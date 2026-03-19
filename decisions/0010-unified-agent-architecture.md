# 0010: Unified Agent Architecture

Date: 2026-02-16
Status: accepted

## Context

The youji scheduler had three separate agent spawn points with duplicated infrastructure and fragmented capabilities:

1. **Work sessions** (executor.ts) — full Claude Code preset, all tools, all skills, CLAUDE.md loaded. Model: opus, no turn limit, 60 min timeout.
2. **Chat** (chat.ts:spawnChatAsync) — custom system prompt with action-tag protocol inlined, restricted to 5 tools (`Read, Glob, Grep, Edit, Bash`), maxTurns: 5, model: sonnet. No skills, no CLAUDE.md, no Write tool.
3. **Autofix** (chat.ts:autoFixExperiment) — custom diagnostic system prompt, same 5 restricted tools, maxTurns: 32, model: sonnet. No skills, no CLAUDE.md.

Design tension: **capability fragmentation vs cost control**. Restricting chat/autofix agents was originally a cost measure (fewer tools = fewer turns = lower cost), but it created real failures: autofix agents exhausted 32 turns without producing a diagnosis because they lacked the full tool suite that work sessions had.

## Decision

Introduce a unified `spawnAgent()` function (`infra/scheduler/src/agent.ts`) that all three triggers use. All agents now share:

- **System prompt**: `{ type: "preset", preset: "claude_code" }` — full Claude Code prompt with CLAUDE.md and skills
- **Tools**: `{ type: "preset", preset: "claude_code" }` — all tools including Write, Task, Skill
- **Settings**: `settingSources: ["project", "user"]`
- **Permissions**: `bypassPermissions` (agents run autonomously)

Differentiation is via `AgentProfile`:

| Profile | Model | maxTurns | Timeout |
|---|---|---|---|
| workSession | opus | unlimited | 60 min |
| chat | sonnet (env override) | 16 | 2 min |
| autofix | opus | 32 | 10 min |

The action-tag protocol for Slack coordination was extracted from `buildSystemPrompt()` into a `/coordinator` skill (`.claude/skills/coordinator/SKILL.md`), which the chat agent references via its prompt preamble.

Security interception (Bash command validation) remains in the chat message handler — it's a caller concern, not an agent concern.

Shared utilities (`summarizeToolUses`, `createToolBatchFlusher`) were extracted to `agent.ts` to eliminate duplication between chat and autofix message handlers.

## Consequences

- All agents now have full capability (skills, Write tool, Task tool). This resolves the autofix exhaustion problem and lets chat agents do things like create files.
- Cost may increase slightly for chat (more capable tools = potentially more turns), mitigated by maxTurns: 16 and 2 min timeout.
- Autofix uses opus instead of sonnet — more expensive per-turn but more efficient overall (fewer wasted turns).
- New agent types can be added by defining a profile and calling `spawnAgent()` — no need to duplicate infrastructure.
- Event-triggered agents (autofix, deep work) were extracted into `event-agents.ts` with a shared `buildProgressHandler()` pattern. This makes it straightforward to add new event-triggered agents (e.g., experiment completion analysis, verification remediation) by providing a prompt builder and completion handler.
- The `[ACTION:deep_work]` action tag provides on-demand escalation from chat to a longer opus session, completing the work mode taxonomy: communicate (chat), deep work (event agent), code jobs (experiment launches via shell).
- The `/architecture` skill was updated to require plan mode for redesigns, ensuring future architectural changes get user approval before implementation.
