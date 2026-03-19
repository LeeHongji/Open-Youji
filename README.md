# Youji (Human Readme)

**Open source implementation for Autonomous Knowledge Acquisition and Research Intelligence (Youji)**

LLM agents can now operate as persistent researchers — selecting tasks, running experiments, recording findings, and building institutional knowledge across thousands of stateless sessions. This repo shows how.

## What this is
Youji is extracted from a production autonomous research system where LLM agents have been running real research — evaluating artifacts, building infrastructure, and operating an autonomous research workflow — for thousands of agent sessions and multiple projects.

**This is not a framework to install. It's a reference architecture and scaffold for your AI agent to read and further operate on.** See [`docs/repo-as-interface.md`](docs/repo-as-interface.md).

Want evidence that this system runs autonomously at scale? Start with [`docs/fleet-research.md`](docs/fleet-research.md).

Important note:

- The architectural decision records (ADRs) and many patterns in this repo are extracted from the actual operational history of Youji running on real research projects. They preserve lessons from that history, but they do **not** describe the open-source repo's current runnable state one-to-one.
- Youji is a reference architecture, not a capability guarantee. The repo does not automatically reproduce Youji's autonomy or output quality in the production system.
- In practice, an Youji-like system has to be "trained" through real project work: conventions must be adapted, skills must be exercised, failures must be diagnosed, and the repo must accumulate its own operational memory.

## How to use it

Youji does not ship with any library, API, CLI (command line interface), or GUI (graphical user interface). The primary user of Youji is Youji itself powered by LLM agents. The repo is the interface.

### Intended usage to use Youji as a "dependency library" for your agent system
1. Point your LLM agent (Claude Code, Cursor, Copilot, etc.) at this repo
2. Tell it what kind of autonomous system you want to build
3. It reads the patterns, conventions, skills, and reference implementations
4. It adapts what's relevant to your project

### Intended usage to use Youji to carry out research projects
1. Run your LLM agent (Claude Code, Cursor, Copilot, etc.) in this repo
2. Tell it what projects you would like to do
3. It reads the patterns, conventions, skills, and reference implementations
4. It adapts what's relevant to your project

Youji also ships two reference capability implementations:

1. a slack bot to report youji's operations and for human interactions
2. an example fleet system to run fast LLM models for simple work in large scale

In the Youji production system, the slack bot is the main interface of human use. However since you might not be using Slack as your favorite IM, the slack bot is only included in the Youji repo as a reference.

To add your own human messaging interface to Youji:

1. Clone [OpenClaw](https://github.com/openclaw/openclaw).
2. Run your LLM Agent in this repo.
3. Point it to the OpenClaw folder you cloned.
4. Tell it that you would like to support a messaging interface of {your favorite IM} using youji and openclaw code as reference.


## What's inside

| Component | Description | Files |
|-----------|-------------|-------|
| [`CLAUDE.md`](CLAUDE.md) | Agent operating manual — conventions, schemas, session discipline | 1 |
| [`.claude/skills/`](.claude/skills/) | 26 encoded judgment skills (orient, diagnose, design, critique, compound, etc.) | 25 dirs |
| [`infra/scheduler/`](infra/scheduler/) | Session orchestrator — cron scheduling, local control API, safety gates, push coordination | TypeScript |
| [`infra/scheduler/reference-implementations/`](infra/scheduler/reference-implementations/) | Slack + fleet code as references for agents (not intended to work out of the box) | TypeScript |
| [`decisions/`](decisions/) | 66 architectural decision records documenting every significant infrastructure choice | 66 files |
| [`projects/youji/patterns/`](projects/youji/patterns/) | 7 evidence-backed design patterns for autonomous research | 7 files |
| [`docs/`](docs/) | Design rationale, SOPs, conventions | 15+ files |
| [`infra/experiment-runner/`](infra/experiment-runner/) | Fire-and-forget experiment submission with progress tracking | Python |
| [`infra/budget-verify/`](infra/budget-verify/) | Resource tracking and budget enforcement | Python |
| [`examples/`](examples/) | Example project scaffold | 1 dir |

## Key ideas

**The repo is the brain.** Agents have no memory between sessions. The repository encodes everything they know — findings, decisions, tasks, open questions, experimental results. If it's not committed, it doesn't exist. See [`docs/design.md`](docs/design.md).

**Skills encode judgment.** Agent capabilities decompose into four layers: code, schema, convention, skill. Skills capture the reasoning that can't be reduced to rules — how to orient at session start, how to design an experiment, how to diagnose unexpected results. See [`projects/youji/patterns/skills-architecture.md`](projects/youji/patterns/skills-architecture.md).

**Conventions prevent drift.** Stateless agents will contradict each other without anchoring. Decision records, provenance requirements, and session discipline create consistency across thousands of sessions. See [`decisions/`](decisions/).

**Autonomous execution needs safety gates.** Agents can run freely on routine work. Expensive or irreversible decisions go through an approval queue for human review. See [`projects/youji/patterns/autonomous-execution.md`](projects/youji/patterns/autonomous-execution.md).

**Knowledge output is the metric.** Every session is evaluated by the knowledge it produces — findings, decisions, hypotheses tested. The fundamental efficiency metric is *findings per dollar*, not tasks completed. See [`CLAUDE.md`](CLAUDE.md).

## How it compares

youji occupies a different point in the design space from both general coding agents and general personal assistant agents:

| Dimension | General coding agents | General personal assistant agents | youji |
|-----------|------------------------|-----------------------------------|-----------|
| **Primary unit of work** | One coding task or PR | One request, thread, or workflow | Ongoing research program across projects |
| **Memory** | Mostly session-local or tool-local | Mostly conversation-local | Persistent institutional knowledge via repo |
| **Output** | Code changes, fixes, refactors | Messages, coordination, reminders, actions | Findings, decisions, experiments, code, and structured records |
| **Governance** | Usually light or human-driven | Usually human-in-the-loop | Budget enforcement, approval gates, decision records |
| **Autonomy horizon** | Short task horizon | Short request horizon | Multi-session, long-horizon autonomous operation |
| **Self-improvement** | Usually external to the system | Usually external to the system | The system can study and improve its own operation through the youji meta-project |
| **Scale** | Usually one active agent | Usually one assistant per user | Scheduler supports autonomous sessions; fleet execution is provided as a reference implementation |
| **Human bridge** | IDE/editor interaction | Chat, email, calendar, app actions | Slack/coordinator patterns are provided as reference implementations |
| **Skills** | Prompt habits or tool use | Prompt habits or tool use | 26 explicit encoded judgment procedures |

General coding agents answer: "Can an AI help with this code task?"

General personal assistant agents answer: "Can an AI help me coordinate and execute everyday work?"

youji answers: "Can AI agents operate as a persistent research group that studies both the world and itself?"

## The design patterns

Seven evidence-backed patterns extracted from operating the system:

1. **[Repo as Cognitive State](projects/youji/patterns/repo-as-cognitive-state.md)** — The repository is the sole persistent memory. File-based state artifacts, orient-read-write cycle, archival conventions.

2. **[Autonomous Execution](projects/youji/patterns/autonomous-execution.md)** — Five-step SOP (orient/select/classify/execute/commit), scope-based approval gates, scheduled cron sessions.

3. **[Skills Architecture](projects/youji/patterns/skills-architecture.md)** — Four-layer capability model (code/schema/convention/skill), 26 encoded judgment procedures.

4. **[Inline Logging](projects/youji/patterns/inline-logging.md)** — Record as you go, not at the end. Five-rule checklist, findings provenance requirement.

5. **[Layered Budget Enforcement](projects/youji/patterns/layered-budget-enforcement.md)** — Four enforcement layers from convention to hard gate.

6. **[Structured Work Records](projects/youji/patterns/structured-work-records.md)** — YAML frontmatter, type-specific sections, automated validation.

7. **[Gravity-Driven Migration](projects/youji/patterns/gravity-driven-migration.md)** — Capabilities migrate from manual to code when patterns recur 3+ times.

## Reading guide

| I want to... | Start here |
|---|---|
| Understand how to use this repo | [`docs/repo-as-interface.md`](docs/repo-as-interface.md) |
| See operational evidence for autonomy at scale | [`docs/fleet-research.md`](docs/fleet-research.md) |
| Understand the core philosophy | [`docs/design.md`](docs/design.md) |
| See the agent operating manual | [`CLAUDE.md`](CLAUDE.md) |
| Learn the design patterns | [`projects/youji/patterns/`](projects/youji/patterns/) |
| Read the encoded skills | [`.claude/skills/`](.claude/skills/) |
| See the end-to-end work cycle | [`docs/sops/autonomous-work-cycle.md`](docs/sops/autonomous-work-cycle.md) |
| Understand why decisions were made | [`decisions/`](decisions/) |
| Create a project structure | [`examples/`](examples/) |
| See the meta-project that studies the system itself | [`projects/youji/README.md`](projects/youji/README.md) |
| Set up session orchestration | [`infra/scheduler/`](infra/scheduler/) |
| Set up budget enforcement | [`infra/budget-verify/`](infra/budget-verify/) |

## Design philosophy

**Everything is plain text.** Markdown, YAML, TypeScript. Diff-friendly, grep-able, LLM-native.

**The repo is the brain.** Agents have no memory between sessions. The repo encodes what they know, what they've decided, and what to do next. If it's not in the repo, it doesn't exist.

**Provenance over assertion.** Every claim is leashed to a source. Structural defense against hallucination — the most dangerous failure mode of autonomous agents.

**Convention over configuration.** Schemas, SOPs, and skills reduce the space of choices agents must make. Less freedom means less drift.

**Knowledge output over task completion.** The fundamental metric is *findings per dollar*. Operational health is a supporting indicator.


## License

MIT. See [LICENSE](LICENSE).

## Citation

```
@misc{youji2026,
  title={youji: Infrastructure for Autonomous AI-Native Research Groups},
  year={2026},
  url={https://github.com/victoriacity/youji}
}
```
