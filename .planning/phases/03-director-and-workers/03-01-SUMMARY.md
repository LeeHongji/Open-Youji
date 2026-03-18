---
phase: 03-director-and-workers
plan: 01
subsystem: infra
tags: [claude-sdk, director, youji-persona, slack, resume, system-prompt]

requires:
  - phase: 02-slack-bridge
    provides: "SlackBridge message pipeline with ThreadStore and ConversationLock"
provides:
  - "director.ts: handleDirectorMessage(), buildYoujiDirective(), DirectorMessageOpts"
  - "Youji persona system prompt with task decomposition instructions"
  - "Claude SDK session resume with history-injection fallback"
  - "slack-bridge.ts wired to director instead of stub"
affects: [03-02-worker-manager, 03-03-integration]

tech-stack:
  added: []
  patterns: [module-level-map-for-ephemeral-state, resume-with-fallback, system-prompt-preset-append]

key-files:
  created:
    - infra/scheduler/src/director.ts
    - infra/scheduler/src/director.test.ts
  modified:
    - infra/scheduler/src/slack-bridge.ts
    - infra/scheduler/src/slack-bridge.test.ts

key-decisions:
  - "Module-level Map for session IDs instead of DB table -- ephemeral is acceptable since resume failure has history-injection fallback"
  - "Director uses bypassPermissions + allowDangerouslySkipPermissions for unattended operation"
  - "System prompt uses claude_code preset with append for Youji directive"

patterns-established:
  - "Resume-with-fallback: try SDK resume, catch error and inject history as prompt prefix"
  - "System prompt construction: buildYoujiDirective() returns append string for claude_code preset"

requirements-completed: [DIR-01, DIR-05, DIR-06]

duration: 3min
completed: 2026-03-18
---

# Phase 3 Plan 1: Director Intelligence Summary

**Youji director module with Claude SDK resume, persona system prompt, and slack-bridge integration replacing Phase 2 stub**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-18T07:36:54Z
- **Completed:** 2026-03-18T07:40:12Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Director module (director.ts) with handleDirectorMessage() that runs Claude SDK sessions with resume support and history-injection fallback
- Youji persona system prompt with task decomposition instructions, tag conventions, spawn-worker tags, and approval gate references
- Slack-bridge wired to director -- Phase 2 stub fully replaced with real intelligence layer
- 24 total tests passing (16 director + 8 bridge)

## Task Commits

Each task was committed atomically:

1. **Task 1: Director module with TDD (RED + GREEN)** - `d47b9e7` (feat)
2. **Task 2: Wire director into slack-bridge.ts** - `1acd5c7` (feat)

## Files Created/Modified
- `infra/scheduler/src/director.ts` - Director intelligence: handleDirectorMessage, buildYoujiDirective, session ID management
- `infra/scheduler/src/director.test.ts` - 16 tests covering SDK options, resume, fallback, and directive content
- `infra/scheduler/src/slack-bridge.ts` - Replaced stub with handleDirectorMessage call, added repoDir module state
- `infra/scheduler/src/slack-bridge.test.ts` - Updated to mock director module, 8 tests for bridge pipeline

## Decisions Made
- Used module-level Map<string, string> for session ID storage instead of SQLite table. Ephemeral storage is acceptable because resume failure has a robust fallback (history injection). Avoids schema changes to ThreadStore.
- Director uses `bypassPermissions` + `allowDangerouslySkipPermissions` for unattended autonomous operation.
- System prompt uses `{ type: "preset", preset: "claude_code", append: buildYoujiDirective() }` to layer Youji's persona on top of Claude Code defaults.
- Removed `store: ThreadStore` from DirectorMessageOpts -- session IDs managed internally via Map, keeping the director interface simpler.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Simplified DirectorMessageOpts interface**
- **Found during:** Task 1 (Director implementation)
- **Issue:** Plan specified `store: ThreadStore` in DirectorMessageOpts for session ID lookup, but module-level Map makes this unnecessary and simplifies the interface
- **Fix:** Removed `store` field from DirectorMessageOpts, used module-level Map directly
- **Files modified:** infra/scheduler/src/director.ts
- **Verification:** All 16 director tests pass
- **Committed in:** d47b9e7

---

**Total deviations:** 1 auto-fixed (1 simplification)
**Impact on plan:** Interface simplification, no scope change. Slack-bridge passes fewer arguments.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Director intelligence fully operational -- Youji responds via Claude SDK with persona
- Ready for Plan 03-02 (Worker Manager) to add worker spawning capability
- Ready for Plan 03-03 (Integration) to wire spawn-worker tag parsing in slack-bridge

---
*Phase: 03-director-and-workers*
*Completed: 2026-03-18*
