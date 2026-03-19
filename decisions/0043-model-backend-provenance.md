# 0043: Model and Backend Provenance in Documents

Date: 2026-02-27
Status: accepted

## Context

youji uses multiple AI backends (Claude SDK, Cursor CLI, opencode/GLM-5) and models
(Claude Opus 4.6, Sonnet 4.5, Gemini 3 Flash/Pro, GPT-5.x, GLM-5-FP8). Documents
produced by youji — experiment records, analyses, log entries — do not consistently
record which model and backend produced them.

Audit of 91 EXPERIMENT.md files found:
- ~60% mention a model somewhere in the Config section, but formats vary wildly
- No frontmatter fields exist for model/backend (not machine-parseable)
- The existing `checkModelSelectionRationale` in verify.ts uses fuzzy regex matching
  that cannot extract or verify specific model identifiers
- Log entries rarely mention which model/backend produced the session's outputs
- A sample project's eval-config-mismatch postmortem showed that ambiguous references
  ("from `config.py`") led to using wrong parameters for 65/100 generations

Without structured model provenance:
1. Future sessions cannot mechanically determine which model generated a finding
2. Reproducibility is degraded — "re-run this experiment" is impossible without
   knowing the exact model
3. Cross-model comparisons require manual inspection of prose
4. Different backends have different capability profiles (GLM-5 weak on constraint
   discovery, Gemini times out on /diagnose) — unlabeled outputs cannot be
   calibrated for model-specific limitations

## Decision

### 1. New frontmatter fields for EXPERIMENT.md

Add two optional frontmatter fields:

```yaml
model: <model-identifier>
backend: <backend-name>
```

- `model`: The primary model used for the work (e.g., `claude-opus-4.6`,
  `gemini-3-flash`, `glm-5-fp8`). For experiments that use multiple models,
  this is the primary/orchestrating model; document additional models in the
  Config section.
- `backend`: The backend/deployment through which the model was accessed (e.g.,
  `claude-sdk`, `cursor`, `opencode`, `cf-gateway`).

These fields are optional to avoid breaking existing records. New records SHOULD
include them when the work involves model-dependent outputs.

### 2. Authoring model line in session log entries

Log entries produced by agent sessions SHOULD include a parenthetical noting the
authoring model:

```
### 2026-02-27 (Claude Opus 4.6 via claude-sdk)
```

This makes it visible at a glance which model produced each log entry, without
requiring readers to cross-reference session metadata.

### 3. Config section model documentation

The Config section template for experiments already requires "Key parameters."
We strengthen the guidance: when an experiment uses external models (LLM judges,
generation APIs, etc.), the Config section MUST include a structured model line:

```markdown
## Config

Model: gemini-3-flash via CF Gateway (selected per Model Selection Guide — best VLM judge at 62.7% PC)
```

This formalizes what the existing `checkModelSelectionRationale` convention
already expects, but with a concrete format.

### 4. Validator enforcement

The experiment-validator (L0 enforcement) will warn when:
- A completed experiment with `consumes_resources: true` has no `model` field
  in frontmatter
- A completed experiment/analysis Config section lacks a "Model:" line

The scheduler's verify.ts `checkModelSelectionRationale` remains as-is (L2
convention check for scripts with LLM API imports).

## Consequences

- New EXPERIMENT.md records will be machine-queryable by model/backend
  (`grep -r "model: gemini" projects/`)
- Existing records are not retroactively required to add fields (optional)
- The validator will produce warnings (not errors) for missing fields, to
  avoid blocking existing workflows
- Log entries gain a lightweight provenance signal without schema changes
- The convention complements (not replaces) the existing Model Selection
  Guide convention in CLAUDE.md
