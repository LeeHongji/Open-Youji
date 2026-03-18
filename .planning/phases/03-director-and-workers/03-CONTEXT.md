# Phase 3: Director and Workers - Context

**Gathered:** 2026-03-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Youji responds conversationally in Slack threads, decomposes mentor goals into tasks, spawns persistent worker agents per project, monitors their progress, and reports results. Workers run continuously in worktrees — one worker per project, executing tasks from TASKS.md in a loop (task → commit → restart). Director intelligence and worker spawning are the core deliverables.

</domain>

<decisions>
## Implementation Decisions

### Task decomposition
- Youji writes decomposed tasks to project `TASKS.md` files — reuses existing task system
- Youji proactively decomposes goals without waiting for confirmation. If uncertain, she asks.
- Task granularity: Claude's discretion — adjust based on task complexity
- Full existing tag system reused: `[in-progress]`, `[blocked-by]`, `[skill: execute]`, etc.

### Worker dispatch model
- **One persistent worker per project** — each active project gets one dedicated worker
- Worker runs in a continuous loop: pick task from TASKS.md → execute in worktree → commit → restart as fresh session (prevents context bloat)
- When TASKS.md is empty, worker stops. Scheduler periodically checks for new tasks and respawns worker when tasks appear.
- Youji decides worker model (Opus vs Sonnet) per task based on complexity
- **V1 is 1 worker per project.** Future improvement: multiple workers per project for parallelism (noted as deferred)
- Workers use existing worktree isolation (Phase 1): `.worktrees/`, `worker/{taskId}` branches, push queue

### Result reporting
- **Proactive push**: Youji sends a Slack DM summary when a worker completes a task
- Summary format: one-line result + diff reference. E.g., "✅ FOUND-01 完成: 创建了 worktree.ts (3 commits, 22 tests)"
- Detailed reports only when mentor asks
- **Failure handling**: Worker failure → Youji immediately notifies mentor in Slack + auto-retries once. If retry also fails → mark task `[blocked-by: execution failure]`
- Living messages used for long-running tasks (Phase 2 infra ready)

### Claude's Discretion
- Director system prompt content and persona details
- Exact worker restart mechanism (spawn new process vs scheduler re-trigger)
- How to detect "task complete" vs "task needs more work"
- Worker timeout duration (recommended 15 min based on research)
- How to summarize worker output for the mentor

</decisions>

<specifics>
## Specific Ideas

- The mentor described the architecture as: "Youji 是所有 agent 的 mentor" — she manages workers the way a PI manages grad students. She gives them tasks, checks their work, and only escalates to the human mentor when needed.
- Worker loop should feel autonomous: once tasks exist, workers just run. No human intervention needed between task creation and completion.
- The "one worker per project" model keeps things simple and avoids the coordination complexity of multi-worker parallelism (which is explicitly deferred).

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `slack-bridge.ts`: Message pipeline with hook point for director — currently returns stub response, Phase 3 replaces with Claude SDK call
- `thread-store.ts`: Thread persistence — stores conversation context for director session reconstruction
- `worktree.ts`: WorktreeManager — allocate/release worktrees for workers
- `sdk.ts`: `runQuerySupervised()` — spawn Claude sessions with streaming and supervision
- `agent.ts`: Agent profiles (workSession, fleetWorker, etc.) — add `directorSession` and `projectWorker` profiles
- `task-parser.ts`: TASKS.md parsing — workers use this to find their next task
- `push-queue.ts`: Serialized push for worker commits
- `executor.ts`: Session lifecycle — pre/post processing patterns for worker sessions

### Established Patterns
- Event-driven director: fresh Claude session per Slack message, context from thread history + repo state
- Worker session: `spawnAgent()` with `cwd` set to worktree path, `bypassPermissions` for unattended execution
- Task claiming: `POST /api/tasks/claim` prevents double-pickup

### Integration Points
- `slack-bridge.ts`: Replace stub response handler with director Claude session
- `service.ts`: Add worker lifecycle management (spawn, monitor, restart)
- `api/server.ts`: Add worker status endpoints
- `cli.ts`: Add worker management commands (start/stop/status)

</code_context>

<deferred>
## Deferred Ideas

- Multiple workers per project for parallelism — future improvement, requires more sophisticated task coordination and conflict avoidance
- Living message infrastructure — hooks ready from Phase 2, wire triggers in Phase 3 or defer to Phase 4

</deferred>

---

*Phase: 03-director-and-workers*
*Context gathered: 2026-03-18*
