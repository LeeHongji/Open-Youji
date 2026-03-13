# ADR-0025: Skill-task bridge convention

Date: 2026-03-13
Status: accepted
Adapted from: OpenAkari ADR-0064

## Context

Skills like `/diagnose`, `/critique`, `/analyze`, and `/write` produce actionable recommendations — quick wins, prevention measures, improvement roadmaps, prioritized fixes. But these recommendations exist only in session output or static report files. They never enter the task pipeline for future execution.

OpenAkari's analysis found that 12 of 26 skills produced actionable recommendations that never became tasks. Conservative estimate: 55-85 actionable items per week from non-orient skills, representing significant lost task supply.

The fundamental gap: observations about missing work die as annotations in findings sections instead of becoming tasks.

## Decision

### Tiered task bridge enforcement

Skills are classified into three tiers based on the actionability of their output:

**Tier 1: Task Bridge REQUIRED** — skills whose output includes concrete, specific recommendations that are task-shaped:

| Skill | Task source |
|-------|------------|
| diagnose | Quick wins, experiments needed |
| critique | High-severity issues with concrete suggestions |
| analyze | Implications with concrete action verbs |

**Tier 2: Task Bridge RECOMMENDED** — skills whose output sometimes contains actionable items:

| Skill | Task source |
|-------|------------|
| write | Revisions needed, gaps identified |
| lit-review | Research gaps, follow-up investigations |

**Tier 3: Caller's responsibility** — skills invoked as sub-steps within larger workflows where the calling skill handles task creation.

### Task bridge procedure

Each Tier 1 skill includes a "Task Bridge" step after saving output:

1. For each actionable recommendation in the output:
   - Check TASKS.md for an existing task covering the same action
   - If no existing task, create one with appropriate tags and done-when condition
   - Reference the skill output file in the task's Why field
2. Skip recommendations that are purely observational, already implemented in-session, or informational context

## Consequences

- Task supply gains a new production source from skill output
- Diagnosis insights, critique findings, and analysis implications are acted upon rather than rediscovered
- Low implementation cost: a few lines added per skill, ~30 seconds per invocation
- Risk: task inflation from mechanical conversion of all recommendations. Mitigated by deduplication check and skipping observational items.
