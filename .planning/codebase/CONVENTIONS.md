# Coding Conventions

**Analysis Date:** 2026-03-17

## Naming Patterns

**Files:**
- All source files use `kebab-case.ts` (e.g., `task-parser.ts`, `backend-preference.ts`, `sleep-guard.ts`)
- Test files co-located with source, named `<module>.test.ts` (e.g., `store.test.ts`, `executor.test.ts`)
- Large test suites split into focused sub-files: `verify-knowledge.test.ts`, `verify-compliance.test.ts`, `verify-footer.test.ts`, `verify-experiment.test.ts`, `verify-approval.test.ts`
- Entry point follows standard Node convention: `cli.ts`

**Functions:**
- camelCase for all functions: `computeNextRunAtMs`, `parseExperimentFrontmatter`, `checkConsumesResources`
- Async functions are named after their action: `executeJob`, `autoCommitOrphanedFiles`, `enqueuePushAndWait`
- Boolean-returning functions use is/has/was prefixes: `isL2Violation`, `hasRunScript`, `wasFullOrient`
- Pure utility functions documented with `/** Pure function — no I/O. */`

**Variables:**
- camelCase: `storePath`, `nextRunAtMs`, `lastRunAtMs`
- Constants use SCREAMING_SNAKE_CASE: `EXCLUDED_PROJECTS`, `UNCOMMITTED_FILE_WARNING_THRESHOLD`, `DEFAULT_DRAIN_TIMEOUT_MS`
- Module-level mutable state uses lowercase: `sessions`, `watchCallback`
- Regex constants use SCREAMING_SNAKE_CASE with `_RE` suffix: `PROJECT_README_RE`, `EXPERIMENT_MD_RE`, `BLOCKED_RE`

**Types and Interfaces:**
- PascalCase for all types, interfaces, and classes: `JobStore`, `SchedulerService`, `FleetTask`, `KnowledgeMetrics`
- Interface names are nouns or noun phrases: `AgentBackend`, `SessionHandle`, `ExecutionResult`
- Union types for discriminated unions with `kind` discriminant: `Schedule = CronSchedule | IntervalSchedule`
- Type aliases for unions: `SkillType`, `WorkerRole`, `TaskType`

**Classes:**
- PascalCase: `JobStore`, `SchedulerService`, `PushQueue`
- Class instances use private fields with `private` keyword: `private storePath`, `private data`, `private timer`

## Code Style

**Formatting:**
- TypeScript 5.9 with strict mode enabled (`"strict": true` in `tsconfig.json`)
- ES2022 target, Node16 module resolution
- No explicit formatter config detected (no `.prettierrc` or `biome.json`); style is consistent from manual convention

**TypeScript Strictness:**
- `strict: true` is mandatory — all functions have typed parameters and return types
- `declaration: true` — generates `.d.ts` files
- `skipLibCheck: true` for dependency compat
- Test files excluded from compilation via `tsconfig.json` `exclude`

**Line Length/Indentation:**
- 2-space indentation throughout
- Long lines broken at logical points (multi-line object literals, chained calls)

**Module System:**
- ESM throughout (`"type": "module"` in `package.json`)
- All local imports use `.js` extension (required for Node16 ESM): `import { JobStore } from "./store.js"`
- Node built-ins imported with `node:` prefix: `import { readFile } from "node:fs/promises"`
- Type-only imports use `import type`: `import type { Store, Job } from "./types.js"`

## Import Organization

**Order (observed pattern):**
1. Node built-ins with `node:` prefix: `node:fs/promises`, `node:path`, `node:child_process`
2. Third-party packages: `@anthropic-ai/claude-agent-sdk`, `better-sqlite3`, `croner`
3. Local modules with relative paths: `./store.js`, `./backend.js`, `./types.js`
4. Type-only imports (`import type`) at end of import block or mixed with value imports

**Path Aliases:**
- None detected. All local imports use relative paths.

**Example:**
```typescript
import { readFile, writeFile, mkdir, rename, access } from "node:fs/promises";
import { dirname } from "node:path";
import type { Store, Job, JobCreate, Schedule } from "./types.js";
import { computeNextRunAtMs } from "./schedule.js";
```

## Error Handling

**Patterns:**
- Best-effort operations wrapped in try/catch with empty catch: `try { ... } catch { /* best-effort logging */ }`
- Async error catching with explicit `err` variable typed via `err instanceof Error` guard:
  ```typescript
  const errMsg = err instanceof Error ? err.message : String(err);
  ```
- Operations that should not block caller use `.catch(() => defaultValue)`:
  ```typescript
  const activeExpDirs = await findActiveExperimentDirs(cwd).catch(() => [] as string[]);
  ```
- Guard clauses throw early: `if (!this.data) throw new Error("Store not loaded. Call load() first.")`
- Functions that may fail return `null` or boolean rather than throwing (e.g., `checkConsumesResources` returns `false` on error)
- All error paths still produce a complete result object — callers receive structured errors, not exceptions

**Console Logging:**
- Uses `console.log`, `console.warn`, `console.error` with `[module-name]` prefix: `[executor]`, `[auto-commit]`, `[rebase-push]`
- No structured logging library used; raw console output is the logging mechanism

## Comments

**File-Level JSDoc:**
- Every source file starts with a single-line `/** Description of the module. */` comment
- Examples: `/** Persistent JSON file store for scheduler jobs. */`, `/** Post-session verification — git-observed checks for SOP adherence. */`

**Function-Level JSDoc:**
- Multi-line JSDoc for public functions with non-obvious behavior:
  ```typescript
  /**
   * Check each enabled job's schedule fingerprint against what was stored.
   * Recompute nextRunAtMs when:
   *   1. Fingerprint doesn't match current schedule (schedule was edited)
   *   2. nextRunAtMs is null (broken job needing healing, regardless of fingerprint)
   */
  ```
- Inline comments reference decision records by ADR number: `// See ADR 0030`, `// See ADR 0042-v2`
- Inline comments reference architecture documents: `// See architecture/concurrency-safety.md §3 Race 3`

**Section Headers:**
- Module sections marked with unicode separators:
  ```typescript
  // ── Types ────────────────────────────────────────────────────────────────────
  // ── State ────────────────────────────────────────────────────────────────────
  // ── Public API ───────────────────────────────────────────────────────────────
  ```

**Interface Fields:**
- All fields on exported interfaces have JSDoc comments:
  ```typescript
  /** Maximum concurrent fleet workers. 0 = fleet disabled. */
  maxWorkers: number;
  ```

## Function Design

**Size:** Functions are kept focused. Long functions like `executeJob` in `executor.ts` are pipeline-style with clear sequential steps commented inline.

**Parameters:** Use options objects for complex configurations (`ServiceOptions`, `SpawnAgentOpts`). Single required parameters are positional. Optional parameters use `?` with defaults applied inside the function.

**Return Values:**
- Async operations return `Promise<T>` with meaningful result types
- Functions that can fail return `null` or a boolean flag rather than throwing
- Side-effecting functions that return void are typed as `Promise<void>`
- Result structs like `ExecutionResult` capture all outcome data (ok, error, metadata) rather than exceptions

## Module Design

**Exports:**
- Named exports only. No default exports in source files.
- All public API surface explicitly marked `export`
- Private helpers are unexported module-level functions

**Type Definitions:**
- All shared types centralized in `src/types.ts`
- Module-specific types defined in the module file alongside the implementation

**Immutability:**
- Profile overrides use spread: `return { ...profile, ...overrides }` (never mutate the original)
- Store state updated via `Object.assign` on job state (exception to immutability for in-place store mutations)
- Arrays sorted with spread: `const sorted = [...values].sort(...)`

**`const satisfies` pattern:**
```typescript
export const AGENT_PROFILES = {
  workSession: { model: "opus", maxDurationMs: 1_800_000, label: "work-session" },
  ...
} as const satisfies Record<string, AgentProfile>;
```

---

*Convention analysis: 2026-03-17*
