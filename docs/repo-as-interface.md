Youji is a repo for agents to read, not a product to install.

## Core premise

Most AI-agent projects expose a CLI, SDK, or hosted service. Youji exposes a working repository structure.

That is intentional.

The hardest part of autonomous research is not invoking a model. It is preserving memory, encoding judgment, constraining drift, recording provenance, and coordinating stateless sessions over time. Those capabilities live in files, conventions, skills, decision records, and reference implementations.

The repo is the interface.

## How to use it

Point `claude -p` at this repository and give it a concrete goal:

- "Run your autonomous work cycle"
- "Investigate this research question"
- "Design an experiment for X"
- "Analyze these results and update the findings"

Youji reads the docs, patterns, skills, decisions, and project state, then works within the established structure.

This means Youji's repo is closer to:

- a living research notebook
- an executable body of knowledge and judgment
- a persistent cognitive state for an AI research assistant

than to:

- a one-command framework
- a polished end-user product
- a generic chatbot

## Why repo-as-brain

A CLI can expose commands, but it hides the reasoning structure behind them.

Youji's repo is optimized for persistent research operation:

1. **Patterns** explain why the system is shaped this way.
2. **Conventions** constrain Youji's behavior across sessions.
3. **Skills** encode judgment procedures that prompts alone do not reliably preserve.
4. **Decision records** show the trade-offs behind the current design.
5. **Project files** contain the actual research state, findings, and open questions.

If these ideas were compressed behind a small surface API, a new session would lose the context it needs to continue productive research.

## What the directories are for

- `docs/` and `decisions/` explain the system design
- `.claude/skills/` shows how reusable judgment procedures are encoded
- `projects/` contains active research work, each self-contained
- `knowledge/` holds cross-project insights
- `infra/` holds any shared tooling (scheduler, experiment runners)

## What success looks like

Success is not "I installed Youji."

Success is:

- the repo stores Youji's memory explicitly
- sessions follow stable conventions
- sessions leave durable logs, tasks, and decisions
- expensive actions are gated through the approval queue
- the system improves over repeated sessions instead of resetting each time
- research knowledge compounds across sessions

## Design consequence

Because the repo is the interface, Youji favors artifacts that are legible to both humans and agents:

- plain text over hidden state
- explicit schemas over ad hoc notes
- decision records over implicit tribal knowledge
- small files over giant prompts
- provenance-backed claims over assertions

The documentation is not support material for the system. It is part of the system.

## Reading order

If you are new here, start with:

1. `README.md`
2. `docs/design.md`
3. `CLAUDE.md`
4. `docs/sops/autonomous-work-cycle.md`
5. `.claude/skills/`
6. A project README in `projects/`

That path gives enough context to understand the operating model before touching implementation details.
