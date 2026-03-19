# 0064: Skill Task Bridge Convention

Date: 2026-03-05
Status: accepted
Extends: 0060 (Actionable Implication Task Gate), 0062 (Skill-Typed Organization)

## Context

The fleet system (ADR 0042-v2, operational since 2026-03-01) changed youji's task
lifecycle dynamics. Pre-fleet, orient was both the primary task producer and the
gateway to task consumption. Task supply was adequate because the single autonomous
work cycle consumed tasks slowly.

With 16 GLM-5 workers consuming 6-10 tasks/hour, task production became the binding
constraint. Multiple diagnoses identified this supply deficit:
- `diagnosis-fleet-task-starvation-2026-03-01.md`
- `diagnosis-fleet-starvation-2026-03-03.md`
- `diagnosis-fleet-utilization-gap-2026-03-02.md`
- ADR 0053 (decomposition proposals dying in output)

The system responded with supply-side fixes focused on orient and compound:
- ADR 0047: orient supply generation obligation
- ADR 0053: decomposition writes directly to TASKS.md
- ADR 0062: "Opus as Task Factory" convention, GLM follow-ups

However, an architectural analysis (`architecture/architecture-skill-task-lifecycle-2026-03-05.md`)
revealed that **12 of 26 skills produce actionable recommendations that never become tasks**.
Skills like `/diagnose`, `/postmortem`, `/synthesize`, `/slack-diagnosis`, and `/architecture`
produce concrete actions (quick wins, prevention measures, improvement roadmaps, prioritized
fixes) — but these exist only in ephemeral session output or static report files. They never
enter the task pipeline for fleet consumption.

Conservative estimate: 55-85 actionable items per week from non-orient/compound skills.
At 30% fleet-eligible conversion rate, this represents 16-25 tasks/week — enough to sustain
2-3 fleet workers continuously.

ADR 0060 partially addresses this with an L0 check for actionable language in EXPERIMENT.md,
diagnosis, and postmortem files. But the L0 check is a safety net that fires at session end,
not a production mechanism. The better intervention point is at the skill level.

## Decision

### Tiered task bridge enforcement

Skills are classified into three tiers based on the actionability of their output:

**Tier 1: Task Bridge REQUIRED** — skills whose primary output includes concrete,
specific recommendations that are task-shaped (clear action, identifiable target,
verifiable done-when):

| Skill | Task source | Bridge added |
|-------|------------|--------------|
| diagnose | Quick wins, experiments needed | Yes |
| postmortem | Prevention actions | Yes |
| slack-diagnosis | Improvement roadmap items not fixed in-session | Yes |
| architecture | P1/P2 issues not fixed in-session | Yes |
| synthesize | Implications with concrete action verbs | Yes |

**Tier 2: Task Bridge RECOMMENDED** — skills whose output sometimes contains
actionable items but requires judgment:

| Skill | Task source | Bridge added |
|-------|------------|--------------|
| gravity | Migration plans for "formalize now" verdicts | Yes |
| critique | High-severity issues with concrete suggestions | Yes |

**Tier 3: Caller's responsibility** — skills invoked as sub-steps within larger
workflows where the calling skill handles task creation:

| Skill | Rationale |
|-------|-----------|
| review | Invoked during experiment workflow; parent session handles tasks |
| simplify | Invoked during compound or architecture; caller handles tasks |
| audit-references | Invoked during publish or review; caller handles tasks |
| refresh-skills | Niche; issues fed into next orient |
| report | Output artifact, not recommendations |

### Task bridge procedure (standard)

Each Tier 1 skill includes a "Task Bridge" step after saving output to disk:

1. For each actionable recommendation in the output:
   - Check TASKS.md for an existing task covering the same action
   - If no existing task, create one with fleet/skill tags and done-when
   - Reference the skill output file in the task's Why field
2. Skip recommendations that are purely observational, already implemented
   in-session, or informational context
3. Apply fleet-eligibility checklist per ADR 0045

Tier 2 skills include a softer "Task Bridge (recommended)" step with guidance
on when to create tasks vs. when to defer.

## Consequences

### Positive

- Task supply chain gains a new production source: ~16-25 fleet-eligible
  tasks/week from skill output, reducing fleet starvation episodes
- Diagnosis insights, postmortem prevention actions, and synthesis implications
  are acted upon rather than rediscovered in future sessions
- Consistent with ADR 0060's direction (observations about missing work must
  generate tasks) — extends the pattern from file-level to skill-level
- Low implementation cost: ~10 lines added per skill, ~30 seconds per invocation

### Negative

- Task inflation risk from mechanical conversion of all recommendations.
  Mitigation: deduplication check, skip observational items, orient prunes
  stale tasks
- Slight increase in skill execution time (~30 seconds for TASKS.md check
  and write). Mitigation: negligible compared to overall skill runtime
- Convention compliance drift on Tier 1 enforcement. Mitigation: ADR 0060's
  L0 check catches diagnosis/postmortem files without TASKS.md modification

### Migration

- [x] Added Task Bridge step to `/diagnose` SKILL.md
- [x] Added Task Bridge step to `/postmortem` SKILL.md
- [x] Added Task Bridge step to `/synthesize` SKILL.md (also added Save to disk and Commit)
- [x] Added Task Bridge step to `/slack-diagnosis` SKILL.md (Step 6b)
- [x] Added Task Bridge step to `/architecture` SKILL.md (Step 5b, Auto mode)
- [x] Added Task Bridge (recommended) to `/gravity` SKILL.md
- [x] Added Task Bridge (recommended) to `/critique` SKILL.md
- [ ] Extend ADR 0060 L0 check to architecture and synthesis report files
- [ ] Add `tasksCreated` metric to session recording for supply chain visibility
- [ ] Add `task-bridge` field to skill schema (docs/schemas/skill.md or convention)
