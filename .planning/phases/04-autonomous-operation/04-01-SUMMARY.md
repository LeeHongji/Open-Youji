---
phase: 04-autonomous-operation
plan: 01
subsystem: infra
tags: [budget-gate, metrics, compute-minutes, worker-respawn]

requires:
  - phase: 03-director-and-workers
    provides: WorkerManager with startProject/stopProject lifecycle

provides:
  - getProjectDailyMinutes aggregation from JSONL metrics
  - checkTimeBudget per-project daily compute-minutes enforcement
  - TimeBudgetResult interface for budget check results
  - Worker respawn budget gating in SchedulerService
  - notifyBudgetExceeded Slack stub for mentor alerts

affects: [04-02, autonomous-operation, budget-enforcement]

tech-stack:
  added: []
  patterns: [time-based-budget-gate, fire-and-forget-notification]

key-files:
  created: []
  modified:
    - infra/scheduler/src/metrics.ts
    - infra/scheduler/src/metrics.test.ts
    - infra/scheduler/src/budget-gate.ts
    - infra/scheduler/src/budget-gate.test.ts
    - infra/scheduler/src/service.ts
    - infra/scheduler/src/service.test.ts
    - infra/scheduler/src/slack.ts

key-decisions:
  - "readBudgetStatus reused from notify.ts -- no new budget.yaml parser needed"
  - "Budget check uses importOriginal mock pattern to allow real readBudgetStatus in tests"
  - "notifyBudgetExceeded is fire-and-forget (.catch) to avoid breaking tick loop"

patterns-established:
  - "Time-based budget gate pattern: aggregate daily metrics then compare against budget.yaml limit"
  - "Fire-and-forget notification: .catch() on async notification calls to prevent tick loop failures"

requirements-completed: [RES-01, RES-02]

duration: 8min
completed: 2026-03-18
---

# Phase 04 Plan 01: Time-Based Resource Accounting Summary

**Daily compute-minutes aggregation from JSONL metrics with per-project budget gate that blocks worker respawn when limits are exceeded**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-18T08:46:14Z
- **Completed:** 2026-03-18T08:54:49Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- getProjectDailyMinutes aggregates daily session durations per project from JSONL metrics
- checkTimeBudget enforces compute-minutes limits from budget.yaml per project per day
- Worker respawn in SchedulerService checks time budget before spawning -- projects over budget are stopped and mentor is notified

## Task Commits

Each task was committed atomically:

1. **Task 1: getProjectDailyMinutes + checkTimeBudget (TDD)**
   - `6fa9105` (test) - RED: failing tests for both functions
   - `d7af7f0` (feat) - GREEN: implement getProjectDailyMinutes and checkTimeBudget
2. **Task 2: Wire budget check into checkAndRespawnWorkers (TDD)**
   - `c7a1a04` (test) - RED: failing tests for worker respawn budget check
   - `00ee87f` (feat) - GREEN: wire checkTimeBudget into respawn loop

_TDD tasks have multiple commits (test then feat)_

## Files Created/Modified
- `infra/scheduler/src/metrics.ts` - Added getProjectDailyMinutes aggregation function
- `infra/scheduler/src/metrics.test.ts` - Added 5 tests for getProjectDailyMinutes
- `infra/scheduler/src/budget-gate.ts` - Added checkTimeBudget and TimeBudgetResult
- `infra/scheduler/src/budget-gate.test.ts` - Added 5 tests for checkTimeBudget
- `infra/scheduler/src/service.ts` - Budget check before wm.startProject in checkAndRespawnWorkers
- `infra/scheduler/src/service.test.ts` - Added 4 tests for worker respawn budget check
- `infra/scheduler/src/slack.ts` - Added notifyBudgetExceeded no-op stub

## Decisions Made
- Reused readBudgetStatus from notify.ts rather than writing a new budget.yaml parser
- Used importOriginal mock pattern in budget-gate.test.ts to allow real readBudgetStatus while mocking readAllBudgetStatuses
- notifyBudgetExceeded wrapped in .catch() to prevent notification failures from breaking the tick loop

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed vi.mock for notify.js to include readBudgetStatus**
- **Found during:** Task 1 (GREEN phase)
- **Issue:** Existing vi.mock in budget-gate.test.ts only mocked readAllBudgetStatuses, but checkTimeBudget also imports readBudgetStatus
- **Fix:** Changed to importOriginal pattern to expose real readBudgetStatus alongside mocked readAllBudgetStatuses
- **Files modified:** infra/scheduler/src/budget-gate.test.ts
- **Verification:** All 68 tests pass
- **Committed in:** d7af7f0 (Task 1 GREEN commit)

**2. [Rule 1 - Bug] Fixed test assertion for checkTimeBudget call args**
- **Found during:** Task 2 (GREEN phase)
- **Issue:** Test expected 3 args (project, repoDir, undefined) but implementation only passes 2 (no metricsPath)
- **Fix:** Removed undefined from expected args
- **Files modified:** infra/scheduler/src/service.test.ts
- **Verification:** All 19 service tests pass
- **Committed in:** 00ee87f (Task 2 GREEN commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Both auto-fixes necessary for test correctness. No scope creep.

## Issues Encountered
- Pre-existing test failures in backend.test.ts, evolution.test.ts, verify-knowledge.test.ts are unrelated to this plan's changes (out of scope)

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Time-based budget gate is wired and tested, ready for plan 04-02 (session lifecycle and full autonomous loop)
- notifyBudgetExceeded is a stub -- real Slack notification implementation deferred to Slack integration work

---
*Phase: 04-autonomous-operation*
*Completed: 2026-03-18*
