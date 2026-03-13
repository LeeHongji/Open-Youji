---
name: orient
description: "Use at the start of every work session to assess current state and select the highest-value task"
argument-hint: "[fast | full | project-name] — 'fast' for abbreviated orient, 'full' for comprehensive, or project name to scope"
---

# /orient

You are starting or resuming a work session on the Youji research repo. Your job is to quickly build situational awareness and recommend the single highest-leverage next action.

## Tier selection

Orient has two tiers: **fast** (abbreviated, ~2-3 turns) and **full** (comprehensive, ~5-7 turns).

- `/orient fast` — run fast orient (skip to "Fast orient" section below)
- `/orient full` — run full orient (use the standard procedure below)
- `/orient` (no argument) — default to full orient unless the researcher indicates a recent orient was done
- `/orient <project-name>` — run full orient scoped to that project

## Fast orient

When running in fast mode, do only the following:

### Step 0: Commit orphaned work
Run `git status`, commit and push any orphaned changes from previous sessions.

### Gather context (minimal)
Read the following in parallel:
1. `git log --oneline -5` — recent activity
2. `git status` (reuse from step 0)
3. `projects/*/TASKS.md` — for all active projects. Also read `projects/*/README.md` headers (first ~5 lines) to extract each project's `Priority:` field for project-level ranking. Skip full READMEs.

### Mission gap check

For each high-priority project with <=2 unblocked tasks:

1. Read the project's `Done when` criteria from README.md
2. For each condition in `Done when`, check if there's a corresponding open task in TASKS.md
3. If any `Done when` condition has no corresponding open task AND is not already satisfied by completed work, generate a task:
   ```
   - [ ] <imperative verb phrase for the gap>
      Why: Mission gap — no task for <condition>
      Done when: <verifiable condition matching the Done when criterion>
   ```
4. Report: "Mission gaps: N conditions checked, M tasks generated" or "Mission gaps: none"

### Select task
Extract unblocked tasks from TASKS.md files. Apply project priority grouping first (`high` > `medium` | untagged > `low`), then apply task-level ranking (prevents waste > unblocks > produces knowledge > matches momentum > cost-proportionate), but skip strategic alignment check, repetition penalty scan, and compound opportunity scanning.

**Stale blocker check**: Note any `[blocked-by: external: ... (YYYY-MM-DD)]` tags older than 7 days — flag for re-verification.

### Output format (fast)

Report these sections:
- **Mission gaps**: For high-priority projects with <=2 unblocked tasks
- **Recommended task**: Task text, project, 1-line rationale
- **Uncommitted work**: Git status summary or "clean"
- **Task supply updates**: Any task generation or decomposition done during orient

Skip: Cross-session patterns, Gravity signals, Compound opportunities, Risks, Recommended skill.

---

## Full orient

The standard comprehensive orient procedure.

## Scope

If a project argument is provided (e.g. `/orient sample-project`), scope to that project only:
- Read only `projects/<arg>/README.md` (not all projects)
- Also read domain knowledge files: `projects/<arg>/knowledge.md` (if it exists) and `projects/<arg>/knowledge/*.md` (if the directory exists). Both patterns are used — some projects use a flat file, others use a directory. This injects accumulated domain knowledge into session context.
- Also read `projects/<arg>/decisions/*.md` if the directory exists — project-direction decisions inform task context
- Skip cross-project comparison — focus on within-project task ranking
- Still read git status and recent git log for repo-wide awareness

If no project argument, assess all active projects and recommend the highest-leverage task across all of them.

## Step 0: Commit orphaned work

Before anything else, run `git status`. If there are uncommitted changes from previous sessions (modified files, untracked artifacts), commit them immediately. Orphaned work is the most common knowledge-loss pattern. Do not analyze or assess — just commit what's there with a descriptive message.

Skip this step only if `git status` is clean.

## Gather context

Read the following in parallel:

1. Recent git activity:
   - `git log --oneline -15`
   - `git status` (already done above — reuse the output)
2. Project READMEs and TASKS — either the scoped project or all active projects: `projects/*/README.md` (for context, log, questions) and `projects/*/TASKS.md` (for task selection). **Extract each project's `Priority:` field** from its README (high | medium | low; absent = medium). For **scoped** orient, also read domain knowledge files. For all projects, check for `projects/<project>/decisions/` and read any files there.
3. Research roadmap: `docs/roadmap.md` — for active research questions and strategic priorities
4. Cross-project knowledge: `knowledge/*.md` — for relevant methods and insights

## Mission gap analysis

Before ranking tasks, check whether active projects have tasks for all their `Done when` conditions. This step ensures the system is goal-directed — working toward project completion, not just executing whatever happens to be in the queue.

### Procedure

For each active project with `Priority: high` or `medium` (already read in "Gather context"):

1. **Extract `Done when` criteria** from the project README. Decompose compound criteria into discrete verifiable conditions. E.g., "benchmark covers >=5 models across >=3 skill categories with validated rubrics" decomposes into: (a) >=5 models benchmarked, (b) >=3 skill categories covered, (c) rubrics validated.

2. **For each condition**, determine its status:
   - **Satisfied**: Evidence exists that the condition is met (completed experiment, artifact on disk, completed task with verification)
   - **Has task**: An open task in TASKS.md would satisfy this condition when completed
   - **Gap**: Condition is unsatisfied AND no open task addresses it

3. **For each gap**, generate a task proposal following the standard task schema:
    ```
    - [ ] <imperative verb phrase>
      Why: Mission gap — no task for "<condition>"
      Done when: <verifiable condition that satisfies the Done when criterion>
      Priority: <inherit from project priority>
   ```

4. **Write generated tasks** to the project's TASKS.md under a "## Mission gap tasks" section. Mission gap tasks represent work the project structurally requires.

### Report

```
### Mission gap analysis
<per-project summary>
**<project>**: N conditions, M satisfied, K have tasks, J gaps
  Gaps: <list each gap condition and generated task, or "none">
```

### When to skip

Skip mission gap analysis for:
- Projects with `Priority: low` (unless in empty-queue fallback mode)
- Projects with `Status: paused` or `Status: completed`
- Projects with >5 unblocked tasks (task supply is healthy; gap analysis can wait)

## Rank tasks

Extract all unblocked tasks from `TASKS.md` files. For each task, assess:

1. **Prevents waste?** Does this task stop resources from being burned on broken configs, invalid setups, or known-bad patterns? Tasks that prevent waste are almost always highest leverage because they protect the denominator of findings/dollar.

2. **Unblocks others?** How many other tasks or experiments depend on this completing? A task that unblocks 3 others is worth more than a task that unblocks 0. Check for `[blocked-by: ...]` tags that reference this task.

3. **Produces knowledge?** Does the task have a clear hypothesis, falsifiable outcome, or "Done when" that includes a finding or decision? Tasks that produce knowledge directly serve the mission. Tasks that only produce operational output are lower leverage unless they enable knowledge-producing tasks.

4. **Matches momentum?** Is there recent work (last 2-3 sessions) building toward this task? Continuing a thread is cheaper than starting a new one — context is warm, dependencies are fresh, partial work may exist.

5. **Cost-proportionate?** Is the expected cost (time, complexity) proportionate to the expected knowledge output? A quick analysis that produces 3 findings beats a long experiment that produces 1.

**Project priority grouping:** Before applying task-level criteria, group candidate tasks by their project's priority: `high` > `medium` | untagged > `low`. Only consider tasks from lower-priority projects when all higher-priority projects have no actionable tasks. Within a project priority group, apply the task-level criteria below.

**Ranking algorithm:** Score each task by the first criterion it satisfies, in order. Criterion 1 (prevents waste) dominates criterion 2 (unblocks), which dominates criterion 3 (produces knowledge), etc. Within the same criterion, prefer lower cost.

**Strategic alignment:** When recommending, state how the task connects to an active research question from `docs/roadmap.md`. If it doesn't connect to any, flag this as potential drift — it may still be valid (infrastructure work), but the disconnect should be explicit.

**Repetition penalty:** Before finalizing a recommendation, scan the project README log for the last 5 "Task-selected:" entries. If the candidate task (or a task analyzing the same experiment/artifact) appears in 3+ of those entries, apply a repetition penalty:
- Flag it: "WARNING: This task has been selected N/5 recent sessions. Check for diminishing returns."
- Check whether the task has genuinely new preconditions since last selection (e.g., experiment just completed, blocker removed, new data accumulated).
- If no new preconditions exist, prefer an alternative task. If no alternatives exist, recommend the task but note the repetition risk.

**Priority tiebreaker:** Within tasks at the same criterion level, prefer `Priority: high` > `Priority: medium` > `Priority: low` > untagged.

Do NOT recommend tasks from:
- Tasks with `[blocked-by: ...]` tags with unresolved blockers
- Tasks with `[in-progress: ...]` tags (already being worked on)

**Empty-queue fallback**: If no actionable tasks are found across all eligible projects after ranking:
1. **Mission gap analysis**: Run the full mission gap analysis for ALL active projects, not just high-priority. Most empty queues are caused by missing tasks, not missing recommendations.
2. If mission gap analysis generates tasks, select from the generated tasks.
3. If no mission gaps found, scan completed experiments for unsurfaced recommendations (Recommendations, Prevention, Next steps sections without a "Recommendations surfaced:" marker).
4. If unsurfaced files exist, recommend: "Run `/compound deep` to process N unsurfaced recommendation files" as the task.
5. If nothing found, log "no actionable tasks, no mission gaps, and no unsurfaced recommendations" and end the session.

## Task supply generation and decomposition

Task generation is a primary output of orient, not just a side effect. If you notice thin task supply, stale blockers, or over-broad tasks, improve the queue before selecting work.

**Generation procedure (write tasks directly to TASKS.md):**
1. **Unblock stale blockers**: Find `[blocked-by: ...]` tags where the referenced condition is now resolved (prerequisite task marked `[x]`, issue fixed, time gate passed). Remove the tag.
2. **Decompose broad tasks**: Split tasks with >2 independent steps into smaller subtasks. Write subtasks directly to TASKS.md.
3. **Extract preparatory work from blocked tasks**: For blocked tasks, identify prerequisite setup that is NOT blocked (directory creation, config files, documentation). Create subtasks for these preparatory steps.
4. **Create follow-up tasks from recent completions**: Scan recently completed tasks (`[x]`) for implied follow-up work: validation, documentation updates, cross-project propagation, analysis of new artifacts.
5. **Create knowledge management tasks**: Add tasks for cross-reference verification, README status verification, completed task archival (TASKS.md with >10 completed tasks).

After generating, report what changed in the task supply.

## Assess context

For the recommended task and its project, also evaluate:

- **Gravity signals**: Are there recurring manual fixes or workarounds flagged in recent logs?
- **Uncommitted work**: Does `git status` show meaningful uncommitted changes that should be committed first?
- **Decision debt**: Are there implicit choices being made that should be recorded in `decisions/` (system-wide) or `projects/<project>/decisions/` (project-direction)?
- **Compound opportunities**: Check for recent `diagnosis-*.md` and `postmortem-*.md` files (last 14 days) in `projects/`. If any contain unactioned recommendations relevant to the recommended task, surface them so the session can address them.

## Output format

Produce a brief orientation report with these sections:

**State**: 2-3 sentence summary

**Uncommitted work**: Git status

**Mission gap analysis**: Per-project condition counts (satisfied, has task, gaps). List gaps and generated tasks.

**Recommended task**: Task text, project, why highest-leverage, expected output

**Cross-session patterns**: Recurring issues from recent logs

**Gravity signals**: Recurring manual patterns

**Compound opportunities**: Unactioned recommendations from recent diagnostics

**Task supply updates**: What you generated, decomposed, or updated

**Risks**: Anything wrong, stalled, or drifting

**Recommended skill**: Which skill to apply first, or "none — proceed with implementation"

**Skill selection guide**:
- Just finished experiment → `/review`
- Results to interpret → `/diagnose`
- Reviewing plan/design → `/simplify` or `/critique`
- Something went wrong → `/postmortem` or `/diagnose`
- Accumulated findings → `/synthesize`
- Recurring pattern → `/gravity`
- Need papers → `/lit-review`
- Designing experiment → `/design`
- Research gap → `/project propose`
- Paper ready → `/publish`
- Infra/code changes → `/develop` or `/architecture`
- Compliance → `/self-audit`
- End of session → `/compound`

Keep the report concise. End with one clear recommended task.
