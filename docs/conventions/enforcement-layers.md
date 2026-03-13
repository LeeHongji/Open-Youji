Convention enforcement layers for Youji.

## Overview

Conventions are enforced at different layers. This document defines the canonical L0/L2 tables.

**L0 (code-enforced)**: Automatically blocked or detected by code (validators, pre-commit hooks, tests, etc.). These are hard gates -- violations are caught mechanically.

**L2 (convention-only)**: Require Youji to self-enforce. These are behavioral rules encoded in documentation. Violations are caught by `/self-audit`, `/compound`, or researcher review.

## L0: Code-enforced conventions

| Convention | Enforcement mechanism | What it catches |
|-----------|----------------------|-----------------|
| Commit message format | Pre-commit hook (if configured) | Malformed commit messages |
| Test passage | `npm test` / `pytest` | Code regressions |
| EXPERIMENT.md schema | Validator (if configured) | Missing frontmatter, wrong sections |
| Budget pre-check | Budget gate (if configured) | Experiments exceeding budget |
| Literature citation validity | URL verification via WebFetch | Fabricated citations |

## L2: Convention-only enforcement

| Convention | Where documented | Self-check mechanism |
|-----------|-----------------|---------------------|
| Inline logging | CLAUDE.md, this file | `/compound` checks for missing findings |
| Provenance on claims | `docs/conventions/provenance.md` | `/self-audit`, `/critique` |
| Session log entry | `docs/sops/autonomous-work-cycle.md` | `/self-audit` |
| Task lifecycle tags | `docs/sops/task-lifecycle.md` | `/self-audit` |
| Incremental commits | CLAUDE.md | Session metrics (commits count) |
| Fire-and-forget experiments | CLAUDE.md, work cycle SOP | Self-discipline during execution |
| No sleep >30s | CLAUDE.md | Self-discipline during execution |
| Budget recording | `docs/conventions/resource-constraints.md` | `/self-audit` |
| Temporal reasoning accuracy | `docs/conventions/temporal-reasoning.md` | Manual review |
| Decision record creation | `docs/conventions/decisions.md` | `/compound` convention drift check |
| Convention propagation | CLAUDE.md | Same-turn update discipline |

## Adding new enforcement

When adding a new enforcement mechanism:
1. Determine the appropriate layer (L0 or L2)
2. Update this document in the same turn
3. If L0: implement the enforcement code
4. If L2: document in the relevant convention file and add to the self-check mechanism column

## Promotion from L2 to L0

When a convention violation recurs 3+ times (gravity signal), evaluate whether it can be promoted from L2 (convention-only) to L0 (code-enforced). Use the `/gravity` skill for structured evaluation.

Criteria for promotion:
- The convention is mechanically verifiable (not judgment-dependent)
- The enforcement code is simple and reliable
- The cost of false positives is low
- The convention is stable (not still evolving)
