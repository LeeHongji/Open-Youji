# Self-Improvement Measurement

Date: 2026-03-14
Project: youji
Type: adapted plan

## Goal

Define concrete metrics for whether an autonomous research system is improving itself over time.

The key question is not just whether the system completes tasks. It is whether the system can:

1. identify gaps from its own operational data
2. implement changes that address those gaps
3. measure whether the changes worked
4. require less human intervention per unit of useful work over time

## Suggested metrics

### M1: Gap Detection Rate

How often does the system generate diagnosis or postmortem artifacts from its own operations?

Possible signals:
- diagnosis files
- postmortem files
- explicit convention-drift findings

Formula:

`gap_artifacts / sessions` over a rolling time window.

### M2: Closure Rate

What fraction of self-detected gaps lead to implemented fixes or concrete follow-up tasks?

Possible signals:
- diagnosis files linked to code/doc/convention changes
- postmortems linked to fixes
- tasks created from detected failures and later completed

Formula:

`gaps_with_fixes_or_tasks / total_gaps_detected`

### M3: Improvement Effectiveness

Do the fixes measurably improve the metric they were meant to affect?

Examples:
- fewer repeated failures after a guardrail is added
- lower intervention rate after a workflow is stabilized
- higher commit/log compliance after convention changes

Formula:

`improvements_with_positive_delta / improvements_measured`

### M4: Human Intervention Rate

How much explicit human action is needed per session?

Possible signals:
- approval queue entries
- direct human correction commits
- manual recovery operations

Formula:

`intervention_events / sessions`

### M5: System-Learning Rate

How often do sessions embed learnings back into the system itself?

Possible signals:
- skill updates
- convention updates
- new decision records
- infrastructure changes triggered by diagnoses rather than external feature requests

Formula:

`system_level_improvements / sessions`

## Baseline experiment shape

1. identify the operational records already available in the repo
2. compute an initial baseline for the metrics above
3. repeat on a fixed cadence
4. compare trends rather than relying on one-off anecdotes

## Notes

This file is adapted from the OpenAkari meta-project's self-improvement measurement plan. The metrics are general enough to apply to any repo-as-brain system. Youji-specific denominators (session counts, artifact locations) should be grounded in actual operational data once sufficient sessions have accumulated.
