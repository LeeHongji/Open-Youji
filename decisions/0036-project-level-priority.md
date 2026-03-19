# 0036: Project-Level Priority

Date: 2026-02-24
Status: accepted

## Context

The autonomous work cycle selects tasks via `/orient`, which reads all active project READMEs and TASKS.md files, then ranks individual tasks using criteria like waste-prevention, unblocking, and knowledge production. However, there is no mechanism for humans to steer which *project* gets attention. The only levers available are indirect: pausing a project (`Status: paused`), starving its budget, or stacking high-priority tasks in a project's TASKS.md.

A human asked: "What about whole project priorities?" — wanting a simple, explicit way to direct the system's focus toward certain projects over others. This is a governance lever, not an optimization: it expresses human strategic intent about where research effort should concentrate.

## Decision

Add an optional `Priority: high | medium | low` field to the project README schema, placed after the `Status:` line.

**Semantics:**
- `Priority: high` — this project should receive attention before others when actionable tasks exist
- `Priority: medium` — default priority (equivalent to omitting the field)
- Untagged (no Priority field) — treated as medium
- `Priority: low` — this project should only receive attention when higher-priority projects have no actionable tasks

**Ranking order:** `high` > `medium` | untagged > `low`

**Where it applies:** `/orient` uses project priority as a grouping criterion when selecting across projects. Within a priority group, the existing task-ranking criteria (prevents waste > unblocks > produces knowledge > matches momentum > cost-proportionate) apply unchanged. Project priority does not override task-level `Priority: high/medium/low` within a single project — it controls which project is considered first.

**Who sets it:** Humans only. Project priority is a governance lever, like `Status:` and `budget.yaml`. Autonomous sessions do not change project priority. If an agent believes a project's priority should change, it writes to `APPROVAL_QUEUE.md`.

**Initial state:** All existing projects are left untagged (equivalent to medium). Humans adjust priorities as strategic needs change.

## Consequences

- Humans gain a simple, explicit lever to steer autonomous work allocation across projects
- `/orient` skill updated to read and respect project priority during project selection
- CLAUDE.md updated: Project README schema includes Priority field; task selection section references project priority
- Project priority is orthogonal to task priority — they operate at different levels (project selection vs. task selection within a project)
- No migration needed: omitting the field is equivalent to `Priority: medium`
