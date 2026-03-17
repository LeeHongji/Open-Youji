# Roadmap: Open-Youji

## Overview

Open-Youji transforms the existing Youji research institute infrastructure into an autonomous director-worker system where Youji communicates with the mentor via Slack, spawns workers in isolated git worktrees, and keeps the research program running without human task management. The existing codebase provides 60-70% of needed infrastructure; this roadmap delivers the remaining 30-40% across four phases, with Phase 1 and Phase 2 executable in parallel.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation** - Worktree manager, project scaffold, and session logging infrastructure
- [ ] **Phase 2: Slack Bridge** - Socket Mode connection with thread-to-session routing and reconnection
- [ ] **Phase 3: Director and Workers** - Youji director responds in Slack, decomposes tasks, spawns and monitors workers in worktrees
- [ ] **Phase 4: Autonomous Operation** - Cron-triggered director wake-ups, proactive reporting, and time-based resource accounting

## Phase Details

### Phase 1: Foundation
**Goal**: Workers can be spawned into isolated git worktrees with proper lifecycle management and structured logging
**Depends on**: Nothing (first phase)
**Requirements**: FOUND-01, FOUND-02, FOUND-03, FOUND-04, OBS-01, OBS-02
**Success Criteria** (what must be TRUE):
  1. A worker session can be allocated an isolated git worktree with its own branch, and that worktree is cleaned up after the session completes
  2. The system enforces a configurable maximum concurrent worktree limit (default N=4) and rejects allocation when at capacity
  3. The remote repo is configured as `https://github.com/LeeHongji/Open-Youji` and worktree branches can push to it
  4. Every session (director or worker) produces structured JSONL metrics and logs that can be inspected for debugging
**Plans**: TBD

Plans:
- [ ] 01-01: TBD
- [ ] 01-02: TBD

### Phase 2: Slack Bridge
**Goal**: Mentor can talk to the system via Slack threads with reliable message routing and reconnection
**Depends on**: Nothing (parallel with Phase 1)
**Requirements**: SLACK-01, SLACK-02, SLACK-03, SLACK-04, SLACK-05
**Success Criteria** (what must be TRUE):
  1. The Slack bot connects via Socket Mode without requiring a public HTTP endpoint
  2. Messages sent in the same Slack thread are routed to the same session context, and new threads create new contexts
  3. The bot automatically reconnects on WebSocket disconnect without losing conversation state
  4. Concurrent messages in the same thread are serialized (no race conditions from interleaved handling)
**Plans**: TBD

Plans:
- [ ] 02-01: TBD
- [ ] 02-02: TBD

### Phase 3: Director and Workers
**Goal**: Mentor can converse with Youji in Slack, and Youji can spawn workers to execute tasks and report results
**Depends on**: Phase 1, Phase 2
**Requirements**: DIR-01, DIR-02, DIR-05, DIR-06, WORK-01, WORK-02, WORK-03, WORK-04, WORK-05, WORK-06, OBS-03
**Success Criteria** (what must be TRUE):
  1. Youji responds to mentor messages in Slack threads as a conversational agent that reads and respects existing decision records and conventions
  2. Youji can decompose high-level goals from the mentor into concrete tasks and spawn worker agents to execute them
  3. Workers execute in isolated worktrees, commit results, and push through the serialized push queue without conflicts
  4. Zombie workers are detected and terminated after timeout, and task claiming prevents double-pickup across concurrent workers
  5. Worker results are summarized and reported back to the director for relay to the mentor
**Plans**: TBD

Plans:
- [ ] 03-01: TBD
- [ ] 03-02: TBD
- [ ] 03-03: TBD

### Phase 4: Autonomous Operation
**Goal**: Youji operates independently via cron, proactively reports to the mentor, and enforces time-based resource budgets
**Depends on**: Phase 3
**Requirements**: DIR-03, DIR-04, RES-01, RES-02, RES-03
**Success Criteria** (what must be TRUE):
  1. Youji periodically wakes up via cron to check project status across all active projects without mentor prompting
  2. Youji proactively posts progress summaries, blockers, and pending approvals to the mentor in Slack
  3. Session duration is tracked in wall-clock compute-minutes and budget gates enforce per-project time limits
**Plans**: TBD

Plans:
- [ ] 04-01: TBD
- [ ] 04-02: TBD

## Progress

**Execution Order:**
Phase 1 and Phase 2 can execute in parallel. Phase 3 depends on both. Phase 4 depends on Phase 3.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 0/2 | Not started | - |
| 2. Slack Bridge | 0/2 | Not started | - |
| 3. Director and Workers | 0/3 | Not started | - |
| 4. Autonomous Operation | 0/2 | Not started | - |
