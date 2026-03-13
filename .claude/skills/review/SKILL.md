---
name: review
description: "Validate experiment metrics and findings — run metrics-first to check computations are meaningful, then findings to check conclusions are valid"
argument-hint: "[metrics | findings] <path or experiment name>"
---

# /review [metrics | findings] <path or experiment name>

Validate experiment outputs in two modes. **Metrics mode** checks whether metric computations are meaningful given the experimental setup (run *before* writing findings). **Findings mode** checks whether written conclusions are valid (run *after* writing findings). If no mode is specified, run both in sequence: metrics first, then findings.

## When to use this vs alternatives

- **Use `/review metrics`** when you have metric definitions or computed values and want to check whether they are meaningful given the experimental setup.
- **Use `/review findings`** when findings have been written and you want to validate each claim.
- **Use `/review`** (no mode) to run the full pipeline: metrics validation then findings validation.
- **Use `/critique`** for a broad adversarial review across 10 failure dimensions. Critique is wider but shallower; /review goes deeper on metric validity and finding correctness.
- **Use `/diagnose`** when you want to understand *what results mean* — error patterns, root causes, hypotheses. Diagnose interprets results; /review checks whether they are interpretable and correctly stated.

---

## Metrics mode

### 1. Extract the constraint set

Identify the fixed parameters of the experiment:
- **Response schema**: What values can the model output?
- **n_runs**: How many repeated calls per evaluation?
- **Temperature**: Is there randomness across runs?
- **Sample size**: How many items/pairs/tasks?
- **Ground truth structure**: Does ground truth include ties, ordinal rankings, continuous scores?
- **Aggregation method**: How are repeated runs combined?

### 2. For each metric, apply these tests

#### Degeneracy test
Given the constraints, can this metric take more than one value? If the setup forces the metric to a constant regardless of model behavior, it is **degenerate**.

#### Discriminative power test
Can this metric distinguish between the things we want to compare? Check variance across conditions and whether a random baseline scores similarly.

#### Denominator test
Is the metric computed over a meaningful base? Is the denominator large enough? Are subgroups large enough when sliced?

#### Interpretation test
Does the metric name match what it actually measures? Check the computation.

#### Cross-experiment comparison test
For any metric comparison across experiments, verify that denominators and filtering criteria are explicitly stated. Flag comparisons that could mislead if denominators differ silently.

### 3. Trace to source

For each metric, find where it is computed in the codebase. Verify the implementation matches the claimed definition.

### Metrics output format

```
## Metric Audit: <experiment>

### Constraints
- Response schema: ...
- n_runs: ...
- Temperature: ...
- Sample size: ...
- Ground truth: ...

### <Metric name>
- Computation: <how it's calculated, with file:line reference>
- Degenerate: yes | no
- Discriminative: yes | no
- Denominator: adequate | too small | missing
- Name matches meaning: yes | no
- Cross-experiment comparison: n/a | explicit denominator | implicit/ambiguous
- Verdict: **valid** | **degenerate** | **misleading** | **underpowered**
- Action: keep | remove | rename | recompute with <change>

### Summary
- Metrics audited: N
- Valid: N | Degenerate: N | Misleading: N | Underpowered: N
```

---

## Findings mode

### For each finding or conclusion, apply these tests

#### 1. Design-vs-discovery test
Ask: "Could this result have been different given the experimental setup?" If no — if the result is a necessary consequence of the protocol — it is a **design constraint**, not a finding.

#### 2. Layer attribution test
Which CI layer does the finding describe? Is that attribution correct?

#### 3. Falsifiability test
Could an experiment in principle refute this claim?

#### 4. Redundancy test
Does another finding in the same report already cover this with better framing?

#### 5. Missing denominator test
Are rates reported without their base?

#### 6. Anthropomorphic explanation test
Does the finding explain model behavior using human psychological states? Use mechanistic terms instead.

#### 7. Cross-session citation verification test
For each numerical finding cited from a prior experiment, verify the number by re-running the source script or comparing against the source data file. Do not copy numbers from text without verification.

#### 8. Narrative coherence test
Does every category or dimension claimed in narrative sections have corresponding statistical validation? Extract all named categories and check results for each.

### Findings output format

```
## Finding Review: <artifact>

### <Finding N>: "<quoted claim>"
- Design-or-discovery: design constraint | genuine finding | mixed
- Layer attribution: <claimed> -> <actual> (or "correct")
- Falsifiable: yes | no
- Redundant with: <other finding> | none
- Missing denominator: yes | no
- Anthropomorphic explanation: yes | no
- Citation verified: n/a | yes (source: <file>) | no (stale/unverifiable)
- Narrative coherence: all categories validated | gaps: <missing> | n/a
- Verdict: **keep** | **reframe** | **cut**
- Note: <explanation if reframe or cut>

### Summary
- Findings reviewed: N
- Keep: N | Reframe: N (list) | Cut: N (list)
```

---

## Common rationalizations

| Excuse | Reality |
|--------|---------|
| "This finding is obviously valid" | Obvious findings are most likely to be tautologies. Apply all tests. |
| "The design-vs-discovery test doesn't apply" | It applies to every finding. |
| "Saying the model was confused is shorthand" | Shorthand that forecloses investigation. Use mechanistic terms. |
| "The number was already verified in the source" | The source may have been modified. Re-verify. |

## Red flags — STOP

- Marking "keep" without checking all tests
- Using "confused", "struggled", or "tried" to describe model behavior
- A finding that restates experimental design as a result
- Reporting a metric without its denominator
- Comparing metrics across experiments without stating denominators
- Citing a numerical finding from another experiment without verifying against source data

## Commit

Commit message: `review: <artifact reviewed>`
