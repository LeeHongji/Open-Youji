Youji's fleet is an operational research system: many concurrent autonomous sessions, coordinated by infrastructure, producing measurable engineering and research output with sparse human intervention.

This document is intentionally evidence-heavy and implementation-light.

## What the fleet is

The fleet is a pool of concurrent worker agents launched by the scheduler to execute well-scoped tasks across many projects.

Key properties:

- **Scheduler-driven task assignment** (workers do not rely on /orient to self-select work)
- **Persistent memory in the repo** (logs, tasks, decisions, experiments)
- **Governance and safety gates** for expensive or irreversible actions
- **Operational metrics** recorded for post hoc analysis

If you want the pattern and trade-offs, read `decisions/0042-v2-persistent-subagent-fleet.md` and `projects/youji/patterns/autonomous-execution.md`.

## Evidence: sustained autonomous operation

The source system that youji was extracted from operated an always-on fleet for weeks. The most useful evidence is not a demo run; it is the distribution of outcomes over thousands of autonomous sessions.

Operational record excerpt (2026-02-25 through 2026-03-07):

- **Fleet sessions:** 5,303
- **Overall success rate:** 91.0% (4,825/5,303)
- **Knowledge-producing sessions:** 54.2% (2,876/5,303)

Selected aggregate outputs produced by those sessions:

- **Structural changes:** 7,026
- **New literature notes:** 1,647
- **New experiment findings:** 1,465
- **Experiments completed:** 185
- **Infra code changes:** 494
- **Decision records created:** 48

One useful detail: the fleet experienced a major transient incident (a concentrated run of worker crashes) and recovered to a high success rate within 48 hours. This matters because autonomy is not "never fails"; it is "fails, recovers, and continues producing work" under operational noise.

## Evidence: scarce human intervention

The cleanest operational proxy for explicit human intervention is the approval queue: every approval/denial is a concrete human decision that gates agent actions.

To avoid conflating fleet bootstrap with steady-state behavior, the most relevant window is the first full week after the fleet was already up and running.

In the week of 2026-03-02, the source system recorded:

- Week of 2026-03-02: **0.0079** approval events per session (12 events / 1,529 sessions)

That means explicit approval decisions were required in fewer than 1 out of 100 sessions during a week when the fleet was already operating at scale.

There is also a broader but noisier intervention estimate in the source analysis:

- Combined approval events + human correction commits: **0.0556** per session (85 / 1,529)

That number is useful, but it should be treated cautiously because the underlying production repo could not perfectly distinguish human correction commits from some agent commits.

Human involvement can also appear in forms that are not captured by the approval queue metric at all, including:

- feedback that redirects system behavior
- diagnosis or postmortem work that interprets failures and changes conventions
- exceptional recovery or governance actions outside the approval queue

In the same late window (2026-03-02 through 2026-03-04), the source repo also accumulated intervention-related artifacts:

- 2 feedback files
- 28 diagnosis files
- 1 postmortem file

These should not be interpreted as direct human-intervention events. Some were agent-authored reflective artifacts. They are better read as evidence that the system and its operators were still actively studying and correcting the operating process.

So the right claim is not "humans are absent." The right claim is that routine autonomous throughput can remain high while explicit human governance events stay sparse.

This is the autonomy claim youji is willing to make:

- Humans remain in the loop for governance.
- Human intervention can also take the form of feedback, diagnosis, or postmortem work.
- Explicit approval events can stay sparse even when the system is operating at scale.
- A broader full-intervention estimate exists, but it is noisier than the approval-queue metric.

## Why this makes AI-native software engineering into research

In a conventional engineering org, the system is engineered, but the engineering process itself is rarely instrumented as a first-class research object.

In Youji, the agentic software process is instrumented and studied:

- Sessions produce structured operational records.
- The system measures its own self-improvement loop (gap detection, closure rate, intervention rate).
- The system performs methodological audits on its metrics (e.g., identifying when an attribution method is invalid).

This is the core shift:

- AI-native software engineering is no longer just building tools.
- It becomes an empirical loop: observe operations -> form hypotheses -> change infrastructure/conventions -> measure the effect.

Youji is designed to make that loop legible and portable.

## What is intentionally omitted

This repo does not include private runtime logs, internal endpoints, hostnames/IPs, or proprietary deployment topology. Those are not required to learn the architecture or reproduce the operating model.

The evidence above is presented as aggregated operational outcomes rather than raw traces.

## How to reproduce this kind of evidence in your system

To replicate this style of claim in your own fork:

1. Ensure your scheduler writes per-session metrics (one line per session).
2. Require durable outputs (commit + log entry) for non-idle sessions.
3. Use an explicit approval queue for gated actions.
4. Run periodic analyses that compute:
   - success rate
   - knowledge-producing session rate
   - output counts by category
   - approval events per session

The exact scripts will differ by implementation, but the important thing is that the autonomy claims are computable from operational records.
