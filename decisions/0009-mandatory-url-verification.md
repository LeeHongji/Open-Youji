# ADR-0009: Mandatory mechanical URL verification for literature notes

Date: 2026-03-13
Status: accepted
Adapted from: OpenAkari ADR-0019

## Context

An audit of literature notes in OpenAkari revealed that 7 of 15 notes contained fabricated papers. ArXiv URLs pointed to completely unrelated publications. Fabricated claims propagated through synthesis and analysis files before detection.

The root cause: literature notes were created from LLM parametric memory without mechanical verification of URLs. The agent "knew" papers existed and generated plausible-looking citations, but the papers were fabricated. This is a fundamental LLM failure mode — confabulation of plausible-sounding references — and it applies to any system that creates literature records.

## Decision

All literature notes require mandatory mechanical URL verification before creation:

1. **Fetch** the URL/DOI using a web fetch tool.
2. **Title match**: compare fetched page title against claimed title.
3. **Author match**: confirm at least one claimed author appears on the fetched page.
4. **On FAIL**: do not create the note. Record the topic as a knowledge gap.
5. **On inconclusive**: create note with `Verified: false`. Do not cite until verified.

### Key rule

**Never create literature notes from parametric memory alone.** Parametric memory ("I know this paper exists") is explicitly not verification. The verification must be mechanical: fetch the URL, check the title, check the authors.

### Verified field

The literature note schema includes a `Verified` field:
- `Verified: YYYY-MM-DD` — URL fetched and title/author matched on this date
- `Verified: false` — could not verify (paywall, non-standard hosting, etc.)

Only `Verified: YYYY-MM-DD` notes may be cited in publication artifacts or authoritative analyses.

## Consequences

- Literature reviews are slower: each paper requires a web fetch round-trip
- Some papers behind paywalls will be flagged `Verified: false` rather than verified
- Confabulation-based citation fabrication is eliminated for any session following the procedure
- Literature gaps (topics where no verified papers exist) are recorded explicitly rather than filled with fabricated citations
- The `/audit-references` pattern enables post-hoc verification of existing notes
