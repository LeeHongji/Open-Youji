# ADR-0013: Project-level priority

Date: 2026-03-13
Status: accepted
Adapted from: OpenAkari ADR-0036

## Context

The autonomous work cycle selects tasks via orient, which reads all active project READMEs and TASKS.md files. However, there is no mechanism for the researcher to steer which *project* gets attention. The only levers are indirect: pausing a project (`Status: paused`) or stacking high-priority tasks in a project's TASKS.md.

The researcher needs a simple, explicit way to direct Youji's focus toward certain projects over others. This is a governance lever that expresses research strategic intent about where effort should concentrate.

## Decision

Add an optional `Priority: high | medium | low` field to the project README schema, placed after the `Status:` line.

**Semantics:**
- `Priority: high` — this project should receive attention before others when actionable tasks exist
- `Priority: medium` — default priority (equivalent to omitting the field)
- Untagged (no Priority field) — treated as medium
- `Priority: low` — only receive attention when higher-priority projects have no actionable tasks

**Ranking order:** `high` > `medium` | untagged > `low`

**Where it applies:** Orient uses project priority as a grouping criterion when selecting across projects. Within a priority group, existing task-ranking criteria (prevents waste > unblocks > produces knowledge > matches momentum) apply unchanged.

**Who sets it:** The researcher only. Project priority is a governance lever. Autonomous sessions do not change project priority. If Youji believes a project's priority should change, it notes this in the project README or flags for the researcher.

## Consequences

- The researcher gains a simple, explicit lever to steer work allocation across projects
- Orient respects project priority during task selection
- Project priority is orthogonal to task priority — they operate at different levels
- No migration needed: omitting the field is equivalent to `Priority: medium`
