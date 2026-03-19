# Testing Patterns

**Analysis Date:** 2026-03-17

## Test Framework

**Runner:**
- Vitest 4.x
- Config: `infra/scheduler/vitest.config.ts`

**Assertion Library:**
- Vitest built-in (`expect`) — no separate assertion library

**Run Commands:**
```bash
cd infra/scheduler
npx vitest run          # Run all tests once
npx vitest              # Watch mode
# No dedicated coverage command in package.json scripts
```

**Vitest Config:**
```typescript
export default defineConfig({
  test: {
    globals: true,
    include: ["src/**/*.test.ts"],
    exclude: ["dist/**", "node_modules/**", "reference-implementations/**"],
  },
});
```

## Test File Organization

**Location:** Co-located with source files in `infra/scheduler/src/`. Every `foo.ts` has a corresponding `foo.test.ts` in the same directory.

**Naming:**
- `<module>.test.ts` for the primary test file
- Large modules with many concerns split into `<module>-<focus>.test.ts`:
  - `verify-knowledge.test.ts`
  - `verify-compliance.test.ts`
  - `verify-footer.test.ts`
  - `verify-experiment.test.ts`
  - `verify-approval.test.ts`
- The root `verify.test.ts` acts as an index file with a single placeholder test

**Counts:**
- 64 test files, 77 source files (nearly 1:1 ratio)

**Structure:**
```
infra/scheduler/src/
├── store.ts
├── store.test.ts
├── executor.ts
├── executor.test.ts
├── verify.ts
├── verify.test.ts          # index — delegates to focused sub-files
├── verify-knowledge.test.ts
├── verify-compliance.test.ts
...
```

## Test Structure

**Suite Organization:**
```typescript
/** Tests for <module>: <brief description>. */
import { describe, it, expect, beforeEach, afterEach } from "vitest";

describe("<module or feature>", () => {
  describe("<sub-feature>", () => {
    it("<does specific thing>", () => {
      // arrange
      // act
      // assert
    });
  });
});
```

**Patterns:**
- Tests import only what they need from vitest: `import { describe, it, expect, beforeEach, afterEach } from "vitest"`
- `beforeEach` / `afterEach` used for filesystem setup/teardown (temp directories)
- File-level JSDoc on test files mirrors source file doc: `/** Tests for JobStore: schedule-change detection and nextRunAtMs recomputation. */`
- Descriptive `it()` strings written as complete sentences: `"recomputes nextRunAtMs when schedule.expr changes and nextRunAtMs is null"`
- Arrange-Act-Assert with inline comments for non-obvious setup

## Mocking

**Framework:** Vitest's built-in `vi.mock` / `vi.fn` / `vi.mocked`

**Module Mock Pattern (executor.test.ts):**
```typescript
vi.mock("./auto-commit.js", () => ({
  autoCommitOrphanedFiles: vi.fn().mockResolvedValue(null),
}));

vi.mock("./agent.js", () => ({
  spawnAgent: vi.fn().mockImplementation((opts: SpawnAgentOpts) => {
    spawnCalls.push(opts);
    return { result: Promise.resolve(spawnResult) };
  }),
  AGENT_PROFILES: { ... },
  generateSessionId: vi.fn().mockReturnValue("work-session-test123"),
  resolveProfileForBackend: vi.fn().mockImplementation((profile) => profile),
}));
```

**Dynamic Mock Override Pattern:**
```typescript
vi.mocked(await import("./agent.js")).spawnAgent.mockImplementationOnce(() => {
  throw new Error("Failed to spawn agent");
});
```

**Spy Pattern:**
```typescript
const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
// ... test ...
warnSpy.mockRestore();
```

**Reset Pattern:**
```typescript
beforeEach(() => {
  vi.clearAllMocks();
  spawnCalls = [];
  spawnResult = { text: "Session completed", costUsd: 0.5, ... };
});
```

**What to Mock:**
- All external side-effects: Slack notifications (`slack.js`), git operations (`verify.js`), filesystem-touching utilities (`auto-commit.js`)
- Backend calls: `agent.js`, `backend.js`, `executor.js`
- Services that are expensive or have side effects: `rebase-push.js`, `branch-cleanup.js`

**What NOT to Mock:**
- Pure functions (schedule math, parsers, regex validators) — these are tested directly
- Filesystem in integration-style tests that explicitly write and read temp files

## Fixtures and Factories

**Test Data Factory Pattern:**
```typescript
function makeStore(jobs: Store["jobs"]): Store {
  return { version: 1, jobs };
}

function makeCronJob(
  id: string,
  name: string,
  expr: string,
  nextRunAtMs: number | null,
): Job {
  return {
    id,
    name,
    schedule: { kind: "cron", expr },
    payload: { message: "test" },
    enabled: true,
    createdAtMs: Date.now(),
    state: { nextRunAtMs, lastRunAtMs: null, lastStatus: null, lastError: null, lastDurationMs: null, runCount: 0 },
  };
}

function createJob(overrides?: Partial<JobPayload>): Job {
  return {
    id: "job-1",
    name: "test-job",
    schedule: { kind: "every", everyMs: 60000 },
    payload: { message: "Test message", ...overrides },
    ...
  };
}
```

**Default Object Helpers (anomaly-detection.test.ts):**
```typescript
function defaultKnowledge(): KnowledgeMetrics {
  return { newExperimentFindings: 0, newDecisionRecords: 0, ... };
}

function session(overrides: Partial<SessionMetrics> = {}): SessionMetrics {
  return { timestamp: "2026-02-21T00:00:00.000Z", jobName: "youji-work-cycle", ...overrides };
}
```

**Location:** Factories are defined locally within each test file (no shared fixtures directory).

**Temp Directory Pattern:**
```typescript
const TEST_DIR = join(tmpdir(), `scheduler-store-test-${Date.now()}`);

beforeEach(async () => {
  await mkdir(TEST_DIR, { recursive: true });
  storePath = join(TEST_DIR, "jobs.json");
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});
```

For async temp dirs: `tmpDir = await mkdtemp(join(tmpdir(), "notify-test-"))`.

## Coverage

**Requirements:** No coverage target configured in `vitest.config.ts`. No `--coverage` script in `package.json`.

**View Coverage:**
```bash
cd infra/scheduler
npx vitest run --coverage
```

## Test Types

**Unit Tests:**
- Primary test type. All 64 test files are unit tests.
- Scope: individual functions, pure utilities, class methods with mocked dependencies
- Pure functions (schedule math, regex matching, parsers) tested directly without mocks
- Stateful classes (JobStore) tested with real filesystem via temp directories

**Integration Tests:**
- Not distinct from unit tests — no separate integration test directory or marker
- Store tests that write real JSON to tmpdir and read back are effectively integration tests

**E2E Tests:**
- Not present. No Playwright, Cypress, or end-to-end harness detected.

## Common Patterns

**Parametric Testing with `it.each`:**
```typescript
it.each([
  ["[blocked-by: external-dep]", true],
  ["[BLOCKED-BY: something]", true],
  ["[fleet-eligible]", false],
])("matches %s: %s", (input, expected) => {
  expect(BLOCKED_RE.test(input)).toBe(expected);
});
```

Used in: `task-parser.test.ts`, `sleep-guard.test.ts`, `verify-compliance.test.ts`, `backend-all.test.ts`.

**Async Testing:**
```typescript
it("returns null when no budget.yaml exists", async () => {
  const result = await readBudgetStatus(tmpDir);
  expect(result).toBeNull();
});
```

**Error Testing:**
```typescript
it("does not throw on git status error", async () => {
  await expect(checkUncommittedFileThreshold(process.cwd())).resolves.not.toThrow();
});

it("returns null for invalid cron expression", () => {
  const schedule: Schedule = { kind: "cron", expr: "invalid" };
  expect(() => computeNextRunAtMs(schedule, nowMs)).toThrow();
});
```

**Asserting on Mutable State (spy capture):**
```typescript
let spawnCalls: SpawnAgentOpts[] = [];

vi.mock("./agent.js", () => ({
  spawnAgent: vi.fn().mockImplementation((opts: SpawnAgentOpts) => {
    spawnCalls.push(opts);
    return { result: Promise.resolve(spawnResult) };
  }),
}));

it("passes cwd to spawnAgent", async () => {
  const job = createJob({ cwd: "/tmp/test-project" });
  await executeJob(job);
  expect(spawnCalls[0]!.cwd).toBe("/tmp/test-project");
});
```

**Module Reset for Stateful Modules:**
```typescript
beforeEach(async () => {
  vi.resetModules();
  // ...
});

afterEach(async () => {
  vi.resetModules();
  // ...
});

it("getBackendPreference returns null when no preference is set", async () => {
  const { getBackendPreference, setBackendPreferencePath } = await import(
    "./backend-preference.js"
  );
  setBackendPreferencePath(testFile);
  expect(getBackendPreference()).toBeNull();
});
```

`vi.resetModules()` is used when module state needs to be reset between tests (e.g., `backend-preference.test.ts`).

---

*Testing analysis: 2026-03-17*
