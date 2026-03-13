# Image Captioning Benchmark — Tasks

### Phase 1: Baseline evaluation

- [ ] Run baseline captioning with 3 models on 50-image pilot set [skill: execute]
  Why: Need initial accuracy data before scaling to full 500-image dataset
  Done when: Captions generated for all 50 pilot images with GPT-4o, Gemini 2.0 Flash, and Claude Sonnet. Results in `experiments/baseline-pilot/results/`.
  Priority: high

- [ ] Compute automated metrics for pilot results [skill: execute] [zero-resource]
  Why: Establish which metrics correlate with human judgments before running at scale
  Done when: BLEU, METEOR, CIDEr, and CLIPScore computed for all pilot captions. Correlation with human ratings documented.
  Priority: high

- [ ] Design human evaluation protocol [requires-opus] [skill: design] [zero-resource]
  Why: Need a reliable human evaluation rubric before collecting judgments
  Done when: Evaluation rubric with 3+ dimensions (accuracy, detail, fluency), inter-annotator agreement target (kappa >= 0.6), and annotation interface specified.
  Priority: medium

### Phase 2: Scale and analyze

- [ ] Run full-scale evaluation on 500 images with 5+ models [skill: execute] [blocked-by: Phase 1 analysis]
  Why: Phase 1 pilot identifies best metrics and models to focus on at scale
  Done when: All 500 images captioned by 5+ models, evaluated with top-performing automated metrics.
  Priority: high

- [ ] Analyze per-category performance patterns [requires-opus] [skill: analyze] [zero-resource] [blocked-by: full-scale evaluation]
  Why: Category-level analysis reveals model strengths and systematic failure modes
  Done when: Per-category accuracy breakdown for all models. Statistical tests for category effects.
  Priority: medium
