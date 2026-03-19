# 0037: Multi-agent support with fallback chain

Date: 2026-02-26
Status: accepted

## Context

The youji repo has been developed primarily for Claude Code, with a `CLAUDE.md` file and skills in `.claude/skills/`. However, different AI coding agents are sometimes preferred or required:

1. **Claude Code** — primary agent, uses CLAUDE.md directly
2. **Cursor** — secondary option, uses `.cursor/rules/` 
3. **opencode** — tertiary option, open-source alternative

Previously, only Claude Code had full support. Cursor had a bridge rule, but opencode had no configuration. Additionally, the scheduler (`infra/scheduler/`) only supported Claude and Cursor backends, with a 2-tier fallback.

## Decision

Implement multi-agent support with a fallback chain: **Claude Code → Cursor → opencode**.

### Configuration structure

| Agent | Primary Config | Skills |
|-------|---------------|--------|
| Claude Code | `CLAUDE.md` | `.claude/skills/*/SKILL.md` |
| Cursor | `.cursor/rules/` → `CLAUDE.md` | `.claude/skills/*/SKILL.md` |
| opencode | `opencode.json` → `CLAUDE.md` | `.claude/skills/*/SKILL.md` |

### Scheduler backend support

The scheduler now supports opencode as a backend option:

- `BackendPreference` type includes `"opencode"`
- `OpenCodeBackend` class implements the `AgentBackend` interface using `opencode run --format json`
- 3-tier fallback chain: Claude → Cursor → opencode
- Slack bot notifications include the active backend

### New files

1. **`AGENTS.md`** — Unified entry point for all AI coding agents
2. **`opencode.json`** — Configuration for opencode CLI
3. **`infra/scheduler/src/backend.test.ts`** — Tests for backend resolution
4. **Skills** — All skills updated with `name` field in frontmatter (required by opencode)

### Changes to existing files

1. **`.cursor/rules/claude-skills.mdc`** — Added reference to AGENTS.md
2. **`infra/scheduler/src/backend.ts`** — Added OpenCodeBackend class, updated types
3. **`infra/scheduler/src/executor.ts`** — Updated ExecutionResult backend type
4. **`infra/scheduler/src/metrics.ts`** — Updated SessionMetrics backend type
5. **`infra/scheduler/src/cli.ts`** — Updated CLI backend option handling
6. **`infra/scheduler/src/types.ts`** — Updated JobPayload backend type

## Consequences

- All three agents can now work in this repo with consistent behavior
- Skills are shared across all agents (defined once in `.claude/skills/`)
- AGENTS.md serves as the unified entry point, reducing duplication
- CLAUDE.md remains the canonical comprehensive instructions
- The fallback chain allows graceful degradation when the primary agent is unavailable
- Scheduler can now use opencode as a backend option or fallback
