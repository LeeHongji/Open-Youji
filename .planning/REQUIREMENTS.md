# Requirements: Open-Youji

**Defined:** 2026-03-17
**Core Value:** Youji runs autonomously as a research institute director — she talks to the mentor via Slack, schedules and monitors worker agents, and keeps the research program moving forward.

## v1 Requirements

### Foundation

- [x] **FOUND-01**: Worktree manager can allocate an isolated git worktree for a worker session
- [x] **FOUND-02**: Worktree manager cleans up completed worktrees and merges branches back to main
- [x] **FOUND-03**: Worktree manager enforces a maximum concurrent worktree limit (configurable, default N=4)
- [x] **FOUND-04**: Remote repo configured as `https://github.com/LeeHongji/Open-Youji`

### Slack Bridge

- [x] **SLACK-01**: Slack bot connects via Socket Mode (no public HTTP endpoint needed)
- [x] **SLACK-02**: Messages in a Slack thread are routed to the same director session context
- [x] **SLACK-03**: New Slack threads create new session contexts
- [x] **SLACK-04**: Bot reconnects automatically on WebSocket disconnect without losing conversation state
- [x] **SLACK-05**: Per-thread mutex prevents concurrent message handling races

### Director (Youji)

- [x] **DIR-01**: Youji responds to mentor messages in Slack threads as a conversational agent
- [x] **DIR-02**: Youji can spawn worker agents to execute tasks based on mentor instructions
- [x] **DIR-03**: Youji periodically wakes up via cron to check project status across all active projects
- [x] **DIR-04**: Youji proactively reports progress, blockers, and pending approvals to mentor via Slack
- [x] **DIR-05**: Youji decomposes high-level goals from mentor into concrete tasks in TASKS.md
- [x] **DIR-06**: Youji reads and respects existing decision records, conventions, and approval gates

### Worker Orchestration

- [x] **WORK-01**: Workers execute in isolated git worktrees with their own branch
- [x] **WORK-02**: Workers receive a single self-contained task and return results via git commit
- [x] **WORK-03**: Worker pushes are serialized through the existing push queue
- [x] **WORK-04**: Workers have configurable session timeouts (default 15 min)
- [x] **WORK-05**: Zombie workers are detected and terminated (hard timeout + orphan cleanup)
- [x] **WORK-06**: Task claiming prevents double-pickup across concurrent workers

### Resource Accounting

- [x] **RES-01**: Session duration (wall-clock minutes) is tracked as the primary resource metric
- [x] **RES-02**: Budget gates enforce time-based limits per project (compute-minutes)
- [x] **RES-03**: Youji includes time budget status in proactive reports to mentor

### Observability

- [x] **OBS-01**: Every session (director and worker) produces structured metrics (JSONL)
- [x] **OBS-02**: Session logs are stored for debugging
- [x] **OBS-03**: Worker results are summarized and reported to the director

## v2 Requirements

### Self-Evolution

- **EVO-01**: System can modify its own scheduler code, rebuild, and restart safely
- **EVO-02**: Governance changes require approval before self-modification

### Advanced Routing

- **ROUTE-01**: Skill-typed task routing to appropriate worker models
- **ROUTE-02**: Knowledge-optimized metrics (findings per dollar/hour)

### Experiment Framework

- **EXP-01**: Fire-and-forget experiment submission with progress tracking
- **EXP-02**: Incremental analysis at defined checkpoints

## Out of Scope

| Feature | Reason |
|---------|--------|
| Web dashboard | Slack is the sole human interface; dashboards split attention |
| Inter-agent messaging | Coordination via git repo and director, not direct agent-to-agent |
| Multi-user access control | Single mentor model; Slack handles auth |
| Custom LLM routing layer | Claude Agent SDK handles model selection |
| Real-time agent streaming to mentor | Reports results, not process; avoids noise |
| Automatic conflict resolution | Prevent conflicts via task decomposition; fallback branches for edge cases |
| Agent memory beyond git | Repo is the brain; external stores create split-brain risk |
| Plugin/extension architecture | Skills (Markdown files) are the extension mechanism |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| FOUND-01 | Phase 1 | Complete |
| FOUND-02 | Phase 1 | Complete |
| FOUND-03 | Phase 1 | Complete |
| FOUND-04 | Phase 1 | Complete |
| SLACK-01 | Phase 2 | Complete |
| SLACK-02 | Phase 2 | Complete |
| SLACK-03 | Phase 2 | Complete |
| SLACK-04 | Phase 2 | Complete |
| SLACK-05 | Phase 2 | Complete |
| DIR-01 | Phase 3 | Complete |
| DIR-02 | Phase 3 | Complete |
| DIR-03 | Phase 4 | Complete |
| DIR-04 | Phase 4 | Complete |
| DIR-05 | Phase 3 | Complete |
| DIR-06 | Phase 3 | Complete |
| WORK-01 | Phase 3 | Complete |
| WORK-02 | Phase 3 | Complete |
| WORK-03 | Phase 3 | Complete |
| WORK-04 | Phase 3 | Complete |
| WORK-05 | Phase 3 | Complete |
| WORK-06 | Phase 3 | Complete |
| RES-01 | Phase 4 | Complete |
| RES-02 | Phase 4 | Complete |
| RES-03 | Phase 4 | Complete |
| OBS-01 | Phase 1 | Complete |
| OBS-02 | Phase 1 | Complete |
| OBS-03 | Phase 3 | Complete |

**Coverage:**
- v1 requirements: 27 total
- Mapped to phases: 27
- Unmapped: 0

---
*Requirements defined: 2026-03-17*
*Last updated: 2026-03-17 after initial definition*
