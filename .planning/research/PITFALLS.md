# Pitfalls: Autonomous Agent Orchestration Systems

Research date: 2026-03-17

This document catalogs pitfalls for building Open-Youji, informed by:
- Youji's operational history (65+ ADRs, 1400+ fleet sessions, runbooks, postmortems)
- Claude Agent SDK documentation and known issues
- Community experience with git worktrees for parallel agents
- Slack bot persistence patterns

---

## 1. Git Worktree + Parallel Agents

### 1.1 Merge Conflicts at Scale

**The problem.** With N parallel agents committing to the same repo, git push
conflicts grow superlinearly. Youji observed 7% conflict rate at N=8 fleet
workers, rising to 36.3% during burst completion windows (ADR 0056). Backoff
jitter did not fix it -- the problem is architectural, not timing-related.

**Warning signs:**
- Increasing count of `session-*` fallback branches
- Burst completions (multiple agents finishing within seconds of each other)
- Agents editing shared files (README.md, TASKS.md, config files)

**Prevention strategy:**
- Serialize pushes through a push queue (ADR 0061). A single-threaded HTTP
  endpoint (`POST /api/push/enqueue`) eliminates conflicts architecturally.
  Youji's push queue reduced conflict rate to near-zero at any fleet size.
- Per-project concurrency limits (K=4 agents per project) to bound contention
  on project-scoped files.
- Rebase-before-push with exponential backoff + jitter as fallback.
- Session-branch fallback when all retries fail (no data loss, cleanup later).

**Phase:** Must be solved in Phase 2 (Worker Agents). Without push serialization,
parallel workers will generate hundreds of stale branches per day.

### 1.2 Branch Explosion from Fallback Branches

**The problem.** When push conflicts trigger session-branch fallback, stale
branches accumulate rapidly. Youji experienced 1,159 stale branches in ~5 days
of fleet operation (ADR 0055), requiring manual human intervention.

**Warning signs:**
- Remote branch count growing by 50+/day
- Branch names like `session-*` that no one is actively using
- GitHub API rate limits hit during branch operations

**Prevention strategy:**
- Automated branch cleanup on a schedule (every 6 hours).
- Universal branch pattern matching (not just one session type).
- Health watchdog alert when session branches exceed threshold (>50).
- Merge-back mechanism for branches containing unique, unmerged work.

**Phase:** Phase 2, alongside push queue implementation.

### 1.3 Stale Worktrees and Disk Space

**The problem.** Git worktrees left behind after interrupted sessions consume
disk space and can cause git operations to fail. Each worktree is a full
checkout of the repo.

**Warning signs:**
- Disk usage growing unexpectedly
- `git worktree list` showing entries with missing paths
- Git operations failing with "worktree already checked out" errors

**Prevention strategy:**
- Automatic worktree cleanup on session exit (finally block, not just
  success path). Claude Code v2.1.50+ has improved stale worktree cleanup.
- Periodic `git worktree prune` in a health check loop.
- Set a maximum worktree count equal to max concurrent workers + buffer.
- Use `/tmp` or a dedicated scratch directory, not the main repo tree.

**Phase:** Phase 2. Design worktree lifecycle before spawning workers.

### 1.4 Agents Blind to Each Other's Changes

**The problem.** Agents in separate worktrees cannot see what other agents are
working on. Two agents may independently refactor the same module, or make
contradictory changes to shared interfaces. The open-source tool "Clash" was
built specifically to detect this: it shows a conflict matrix for all worktree
pairs before agents write files.

**Warning signs:**
- Frequent semantic conflicts (not just textual -- code that doesn't work
  together even though git merges cleanly)
- Duplicate work across agents
- Integration failures after merging

**Prevention strategy:**
- Task-level isolation: assign tasks that touch disjoint file sets.
- File-level lock registry: director tracks which files each worker
  is modifying and prevents overlapping assignments.
- Consider adopting Clash (github.com/clash-sh/clash) for pre-write
  conflict detection.
- Limit concurrent agents per project (K=4 worked for Youji).

**Phase:** Phase 2-3. File-level tracking is Phase 3 polish; task isolation
is essential at Phase 2.

---

## 2. Claude Agent SDK Limitations

### 2.1 Context Window Exhaustion Mid-Task

**The problem.** Long-running agent sessions accumulate context from tool use.
A "lint, fix, test, fix" cycle can generate 8-12 API calls within 60 seconds,
each adding to context. When agents run out of context mid-implementation,
features are left half-done with no documentation of what was attempted.

**Warning signs:**
- Sessions ending abruptly without commits
- Compacted (summarized) context losing critical details
- Agents repeating work that a previous turn already completed

**Prevention strategy:**
- Scope tasks tightly: one task per session, clear "done when" condition.
  Youji's fleet workers receive a single task prompt -- no self-selection
  overhead (ADR 0042-v2).
- Delegate verbose operations to subagents: test output, log analysis,
  and documentation searches stay in the subagent's context.
- Set `maxTurns` to bound session length (Youji uses 64 turns for workers).
- Commit incrementally: after each logical unit of work, `git add && git commit`
  so that partial progress is preserved.

**Phase:** Phase 1 (Director) and Phase 2 (Workers). The task prompt template
must enforce tight scoping from day one.

### 2.2 Rate Limits with Concurrent Sessions

**The problem.** Each Claude Code session generates multiple API calls per
user-visible action. Running multiple concurrent sessions quickly hits
tokens-per-minute (TPM) and requests-per-minute (RPM) limits. The weekly
Opus limit is reachable by running multiple worktree sessions all week.

**Warning signs:**
- HTTP 429 responses from the API
- Sessions stalling for minutes between turns
- Cost spiking unexpectedly

**Prevention strategy:**
- Use the Claude Agent SDK (not raw API) which handles retries and backoff.
- Limit concurrent Opus/API sessions to 1 (Youji's "single Opus slot"
  constraint). All parallel workers use self-hosted models.
- Set `maxBudgetUsd` per session to cap runaway costs.
- For Open-Youji: if using Claude Code CLI (Max plan), you are subject to
  Max plan rate limits -- likely 1-3 concurrent sessions max. Design
  accordingly: director gets the Opus slot, workers use cheaper models
  or queue for the shared slot.

**Phase:** Phase 1. Rate limit strategy must be decided before any concurrent
execution.

### 2.3 Session State is Ephemeral

**The problem.** Every `query()` call without a `resume` parameter starts a
fresh session with zero memory. The SDK does support session resumption via
`session_id`, but this only works within the same process -- there is no
cross-process session persistence.

**Warning signs:**
- Agent repeating orientation steps in every session
- Lost context about what was attempted and why it failed
- "Groundhog Day" loops where sessions rediscover the same facts

**Prevention strategy:**
- The repo is the memory. Everything discovered must be committed to files
  before the session ends. Youji's "work cycle" convention: finding -> file,
  immediately (CLAUDE.md).
- Pre-built prompts with relevant context (project README excerpt, recent
  log entries, experiment context) eliminate the need for agents to self-orient.
- Session IDs can be captured and passed for `resume` within a single
  director session (e.g., follow-up questions).

**Phase:** Phase 1. The "repo as memory" pattern is foundational.

### 2.4 SDK Process Accumulation and Memory Leaks

**The problem.** Multiple Claude CLI processes accumulate over time. Each
process consumes 270-370MB RAM. Long sessions trigger memory leaks that have
required multiple dedicated fixes in Claude Code releases.

**Warning signs:**
- System RAM usage climbing steadily
- Individual Claude Code processes exceeding 500MB
- System becoming unresponsive or swapping to disk

**Prevention strategy:**
- Enforce session time limits (Youji uses 15 min for fleet workers).
- Kill processes explicitly after session completion -- do not rely on
  garbage collection.
- Monitor per-process memory and kill sessions exceeding a threshold.
- Apply Claude Code updates promptly (v2.1.50+ includes 6 memory fixes).

**Phase:** Phase 2. Must be addressed before running more than 2 concurrent
workers.

---

## 3. Slack Bot Persistence

### 3.1 WebSocket Disconnects Losing Conversation State

**The problem.** Socket Mode uses WebSocket connections that Slack periodically
recycles. The server backend recycles containers, leading to disconnects.
If conversation state is stored only in memory, it is lost on reconnect.

**Warning signs:**
- Bot going "offline" periodically in Slack
- Users reporting the bot "forgot" their conversation
- Reconnection logs showing frequent WebSocket closures

**Prevention strategy:**
- Store conversation state externally (database, file, or the git repo
  itself -- not in-memory).
- Maintain up to 10 WebSocket connections for redundancy (Slack's
  documented maximum).
- Use the `approximate_connection_time` field to proactively establish
  replacement connections before Slack recycles the current one.
- Implement reconnection with exponential backoff in the Bolt framework.

**Phase:** Phase 1. The director's Slack connection is the primary interface.

### 3.2 Thread Context Across Multiple Messages

**The problem.** Slack threads can span hours or days. The director agent
needs context from earlier messages to understand follow-up questions, but
each agent session starts fresh.

**Warning signs:**
- Director giving answers that ignore previous conversation
- Users needing to repeat context in every message
- Thread replies that contradict earlier statements

**Prevention strategy:**
- Store thread history in the repo (per-thread log files or a conversation
  database).
- On each message, load the thread's history from storage and include it
  in the agent prompt as context.
- Limit context window: include only the last N messages (e.g., 20) plus
  a summary of older messages.
- Use Slack's `conversations.replies` API to fetch thread history on demand.

**Phase:** Phase 1. Thread context is essential for the director's usability.

### 3.3 Concurrent Message Handling Races

**The problem.** If a user sends multiple messages while the bot is processing
the first, concurrent async operations on the same conversation cause race
conditions. Youji's ADR 0008 documents this exact bug: interleaved async
operations at `await` boundaries caused state corruption.

**Warning signs:**
- Bot responses appearing out of order
- State mutations from completed-but-stale agent sessions
- ACTION tags or internal markers leaking into user-visible messages

**Prevention strategy:**
- Per-conversation mutex (promise-based lock). Youji's `ConversationLock`
  prevents interleaved operations.
- Generation counter: monotonic integer incremented on each new agent spawn.
  Stale completions check generation and skip state mutation if outdated.
- Strip internal markers (action tags, tool output) from user-facing messages.
- Queue messages per conversation, process sequentially.

**Phase:** Phase 1. Must be designed into the Slack handler from the start.

---

## 4. Director-Worker Coordination

### 4.1 Zombie Workers (Processes That Never Complete)

**The problem.** Worker agents can hang indefinitely due to tool calls that
block, network issues, or model server failures. Youji experienced total
fleet failure when orphaned opencode processes held database locks, blocking
all new sessions (opencode-contention-runbook.md).

**Warning signs:**
- Sessions reaching maximum duration (timeout) with no output
- `numTurns: null` -- session hung before any LLM interaction
- Orphaned processes with PPID=1 (reparented to init after parent died)
- Increasing process count over time

**Prevention strategy:**
- Hard timeout per session (Youji: 15 min for workers, 60 min for director).
  Kill with SIGTERM, then SIGKILL after grace period.
- Orphan cleanup at scheduler startup: find processes matching the worker
  pattern with PPID=1 and kill them (Youji's `orphan-cleanup.ts`).
- Stall guard: detect when a shell tool call blocks for >2 minutes and
  trigger an alert or session termination (Youji's `stall-guard.ts`).
- Instance guard: PID lockfile to prevent multiple scheduler instances
  (Youji's `instance-guard.ts`).

**Phase:** Phase 2. Essential before any parallel execution.

### 4.2 Task Handoff Failures

**The problem.** The director assigns a task to a worker, but the worker
fails silently, misunderstands the task, or produces incorrect output.
Without verification, bad work propagates.

**Warning signs:**
- Workers completing tasks without meaningful commits
- Tasks marked complete but "done when" conditions not actually met
- Workers producing output that contradicts the task specification

**Prevention strategy:**
- Require commits as proof of work. Sessions that produce no commits are
  logged as failures (Youji tracks `fleet_success_rate`).
- Mechanically verifiable "done when" conditions: file exists, test passes,
  specific string in output. Avoid subjective completion criteria.
- Escalation mechanism: workers tag tasks `[escalate: <reason>]` when they
  encounter unexpected complexity.
- Director audits worker output periodically (Youji's Opus supervisor
  reviews fleet output during its `/compound` step).

**Phase:** Phase 2-3. Basic commit tracking in Phase 2, quality auditing in
Phase 3.

### 4.3 Task Double-Pickup

**The problem.** Two workers claim the same task simultaneously if there is
no atomic claiming mechanism. This wastes resources and may produce
conflicting implementations.

**Warning signs:**
- Two sessions working on the same task (visible in session logs)
- Duplicate commits addressing the same issue
- `[in-progress]` tags applied by multiple sessions

**Prevention strategy:**
- Server-side task claiming: the scheduler (not the worker) claims tasks
  atomically before spawning the worker. Workers never choose their own
  tasks (Youji's `task-claims.ts`).
- `[in-progress: YYYY-MM-DD]` tags in TASKS.md serve as secondary defense.
- Task failure counter: auto-skip tasks that have failed 3+ times across
  different workers.

**Phase:** Phase 2. Must be implemented in the scheduler before spawning
parallel workers.

### 4.4 Graceful Shutdown Without Losing Work

**The problem.** When the scheduler restarts (upgrade, crash, signal), all
child agent sessions are killed. In-progress work is lost. Youji's ADR 0018
documents this: deep work sessions lose progress on forced restart.

**Warning signs:**
- Sessions ending mid-task after scheduler restart
- Uncommitted work lost (visible only in process memory, never committed)
- pm2/systemd killing processes before they finish

**Prevention strategy:**
- Drain mode: on SIGTERM, stop accepting new sessions but wait for active
  ones to complete (Youji: 5-minute drain timeout).
- Set process manager kill timeout higher than drain timeout (Youji: pm2
  `kill_timeout: 330000` = 5.5 min).
- Incremental commits: agents commit after each logical unit of work,
  not just at the end. This limits the blast radius of forced kills.
- Worktree isolation helps here: even if the process is killed, the
  worktree contains the uncommitted changes which can be recovered.

**Phase:** Phase 2. Design shutdown sequence before deploying workers.

---

## 5. Time-Based Resource Accounting

### 5.1 Wall-Clock Time vs. Actual Compute

**The problem.** Measuring agent cost by wall-clock time is inaccurate.
An agent may spend 10 minutes sleeping/polling and 30 seconds on actual
LLM calls. Conversely, an agent may make expensive API calls that complete
in seconds but cost dollars.

**Warning signs:**
- Budget exhaustion with little productive output
- Sessions that run full duration but produce minimal work
- Cost tracking that does not correlate with value produced

**Prevention strategy:**
- Track multiple dimensions: wall-clock time, API cost (USD), turn count,
  and token count. Youji's `SessionMetrics` captures all four.
- Primary metric: cost in USD (from API response headers), not time.
- Secondary metric: "findings per dollar" -- knowledge output divided by
  cost (Youji's fundamental efficiency metric).
- Budget gates that check resource consumption before each session, not
  just wall-clock time (Youji's `budget-gate.ts`).

**Phase:** Phase 1-2. Cost tracking design in Phase 1, budget gates in Phase 2.

### 5.2 Sleep-Polling Loops Waste Budget

**The problem.** Agents waiting for long-running processes (training, rendering,
batch jobs) enter sleep-poll loops that consume session time without producing
value. Youji had a session spend 50 minutes polling for experiments that would
take 1-2 hours (ADR 0017).

**Warning signs:**
- `sleep` commands >30 seconds in agent tool calls
- Sessions timing out with no commits
- Agent output showing repeated "checking if done yet" patterns

**Prevention strategy:**
- Hard rule: never sleep >30 seconds in a session (L0 enforcement via
  `sleep-guard.ts` which detects and blocks sleep commands).
- Stall guard: detect tool calls that block >2 minutes (`stall-guard.ts`).
- Fire-and-forget pattern: launch long processes via a detached runner,
  register for completion notification, commit setup, and end session.
- Analysis happens in future sessions triggered by completion callbacks.

**Phase:** Phase 2. Sleep guard is essential before autonomous execution.

### 5.3 Budget Race Conditions with Parallel Workers

**The problem.** Multiple workers checking budget simultaneously may all
pass the gate before any of them records consumption, causing overspend.

**Warning signs:**
- Budget consumed significantly beyond allocated limits
- Multiple sessions starting simultaneously for the same project
- Budget check passing but post-session total exceeding limit

**Prevention strategy:**
- Pre-session budget reservation: deduct estimated cost before starting,
  refund unused portion after completion.
- Per-project concurrency limits reduce the race window.
- Fail-open budget checks (Youji: if budget read fails, allow the session)
  but with post-hoc reconciliation.
- Accept ~10-20% overshoot as tolerable; make budget limits conservative.

**Phase:** Phase 3. Not critical until running many concurrent workers
against a tight budget.

---

## 6. Single-Machine Resource Contention

### 6.1 CPU/Memory Exhaustion from Concurrent Processes

**The problem.** Each Claude Code process uses 270-370MB RAM and non-trivial
CPU. At N=8 workers + 1 director + git operations + Slack bot, a single
machine can run out of resources. Claude Code has known issues with 100% CPU
usage and process accumulation (GitHub issues #5771, #11122).

**Warning signs:**
- System load average exceeding CPU count
- Memory usage >80% with swap activity
- OOM killer terminating processes
- Increasing response latency across all sessions

**Prevention strategy:**
- Set conservative concurrent worker limits. Youji found N<=4 was safe
  for opencode workers; N>=9 caused >45% failure rate.
- Monitor per-process resource usage and enforce limits (cgroups, ulimits).
- Ensure kill-after-timeout is enforced (SIGTERM then SIGKILL) so stuck
  processes release resources.
- Reserve headroom: do not use 100% of available RAM for workers. Leave
  30-40% for OS, git operations, and the scheduler itself.

**Phase:** Phase 2. Determine safe N experimentally before scaling.

### 6.2 Disk I/O Contention from Concurrent Git Operations

**The problem.** Multiple agents performing git operations (clone, fetch,
rebase, push, gc) simultaneously create I/O contention. Git's garbage
collection (`git gc`) is especially problematic -- it creates temporary pack
files that can conflict with concurrent operations. Youji found that `git gc`
during opencode sessions caused hangs and had to disable it entirely
(`gc.auto=0` in environment).

**Warning signs:**
- `tmp_pack_*` files accumulating in `.git/objects/pack/`
- Git operations taking 10x normal duration
- Sessions hanging during git fetch/push operations
- SQLite database locks (for tools that use SQLite, like opencode)

**Prevention strategy:**
- Disable automatic git gc for worker sessions: set `GIT_CONFIG_COUNT=1`,
  `GIT_CONFIG_KEY_0=gc.auto`, `GIT_CONFIG_VALUE_0=0` in process environment.
- Run git gc manually during maintenance windows (low-concurrency periods).
- Serialize git push operations through a push queue.
- Use worktrees on SSD storage; avoid network-mounted filesystems.
- Periodic cleanup of stale git temp files.

**Phase:** Phase 2. Set gc.auto=0 from day one for worker processes.

### 6.3 Database Lock Contention

**The problem.** If worker agents share a database (SQLite, etc.), concurrent
writes cause lock contention that escalates to total failure. Youji's opencode
backend uses a shared SQLite database; at N>4 concurrent workers, database
contention caused cascading failures with 100% session failure rate
(opencode-contention-runbook.md).

**Warning signs:**
- Sessions hanging with no model interaction (`numTurns: null`)
- `lsof` showing >8 processes holding database files open
- Database file growing beyond expected size (fragmentation)
- Exit code null (process killed by timeout, never completed)

**Prevention strategy:**
- Avoid shared mutable state between workers. Each worktree should be
  self-contained.
- If a shared database is unavoidable, use WAL mode for SQLite and
  limit concurrent writers.
- Periodic VACUUM to defragment the database.
- Monitor database lock wait times as a health metric.
- Design the architecture so workers communicate only through git, not
  through shared local state.

**Phase:** Phase 2. Architecture must ensure worker isolation.

---

## Summary: Pitfall Priority by Phase

### Phase 1 (Director Agent)
| Pitfall | Severity | Mitigation |
|---------|----------|------------|
| 3.1 WebSocket disconnects | High | External state storage, multi-connection |
| 3.2 Thread context | High | Thread history in repo, context loading |
| 3.3 Concurrent message races | High | Per-conversation mutex, generation counter |
| 2.1 Context exhaustion | Medium | Tight task scoping, incremental commits |
| 2.2 Rate limits | Medium | Single Opus slot, budget caps |
| 2.3 Session ephemerality | High | Repo-as-memory pattern |
| 5.1 Resource accounting | Medium | Multi-dimensional cost tracking |

### Phase 2 (Worker Agents)
| Pitfall | Severity | Mitigation |
|---------|----------|------------|
| 1.1 Merge conflicts | Critical | Push queue, per-project limits |
| 1.2 Branch explosion | High | Automated cleanup, health alerts |
| 1.3 Stale worktrees | Medium | Automatic cleanup, prune on exit |
| 4.1 Zombie workers | Critical | Hard timeout, orphan cleanup, stall guard |
| 4.2 Task handoff failures | High | Commit-as-proof, escalation mechanism |
| 4.3 Double-pickup | High | Server-side atomic claiming |
| 4.4 Graceful shutdown | High | Drain mode, incremental commits |
| 5.2 Sleep-polling waste | High | Sleep guard, fire-and-forget |
| 6.1 CPU/Memory exhaustion | Critical | Conservative N, per-process limits |
| 6.2 Git I/O contention | High | Disable gc.auto, push queue, SSD |
| 6.3 Database contention | High | Worker isolation, no shared mutable state |
| 2.4 Process memory leaks | Medium | Session time limits, explicit kills |

### Phase 3 (Scaling & Polish)
| Pitfall | Severity | Mitigation |
|---------|----------|------------|
| 1.4 Blind-to-each-other | Medium | File-level lock registry, Clash tool |
| 5.3 Budget race conditions | Medium | Pre-session reservation, conservative limits |

---

## Key Lessons from Youji's Operational History

1. **Push serialization is the only reliable solution for concurrent git push.**
   Retry with backoff does not work at scale. Youji tried exponential backoff
   + jitter (ADR 0056) and conflict rate rose from 7% to 36.3%. The push queue
   (ADR 0061) solved it architecturally.

2. **Worker concurrency limits are lower than expected.** Youji's theoretical
   target was N=32 workers but operational reality showed N<=4 was the safe
   threshold due to database contention and resource limits. Start with N=2
   and increase based on measured stability.

3. **Agents must commit incrementally, not at session end.** Sessions that
   defer all commits to the end lose everything on timeout or crash. Youji
   enforces this as a convention but has no L0 enforcement.

4. **Orphan processes are a first-class failure mode.** When the scheduler
   restarts, child process handles are lost. Orphaned processes continue
   running, holding locks and consuming resources. Startup cleanup is mandatory.

5. **Disable git gc for worker sessions.** `git gc` creates temp files that
   conflict with concurrent operations and cause hangs. Set `gc.auto=0` in
   the process environment for all worker sessions.

6. **The "repo as memory" pattern works but requires discipline.** Every fact
   discovered must be committed in the same turn. Sessions that defer recording
   to "later" lose knowledge when they time out.
