# 0035: Per-Project Decision Records

Date: 2026-02-24
Status: accepted

## Context

All 35 existing decision records live in a single centralized `decisions/` directory. Initial analysis (feedback-per-project-decision-records.md) recommended keeping this structure, noting that 80% of ADRs are system-wide and the current scale (3 projects, 35 ADRs) doesn't justify restructuring.

However, the PI identified a gap: **project-scoped strategic pivots** — decisions like "we're pivoting project-X from approach-A to approach-B" or "project-Y should target a different evaluation paradigm" — don't have a good home. These decisions:

- Are high-stakes and irreversible (you can't un-pivot)
- Need historical context specific to that project
- Are exactly what a future agent session most needs to find when working on that project
- Don't fit naturally in `analysis/` or `architecture/` (which are retrospective records, not forward-looking direction choices)
- Get buried in the centralized `decisions/` directory among system-wide ADRs

## Decision

Establish a dual-level decision record convention:

**System-wide decisions** stay in `decisions/NNNN-title.md` (centralized, globally numbered). These include: repo conventions, agent behavior rules, scheduler configuration, cross-project standards, infrastructure patterns.

**Project-direction decisions** go in `projects/<project>/decisions/NNNN-title.md` (per-project, project-scoped numbering starting at 0001). These include: strategic pivots, methodology changes, scope redefinitions, approach changes, evaluation strategy shifts — decisions that fundamentally alter a project's direction.

**Scope rule:** If a decision affects how agents behave across the repo, it goes in centralized `decisions/`. If a decision affects what a specific project is doing or how it's approaching its mission, it goes in the project's `decisions/`. When in doubt, centralize — the cost of a misplaced centralized ADR is lower than a missed cross-cutting decision.

**Format:** Project decisions use the same ADR schema as centralized decisions (NNNN-title.md with Date, Status, Context, Decision, Consequences sections). Numbering is independent per project (each starts at 0001).

**Agent behavior:**
- When working on a project, check both `decisions/` and `projects/<project>/decisions/` for relevant prior art
- `/orient` reads project `decisions/` during orientation alongside knowledge.md and TASKS.md
- Cross-references use explicit paths: `decisions/0035-...` for centralized, `projects/<project>/decisions/0001-...` for project-scoped

## Consequences

- Projects gain a structured mechanism for recording strategic direction changes, distinct from operational analysis records
- Agents must check two locations for decision records when working on a project (minor overhead, high value for direction decisions)
- The centralized `decisions/` directory remains the primary location; per-project directories are optional and used only when a project has project-direction decisions to record
- Existing project-scoped ADRs in centralized `decisions/` (e.g., 0013, 0034) remain where they are — no migration. The convention applies to new decisions going forward
- CLAUDE.md updated: Decision record schema, Decisions convention, Project READMEs section
- Orient skill updated to read project `decisions/` during orientation

### Migration

None required for existing ADRs. The convention applies to new decisions going forward. Projects create their `decisions/` directory on first use (same pattern as `diagnosis/`, `postmortem/`, etc.).
