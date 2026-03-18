---
phase: 03-director-and-workers
plan: 02
subsystem: infra
tags: [worker-manager, task-parser, worktree, agent-spawning, push-queue]

requires:
  - phase: 01-foundation
    provides: "WorktreeManager, spawnAgent, enqueuePushAndWait, task-parser base utilities"
provides:
  - "WorkerManager class with per-project worker loop lifecycle"
  - "parseTasksFile() for structured TASKS.md parsing"
  - "markTaskInProgress() and markTaskDone() for task state transitions"
  - "WorkerCompletionEvent for downstream notification integration"
affects: [03-director-and-workers, 04-integration]

tech-stack:
  added: []
  patterns: [per-project-worker-loop, task-claiming-via-in-progress-tag, fire-and-forget-async-loop, auto-retry-with-blocked-fallback]

key-files:
  created:
    - infra/scheduler/src/worker-manager.ts
    - infra/scheduler/src/worker-manager.test.ts
  modified:
    - infra/scheduler/src/task-parser.ts
    - infra/scheduler/src/task-parser.test.ts

key-decisions:
  - "TaskId generated from SHA-256 hash of task text (deterministic, collision-resistant)"
  - "Worker loop is fire-and-forget async — startProject returns immediately"
  - "Auto-retry exactly once on failure, then mark blocked (prevents infinite retry loops)"
  - "markTaskDone finds task by text match (robust to index shifts from concurrent writes)"

patterns-established:
  - "Worker loop pattern: read -> pick -> claim -> worktree -> execute -> release -> push -> mark-done -> repeat"
  - "Full DI constructor for all external dependencies (spawnAgent, worktreeManager, enqueuePush, readFile, writeFile)"

requirements-completed: [WORK-01, WORK-02, WORK-03, WORK-04, WORK-05, WORK-06]

duration: 4min
completed: 2026-03-18
---

# Phase 03 Plan 02: Worker Manager Summary

**WorkerManager with per-project worker loop that picks tasks from TASKS.md, executes in worktrees via spawnAgent, and pushes results through the push queue**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-18T07:36:57Z
- **Completed:** 2026-03-18T07:41:03Z
- **Tasks:** 1
- **Files modified:** 4

## Accomplishments
- WorkerManager class with full worker lifecycle: pick task -> mark in-progress -> allocate worktree -> spawn agent -> release worktree -> push -> mark done -> repeat
- Extended task-parser with parseTasksFile(), markTaskInProgress(), markTaskDone() for file-level TASKS.md manipulation
- One worker per project guard enforced (duplicate startProject is no-op)
- Auto-retry once on failure, then mark task [blocked-by: execution failure]
- 21 new tests (14 worker-manager + 7 task-parser), all passing

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend task-parser + WorkerManager (RED + GREEN)** - `aa41b3e` (feat)

**Plan metadata:** pending (docs: complete plan)

_Note: TDD task with RED+GREEN committed together after verification._

## Files Created/Modified
- `infra/scheduler/src/worker-manager.ts` - WorkerManager class with per-project worker loop, completion events, retry logic
- `infra/scheduler/src/worker-manager.test.ts` - 14 tests covering lifecycle, error handling, no-op guard, model override
- `infra/scheduler/src/task-parser.ts` - Added ParsedTask interface, parseTasksFile(), markTaskInProgress(), markTaskDone()
- `infra/scheduler/src/task-parser.test.ts` - Added 7 tests for new file-level parsing functions

## Decisions Made
- TaskId generated from SHA-256 hash of task text (deterministic, collision-resistant, no sequential counter needed)
- Worker loop is fire-and-forget async — startProject returns immediately, no awaiting the loop
- Auto-retry exactly once on failure, then mark blocked (prevents infinite retry loops while giving transient errors a chance)
- markTaskDone finds task by text match rather than index (robust to index shifts from concurrent writes)
- Worker prompt template follows RESEARCH.md Pattern 4 format

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- WorkerManager ready for integration with DirectorAgent (Plan 03-03)
- startProject() accepts model override for per-task model routing
- WorkerCompletionEvent provides branch name for diff references in Slack notifications

---
*Phase: 03-director-and-workers*
*Completed: 2026-03-18*

## Self-Check: PASSED
