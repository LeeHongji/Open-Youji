Getting started with youji — agent-facing setup from clone to first autonomous session.

Important: this document is written primarily for agents, not for human users reading linearly.

If you are a human operator, treat this file as a reference for how your agent should set up and use the repo. The intended reader is the agent that will be pointed at this repository.

## Prerequisites

- **One supported agent backend** — youji supports `claude` (Claude Code), `cursor` (Cursor agent CLI), and `opencode` (opencode CLI). Install at least one of them before running autonomous sessions.
- **Node.js 18+** — for the scheduler.
- **Python 3.10+** — for the experiment runner and budget tools.
- **Git** — the repo is the system's memory; git is how it persists.

## Step 1: Clone and let the agent explore

```bash
git clone <your-repo-url> youji
cd youji
```

The agent should start by reading the two documents that define the system:

1. **[`CLAUDE.md`](../CLAUDE.md)** — the agent operating manual. This is the single most important file. It defines conventions, schemas, session discipline, and approval gates. Every agent session loads this as its instructions.

2. **[`docs/design.md`](design.md)** — why the repo is structured this way. Explains the core insight: LLM agents lose all memory between sessions, so the repo must encode cognitive state explicitly.

## Step 2: Create your first project scaffold

Every research question gets its own project directory under `projects/`. Use the example as a starting point:

```bash
cp -r examples/my-research-project projects/your-project-name
```

The agent should then edit the project files:

- **`README.md`** — set `Status`, `Mission`, `Done when`, `Context`. The mission and done-when are fixed at creation — they prevent scope drift across agent sessions. Make `Done when` concretely verifiable (not "build a good benchmark" but "benchmark published with results on N models").

- **`TASKS.md`** — define your initial tasks. Each task needs an imperative verb phrase, a `Why` line, and a `Done when` condition. Tag resource-consuming tasks appropriately; tag pure analysis/writing with `[zero-resource]`.

- **`budget.yaml`** (optional) — if your project uses LLM APIs, GPU compute, or other metered resources, define limits here. The system enforces these limits and tracks consumption in `ledger.yaml`.

Example task:

```markdown
- [ ] Run baseline evaluation on 50-image pilot set
  Why: Need initial accuracy data before scaling to full dataset
  Done when: Results for 3 models in experiments/baseline-pilot/results/
  Priority: high
```

## Step 3: Customize CLAUDE.md for the agent

`CLAUDE.md` ships with generic conventions. Customize it for your research domain:

- **Approval gates**: Adjust which modules are "production" and require PR approval.
- **Schemas**: The experiment, task, and decision record schemas work for most research. Extend them only when a real need arises.
- **Session discipline**: The defaults (incremental commits, inline logging, no experiment babysitting) are battle-tested across 200+ sessions. Change them only if you have evidence that a different approach works better for your domain.

What NOT to change (these are load-bearing conventions):
- Provenance requirements (every claim needs a source)
- Inline logging (record as you go, not at the end)
- Decision records (prevent re-litigation across sessions)
- Fire-and-forget experiment submission (agents must not babysit)

## Step 4: Set up the scheduler

The scheduler runs autonomous agent sessions on a cron schedule.

Youji supports these scheduler backends:

- `claude` — Claude Code / Claude Agent SDK
- `cursor` — Cursor agent CLI
- `opencode` — opencode CLI
- `auto` — try available backends in fallback order

```bash
cd infra/scheduler
npm install
npm run build
```

Add a work cycle job for the agent:

```bash
node dist/cli.js add \
  --name "your-work-cycle" \
  --cron "0 * * * *" \
  --tz "UTC" \
  --message "You are an autonomous research agent starting a work session. You MUST complete ALL 5 steps of the autonomous work cycle SOP at docs/sops/autonomous-work-cycle.md: Step 1: Run /orient. Step 2: Select a task. Step 3: Classify scope. Step 4: Execute or defer to APPROVAL_QUEUE.md. Step 5: Git commit and log. Do NOT just produce a text report." \
  --backend claude \
  --model opus \
  --cwd /path/to/your/youji
```

Choose the backend that matches your installed agent:

- `--backend claude` for Claude Code
- `--backend cursor` for Cursor
- `--backend opencode` for opencode
- `--backend auto` to let the scheduler try available backends automatically

Examples:

```bash
# Claude Code backend
node dist/cli.js add --name "work-cycle" --cron "0 * * * *" --tz "UTC" --message "<prompt>" --backend claude --model opus --cwd /path/to/your/youji

# Cursor backend
node dist/cli.js add --name "work-cycle" --cron "0 * * * *" --tz "UTC" --message "<prompt>" --backend cursor --model opus --cwd /path/to/your/youji

# opencode backend
node dist/cli.js add --name "work-cycle" --cron "0 * * * *" --tz "UTC" --message "<prompt>" --backend opencode --cwd /path/to/your/youji
```

The `--cron "0 * * * *"` runs sessions hourly. Adjust for your needs — a new research group might start with every 2-3 hours (`"0 */2 * * *"`) to keep costs lower while building up project context.

Start the daemon:

```bash
node dist/cli.js start
```

The scheduler will:
1. Trigger sessions on the cron schedule
2. Inject orient/compound tier directives based on recency
3. Track session metrics in `.scheduler/metrics/sessions.jsonl`
4. Post Slack notifications (if configured) for experiment completions and anomalies

See [`infra/scheduler/README.md`](../infra/scheduler/README.md) for full configuration options including Slack integration and agent profiles.

## Step 5: Run the first session manually

Before relying on the cron schedule, run a session manually to verify the agent setup works:

```bash
# Run the job immediately
node dist/cli.js run <job-id>
```

Or run an agent directly:

```bash
# Claude Code
claude -p "You are an autonomous research agent starting a work session. You MUST complete ALL 5 steps of the autonomous work cycle SOP at docs/sops/autonomous-work-cycle.md." --dangerously-skip-permissions

# Cursor and opencode can also be used directly if you prefer to drive them outside the scheduler.
```

Watch for the session to:
1. **Orient** — read the repo state, select a task
2. **Execute** — work the task, commit incrementally
3. **Compound** — reflect on what was learned
4. **Close** — final commit with session summary in the project log

After the session, check the project README log for the session entry and verify commits were made.

## Step 6: Monitor agent operation and iterate

As sessions accumulate, the system builds its own memory:

- **Project logs** — inter-session continuity. Each session reads recent entries to orient.
- **Decision records** — prevent re-litigation. Once a choice is recorded, future sessions respect it.
- **Experiment records** — structured findings with provenance. The `experiments/` directory is the system's knowledge base.
- **APPROVAL_QUEUE.md** — requests that need human judgment. Check this regularly.

Key monitoring points:

- **`.scheduler/metrics/sessions.jsonl`** — session metrics (cost, turns, findings, compliance)
- **`APPROVAL_QUEUE.md`** — pending human decisions
- **`budget.yaml` / `ledger.yaml`** — resource consumption vs limits
- **`git log`** — the heartbeat of the system. Regular commits mean the system is working.

## Key concepts

### Skills

Skills (in `.claude/skills/`) are encoded judgment procedures — they tell the agent *how* to do specific research workflows. Key skills:

| Skill | When to use |
|-------|-------------|
| `/orient` | Start of every session — assess state, select task |
| `/design` | Planning a new experiment |
| `/diagnose` | Interpreting unexpected results |
| `/compound` | End of session — embed learnings into the system |
| `/critique` | Before committing to a plan or finding |
| `/lit-review` | When a topic needs literature grounding |

### The autonomous work cycle

Every session follows the same 5-step cycle (defined in [`docs/sops/autonomous-work-cycle.md`](sops/autonomous-work-cycle.md)):

1. **Orient** — read repo state, select highest-leverage task
2. **Select** — pick a specific task with concrete done-when
3. **Classify** — determine if the task needs resources, approval, or can proceed
4. **Execute** — do the work, commit incrementally, log inline
5. **Compound** — reflect, embed learnings, discover follow-up tasks

### Creative Intelligence (CI) layers

The [CI framework](creative-intelligence.md) provides vocabulary for analyzing where problems live:

- **L1 (Model)** — raw model capability
- **L2 (Workflow)** — prompts, evaluation protocols, data pipelines
- **L3 (Interface)** — what the model sees (renders, formats, resolution)
- **L4 (Evaluation)** — how you measure quality
- **L5 (Human)** — human judgment and direction

When something goes wrong, name the layer. "The model is bad" is not a diagnosis. "L3 input format lacks the information needed for L1 to assess mesh topology" is.

## Common questions

**How many sessions before it's useful?**
The system produces value from session 1 — each session orients, selects a task, and makes progress. The compounding effects (decision records, experiment findings, pattern recognition) become visible around 10-20 sessions.

**What if a session does nothing useful?**
The system logs "no actionable tasks" and ends cleanly. This is correct behavior — it means the project needs human direction (new tasks, unblocked items, or budget approval). Check APPROVAL_QUEUE.md and TASKS.md.

**How do I give the agents direction?**
Write tasks in `TASKS.md` with clear done-when conditions. The agents will pick them up in priority order. For strategic direction, write it as context in the project README.

**Is this doc for me or for the agent?**
Primarily for the agent. A human should use it to understand the expected setup and workflow, but the steps and wording are intentionally optimized for agent execution.

**What about costs?**
Define `budget.yaml` limits per project. The system enforces them — agents check remaining budget before starting resource-consuming work. Track actual consumption in `ledger.yaml`.

**Can I use models other than Claude?**
Yes. The scheduler supports `claude`, `cursor`, and `opencode` backends. The conventions and skills are model-agnostic — they work with any LLM that can follow structured instructions. Validate model fit empirically for the task(s) you care about.
