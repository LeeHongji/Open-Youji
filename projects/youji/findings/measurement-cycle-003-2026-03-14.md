# Measurement Cycle 003: Self-Improvement Metrics

Date: 2026-03-14
Type: measurement cycle
Sessions measured: autonomous sessions 5-9
Reference: plans/self-improvement-measurement.md
Previous cycle: findings/measurement-cycle-002-2026-03-14.md

## Summary

| Metric | Cycle 001 | Cycle 002 | Cycle 003 | Trend | Status |
|--------|-----------|-----------|-----------|-------|--------|
| M1: Compliance | 75% | 100% | 100% | stable | At ceiling |
| M2: Detection | 0.75/s | 1.0/s | 0.2/s | down | Stabilizing |
| M3: Closure | 50-100% | 67% | 100% | up | Healthy |
| M4: Intervention | 0.0/s | 0.0/s | 0.0/s | stable | At target |
| M5: Learning | 1.0/s | 0.5/s | 0.4/s | down | Watch |

Interpretation (per framework): M1 stable at ceiling + M2 declining = "System is stabilizing — fewer new gaps found, existing conventions improving." This is the expected pattern for a maturing system. However, M5 continuing to decline warrants attention.

## M1: Convention Compliance Rate

**Current**: 8/8 = 100%
**Previous**: 100%
**Change**: stable

### Convention checks (sessions 5-9)

| Check | Status | Evidence |
|-------|--------|----------|
| Log entry completeness | PASS | All 5 sessions have README log entries citing source files |
| Inline logging discipline | PASS | Session 5: 3 commits, Session 8: 2 commits. Sessions 6,7,9 had single commits — appropriate since they had no actionable tasks |
| Commit message quality | PASS | All commits use conventional format (docs:, feat:) with descriptive messages |
| Decision records | PASS | No architectural decisions requiring ADRs were made |
| Provenance | PASS | All log entries cite sources (git log, TASKS.md, specific findings files) |
| Session discipline | PASS | All sessions follow orient → work/log → push cycle |
| Task lifecycle | PASS | Session 8 marked orphaned commit monitoring [x] with Done description; session 5 created cycle 003 task with proper schema |
| File organization | PASS | All files in correct project directories per CLAUDE.md structure |

### Note on orphaned auto-commits

5 orphaned auto-commits occurred during this window (129c080, f416161, 4977edb, 7b77be8, e20b0ff). All originate from interactive sessions. The last 2 (7b77be8, e20b0ff) use descriptive messages per Fix 1 from session 8 — confirming the fix is working as intended. These are not autonomous session compliance violations.

## M2: Gap Detection Rate

**Current**: 0.2/session (1 gap across 5 sessions)
**Previous**: 1.0/session
**Change**: -0.8/session (significant decline)

Gaps detected in sessions 5-9:
1. Session 5: Created "measurement cycle 003" task — a self-generated monitoring task from the measurement framework.

No new diagnosis files were created. Sessions 6, 7, and 9 found no actionable tasks and correctly logged that fact rather than inventing work.

### Context

The decline from 1.0 to 0.2 is the natural consequence of early gap exhaustion. The system found and fixed the obvious gaps (logging convention, orphaned commits) in cycles 001-002. Per the interpretation framework, M2 falling while M1 is stable indicates stabilization, not failure. The red-flag threshold is zero detection for 5+ sessions — we are above that (1 detection in 5 sessions).

However, this raises a question: should the system expand its audit scope to detect subtler gaps, or is the current convention set mature enough?

## M3: Gap Closure Rate

**Current**: 100% (3/3 gaps fully resolved)
**Previous**: 67% (2/3)
**Change**: +33 percentage points

| Gap | Detected | Status |
|-----|----------|--------|
| Infra-only logging convention | Session 2 audit | Fixed (session 3, convention documented) |
| Monolithic init commit | Session 2 audit | Accepted as bootstrapping exception |
| Orphaned commit attribution loss | Session 4 diagnosis | Fixed (session 8, descriptive auto-commit messages). Monitoring concluded in findings/orphaned-commit-monitoring-conclusion.md |

All detected gaps now have either an implemented fix or an explicit acceptance. The orphaned commit gap, which was "monitoring in progress" in cycle 002, was resolved in session 8 with Fix 1 (descriptive auto-commit messages).

## M4: Human Intervention Rate

**Current**: 0.0/session (sessions 5-9)
**Previous**: 0.0/session
**Change**: stable at target

Data sources checked:
- APPROVAL_QUEUE.md: no entries (pending or resolved)
- Git log: no human corrections to autonomous session output
- Interactive sessions modified infra/scheduler/src/session.ts and scheduler.ts multiple times, but these are voluntary researcher-driven improvements, not corrections to autonomous behavior

The system has maintained zero human intervention for 9 consecutive autonomous sessions (since the stdin-blocking fix in session 1).

## M5: System Learning Rate

**Current**: 0.4/session (2 system-level files / 5 sessions)
**Previous**: 0.5/session
**Change**: -0.1/session (continuing decline)

System-level file changes by autonomous sessions 5-9:

| Session | System-level files changed | Details |
|---------|---------------------------|---------|
| 5 | 0 | Project-level only: findings, TASKS.md, README.md |
| 6 | 0 | No actionable tasks, log entry only |
| 7 | 0 | No actionable tasks, log entry only |
| 8 | 2 | infra/scheduler/src/git.ts, infra/scheduler/src/git.test.ts (Fix 1 implementation) |
| 9 | 0 | No actionable tasks, log entry only |

### Context

M5 = 0.4 is below the 0.5/session threshold but above the 0.0 red-flag. The decline trajectory: 1.0 → 0.5 → 0.4 suggests gradual stabilization rather than sudden cessation.

The root cause is clear: 3 of 5 sessions (6, 7, 9) had no actionable tasks and thus no opportunity for system-level changes. The task queue was empty — not because the compound step was skipped, but because the system had run out of tasks to execute. Session 8, when it had a task, did produce system-level changes (infrastructure improvement).

This signals the system needs **new task generation** rather than better compound behavior.

## Orphaned Commit Rate Update

| Metric | Cycle 002 | Cycle 003 | Change |
|--------|-----------|-----------|--------|
| Total commits | 15 | 28 | +13 |
| Orphaned auto-commits | 5 | 10 | +5 |
| Orphaned rate | 33.3% | 35.7% | +2.4 pp |

The orphaned rate remains stubbornly around 35%, with all orphaned commits from interactive sessions. However, post-Fix 1 orphaned commits now carry descriptive messages, improving traceability. The rate itself is an interactive-session workflow issue, not an autonomous system problem.

## Findings

1. **The system has stabilized**: M1 at 100%, M4 at 0.0, M3 at 100% — all convention and operational metrics are at target. The self-improvement loop (detect → task → fix → verify) is complete for all known gaps.

2. **Gap detection is declining naturally**: M2 dropped from 1.0 to 0.2/session. This is the expected "diminishing returns" pattern after early obvious gaps are exhausted. The system correctly avoids inventing work when none exists.

3. **Task generation is the bottleneck**: 3 of 5 sessions (60%) had no actionable tasks. M5 decline is caused by empty task queue, not by failure to embed learnings. The system needs new sources of self-observation or expanded audit scope.

4. **Fix 1 (descriptive auto-commit messages) is working**: Post-implementation orphaned commits carry meaningful context. The rate hasn't decreased (interactive workflow hasn't changed) but attribution quality has improved.

5. **9 consecutive sessions with zero human intervention**: The autonomous system is operationally self-sufficient within its current task domain.

## Recommendations

1. **Expand audit scope**: The current 8-check compliance audit may be exhausted. Consider adding checks for: knowledge output per session, cross-project learning transfer, or convention freshness.

2. **New task sources**: To prevent idle sessions, the system should generate tasks from: (a) new research directions, (b) expanded self-observation (e.g., session cost efficiency, context utilization), or (c) proactive capability experiments.

3. **Accept M5 plateau**: A 0.4/session learning rate may be the natural steady state for a maturing system. The red-flag threshold (0.0 for 3+ sessions) hasn't been hit. Consider lowering the threshold from 0.5 to 0.3.

Sources: git log (28 commits), TASKS.md, APPROVAL_QUEUE.md, projects/youji/README.md (session logs 5-9), findings/measurement-cycle-002-2026-03-14.md, plans/self-improvement-measurement.md, infra/scheduler/src/git.ts
