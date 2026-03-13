# youji - Next actions

## Meta-project setup

- [x] Adapt the self-improvement measurement plan to Youji's repo with 3-5 concrete metrics [requires-opus] [skill: design] [zero-resource]
  Done: plans/self-improvement-measurement.md rewritten with 5 concrete metrics (M1-M5), each with data sources, computation formulas, baselines from first 4 sessions, and an interpretation framework.

- [x] Run first self-audit of convention compliance [skill: self-audit] [zero-resource]
  Done: compliance-audit-2026-03-14.md — 6/8 checks passing.

- [x] Document convention for infra-only sessions: add logging requirement to session-discipline.md [zero-resource]
  Done: session-discipline.md now contains "Infra-only sessions" section routing infra changes to projects/youji/README.md.

- [x] Measure human intervention rate in Youji deployment [skill: analyze] [zero-resource]
  Done: findings/human-intervention-rate-2026-03-14.md — M4 = 0.33/session overall (1.0 pre-fix → 0.0 post-fix). Single critical infrastructure intervention (stdin blocking); zero task-level interventions.

- [x] Write one self-observation diagnosis from operational evidence [requires-opus] [skill: diagnose] [zero-resource]
  Done: diagnosis/orphaned-commit-attribution-loss.md — 40% of commits are generic orphaned-file auto-commits (273 lines of changes with no context). Root cause: interactive sessions not committing incrementally. Proposed 3 fixes with monitoring follow-up.

- [ ] Monitor orphaned commit rate over next 5 sessions [fleet-eligible] [zero-resource]
  Why: Follow-up from diagnosis/orphaned-commit-attribution-loss.md — need to determine if 40% rate is bootstrapping noise or recurring pattern.
  Done when: After 5 more autonomous sessions, compute orphaned commit % and decide whether to implement Fix 1 (descriptive auto-commit messages).
  Priority: low

- [x] Add one local example of a successful self-improvement loop [skill: compound] [zero-resource]
  Done: findings/self-improvement-loop-001-infra-logging.md — complete 4-stage loop (detect → task → fix → verify) for infra-only session logging convention gap. Zero human intervention, completed across 2 autonomous sessions.
