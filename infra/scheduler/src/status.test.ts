/** Tests for the unified status dashboard — combines sessions, experiments, and jobs. */

import { describe, it, expect } from "vitest";
import {
  getUnifiedStatus,
  formatUnifiedStatus,
  type UnifiedStatus,
  type StatusSession,
  type StatusExperiment,
  type StatusJob,
} from "./status.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeSession(overrides?: Partial<StatusSession>): StatusSession {
  return {
    id: "work-session-abc123",
    jobName: "youji-work-cycle",
    startedAtMs: Date.now() - 300_000, // 5 min ago
    elapsedMs: 300_000,
    costUsd: 2.5,
    numTurns: 42,
    lastActivity: "Reading project README",
    ...overrides,
  };
}

function makeExperiment(overrides?: Partial<StatusExperiment>): StatusExperiment {
  return {
    project: "sample-project",
    id: "phase-a-full-scale",
    status: "running",
    startedAt: new Date(Date.now() - 600_000).toISOString(),
    elapsedMs: 600_000,
    progress: 45,
    message: "Processing evaluations",
    ...overrides,
  };
}

function makeJob(overrides?: Partial<StatusJob>): StatusJob {
  return {
    id: "job-1",
    name: "youji-work-cycle",
    enabled: true,
    schedule: "0 */1 * * *",
    nextRunAtMs: Date.now() + 3600_000,
    lastStatus: "ok",
    lastRunAtMs: Date.now() - 3600_000,
    runCount: 15,
    ...overrides,
  };
}

// ── getUnifiedStatus ──

describe("getUnifiedStatus", () => {
  it("returns combined status from all sources", () => {
    const sessions = [makeSession()];
    const experiments = [makeExperiment()];
    const jobs = [makeJob()];

    const status = getUnifiedStatus({ sessions, experiments, jobs });

    expect(status.sessions).toHaveLength(1);
    expect(status.experiments).toHaveLength(1);
    expect(status.jobs).toHaveLength(1);
    expect(status.timestamp).toBeDefined();
  });

  it("returns empty arrays when nothing is active", () => {
    const status = getUnifiedStatus({ sessions: [], experiments: [], jobs: [] });

    expect(status.sessions).toHaveLength(0);
    expect(status.experiments).toHaveLength(0);
    expect(status.jobs).toHaveLength(0);
  });

  it("filters experiments to only running/retrying/stopping", () => {
    const experiments = [
      makeExperiment({ status: "running" }),
      makeExperiment({ id: "exp-completed", status: "completed" }),
      makeExperiment({ id: "exp-failed", status: "failed" }),
      makeExperiment({ id: "exp-retrying", status: "retrying" }),
      makeExperiment({ id: "exp-stopping", status: "stopping" }),
    ];

    const status = getUnifiedStatus({ sessions: [], experiments, jobs: [] });

    expect(status.experiments).toHaveLength(3); // running, retrying, stopping
    expect(status.experiments.map((e) => e.id)).toEqual(
      expect.arrayContaining(["phase-a-full-scale", "exp-retrying", "exp-stopping"]),
    );
  });

  it("includes summary counts", () => {
    const sessions = [makeSession(), makeSession({ id: "session-2" })];
    const experiments = [makeExperiment()];
    const jobs = [makeJob(), makeJob({ id: "job-2", name: "other-job", enabled: false })];

    const status = getUnifiedStatus({ sessions, experiments, jobs });

    expect(status.summary.activeSessions).toBe(2);
    expect(status.summary.runningExperiments).toBe(1);
    expect(status.summary.totalJobs).toBe(2);
    expect(status.summary.enabledJobs).toBe(1);
  });
});

// ── formatUnifiedStatus ──

describe("formatUnifiedStatus", () => {
  it("formats status with sessions and experiments", () => {
    const status: UnifiedStatus = {
      timestamp: new Date().toISOString(),
      summary: { activeSessions: 1, runningExperiments: 1, totalJobs: 2, enabledJobs: 1 },
      sessions: [makeSession()],
      experiments: [makeExperiment()],
      jobs: [makeJob()],
    };

    const output = formatUnifiedStatus(status);

    expect(output).toContain("Active Sessions: 1");
    expect(output).toContain("Running Experiments: 1");
    expect(output).toContain("youji-work-cycle");
    expect(output).toContain("sample-project/phase-a-full-scale");
  });

  it("shows no-activity message when nothing is running", () => {
    const status: UnifiedStatus = {
      timestamp: new Date().toISOString(),
      summary: { activeSessions: 0, runningExperiments: 0, totalJobs: 1, enabledJobs: 1 },
      sessions: [],
      experiments: [],
      jobs: [makeJob()],
    };

    const output = formatUnifiedStatus(status);

    expect(output).toContain("Active Sessions: 0");
    expect(output).toContain("Running Experiments: 0");
  });

  it("formats session elapsed time in human-readable form", () => {
    const status: UnifiedStatus = {
      timestamp: new Date().toISOString(),
      summary: { activeSessions: 1, runningExperiments: 0, totalJobs: 0, enabledJobs: 0 },
      sessions: [makeSession({ elapsedMs: 3_723_000 })], // 1h 2m 3s
      experiments: [],
      jobs: [],
    };

    const output = formatUnifiedStatus(status);

    expect(output).toContain("1h 2m");
  });

  it("formats experiment progress percentage", () => {
    const status: UnifiedStatus = {
      timestamp: new Date().toISOString(),
      summary: { activeSessions: 0, runningExperiments: 1, totalJobs: 0, enabledJobs: 0 },
      sessions: [],
      experiments: [makeExperiment({ progress: 72, message: "Evaluating models" })],
      jobs: [],
    };

    const output = formatUnifiedStatus(status);

    expect(output).toContain("72%");
    expect(output).toContain("Evaluating models");
  });

  it("includes cost information for sessions", () => {
    const status: UnifiedStatus = {
      timestamp: new Date().toISOString(),
      summary: { activeSessions: 1, runningExperiments: 0, totalJobs: 0, enabledJobs: 0 },
      sessions: [makeSession({ costUsd: 3.75, numTurns: 55 })],
      experiments: [],
      jobs: [],
    };

    const output = formatUnifiedStatus(status);

    expect(output).toContain("$3.75");
    expect(output).toContain("55 turns");
  });

  it("includes job schedule and next run", () => {
    const nextRun = Date.now() + 1800_000; // 30 min from now
    const status: UnifiedStatus = {
      timestamp: new Date().toISOString(),
      summary: { activeSessions: 0, runningExperiments: 0, totalJobs: 1, enabledJobs: 1 },
      sessions: [],
      experiments: [],
      jobs: [makeJob({ nextRunAtMs: nextRun, schedule: "0 */1 * * *" })],
    };

    const output = formatUnifiedStatus(status);

    expect(output).toContain("youji-work-cycle");
    expect(output).toContain("0 */1 * * *");
  });

  it("handles experiments without progress or message", () => {
    const status: UnifiedStatus = {
      timestamp: new Date().toISOString(),
      summary: { activeSessions: 0, runningExperiments: 1, totalJobs: 0, enabledJobs: 0 },
      sessions: [],
      experiments: [makeExperiment({ progress: undefined, message: undefined })],
      jobs: [],
    };

    const output = formatUnifiedStatus(status);

    expect(output).toContain("sample-project/phase-a-full-scale");
    // Should not crash
    expect(output).toBeDefined();
  });
});
