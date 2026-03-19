/** Tests for the burst mode CLI extension — rapid session loop. */

import { describe, it, expect, vi } from "vitest";
import { runBurst, type BurstOptions, type BurstResult, type DiagnoseOpts, type DiagnoseResult } from "./burst.js";
import type { ExecutionResult } from "./executor.js";
import type { Job } from "./types.js";

function makeJob(overrides?: Partial<Job>): Job {
  return {
    id: "test-id",
    name: "test-job",
    schedule: { kind: "cron", expr: "0 9 * * *" },
    payload: { message: "do work" },
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
    ...overrides,
  };
}

function makeResult(overrides?: Partial<ExecutionResult>): ExecutionResult {
  return {
    ok: true,
    durationMs: 60_000,
    exitCode: 0,
    stdout: "Session completed. Task: fix bug\nTask-completed: yes",
    costUsd: 2.5,
    numTurns: 50,
    ...overrides,
  };
}

// ── Stop condition: max sessions ──

describe("burst mode — max sessions", () => {
  it("stops after reaching max sessions", async () => {
    const executor = vi.fn<(job: Job) => Promise<ExecutionResult>>()
      .mockResolvedValue(makeResult());

    const result = await runBurst({
      job: makeJob(),
      maxSessions: 3,
      maxCost: 100,
      execute: executor,
    });

    expect(executor).toHaveBeenCalledTimes(3);
    expect(result.sessionsRun).toBe(3);
    expect(result.stopReason).toBe("max-sessions");
  });

  it("runs exactly 1 session when maxSessions is 1", async () => {
    const executor = vi.fn<(job: Job) => Promise<ExecutionResult>>()
      .mockResolvedValue(makeResult());

    const result = await runBurst({
      job: makeJob(),
      maxSessions: 1,
      maxCost: 100,
      execute: executor,
    });

    expect(executor).toHaveBeenCalledTimes(1);
    expect(result.sessionsRun).toBe(1);
    expect(result.stopReason).toBe("max-sessions");
  });
});

// ── Stop condition: max cost ──

describe("burst mode — max cost", () => {
  it("stops when cumulative cost exceeds max", async () => {
    const executor = vi.fn<(job: Job) => Promise<ExecutionResult>>()
      .mockResolvedValueOnce(makeResult({ costUsd: 5.0 }))
      .mockResolvedValueOnce(makeResult({ costUsd: 4.0 }))
      .mockResolvedValueOnce(makeResult({ costUsd: 3.0 }));

    const result = await runBurst({
      job: makeJob(),
      maxSessions: 10,
      maxCost: 10,
      execute: executor,
    });

    // After session 2: total = 9.0, under cap → run session 3
    // After session 3: total = 12.0, over cap → stop
    expect(executor).toHaveBeenCalledTimes(3);
    expect(result.sessionsRun).toBe(3);
    expect(result.totalCost).toBeCloseTo(12.0);
    expect(result.stopReason).toBe("max-cost");
  });

  it("handles sessions with no cost data (null costUsd)", async () => {
    const executor = vi.fn<(job: Job) => Promise<ExecutionResult>>()
      .mockResolvedValue(makeResult({ costUsd: undefined }));

    const result = await runBurst({
      job: makeJob(),
      maxSessions: 3,
      maxCost: 100,
      execute: executor,
    });

    expect(result.sessionsRun).toBe(3);
    expect(result.totalCost).toBe(0);
    expect(result.stopReason).toBe("max-sessions");
  });
});

// ── Stop condition: no actionable tasks ──

describe("burst mode — no actionable tasks", () => {
  it("stops when session stdout indicates no actionable tasks", async () => {
    const executor = vi.fn<(job: Job) => Promise<ExecutionResult>>()
      .mockResolvedValueOnce(makeResult({ stdout: "Task-completed: yes" }))
      .mockResolvedValueOnce(makeResult({ stdout: "no actionable tasks" }));

    const result = await runBurst({
      job: makeJob(),
      maxSessions: 10,
      maxCost: 100,
      execute: executor,
    });

    expect(executor).toHaveBeenCalledTimes(2);
    expect(result.sessionsRun).toBe(2);
    expect(result.stopReason).toBe("no-actionable-tasks");
  });

  it("detects variant phrasing: No actionable tasks exist", async () => {
    const executor = vi.fn<(job: Job) => Promise<ExecutionResult>>()
      .mockResolvedValueOnce(makeResult({ stdout: "No actionable tasks exist in any eligible project" }));

    const result = await runBurst({
      job: makeJob(),
      maxSessions: 10,
      maxCost: 100,
      execute: executor,
    });

    expect(result.sessionsRun).toBe(1);
    expect(result.stopReason).toBe("no-actionable-tasks");
  });
});

// ── Stop condition: session error ──

describe("burst mode — session error", () => {
  it("stops when a session fails (ok: false)", async () => {
    const executor = vi.fn<(job: Job) => Promise<ExecutionResult>>()
      .mockResolvedValueOnce(makeResult())
      .mockResolvedValueOnce(makeResult({ ok: false, error: "agent crashed" }));

    const result = await runBurst({
      job: makeJob(),
      maxSessions: 10,
      maxCost: 100,
      execute: executor,
    });

    expect(executor).toHaveBeenCalledTimes(2);
    expect(result.sessionsRun).toBe(2);
    expect(result.stopReason).toBe("error");
  });
});

// ── Result tracking ──

describe("burst mode — result tracking", () => {
  it("accumulates cost across sessions", async () => {
    const executor = vi.fn<(job: Job) => Promise<ExecutionResult>>()
      .mockResolvedValueOnce(makeResult({ costUsd: 1.5 }))
      .mockResolvedValueOnce(makeResult({ costUsd: 2.5 }))
      .mockResolvedValueOnce(makeResult({ costUsd: 3.0 }));

    const result = await runBurst({
      job: makeJob(),
      maxSessions: 3,
      maxCost: 100,
      execute: executor,
    });

    expect(result.totalCost).toBeCloseTo(7.0);
    expect(result.totalDurationMs).toBeGreaterThan(0);
    expect(result.sessionResults).toHaveLength(3);
  });

  it("records per-session results", async () => {
    const r1 = makeResult({ costUsd: 1.0, durationMs: 30_000 });
    const r2 = makeResult({ costUsd: 2.0, durationMs: 45_000 });
    const executor = vi.fn<(job: Job) => Promise<ExecutionResult>>()
      .mockResolvedValueOnce(r1)
      .mockResolvedValueOnce(r2);

    const result = await runBurst({
      job: makeJob(),
      maxSessions: 2,
      maxCost: 100,
      execute: executor,
    });

    expect(result.sessionResults[0].costUsd).toBe(1.0);
    expect(result.sessionResults[1].costUsd).toBe(2.0);
  });
});

// ── Callback hooks ──

describe("burst mode — onSessionComplete callback", () => {
  it("calls onSessionComplete after each session", async () => {
    const onSessionComplete = vi.fn();
    const executor = vi.fn<(job: Job) => Promise<ExecutionResult>>()
      .mockResolvedValue(makeResult());

    await runBurst({
      job: makeJob(),
      maxSessions: 3,
      maxCost: 100,
      execute: executor,
      onSessionComplete,
    });

    expect(onSessionComplete).toHaveBeenCalledTimes(3);
    // First call gets session number 1
    expect(onSessionComplete.mock.calls[0][0]).toBe(1);
    // Third call gets session number 3
    expect(onSessionComplete.mock.calls[2][0]).toBe(3);
  });
});

// ── Edge cases ──

describe("burst mode — edge cases", () => {
  it("handles maxSessions = 0 (runs no sessions)", async () => {
    const executor = vi.fn<(job: Job) => Promise<ExecutionResult>>();

    const result = await runBurst({
      job: makeJob(),
      maxSessions: 0,
      maxCost: 100,
      execute: executor,
    });

    expect(executor).not.toHaveBeenCalled();
    expect(result.sessionsRun).toBe(0);
    expect(result.stopReason).toBe("max-sessions");
  });

  it("handles maxCost = 0 — runs first session then stops", async () => {
    const executor = vi.fn<(job: Job) => Promise<ExecutionResult>>()
      .mockResolvedValue(makeResult({ costUsd: 0.01 }));

    const result = await runBurst({
      job: makeJob(),
      maxSessions: 10,
      maxCost: 0,
      execute: executor,
    });

    // First session always runs; then cost check triggers
    expect(result.sessionsRun).toBe(1);
    expect(result.stopReason).toBe("max-cost");
  });
});

// ── Autofix ──

function makeDiagnose(verdict: DiagnoseResult["verdict"], costUsd = 0.5): (opts: DiagnoseOpts) => Promise<DiagnoseResult> {
  return vi.fn(async () => ({
    verdict,
    summary: `Mock diagnosis: ${verdict}`,
    costUsd,
    durationMs: 15_000,
  }));
}

describe("burst mode — autofix", () => {
  it("retries session when autofix returns retry verdict", async () => {
    const executor = vi.fn<(job: Job) => Promise<ExecutionResult>>()
      .mockResolvedValueOnce(makeResult({ ok: false, error: "crash" }))
      .mockResolvedValue(makeResult()); // retry + remaining sessions succeed

    const diagnose = makeDiagnose("retry");

    const result = await runBurst({
      job: makeJob(),
      maxSessions: 2,
      maxCost: 100,
      execute: executor,
      autofix: { maxRetries: 3, diagnose, repoDir: "/tmp" },
    });

    // 1st call fails → autofix retry → 2nd call succeeds → 3rd call succeeds
    expect(executor).toHaveBeenCalledTimes(3);
    expect(diagnose).toHaveBeenCalledTimes(1);
    expect(result.stopReason).toBe("max-sessions");
    expect(result.autofixAttempts).toBe(1);
  });

  it("skips session when autofix returns skip verdict", async () => {
    const executor = vi.fn<(job: Job) => Promise<ExecutionResult>>()
      .mockResolvedValueOnce(makeResult({ ok: false, error: "crash" }))
      .mockResolvedValueOnce(makeResult()) // next session succeeds
      .mockResolvedValueOnce(makeResult());

    const diagnose = makeDiagnose("skip");

    const result = await runBurst({
      job: makeJob(),
      maxSessions: 3,
      maxCost: 100,
      execute: executor,
      autofix: { maxRetries: 3, diagnose, repoDir: "/tmp" },
    });

    // 3 sessions total: first fails+skip, second and third succeed
    expect(executor).toHaveBeenCalledTimes(3);
    expect(result.sessionsRun).toBe(3);
    expect(result.stopReason).toBe("max-sessions");
  });

  it("stops burst when autofix returns stop verdict", async () => {
    const executor = vi.fn<(job: Job) => Promise<ExecutionResult>>()
      .mockResolvedValueOnce(makeResult({ ok: false, error: "systemic" }));

    const diagnose = makeDiagnose("stop");

    const result = await runBurst({
      job: makeJob(),
      maxSessions: 10,
      maxCost: 100,
      execute: executor,
      autofix: { maxRetries: 3, diagnose, repoDir: "/tmp" },
    });

    expect(executor).toHaveBeenCalledTimes(1);
    expect(diagnose).toHaveBeenCalledTimes(1);
    expect(result.stopReason).toBe("error");
  });

  it("stops with autofix-exhausted after max retries", async () => {
    // Executor always fails
    const executor = vi.fn<(job: Job) => Promise<ExecutionResult>>()
      .mockResolvedValue(makeResult({ ok: false, error: "persistent" }));

    // Diagnose always says retry
    const diagnose = makeDiagnose("retry");

    const result = await runBurst({
      job: makeJob(),
      maxSessions: 10,
      maxCost: 100,
      execute: executor,
      autofix: { maxRetries: 2, diagnose, repoDir: "/tmp" },
    });

    // First session fails → autofix retry (attempt 1) → second session fails →
    // autofix retry (attempt 2) → third session fails → maxRetries reached → stop
    expect(diagnose).toHaveBeenCalledTimes(2);
    expect(result.stopReason).toBe("autofix-exhausted");
    expect(result.autofixAttempts).toBe(2);
  });

  it("counts autofix cost toward burst totalCost", async () => {
    const executor = vi.fn<(job: Job) => Promise<ExecutionResult>>()
      .mockResolvedValueOnce(makeResult({ ok: false, error: "crash", costUsd: 2.0 }))
      .mockResolvedValue(makeResult({ costUsd: 3.0 }));

    const diagnose = makeDiagnose("retry", 1.0);

    const result = await runBurst({
      job: makeJob(),
      maxSessions: 1,
      maxCost: 100,
      execute: executor,
      autofix: { maxRetries: 3, diagnose, repoDir: "/tmp" },
    });

    // 2.0 (failed) + 1.0 (autofix) + 3.0 (retry success) = 6.0
    expect(result.totalCost).toBeCloseTo(6.0);
  });

  it("preserves error stop when autofix not configured", async () => {
    const executor = vi.fn<(job: Job) => Promise<ExecutionResult>>()
      .mockResolvedValueOnce(makeResult({ ok: false, error: "crash" }));

    const result = await runBurst({
      job: makeJob(),
      maxSessions: 10,
      maxCost: 100,
      execute: executor,
    });

    expect(result.stopReason).toBe("error");
    expect(result.autofixAttempts).toBe(0);
  });

  it("calls onAutofix callback after each autofix attempt", async () => {
    const executor = vi.fn<(job: Job) => Promise<ExecutionResult>>()
      .mockResolvedValueOnce(makeResult({ ok: false, error: "crash" }))
      .mockResolvedValue(makeResult());

    const diagnose = makeDiagnose("retry");
    const onAutofix = vi.fn();

    await runBurst({
      job: makeJob(),
      maxSessions: 2,
      maxCost: 100,
      execute: executor,
      autofix: { maxRetries: 3, diagnose, repoDir: "/tmp" },
      onAutofix,
    });

    expect(onAutofix).toHaveBeenCalledTimes(1);
    expect(onAutofix.mock.calls[0][0]).toBe(1); // attempt number
    expect(onAutofix.mock.calls[0][1].verdict).toBe("retry");
  });

  it("includes autofix duration in totalDurationMs", async () => {
    const executor = vi.fn<(job: Job) => Promise<ExecutionResult>>()
      .mockResolvedValueOnce(makeResult({ ok: false, error: "crash", durationMs: 10_000 }))
      .mockResolvedValue(makeResult({ durationMs: 20_000 }));

    const diagnose = vi.fn(async () => ({
      verdict: "retry" as const,
      summary: "Fixed",
      costUsd: 0,
      durationMs: 5_000,
    }));

    const result = await runBurst({
      job: makeJob(),
      maxSessions: 1,
      maxCost: 100,
      execute: executor,
      autofix: { maxRetries: 3, diagnose, repoDir: "/tmp" },
    });

    // 10_000 (failed) + 5_000 (autofix) + 20_000 (retry success) = 35_000
    expect(result.totalDurationMs).toBe(35_000);
  });
});
