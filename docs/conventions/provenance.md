Provenance conventions for Youji.

## Core rule

Every factual claim is leashed to a source. This is a structural defense against hallucination -- the most dangerous failure mode of autonomous agents.

## What counts as provenance

| Claim type | Required provenance |
|-----------|-------------------|
| Numerical claims | The script + data file that produces the number, OR inline arithmetic from referenced data (e.g., "96/242 = 39.7%") |
| Paper citations | A verified URL (fetched and confirmed via WebFetch). Must have `Verified: YYYY-MM-DD` in the literature note. |
| Experimental results | The experiment directory and specific output files |
| Code behavior | The file path and line number, or the command + output that demonstrates the behavior |
| API behavior | The exact request/response or documentation URL |
| Configuration values | The file path and the specific line |

## What does NOT count as provenance

- "I know this from training data" -- parametric memory is not verification
- "This is a well-known result" -- cite the source anyway
- Paraphrased claims without attribution -- use direct quotes for important claims
- Numbers copied from text without tracing to computational source -- trace back to the script/data
- Another agent session's assertion -- verify independently or cite the specific log entry with date

## When to apply

Provenance is required in:
- Every EXPERIMENT.md Findings section
- Every literature note
- Every claim in papers and reports
- Every non-obvious assertion in project logs
- Every numerical result cited in synthesis documents

Provenance is optional for:
- Session log entries describing what actions were taken (these are self-evident from the commit)
- Opinions and recommendations (clearly labeled as such)
- Plans and task descriptions

## Findings provenance checklist

For EXPERIMENT.md Findings sections specifically:

1. Every numerical claim includes either:
   (a) The script + data file that produces it, or
   (b) Inline arithmetic from referenced data
2. Every comparison between experiments uses explicit denominators
3. Every literature reference has a `Verified: YYYY-MM-DD` field
4. Every claim about model behavior cites the specific experiment run

## URL verification procedure

See [docs/sops/url-verification.md](../sops/url-verification.md) for the full procedure.

Summary:
1. Fetch the URL with WebFetch
2. Confirm title matches claimed paper
3. Confirm at least one author matches
4. Record verification date: `Verified: YYYY-MM-DD`
5. On failure: do NOT cite. Record as gap.

## Provisional data tagging

When citing data from in-progress experiments:
- Mark explicitly as provisional: "preliminary results from an in-progress experiment show..."
- Never cite provisional data as authoritative
- Include the experiment status in the citation context

## Why this matters

LLM agents can generate plausible-looking citations, statistics, and claims from parametric memory. Without mechanical verification, fabricated data looks identical to real data and persists through downstream synthesis. Provenance creates a verification path that future sessions can follow to confirm or refute any claim.

The cost of provenance is extra time per finding. The cost of no provenance is unreliable knowledge that contaminates all downstream work.
