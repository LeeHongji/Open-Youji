Structured work record conventions for Youji.

## When to create a structured record

Create a structured experiment record (EXPERIMENT.md) when work:
- Produces findings worth preserving
- Requires verification or reproducibility
- Spans sessions
- Consumes resources

For trivial work (fixing a typo, updating a log), a commit message and log entry suffice.

## Experiment directory structure

```
projects/<project>/experiments/<task-id>/
  EXPERIMENT.md   -- YAML frontmatter + type-specific sections (required)
  config.*        -- input configuration (required for non-planned experiments)
  results/        -- output data files
  analysis/       -- derived metrics and visualizations
```

## YAML frontmatter

Machine-parseable metadata at the top of every EXPERIMENT.md:

```yaml
---
id: <kebab-case-slug>
type: experiment | implementation | bugfix | analysis
status: completed | running | planned | failed | abandoned
date: YYYY-MM-DD
project: <project-name>
consumes_resources: true | false
tags: [optional, tag, list]
---
```

Required fields: `id`, `status`, `date`, `project`, `consumes_resources`.
The `type` field defaults to `experiment` if absent.

## Four work types

| Type | Key Sections (completed) | Use when |
|------|--------------------------|----------|
| experiment | Design, Config, Results, Findings, Reproducibility | Hypothesis-driven, controlled investigation |
| implementation | Specification, Changes, Verification | Building new functionality |
| bugfix | Problem, Root Cause, Fix, Verification | Fixing broken behavior |
| analysis | Question, Method, Findings | Analytical investigation without controlled variables |

Each type has status-appropriate required sections:
- `planned`: Design and Config
- `running`: Design, Config, partial Results
- `completed`: All sections including Findings
- `failed`/`abandoned`: All available sections plus failure description

## The `consumes_resources` field

Determines whether the work consumes budget resources:
- `type: experiment` --> must be `consumes_resources: true`
- Other types --> determined by the resource-signal checklist

This enables selective enforcement: zero-resource work proceeds even when budget is exhausted.

## Findings provenance

Every numerical claim in a Findings section must include either:
(a) The script + data file that produces it, or
(b) Inline arithmetic from referenced data (e.g., "96/242 = 39.7%")

Claims without provenance are unverifiable and should be treated as suspect by downstream sessions.

## Status transitions

```
planned --> running --> completed
                   --> failed
                   --> abandoned
```

- `planned`: Work is designed but not started
- `running`: Work is in progress
- `completed`: Work is done with findings documented
- `failed`: Work encountered unrecoverable errors
- `abandoned`: Work was stopped before completion (record why)

Never skip `planned` unless the work is trivially small.
