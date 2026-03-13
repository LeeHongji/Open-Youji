# youji - Next actions

## Meta-project setup

- [ ] Adapt the self-improvement measurement plan to Youji's repo with 3-5 concrete metrics [requires-opus] [skill: design] [zero-resource]
  Why: The adapted plan shows the pattern, but Youji's deployment needs its own metrics, denominators, and failure modes grounded in actual operational data.
  Done when: A repo-specific measurement plan exists with 3-5 concrete metrics and explicit data sources.
  Priority: high

- [x] Run first self-audit of convention compliance [skill: self-audit] [zero-resource]
  Done: compliance-audit-2026-03-14.md — 6/8 checks passing.

- [x] Document convention for infra-only sessions: add logging requirement to session-discipline.md [zero-resource]
  Done: session-discipline.md now contains "Infra-only sessions" section routing infra changes to projects/youji/README.md.

- [ ] Measure human intervention rate in Youji deployment [skill: analyze] [zero-resource]
  Why: A decreasing intervention rate is one of the clearest signals that the system is becoming more autonomous.
  Done when: A short analysis computes intervention events per session over at least 2 time windows and records the result.
  Priority: medium

- [ ] Write one self-observation diagnosis from operational evidence [requires-opus] [skill: diagnose] [zero-resource]
  Why: The meta-project only becomes real when the system diagnoses its own failure modes from its own logs and artifacts.
  Done when: One diagnosis file identifies a concrete self-observation failure, cites evidence, and proposes a fix or follow-up task.
  Priority: medium

- [ ] Add one local example of a successful self-improvement loop [skill: compound] [zero-resource]
  Why: The strongest evidence for the meta-project is a full loop: detect a gap, change the system, then measure improvement.
  Done when: README log entry or analysis file records a before/after operational improvement with provenance.
  Priority: medium
