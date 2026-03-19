# 0028: Human-Driven Structural Refactor

Date: 2026-02-20T19:18+08:00
Status: accepted
Continues: 0020 (project directory structure conventions)

## Context

ADR 0020 established conventions for project directory hygiene — `diagnosis/`,
`log/`, `completed-tasks.md` — and laid out per-project migration steps. This
ADR goes further: a human-driven refactor of youji's overall repo structure,
making changes that are too broad or too disruptive for autonomous sessions to
execute safely.

This refactor is driven by the human PI, not by youji's autonomous sessions.
The agent records the decisions as dictated; the human designs and executes
the changes. Autonomous sessions should treat this ADR as externally imposed
structure, not as self-generated reorganization.

## Decision

The following steps are executed in order. Each step is a discrete, committable unit.

### Step 1: Separate `postmortem/` from `diagnosis/`

**Rationale.** Postmortems describe serious issues — resource waste, systemic
failures, flawed reasoning chains. Diagnoses are lighter: observations about
unexpected behavior that may or may not indicate a real problem. Mixing them
in a single `diagnosis/` directory forces agents to scan every file to assess
severity. Separating them at the directory level lets agents:

- **Triage by directory**: `ls postmortem/` immediately surfaces serious incidents.
- **Prioritize during /orient**: postmortems signal unresolved systemic risks;
  diagnoses signal operational noise that may or may not need action.
- **Scope reviews**: a human reviewing "what went wrong" reads `postmortem/`;
  a human reviewing "what was investigated" reads `diagnosis/`.

**Change.** Every project gets two directories instead of one:

```
projects/<project>/
├── diagnosis/      ← operational investigations (diagnosis-*.md, analysis-*.md)
├── postmortem/     ← serious incidents (postmortem-*.md)
```

ADR 0020 Convention 1 is amended: `diagnosis/` no longer holds postmortem files.
The `/postmortem` skill writes to `postmortem/`; `/diagnose` and
`/slack-diagnosis` continue writing to `diagnosis/`.

**Migration.** `git mv` all `postmortem-*.md` files from `diagnosis/` (and any
still at project root or in `analysis/`) into `postmortem/`. Fix cross-references.

Current files to move:
- `projects/<project-A>/diagnosis/postmortem-*.md` (3 files) → `projects/<project-A>/postmortem/`
- `projects/<project-B>/diagnosis/postmortem-*.md` (2 files) → `projects/<project-B>/postmortem/`
- `projects/<project-B>/analysis/postmortem-*.md` (2 files) → `projects/<project-B>/postmortem/`

### Step 2: Break READMEs apart by access pattern

**Rationale.** Project READMEs have grown to 614-655 lines. Agents load them
every session — for /orient, task selection, and logging. But these operations
need different data:

| Operation | Needs | Doesn't need |
|-----------|-------|-------------|
| Task selection | tasks | log, context, questions |
| /orient | mission, tasks, questions | full log history |
| Logging | recent log (for context) | tasks, full history |

A monolithic README forces every operation to pay the token cost of every
section. At 650 lines, that's ~2,000 tokens wasted per load. Over dozens of
sessions, this adds up.

**Diagnosis.** The bloat has two causes:
1. **Log sections exceed archival threshold.** ADR 0020 mandates archival at
   ~150 lines; both project-A (522 lines) and project-B (482 lines) are 3x over.
2. **Tasks and log are co-located.** Even after archival, the README mixes
   stable content (mission, context), frequently-read content (tasks), and
   append-only content (log). Every reader pays for all three.

**Change.** Split each project README into focused files:

```
projects/<project>/
├── README.md    ← mission, context, open questions, recent log (~100-150 lines)
├── TASKS.md     ← next actions only (~50-100 lines)
```

- **README.md** retains: header (mission/done-when), Context, Log (recent
  2-3 days only, rest archived to `log/`), Open questions.
- **TASKS.md** contains: the "Next actions" section, moved verbatim from README.
  Task lifecycle tags, schemas, and conventions are unchanged — only the file
  location changes.

**Convention updates required:**
- CLAUDE.md: "Tasks are selected from project README 'Next actions' sections"
  → "Tasks are selected from project `TASKS.md` files"
- Skills that reference README tasks (e.g., /orient) must scan `TASKS.md`
- The task schema and lifecycle tags are unchanged

**Migration.** For each project:
1. Archive log entries older than 2-3 days to `log/`
2. Extract "Next actions" section to `TASKS.md`
3. Update cross-references in CLAUDE.md, skills, SOPs

### Step 3: Remove 3dai-simulation-game project

**Rationale.** The 3dai-simulation-game project is complete (mission accomplished:
agents ran 8 sessions, discovered 25+ findings). Its continued presence in the repo
causes unnecessary complexity:

- Required an exclusion rule in CLAUDE.md, the /orient skill, and the SOP
- Had a separate `sim-game-cycle` scheduler job with a long, specialized prompt
- Savegame-specific logic in `notify.ts` (ledger scanning), `validate.py` (config
  detection), and `budget-status.py` (directory scanning)
- Two resolved approval queue items referencing it

All project files are preserved in git history. Historical references in log entries,
experiment records, and design patterns documents are left intact (they describe
what happened and remain valid historical evidence).

**Changes.**

1. `git rm -r projects/3dai-simulation-game/`
2. Remove `sim-game-cycle` job from `.scheduler/jobs.json`
3. Empty `EXCLUDED_PROJECTS` in `infra/scheduler/src/constants.ts`
4. Remove savegame-specific logic from `notify.ts`, `notify.test.ts`, `verify.ts`,
   `verify.test.ts`, `validate.py`, `budget-status.py`
5. Remove exclusion rules from `CLAUDE.md`, `autonomous-work-cycle.md`, `/orient`
6. Update `docs/status.md` (3→2 projects), `docs/roadmap.md` (remove RQ, milestone,
   priority), `decisions/0020` (remove sim-game migration section and table row),
   `APPROVAL_QUEUE.md` (remove resolved sim-game items)
7. Update project count in `design-patterns.md` and `paper.md`; keep historical
   evidence references intact

### Step 4: Pattern-centric knowledge architecture

**Rationale.** The `experiments/` directory contains 70 records organized around
work done, not knowledge produced. Only 5-6 records are cited as evidence in
`design-patterns.md`. 64 of 70 contain only a single `EXPERIMENT.md` — no config,
results, or analysis artifacts. The `patterns/` directory has only 2 of 7 patterns
developed as individual files. The system's self-model is underdeveloped, and there
is no structured link between operational records and the patterns they inform.

A self-evolving system needs to: (1) understand its own capabilities and patterns,
(2) detect gaps from operational experience, (3) connect specific incidents to
specific patterns. The current flat `experiments/` structure supports none of these.

**Changes.**

1. **Update youji mission.** From "Develop and validate design patterns" to "Achieve
   fully autonomous research through self-evolution and AI-native research
   infrastructure." Done-when updated to reflect self-directed capability improvement.

2. **Expand `patterns/` to all 7 design patterns.** Create 5 new pattern files
   matching the depth of `autonomous-execution.md` (~200 lines each):
   `repo-as-cognitive-state.md`, `inline-logging.md`, `structured-work-records.md`,
   `layered-budget-enforcement.md`, `gravity-driven-migration.md`. Each includes
   staleness signals, evidence traces, self-evolution gaps, and open questions.

3. **Add `evidence_for` field to EXPERIMENT.md schema.** New optional frontmatter
   field: `evidence_for: [pattern-slug, ...]`. Values are pattern slugs matching
   `patterns/*.md` filenames. Enables machine-readable evidence chains. Validator
   updated to accept and validate slugs.

4. **Tag existing evidence-bearing records.** ~23 records tagged with `evidence_for`.

5. **Reclassify operational records by function.** Instead of a flat `experiments/`:
   ```
   projects/youji/
   ├── experiments/    ← only true experiments (~10 dirs, hypothesis-driven)
   ├── feedback/       ← PI feedback processing records (16 files)
   ├── analysis/       ← analytical work (16 files)
   ├── architecture/   ← implementations, bugfixes, infra work (29 files)
   ├── patterns/       ← 7 design pattern files
   ```
   Records are moved from `experiments/<name>/EXPERIMENT.md` to `<category>/<name>.md`
   (flat files, no subdirectories needed for single-file records).

6. **Untrack runner artifacts.** `git rm --cached` for output.log,
   runner_stderr.log, canary.log, progress.json, run.log, .bak files (~21 tracked
   files). Added `projects/.gitignore` to prevent re-tracking. Files kept on disk.

7. **Update `design-patterns.md`.** Now references `patterns/*.md` for full detail.
   The pipeline: `patterns/*.md` → `design-patterns.md` → `publications/paper.md`.

### Step 5: Clean up dangling and stale files

**Rationale.** After Steps 1-4, the repo accumulated stale artifacts: superseded
one-time reports still tracked, misplaced files not yet relocated per ADR 0020/0028
conventions, empty directories left behind by moves, and `__pycache__` litter across
the working tree.

**Changes.**

1. **Remove 3 stale tracked files.**
   - `DEEP_WORK_REPORT.md` — one-time session report (2026-02-17), all issues resolved,
     superseded by structured experiment records.
   - `HEARTBEAT.md` — simple checklist (2026-02-15), superseded by scheduler's built-in
     heartbeat (`infra/scheduler/src/notify.ts`).
   - `projects/youji/orientation-2026-02-20.md` — ephemeral session artifact committed
     by mistake; orientation outputs are not permanent records.

2. **Relocate 2 misplaced files.**
   - `projects/<project>/diagnosis-budget-discrepancy-2026-02-17.md` → `projects/<project>/diagnosis/`
     (per ADR 0020 convention).
   - `projects/youji/experiments/tdd-compliance-audit/analyze.py` → `projects/youji/analysis/tdd-compliance-audit-analyze.py`
     (orphaned after EXPERIMENT.md moved to `analysis/` in Step 4; empty experiment dir removed).

3. **Delete untracked remnants.** `plan.md` (session planning artifact) and
   `projects/3dai-simulation-game/` (removed from git in Step 3; only `__pycache__`
   and runtime state remained on disk).

4. **Remove empty directories.** `model-comparison-focused/{analysis,results}`,
   `per-category-llm-accuracy/analysis/`, and other empty output directories.

5. **Clean all `__pycache__/` directories.** Root `.gitignore` already contains
   `__pycache__/`; this step only removed existing disk litter.

## Consequences

### Positive

- **Simpler work cycle.** One scheduler job, no exclusion rules, no special-case
  code paths. Every project in `projects/` is a valid task selection target.
- **Reduced infra complexity.** ~60 lines of savegame-specific code removed from
  4 infra files.
- **Cleaner mental model.** New agents (and humans) see only active projects.

### Negative

- **Historical references.** Some markdown links to `projects/3dai-simulation-game/`
  in historical records (log entries, experiment findings) are now dead links.
  This is acceptable — they point to git history, and the records note the removal.
- **Evidence base.** The design patterns document originally drew evidence from
  3 projects. The evidence remains valid (it describes historical observations)
  but the sim-game project can no longer be inspected live.
