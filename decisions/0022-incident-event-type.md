# 0022: Incident Event Type

Date: 2026-02-19
Status: accepted

## Context

The host machine migration (2026-02-19) required a structured record of what happened, what broke, and what was recovered. The existing EXPERIMENT.md types (`experiment`, `implementation`, `bugfix`, `analysis`) didn't cleanly fit — the root cause was an external infrastructure event, not a software bug. We used `type: bugfix` with an "incident" tag as the closest approximation.

This raised the question: should "incident" be a first-class event type, or is `bugfix` with tags sufficient?

## Decision

Incidents are recorded as `type: bugfix` with `tags: [incident]`. No new type is introduced.

Rationale:
- The EXPERIMENT.md schema's `bugfix` type already has the right structure: Problem, Root Cause, Fix, Verification.
- Incidents are rare — adding a schema type for rare events adds complexity without proportional value.
- The `tags` field provides sufficient discrimination. Searching for `tags: [incident]` finds all incidents.
- The `bugfix` framing is accurate: something broke (paths became invalid), we diagnosed the root cause (host migration), and we fixed it (path replacement).

## Consequences

- Incidents use `type: bugfix` with `tags: [incident]` in EXPERIMENT.md frontmatter.
- No schema changes needed.
- Future incidents follow the same pattern: create an experiment directory, use the bugfix template, tag with `incident`.
- If incidents become frequent enough to warrant distinct sections (e.g., "Timeline", "Blast radius"), this decision can be revisited.
