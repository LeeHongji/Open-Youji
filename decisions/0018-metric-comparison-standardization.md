# ADR-0018: Metric comparison standardization

Date: 2026-03-13
Status: accepted
Adapted from: OpenAkari ADR-0052

## Context

Cross-experiment metric comparisons are misleading when denominators differ silently. A concrete example: comparing 40.8% "correctness including ties" against 70.0% "correctness on non-tie predictions" creates a false impression of gap or improvement, when the difference is largely due to filtering conditions.

The root problem: metric labels (e.g., "correctness," "accuracy") obscure filtering conditions that materially affect the value. A 70.0% metric on N=550 filtered samples is not comparable to a 40.8% metric on N=800 unfiltered samples without explicit qualification.

## Decision

When comparing metrics across experiments or projects, citations must include:

1. **Explicit denominator**: State the sample size — e.g., "N=550 samples".

2. **Explicit filtering conditions**: If the metric excludes certain cases, state this — e.g., "on non-tie predictions," "excluding low-confidence cases."

3. **Definition matching**: When comparing metrics from different sources, verify the definitions are comparable. If they differ, either (a) recompute to match, or (b) qualify the comparison explicitly.

### Examples

**Bad**: "Experiment A achieved 70.0% correctness vs Experiment B's 40.8%."

**Good**: "Experiment A achieved 70.0% correctness on non-tie predictions (N=550) vs Experiment B's 40.8% correctness on all predictions including ties (N=800). Metrics are not directly comparable due to different filtering conditions."

### Applies to

- Cross-experiment comparisons in analysis documents
- Cross-project comparisons in synthesis reports
- Log entries that compare findings across sessions
- Paper drafts that aggregate results from multiple experiments

## Consequences

- Comparisons take marginally longer to write but are no longer misleading
- Readers can immediately assess whether two metrics are comparable
- Creates a clear standard: any "%" comparison without "(N=...)" is suspect
- Complements ADR-0016 (provisional data) and ADR-0017 (error propagation): this addresses definition-mismatch, while those address provisional-data and error-correction vectors
