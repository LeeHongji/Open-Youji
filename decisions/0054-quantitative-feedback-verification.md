# 0054: Quantitative Feedback Verification

Date: 2026-03-02
Status: accepted

## Context

PI gave clear quantitative feedback: "fleet should reach ≥75% utilization and maintain
it constantly" (ADR 0047, March 1). One day later, actual utilization was 16.5% — a
massive gap. The system had responded to the feedback by writing policy (ADR 0047),
updating conventions (orient skill), and adding alerts (starvation notifications). But
none of these mechanisms verified whether the target was actually being met.

This is a recurring pattern: feedback with clear quantitative objectives produces policy
artifacts but not results. The system writes rules and trusts future sessions to follow
them, without closing the feedback loop. When compliance is L2 (convention-only), it
erodes to zero.

Root cause incident: "Monitor fleet at N=8 for 48 hours" task caused fleet gridlock —
156 consecutive zero-output sessions because every worker picked up an uncompletable
time-gated task. See `diagnosis-fleet-gridlock-on-time-gated-task-2026-03-02.md`.

## Decision

When PI feedback includes a quantitative target, the system must create **both**
a policy change and a verification mechanism. Verification must be L0 (code-enforced)
whenever feasible.

### Required response to quantitative feedback

1. **Policy**: Write ADR, update convention, change code — as before.
2. **Measurement**: Implement code that measures the metric. The metric must be
   computable from existing data (sessions.jsonl, git history, task files).
3. **Alert**: Wire the measurement to an alert that fires when the metric is
   outside the target range. This closes the feedback loop — a human or an
   orient session sees the gap and can act on it.
4. **Baseline**: Record the metric value at the time of the policy change.
   Without a baseline, there's no way to verify whether the change helped.

### For fleet utilization specifically

The fleet scheduler should:
- Track compute-time utilization: `sum(worker_duration_ms) / (calendar_time_ms × maxWorkers)`
- Expose utilization in the fleet status snapshot (already has FleetMetricsTracker)
- Alert when rolling 1-hour utilization drops below the configured target
- Include the top reason for idle time in the alert (no tasks, all claimed, all
  on cooldown, etc.)

### Enforcement layer update

Add to L0 table in CLAUDE.md:

| Convention | Enforcer | Location |
|------------|----------|----------|
| Quantitative feedback verification | `/feedback` skill check | During feedback processing |

The `/feedback` skill must check: if the feedback contains a number + comparison
operator (≥, ≤, >, <, at least, at most), classify as quantitative and require
a verification mechanism as part of the fix.

## Consequences

- Future quantitative feedback will produce measurable outcomes, not just policy
- Fleet utilization will have L0 alerting, preventing silent degradation
- The `/feedback` skill gains a verification step for quantitative targets
- Adds implementation work: fleet utilization tracking and alerting
