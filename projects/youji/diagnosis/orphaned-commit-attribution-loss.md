# Diagnosis: Orphaned Commit Attribution Loss

Date: 2026-03-14
Project: youji
Type: self-observation diagnosis
Related failure mode: #3 (Statelessness weakens feedback loops) from self-observation-examples.md

## Problem

40% of Youji's git history consists of generic "auto-commit: orphaned files from previous session" commits. These commits contain real work — including a 192-line multi-agent configuration feature — but strip away all attribution, context, and provenance.

## Evidence

### Orphaned commit inventory

| Commit | Files | Lines changed | Likely source session | Content |
|--------|-------|---------------|----------------------|---------|
| b120409 | 1 | +11/-2 | Interactive (S8, debug) | session.ts output capture |
| bc4680d | 7 | +192/-22 | Interactive (S10, config) | Full multi-agent scheduler config: types, git, session, scheduler, index, tests |
| 19ac13d | 1 | +5/-3 | Interactive (S13, fix) | session.ts stdin blocking fix |
| ad126ef | 2 | +36/-2 | Interactive/autonomous (S15) | Autonomous session settings + prompt optimization |

**Total**: 4 orphaned commits / 10 total commits = 40%
**Total orphaned lines**: +244/-29 = 273 lines of changes with no descriptive commit message

Source: `git show --stat` for each commit, cross-referenced with scheduler history and session timeline

### The worst case: bc4680d

This single orphaned commit contains 192 insertions across 7 files — an entire multi-agent deployment feature. It includes:
- New type definitions (`types.ts`)
- Enhanced git automation with sensitive file filtering (`git.ts`, `git.test.ts`)
- Supervisor and fleet session configuration (`session.ts`, `index.ts`)
- Updated scheduler configuration (`scheduler.ts`, `scheduler.test.ts`)

A fresh session reading the git log sees only "auto-commit: orphaned files" — it cannot determine what this change does, why it was made, or what decision drove the design.

### How the auto-commit mechanism works

The scheduler's `autoCommitOrphanedFiles()` function (in `infra/scheduler/src/git.ts`) runs at the start of each session. It detects uncommitted changes from a previous session, stages them, and commits with the generic message "auto-commit: orphaned files from previous session". This preserves the code but destroys the context.

## Root cause analysis

The orphaned files come primarily from **interactive sessions** where the researcher and Youji worked together on scheduler infrastructure. These sessions:

1. Made changes across multiple files
2. Did not commit incrementally (violating session-discipline convention)
3. Ended without a final commit (the researcher may have exited to restart the scheduler)
4. Left the working tree dirty for the auto-commit mechanism to clean up

The convention says "commit incrementally after each logical unit of work" — but this convention is enforced only in autonomous sessions (via the /orient → /compound work cycle). Interactive sessions have no enforcement mechanism.

## Impact

1. **Lost provenance**: 273 lines of changes cannot be traced to a specific decision, session, or purpose from git log alone
2. **Inflated noise ratio**: 40% of commits are uninformative, making `git log` less useful for future sessions
3. **Metric distortion**: Session productivity metrics (commits per session, changes per commit) are skewed by orphaned commits attributed to the wrong session

## Proposed fixes

### Fix 1: Descriptive auto-commit messages (low effort, high impact)

Enhance `autoCommitOrphanedFiles()` to generate a descriptive commit message from the diff. Instead of "auto-commit: orphaned files from previous session", use:

```
auto-commit: orphaned changes — <list of changed files/modules>
```

This preserves at least the "what" even if the "why" is lost.

### Fix 2: Interactive session commit reminder (medium effort)

Add a pre-session check: if the scheduler detects uncommitted changes AND the previous session was interactive (no scheduler session ID), log a warning and prompt the autonomous session to review the changes before auto-committing.

### Fix 3: Accept as bootstrapping cost (no effort)

The orphaned commits all occurred on 2026-03-14, the first day of Youji's operation. They may reflect one-time infrastructure setup rather than a recurring pattern. If orphaned commits drop to <10% over the next 5 sessions, no fix is needed.

## Follow-up task

Monitor orphaned commit rate over the next 5 autonomous sessions. If rate stays above 20%, implement Fix 1.

## Significance

This diagnosis is itself an example of self-observation: the system examined its own git history, identified a pattern (40% orphaned commits), traced the root cause (interactive sessions not committing), and proposed a verifiable fix. The diagnosis is grounded in mechanical evidence (git log, commit stats) rather than narrative claims — following the core lesson from self-observation-examples.md.
