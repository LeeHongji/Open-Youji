---
name: audit-references
description: "Use when literature notes exist and need citation verification, or before publishing any artifact that cites literature"
argument-hint: "[project path or publication draft path]"
---

# /audit-references <project path or draft path>

Verify every literature note and cited reference in a project or publication draft by fetching each URL and confirming the paper's identity. This is a mechanical verification procedure — do not rely on memory or judgment about whether a paper is real.

## When to use this

- **Pre-publication gate**: Before committing or sharing any publication draft, run this to verify all cited references.
- **Post-literature-review**: After `/lit-review` produces notes, run this to verify them.
- **Periodic audit**: On any project with a `literature/` directory that hasn't been audited recently.
- **Incident response**: When a hallucination is suspected in any literature note.

## Step 1: Discover literature notes

If the argument is a project directory (e.g., `projects/sample-project/`):
- Glob for `<project>/literature/*.md` (exclude `synthesis.md` or any non-note files)
- These are the notes to audit

If the argument is a publication draft file:
- Read the draft and extract all citation references
- For each citation, find the corresponding literature note
- Flag any citations that have no corresponding literature note

## Step 2: Extract claims from each note

For each literature note, extract:
1. **Claimed title** — from the heading or citation line
2. **Claimed authors** — from the citation line
3. **Claimed URL/DOI** — from the URL/DOI field
4. **Claimed venue/year** — from the citation line
5. **Current `verified` field** — if present

## Step 3: Fetch and verify each URL

For each URL/DOI:

1. **Fetch the URL** using WebFetch. For arxiv URLs, fetch the abstract page.
2. **Extract the actual title** from the fetched page.
3. **Extract actual authors** from the fetched page.
4. **Compare title**: Does the fetched title match the claimed title? Use fuzzy matching — minor differences acceptable. A completely different topic is a FAIL.
5. **Compare authors**: Does at least one claimed author appear? One match is sufficient.
6. **Record the result**: PASS, FAIL, or ERROR (URL unreachable, 404, paywall).

## Step 4: Update `verified` field

For each literature note:
- If verification PASSED: add or update `verified: YYYY-MM-DD`
- If verification FAILED: add or update `verified: false` with a warning
- If verification had an ERROR: add `verified: error — <reason>`

## Step 5: Generate audit report

Save to `<project>/literature/audit-YYYY-MM-DD.md`:

```
# Literature Audit: <project name>

Date: YYYY-MM-DD
Notes audited: N
Passed: N
Failed: N
Errors: N

## Results

| File | Claimed title | URL | Title match | Author match | Status |
|------|--------------|-----|-------------|--------------|--------|

## Failed verifications

### <filename>
- Claimed: "<claimed title>" by <claimed authors>
- Fetched: "<actual title>" by <actual authors>
- Action needed: <remove note / correct URL / flag for human review>

## Notes
<observations about patterns in failures>
```

## Step 6: Flag downstream contamination

If any notes FAILED and the argument was a publication draft:
- List every place in the draft where the failed note is cited
- Recommend specific text to remove or flag

If any notes FAILED and there is a `synthesis.md`:
- Check whether the synthesis cites claims from failed notes
- List the contaminated sections

## Judgment rules

- A title mismatch on a **completely different topic** is a hallucination. Mark as FAIL.
- A title mismatch on the **same paper with slightly different title** (camera-ready vs preprint) is acceptable. Mark as PASS with a note.
- An author list where **none** of the claimed authors appear is a strong hallucination signal. Mark as FAIL.
- A 404 or unreachable URL is not proof of hallucination — the paper may have moved. Mark as ERROR.
- If you recognize a paper from training data, that recognition is **not verification**. You must still fetch the URL.

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "I'm confident this paper is real" | Your confidence is not evidence. Parametric memory fabricates plausible papers. Fetch the URL. |
| "The URL is obviously correct" | Hallucinated papers have plausible-looking URLs too. Fetch it. |
| "Fetching will just confirm what I know" | Then it costs 5 seconds. Not fetching risks a hallucinated citation. |
| "This is a well-known landmark paper" | Well-known papers have been fabricated before. Fetch it. |
| "The DOI resolves so it must be correct" | DOIs can point to different papers than claimed. Check title and authors. |
| "The URL timed out, but I know this paper" | Mark as ERROR. Do not mark as PASS. |

## Red Flags — STOP

- About to mark a note as "verified" without having used WebFetch in this session
- Reasoning about whether a paper "probably exists" instead of fetching
- Skipping a note because "it was verified last time" (re-verify when re-auditing)
- Marking a failed fetch as PASS because you "recognize" the paper

## Commit

Commit message: `audit-references: <project> — N notes audited, N passed, N failed`
