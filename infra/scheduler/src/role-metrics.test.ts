/** Tests for per-role metrics aggregation (specialization experiment infrastructure). */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  groupByRole,
  computeRoleDistribution,
  compareRoles,
  formatRoleComparison,
  aggregateRoleMetrics,
} from "./role-metrics.js";
import { recordMetrics, type SessionMetrics } from "./metrics.js";

function session(overrides: Partial<SessionMetrics> = {}): SessionMetrics {
  return {
    timestamp: "2026-02-25T00:00:00Z",
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

describe("groupByRole", () => {
  it("groups sessions by injectedRole", () => {
    const sessions = [
      session({ runId: "1", injectedRole: "project-researcher" }),
      session({ runId: "2", injectedRole: "project-researcher" }),
      session({ runId: "3", injectedRole: "infrastructure-engineer" }),
      session({ runId: "4" }),
    ];

    const groups = groupByRole(sessions);
    expect(groups.size).toBe(3);
    expect(groups.get("project-researcher")?.length).toBe(2);
    expect(groups.get("infrastructure-engineer")?.length).toBe(1);
    expect(groups.get("generalist")?.length).toBe(1);
  });

  it("treats null and undefined role as generalist", () => {
    const sessions = [
      session({ runId: "1", injectedRole: null }),
      session({ runId: "2" }),
    ];

    const groups = groupByRole(sessions);
    expect(groups.size).toBe(1);
    expect(groups.get("generalist")?.length).toBe(2);
  });

  it("returns empty map for empty input", () => {
    expect(groupByRole([]).size).toBe(0);
  });
});

describe("computeRoleDistribution", () => {
  it("computes orient overhead from orientTurns and numTurns", () => {
    const sessions = [
      session({ orientTurns: 10, numTurns: 40 }),
      session({ orientTurns: 8, numTurns: 40 }),
      session({ orientTurns: 12, numTurns: 40 }),
    ];

    const dist = computeRoleDistribution("test", sessions);
    expect(dist.orientOverhead).not.toBeNull();
    expect(dist.orientOverhead!.mean).toBeCloseTo(0.25, 2);
    expect(dist.orientOverhead!.median).toBeCloseTo(0.25, 2);
  });

  it("returns null orient overhead when no orientTurns data", () => {
    const sessions = [
      session({ orientTurns: null, numTurns: 40 }),
    ];

    const dist = computeRoleDistribution("test", sessions);
    expect(dist.orientOverhead).toBeNull();
  });

  it("computes findings per dollar", () => {
    const sessions = [
      session({
        costUsd: 4.0,
        knowledge: {
          newExperimentFindings: 6,
          logEntryFindings: 2,
          newDecisionRecords: 0, newLiteratureNotes: 0,
          openQuestionsResolved: 0, openQuestionsDiscovered: 0,
          experimentsCompleted: 0, crossReferences: 0,
          newAnalysisFiles: 0, infraCodeChanges: 0,
          bugfixVerifications: 0, compoundActions: 0,
          structuralChanges: 0, feedbackProcessed: 0,
          diagnosesCompleted: 0,
        },
      }),
    ];

    const dist = computeRoleDistribution("test", sessions);
    expect(dist.findingsPerDollar).not.toBeNull();
    expect(dist.findingsPerDollar!.mean).toBeCloseTo(2.0, 2);
  });

  it("skips zero-cost sessions for f/$ calculation", () => {
    const sessions = [
      session({ costUsd: 0, knowledge: { newExperimentFindings: 5, logEntryFindings: 0 } as any }),
      session({ costUsd: 2.0, knowledge: { newExperimentFindings: 4, logEntryFindings: 0 } as any }),
    ];

    const dist = computeRoleDistribution("test", sessions);
    expect(dist.findingsPerDollar).not.toBeNull();
    expect(dist.findingsPerDollar!.mean).toBeCloseTo(2.0, 2);
  });

  it("computes cross-project reference rate", () => {
    const sessions = [
      session({ crossProject: { projectsTouched: ["a"], findingsPerProject: {}, crossProjectRefs: 2 } }),
      session({ crossProject: { projectsTouched: ["a"], findingsPerProject: {}, crossProjectRefs: 0 } }),
      session({ crossProject: { projectsTouched: ["a", "b"], findingsPerProject: {}, crossProjectRefs: 1 } }),
      session({ crossProject: null }),
    ];

    const dist = computeRoleDistribution("test", sessions);
    expect(dist.crossProjectRefRate).toBeCloseTo(0.5, 2);
  });

  it("computes timeout rate", () => {
    const sessions = [
      session({ timedOut: true }),
      session({ timedOut: false }),
      session({ timedOut: false }),
      session({ timedOut: true }),
    ];

    const dist = computeRoleDistribution("test", sessions);
    expect(dist.timedOutRate).toBeCloseTo(0.5, 2);
  });

  it("handles empty sessions array", () => {
    const dist = computeRoleDistribution("empty", []);
    expect(dist.sessionCount).toBe(0);
    expect(dist.orientOverhead).toBeNull();
    expect(dist.findingsPerDollar).toBeNull();
    expect(dist.crossProjectRefRate).toBe(0);
    expect(dist.avgTurns).toBe(0);
  });
});

describe("compareRoles", () => {
  it("produces comparison with generalist baseline", () => {
    const sessions = [
      session({ runId: "1", injectedRole: "project-researcher", costUsd: 3.0 }),
      session({ runId: "2", injectedRole: "project-researcher", costUsd: 2.5 }),
      session({ runId: "3", costUsd: 4.0 }),
    ];

    const comparison = compareRoles(sessions);
    expect(comparison.roles.length).toBe(2);
    expect(comparison.generalistBaseline).not.toBeNull();
    expect(comparison.generalistBaseline!.role).toBe("generalist");
    expect(comparison.generalistBaseline!.sessionCount).toBe(1);
  });

  it("returns null baseline when no generalist sessions", () => {
    const sessions = [
      session({ runId: "1", injectedRole: "project-researcher" }),
    ];

    const comparison = compareRoles(sessions);
    expect(comparison.generalistBaseline).toBeNull();
  });

  it("sorts roles by session count descending", () => {
    const sessions = [
      session({ runId: "1", injectedRole: "synthesizer" }),
      session({ runId: "2", injectedRole: "project-researcher" }),
      session({ runId: "3", injectedRole: "project-researcher" }),
      session({ runId: "4", injectedRole: "project-researcher" }),
    ];

    const comparison = compareRoles(sessions);
    expect(comparison.roles[0].role).toBe("project-researcher");
    expect(comparison.roles[1].role).toBe("synthesizer");
  });
});

describe("formatRoleComparison", () => {
  it("produces readable markdown output", () => {
    const sessions = [
      session({
        runId: "1",
        injectedRole: "project-researcher",
        orientTurns: 5,
        numTurns: 20,
        costUsd: 3.0,
        knowledge: { newExperimentFindings: 3, logEntryFindings: 1 } as any,
      }),
      session({
        runId: "2",
        orientTurns: 15,
        numTurns: 40,
        costUsd: 4.0,
        knowledge: { newExperimentFindings: 1, logEntryFindings: 1 } as any,
      }),
    ];

    const comparison = compareRoles(sessions);
    const output = formatRoleComparison(comparison);

    expect(output).toContain("## Per-Role Metrics Comparison");
    expect(output).toContain("### generalist");
    expect(output).toContain("### project-researcher");
    expect(output).toContain("Orient overhead:");
    expect(output).toContain("Findings/dollar:");
  });
});

describe("aggregateRoleMetrics (integration)", () => {
  let tmpDir: string;
  let metricsPath: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `role-metrics-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    metricsPath = join(tmpDir, "sessions.jsonl");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("reads sessions.jsonl and groups by role", async () => {
    await recordMetrics(session({ runId: "1", injectedRole: "project-researcher" }), metricsPath);
    await recordMetrics(session({ runId: "2", injectedRole: "project-researcher" }), metricsPath);
    await recordMetrics(session({ runId: "3", injectedRole: "infrastructure-engineer" }), metricsPath);
    await recordMetrics(session({ runId: "4" }), metricsPath);

    const comparison = await aggregateRoleMetrics({ metricsPath });
    expect(comparison.roles.length).toBe(3);
    expect(comparison.generalistBaseline?.sessionCount).toBe(1);
  });

  it("respects limit parameter", async () => {
    for (let i = 0; i < 10; i++) {
      await recordMetrics(
        session({ runId: `run-${i}`, injectedRole: i < 5 ? "specialist" : undefined }),
        metricsPath,
      );
    }

    const comparison = await aggregateRoleMetrics({ limit: 5, metricsPath });
    const total = comparison.roles.reduce((s, r) => s + r.sessionCount, 0);
    expect(total).toBe(5);
  });

  it("returns empty comparison for missing file", async () => {
    const comparison = await aggregateRoleMetrics({ metricsPath: join(tmpDir, "nonexistent.jsonl") });
    expect(comparison.roles.length).toBe(0);
  });
});

describe("SessionMetrics injectedRole field", () => {
  let tmpDir: string;
  let metricsPath: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `metrics-role-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    metricsPath = join(tmpDir, "sessions.jsonl");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("stores injectedRole when present", async () => {
    await recordMetrics(session({ injectedRole: "project-researcher" }), metricsPath);
    const [rec] = await import("node:fs/promises").then((fs) => fs.readFile(metricsPath, "utf-8")).then((s) => [JSON.parse(s.trim())]);
    expect(rec.injectedRole).toBe("project-researcher");
  });

  it("stores null injectedRole for generalist sessions", async () => {
    await recordMetrics(session({ injectedRole: null }), metricsPath);
    const [rec] = await import("node:fs/promises").then((fs) => fs.readFile(metricsPath, "utf-8")).then((s) => [JSON.parse(s.trim())]);
    expect(rec.injectedRole).toBeNull();
  });

  it("roundtrips injectedRole through readMetrics", async () => {
    await recordMetrics(session({ runId: "1", injectedRole: "infrastructure-engineer" }), metricsPath);
    await recordMetrics(session({ runId: "2", injectedRole: null }), metricsPath);
    await recordMetrics(session({ runId: "3", injectedRole: "synthesizer" }), metricsPath);

    const { readMetrics } = await import("./metrics.js");
    const records = await readMetrics({ metricsPath });
    expect(records).toHaveLength(3);
    expect(records[0].injectedRole).toBe("infrastructure-engineer");
    expect(records[1].injectedRole).toBeNull();
    expect(records[2].injectedRole).toBe("synthesizer");
  });
});
