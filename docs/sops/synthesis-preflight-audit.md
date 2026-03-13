Pre-synthesis verification procedure to prevent error propagation.

## Synthesis Pre-flight Audit

When: Before any synthesis session -- paper drafts, summary reports, cross-project analyses, or any work that combines findings from multiple prior experiments/sessions into a single document. Trigger explicitly before writing begins, not after.
Requires: Draft outline or section plan identifying which prior experiments/analyses will be cited. Access to source data files and analysis scripts.

### Why this exists

Synthesis sessions trust all prior artifacts as verified ground truth. Errors in upstream artifacts propagate undetected through the synthesis chain. Incorrect data looks plausible and persists until manual audit. This procedure prevents that.

### Procedure

1. **Enumerate upstream sources.** List every prior experiment, analysis, or literature note that the synthesis will cite. For each, record:
   - Source file path (EXPERIMENT.md, analysis report, literature note)
   - Experiment status (`status:` field in EXPERIMENT.md frontmatter)
   - Data quality flag (`data_quality:` field, if present)
   > Output: source inventory table

2. **Flag provisional data.** For each source with `status: running`, `status: failed`, or `data_quality: provisional`, flag it. Provisional data may be cited in synthesis *only* with an explicit qualifier (e.g., "preliminary results from an in-progress experiment show..."). Never cite provisional data as authoritative.
   > Output: provisional sources flagged in inventory

3. **Verify numerical claims.** For each numerical result that will appear in the synthesis:
   a. Locate the source script and data file that produces it
   b. If a script exists: re-run it (or verify the output file's checksum/row count matches expectations)
   c. If inline arithmetic: verify the arithmetic from the referenced data
   d. If the number was copied from text (README, log entry, EXPERIMENT.md): trace it back to its computational source -- do NOT accept text-cited numbers at face value
   > Output: per-claim verification status (verified | unverifiable | mismatch)

4. **Verify literature citations.** For each literature reference:
   a. Check the corresponding literature note for `Verified: YYYY-MM-DD`
   b. If unverified or `Verified: false`: run URL/DOI fetch to confirm the paper exists
   c. For quantitative claims attributed to literature: verify the claim appears in the actual paper (not fabricated)
   > Output: per-citation verification status

5. **Check cross-experiment comparisons.** For each comparison between results from different experiments or projects:
   a. Verify both metrics use the same denominator and filtering criteria
   b. Explicitly state the denominator for each side (e.g., "N=550 non-tie predictions" vs "N=1595 total")
   c. Flag implicit comparisons where denominators differ silently
   > Output: comparison pairs with explicit denominators

6. **Gate decision.** Review all flags:
   - If any numerical claim shows "mismatch": STOP. Fix the source or correct the number before proceeding.
   - If any citation is unverified: verify or remove before proceeding.
   - If provisional data is cited without qualifier: add qualifier or defer until data is final.
   - If cross-experiment comparisons have mismatched denominators: add explicit denominators.
   > Output: go/no-go decision with rationale

Check: The synthesis document contains zero unverified numerical claims, zero unverified citations, and all cross-experiment comparisons have explicit denominators. Every claim traces to a computational source, not to copied text.

### Scope control

This audit should take 5-15 minutes, not hours. For a typical paper section citing 5-10 prior results:
- Steps 1-2: ~2 minutes (scan experiment directories)
- Step 3: ~5 minutes (spot-check key numbers, not every decimal)
- Steps 4-5: ~3 minutes (check literature note verified fields, note denominators)
- Step 6: ~1 minute (review flags)

Focus verification effort on: (a) key findings that drive conclusions, (b) numbers that appear in abstracts or tables, (c) cross-project comparisons. Skip verification of internal-only log entries and intermediate analysis notes.

### Integration points

- `/synthesize` skill: recommended before cross-session synthesis begins
- `/publish` skill: mandatory before preparing publication drafts
- Manual invocation: any session about to write a document synthesizing prior findings
