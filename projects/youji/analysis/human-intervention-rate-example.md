# Example: Human Intervention Rate Trend

Date: 2026-03-14
Project: youji
Type: adapted example

## Why this matters

If autonomy is improving, human effort should scale sublinearly relative to agent work.

One practical proxy is intervention events per session. The cleanest events are explicit approvals or denials, because they represent clear moments where a human had to make a decision for the system.

## Example finding from the original Youji/OpenAkari lineage

Across three weekly windows, approval-related intervention events per session fell sharply while session volume increased.

Illustrative pattern:

- early window: relatively high intervention rate during bootstrap and governance setup
- middle window: lower intervention rate despite more sessions
- later window: much lower intervention rate while the system continued operating at larger scale

The strongest interpretation is not "humans disappeared." It is:

- humans stayed in the loop for governance
- but human effort did not grow linearly with throughput

## How to reproduce this analysis in Youji

1. define what counts as an intervention (approval queue entries, direct human correction commits, manual recovery operations)
2. count sessions over matching windows
3. compute `interventions / sessions`
4. keep governance interventions distinct from bug-fix or recovery interventions when possible

## Caution

This metric is meaningful only if the system is also producing useful work. A low intervention rate by itself could also mean the system is idle or failing silently.

## Notes

This file is adapted from the OpenAkari meta-project analyses and is included as an example of how to quantify increasing autonomy. Once Youji has sufficient operational history, this analysis should be reproduced with local data.
