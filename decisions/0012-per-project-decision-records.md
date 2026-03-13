# ADR-0012: Per-project decision records

Date: 2026-03-13
Status: accepted
Adapted from: OpenAkari ADR-0035

## Context

All decision records live in a single centralized `decisions/` directory. Most ADRs are system-wide, and the current scale doesn't justify restructuring.

However, **project-scoped strategic pivots** — decisions like "we're pivoting this project from approach A to approach B" or "this project should target a different evaluation paradigm" — don't have a good home in the centralized directory. These decisions:

- Are high-stakes and often irreversible
- Need historical context specific to that project
- Are exactly what a future session needs when working on that project
- Get buried among system-wide ADRs in the centralized directory

## Decision

Establish a dual-level decision record convention:

**System-wide decisions** stay in `decisions/NNNN-title.md` (centralized, globally numbered). These include: repo conventions, agent behavior rules, cross-project standards, infrastructure patterns.

**Project-direction decisions** go in `projects/<project>/decisions/NNNN-title.md` (per-project, project-scoped numbering starting at 0001). These include: strategic pivots, methodology changes, scope redefinitions, approach changes, evaluation strategy shifts.

### Scope rule

If a decision affects how Youji behaves across the repo, it goes in centralized `decisions/`. If a decision affects what a specific project is doing or how it's approaching its mission, it goes in the project's `decisions/`. When in doubt, centralize — the cost of a misplaced centralized ADR is lower than a missed cross-cutting decision.

### Format

Project decisions use the same ADR schema as centralized decisions. Numbering is independent per project (each starts at 0001).

### Session behavior

- When working on a project, check both `decisions/` and `projects/<project>/decisions/`
- Orient reads project `decisions/` during orientation
- Cross-references use explicit paths for clarity

## Consequences

- Projects gain a structured mechanism for recording strategic direction changes
- Sessions must check two locations for decision records (minor overhead, high value)
- Centralized `decisions/` remains the primary location; per-project directories are optional
- No migration needed for existing ADRs — convention applies to new decisions going forward
- Projects create their `decisions/` directory on first use
