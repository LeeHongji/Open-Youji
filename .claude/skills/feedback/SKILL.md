---
name: feedback
description: "Use when the PI or a human provides feedback, corrections, or direction on agent work"
complexity: high
model-minimum: gpt-5
allowed-tools: ["Read", "Grep", "Glob", "Edit", "Write", "Bash(cd infra/scheduler && npm test)", "Bash(cd infra/scheduler && npx tsc --noEmit)", "Bash(cd infra/scheduler && npm run build)", "Bash(cd infra/scheduler && npm install *)", "Bash(git diff *)", "Bash(git log *)", "Bash(git status)", "Bash(git add *)", "Bash(git commit *)", "Bash(git push)", "Bash(curl *)", "Bash(pixi run validate *)"]
argument-hint: "<human feedback message describing what went wrong or should change>"
---

# /feedback <message>

Process human feedback to make youji better. The human giving feedback is the PI — the authority who governs research direction, resource allocation, quality standards, and operational parameters. Their feedback is not a suggestion; it is an instruction.

Your job: understand what the PI wants, figure out what should change, make the change, and record the learning so it never needs to be said again.

**If no feedback message is provided, stop immediately.** Say: "No feedback provided. Usage: `/feedback <what went wrong or should change>`" and do nothing else.

---

## Step 1: Parse the feedback

Read the feedback message and classify it:

| Type | Signal | Example |
|---|---|---|
| **Correction** | "Don't do X", "X was wrong", "Stop doing X" | "Don't modify budget.yaml without approval" |
| **Complaint** | "X didn't work", "X is broken", "X keeps failing" | "Skills aren't being invoked from Slack" |
| **Directive** | "Always do X", "Start doing X", "X should work like Y" | "Always deploy after changing scheduler code" |
| **Observation** | "I noticed X", "X seems off", "Why does X happen?" | "The bot sometimes answers instead of delegating" |
| **Approval** | "Approve X", "Deny X", "Yes to X", "Go ahead with X" | "Approve the budget increase to 3000" |
| **Resource** | "Increase budget", "Spend less on X", "Reallocate" | "Increase sample-project budget to 5000 calls" |
| **Strategy** | "Pivot to X", "Drop project Y", "Start project Z" | "Pause sample-project, focus on youji infrastructure" |
| **Knowledge** | "FYI X", "We now have X", "Deadline moved to X" | "We just got access to GPT-6 API" |
| **Calibration** | "Quality is too low", "Be more rigorous", "Bar is wrong" | "Stop producing surface-level findings" |
| **Tuning** | "Bot is too verbose", "Sessions too long", "Use model X" | "Use a cheaper model for routine work cycles" |
| **Schedule** | "Run more often", "Pause sessions", "Add a job" | "Run work cycles every 3 hours instead of 6" |

State the feedback type and a one-sentence restatement in your own words to confirm understanding.

**Quantitative check:** If the feedback contains a number + comparison operator (≥, ≤, >, <, "at least", "at most"), classify as **quantitative**. Example: "utilization should be ≥75%" is quantitative. If quantitative, a verification mechanism is MANDATORY (per ADR 0054).

## Step 2: Investigate

The depth of investigation depends on the feedback type.

**Full investigation** (correction, complaint, observation): Trace the root cause.

1. **Find the code path.** Grep for relevant functions, handlers, prompts, or config in `infra/scheduler/src/`, `.claude/skills/`, `decisions/`, and `CLAUDE.md`. Read the actual code — do not guess.
2. **Find the history.** Check `git log` for recent changes to the relevant files. Check project README logs and experiment records for context.
3. **Find prior feedback.** Grep interaction logs (`~/.scheduler/metrics/interactions.jsonl`), diagnosis files (`projects/<project>/diagnosis/diagnosis-*.md`), and postmortems (`projects/<project>/postmortem/postmortem-*.md`) for similar issues.
4. **Attribute to CI layer:**
   - L0 Code: bug or missing feature in infrastructure
   - L1 Model: LLM capability limitation
   - L2 Workflow: process or procedure gap
   - L3 Interface: prompt, message format, or UX issue
   - L4 Evaluation: metrics or validation gap
   - L5 Human: governance, approval, or communication gap
5. **State the root cause** in one sentence: "The system does X because Y, but the human expects Z because W."

**Light investigation** (directive, approval, resource, strategy, knowledge, calibration, tuning, schedule): Verify feasibility and find the right files to change.

1. Read the relevant files to understand current state.
2. Check `decisions/` for constraints that might conflict.
3. Confirm the change is safe to apply.

## Step 3: Determine the fix

Based on the feedback type, identify what should change:

| Fix type | When to use | Example |
|---|---|---|
| **Code change** | Behavior should be enforced deterministically | Add regex skill detection in processMessageInner |
| **Convention/rule** | Behavior should be followed by agents | Add deploy step to /develop skill |
| **Prompt change** | LLM behavior should shift | Add "FIRST: check for skills" to system prompt |
| **Decision record** | A policy needs to be established | "Budget changes require human approval" |
| **Documentation** | Knowledge needs to be captured | Add entry to project README log |
| **Approval resolution** | PI is deciding on a pending item | Resolve item in APPROVAL_QUEUE.md |
| **Resource change** | PI is adjusting budget or limits | Edit budget.yaml, add log entry |
| **Project change** | PI is reshaping the portfolio | Create/pause/complete project, edit README |
| **Config change** | PI is tuning operational parameters | Edit agent profiles, job schedules, .env |

**Scope check:** If the fix requires >5 files or an architectural change, use `EnterPlanMode` first.

**Quantitative feedback requirement:** If the feedback was classified as quantitative (contains number + comparison operator), the fix MUST include a verification mechanism per ADR 0054:

1. **Measurement** — Code that computes the metric (e.g., utilization formula in `fleet-status.ts`)
2. **Alert** — Mechanism that fires when the metric is outside the target range (e.g., warning in `health-watchdog.ts`)
3. **Baseline** — Record the metric value at the time of change (in the feedback record)

If you cannot implement verification (e.g., no code path to measure), document why and add a task to create the measurement infrastructure.

## Step 4: Implement

Apply the fix. Follow the appropriate workflow for each type:

### Code changes (infra/scheduler)

1. Write tests first (TDD) — no production code without a failing test first (per `/develop` skill's Iron Law)
2. Implement the change
3. Verify: `cd infra/scheduler && npm test` and `npx tsc --noEmit`
4. Deploy: `git commit && git push && npm run build && curl -s -X POST http://localhost:8420/api/restart` (graceful drain — ADR 0018)

### Skill/prompt changes

1. Edit the relevant SKILL.md or prompt-building code
2. If touching TypeScript: test + type-check + deploy
3. If touching only markdown: commit

### Convention/decision changes

1. Write the decision record to `decisions/NNNN-title.md`
2. Propagate to all locations that reference the convention (CLAUDE.md, SOPs, skills)
3. If the ADR includes Migration or Consequences with action items not implemented in this session, create corresponding tasks in the relevant project's `TASKS.md` (ADR task bridge — see CLAUDE.md Decisions section)
4. Commit

### Project roadmap changes (reprioritization, new tasks, dropped tasks)

1. Read the project's `TASKS.md`.
2. Apply the feedback: add tasks, remove tasks, reorder priorities, add/change lifecycle tags.
3. If the feedback conflicts with `Mission` or `Done when` — those are fixed at project creation and cannot be changed. Write the conflict to `APPROVAL_QUEUE.md` instead.
4. **Compositional consistency check:** After modifying tasks, verify: (a) no task combines blocked and unblocked work — if an upstream task was split, check whether downstream tasks should also be split; (b) `[blocked-by]` tags reference only conditions requiring external action, not implementation steps the agent can perform.
5. Add a log entry to the project README explaining what changed and why (referencing the feedback).
6. Commit.

### Approval resolution

The PI is the authority who resolves APPROVAL_QUEUE.md items. When they give approval feedback:

1. Read `APPROVAL_QUEUE.md` and find the matching pending item.
2. Move it from `## Pending` to `## Resolved` with the PI's decision (approved/denied/modified) and any notes.
3. **Update the task tag:** Search for matching tasks in project `TASKS.md` files. Change `[approval-needed]` to `[approved: YYYY-MM-DD]` using the approval date. This prevents tasks from being skipped by orient due to stale tags.
4. If approved, execute the approved action (e.g., edit budget.yaml, launch experiment).
5. Add a log entry to the relevant project README.
6. Commit.

### Resource changes (budget, limits)

The PI sets resource limits. When they direct a budget change:

1. Read the project's `budget.yaml` and `ledger.yaml` to understand current state.
2. Edit `budget.yaml` as directed (change limits, add resource types, adjust deadlines).
3. If there's a corresponding pending item in APPROVAL_QUEUE.md, resolve it.
4. Add a log entry to the project README with before/after values and rationale.
5. Commit.

### Strategy shifts (project portfolio)

The PI directs research strategy. When they reshape the project portfolio:

**Pause a project:**
1. Set `Status: paused` in the project README.
2. Add a log entry explaining why.
3. If the project has scheduled jobs, disable them in `.scheduler/jobs.json` (set `enabled: false`).
4. Deploy if jobs were changed: `npm run build && curl -s -X POST http://localhost:8420/api/restart` (graceful drain — ADR 0018).

**Resume/activate a project:**
1. Set `Status: active` in the project README.
2. Re-enable any disabled jobs.
3. Add a log entry. Deploy if jobs changed.

**Start a new project:**
1. Create `projects/<name>/README.md` following the project README schema in CLAUDE.md (Status, Mission, Done when, Context, Log, Open questions) and `projects/<name>/TASKS.md` for tasks.
2. Optionally create `budget.yaml` if the PI specifies resource limits.
3. Add a log entry to `projects/youji/README.md` noting the new project.

**Complete/archive a project:**
1. Set `Status: completed` in the project README.
2. Disable scheduled jobs.
3. Add a final log entry summarizing outcomes.
4. Deploy if jobs changed.

### Knowledge injection

New external facts that change what's possible or urgent:

1. Record the fact in the most relevant project file (README log entry, `existing-data.md`, `datasets.md`, or a new file if none fits).
2. Assess impact: does this new knowledge change priorities? Unblock tasks? Invalidate assumptions? Enable new work?
3. **Create tasks in every affected project's `TASKS.md`.** New data or capabilities relevant to a project always produce at least one task (e.g., "Evaluate new X data against existing method," "Incorporate Y into training pipeline"). If you believe no task is needed, state the justification explicitly in the feedback record's Learning section.
4. If priorities change, reorder or update lifecycle tags in affected `TASKS.md` files.
5. If a deadline changed, update `budget.yaml` deadline field if applicable.
6. Commit.

### Quality calibration

The PI is raising or changing the bar:

1. Identify which artifacts the calibration applies to (experiment findings, analysis depth, documentation quality, code standards).
2. Find the relevant conventions:
   - CLAUDE.md for repo-wide standards
   - Skill SKILL.md files for skill-specific standards
   - `decisions/` for established policies
3. Write or update the convention to encode the new bar. Be specific — "more rigorous" must become a concrete, checkable criterion (e.g., "all findings must include confidence intervals" or "analyses must break down by at least 3 dimensions before concluding").
4. If the change modifies governance in CLAUDE.md (approval workflow, budget rules, what requires approval), write to `APPROVAL_QUEUE.md` instead. Convention clarifications, gotcha additions, and skill improvements may be applied directly.
5. Propagate to all relevant locations. Commit.

### Agent behavior tuning

The PI controls operational parameters:

**Model changes:**
1. Read `infra/scheduler/src/agent.ts` — `AGENT_PROFILES` defines model, maxTurns, maxDurationMs for each agent type (workSession, chat, autofix, deepWork).
2. Edit the profile as directed.
3. For chat model: can also be set via `SLACK_CHAT_MODEL` env var in `infra/scheduler/.env`.
4. Test + type-check + deploy.

**Voice/style changes:**
1. Read the "Voice & style" section in `buildChatPrompt()` in `infra/scheduler/src/chat.ts`.
2. Edit the style directives as directed.
3. Deploy.

**Turn/duration limits:**
1. Edit the relevant profile in `AGENT_PROFILES` in `agent.ts`.
2. Deploy.

### Schedule changes

The PI controls when and how often agents run:

1. Read `.scheduler/jobs.json` to see current jobs (id, name, schedule, enabled).
2. Apply the change:
   - **Change frequency:** Edit the `schedule.expr` (cron) or `schedule.everyMs` (interval) field.
   - **Enable/disable:** Set `enabled: true` or `false`.
   - **Add a job:** Append a new job object following the `Job` schema in `infra/scheduler/src/types.ts` (id, name, schedule, payload, enabled, state).
   - **Remove a job:** Set `enabled: false` (prefer disabling over deleting for audit trail).
3. Add a log entry to `projects/youji/README.md` with the schedule change.
4. Deploy: `curl -s -X POST http://localhost:8420/api/restart` (graceful drain — ADR 0018; the scheduler re-reads jobs.json on startup).

### Documentation only

1. Write the log entry, README update, or experiment record
2. Validate: `pixi run validate` if touching experiment records
3. Commit

## Step 5: Record the learning

**MANDATORY.** Every feedback cycle must produce a persistent record. This is the knowledge output — it ensures the same feedback never needs to be given twice.

Create or update a file at: `projects/youji/feedback/feedback-<slug>.md`

Use this template:

```yaml
---
id: feedback-<slug>
type: bugfix
status: completed
date: YYYY-MM-DD
project: youji
consumes_resources: false
tags: [feedback, <category>]
---
```

```markdown
## Problem

Feedback: "<exact quote of the human feedback>"
Type: <correction | complaint | directive | observation | approval | resource | strategy | knowledge | calibration | tuning | schedule>
Interpretation: <one-sentence restatement>

## Root Cause

<What causes the current behavior. CI layer attribution. Reference code/config by path.>
<For light-investigation types (approval, resource, etc.), briefly state what the current state was and why the change was requested.>

## Fix

<What was changed. File-by-file summary. Reference files by path.>

## Verification

<How correctness was confirmed. Exact commands and output.>

## Learning

<One-paragraph summary: what principle does this feedback encode? How does it generalize beyond this specific case? What should youji "know" going forward?>
```

The **Learning** section is the most important part. It should capture the general principle, not just the specific fix. Good: "Human approval is required for all resource-limit changes because budget constraints are governance decisions, not operational ones." Bad: "Changed budget.yaml approval check."

### Step 5b: Propagation check

**MANDATORY.** After recording, assess whether the learning should propagate beyond this project-local feedback record. Without this check, ~30% of learnings remain isolated and get re-learned in different contexts.

Run these tests in order:

#### 1. Cross-project applicability test

Ask: "Does this learning apply to multiple projects or is it project-specific?"

- **Applies to all/most projects** → Propagate to CLAUDE.md (convention) or a skill (workflow guidance)
- **Applies to specific project types** → Consider a skill (e.g., `/design` for experiment design, `/develop` for code changes)
- **Project-specific** → Keep in feedback record only

If propagating to CLAUDE.md:
1. Add to the relevant section (e.g., Session discipline, Enforcement layers, Task lifecycle)
2. Update `docs/conventions/enforcement-layers.md` if it changes what's L0 vs L2
3. Note the propagation in the feedback record's `## Learning` section

#### 2. Code enforceability test

Ask: "Can this learning be enforced deterministically in code (L0) instead of relying on agent compliance (L2)?"

- **Yes, code can enforce** → Add to `infra/scheduler/src/verify.ts`, `budget-gate.ts`, or create a new enforcement module
- **No, requires judgment** → Keep as convention/skill guidance

If adding L0 enforcement:
1. Write the verification code
2. Add tests in `verify.test.ts` or relevant test file
3. Update `docs/conventions/enforcement-layers.md` to mark the item as L0
4. Note the enforcement mechanism in the feedback record

#### 3. Skill update check

Ask: "Does this learning belong in an existing skill?"

Skills that commonly receive feedback-driven updates:
- `/develop` — Code workflow, testing, deployment
- `/orient` — Task selection, priority handling
- `/diagnose` — Error analysis methodology
- `/review` — Validation criteria
- `/compound` — Session-end learning capture

If updating a skill:
1. Add the guidance to the appropriate step in the skill's SKILL.md
2. Note the skill update in the feedback record

#### 4. Generalization note

In the feedback record, add a `## Propagation` section documenting:

```markdown
## Propagation

- **Cross-project:** <yes/no + where propagated>
- **Code enforcement:** <yes/no + mechanism if yes>
- **Skill update:** <skill name + section if applicable>
```

If the answer to all three tests is "no," state: "Learning remains project-local. Justification: <reason>."

## Step 6: Verify the loop is closed

Before finishing, check:

1. **Is the fix live?** If code was changed, is it deployed? If a convention was added, is it in all relevant files?
2. **Is the learning recorded?** Does the experiment record exist and pass validation?
3. **Would the same feedback trigger the same problem again?** If yes, the fix is insufficient — go back to Step 3.
4. **Would a fresh agent session know about this?** Read only the repo (not conversation history) — is the learning discoverable?
5. **Were tasks created?** If the feedback record contains actionable recommendations (numbered items, bulleted action items, or a Recommendations section), verify that corresponding tasks were created in the affected project's TASKS.md — regardless of feedback type. This applies to all types (correction, complaint, observation, directive, knowledge, calibration, etc.), not just `knowledge`. Each recommendation that implies a concrete change (convention, code, workflow, skill update) must have a task. If not, either create the tasks now or explicitly justify why no action is needed in the feedback record. Reference the feedback record in each task's `Source:` field (per ADR task bridge convention).

---

## Constraints

- **No feedback = no action.** Exit immediately if the argument is empty.
- **PI authority.** The feedback comes from the PI. Approvals, budget changes, strategy shifts, and schedule changes are instructions, not requests. Execute them.
- **Evidence first.** For corrections and complaints, never assume the root cause. Read the code, check the logs, find the history.
- **Code over convention.** If a behavior should always happen, enforce it in code. Prompt-level instructions are probabilistic; code is deterministic.
- **L0+L2 dual-fix default.** When implementing a fix, default to both code enforcement (L0) and convention documentation (L2). Pure L2-only fixes require explicit justification. See `docs/conventions/enforcement-layers.md` → Feedback-driven fix default.
- **Record everything.** The experiment record is not optional. Feedback without a learning record is wasted.
- **Inline logging.** Record discoveries to repo files in the same turn, not at session end.
- **Check decisions/.** Do not contradict established decisions without the PI explicitly overriding them. If the feedback conflicts with a decision, note the conflict, implement the PI's instruction, and update or supersede the decision record.
- **Mission is immutable unless PI directs a pivot.** In that case, evaluate whether to amend the mission or create a new project based on knowledge lineage continuity. Change the mission when the pivot is a natural evolution (same domain, same data, same experiments, refined question). Create a new project when the pivot changes what counts as a finding.
- **Push is session-level.** Pushing is handled at the session lifecycle level, not per-skill. This skill commits but does not push — the session SOP handles pushing. Exception: code deployments (`git push && npm run build && restart`) where push is part of the deploy action.
