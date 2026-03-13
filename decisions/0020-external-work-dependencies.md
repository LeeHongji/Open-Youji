# ADR-0020: External work dependencies

Date: 2026-03-13
Status: accepted
Adapted from: OpenAkari ADR-0040

## Context

Research projects sometimes require external work — data collection by collaborators, infrastructure provisioning, feedback from domain experts, or resources from other teams. This external work has no guaranteed completion time and can block project progress indefinitely.

The current system uses `[blocked-by]` tags, but lacks explicit guidance on how to continue making progress while waiting, when to follow up on stale requests, and how to identify parallel work.

## Decision

### 1. Tagging pattern

Use explicit `[blocked-by: external: <description>]` syntax for tasks waiting on external work. This distinguishes external dependencies from other blocker types (approval, other tasks, missing tools).

### 2. Progress strategies

When tasks are blocked on external work, Youji should:

a. **Decompose** — Split the blocked task into preparatory work and dependent work. Preparatory work (setup, analysis design, code scaffolding) can proceed immediately.

b. **Parallelize** — Work on other tasks in the same project, or fall back to lower-priority projects.

c. **Document** — Add a note to the project README or task description indicating what external work is pending and what preparatory work has been done.

### 3. Staleness threshold

External work requests older than 7 days should be flagged for re-evaluation during orient:
- Check if the external work completed (check relevant files, data paths)
- If still pending, note the delay in the project README
- Consider whether the approach should change (alternative data sources, scaled-down scope)

## Consequences

- Tasks with `[blocked-by: external: ...]` are filtered out of orient's task selection
- Sessions will create preparatory subtasks when decomposing blocked tasks
- External requests should include a `requested: YYYY-MM-DD` date for staleness tracking
- Project READMEs document pending external work and preparatory work completed
