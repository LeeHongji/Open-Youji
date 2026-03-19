# 0024: Tool Access Approval Gate

Date: 2026-02-20
Status: accepted

## Context

Autonomous agent sessions sometimes discover they need a tool (MCP server, API key,
model access) that is not currently configured in the environment. Currently there is
no approval category for this — the agent has no structured way to request
environmental configuration changes. The three existing approval types do not cover
this case:

- Resource decisions are about budget limits and deadlines.
- Governance changes are about rules and code contracts.
- External actions are about outbound effects (releases, publications).

Tool access is a fourth category: requesting that a human configure or provision an
environmental dependency so the agent can use it in future sessions.

## Decision

1. Add `tool-access` as a fourth approval type in APPROVAL_QUEUE.md.
2. Tool-access requests are **task-blocking, not session-blocking**. The agent:
   (a) writes to APPROVAL_QUEUE.md with type `tool-access`,
   (b) tags the current task `[blocked-by: tool-access approval for <tool>]`,
   (c) attempts to select a different task in the same session.
   If no other actionable task exists, ends the session cleanly.
3. The approval item includes a `Tool:` field (required) naming what is needed, and
   an optional `Configuration hint:` field with setup guidance the agent can infer.
4. Once a human configures the tool and resolves the approval item, a future session
   picks up the previously-blocked task.

## Consequences

- Agents can signal environmental gaps without inventing workarounds or failing silently.
- The task-blocking (not session-blocking) behavior is more efficient than the
  resource/governance pattern: the agent can continue with other work in the same session.
- Humans get clear, actionable requests: what tool, why, and how to configure it.
- No infrastructure code changes required — the `type` field in `notify.ts` is already
  a free string, and `tool-access` will be parsed and displayed correctly by existing code.
- This is the first task-blocking (vs. session-blocking) approval type, establishing a
  pattern for future approval categories that block one task but not all work.
