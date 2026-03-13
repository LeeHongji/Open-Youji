Decision record conventions for Youji.

## Purpose

Decisions prevent re-litigation. Once a choice is recorded, future sessions respect it unless explicitly superseding it with a new ADR. This is the consistency anchor across stateless sessions.

## When to write a decision record

Write a decision record when:
- Choosing between non-obvious alternatives (methodology, tools, frameworks)
- Making a choice that constrains future work
- Resolving an open question that other sessions might re-litigate
- Changing a previous decision
- Adopting a convention that future sessions must follow

Do NOT write a decision record for:
- Trivial choices (file naming for one file, variable names)
- Temporary decisions (will change next session)
- Choices with no alternatives considered

## Where to write

- **System-wide decisions**: `decisions/NNNN-<slug>.md`
- **Project-specific decisions**: `projects/<project>/decisions/<slug>.md`

## Numbering

System-wide ADRs use sequential numbering: 0001, 0002, etc.
Project-specific decisions use descriptive slugs without numbers.

## Decision record schema

```markdown
# ADR-NNNN: <title>

Date: YYYY-MM-DD
Status: accepted | superseded by ADR-XXXX

## Context
<why this decision was needed -- what problem, what alternatives considered>

## Decision
<what was decided and why this alternative was chosen>

## Consequences
<what follows from this decision -- both positive and negative>
```

## Status values

- `accepted` -- current active decision
- `superseded by ADR-XXXX` -- replaced by a newer decision (link to it)

## Immutability

Decision records are never edited after acceptance. If a decision needs changing:
1. Write a new ADR that supersedes the old one
2. Update the old ADR's status to `superseded by ADR-XXXX`
3. The new ADR's Context should explain why the previous decision no longer applies

## ADR task bridge

When writing an ADR with a Consequences section containing action items not yet implemented:
1. Create corresponding tasks in the relevant project's `TASKS.md`
2. Reference the ADR in the task's `Why:` line
3. Do this before committing the ADR

This prevents decisions from being recorded without follow-through.

## Key principles

- **Decisions bind future sessions.** Once recorded, a decision is the default until superseded. Do not re-litigate.
- **Record trade-offs.** The most valuable part of a decision record is the alternatives considered and why they were rejected. This prevents future sessions from exploring the same dead ends.
- **Scope appropriately.** System-wide decisions affect all projects. Project-specific decisions affect only that project. Don't over-scope.
- **If in doubt, record it.** The cost of an unnecessary decision record is one small file. The cost of a missing decision record is re-litigation across multiple sessions.
