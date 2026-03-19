# 0020: Project Directory Structure Conventions

Date: 2026-02-19 (revised 2026-02-20)
Status: accepted
Supersedes: original 0020 (youji-only scope, 2026-02-19)

## Context

The original ADR 0020 (2026-02-19) addressed directory clutter in `projects/youji/`
only. However, the same organizational problems apply to all projects:

| Project | README lines | diagnosis-*/postmortem-*/analysis-* at root | log/ exists | completed-tasks.md |
|---------|-------------|---------------------------------------------|-------------|-------------------|
| youji | 523 (down from 2,098 after partial migration) | 37 files | yes (created) | no |
| sample-project | 2,128 (~1,900 lines of log) | 1 file | no | no |

The youji project partially implemented the original ADR: `log/` was created and
77 log entries archived (README reduced from 2,098 to 523 lines). But `diagnosis/`
was never created, completed tasks were never archived, and skills were never
updated. More importantly, the sample-project has the same README bloat problem
(2,128 lines, 45 completed tasks) and was never in scope.

### Why repo-wide

The three organizational conventions — `diagnosis/` for operational records, `log/`
for archived entries, `completed-tasks.md` for done tasks — solve structural
problems that affect any project under sustained autonomous operation:

1. **Top-level file proliferation**: Any project that uses `/slack-diagnosis`,
   `/diagnose`, or `/postmortem` accumulates files at root.
2. **README bloat**: Any project with active logging exceeds ~150 lines within
   days of active operation.
3. **Completed task accumulation**: Task selection scans "Next actions"; completed
   tasks impose context cost proportional to project age.

Making these project-specific would require re-discovering and re-deciding the same
conventions for each new project. Repo-wide conventions prevent that.

### Design tension (retained from original)

**Organic growth vs. navigability.** The current structure is a natural result
of "write the file and move on" — which is exactly what agents should do during
operational work. Adding organizational overhead during diagnosis (creating
subdirectories, moving files) would slow down the real-time work. But the
accumulated result is a cluttered directory that imposes a tax on every
subsequent session.

The tension is between **write-time simplicity** (just create the file) and
**read-time efficiency** (find what you need quickly). Since each file is
written once but read many times across sessions, the balance should favor
read-time efficiency — but with minimal write-time friction.

## Decision

These conventions apply to **all projects** under `projects/`.

### Convention 1: `diagnosis/` and `postmortem/` directories for operational records

> **Amended by ADR 0028 Step 1**: postmortems are separated into their own
> `postmortem/` directory. The original convention placed all operational records
> in `diagnosis/`.

Every project SHOULD have a `diagnosis/` subdirectory for ad-hoc operational
investigations and a `postmortem/` subdirectory for serious incident records.
These are distinct from structured experiment records (which live in
`experiments/`) because they lack EXPERIMENT.md frontmatter and are produced
by real-time investigative skills rather than planned work.

- **Create on first use**: Directories are created when the first file of that
  type is produced for that project. No need to pre-create empty directories.
- **Naming convention**: Files keep their existing naming patterns with date
  suffixes (`diagnosis-<slug>-YYYY-MM-DD.md`, `analysis-<slug>-YYYY-MM-DD.md`
  in `diagnosis/`; `postmortem-<slug>-YYYY-MM-DD.md` in `postmortem/`).
- **Skill convention**: `/slack-diagnosis` and `/diagnose` write to
  `projects/<project>/diagnosis/`; `/postmortem` writes to
  `projects/<project>/postmortem/`.
- **Future consideration**: If a project's diagnosis files grow to 50+, they
  could be further organized into monthly subdirectories (`diagnosis/2026-02/`),
  but this is not necessary now.

### Convention 2: `log/` directory for archived README entries

> **Amended by ADR 0066**: Retention rule changed from time-based ("2-3 days")
> to count-based ("≤5 entries"). The 150-line threshold remains as a secondary
> safety net.

Every project SHOULD archive log entries when the README has more than 5 log
entries. Archive into `log/` as individual files with descriptive names.

- **Naming convention**: `YYYY-MM-DD-<slug>.md`, where `<slug>` is a short
  kebab-case summary of the entry topic. When a day has multiple entries,
  append a lowercase letter: `2026-02-16a-`, `2026-02-16b-`, etc.
- **Retention in README**: Keep only the 5 most recent entries in the README.
  Move everything older to `log/`.
- **Why per-entry files**: Monthly aggregates (`YYYY-MM.md`) become too large
  under sustained operation. Daily aggregates (`YYYY-MM-DD.md`) are semantically
  opaque. Per-entry files with descriptive slugs make `ls log/` a human-readable
  index. The tradeoff is more files, but they live in a dedicated subdirectory
  where quantity is manageable.

### Convention 3: `completed-tasks.md` for archived tasks

Every project SHOULD move completed tasks (`[x]`) from the "Next actions"
section to `completed-tasks.md` when the completed task count exceeds ~10.

- The README "Next actions" section should contain only open tasks, making it
  immediately actionable for task selection.
- The completed-tasks file serves as a historical record. It can be consulted
  when needed but doesn't impose context cost on routine task selection.
- Completed tasks retain their full description (including "done" annotations)
  in the archive file.

### Convention 4: Update skill output paths

The `/slack-diagnosis`, `/diagnose`, and `/postmortem` skills write output to
`projects/<project>/diagnosis/` rather than the project root. This is a
convention change in skill instructions — no code changes needed.

### Resulting structure (generic project)

After all conventions are applied, a project directory looks like:

```
projects/<project>/
├── README.md              (~200 lines: context + recent log + open questions + open tasks)
├── completed-tasks.md     (archived completed tasks)
├── diagnosis/             (operational investigations: diagnoses, analyses)
│   ├── diagnosis-*.md
│   └── analysis-*.md
├── postmortem/            (serious incident records — per ADR 0028)
│   └── postmortem-*.md
├── experiments/           (structured work records — unchanged)
├── log/                   (archived log entries with descriptive names)
│   ├── YYYY-MM-DD-slug.md
│   └── ...
└── <project-specific>/    (e.g., literature/, renders/, plans/, patterns/)
```

## Consequences

### Positive

- **Reduced context cost.** Agents loading READMEs read only recent log entries
  and open tasks. For large projects, this means ~200 lines instead of ~2,128.
- **Cleaner navigation.** Top-level directory listings show organizational
  structure, not file clutter.
- **Convention alignment.** The CLAUDE.md log archival threshold is consistently
  applied across all projects.
- **Consistent structure.** New projects inherit the conventions automatically
  rather than re-discovering them after accumulating clutter.
- **Diagnosis discoverability.** A `diagnosis/` directory makes operational
  records easy to find and scan across projects.

### Negative

- **Cross-references break.** Moving files invalidates existing markdown links.
  The experiment validator's cross-reference checker will catch these.
- **Git history fragmentation.** `git mv` preserves history with `--follow`,
  but casual `git log <file>` won't show pre-move history.
- **Migration effort.** Applying retroactively to existing projects requires
  per-project migration work (see below).

### Migration

Migration is per-project and incremental. Each project can be migrated
independently, and each step within a project can be done independently.

#### youji (partially complete)

1. ~~**Create `log/` and archive entries**~~ — DONE (2026-02-19). 77 entries archived. README reduced from 2,098 to 523 lines.
2. ~~**Create `diagnosis/` and move files**~~ — DONE (2026-02-19). 33 diagnosis + 1 analysis files to `diagnosis/`. Postmortems separated to `postmortem/` per ADR 0028 (2026-02-20).
3. **Archive completed tasks** — move 43 `[x]` tasks to `completed-tasks.md`
4. **Fix cross-references** — run `pixi run validate`, fix broken links from steps 2-3
5. ~~**Update skills**~~ — DONE (2026-02-20, ADR 0028). `/postmortem` writes to `postmortem/`; `/diagnose` and `/slack-diagnosis` write to `diagnosis/`.

#### Sample project (large README)

1. **Create `log/` and archive entries** — README is 2,128 lines with ~1,900 lines of log. Archive all but recent 2-3 days.
2. ~~**Create `diagnosis/` and move files**~~ — DONE (2026-02-20, ADR 0028). Postmortems moved to `postmortem/`.
3. **Archive completed tasks** — move 45 `[x]` tasks to `completed-tasks.md`
4. **Fix cross-references** — run `pixi run validate`, fix broken links

#### CLAUDE.md and SOP updates

- Update CLAUDE.md Project READMEs section to reference `diagnosis/` convention
- Update `docs/sops/autonomous-work-cycle.md` Step 5 to scan
  `projects/*/diagnosis/` instead of `projects/*/diagnosis-*.md`
- Update skill files per Convention 4

### Not addressed

- **Experiment directory naming inconsistency** (some have dates, some don't).
  This is minor and not worth the churn of renaming.
- **Missing `type` field in experiment frontmatter.** Valid per schema (defaults
  to `experiment`), and backfilling is low-value.
- **The `experiments/` directory name** retains its original name despite holding
  non-experiment structured records. This was an explicit decision in ADR 0012.
