/** Tests for graceful restart with session drain and spawn gate. */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SchedulerService } from "./service.js";
import type { Store } from "./types.js";

vi.mock("./executor.js", () => ({
  executeJob: vi.fn(),
}));

import { executeJob } from "./executor.js";
const mockedExecuteJob = vi.mocked(executeJob);

vi.mock("./backend.js", () => ({
  resolveBackend: vi.fn(() => ({
    name: "claude",
    runSupervised: vi.fn(() => ({
      handle: { backend: "claude", interrupt: async () => {}, streamInput: async () => {} },
      result: new Promise(() => {}),
    })),
  })),
}));

vi.mock("./session.js", () => ({
  registerSession: vi.fn(() => ({
    id: "test",
    jobId: "test",
    jobName: "test",
    sessionId: null,
    startedAtMs: Date.now(),
    handle: { backend: "claude", interrupt: async () => {} },
    messages: [],
    watchers: new Set(),
    costUsd: 0,
    numTurns: 0,
  })),
  unregisterSession: vi.fn(),
  bufferMessage: vi.fn(),
  summarizeMessage: vi.fn(() => null),
  updateSessionStats: vi.fn(),
}));

import { spawnAgent, AGENT_PROFILES } from "./agent.js";
import { isDraining, setDraining } from "./drain-state.js";

vi.mock("./drain-state.js", () => ({
  isDraining: vi.fn(() => false),
  setDraining: vi.fn(),
}));

const mockedIsDraining = vi.mocked(isDraining);

const TEST_DIR = join(tmpdir(), `drain-test-${Date.now()}`);

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

describe("SchedulerService drain mode", () => {
  let storePath: string;

  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
    storePath = join(TEST_DIR, "jobs.json");
    mockedExecuteJob.mockReset();
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it("isDraining is false initially", async () => {
    await writeFile(storePath, JSON.stringify(makeStore([])));
    const service = new SchedulerService({ storePath, pollIntervalMs: 100_000 });
    await service.start();

    expect(service.isDraining()).toBe(false);

    service.stop();
  });

  it("startDrain resolves immediately when no jobs are running", async () => {
    await writeFile(storePath, JSON.stringify(makeStore([])));
    const service = new SchedulerService({ storePath, pollIntervalMs: 100_000 });
    await service.start();

    await service.startDrain();

    expect(service.isDraining()).toBe(true);

    service.stop();
  });

  it("draining prevents new jobs from being executed", async () => {
    const now = Date.now();
    const job = makeJob("job-a", "test-job", now - 1000);
    await writeFile(storePath, JSON.stringify(makeStore([job])));

    mockedExecuteJob.mockResolvedValue({
      ok: true,
      durationMs: 50,
      exitCode: 0,
      stdout: "",
    });

    const service = new SchedulerService({ storePath, pollIntervalMs: 100_000 });

    await writeFile(storePath, JSON.stringify(makeStore([])));
    await service.start();

    await writeFile(storePath, JSON.stringify(makeStore([job])));
    await service.startDrain();

    expect(mockedExecuteJob).not.toHaveBeenCalled();

    service.stop();
  });

  it("startDrain waits for running jobs to complete", async () => {
    const now = Date.now();
    const job = makeJob("job-a", "test-job", now - 1000);
    await writeFile(storePath, JSON.stringify(makeStore([job])));

    let resolveExec!: () => void;
    const hangExec = new Promise<void>((r) => { resolveExec = r; });

    mockedExecuteJob.mockImplementation(async () => {
      await hangExec;
      return { ok: true, durationMs: 100, exitCode: 0, stdout: "" };
    });

    const service = new SchedulerService({ storePath, pollIntervalMs: 100_000 });
    const startPromise = service.start();

    await new Promise((r) => setTimeout(r, 50));
    expect(service.getRunningCount()).toBe(1);

    let drainResolved = false;
    const drainPromise = service.startDrain().then(() => { drainResolved = true; });

    expect(service.isDraining()).toBe(true);

    await new Promise((r) => setTimeout(r, 100));
    expect(drainResolved).toBe(false);

    resolveExec();
    await drainPromise;
    expect(drainResolved).toBe(true);
    expect(service.getRunningCount()).toBe(0);

    await startPromise;
    service.stop();
  });

  it("startDrain resolves after timeout even if jobs still running", async () => {
    const now = Date.now();
    const job = makeJob("job-a", "test-job", now - 1000);
    await writeFile(storePath, JSON.stringify(makeStore([job])));

    mockedExecuteJob.mockImplementation(async () => {
      await new Promise(() => {});
      return { ok: true, durationMs: 0, exitCode: 0, stdout: "" };
    });

    const service = new SchedulerService({ storePath, pollIntervalMs: 100_000 });
    const startPromise = service.start();

    await new Promise((r) => setTimeout(r, 50));
    expect(service.getRunningCount()).toBe(1);

    const start = Date.now();
    await service.startDrain(500);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(400);
    expect(elapsed).toBeLessThan(2000);
    expect(service.isDraining()).toBe(true);

    service.stop();
  });

  it("calling startDrain twice returns the same promise", async () => {
    await writeFile(storePath, JSON.stringify(makeStore([])));
    const service = new SchedulerService({ storePath, pollIntervalMs: 100_000 });
    await service.start();

    const p1 = service.startDrain();
    const p2 = service.startDrain();

    expect(p1).toBe(p2);

    await p1;
    service.stop();
  });
});

describe("spawnAgent drain gate", () => {
  beforeEach(() => {
    mockedIsDraining.mockReturnValue(false);
  });

  it("spawns normally when not draining", () => {
    const result = spawnAgent({
      profile: AGENT_PROFILES.chat,
      prompt: "hello",
      cwd: "/tmp",
    });

    expect(result.sessionId).toBeTruthy();
    expect(result.handle).toBeDefined();
    expect(result.result).toBeInstanceOf(Promise);
  });

  it("throws when draining", () => {
    mockedIsDraining.mockReturnValue(true);

    expect(() => {
      spawnAgent({
        profile: AGENT_PROFILES.chat,
        prompt: "hello",
        cwd: "/tmp",
      });
    }).toThrow(/draining/i);
  });
});
