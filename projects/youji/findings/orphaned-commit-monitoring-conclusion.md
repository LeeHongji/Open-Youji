# Finding: Orphaned Commit Monitoring — Conclusion

Date: 2026-03-14
Project: youji
Related: diagnosis/orphaned-commit-attribution-loss.md

## Monitoring period

Sessions 4–8 (5 autonomous sessions post-diagnosis).

## Data

| Metric | At diagnosis (session 4) | At cycle 002 (session 5) | Final (session 8) |
|--------|-------------------------|--------------------------|-------------------|
| Total commits | 10 | 15 | 23 |
| Orphaned commits | 4 | 5 | 8 |
| Orphaned rate | 40.0% | 33.3% | 34.8% |
| Autonomous orphaned | 0 | 0 | 0 |
| Interactive orphaned | 4 (100%) | 5 (100%) | 8 (100%) |

Source: `git log --oneline` at each measurement point, manual classification.

## Key findings

1. **Orphaned rate stabilized at ~35%, well above the 20% threshold.** The rate declined slightly from 40% to 34.8% due to more autonomous commits diluting the ratio, not because interactive sessions improved.

2. **100% of orphaned commits originate from interactive sessions.** Zero autonomous sessions produced orphaned files across 8 consecutive autonomous sessions (sessions 1–8). The autonomous work cycle (orient → execute → commit → push) prevents orphaning by design.

3. **Root cause confirmed: interactive sessions lack commit enforcement.** The researcher exits interactive sessions without committing, leaving the scheduler's auto-commit mechanism to clean up with generic messages.

## Decision

**Implement Fix 1 (descriptive auto-commit messages)** as recommended in the diagnosis.

Rationale:
- Rate (34.8%) exceeds the 20% threshold established in the diagnosis
- Fix 1 is low-effort (single function change) and preserves at least "what changed" in orphaned commits
- Fix 3 (accept as bootstrapping cost) is rejected — the pattern is recurring, not transient
- Fix 2 (interactive session reminder) is deferred — requires changes to the interactive workflow, not the scheduler

## Implementation

Modified `buildOrphanSummary()` in `infra/scheduler/src/git.ts`. Auto-commit messages now list changed file names:
- Before: `auto-commit: orphaned files from previous session`
- After: `auto-commit: orphaned changes — session.ts, git.ts, index.ts`
- Truncation: if message exceeds 72 chars, shows first 3 files + count

## Verification

All 32 tests pass including new assertion that commit message contains file names.
