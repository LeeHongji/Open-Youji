Getting started with Youji -- agent-facing setup from clone to first autonomous session.

Important: this document is written primarily for agents, not for human users reading linearly.

If you are a human operator, treat this file as a reference for how Youji should set up and use the repo. The intended reader is the agent that will be pointed at this repository.

## Prerequisites

- **Claude Code CLI** (`claude`) -- Youji uses `claude -p` for autonomous sessions.
- **Node.js 18+** -- for the scheduler.
- **Git** -- the repo is Youji's memory; git is how it persists.

## Step 1: Clone and let the agent explore

```bash
git clone <your-repo-url> Youji
cd Youji
```

The agent should start by reading the two documents that define the system:

1. **[`CLAUDE.md`](../CLAUDE.md)** -- the agent operating manual. This is the single most important file. It defines conventions, schemas, session discipline, and approval gates. Every agent session loads this as its instructions.

2. **[`docs/design.md`](design.md)** -- why the repo is structured this way. Explains the core insight: LLM agents lose all memory between sessions, so the repo must encode cognitive state explicitly.

## Step 2: Create your first project scaffold

Every research question gets its own project directory under `projects/`. Create a project:

```bash
mkdir -p projects/your-project-name
```

Then create the project files:

- **`README.md`** -- set `Status`, `Mission`, `Done when`, `Context`. The mission and done-when are fixed at creation -- they prevent scope drift across sessions. Make `Done when` concretely verifiable (not "build a good benchmark" but "benchmark published with results on N models").

- **`TASKS.md`** -- define your initial tasks. Each task needs an imperative verb phrase, a `Why` line, and a `Done when` condition.

Example task:

```markdown
- [ ] Run baseline evaluation on 50-image pilot set
  Why: Need initial accuracy data before scaling to full dataset
  Done when: Results for 3 models in experiments/baseline-pilot/results/
  Priority: high
```

## Step 3: Customize CLAUDE.md

`CLAUDE.md` ships with generic conventions. Customize it for your research domain:

- **Approval gates**: Adjust which actions require researcher approval.
- **Schemas**: The experiment, task, and decision record schemas work for most research. Extend only when a real need arises.
- **Session discipline**: The defaults (incremental commits, inline logging, no experiment babysitting) are battle-tested. Change only if you have evidence that a different approach works better.

What NOT to change (these are load-bearing conventions):
- Provenance requirements (every claim needs a source)
- Inline logging (record as you go, not at the end)
- Decision records (prevent re-litigation across sessions)

## Step 4: Set up the scheduler (optional)

The scheduler runs autonomous `claude -p` sessions on a cron schedule.

```bash
cd infra/scheduler
npm install
npm run build
```

Add a work cycle job:

```bash
node dist/cli.js add \
  --name "youji-work-cycle" \
  --cron "0 * * * *" \
  --tz "UTC" \
  --message "You are Youji, starting an autonomous work session. Complete ALL 5 steps of the autonomous work cycle SOP at docs/sops/autonomous-work-cycle.md: Step 1: Orient. Step 2: Select a task. Step 3: Classify scope. Step 4: Execute. Step 5: Git commit and log. Do NOT just produce a text report." \
  --backend claude \
  --model opus \
  --cwd /path/to/Youji
```

The `--cron "0 * * * *"` runs sessions hourly. Adjust for your needs -- a new project might start with every 2-3 hours (`"0 */2 * * *"`).

Start the daemon:

```bash
node dist/cli.js start
```

## Step 5: Run the first session manually

Before relying on the cron schedule, run a session manually to verify:

```bash
claude -p "You are Youji, starting an autonomous work session. Complete ALL 5 steps of the autonomous work cycle SOP at docs/sops/autonomous-work-cycle.md." --dangerously-skip-permissions
```

Watch for the session to:
1. **Orient** -- read the repo state, select a task
2. **Execute** -- work the task, commit incrementally
3. **Compound** -- reflect on what was learned
4. **Close** -- final commit with session summary in the project log

After the session, check the project README log for the session entry and verify commits were made.

## Step 6: Monitor and iterate

As sessions accumulate, the system builds its own memory:

- **Project logs** -- inter-session continuity. Each session reads recent entries to orient.
- **Decision records** -- prevent re-litigation. Once a choice is recorded, future sessions respect it.
- **Experiment records** -- structured findings with provenance.
- **APPROVAL_QUEUE.md** -- requests that need researcher judgment. Check this regularly.

Key monitoring points:

- **`git log`** -- the heartbeat of the system. Regular commits mean the system is working.
- **`APPROVAL_QUEUE.md`** -- pending decisions.
- **Project README logs** -- what Youji has been doing across sessions.

## Key concepts

### Skills

Skills (in `.claude/skills/`) are encoded judgment procedures -- they tell Youji *how* to do specific research workflows. Key skills:

| Skill | When to use |
|-------|-------------|
| `/orient` | Start of every session -- assess state, select task |
| `/design` | Planning a new experiment |
| `/diagnose` | Interpreting unexpected results |
| `/compound` | End of session -- embed learnings into the system |
| `/critique` | Before committing to a plan or finding |
| `/lit-review` | When a topic needs literature grounding |

### The autonomous work cycle

Every session follows the same 5-step cycle (defined in [`docs/sops/autonomous-work-cycle.md`](sops/autonomous-work-cycle.md)):

1. **Orient** -- read repo state, select highest-leverage task
2. **Select** -- pick a specific task with concrete done-when
3. **Classify** -- determine if the task needs resources, approval, or can proceed
4. **Execute** -- do the work, commit incrementally, log inline
5. **Compound** -- reflect, embed learnings, discover follow-up tasks

### Creative Intelligence (CI) layers

The [CI framework](creative-intelligence.md) provides vocabulary for analyzing where problems live:

- **L1 (Model)** -- raw model capability
- **L2 (Workflow)** -- prompts, evaluation protocols, data pipelines
- **L3 (Interface)** -- what the model sees (renders, formats, resolution)
- **L4 (Evaluation)** -- how you measure quality
- **L5 (Human)** -- human judgment and direction

When something goes wrong, name the layer.

## Common questions

**How many sessions before it's useful?**
The system produces value from session 1 -- each session orients, selects a task, and makes progress. The compounding effects (decision records, experiment findings, pattern recognition) become visible around 10-20 sessions.

**What if a session does nothing useful?**
The system logs "no actionable tasks" and ends cleanly. This is correct behavior -- it means the project needs human direction (new tasks, unblocked items). Check TASKS.md.

**How do I give Youji direction?**
Write tasks in `TASKS.md` with clear done-when conditions. Youji will pick them up in priority order. For strategic direction, write it as context in the project README.

**What about costs?**
Each `claude -p` session consumes API credits. Adjust the cron schedule based on your budget. Sessions that find no actionable tasks end quickly and cheaply.

**Can I use models other than Claude?**
The conventions and skills are model-agnostic -- they work with any LLM that can follow structured instructions. The scheduler can be extended to support other backends. Validate model fit empirically.
