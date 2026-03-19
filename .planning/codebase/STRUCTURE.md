# Codebase Structure

**Analysis Date:** 2026-03-17

## Directory Layout

```
Youji/                          # Repo root — also the agents' persistent brain
├── CLAUDE.md                   # Agent operating manual (conventions, schemas, SOPs)
├── APPROVAL_QUEUE.md           # Pending human approval items
├── README.md                   # Human-facing overview
├── .claude/                    # Claude Code configuration
│   └── skills/                 # 25 encoded judgment procedures (L3 capability layer)
│       ├── orient/             # Session-start situational awareness skill
│       ├── compound/           # Post-session knowledge embedding skill
│       ├── design/             # Experiment design skill
│       ├── critique/           # Adversarial review skill
│       ├── diagnose/           # Error analysis skill
│       └── ...                 # 20 more skills
├── decisions/                  # 67 architectural decision records (ADRs)
├── docs/                       # Design rationale, conventions, SOPs
│   ├── design.md               # Core repo-as-brain philosophy
│   ├── conventions/            # Extracted convention files (provenance, task lifecycle, etc.)
│   ├── schemas/                # Document schema templates
│   └── sops/                   # Standard operating procedures (autonomous-work-cycle.md, etc.)
├── examples/                   # Example project scaffold
│   └── my-research-project/    # Reference structure for new projects
├── infra/                      # Shared tooling used across projects
│   ├── scheduler/              # TypeScript cron scheduler and session orchestrator
│   │   ├── src/                # Scheduler source code
│   │   │   ├── cli.ts          # CLI entry point (start, add, list, run, status)
│   │   │   ├── service.ts      # Polling daemon (SchedulerService)
│   │   │   ├── executor.ts     # Agent session spawner with pre/post-processing
│   │   │   ├── agent.ts        # Unified agent spawner (profiles, team sessions)
│   │   │   ├── backend.ts      # Backend abstraction (Claude SDK, opencode, cursor)
│   │   │   ├── types.ts        # Core type definitions (Job, FleetTask, Schedule, etc.)
│   │   │   ├── store.ts        # JSON file persistence for jobs
│   │   │   ├── schedule.ts     # Cron/interval computation (croner)
│   │   │   ├── verify.ts       # Post-session git-observed SOP compliance checks
│   │   │   ├── metrics.ts      # Session metrics JSONL storage
│   │   │   ├── budget-gate.ts  # Pre-session budget enforcement gate
│   │   │   ├── orient-tier.ts  # Fast/full orient/compound tier decisions
│   │   │   ├── task-parser.ts  # TASKS.md parsing utilities
│   │   │   ├── push-queue.ts   # Serialized git push queue for fleet concurrency
│   │   │   ├── rebase-push.ts  # Rebase-then-push with fallback branch logic
│   │   │   ├── auto-commit.ts  # Pre/post-session orphaned file auto-commit
│   │   │   ├── slack.ts        # Slack notification integration
│   │   │   ├── session.ts      # Active session registry and supervision
│   │   │   ├── notify.ts       # Approval queue reader and notification dispatch
│   │   │   ├── team-session.ts # Agent Teams configuration (analyst + builder subagents)
│   │   │   └── api/            # Local HTTP control API
│   │   │       └── server.ts   # HTTP server (status, push queue, task claim, experiments)
│   │   ├── reference-implementations/  # Reference-only code (not production)
│   │   │   ├── slack/          # Slack bot reference implementation
│   │   │   └── fleet/          # Fleet worker reference implementation
│   │   ├── package.json        # Node.js dependencies
│   │   ├── tsconfig.json       # TypeScript configuration
│   │   └── vitest.config.ts    # Test configuration
│   ├── experiment-runner/      # Python fire-and-forget experiment launcher
│   │   └── run.py              # Main launcher script
│   └── budget-verify/          # Python budget cross-verification tools
│       ├── budget-status.py    # Budget dashboard across all projects
│       ├── verify.py           # Full verification against CF Gateway logs
│       └── auto-ledger.py      # Automated ledger entry generation
└── projects/                   # Research projects (one directory per project)
    └── youji/                  # Meta-project: system self-study
        ├── README.md           # Project context, reverse-chronological log, open questions
        ├── TASKS.md            # Task queue with lifecycle tags
        ├── budget.yaml         # Resource budget definition
        ├── patterns/           # 7 design patterns extracted from operational history
        ├── analysis/           # Analysis artifacts
        ├── diagnosis/          # Diagnosis artifacts
        └── plans/              # Planning documents
```

## Directory Purposes

**`.claude/skills/`:**
- Purpose: Encoded judgment procedures (L3 capability layer) — invokable by agents with `/skill-name`
- Contains: One subdirectory per skill, each with `SKILL.md` (YAML frontmatter + procedure + output template)
- Key files: `.claude/skills/orient/`, `.claude/skills/compound/`, `.claude/skills/design/`

**`decisions/`:**
- Purpose: Immutable record of every significant architectural choice — the consistency anchor preventing agents from re-litigating resolved questions
- Contains: 67 ADRs named `NNNN-kebab-case-title.md` with date, status, context, decision, consequences
- Key files: `decisions/0001-initial-structure.md` through `decisions/0067-*.md`

**`docs/`:**
- Purpose: Design rationale, conventions, SOPs — the reference material agents read during orient and task execution
- Contains: Design philosophy, skill classifications, convention files, schema templates, SOPs
- Key files: `docs/design.md`, `docs/sops/autonomous-work-cycle.md`, `docs/conventions/`

**`infra/scheduler/src/`:**
- Purpose: The only production TypeScript source code in the repo — the session orchestration engine
- Contains: All scheduler modules — daemon, executor, agent spawner, backends, verification, metrics, push queue, API server
- Key files: `cli.ts` (entry point), `executor.ts` (session lifecycle), `service.ts` (polling daemon), `types.ts` (shared types)

**`infra/experiment-runner/`:**
- Purpose: Python utility for fire-and-forget experiment submission with budget safeguards
- Contains: `run.py` (launcher), tests, dedup audit
- Key files: `infra/experiment-runner/run.py`

**`infra/budget-verify/`:**
- Purpose: Resource consumption verification cross-referencing ledger vs. Cloudflare AI Gateway logs
- Contains: `budget-status.py` (dashboard), `verify.py` (full verification), `auto-ledger.py` (automation)
- Key files: `infra/budget-verify/budget-status.py`, `infra/budget-verify/verify.py`

**`projects/<name>/`:**
- Purpose: Self-contained research project directory — one agent pointed at a project directory has full context
- Contains: `README.md` (log + context), `TASKS.md` (task queue), `budget.yaml`, `ledger.yaml`, experiments, analysis, postmortems
- Key files: `projects/youji/README.md`, `projects/youji/TASKS.md`

**`.scheduler/` (generated, gitignored):**
- Purpose: Runtime state for the scheduler daemon — not committed
- Contains: `jobs.json` (job definitions and state), `logs/` (session text logs), `metrics/sessions.jsonl` (structured metrics)

## Key File Locations

**Entry Points:**
- `infra/scheduler/src/cli.ts`: CLI for all scheduler operations (add job, start daemon, run, status, health check)
- `infra/experiment-runner/run.py`: Experiment submission entry point

**Configuration:**
- `CLAUDE.md`: Agent operating manual — the most important file in the repo; every agent session reads it
- `infra/scheduler/package.json`: Node.js dependencies and build scripts
- `infra/scheduler/tsconfig.json`: TypeScript compiler configuration
- `infra/scheduler/vitest.config.ts`: Test runner configuration
- `infra/budget-verify/pixi.toml`: Python environment for budget tools

**Core Logic:**
- `infra/scheduler/src/executor.ts`: Full agent session lifecycle (pre-processing, spawn, post-processing, push, metrics)
- `infra/scheduler/src/agent.ts`: Agent profiles, team session configuration, unified spawner
- `infra/scheduler/src/backend.ts`: Backend abstraction (Claude SDK vs. opencode vs. cursor with fallback)
- `infra/scheduler/src/verify.ts`: Post-session compliance checking (log entry, commits, footer, ledger)
- `infra/scheduler/src/budget-gate.ts`: Pre-session budget enforcement

**Governance State:**
- `APPROVAL_QUEUE.md`: Human approval items — agents write here for gated operations
- `decisions/`: 67 ADRs — the consistency anchor across sessions
- `docs/conventions/enforcement-layers.md`: Canonical L0/L2 enforcement table

**Testing:**
- `infra/scheduler/src/*.test.ts`: Co-located unit/integration tests for all scheduler modules

## Naming Conventions

**Files:**
- TypeScript source: `kebab-case.ts` (e.g., `budget-gate.ts`, `task-parser.ts`)
- TypeScript tests: `kebab-case.test.ts` co-located with source
- Decision records: `NNNN-kebab-case-title.md` (e.g., `0061-push-queuing.md`)
- Experiment directories: `<short-description>-YYYY-MM-DD/` (e.g., `style-eval-2026-02-15/`)
- Diagnosis files: `diagnosis-<description>-YYYY-MM-DD.md`
- Postmortem files: `postmortem-<description>-YYYY-MM-DD.md`
- Architecture files: `architecture-<description>-YYYY-MM-DD.md`
- Skills: lowercase single-word or hyphenated (e.g., `orient`, `audit-references`)

**Directories:**
- Project directories: lowercase hyphenated (e.g., `my-research-project`)
- Infra tools: lowercase hyphenated (e.g., `experiment-runner`, `budget-verify`)
- Project subdirs: lowercase plural nouns (e.g., `experiments/`, `analysis/`, `diagnosis/`, `postmortem/`, `patterns/`)

**TASKS.md task tags:**
- Lifecycle: `[in-progress: YYYY-MM-DD]`, `[blocked-by: description]`, `[approval-needed]`, `[approved: YYYY-MM-DD]`
- Routing: `[fleet-eligible]`, `[requires-opus]`, `[zero-resource]`
- Skill: `[skill: record]`, `[skill: execute]`, `[skill: analyze]`, `[skill: orient]`, `[skill: multi]`, etc.

## Where to Add New Code

**New Scheduler Feature:**
- Implementation: `infra/scheduler/src/<feature-name>.ts`
- Tests: `infra/scheduler/src/<feature-name>.test.ts`
- If it changes enforcement: update `docs/conventions/enforcement-layers.md`
- If it's a significant architectural choice: create `decisions/NNNN-<title>.md`

**New Skill:**
- Create directory: `.claude/skills/<name>/`
- Create file: `.claude/skills/<name>/SKILL.md` with YAML frontmatter and procedure
- Update skill inventory comment in `projects/youji/patterns/skills-architecture.md`
- Update `docs/skill-classifications.md` to classify autonomous vs. human-triggered

**New Research Project:**
- Create directory: `projects/<name>/`
- Required files: `README.md` (from `docs/schemas/project-readme.md` template), `TASKS.md`, `budget.yaml`
- Optional at creation: `ledger.yaml`, `experiments/`, `analysis/`
- Use `examples/my-research-project/` as reference scaffold

**New Decision Record:**
- Create file: `decisions/NNNN-<kebab-title>.md` (increment NNNN by 1)
- Use schema from `docs/schemas/decision-record.md`
- If ADR contains action items not implemented in the same session, create tasks in relevant `projects/*/TASKS.md`

**New Infra Tool:**
- Create directory: `infra/<tool-name>/`
- Required: `README.md` following the same schema as project READMEs (`docs/schemas/project-readme.md`)
- Source code lives here (exception to "code lives elsewhere" rule for `projects/`)

**New Convention:**
- If unconditional and applies every session → add to `CLAUDE.md` as L2 convention
- If complex enough to warrant a separate file → create `docs/conventions/<name>.md` and link from `CLAUDE.md`
- If code-enforceable → implement in `infra/scheduler/src/verify.ts` as L0 check and update `docs/conventions/enforcement-layers.md`

**Utilities:**
- Shared scheduler helpers: `infra/scheduler/src/` (co-locate with related module)
- Python utilities for research projects: `infra/experiment-runner/` or `infra/budget-verify/`

## Special Directories

**`.scheduler/`:**
- Purpose: Runtime state — job definitions, session logs, metrics
- Generated: Yes (by the scheduler daemon at runtime)
- Committed: No (in `.gitignore`)

**`.planning/`:**
- Purpose: Planning documents for GSD planning sessions
- Generated: Yes (by GSD tooling)
- Committed: No (in `.gitignore`)

**`decisions/`:**
- Purpose: Immutable architectural history — every significant choice recorded with context and rationale
- Generated: No (written by agents/humans)
- Committed: Yes (primary consistency mechanism for multi-session coherence)

**`infra/scheduler/reference-implementations/`:**
- Purpose: Reference code (Slack bot, fleet system) that is not intended to run out-of-the-box — provided as reading material for agents adapting patterns
- Generated: No
- Committed: Yes (documentation by code)

**`infra/scheduler/node_modules/`:**
- Purpose: npm dependencies
- Generated: Yes (`npm install`)
- Committed: No (in `.gitignore`)

---

*Structure analysis: 2026-03-17*
