# 0031: Proactive self-evolution

Date: 2026-02-21
Status: accepted

## Context

The scheduler's self-evolution mechanism (`evolution.ts`) has existed since 2026-02-16 but has never fired in production. The mechanism is structurally sound — it validates, builds, and applies code changes proposed by agent sessions — but it depends on the `/compound` phase to *accidentally* notice scheduler improvement opportunities while wrapping up unrelated tasks. This is too high a bar: compound runs with context focused on the completed task, not on scheduler internals.

Evidence of the gap: On 2026-02-21, four monitoring systems (~2,200 lines of code + tests) were added by a human-triggered deep work session rather than through self-evolution. The PI observed that "90% of bugs are human-discovered." Since all youji work cycles are autonomous (no human triggers sessions), the system must be capable of identifying its own improvement needs.

Design tension: **autonomy requires proactive self-improvement, but the architecture only supported reactive self-improvement.**

## Decision

Enable proactive self-evolution through two complementary mechanisms:

### 1. Monitoring-to-task bridge (`health-tasks.ts`)

When monitoring systems (health-watchdog, anomaly-detection, warning-escalation, interaction-audit) detect issues, they now also create tasks in `projects/youji/TASKS.md`. This closes the reactive feedback loop: detected problems become work that autonomous sessions pick up through normal task selection.

Key properties:
- Tasks are deduplicated by source ID (`<system>:<checkId>`)
- Tasks have a 7-day TTL via `[detected: YYYY-MM-DD]` tag — prevents duplicate task creation while the issue persists
- Task priority maps from check severity (high → high, medium → medium)
- Runs at the same cadence as existing monitoring (every 6 or 12 hours)

### 2. Dedicated infrastructure review job (`infra-health-review`)

A weekly scheduled job (Monday 06:00 UTC) that specifically tasks an agent with reviewing scheduler health, examining source code, and proposing improvements via the existing `.pending-evolution.json` protocol.

This addresses the proactive gap: rather than depending on compound to notice scheduler improvements, a dedicated agent session periodically reviews the scheduler with fresh eyes. Precedent: `horizon-scan-weekly` applies the same pattern to external developments.

### 3. Evolution safety hardening

Added redundant test execution (`vitest run`) to `applyEvolution()`, alongside the existing redundant `tsc --noEmit` check. This ensures that even if an agent claims tests passed, the scheduler independently verifies before restarting.

## Consequences

- Detected problems now create actionable tasks, not just Slack notifications. Autonomous sessions will pick up monitoring-generated tasks through normal `/orient` → task selection flow.
- The scheduler has a dedicated periodic review, not just incidental compound-phase discovery. This makes the self-evolution path viable for the first time.
- All existing safety gates are preserved: scope restriction (files must be under `infra/scheduler/src/`), type checking, test execution, experiment tracking, and graceful drain.
- The monitoring-to-task bridge may produce tasks that agents find too vague. If this happens, the task templates in `health-tasks.ts` should be refined based on observed agent success rates.
- Risk: task spam from persistent issues. Mitigated by the 7-day TTL and source-based deduplication.
- Risk: the weekly infra review session may produce no useful output. This costs one session's worth of compute per week, which is acceptable given the potential for autonomous infrastructure improvement.
- Future work (deferred): autonomous diagnosis spawning from monitoring (Tier 3 in feedback-autonomous-issue-detection.md). This should wait until the task-based approach proves stable.
