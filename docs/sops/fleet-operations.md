Operational procedures for managing the youji fleet of GLM-5 workers.

## Fleet Operations

When: Fleet needs scaling, draining, or troubleshooting.
Requires: Scheduler running (`infra/scheduler/`), access to `.scheduler/` state.

---

### 1. Scaling Up/Down

**Purpose:** Adjust fleet capacity based on workload.

**Check current state:**
```bash
# Active workers
curl -s http://localhost:8420/api/fleet/status | jq

# Fleet config (maxWorkers = FLEET_SIZE)
cat .scheduler/config.json | jq '.fleet'
```

**Scale up (increase maxWorkers):**
```bash
# Via API (runtime change, persists across restarts)
curl -s -X PATCH http://localhost:8420/api/fleet/config \
  -H 'Content-Type: application/json' \
  -d '{"maxWorkers": 8}'

# Or edit config.json directly and restart scheduler
```

**Scale down (decrease maxWorkers):**
```bash
# Graceful: current workers finish their tasks, no new spawns until below limit
curl -s -X PATCH http://localhost:8420/api/fleet/config \
  -H 'Content-Type: application/json' \
  -d '{"maxWorkers": 2}'
```

**Disable fleet (emergency):**
```bash
curl -s -X PATCH http://localhost:8420/api/fleet/config \
  -H 'Content-Type: application/json' \
  -d '{"maxWorkers": 0}'
```

**Check:**
- `curl -s http://localhost:8420/api/fleet/status` shows `activeCount ≤ maxWorkers`
- New workers spawn only when task supply > 0 and active < maxWorkers

---

### 2. Draining the Fleet

**Purpose:** Gracefully stop all fleet workers without interrupting active sessions.

**Start drain:**
```bash
# Sets maxWorkers=0, waits for active workers to complete
curl -s -X POST http://localhost:8420/api/fleet/drain
```

**Check drain status:**
```bash
curl -s http://localhost:8420/api/fleet/status | jq '{draining, activeCount}'
```

**What happens:**
1. `maxWorkers` set to 0
2. `drain-state.ts` flag set to `true`
3. Active workers continue until session ends
4. No new workers spawned
5. When `activeCount = 0`, drain complete

**Cancel drain (resume operations):**
```bash
curl -s -X PATCH http://localhost:8420/api/fleet/config \
  -H 'Content-Type: application/json' \
  -d '{"maxWorkers": 4}'
# Drain flag auto-clears when maxWorkers > 0
```

---

### 3. Debugging Starvation

**Symptoms:**
- Slack alert: "Fleet supply at 0 — workers idle"
- `activeCount = 0` despite `maxWorkers > 0`
- Tasks exist in TASKS.md but workers not spawning

**Diagnostic steps:**

1. **Check task supply:**
   ```bash
   # Count fleet-eligible, unblocked tasks
   curl -s http://localhost:8420/api/fleet/tasks | jq 'length'

   # View task details
   curl -s http://localhost:8420/api/fleet/tasks | jq '.[] | {project, text, blocked, fleetEligible}'
   ```

2. **Check for blockers:**
   ```bash
   # Find blocked tasks
   curl -s http://localhost:8420/api/fleet/tasks | jq '.[] | select(.blocked) | {project, text, blockedBy}'
   ```

3. **Check task claims:**
   ```bash
   ls .scheduler/claims/
   # Stale claims prevent task pickup
   ```

4. **Check recent failures:**
   ```bash
   cat .scheduler/metrics/sessions.jsonl | tail -20 | jq 'select(.agentType == "fleet-worker")'
   ```

**Common causes and fixes:**

| Cause | Symptom | Fix |
|-------|---------|-----|
| All tasks blocked | Tasks have `[blocked-by: ...]` | Unblock tasks or create new fleet-eligible tasks |
| Missing `[fleet-eligible]` tag | `fleetEligible: false` | Add tag to tasks in TASKS.md |
| Stale claims | Claims files exist but sessions ended | Delete stale claims: `rm .scheduler/claims/*` |
| Fleet disabled | `maxWorkers: 0` | Scale up via API |
| Tasks require Opus | `[requires-opus]` tag | Create fleet-eligible subtasks |

**Quick fix — generate tasks via Opus:**
```bash
# Trigger an Opus supervisor session to create fleet tasks
curl -s -X POST http://localhost:8420/api/jobs/opus-supervisor/run
```

---

### 4. Monitoring Task Supply

**Purpose:** Ensure fleet has enough work to maintain utilization.

**Manual check:**
```bash
# Current supply vs target
FLEET_SIZE=$(cat .scheduler/config.json | jq -r '.fleet.maxWorkers')
SUPPLY=$(curl -s http://localhost:8420/api/fleet/tasks | jq 'length')
echo "Supply: $SUPPLY / Target: $FLEET_SIZE"

# Per-project breakdown
curl -s http://localhost:8420/api/fleet/tasks | jq 'group_by(.project) | map({project: .[0].project, count: length})'
```

**Automated monitoring:**
- Slack alert fires when supply = 0 (throttled to once per 30 min)
- Scheduler logs supply count each refill tick

**Target:** Supply ≥ FLEET_SIZE (default: 4)

**If supply < FLEET_SIZE:**
1. Check for stale blockers (tasks completed but `[blocked-by]` not removed)
2. Decompose `[requires-opus]` tasks into fleet-eligible subtasks
3. Create standing tasks: compliance audits, session analysis, documentation

---

### 5. Common Failure Modes

#### Worker fails to commit/push

**Symptom:** Session ends with uncommitted changes, no git push.

**Diagnosis:**
```bash
# Check session metrics
cat .scheduler/metrics/sessions.jsonl | jq 'select(.sessionId == "<id>") | {filesChanged, commitCount, pushError}'
```

**Fix:**
- Conflict on branch → worker abandons and retries (auto-handled)
- Auth issue → check `GITHUB_TOKEN` in scheduler environment
- Network issue → transient, next retry succeeds

#### Task retry loop

**Symptom:** Same task attempted multiple times without progress.

**Diagnosis:**
```bash
# Check task failure count
curl -s http://localhost:8420/api/fleet/tasks | jq '.[] | select(.taskId == "<id>")'
```

**Fix:**
- Max 3 retries per task before exclusion
- If task is genuinely broken, mark `[requires-opus]` for human review
- Check if task's "Done when" is achievable

#### Worker timeout

**Symptom:** Session exceeds maxDurationMs, killed by executor.

**Diagnosis:**
```bash
# Check session duration
cat .scheduler/metrics/sessions.jsonl | jq 'select(.durationMs > 1800000)'
```

**Fix:**
- Task too complex for single session → decompose
- Worker stuck on long operation → check if process needs fire-and-forget submission
- Increase maxDurationMs in AGENT_PROFILES (requires config change)

#### Idle exploration not producing output

**Symptom:** Workers running idle tasks but nothing committed.

**Diagnosis:**
```bash
# Check if workers are in idle mode
curl -s http://localhost:8420/api/fleet/status
```

**Expected behavior:**
- Idle tasks only commit if valuable (discovery, fix, artifact)
- No commit is valid if nothing valuable found
- Check for cooldown: 6-hour per project+type

---

### 6. Fleet Configuration Reference

**Config file:** `.scheduler/config.json`

```json
{
  "fleet": {
    "maxWorkers": 4,
    "maxWorkersPerProject": 1,
    "pollIntervalMs": 30000
  }
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `maxWorkers` | 4 | Maximum concurrent fleet workers (0 = disabled) |
| `maxWorkersPerProject` | 1 | Concurrency limit per project |
| `pollIntervalMs` | 30000 | Task scan interval |

**Environment variables:**
- `GITHUB_TOKEN` — required for git push operations
- `OPENCODE_API_KEY` — required for GLM-5 backend access

**API endpoints:**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/fleet/status` | GET | Active workers, drain state |
| `/api/fleet/tasks` | GET | Fleet-eligible tasks |
| `/api/fleet/config` | GET/PATCH | Get/update config |
| `/api/fleet/drain` | POST | Start graceful drain |

---

### 7. Emergency Procedures

**Kill all workers immediately:**
```bash
# Warning: loses in-progress work
pkill -f "opencode.*fleet-worker"
curl -s -X PATCH http://localhost:8420/api/fleet/config \
  -H 'Content-Type: application/json' \
  -d '{"maxWorkers": 0}'
```

**Reset task failures:**
```bash
# Clear failure tracking (allows retry of failed tasks)
# Stored in memory, restart scheduler to reset
systemctl restart youji-scheduler
```

**Clear all claims:**
```bash
rm -f .scheduler/claims/*
```
