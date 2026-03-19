# 0063: Self-Audit Weekly Cadence

Date: 2026-03-04
Status: accepted

## Context

Self-audits were generated as individual fleet tasks per project without cadence enforcement. Each audit produces 2-3 commits. With 6+ active projects, a single batch generates 12-24 ceremony commits. Analysis showed 63 self-audit commits (7.9% of total) from frequent generation.

Decision 0050 specifies weekly frequency in the standing inventory, but no enforcement mechanism existed in the orient/orient-simple skills.

## Decision

Enforce weekly cadence for self-audit task generation:

1. Both `/orient` and `/orient-simple` skills now check for recent compliance audits before creating new self-audit tasks
2. Projects with audits within the last 7 days are skipped during fleet supply generation
3. Check uses `projects/*/diagnosis/compliance-audit-*.md` filenames with YYYY-MM-DD date extraction

## Consequences

- Self-audit commits reduced by ~6x (from batch-per-session to batch-per-week)
- Fleet supply generation still creates audits when genuinely needed
- Compliance audit coverage remains weekly per project (per ADR 0047)
- Ceremony commit noise significantly reduced

## Reference

- ADR 0047: Fleet supply maintenance obligation (standing inventory)
- ADR 0053: Fleet supply decomposition obligation
