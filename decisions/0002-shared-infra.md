# 0002: Shared infrastructure in `infra/`

Date: 2026-02-14
Status: accepted

## Context

Research groups build shared tooling (experiment harnesses, data pipelines, plotting utilities). This code is neither an external dependency nor a research project. It needs a home.

Three options considered: (1) `infra/` directory at repo root, (2) treat infra as projects inside `projects/`, (3) separate repos.

## Decision

Option 1: `infra/` at repo root, parallel to `projects/`. Each tool gets its own subdirectory with a README following the same schema as projects.

`infra/` is the one place in the repo where source code lives. Projects reference external code; infra IS code. This distinction keeps `projects/` clean for research orchestration while giving shared tooling a stable, discoverable home.

Option 2 rejected because infra and projects have different lifecycles — infra is long-lived and shared, projects conclude. Mixing them muddies navigation. Option 3 rejected because separate repos add coordination overhead that defeats the monorepo premise.

## Consequences

- Shared utilities are importable as local packages from `infra/<tool>/`.
- Infra READMEs follow the same schema as project READMEs, so agents operate them identically.
- When a project-specific script proves useful to multiple projects, it migrates to `infra/`.
