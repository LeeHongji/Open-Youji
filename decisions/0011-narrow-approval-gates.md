# 0011: Narrow Approval Gates

Date: 2026-02-16
Status: accepted

## Context

The v2 experiment postmortem identified 7 infrastructure safeguards (validation, tests, error handling) needed to prevent autonomous agents from wasting resources. These were queued for approval as "structural decisions that can't be statically verified," delaying fixes that would have prevented further waste.

Infrastructure fixes — adding input validation, schema checks, dry-run modes, integration tests, error propagation — are exactly what a research group should do immediately when fragility is discovered. Requiring approval for defensive improvements creates a perverse incentive: the system remains fragile while waiting for a human to confirm that making it safer is okay.

## Decision

Narrowed the approval gates to three categories (later extended to four with tool-access in [0024](0024-tool-access-approval.md)):

1. **Resource decisions**: Requests to increase `budget.yaml` limits or extend deadlines (experiments within remaining budget proceed autonomously)
2. **Governance changes**: CLAUDE.md changes, changes to the approval workflow itself
3. **External actions**: Git push, publication, messages to humans
4. **Tool access** (added by [0024](0024-tool-access-approval.md)): Requests for tools, APIs, or model access not currently configured. Task-blocking, not session-blocking.

Removed "structural decisions that can't be statically verified" as a gate. Infrastructure fixes, new files, schema changes, and refactors do not need approval as long as correctness is verifiable by code.

## Consequences

- Agents can immediately fix infrastructure problems (validation, tests, error handling) without queuing for approval.
- "New projects" no longer requires approval — agents can create project directories if needed. Project mission and done-when are still set by humans in practice (via Slack conversation), but the gate is social, not procedural.
- The only self-referential gate is governance changes (CLAUDE.md, approval workflow). This prevents agents from loosening their own constraints without human consent.
- Risk: agents could make bad architectural decisions without human review. Mitigated by: decision records (async review), git history (revertible), and the principle that code-verifiable changes are low-risk.
