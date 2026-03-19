# 0051: Error Propagation Tracking

Date: 2026-03-01
Status: accepted

## Context

When a bug is fixed or incorrect data is corrected, downstream documents that cited the incorrect values are left orphaned — they continue to state wrong numbers until someone happens to notice. This is not theoretical: the dimension-mismatch postmortem identified 6 downstream consumers with incorrect citations that persisted for 9 days (`projects/sample-project/postmortem/postmortem-dimension-mismatch-artist-comparison-2026-02-27.md`), and the flash-240 postmortem found 15 preliminary analyses with systematically wrong metrics (`projects/sample-project/postmortem/postmortem-flash-240-retry-waste-2026-02-20-v2.md`). The system-level analysis in `projects/youji/feedback/feedback-incorrect-experiment-contamination-analysis-2026-03-01.md` found 7 high-severity contamination incidents across 4 projects.

The root problem is that corrections are point fixes — they fix the source but do not trace the error's propagation path. The existing provenance convention ensures citations include source references, but provides no mechanism for corrections to flow *back* through those references.

## Decision

When a correction is made (bugfix, data invalidation, postmortem fix, or retracted finding), the correction artifact must include a **Downstream Impact** section that:

1. **Identifies consumers**: Lists all known files that cite or depend on the corrected data. Use `grep` for specific incorrect values, file paths, or experiment IDs to find citations mechanically.

2. **Classifies each consumer**:
   - `corrected` — updated in the same commit or PR
   - `needs-update` — identified but not yet corrected (creates a follow-up task)
   - `no-impact` — references the source but is not affected (e.g., references the experiment but not the incorrect number)

3. **Creates tasks for uncorrected consumers**: Any consumer classified as `needs-update` gets a task in the relevant project's TASKS.md, tagged `[fleet-eligible]` (corrections are mechanical) with provenance pointing back to the correction artifact.

### Applies to

- Postmortem Prevention/Fix sections
- Bugfix EXPERIMENT.md Verification sections
- Diagnosis Recommendations sections (when the recommendation is a correction)
- Any commit that changes a previously-reported numerical finding

### Template

```markdown
## Downstream Impact

Incorrect value(s): <what was wrong, e.g., "PC reported as 58-60% (actual: 63.8%)">
Search command: `grep -r "58%" projects/sample-project/` (or equivalent)

| File | Status | Incorrect claim | Corrected value |
|------|--------|-----------------|-----------------|
| experiments/foo/EXPERIMENT.md | corrected | "PC = 58%" | "PC = 63.8%" |
| paper/draft.md §4.5 | needs-update | "accuracy ~59%" | "accuracy 63.8%" |
| README.md log 2026-02-20 | no-impact | references experiment but not the number | — |
```

### Enforcement

L2 (convention, agent self-enforcement). The compound step's "session learnings" check should flag corrections without downstream impact sections.

Future L0 path: `verify.ts` could detect commits that modify numerical values in Findings sections and warn if no downstream impact section exists. Deferred — the mechanical detection of "correction" contexts is non-trivial.

## Consequences

- Correction commits take longer (5-10 minutes to search for consumers) but prevent multi-day contamination windows.
- The mechanical search step (grep for incorrect values) is automatable and produces verifiable results — agents can't claim "no downstream consumers" without evidence.
- Works with ADR 0050 (provisional data tagging): provisional data that gets corrected already has a reduced blast radius because downstream consumers include warnings. Error propagation tracking handles the case where data was *not* tagged provisional but turned out to be wrong.
- The `needs-update` classification creates a natural task supply for fleet workers — corrections are mechanical and well-scoped.
