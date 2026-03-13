# ADR-0015: Goal-directed planning loop

Date: 2026-03-13
Status: accepted
Adapted from: OpenAkari ADR-0049

## Context

The autonomous system executes tasks from TASKS.md but never generates tasks by comparing project state against `Done when` criteria. Projects with depleted task queues stall: the system loops through orient, finds no tasks, logs "no actionable tasks," and exits. Repeat every session.

This is a fundamental gap: the system has three loops — task execution (orient, execute, commit), knowledge embedding (compound), and task discovery from recommendations. None is goal-directed: none reads the project's `Done when` criteria and asks "what's missing?"

## Decision

Add a **mission gap analysis** step to orient that periodically compares project `Done when` criteria against the task inventory and generates tasks for unmet conditions.

### Mechanism

**Full orient** gains a "Mission gap analysis" section that:

1. For each active project with `Priority: high` or `medium`, reads `Mission` and `Done when` from the project README
2. Decomposes each `Done when` criterion into discrete verifiable conditions
3. For each condition: checks if it's already satisfied (completed work, artifacts on disk, completed tasks) or has a corresponding open task
4. If a condition is unsatisfied AND has no open task, generate a task proposal
5. Reports gaps in the orientation output

**Fast orient** gains a lightweight mission gap check: for the selected project, compare `Done when` against open tasks and flag any condition with no task.

### Trigger cadence

- Full mission gap analysis runs during every full orient
- Lightweight check runs during every fast orient
- When a project's unblocked task count drops to 0, mission gap analysis is mandatory

### Task generation rules

- Generated tasks follow the standard task schema (imperative verb, Done when, Priority)
- Tasks reference this ADR as provenance: "Why: Mission gap — no task for <condition> (per ADR-0015)"
- Generated tasks are proposals during orient — the session reviews and applies them

## Consequences

- Projects with defined `Done when` criteria will generate tasks autonomously when their task queues deplete
- The `Done when` field in project READMEs becomes operationally significant — vague conditions will produce vague tasks. Projects benefit from concrete, decomposable `Done when` criteria.
- Session overhead increases slightly during full orient (one additional README read per active project). Negligible for fast orient.
- Orient output gains a "Mission gap analysis" section showing per-project gap status
