Governance and approval conventions for Youji.

## Project priority

Tasks are selected from project `TASKS.md` files. Priority order:
1. Tasks in the project recommended by /orient (respecting project priority)
2. Unblocked tasks (no `[blocked-by: ...]` tag)
3. Tasks with concrete "Done when" conditions
4. Routine tasks before resource-intensive tasks
5. Tasks with explicit `Priority: high` before `Priority: medium` before untagged

## Approval gates

Autonomous sessions MUST NOT proceed with:

- **Resource decisions**: Requests to increase `budget.yaml` limits or extend deadlines
- **Governance changes**: Changes to approval workflow, budget rules, or other governance mechanisms in CLAUDE.md. Convention clarifications, gotcha additions, and skill improvements may be applied directly -- they are verifiable and do not change governance. When in doubt, the test is: "Does this change what requires approval or how resources are allocated?" If yes, it's governance; write to APPROVAL_QUEUE.md.
- **CLAUDE.md structural edits**: Changes that alter the operating model require researcher review.

Git push does **not** require approval -- sessions commit and push freely.

## What does NOT need approval

Everything else, including:
- Infrastructure fixes (validation, tests, error handling)
- New files, new decision records
- Schema changes
- Refactors
- Convention clarifications and skill improvements

As long as correctness is verifiable by code (tests, type checks, validators, linters). The principle: if a future session can mechanically confirm the change is correct, researcher review is redundant as a gate (though it may still happen asynchronously).

Bug fixes and safeguards that prevent resource waste should be implemented immediately, not queued.

## Approval queue protocol

For items requiring approval:

1. Write to `APPROVAL_QUEUE.md` with:
   - Type (resource, governance, structural)
   - Request description
   - Context and rationale
   - Cost estimate (for resource requests)
2. Tag the relevant task `[approval-needed]` in TASKS.md
3. End session or select a different task

The researcher reviews the queue periodically and records decisions (approved/denied with date and rationale).

## Goal-directed planning

Before any implementation plan, ask: "What knowledge does this produce?" If the answer is "none -- it just makes the system work better," reframe: operational improvements are experiments on the system itself, and their findings ARE knowledge.

Each project has:
- **Mission**: fixed at creation, prevents scope drift
- **Done when**: concrete, verifiable completion conditions
- **TASKS.md**: actionable work items with priority and done-when

When no actionable tasks exist, run mission gap analysis: compare project `Done when` criteria against task inventory and generate tasks for unmet conditions.

## Decision records as consistency anchor

The `decisions/` directory prevents contradictory choices across sessions. Once a choice is recorded, it is the default until explicitly superseded by a new ADR.

Do not re-litigate decisions recorded in `decisions/`. If a decision seems wrong, discuss with the researcher or write to APPROVAL_QUEUE.md.
