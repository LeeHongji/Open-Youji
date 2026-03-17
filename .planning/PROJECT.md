# Open-Youji: Autonomous Research Institute Runtime

## What This Is

A self-operating autonomous research institute powered by LLM agents, where a persistent "director" agent (Youji) communicates with a human mentor via Slack, orchestrates worker agents to execute tasks in parallel git worktrees, and uses the repository as its sole persistent brain. All agent execution is powered by the Claude Agent SDK calling the local Claude Code CLI — no API keys or token-based billing.

## Core Value

Youji runs autonomously as a research institute director: she talks to the mentor via Slack, schedules and monitors worker agents, and keeps the research program moving forward — all without requiring the mentor to manage individual tasks or sessions.

## Requirements

### Validated

- :white_check_mark: Cron-based scheduler triggers agent sessions on schedule — existing (`infra/scheduler/`)
- :white_check_mark: Autonomous work cycle SOP (orient/select/classify/execute/compound/commit) — existing (`docs/sops/`)
- :white_check_mark: 25 encoded judgment skills for agent decision-making — existing (`.claude/skills/`)
- :white_check_mark: 67 architectural decision records for consistency — existing (`decisions/`)
- :white_check_mark: Push queue for serialized git push coordination — existing (`push-queue.ts`)
- :white_check_mark: Task claiming API to prevent duplicate pickup — existing (`/api/tasks/claim`)
- :white_check_mark: Fire-and-forget experiment submission — existing (`infra/experiment-runner/`)
- :white_check_mark: Convention and schema system (L0-L3) — existing
- :white_check_mark: Multi-backend agent execution (Claude SDK, Cursor, opencode) — existing (`backend.ts`)

### Active

- [ ] Youji director agent: persistent Slack-based conversational agent that acts as institute director
- [ ] Slack thread-to-session mapping: same thread = same session context, different thread = new session
- [ ] Worker agent spawning: Youji dispatches tasks to parallel worker agents in separate git worktrees
- [ ] Time-based resource accounting: replace token/API cost tracking with wall-clock time budgets
- [ ] Claude SDK-only execution: all agents run via Claude Agent SDK → local Claude Code CLI, no API calls
- [ ] Cron-based director wake-up: Youji periodically checks project status and reports to mentor
- [ ] Mentor reporting: Youji proactively summarizes project progress, blockers, and decisions needing input
- [ ] Continuous worker loop: workers continuously pick up tasks and execute them without human intervention
- [ ] Remote repo sync: use `https://github.com/LeeHongji/Open-Youji` as the canonical remote brain

### Out of Scope

- API-based billing and token cost tracking — replaced by time-based accounting
- opencode/GLM-5 fleet backend — not available in Claude SDK-only mode
- Cursor backend — not needed when Claude SDK is the sole execution engine
- Web dashboard UI — Slack is the sole human interface
- Multi-user access control — single mentor model

## Context

**Existing codebase:** The Youji repo already has a complete scheduler, skills system, convention framework, and autonomous work cycle. The core infrastructure works. What's missing is the "director" persona that ties it all together into a coherent autonomous institute experience.

**Key architectural shift:** The current scheduler treats each session as independent and equal. The new architecture introduces a hierarchy: Youji (director) → Worker agents. Youji is the only agent that talks to the human; workers are headless executors.

**Claude SDK constraint:** The Claude Agent SDK wraps `claude -p` (local Claude Code CLI). This means:
- No API key costs — execution uses the user's Claude Code subscription
- Sessions have the full Claude Code tool set (Read, Write, Edit, Bash, Grep, Glob, MCP, etc.)
- Skills, hooks, and settings from `~/.claude/` are available in SDK-spawned sessions

**Slack integration:** The reference implementation at `infra/scheduler/reference-implementations/slack/` provides a starting point but needs significant rework to support the director model (persistent sessions, thread-to-session mapping, proactive reporting).

## Constraints

- **Execution engine**: Claude Agent SDK only — no direct Anthropic API calls
- **Human interface**: Slack only — mentor interacts exclusively via Slack threads
- **Concurrency**: Worker agents must operate in isolated git worktrees to avoid conflicts
- **Platform**: macOS (darwin) — the mentor's development machine
- **Remote**: `https://github.com/LeeHongji/Open-Youji` — all work must push here

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Claude SDK over API | Leverages local Claude Code with full tool access, no API billing | -- Pending |
| Youji as persistent director | Single point of contact for mentor, reduces cognitive load | -- Pending |
| Time-based resource accounting | API costs are zero with SDK; wall-clock time is the real constraint | -- Pending |
| Slack thread = session | Natural conversation model; threads provide context isolation | -- Pending |
| Workers in git worktrees | Prevents merge conflicts during parallel execution | -- Pending |

---
*Last updated: 2026-03-17 after initialization*
