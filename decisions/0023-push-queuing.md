# ADR-0023: Push queuing for concurrent sessions

Date: 2026-03-13
Status: accepted
Adapted from: OpenAkari ADR-0061

## Context

When Youji runs multiple concurrent `claude -p` sessions (e.g., a supervisor session and worker sessions), all attempting to push to main, git conflicts occur. Even with exponential backoff and jitter, concurrent pushes to the same branch produce unavoidable conflicts at higher concurrency levels.

OpenAkari observed a 36.3% conflict rate at 8 concurrent workers over 40 hours. The rate was bimodal: ~0% at low concurrency, ~80% at high concurrency during burst completion windows.

## Decision

Adopt a serialized push queue. The scheduler process exposes a push endpoint that serializes all pushes through a single-threaded queue, eliminating conflicts architecturally.

### Mechanism

1. Sessions call the scheduler's push API instead of pushing directly
2. The scheduler queues push requests and processes them one at a time
3. Each push does: `git pull --rebase origin main && git push origin main`
4. Serial execution ensures no concurrent rebases

### Fallback

If the scheduler's push API is unavailable, sessions fall back to direct push with retry logic (ADR-0021), maintaining existing safety guarantees.

### Priority

Supervisor sessions can push before worker sessions by specifying priority. Within each priority tier, pushes are FIFO.

### No persistent state needed

The queue drains in seconds. Lost requests (scheduler crash) are retried naturally by future sessions or the fallback mechanism.

## Consequences

- Git conflict rate drops to near-zero at any concurrency level
- Push latency increases slightly during burst completions (serial drain time)
- Requires scheduler API availability; fallback ensures no data loss on scheduler failure
- Queue depth and wait time are observable for monitoring
- Simpler than distributed locking schemes while being fully effective
