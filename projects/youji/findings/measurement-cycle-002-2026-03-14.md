# Measurement Cycle 002: Self-Improvement Metrics

Date: 2026-03-14
Type: measurement cycle
Sessions measured: autonomous sessions 3-4 (plus system-wide observations)
Reference: plans/self-improvement-measurement.md
Previous cycle: diagnosis/compliance-audit-2026-03-14.md (baseline)

## Summary

| Metric | Baseline | Current | Trend | Status |
|--------|----------|---------|-------|--------|
| M1: Compliance | 75% | 100% | up | Improving |
| M2: Detection | 0.75/s | 1.0/s | up | Healthy |
| M3: Closure | 50-100% | 67% | stable | Acceptable |
| M4: Intervention | 0.0/s | 0.0/s | stable | At target |
| M5: Learning | 1.0/s | 0.5/s | down | Watch |

Interpretation (per framework): M1 rising + M2 stable = "System is stabilizing — fewer new gaps found, existing conventions improving." This matches observed behavior: the convention gap from session 2 was fixed, no new violations emerged.

## M1: Convention Compliance Rate

**Current**: 8/8 = 100%
**Baseline**: 6/8 = 75%
**Change**: +25 percentage points

### Convention checks (sessions 3-4)

| Check | Status | Evidence |
|-------|--------|----------|
| Log entry completeness | PASS | Both sessions have README log entries citing source files |
| Inline logging discipline | PASS | Sessions produce 3-4 incremental commits each, not monolithic |
| Commit message quality | PASS | All commits use conventional format (fix:, feat:, docs:) with descriptive messages |
| Decision records | PASS | No architectural decisions requiring ADRs were made |
| Provenance | PASS | All findings cite sources; README log entries reference specific files |
| Session discipline | PASS | Orient -> work -> incremental commit -> log -> push cycle followed |
| Task lifecycle | PASS | Tasks marked done with "Done:" descriptions and evidence |
| File organization | PASS | All files in correct project directories per CLAUDE.md structure |

### Note on orphaned auto-commits

Two orphaned auto-commits occurred between autonomous sessions (ad126ef, 6195a9e). These originate from interactive sessions leaving uncommitted scheduler changes — not from autonomous session discipline violations. See orphaned commit analysis below.

## M2: Gap Detection Rate

**Current**: 1.0/session (2 gaps across 2 sessions)
**Baseline**: 0.75/session
**Change**: +0.25/session

Gaps detected in sessions 3-4:
1. Orphaned commit attribution loss — diagnosis file created (session 4)
2. "Monitor orphaned commit rate" — self-generated monitoring task (session 4)

Both detections were in session 4. Session 3 focused on fixing previously detected gaps rather than finding new ones, which is expected behavior.

## M3: Gap Closure Rate

**Current**: 67% (2/3 gaps resolved)
**Baseline**: 50-100%
**Change**: stable

| Gap | Detected | Status |
|-----|----------|--------|
| Infra-only logging convention | Session 2 audit | Fixed (session 3, convention documented) |
| Monolithic init commit | Session 2 audit | Accepted as bootstrapping exception |
| Orphaned commit attribution loss | Session 4 diagnosis | Monitoring in progress |

The third gap has a monitoring task but no fix implemented yet. Per the measurement plan, gaps persisting >5 sessions without a fix or explicit acceptance are failures. This gap is at session 2 of monitoring — still within threshold.

## M4: Human Intervention Rate

**Current**: 0.0/session (sessions 3-4)
**Baseline**: 0.0/session (post-stdin-fix)
**Change**: stable at target

Data sources checked:
- APPROVAL_QUEUE.md: no entries (pending or resolved)
- Git log: no human corrections to autonomous session output
- The researcher made infrastructure enhancements (scheduler optimization, supervisor prompt tuning) via interactive sessions, but these are voluntary improvements, not interventions correcting failed autonomous behavior

## M5: System Learning Rate

**Current**: 0.5/session
**Baseline**: 1.0/session
**Change**: -0.5/session (declining)

System-level file changes by autonomous sessions:
- Session 3: docs/conventions/session-discipline.md (1 convention update)
- Session 4: 0 system-level files (all output was project-level: findings, diagnosis)

Total: 1 system-level change / 2 sessions = 0.5/session

### Context

The decline from 1.0 to 0.5 is expected: early sessions had obvious system gaps (missing conventions, missing logging). Session 4 focused on measurement and diagnosis artifacts which are project-level, not system-level per the measurement plan definition.

Notable: interactive sessions during this period produced significant system-level changes (scheduler optimization, supervisor prompt tuning, lightweight settings) that are not counted in M5 because they were researcher-initiated, not autonomous. The system is receiving improvements — just not all from autonomous sessions.

Per interpretation framework: M5 = 0 for 3+ sessions is the red-flag threshold. We are above that (0.5). If M5 drops to 0 in the next measurement cycle, investigate whether the compound step is being skipped.

## Orphaned Commit Rate Analysis

Additional analysis for the monitoring task in TASKS.md.

| Metric | Original (session 4) | Current | Change |
|--------|----------------------|---------|--------|
| Orphaned auto-commits | 4 | 5 | +1 |
| Total commits | 10 | 15 | +5 |
| Orphaned rate | 40% | 33.3% | -6.7 pp |

Breakdown by session type:
- **Autonomous sessions (2-4)**: 0 orphaned commits out of 7 meaningful commits = 0% orphaned
- **Interactive sessions**: 5 orphaned auto-commits, all from interactive sessions leaving uncommitted changes

**Finding**: The orphaned commit problem is isolated to interactive sessions, not autonomous ones. The auto-commit mechanism correctly catches uncommitted files, but interactive sessions (researcher + Youji collaborating) don't always commit incrementally. This is a workflow pattern of interactive usage, not a failure of the autonomous system.

**Implication for Fix 1 (descriptive auto-commit messages)**: Still worth implementing — even if autonomous sessions don't produce orphaned commits, the auto-commit mechanism would benefit from generating descriptive messages from diffs to preserve context for interactive session changes.

## Findings

1. **Convention compliance has fully recovered** from 75% to 100%. The two violations from the first audit (infra-only logging gap, monolithic init) are resolved.
2. **The system is self-improving measurably**: gap detection leads to fixes, which improve compliance scores.
3. **Human intervention remains at zero** for autonomous sessions — the system operates independently within its task domain.
4. **M5 (system learning) needs monitoring** — declining but not yet at red-flag levels. Future sessions should consciously look for opportunities to embed learnings into conventions, skills, or infrastructure.
5. **Orphaned commits are an interactive-session problem**, not an autonomous-session problem. The monitoring task's hypothesis (that it's a recurring autonomous issue) is refuted for the autonomous case.

Sources: git log, TASKS.md, APPROVAL_QUEUE.md, plans/self-improvement-measurement.md, diagnosis/compliance-audit-2026-03-14.md
