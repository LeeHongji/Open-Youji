Design pattern for structured experiment records with machine-parseable frontmatter and type-specific sections.

# Pattern: Structured Work Records

## Summary

Every non-trivial piece of work — experiments, analyses, implementations, bugfixes — gets its own directory with a structured `EXPERIMENT.md` containing YAML frontmatter (machine-parseable) and type-specific markdown sections (human-readable). A validator enforces schema compliance at commit time.

## Problem

Research produces diverse work types that all generate knowledge worth preserving. Without structure:

1. **Knowledge is scattered**: findings end up in log entries, chat messages, or uncommitted files — hard to find and impossible to validate.
2. **Reproducibility is lost**: without recorded configs, commands, and verification steps, successful work cannot be repeated and failed work cannot be debugged.
3. **Machine processing is impossible**: unstructured text cannot be validated, queried, or aggregated. You can't answer "how many experiments consumed resources?" without reading every file.

The initial approach — logging everything to README entries — broke down quickly. Log entries are good for narrative ("what happened") but bad for structured data ("what were the parameters, what was measured, what was found").

## Solution

### The experiment directory structure

```
projects/<project>/experiments/<task-id>/
  EXPERIMENT.md   — YAML frontmatter + type-specific sections (required)
  config.*        — input configuration (required for non-planned experiments)
  results/        — output data files
  analysis/       — derived metrics and visualizations
```

### YAML frontmatter

Machine-parseable metadata at the top of every EXPERIMENT.md:

```yaml
---
id: <kebab-case-slug>
type: experiment | implementation | bugfix | analysis
status: completed | running | planned | failed | abandoned
date: YYYY-MM-DD
project: <project-name>
consumes_resources: true | false
evidence_for: [pattern-slug, ...]  # optional
tags: [optional, tag, list]
---
```

Required fields: `id`, `status`, `date`, `project`, `consumes_resources`. The `type` field defaults to `experiment` if absent. The `evidence_for` field links records to design patterns for self-model evidence tracking.

### Four work types

The type system generalizes the experiment schema to cover all non-trivial work:

| Type | Key Sections (completed) | Use when |
|---|---|---|
| experiment | Design, Config, Results, Findings, Reproducibility | Hypothesis-driven, controlled investigation |
| implementation | Specification, Changes, Verification | Building new functionality |
| bugfix | Problem, Root Cause, Fix, Verification | Fixing broken behavior |
| analysis | Question, Method, Findings | Analytical investigation without controlled variables |

Each type has status-appropriate required sections (e.g., a `planned` experiment needs Design and Config; a `completed` experiment also needs Results, Findings, and Reproducibility).

### The `consumes_resources` field

Added to distinguish zero-resource work from resource-consuming work. Rules:

- `type: experiment` -> must be `consumes_resources: true` (experiments always consume budget)
- Other types -> determined by the resource-signal checklist (LLM API calls? External APIs? GPU? Long compute?)

This enables selective enforcement: zero-resource work proceeds even when budget is exhausted.

### Validation

Schema compliance should be enforced at commit time. A validator checks:
- Required frontmatter fields present and valid
- Type-specific sections present for the given status
- ID matches directory name
- Referenced files exist
- Cross-reference integrity (markdown links resolve)

Note: Youji does not yet have a commit-time validator. Building one is a future infrastructure task. Convention compliance is currently enforced through the `/self-audit` skill and agent adherence.

## Forces and trade-offs

### Structure vs. overhead

Creating a directory and EXPERIMENT.md for every non-trivial task adds overhead. The guideline — create a structured record when the work produces findings, requires verification, spans sessions, or consumes resources — is helpful but judgment-dependent.

### Schema evolution

The schema should evolve conservatively: each new field must preserve backward compatibility so existing records don't need updating. Fields added: `type`, `consumes_resources`, `evidence_for`. Each responded to a specific need.

### Validator strictness

The validator (when built) should be strict about structure (required sections, valid frontmatter) but lenient about content (doesn't check whether findings are meaningful). This catches formatting errors but not quality problems — a tautological finding passes validation if it's in the right section.

## Evidence

Evidence from the OpenAkari system:

**Schema robustness:** The schema was extended three times (adding `type`, `consumes_resources`, `evidence_for` fields) with zero breaking changes to existing records.

**Validator effectiveness:** When deployed, the validator caught missing Findings sections and schema violations before they were committed, with zero false positives.

**Work type coverage:** All four work types (experiment, implementation, bugfix, analysis) are used in practice, validating the type system's generality.

Youji-specific evidence will be collected as operational history accumulates. Key metrics to track: record creation rate, structural compliance, content quality (provenance-backed findings vs. pro-forma entries).

## CI layer analysis

**L1 (Schema)** — structural templates that constrain what agents produce. The YAML frontmatter is a schema; the type-specific sections are schemas. The validator (when built) at **L0 (Code)** enforces schema compliance. The "when to create a record" guideline is **L2 (Convention)**.

## Known limitations

1. **Threshold ambiguity.** When to create a structured record vs. just a log entry is judgment-dependent. The guideline (produces findings, requires verification, spans sessions, or consumes resources) is helpful but not always clear.

2. **Directory proliferation.** Each record gets a directory, leading to many small directories over time. Organizing records into type-specific directories (feedback/, analysis/, architecture/) by function can help.

3. **Content-free records.** Many records may contain only EXPERIMENT.md with no config, results, or analysis artifacts. For implementation and bugfix types, this is acceptable (the record IS the knowledge). For experiment types, missing config/results suggests the record is under-documented.

4. **No content quality validation.** The validator checks structure, not substance. A finding that says "things worked" passes validation despite being useless.

5. **No commit-time validator yet.** Youji relies on convention and the `/self-audit` skill rather than automated validation. Building a validator is a future infrastructure goal.

## Self-evolution gaps

- **Human-dependent**: The decision to add new fields was human-driven in response to specific problems.
- **Self-diagnosable**: Record counts, structural compliance, and schema adherence are mechanically measurable. The system can detect its own record quality at a structural level.
- **Gap**: No mechanism to assess whether a record's content is substantive vs. pro-forma. A future quality metric could check whether Findings sections contain provenance-backed claims.

## Open questions

1. **What is the right record threshold?** Should every implementation get a record, or only significant ones? The current answer ("non-trivial work") is vague.

2. **Should the validator enforce provenance?** The findings-provenance convention (CLAUDE.md checklist item 5) is currently advisory. Could the validator check that Findings sections contain file references or arithmetic?

3. **How should records be organized at scale?** With many records in `experiments/`, discovery becomes difficult. Organization by type, by topic, by pattern, or by date may be needed as the collection grows.

## Related patterns

- **Inline Logging** ([patterns/inline-logging.md](inline-logging.md)) — inline-logged findings flow into EXPERIMENT.md Findings sections.
- **Layered Budget Enforcement** ([patterns/layered-budget-enforcement.md](layered-budget-enforcement.md)) — the `consumes_resources` field enables selective budget enforcement.
- **Repo as Cognitive State** ([patterns/repo-as-cognitive-state.md](repo-as-cognitive-state.md)) — experiment records are the most structured form of repo state.
