# 0019: Mandatory Mechanical URL Verification for Literature Notes

Date: 2026-02-19
Status: accepted

## Context

On 2026-02-19, an audit of a project's literature directory revealed that 7 of 15 literature notes contained fabricated papers. The arxiv URLs pointed to completely unrelated publications. Fabricated claims propagated through synthesis and benchmark draft files before detection. See the postmortem for full root-cause analysis.

The root cause was that literature notes were created from LLM parametric memory without mechanical verification of URLs. The agent "knew" papers existed and generated plausible-looking citations with real arxiv URL patterns, but the papers were fabricated.

## Decision

All literature notes require mandatory mechanical URL verification before creation:

1. **Fetch** the URL/DOI using WebFetch.
2. **Title match**: compare fetched page title against claimed title.
3. **Author match**: confirm at least one claimed author appears on the fetched page.
4. **On FAIL**: do not create the note. Record the topic as a gap.
5. **On inconclusive**: create note with `Verified: false`. Do not cite until verified.

This procedure is encoded in:
- `CLAUDE.md` Provenance section (URL verification procedure)
- `CLAUDE.md` Literature note schema (`Verified` field)
- `.claude/skills/lit-review/SKILL.md` Step 4 (mandatory verification before note creation)
- `.claude/skills/audit-references/SKILL.md` (post-hoc verification skill)
- `docs/sops/autonomous-work-cycle.md` Section 4 (literature task requirement)

The rule "never create literature notes from parametric memory alone" is the key behavioral constraint. Parametric memory ("I know this paper exists") is explicitly not verification.

## Consequences

- Literature reviews will be slower: each paper requires a WebFetch round-trip.
- Some papers behind paywalls or with non-standard hosting will be flagged `Verified: false` rather than verified.
- Confabulation-based citation fabrication is eliminated for any agent following the procedure.
- The `/audit-references` skill enables post-hoc verification of existing notes.
- Only `Verified: YYYY-MM-DD` notes may be cited in publication artifacts.
- Literature gaps (topics where no verified papers exist) are recorded explicitly rather than filled with fabricated citations.
