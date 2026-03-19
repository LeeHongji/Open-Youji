# Scheduler REST API

The scheduler exposes HTTP endpoints on port 8420 (configurable via `SCHEDULER_PORT`). All endpoints return JSON.

**Base URL:** `http://localhost:8420`

## Authentication

None. The server binds to localhost only and is intended for local tooling access.

---

## System Control

### POST /api/restart

Trigger graceful restart. Drains active sessions before exiting.

**Request:** No body required.

**Response:**
```json
{ "ok": true, "message": "Draining sessions before restart..." }
```

**Error responses:**
- `405 Method Not Allowed` — Use POST
- `503 Service Unavailable` — Restart handler not registered

---

### POST /api/fleet/drain

Stop accepting new fleet workers. Let running workers complete. Sets `FLEET_SIZE=0`.

**Request:** No body required.

**Response:**
```json
{ "ok": true, "message": "Fleet drain initiated — stopping new workers..." }
```

**Error responses:**
- `405 Method Not Allowed` — Use POST
- `503 Service Unavailable` — Fleet drain handler not registered

---

## Deep Work Sessions

### POST /api/deep-work

Spawn a deep work session for a specific task.

**Request body:**
```json
{
  "task": "string (required) — task description",
  "threadKey": "string (optional) — Slack thread key for notifications"
}
```

**Response:**
```json
{ "ok": true, "sessionId": "deep-work-abc123" }
```

**Error responses:**
- `400 Bad Request` — Missing `task` field or invalid JSON
- `405 Method Not Allowed` — Use POST
- `503 Service Unavailable` — Deep work handler not registered
- `500 Internal Server Error` — Failed to spawn session

---

## Experiment Tracking

### POST /api/experiments/register

Register an experiment for completion tracking. Called by agents after launching via `run.py --detach`.

**Request body:**
```json
{
  "dir": "string (required) — absolute path to experiment directory",
  "project": "string (required) — project name",
  "id": "string (required) — experiment ID"
}
```

**Response:**
```json
{ "ok": true }
```

**Error responses:**
- `400 Bad Request` — Missing required fields or invalid JSON
- `405 Method Not Allowed` — Use POST

---

## Channel Configuration

### GET /api/channels

List all configured Slack channels with their modes.

**Response:**
```json
{
  "channels": [
    { "mode": "dev", "channelId": "C12345678" },
    { "mode": "chat", "channelId": "C87654321", "team": "research" }
  ]
}
```

Channel modes: `dev` (development, triggers agent sessions) or `chat` (general chat, no agent).

---

### POST /api/channels

Set a channel's mode at runtime. Persists to `.scheduler/channel-modes.json`.

**Request body:**
```json
{
  "channelId": "string (required) — Slack channel ID",
  "mode": "string (required) — 'dev' or 'chat'"
}
```

**Response:**
```json
{ "ok": true, "channelId": "C12345678", "mode": "dev" }
```

**Error responses:**
- `400 Bad Request` — Missing `channelId` or invalid `mode`
- `405 Method Not Allowed` — Use POST

---

### DELETE /api/channels

Remove a channel from the registry.

**Request body:**
```json
{ "channelId": "string (required) — Slack channel ID" }
```

**Response:**
```json
{ "ok": true, "channelId": "C12345678" }
```

**Error responses:**
- `400 Bad Request` — Missing `channelId`
- `404 Not Found` — Channel not in registry
- `405 Method Not Allowed` — Use DELETE

---

## Task Claims

Task claims prevent concurrent agents from picking up the same task. Claims have a TTL (default 45 minutes).

### POST /api/tasks/claim

Attempt to claim a task. Returns the claim if successful, or error if already claimed.

**Request body:**
```json
{
  "taskText": "string (required) — first line of task from TASKS.md",
  "project": "string (required) — project name",
  "agentId": "string (required) — unique agent identifier",
  "ttlMs": "number (optional) — claim duration in ms, default 2700000 (45 min)"
}
```

**Response (success):**
```json
{
  "ok": true,
  "claim": {
    "claimId": "a1b2c3d4e5f6g7h8",
    "taskId": "1a2b3c4d5e6f",
    "taskText": "Write API documentation",
    "project": "youji",
    "agentId": "fleet-worker-abc123",
    "claimedAt": 1709251200000,
    "expiresAt": 1709253900000
  }
}
```

**Response (conflict):**
```json
{
  "ok": false,
  "error": "Task already claimed",
  "claimedBy": "fleet-worker-xyz789",
  "expiresAt": 1709253900000
}
```

**Error responses:**
- `400 Bad Request` — Missing required fields or invalid JSON
- `409 Conflict` — Task already claimed by another agent

---

### POST /api/tasks/release

Release a claim by claim ID or all claims for an agent.

**Request body (by claim ID):**
```json
{ "claimId": "string — the claim ID to release" }
```

**Request body (by agent ID):**
```json
{ "agentId": "string — release all claims for this agent" }
```

**Response:**
```json
{ "ok": true, "released": 3 }
```

Or for single claim:
```json
{ "ok": true }
```

**Error responses:**
- `400 Bad Request` — Provide `claimId` or `agentId`
- `404 Not Found` — Claim not found (when using `claimId`)

---

### GET /api/tasks/claims

List all active claims.

**Query parameters:**
- `project` — Filter by project name (optional)

**Response:**
```json
{
  "claims": [
    {
      "claimId": "a1b2c3d4e5f6g7h8",
      "taskId": "1a2b3c4d5e6f",
      "taskText": "Write API documentation",
      "project": "youji",
      "agentId": "fleet-worker-abc123",
      "claimedAt": 1709251200000,
      "expiresAt": 1709253900000
    }
  ]
}
```

---

## Unified Status

### GET /api/status

Get unified status combining sessions, experiments, jobs, and fleet metrics.

**Response:**
```json
{
  "timestamp": "2026-03-01T12:00:00.000Z",
  "summary": {
    "activeSessions": 2,
    "runningExperiments": 1,
    "totalJobs": 5,
    "enabledJobs": 4,
    "activeFleetWorkers": 3,
    "fleetTaskSupply": 12
  },
  "sessions": [
    {
      "id": "session-abc123",
      "jobName": "heartbeat",
      "startedAtMs": 1709251200000,
      "elapsedMs": 300000,
      "costUsd": 0.42,
      "numTurns": 8,
      "lastActivity": "Completed task..."
    }
  ],
  "experiments": [
    {
      "project": "tree-gen-project",
      "id": "eval-v1",
      "status": "running",
      "startedAt": "2026-03-01T11:00:00Z",
      "elapsedMs": 3600000,
      "progress": 45,
      "message": "Processing batch 45/100"
    }
  ],
  "jobs": [
    {
      "id": "job-1",
      "name": "heartbeat",
      "enabled": true,
      "schedule": "every 300000ms",
      "nextRunAtMs": 1709251800000,
      "lastStatus": "success",
      "lastRunAtMs": 1709251500000,
      "runCount": 42
    }
  ],
  "fleetWorkers": [
    {
      "sessionId": "fleet-worker-abc123",
      "taskId": "write-api-docs",
      "project": "youji",
      "durationMs": 180000
    }
  ]
}
```

Notes:
- `experiments` only includes active statuses (`running`, `retrying`, `stopping`)
- `fleetTaskSupply` is the count of unblocked fleet-eligible tasks

---

## Static Assets

### GET /charts/{filename}

Serve cached chart images (PNG). Used by the HTML dashboard.

**Response:** `200 OK` with `image/png` content type.

**Error responses:**
- `400 Bad Request` — Invalid filename (path traversal)
- `404 Not Found` — Chart not found

---

## HTML Pages

The dashboard also serves HTML pages for browser access:

| Path | Description |
|------|-------------|
| `/` | Overview dashboard |
| `/operational` | Operational metrics |
| `/research` | Research progress |
| `/projects` | Project list |
| `/projects/{name}` | Project detail page |
| `/experiments` | Experiment list |
