# ADR-0006: Task system — structured work records beyond experiments

Date: 2026-03-13
Status: accepted
Adapted from: OpenAkari ADR-0012

## Context

The experiment schema (hypothesis, method, results, findings) works well for exploratory research, but autonomous sessions also perform implementation, bugfix, and analysis work that produces knowledge. This work currently exists only as README log entries — unstructured and not machine-parseable.

Two problems:
1. Knowledge from non-experiment work is buried in prose log entries without structured findings, verification, or reproducibility sections.
2. No structure enforces that "Done when" criteria from TASKS.md are actually met and recorded.

## Decision

Add an optional `type` field to experiment/structured work records. Four types:

- `experiment` — explorative work with hypotheses (default)
- `implementation` — building or extending capability
- `bugfix` — fixing broken behavior
- `analysis` — interpreting existing data or code

Each type has its own required sections appropriate to the work:
- Experiments require: hypothesis, method, results, findings
- Implementations require: design rationale, changes made, verification
- Bugfixes require: root cause, fix, verification, downstream impact check
- Analyses require: question, method, findings, implications

### When to create a structured record

Not every task needs one. The threshold: create a structured record when the task:
- Produces findings that future sessions need
- Requires verification that should be documented
- Spans multiple sessions
- Consumes external resources

### Resource classification

Records include a `consumes_resources` field:
- `true` — the work consumes tracked resources (API calls, compute). Subject to budget gates.
- `false` — zero-resource work (analysis, documentation, planning). Exempt from budget gates.

Use the resource-signal checklist from ADR-0005 to determine the correct value.

## Consequences

- All existing experiments continue unchanged (default type = experiment)
- Sessions can now create structured records for bugfixes, implementations, and analyses
- Knowledge from non-experiment work gains structured findings and verification sections
- The `consumes_resources` field enables budget-aware work selection: zero-resource tasks proceed even when budget is exhausted
