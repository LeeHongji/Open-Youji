# ADR-0024: Self-audit weekly cadence

Date: 2026-03-13
Status: accepted
Adapted from: OpenAkari ADR-0063

## Context

Self-audits (convention compliance checks, cross-reference verification, status accuracy reviews) are valuable for maintaining repo health. However, without cadence enforcement, they can be generated too frequently — creating ceremony commits that add noise without proportional value.

OpenAkari observed 63 self-audit commits (7.9% of total) from frequent, uncadenced generation. Self-audits were being created per-project per-session, producing 12-24 ceremony commits per batch.

## Decision

Enforce weekly cadence for self-audit task generation:

1. Orient checks for recent compliance audits before creating new self-audit tasks
2. Projects with audits within the last 7 days are skipped
3. Check uses dated filenames to determine recency

### What counts as a self-audit

- Convention compliance checks (task tags, log format, provenance)
- Cross-reference verification (findings reflected in READMEs)
- Status accuracy reviews (project status, experiment status)
- Documentation coherence checks (README matches actual state)

### Cadence

- Weekly per project is sufficient for a single-researcher system
- Self-audits are zero-resource tasks and exempt from budget gates
- The compound phase (ADR-0007) handles per-session convention drift; self-audits handle accumulated drift

## Consequences

- Self-audit commit noise reduced significantly
- Compliance coverage remains weekly per project
- Orient respects the cadence, avoiding duplicate audit tasks
- The weekly cadence can be adjusted based on observed repo drift rate
