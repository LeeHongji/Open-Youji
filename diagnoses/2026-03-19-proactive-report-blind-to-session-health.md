# Diagnosis: Proactive Report Is Blind to Session Health

**Date:** 2026-03-19
**Severity:** Medium
**Component:** `infra/scheduler/src/proactive-report.ts`, `infra/scheduler/src/service.ts`

## Failure Observed

The proactive reporting system — Youji's only self-observation mechanism that runs without human prompting — cannot detect session-level failures, timeouts, or degradation. It observes task counts and budget usage but has zero visibility into whether sessions are actually succeeding.

## Evidence

### 1. `ProjectSnapshot` omits all session health data

`proactive-report.ts:9-20` defines the snapshot interface:

```typescript
export interface ProjectSnapshot {
  project: string;
  completedTasks: number;    // from TASKS.md
  openTasks: number;         // from TASKS.md
  blockedTasks: number;      // from TASKS.md
  inProgressTasks: number;   // from TASKS.md
  activeWorkers: number;     // passed by caller
  pendingApprovals: number;  // from APPROVAL_QUEUE
  computeMinutesUsed: number; // from metrics (duration only)
  computeMinutesLimit: number; // from budget file
  budgetExceeded: boolean;   // derived
}
```

No fields for: session success rate, error count, timeout count, recent errors, L2 violations, stall violations, or duration trends. The snapshot reads `getProjectDailyMinutes()` from the JSONL but only extracts aggregate duration — it discards every other field.

### 2. Session metrics are collected but never consumed by the observation loop

`metrics.ts` defines rich `SessionMetrics` with 30+ fields including `ok`, `error`, `timedOut`, `verification.l2ViolationCount`, `verification.stallViolationCommand`, and `worktreeMergeResult`. These are faithfully written to `.scheduler/metrics/sessions.jsonl` via `recordMetrics()`.

However, `buildProjectSnapshot()` (the only function called by the hourly proactive check in `service.ts:338-368`) calls only `getProjectDailyMinutes()`, which sums `durationMs` and returns a single number. The rich session data is written and never read back for observation purposes.

### 3. `auto-diagnose.ts` and `session-autofix.ts` are imported but don't exist

`cli.ts:66` imports `diagnoseSession` from `./session-autofix.js` and `cli.ts:79` imports `triggerAutoDiagnosis` from `./auto-diagnose.js`. Neither file exists in `infra/scheduler/src/`. This means the intended auto-diagnosis pipeline — which would have consumed session metrics — was wired into the CLI but never implemented.

### 4. `hasChanged()` can't detect health degradation

`proactive-report.ts:89-104` detects changes by comparing task counts, worker count, approvals, and budget status. A scenario where all 10 of today's sessions fail with errors would produce no change signal — tasks stay the same, budget ticks up normally, workers respawn, and the hourly report says nothing.

## Impact

- **Silent failure cascades:** Workers can fail repeatedly without any Slack notification. The human mentor sees "3 open, 0 blocked" but doesn't know those 3 tasks have failed 5 times each.
- **Wasted compute budget:** Sessions that timeout or error still consume budget minutes. Without health visibility, the system burns budget on a broken task without alerting anyone.
- **No degradation trend detection:** Gradual performance decline (rising duration, falling success rate) is invisible until tasks stop completing entirely.
- **Diagnosis infrastructure gap:** The `KnowledgeMetrics.diagnosesCompleted` counter exists to track diagnosis artifacts, but the auto-diagnosis pipeline (`auto-diagnose.ts`) that would generate them is unimplemented.

## Proposed Fix

**Extend `ProjectSnapshot` with session health fields** and have `buildProjectSnapshot()` query recent session metrics:

```typescript
// Add to ProjectSnapshot:
recentSessionCount: number;       // sessions in last reporting window
recentFailureCount: number;       // sessions where ok === false
recentTimeoutCount: number;       // sessions where timedOut === true
avgSessionDurationMs: number;     // mean duration for trend detection
lastError: string | undefined;    // most recent error message
l2ViolationTotal: number;         // sum of L2 violations in window
```

**Update `hasChanged()`** to trigger on health degradation (e.g., failure rate > 50%, new timeouts, L2 spikes).

**Update `formatProactiveReport()`** to surface health signals in Slack:
- `:warning: 3/5 sessions failed in last hour`
- `:hourglass: 2 sessions timed out`
- `:rotating_light: Last error: "merge conflict on main"`

## Follow-Up Tasks

1. Implement the `ProjectSnapshot` extension described above.
2. Implement `auto-diagnose.ts` — the CLI already expects it.
3. Implement `session-autofix.ts` — the CLI already expects it.
4. Add a `hasHealthDegraded()` function that triggers outside the normal `hasChanged()` cycle for urgent alerts (e.g., 3 consecutive failures → immediate DM, don't wait for hourly check).
