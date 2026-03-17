# Phase 1: Foundation - Context

**Gathered:** 2026-03-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the worktree lifecycle manager and session logging infrastructure that worker agents will use. Workers can be allocated isolated git worktrees, execute tasks, and have their worktrees cleaned up after completion. All sessions produce structured metrics. Remote repo is configured.

</domain>

<decisions>
## Implementation Decisions

### Worktree lifecycle
- Branches named `worker/{taskId}` (e.g., `worker/FOUND-01-setup`) — descriptive, task-traceable
- Worktrees created under `.worktrees/` in repo root (gitignored)
- Cleanup happens immediately after successful merge — no delay
- On crash/timeout: auto-commit any changes (like existing `auto-commit.ts`), then cleanup. Work is preserved, not discarded.
- Maximum concurrent worktrees: configurable, default N=4 (start with N=2 for initial testing)

### Merge-back strategy
- Rebase onto main (reuses existing `rebase-push.ts` pattern) — clean linear history
- On rebase conflict: push to `session-{id}` fallback branch, notify director. Director resolves in next session.
- Pushes go through existing serialized push queue (`push-queue.ts`)

### Project structure
- New code lives in `infra/scheduler/src/` — extends existing scheduler package
- New files: `worktree.ts` (manager), `worktree.test.ts` (tests)
- Reuses existing build system, types, test infra
- Remote repo configured to `https://github.com/LeeHongji/Open-Youji` during this phase, with push access verified

### Claude's Discretion
- Exact WorktreeManager API design (allocate, cleanup, list, etc.)
- Logging metrics format extensions (existing JSONL pattern is fine to extend)
- Internal implementation of stale worktree detection
- `.worktrees/` gitignore entry placement

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. The key constraint is that this infrastructure must integrate cleanly with the existing scheduler patterns (same coding conventions, same module structure, same test framework).

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `rebase-push.ts`: Already handles rebase-onto-main + fallback branch creation — worktree merge-back can delegate to this
- `push-queue.ts`: Serialized push queue with HTTP API — worktree pushes go through this
- `auto-commit.ts`: Pre/post-session orphaned file auto-commit — same pattern for crash recovery in worktrees
- `agent.ts` / `sdk.ts`: `spawnAgent()` already accepts `cwd` parameter — worktree path passed here
- `metrics.ts`: JSONL session metrics with `durationMs`, `model`, `ok` — extend for worktree-specific fields
- `types.ts`: Centralized type definitions — add `WorktreeState`, `WorktreeConfig` here

### Established Patterns
- ESM with `.js` imports, 2-space indent, kebab-case files
- `const satisfies` for configuration objects
- Named exports only, no default exports
- Error handling: return `null`/boolean rather than throw; `Result` structs over exceptions
- Console logging with `[module-name]` prefix
- Co-located tests: `worktree.test.ts` next to `worktree.ts`

### Integration Points
- `executor.ts`: Session lifecycle — worktree allocation happens before spawn, cleanup after
- `service.ts`: Polling loop — worktree capacity check before scheduling new workers
- `api/server.ts`: Control API — add worktree status endpoint
- `.gitignore`: Add `.worktrees/` entry

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 01-foundation*
*Context gathered: 2026-03-17*
