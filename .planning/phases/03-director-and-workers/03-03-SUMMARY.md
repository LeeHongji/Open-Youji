---
phase: 03-director-and-workers
plan: 03
subsystem: infra
tags: [integration, worker-lifecycle, spawn-worker, notifications, agent-profiles]

requires:
  - phase: 03-director-and-workers
    provides: "Director handleDirectorMessage (Plan 01), WorkerManager with worker loop (Plan 02)"
provides:
  - "directorSession and projectWorker agent profiles in AGENT_PROFILES"
  - "WorkerManager lifecycle in slack-bridge (create on start, cleanup on stop)"
  - "spawn-worker tag parsing in director response for immediate worker dispatch"
  - "Worker completion/failure notification stubs in slack.ts"
  - "Periodic worker respawn check in scheduler service tick()"
  - "getWorkerManager() accessor for cross-module integration"
affects: [04-integration]

tech-stack:
  added: []
  patterns: [post-response-tag-parsing, periodic-respawn-poll, completion-callback-chain]

key-files:
  created: []
  modified:
    - infra/scheduler/src/agent.ts
    - infra/scheduler/src/slack.ts
    - infra/scheduler/src/slack-bridge.ts
    - infra/scheduler/src/slack-bridge.test.ts
    - infra/scheduler/src/service.ts

key-decisions:
  - "Two spawn paths for DIR-02: director [spawn-worker] tag for immediate spawn + scheduler 60s poll as fallback"
  - "WorkerManager lifecycle tied to slack-bridge start/stop (single owner, clean shutdown)"
  - "Completion handler uses fire-and-forget notification (catch errors, don't block worker loop)"

patterns-established:
  - "Post-response tag parsing: regex match on director response to extract structured signals"
  - "Periodic respawn poll: shouldCheckWorkers() with timestamp-based throttling in service tick()"
  - "Completion callback chain: WorkerManager -> handleWorkerCompletion -> notify stubs"

requirements-completed: [DIR-02, OBS-03]

duration: 3min
completed: 2026-03-18
---

# Phase 03 Plan 03: Director-Worker Integration Summary

**Full director-worker loop: agent profiles, WorkerManager lifecycle in slack-bridge, spawn-worker tag parsing, completion notifications, and periodic task respawn**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-18T07:44:50Z
- **Completed:** 2026-03-18T07:50:30Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- directorSession (16 turns, 2min) and projectWorker (64 turns, 15min) agent profiles with opencode backend overrides
- WorkerManager created/destroyed with slack-bridge lifecycle, including worktree recovery on startup
- Director response parsed for [spawn-worker: project model=X] tag to trigger immediate worker dispatch
- Worker completion/failure events routed to Slack notification stubs (notifyWorkerCompletion, notifyWorkerFailure)
- Periodic worker respawn in service.ts every 60s scans projects/ for open TASKS.md entries
- 19 slack-bridge tests covering lifecycle, spawn tags, notifications, concurrency; 18 agent tests passing

## Task Commits

Each task was committed atomically:

1. **Task 1: Add agent profiles and notification stubs** - `e7e4c2a` (feat)
2. **Task 2: Wire WorkerManager into slack-bridge lifecycle** - `2f1e9be` (feat)

## Files Created/Modified
- `infra/scheduler/src/agent.ts` - Added directorSession and projectWorker profiles + opencode overrides
- `infra/scheduler/src/slack.ts` - Added notifyWorkerCompletion and notifyWorkerFailure no-op stubs
- `infra/scheduler/src/slack-bridge.ts` - WorkerManager lifecycle, completion handler, spawn-worker tag parsing, getWorkerManager()
- `infra/scheduler/src/slack-bridge.test.ts` - 19 tests: lifecycle, spawn tags, completion notifications, concurrency, errors
- `infra/scheduler/src/service.ts` - Periodic worker respawn check every 60s scanning projects/TASKS.md

## Decisions Made
- Two complementary spawn paths for DIR-02: (1) Director emits [spawn-worker] tag for immediate spawn after task creation, (2) Scheduler polls every 60s for orphaned tasks. Both call startProject() which is idempotent.
- WorkerManager lifecycle owned by slack-bridge (not service.ts) to keep single-owner semantics and clean shutdown order.
- Completion handler uses fire-and-forget notification pattern (.catch for error logging) to avoid blocking the worker loop.
- Summary text truncated to 500 chars in completion notifications to keep Slack messages readable.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Full director-worker loop operational: mentor speaks to Youji, Youji spawns workers, workers complete tasks, results reported back
- Ready for Phase 4 integration testing and end-to-end verification
- All agent profiles defined for both claude and opencode backends

## Self-Check: PASSED

---
*Phase: 03-director-and-workers*
*Completed: 2026-03-18*
