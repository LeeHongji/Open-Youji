# Phase 3: Director and Workers - Research

**Researched:** 2026-03-18
**Domain:** Agent orchestration — director intelligence (event-driven Claude sessions via Slack) + persistent worker lifecycle
**Confidence:** HIGH

## Summary

Phase 3 transforms the stub response in `slack-bridge.ts` into a full director intelligence layer (Youji) and adds a worker lifecycle manager. The director is event-driven: each Slack message triggers a fresh Claude SDK session that uses `resume` to reconstruct conversation context from the stored session ID. Workers are persistent-per-project loops that pick tasks from `TASKS.md`, execute in worktrees, commit, and restart as fresh sessions.

The existing codebase provides all building blocks: `slack-bridge.ts` has the message pipeline with the stub injection point, `sdk.ts` wraps the Claude SDK `query()` with supervision, `agent.ts` has `spawnAgent()` with full lifecycle management, `worktree.ts` has `WorktreeManager` for isolation, `task-parser.ts` parses `TASKS.md`, and `push-queue.ts` serializes pushes. The work is primarily integration — wiring these together with two new coordination modules (director and worker-manager) rather than building from scratch.

**Primary recommendation:** Build a `director.ts` module that replaces the stub in `slack-bridge.ts` with a Claude SDK `query()` call using `resume` for multi-turn context, and a `worker-manager.ts` module that manages per-project worker lifecycles with the existing `spawnAgent()` + `WorktreeManager` infrastructure.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Youji writes decomposed tasks to project `TASKS.md` files — reuses existing task system
- Youji proactively decomposes goals without waiting for confirmation. If uncertain, she asks.
- Task granularity: Claude's discretion — adjust based on task complexity
- Full existing tag system reused: `[in-progress]`, `[blocked-by]`, `[skill: execute]`, etc.
- **One persistent worker per project** — each active project gets one dedicated worker
- Worker runs in a continuous loop: pick task from TASKS.md -> execute in worktree -> commit -> restart as fresh session (prevents context bloat)
- When TASKS.md is empty, worker stops. Scheduler periodically checks for new tasks and respawns worker when tasks appear.
- Youji decides worker model (Opus vs Sonnet) per task based on complexity
- **V1 is 1 worker per project.** Future improvement: multiple workers per project for parallelism (noted as deferred)
- Workers use existing worktree isolation (Phase 1): `.worktrees/`, `worker/{taskId}` branches, push queue
- **Proactive push**: Youji sends a Slack DM summary when a worker completes a task
- Summary format: one-line result + diff reference
- Detailed reports only when mentor asks
- **Failure handling**: Worker failure -> Youji immediately notifies mentor in Slack + auto-retries once. If retry also fails -> mark task `[blocked-by: execution failure]`
- Living messages used for long-running tasks (Phase 2 infra ready)
- Director is event-driven: fresh Claude session per Slack message

### Claude's Discretion
- Director system prompt content and persona details
- Exact worker restart mechanism (spawn new process vs scheduler re-trigger)
- How to detect "task complete" vs "task needs more work"
- Worker timeout duration (recommended 15 min based on research)
- How to summarize worker output for the mentor

### Deferred Ideas (OUT OF SCOPE)
- Multiple workers per project for parallelism — future improvement, requires more sophisticated task coordination and conflict avoidance
- Living message infrastructure — hooks ready from Phase 2, wire triggers in Phase 3 or defer to Phase 4
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DIR-01 | Youji responds to mentor messages in Slack threads as a conversational agent | Director module replaces stub in `slack-bridge.ts`; Claude SDK `query()` with `resume` for multi-turn; system prompt with Youji persona; thread history from `ThreadStore` |
| DIR-02 | Youji can spawn worker agents to execute tasks based on mentor instructions | Director calls `WorkerManager.startProject()` after decomposing tasks; WorkerManager uses `spawnAgent()` with worktree isolation |
| DIR-05 | Youji decomposes high-level goals from mentor into concrete tasks in TASKS.md | Director system prompt instructs task decomposition; writes to `projects/{name}/TASKS.md` using existing tag format |
| DIR-06 | Youji reads and respects existing decision records, conventions, and approval gates | Director's Claude session runs with `cwd` set to repo root; `settingSources: ["project", "user"]` loads CLAUDE.md; system prompt references decisions/ and governance conventions |
| WORK-01 | Workers execute in isolated git worktrees with their own branch | `WorktreeManager.allocate(taskId)` creates `.worktrees/{taskId}` with `worker/{taskId}` branch; worker's `spawnAgent()` uses worktree path as `cwd` |
| WORK-02 | Workers receive a single self-contained task and return results via git commit | Worker prompt includes task text + "Done when" condition; `bypassPermissions` mode; auto-commit on release via `WorktreeManager.release()` |
| WORK-03 | Worker pushes are serialized through the existing push queue | `enqueuePushAndWait()` from `rebase-push.ts` called after worker session completes, same pattern as `executor.ts` |
| WORK-04 | Workers have configurable session timeouts (default 15 min) | `AgentProfile.maxDurationMs` set to 900_000 (15 min); `spawnAgent()` already implements duration timeout with interrupt |
| WORK-05 | Zombie workers are detected and terminated (hard timeout + orphan cleanup) | `spawnAgent()` duration timeout handles hard kill; `WorktreeManager.recover()` on startup cleans stale worktrees; WorkerManager tracks active workers for health checks |
| WORK-06 | Task claiming prevents double-pickup across concurrent workers | V1 has one worker per project, so claiming is implicit. In-memory `activeWorkers` map in WorkerManager prevents duplicate project workers. Task is marked `[in-progress: YYYY-MM-DD]` in TASKS.md before execution. |
| OBS-03 | Worker results are summarized and reported to the director | WorkerManager emits completion events; director formats one-line summary from `AgentResult` (text, costUsd, durationMs) and sends via `dm()` or thread reply |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@anthropic-ai/claude-agent-sdk` | ^0.2.42 | Director + worker Claude sessions | Already in use; `query()` with `resume` for multi-turn director; `spawnAgent()` wraps it for workers |
| `@slack/bolt` | ^4.6.0 | Slack message pipeline | Already in use via `slack-bot.ts` and `slack-bridge.ts` |
| `better-sqlite3` | ^12.6.2 | Thread persistence, session ID storage | Already in use via `thread-store.ts` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `vitest` | ^4.0.18 | Testing | All new modules need tests |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| SDK `resume` for director context | Inject full history as prompt prefix | Resume preserves full context without token cost of re-injecting history; but depends on session files persisting on disk. History injection is a reliable fallback. |
| One module for director+worker | Separate `director.ts` and `worker-manager.ts` | Separation maintains single-responsibility; director handles Slack intelligence, worker-manager handles lifecycle |

**Installation:**
No new dependencies required. All libraries already in `package.json`.

## Architecture Patterns

### Recommended Module Structure
```
src/
├── director.ts              # Director intelligence: system prompt, Claude session per message
├── worker-manager.ts        # Worker lifecycle: spawn, monitor, restart, stop per project
├── slack-bridge.ts          # MODIFIED: replaces stub with director.handleMessage()
├── api/server.ts            # MODIFIED: add worker status endpoints
├── agent.ts                 # MODIFIED: add directorSession + projectWorker profiles
├── service.ts               # MODIFIED: add worker check polling in tick()
└── (existing modules unchanged)
```

### Pattern 1: Director as Event-Driven Claude Session
**What:** Each Slack message triggers a fresh `query()` call with `resume: sessionId` to reconstruct conversation context. The director does not maintain a persistent LLM session.
**When to use:** Every incoming Slack message.
**How it works:**

1. `slack-bridge.ts` `handleMessage()` receives a Slack message
2. Loads conversation history from `ThreadStore`
3. Looks up or creates a Claude session ID for this thread (stored in ThreadStore or a new `director_sessions` table)
4. Calls `director.handleMessage()` which runs `query()` with:
   - `resume: storedSessionId` (if continuing a thread)
   - `systemPrompt: { type: "preset", preset: "claude_code", append: youjiDirective }`
   - `cwd: repoDir`
   - `permissionMode: "bypassPermissions"` (unattended)
   - `maxTurns: 16` (prevent runaway)
5. Stores the returned `sessionId` for future resume
6. Returns response text to Slack

**Key detail from SDK docs (HIGH confidence):** The `resume` option in `query()` automatically loads full conversation history and context. The session ID comes from the `system.init` message or the `result` message. Session data persists on the local filesystem.

### Pattern 2: Worker Manager Lifecycle
**What:** A singleton `WorkerManager` tracks one active worker per project. Workers are spawned via `spawnAgent()` with `cwd` set to an allocated worktree.
**When to use:** When director decomposes tasks and starts a project worker.

**Lifecycle:**
```
Director decomposes tasks → writes TASKS.md
    ↓
WorkerManager.startProject(projectName)
    ↓
Loop:
  1. Parse TASKS.md → find first open, unblocked task
  2. Mark task [in-progress: YYYY-MM-DD]
  3. WorktreeManager.allocate(taskId)
  4. spawnAgent({ profile: projectWorker, cwd: worktreePath, prompt: taskPrompt })
  5. Await result
  6. WorktreeManager.release(taskId) → auto-commit, merge to main
  7. enqueuePushAndWait() → push to origin
  8. Notify director/Slack of result
  9. If more tasks → restart loop (fresh session)
  10. If TASKS.md empty → worker stops
    ↓
Scheduler periodically checks TASKS.md → respawns when tasks appear
```

### Pattern 3: Director System Prompt Construction
**What:** The director's system prompt defines Youji's persona and capabilities.
**Structure:**
```
System prompt = claude_code preset + append:
  - Youji persona (name, role as research institute director)
  - Available actions: decompose tasks, spawn workers, report status
  - TASKS.md format and tag conventions
  - Task decomposition guidelines
  - Constraint: read decisions/ before making choices
  - Constraint: respect approval gates
  - Current project status summary (injected per-message)
```

### Pattern 4: Worker Task Prompt Construction
**What:** Each worker receives a focused prompt with exactly one task.
**Structure:**
```
TASK: {task text}
DONE WHEN: {done-when condition}
PROJECT: {project name}
BRANCH: worker/{taskId}

Instructions:
- Complete the task described above
- Commit your work with descriptive messages
- Do not modify files outside this project's scope
- If blocked, explain what's needed and stop
```

### Anti-Patterns to Avoid
- **Persistent director LLM session:** The director must NOT maintain a long-running Claude session. Each message gets a fresh session with `resume` for context. This prevents context window bloat and allows the director to scale.
- **Worker modifying TASKS.md directly:** Workers should NOT modify TASKS.md (marking tasks done). The WorkerManager handles task state transitions after the worker session completes.
- **Polling TASKS.md from within the director Claude session:** The director should not poll. The WorkerManager's loop handles task iteration.
- **Multiple workers per project in V1:** Explicitly deferred. One worker per project avoids git conflicts and task coordination complexity.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Conversation context | Custom history injection | SDK `resume` option | SDK handles full context restoration from session files |
| Agent session lifecycle | Custom process management | `spawnAgent()` from `agent.ts` | Handles timeout, sleep guard, pm2 guard, stall guard, session registry |
| Worktree isolation | Custom branch management | `WorktreeManager` from `worktree.ts` | Handles allocate, release, merge, conflict fallback, recovery |
| Push serialization | Custom push logic | `enqueuePushAndWait()` from `rebase-push.ts` | Priority queue with rebase, fallback branch on conflict |
| Task parsing | Custom TASKS.md parser | `task-parser.ts` utilities | Regex patterns for all tag types already defined |
| Slack message pipeline | Custom WebSocket handling | `slack-bridge.ts` pipeline | Lock, store, process, reply pattern already implemented |

**Key insight:** Phase 3 is an integration phase. Every major subsystem already exists. The work is wiring them together, not building new infrastructure.

## Common Pitfalls

### Pitfall 1: SDK `resume` Session File Expiry
**What goes wrong:** Claude SDK stores session files on the local filesystem. If the scheduler restarts or disk is cleaned, session files are lost, and `resume` fails.
**Why it happens:** Session files are ephemeral by default.
**How to avoid:** Implement a fallback: if `resume` fails (session not found), start a fresh session and inject recent conversation history from `ThreadStore` as a prompt prefix. Store the new session ID.
**Warning signs:** `resume` call throws an error or returns unexpected results.

### Pitfall 2: Worker TASKS.md Race Condition
**What goes wrong:** Director writes new tasks to TASKS.md while the worker is reading it.
**Why it happens:** Both director and worker operate on the same repo, potentially concurrently.
**How to avoid:** V1 has one worker per project, and the director writes tasks before starting the worker. The WorkerManager's loop re-parses TASKS.md between tasks, which naturally picks up new tasks. For the rare case where the director adds tasks mid-execution, the worker won't see them until the current task finishes — this is acceptable for V1.
**Warning signs:** Worker picks up a partially-written task.

### Pitfall 3: Worker Worktree Merge Conflicts
**What goes wrong:** Worker's `worker/{taskId}` branch diverges from main if other workers or the director committed to main during execution.
**Why it happens:** V1 has one worker per project, but the director session also runs in the main repo and may commit.
**How to avoid:** `WorktreeManager.release()` already handles this with rebase + ff-only merge, falling back to a `session-{taskId}` branch on conflict. The push queue (`enqueuePushAndWait()`) further serializes pushes. This is sufficient for V1.
**Warning signs:** `WorktreeReleaseResult` has `merged: false` with a `fallbackBranch`.

### Pitfall 4: Director Timeout During Task Decomposition
**What goes wrong:** Director's Claude session times out before completing task decomposition and writing TASKS.md.
**Why it happens:** Complex goals require multiple read/write operations.
**How to avoid:** Set `maxTurns: 16` and `maxDurationMs: 120_000` (2 min) for the director profile. If the director can't decompose in 16 turns, it should ask the mentor for clarification rather than continuing indefinitely.
**Warning signs:** Director session result has `timedOut: true`.

### Pitfall 5: Zombie Workers After Scheduler Restart
**What goes wrong:** Workers spawned as child processes become orphans when the scheduler restarts.
**Why it happens:** `spawnAgent()` spawns the Claude SDK process, which is a child of the scheduler.
**How to avoid:** On scheduler startup, call `WorktreeManager.recover()` to clean up stale worktrees. Track active worker PIDs and send SIGTERM on shutdown. The `SchedulerService.startDrain()` pattern already handles graceful shutdown.
**Warning signs:** Stale worktrees in `.worktrees/` after scheduler restart.

### Pitfall 6: Director Can't Distinguish Worker Success from Partial Completion
**What goes wrong:** Worker session completes without error but didn't fully finish the task.
**Why it happens:** Worker may have committed intermediate progress and then hit a turn limit.
**How to avoid:** After worker completes, re-parse TASKS.md to check if the task's "Done when" condition is met. If the worker's output text contains keywords like "blocked", "need more", or the task remains `[in-progress]`, treat as incomplete. Options: auto-retry with continued context, or mark task as needing review.
**Warning signs:** Worker `AgentResult.text` contains blockers or the task's done-when hasn't been verified.

## Code Examples

### Director handleMessage Integration

```typescript
// In slack-bridge.ts — replace stub response
import { handleDirectorMessage } from "./director.js";

// Inside handleMessage():
// const response = `Got it. (${history.length} messages in this thread)`;  // REMOVE
const response = await handleDirectorMessage({
  convKey,
  userMessage: msg.text,
  history,
  repoDir,
  store,  // ThreadStore for session ID lookup/storage
});
```

### Director Module Core

```typescript
// director.ts
import { runQuery, type QueryResult } from "./sdk.js";

export interface DirectorMessageOpts {
  convKey: string;
  userMessage: string;
  history: ThreadMessage[];
  repoDir: string;
  store: ThreadStore;
}

export async function handleDirectorMessage(opts: DirectorMessageOpts): Promise<string> {
  const sessionId = lookupSessionId(opts.store, opts.convKey);

  const result = await runQuery({
    prompt: opts.userMessage,
    cwd: opts.repoDir,
    model: "opus",
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: buildYoujiDirective(opts),
    },
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    maxTurns: 16,
    resume: sessionId ?? undefined,
    settingSources: ["project", "user"],
  });

  // Store new session ID for future resume
  storeSessionId(opts.store, opts.convKey, result.sessionId);

  return result.text;
}
```

### Worker Manager Core

```typescript
// worker-manager.ts
import { spawnAgent, AGENT_PROFILES } from "./agent.js";
import { WorktreeManager } from "./worktree.js";
import { parseTasksFile } from "./task-parser.js"; // extended
import { enqueuePushAndWait } from "./rebase-push.js";

const PROJECT_WORKER_PROFILE = {
  model: "opus",
  maxTurns: 64,
  maxDurationMs: 900_000, // 15 min
  label: "project-worker",
};

export class WorkerManager {
  private activeWorkers = new Map<string, { sessionId: string; taskId: string }>();

  async startProject(project: string): Promise<void> {
    if (this.activeWorkers.has(project)) return; // already running

    await this.runWorkerLoop(project);
  }

  private async runWorkerLoop(project: string): Promise<void> {
    while (true) {
      const task = this.pickNextTask(project);
      if (!task) break; // TASKS.md empty, stop

      this.markInProgress(project, task);
      const alloc = await this.worktreeManager.allocate(task.taskId);
      if (!alloc.ok) { /* handle error */ break; }

      const { result } = spawnAgent({
        profile: PROJECT_WORKER_PROFILE,
        prompt: buildWorkerPrompt(task),
        cwd: alloc.info.path,
      });

      const agentResult = await result;
      await this.worktreeManager.release(task.taskId);
      await enqueuePushAndWait(this.repoDir, agentResult.sessionId ?? "unknown");

      this.notifyCompletion(project, task, agentResult);
      // Loop continues: fresh session for next task
    }

    this.activeWorkers.delete(project);
  }
}
```

### Agent Profile Additions

```typescript
// In agent.ts AGENT_PROFILES:
directorSession: {
  model: "opus",
  maxTurns: 16,
  maxDurationMs: 120_000,  // 2 min — director should be fast
  label: "director",
},
projectWorker: {
  model: "opus",       // overridden per-task by director
  maxTurns: 64,
  maxDurationMs: 900_000,  // 15 min
  label: "project-worker",
},
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Inject full history as prompt | SDK `resume` option | SDK v0.2.x | Preserves full context without re-tokenizing history |
| Module-level mocking | Dependency injection | Phase 1 | WorktreeManager uses DI for testability; follow same pattern |
| Single-backend spawning | Multi-backend with fallback | Pre-Phase 3 | Workers can use any backend (claude/cursor/opencode) |

**Deprecated/outdated:**
- None identified for the technologies in use.

## Open Questions

1. **SDK `resume` reliability for multi-day conversations**
   - What we know: SDK `resume` works by storing session files on disk. The `resume` option is well-documented and tested for single-day use.
   - What's unclear: How long session files persist. Whether they survive scheduler restarts. STATE.md notes this is "MEDIUM confidence (70%)".
   - Recommendation: Implement `resume` as primary, with history-injection fallback. Test empirically during Phase 3 implementation. The fallback ensures the director always works even if `resume` fails.

2. **Director tool access scope**
   - What we know: Director needs Read/Write/Glob/Grep to read project state and write TASKS.md. It should NOT have Bash access to avoid running arbitrary commands.
   - What's unclear: Whether restricting tools via `allowedTools` while using `bypassPermissions` works as expected.
   - Recommendation: Test tool restriction with `allowedTools: ["Read", "Write", "Glob", "Grep", "Edit"]` in combination with `bypassPermissions`. If the SDK doesn't support this combination, use `disallowedTools: ["Bash", "Shell"]` instead.

3. **Worker output summarization strategy**
   - What we know: Worker `AgentResult` contains `.text` (final response), `.costUsd`, `.durationMs`, `.numTurns`.
   - What's unclear: Whether `.text` is a reliable summary or may contain verbose output.
   - Recommendation: Use worker's final `.text` as the primary summary. If too long (>500 chars), truncate with "..." and offer full log on request. The worker prompt should instruct: "End with a one-line summary of what you accomplished."

## Sources

### Primary (HIGH confidence)
- Claude Agent SDK docs — `resume` option, system prompt configuration, permission modes (Context7 `/websites/platform_claude_en_agent-sdk`)
- Existing codebase — all module APIs verified by reading source files directly

### Secondary (MEDIUM confidence)
- STATE.md — SDK `resume` for multi-day conversations rated 70% confidence
- Worker timeout of 15 min — based on existing `fleetWorker` profile at 900_000ms

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies, all libraries already in use
- Architecture: HIGH — integration of existing modules with well-documented APIs
- Pitfalls: HIGH — based on direct codebase analysis and SDK documentation
- Resume reliability: MEDIUM — SDK docs confirm feature exists, but multi-day persistence untested

**Research date:** 2026-03-18
**Valid until:** 2026-04-17 (30 days — stable technologies, existing codebase)
