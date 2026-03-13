---
name: analyze
description: "Use when analyzing experimental results, data, or research outputs"
---

# /analyze <data path or description>

You are analyzing research data or experimental results. Your goal is to extract meaningful findings with rigorous interpretation.

## Step 1: Understand the data

- Read the data source and any associated experiment design.
- What was measured? What was varied? What was expected?
- Check the experiment's success criteria if defined.

## Step 2: Descriptive analysis

Start with the big picture before diving into details:
- **Summary statistics**: means, medians, ranges, distributions
- **Breakdowns**: results by every available dimension
- **Patterns**: are results systematic or scattered?
- **Anomalies**: outliers, unexpected values, missing data

Use Python for computation when the data is structured (CSV, JSON).

## Step 3: Hypothesis evaluation

If the experiment had a hypothesis:
- Does the data confirm, refute, or leave it ambiguous?
- Apply the success criteria defined in the experiment design
- Report effect sizes, not just significance

If exploratory:
- What patterns emerge?
- Which are robust vs. potentially spurious?

## Step 4: Validity check

Before interpreting results as meaningful:
- **Sample size**: sufficient to support conclusions?
- **Confounds**: could other variables explain these results?
- **Measurement validity**: does the metric capture what we claim?

## Step 5: Findings and implications

- State findings clearly with provenance (script + data that produced them)
- Connect to the project's open questions
- Identify implications for next steps
- Note limitations honestly

## Output format

```
## Analysis: <what was analyzed>
Date: YYYY-MM-DD
Data source: <path or description>

### Summary
<2-3 sentence overview of key results>

### Detailed findings
1. <finding with specific numbers and provenance>
2. ...

### Hypothesis evaluation
<confirmed / refuted / ambiguous — with evidence>

### Validity concerns
<any issues that limit interpretation>

### Implications
<what this means for the project>

### Next steps
<recommended follow-up work>
```

## Commit

Commit with message: `analyze: <what was analyzed> — <key finding>`
