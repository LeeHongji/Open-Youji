# Opencode Contention Prevention Runbook

When: Opencode backend sessions hang or fail with exit code null, indicating SQLite database contention or orphaned processes.

Requires: Access to scheduler API, shell access to kill processes, SQLite database path at `~/.local/share/opencode/opencode.db`.

---

## 1. Symptoms Checklist

A session or fleet-wide opencode backend failure manifests as:

- [ ] **Exit code null**: Session metrics show `error: "opencode exited with code null"`
- [ ] **Duration at timeout**: `durationMs: 900000` (15-minute timeout with SIGTERM)
- [ ] **No model interaction**: `numTurns: null` (session hung before LLM call)
- [ ] **High process count**: `ps aux | grep opencode | wc -l` shows >8 concurrent processes
- [ ] **Orphaned PIDs**: Processes with `PPID=1` (reparented to init after scheduler restart)
- [ ] **Direct test hangs**: `opencode run "Reply PONG"` produces no output after 30s

**If 3+ symptoms present → Proceed to Diagnosis.**

---

## 2. Diagnostic Steps

### 2.1 Check concurrent process count

```bash
# Count active opencode processes
ps aux | grep opencode | grep -v grep | wc -l

# Expected: ≤4 (safe threshold per analysis/opencode-concurrency-threshold.md)
# Warning: >8 concurrent processes
# Critical: >16 concurrent processes
```

### 2.2 Check for orphaned processes (zombies)

```bash
# Find opencode processes not owned by scheduler
ps -ef | grep opencode | awk '$2 == 1 {print $0}'

# Orphaned processes show PPID=1
# Example: user 118243 1 0 ... opencode run ...
```

**Action**: Record orphan PIDs for killing (Step 3.1).

### 2.3 Check SQLite database locks

```bash
# Check processes holding the database open
lsof ~/.local/share/opencode/opencode.db

# Expected: 0-4 processes
# Warning: >8 processes holding database open
# Critical: >16 processes with write locks
```

### 2.4 Check database size and fragmentation

```bash
# Database size
du -h ~/.local/share/opencode/opencode.db

# Session count
sqlite3 ~/.local/share/opencode/opencode.db "SELECT COUNT(*) FROM sessions;"

# Warning: >200MB with >500 sessions (fragmentation likely)
# Action: Plan VACUUM during recovery
```

### 2.5 Check git gc temp files in snapshot directories

```bash
# Find stale git pack temp files
find ~/.local/share/opencode/snapshot/*/objects/pack -name "tmp_pack_*" -type f

# These indicate interrupted git gc operations
# Action: Plan cleanup during recovery
```

### 2.6 Verify model server health (rule out network/model issues)

```bash
# Test GLM-5 model server directly
curl -X POST http://100.73.240.114/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"zai-org/GLM-5-FP8","messages":[{"role":"user","content":"test"}]}'

# Expected: Response in <1000ms
# If slow/failing → model server issue (separate diagnosis)
```

---

## 3. Recovery Procedure

### 3.1 Kill orphaned processes (zombies)

```bash
# Replace PIDs with actual orphan PIDs from Step 2.2
kill <PID1> <PID2> <PID3>

# Verify they're gone
ps -ef | grep opencode | awk '$2 == 1 {print $0}'
# Should return no results
```

### 3.2 Kill all current opencode processes

```bash
# Kill all opencode instances
pkill -f opencode

# Verify
ps aux | grep opencode | grep -v grep
# Should return no results
```

### 3.3 Clean git gc temp files

```bash
# Remove stale git pack temp files
find ~/.local/share/opencode/snapshot/*/objects/pack -name "tmp_pack_*" -type f -delete

# Check for corrupted snapshot directories
du -sh ~/.local/share/opencode/snapshot/*
# Remove directories >1GB with incomplete git repos
```

### 3.4 VACUUM the database

```bash
# Compact database to reduce fragmentation
python3 -c "import sqlite3; c=sqlite3.connect('~/.local/share/opencode/opencode.db'); c.execute('VACUUM'); c.close()"

# Verify size reduction
du -h ~/.local/share/opencode/opencode.db
```

### 3.5 Restart scheduler

```bash
# Restart scheduler to clear stale state
systemctl restart youji-scheduler

# Verify scheduler is running
curl -s http://localhost:8420/api/fleet/status | jq
```

### 3.6 Verify recovery

```bash
# Test single opencode session
opencode run "Reply PONG"

# Expected: Response in <15s with "PONG" output
# If hangs → contention persists, repeat diagnosis
```

**Check:**
- Single opencode test responds in <15s
- `curl http://localhost:8420/api/fleet/status` shows `activeCount ≤ maxWorkers`
- Fleet workers spawn and complete successfully

---

## 4. Prevention Measures

### 4.1 Enforce FLEET_SIZE limits

**Maximum safe concurrency**: N ≤ 4 workers (per `analysis/opencode-concurrency-threshold.md`)

```bash
# Check current FLEET_SIZE
cat ~/youji/infra/scheduler/ecosystem.config.cjs | grep FLEET_SIZE

# If >4, reduce immediately
curl -s -X PATCH http://localhost:8420/api/fleet/config \
  -H 'Content-Type: application/json' \
  -d '{"maxWorkers": 4}'
```

**Rationale**: Testing shows:
- N≤4: 93-96% success rate (safe)
- N=5-8: 55-89% success rate (degraded)
- N≥9: <55% success rate (failure)

### 4.2 Disable git gc during opencode sessions

**Implemented in** `infra/scheduler/src/backend.ts` (commit 23865aab)

```typescript
// Opencode spawn environment includes:
process.env.GIT_CONFIG_COUNT = '1';
process.env.GIT_CONFIG_KEY_0 = 'gc.auto';
process.env.GIT_CONFIG_VALUE_0 = '0';
```

**Verify**:
```bash
# Check backend test coverage
cd ~/youji/infra/scheduler
npm test -- backend.test.ts
# Tests at lines 122-137 should pass
```

### 4.3 Periodic database maintenance

**Weekly**: Check database size and fragmentation
```bash
# Add to weekly maintenance task
du -h ~/.local/share/opencode/opencode.db
# If >200MB, schedule VACUUM during low-traffic period
```

### 4.4 Monitor orphan accumulation

**Add to scheduler health check**: Alert if orphan count >0 for >5 minutes

```bash
# Current orphans (should be 0)
ps -ef | grep opencode | awk '$2 == 1' | wc -l
```

### 4.5 Avoid fleet resize without PM2 restart

**Common mistake**: Editing `ecosystem.config.cjs` without `--update-env`

```bash
# WRONG (doesn't apply change):
# Edit ecosystem.config.cjs
# PM2 doesn't pick up new env vars

# CORRECT:
# 1. Edit ecosystem.config.cjs
# 2. Restart with --update-env flag:
pm2 restart ecosystem.config.cjs --update-env

# 3. Verify:
pm2 env 0 | grep FLEET_SIZE
```

---

## 5. Quick Reference

| Symptom | Diagnosis Command | Action |
|---------|-------------------|--------|
| Exit code null | `ps aux \| grep opencode \| wc -l` | Kill processes, check concurrency |
| Session hangs | `lsof ~/.local/share/opencode/opencode.db` | Kill zombies, VACUUM database |
| Timeout at 900s | `find ~/.local/share/opencode/snapshot -name "tmp_pack_*"` | Clean temp files, set gc.auto=0 |
| Orphan processes | `ps -ef \| grep opencode \| awk '$2 == 1'` | Kill orphan PIDs |

**Emergency kill all:**
```bash
pkill -f opencode
curl -s -X PATCH http://localhost:8420/api/fleet/config \
  -H 'Content-Type: application/json' \
  -d '{"maxWorkers": 0}'
```

---

## References

- Diagnosis: `projects/youji/diagnosis/diagnosis-opencode-fleet-total-failure-2026-03-06.md`
- Concurrency analysis: `analysis/opencode-concurrency-threshold.md`
- gc.auto fix: `infra/scheduler/src/backend.ts` (commit 23865aab)
- Fleet operations: `docs/sops/fleet-operations.md`
