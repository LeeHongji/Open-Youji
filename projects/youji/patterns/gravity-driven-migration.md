Design pattern for systematic migration of capabilities from higher layers (human, skill) to lower layers (convention, code).

# Pattern: Gravity-Driven Capability Migration

## Summary

When recurring manual patterns emerge — workarounds, repeated fixes, frequently-invoked judgment — they migrate from higher layers (human intervention, skills) to lower layers (conventions, code). This downward migration is tracked and evaluated systematically using a recurrence threshold, cost-benefit framework, and migration plan. The `/gravity` skill formalizes the evaluation; the `/simplify` skill provides the counterbalance.

## Problem

As a system operates, patterns emerge at every layer:
- Humans repeatedly fix the same class of problem (orphaned files, budget miscalculations, hallucinated references)
- Skills encode judgment that eventually crystallizes into "always do X"
- Conventions accumulate that could be enforced programmatically

Without a mechanism to detect and evaluate these patterns, two failure modes occur:

1. **Ossification**: patterns stay at their initial layer indefinitely, requiring expensive human intervention for problems that could be automated.
2. **Premature formalization**: patterns are migrated before they're well-understood, creating brittle rules that don't handle edge cases.

The challenge is balancing speed (migrate quickly to reduce cost) with understanding (wait until the pattern is clear enough to encode correctly).

## Solution

### The gravity metaphor

Capabilities naturally tend to migrate downward through layers as they become better understood:

```
L5: Human intervention  ->  detect and observe
L3: Skill               ->  encode judgment
L2: Convention           ->  crystallize to rules
L0: Code                 ->  enforce programmatically
```

"Gravity" captures the directionality: manual patterns sink toward automation. But gravity requires force — patterns don't migrate on their own. The force comes from:
- **Pain signals**: the same manual fix needed 3+ times
- **Clarity signals**: the pattern is well-enough understood to encode without loss
- **Cost signals**: the ongoing cost of manual handling exceeds the one-time cost of migration

### Detection: the 3x recurrence threshold

A manual pattern becomes a migration candidate when it's observed 3 or more times. This threshold balances:
- Too low (1-2 occurrences): premature formalization risks encoding an anomaly rather than a pattern
- Too high (5+ occurrences): excessive cost from delayed migration

The `/orient` skill includes gravity signal detection: when processing session history, it flags recurring interventions for evaluation.

### Evaluation: the /gravity skill

The `/gravity` skill provides a structured evaluation framework:
1. **Characterize the pattern**: what recurs, at which layer, how often?
2. **Assess migration target**: which lower layer can encode this? (Not all patterns should migrate — some are irreducibly human)
3. **Cost-benefit analysis**: one-time migration cost vs. ongoing manual cost
4. **Migration plan**: concrete steps to move the capability downward
5. **Verification**: how to confirm the migration worked

### Counterbalance: the /simplify skill

Gravity is additive — it creates new conventions, skills, and code. Without a counterbalance, the system accumulates complexity. The `/simplify` skill evaluates whether existing structures should be removed by testing: "if I removed this, would the mission fail?" This prevents structure that was useful during one phase from persisting after its purpose is served.

### Multi-layer cascades

Some patterns migrate through multiple layers in sequence:

**Hallucination prevention cascade (L5->L2->L3->L0):**
1. L5: Human detects fabricated literature references
2. L2: Mandatory URL verification convention added to CLAUDE.md
3. L3: `/audit-references` skill created for systematic verification
4. L0: Literature citation validator added to experiment-validator

**Budget enforcement cascade (L5->L3->L2->L0):**
1. L5: Human detects budget overspend
2. L3: `/orient` updated to report budget status
3. L2: Protocol budget-check step added
4. L0: Budget gate and experiment runner pre-check

These cascades often complete in 1-2 days when the pain signal is clear.

### Upward gravity (theoretical)

As models improve, some coded capabilities may become unnecessary — the model handles them natively. This "upward gravity" would mean:
- Code checks that the model now reliably performs -> remove the check
- Conventions that the model follows without prompting -> remove the convention
- Skills that the model applies naturally -> retire the skill

This is theorized but not yet systematically observed or tracked.

## Forces and trade-offs

### Speed vs. understanding

Migrating quickly reduces the cost of manual handling but risks encoding an incomplete understanding. The 3x threshold is a compromise — enough occurrences to confirm the pattern is real, few enough to avoid excessive manual cost.

### Formalization vs. flexibility

Each downward migration trades flexibility for reliability. A human applying judgment (L5) can handle any edge case; code enforcing a rule (L0) handles only anticipated cases. The right migration level is the one that handles the known cases without losing important flexibility.

### Adding structure vs. removing it

The gravity and simplify skills are designed as counterweights, but in practice, gravity dominates — it's easier to add a convention than to remove one. The system tends toward increasing complexity. This bias is partially inherent (new problems require new solutions) and partially a limitation (no automated simplification evaluation).

## Evidence

Evidence from the OpenAkari system demonstrates complete gravity cascades:

**Budget enforcement cascade:** What started as a human observation ("agent overspent budget") migrated through: L5 human diagnosis -> L3 skill (orient reports budget) -> L2 convention (protocol budget-check step) -> L0 code (budget-gate.ts, experiment runner pre-check). The entire cascade completed in 2 days.

**Simulation as gravity response:** A simulation game was created as a gravity signal response: humans repeatedly evaluated agent capability by watching real research sessions (high cost, uncontrolled). The simulation moved "agent capability evaluation" from L5 (human judgment on real projects) to L0 (deterministic simulation with planted findings and scorecards) — a 4-layer migration.

**Human gravity analysis:** An analysis of human intervention types from operational logs identified 6 L5->L0/L2 intervention types: orphan recovery, configuration repair, budget enforcement, launch verification, status monitoring, and experiment supervision. Four automation proposals were derived and all were implemented.

**Additional cascades:**
1. **Hallucination prevention** — L5->L2->L3->L0: human detection -> mandatory URL verification -> /audit-references skill -> literature citation validator
2. **Analysis looping** — L5->L2->L3: human observation -> throttling convention -> /orient repetition penalty -> CLAUDE.md convention
3. **Model capability limits** — L5->L2->L3: reactive discovery -> centralized registry -> /orient consultation -> postmortem+diagnose discovery pipeline

## CI layer analysis

This pattern explicitly operates **across all CI layers** — it's a meta-pattern about how capabilities move between layers.

- **L5 (Human)**: detects initial pain signals, decides what to formalize
- **L3 (Skill)**: `/gravity` evaluates migration candidates, `/simplify` evaluates removal candidates, `/orient` detects gravity signals
- **L2 (Convention)**: many gravity outputs are conventions (rules in CLAUDE.md)
- **L0 (Code)**: mature migrations become runtime enforcement (validators, gates)

The gravity metaphor captures the directionality: capabilities tend to migrate downward (from human to code) as they become better understood. The layers are not strictly ordered — a pattern can skip layers (L5->L0) or migrate partially (L5->L2, stopping there).

## Known limitations

1. **Reactive, not proactive.** Gravity signals are detected after the pain has occurred (3+ occurrences). Proactive migration would require predicting which patterns will recur — which is itself a judgment task.

2. **No automatic detection.** Gravity signal identification is currently a manual/skill-guided process. Automated detection of recurring patterns in session logs would be a significant improvement but requires structured pattern matching across unstructured text.

3. **Upward gravity is untracked.** As models improve, some coded capabilities may become unnecessary. This reverse direction is theorized but not systematically monitored — the system only adds complexity, never removes it based on improved model capability.

4. **Simplify underused.** The `/simplify` skill exists as a counterbalance but is rarely invoked. The system has a structural bias toward adding conventions rather than removing them.

5. **No migration effectiveness measurement.** After a pattern migrates (e.g., hallucination prevention from L5 to L0), there's no systematic check that the migration actually reduced manual interventions. The assumption is that code enforcement is better than convention, but this isn't measured.

## Self-evolution gaps

- **Human-dependent**: Initial gravity signal detection typically comes from human observation. The system cannot currently identify its own recurring manual patterns.
- **Self-diagnosable**: Once a gravity signal is identified, the migration can be planned and executed by agents. The evaluation framework (/gravity skill) is itself agent-executable.
- **Gap**: The system needs automated recurring-pattern detection in session logs. If session metrics included a "manual intervention type" field, the system could aggregate across sessions and detect 3x recurrences automatically.

## Open questions

1. **Can gravity signal detection be automated?** Session logs contain natural-language descriptions of what happened. Could an LLM-based pattern detector scan logs for recurring themes and flag migration candidates?

2. **What is the right recurrence threshold?** 3x is a heuristic. Some patterns are clear after 1 occurrence (budget overspend — catastrophic, don't wait for 3x). Others need 5+ to distinguish pattern from coincidence. Should the threshold vary by severity?

3. **How do you detect upward gravity?** When a model improvement makes a convention redundant, what signals reveal this? Possible: track convention violation rates — if agents consistently produce correct output without following the convention, the convention may be unnecessary.

4. **Is there an optimal layer distribution?** The system currently has 25 skills, conventions in CLAUDE.md, and minimal code gates. Is there an optimal ratio? Too many conventions overloads the always-loaded context; too many skills creates selection burden.

## Related patterns

- **Autonomous Execution** ([patterns/autonomous-execution.md](autonomous-execution.md)) — the protocol through which gravity signals are detected (during orient) and migrations are implemented (during execution).
- **Layered Budget Enforcement** ([patterns/layered-budget-enforcement.md](layered-budget-enforcement.md)) — the paradigm case of a complete gravity cascade: human observation -> skill -> convention -> code.
- **Skills Architecture** ([patterns/skills-architecture.md](skills-architecture.md)) — skills are both a source (judgment that may crystallize) and a destination (human judgment encoded as skill) for gravity migrations.
