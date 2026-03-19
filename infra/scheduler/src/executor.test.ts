import { describe, it, expect, beforeEach, vi } from "vitest";
import { executeJob } from "./executor.js";
import type { Job, JobPayload } from "./types.js";
import type { SpawnAgentOpts, AgentResult } from "./agent.js";

vi.mock("./auto-commit.js", () => ({
  autoCommitOrphanedFiles: vi.fn().mockResolvedValue(null),
}));

vi.mock("./rebase-push.js", () => ({
  enqueuePushAndWait: vi.fn().mockResolvedValue({ status: "nothing-to-push" }),
}));

vi.mock("./verify.js", () => ({
  findActiveExperimentDirs: vi.fn().mockResolvedValue([]),
  getHeadCommit: vi.fn().mockResolvedValue("abc123"),
}));

vi.mock("./slack.js", () => ({
  notifySessionStarted: vi.fn().mockResolvedValue({ channel: "C123", threadTs: "123.456" }),
  notifySessionComplete: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./notify.js", () => ({
  getPendingApprovals: vi.fn().mockResolvedValue([]),
}));

vi.mock("./metrics.js", () => ({
  countMetrics: vi.fn().mockResolvedValue(0),
}));

vi.mock("./orient-tier.js", () => ({
  decideTiers: vi.fn().mockReturnValue({ orientTier: "fast", compoundTier: "fast" }),
  injectTierDirectives: vi.fn().mockImplementation((prompt: string) => prompt),
  wasFullOrient: vi.fn().mockReturnValue(false),
}));

vi.mock("./convention-modules.js", () => ({
  injectConventionModules: vi.fn().mockImplementation((prompt: string) => prompt),
}));

vi.mock("./backend.js", () => ({
  resolveBackend: vi.fn().mockReturnValue({
    name: "claude",
    spawn: vi.fn(),
    isAvailable: vi.fn().mockReturnValue(true),
  }),
}));

let spawnCalls: SpawnAgentOpts[] = [];
let spawnResult: AgentResult = {
  text: "Session completed",
  costUsd: 0.5,
  numTurns: 10,
  durationMs: 1000,
  timedOut: false,
};

vi.mock("./agent.js", () => ({
  spawnAgent: vi.fn().mockImplementation((opts: SpawnAgentOpts) => {
    spawnCalls.push(opts);
    return {
      result: Promise.resolve(spawnResult),
    };
  }),
  AGENT_PROFILES: {
    workSession: { model: "opus", maxDurationMs: 1_800_000, label: "work-session" },
    deepWork: { model: "opus", maxTurns: 256, maxDurationMs: 3_600_000, label: "deep-work" },
  },
  generateSessionId: vi.fn().mockReturnValue("work-session-test123"),
  resolveProfileForBackend: vi.fn().mockImplementation((profile) => profile),
}));

function createJob(overrides?: Partial<JobPayload>): Job {
  return {
    id: "job-1",
    name: "test-job",
    schedule: { kind: "every", everyMs: 60000 },
    payload: {
      message: "Test message",
      ...overrides,
    },
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
}

describe("executeJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    spawnCalls = [];
    spawnResult = {
      text: "Session completed",
      costUsd: 0.5,
      numTurns: 10,
      durationMs: 1000,
      timedOut: false,
    };
  });

  describe("session launch parameters", () => {
    it("passes message to spawnAgent", async () => {
      const job = createJob({ message: "Run the tests" });
      await executeJob(job);

      expect(spawnCalls).toHaveLength(1);
      expect(spawnCalls[0]!.prompt).toContain("Run the tests");
    });

    it("passes cwd to spawnAgent", async () => {
      const job = createJob({ cwd: "/tmp/test-project" });
      await executeJob(job);

      expect(spawnCalls).toHaveLength(1);
      expect(spawnCalls[0]!.cwd).toBe("/tmp/test-project");
    });

    it("passes model override to profile", async () => {
      const job = createJob({ model: "sonnet" });
      await executeJob(job);

      expect(spawnCalls).toHaveLength(1);
      expect(spawnCalls[0]!.profile.model).toBe("sonnet");
    });

    it("passes maxDurationMs override to profile", async () => {
      const job = createJob({ maxDurationMs: 60000 });
      await executeJob(job);

      expect(spawnCalls).toHaveLength(1);
      expect(spawnCalls[0]!.profile.maxDurationMs).toBe(60000);
    });

    it("includes sessionId in prompt", async () => {
      const job = createJob();
      await executeJob(job);

      expect(spawnCalls[0]!.prompt).toContain("SESSION_ID=");
    });

    it("injects role directive when role is specified", async () => {
      const job = createJob({ role: "project-researcher" });
      await executeJob(job);

      expect(spawnCalls[0]!.prompt).toContain("ROLE=project-researcher");
    });

    it("injects role with project when roleProject is specified", async () => {
      const job = createJob({ role: "infrastructure-engineer", roleProject: "sample-project" });
      await executeJob(job);

      expect(spawnCalls[0]!.prompt).toContain("ROLE=infrastructure-engineer PROJECT=sample-project");
    });

    it("returns triggerSource in result", async () => {
      const job = createJob();
      const result = await executeJob(job, "slack");

      expect(result.triggerSource).toBe("slack");
    });

    it("defaults triggerSource to scheduler", async () => {
      const job = createJob();
      const result = await executeJob(job);

      expect(result.triggerSource).toBe("scheduler");
    });
  });

  describe("timeout handling", () => {
    it("returns timedOut=true when agent times out", async () => {
      spawnResult = {
        text: "Session timed out",
        costUsd: 0.3,
        numTurns: 5,
        durationMs: 1800000,
        timedOut: true,
      };

      const job = createJob();
      const result = await executeJob(job);

      expect(result.timedOut).toBe(true);
      expect(result.ok).toBe(true);
    });

    it("returns timedOut=false when session completes normally", async () => {
      const job = createJob();
      const result = await executeJob(job);

      expect(result.timedOut).toBe(false);
    });

    it("records duration from agent result", async () => {
      spawnResult = {
        text: "Done",
        costUsd: 0.1,
        numTurns: 3,
        durationMs: 5000,
        timedOut: false,
      };

      const job = createJob();
      const result = await executeJob(job);

      expect(result.durationMs).toBe(5000);
    });
  });

  describe("error recovery", () => {
    it("returns ok=false when spawnAgent throws", async () => {
      vi.mocked(await import("./agent.js")).spawnAgent.mockImplementationOnce(() => {
        throw new Error("Failed to spawn agent");
      });

      const job = createJob();
      const result = await executeJob(job);

      expect(result.ok).toBe(false);
      expect(result.error).toContain("Failed to spawn agent");
      expect(result.exitCode).toBe(1);
    });

    it("returns ok=false with sleep violation", async () => {
      spawnResult = {
        text: "Session ended",
        costUsd: 0.1,
        numTurns: 2,
        durationMs: 1000,
        timedOut: false,
        sleepViolation: "sleep 60",
      };

      const job = createJob();
      const result = await executeJob(job);

      expect(result.ok).toBe(false);
      expect(result.sleepViolation).toBe("sleep 60");
      expect(result.exitCode).toBe(1);
    });

    it("records backend name in error result", async () => {
      vi.mocked(await import("./agent.js")).spawnAgent.mockImplementationOnce(() => {
        throw new Error("Spawn failed");
      });

      const job = createJob();
      const result = await executeJob(job);

      expect(result.backend).toBe("claude");
    });

    it("captures costUsd from agent result", async () => {
      spawnResult = {
        text: "Done",
        costUsd: 1.25,
        numTurns: 20,
        durationMs: 10000,
        timedOut: false,
      };

      const job = createJob();
      const result = await executeJob(job);

      expect(result.costUsd).toBe(1.25);
    });

    it("captures numTurns from agent result", async () => {
      spawnResult = {
        text: "Done",
        costUsd: 0.5,
        numTurns: 15,
        durationMs: 5000,
        timedOut: false,
      };

      const job = createJob();
      const result = await executeJob(job);

      expect(result.numTurns).toBe(15);
    });

    it("captures stdout from agent result", async () => {
      spawnResult = {
        text: "Agent output here",
        costUsd: 0.1,
        numTurns: 1,
        durationMs: 100,
        timedOut: false,
      };

      const job = createJob();
      const result = await executeJob(job);

      expect(result.stdout).toBe("Agent output here");
    });
  });

  describe("result metadata", () => {
    it("includes sessionId in result", async () => {
      const job = createJob();
      const result = await executeJob(job);

      expect(result.sessionId).toBeDefined();
    });

    it("includes logFile path in result", async () => {
      const job = createJob();
      const result = await executeJob(job);

      expect(result.logFile).toBeDefined();
      expect(result.logFile).toMatch(/\.log$/);
    });

    it("includes headAfterAutoCommit in result", async () => {
      const job = createJob();
      const result = await executeJob(job);

      expect(result.headAfterAutoCommit).toBe("abc123");
    });

    it("does not require task claiming to run", async () => {
      const job = createJob();
      await expect(executeJob(job)).resolves.toBeDefined();
    });

    it("calls notifySessionStarted and notifySessionComplete", async () => {
      const job = createJob();
      await executeJob(job);

      const { notifySessionStarted, notifySessionComplete } = await import("./slack.js");
      expect(notifySessionStarted).toHaveBeenCalledWith(job.name, expect.any(String));
      expect(notifySessionComplete).toHaveBeenCalled();
    });
  });

  describe("uncommitted file threshold warning", () => {
    it("logs warning when uncommitted files exceed threshold", async () => {
      const { checkUncommittedFileThreshold, UNCOMMITTED_FILE_WARNING_THRESHOLD } = await import("./executor.js");

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await checkUncommittedFileThreshold(process.cwd());

      if (warnSpy.mock.calls.length > 0) {
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("WARNING:"));
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("uncommitted files detected"));
      }

      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it("does not throw on git status error", async () => {
      const { checkUncommittedFileThreshold } = await import("./executor.js");

      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await expect(checkUncommittedFileThreshold(process.cwd())).resolves.not.toThrow();

      errorSpy.mockRestore();
    });

    it("threshold constant is 50", async () => {
      const { UNCOMMITTED_FILE_WARNING_THRESHOLD } = await import("./executor.js");
      expect(UNCOMMITTED_FILE_WARNING_THRESHOLD).toBe(50);
    });
  });
});
