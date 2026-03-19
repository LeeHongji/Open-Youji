# 0021: Git Push Does Not Require Approval

Date: 2026-02-19
Status: accepted (supersedes relevant parts of 0005)

## Context

Autonomous sessions were listing git push under "EXTERNAL" actions in the SOP, requiring an approval queue entry before pushing. In practice this created friction without safety value — every session produced a git push approval item that was always approved (or rendered moot by manual pushes). The approval queue became noisy with routine push requests.

Meanwhile, creating GitHub releases and version tags is a genuinely consequential external action (it triggers downstream consumers and creates permanent public artifacts) and should retain an approval gate — but a non-blocking one, since there's no reason to halt the session while waiting.

## Decision

1. **Git push requires no approval.** Sessions commit and push freely. No approval queue entry needed.
2. **GitHub releases and version tags require a non-blocking approval queue entry.** Write to `APPROVAL_QUEUE.md` for visibility but continue working — do not end the session or wait for approval.
3. **Blocking approval items remain unchanged:** resource decisions (budget increases, deadline extensions) and governance changes (CLAUDE.md edits, approval workflow changes) still block the session.

Updated in: CLAUDE.md (approval gates), docs/sops/autonomous-work-cycle.md (task classification), decisions/0005-autonomous-execution.md (approval gates paragraph).

## Consequences

- Sessions no longer create approval queue entries for routine git pushes, reducing noise.
- The approval queue is reserved for items that genuinely need human judgment.
- GitHub releases/tags still get human visibility but don't block ongoing work.
- The distinction between blocking and non-blocking approval items is now explicit in all governance documents.
