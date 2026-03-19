# 0025: Plan mode auto-approval for headless sessions

Date: 2026-02-20
Status: accepted

## Context

Deep work sessions (headless autonomous agents) repeatedly failed when using plan mode
tools. The ExitPlanMode tool in the Claude Agent SDK is designed for interactive
workflows: it expects a human to review and approve the plan before the agent proceeds.
In headless sessions, no human is present. The agent either (a) emits a text-only
"waiting for approval" message that the SDK treats as the final answer, terminating the
session, or (b) the SDK pauses waiting for user input that never arrives.

This failure occurred three times (2026-02-18, 2026-02-19, 2026-02-20), each costing
$1.79-$2.81 in wasted compute. The initial fix (commit 556055e) disabled plan mode
tools entirely via `disallowedTools`, but this reduced deep work capability — plan mode
is valuable for complex tasks that benefit from structured exploration before
implementation.

## Decision

Auto-approve plan mode in headless sessions by intercepting ExitPlanMode tool calls in
the message handler and injecting a synthetic user approval message via the SDK's
`streamInput()` API.

The mechanism:
1. Plan mode tools (EnterPlanMode, ExitPlanMode) remain **enabled** for deep work sessions.
2. The progress handler detects ExitPlanMode tool calls via `detectPlanMode: true`.
3. When detected, the handler reads the plan file and posts it to Slack for visibility.
4. An `onExitPlanMode` callback injects a synthetic `SDKUserMessage` via
   `handle.streamInput()` with content "Approved. Proceed with implementation."
5. The SDK receives this as user approval and unblocks the agent to continue.

This approach reuses the existing `streamInput` infrastructure already used for
forwarding human messages to running sessions (chat.ts lines 1092-1108).

### Alternatives considered

- **Disable plan mode tools** (previous fix): Simpler but removes capability. Deep work
  sessions lose the structured explore-then-implement workflow.
- **Prompt override only**: Tell the agent not to wait. Failed three times — tool
  descriptions override system prompt instructions at the point of use.
- **Custom tool replacement**: Replace ExitPlanMode with a no-op tool. More invasive and
  fragile across SDK updates.

## Consequences

- Deep work sessions can use full plan mode (EnterPlanMode → explore → ExitPlanMode →
  implement) without risk of premature termination.
- Plans are posted to Slack threads for human visibility before auto-approval.
- The `onExitPlanMode` callback pattern is extensible — other headless agent types
  (autofix, work sessions) can adopt it if needed.
- If the SDK changes how ExitPlanMode waits for input, the auto-approval may need
  updating. The current approach is robust because `streamInput` is the SDK's official
  input injection API.
