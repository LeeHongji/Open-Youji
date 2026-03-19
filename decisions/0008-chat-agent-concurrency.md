# 0008: Chat Agent Concurrency and Action Tag Protocol

Date: 2026-02-16
Status: accepted

## Context

The chat-as-primary-interface refactor (routing all Slack commands through a natural language chat agent with action tags) exposed concurrency bugs in its first real-world test. Three root causes were identified:

1. **No per-conversation mutex.** Interleaved async operations at `await` boundaries caused races between message processing and agent completion handlers.
2. **No stale-completion guard.** When a user interrupts an in-flight agent and sends a new message, the old agent's `.then()` handler still runs and mutates conversation state.
3. **ACTION tags leaked to users.** The progress handler forwarded raw assistant text including `[ACTION:...]` tags that are meant for internal parsing only.

Two architectural approaches were considered: (a) keep action tags with fixes, or (b) migrate to MCP structured tool output.

## Decision

Keep the action-tag protocol. Add three fixes:

1. **Per-conversation mutex** (`ConversationLock`): promise-based lock acquired by `processMessage` to prevent interleaved operations on the same conversation.
2. **Generation counter**: monotonic integer on `ConversationState`, incremented on each `spawnChatAsync`. The `.then()` handler checks `conv.generation === spawnGeneration` and skips state mutation if stale.
3. **Tag stripping** (`stripActionTags`): regex removal of `[ACTION:...]` tags from text before forwarding via `onProgress`. Raw text preserved in `lastProgressText` for dedup.

## Consequences

- **Simpler than MCP.** MCP structured tool output would eliminate tag leaking by design but adds: server lifecycle management, protocol negotiation, additional dependency. It does NOT fix the concurrency issues (shared mutable state is the root cause regardless of how the agent communicates actions).
- **Tag stripping is a workaround, not a solution.** If the agent generates malformed tags or tags in unexpected positions, stripping may produce odd formatting. Acceptable for now; monitor in production.
- **Mutex serializes conversation handling.** A slow agent query blocks subsequent messages for that conversation. Acceptable because: (a) conversations are independent (no cross-conversation blocking), (b) the interrupt-and-replace pattern means only one agent runs per conversation anyway.
- **Generation counter is a lightweight version of a cancellation token.** It only prevents state mutation, not execution. The interrupted agent still runs to completion (or until the backend terminates it). Resource waste is bounded by `maxTurns`.
