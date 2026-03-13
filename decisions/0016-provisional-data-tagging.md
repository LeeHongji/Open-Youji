# ADR-0016: Provisional data tagging

Date: 2026-03-13
Status: accepted
Adapted from: OpenAkari ADR-0050

## Context

Provisional experiment data — from running experiments, pilot runs, or unverified results — silently escalates to authoritative status across sessions. No flag distinguishes provisional from verified data, so downstream analyses cite preliminary numbers without warnings. The most damaging pattern: pilot runs produce plausible-looking metrics that get cited repeatedly before anyone discovers they're wrong.

The core structural gap: the repo treats all committed artifacts as trusted cognitive state. Sessions consuming prior session outputs have no mechanism to assess reliability.

## Decision

Add a `data_quality` field to experiment/structured work record metadata:

```yaml
data_quality: verified | provisional
```

### Field semantics

| `status` | `data_quality` default | Can override? |
|----------|----------------------|---------------|
| `planned` | `provisional` (implicit) | No |
| `running` | `provisional` (implicit) | No |
| `completed` | `verified` (implicit) | Yes, to `provisional` for pilot runs or unverified results |
| `failed` | `provisional` (implicit) | No |

When `data_quality` is absent, the default is derived from `status`. Explicit `data_quality: provisional` on a completed experiment signals: "results exist but should not be treated as authoritative."

### When to mark completed work as provisional

- Pilot runs (N < planned sample size)
- Results that have not been independently verified
- Work where a known confound exists but results are still informative
- Results whose analysis method has been updated since generation

### Downstream citation rule

When citing findings from any experiment, the citing session MUST:

1. Check `data_quality` (explicit or derived from `status`)
2. If `provisional`: include a warning — e.g., "Provisional: from [experiment-id] (pilot, N=5)"
3. Never cite provisional findings in publication drafts without the warning

## Consequences

- Experiment records gain a reliability signal that persists across sessions
- Existing experiments do not need retroactive tagging — defaults are derived from `status`
- Downstream analyses are protected from silently citing preliminary data as authoritative
- Future enforcement could scan for unqualified citations of provisional experiments
