# Experiment Validator

Validates experiment directories for completeness and integrity per the EXPERIMENT.md schema defined in CLAUDE.md.

## Usage

```bash
# Validate all experiments in the repo
cd infra/experiment-validator && pixi run validate

# Validate a specific project
pixi run validate ../../projects/sample-project

# Validate a single experiment
pixi run validate ../../projects/sample-project/experiments/strategic-100
```

## What it checks

1. **Schema**: EXPERIMENT.md has required YAML frontmatter fields (`id`, `status`, `date`, `project`). ID matches directory name.
2. **Sections**: Required markdown sections present based on status (e.g., `completed` needs Design, Config, Results, Findings, Reproducibility).
3. **File references**: All files referenced in markdown (backtick paths, link targets) exist.
4. **CSV integrity**: Referenced CSV files have headers and non-zero rows.
5. **ID uniqueness**: No duplicate experiment IDs within a project.
6. **Staleness**: Warning for `running` experiments older than 7 days.

## Output

Structured report: PASS/WARN/FAIL per experiment with specific issues listed.
