Session discipline conventions for Youji.

## Session start

- Every autonomous session begins with `/orient` (or manual orient: read project README, TASKS.md, git status)
- Check for uncommitted work from prior sessions -- commit orphaned files if found
- Read `APPROVAL_QUEUE.md` for pending decisions

## Session end

- Every session ends with a git commit and log entry
- If a session produces no useful work (no actionable tasks, blocked on approvals), log that fact and end cleanly -- do not invent work
- Verify: the repo, read fresh by a new agent, contains everything this session learned

## Fire-and-forget experiments

Sessions submit experiments, they do not supervise. Never run training loops, rendering pipelines, or other long-running compute in-process within the agent session.

If a process will run longer than ~2 minutes, launch it detached:
1. Create the experiment directory, config, and run script
2. Launch the process detached (background, nohup, etc.)
3. Commit the experiment setup and log the submission
4. End the session -- analysis happens in a future session

**Warning signs of babysitting:** If you find yourself (a) watching epoch progress, (b) waiting for training loss to converge, (c) checking if early stopping triggered, or (d) running `sleep` in a loop -- stop immediately.

## Sleep limits

Never sleep more than 30 seconds in a session. Sleep-poll loops waiting for experiment output are waste. If you find yourself wanting to `sleep` and check output, use fire-and-forget submission instead.

## Incremental commits

Commit incrementally during sessions. After completing a logical unit of work (experiment setup, analysis write-up, log archiving), run `git add && git commit` before proceeding to the next step. Do not defer all commits to the final "Commit and close" step.

This prevents losing work if the session times out or exhausts its context/turn budget. A session that produces 10+ file changes without a single intermediate commit is a workflow failure.

## Incremental analysis throttling

When analyzing results from a running experiment, apply checkpoint discipline:
- Analyze at most at these checkpoints: ~25%, ~50%, ~75%, and 100% (final)
- After an intermediate analysis, note in the task description when the next analysis is warranted
- If fewer than 20% new rows have accumulated since the last analysis, skip the task and select something else
- When creating an analysis task for a running experiment, split into a preliminary analysis task (satisfiable mid-experiment) and a final analysis task (blocked-by experiment completion)

## Infra-only sessions

Sessions that touch only infrastructure code (e.g., `infra/scheduler/`, `.claude/skills/`, `docs/conventions/`) still require a project log entry. Log these changes to `projects/youji/README.md` — infrastructure improvements are part of the youji meta-project (self-improvement of the autonomous system).

This prevents a gap where operational changes are committed but never recorded in any project log, making them invisible to future orient scans.

## Convention propagation

When modifying a rule that appears in multiple documents (CLAUDE.md, SOPs, decision records, skills), propagate the change to all locations in the same turn.

## Decision respect

Do not re-litigate decisions recorded in `decisions/`. If a decision seems wrong, discuss with the researcher or add it to APPROVAL_QUEUE.md as a structural request.

## Session wall time

Respect session budget: max 30 minutes wall time for autonomous sessions. Interactive sessions with the researcher may run longer as needed.
