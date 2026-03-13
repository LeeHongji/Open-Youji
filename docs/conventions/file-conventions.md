File naming and organization conventions for Youji.

## Plain text everything

Markdown and YAML. Diff-friendly, grep-able, LLM-native. No binary formats for structured data.

## File organization

### Directory structure

```
Youji/
+-- CLAUDE.md                    # Agent operating manual
+-- .claude/skills/              # Encoded judgment procedures
+-- decisions/                   # Architectural decision records
+-- projects/                    # Research projects (one dir per project)
|   +-- <project-name>/
|       +-- README.md            # Status, mission, log, open questions
|       +-- TASKS.md             # Task list
|       +-- literature/          # Literature notes
|       +-- experiments/         # Experiment records
|       +-- plans/               # Non-trivial plans
|       +-- findings/            # Key findings and conclusions
+-- knowledge/                   # Cross-project knowledge base
+-- docs/
|   +-- design.md                # Why the repo is structured this way
|   +-- sops/                    # Standard operating procedures
|   +-- conventions/             # Detailed convention files
+-- infra/                       # Shared tooling (scheduler, etc.)
+-- README.md                    # Repo overview
```

### Projects are self-contained

Each project directory has full context. Youji pointed at one project directory can operate independently.

### Grow structure on demand

Don't create directories or files until they're needed. Youji can always create them later. An empty `literature/` directory adds no value.

## Naming conventions

### Files

- Use kebab-case for file names: `baseline-eval-v1.md`, not `BaselineEvalV1.md`
- Decision records: `NNNN-<slug>.md` (e.g., `0001-initial-structure.md`)
- Experiment directories: `<task-id>/` or `<descriptive-slug>/`
- Literature notes: `<author-year-keyword>.md` or `<descriptive-slug>.md`

### Task IDs

- Use kebab-case slugs: `baseline-eval`, `fix-parser-bug`
- Match the experiment directory name to the task ID when applicable

## File size guidelines

- **README**: Keep under 200 lines. Archive log entries when they exceed ~150 lines.
- **TASKS.md**: Keep under 150 lines. Archive completed tasks when the list grows.
- **CLAUDE.md**: Keep under 400 lines. Extract details to convention files when growing.
- **Source files**: Keep under 500 lines. Extract utilities from large modules.
- **Skill files**: Keep under 300 lines. Flag at 200 lines.

When a file exceeds its guideline, create a task to simplify or split it.

## Archival conventions

### Log archival

When a README's log exceeds ~150 lines:
1. Create `log/` directory in the project
2. Move older entries to `log/YYYY-MM-DD-slug.md`
3. Keep only the 3-5 most recent entries in the README

### Task archival

When completed tasks exceed ~10 in TASKS.md:
1. Create `completed-tasks.md` in the project
2. Move completed tasks there
3. Keep only open tasks in TASKS.md

### Decision immutability

Decision records are never edited after acceptance. Superseding decisions reference the old one with `Status: superseded by ADR-XXXX`.

## Where things go

| Content type | Location |
|-------------|----------|
| Research work | `projects/<name>/` |
| Cross-project knowledge | `knowledge/` |
| System conventions | `docs/conventions/` |
| Operating procedures | `docs/sops/` |
| System-wide decisions | `decisions/` |
| Project-specific decisions | `projects/<name>/decisions/` |
| Encoded judgment | `.claude/skills/` |
| Shared tooling | `infra/` |
