---
phase: 01-foundation
plan: 01
subsystem: infra
tags: [git-worktree, concurrency, worker-isolation, typescript]

# Dependency graph
requires: []
provides:
  - "WorktreeManager class with allocate, release, list, recover, getCapacity"
  - "Porcelain parser for git worktree list output"
  - "Promise-chain serialization for concurrent worktree operations"
  - "ExecFn type for dependency-injected shell execution"
affects: [fleet-scheduler, agent-orchestration, worker-session]

# Tech tracking
tech-stack:
  added: []
  patterns: [dependency-injection-for-testability, promise-chain-serialization, result-types-over-exceptions]

key-files:
  created:
    - infra/scheduler/src/worktree.ts
    - infra/scheduler/src/worktree.test.ts
  modified: []

key-decisions:
  - "Used dependency injection for exec and autoCommit instead of module-level mocking -- enables reliable testing without promisify edge cases"
  - "Promise chain serialization (this.queue = this.queue.then(...)) instead of mutex library -- zero dependencies, sufficient for single-process concurrency"
  - "Rebase conflict fallback creates a local session-{taskId} branch (not pushed) -- caller handles push via push queue"

patterns-established:
  - "DI pattern: WorktreeConfig accepts exec/autoCommit overrides for testing"
  - "Result types: WorktreeAllocResult/WorktreeReleaseResult use { ok: true/false } discriminated union"
  - "Porcelain parsing: parseWorktreeList as standalone pure function"

requirements-completed: [FOUND-01, FOUND-02, FOUND-03]

# Metrics
duration: 6min
completed: 2026-03-17
---

# Phase 1 Plan 1: WorktreeManager Summary

**Git worktree lifecycle manager with concurrent allocation serialization, auto-commit on release, and stale worktree recovery**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-17T14:45:46Z
- **Completed:** 2026-03-17T14:52:00Z
- **Tasks:** 2 (TDD: RED + GREEN)
- **Files modified:** 2

## Accomplishments
- WorktreeManager class with full lifecycle: allocate, release, list, recover, getCapacity
- Promise-chain serialization prevents concurrent allocations from exceeding maxWorktrees
- Rebase conflict fallback to session-{taskId} branch preserves worker commits
- Stale worktree recovery on startup for crashed session cleanup
- Porcelain parser for `git worktree list --porcelain` output
- 22 tests covering all behaviors including concurrent access and edge cases

## Task Commits

Each task was committed atomically:

1. **Task 1: Failing tests (TDD RED)** - `6ed69ca` (test)
2. **Task 2: Implementation (TDD GREEN)** - `a9ac485` (feat)

_TDD plan: RED phase wrote failing tests, GREEN phase implemented WorktreeManager to pass all tests._

## Files Created/Modified
- `infra/scheduler/src/worktree.ts` - WorktreeManager class with all exports (WorktreeManager, WorktreeConfig, WorktreeInfo, WorktreeAllocResult, WorktreeReleaseResult, ExecFn, parseWorktreeList)
- `infra/scheduler/src/worktree.test.ts` - 22 tests covering allocate, release, list, recover, getCapacity, porcelain parsing, concurrency

## Decisions Made
- Used dependency injection (exec/autoCommit in WorktreeConfig) instead of module-level vi.mock to avoid promisify+callback incompatibility in tests
- Promise chain serialization via `this.queue.then(...)` for zero-dependency concurrent access control
- Fallback branch creation is local-only (no push) -- caller decides when to push via existing push queue infrastructure

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Changed from module-level mocking to dependency injection**
- **Found during:** Task 2 (Implementation)
- **Issue:** `promisify(execFile)` with vi.mock doesn't properly handle Node's custom promisify behavior -- `{ stdout, stderr }` destructuring returned undefined
- **Fix:** Added `exec` and `autoCommit` as optional config params with DI, tests pass mock functions directly
- **Files modified:** infra/scheduler/src/worktree.ts, infra/scheduler/src/worktree.test.ts
- **Verification:** All 22 tests pass
- **Committed in:** a9ac485

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** DI approach is actually better architecture than module-level mocking. No scope creep.

## Issues Encountered
- Pre-existing TypeScript errors in cli.ts and api/server.ts (unrelated to worktree) -- not addressed, out of scope

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- WorktreeManager ready for integration into fleet scheduler (Phase 1 Plan 2)
- ExecFn type available for other modules needing testable shell execution
- No blockers

---
*Phase: 01-foundation*
*Completed: 2026-03-17*
