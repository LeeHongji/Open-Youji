# ADR-0021: Automated branch lifecycle management

Date: 2026-03-13
Status: accepted
Adapted from: OpenAkari ADR-0055

## Context

When Youji runs concurrent `claude -p` sessions (supervisor + workers), git push conflicts can occur. The push-retry mechanism creates fallback branches (`session-<id>`) when concurrent pushes to main conflict. Without cleanup, these branches accumulate on the remote.

Even with a single concurrent session, failed pushes or interrupted sessions can leave stale branches.

## Decision

### 1. Session branch pattern

All fallback branches use the pattern `session-*`. Cleanup tools should match this pattern broadly.

### 2. Periodic cleanup

Run branch cleanup periodically (e.g., daily or every 6 hours when the scheduler is active):
- Delete remote session branches older than 3 days
- Log deletions but only alert if >0 branches deleted

### 3. Push retry before branch fallback

Before falling back to a session branch, retry the push cycle up to 2 additional times with a short delay (3 seconds) between attempts. Most conflicts are transient — another session's push completed between our fetch and push.

```
for attempt in [1, 2, 3]:
  git pull --rebase origin main
  if rebase succeeds:
    git push origin main
    if push succeeds: return "pushed"
    if push fails: continue (retry)
  if rebase fails:
    git rebase --abort
    if attempt < 3: sleep 3s, continue
    else: fall back to session branch
```

### 4. Stale branch monitoring

Alert when any unmerged session branch is older than 48 hours — this may indicate lost work that needs rescue.

## Consequences

- Branch accumulation is controlled automatically
- No manual branch triage/rescue operations needed
- Push retry adds ~6-9 seconds of latency in the worst case (3 retries)
- Unique work on fallback branches is surfaced within 48 hours via alerts
- The cleanup mechanism is simple and safe — it only targets `session-*` branches
