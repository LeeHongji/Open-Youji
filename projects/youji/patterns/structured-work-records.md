Design pattern for structured experiment records with machine-parseable frontmatter and type-specific sections.

<!-- staleness-signal: structured-work-records-refs
     source-files: CLAUDE.md, decisions/0012-task-system.md, infra/experiment-validator/validate.py
     last-verified: 2026-02-20
     work-types: experiment, implementation, bugfix, analysis
     required-frontmatter: id, status, date, project, consumes_resources
     optional-frontmatter: type, tags, evidence_for -->

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

The type system (ADR 0012) generalizes the experiment schema to cover all non-trivial work:

| Type | Key Sections (completed) | Use when |
|---|---|---|
| experiment | Design, Config, Results, Findings, Reproducibility | Hypothesis-driven, controlled investigation |
| implementation | Specification, Changes, Verification | Building new functionality |
| bugfix | Problem, Root Cause, Fix, Verification | Fixing broken behavior |
| analysis | Question, Method, Findings | Analytical investigation without controlled variables |

Each type has status-appropriate required sections (e.g., a `planned` experiment needs Design and Config; a `completed` experiment also needs Results, Findings, and Reproducibility).

### The `consumes_resources` field

Added after a budget crisis where analysis work was blocked alongside experiments because there was no way to distinguish zero-resource work from resource-consuming work. Rules:

- `type: experiment` → must be `consumes_resources: true` (experiments always consume budget)
- Other types → determined by the resource-signal checklist (LLM API calls? External APIs? GPU? Long compute?)

This enables selective enforcement: zero-resource work proceeds even when budget is exhausted.

### Validation

The experiment validator (`infra/experiment-validator/validate.py`) enforces:
- Required frontmatter fields present and valid
- Type-specific sections present for the given status
- ID matches directory name
- Referenced files exist
- CSV integrity (headers, non-empty)
- Config consistency (n_runs, row counts match claims)
- Cross-reference integrity (markdown links resolve)
- Literature citation verification (only verified sources cited in publications)

The validator runs at commit time via `pixi run validate` and catches schema violations before they're committed.

## Forces and trade-offs

### Structure vs. overhead

Creating a directory and EXPERIMENT.md for every non-trivial task adds overhead. The guideline — create a structured record when the work produces findings, requires verification, spans sessions, or consumes resources — is helpful but judgment-dependent. Some agents over-create records (64 of 70 youji records contain only EXPERIMENT.md with no additional artifacts); others under-create (leaving findings only in log entries).

### Schema evolution

The schema has evolved three times: adding `type` (ADR 0012), adding `consumes_resources` (budget crisis response), and adding `evidence_for` (pattern-centric restructuring). Each evolution preserved backward compatibility — existing records didn't need updating. This suggests the schema design is robust, but each addition increases the cognitive load on agents creating new records.

### Validator strictness

The validator is strict about structure (required sections, valid frontmatter) but lenient about content (doesn't check whether findings are meaningful). This catches formatting errors but not quality problems — a tautological finding passes validation if it's in the right section.

## Evidence

**Sample research project:** 20+ experiment records span a typical project lifecycle — from initial baselines through full-scale evaluations to hybrid protocol designs. Each records design, config, results, and findings in a reproducible format. When duplicate contamination was discovered in one experiment, the EXPERIMENT.md provided the full audit trail needed to diagnose and correct corrupted preliminary analyses.

**Simulation game:** Savegame experiments follow the same schema. Across multiple sessions and savegames, agents created 30+ structured experiment records with status tracking, and the automated validator caught missing Findings sections before they were committed.

**youji:** 70 experiment records spanning experiments, implementations, bugfixes, analyses, and feedback records. The task system extension (decision 0012) generalized the experiment schema to support four work types. The spot-check validator (`architecture/spot-check-validator.md`) achieved 0 false positives across 87 experiment records. 748 tests across 58 test files cover the enforcement code.

**Measured metrics (at 83 sessions):**
- Total structured work records: 90+ across all projects (70 youji + 20+ sample projects, up from 20+ at 10 sessions)
- Validator-enforced section completeness: 100% (all committed records pass validation, 0 false positives on 87 records)
- Schema extension (adding `type`, `consumes_resources`, `evidence_for` fields): zero breaking changes
- Four work types in use: experiment (most common), analysis, implementation, bugfix

## CI layer analysis

**L1 (Schema)** — structural templates that constrain what agents produce. The YAML frontmatter is a schema; the type-specific sections are schemas. The validator at **L0 (Code)** enforces schema compliance. The "when to create a record" guideline is **L2 (Convention)**.

## Known limitations

1. **Threshold ambiguity.** When to create a structured record vs. just a log entry is judgment-dependent. The guideline (produces findings, requires verification, spans sessions, or consumes resources) is helpful but not always clear.

2. **Directory proliferation.** Each record gets a directory, leading to many small directories over time. The reclassification (ADR 0028 Step 4) addresses this by organizing records into `feedback/`, `analysis/`, `architecture/` directories by function.

3. **Content-free records.** 64 of 70 youji records contain only EXPERIMENT.md with no config, results, or analysis artifacts. For implementation and bugfix types, this is acceptable (the record IS the knowledge). For experiment types, missing config/results suggests the record is under-documented.

4. **No content quality validation.** The validator checks structure, not substance. A finding that says "things worked" passes validation despite being useless.

## Self-evolution gaps

- **Human-dependent**: The decision to add new fields (`consumes_resources`, `evidence_for`) was human-driven in response to specific problems.
- **Self-diagnosable**: Record counts, validator pass rates, and schema compliance are mechanically measurable. The system can detect its own record quality at a structural level.
- **Gap**: No mechanism to assess whether a record's content is substantive vs. pro-forma. A future quality metric could check whether Findings sections contain provenance-backed claims.

## Open questions

1. **What is the right record threshold?** Should every implementation get a record, or only significant ones? The current answer ("non-trivial work") is vague.

2. **Should the validator enforce provenance?** The findings-provenance convention (CLAUDE.md checklist item 5) is currently advisory. Could the validator check that Findings sections contain file references or arithmetic?

3. **How should records be organized at scale?** With 70+ records in `experiments/`, discovery is difficult. The reclassification into type-specific directories is a first step, but further organization (by topic, by pattern, by date) may be needed.

## Related patterns

- **Inline Logging** ([patterns/inline-logging.md](inline-logging.md)) — inline-logged findings flow into EXPERIMENT.md Findings sections.
- **Layered Budget Enforcement** ([patterns/layered-budget-enforcement.md](layered-budget-enforcement.md)) — the `consumes_resources` field enables selective budget enforcement.
- **Repo as Cognitive State** ([patterns/repo-as-cognitive-state.md](repo-as-cognitive-state.md)) — experiment records are the most structured form of repo state.

## References

- Decision record: [decisions/0012-task-system.md](../../../decisions/0012-task-system.md)
- Validator: [infra/experiment-validator/validate.py](../../../infra/experiment-validator/validate.py)
- Spot-check validator: [architecture/spot-check-validator.md](../architecture/spot-check-validator.md)
- Retrospective: [analysis/first-10-sessions-retrospective.md](../analysis/first-10-sessions-retrospective.md)
- Positive feedback analysis: [analysis/positive-feedback-structural-analysis.md](../analysis/positive-feedback-structural-analysis.md)
