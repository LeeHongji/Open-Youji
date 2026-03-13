# ADR-0008: No experiment babysitting — fire-and-forget convention

Date: 2026-03-13
Status: accepted
Adapted from: OpenAkari ADR-0017

## Context

A common anti-pattern in autonomous sessions: launching a long-running process (experiment, data pipeline, model evaluation) and then spending the remainder of the session in a sleep-poll loop waiting for completion. Sessions have finite time and context budgets. A session that spends 50 minutes sleeping and polling produces zero knowledge and risks timing out with no commit.

The correct architecture: sessions set up and launch long-running work, commit the setup, and end. A future session picks up the results.

## Decision

Add a "fire-and-forget" convention for long-running processes:

1. **Sessions submit work, they do not supervise.** Never sleep more than 30 seconds in a session.
2. **The correct lifecycle for long-running work:**
   - Create the work directory, config files, and run script (setup)
   - Launch the process in the background or via a detached runner (submit)
   - Commit the setup and submission record (record)
   - End the session
   - A future session picks up analysis of completed results

3. **Classification during planning**: When the orient phase identifies a task involving long-running processes, flag it during classification so the session plans for async submission from the start.

### What counts as "long-running"

Any process expected to exceed the session's remaining time budget. In practice:
- API calls to >100 endpoints
- Model evaluations over large datasets
- Data processing pipelines with >10 minute expected runtime
- Any process where completion time is uncertain

### The 30-second rule

Never `sleep` for more than 30 seconds in a session. Brief sleeps (e.g., waiting for a process to write its first output, checking that a background process started) are acceptable. Sleep-poll loops are not.

## Consequences

- Sessions that launch long-running work commit immediately rather than waiting, ensuring no work is lost to timeouts
- The 30-second sleep limit is conservative but enforceable
- Analysis of results becomes a separate task, naturally picked up by a future session
- Session throughput increases: instead of one session babysitting one experiment, multiple experiments can be launched across multiple sessions
- Requires infrastructure support: background process launching, result collection in future sessions
