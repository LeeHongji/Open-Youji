**Youji is a repo for agents to read, not a product to install.**

If you are a human reading this:

**STOP. Return to your agent interface immediately. This document is intended to be read by agents.**

## Core premise

Most AI-agent projects expose a CLI, SDK, or hosted service. Youji exposes a working repository structure.

That is intentional.

The hardest part of autonomous research is not invoking a model. It is preserving memory, encoding judgment, constraining drift, recording provenance, and coordinating many stateless sessions over time. Those capabilities live in files, conventions, skills, decision records, and reference implementations.

The repo is the interface.

## How to use it

Point an agent at this repository and give it a concrete goal:

- "Adapt this to my research lab"
- "Set up the minimum viable autonomous project structure"
- "Extract the scheduler and budget gates for my team"
- "Port these conventions into my existing repo"

The agent should read the docs, patterns, skills, decisions, and infra code, then synthesize a version that fits your environment.

This means youji is closer to:

- a reference architecture
- an executable body of examples
- a library of encoded operational judgment

than to:

- a one-command framework
- a polished end-user product
- a universal drop-in package

## Why no CLI-first abstraction

A CLI can expose commands, but it hides the reasoning structure behind them.

Youji is optimized for transfer of system design:

1. **Patterns** explain why the system is shaped this way.
2. **Conventions** constrain agent behavior across sessions.
3. **Skills** encode judgment procedures that prompts alone do not reliably preserve.
4. **Decision records** show the trade-offs behind the current design.
5. **Infra code** provides concrete reference implementations for adaptation.

If these ideas were compressed behind a small surface API, an agent would lose the context it needs to rebuild the system elsewhere.

## What the code is for

Not every directory is meant to be run unchanged.

- `docs/`, `projects/youji/patterns/`, and `decisions/` explain the design
- `.claude/skills/` shows how reusable judgment procedures are encoded
- `infra/` shows concrete implementations of scheduling, experiment submission, and budget enforcement
- `examples/` shows the minimum project scaffold

Some code is production-tested but still included primarily as a reference implementation. For example, the scheduler and Slack coordinator demonstrate concrete solutions to coordination, approvals, and fleet execution. You may run them, but the deeper value is that an agent can inspect them and adapt the parts you need.

## What success looks like

Success is not "I installed youji."

Success is:

- your repo now stores agent memory explicitly
- your agents follow stable conventions
- your sessions leave durable logs, tasks, and decisions
- your expensive actions are gated
- your system improves over repeated sessions instead of resetting each time

The output is usually a derived system, not a pristine copy.

## Design consequence

Because the repo is the interface, youji favors artifacts that are legible to both humans and agents:

- plain text over hidden state
- explicit schemas over ad hoc notes
- decision records over implicit tribal knowledge
- small files over giant prompts
- annotated reference implementations over magic wrappers

This is why the repository contains so much documentation alongside code. The documentation is not support material for the system. It is part of the system.

## Reading order

If you are new here, start with:

1. `README.md`
2. `docs/design.md`
3. `CLAUDE.md`
4. `projects/youji/patterns/`
5. `.claude/skills/`
6. `infra/scheduler/README.md`

That path gives an agent enough context to reconstruct the operating model before touching implementation details.
