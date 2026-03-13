# ADR-0026: Count-based log retention for project READMEs

Date: 2026-03-13
Status: accepted
Adapted from: OpenAkari ADR-0066

## Context

Project README log sections grow over time. With frequent autonomous sessions, a time-based retention rule ("keep the most recent 2-3 days") can produce hundreds of lines of log entries, making the README unwieldy. At high session frequency, the log section dominates the README, burying the project's status, mission, and open questions.

OpenAkari observed a project README reach 2,262 lines (168 log entries, 98.3% log content). A count-based retention approach emerged organically across projects before being formalized.

## Decision

### Rule: Keep no more than 5 log entries in README

- **Maximum entries**: 5 most recent log entries retained in the README `## Log` section
- **Archive trigger**: When entry count exceeds 5, archive oldest entries to a `log/` directory
- **Archive format**: `log/YYYY-MM-DD-slug.md` for individual entries, or `log/YYYY-MM-DD-archive-batchNN.md` for multi-entry archives
- **Batch archival**: When archiving, move all excess entries in a single commit

### Why 5

- Provides 1-2 sessions of recent context for orient/task-selection
- At ~13 lines/entry average, 5 entries = ~65 lines — keeps README navigable
- Small enough for readability; large enough to show recent activity pattern

### Secondary safety net

If 5 entries somehow exceed 150 lines (e.g., unusually long entries), archive sooner. The 150-line threshold is a secondary limit, not the primary trigger.

## Consequences

- READMEs remain navigable regardless of session frequency
- Count-based retention is simple and unambiguous
- Sessions needing deeper history check the `log/` directory
- Archival frequency increases with session frequency, but the mechanism is straightforward
- No change to archive format — just the trigger condition
