# Self-Improvement Measurement Plan

Date: 2026-03-14
Project: youji
Type: measurement plan (Youji-specific)
Status: active

## Goal

Measure whether Youji is improving itself over time. The four capabilities being measured:

1. Identifying gaps from operational data
2. Implementing changes that address those gaps
3. Measuring whether changes worked
4. Requiring less human intervention per unit of useful work

## Metrics

### M1: Convention Compliance Rate

**What**: Fraction of convention checks passing in self-audits.

**Data source**: `projects/youji/diagnosis/compliance-audit-*.md` files. Each audit contains a summary table with pass/warn/fail per check.

**Computation**:
```
compliance_rate = passing_checks / total_checks
```

**Collection**: Run `/self-audit` at least once per 5 sessions. Compare rates across audits.

**Baseline (2026-03-14)**: 6/8 = 75% (first audit, 2 sessions examined).

**Improving means**: Rate trends upward. New checks may be added over time (expanding the denominator), so a steady rate with more checks also counts as progress.

### M2: Gap Detection Rate

**What**: How often does the system identify its own operational problems?

**Data source**: Count new artifacts per session in:
- `projects/youji/diagnosis/*.md` (excluding example templates)
- Tasks in TASKS.md created with self-referential "Why:" (contains words: self-audit, mission gap, compliance, diagnosis, operational)

**Computation**:
```
gap_detection_rate = (new_diagnosis_files + self_generated_tasks) / sessions_in_window
```
To count sessions: each `git push` from an autonomous session represents one session. Count pushes in the time window via `git log --oneline | grep -v "auto-commit"` grouped by session boundaries (clusters of commits separated by >1 hour).

**Collection**: Compute at each self-audit.

**Baseline (2026-03-14)**: 1 audit + 2 self-generated tasks across ~4 sessions = 0.75/session.

**Improving means**: Rate stays above 0.5/session. A declining rate after early sessions is expected (fewer obvious gaps remain). Zero detection for 5+ sessions is a red flag.

### M3: Gap Closure Rate

**What**: Fraction of detected gaps that lead to implemented fixes.

**Data source**: Track lifecycle of each gap:
1. **Detected**: diagnosis file created, or self-audit violation logged
2. **Task created**: corresponding task in TASKS.md
3. **Fixed**: task marked `[x]` with "Done:" description

Gaps are identified from `diagnosis/compliance-audit-*.md` violation sections and any `diagnosis/*.md` finding sections.

**Computation**:
```
closure_rate = gaps_with_completed_fix / total_gaps_detected
```

**Collection**: Compute at each self-audit.

**Baseline (2026-03-14)**: 2 violations detected, 1 fixed (infra-only logging convention), 1 accepted as exception (monolithic init). Closure rate: 1/2 = 50% (or 2/2 = 100% if accepted exceptions count as resolved).

**Improving means**: Rate stays above 70%. Gaps that persist for >5 sessions without a fix or explicit acceptance are failures.

### M4: Human Intervention Rate

**What**: How much explicit human action is needed per session?

**Data source**:
- `APPROVAL_QUEUE.md` — entries moved to "Resolved" (each = 1 intervention event)
- `git log --format="%an %s"` — commits by a human author (not by claude/autonomous sessions)
- Direct researcher corrections identifiable from commit messages or APPROVAL_QUEUE

**Computation**:
```
intervention_rate = intervention_events / sessions_in_window
```

**Collection**: Compute at each self-audit. Requires distinguishing human commits from autonomous commits — use commit message patterns ("auto-commit:", "feat:", "fix:" from autonomous sessions vs. manual commits).

**Baseline (2026-03-14)**: 0 human interventions across ~4 sessions = 0.0/session. (Note: the researcher set up the initial repo and scheduler — this counts as infrastructure, not intervention. Intervention means correcting autonomous behavior.)

**Improving means**: Rate stays below 0.2/session. A rate above 0.5 means the system is creating more work for the researcher than it saves.

### M5: System Learning Rate

**What**: How often do sessions embed improvements back into the system itself (not just project artifacts)?

**Data source**: Count per session of changes to system-level files:
- `docs/conventions/*.md` — convention updates
- `.claude/skills/*/SKILL.md` — skill updates
- `decisions/*.md` — new decision records
- `infra/scheduler/src/*.ts` — infrastructure improvements
- `CLAUDE.md` — operating manual updates

**Computation**:
```
learning_rate = system_level_changes / sessions_in_window
```
Count distinct files changed (not commit count) in system-level paths per session.

**Collection**: Compute at each self-audit.

**Baseline (2026-03-14)**: Session 1 (init) created all system files (bootstrapping, excluded). Sessions 2-4: output capture (1 infra change), self-audit (1 diagnosis), convention fix (1 convention change) = ~1.0 system change/session.

**Improving means**: Rate stays above 0.5/session. A session that only produces project artifacts without any system-level learning is a missed compound opportunity.

## Collection cadence

| Metric | Trigger | Minimum cadence |
|--------|---------|-----------------|
| M1: Compliance | `/self-audit` | Every 5 sessions |
| M2: Detection | At self-audit | Every 5 sessions |
| M3: Closure | At self-audit | Every 5 sessions |
| M4: Intervention | At self-audit | Every 5 sessions |
| M5: Learning | At self-audit | Every 5 sessions |

All metrics piggyback on the self-audit skill, which already reads git history, diagnosis files, and convention documents. No separate collection infrastructure needed.

## Interpretation framework

| Signal | Meaning |
|--------|---------|
| M1 rising, M2 falling | System is stabilizing — fewer new gaps found, existing conventions improving |
| M1 stable, M2 rising | New convention areas being audited — healthy expansion |
| M3 < 50% | Gap detection without follow-through — orient/task generation may be broken |
| M4 rising | System is becoming less autonomous — investigate root cause |
| M5 = 0 for 3+ sessions | Compound step being skipped — sessions are task-completing but not learning |

## Notes

Adapted from OpenAkari meta-project measurement plan. Grounded in Youji's actual data sources: git log, diagnosis files, TASKS.md, APPROVAL_QUEUE.md, and convention/skill/infra file paths. Baselines computed from the first ~4 autonomous sessions (2026-03-14).

All metrics use sessions as the denominator. Session boundaries are determined from git log (clusters of commits separated by >1 hour gap). The init session (commit 4930053) is excluded from baselines as a bootstrapping event.
