Step-by-step procedure for autonomous agent sessions in the youji repo.

## Autonomous Work Cycle

When: Triggered by cron schedule or manual invocation of an autonomous session.
Requires: youji repo checked out, CLAUDE.md loaded, /orient skill available. Skill classification reference: [docs/skill-classifications.md](../skill-classifications.md).

### 1. Orient

- Run `/orient` skill — the scheduler injects tier directives (fast or full) based on `lastFullOrientAt` tracked in job state (see [ADR 0030](../../decisions/0030-tiered-orient.md))
  - **Fast orient** (~2-3 turns): git status + TASKS.md + task selection. Runs when a full orient occurred within the last ~2 hours.
  - **Full orient** (~5-7 turns): comprehensive assessment including `docs/status.md`, project READMEs, budget/ledger, roadmap, session patterns, model limits, horizon-scan intel. Runs every ~2 hours or on state-change triggers.
- Read `APPROVAL_QUEUE.md` — note which projects/tasks have pending approvals
- For resource-consuming tasks: verify budget headroom from `budget.yaml` and `ledger.yaml`
  - If deadline is past or any resource is 100% consumed → project is not actionable (skip it for resource-consuming tasks; `[zero-resource]` tasks may still proceed)
→ Output: orientation report with priority recommendation (abbreviated for fast, comprehensive for full)

### 2. Select task

- From the recommended project, read its `TASKS.md`
- Score tasks by:
  (a) Unblocked — no `[blocked-by: ...]` tag
  (b) Concrete "Done when" condition exists
  (c) Aligns with project mission
- Skip tasks tagged `[approval-needed]`, `[in-progress: ...]`, or referenced in a pending APPROVAL_QUEUE.md item
- If a task is tagged `[approved: YYYY-MM-DD]`, prefer it (human explicitly approved)
- If no actionable tasks in the recommended project, check other active projects (except excluded ones) before giving up
- If no actionable tasks exist in any eligible project, apply the **empty-queue fallback** (see orient skill): (1) run mission gap analysis per ADR 0049 — compare project `Done when` criteria against task inventory and generate tasks for unmet conditions, (2) if no gaps, scan for unsurfaced recommendation files and suggest `/compound deep` if any exist. Only log "no actionable tasks" and end the session if no gaps and no unsurfaced recommendations exist
- **Claim the task** via `curl -s -X POST http://localhost:8420/api/tasks/claim` with `taskText`, `project`, and `agentId` (from `SESSION_ID` scheduler directive). If 409 (already claimed), select a different task. If the API is unavailable, proceed without claiming. The executor auto-releases claims when the session ends.
→ Output: selected task with rationale logged to project README

### 3. Classify task scope

**First: apply the resource-signal checklist.** Before classifying, ask whether the task involves any of these:

1. **LLM API calls** — calling any language model (evaluation, summarization, generation)?
2. **External API calls** — calling any third-party API (3D generation, image generation, web services)?
3. **GPU compute** — running inference, training, or rendering that requires GPU?
4. **Long-running compute** — processes expected to run >10 minutes (data processing, simulations)?

If ANY answer is yes → the task consumes resources. Set `consumes_resources: true` in the EXPERIMENT.md frontmatter and check the project budget before proceeding.
If ALL answers are no → the task does not consume resources. Set `consumes_resources: false` and proceed regardless of budget state.

**If item 3 (GPU compute) or item 4 (long-running compute) is yes:** The task requires fire-and-forget execution — never run training loops, rendering, or inference in-process within the agent session. This explicitly includes local GPU training (PyTorch, JAX, etc.) even on locally-available GPUs. Training runs with multiple epochs routinely take 5-20+ minutes and cause session timeouts, producing orphaned files that cascade into attribution errors across subsequent sessions. Plan the session as: setup experiment directory, config, and run script → submit via experiment runner (`infra/experiment-runner/run.py --detach`) → commit setup → end session. Analysis of results happens in a future session. See [decisions/0017-no-experiment-babysitting.md](../../decisions/0017-no-experiment-babysitting.md).

**Warning signs of babysitting:** If during execution you find yourself (a) watching epoch progress, (b) waiting for training loss to converge, (c) checking if early stopping triggered, or (d) running `sleep` in a loop — stop immediately. Commit whatever work you have, and either convert to fire-and-forget submission or end the session and create a task for result analysis.

Note: the `type` field is *what kind of work* (experiment, analysis, implementation, bugfix). The resource-signal checklist determines *whether it costs resources*. An analysis that calls an LLM to summarize data is `type: analysis` with `consumes_resources: true`. A bugfix that only changes code is `type: bugfix` with `consumes_resources: false`.

**Then classify into one of five categories:**

- **ROUTINE**: Task where the resource-signal checklist is all "no" — literature search, data analysis on existing data, running existing pipelines, writing log entries, updating documentation.
  → Proceed autonomously.
- **RESOURCE**: Task where the resource-signal checklist has at least one "yes" **AND** it would exceed the project's remaining budget (per `budget.yaml` / `ledger.yaml`), **OR** request to increase `budget.yaml` limits or extend deadlines.
  → Scale down to fit remaining budget, or write to `APPROVAL_QUEUE.md` with cost estimate and budget increase request, end session.
- **STRUCTURAL (verifiable)**: Infra code changes, new decision records, validator extensions — where correctness can be confirmed by static checks (type checker, tests, validators).
  → Proceed autonomously. Run verification before committing.
- **STRUCTURAL (non-verifiable)**: New projects, CLAUDE.md edits, schema changes that alter external-facing contracts — where correctness requires human judgment.
  → Write to `APPROVAL_QUEUE.md` with rationale, end session.
- **EXTERNAL (blocking)**: Resource decisions (budget increases, deadline extensions) or governance changes that require human judgment.
  → Write to `APPROVAL_QUEUE.md` with description, end session.
- **EXTERNAL (non-blocking)**: Creating GitHub releases or version tags.
  → Write to `APPROVAL_QUEUE.md` for visibility, but continue working. Do not end the session.
- **TOOL-ACCESS**: Task requires a tool, API, or model that is not currently configured or available in the environment.
  → Write to `APPROVAL_QUEUE.md` with type `tool-access`, tag the task `[blocked-by: tool-access approval for <tool>]`, and attempt to select a different task. If no other task is actionable, end the session.

Note: git push does **not** require approval or an approval queue entry. Sessions commit and push freely.

### 4. Execute

- Tag the task `[in-progress: YYYY-MM-DD]` in the project README
- Work the task following CLAUDE.md conventions
- **Invoke skills as needed.** During task execution, use any autonomous-capable skill when the task calls for it (e.g., `/design` before planning an experiment, `/lit-review` for literature gaps, `/critique` on a draft artifact). See [docs/skill-classifications.md](../skill-classifications.md) for which skills are autonomous-capable vs. human-triggered. Do not invoke human-triggered skills (`/coordinator`, `/feedback`, `/report`, `/slack-diagnosis`).
- Log inline per [decisions/0004-inline-logging.md](../../decisions/0004-inline-logging.md)
- **Commit incrementally.** After completing a logical unit of work (experiment setup, analysis write-up, log archiving, EXPERIMENT.md updates), run `git add && git commit` before proceeding to the next step. Do not defer all commits to Step 6. This prevents losing work if the session times out or exhausts its turn budget. A session that produces 10+ file changes without a single intermediate commit is a workflow failure.
- **Batch archival commits per project.** When archiving (log entry archival, completed task archival), stage all archival changes for a single project together and commit once. Do not create separate commits for log moves vs. task moves within the same project. Example: archiving 3 log entries + 2 completed tasks from style-project → one commit, not two.
- Respect session budget: max 30 minutes wall time
- **Long-running experiments: fire and forget.** If the task involves launching a process that may run >2 minutes (API evaluation batches, training, rendering, GPU inference), use the experiment runner's detach mode. **Never run training loops (PyTorch, JAX, etc.) in-process** — always create a standalone script and launch it detached:
  1. Create the experiment directory, config files, and run script.
  2. Launch with **all mandatory flags** (per [decisions/0027-experiment-resource-safeguards.md](../../decisions/0027-experiment-resource-safeguards.md)):
     ```
     python infra/experiment-runner/run.py --detach \
       --project-dir <project-dir> \
       --max-retries <N> \
       --watch-csv <output-csv> --total <N> \
       <experiment-dir> -- <command...>
     ```
     - `--project-dir`: enables budget pre-check and post-completion consumption audit. **Never omit this for resource-consuming experiments.**
     - `--max-retries`: explicit retry limit (forces conscious choice about retry tolerance).
     - `--watch-csv` + `--total`: enables retry progress guard (detects stalled/duplicate-producing retries).
  3. Register with scheduler: `curl -s -X POST http://localhost:8420/api/experiments/register -H 'Content-Type: application/json' -d '{"dir":"<abs-path>","project":"<project>","id":"<experiment-id>"}'`
  4. Commit the experiment setup and log the submission (PID, estimated duration).
  5. End the session. The scheduler watches `progress.json` with 10s polling and posts Slack notifications on completion.
  6. Do NOT `sleep` in a loop waiting for output. Do NOT tail log files waiting for completion. The session's job is setup and submission, not supervision.
- **Experiment result verification**: When checking a completed or failed experiment's `progress.json`, always check the `status` field first. If `status: "failed"`, do NOT interpret `current` or `pct` as success counts — they track iterations (CSV rows written), not successful completions. Verify actual output files exist before reporting progress. See `projects/style-project/postmortem/postmortem-false-progress-reporting-2026-02-25.md`. **Also beware multi-phase experiments**: `pct: 100.0` may mean one phase completed, not the entire experiment. Multi-trial experiments (e.g., `run_multi_trial.sh` running 4 sequential runs) track progress within a single run — always verify how many output files exist in the results directory before declaring the experiment complete. See sample-benchmark session 2026-03-02 (progress.json showed 760/760 but only 2/5 runs were complete).
- **Incremental analysis throttling**: When analyzing results from a running experiment, apply checkpoint discipline per [decisions/0023-incremental-analysis-throttling.md](../../decisions/0023-incremental-analysis-throttling.md):
  - Analyze at most at these checkpoints: ~25%, ~50%, ~75%, and 100% (final). Do not analyze on every session.
  - After an intermediate analysis, note in the task description when the next analysis is warranted (e.g., "Next analysis at ~N rows or completion").
  - If fewer than 20% new rows have accumulated since the last analysis, skip the task and select something else.
  - When creating an analysis task for a running experiment, prefer splitting into a preliminary analysis task (satisfiable mid-experiment) and a final analysis task (blocked-by experiment completion).
- **ADR task bridge**: When writing an ADR with a Migration or Consequences section containing action items not implemented in this session, create tasks in the relevant project's `TASKS.md` before committing the ADR. See CLAUDE.md Decisions section.
- **Convention propagation**: When modifying a rule that appears in multiple documents (CLAUDE.md, SOPs, decision records, pattern docs, skills), propagate the change to all locations in the same turn.
- If task completes: mark done in `TASKS.md` (`[x]`), update `docs/status.md` if the change is significant
- If task is partially complete: log progress, update task description with remaining work, remove `[in-progress]` tag. **Never mark a task `[x]` with a "(partial)" annotation.** If work is partially done, keep the task `[ ]` and update the description to reflect remaining work, or split into a completed subtask and a new open task. The `[x]` checkbox is binary — the task selector treats it as complete and will never revisit it.

### 5. Compound

After completing the task, reflect on what this session learned and embed it into the system. This step closes the loop between doing work and improving the system's ability to do future work. See [ralph-loop-architecture-analysis](../../projects/youji/analysis/ralph-loop-architecture-analysis.md) Finding 2 for rationale.

Run the `/compound` skill — the skill auto-detects whether to run **fast** or **full** compound based on recency of the last full compound (see `projects/youji/analysis/compound-step-overhead-analysis.md`):
  - **Fast compound** (~1-2 turns): Steps 1-2 + task discovery + fleet spot-check (review session work, session learnings, implied tasks, fleet verification pass rate). Runs when a full compound occurred within the last ~3 hours.
  - **Full compound** (~2-5 minutes): All steps including cross-session scanning. Runs every ~3 hours or on state-change triggers.
  - **Deep compound** (~10-15 minutes): Thorough scan across all projects. Standalone invocation only.

The checks performed (full/deep mode include all; fast mode includes 1, 2, 4, and 9):

1. **Session learnings**: What did this session discover that future sessions should know? Check the git diff for the session's work — if a non-obvious fact, gotcha, or pattern was encountered, does it belong in CLAUDE.md, a skill, or a decision record?
2. **Task discovery** (all tiers): If this session completed an experiment or analysis, check whether the findings imply follow-up tasks (failed success criteria, insufficient sample sizes, identified confounds, multi-phase experiments with missing phase tasks). Create tasks with provenance. This is a quick check (~1 turn) that prevents the most common knowledge-loss pattern: experiment findings that imply work but never become tasks.
3. **Unactioned recommendations** (full/deep only): Scan `projects/*/diagnosis/diagnosis-*.md`, `projects/*/postmortem/postmortem-*.md`, and legacy `projects/*/diagnosis-*.md`, `projects/*/postmortem-*.md` modified in the last 14 days. Also scan completed EXPERIMENT.md files for formal recommendation sections. If any recommendations are directly actionable given the current session's context, apply them. Otherwise note them as tasks.
4. **Convention drift**: Did this session work around a convention that didn't fit? If a CLAUDE.md rule or skill instruction was unhelpful or misleading, update it.
5. **Research questions** (full/deep only): Extract implicit research questions from experiment findings (unexplained results, untestable hypotheses, aggregate-stratum reversals), cross-session patterns with unknown root causes, and literature gaps. Propose new questions for project "Open questions" sections.
6. **Gravity candidates** (full/deep only): Did a pattern appear that has now recurred 3+ times? If so, flag it for `/gravity` evaluation in the next session (or apply directly if the migration is trivial).
7. **Domain knowledge synthesis** (deep only): Check whether any active project has 10+ completed experiments without a `knowledge.md` (or with a stale one). If so, flag domain synthesis as a task candidate. Per `feedback/feedback-domain-knowledge-consolidation.md`.
8. **Complexity monitoring** (deep only): Check artifact sizes (CLAUDE.md >400 lines, README >200 lines, TASKS.md >150 lines, source files >500 lines) and flag growth. Flagged artifacts get a simplification task created. **Skills use tiered triggers:** >200 lines = flag, >300 lines = create task, >400 lines = mandatory simplify before adding more content (hard gate). Per `feedback/feedback-simplify-skill-deployment-strategy.md` and `feedback/feedback-skill-growth-governance.md`.
9. **Fleet output audit** (all tiers — fast: spot-check last 5 sessions; full/deep: full audit per `projects/youji/plans/fleet-quality-audit-checklist.md`): Check fleet worker verification pass rate, task completion integrity (D1), and escalation appropriateness (D5). Flag dimensions with <70% pass rate. Per fleet bootstrap plan Step 2.2.

**Scope control**: Fast compound takes 1-2 turns. Full compound should take 2-5 minutes, not dominate the session. Make direct updates only when the change is small and obviously correct (fixing a typo in a convention, adding a gotcha to a skill). For larger changes, add a task to the project's `TASKS.md` instead.

**Output**: Zero or more direct file updates (CLAUDE.md, skills, conventions) plus zero or more new tasks. If no compound actions are warranted, log "Compound (fast): no actions" or "Compound: no actions" and proceed.

### 6. Commit and close

- Stage any remaining changed files and commit with a descriptive message (most work should already be committed incrementally during Step 4)
- If experiments consumed resources, append entries to the project's `ledger.yaml` (if not already done inline during execution)
- **Rebase before push:** The scheduler's executor automatically runs `git pull --rebase origin main` after the agent session completes, then pushes. If rebase fails due to a conflict, it aborts and pushes to a `session-{runId}` fallback branch. Agents do not need to handle this manually — the executor manages it. See `projects/youji/architecture/concurrency-safety.md` §3 Race 3 for the full design.
- Append session summary to project README log, including the session metrics footer:

```
Session-type: autonomous
Duration: <minutes>
Task-selected: <task description or "none">
Task-completed: yes | partial | no
Approvals-created: <count>
Files-changed: <count>
Commits: <count>
Compound-actions: <count> or "none"
Resources-consumed: <resource: amount, ...> or "none"
Budget-remaining: <resource: remaining/limit, ...> or "n/a"
```

- If new tasks were discovered during execution, add them to `TASKS.md`
- If approval items were created, the scheduler will send a Slack notification after the session

Check: The repo, read fresh by a new agent, contains everything this session learned. No context exists only in conversation history.
