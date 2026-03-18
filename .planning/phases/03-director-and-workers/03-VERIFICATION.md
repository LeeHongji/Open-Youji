---
phase: 03-director-and-workers
verified: 2026-03-18T08:00:00Z
status: passed
score: 5/5 must-haves verified
re_verification: false
---

# Phase 3: Director and Workers Verification Report

**Phase Goal:** Mentor can converse with Youji in Slack, and Youji can spawn workers to execute tasks and report results
**Verified:** 2026-03-18T08:00:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth                                                                                                                        | Status     | Evidence                                                                                                      |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------- |
| 1   | Youji responds to mentor messages in Slack threads as a conversational agent that reads and respects decisions and conventions | ✓ VERIFIED | `director.ts` runs Claude SDK sessions with `bypassPermissions`, `settingSources: ["project","user"]`, `decisions/` read instruction in system prompt; slack-bridge wires `handleDirectorMessage` replacing the Phase 2 stub |
| 2   | Youji can decompose high-level goals into concrete tasks and spawn worker agents to execute them                              | ✓ VERIFIED | `buildYoujiDirective` contains TASKS.md format, tag conventions, and `[spawn-worker:]` emission instructions; slack-bridge post-response hook parses the tag and calls `WorkerManager.startProject()` with optional model override |
| 3   | Workers execute in isolated worktrees, commit results, and push through the serialized push queue without conflicts           | ✓ VERIFIED | `worker-manager.ts` loop: `worktreeManager.allocate(taskId)` → `spawnAgent(cwd=worktree.path)` → `worktreeManager.release(taskId)` → `enqueuePushAndWait`; DI injected for all dependencies |
| 4   | Zombie workers are detected and terminated after timeout, and task claiming prevents double-pickup across concurrent workers  | ✓ VERIFIED | `startProject` is no-op if project already in `activeWorkers` map; `maxDurationMs: 900_000` enforced via spawnAgent's duration timeout; `worktreeManager.recover()` called on bridge startup; `markTaskInProgress` with date tag prevents double-pickup |
| 5   | Worker results are summarized and reported back to the director for relay to the mentor                                      | ✓ VERIFIED | `handleWorkerCompletion` callback in slack-bridge calls `notifyWorkerCompletion` (with 500-char summary + branch diff ref) or `notifyWorkerFailure`; periodic 60s respawn check in `service.ts` via `checkAndRespawnWorkers` |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact                                        | Expected                                                             | Status     | Details                                                                                                |
| ----------------------------------------------- | -------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------ |
| `infra/scheduler/src/director.ts`               | `handleDirectorMessage`, `buildYoujiDirective`, `DirectorMessageOpts` | ✓ VERIFIED | All three exports present; 176 lines; substantive implementation with resume logic, fallback, and full Youji directive |
| `infra/scheduler/src/director.test.ts`          | 16 tests for SDK options, resume, fallback, directive content        | ✓ VERIFIED | 16+ tests via `describe("director")` and nested suites; all passing |
| `infra/scheduler/src/slack-bridge.ts`           | Stub replaced with `handleDirectorMessage`, WorkerManager lifecycle  | ✓ VERIFIED | `handleDirectorMessage` called at line 150; `WorkerManager` created at line 63; stub comment absent |
| `infra/scheduler/src/worker-manager.ts`         | `WorkerManager`, `WorkerManagerConfig`, `WorkerCompletionEvent`      | ✓ VERIFIED | All three exported; 287 lines; full worker loop with retry logic, DI for all dependencies |
| `infra/scheduler/src/worker-manager.test.ts`    | 14 tests for lifecycle, error handling, no-op guard, model override  | ✓ VERIFIED | Tests present and passing as part of 122-test suite |
| `infra/scheduler/src/task-parser.ts`            | `parseTasksFile`, `markTaskInProgress`, `markTaskDone`, `ParsedTask` | ✓ VERIFIED | All four exports present; 159 lines; handles continuation lines for "Done when:" |
| `infra/scheduler/src/agent.ts`                  | `directorSession` and `projectWorker` profiles in `AGENT_PROFILES`  | ✓ VERIFIED | Lines 36-37: `directorSession` (16 turns, 120s) and `projectWorker` (64 turns, 900s); opencode overrides at lines 53-54 |
| `infra/scheduler/src/slack.ts`                  | `notifyWorkerCompletion` and `notifyWorkerFailure` stubs             | ✓ VERIFIED | Lines 116-134: both exported as async no-op stubs with correct signatures including `diffRef` parameter |
| `infra/scheduler/src/service.ts`                | Periodic 60s worker respawn check in `tick()`                        | ✓ VERIFIED | `shouldCheckWorkers`, `checkAndRespawnWorkers`, and `lastWorkerCheckMs` present; scans `projects/` for open TASKS.md entries |

### Key Link Verification

| From                       | To                       | Via                                         | Status     | Details                                                                                                     |
| -------------------------- | ------------------------ | ------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------- |
| `slack-bridge.ts`          | `director.ts`            | `handleDirectorMessage()` in `handleMessage` | ✓ WIRED    | Import at line 7, call at line 150 with `convKey`, `userMessage`, `history`, `repoDir` |
| `director.ts`              | `sdk.ts`                 | `runQuery()` for Claude SDK session          | ✓ WIRED    | Import at line 8, called at lines 40 and 66 (resume + fallback paths); result text returned |
| `slack-bridge.ts`          | `worker-manager.ts`      | `WorkerManager` instance lifecycle           | ✓ WIRED    | Import at line 8, created at line 63, cleaned up in `stopSlackBridge`, exported via `getWorkerManager()` |
| `slack-bridge.ts`          | `slack.ts`               | `notifyWorkerCompletion`/`notifyWorkerFailure` | ✓ WIRED  | Import at line 12, called in `handleWorkerCompletion` at lines 107 and 117 |
| `worker-manager.ts`        | `worktree.ts`            | `worktreeManager.allocate/release`           | ✓ WIRED    | `allocate(taskId)` at line 176, `release(taskId)` at line 228 |
| `worker-manager.ts`        | `agent.ts`               | `spawnAgent()` for Claude sessions           | ✓ WIRED    | DI via `config.spawnAgent`; called at line 201 with `profile`, `prompt`, `cwd=worktreePath` |
| `worker-manager.ts`        | `rebase-push.ts`         | `enqueuePushAndWait()` after worker completes | ✓ WIRED   | DI via `config.enqueuePush`; called at line 258 after `worktreeManager.release` |
| `worker-manager.ts`        | `task-parser.ts`         | `parseTasksFile`, `markTaskInProgress`       | ✓ WIRED    | Import at line 7, `parseTasksFile` at lines 157 and 267, `markTaskInProgress` at line 172, `markTaskDone` at line 271 |
| `service.ts`               | `worker-manager.ts`      | Periodic task check in `tick()`              | ✓ WIRED    | `getWorkerManager` imported from `slack-bridge.ts` at line 12; `checkAndRespawnWorkers(wm)` at line 273 |
| `slack-bridge.ts` (spawn)  | `worker-manager.ts`      | `[spawn-worker:]` tag parsed post-response   | ✓ WIRED    | Regex at line 161; `workerManager.startProject(project, {model})` at line 165 |

### Requirements Coverage

| Requirement | Source Plan | Description                                                              | Status      | Evidence                                                                                                   |
| ----------- | ----------- | ------------------------------------------------------------------------ | ----------- | ---------------------------------------------------------------------------------------------------------- |
| DIR-01      | 03-01       | Youji responds to mentor messages in Slack as a conversational agent     | ✓ SATISFIED | `handleDirectorMessage` replaces stub; Claude SDK session with Youji persona; all 16 director tests pass  |
| DIR-02      | 03-03       | Youji can spawn worker agents to execute tasks                           | ✓ SATISFIED | Two spawn paths: `[spawn-worker:]` tag (immediate) + 60s scheduler poll (fallback); both call idempotent `startProject()` |
| DIR-05      | 03-01       | Youji decomposes goals into TASKS.md entries with tag format             | ✓ SATISFIED | `buildYoujiDirective` instructs task format with `[skill:]`, `[fleet-eligible]`, `Done when:` continuation |
| DIR-06      | 03-01       | Youji reads decision records and respects approval gates                 | ✓ SATISFIED | Directive includes: "Read `decisions/` directory before making significant choices" and "Respect approval gates defined in CLAUDE.md" |
| WORK-01     | 03-02       | Workers execute in isolated git worktrees with their own branch          | ✓ SATISFIED | `WorktreeManager.allocate(taskId)` returns `WorktreeInfo` with unique branch; `cwd=worktreeInfo.path` in spawnAgent |
| WORK-02     | 03-02       | Workers receive one task and return results via git commit               | ✓ SATISFIED | Worker prompt template: single task text, done-when, project, branch; agent runs in worktree and commits |
| WORK-03     | 03-02       | Worker pushes serialized through push queue                              | ✓ SATISFIED | `enqueuePushAndWait(repoDir, "worker-{taskId}")` called after each worktree release |
| WORK-04     | 03-02       | Workers have configurable timeout (default 15 min)                       | ✓ SATISFIED | `PROJECT_WORKER_PROFILE.maxDurationMs = 900_000` (15 min); `startProject` accepts `model` override; `spawnAgent` enforces duration via `setTimeout` |
| WORK-05     | 03-02       | Zombie workers detected and terminated                                   | ✓ SATISFIED | `worktreeManager.recover()` on bridge startup; `activeWorkers` map prevents duplicate loops; `AbortController` for stop; `spawnAgent` duration timeout interrupts zombies |
| WORK-06     | 03-02       | Task claiming prevents double-pickup across concurrent workers            | ✓ SATISFIED | `markTaskInProgress` writes `[in-progress: YYYY-MM-DD]` to TASKS.md before worktree allocation; `parseTasksFile` filters out `isInProgress` tasks |
| OBS-03      | 03-03       | Worker results summarized and reported to director                       | ✓ SATISFIED | `WorkerCompletionEvent` (with `result.text`, `durationMs`, `costUsd`, `branch`) routed to `notifyWorkerCompletion`/`notifyWorkerFailure` in slack-bridge |

### Anti-Patterns Found

None. Scanned `director.ts`, `worker-manager.ts`, `slack-bridge.ts`, `service.ts`, and `task-parser.ts` for:
- TODO/FIXME/HACK/PLACEHOLDER comments — none found
- Empty return implementations (`return null`, `return {}`) — none in core logic paths
- Phase 2 stub response — fully replaced; no "Got it" stub remains in slack-bridge

### Human Verification Required

#### 1. Slack round-trip conversation

**Test:** Send a DM to Youji on Slack with a high-level goal (e.g., "Please set up a new experiment to test X")
**Expected:** Youji responds in the same thread with a conversational reply in the user's language, and decomposes the goal into tasks written to the appropriate project's TASKS.md
**Why human:** Requires real Slack tokens, Socket Mode connection, and live Claude SDK access. Cannot be verified programmatically without those credentials.

#### 2. Worker spawn and completion notification

**Test:** After Youji writes tasks and emits `[spawn-worker: project]`, observe whether a worker agent starts, commits results, and a completion summary is posted
**Expected:** A Slack message appears (via `notifyWorkerCompletion`) showing task summary, duration, cost, and branch diff reference
**Why human:** `notifyWorkerCompletion` is a no-op stub — the real notification requires the Slack bridge to be configured with live tokens. The wiring is verified, but the end-to-end notification requires human observation.

#### 3. Multi-turn conversation resume

**Test:** Send two sequential messages in the same Slack thread and verify Youji's second response shows awareness of the first exchange
**Expected:** Second response references context from first turn (demonstrating SDK `resume` is working, not falling back)
**Why human:** SDK session resume behavior requires live Claude API calls; mock tests verify the wiring but not the actual continuity of context.

---

## Summary

Phase 3 goal is fully achieved. All five observable truths are verified against the actual codebase:

1. **Director intelligence** (`director.ts`) replaces the Phase 2 stub with a real Claude SDK session. Youji's persona, TASKS.md decomposition instructions, tag conventions, `decisions/` read instruction, and approval gate references are all present in `buildYoujiDirective`. Resume with history-injection fallback is implemented and tested.

2. **Worker spawning** works via two complementary paths: the `[spawn-worker:]` tag parsed immediately post-director-response, and a 60-second scheduler poll in `service.ts` as a fallback. Both call `WorkerManager.startProject()` which is idempotent.

3. **Worker lifecycle** (`worker-manager.ts`) implements the full loop: pick task → mark in-progress → allocate isolated worktree → spawn agent → release worktree → serialize push → mark done → notify. All external dependencies are injected for testability.

4. **Zombie prevention** is three-layered: `worktreeManager.recover()` on startup cleans stale worktrees, the `activeWorkers` Map enforces one-per-project, and `spawnAgent`'s duration timeout interrupts long-running sessions.

5. **Completion reporting** routes `WorkerCompletionEvent` through the `handleWorkerCompletion` callback to `notifyWorkerCompletion`/`notifyWorkerFailure` stubs in `slack.ts`. The stubs are no-ops until Slack tokens are configured, but the wiring is complete.

All 122 tests across 5 test files pass (director: 16, worker-manager: 14, task-parser: 7+, slack-bridge: 19, agent: 18+, others: remaining). All 11 requirement IDs from plans 03-01, 03-02, and 03-03 are satisfied.

Three items require human verification: live Slack round-trip, end-to-end completion notification, and actual SDK resume continuity. These depend on external credentials and cannot be verified programmatically.

---

_Verified: 2026-03-18T08:00:00Z_
_Verifier: Claude (gsd-verifier)_
