# 0027: Experiment Resource Safeguards — Mandatory Runner Flags and Defense-in-Depth

Date: 2026-02-20
Status: accepted

## Context

The flash-240 experiment consumed 39,222 LLM API calls against a 20,000-call project budget (225% of total budget) with 87.3% waste. Five independent safeguard layers (canary, budget pre-check, retry logic, consumption audit, orient monitoring) all failed to detect the waste during 16 hours of execution. The root cause was not a single bug but an architectural gap: every safeguard was designed for a different failure scenario, and no safeguard covered the scenario that occurred (silent resource waste from a running experiment with a broken resume path).

Full analysis: `projects/sample-project/postmortem/postmortem-flash-240-retry-waste-2026-02-20-v2.md`

The prior postmortem (v1) implemented local fixes (dtype coercion, progress guard, audit on all exit codes). This ADR formalizes the systemic prevention measures needed across all projects.

## Decision

### 1. Mandatory experiment runner flags

When launching resource-consuming experiments via `run.py --detach`, the following flags are **mandatory**:

```
python infra/experiment-runner/run.py --detach \
  --project-dir <project-dir> \
  --max-retries <N> \
  --watch-csv <output-csv> --total <N> \
  <experiment-dir> -- <command...>
```

- `--project-dir`: enables both budget pre-check and post-completion consumption audit. Without it, both safeguards are silently disabled.
- `--max-retries`: must be explicit, not defaulted. Forces the launcher to think about how many retries are appropriate.
- `--watch-csv` + `--total`: enables the retry progress guard for CSV-based experiments.

This is a convention change (CLAUDE.md + SOP), not a code enforcement. The runner still accepts calls without these flags for backward compatibility and non-resource experiments.

### 2. Ledger entries: estimates flagged, actuals reconciled

- When a session launches a fire-and-forget experiment, it records the design estimate in the ledger with the note `"(design estimate, pending reconciliation)"`.
- The consumption_audit (which now runs on all exit codes) writes the actual consumption to progress.json.
- Orient is responsible for detecting ledger entries that say "design estimate" and reconciling them against progress.json audit results when the experiment is complete.
- An unreconciled design estimate that is >2× the actual (or <0.5× the actual) is flagged as a budget integrity issue.

### 3. Resume path must be tested

Any experiment that uses `--resume`, `--checkpoint`, or any form of output-based deduplication must include a resume validation step in its canary or pre-launch check. At minimum:
- Load existing output with the same code path used in production
- Verify that previously-completed items are correctly identified for skipping
- Report skip count and verify it matches expectations

For experiment batch scripts that use resume: add `--resume-validate` mode that performs a dry-run resume (load CSV, compute skip set, report counts, exit).

### 4. Waste-ratio abort threshold

Add to the experiment runner's retry loop: after each retry, compute `waste_ratio = (raw_rows - unique_rows) / raw_rows`. If waste_ratio > 0.3 (30% duplicate rows), abort with `failure_class: "resume_corruption"`. This catches scenarios where retries produce some new rows but waste the majority of work on duplicates.

### 5. Experiment runner test suite

The experiment runner (`infra/experiment-runner/run.py`) is a critical safety system that currently has zero tests. A minimum test suite must cover: retry progress guard, waste ratio guard, consumption audit accuracy, budget pre-check, and canary failure handling. Testing convention in CLAUDE.md already requires "new code needs tests" — the runner has accumulated significant new functionality (retry logic, consumption audit, canary, budget check) without corresponding tests.

## Consequences

- Agents launching experiments must use the full flag set. Sessions that omit `--project-dir` are bypassing the primary budget safeguard — this is now a documented convention violation, catchable by code review or `/compound`.
- Ledger accuracy improves: design estimates are explicitly labeled and reconciled post-completion. Orient can detect and flag stale estimates.
- Resume bugs are caught pre-launch (resume validation) rather than post-waste. This is the single highest-impact change — the flash-240 zero-padding bug would have been caught before any API calls were made.
- The waste-ratio guard catches a broader class of resume failures than the zero-progress guard. The zero-progress guard only catches degenerate cases (no new rows); the waste-ratio guard catches cases where some progress occurs alongside massive waste.
- The test suite provides regression protection for all future changes to the experiment runner. Currently, any change to the runner's retry, audit, or budget logic is untested.

## Migration

1. **CLAUDE.md**: Add mandatory runner flags to "Session discipline" section (same turn as this ADR)
2. **SOP**: Update `docs/sops/autonomous-work-cycle.md` Step 4 launch command to include all mandatory flags (same turn)
3. **run.py waste-ratio guard**: Implementation task for `projects/youji/` Next Actions
4. **Experiment script --resume-validate**: Implementation task for `projects/sample-project/` Next Actions
5. **Experiment runner test suite**: Implementation task for `projects/youji/` Next Actions
6. **Orient ledger reconciliation**: Implementation task for `projects/youji/` Next Actions
