/** Tests for JobStore: schedule-change detection and nextRunAtMs recomputation. */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { JobStore } from "./store.js";
import { computeNextRunAtMs } from "./schedule.js";
import type { Store, Job } from "./types.js";

const TEST_DIR = join(tmpdir(), `scheduler-store-test-${Date.now()}`);

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

describe("JobStore schedule-change recomputation", () => {
  let storePath: string;

  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
    storePath = join(TEST_DIR, "jobs.json");
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it("recomputes nextRunAtMs when schedule.expr changes and nextRunAtMs is null", async () => {
    // Simulate: user edited schedule from weekly to daily, left nextRunAtMs as null
    const job = makeCronJob("hscan", "horizon-scan", "0 0 * * *", null);
    await writeFile(storePath, JSON.stringify(makeStore([job])));

    const store = new JobStore(storePath);
    await store.load();

    const loaded = store.get("hscan")!;
    expect(loaded.state.nextRunAtMs).not.toBeNull();
    // Should be a valid future timestamp matching the cron expression
    const expected = computeNextRunAtMs(
      { kind: "cron", expr: "0 0 * * *" },
      Date.now(),
    );
    expect(loaded.state.nextRunAtMs).toBe(expected);
  });

  it("recomputes nextRunAtMs when schedule.expr changes (stale value from old schedule)", async () => {
    // Job was running weekly (Sunday 6AM), schedule changed to daily midnight.
    // nextRunAtMs still points to the old weekly schedule time.
    const oldNextRun = computeNextRunAtMs(
      { kind: "cron", expr: "0 6 * * 0" },
      Date.now(),
    );
    // The schedule has been changed to daily midnight, but nextRunAtMs is from old schedule
    const job = makeCronJob("hscan", "horizon-scan", "0 0 * * *", oldNextRun);
    // Persist with a _scheduleFingerprint that matches the OLD schedule
    const storeData = makeStore([job]);
    (storeData.jobs[0].state as any)._scheduleFingerprint = "cron:0 6 * * 0";
    await writeFile(storePath, JSON.stringify(storeData));

    const store = new JobStore(storePath);
    await store.load();

    const loaded = store.get("hscan")!;
    // nextRunAtMs should now match the NEW schedule (daily midnight)
    const expectedNew = computeNextRunAtMs(
      { kind: "cron", expr: "0 0 * * *" },
      Date.now(),
    );
    expect(loaded.state.nextRunAtMs).toBe(expectedNew);
  });

  it("does NOT recompute nextRunAtMs when schedule has not changed", async () => {
    // Job with a valid nextRunAtMs and matching fingerprint — should be left alone
    const existingNext = computeNextRunAtMs(
      { kind: "cron", expr: "*/30 * * * *" },
      Date.now(),
    );
    const job = makeCronJob(
      "work",
      "youji-work-cycle",
      "*/30 * * * *",
      existingNext,
    );
    const storeData = makeStore([job]);
    (storeData.jobs[0].state as any)._scheduleFingerprint =
      "cron:*/30 * * * *";
    await writeFile(storePath, JSON.stringify(storeData));

    const store = new JobStore(storePath);
    await store.load();

    const loaded = store.get("work")!;
    expect(loaded.state.nextRunAtMs).toBe(existingNext);
  });

  it("recomputes nextRunAtMs for enabled job with null nextRunAtMs and no fingerprint", async () => {
    // Legacy job with no fingerprint and null nextRunAtMs — should be healed
    const job = makeCronJob("legacy", "some-job", "0 12 * * *", null);
    await writeFile(storePath, JSON.stringify(makeStore([job])));

    const store = new JobStore(storePath);
    await store.load();

    const loaded = store.get("legacy")!;
    expect(loaded.state.nextRunAtMs).not.toBeNull();
    const expected = computeNextRunAtMs(
      { kind: "cron", expr: "0 12 * * *" },
      Date.now(),
    );
    expect(loaded.state.nextRunAtMs).toBe(expected);
  });

  it("does NOT recompute nextRunAtMs for disabled jobs", async () => {
    const job = makeCronJob("disabled", "disabled-job", "0 0 * * *", null);
    job.enabled = false;
    await writeFile(storePath, JSON.stringify(makeStore([job])));

    const store = new JobStore(storePath);
    await store.load();

    const loaded = store.get("disabled")!;
    expect(loaded.state.nextRunAtMs).toBeNull();
  });

  it("persists the recomputed nextRunAtMs and fingerprint to disk", async () => {
    const job = makeCronJob("hscan", "horizon-scan", "0 0 * * *", null);
    await writeFile(storePath, JSON.stringify(makeStore([job])));

    const store = new JobStore(storePath);
    await store.load();

    // Read the raw file to confirm it was written back
    const raw = JSON.parse(await readFile(storePath, "utf-8")) as Store;
    const savedJob = raw.jobs[0];
    expect(savedJob.state.nextRunAtMs).not.toBeNull();
    expect((savedJob.state as any)._scheduleFingerprint).toBe("cron:0 0 * * *");
  });

  it("heals null nextRunAtMs even when fingerprint matches (postmortem: scheduled-jobs-never-fired)", async () => {
    const job = makeCronJob("audit", "self-audit-weekly", "0 0 * * 4", null);
    const storeData = makeStore([job]);
    (storeData.jobs[0].state as any)._scheduleFingerprint = "cron:0 0 * * 4";
    await writeFile(storePath, JSON.stringify(storeData));

    const store = new JobStore(storePath);
    await store.load();

    const loaded = store.get("audit")!;
    expect(loaded.state.nextRunAtMs).not.toBeNull();
    const expected = computeNextRunAtMs(
      { kind: "cron", expr: "0 0 * * 4" },
      Date.now(),
    );
    expect(loaded.state.nextRunAtMs).toBe(expected);
  });

  it("handles interval schedules correctly", async () => {
    const job: Job = {
      id: "interval-job",
      name: "interval-test",
      schedule: { kind: "every", everyMs: 3_600_000 },
      payload: { message: "test" },
      enabled: true,
      createdAtMs: Date.now(),
      state: {
        nextRunAtMs: null,
        lastRunAtMs: null,
        lastStatus: null,
        lastError: null,
        lastDurationMs: null,
        runCount: 0,
      },
    };
    await writeFile(storePath, JSON.stringify(makeStore([job])));

    const store = new JobStore(storePath);
    await store.load();

    const loaded = store.get("interval-job")!;
    expect(loaded.state.nextRunAtMs).not.toBeNull();
    expect((loaded.state as any)._scheduleFingerprint).toBe(
      "every:3600000",
    );
  });
});
