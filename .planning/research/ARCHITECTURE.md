# Open-Youji Architecture

Research document covering the target architecture for the Open-Youji autonomous research system.

## 1. Component Boundaries

### 1.1 Youji Director (persistent, Slack-resident)

The director is the system's single persistent agent identity. It communicates with a human mentor via Slack and orchestrates all worker activity.

**Responsibilities:**
- Receives human instructions via Slack messages
- Maintains conversational context per Slack thread
- Decides what work to do: task selection, prioritization, decomposition
- Spawns worker agents for task execution
- Reports results back to the human in Slack
- Makes strategic decisions (what to research, which experiments to run)

**Implementation:** A long-lived process that connects to Slack via Socket Mode (WebSocket). Uses the Claude Agent SDK to run a persistent Claude Code session that acts as the director's "brain." The director is NOT a continuously-running LLM session — it is an event-driven process that invokes Claude when a Slack event arrives (message, reaction, etc.) and maintains state in the git repo between invocations.

**Key design question — stateful vs. stateless director:**
- **Stateless (recommended for v1):** Each Slack message triggers a fresh Claude invocation with context loaded from the repo + Slack thread history. This is simpler, avoids session timeout issues, and aligns with the existing chat pattern in the reference Slack implementation.
- **Stateful (future):** A persistent Claude session that stays alive across messages. Higher coherence but requires session management, reconnection logic, and cost management.

### 1.2 Worker Pool

Workers are ephemeral Claude Code sessions that execute specific tasks in isolated git worktrees.

**Responsibilities:**
- Execute a single task (implementation, analysis, experiment setup, etc.)
- Operate in an isolated git worktree — no interference with other workers or the director
- Commit work to their worktree branch
- Report completion/failure back to the director
- Self-terminate after task completion or timeout

**Implementation:** Each worker is a `spawnAgent()` call (from existing `agent.ts`) with its `cwd` set to an isolated git worktree directory. Workers use the Claude Agent SDK via the existing backend abstraction.

**Isolation model:** Git worktrees provide filesystem-level isolation. Each worker gets its own worktree branched from `main`. On completion, the worker's commits are merged/rebased back to `main` via the push queue.

### 1.3 Scheduler

The scheduler is the existing `infra/scheduler/` process, extended to support the new hierarchical model.

**Current role:** Cron-triggered autonomous sessions, fleet worker management, push queue coordination.

**New role in Open-Youji:** The scheduler becomes the runtime host for both the director and the worker pool. It manages:
- Director lifecycle (start, restart, health monitoring)
- Worker pool capacity (max concurrent workers, worktree allocation)
- Push queue for serialized git operations
- Control API (HTTP on port 8420)
- Health monitoring and Slack notifications

The scheduler does NOT make task selection decisions — that is the director's job. The scheduler is infrastructure; the director is intelligence.

### 1.4 Slack Bridge

The Slack bridge connects the director to Slack. It translates between Slack events and director actions.

**Responsibilities:**
- Maintains the Slack WebSocket connection (Socket Mode via `@slack/bolt`)
- Routes incoming messages to the director
- Posts director responses back to Slack threads
- Handles Slack-specific UX (reactions, thread management, living messages)
- Manages thread-to-conversation mapping

**Implementation:** The existing reference implementation at `infra/scheduler/reference-implementations/slack/` provides the foundation. The key difference from the current design: instead of routing messages to a lightweight chat agent, the bridge routes them to the director agent which can spawn workers.

## 2. Data Flow Between Components

```
Human (Slack)
    |
    | Slack Socket Mode (WebSocket)
    v
+-------------------+
| Slack Bridge      |  Translates Slack events <-> director invocations
+-------------------+
    |
    | In-process function calls
    v
+-------------------+
| Youji Director    |  Makes decisions, decomposes tasks, reports results
| (Claude session)  |
+-------------------+
    |
    | spawnAgent() calls via scheduler infrastructure
    v
+-------------------+
| Worker Pool       |  N concurrent workers, each in a git worktree
| [W1] [W2] [W3]   |
+-------------------+
    |
    | git commit (in worktree) + push queue
    v
+-------------------+
| Git Repository    |  Persistent memory, source of truth
| (main branch)     |
+-------------------+
    |
    | Scheduler reads repo state for /orient, status, etc.
    v
+-------------------+
| Scheduler         |  Infrastructure host, capacity management, cron jobs
| (port 8420 API)   |
+-------------------+
```

### 2.1 Message flow: Human -> Work gets done

1. Human sends a Slack message in a thread
2. Slack Bridge receives the event, fetches thread history for context
3. Bridge invokes the Director with the message + thread context + repo state
4. Director reads repo state (TASKS.md, project READMEs, recent logs) to orient
5. Director decides to spawn a worker for a specific task
6. Director calls a "spawn worker" tool/function, specifying: task description, project scope, worktree branch name
7. Scheduler allocates a worktree, spawns the worker agent
8. Worker executes the task, commits to its worktree branch
9. Worker completes; scheduler merges the branch back to main via push queue
10. Director is notified of completion, summarizes results to human in Slack

### 2.2 Message flow: Autonomous work (no human trigger)

1. Scheduler fires a cron job for the Director
2. Director runs `/orient` equivalent: reads TASKS.md, budget, recent logs
3. Director selects tasks and spawns workers
4. Workers execute, commit, push
5. Director posts a summary to Slack (proactive notification)

### 2.3 Data shared between components

| Data | Location | Written by | Read by |
|------|----------|------------|---------|
| Task lists | `projects/*/TASKS.md` | Director, Workers | Director |
| Project state | `projects/*/README.md` | Workers | Director |
| Decision records | `decisions/*.md` | Director, Workers | All |
| Experiment configs | `projects/*/experiments/` | Director, Workers | Workers |
| Budget/ledger | `projects/*/budget.yaml` | Workers, Scheduler | Director, Scheduler |
| Session logs | `.scheduler/logs/` | Scheduler | Director |
| Worker results | In-memory (scheduler) | Workers | Director |
| Slack thread state | Slack API + in-memory | Slack Bridge | Slack Bridge, Director |

## 3. Slack Thread <-> Session Mapping

### 3.1 Thread types

**Conversation threads (human-initiated):**
- Human starts a thread by messaging Youji
- Each thread maintains its own conversation context
- The director is invoked per-message with the full thread history
- Thread key: `${channelId}:${threadTs}` (same as existing reference implementation)

**Worker status threads (system-initiated):**
- When a worker is spawned, the director posts a status message in the relevant thread
- Worker progress can be streamed to this thread (living messages)
- On completion, the final result is posted

**Notification threads (system-initiated):**
- Proactive status updates (daily summaries, experiment completions, approval requests)
- Posted to the DM channel or a designated notification channel

### 3.2 Mapping implementation

```
Slack Thread (channelId:threadTs)
    |
    └── ConversationState (in-memory, from existing chat.ts pattern)
         ├── messages: ChatMessage[]          -- conversation history
         ├── activeWorkers: WorkerHandle[]    -- workers spawned from this thread
         ├── generation: number              -- stale-completion guard
         └── lastActivityMs: number          -- TTL for cleanup
```

The mapping is **stateless across restarts** — on restart, the director re-reads the Slack thread history via the API. In-memory state is a cache, not the source of truth. This follows the existing pattern in the reference `chat.ts`.

### 3.3 Thread context for the director

When the director is invoked for a thread message, it receives:
1. **Slack thread history** (fetched via `conversations.replies`)
2. **Repo state summary** (from `/orient`-like scan: active tasks, recent logs, budget)
3. **Active worker statuses** (from in-memory session registry)

This gives the director enough context to make decisions without maintaining persistent LLM state.

## 4. Worktree Lifecycle Management

### 4.1 Why worktrees

Git worktrees allow multiple working directories from a single repository. Each worktree has its own branch, index, and working tree, but shares the object store. This provides:
- **Filesystem isolation:** Workers cannot interfere with each other's file changes
- **Branch isolation:** Each worker commits to its own branch
- **Efficient storage:** Shared object store means minimal disk overhead
- **Native git merge:** Standard git merge/rebase to integrate work

### 4.2 Worktree lifecycle

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  ALLOCATE │ --> │  ACTIVE  │ --> │ COMPLETE │ --> │  CLEANUP │
└──────────┘     └──────────┘     └──────────┘     └──────────┘
```

**ALLOCATE:**
1. Create a branch from `main`: `git branch worker/<sessionId> main`
2. Create a worktree: `git worktree add <path> worker/<sessionId>`
3. Worktree path: `.worktrees/<sessionId>/` (under repo root, gitignored)

**ACTIVE:**
1. Worker agent runs with `cwd` set to the worktree path
2. Worker reads/writes files, runs commands, commits — all within the worktree
3. The CLAUDE.md and project files are visible (shared repo structure)
4. Worker commits to `worker/<sessionId>` branch

**COMPLETE:**
1. Worker session ends (success, timeout, or error)
2. Scheduler captures the worker's commits
3. Rebase the worker branch onto current `main`: `git rebase main worker/<sessionId>`
4. Fast-forward `main` to the rebased branch (or use push queue for serialization)
5. If rebase conflicts: park the branch, notify director for resolution

**CLEANUP:**
1. Remove the worktree: `git worktree remove <path>`
2. Delete the branch: `git branch -d worker/<sessionId>`
3. Run periodically (not just on completion — handle abandoned worktrees)

### 4.3 Worktree manager module

```typescript
interface WorktreeManager {
  /** Allocate a new worktree for a worker session. Returns the worktree path. */
  allocate(sessionId: string, baseBranch?: string): Promise<string>;

  /** Mark a worktree as complete and merge its branch back to main. */
  complete(sessionId: string): Promise<MergeResult>;

  /** Remove a worktree and its branch. */
  cleanup(sessionId: string): Promise<void>;

  /** List all active worktrees. */
  list(): Promise<WorktreeInfo[]>;

  /** Clean up abandoned worktrees (no active session, older than TTL). */
  gc(ttlMs: number): Promise<string[]>;
}

interface MergeResult {
  status: "merged" | "conflict" | "no-commits";
  branch: string;
  commitCount: number;
  conflictFiles?: string[];
}
```

### 4.4 Concurrency considerations

- **Max worktrees:** Limited by `maxConcurrentWorkers` in scheduler config. Recommended default: 4 (matches typical CPU core count for local execution).
- **Push serialization:** The existing push queue handles this. Each worktree's merge is enqueued as a push request.
- **Conflict resolution:** If two workers modify the same file, the second-to-merge will encounter a rebase conflict. Strategy: park the conflicting branch, notify the director, let a subsequent worker or the director resolve it.
- **Worktree cleanup on crash:** The `gc()` method runs periodically (e.g., every 30 minutes) to clean up worktrees whose sessions no longer exist.

## 5. Build Order

The components have clear dependencies. Build in this order:

### Phase 0: Foundation (no new features, just structure)

**0.1 — Project scaffolding**
- Set up the Open-Youji package structure
- Decide on module boundaries (single package vs. monorepo packages)
- Configure build tooling (TypeScript, vitest)
- Done when: `npm run build` and `npm test` pass with an empty test

**0.2 — Extract reusable scheduler primitives**
- Identify which modules from `infra/scheduler/` are needed
- Key modules to reuse: `agent.ts`, `backend.ts`, `sdk.ts`, `session.ts`, `push-queue.ts`, `api/server.ts`
- Either import directly or copy + adapt
- Done when: Can `spawnAgent()` from the new package

### Phase 1: Worktree Manager

**1.1 — Worktree lifecycle (allocate/cleanup)**
- Implement `WorktreeManager` with `allocate()`, `cleanup()`, `list()`, `gc()`
- Test with real git operations (create repo, create worktree, verify isolation)
- Done when: Can allocate a worktree, run `git commit` in it, and clean it up

**1.2 — Worktree merge-back**
- Implement `complete()` with rebase-onto-main logic
- Handle the conflict case (park branch, return conflict info)
- Integrate with existing push queue for serialization
- Done when: Two worktrees with non-conflicting changes both merge to main

### Phase 2: Worker Orchestration

**2.1 — Worker spawning from director context**
- Define the interface the director uses to spawn workers
- Implement worker lifecycle: spawn in worktree -> monitor -> collect result -> merge
- Done when: Can programmatically spawn a worker, have it edit a file, and see the change on main

**2.2 — Worker pool management**
- Concurrency limits, queue for pending work
- Session tracking (active workers, their status, their worktrees)
- Done when: Can run N workers concurrently with proper limits

### Phase 3: Slack Bridge

**3.1 — Slack connection and message routing**
- Adapt the reference Slack implementation for the new architecture
- Socket Mode connection, message receipt, thread context fetching
- Done when: Bot receives a Slack message and logs it

**3.2 — Director invocation from Slack**
- On message receipt, invoke Claude with thread context + repo state
- Post Claude's response back to the thread
- Done when: Can have a basic conversation with the bot in Slack

### Phase 4: Director Intelligence

**4.1 — Director as task orchestrator**
- Give the director the ability to spawn workers via a tool/function
- Director reads TASKS.md, decides what to work on, spawns workers
- Done when: Human says "work on X" in Slack, director spawns a worker that does it

**4.2 — Director status reporting**
- Director monitors worker progress, reports to Slack
- Living messages for in-progress work
- Completion summaries posted to thread
- Done when: Human can see worker progress in Slack in real time

**4.3 — Autonomous scheduling**
- Cron-triggered director sessions (like existing scheduler)
- Director picks tasks autonomously, spawns workers, reports results
- Done when: System does useful work without human prompting

### Phase 5: Production Hardening

**5.1 — Error handling and recovery**
- Worker crashes, timeout handling, orphaned worktree cleanup
- Director error handling (Slack reconnection, Claude API errors)
- Done when: System recovers gracefully from worker crashes

**5.2 — Observability**
- Session metrics (cost, duration, turns) via existing metrics module
- Control API endpoint for system status
- Done when: `/api/status` returns comprehensive system state

**5.3 — Budget and governance**
- Budget tracking per worker session
- Approval gates for resource-intensive operations
- Done when: Budget limits are enforced and visible in Slack

### Dependency graph

```
Phase 0 (scaffolding)
    |
    v
Phase 1 (worktree manager) ──────────────────┐
    |                                          |
    v                                          v
Phase 2 (worker orchestration)          Phase 3 (Slack bridge)
    |                                          |
    └──────────────┬───────────────────────────┘
                   |
                   v
            Phase 4 (director intelligence)
                   |
                   v
            Phase 5 (production hardening)
```

Phases 1 and 3 can proceed in parallel. Phase 2 depends on Phase 1. Phase 4 depends on both Phases 2 and 3. Phase 5 depends on Phase 4.

## 6. Key Architectural Decisions

### 6.1 Claude Agent SDK, not API

All agent sessions (director and workers) run via the Claude Agent SDK, which wraps the local Claude Code CLI. This means:
- No direct Anthropic API calls — the SDK handles model selection, tool use, and session management
- Workers get full Claude Code capabilities (file read/write, bash, git)
- The existing backend abstraction (Claude/Cursor/opencode) is reusable

### 6.2 Director as event-driven, not persistent session

The director is invoked per-event (Slack message, cron trigger, worker completion), not as a persistent LLM session. Rationale:
- Persistent sessions accumulate context and cost
- Event-driven aligns with the "repo is memory" philosophy
- Each invocation re-reads the repo for fresh state
- Thread history from Slack provides conversational continuity

### 6.3 Worktrees over branches-only

Using git worktrees (not just branches) because workers need filesystem isolation. A worker running `npm test` or `python script.py` needs its own working directory. Branches alone would require the scheduler to manage file checkouts, which is fragile and racy.

### 6.4 Reuse existing scheduler infrastructure

Rather than building from scratch, Open-Youji extends the existing scheduler with:
- Worktree management (new module)
- Director lifecycle management (new module)
- Worker pool coordination (extends existing session tracking)
- Slack bridge (adapts existing reference implementation)

The existing push queue, backend abstraction, session registry, and control API are reused as-is.
