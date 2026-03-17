# Stack Research: Open-Youji

Research date: 2026-03-17

## 1. Slack Bot Component

### Problem

The existing reference implementation (`infra/scheduler/reference-implementations/slack/`) uses `@slack/bolt` with Socket Mode and an in-memory `ConversationState` keyed by `channel:threadTs`. This works for stateless Q&A but does not support persistent director sessions where Youji maintains long-running context across Slack threads.

Key requirements:
- Thread-to-session mapping: same Slack thread = same agent session context
- Persistent sessions: Youji's director context survives process restarts
- Proactive messaging: Youji initiates conversations (status reports, blockers)
- Single mentor model: only one designated user interacts with Youji

### Recommendation

**Use `@slack/bolt` v4.x with Socket Mode (keep existing choice)**

Confidence: **HIGH** (95%)

Rationale:
- Socket Mode avoids needing a public HTTP endpoint — ideal for running on the mentor's macOS machine
- `@slack/bolt` is Slack's official framework, well-maintained, and already proven in the reference implementation
- The existing reference implementation (`slack.ts`, `living-message.ts`, `chat/`) provides 80% of the needed patterns

Specific version: `@slack/bolt@^4.1.0` (current latest stable, Socket Mode support mature)

**Thread-to-session mapping architecture:**

```
Slack Thread (channel:threadTs)  →  SessionContext (in-memory + SQLite)
                                      ├── conversationHistory: Message[]
                                      ├── activeAgentSessionId: string | null
                                      ├── directorState: DirectorContext
                                      └── lastActivityMs: number
```

Use the existing `better-sqlite3` (already a dependency) to persist session context:

```sql
CREATE TABLE director_sessions (
  thread_key TEXT PRIMARY KEY,        -- "channel:threadTs"
  conversation_json TEXT NOT NULL,    -- serialized conversation history
  director_state_json TEXT,           -- director-specific context (project status, pending decisions)
  active_agent_session TEXT,          -- Claude SDK session ID (for resume)
  created_at INTEGER NOT NULL,
  last_activity_at INTEGER NOT NULL
);
```

Confidence for SQLite persistence: **HIGH** (90%) — `better-sqlite3` is already in `package.json`, synchronous reads are fast, and the data volume is trivial (dozens of threads, not millions).

**Session resume via Claude SDK:**

The SDK's `resume` option (visible in `sdk.ts` line 19: `resume?: string`) allows resuming a session by ID. This is the mechanism for persistent director sessions:

1. User sends message in a Slack thread
2. Look up `director_sessions` by `channel:threadTs`
3. If an existing session exists and hasn't expired, call `query()` with `resume: sessionId`
4. If no session exists, create a new one

Confidence: **MEDIUM** (70%) — The `resume` option exists in the SDK interface but its behavior for long-lived sessions (hours/days between messages) needs validation. If resume fails on stale sessions, the fallback is to start a new session with conversation history injected into the prompt.

**Proactive messaging pattern:**

Use the existing `croner` cron library (already a dependency) to schedule periodic director wake-ups. The director wake-up flow:

1. Cron triggers every N minutes
2. Director agent runs with a "status check" prompt
3. Agent reads project files, TASKS.md, APPROVAL_QUEUE.md
4. If there's something to report, the agent's response is posted to the designated DM channel
5. If nothing noteworthy, the session ends silently

This mirrors the existing `executeJob()` pattern in `executor.ts` but posts results to Slack instead of just logging.

### What NOT to use

- **Slack Events API over HTTP**: Requires a public endpoint, TLS, and ngrok or similar — unnecessary complexity for a single-user macOS setup. Socket Mode is simpler.
- **@slack/web-api standalone**: Lower-level than Bolt; would require reimplementing message routing, middleware, and error handling.
- **Custom WebSocket to Slack**: Bolt's Socket Mode already handles reconnection, heartbeats, and acknowledgments.

---

## 2. Git Worktree Management for Parallel Workers

### Problem

Worker agents need isolated working directories to avoid merge conflicts. The existing system uses a single repository with a push queue (`push-queue.ts`) to serialize pushes. For true parallel execution, each worker needs its own worktree.

### Recommendation

**Use `git worktree` (built-in git feature) managed via Node.js `child_process`**

Confidence: **HIGH** (92%)

Git worktrees are the correct primitive — they share the same `.git` directory but provide separate working trees and branch checkouts. No third-party library is needed; the git CLI commands are straightforward.

**Worktree lifecycle:**

```
git worktree add /path/to/worktrees/worker-{sessionId} -b worker/{sessionId} main
# ... worker agent runs in that directory ...
git worktree remove /path/to/worktrees/worker-{sessionId}
```

**Directory layout:**

```
~/Youji/                           # main worktree (director + scheduler)
~/Youji/.worktrees/                # parent dir for worker worktrees
~/Youji/.worktrees/worker-abc123/  # worker session worktree
~/Youji/.worktrees/worker-def456/  # another worker session worktree
```

Use `.worktrees/` inside the repo root (gitignored). Alternative: use a temp directory outside the repo, but keeping it co-located simplifies cleanup and debugging.

**Implementation module: `worktree-manager.ts`**

```typescript
interface WorktreeHandle {
  path: string;          // absolute path to worktree
  branch: string;        // branch name (worker/{sessionId})
  sessionId: string;
  createdAt: number;
}

// Core operations:
async function createWorktree(repoDir: string, sessionId: string): Promise<WorktreeHandle>
async function removeWorktree(handle: WorktreeHandle): Promise<void>
async function listWorktrees(repoDir: string): Promise<WorktreeHandle[]>
async function cleanupStaleWorktrees(repoDir: string, maxAgeMs: number): Promise<number>
```

**Merge strategy:**

After a worker completes:
1. Worker commits to its branch (`worker/{sessionId}`)
2. Merge branch into `main` (or rebase if clean)
3. Push `main` to origin via the existing push queue
4. Remove the worktree and delete the branch

The existing `rebase-push.ts` and `push-queue.ts` can be reused for step 3.

Confidence for rebase-push reuse: **HIGH** (88%) — The push queue already handles serialized pushes with priority ordering (opus > fleet). Workers would use `priority: "fleet"`.

**Concurrency limits:**

- Max worktrees: configurable, default 3 (macOS machines have limited CPU/RAM)
- Each worktree consumes ~100MB disk (shared `.git`, but working tree files are copied)
- Monitor with `git worktree list --porcelain` for cleanup

**Edge cases to handle:**
- Stale worktrees from crashed sessions → periodic cleanup via `cleanupStaleWorktrees()`
- Branch conflicts when two workers modify the same file → the push queue's rebase logic handles this; if rebase fails, fall back to branch push (existing behavior)
- `.git/worktrees/` lock files → `git worktree remove --force` as last resort

### What NOT to use

- **Separate git clones**: Wastes disk space (full `.git` per clone), slower to create, and doesn't share reflog/objects.
- **`simple-git` npm package**: Adds a dependency for something achievable with 4-5 `child_process.execFile()` calls. The existing codebase already uses raw `execFile("git", ...)` throughout (`verify.ts`, `auto-commit.ts`, `rebase-push.ts`).
- **`isomorphic-git`**: Pure JS git implementation — slower, incomplete (no worktree support), and unnecessary when the system already depends on the git CLI.

---

## 3. Time-Based Resource Accounting

### Problem

The existing system tracks costs in USD (`costUsd` in `QueryResult`, `budget.yaml` with `consumed`/`limit` in dollars). Since Open-Youji uses Claude SDK (local CLI, no API billing), token costs are zero. The real constraint is wall-clock time — how long sessions run, how much compute the mentor's machine is spending.

### Recommendation

**Track wall-clock minutes as the primary resource unit, stored in the existing budget YAML format**

Confidence: **HIGH** (85%)

The existing `budget.yaml` schema and `budget-gate.ts` enforcement layer can be adapted with minimal changes:

```yaml
# projects/sample-project/budget.yaml
deadline: 2026-04-15
resources:
  - resource: compute-minutes
    consumed: 347
    limit: 2000
  - resource: sessions
    consumed: 42
    limit: 200
```

**What to track:**
1. **Session wall-clock time** (primary): `durationMs` from `AgentResult` — already tracked
2. **Session count** (secondary): `runCount` in `JobState` — already tracked
3. **Turn count** (diagnostic): `numTurns` — already tracked

**Implementation approach:**

The existing `ExecutionResult` already has `durationMs`. The accounting flow:

1. Session completes → `executor.ts` receives `ExecutionResult` with `durationMs`
2. Convert to minutes: `Math.ceil(durationMs / 60_000)`
3. Update `budget.yaml` for the relevant project: increment `consumed` for `compute-minutes`
4. `budget-gate.ts` checks budget before launching new sessions (already exists)

**No new library needed.** The existing YAML read/write in `notify.ts` (`readBudgetStatus()`) and the budget gate in `budget-gate.ts` already provide the enforcement mechanism. The only change is the resource unit (minutes instead of USD).

**Time tracking module additions:**

```typescript
// In executor.ts or a new time-accounting.ts
async function recordSessionTime(
  repoDir: string,
  project: string,
  durationMs: number,
): Promise<void> {
  const minutes = Math.ceil(durationMs / 60_000);
  // Read budget.yaml, increment compute-minutes consumed, write back
}
```

**Rate limiting (optional, for future):**

If the mentor wants to limit concurrent compute:
- Max total wall-clock minutes per day
- Max concurrent sessions (already exists: `maxConcurrentSessions` in `ServiceOptions`)
- Cool-down period between sessions

For time-series tracking (if needed for dashboards later), use the existing `better-sqlite3`:

```sql
CREATE TABLE session_time_log (
  session_id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  turns INTEGER,
  backend TEXT
);
```

Confidence for SQLite time log: **MEDIUM** (75%) — useful for analytics but not required for MVP. The budget YAML approach is sufficient for enforcement.

### What NOT to use

- **Prometheus/Grafana**: Overkill for a single-machine setup. The scheduler already has `metrics.ts` for in-process metrics.
- **Time-tracking SaaS (Toggl, Clockify)**: Unnecessary external dependency for machine-to-machine time tracking.
- **Token counting libraries (`tiktoken`, `@anthropic-ai/tokenizer`)**: Irrelevant — we're not counting tokens, we're counting wall-clock time.

---

## 4. Director-Worker Hierarchy with Claude Agent SDK

### Problem

The existing system treats all sessions as equal peers. The new architecture needs a hierarchy:
- **Director (Youji)**: long-running, Slack-facing, spawns and monitors workers
- **Workers**: short-lived, headless, execute single tasks in isolated worktrees

### Recommendation

**Use the SDK's Agent Teams feature for director-spawned workers**

Confidence: **MEDIUM-HIGH** (78%)

The codebase already has Agent Teams support (`team-session.ts`), and the SDK's `agents` option enables the supervisor (director) to spawn subagents via the `Task` tool. This is the most natural fit for the director-worker hierarchy.

**Architecture:**

```
┌─────────────────────────────────────────────┐
│  Scheduler (service.ts)                      │
│  - Cron triggers director wake-up            │
│  - Manages worktree lifecycle                │
│  - Enforces time budgets                     │
├─────────────────────────────────────────────┤
│  Director Agent (Youji)                      │
│  - Runs as persistent SDK session            │
│  - Profile: opus, maxTurns: 256              │
│  - Has Task tool for spawning workers        │
│  - Reports to mentor via Slack               │
├─────────────────────────────────────────────┤
│  Worker Agent A          Worker Agent B       │
│  - Spawned via Task tool  - Spawned via Task  │
│  - Runs in worktree A    - Runs in worktree B │
│  - Profile: sonnet/opus  - Profile: sonnet    │
│  - maxTurns: 64          - maxTurns: 64       │
│  - Headless (no Slack)   - Headless (no Slack)│
└─────────────────────────────────────────────┘
```

**Two implementation paths (choose based on SDK capabilities):**

**Path A: SDK Agent Teams (preferred)**

Use the existing `buildTeamSession()` from `team-session.ts` to define worker agents:

```typescript
const workerConfigs: SkillAgentConfig[] = [
  {
    name: "worker",
    description: "Executes a single task in an isolated git worktree. " +
      "Commits results to a worker branch. Headless — no Slack access.",
    prompt: buildWorkerPrompt(task), // task-specific prompt
    model: "sonnet",
    maxTurns: 64,
  },
];
```

The director spawns workers via the `Task` tool in its conversation:
```
Task: "worker" with description "Implement feature X in projects/foo"
```

Limitation: SDK subagents run in the same `cwd` as the parent. For worktree isolation, the director would need to set up the worktree first (via Bash tool) and then the worker operates within it.

Confidence: **MEDIUM** (70%) — Agent Teams work well for analyst+builder patterns (already proven in the codebase), but the worktree isolation requirement adds complexity. The subagent's `cwd` is inherited from the parent, so worktree switching must happen via Bash commands within the subagent, not at the SDK level.

**Path B: Scheduler-managed workers (fallback)**

If Agent Teams doesn't provide sufficient control over worker `cwd`, use the scheduler to spawn workers directly:

```typescript
// Director decides what tasks to assign (via Slack conversation)
// Scheduler spawns workers independently (not as SDK subagents)
const workerResult = await spawnAgent({
  profile: AGENT_PROFILES.fleetWorker,
  prompt: buildWorkerPrompt(task),
  cwd: worktreeHandle.path,  // isolated worktree
  sessionId: `worker-${task.id}`,
  backend: "claude",
});
```

This mirrors the existing fleet execution pattern (`fleet-executor.ts`) but:
- Workers run in worktrees instead of the main repo
- The director agent decides task assignment (not the scheduler's task scanner)
- Results are reported back to the director via the session registry

Confidence: **HIGH** (88%) — This is essentially the existing fleet pattern with worktree isolation. The `spawnAgent()` function already accepts `cwd` as a parameter.

**Recommended approach: Path B for MVP, migrate to Path A when SDK worktree support is validated.**

Path B is lower risk because:
1. `spawnAgent()` with custom `cwd` is battle-tested
2. Worktree lifecycle is managed by the scheduler (not the agent)
3. The director can monitor workers via the existing session registry (`session.ts`)
4. No dependency on SDK Agent Teams working correctly with different `cwd` per subagent

**Director agent profile:**

```typescript
const directorProfile: AgentProfile = {
  model: "opus",
  maxTurns: undefined,      // no turn limit — director runs until idle
  maxDurationMs: 3_600_000, // 1 hour max per wake-up
  label: "director",
};
```

**Director system prompt structure:**

The director needs a specialized system prompt that:
1. Defines its role (institute director, not a task executor)
2. Provides current system state (active sessions, project status, budgets)
3. Lists available actions (spawn worker, report to mentor, review approvals)
4. Establishes communication protocols (when to proactively message the mentor)

This is analogous to the existing `buildChatPrompt()` in `chat-prompt.ts` but with director-specific context.

**Worker result flow:**

```
Worker completes → AgentResult
  → Merge worker branch into main (worktree-manager)
  → Push via push queue (rebase-push.ts)
  → Update session metrics (metrics.ts)
  → Record time consumed (time-accounting)
  → Remove worktree (worktree-manager)
  → Notify director (session registry or Slack thread)
```

---

## Summary: Full Stack

| Component | Library/Tool | Version | Confidence |
|-----------|-------------|---------|------------|
| Slack bot framework | `@slack/bolt` | `^4.1.0` | HIGH (95%) |
| Slack connection mode | Socket Mode (built into Bolt) | -- | HIGH (95%) |
| Session persistence | `better-sqlite3` (existing dep) | `^12.6.2` | HIGH (90%) |
| Session resume | Claude SDK `resume` option | `^0.2.42` | MEDIUM (70%) |
| Cron scheduling | `croner` (existing dep) | `^9.0.0` | HIGH (95%) |
| Git worktree management | `git worktree` CLI via `child_process` | git 2.x | HIGH (92%) |
| Time-based budgets | Existing `budget.yaml` + `budget-gate.ts` | -- | HIGH (85%) |
| Time-series logging | `better-sqlite3` | `^12.6.2` | MEDIUM (75%) |
| Director-worker spawning | `spawnAgent()` with worktree `cwd` | -- | HIGH (88%) |
| Agent Teams (future) | `@anthropic-ai/claude-agent-sdk` agents | `^0.2.42` | MEDIUM (70%) |
| Push serialization | Existing `push-queue.ts` | -- | HIGH (88%) |
| Test framework | `vitest` (existing dep) | `^4.0.18` | HIGH (95%) |
| TypeScript | `typescript` (existing dep) | `^5.9.3` | HIGH (95%) |

### New dependencies needed: 1

Only `@slack/bolt@^4.1.0` needs to be added. Everything else is either already in `package.json` or uses built-in Node.js/git capabilities.

### Key architectural decisions still pending validation

1. **SDK `resume` for long-lived director sessions** — needs testing to confirm behavior when hours/days pass between messages. Fallback: inject conversation history into prompt.
2. **Agent Teams `cwd` isolation** — needs testing to confirm whether subagents can operate in different directories than the parent. Determines Path A vs Path B for worker spawning.
3. **Worktree branch merge strategy** — rebase vs merge commit. Recommendation: rebase (matches existing `rebase-push.ts` pattern), but may need merge commits if worker changes are large and rebase conflicts are frequent.
