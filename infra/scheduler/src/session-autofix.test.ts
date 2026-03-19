/** Tests for session autofix — diagnostic agent for failed burst sessions. */

import { describe, it, expect, vi } from "vitest";
import type { ExecutionResult } from "./executor.js";
import type { Job } from "./types.js";

// We'll mock spawnAgent before importing the module under test
vi.mock("./agent.js", () => ({
  spawnAgent: vi.fn(),
  AGENT_PROFILES: {
    autofix: { model: "opus", maxTurns: 32, maxDurationMs: 600_000, label: "autofix" },
  },
}));

import { buildSessionDiagnosticPrompt, diagnoseSession, type SessionFixVerdict } from "./session-autofix.js";
import { spawnAgent } from "./agent.js";

function makeJob(overrides?: Partial<Job>): Job {
  return {
    id: "test-id",
    name: "test-job",
    schedule: { kind: "cron", expr: "0 9 * * *" },
    payload: { message: "Run /orient and do autonomous work" },
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
    ok: false,
    durationMs: 60_000,
    exitCode: 1,
    stdout: "Some agent output before the crash happened",
    error: "Agent process exited with code 1",
    ...overrides,
  };
}

// ── buildSessionDiagnosticPrompt ──

describe("buildSessionDiagnosticPrompt", () => {
  it("includes error message in prompt", () => {
    const prompt = buildSessionDiagnosticPrompt({
      job: makeJob(),
      result: makeResult({ error: "SIGKILL received" }),
      sessionNumber: 2,
      attempt: 1,
      maxAttempts: 3,
      repoDir: "/home/user/youji",
    });
    expect(prompt).toContain("SIGKILL received");
  });

  it("includes stdout tail in prompt", () => {
    const prompt = buildSessionDiagnosticPrompt({
      job: makeJob(),
      result: makeResult({ stdout: "line1\nline2\nline3" }),
      sessionNumber: 1,
      attempt: 1,
      maxAttempts: 3,
      repoDir: "/tmp",
    });
    expect(prompt).toContain("line1");
    expect(prompt).toContain("line3");
  });

  it("truncates stdout to 3000 chars", () => {
    const longOutput = "x".repeat(5000);
    const prompt = buildSessionDiagnosticPrompt({
      job: makeJob(),
      result: makeResult({ stdout: longOutput }),
      sessionNumber: 1,
      attempt: 1,
      maxAttempts: 3,
      repoDir: "/tmp",
    });
    // The prompt should not contain all 5000 chars of stdout
    const stdoutSection = prompt.match(/## Session output[\s\S]*?```([\s\S]*?)```/);
    expect(stdoutSection).not.toBeNull();
    expect(stdoutSection![1].length).toBeLessThanOrEqual(3100); // 3000 + minor formatting
  });

  it("includes session number and attempt count", () => {
    const prompt = buildSessionDiagnosticPrompt({
      job: makeJob(),
      result: makeResult(),
      sessionNumber: 5,
      attempt: 2,
      maxAttempts: 3,
      repoDir: "/tmp",
    });
    expect(prompt).toContain("5");
    expect(prompt).toContain("2");
    expect(prompt).toContain("3");
  });

  it("includes job name and prompt excerpt", () => {
    const prompt = buildSessionDiagnosticPrompt({
      job: makeJob({ name: "youji-work-cycle", payload: { message: "Do the thing with the stuff" } }),
      result: makeResult(),
      sessionNumber: 1,
      attempt: 1,
      maxAttempts: 3,
      repoDir: "/tmp",
    });
    expect(prompt).toContain("youji-work-cycle");
    expect(prompt).toContain("Do the thing with the stuff");
  });

  it("notes timeout when result.timedOut is true", () => {
    const prompt = buildSessionDiagnosticPrompt({
      job: makeJob(),
      result: makeResult({ timedOut: true }),
      sessionNumber: 1,
      attempt: 1,
      maxAttempts: 3,
      repoDir: "/tmp",
    });
    expect(prompt).toMatch(/timed?\s*out/i);
  });

  it("instructs conservatism on final attempt", () => {
    const prompt = buildSessionDiagnosticPrompt({
      job: makeJob(),
      result: makeResult(),
      sessionNumber: 1,
      attempt: 3,
      maxAttempts: 3,
      repoDir: "/tmp",
    });
    expect(prompt).toMatch(/conservat|final|last/i);
  });
});

// ── diagnoseSession ──

describe("diagnoseSession", () => {
  const mockedSpawnAgent = vi.mocked(spawnAgent);

  function mockAgentResult(text: string) {
    mockedSpawnAgent.mockReturnValue({
      sessionId: "autofix-test-123",
      handle: { interrupt: vi.fn(), backend: "claude" as const },
      result: Promise.resolve({
        text,
        costUsd: 0.42,
        numTurns: 5,
        durationMs: 30_000,
        timedOut: false,
      }),
    });
  }

  it("returns retry verdict when agent emits [SESSIONFIX:retry]", async () => {
    mockAgentResult("## Diagnosis\nGit was in a broken state.\n## Action\nRan git reset.\n[SESSIONFIX:retry]");

    const result = await diagnoseSession({
      job: makeJob(),
      result: makeResult(),
      sessionNumber: 1,
      attempt: 1,
      maxAttempts: 3,
      repoDir: "/tmp",
    });

    expect(result.verdict).toBe("retry");
  });

  it("returns skip verdict when agent emits [SESSIONFIX:skip]", async () => {
    mockAgentResult("## Diagnosis\nTask-specific issue.\n## Action\nNone needed.\n[SESSIONFIX:skip]");

    const result = await diagnoseSession({
      job: makeJob(),
      result: makeResult(),
      sessionNumber: 1,
      attempt: 1,
      maxAttempts: 3,
      repoDir: "/tmp",
    });

    expect(result.verdict).toBe("skip");
  });

  it("returns stop verdict when agent emits [SESSIONFIX:stop]", async () => {
    mockAgentResult("## Diagnosis\nSystemic issue.\n## Action\nHuman needed.\n[SESSIONFIX:stop]");

    const result = await diagnoseSession({
      job: makeJob(),
      result: makeResult(),
      sessionNumber: 1,
      attempt: 1,
      maxAttempts: 3,
      repoDir: "/tmp",
    });

    expect(result.verdict).toBe("stop");
  });

  it("defaults to stop when no verdict tag present", async () => {
    mockAgentResult("I looked at the error but could not determine the cause.");

    const result = await diagnoseSession({
      job: makeJob(),
      result: makeResult(),
      sessionNumber: 1,
      attempt: 1,
      maxAttempts: 3,
      repoDir: "/tmp",
    });

    expect(result.verdict).toBe("stop");
  });

  it("includes cost and duration from agent result", async () => {
    mockAgentResult("[SESSIONFIX:retry]");

    const result = await diagnoseSession({
      job: makeJob(),
      result: makeResult(),
      sessionNumber: 1,
      attempt: 1,
      maxAttempts: 3,
      repoDir: "/tmp",
    });

    expect(result.costUsd).toBeCloseTo(0.42);
    expect(result.durationMs).toBe(30_000);
  });

  it("extracts summary from Diagnosis section", async () => {
    mockAgentResult("## Diagnosis\nThe API key was expired.\n## Action\nRotated the key.\n[SESSIONFIX:retry]");

    const result = await diagnoseSession({
      job: makeJob(),
      result: makeResult(),
      sessionNumber: 1,
      attempt: 1,
      maxAttempts: 3,
      repoDir: "/tmp",
    });

    expect(result.summary).toContain("API key was expired");
  });

  it("uses fallback summary when no Diagnosis section", async () => {
    mockAgentResult("Something went wrong and I fixed it.\n[SESSIONFIX:retry]");

    const result = await diagnoseSession({
      job: makeJob(),
      result: makeResult(),
      sessionNumber: 1,
      attempt: 1,
      maxAttempts: 3,
      repoDir: "/tmp",
    });

    expect(result.summary.length).toBeGreaterThan(0);
  });

  it("returns stop verdict when agent throws", async () => {
    mockedSpawnAgent.mockReturnValue({
      sessionId: "autofix-err-123",
      handle: { interrupt: vi.fn(), backend: "claude" as const },
      result: Promise.reject(new Error("SDK crashed")),
    });

    const result = await diagnoseSession({
      job: makeJob(),
      result: makeResult(),
      sessionNumber: 1,
      attempt: 1,
      maxAttempts: 3,
      repoDir: "/tmp",
    });

    expect(result.verdict).toBe("stop");
    expect(result.summary).toContain("SDK crashed");
  });
});
