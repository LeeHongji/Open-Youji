# 0040: External Work Dependencies

Date: 2026-02-26
Status: accepted

## Context

As youji works on production-related projects, it sometimes requests external work from the team (e.g., art evaluations, infrastructure provisioning, data collection by other teams). This external work is subject to team bandwidth availability and schedule, and has no guaranteed completion time.

The current system uses `[blocked-by]` tags and APPROVAL_QUEUE.md entries, but lacks explicit guidance on:
- How to continue making progress while waiting
- When to follow up on stale external requests
- How to identify work that can proceed in parallel

## Decision

Establish a convention for external work dependencies with three components:

### 1. Tagging pattern

Use explicit `[blocked-by: external: <description>]` syntax for tasks waiting on external work. This distinguishes external dependencies from other blocker types (approval, credentials, another task).

### 2. Progress strategies

When tasks are blocked on external work, agents should:

a. **Decompose** — Split the blocked task into preparatory work and dependent work. Preparatory work (setup, analysis design, code scaffolding) can proceed immediately.

b. **Parallelize** — Work on other tasks in the same project, or fallback to lower-priority projects per existing orient logic.

c. **Document** — Add a note to the project README or task description indicating what external work is pending and what preparatory work has been done.

### 3. Staleness threshold

External work requests older than 7 days should be flagged for re-evaluation during orient. The agent should:
- Check if the external work completed (check relevant files, data paths)
- If still pending, note the delay in the project README
- Consider whether the approach should change (e.g., alternative data sources, scaled-down scope)

## Consequences

- Tasks with `[blocked-by: external: ...]` are filtered out of orient's task selection (existing behavior)
- Agents will create preparatory subtasks when decomposing blocked tasks
- APPROVAL_QUEUE.md entries with `Type: external` should include a `requested: YYYY-MM-DD` date field for staleness tracking
- Project READMEs should document pending external work and preparatory work completed

## Migration

1. Update CLAUDE.md task lifecycle tags section to include external dependency pattern
2. Add `requested` date field to APPROVAL_QUEUE.md external entries
3. Update orient skill to flag stale external requests (7+ days)
