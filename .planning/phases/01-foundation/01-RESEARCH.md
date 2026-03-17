# Phase 1: Foundation - Research

**Researched:** 2026-03-17
**Domain:** Git worktree lifecycle management + structured session logging
**Confidence:** HIGH

## Summary

Phase 1 builds the worktree lifecycle manager (`worktree.ts`) that allocates isolated git worktrees for worker agents, enforces a concurrency limit, and cleans up after sessions complete. It also extends the existing JSONL metrics system to capture worktree-specific data and configures the remote repo.

The existing scheduler codebase provides substantial reusable infrastructure: `rebase-push.ts` for merge-back, `push-queue.ts` for serialized pushes, `auto-commit.ts` for crash recovery, and `agent.ts` for spawning agents with `cwd`. The worktree manager is a new module that orchestrates git worktree commands and tracks allocation state in-memory with filesystem validation.

**Primary recommendation:** Build `worktree.ts` as a stateful singleton class (`WorktreeManager`) that wraps `git worktree add/remove/list` commands, tracks allocations in a `Map<taskId, WorktreeInfo>`, and validates against filesystem state on startup (stale worktree recovery). Integrate with `executor.ts` for lifecycle hooks and `metrics.ts` for extended session metrics.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Branches named `worker/{taskId}` (e.g., `worker/FOUND-01-setup`) -- descriptive, task-traceable
- Worktrees created under `.worktrees/` in repo root (gitignored)
- Cleanup happens immediately after successful merge -- no delay
- On crash/timeout: auto-commit any changes (like existing `auto-commit.ts`), then cleanup. Work is preserved, not discarded.
- Maximum concurrent worktrees: configurable, default N=4 (start with N=2 for initial testing)
- Rebase onto main (reuses existing `rebase-push.ts` pattern) -- clean linear history
- On rebase conflict: push to `session-{id}` fallback branch, notify director. Director resolves in next session.
- Pushes go through existing serialized push queue (`push-queue.ts`)
- New code lives in `infra/scheduler/src/` -- extends existing scheduler package
- New files: `worktree.ts` (manager), `worktree.test.ts` (tests)
- Reuses existing build system, types, test infra
- Remote repo configured to `https://github.com/LeeHongji/Open-Youji` during this phase, with push access verified

### Claude's Discretion
- Exact WorktreeManager API design (allocate, cleanup, list, etc.)
- Logging metrics format extensions (existing JSONL pattern is fine to extend)
- Internal implementation of stale worktree detection
- `.worktrees/` gitignore entry placement

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| FOUND-01 | Worktree manager can allocate an isolated git worktree for a worker session | `git worktree add -b worker/{taskId} .worktrees/{taskId} main` -- creates branch + worktree atomically. WorktreeManager.allocate() wraps this. |
| FOUND-02 | Worktree manager cleans up completed worktrees and merges branches back to main | Merge-back via existing `rebaseAndPush()` from `rebase-push.ts`, then `git worktree remove` + `git branch -d`. WorktreeManager.release() orchestrates this. |
| FOUND-03 | Worktree manager enforces a maximum concurrent worktree limit (configurable, default N=4) | In-memory `Map<taskId, WorktreeInfo>` tracks allocations. `allocate()` checks `map.size < maxWorktrees` before creating. Validated against `git worktree list --porcelain` on startup. |
| FOUND-04 | Remote repo configured as `https://github.com/LeeHongji/Open-Youji` | `git remote set-url origin https://github.com/LeeHongji/Open-Youji` + verification push. Can be a one-time setup step or ensured at WorktreeManager init. |
| OBS-01 | Every session produces structured metrics (JSONL) | Extend existing `SessionMetrics` in `metrics.ts` with optional `worktreeId`, `worktreeBranch`, `worktreeAllocMs`, `worktreeCleanupMs` fields. |
| OBS-02 | Session logs are stored for debugging | Already implemented in `executor.ts` -- writes log files to `.scheduler/logs/`. Worktree sessions inherit this via the same `executeJob()` path. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| git (CLI) | 2.39+ | Worktree management | `git worktree add/remove/list` are the only API for worktrees. No Node.js library wraps these well -- exec is the standard approach (same pattern as existing `rebase-push.ts`, `auto-commit.ts`, `branch-cleanup.ts`). |
| node:child_process | built-in | Git command execution | `execFile` with `promisify` -- established pattern throughout the scheduler codebase. |
| node:fs/promises | built-in | Filesystem operations | Directory existence checks, cleanup verification. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | ^4.0.18 | Testing | Already configured. Co-located test file `worktree.test.ts`. Globals enabled. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Raw git CLI via execFile | simple-git (npm) | simple-git adds 200KB+ dependency for commands that are 1-line exec calls. The entire scheduler uses raw git CLI. Not worth the inconsistency. |
| In-memory Map for state | SQLite/file-based state | Overkill for tracking 2-4 concurrent worktrees. In-memory with filesystem validation on startup is simpler and matches the scheduler's existing patterns (e.g., `session.ts` uses in-memory Maps). |

**Installation:**
No new packages needed. All dependencies are already in the scheduler.

## Architecture Patterns

### Recommended Project Structure
```
infra/scheduler/src/
├── worktree.ts           # WorktreeManager class + types
├── worktree.test.ts      # Co-located tests
├── types.ts              # Add WorktreeState, WorktreeConfig types
├── executor.ts           # Modified: worktree lifecycle hooks
├── metrics.ts            # Modified: add worktree fields to SessionMetrics
└── (existing files unchanged)
```

### Pattern 1: WorktreeManager as Singleton Class
**What:** A class that manages the full worktree lifecycle: allocate, release, list, recover stale.
**When to use:** Called by `executor.ts` before/after agent sessions.
**API Design (Claude's Discretion area):**

```typescript
export interface WorktreeConfig {
  repoDir: string;         // Repo root (where .worktrees/ lives)
  maxWorktrees: number;     // Concurrency limit (default: 4)
  worktreeDir?: string;     // Override .worktrees/ location
  remoteUrl?: string;       // Expected remote URL
}

export interface WorktreeInfo {
  taskId: string;
  branch: string;           // worker/{taskId}
  path: string;             // .worktrees/{taskId}
  allocatedAt: number;       // timestamp ms
  sessionId?: string;
}

export type WorktreeAllocResult =
  | { ok: true; info: WorktreeInfo }
  | { ok: false; reason: "at-capacity" | "already-exists" | "git-error"; error?: string };

export type WorktreeReleaseResult =
  | { ok: true; merged: boolean; fallbackBranch?: string }
  | { ok: false; reason: "not-found" | "cleanup-error"; error?: string };

export class WorktreeManager {
  constructor(config: WorktreeConfig);
  allocate(taskId: string, sessionId?: string): Promise<WorktreeAllocResult>;
  release(taskId: string): Promise<WorktreeReleaseResult>;
  list(): WorktreeInfo[];
  recover(): Promise<number>;     // Startup: detect stale worktrees
  getCapacity(): { current: number; max: number };
}
```

### Pattern 2: Result Types Over Exceptions
**What:** Return `{ ok: true, ... } | { ok: false, reason, error }` instead of throwing.
**When to use:** All WorktreeManager methods. Matches established codebase pattern (e.g., `RebasePushResult` uses status enum, `autoCommitOrphanedFiles` returns null on error).
**Why:** Callers can handle failure cases without try-catch. Error reasons are typed and inspectable.

### Pattern 3: Filesystem Validation on Startup
**What:** On `WorktreeManager` construction or explicit `recover()`, run `git worktree list --porcelain` and reconcile with the in-memory Map. Clean up orphaned worktrees from crashed sessions.
**When to use:** Scheduler startup, or periodically during operation.
**Example:**
```typescript
// git worktree list --porcelain output:
// worktree /abs/path/.worktrees/task-123
// HEAD abc123
// branch refs/heads/worker/task-123
//
// Parse this to discover existing worktrees and reconcile with in-memory state
```

### Pattern 4: Lifecycle Integration with executor.ts
**What:** Worktree allocation happens before `spawnAgent()`, cleanup after result. The worktree path is passed as `cwd` to `spawnAgent()`.
**When to use:** Worker sessions only (not director/chat sessions).
**Flow:**
```
1. executor: worktreeManager.allocate(taskId)
2. executor: spawnAgent({ cwd: worktreeInfo.path, ... })
3. (agent runs in isolated worktree)
4. executor: autoCommitOrphanedFiles(worktreeInfo.path)  // crash safety
5. executor: rebaseAndPush from worktree branch to main
6. executor: worktreeManager.release(taskId)
```

### Anti-Patterns to Avoid
- **Modifying main worktree from workers:** Workers MUST operate in their allocated worktree. Never share the main worktree between concurrent sessions.
- **Leaving orphaned worktrees:** Every `allocate()` MUST have a corresponding `release()`, even on crash. The `recover()` method is the safety net.
- **Blocking on git operations:** Use `execFile` (not `exec` shell), avoid long-running git operations. Git worktree add/remove are fast (<1s).
- **State only in memory:** The in-memory Map MUST be reconcilable from filesystem state (`git worktree list`). A restart should recover correct state.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Merge-back to main | Custom merge logic | `rebaseAndPush()` from `rebase-push.ts` | Already handles retry, conflict detection, fallback branch. Battle-tested across hundreds of sessions. |
| Serialized pushes | Custom push lock | `enqueuePushAndWait()` from `rebase-push.ts` + `PushQueue` from `push-queue.ts` | Priority queue with opus/fleet ordering. HTTP API for cross-process coordination. |
| Crash recovery commit | Custom pre-cleanup commit | `autoCommitOrphanedFiles()` from `auto-commit.ts` | Handles cooldown, provenance, experiment exclusion. Pass worktree path as `cwd`. |
| Branch cleanup | Custom branch deletion | Extend `branch-cleanup.ts` pattern | Already handles merged/old-unmerged classification, dry-run mode, local+remote cleanup. Add `worker/*` branch pattern. |
| Session metrics | Custom logging | `recordMetrics()` from `metrics.ts` | JSONL append, directory creation, tail-read optimization. Just add fields. |

**Key insight:** The existing scheduler has already solved the hard concurrency problems (serialized push, conflict fallback, auto-commit). The worktree manager is primarily an orchestration layer that calls these existing tools with the worktree path as `cwd`.

## Common Pitfalls

### Pitfall 1: Git Worktree Branch Conflicts
**What goes wrong:** `git worktree add -b worker/task-123` fails if `worker/task-123` branch already exists (from a previous crashed session that didn't clean up).
**Why it happens:** The branch persists even if the worktree directory was manually deleted or the process crashed between allocation and cleanup.
**How to avoid:** In `allocate()`, check if the branch already exists (`git branch --list worker/{taskId}`). If it does and no worktree uses it, delete the branch first (`git branch -D worker/{taskId}`). If a worktree DOES use it, return `already-exists` error.
**Warning signs:** `git worktree add` returns "fatal: a branch named 'worker/...' already exists".

### Pitfall 2: Worktree Remove Requires Clean State
**What goes wrong:** `git worktree remove` fails if the worktree has uncommitted changes.
**Why it happens:** Agent crashed or timed out without committing.
**How to avoid:** Always run `autoCommitOrphanedFiles(worktreePath)` before `git worktree remove`. If that fails, use `git worktree remove --force`.
**Warning signs:** `git worktree remove` returns "fatal: ... contains modified or untracked files, use --force to delete it".

### Pitfall 3: Main Worktree Cannot Checkout Worker Branch
**What goes wrong:** Git refuses `git worktree add` because the main worktree is already on the same branch reference.
**Why it happens:** This shouldn't happen with the `worker/{taskId}` naming (new branches), but could if trying to reuse a branch.
**How to avoid:** Always create fresh branches with `-b`. Never reuse branch names across worktree sessions.
**Warning signs:** "fatal: 'worker/...' is already checked out at '...'".

### Pitfall 4: Concurrent allocate() Race Condition
**What goes wrong:** Two concurrent calls to `allocate()` both check capacity (3/4), both proceed, ending up with 5 worktrees.
**Why it happens:** JavaScript is single-threaded but async operations create interleaving.
**How to avoid:** Use a simple async mutex/queue for `allocate()`. The simplest approach: a `Promise` chain where each allocate waits for the previous one.
**Warning signs:** `list().length > maxWorktrees`.

### Pitfall 5: Rebase From Worktree vs Main
**What goes wrong:** Running `rebaseAndPush()` from the worktree directory targets the worktree's branch, not main. The existing function assumes it's operating on `main`.
**Why it happens:** `rebaseAndPush()` reads the current branch via `git rev-parse --abbrev-ref HEAD` and rebases onto `origin/{currentBranch}`.
**How to avoid:** The merge-back flow should: (1) from the main worktree, merge the worker branch commits into main, then (2) push main via the push queue. Alternatively, adapt `rebaseAndPush()` to accept a target branch parameter. The cleanest approach: checkout main in the main worktree, `git merge --ff-only worker/{taskId}` (after rebase), then push.
**Warning signs:** Push creates remote `worker/` branches instead of updating `main`.

### Pitfall 6: `.worktrees/` Path Resolution
**What goes wrong:** Relative paths break when the scheduler's working directory differs from the repo root.
**Why it happens:** The scheduler might be started from a subdirectory or different location.
**How to avoid:** Always resolve `.worktrees/` as an absolute path relative to the repo root. Use `git rev-parse --show-toplevel` to find the repo root, then join with `.worktrees/`.
**Warning signs:** Worktrees created in unexpected locations.

## Code Examples

### Allocating a Worktree
```typescript
// Core allocation logic
async function gitWorktreeAdd(repoDir: string, taskId: string): Promise<WorktreeInfo> {
  const branch = `worker/${taskId}`;
  const worktreePath = join(repoDir, ".worktrees", taskId);

  // Clean up stale branch if it exists without a worktree
  try {
    await exec("git", ["branch", "--list", branch], { cwd: repoDir });
    // If branch exists, try deleting it (it's stale)
    await exec("git", ["branch", "-D", branch], { cwd: repoDir });
  } catch { /* branch doesn't exist, which is fine */ }

  // Create worktree with new branch based on main
  await exec("git", ["worktree", "add", "-b", branch, worktreePath, "main"], { cwd: repoDir });

  return {
    taskId,
    branch,
    path: worktreePath,
    allocatedAt: Date.now(),
  };
}
```

### Releasing a Worktree (Merge-Back + Cleanup)
```typescript
// Core release logic
async function gitWorktreeRelease(
  repoDir: string,
  info: WorktreeInfo,
): Promise<{ merged: boolean; fallbackBranch?: string }> {
  // 1. Auto-commit any uncommitted changes in the worktree
  await autoCommitOrphanedFiles(info.path);

  // 2. Check if the worker branch has commits ahead of main
  const { stdout: aheadCount } = await exec(
    "git", ["rev-list", "--count", `main..${info.branch}`],
    { cwd: repoDir },
  );

  if (parseInt(aheadCount.trim(), 10) === 0) {
    // Nothing to merge -- just clean up
    await exec("git", ["worktree", "remove", info.path, "--force"], { cwd: repoDir });
    await exec("git", ["branch", "-d", info.branch], { cwd: repoDir }).catch(() => {});
    return { merged: false };
  }

  // 3. In main worktree: rebase worker branch onto main, then merge
  //    First, update main to latest origin
  await exec("git", ["fetch", "origin", "main"], { cwd: repoDir });

  //    Rebase worker branch onto origin/main
  try {
    await exec("git", ["rebase", "origin/main", info.branch], { cwd: repoDir });
  } catch {
    await exec("git", ["rebase", "--abort"], { cwd: repoDir }).catch(() => {});
    // Conflict: push worker branch as fallback
    const fallback = `session-${info.taskId}`;
    await exec("git", ["push", "-u", "origin", info.branch + ":" + fallback], { cwd: repoDir });
    await exec("git", ["worktree", "remove", info.path, "--force"], { cwd: repoDir });
    await exec("git", ["branch", "-D", info.branch], { cwd: repoDir }).catch(() => {});
    return { merged: false, fallbackBranch: fallback };
  }

  //    Fast-forward merge into main
  await exec("git", ["checkout", "main"], { cwd: repoDir });
  await exec("git", ["merge", "--ff-only", info.branch], { cwd: repoDir });

  // 4. Push via queue
  // (caller handles push via enqueuePushAndWait)

  // 5. Clean up worktree and branch
  await exec("git", ["worktree", "remove", info.path, "--force"], { cwd: repoDir });
  await exec("git", ["branch", "-d", info.branch], { cwd: repoDir }).catch(() => {});

  return { merged: true };
}
```

### Listing Worktrees (Porcelain Parse)
```typescript
// Parse `git worktree list --porcelain` output
interface GitWorktreeEntry {
  path: string;
  head: string;
  branch: string | null;  // null for detached HEAD
}

function parseWorktreeList(output: string): GitWorktreeEntry[] {
  const entries: GitWorktreeEntry[] = [];
  let current: Partial<GitWorktreeEntry> = {};

  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current.path) entries.push(current as GitWorktreeEntry);
      current = { path: line.slice("worktree ".length) };
    } else if (line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length);
    } else if (line.startsWith("branch ")) {
      current.branch = line.slice("branch ".length).replace("refs/heads/", "");
    } else if (line === "") {
      if (current.path) entries.push(current as GitWorktreeEntry);
      current = {};
    }
  }
  if (current.path) entries.push(current as GitWorktreeEntry);

  return entries;
}
```

### Stale Worktree Recovery
```typescript
// On startup: reconcile filesystem with in-memory state
async function recoverStaleWorktrees(
  repoDir: string,
  worktreeDir: string,
): Promise<number> {
  const { stdout } = await exec("git", ["worktree", "list", "--porcelain"], { cwd: repoDir });
  const entries = parseWorktreeList(stdout);

  let recovered = 0;
  for (const entry of entries) {
    // Only process worker/* branches in .worktrees/ directory
    if (!entry.branch?.startsWith("worker/") || !entry.path.includes(".worktrees/")) continue;

    console.log(`[worktree] Recovering stale worktree: ${entry.path} (${entry.branch})`);

    // Auto-commit, then remove
    await autoCommitOrphanedFiles(entry.path).catch(() => {});
    await exec("git", ["worktree", "remove", entry.path, "--force"], { cwd: repoDir }).catch(() => {});
    await exec("git", ["branch", "-D", entry.branch], { cwd: repoDir }).catch(() => {});
    recovered++;
  }

  // Also prune worktree metadata for manually-deleted directories
  await exec("git", ["worktree", "prune"], { cwd: repoDir }).catch(() => {});

  return recovered;
}
```

### Extended Metrics
```typescript
// Add to SessionMetrics interface in metrics.ts
interface SessionMetrics {
  // ... existing fields ...
  /** Worktree task ID (worker sessions only). */
  worktreeTaskId?: string;
  /** Worktree branch name. */
  worktreeBranch?: string;
  /** Time spent allocating the worktree (ms). */
  worktreeAllocMs?: number;
  /** Time spent cleaning up the worktree (ms). */
  worktreeCleanupMs?: number;
  /** Whether merge-back succeeded or fell back to branch. */
  worktreeMergeResult?: "merged" | "fallback" | "no-changes" | "error";
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single shared working directory | Git worktrees for isolation | Git 2.5+ (2015) | Enables true concurrent work without filesystem conflicts |
| `git worktree prune` (manual) | `git worktree remove` (explicit) | Git 2.17+ (2018) | Cleaner lifecycle -- explicit removal > garbage collection |

**Deprecated/outdated:**
- `git worktree prune` as primary cleanup: still works but `git worktree remove` is preferred for explicit lifecycle control. `prune` is the safety net, not the primary mechanism.

## Open Questions

1. **Merge-back strategy: rebase in worktree vs main worktree**
   - What we know: The user decided "rebase onto main" but the exact git workflow (rebase the worker branch then ff-merge into main, vs. cherry-pick, vs. merge commit) needs to be chosen.
   - What's unclear: Whether `rebaseAndPush()` from `rebase-push.ts` can be reused directly or needs adaptation for the worktree-to-main flow.
   - Recommendation: The cleanest approach is: (1) fetch origin/main, (2) rebase worker branch onto origin/main (from main worktree), (3) checkout main, (4) merge --ff-only worker branch, (5) push main via push queue. This gives linear history as requested. The existing `rebaseAndPush()` is designed for same-branch push (rebase main onto origin/main, push main) -- it would need a wrapper for the cross-branch case.

2. **Remote URL configuration: one-time vs enforced**
   - What we know: Remote should be `https://github.com/LeeHongji/Open-Youji`.
   - What's unclear: Whether this should be verified on every WorktreeManager init (defensive) or configured once and assumed.
   - Recommendation: Verify on init. `git remote get-url origin` is fast (<10ms). If wrong, set it. Log either way.

3. **Concurrency mutex implementation**
   - What we know: Need to prevent race in `allocate()`.
   - What's unclear: Whether a simple Promise chain is sufficient or a proper mutex library is needed.
   - Recommendation: Simple Promise chain (serialize async operations). JavaScript's event loop means the check-and-allocate can be made atomic by not yielding between the capacity check and the Map insertion. The git operations can happen after the Map reservation.

## Sources

### Primary (HIGH confidence)
- **Existing codebase** (`infra/scheduler/src/`) -- direct inspection of `rebase-push.ts`, `push-queue.ts`, `auto-commit.ts`, `agent.ts`, `executor.ts`, `metrics.ts`, `types.ts`, `branch-cleanup.ts`, `instance-guard.ts`, `service.ts`, `constants.ts`
- **Git documentation** (`git worktree --help`) -- verified `add -b`, `remove`, `list --porcelain`, `prune` commands and their behavior
- **Git version** -- verified 2.39.5 on target platform (macOS), which supports all required worktree features

### Secondary (MEDIUM confidence)
- **Architecture patterns** -- WorktreeManager API design is recommended based on codebase conventions (Result types, named exports, const satisfies config)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all git CLI commands verified
- Architecture: HIGH -- follows established codebase patterns exactly
- Pitfalls: HIGH -- identified from direct git worktree documentation and codebase analysis of existing concurrency patterns

**Research date:** 2026-03-17
**Valid until:** 2026-04-17 (stable domain -- git worktree API is mature)
