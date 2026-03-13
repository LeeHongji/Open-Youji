# ADR-0017: Error propagation tracking

Date: 2026-03-13
Status: accepted
Adapted from: OpenAkari ADR-0051

## Context

When a bug is fixed or incorrect data is corrected, downstream documents that cited the incorrect values are left orphaned — they continue to state wrong numbers until someone happens to notice. This is not theoretical: OpenAkari documented incidents where incorrect citations persisted for 9+ days across 6 downstream consumers, and preliminary analyses with systematically wrong metrics contaminated 15 files.

The root problem: corrections are point fixes. They fix the source but do not trace the error's propagation path. The existing provenance convention ensures citations include source references, but provides no mechanism for corrections to flow *back* through those references.

## Decision

When a correction is made (bugfix, data invalidation, or retracted finding), the correction artifact must include a **Downstream Impact** section that:

1. **Identifies consumers**: Lists all known files that cite or depend on the corrected data. Use `grep` for specific incorrect values, file paths, or experiment IDs to find citations mechanically.

2. **Classifies each consumer**:
   - `corrected` — updated in the same commit
   - `needs-update` — identified but not yet corrected (creates a follow-up task)
   - `no-impact` — references the source but is not affected by the specific error

3. **Creates tasks for uncorrected consumers**: Any consumer classified as `needs-update` gets a task in TASKS.md with provenance pointing back to the correction.

### Template

```markdown
## Downstream Impact

Incorrect value(s): <what was wrong>
Search command: `grep -r "<incorrect value>" projects/<project>/`

| File | Status | Incorrect claim | Corrected value |
|------|--------|-----------------|-----------------|
| experiments/foo/EXPERIMENT.md | corrected | "metric = 58%" | "metric = 63.8%" |
| paper/draft.md section 4.5 | needs-update | "accuracy ~59%" | "accuracy 63.8%" |
| README.md log 2026-03-10 | no-impact | references experiment, not the number | — |
```

### Applies to

- Bugfix verification sections
- Postmortem prevention/fix sections
- Any commit that changes a previously-reported numerical finding
- Diagnosis recommendations that are corrections

## Consequences

- Correction commits take longer (5-10 minutes to search for consumers) but prevent multi-day contamination windows
- The mechanical search step (grep for incorrect values) produces verifiable results
- Works with ADR-0016 (provisional data tagging): provisional data that gets corrected already has a reduced blast radius. Error propagation tracking handles the case where data was not tagged provisional but turned out to be wrong.
- `needs-update` classifications create natural follow-up tasks
