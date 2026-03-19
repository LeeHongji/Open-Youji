# 0023: Incremental Analysis Throttling

Date: 2026-02-20
Status: accepted

## Context

The full-scale-flash-240 experiment (1428 API calls, ~2.3h runtime) produced results
incrementally. Between 2026-02-19 17:35 and 2026-02-20 08:06, **14 consecutive autonomous
sessions** each selected the "Analyze full-scale-flash-240 results" task, processing
~30-100 new rows per session and updating the same findings with small numerical shifts.

The first 2-3 analyses (222→485 rows) produced genuinely novel findings: trimodal vote
distribution breaking, ranking instability, position bias improvement. Sessions 4-14
produced near-zero marginal knowledge — ±1-3pp oscillations on established metrics with
no new structural insights. The system spent ~3.5 hours of agent time on incremental
refinement that a single final analysis would have captured.

Three system factors enabled this loop:

1. **Task design**: The analysis task had a `Done when` condition achievable only at
   experiment completion. It remained `[ ]` indefinitely, making it perpetually eligible.
2. **Orient's "momentum" criterion**: The `/orient` skill gives a bonus to tasks with
   recent work. This turned from "help complete multi-session work" into "always pick
   the most recently touched task."
3. **No diminishing-returns detection**: Neither the orient skill nor the SOP had any
   mechanism to detect that the same task was being selected repeatedly with declining
   marginal value.

## Decision

Three changes to prevent analysis loops on incomplete experiments:

### 1. Incremental analysis throttling convention (CLAUDE.md + SOP)

When analyzing results from a running experiment, apply **checkpoint discipline**:

- Analyze at most at these checkpoints: ~25% (early signal), ~50% (midpoint), ~75%
  (convergence check), and 100% (final). The exact rows don't matter — the principle
  is ≤4 analyses total, not continuous monitoring.
- After an intermediate analysis, **mark the task with the checkpoint reached** and
  add a note like "Next analysis at ~N rows or completion." This makes the throttle
  visible to future sessions.
- If fewer than 20% new rows have accumulated since the last analysis, skip the task
  and select something else. The marginal information from <20% new data is almost
  never worth a full session.

### 2. Anti-looping heuristic in /orient

Add to the orient skill's ranking algorithm: **repetition penalty**. When a task
appears in the README log as "Task-selected" in 3+ of the last 5 log entries, flag it
with a warning: "This task has been selected N times in the last M sessions. Check
for diminishing returns before selecting it again."

The orient skill should then prefer an alternative task unless the repeated task has
genuinely new preconditions (e.g., experiment just completed, blocker removed).

### 3. Task design convention: split long-running analysis tasks

When creating an analysis task for a running experiment, split it into:
- "Run preliminary analysis at ~50% completion" — satisfiable mid-experiment
- "Run final analysis on completion" — blocked-by the experiment finishing

This ensures the preliminary analysis can be marked `[x]` and won't loop.

## Consequences

- Autonomous sessions will no longer spend >4 sessions analyzing the same running
  experiment. The throttling convention sets an explicit upper bound.
- The anti-looping heuristic provides a soft guardrail at the orient level: it doesn't
  block repeated selection but raises visibility of the pattern.
- Task design guidance prevents the root cause: monolithic analysis tasks with
  unsatisfiable intermediate Done-when conditions.
- Existing convention 0017 (fire-and-forget) addressed experiment *launching*; this
  decision addresses experiment *analysis*. Together they form a complete lifecycle
  convention: submit → forget → analyze at checkpoints → finalize at completion.
