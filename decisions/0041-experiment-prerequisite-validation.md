# 0041: Experiment Prerequisite Validation

Date: 2026-02-26
Status: accepted

## Context

Diagnosis `diagnosis-input-validation-gap-2026-02-26` identified that the leaf-removal pipeline experiment processed images that may not be trees. The root cause: the experiment assumed upstream outputs were validated without checking.

The diagnosis proposed PM3: adding a `prerequisites_validated` section to EXPERIMENT.md frontmatter:

```yaml
prerequisites_validated:
  - name: Test images are trees
    source: experiments/tree-test-images/EXPERIMENT.md
    status: pending | verified | known_limitation
    detail: "Visual classification not run"
```

## Decision

**Do NOT add `prerequisites_validated` to EXPERIMENT.md frontmatter.**

Instead, enforce the existing Design section convention: experiments using upstream outputs must document prerequisite validation in the "Controlled" variables section.

## Rationale

1. **Schema parsimony**: Adding frontmatter fields has ongoing cost (every EXPERIMENT.md must consider them, validator must check them). The benefit (catching one class of errors) doesn't justify the cost.

2. **Existing mechanism suffices**: The Design → Controlled section is explicitly for documenting what inputs are held fixed. Prerequisite validation belongs there as a controlled variable with its validation status.

3. **PM1 is the right fix**: The diagnosis's PM1 (add "Upstream Limitations Review" to design workflow) addresses the root cause without schema changes:
   - Design section convention: "Upstream limitations reviewed: [list or 'none']"
   - Validator can check for presence via text match
   - No frontmatter changes needed

4. **Task-level blocking exists**: The `[blocked-by]` tag in TASKS.md already handles dependency tracking. If an upstream experiment has unresolved limitations that would invalidate downstream work, create a follow-up task and block the downstream task.

## Consequences

1. **Design skill update**: The `/design` skill should include a checklist item: "For experiments using upstream outputs: list upstream experiments reviewed, their limitations, and how addressed."

2. **Controlled variables convention**: When an experiment depends on upstream outputs, the Controlled section should document:
   - What the input is expected to be
   - How it was validated (or explicitly: "not validated, accepted as known limitation")
   - Source experiment reference

3. **No validator changes**: No need to update the EXPERIMENT.md validator for new frontmatter fields.

4. **Alternative to schema change recorded**: Future sessions proposing similar frontmatter additions should reference this ADR as precedent for preferring convention over schema extension.

## Evidence

- Diagnosis: `projects/sample-research-project/diagnosis/diagnosis-input-validation-gap-2026-02-26.md`
- Current EXPERIMENT.md schema: `CLAUDE.md:418-470`
- Existing blocking mechanism: `[blocked-by]` tag in TASKS.md
