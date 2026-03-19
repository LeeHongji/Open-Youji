# 0009: Transient Failure Retry for Experiments

Date: 2026-02-16
Status: accepted

## Context

The `model-comparison-focused` experiment crashed at 72% progress with exit code 134 (SIGABRT from a Vulkan driver failure). This is a transient error — random GPU/driver instability, not a bug in the experiment code. The system treated it as a permanent failure, triggering autofix unnecessarily and losing partial progress.

Two problems identified:
1. **No retry**: Signal deaths (SIGABRT, SIGKILL, SIGSEGV) are not distinguished from permanent failures.
2. **Progress loss**: `run.sh` didn't pass `--resume` to the batch experiment script, so retries would re-process already-completed pairs.

## Decision

Add retry logic at the **runner level** (`run.py`), not the scheduler:

1. **Exit code classification** (`is_transient_failure`): Exit codes 134 (SIGABRT), 136 (SIGFPE), 137 (SIGKILL/OOM), 139 (SIGSEGV) are transient. Everything else is permanent.
2. **Retry loop in `run.py`**: New `--max-retries` (default 0, backward-compatible) and `--retry-delay` (default 10s) flags. On transient failure with retries remaining, status transitions to `"retrying"`, then re-spawns after delay.
3. **Append-mode log**: On retries, the log file opens in append mode to preserve previous output.
4. **`--resume` in experiment scripts**: The batch experiment script supports `--resume` to skip already-completed items. Added to `run.sh`.
5. **Scheduler awareness**: `ExperimentProgress` gains `failure_class`, `attempt`, `max_retries` fields. The watcher treats `"retrying"` like `"running"` (keeps tracking). Slack notifications are context-aware: brief note on retry, full failure with retry context on exhaustion.

Default `max-retries=0` preserves existing behavior — no experiment retries unless explicitly opted in.

## Consequences

- **Runner-level retry keeps the scheduler simple.** The scheduler doesn't need retry orchestration; it just reads progress.json. This matches the existing architecture where run.py owns the process lifecycle.
- **Transient classification is conservative.** Only signal deaths are classified as transient. Non-signal failures (exit code 1, 2, etc.) are always permanent. This avoids infinite retry loops on real bugs.
- **`--resume` correctness depends on the experiment script's implementation.** The CSV is saved incrementally, and `--resume` skips existing rows. If the CSV is corrupted by a crash, `--resume` may produce incorrect results. This is acceptable because CSV writes are atomic (write-then-rename) in the experiment script.
- **Autofix still triggers on `transient_exhausted`.** If the transient issue persists through all retries, autofix investigates — the problem may actually require code changes (e.g., reducing batch size to avoid OOM).
