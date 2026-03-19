# 0050: Provisional Data Tagging

Date: 2026-03-01
Status: accepted

## Context

Seven documented incidents show that provisional experiment data — from running experiments, pilot runs, or unverified results — silently escalates to authoritative status across sessions. No flag distinguishes provisional from verified data, so downstream analyses cite preliminary numbers without warnings. The most damaging pattern: pilot runs produce plausible-looking metrics that get cited 15+ times before anyone discovers they're wrong (flash-240 incident: 34,254 wasted API calls, 15 contaminated analyses, paper draft compromised).

See `projects/youji/feedback/feedback-incorrect-experiment-contamination-analysis-2026-03-01.md` for the full investigation (7 incidents, 4 projects, 141 experiment records surveyed).

The core structural gap: the repo treats all committed artifacts as trusted cognitive state. Agents consuming prior session outputs have no mechanism to assess reliability.

## Decision

Add a `data_quality` field to the EXPERIMENT.md frontmatter schema:

```yaml
data_quality: verified | provisional
```

### Field semantics

| `status` | `data_quality` default | Can override? |
|----------|----------------------|---------------|
| `planned` | `provisional` (implicit) | No |
| `running` | `provisional` (implicit) | No |
| `completed` | `verified` (implicit) | Yes → `provisional` for pilot runs, small-N studies, or unverified results |
| `failed` | `provisional` (implicit) | No |
| `abandoned` | `provisional` (implicit) | No |

When `data_quality` is absent from frontmatter, the default is derived from `status` per the table above. Explicit `data_quality: provisional` on a `status: completed` experiment signals: "results exist but should not be treated as authoritative."

### When to mark completed experiments as provisional

- Pilot runs (N < planned sample size)
- Results that have not been independently verified (no re-run, no cross-check)
- Experiments where a known confound exists but results are still informative
- Experiments whose analysis scripts have been updated since results were generated

### Downstream citation rule

When citing findings from any experiment, the citing agent MUST:

1. Check `data_quality` (explicit or derived from `status`)
2. If `provisional`: include a warning in the citing document — e.g., "Provisional: from [experiment-id] (pilot, N=5)"
3. Never cite provisional findings in publication drafts or summary reports without the warning

This is L2 (agent self-enforcement) initially, with a path to L0 promotion via `verify.ts` checking for unqualified citations of provisional experiments.

## Consequences

- The EXPERIMENT.md schema gains an optional `data_quality` field (see `docs/schemas/experiment.md`)
- The provenance convention gains a provisional-data citation rule (see `docs/conventions/provenance.md`)
- Existing experiments do not need retroactive tagging — the field is optional and defaults are derived from `status`
- Future L0 enforcement: `verify.ts` could scan for experiments cited in findings sections, check their `data_quality`, and warn if provisional data is cited without qualification
