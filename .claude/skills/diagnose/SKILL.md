---
name: diagnose
description: "Use when experimental results are unexpected, confusing, or need interpretation"
argument-hint: "<results path or description>"
---

# /diagnose <results path or description>

You are diagnosing empirical results — finding patterns in errors, generating hypotheses about root causes, and assessing whether the results mean what they appear to mean. This is the analytical complement to `/synthesize` (which works across accumulated findings); `/diagnose` works within one result set.

The argument is a path to results (CSV, log entry, analysis output) or a description of what to examine. Read the data first.

## When to use this vs alternatives

- **Use `/diagnose`** when you have *empirical results* (CSVs, metrics, error logs) and want to understand what they mean — error patterns, root-cause hypotheses, validity assessment.
- **Use `/postmortem`** when the problem is not "what do the results mean?" but "why did an agent report flawed results as correct?" Postmortem analyzes *reasoning failures*; diagnose analyzes *data*.
- **Use `/review metrics`** when you suspect the metrics themselves may be degenerate or misleading before interpreting the results. `/review` checks whether results are interpretable; `/diagnose` interprets them.

## Step 1: Understand the experiment

- Read the results file and any associated project log entries.
- Identify what was measured, what was varied, and what the expected outcome was.
- Read the experiment design or method description if one exists.
- Identify which CI layers are involved.

## Step 2: Characterize the error distribution

Do not start with individual examples. Start with the distribution:

- **Overall rates**: What is the base rate of success/failure? How does it compare to random chance or a naive baseline?
- **Conditional rates**: Break errors down by every available dimension (model, question type, category, run number, etc.). Where are errors concentrated?
- **Error types**: Categorize errors. Are they systematic (same direction, same condition) or random (scattered)? Common categories for judgment tasks:
  - Wrong direction (picked A when B was correct)
  - False consensus (called a tie when humans disagreed)
  - False distinction (picked a winner when humans saw a tie)
  - Magnitude error (correct direction but wrong confidence)
- **Temporal patterns**: Do error rates change over runs? Is there a position effect, order effect, or fatigue analog?

If the data is in CSV or structured format, use `python` to compute breakdowns rather than eyeballing.

## Step 3: Generate root-cause hypotheses

For each systematic error pattern found in Step 2, generate candidate explanations. For each hypothesis:

- **State the hypothesis** as a testable claim
- **Name the CI layer** where the root cause lives:
  - L1 Model: the LLM lacks the capability
  - L2 Workflow: the pipeline introduces the error
  - L3 Interface: the presentation format loses information
  - L4 Methodology: the metric misrepresents performance
  - L5 Human/Data: the ground truth itself is questionable
- **State what evidence would confirm or refute** this hypothesis
- **Rate plausibility**: high (consistent with multiple error patterns), medium (consistent but other explanations exist), low (speculative)

Resist the temptation to attribute everything to the model (L1). Most errors in automated systems come from workflow (L2), interface (L3), or methodology (L4).

## Step 4: Assess validity

Before interpreting the results as meaningful, check:

- **Construct validity**: Does the measurement capture what it claims to? Where is the gap between operationalization and construct?
- **Statistical validity**: Is the sample size sufficient to support the conclusions? Are the observed differences larger than expected noise? If you can compute confidence intervals or significance tests, do so.
- **External validity**: Would these results generalize to other datasets, other models, other prompt formats? What are the boundary conditions?
- **Ground truth quality**: How reliable is the ground truth? What is the inter-annotator agreement? Are there known biases in the human data?

## Step 5: Recommend next steps

Based on the diagnosis, recommend concrete actions:

- **Quick wins**: Changes that could improve results with minimal effort (e.g., adjusting a threshold, fixing a prompt)
- **Experiments needed**: Hypotheses that require new experiments to test (reference `/design` for designing them)
- **Validity concerns**: Issues that need to be resolved before interpreting results further
- **What NOT to do**: Common reactions that would be wrong given the diagnosis

## Step 6: Record model limits (if L1 hypothesis confirmed)

If any root-cause hypothesis attributed to L1 (Model) is rated "high" plausibility, record it in the same turn:

1. The relevant project README (as an open question or warning)
2. The diagnosis itself (with evidence and mitigation)
3. A model-notes file in the project or `knowledge/` directory

Skip this step if no root-cause hypothesis involves L1, or if all L1 hypotheses are low plausibility.

## Output format

```
## Diagnosis: <what was examined>
CI layers involved: <L1-L5>
Date: YYYY-MM-DD

### Error distribution
<rates, breakdowns, error type categorization — with specific numbers>

### Systematic patterns
<numbered list of patterns with evidence>

### Root-cause hypotheses

#### Hypothesis 1: <testable claim>
Layer: <L1-L5>
Evidence for: <what supports this>
Evidence against: <what contradicts this>
Test: <what experiment would confirm/refute>
Plausibility: high | medium | low

[repeat for each hypothesis]

### Validity assessment
- Construct: <assessment>
- Statistical: <assessment>
- External: <assessment>
- Ground truth: <assessment>

### Recommended actions
- Quick wins: <bulleted>
- Experiments needed: <bulleted, with enough detail to feed into /design>
- Validity concerns: <bulleted>
- Avoid: <what not to do and why>

### Model-limit notes
<"Recorded model-specific limit: <what was added/changed>" or "No confirmed L1 root cause — skip">
```

Prioritize depth over breadth. One well-grounded hypothesis with clear evidence is worth more than five speculative ones.

## Save to disk

Write the diagnosis to `projects/<project>/diagnosis/diagnosis-<brief-slug>-YYYY-MM-DD.md`. Create the `diagnosis/` directory if it doesn't exist yet.

## Task Bridge

After saving the diagnosis to disk, convert actionable recommendations to tasks:

1. For each item in "Quick wins" and "Experiments needed":
   - Check the project's TASKS.md for an existing task covering the same action
   - If no existing task, create one with `Done when:` and `Why:` referencing this diagnosis
2. For "Validity concerns" that require follow-up experiments: create a task referencing `/design`
3. Do NOT create tasks for "What NOT to do" items — these are anti-patterns, not actions

## Commit

Commit message: `diagnosis: <brief summary of what was diagnosed>`
