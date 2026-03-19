# 0066: Count-Based Log Retention for Project READMEs

Date: 2026-03-07
Status: accepted
Amends: ADR 0020 Convention 2

## Context

ADR 0020 established two log retention rules for project READMEs:
1. Archive when the log section exceeds ~150 lines
2. Retain the "most recent 2-3 days" of entries

These rules were written when projects generated ~5-10 log entries/day. With fleet
scaling (N=4-16 workers), the youji project now generates ~56 entries/day (728
lines/day). At this rate:

- The 150-line threshold is exceeded in ~5 hours
- "2-3 days" retention = 1,500-2,200 lines (10-15x over threshold)
- The two rules directly contradict each other

A de facto "5-entry limit" has already emerged across projects — fleet workers
routinely archive entries to maintain this threshold (see commits 5b96e8e8,
e9726b3d, 5317659b, e1887a0d, f1d142c0). This ADR codifies the emergent practice
and resolves the ADR 0020 contradiction.

### Analysis

The youji README reached 2,262 lines (168 entries, 98.3% log content) on
2026-03-07. Root cause: 137 fleet worker entries on 2026-03-06 alone. See
`projects/youji/analysis/log-entry-growth-analysis-2026-03-07.md` for full data.

Options considered:
- **Time-based retention** (status quo): Incompatible with high-volume fleet operation
- **Line-based threshold only**: Doesn't specify how many entries to keep
- **Count-based retention**: Simple, fleet-proof, already emerging in practice

## Decision

Replace ADR 0020 Convention 2's retention rule with count-based retention:

### Rule: Keep ≤5 log entries in README

- **Maximum entries**: 5 most recent log entries retained in the README `## Log` section
- **Archive trigger**: When entry count exceeds 5, archive oldest entries to `log/`
- **Archive format**: Unchanged — `log/YYYY-MM-DD-slug.md` per ADR 0020
- **Batch archival**: When archiving, move all excess entries in a single commit
  (not one commit per entry). Use `log/YYYY-MM-DD-archive-batchNN.md` for multi-entry
  archives, following the existing naming pattern.

### Why 5

- Provides 1-2 sessions of context for orient/task-selection (sessions read recent
  log to understand momentum)
- At 13 lines/entry average, 5 entries = ~65 lines — well under the 150-line threshold
- Already the de facto standard across 5+ projects
- Small enough to keep README navigable; large enough to show recent activity pattern

### What this changes

| Aspect | ADR 0020 (before) | ADR 0066 (after) |
|--------|-------------------|-------------------|
| Retention metric | Time (2-3 days) | Count (≤5 entries) |
| Archive trigger | ~150 lines | >5 entries |
| Archive format | Unchanged | Unchanged |
| Naming convention | Unchanged | Unchanged |

The 150-line threshold from ADR 0020 remains as a secondary safety net — if 5
entries somehow exceed 150 lines (e.g., unusually long entries), archive sooner.

## Consequences

### Positive

- **Fleet-proof**: Count-based retention works regardless of entry volume
- **Codifies practice**: Aligns written convention with de facto fleet worker behavior
- **Predictable README size**: 5 entries × 13 lines = ~65 lines of log, keeping
  READMEs under the ~200 line target from ADR 0020
- **Reduces archival churn**: Clear threshold eliminates ambiguity about when to archive

### Negative

- **Less history in README**: During high-volume periods, 5 entries may cover only
  a few hours rather than days. Sessions needing deeper history must check `log/`.
- **Archival frequency increases**: At 56 entries/day, archival happens ~11 times/day.
  Fleet workers already handle this, so marginal cost is low.

### Not addressed

- **Fleet entry compression** (daily summaries instead of per-session entries):
  This would reduce volume at the source but requires fleet scheduler changes.
  Deferred — may be worth pursuing if archival frequency becomes excessive.
- **Automated archival enforcement** (pre-commit hooks or scheduler tasks):
  Valuable but requires infra code. Out of scope for this convention change.
