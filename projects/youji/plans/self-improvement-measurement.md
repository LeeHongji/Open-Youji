# Self-Improvement Measurement Plan (Repo-Specific)

Date: 2026-03-19
Project: youji
Type: plan
Supersedes: generic self-improvement-measurement template (2026-03-08)

## Goal

Define concrete, computable metrics for whether this Youji deployment is improving itself over time, using data sources that already exist in the scheduler infrastructure.

The self-improvement loop has four stages:
1. **Detect** — identify gaps from operational data
2. **Act** — implement changes that address those gaps
3. **Embed** — encode learnings back into the system (skills, conventions, decisions)
4. **Verify** — measure whether the changes worked

Each metric below maps to one or more stages and specifies the exact data source and computation.

## Metrics

### M1: Gap Detection Rate

**Stage**: Detect
**Question**: How often does the system identify its own failure modes from operational evidence?

**Data source**: `.scheduler/metrics/sessions.jsonl`
- Field: `knowledge.diagnosesCompleted` — counts new diagnosis/postmortem files per session
- Field: `qualityAudit.auditFindings` — counts audit issue lines discovered per session

**Formula**:

```
gap_detection_rate = sessions_with_(diagnosesCompleted > 0 OR auditFindings > 0) / total_sessions
```

**Computation window**: rolling 7-day periods.

**Baseline target**: Establish initial value from first 50 sessions. A healthy system should detect at least 1 gap per 20 sessions (5%).

**Why this works here**: Youji already counts diagnosis artifacts and audit findings per session in structured JSONL. No new instrumentation needed.

### M2: Human Intervention Rate

**Stage**: Detect + Verify
**Question**: How much explicit human effort is needed per unit of agent work?

**Data sources**:
1. `.scheduler/metrics/interactions.jsonl`
   - Field: `userCorrected` (boolean) — user had to rephrase or correct the system
   - Field: `intentFulfilled` — whether the interaction succeeded ("fulfilled" | "partial" | "failed" | "abandoned")
2. `APPROVAL_QUEUE.md` — count of pending approval items (git diff to track additions/removals)
3. `.scheduler/metrics/sessions.jsonl` — total session count as denominator

**Formula**:

```
intervention_rate = (correction_interactions + failed_interactions + new_approval_items) / total_sessions
```

Where:
- `correction_interactions` = interactions where `userCorrected === true`
- `failed_interactions` = interactions where `intentFulfilled === "failed"`
- `new_approval_items` = new entries added to APPROVAL_QUEUE.md (via git diff)

**Computation window**: rolling 7-day periods, compared across consecutive windows.

**Baseline target**: Establish initial value. Decreasing trend over 3+ windows signals improving autonomy.

**Why this works here**: The interaction logger already tracks correction and fulfillment signals. Approval queue is a git-native artifact that captures governance interventions.

### M3: Self-Embedding Rate

**Stage**: Embed
**Question**: How often do sessions encode learnings back into the system itself (skills, conventions, infrastructure)?

**Data source**: `.scheduler/metrics/sessions.jsonl`
- Field: `knowledge.compoundActions` — counts changes to governance files: CLAUDE.md, skills, decisions, patterns, SOPs
- Field: `knowledge.infraCodeChanges` — counts changes to scheduler/infrastructure code
- Field: `knowledge.newDecisionRecords` — counts new ADRs

**Formula**:

```
self_embedding_rate = sessions_with_(compoundActions > 0 OR infraCodeChanges > 0) / total_sessions
```

**Computation window**: rolling 7-day periods.

**Baseline target**: Establish initial value from first 50 sessions. A system that never embeds learnings (rate near 0%) is not self-improving regardless of other metrics.

**Why this works here**: `compoundActions` was designed specifically to track system-level changes vs. regular project work. It distinguishes "the system changed itself" from "the system did normal tasks."

### M4: Findings Yield

**Stage**: Verify (overall productivity)
**Question**: Is the system producing more knowledge per unit of compute over time?

**Data source**: `.scheduler/metrics/sessions.jsonl`
- Fields: `knowledge.newExperimentFindings`, `knowledge.logEntryFindings` — knowledge output
- Field: `durationMs` — wall-clock compute time (the true scarce resource)

**Formula**:

```
findings_yield = (newExperimentFindings + logEntryFindings) / (sum(durationMs) / 3_600_000)
```

Unit: findings per compute-hour.

**Computation window**: rolling 7-day periods.

**Baseline target**: The health watchdog already tracks `findings_per_dollar` with a baseline of 1.29 f/$. This metric replaces the dollar denominator with compute-hours, which is the actual constraint under Claude Agent SDK (no per-token billing). Establish the time-based baseline from the first 50 sessions.

**Why this works here**: Findings and duration are already captured per session. The shift from cost to time aligns with the SDK billing model (decisions/0027 notes time-based accounting).

## Excluded Metrics

### Closure Rate (generic M2)

The generic plan's "closure rate" (gaps with fixes / total gaps) requires manual linking between diagnosis files and subsequent fix commits. This cross-artifact tracing is not yet automated in the scheduler. **Revisit after implementing structured diagnosis→fix references.**

### Improvement Effectiveness (generic M3)

Requires before/after measurement of the specific metric a fix was meant to affect. This is the highest-value metric but also the hardest to automate — it needs per-fix hypothesis tracking. **Revisit as a future experiment when M1-M4 baselines are stable.**

## Data Collection

All four metrics can be computed from two existing JSONL files with no new instrumentation:

| Metric | Primary File | Key Fields |
|--------|-------------|------------|
| M1: Gap Detection Rate | sessions.jsonl | `knowledge.diagnosesCompleted`, `qualityAudit.auditFindings` |
| M2: Intervention Rate | interactions.jsonl + sessions.jsonl | `userCorrected`, `intentFulfilled`, session count |
| M3: Self-Embedding Rate | sessions.jsonl | `knowledge.compoundActions`, `knowledge.infraCodeChanges` |
| M4: Findings Yield | sessions.jsonl | `knowledge.newExperimentFindings`, `knowledge.logEntryFindings`, `durationMs` |

## Computation Approach

1. **Baseline**: Compute M1-M4 over the first available 7-day window with ≥10 sessions
2. **Trend**: Recompute weekly; store results as analysis files in `projects/youji/analysis/`
3. **Alerting**: The health watchdog already monitors findings_per_dollar and orient_overhead. Extend watchdog signals to include M1 and M3 when baselines are established
4. **Comparison**: Plot each metric across consecutive windows; a self-improving system shows M1 stable or rising, M2 falling, M3 stable or rising, M4 rising

## Success Criteria

The measurement plan is useful if:
- All four metrics are computable from existing data (no new instrumentation)
- Baselines can be established within the first week of operation
- At least one metric shows a measurable trend (positive or negative) within 3 weeks
- The metrics surface at least one actionable insight that leads to a system change

## Relationship to Health Watchdog

The health watchdog (`infra/scheduler/src/health-watchdog.ts`) already computes a ReadinessScore from 5 signals. The metrics here are complementary:

| Watchdog Signal | Measurement Plan Metric | Overlap |
|----------------|------------------------|---------|
| `findings_per_dollar` | M4: Findings Yield | Same numerator, different denominator ($ vs. hours) |
| `orient_overhead` | — | Not directly measured here (orient efficiency, not self-improvement) |
| `quality_regression` | M1: Gap Detection Rate | Quality regression triggers gap detection |
| `budget_drift` | — | Resource constraint, not self-improvement signal |
| `cross_project_miss_rate` | — | Coordination metric, not self-improvement signal |

The watchdog measures "is the system healthy enough to operate?" These metrics measure "is the system getting better at operating?"
