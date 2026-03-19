# 0061: Push Queuing for Fleet Sessions

Date: 2026-03-05
Status: accepted

## Context

Fleet sessions at N=8 experienced a 36.3% git conflict rate over 40 hours (89/245 sessions). The conflict rate was bimodal: ~0% at low concurrency, ~80% at high concurrency (≥15 sessions/hr). Workers completing tasks simultaneously attempted concurrent `git pull --rebase origin main && git push origin main`, causing rebase collisions.

Exponential backoff + jitter (ADR 0056) was insufficient. Retries desynchronized by seconds, but 8 concurrent pushes to the same branch produced unavoidable conflicts. At N=16, the problem would worsen.

Three approaches were evaluated:
1. **Scheduler-mediated HTTP queue**: Scheduler exposes `/api/push/enqueue` endpoint, serializing all pushes through a single-threaded queue.
2. **File lock (flock)**: Workers acquire exclusive file lock before pushing.
3. **Status quo + cleanup**: Accept branch fallback rate, add automated branch cleanup.

Data source: `analysis/backoff-jitter-24h-validation-2026-03-05.md`.

## Decision

Adopt scheduler-mediated HTTP push queue (Option A). The scheduler process (single instance, always running) exposes a `POST /api/push/enqueue` endpoint. Fleet workers and Opus sessions call this instead of pushing directly. The scheduler serializes all pushes through a single-threaded queue, eliminating conflicts architecturally.

Implementation details at `projects/youji/plans/push-queuing-design.md`.

## Consequences

- **Conflict elimination**: Serial execution ensures no concurrent rebases, eliminating the 36.3% conflict rate at any fleet size (N=8, 16, 32, 64).
- **Push latency**: Burst completions add serial push drain time (N=16 worst-case ~60-80s). This is acceptable because sessions have already completed their work — push latency doesn't affect session duration or cost.
- **Scheduler dependency**: Pushes require scheduler API availability. Executors fall back to direct `rebaseAndPush()` on API failure, maintaining existing safety guarantees (no data loss, branch-fallback on conflict).
- **Priority support**: Opus supervisor sessions can push before fleet workers by passing `priority: "opus"` in the enqueue request. Priority sorting is FIFO within each tier.
- **Observability**: Queue depth, wait time, and push status are queryable via `GET /api/push/queue` and `GET /api/push/status/:sessionId`. Metrics integrate into existing session recording.
- **No persistent state needed**: Queue drains in seconds. Lost requests (scheduler crash) are retried naturally by future sessions.

Implementation decomposed into 5 fleet-eligible subtasks. PushQueue class (Step 1) already implemented 2026-03-05.
