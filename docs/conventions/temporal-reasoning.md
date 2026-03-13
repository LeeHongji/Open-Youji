Temporal reasoning conventions for Youji.

## Core rule

Never make claims about duration, age, or timelines without explicit date references. LLM parametric knowledge of dates is unreliable.

## Determining the current date

Before making any temporal claim:
1. Use a system command: `date '+%Y-%m-%d'`
2. If system clock may be inaccurate, use a web time API as fallback
3. Never rely solely on model knowledge for the current date

## Temporal claim format

Always anchor temporal claims to concrete dates:

**Wrong:**
- "The experiment ran for about two weeks"
- "This was done recently"
- "The paper is from last year"

**Correct:**
- "The experiment ran from 2026-02-15 to 2026-02-28 (13 days)"
- "Last session was 2026-03-12 (1 day ago as of 2026-03-13)"
- "Published 2025-06 (9 months ago as of 2026-03-13)"

## Duration calculations

When calculating durations:
- State both endpoints explicitly
- Show the arithmetic
- Use ISO 8601 date format (YYYY-MM-DD)

Example: "Budget deadline is 2026-03-01. Today is 2026-02-25. Remaining: 4 days."

## Staleness checks

When assessing whether information is stale:
- Check the `last-verified` or `date` field in the artifact
- Compare against the current date (obtained via system command)
- Define "stale" thresholds explicitly (e.g., "literature notes unverified for >30 days")

## Common pitfalls

- **Relative time without anchor**: "This was decided a few sessions ago" -- always cite the decision record date
- **Assumed recency**: "The latest version of X" -- check the actual publication/release date
- **Calendar arithmetic errors**: Verify month boundaries, leap years. Use system tools for date math when possible
- **Timezone confusion**: Use UTC for all timestamps unless there is a specific reason for a local timezone
