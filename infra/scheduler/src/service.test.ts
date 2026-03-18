/** Tests for SchedulerService concurrency guard and scheduling. */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SchedulerService } from "./service.js";
import type { Store } from "./types.js";

// Mock executeJob so we can control when it resolves
vi.mock("./executor.js", () => ({
  executeJob: vi.fn(),
}));

vi.mock("./branch-cleanup.js", () => ({
  runBranchCleanup: vi.fn(),
}));

vi.mock("./slack.js", () => ({
  dm: vi.fn().mockResolvedValue(undefined),
  notifyBudgetExceeded: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./slack-bridge.js", () => ({
  getWorkerManager: vi.fn(),
}));

vi.mock("./budget-gate.js", () => ({
  checkBudget: vi.fn(),
  checkTimeBudget: vi.fn(),
}));

import { executeJob } from "./executor.js";
import { runBranchCleanup } from "./branch-cleanup.js";
import { dm, notifyBudgetExceeded } from "./slack.js";
import { getWorkerManager } from "./slack-bridge.js";
import { checkTimeBudget } from "./budget-gate.js";
const mockedExecuteJob = vi.mocked(executeJob);
const mockedRunBranchCleanup = vi.mocked(runBranchCleanup);
const mockedDm = vi.mocked(dm);
const mockedNotifyBudgetExceeded = vi.mocked(notifyBudgetExceeded);
const mockedGetWorkerManager = vi.mocked(getWorkerManager);
const mockedCheckTimeBudget = vi.mocked(checkTimeBudget);

const TEST_DIR = join(tmpdir(), `scheduler-service-test-${Date.now()}`);

function makeStore(jobs: Store["jobs"]): Store {
  return { version: 1, jobs };
}

function makeJob(id: string, name: string, nextRunAtMs: number) {
  return {
    id,
    name,
    schedule: { kind: "every" as const, everyMs: 3_600_000 },
    payload: { message: "test" },
    enabled: true,
    createdAtMs: Date.now(),
    state: {
      nextRunAtMs,
      lastRunAtMs: null,
      lastStatus: null,
      lastError: null,
      lastDurationMs: null,
      runCount: 0,
    },
  };
}

describe("SchedulerService same-name concurrency guard", () => {
  let storePath: string;

  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
    storePath = join(TEST_DIR, "jobs.json");
    mockedExecuteJob.mockReset();
    mockedRunBranchCleanup.mockReset();
    mockedDm.mockReset();
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it("skips a due job when another job with the same name is already running across ticks", async () => {
    const now = Date.now();
    // Two different job definitions sharing the same name.
    // jobA is due now and will hang during execution.
    // jobB becomes due on a subsequent tick (while jobA is still executing).
    const jobA = makeJob("job-a", "youji-work-cycle", now - 1000);
    // jobB will be due ~150ms from now (after the first interval tick fires)
    const jobB = makeJob("job-b", "youji-work-cycle", now + 50);

    await writeFile(storePath, JSON.stringify(makeStore([jobA, jobB])));

    const executedJobIds: string[] = [];
    let resolveExec!: () => void;
    const hangExec = new Promise<void>((r) => { resolveExec = r; });

    mockedExecuteJob.mockImplementation(async (job) => {
      executedJobIds.push(job.id);
      await hangExec;
      return { ok: true, durationMs: 100, exitCode: 0, stdout: "" };
    });

    const service = new SchedulerService({
      storePath,
      // Short interval so ticks fire while jobA is still executing
      pollIntervalMs: 100,
    });

    // start() calls tick(), which begins executing jobA and blocks on hangExec.
    // Meanwhile, setInterval fires more ticks. jobB becomes due, but the name
    // "youji-work-cycle" is in the running set → jobB is skipped.
    const startPromise = service.start();

    // Wait long enough for jobB to become due and several interval ticks to fire
    await new Promise((r) => setTimeout(r, 500));

    // Only jobA should have been executed — jobB was skipped because of the name guard
    expect(executedJobIds).toEqual(["job-a"]);
    expect(mockedExecuteJob).toHaveBeenCalledTimes(1);
    expect(service.getRunningCount()).toBe(1);

    // Resolve the hanging execution so cleanup proceeds
    resolveExec();
    await startPromise;

    service.stop();
  });
});

// ── Branch cleanup scheduling ────────────────────────────────────────────────

describe("SchedulerService branch cleanup scheduling", () => {
  let storePath: string;

  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
    storePath = join(TEST_DIR, "jobs.json");
    mockedExecuteJob.mockReset();
    mockedRunBranchCleanup.mockReset();
    mockedDm.mockReset();
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it("runs branch cleanup when 6 hours have passed", async () => {
    await writeFile(storePath, JSON.stringify(makeStore([])));

    mockedRunBranchCleanup.mockResolvedValue({
      deleted: ["session-foo-abc", "session-bar-def"],
      kept: [],
    });

    const service = new SchedulerService({
      storePath,
      pollIntervalMs: 50,
      repoDir: "/test/repo",
    });

    await service.start();

    expect(mockedRunBranchCleanup).toHaveBeenCalledWith("/test/repo", {
      keepDays: 3,
      dryRun: false,
    });

    service.stop();
  });

  it("sends Slack DM when branches are deleted", async () => {
    await writeFile(storePath, JSON.stringify(makeStore([])));

    mockedRunBranchCleanup.mockResolvedValue({
      deleted: ["session-foo-abc"],
      kept: [],
    });

    const service = new SchedulerService({
      storePath,
      pollIntervalMs: 50,
      repoDir: "/test/repo",
    });

    await service.start();

    expect(mockedDm).toHaveBeenCalledTimes(1);
    expect(mockedDm).toHaveBeenCalledWith(
      expect.stringContaining("deleted 1 stale branch")
    );

    service.stop();
  });

  it("does not send Slack DM when no branches are deleted", async () => {
    await writeFile(storePath, JSON.stringify(makeStore([])));

    mockedRunBranchCleanup.mockResolvedValue({
      deleted: [],
      kept: [],
    });

    const service = new SchedulerService({
      storePath,
      pollIntervalMs: 50,
      repoDir: "/test/repo",
    });

    await service.start();

    expect(mockedDm).not.toHaveBeenCalled();

    service.stop();
  });

  it("does not run cleanup when repoDir is not set", async () => {
    await writeFile(storePath, JSON.stringify(makeStore([])));

    const service = new SchedulerService({
      storePath,
      pollIntervalMs: 50,
    });

    await service.start();

    expect(mockedRunBranchCleanup).not.toHaveBeenCalled();

    service.stop();
  });

  it("does not run cleanup on subsequent ticks within 6 hours", async () => {
    await writeFile(storePath, JSON.stringify(makeStore([])));

    mockedRunBranchCleanup.mockResolvedValue({
      deleted: [],
      kept: [],
    });

    const service = new SchedulerService({
      storePath,
      pollIntervalMs: 50,
      repoDir: "/test/repo",
    });

    await service.start();

    expect(mockedRunBranchCleanup).toHaveBeenCalledTimes(1);

    await new Promise((r) => setTimeout(r, 150));

    expect(mockedRunBranchCleanup).toHaveBeenCalledTimes(1);

    service.stop();
  });

  it("does not run cleanup when draining", async () => {
    await writeFile(storePath, JSON.stringify(makeStore([])));

    const service = new SchedulerService({
      storePath,
      pollIntervalMs: 50,
      repoDir: "/test/repo",
    });

    await service.start();

    mockedRunBranchCleanup.mockClear();

    service.startDrain();

    await new Promise((r) => setTimeout(r, 150));

    expect(mockedRunBranchCleanup).not.toHaveBeenCalled();

    service.stop();
  });

  it("handles cleanup errors gracefully", async () => {
    await writeFile(storePath, JSON.stringify(makeStore([])));

    mockedRunBranchCleanup.mockRejectedValue(new Error("git fetch failed"));

    const service = new SchedulerService({
      storePath,
      pollIntervalMs: 50,
      repoDir: "/test/repo",
    });

    await service.start();

    expect(mockedRunBranchCleanup).toHaveBeenCalled();
    expect(mockedDm).not.toHaveBeenCalled();

    service.stop();
  });
});

describe("SchedulerService max concurrent sessions limit", () => {
  let storePath: string;

  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
    storePath = join(TEST_DIR, "jobs.json");
    mockedExecuteJob.mockReset();
    mockedRunBranchCleanup.mockReset();
    mockedDm.mockReset();
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it("defaults to max 1 concurrent session", async () => {
    const now = Date.now();
    const jobA = makeJob("job-a", "job-a", now - 1000);
    const jobB = makeJob("job-b", "job-b", now - 500);

    await writeFile(storePath, JSON.stringify(makeStore([jobA, jobB])));

    let resolveA!: () => void;
    const hangA = new Promise<void>((r) => { resolveA = r; });

    const executedJobs: string[] = [];
    mockedExecuteJob.mockImplementation(async (job) => {
      executedJobs.push(job.id);
      if (job.id === "job-a") await hangA;
      return { ok: true, durationMs: 100, exitCode: 0, stdout: "" };
    });

    const service = new SchedulerService({
      storePath,
      pollIntervalMs: 100,
    });

    const startPromise = service.start();

    // Wait for first tick to start jobA (which hangs)
    await new Promise((r) => setTimeout(r, 50));

    // jobA is running, jobB should be skipped on subsequent ticks
    expect(executedJobs).toEqual(["job-a"]);
    expect(service.getRunningCount()).toBe(1);

    // Wait for another tick cycle - jobB should still be skipped
    await new Promise((r) => setTimeout(r, 150));
    expect(executedJobs).toEqual(["job-a"]); // Still only jobA

    // Resolve jobA - next tick should pick up jobB
    resolveA();
    await new Promise((r) => setTimeout(r, 150));

    expect(executedJobs).toEqual(["job-a", "job-b"]);

    await startPromise;
    service.stop();
  });

  it("blocks second job when max concurrent is 1 and first spans ticks", async () => {
    const now = Date.now();
    const jobA = makeJob("job-a", "job-a", now - 1000);
    const jobB = makeJob("job-b", "job-b", now - 500);

    await writeFile(storePath, JSON.stringify(makeStore([jobA, jobB])));

    let resolveA!: () => void;
    const hangA = new Promise<void>((r) => { resolveA = r; });

    const executedJobs: string[] = [];
    const log: string[] = [];
    mockedExecuteJob.mockImplementation(async (job) => {
      executedJobs.push(job.id);
      log.push(`start ${job.id} at ${Date.now()}`);
      if (job.id === "job-a") await hangA;
      log.push(`end ${job.id} at ${Date.now()}`);
      return { ok: true, durationMs: 100, exitCode: 0, stdout: "" };
    });

    const service = new SchedulerService({
      storePath,
      pollIntervalMs: 50,
      maxConcurrentSessions: 1,
    });

    const startPromise = service.start();

    // Wait 200ms - multiple ticks should fire, but jobB should be blocked
    await new Promise((r) => setTimeout(r, 200));

    // Only jobA should have started, jobB blocked
    expect(executedJobs).toEqual(["job-a"]);
    expect(service.getRunningCount()).toBe(1);

    // Resolve jobA
    resolveA();
    await new Promise((r) => setTimeout(r, 100));

    // Now jobB should start
    expect(executedJobs).toEqual(["job-a", "job-b"]);

    await startPromise;
    service.stop();
  });

  it("allows configuring max concurrent sessions to 2", async () => {
    const now = Date.now();
    const jobA = makeJob("job-a", "job-a", now - 1000);
    const jobB = makeJob("job-b", "job-b", now - 500);
    const jobC = makeJob("job-c", "job-c", now - 250);

    await writeFile(storePath, JSON.stringify(makeStore([jobA, jobB, jobC])));

    let resolveA!: () => void;
    let resolveB!: () => void;
    const hangA = new Promise<void>((r) => { resolveA = r; });
    const hangB = new Promise<void>((r) => { resolveB = r; });

    const executedJobs: string[] = [];
    mockedExecuteJob.mockImplementation(async (job) => {
      executedJobs.push(job.id);
      if (job.id === "job-a") await hangA;
      if (job.id === "job-b") await hangB;
      return { ok: true, durationMs: 100, exitCode: 0, stdout: "" };
    });

    const service = new SchedulerService({
      storePath,
      pollIntervalMs: 100,
      maxConcurrentSessions: 2,
    });

    const startPromise = service.start();

    // First tick: jobA starts (sequential loop, jobA blocks)
    await new Promise((r) => setTimeout(r, 50));
    expect(executedJobs).toEqual(["job-a"]);
    expect(service.getRunningCount()).toBe(1);

    // Resolve jobA so loop can continue to jobB
    resolveA();
    await new Promise((r) => setTimeout(r, 50));

    // Now jobB should have started
    expect(executedJobs).toEqual(["job-a", "job-b"]);
    expect(service.getRunningCount()).toBe(1);

    // Resolve jobB so loop continues to jobC
    resolveB();
    await new Promise((r) => setTimeout(r, 50));

    // jobC should now start (jobA and jobB completed)
    expect(executedJobs).toEqual(["job-a", "job-b", "job-c"]);

    await startPromise;
    service.stop();
  });

  it("allows unlimited concurrent sessions when maxConcurrentSessions is 0", async () => {
    const now = Date.now();
    const jobA = makeJob("job-a", "job-a", now - 1000);
    const jobB = makeJob("job-b", "job-b", now - 500);
    const jobC = makeJob("job-c", "job-c", now - 250);

    await writeFile(storePath, JSON.stringify(makeStore([jobA, jobB, jobC])));

    // Use slow-resolving mock to span ticks
    let resolveAll!: () => void;
    const hangAll = new Promise<void>((r) => { resolveAll = r; });

    const executedJobs: string[] = [];
    let callCount = 0;
    mockedExecuteJob.mockImplementation(async (job) => {
      executedJobs.push(job.id);
      callCount++;
      // Only hang the first job to simulate cross-tick scenario
      if (callCount === 1) await hangAll;
      return { ok: true, durationMs: 100, exitCode: 0, stdout: "" };
    });

    const service = new SchedulerService({
      storePath,
      pollIntervalMs: 100,
      maxConcurrentSessions: 0,
    });

    const startPromise = service.start();

    await new Promise((r) => setTimeout(r, 50));

    // First job starts, blocks the loop
    expect(executedJobs).toEqual(["job-a"]);
    expect(service.getRunningCount()).toBe(1);

    resolveAll();
    await startPromise;

    // All jobs should have run sequentially (unlimited means no cross-tick blocking)
    expect(executedJobs.sort()).toEqual(["job-a", "job-b", "job-c"]);

    service.stop();
  });
});

// ── Fleet integration ───────────────────────────────────────────────────────

describe("SchedulerService startup validation", () => {
  let storePath: string;

  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
    storePath = join(TEST_DIR, "jobs.json");
    mockedExecuteJob.mockReset();
    mockedRunBranchCleanup.mockReset();
    mockedDm.mockReset();
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it("logs warning for enabled job with null nextRunAtMs on startup", async () => {
    await writeFile(storePath, JSON.stringify(makeStore([])));

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.join(" "));
    };

    const service = new SchedulerService({
      storePath,
      pollIntervalMs: 100,
    });

    const brokenJob = makeJob("broken-job", "test-job", null as unknown as number);

    const storeSpy = vi.spyOn(service["store"], "list").mockReturnValue([brokenJob]);

    await service.start();
    service.stop();

    console.log = originalLog;
    storeSpy.mockRestore();

    expect(logs.some((l) => l.includes("Scheduler started"))).toBe(true);
    expect(logs.some((l) => l.includes("WARNING") && l.includes("null nextRunAtMs") && l.includes("test-job"))).toBe(true);
  });

  it("does not log warning for disabled job with null nextRunAtMs", async () => {
    await writeFile(storePath, JSON.stringify(makeStore([])));

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.join(" "));
    };

    const service = new SchedulerService({
      storePath,
      pollIntervalMs: 100,
    });

    const disabledJob = makeJob("disabled-job", "test-job", null as unknown as number);
    disabledJob.enabled = false;

    const storeSpy = vi.spyOn(service["store"], "list").mockReturnValue([disabledJob]);

    await service.start();
    service.stop();

    console.log = originalLog;
    storeSpy.mockRestore();

    expect(logs.some((l) => l.includes("WARNING") && l.includes("null nextRunAtMs"))).toBe(false);
  });

  it("logs warnings for multiple enabled jobs with null nextRunAtMs", async () => {
    await writeFile(storePath, JSON.stringify(makeStore([])));

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.join(" "));
    };

    const service = new SchedulerService({
      storePath,
      pollIntervalMs: 100,
    });

    const jobA = makeJob("job-a", "job-a", null as unknown as number);
    const jobB = makeJob("job-b", "job-b", null as unknown as number);
    const jobC = makeJob("job-c", "job-c", Date.now() - 1000);

    const storeSpy = vi.spyOn(service["store"], "list").mockReturnValue([jobA, jobB, jobC]);

    mockedExecuteJob.mockResolvedValue({ ok: true, durationMs: 100, exitCode: 0, stdout: "" });

    await service.start();
    service.stop();

    console.log = originalLog;
    storeSpy.mockRestore();

    const warningLogs = logs.filter((l) => l.includes("WARNING") && l.includes("null nextRunAtMs"));
    expect(warningLogs).toHaveLength(2);
    expect(warningLogs.some((l) => l.includes("job-a"))).toBe(true);
    expect(warningLogs.some((l) => l.includes("job-b"))).toBe(true);
    expect(warningLogs.some((l) => l.includes("job-c"))).toBe(false);
  });
});

// ── Worker respawn budget check ──────────────────────────────────────────────

describe("SchedulerService worker respawn budget check", () => {
  let storePath: string;
  let repoDir: string;

  beforeEach(async () => {
    repoDir = join(TEST_DIR, `repo-${Date.now()}`);
    await mkdir(join(repoDir, "projects", "projA"), { recursive: true });
    storePath = join(TEST_DIR, `jobs-${Date.now()}.json`);
    mockedExecuteJob.mockReset();
    mockedRunBranchCleanup.mockReset();
    mockedDm.mockReset();
    mockedNotifyBudgetExceeded.mockReset();
    mockedGetWorkerManager.mockReset();
    mockedCheckTimeBudget.mockReset();
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it("calls checkTimeBudget before starting a project worker", async () => {
    await writeFile(storePath, JSON.stringify(makeStore([])));
    // Create a TASKS.md with open tasks
    await writeFile(join(repoDir, "projects", "projA", "TASKS.md"), "- [ ] Do something\n");

    mockedCheckTimeBudget.mockResolvedValue({
      allowed: true,
      usedMinutes: 50,
      limitMinutes: 240,
    });

    const mockWm = {
      startProject: vi.fn(),
      stopProject: vi.fn(),
    };
    mockedGetWorkerManager.mockReturnValue(mockWm as unknown as ReturnType<typeof getWorkerManager>);

    const service = new SchedulerService({
      storePath,
      pollIntervalMs: 50,
      repoDir,
    });

    await service.start();
    // Wait for worker check (60s interval, but first tick triggers immediately since lastWorkerCheckMs=0)
    await new Promise((r) => setTimeout(r, 100));
    service.stop();

    expect(mockedCheckTimeBudget).toHaveBeenCalledWith("projA", repoDir, undefined);
    expect(mockWm.startProject).toHaveBeenCalledWith("projA");
  });

  it("blocks wm.startProject and calls wm.stopProject when budget exceeded", async () => {
    await writeFile(storePath, JSON.stringify(makeStore([])));
    await writeFile(join(repoDir, "projects", "projA", "TASKS.md"), "- [ ] Do something\n");

    mockedCheckTimeBudget.mockResolvedValue({
      allowed: false,
      usedMinutes: 250,
      limitMinutes: 240,
      reason: "Time budget exceeded: 250/240 compute-minutes used today",
    });

    const mockWm = {
      startProject: vi.fn(),
      stopProject: vi.fn(),
    };
    mockedGetWorkerManager.mockReturnValue(mockWm as unknown as ReturnType<typeof getWorkerManager>);

    const service = new SchedulerService({
      storePath,
      pollIntervalMs: 50,
      repoDir,
    });

    await service.start();
    await new Promise((r) => setTimeout(r, 100));
    service.stop();

    expect(mockWm.startProject).not.toHaveBeenCalled();
    expect(mockWm.stopProject).toHaveBeenCalledWith("projA");
  });

  it("sends budget exceeded notification when budget is exceeded", async () => {
    await writeFile(storePath, JSON.stringify(makeStore([])));
    await writeFile(join(repoDir, "projects", "projA", "TASKS.md"), "- [ ] Do something\n");

    mockedCheckTimeBudget.mockResolvedValue({
      allowed: false,
      usedMinutes: 250,
      limitMinutes: 240,
      reason: "Time budget exceeded",
    });

    const mockWm = {
      startProject: vi.fn(),
      stopProject: vi.fn(),
    };
    mockedGetWorkerManager.mockReturnValue(mockWm as unknown as ReturnType<typeof getWorkerManager>);

    const service = new SchedulerService({
      storePath,
      pollIntervalMs: 50,
      repoDir,
    });

    await service.start();
    await new Promise((r) => setTimeout(r, 100));
    service.stop();

    expect(mockedNotifyBudgetExceeded).toHaveBeenCalledWith("projA", 250, 240);
  });

  it("proceeds normally when budget check returns allowed", async () => {
    await writeFile(storePath, JSON.stringify(makeStore([])));
    await writeFile(join(repoDir, "projects", "projA", "TASKS.md"), "- [ ] Do something\n");

    mockedCheckTimeBudget.mockResolvedValue({
      allowed: true,
      usedMinutes: 100,
      limitMinutes: 240,
    });

    const mockWm = {
      startProject: vi.fn(),
      stopProject: vi.fn(),
    };
    mockedGetWorkerManager.mockReturnValue(mockWm as unknown as ReturnType<typeof getWorkerManager>);

    const service = new SchedulerService({
      storePath,
      pollIntervalMs: 50,
      repoDir,
    });

    await service.start();
    await new Promise((r) => setTimeout(r, 100));
    service.stop();

    expect(mockWm.startProject).toHaveBeenCalledWith("projA");
    expect(mockWm.stopProject).not.toHaveBeenCalled();
    expect(mockedNotifyBudgetExceeded).not.toHaveBeenCalled();
  });
});
