# 0013: Alignment Metrics and Assessment Protocol

Date: 2026-02-17
Status: accepted

## Context

A sample benchmark project compares automated judge predictions against human ground truth (pairwise comparison votes) to measure how well automated judges can assess output quality. Multiple experiments have been run using ad-hoc metric definitions. The experiment pipeline computes "accuracy" and "correctness" but these terms are overloaded and their relationship to standard alignment metrics is unclear. We need a principled, documented metric framework before the benchmark publication.

**What prompted this:** A task to define alignment metrics and assessment protocol. The literature synthesis provides context: text-domain LLM-as-judge achieves >80% human agreement, visual QA achieves ~80% Spearman correlation, and specialized automated metrics top out at ρ=0.58. We need metrics that enable direct comparison with these baselines.

## Decision

### Primary metrics

**1. Pairwise Correctness (PC)** — the fraction of non-tie comparisons where the judge picks the same winner as the ground truth.

```
PC = (correct winner predictions) / (predictions where judge is not a tie)
```

This is the existing "correctness" metric in the experiment pipeline. It is the primary metric for all analyses because:
- It directly measures what we care about: does the judge agree with humans on which model is better?
- It is comparable across experiments with different tie rates.
- It is interpretable: random chance is 50% (binary choice), so any value significantly above 50% indicates useful signal.

**Reporting convention:** Always report as percentage with one decimal place (e.g., "59.4%"). Always include the sample size (e.g., "59.4% correctness, n=165").

**2. Tie Detection Rate (TDR)** — the fraction of ground-truth ties that the judge also predicts as a tie.

```
TDR = FN_tie / (FN_tie + TP_tie)
```

Where FN_tie = ground truth tie predicted as non-tie (false positive in tie detection), TP_tie = ground truth tie predicted as tie. Note: this metric is only meaningful when n_runs > 1 (ties are impossible with n_runs=1 since predictions are always 0/100).

**Reporting convention:** Always note the n_runs value when reporting TDR. "TDR = 0% (n_runs=1, ties impossible)" is a design constraint, not a finding.

**3. Error Type Distribution** — the breakdown of errors into three categories:
- **wrong_winner**: judge picks the opposite winner from ground truth
- **FP (false positive)**: judge picks a winner when ground truth is a tie
- **FN (false negative)**: judge calls a tie when ground truth has a clear winner

**Reporting convention:** Report as both counts and percentages of total errors. The ratio of wrong_winner to FN errors characterizes judge behavior: wrong_winner-dominated = overconfident; FN-dominated = under-discriminating.

### Secondary metrics (for publication and cross-study comparison)

**4. Cohen's Kappa (κ)** — chance-corrected agreement between judge and ground truth.

```
κ = (observed agreement - expected agreement) / (1 - expected agreement)
```

Where the response categories are {model_A_wins, tie, model_B_wins}. This is necessary for cross-study comparison because raw correctness is inflated when one outcome dominates (e.g., if model A wins 80% of pairs, always picking A yields 80% "correctness").

**When to use:** Report κ alongside PC in the publication. Interpretation: κ < 0.2 (slight), 0.2-0.4 (fair), 0.4-0.6 (moderate), 0.6-0.8 (substantial), > 0.8 (almost perfect). Text-domain LLM judges typically achieve κ = 0.6-0.8.

**5. Spearman Rank Correlation (ρ)** — correlation between judge-derived model rankings and ground truth rankings.

For each judge, compute per-model win rates across all evaluated pairs, then compute Spearman ρ against ground truth model rankings (from ELO ratings or aggregate win rates).

**When to use:** Report when assessing across 5+ models. This enables comparison with automated metric baselines. Target: ρ > 0.7 would establish strong automated assessment alignment with human judgment.

**6. Position Bias Index (PBI)** — measures systematic preference for the first or second option.

```
PBI = |P(pick_A | A_first) - P(pick_A | A_second)| / 2
```

Where A_first means model A was presented as option 1, A_second means option 2. Requires n_runs >= 2 with position swapping. PBI = 0 means no position bias; PBI = 0.5 means the judge always picks the same position.

**Reporting convention:** Report alongside PC when n_runs >= 2. Prior work: text-domain PBI ~0.10-0.15. Our v2 experiment measured 21.2% position bias for gpt-5.2.

### Tie handling protocol

**Ground truth tie threshold:** A comparison is a ground truth tie when neither model's win rate exceeds a configurable threshold. The default is 52.5% (the existing pipeline default).

**Sensitivity analysis:** The publication must report PC at three tie thresholds: 52.5% (strict — more ties), 55% (moderate), and 60% (lenient — fewer ties). This demonstrates metric robustness and reveals how sensitive alignment claims are to the tie definition.

**Judge tie detection:** With n_runs > 1, judge predictions are ties when neither model achieves > 50% of runs. With n_runs = 1, ties are impossible — this is a design constraint to be noted, not an error.

### Evaluation protocol

**Unit of assessment:** A single assessment is one (task, model_pair, dimension) tuple. The judge produces a prediction for this tuple; the ground truth provides the human consensus.

**Aggregation levels:** Metrics are reported at four levels:
1. **Overall** — all assessments pooled
2. **Per dimension** — grouped by assessment dimension
3. **Per task** — grouped by task ID (identifies hard/easy tasks)
4. **Per model pair** — grouped by model pair (identifies model-specific biases)

**Minimum sample sizes:**
- Overall metrics require n >= 100 assessments
- Per-dimension metrics require n >= 30 assessments per dimension
- Per-task metrics require n >= 10 assessments per task
- Below minimum, report but mark as "preliminary" with confidence intervals

**Statistical significance:** Use McNemar's test (paired) to compare two judges on the same evaluations. Use chi-squared test (unpaired) to compare judge performance across groups (e.g., per-dimension). Report p-values; significance threshold p < 0.05.

**Position swap protocol:** When n_runs > 1, half of runs should present (A, B) and half (B, A). Position-swapped runs are matched pairs for bias analysis.

### What we do NOT include as primary metrics

**Accuracy (tie vs not-tie):** The existing "accuracy" metric measures whether the judge correctly predicts tie status. This is excluded as a primary metric because:
- With n_runs=1, it is necessarily equal to (total - ground_truth_ties) / total for ALL judges — a tautological artifact (see log entry 2026-02-15 (d)).
- Even with n_runs > 1, it conflates two different capabilities (winner prediction and tie detection).
- TDR and PC together provide the same information more clearly.

**Krippendorff's Alpha:** Better suited for multi-rater reliability (not judge-vs-ground-truth comparison). Would be relevant for measuring inter-judge agreement but not for alignment with human data.

## Consequences

- The experiment pipeline already computes PC and error types. Cohen's κ, Spearman ρ, and PBI need to be added.
- All future analyses should use PC as the primary metric, with error type distribution as the primary diagnostic.
- The benchmark publication should include: PC, κ, and error types for all judges, plus ρ for model ranking comparison and PBI for bias characterization.
- The tie threshold sensitivity analysis ensures claims about alignment are robust to arbitrary choices.
- This framework enables direct comparison with text-domain baselines (Zheng et al. 2023: >80% agreement, κ ~0.7) and automated metrics (Kirstain et al. 2023: ρ=0.19-0.47 for standard metrics).
