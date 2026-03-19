# 0049: Goal-Directed Planning Loop

Date: 2026-03-01
Status: accepted

## Context

The autonomous system executes tasks from TASKS.md but never generates tasks by
comparing project state against `Done when` criteria. This means projects with
depleted task queues stall indefinitely — the system loops through orient, finds
no tasks, logs "no actionable tasks," and exits. Repeat every 30 minutes.

A sample benchmark project demonstrated this: the project's mission requires benchmark
coverage across ≥3 skill categories, but only 4 of 7 taxonomy categories had tasks.
The system ran autonomously for days completing maintenance work while core paper
requirements had no corresponding tasks.

The system has three loops — task execution (`/orient → execute → commit`),
knowledge embedding (`/compound`), and task discovery from recommendations
(compound Step 3). None of these loops is goal-directed: none reads the project's
`Done when` criteria and asks "what's missing?"

See: `projects/youji/postmortem/postmortem-no-goal-directed-planning-loop-2026-03-01.md`

Prior analysis: `projects/youji/analysis/task-discovery-workflow-gap-2026-02-22.md`
identified recommendation surfacing gaps. This ADR addresses a deeper gap: the
system never generates tasks from first principles by analyzing what the mission
requires.

## Decision

Add a **mission gap analysis** step to `/orient` that periodically compares project
`Done when` criteria against the task inventory and generates tasks for unmet
conditions.

### Mechanism

**Full orient** gains a new "Mission gap analysis" section (after fleet supply
generation, before rank tasks) that:

1. For each active project with `Priority: high` or `medium`, reads `Mission` and
   `Done when` from the project README
2. Decomposes each `Done when` criterion into discrete verifiable conditions
3. For each condition: checks if it's already satisfied (completed experiments,
   artifacts on disk, completed tasks) or has a corresponding open task
4. If a condition is unsatisfied AND has no open task → generate a task proposal
5. Reports gaps in the orientation output

**Fast orient** gains a lightweight mission gap check: for the selected project,
compare `Done when` against open tasks. Flag any condition with no task.

### Trigger cadence

- Full mission gap analysis runs during every full orient (~every 2 hours)
- Lightweight check runs during every fast orient
- When a project's unblocked task count drops to 0, mission gap analysis is
  mandatory regardless of orient tier

### Task generation rules

- Generated tasks follow the standard task schema (imperative verb, Done when, fleet tags)
- Tasks are tagged `[fleet-eligible]` or `[requires-opus]` per the fleet-eligibility checklist
- Tasks reference this ADR as provenance: "Why: Mission gap — no task for <condition> (per ADR 0049)"
- Generated tasks are proposals during orient — the agent reviews and applies them
  (same pattern as fleet decomposition proposals)

## Consequences

1. Projects with defined `Done when` criteria will generate tasks autonomously
   when their task queues deplete, closing the reactive→goal-directed gap.
2. Orient output gains a "Mission gap analysis" section showing per-project gap
   status.
3. The `Done when` field in project READMEs becomes operationally significant —
   vague conditions will produce vague tasks. Projects benefit from concrete,
   decomposable `Done when` criteria.
4. Session overhead increases slightly during full orient (one additional
   README read + task comparison per active project). Negligible for fast orient
   (one project only).

### Migration

- Update `/orient` SKILL.md with mission gap analysis step (full orient)
- Update `/orient` SKILL.md with lightweight mission gap check (fast orient)
- Update `/orient-simple` SKILL.md to match
- Update CLAUDE.md to document the convention
- Update autonomous-work-cycle SOP to reference the planning loop
