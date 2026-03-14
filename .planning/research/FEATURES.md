# Feature Landscape

**Domain:** Slack-based autonomous AI research agent
**Researched:** 2026-03-15
**Overall confidence:** HIGH (grounded in existing codebase analysis + reference implementation)

## Table Stakes

Features the mentor expects from day one. Missing any of these makes the system unusable or untrustworthy.

| # | Feature | Why Expected | Complexity | Notes |
|---|---------|--------------|------------|-------|
| T1 | **Slack message intake** | Mentor sends a message, Youji receives it and spawns a Claude CLI session. Without this, there is no interaction. | Med | Bolt Socket Mode is already proven in reference impl. Rewrite for Claude CLI backend instead of Agent SDK. |
| T2 | **Summary + thread response pattern** | Mentor needs a clean channel: one-line summary in channel, details in thread on demand. Without this, Slack becomes noisy and unusable. | Med | Reference impl has `living-message.ts` pattern. Adapt for Claude CLI output parsing. |
| T3 | **Scheduled autonomous sessions** | Agent must run on cron without human prompting. This is core to "autonomous" identity. | Low | Already exists in scheduler. Wire Claude CLI as the sole backend. |
| T4 | **Session status reporting** | Mentor must be able to ask "what are you doing?" and get a coherent answer, not silence. | Low | Reference impl has `/api/status` endpoint and living message state tracking. Expose via Slack command. |
| T5 | **Budget gate enforcement** | Sessions must not run when budget is exhausted. Without this, costs spiral silently. | Low | Already exists (`budget-gate.ts`). No changes needed beyond wiring to Claude CLI executor. |
| T6 | **Git commit + push on every session** | Every session must leave a trace in the repo. Without this, work is lost between stateless sessions. | Low | Already exists (push queue, SOP). |
| T7 | **Error reporting to Slack** | When a session fails (crash, timeout, budget block), mentor must be notified, not left wondering. | Low | Reference impl has `notifyBudgetBlocked`, `notifySessionComplete` stubs. Implement for real. |
| T8 | **On-demand session trigger** | Mentor sends a task in Slack, Youji executes it now (not at next cron tick). This is the core "assign a task" UX. | Med | Reference impl `chat.ts` has fire-and-forget spawn pattern. Reimplement with Claude CLI. |
| T9 | **Task result artifacts in repo** | Research findings, experiment records, analysis must be written to structured files in the repo, not just posted to Slack. Slack messages are ephemeral; repo is permanent. | Low | Already enforced by conventions (EXPERIMENT.md, project READMEs, log entries). |
| T10 | **Graceful session timeout** | Claude CLI sessions must have a max duration. Runaway sessions waste budget and block the scheduler. | Low | Executor already has `maxDuration` in job schema. Apply to Claude CLI process. |

## Differentiators

Features that make Youji genuinely useful as a research partner rather than a glorified chatbot.

| # | Feature | Value Proposition | Complexity | Notes |
|---|---------|-------------------|------------|-------|
| D1 | **PR-based self-evolution** | Youji identifies improvements to her own skills, conventions, or code and creates a GitHub PR for mentor review. This is the mechanism for Youji to grow smarter over time while maintaining human oversight. | High | Requires: Claude CLI can run `gh pr create`, branch management, diff generation. Safety gate: mentor must merge. Depends on: T8 (on-demand sessions). |
| D2 | **Research workflow: paper analysis** | Youji reads arxiv papers, extracts key findings, writes structured literature notes. This is the core "research assistant" value. | Med | Leverage existing `lit-review` and `horizon-scan` skills. Claude CLI has web fetch capability. Output: literature notes per schema. |
| D3 | **Research workflow: deep topic dives** | Mentor says "research X" and Youji produces a structured multi-source analysis over one or more sessions, with findings recorded in the repo. | Med | Existing skills (`design`, `synthesize`, `critique`) provide the judgment patterns. New: multi-session continuity via repo artifacts. |
| D4 | **Experiment submission + async results** | Youji sets up experiments, submits via experiment runner (fire-and-forget), and picks up results in a future session. Mentor gets notified when results are ready. | Med | Experiment runner already exists. New: Slack notification on experiment completion, result summary posted to thread. Depends on: T2, T7. |
| D5 | **Living message (real-time progress)** | While a session runs, a single Slack message updates in-place showing current activity, turn count, elapsed time. Mentor can glance at it without interrupting. | Med | Reference impl has full `living-message.ts` with persistence and recovery. Port to Claude CLI output stream parsing. |
| D6 | **Action tag confirmation** | For destructive or expensive operations, Youji posts a confirmation prompt in Slack before executing. Mentor approves or rejects inline. | Med | Reference impl has `action-tags.ts` with `findActionTag`, `buildConfirmPrompt`. Port as-is. Depends on: T8. |
| D7 | **Approval queue notifications** | When Youji encounters something requiring human approval (budget increase, governance change, production PR), she posts to Slack and waits. Mentor approves in Slack. | Med | APPROVAL_QUEUE.md already exists. New: Slack-native approval UX (button or reply). Reference impl has `buildApprovalBlocks`. |
| D8 | **Slack command interface** | `/youji status`, `/youji run <task>`, `/youji budget`, `/youji approve <id>`. Structured commands for common operations. | Med | Reference impl has `/youji` slash command with `channel-mode` subcommands. Extend for operational commands. |
| D9 | **Session watching** | Mentor can "watch" a running session: see buffered tool calls and agent reasoning streamed to a Slack thread. For debugging or curiosity. | High | Reference impl has `addWatcher`, `setWatchCallback` in `session.ts`. Requires Claude CLI stdout parsing and streaming to Slack. |
| D10 | **Skill invocation from Slack** | Mentor says "run /horizon-scan on diffusion models" and Youji invokes the named skill in a Claude CLI session. Direct access to the 26-skill library via natural language. | Low | Reference impl has `detectSkillInvocation`. Skills already exist. Wire skill name into Claude CLI `-p` prompt. |
| D11 | **Multi-session research continuity** | For complex research topics, Youji tracks progress across sessions using repo artifacts. Each session reads what previous sessions found and builds on it. | Low | This is already how the system works (repo as memory). The differentiator is making it visible: Slack thread links to repo artifacts, progress summaries. |
| D12 | **Budget dashboard in Slack** | Mentor asks "budget?" and gets a formatted summary of all project budgets, consumption, remaining capacity. | Low | `budget-status.py` already generates this. New: format output as Slack blocks. |

## Anti-Features

Features to deliberately NOT build. Each would add complexity without proportional value, or would violate architectural principles.

| # | Anti-Feature | Why Avoid | What to Do Instead |
|---|--------------|-----------|-------------------|
| A1 | **Web dashboard / GUI** | Adds a second interface to maintain. Slack is the sole human channel by design constraint. A dashboard splits attention and doubles the notification surface. | Use Slack Block Kit for rich formatting. For detailed views, link to GitHub repo files. |
| A2 | **Real-time log streaming to Slack** | Overwhelming. Agent sessions produce hundreds of tool calls. Streaming all of them to Slack creates noise the mentor will mute. | Living message (D5) for at-a-glance progress. Session watching (D9) as opt-in for deep debugging. Summary + thread (T2) for results. |
| A3 | **Multi-user / team support** | Single mentor by design. Multi-user adds auth, permissions, conflict resolution, and channel routing complexity that is not needed. | Keep single designated user. If team use emerges later, it is a separate project. |
| A4 | **Direct Anthropic API calls for sessions** | Claude CLI is the execution engine. Direct API calls bypass Claude Code's tooling (MCP servers, skills, CLAUDE.md loading) and create a parallel execution path to maintain. | All agent work goes through `claude -p` or `claude code`. API calls only for budget verification (CF Gateway). |
| A5 | **Slack interactive components (modals, buttons beyond confirmation)** | Modals require server-side state management and webhook routing. They add complexity for marginal UX improvement over text commands. | Use slash commands and natural language. Action tags (D6) for the one case where inline confirmation matters. |
| A6 | **Cloud deployment** | Runs on local Mac. Cloud adds infra management (containers, secrets, networking, uptime monitoring) without benefit for a single-user system. | pm2 on local Mac. If the Mac is off, Youji is off. Mentor knows this. |
| A7 | **Conversation memory in Slack** | Storing conversation history in Slack threads and replaying it to maintain multi-turn context across sessions. Slack threads are ephemeral UI; repo is memory. | All durable state goes to repo files. Slack is a notification channel, not a database. Reference impl's `chat-context.ts` gathers thread context for a single session's use, which is fine. |
| A8 | **Automatic self-modification without PR** | Allowing Youji to modify her own code and push directly. Violates the safety constraint. Even "safe" changes (typo fixes, convention updates) should go through PR review to maintain trust. | PR-based self-evolution (D1) with mandatory mentor review before merge. |
| A9 | **Mobile-optimized Slack formatting** | Over-engineering Block Kit layouts for mobile rendering. Slack's mobile app handles blocks adequately. | Use standard Block Kit patterns. Test on desktop. Mobile works well enough by default. |
| A10 | **Training / fine-tuning loops in-session** | Running GPU training or long compute inside the agent session. Sessions have a max duration and this causes timeouts. | Fire-and-forget via experiment runner (D4). Session submits, commits, ends. Future session analyzes results. |

## Feature Dependencies

```
T1 (Slack intake) ─────────────────┬──> T2 (summary + thread)
                                   ├──> T7 (error reporting)
                                   ├──> T8 (on-demand trigger)
                                   └──> T4 (status reporting)

T3 (scheduled sessions) ──────────> T6 (git commit)
                                   └──> T5 (budget gate)

T8 (on-demand trigger) ───────────> D1 (self-evolution PRs)
                                   ├──> D6 (action tag confirmation)
                                   ├──> D9 (session watching)
                                   └──> D10 (skill invocation)

T2 (summary + thread) ────────────> D4 (experiment notification)
                                   └──> D5 (living message)

T7 (error reporting) ─────────────> D7 (approval queue)

T4 (status reporting) ────────────> D8 (Slack commands)
                                   └──> D12 (budget dashboard)

D2 (paper analysis) ──────────────> D3 (deep topic dives)
                                   └──> D11 (multi-session continuity)
```

## MVP Recommendation

**Phase 1 — Core loop (must ship together):**
1. T1: Slack message intake via Bolt Socket Mode
2. T3: Scheduled sessions with Claude CLI backend
3. T8: On-demand session trigger from Slack
4. T2: Summary + thread response pattern
5. T6: Git commit on every session
6. T5: Budget gate enforcement
7. T10: Graceful session timeout
8. T7: Error reporting to Slack

These eight features form the minimum viable interaction loop: mentor sends task, Youji executes via Claude CLI, results appear in Slack and repo.

**Phase 2 — Research value:**
1. D2: Paper analysis workflow
2. D3: Deep topic research
3. D10: Skill invocation from Slack
4. D12: Budget dashboard
5. T4: Status reporting (enhanced)
6. D11: Multi-session research continuity

**Phase 3 — Polish and autonomy:**
1. D1: PR-based self-evolution
2. D5: Living message progress
3. D4: Experiment submission + async notification
4. D7: Approval queue in Slack
5. D6: Action tag confirmation

**Defer indefinitely:**
- D9 (session watching): High complexity, niche use case. Only build if mentor repeatedly finds themselves debugging sessions.
- D8 (Slack commands): Natural language via T8 covers most cases. Structured commands are nice-to-have.

## Sources

- Existing codebase: `infra/scheduler/` (architecture, executor, budget gate, push queue)
- Reference implementation: `infra/scheduler/reference-implementations/slack/` (Slack patterns, living message, chat, action tags)
- Project definition: `.planning/PROJECT.md` (requirements, constraints, decisions)
- Architecture document: `.planning/codebase/ARCHITECTURE.md` (component inventory)
- Skills inventory: `.claude/skills/` (26 skills including orient, compound, design, diagnose, lit-review, horizon-scan, coordinator)
- Slack App Manifest: `reference-implementations/slack/slack-app-manifest.yaml`
- Confidence: HIGH — all findings grounded in existing code and documented decisions, not external research
