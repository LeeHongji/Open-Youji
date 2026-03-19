# 0055: Automated Branch Lifecycle Management

Date: 2026-03-03
Status: accepted
Triggered by: postmortem-fleet-branch-explosion-2026-03-03

## Context

The fleet's `rebase-push.ts` creates fallback branches (`session-{sessionId}`) whenever
a concurrent push to main conflicts. With 4+ fleet workers running simultaneously, this
generates hundreds of remote branches per day. The existing `branch-cleanup.ts`:

1. Only matches `session-work-session-*` (missing fleet-worker, deep-work, chat, etc.)
2. Is only available as a manual CLI command — never runs automatically
3. Has no merge-back mechanism for branches containing unique work

This resulted in 1,159 stale branches accumulating over ~5 days of fleet operation,
requiring manual human intervention to triage and clean up.

## Decision

### 1. Universal session branch pattern

Change `SESSION_BRANCH_PATTERN` in `branch-cleanup.ts` from:
```
/^session-work-session-[a-z0-9]+$/
```
to:
```
/^session-.+/
```

This matches all branches created by `rebase-push.ts` regardless of session type
(work-session, fleet-worker, deep-work, chat, team-work-session, skill-cycle, autofix).

### 2. Scheduled automatic cleanup

Run `runBranchCleanup` from the service tick loop once per 6 hours. Parameters:
- `keepDays: 3` (reduced from 7 — fleet volume makes 7 days too long)
- `dryRun: false`
- Log results but only send Slack notification if >0 branches deleted

The 6-hour interval balances cleanup frequency against GitHub API rate limits
(each branch deletion is a separate `git push --delete`).

### 3. Push retry before branch fallback

Before falling back to a session branch, `rebase-push.ts` should retry the
rebase-push cycle up to 2 additional times with a 3-second delay between
attempts. Most conflicts are transient — another worker's push completed
between our fetch and push. Retrying eliminates the majority of fallback
branches.

Updated strategy:
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

### 4. Health watchdog branch monitoring

Add a branch count check to the health watchdog. Alert when:
- Total remote session branches > 50 (early warning)
- Any unmerged session branch is older than 48 hours (possible lost work)

## Consequences

### Positive
- Branch accumulation rate drops from ~300/day to near-zero (retry eliminates most fallbacks; scheduled cleanup handles the rest)
- No more manual branch triage/rescue operations
- Unique work on fallback branches is surfaced within 48 hours via health alerts

### Negative
- Push retry adds ~6-9 seconds of latency in the worst case (3 retries × 3s delay)
- Scheduled cleanup adds GitHub API calls (one per deleted branch, amortized over 6 hours)

### Action items
1. Fix `SESSION_BRANCH_PATTERN` to match all session branches [fleet-eligible]
2. Add push retry logic to `rebase-push.ts` [fleet-eligible]
3. Schedule `runBranchCleanup` in service tick loop [fleet-eligible]
4. Add branch count to health watchdog alerts [fleet-eligible]
5. Update `branch-cleanup.test.ts` for new pattern and retry logic [fleet-eligible]
