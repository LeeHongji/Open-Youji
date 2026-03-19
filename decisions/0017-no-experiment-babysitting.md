# 0017: No Experiment Babysitting — Fire-and-Forget Convention

Date: 2026-02-18
Status: accepted

## Context

Work session `work-session-mlqshn9m` launched two Phase A experiments as background
processes, then spent ~50 minutes in a sleep-poll loop (`sleep 300` + `tail`/`grep`)
waiting for experiments that would take 1-2 hours. The session timed out at 60 minutes
with no commit and no analysis produced. Full postmortem:
`projects/youji/postmortem/postmortem-experiment-babysitting-2026-02-18.md`.

The experiment infrastructure (`infra/experiment-runner/run.py --detach`,
`infra/scheduler/src/experiments.ts: launchExperiment()`, `trackExperiment()`,
`progress.json` monitoring, Slack completion callbacks) already provides fully
asynchronous experiment execution. But no convention document — CLAUDE.md, the
autonomous work cycle SOP, or any project README — mentioned this infrastructure.
The agent had no way to discover it during normal orientation.

This is a gravity signal (CI framework): infrastructure built at L2 (workflow tools)
was not absorbed into L5 (agent conventions). The knowledge existed in code but not
in the agent's working context.

## Decision

Add a "fire-and-forget" convention for long-running processes to three locations:

1. **CLAUDE.md "Session discipline"** — a hard rule: sessions submit experiments
   via the experiment runner, they do not babysit. Never sleep more than 30 seconds.
2. **Autonomous work cycle SOP Step 3** — flag long-running experiments during
   classification so the agent plans for async submission from the start.
3. **Autonomous work cycle SOP Step 4** — explicit procedure for experiment
   execution: submit via `run.py --detach`, commit setup, log submission, end session.

The rule is principle-based ("sessions submit, they do not supervise") with a concrete
guardrail ("never sleep >30 seconds"). The principle prevents the category of waste;
the threshold makes violations detectable.

The correct lifecycle for experiments that exceed the session window:

1. Session creates experiment directory, config files, run script (setup).
2. Session launches via `python infra/experiment-runner/run.py --detach` (submit).
3. Session registers with scheduler: `curl -s -X POST http://localhost:8420/api/experiments/register -H 'Content-Type: application/json' -d '{"dir":"<abs-path>","project":"<project>","id":"<experiment-id>"}'` (track).
4. Session commits setup + submission log entry (record).
5. Session ends. The scheduler's experiment watcher monitors `progress.json`
   with 10-second polling and posts Slack notifications on completion.
6. A future session picks up analysis of completed results.

Step 3 is critical: without registration, the scheduler falls back to periodic
discovery scans which have lower time resolution. Registration enables the same
fast polling path used by Slack-launched experiments.

## Consequences

- Agents will know about the experiment infrastructure from their first orientation,
  because it is now documented in CLAUDE.md and the SOP.
- Sessions that launch experiments will commit their setup immediately rather than
  waiting, ensuring no work is lost to timeouts.
- The 30-second sleep limit is conservative but enforceable. Legitimate use of brief
  sleeps (e.g., waiting for a process to write its first output) remains allowed.
- Analysis of experiment results becomes a separate task, naturally picked up by a
  future session after the completion callback fires. This matches the existing
  architecture.
- The convention change is propagated to CLAUDE.md, the SOP, and this decision
  record — all in the same commit per CLAUDE.md's "Decisions" convention.
