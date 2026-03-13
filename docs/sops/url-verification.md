Standard procedure for mechanically verifying literature citations before creating literature notes.

## URL Verification

When: Creating a literature note or citing a paper in any artifact.
Requires: A URL or DOI for the paper to verify.

### 1. Fetch the source

- Use WebFetch to retrieve the URL/DOI content
- For arxiv links, fetch the abstract page (e.g., `https://arxiv.org/abs/2301.00001`)
- For DOIs, fetch the DOI resolver URL

> Output: Fetched page content with title and author information

### 2. Verify title match

- Compare the fetched page title against the claimed paper title
- Minor formatting differences (punctuation, capitalization) are acceptable
- A completely different topic is a FAIL

> Output: Title match confirmed or FAILED

### 3. Verify author match

- Confirm at least one claimed author appears on the fetched page
- One match is sufficient; full author list match is not required

> Output: At least one author verified

### 4. Handle verification result

- **On PASS**: Add `Verified: YYYY-MM-DD` to the literature note frontmatter. Proceed with note creation.
- **On FAIL**: Do not create the literature note. Record the topic as a gap needing verified sources. Never substitute a fabricated citation.
- **On INCONCLUSIVE** (paywall, 404, timeout, access denied): Create note with `Verified: false`. Flag for manual verification. Do not cite in publication artifacts until verified.

> Output: Literature note with appropriate `Verified` field, or gap record

### 5. Cite only verified sources

- Only notes with `Verified: YYYY-MM-DD` may be cited in publication artifacts
- Notes with `Verified: false` must not be cited until manually verified

> Output: Citable literature note or explicit gap

Check: Literature note contains `Verified: YYYY-MM-DD` field, or gap is explicitly recorded.

## Rationale

This procedure eliminates confabulation-based citation fabrication. LLMs can generate plausible-looking citations with real arxiv URL patterns from parametric memory, but the papers may not exist. Mechanical verification prevents this class of hallucination.
