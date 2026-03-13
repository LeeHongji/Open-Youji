Design pattern for using the repository as the sole persistent memory for stateless LLM agent sessions.

# Pattern: Repo as Cognitive State

## Summary

The repository is the sole shared state between stateless LLM agent sessions. All inter-session communication — facts, decisions, plans, tasks, open questions — is encoded as files in the repo. No external databases, no session history, no workflow state outside the repo.

## Problem

LLM agents have no persistent memory. Each session starts from zero context. Without explicit external memory, consecutive sessions drift, repeat work, or contradict each other. The fundamental challenge: how do you make stateless agents behave as if they have institutional memory?

Three failure modes emerge without persistent state:
1. **Knowledge loss**: findings discovered in one session are unavailable to the next.
2. **Decision amnesia**: choices made in one session are re-litigated in the next.
3. **Context collapse**: each session acts as if it's the first, lacking awareness of project history, open questions, and prior failed approaches.

Alternative approaches (external databases, vector stores, session logs) were considered and rejected. External state creates synchronization problems — the repo and the database can diverge. Session logs are too verbose and unstructured for efficient retrieval. The repo-as-state approach eliminates these by making the working directory the single source of truth.

## Solution

### File-based state artifacts

Every piece of inter-session state has a designated file type and location:

| State type | File/location | Access pattern |
|---|---|---|
| What happened | Project README log entries | Read at orient, append at session end |
| What to do next | `TASKS.md` per project | Read at task selection, update during execution |
| What was decided | `decisions/NNNN-title.md` | Read when relevant, immutable once accepted |
| What's unknown | README "Open questions" section | Read at orient, update when questions arise or resolve |
| What needs human input | `APPROVAL_QUEUE.md` | Read at orient, append when approval needed |
| What was learned | `experiments/*/EXPERIMENT.md` | Created during work, referenced in log entries |
| How things work | `patterns/*.md` | Read for self-understanding, updated after synthesis |

### The orient-read-write cycle

Every session follows a read-heavy start (orient) followed by focused writes:

1. **Orient**: read project READMEs, `APPROVAL_QUEUE.md`, budgets. This reconstructs the agent's understanding of the current state.
2. **Select**: read `TASKS.md` to find an actionable task.
3. **Execute**: do the work, writing findings inline (see Inline Logging pattern).
4. **Record**: commit changes, append a log entry summarizing what happened.

The log entry is the critical handoff — it's what the next session's orient step reads to understand what just happened.

### Archival conventions

State artifacts grow over time. Without management, READMEs become thousands of lines and orient becomes expensive. Conventions manage growth:

- **Log archival**: when a README's log exceeds ~150 lines, archive older entries to `log/YYYY-MM-DD-slug.md`. Keep only the 3-5 most recent entries in the README.
- **Task archival**: when completed tasks exceed ~10, archive to `completed-tasks.md`. `TASKS.md` contains only open tasks.
- **Decision immutability**: decision records are never edited after acceptance. Superseding decisions reference the old one.

### Orphan recovery

A persistent failure mode: sessions create files but don't commit them. The next session finds uncommitted work ("orphaned files"). The `/orient` skill's Step 0 checks for orphaned files and commits them, preventing knowledge loss. Tracking orphaned file rates over time is one way to measure improvement in session discipline.

## Forces and trade-offs

### Simplicity vs. query efficiency

Files are the simplest possible state mechanism — no schema migrations, no connection strings, no deployment. But files are bad at queries. "Which experiments used model X?" requires grepping through all EXPERIMENT.md files. For small-to-moderate scale (~100 experiment records), this is fast enough. At 1,000+, structured queries would be needed — but adding a database would introduce the synchronization problem this pattern deliberately avoids.

### Verbosity vs. context transfer

Effective context transfer requires verbose log entries with enough detail for the next session to understand what happened. But verbose entries make orient expensive (more tokens to read). The tension is managed by the archival convention — recent entries are verbose and accessible; older entries are archived and only consulted when needed.

### Single source of truth vs. redundancy

The pattern enforces one source of truth per fact. Tasks live in `TASKS.md`, not in the README and a tracking system. Decisions live in `decisions/`, not in chat messages. This prevents conflicts but requires discipline — agents must know where each type of state belongs.

## Evidence

Evidence from the OpenAkari system demonstrates the pattern's viability:

**Cross-session context transfer:** agents successfully reference prior log entries across sessions, enabling multi-session research projects where each session builds on the previous one's findings.

**Decision record compliance:** decision records are created and respected across sessions — agents do not contradict recorded decisions.

**Orphan recovery improvement:** orphaned file rates decrease over time as conventions and orient checks improve session discipline.

Youji-specific evidence will be collected as operational history accumulates. Key metrics to track: commit compliance rate, orphaned file rate, decision record adherence, cross-session context transfer success.

## CI layer analysis

Primarily **L2 (Workflow)** — the repo structure is a workflow pattern that shapes how agents interact with persistent state. The archival conventions are L2 (rules). The orphan recovery mechanism in /orient is L3 (Skill — judgment about what to commit). The file-based state artifacts are L1 (Schema — structural templates for logs, decisions, experiments).

## Known limitations

1. **Log verbosity scales poorly.** As projects accumulate hundreds of log entries, agents must parse more text to orient. The archival convention (move logs past ~150 lines to `log/YYYY-MM-DD-slug.md`) mitigates this. But archival is itself a recurring task.

2. **No session-to-session learning.** While logs transfer facts, no mechanism transfers _strategies_. A session that discovers "approach X doesn't work" records this as a log entry, but the next session may not read it carefully enough to avoid repeating the approach.

3. **Orphaned file accumulation.** Sessions commit their own work but not prior sessions' uncommitted files. The auto-commit convention in /orient Step 0 addresses this, but orphaned files remain the most common knowledge-loss pattern.

4. **No structured query capability.** Finding all experiments related to a topic requires grep-based search. The `evidence_for` frontmatter field (linking records to patterns) is a first step toward structured queries, but full-text search across hundreds of records remains manual.

## Self-evolution gaps

- **Human-dependent**: Archival decisions (when to archive, what to keep in README) are currently encoded as conventions but require judgment about what's "recent enough" to keep.
- **Self-diagnosable**: Orphan rates and commit compliance are mechanically measurable. The system can detect its own knowledge-loss rate.
- **Gap**: No mechanism to detect when a log entry lacks sufficient context for the next session. A session can write a log entry that is technically compliant but practically useless — and the system has no way to measure this.

## Open questions

1. **What is the minimum viable log entry?** What information must a log entry contain to reliably transfer context to the next session? The current convention (what happened, what was learned) evolved empirically but hasn't been systematically tested.

2. **Does archival lose important context?** When entries are moved to `log/`, they become less accessible (agents must explicitly navigate to them). Does this cause knowledge loss for patterns that span many sessions?

3. **How should the system handle conflicting state?** If two files disagree (e.g., a task is marked complete in `TASKS.md` but the experiment record says `status: running`), which wins? Currently, there's no conflict resolution mechanism — agents trust whatever they read first.

## Related patterns

- **Inline Logging** ([patterns/inline-logging.md](inline-logging.md)) — the convention for recording discoveries immediately. Ensures that repo state is updated in real-time, not deferred to end-of-session.
- **Structured Work Records** ([patterns/structured-work-records.md](structured-work-records.md)) — the schema for experiment records. Provides the structured format for the most knowledge-dense state artifacts.
- **Autonomous Execution** ([patterns/autonomous-execution.md](autonomous-execution.md)) — the protocol that reads and writes repo state on a schedule. The orient step is the primary consumer of repo-as-state.
