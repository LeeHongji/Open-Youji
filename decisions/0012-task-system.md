# 0012: Task System — Extending Experiments to General Structured Work

Date: 2026-02-16
Status: accepted

## Context

The experiment system (EXPERIMENT.md, validator, runner, scheduler) handles explorative research well, but autonomous agents also do implementation, bugfix, and analysis work that produces knowledge. This work currently exists only as README log entries — unstructured, unvalidated, not machine-parseable.

Two concrete problems:
1. Knowledge from non-experiment work is buried in prose log entries without structured Findings, Verification, or Reproducibility sections.
2. No validation enforces that "Done when" criteria from README tasks are actually met and recorded.

The experiment schema's shape (YAML frontmatter + status-dependent sections + file references) is sound for any structured work. The issue is that required sections are experiment-specific (Design, Config, Results).

## Decision

Add an optional `type` field to EXPERIMENT.md frontmatter. Four types:

- `experiment` — explorative work with hypotheses (current behavior, default)
- `implementation` — building or extending capability
- `bugfix` — fixing broken behavior
- `analysis` — interpreting existing data or code

Each type defines its own required sections per status, replacing the single `SECTIONS_BY_STATUS` mapping in the validator with `SECTIONS_BY_TYPE_STATUS`. When `type` is absent, behavior defaults to `experiment` — full backward compatibility.

The `experiments/` directory name is retained. All structured work records live in `projects/<project>/experiments/<task-id>/` regardless of type.

Not every README task needs a structured record. The threshold: create one when the task produces findings, requires verification, spans sessions, or consumes resources.

Full design: `projects/youji/experiments/task-system-architecture/architecture.md`.

### `consumes_resources` field

Date: 2026-02-17

Added a required `consumes_resources: true | false` field to EXPERIMENT.md frontmatter. This field makes the budget-relevance of each structured work record explicit and machine-parseable.

**Semantics:**
- `true` — the work consumes tracked resources (API calls, compute time, etc.). Subject to budget gates.
- `false` — the work uses no tracked resources (pure analysis, documentation, planning). Exempt from budget gates (but still respects deadlines).

**Type constraints enforced by validator:**
- `type: experiment` → must be `consumes_resources: true` (experiments always consume resources by definition).
- `type: analysis`, `type: implementation`, and `type: bugfix` → either value is valid. Use the resource-signal checklist to determine the correct value.

**Motivation:** A sample project reached 137% budget consumption, blocking all new work. However, analysis tasks (data mining existing results, literature synthesis) produce knowledge at zero marginal cost. Without a machine-readable way to distinguish budget-consuming from zero-resource work, the budget gate blocks everything equally. The `consumes_resources` field + `[zero-resource]` lifecycle tag enable agents to continue productive work even when budget is exhausted.

**Self-identification method (resource-signal checklist):**

Agents determine the value of `consumes_resources` by applying this checklist before planning work:
1. Does the task call any language model (evaluation, summarization, generation)?
2. Does the task call any third-party API (3D generation, image generation, web services)?
3. Does the task run inference, training, or rendering that requires GPU?
4. Does the task involve processes expected to run >10 minutes?

If any answer is yes → `consumes_resources: true`. If all answers are no → `consumes_resources: false`.

The checklist is independent of the `type` field. An analysis that calls an LLM is `type: analysis` with `consumes_resources: true`. The validator constraint has been relaxed: `type: analysis` now allows either value (previously required `false`). Only `type: experiment` retains a hard constraint (`consumes_resources: true`).

**Companion changes:**
- `[zero-resource]` lifecycle tag added to task schema for README "Next actions" items.
- Budget check protocol exempts `consumes_resources: false` work from budget gates.
- Task selection prioritizes `[zero-resource]` tasks when budget is >90% consumed.
- Resource-signal checklist added to autonomous work cycle SOP Step 3 and CLAUDE.md resource constraints section.

## Consequences

- All 13 existing experiments continue to validate without changes (default type = experiment).
- Agents can now create structured records for bugfixes and implementations, preserving root causes, design decisions, and verification evidence.
- The validator gains type-aware section checking with no breaking changes.
- No changes needed to the experiment runner or scheduler — both are already type-agnostic.
- The SOP for autonomous execution needs a minor update: agents should create structured records for non-trivial work, not just experiments.
- The type taxonomy (4 types) may need revision after real usage. Phase 3 retrospective planned after 10+ mixed-type records.
- The `consumes_resources` field is now required in all EXPERIMENT.md files. Existing files need backfilling.
