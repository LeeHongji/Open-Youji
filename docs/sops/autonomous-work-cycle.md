Step-by-step procedure for Youji's autonomous sessions.

## Autonomous Work Cycle

When: Triggered by cron schedule, manual `claude -p` invocation, or researcher request.
Requires: Youji repo checked out, CLAUDE.md loaded, /orient skill available. Skill classification reference: [docs/skill-classifications.md](../skill-classifications.md).

### 1. Orient

- Run `/orient` skill (or manually: read project READMEs, TASKS.md files, git status)
- Read `APPROVAL_QUEUE.md` -- note which projects/tasks have pending approvals
- For resource-consuming tasks: verify budget headroom from `budget.yaml` and `ledger.yaml` (if applicable)
- Check for uncommitted work from prior sessions -- commit orphaned files if found

> Output: orientation report with priority recommendation

### 2. Select task

- From the recommended project, read its `TASKS.md`
- Score tasks by:
  (a) Unblocked -- no `[blocked-by: ...]` tag
  (b) Concrete "Done when" condition exists
  (c) Aligns with project mission
  (d) Priority level (high > medium > untagged)
- Skip tasks tagged `[approval-needed]`, `[in-progress: ...]`, or referenced in a pending APPROVAL_QUEUE.md item
- If a task is tagged `[approved: YYYY-MM-DD]`, prefer it (researcher explicitly approved)
- If no actionable tasks in the recommended project, check other active projects before giving up
- If no actionable tasks exist anywhere:
  1. Run mission gap analysis -- compare project `Done when` criteria against task inventory and generate tasks for unmet conditions
  2. If no gaps, log "no actionable tasks" and end the session

> Output: selected task with rationale logged to project README

### 3. Classify task scope

**First: apply the resource-signal checklist.** Before classifying, ask whether the task involves any of these:

1. **LLM API calls** -- calling any language model (evaluation, summarization, generation)?
2. **External API calls** -- calling any third-party API?
3. **GPU compute** -- running inference, training, or rendering that requires GPU?
4. **Long-running compute** -- processes expected to run >10 minutes?

If ANY answer is yes --> the task consumes resources. Check the project budget before proceeding.
If ALL answers are no --> the task does not consume resources. Proceed regardless of budget state.

**If item 3 (GPU compute) or item 4 (long-running compute) is yes:** The task requires fire-and-forget execution -- never run training loops, rendering, or inference in-process within the agent session. Plan the session as: setup experiment directory, config, and run script --> submit via detached process --> commit setup --> end session. Analysis of results happens in a future session.

**Warning signs of babysitting:** If during execution you find yourself (a) watching epoch progress, (b) waiting for training loss to converge, (c) checking if early stopping triggered, or (d) running `sleep` in a loop -- stop immediately. Commit whatever work you have, convert to fire-and-forget or end the session.

**Then classify into one of these categories:**

- **ROUTINE**: Resource-signal checklist is all "no" -- literature search, data analysis on existing data, writing log entries, updating documentation.
  --> Proceed autonomously.
- **RESOURCE**: Resource-signal checklist has at least one "yes" AND it would exceed the project's remaining budget, OR request to increase budget limits.
  --> Scale down to fit remaining budget, or write to `APPROVAL_QUEUE.md` with cost estimate, end session.
- **STRUCTURAL (verifiable)**: Code changes, new decision records, validator extensions -- where correctness can be confirmed by tests, type checks, or validators.
  --> Proceed autonomously. Run verification before committing.
- **STRUCTURAL (non-verifiable)**: CLAUDE.md edits, schema changes that alter contracts -- where correctness requires researcher judgment.
  --> Write to `APPROVAL_QUEUE.md` with rationale, end session.
- **EXTERNAL (blocking)**: Resource decisions (budget increases, deadline extensions) or governance changes.
  --> Write to `APPROVAL_QUEUE.md`, end session.

Note: git push does **not** require approval. Sessions commit and push freely.

### 4. Execute

- Tag the task `[in-progress: YYYY-MM-DD]` in TASKS.md
- Work the task following CLAUDE.md conventions
- **Invoke skills as needed.** During task execution, use any autonomous-capable skill when the task calls for it (e.g., `/design` before planning an experiment, `/lit-review` for literature gaps, `/critique` on a draft artifact). See [docs/skill-classifications.md](../skill-classifications.md) for which skills are autonomous-capable vs. researcher-triggered.
- Log inline per CLAUDE.md inline logging checklist
- **Commit incrementally.** After completing a logical unit of work (experiment setup, analysis write-up, EXPERIMENT.md updates), run `git add && git commit` before proceeding to the next step. Do not defer all commits to Step 6. This prevents losing work if the session times out.
- Respect session budget: max 30 minutes wall time
- **Long-running experiments: fire and forget.** If the task involves launching a process that may run >2 minutes, create the experiment directory, config, and run script, then launch detached. Commit the experiment setup, log the submission, and end the session. Analysis of results happens in a future session.
- **Convention propagation**: When modifying a rule that appears in multiple documents (CLAUDE.md, SOPs, decision records, skills), propagate the change to all locations in the same turn.
- If task completes: mark done in `TASKS.md` (`[x]`), add completion note
- If task is partially complete: log progress, update task description with remaining work, remove `[in-progress]` tag. **Never mark a task `[x]` with a "(partial)" annotation.** If work is partially done, keep the task `[ ]` and update the description to reflect remaining work, or split into a completed subtask and a new open task.

### 5. Compound

After completing the task, reflect on what this session learned and embed it into the system. This step closes the loop between doing work and improving the system's ability to do future work.

Run the `/compound` skill (or manually perform these checks):

1. **Session learnings**: What did this session discover that future sessions should know? If a non-obvious fact, gotcha, or pattern was encountered, does it belong in CLAUDE.md, a skill, or a decision record?
2. **Task discovery**: If this session completed an experiment or analysis, check whether the findings imply follow-up tasks. Create tasks with provenance.
3. **Convention drift**: Did this session work around a convention that didn't fit? If a CLAUDE.md rule or skill instruction was unhelpful or misleading, update it.
4. **Research questions**: Extract implicit research questions from experiment findings (unexplained results, untestable hypotheses). Propose new questions for project "Open questions" sections.
5. **Gravity candidates**: Did a pattern appear that has now recurred 3+ times? If so, flag it for `/gravity` evaluation.

**Scope control**: Compound should take 2-5 minutes, not dominate the session. Make direct updates only when the change is small and obviously correct. For larger changes, add a task to the project's `TASKS.md`.

> Output: Zero or more direct file updates plus zero or more new tasks. If no compound actions are warranted, log "Compound: no actions" and proceed.

### 6. Commit and close

- Stage any remaining changed files and commit with a descriptive message (most work should already be committed incrementally during Step 4)
- If experiments consumed resources, append entries to the project's `ledger.yaml` (if applicable)
- Append session summary to project README log:

```
### YYYY-MM-DD

<what happened, what changed, what was learned>

Session-type: autonomous | interactive
Task-selected: <task description or "none">
Task-completed: yes | partial | no
Files-changed: <count>
Commits: <count>
Compound-actions: <count> or "none"
```

- If new tasks were discovered during execution, add them to `TASKS.md`

Check: The repo, read fresh by a new agent, contains everything this session learned. No context exists only in conversation history.
