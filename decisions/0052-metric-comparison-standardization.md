# 0052: Metric Comparison Standardization

Date: 2026-03-01
Status: accepted

## Context

Cross-experiment metric comparisons are misleading when denominators differ silently. A concrete example: comparing 40.8% "correctness including ties" against 70.0% "correctness on non-tie predictions" creates a false impression of gap or improvement, when the difference is largely due to filtering conditions.

A cross-project metric comparison was flagged as potentially misleading for this reason. The system-level analysis in `projects/youji/feedback/feedback-incorrect-experiment-contamination-analysis-2026-03-01.md` identified this as a pattern: agents copy numbers from prior experiments without checking whether the metric definitions match.

The root problem is that metric labels (e.g., "correctness") obscure filtering conditions that materially affect the value. A 70.0% metric on N=550 non-tie predictions is not comparable to a 40.8% metric on N=800 all predictions without explicit qualification.

## Decision

When comparing metrics across experiments or projects, citations must include:

1. **Explicit denominator**: State the sample size — e.g., "N=550 samples".

2. **Explicit filtering conditions**: If the metric excludes certain cases (ties, outliers, specific categories), state this — e.g., "on non-tie predictions", "excluding low-confidence cases".

3. **Definition matching**: When comparing metrics from different sources, verify the definitions are comparable. If they differ, either (a) recompute to match, or (b) qualify the comparison explicitly.

### Examples

**Bad**: "Experiment A achieved 70.0% correctness vs Experiment B's 40.8%."
**Good**: "Experiment A achieved 70.0% correctness on non-tie predictions (N=550) vs Experiment B's 40.8% correctness on all predictions including ties (N=800). Metrics are not directly comparable due to different filtering conditions."

### Applies to

- Cross-experiment comparisons in analysis documents
- Cross-project comparisons in synthesis reports
- Log entries that compare findings across sessions
- Paper drafts that aggregate results from multiple experiments

### Enforcement

L2 (convention, agent self-enforcement). The /review skill's citation verification step should spot-check that cross-experiment metric comparisons include explicit denominators.

## Consequences

- Comparisons take marginally longer to write but are no longer misleading.
- Readers can immediately assess whether two metrics are comparable.
- Works with ADR 0050 (provisional data) and ADR 0051 (error propagation): this addresses the definition-mismatch vector, while those address the provisional-data and error-correction vectors respectively.
- Creates a clear standard that reviewers can check mechanically: any "%" comparison without "(N=...)" is suspect.
