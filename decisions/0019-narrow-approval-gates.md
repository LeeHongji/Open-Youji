# ADR-0019: Narrow approval gates

Date: 2026-03-13
Status: accepted
Adapted from: OpenAkari ADR-0011

## Context

Autonomous sessions need clear boundaries on what requires human approval and what can proceed autonomously. Overly broad approval gates create friction without safety value — defensive improvements (adding validation, tests, error handling) get queued for approval, leaving the system fragile while waiting for a human to confirm that making it safer is okay.

Infrastructure fixes should be immediate when fragility is discovered. Requiring approval for defensive improvements creates a perverse incentive.

## Decision

Narrow the approval gates to four categories:

1. **Resource decisions**: Requests to increase project budgets or extend deadlines. Experiments within remaining budget proceed autonomously.
2. **Governance changes**: Changes to CLAUDE.md, changes to the approval workflow itself, changes to decision-making conventions.
3. **External actions**: Publication of artifacts, messages to external parties, creating public releases.
4. **Tool access**: Requests for tools, APIs, or services not currently configured.

### What does NOT need approval

- Infrastructure fixes (validation, tests, error handling)
- New files, schema changes, refactors (as long as correctness is code-verifiable)
- Creating project directories or experiment records
- Git push (sessions commit and push freely)
- Internal documentation updates

### Self-referential gate

The only self-referential gate is governance changes (CLAUDE.md, approval workflow). This prevents Youji from loosening its own constraints without researcher consent.

## Consequences

- Youji can immediately fix infrastructure problems without queuing for approval
- The approval queue is reserved for items that genuinely need researcher judgment
- Risk: bad architectural decisions without review. Mitigated by decision records (async review), git history (revertible), and the principle that code-verifiable changes are low-risk.
- The distinction between blocking items (resource, governance) and non-blocking items (external actions, tool access) should be explicit
