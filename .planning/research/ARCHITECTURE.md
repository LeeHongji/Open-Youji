# Architecture Patterns

**Domain:** Autonomous AI research agent with Slack interface, Claude CLI backend
**Researched:** 2026-03-15
**Overall confidence:** HIGH (based on existing codebase analysis + Claude CLI docs)

## Recommended Architecture

The migration simplifies the existing multi-backend scheduler into a single-backend system with Slack as the primary human interface. The core insight: the existing architecture is already well-structured. The migration is subtractive (remove backends) plus additive (promote Slack from reference to production).

```
                    ┌─────────────────────────────┐
                    │        Slack Bot             │
                    │   (Socket Mode, Bolt SDK)    │
                    │                              │
                    │  • Receives mentor messages   │
                    │  • Slash commands / DMs       │
                    │  • Posts summaries + threads  │
                    └──────────┬──────────┬────────┘
                               │          │
                    inbound    │          │  outbound
                    messages   │          │  notifications
                               │          │
                    ┌──────────▼──────────▼────────┐
                    │      Scheduler Daemon         │
                    │   infra/scheduler/ (TS)       │
                    │                               │
                    │  ┌──────────┐  ┌───────────┐  │
                    │  │ Cron     │  │ Slack     │  │
                    │  │ Poller   │  │ Listener  │  │
                    │  └────┬─────┘  └─────┬─────┘  │
                    │       │              │        │
                    │  ┌────▼──────────────▼─────┐  │
                    │  │     Task Router          │  │
                    │  │  (scheduled + on-demand) │  │
                    │  └────────────┬─────────────┘  │
                    │               │               │
                    │  ┌────────────▼─────────────┐  │
                    │  │     Budget Gate           │  │
                    │  └────────────┬─────────────┘  │
                    │               │               │
                    │  ┌────────────▼─────────────┐  │
                    │  │  Claude CLI Backend       │  │
                    │  │  (sole execution engine)  │  │
                    │  └────────────┬─────────────┘  │
                    │               │               │
                    │  ┌────────────▼─────────────┐  │
                    │  │   Push Queue + Verify     │  │
                    │  └──────────────────────────┘  │
                    └───────────────┬────────────────┘
                                    │
                         spawns `claude` CLI
                                    │
                    ┌───────────────▼────────────────┐
                    │     Agent Session               │
                    │  (stateless, ephemeral)          │
                    │                                  │
                    │  Claude CLI process              │
                    │  --print / --output-format json  │
                    │  Full MCP, skills, CLAUDE.md     │
                    │  access via native Claude Code   │
                    └──────────────────────────────────┘
```

### Component Boundaries

| Component | Responsibility | Communicates With | Interface |
|-----------|---------------|-------------------|-----------|
| **Slack Bot** | Receives mentor messages, posts results, manages threads, handles slash commands, approval UX | Scheduler (in-process), Mentor (Slack API) | Slack Socket Mode (inbound), Slack Web API (outbound) |
| **Scheduler Daemon** | Cron-based job scheduling, session lifecycle management, metrics recording | Slack Bot (in-process), Claude CLI Backend (spawns process), Push Queue, Budget Gate | pm2-managed Node.js process |
| **Task Router** | Merges scheduled jobs + on-demand Slack requests into a unified execution queue | Scheduler internal module | Function calls |
| **Claude CLI Backend** | Spawns `claude` CLI process, captures output (JSON stream), enforces timeouts | Scheduler (parent process) | child_process spawn, stdout JSON stream |
| **Budget Gate** | Pre-execution budget check | Scheduler, budget.yaml/ledger.yaml files | Function call |
| **Push Queue** | Serialized git push with rebase-retry | Scheduler, Git | Function call + child_process |
| **Slack Notifier** | Posts session start/complete/error to Slack channels and threads | Slack Web API | Slack Block Kit messages |
| **Experiment Runner** | Fire-and-forget long-running tasks | Scheduler API (registration), progress.json | Detached Python process |
| **Budget Verify** | Offline budget reconciliation | Ledger files, CF Gateway logs | CLI tool (Python) |

### Data Flow

#### Flow 1: Mentor Slack message to task execution

```
1. Mentor sends DM or channel message in Slack
   │
2. Slack Bot receives via Socket Mode event
   │
3. Message classifier determines intent:
   │  ├── Quick question → Chat agent (Sonnet, fast, in-thread reply)
   │  ├── Task assignment → Deep work session (Opus, spawns Claude CLI)
   │  ├── Slash command (/status, /budget, /approve) → Direct handler
   │  └── Approval response → Approval queue update
   │
4. For task execution:
   │  a. Slack Bot posts "Starting..." with session ID to thread
   │  b. Task Router creates ephemeral Job object
   │  c. Budget Gate checks resource availability
   │  d. Claude CLI Backend spawns: `claude -p --output-format stream-json --model opus ...`
   │  e. Progress handler streams tool summaries + text to Slack thread
   │  f. On completion: session text captured
   │
5. Post-session:
   │  a. Auto-commit orphaned files (if any)
   │  b. Push queue: rebase + push to origin
   │  c. Verify.ts: post-session quality check
   │  d. Metrics recorded to sessions.jsonl
   │  e. Slack Bot posts summary to channel, details in thread
```

#### Flow 2: Scheduled autonomous session

```
1. Cron poller fires (every 30s check)
   │
2. Job is due → Budget Gate check
   │
3. Claude CLI Backend spawns session with orient prompt
   │
4. Agent reads repo (/orient), picks task, executes, commits
   │
5. Post-session pipeline (same as Flow 1, step 5)
   │
6. Slack notification: summary to designated channel
```

#### Flow 3: Chat (quick Q&A)

```
1. Mentor sends message in chat-mode channel
   │
2. Slack Bot classifies as chat (no task keyword)
   │
3. Claude CLI spawned with Sonnet profile (16 turns, 2 min max)
   │  - Thread context from prior messages injected
   │  - Read-only: no Edit/Write tools, no git push
   │
4. Response posted directly in Slack thread
```

## Claude CLI Backend Design

**Key decision: Use `claude` CLI (Claude Code) instead of the Agent SDK.**

The existing `ClaudeBackend` in `backend.ts` wraps `@anthropic-ai/claude-agent-sdk`. The new backend replaces this with `claude` CLI process spawning. This is the single most impactful change.

### Why Claude CLI over Agent SDK

| Aspect | Agent SDK | Claude CLI |
|--------|-----------|------------|
| MCP support | Manual setup | Native (reads .claude/settings.json) |
| Skills | Manual injection | Native (/skill invocation) |
| CLAUDE.md | Must inject as system prompt | Auto-loaded |
| Tool permissions | Programmatic | --dangerously-skip-permissions or allowedTools |
| Output format | SDK events | `--output-format stream-json` (NDJSON) |
| Plan mode | Must handle SDK events | Native support |
| Dependencies | npm package + API key | CLI binary on PATH |
| Session resume | SDK session ID | `--resume` flag |
| Cost tracking | SDK events | JSON result message |
| Model selection | `--model` option | `--model` option |
| Agent Teams | SDK agents config | `--agent-teams` flag (if available) |

### Claude CLI Invocation Pattern

```typescript
// Spawn pattern (replaces sdk.ts)
const proc = spawn("claude", [
  "-p",                           // print mode (non-interactive)
  "--output-format", "stream-json", // NDJSON progress stream
  "--model", profile.model,
  "--max-turns", String(profile.maxTurns),
  "--dangerously-skip-permissions", // headless autonomous mode
  prompt,
], {
  cwd: repoDir,
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env },
  timeout: profile.maxDurationMs,
});
```

The JSON stream from `--output-format stream-json` emits the same event types as the existing `parseCursorMessage` / `parseOpenCodeMessage` parsers. The existing `onMessage` callback pattern and progress handler infrastructure can be reused with minimal changes.

### Backend Module Refactoring

**Remove:** `ClaudeBackend` (SDK), `CursorBackend`, `OpenCodeBackend`, `FallbackBackend`
**Remove:** `sdk.ts` (Agent SDK wrapper), `opencode-db.ts`, model maps, fallback detection
**Replace with:** Single `ClaudeCLIBackend` class

```
Before (backend.ts):
  ClaudeBackend (SDK) → CursorBackend (CLI) → OpenCodeBackend (CLI) → FallbackBackend

After (backend.ts):
  ClaudeCLIBackend (CLI spawn only)
```

The `AgentBackend` interface stays the same (`runQuery`, `runSupervised`). The `SessionHandle` interface stays the same (`interrupt`, `backend`). Only the implementations change.

### Message Parsing

Claude CLI `--output-format stream-json` emits NDJSON with types:
- `system` (init, with session_id)
- `assistant` (text blocks, tool_use blocks)
- `tool_result` (tool outputs)
- `result` (final: cost, turns, duration, session_id)

This maps directly to the existing `SDKMessage` type. The `parseCursorMessage` function is already the right shape — rename/adapt it for Claude CLI output.

## Slack Integration Design

**Promote from reference to production.** The existing `reference-implementations/slack/` is a comprehensive 700+ line implementation. The migration is:

1. Move `reference-implementations/slack/slack.ts` → `src/slack.ts` (already exists as stub)
2. Move `reference-implementations/slack/chat/` → `src/chat/`
3. Move `reference-implementations/slack/living-message*.ts` → `src/`
4. Wire into `cli.ts` startup (Socket Mode connection)
5. Update imports from reference-local types to main `types.ts`

### Slack App Structure

```
Slack App (Socket Mode)
├── Event: message (DM or channel)
│   ├── Chat-mode channel → Chat agent (Sonnet, read-only)
│   ├── Dev-mode channel → Full agent access
│   └── DM → Deep work or chat (based on message content)
├── Event: app_mention
│   └── Same as message routing
├── Slash commands (optional)
│   ├── /status → Current session + experiment status
│   ├── /budget → Budget dashboard
│   └── /approve <id> → Approval queue resolution
├── Actions (Block Kit buttons)
│   ├── approve_* → Approve pending item
│   └── reject_* → Reject pending item
└── Outbound notifications
    ├── Session start → Channel message
    ├── Session progress → Thread updates (living message)
    ├── Session complete → Thread summary
    ├── Experiment events → Thread updates
    └── Approval requests → DM with buttons
```

### Message Format: Summary + Thread Pattern

```
Channel message (summary):
┌─────────────────────────────────────────┐
│ ✅ Session complete: work-session       │
│ Duration: 312s | Turns: 45 | Cost: $2.31│
│ Task: Analyze experiment results for X  │
│ 📝 2 files committed, pushed to origin  │
│                                         │
│ [View details in thread →]              │
└─────────────────────────────────────────┘

Thread (details):
├── 🔧 Read projects/x/EXPERIMENT.md
├── 📊 Analyzed 96 results across 3 dimensions
├── 📝 Wrote findings to EXPERIMENT.md
├── ✅ Deep work complete (312s, 45 turns, $2.31)
│   <full agent summary text>
```

## Patterns to Follow

### Pattern 1: Single Backend, Single Binary

**What:** All agent sessions (work, chat, autofix, deep work) spawn the same `claude` binary with different profiles (model, max-turns, timeout).
**When:** Always. No fallback chain, no backend negotiation.
**Why:** Eliminates the entire backend abstraction layer (FallbackBackend, shouldFallback, isRateLimitError, isBillingError). If Claude CLI is unavailable, the system is down — fail loudly.

### Pattern 2: In-Process Slack + Scheduler

**What:** Slack bot runs in the same Node.js process as the scheduler daemon. Not a separate service.
**When:** Single-mentor, local Mac deployment.
**Why:** Avoids inter-process communication complexity. The reference implementation already assumes in-process access to job store, session state, and experiment tracking. Separate services would require an API layer that adds complexity without benefit for a single-user system.

### Pattern 3: Event-Driven Task Creation

**What:** Slack messages create ephemeral Job objects that are immediately executed (not persisted to jobs.json). Scheduled jobs remain cron-based and persistent.
**When:** Mentor sends a task via Slack.
**Why:** The existing `spawnDeepWork` function in `event-agents.ts` already implements this pattern. It creates an agent session directly without going through the job store. This is the right approach — Slack-triggered tasks are one-shot, not recurring.

### Pattern 4: Thread-Based Context Inheritance

**What:** When a mentor replies in a Slack thread, the thread history is injected into the new agent session's prompt. This allows multi-turn research conversations.
**When:** Follow-up messages in a Slack thread.
**Why:** Already implemented in the reference chat system. Agent sessions are stateless, but thread context provides continuity.

## Anti-Patterns to Avoid

### Anti-Pattern 1: Separate Slack Microservice

**What:** Running the Slack bot as a separate process/service from the scheduler.
**Why bad:** Requires IPC, shared state management, deployment coordination. For a single-user local Mac system, this is pure overhead.
**Instead:** In-process Slack bot within the scheduler daemon.

### Anti-Pattern 2: Persistent Task Queue for Slack Requests

**What:** Writing Slack-triggered tasks to a database/file queue, then having the scheduler pick them up.
**Why bad:** Adds latency, persistence complexity, and failure modes. Slack requests need immediate response — the mentor is watching.
**Instead:** Direct spawn via `spawnDeepWork` pattern. The session is the task.

### Anti-Pattern 3: Streaming Raw Agent Output to Slack

**What:** Forwarding every Claude CLI output event directly to Slack.
**Why bad:** Creates noisy, unreadable threads. Tool call details and intermediate reasoning are not useful for the mentor.
**Instead:** Use the existing `buildProgressHandler` with tool-summary batching (2s debounce) and text-only forwarding.

### Anti-Pattern 4: Keeping Multi-Backend Fallback

**What:** Maintaining the Claude SDK, Cursor, or opencode backends "just in case."
**Why bad:** Dead code, maintenance burden, test complexity. The whole point of this migration is simplification.
**Instead:** Remove all backends except Claude CLI. If Claude CLI breaks, fix Claude CLI.

## Suggested Build Order

Dependencies between components determine build order. Each phase produces a working system.

### Phase 1: Claude CLI Backend (Foundation)

**Build:**
- `ClaudeCLIBackend` class implementing existing `AgentBackend` interface
- Claude CLI JSON stream parser (adapt from existing `parseCursorMessage`)
- Update `resolveBackend()` to return `ClaudeCLIBackend` only

**Why first:** Everything depends on the execution engine. The existing scheduler, executor, event-agents, and Slack code all call through `AgentBackend`. Swapping the implementation while keeping the interface means all downstream code continues to work.

**Done when:** `executeJob()` successfully spawns a Claude CLI session, captures output, and records metrics. Existing cron jobs work with the new backend.

**Dependencies:** None — pure replacement of existing abstraction.

### Phase 2: Backend Cleanup (Simplification)

**Build:**
- Remove `sdk.ts` (Agent SDK wrapper), `opencode-db.ts`
- Remove `ClaudeBackend`, `CursorBackend`, `OpenCodeBackend`, `FallbackBackend` from `backend.ts`
- Remove `@anthropic-ai/claude-agent-sdk` dependency from package.json
- Remove backend preference system (`backend-preference.ts`, `AGENT_BACKEND` env var)
- Remove model maps (CURSOR_MODEL_MAP, OPENCODE_MODEL)
- Simplify `agent.ts`: remove `BACKEND_PROFILE_OVERRIDES` (only one backend now)

**Why second:** After Phase 1 validates the new backend works, remove the old code. This is mechanical deletion — low risk, high signal (if tests still pass, the migration is clean).

**Done when:** `npm run build` succeeds, all tests pass, `backend.ts` contains only `ClaudeCLIBackend`.

**Dependencies:** Phase 1.

### Phase 3: Slack Bot (Integration)

**Build:**
- Move reference Slack implementation to production (`reference-implementations/slack/` → `src/`)
- Wire Slack Socket Mode connection into `cli.ts` startup
- Connect `notifySessionStarted` / `notifySessionComplete` to production Slack bot
- Implement message routing: DM → deep work, channel → chat
- Connect `spawnDeepWork` and chat to use new Claude CLI backend

**Why third:** The Slack bot is the user-facing interface. It depends on the execution engine (Phase 1) being stable. The reference implementation is comprehensive — this phase is primarily wiring, not new feature development.

**Done when:** Mentor can send a Slack DM, Youji spawns a Claude CLI session, and posts results back to the thread.

**Dependencies:** Phase 1 (Claude CLI backend must work).

### Phase 4: Polish + Self-Evolution

**Build:**
- Approval UX via Slack buttons (Block Kit actions)
- Status dashboard via slash commands
- Self-evolution: Youji creates PRs via `gh` CLI, posts PR link to Slack for review
- Living message integration (real-time session progress in a single updating message)

**Why last:** These are quality-of-life features. The system is functional after Phase 3. Phase 4 makes it polished.

**Done when:** Full interaction loop works — mentor assigns tasks, gets results, approves PRs, checks status, all through Slack.

**Dependencies:** Phase 3 (Slack bot must be wired).

## Scalability Considerations

| Concern | Current (1 mentor) | At 5 mentors | At 20 mentors |
|---------|---------------------|--------------|---------------|
| Concurrent sessions | 1-2 | Needs session queue | Needs external job queue (Redis/BullMQ) |
| Slack channels | 1 DM + 1 channel | Per-mentor DMs | Dedicated workspace, channel-per-project |
| Claude CLI cost | ~$5-20/day | Need per-user budgets | Need billing split |
| Git conflicts | Push queue handles | Push queue handles | Branch-per-session strategy |
| Process management | pm2 | pm2 | Kubernetes/Docker |

**For the current single-mentor scope:** None of these scalability concerns apply. The in-process architecture is correct. Do not pre-optimize.

## Sources

- Existing codebase analysis: `infra/scheduler/src/backend.ts`, `executor.ts`, `event-agents.ts`, `agent.ts`, `sdk.ts` (HIGH confidence)
- Reference Slack implementation: `infra/scheduler/reference-implementations/slack/` (HIGH confidence — first-party code)
- Claude CLI documentation: `claude -p --output-format stream-json` behavior (MEDIUM confidence — based on Cursor/opencode CLI patterns in codebase, which follow the same NDJSON convention)
- Architecture decisions: `decisions/` directory, 66 ADRs (HIGH confidence — first-party decisions)
