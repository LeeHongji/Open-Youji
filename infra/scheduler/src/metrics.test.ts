/** Tests for modelUsage, toolCounts, orientTurns, tail-read, and countMetrics. */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordMetrics, readMetrics, countMetrics, fleetResultToMetrics, type SessionMetrics } from "./metrics.js";
import type { FleetWorkerResult } from "./types.js";

/** Build a minimal SessionMetrics with sensible defaults, overridable per-field. */
function session(overrides: Partial<SessionMetrics> = {}): SessionMetrics {
  return {
    timestamp: "2026-02-20T00:00:00Z",
    jobName: "test-job",
    runId: "test-1",
    backend: "claude",
    durationMs: 300_000,
    costUsd: 2.0,
    numTurns: 40,
    timedOut: false,
    ok: true,
    verification: null,
    knowledge: null,
    budgetGate: null,
    modelUsage: null,
    toolCounts: null,
    orientTurns: null,
    crossProject: null,
    qualityAudit: null,
    ...overrides,
  };
}

describe("SessionMetrics modelUsage", () => {
  let tmpDir: string;
  let metricsPath: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `metrics-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    metricsPath = join(tmpDir, "sessions.jsonl");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("stores modelUsage when present", async () => {
    const usage = {
      "claude-opus-4-6": { inputTokens: 50000, outputTokens: 12000, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 1.5 },
      "claude-haiku-4-5-20251001": { inputTokens: 8000, outputTokens: 2000, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.02 },
    };
    const metrics = session({ modelUsage: usage });
    await recordMetrics(metrics, metricsPath);

    const raw = await readFile(metricsPath, "utf-8");
    const parsed = JSON.parse(raw.trim());
    expect(parsed.modelUsage).toEqual(usage);
  });

  it("stores null modelUsage when not provided", async () => {
    const metrics = session({ modelUsage: null });
    await recordMetrics(metrics, metricsPath);

    const raw = await readFile(metricsPath, "utf-8");
    const parsed = JSON.parse(raw.trim());
    expect(parsed.modelUsage).toBeNull();
  });

  it("roundtrips modelUsage through readMetrics", async () => {
    const usage = {
      "claude-opus-4-6": { inputTokens: 100000, outputTokens: 25000, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 3.2 },
    };
    await recordMetrics(session({ modelUsage: usage }), metricsPath);
    await recordMetrics(session({ modelUsage: null, runId: "test-2" }), metricsPath);

    const records = await readMetrics({ metricsPath });
    expect(records).toHaveLength(2);
    expect(records[0].modelUsage).toEqual(usage);
    expect(records[1].modelUsage).toBeNull();
  });

  it("stores cache metrics (cacheReadInputTokens, cacheCreationInputTokens) when present", async () => {
    const usage = {
      "claude-opus-4-6": {
        inputTokens: 50000,
        outputTokens: 12000,
        cacheReadInputTokens: 42000,
        cacheCreationInputTokens: 8000,
        costUSD: 1.5,
      },
    };
    const metrics = session({ modelUsage: usage });
    await recordMetrics(metrics, metricsPath);

    const raw = await readFile(metricsPath, "utf-8");
    const parsed = JSON.parse(raw.trim());
    expect(parsed.modelUsage["claude-opus-4-6"].cacheReadInputTokens).toBe(42000);
    expect(parsed.modelUsage["claude-opus-4-6"].cacheCreationInputTokens).toBe(8000);
  });

  it("roundtrips cache metrics through readMetrics", async () => {
    const usage = {
      "claude-opus-4-6": {
        inputTokens: 100000,
        outputTokens: 25000,
        cacheReadInputTokens: 85000,
        cacheCreationInputTokens: 15000,
        costUSD: 3.2,
      },
      "claude-haiku-4-5-20251001": {
        inputTokens: 8000,
        outputTokens: 2000,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        costUSD: 0.02,
      },
    };
    await recordMetrics(session({ modelUsage: usage }), metricsPath);

    const records = await readMetrics({ metricsPath });
    expect(records).toHaveLength(1);
    expect(records[0].modelUsage).toEqual(usage);
    expect(records[0].modelUsage!["claude-opus-4-6"].cacheReadInputTokens).toBe(85000);
    expect(records[0].modelUsage!["claude-haiku-4-5-20251001"].cacheCreationInputTokens).toBe(0);
  });
});

describe("SessionMetrics toolCounts", () => {
  let tmpDir: string;
  let metricsPath: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `metrics-toolcounts-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    metricsPath = join(tmpDir, "sessions.jsonl");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("stores toolCounts when present", async () => {
    const toolCounts = { Read: 15, Grep: 8, Bash: 5, Edit: 3, Write: 1, Glob: 4 };
    const metrics = session({ toolCounts });
    await recordMetrics(metrics, metricsPath);

    const raw = await readFile(metricsPath, "utf-8");
    const parsed = JSON.parse(raw.trim());
    expect(parsed.toolCounts).toEqual(toolCounts);
  });

  it("stores null toolCounts when not provided", async () => {
    const metrics = session({ toolCounts: null });
    await recordMetrics(metrics, metricsPath);

    const raw = await readFile(metricsPath, "utf-8");
    const parsed = JSON.parse(raw.trim());
    expect(parsed.toolCounts).toBeNull();
  });

  it("roundtrips toolCounts through readMetrics", async () => {
    const toolCounts = { Read: 20, Bash: 10, Task: 2 };
    await recordMetrics(session({ toolCounts }), metricsPath);
    await recordMetrics(session({ toolCounts: null, runId: "test-2" }), metricsPath);

    const records = await readMetrics({ metricsPath });
    expect(records).toHaveLength(2);
    expect(records[0].toolCounts).toEqual(toolCounts);
    expect(records[1].toolCounts).toBeNull();
  });

  it("handles empty toolCounts record", async () => {
    const toolCounts = {};
    const metrics = session({ toolCounts });
    await recordMetrics(metrics, metricsPath);

    const records = await readMetrics({ metricsPath });
    expect(records[0].toolCounts).toEqual({});
  });
});

describe("SessionMetrics orientTurns", () => {
  let tmpDir: string;
  let metricsPath: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `metrics-orient-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    metricsPath = join(tmpDir, "sessions.jsonl");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("stores orientTurns when present", async () => {
    const metrics = session({ orientTurns: 7 });
    await recordMetrics(metrics, metricsPath);

    const raw = await readFile(metricsPath, "utf-8");
    const parsed = JSON.parse(raw.trim());
    expect(parsed.orientTurns).toBe(7);
  });

  it("stores null orientTurns when orient was not detected", async () => {
    const metrics = session({ orientTurns: null });
    await recordMetrics(metrics, metricsPath);

    const raw = await readFile(metricsPath, "utf-8");
    const parsed = JSON.parse(raw.trim());
    expect(parsed.orientTurns).toBeNull();
  });

  it("roundtrips orientTurns through readMetrics", async () => {
    await recordMetrics(session({ orientTurns: 5 }), metricsPath);
    await recordMetrics(session({ orientTurns: null, runId: "test-2" }), metricsPath);

    const records = await readMetrics({ metricsPath });
    expect(records).toHaveLength(2);
    expect(records[0].orientTurns).toBe(5);
    expect(records[1].orientTurns).toBeNull();
  });
});

// ── Tail-read and countMetrics tests ────────────────────────────────────────

describe("readMetrics tail-read optimization", () => {
  let tmpDir: string;
  let metricsPath: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `metrics-tail-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    metricsPath = join(tmpDir, "sessions.jsonl");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns last N records when limit is set", async () => {
    for (let i = 0; i < 20; i++) {
      await recordMetrics(session({ runId: `run-${i}`, costUsd: i }), metricsPath);
    }

    const last5 = await readMetrics({ limit: 5, metricsPath });
    expect(last5).toHaveLength(5);
    expect(last5[0].runId).toBe("run-15");
    expect(last5[4].runId).toBe("run-19");
  });

  it("returns all records when limit exceeds file size", async () => {
    for (let i = 0; i < 3; i++) {
      await recordMetrics(session({ runId: `run-${i}` }), metricsPath);
    }

    const all = await readMetrics({ limit: 10, metricsPath });
    expect(all).toHaveLength(3);
    expect(all[0].runId).toBe("run-0");
    expect(all[2].runId).toBe("run-2");
  });

  it("returns empty array for missing file", async () => {
    const result = await readMetrics({ limit: 5, metricsPath: join(tmpDir, "nonexistent.jsonl") });
    expect(result).toEqual([]);
  });

  it("returns empty array for empty file", async () => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(metricsPath, "", "utf-8");
    const result = await readMetrics({ limit: 5, metricsPath });
    expect(result).toEqual([]);
  });

  it("returns single record when file has one line", async () => {
    await recordMetrics(session({ runId: "only-one" }), metricsPath);
    const result = await readMetrics({ limit: 5, metricsPath });
    expect(result).toHaveLength(1);
    expect(result[0].runId).toBe("only-one");
  });

  it("preserves JSON fidelity in tail-read path", async () => {
    const usage = {
      "claude-opus-4-6": { inputTokens: 100000, outputTokens: 25000, cacheReadInputTokens: 85000, cacheCreationInputTokens: 15000, costUSD: 3.2 },
    };
    await recordMetrics(session({ modelUsage: usage, toolCounts: { Read: 20 }, orientTurns: 42, runId: "fidelity" }), metricsPath);

    const [rec] = await readMetrics({ limit: 1, metricsPath });
    expect(rec.modelUsage).toEqual(usage);
    expect(rec.toolCounts).toEqual({ Read: 20 });
    expect(rec.orientTurns).toBe(42);
  });

  it("matches full-read results for limit queries", async () => {
    for (let i = 0; i < 50; i++) {
      await recordMetrics(session({ runId: `run-${i}`, costUsd: i * 0.5 }), metricsPath);
    }

    const fullRead = await readMetrics({ metricsPath });
    const tailRead = await readMetrics({ limit: 10, metricsPath });

    expect(tailRead).toEqual(fullRead.slice(-10));
  });

  it("falls back to full read when since is specified alongside limit", async () => {
    await recordMetrics(session({ runId: "old", timestamp: "2026-01-01T00:00:00Z" }), metricsPath);
    await recordMetrics(session({ runId: "new", timestamp: "2026-02-01T00:00:00Z" }), metricsPath);

    const result = await readMetrics({ since: "2026-01-15T00:00:00Z", limit: 10, metricsPath });
    expect(result).toHaveLength(1);
    expect(result[0].runId).toBe("new");
  });
});

describe("countMetrics", () => {
  let tmpDir: string;
  let metricsPath: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `metrics-count-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    metricsPath = join(tmpDir, "sessions.jsonl");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns 0 for missing file", async () => {
    const count = await countMetrics(join(tmpDir, "nonexistent.jsonl"));
    expect(count).toBe(0);
  });

  it("returns correct count for populated file", async () => {
    for (let i = 0; i < 15; i++) {
      await recordMetrics(session({ runId: `run-${i}` }), metricsPath);
    }
    const count = await countMetrics(metricsPath);
    expect(count).toBe(15);
  });

  it("returns 0 for empty file", async () => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(metricsPath, "", "utf-8");
    expect(await countMetrics(metricsPath)).toBe(0);
  });
});

// ── SessionMetrics worktree fields ────────────────────────────────────────

describe("SessionMetrics worktree fields", () => {
  let tmpDir: string;
  let metricsPath: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `metrics-worktree-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    metricsPath = join(tmpDir, "sessions.jsonl");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("stores and roundtrips worktree fields", async () => {
    const metrics = session({
      worktreeTaskId: "task-abc",
      worktreeBranch: "worker/task-abc",
      worktreeAllocMs: 1200,
      worktreeCleanupMs: 800,
      worktreeMergeResult: "merged",
    });
    await recordMetrics(metrics, metricsPath);

    const records = await readMetrics({ metricsPath });
    expect(records).toHaveLength(1);
    expect(records[0].worktreeTaskId).toBe("task-abc");
    expect(records[0].worktreeBranch).toBe("worker/task-abc");
    expect(records[0].worktreeAllocMs).toBe(1200);
    expect(records[0].worktreeCleanupMs).toBe(800);
    expect(records[0].worktreeMergeResult).toBe("merged");
  });

  it("accepts all worktreeMergeResult values", async () => {
    const results: Array<SessionMetrics["worktreeMergeResult"]> = ["merged", "fallback", "no-changes", "error"];
    for (const result of results) {
      const metrics = session({
        runId: `wt-${result}`,
        worktreeMergeResult: result,
      });
      await recordMetrics(metrics, metricsPath);
    }

    const records = await readMetrics({ metricsPath });
    expect(records).toHaveLength(4);
    expect(records.map((r) => r.worktreeMergeResult)).toEqual(results);
  });

  it("worktree fields are optional (undefined when not set)", async () => {
    const metrics = session();
    await recordMetrics(metrics, metricsPath);

    const records = await readMetrics({ metricsPath });
    expect(records[0].worktreeTaskId).toBeUndefined();
    expect(records[0].worktreeBranch).toBeUndefined();
    expect(records[0].worktreeAllocMs).toBeUndefined();
    expect(records[0].worktreeCleanupMs).toBeUndefined();
    expect(records[0].worktreeMergeResult).toBeUndefined();
  });
});

// ── generateRunId tests ────────────────────────────────────────────────────

import { generateRunId } from "./metrics.js";

describe("generateRunId", () => {
  it("includes the job ID prefix", () => {
    const id = generateRunId("my-job");
    expect(id.startsWith("my-job-")).toBe(true);
  });

  it("generates unique IDs across concurrent calls", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateRunId("job"));
    }
    // All 100 should be unique
    expect(ids.size).toBe(100);
  });

  it("suffix is 8 hex characters", () => {
    const id = generateRunId("test");
    const suffix = id.slice("test-".length);
    expect(suffix).toMatch(/^[0-9a-f]{8}$/);
  });
});

// ── OrientTurnTracker unit tests ────────────────────────────────────────────

import { OrientTurnTracker } from "./sdk.js";

describe("OrientTurnTracker", () => {
  it("returns undefined when no orient skill is invoked", () => {
    const tracker = new OrientTurnTracker();
    tracker.onNewTurn();
    tracker.onTool("Read");
    tracker.onNewTurn();
    tracker.onTool("Bash");
    tracker.finalize();
    expect(tracker.orientTurns).toBeUndefined();
  });

  it("counts turns from orient Skill invocation to first Edit", () => {
    const tracker = new OrientTurnTracker();
    // Turn 1: invoke orient
    tracker.onNewTurn();
    tracker.onTool("Skill", { skill: "orient" });
    // Turn 2: Read files (orient work)
    tracker.onNewTurn();
    tracker.onTool("Read");
    tracker.onTool("Bash");
    // Turn 3: more orient reads
    tracker.onNewTurn();
    tracker.onTool("Read");
    tracker.onTool("Glob");
    // Turn 4: first Edit signals execution start
    tracker.onNewTurn();
    tracker.onTool("Edit");
    tracker.finalize();
    // Orient took turns 1-3, ended at turn 4: 4 - 1 = 3
    expect(tracker.orientTurns).toBe(3);
  });

  it("counts all remaining turns as orient when no execution tool is called", () => {
    const tracker = new OrientTurnTracker();
    tracker.onNewTurn();
    tracker.onTool("Skill", { skill: "orient" });
    tracker.onNewTurn();
    tracker.onTool("Read");
    tracker.onNewTurn();
    tracker.onTool("Bash");
    tracker.onNewTurn();
    tracker.onTool("Read");
    tracker.finalize();
    // 4 turns total, orient at turn 1: 4 - 1 = 3
    expect(tracker.orientTurns).toBe(3);
  });

  it("detects orient with 'orient fast' variant", () => {
    const tracker = new OrientTurnTracker();
    tracker.onNewTurn();
    tracker.onTool("Skill", { skill: "orient", args: "fast" });
    tracker.onNewTurn();
    tracker.onTool("Read");
    tracker.onNewTurn();
    tracker.onTool("TodoWrite");
    tracker.finalize();
    expect(tracker.orientTurns).toBe(2);
  });

  it("detects orient end with Write tool", () => {
    const tracker = new OrientTurnTracker();
    tracker.onNewTurn();
    tracker.onTool("Skill", { skill: "orient" });
    tracker.onNewTurn();
    tracker.onTool("Read");
    tracker.onNewTurn();
    tracker.onTool("Write");
    tracker.finalize();
    expect(tracker.orientTurns).toBe(2);
  });

  it("detects orient end with TodoWrite tool", () => {
    const tracker = new OrientTurnTracker();
    tracker.onNewTurn();
    tracker.onTool("Skill", { skill: "orient" });
    tracker.onNewTurn();
    tracker.onTool("TodoWrite");
    tracker.finalize();
    expect(tracker.orientTurns).toBe(1);
  });

  it("ignores non-orient Skill invocations", () => {
    const tracker = new OrientTurnTracker();
    tracker.onNewTurn();
    tracker.onTool("Skill", { skill: "compound" });
    tracker.onNewTurn();
    tracker.onTool("Edit");
    tracker.finalize();
    expect(tracker.orientTurns).toBeUndefined();
  });

  it("handles orient start and end in the same turn", () => {
    const tracker = new OrientTurnTracker();
    // Turn 1: some pre-orient read
    tracker.onNewTurn();
    tracker.onTool("Read");
    // Turn 2: orient + immediate Edit in same message
    tracker.onNewTurn();
    tracker.onTool("Skill", { skill: "orient" });
    tracker.onTool("Edit");
    tracker.finalize();
    // Orient started at turn 2, Edit at turn 2: 2 - 2 = 0
    expect(tracker.orientTurns).toBe(0);
  });

  it("only counts the first orient invocation", () => {
    const tracker = new OrientTurnTracker();
    tracker.onNewTurn();
    tracker.onTool("Skill", { skill: "orient" });
    tracker.onNewTurn();
    tracker.onTool("Read");
    // Second orient call (should be ignored)
    tracker.onNewTurn();
    tracker.onTool("Skill", { skill: "orient" });
    tracker.onNewTurn();
    tracker.onTool("Edit");
    tracker.finalize();
    // Orient started at turn 1, Edit at turn 4: 4 - 1 = 3
    expect(tracker.orientTurns).toBe(3);
  });
});

// ── fleetResultToMetrics ────────────────────────────────────────────────────

describe("fleetResultToMetrics", () => {
  it("converts a successful FleetWorkerResult to SessionMetrics", () => {
    const fr: FleetWorkerResult = {
      taskId: "task-abc",
      project: "my-project",
      sessionId: "fleet-sess-001",
      ok: true,
      durationMs: 120000,
      costUsd: 0,
      numTurns: 8,
      timedOut: false,
      backend: "opencode",
      toolCounts: { Read: 3, Bash: 2 },
    };

    const metrics = fleetResultToMetrics(fr);

    expect(metrics.jobName).toBe("fleet-worker:my-project");
    expect(metrics.runId).toBe("fleet-sess-001");
    expect(metrics.triggerSource).toBe("fleet");
    expect(metrics.backend).toBe("opencode");
    expect(metrics.durationMs).toBe(120000);
    expect(metrics.costUsd).toBe(0);
    expect(metrics.numTurns).toBe(8);
    expect(metrics.timedOut).toBe(false);
    expect(metrics.ok).toBe(true);
    expect(metrics.error).toBeUndefined();
    expect(metrics.toolCounts).toEqual({ Read: 3, Bash: 2 });
    // Without post-session data, these default to null
    expect(metrics.verification).toBeNull();
    expect(metrics.knowledge).toBeNull();
    expect(metrics.budgetGate).toBeNull();
    expect(metrics.crossProject).toBeNull();
    expect(metrics.qualityAudit).toBeNull();

    // skillType/workerRole default to null when not present
    expect(metrics.skillType).toBeNull();
    expect(metrics.workerRole).toBeNull();
  });

  it("copies skillType and workerRole from FleetWorkerResult", () => {
    const fr: FleetWorkerResult = {
      taskId: "task-skill",
      project: "test-project",
      sessionId: "fleet-skill-001",
      ok: true,
      durationMs: 60000,
      costUsd: 0,
      numTurns: 3,
      timedOut: false,
      backend: "opencode",
      toolCounts: {},
      skillType: "execute",
      workerRole: "implementation",
    };

    const metrics = fleetResultToMetrics(fr);

    expect(metrics.skillType).toBe("execute");
    expect(metrics.workerRole).toBe("implementation");
  });

  it("passes through verification and knowledge metrics when present", () => {
    const mockVerification = {
      uncommittedFiles: 0,
      orphanedFiles: 0,
      hasLogEntry: false,
      hasCommit: true,
      hasCompleteFooter: false,
      ledgerConsistent: true,
      filesChanged: 3,
      commitCount: 2,
      agentCommitCount: 2,
      warningCount: 1,
      l2ViolationCount: 0,
      l2ChecksPerformed: 4,
    };
    const mockKnowledge = {
      newExperimentFindings: 2,
      newDecisionRecords: 0,
      newLiteratureNotes: 0,
      openQuestionsResolved: 0,
      openQuestionsDiscovered: 0,
      experimentsCompleted: 1,
      crossReferences: 0,
      newAnalysisFiles: 0,
      logEntryFindings: 0,
      infraCodeChanges: 0,
      bugfixVerifications: 0,
      compoundActions: 0,
      structuralChanges: 0,
      feedbackProcessed: 0,
      diagnosesCompleted: 0,
    };
    const mockCrossProject = {
      projectsTouched: ["proj-a"],
      findingsPerProject: { "proj-a": 2 },
      crossProjectRefs: 0,
    };
    const mockQualityAudit = {
      auditSkillsInvoked: 0,
      auditFindings: 0,
      experimentsAudited: 0,
    };

    const fr: FleetWorkerResult = {
      taskId: "task-with-verify",
      project: "verified-proj",
      sessionId: "fleet-verified",
      ok: true,
      durationMs: 60000,
      backend: "opencode",
      verification: mockVerification,
      knowledge: mockKnowledge,
      crossProject: mockCrossProject,
      qualityAudit: mockQualityAudit,
    };

    const metrics = fleetResultToMetrics(fr);

    expect(metrics.verification).toEqual(mockVerification);
    expect(metrics.knowledge).toEqual(mockKnowledge);
    expect(metrics.crossProject).toEqual(mockCrossProject);
    expect(metrics.qualityAudit).toEqual(mockQualityAudit);
    expect(metrics.budgetGate).toBeNull();

  });

  it("converts a failed FleetWorkerResult with error", () => {
    const fr: FleetWorkerResult = {
      taskId: "task-xyz",
      project: "failing-proj",
      sessionId: "fleet-fail-001",
      ok: false,
      durationMs: 5000,
      error: "Agent crashed",
      backend: "opencode",
    };

    const metrics = fleetResultToMetrics(fr);

    expect(metrics.ok).toBe(false);
    expect(metrics.error).toBe("Agent crashed");
    expect(metrics.costUsd).toBeNull();
    expect(metrics.numTurns).toBeNull();
    expect(metrics.timedOut).toBe(false);
    expect(metrics.modelUsage).toBeNull();
    expect(metrics.orientTurns).toBeNull();
  });

  it("defaults backend to opencode when not specified", () => {
    const fr: FleetWorkerResult = {
      taskId: "task-def",
      project: "proj",
      sessionId: "fleet-def",
      ok: true,
      durationMs: 1000,
    };

    const metrics = fleetResultToMetrics(fr);
    expect(metrics.backend).toBe("opencode");
  });

  it("propagates modelUsage when present", () => {
    const modelUsage = {
      "glm-5-fp8": {
        inputTokens: 5000,
        outputTokens: 2000,
        cacheReadInputTokens: 100,
        cacheCreationInputTokens: 50,
        costUSD: 0,
      },
    };

    const fr: FleetWorkerResult = {
      taskId: "task-model",
      project: "proj",
      sessionId: "fleet-model",
      ok: true,
      durationMs: 30000,
      modelUsage,
    };

    const metrics = fleetResultToMetrics(fr);
    expect(metrics.modelUsage).toEqual(modelUsage);
  });

  it("sets timestamp to current time", () => {
    const before = new Date().toISOString();
    const fr: FleetWorkerResult = {
      taskId: "t",
      project: "p",
      sessionId: "s",
      ok: true,
      durationMs: 1,
    };
    const metrics = fleetResultToMetrics(fr);
    const after = new Date().toISOString();

    expect(metrics.timestamp >= before).toBe(true);
    expect(metrics.timestamp <= after).toBe(true);
  });

  it("includes worktree fields when present in FleetWorkerResult", () => {
    const fr: FleetWorkerResult = {
      taskId: "task-wt",
      project: "wt-proj",
      sessionId: "fleet-wt-001",
      ok: true,
      durationMs: 90000,
      backend: "opencode",
    };

    const metrics = fleetResultToMetrics(fr);

    // Worktree fields are optional and not set by fleetResultToMetrics
    // (they are populated by the fleet scheduler at a higher level)
    expect(metrics.worktreeTaskId).toBeUndefined();
    expect(metrics.worktreeBranch).toBeUndefined();
  });

  it("passes through verification metrics when present", () => {
    const verification = {
      uncommittedFiles: 2,
      orphanedFiles: 0,
      hasLogEntry: true,
      hasCommit: true,
      hasCompleteFooter: true,
      ledgerConsistent: true,
      filesChanged: 5,
      commitCount: 3,
      agentCommitCount: 2,
      warningCount: 1,
      l2ViolationCount: 0,
      l2ChecksPerformed: 4,
    };

    const knowledge = {
      newExperimentFindings: 0,
      newDecisionRecords: 0,
      newLiteratureNotes: 0,
      openQuestionsResolved: 0,
      openQuestionsDiscovered: 0,
      experimentsCompleted: 0,
      crossReferences: 0,
      newAnalysisFiles: 0,
      logEntryFindings: 0,
      infraCodeChanges: 1,
      bugfixVerifications: 0,
      compoundActions: 0,
      structuralChanges: 2,
      feedbackProcessed: 0,
      diagnosesCompleted: 0,
    };

    const crossProject = {
      projectsTouched: ["proj-a"],
      findingsPerProject: {},
      crossProjectRefs: 0,
    };

    const qualityAudit = {
      auditSkillsInvoked: 0,
      auditFindings: 0,
      experimentsAudited: 0,
    };

    const fr: FleetWorkerResult = {
      taskId: "task-with-verify",
      project: "proj-a",
      sessionId: "fleet-with-verify",
      ok: true,
      durationMs: 60000,
      verification,
      knowledge,
      crossProject,
      qualityAudit,
    };

    const metrics = fleetResultToMetrics(fr);

    expect(metrics.verification).toEqual(verification);
    expect(metrics.knowledge).toEqual(knowledge);
    expect(metrics.crossProject).toEqual(crossProject);
    expect(metrics.qualityAudit).toEqual(qualityAudit);
    expect(metrics.budgetGate).toBeNull();

  });
});

// ── getProjectDailyMinutes tests ────────────────────────────────────────────

import { getProjectDailyMinutes } from "./metrics.js";

describe("getProjectDailyMinutes", () => {
  let tmpDir: string;
  let metricsPath: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `metrics-daily-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    metricsPath = join(tmpDir, "sessions.jsonl");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("sums durationMs / 60000 for matching project and day", async () => {
    // Two sessions for projA on 2026-03-18: 120_000ms (2min) + 180_000ms (3min) = 5min
    await recordMetrics(session({
      jobName: "worker:projA",
      timestamp: "2026-03-18T10:00:00Z",
      durationMs: 120_000,
    }), metricsPath);
    await recordMetrics(session({
      jobName: "worker:projA",
      timestamp: "2026-03-18T14:00:00Z",
      durationMs: 180_000,
    }), metricsPath);

    const minutes = await getProjectDailyMinutes("projA", "2026-03-18", metricsPath);
    expect(minutes).toBe(5);
  });

  it("returns 0 when no matching records exist", async () => {
    const minutes = await getProjectDailyMinutes("projA", "2026-03-18", metricsPath);
    expect(minutes).toBe(0);
  });

  it("excludes records from other projects", async () => {
    await recordMetrics(session({
      jobName: "worker:projA",
      timestamp: "2026-03-18T10:00:00Z",
      durationMs: 120_000,
    }), metricsPath);
    await recordMetrics(session({
      jobName: "worker:projB",
      timestamp: "2026-03-18T10:00:00Z",
      durationMs: 300_000,
    }), metricsPath);

    const minutes = await getProjectDailyMinutes("projA", "2026-03-18", metricsPath);
    expect(minutes).toBe(2);
  });

  it("excludes records from other days", async () => {
    await recordMetrics(session({
      jobName: "worker:projA",
      timestamp: "2026-03-17T23:59:00Z",
      durationMs: 600_000,
    }), metricsPath);
    await recordMetrics(session({
      jobName: "worker:projA",
      timestamp: "2026-03-18T10:00:00Z",
      durationMs: 120_000,
    }), metricsPath);
    await recordMetrics(session({
      jobName: "worker:projA",
      timestamp: "2026-03-19T00:01:00Z",
      durationMs: 600_000,
    }), metricsPath);

    const minutes = await getProjectDailyMinutes("projA", "2026-03-18", metricsPath);
    expect(minutes).toBe(2);
  });

  it("rounds to nearest integer minute", async () => {
    // 90_000ms = 1.5 minutes, should round to 2
    await recordMetrics(session({
      jobName: "worker:projA",
      timestamp: "2026-03-18T10:00:00Z",
      durationMs: 90_000,
    }), metricsPath);

    const minutes = await getProjectDailyMinutes("projA", "2026-03-18", metricsPath);
    expect(minutes).toBe(2);
  });
});
