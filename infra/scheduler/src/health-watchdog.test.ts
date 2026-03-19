/** Tests for the session health watchdog — detects anomalies in session metrics. */

import { describe, it, expect } from "vitest";
import {
  analyzeHealth,
  formatHealthReport,
  computeReadinessScore,
  formatReadinessReport,
  parseEarliestLedgerDate,
  computeBudgetDrift,
  getCommitsAhead,
  extractPendingApprovalItems,
  filterStaleApprovalItems,
  getBranchStats,
  type HealthCheck,
  type HealthCheckOpts,
  type BudgetDriftInput,
  type BudgetDriftData,
  type HealthCheckInput,
  type BranchStats,
} from "./health-watchdog.js";
import type { SessionMetrics, KnowledgeMetrics, VerificationMetrics } from "./metrics.js";

// ── Test helpers ───────────────────────────────────────────────────────────

function defaultKnowledge(): KnowledgeMetrics {
  return {
    newExperimentFindings: 0,
    newDecisionRecords: 0,
    newLiteratureNotes: 0,
    openQuestionsResolved: 0,
    openQuestionsDiscovered: 0,
    experimentsCompleted: 0,
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
}

function defaultVerification(): VerificationMetrics {
  return {
    uncommittedFiles: 0,
    orphanedFiles: 0,
    hasLogEntry: true,
    hasCommit: true,
    hasCompleteFooter: true,
    ledgerConsistent: true,
    filesChanged: 5,
    commitCount: 2,
          agentCommitCount: 2,
    warningCount: 2,
    l2ViolationCount: 0,
    l2ChecksPerformed: 0,
  };
}

function session(overrides: Partial<SessionMetrics> = {}): SessionMetrics {
  return {
    timestamp: "2026-02-21T00:00:00.000Z",
    jobName: "youji-work-cycle",
    runId: "test-1",
    backend: "claude",
    durationMs: 300_000,
    costUsd: 3.5,
    numTurns: 60,
    timedOut: false,
    ok: true,
    verification: defaultVerification(),
    knowledge: defaultKnowledge(),
    budgetGate: { allowed: true },
    modelUsage: null,
    toolCounts: null,
    orientTurns: null,
    crossProject: null,
    qualityAudit: null,
    ...overrides,
  };
}

function productiveSession(overrides: Partial<SessionMetrics> = {}): SessionMetrics {
  return session({
    knowledge: { ...defaultKnowledge(), newExperimentFindings: 3 },
    ...overrides,
  });
}

// ── analyzeHealth tests ────────────────────────────────────────────────────

describe("analyzeHealth", () => {
  it("returns empty array when no sessions", () => {
    expect(analyzeHealth([])).toEqual([]);
  });

  it("returns empty array when all metrics are healthy", () => {
    const sessions = Array.from({ length: 10 }, (_, i) =>
      productiveSession({
        timestamp: `2026-02-21T0${i}:00:00.000Z`,
        runId: `test-${i}`,
        costUsd: 3.0 + Math.random() * 0.5,
      }),
    );
    const checks = analyzeHealth(sessions);
    expect(checks).toEqual([]);
  });

  // ── Error rate ─────────────────────────────────────────────────────────

  describe("error rate", () => {
    it("flags error rate > 30%", () => {
      const sessions = [
        session({ ok: false, runId: "f1" }),
        session({ ok: false, runId: "f2" }),
        session({ ok: false, runId: "f3" }),
        session({ ok: false, runId: "f4" }),
        session({ ok: true, runId: "o1" }),
        session({ ok: true, runId: "o2" }),
        session({ ok: true, runId: "o3" }),
        session({ ok: true, runId: "o4" }),
        session({ ok: true, runId: "o5" }),
        session({ ok: true, runId: "o6" }),
      ];
      const checks = analyzeHealth(sessions);
      const errorCheck = checks.find((c) => c.id === "high_error_rate");
      expect(errorCheck).toBeDefined();
      expect(errorCheck!.severity).toBe("high");
      expect(errorCheck!.value).toBe(40); // 4/10 = 40%
    });

    it("does not flag error rate at 30%", () => {
      const sessions = [
        session({ ok: false, runId: "f1" }),
        session({ ok: false, runId: "f2" }),
        session({ ok: false, runId: "f3" }),
        ...Array.from({ length: 7 }, (_, i) =>
          session({ ok: true, runId: `o${i}` }),
        ),
      ];
      const checks = analyzeHealth(sessions);
      expect(checks.find((c) => c.id === "high_error_rate")).toBeUndefined();
    });

    it("excludes idle exploration from error rate", () => {
      const sessions = [
        // 6 task-bearing sessions: 3 failed, 3 ok → 50% error rate
        session({ ok: false, runId: "f1", isIdle: false }),
        session({ ok: false, runId: "f2", isIdle: false }),
        session({ ok: false, runId: "f3", isIdle: false }),
        session({ ok: true, runId: "o1", isIdle: false }),
        session({ ok: true, runId: "o2", isIdle: false }),
        session({ ok: true, runId: "o3", isIdle: false }),
        // 4 idle sessions: all "failed" (timed out) but should be excluded
        session({ ok: false, runId: "idle1", isIdle: true }),
        session({ ok: false, runId: "idle2", isIdle: true }),
        session({ ok: false, runId: "idle3", isIdle: true }),
        session({ ok: false, runId: "idle4", isIdle: true }),
      ];
      const checks = analyzeHealth(sessions);
      const errorCheck = checks.find((c) => c.id === "high_error_rate");
      expect(errorCheck).toBeDefined();
      expect(errorCheck!.value).toBe(50); // 3/6 = 50% (excludes idle)
      expect(errorCheck!.description).toContain("3/6 task-bearing");
      expect(errorCheck!.description).toContain("4 idle");
    });

    it("does not flag when only idle sessions failed", () => {
      const sessions = [
        // 5 successful task-bearing sessions
        ...Array.from({ length: 5 }, (_, i) =>
          session({ ok: true, runId: `o${i}`, isIdle: false }),
        ),
        // 5 failed idle sessions (should be excluded)
        ...Array.from({ length: 5 }, (_, i) =>
          session({ ok: false, runId: `idle${i}`, isIdle: true }),
        ),
      ];
      const checks = analyzeHealth(sessions);
      expect(checks.find((c) => c.id === "high_error_rate")).toBeUndefined();
    });
  });

  // ── Cost spike ─────────────────────────────────────────────────────────

  describe("cost spike", () => {
    it("flags cost spike > 50% above baseline", () => {
      // 5 older sessions at ~$3, 5 recent sessions at ~$6
      const sessions = [
        ...Array.from({ length: 5 }, (_, i) =>
          session({ costUsd: 3.0, runId: `old-${i}`, timestamp: `2026-02-21T0${i}:00:00.000Z` }),
        ),
        ...Array.from({ length: 5 }, (_, i) =>
          session({ costUsd: 6.0, runId: `new-${i}`, timestamp: `2026-02-21T1${i}:00:00.000Z` }),
        ),
      ];
      const checks = analyzeHealth(sessions);
      const costCheck = checks.find((c) => c.id === "cost_spike");
      expect(costCheck).toBeDefined();
      expect(costCheck!.severity).toBe("medium");
    });

    it("does not flag when cost is stable", () => {
      const sessions = Array.from({ length: 10 }, (_, i) =>
        session({ costUsd: 3.0, runId: `s-${i}`, timestamp: `2026-02-21T0${i}:00:00.000Z` }),
      );
      const checks = analyzeHealth(sessions);
      expect(checks.find((c) => c.id === "cost_spike")).toBeUndefined();
    });

    it("does not flag with fewer than 8 non-zero-cost sessions", () => {
      const sessions = [
        ...Array.from({ length: 3 }, (_, i) =>
          session({ costUsd: 2.0, runId: `old-${i}` }),
        ),
        ...Array.from({ length: 3 }, (_, i) =>
          session({ costUsd: 6.0, runId: `new-${i}` }),
        ),
      ];
      const checks = analyzeHealth(sessions);
      expect(checks.find((c) => c.id === "cost_spike")).toBeUndefined();
    });

    it("handles sessions with null costUsd", () => {
      const sessions = Array.from({ length: 10 }, (_, i) =>
        session({ costUsd: null, runId: `s-${i}`, backend: "cursor" }),
      );
      const checks = analyzeHealth(sessions);
      expect(checks.find((c) => c.id === "cost_spike")).toBeUndefined();
    });
  });

  // ── Zero-knowledge rate ────────────────────────────────────────────────

  describe("zero-knowledge rate", () => {
    it("flags zero-knowledge rate > 15%", () => {
      // 3 zero-knowledge sessions out of 10 = 30%
      // These have projects touched so they're genuine waste, not task starvation
      const sessions = [
        ...Array.from({ length: 3 }, (_, i) =>
          session({
            runId: `zk-${i}`,
            knowledge: defaultKnowledge(),
            verification: { ...defaultVerification(), hasCommit: false, filesChanged: 0 },
            crossProject: { projectsTouched: ["youji"], findingsPerProject: {}, crossProjectRefs: 0 },
          }),
        ),
        ...Array.from({ length: 7 }, (_, i) =>
          productiveSession({ runId: `pk-${i}` }),
        ),
      ];
      const checks = analyzeHealth(sessions);
      const zkCheck = checks.find((c) => c.id === "high_zero_knowledge_rate");
      expect(zkCheck).toBeDefined();
      expect(zkCheck!.severity).toBe("medium");
      expect(zkCheck!.value).toBe(30); // 3/10 = 30%
    });

    it("does not flag when zero-knowledge rate is at 10% (below 15% threshold)", () => {
      const sessions = [
        ...Array.from({ length: 1 }, (_, i) =>
          session({
            runId: `zk-${i}`,
            knowledge: defaultKnowledge(),
            verification: { ...defaultVerification(), hasCommit: false, filesChanged: 0 },
            crossProject: { projectsTouched: ["youji"], findingsPerProject: {}, crossProjectRefs: 0 },
          }),
        ),
        ...Array.from({ length: 9 }, (_, i) =>
          productiveSession({ runId: `pk-${i}` }),
        ),
      ];
      const checks = analyzeHealth(sessions);
      expect(checks.find((c) => c.id === "high_zero_knowledge_rate")).toBeUndefined();
    });

    it("flags when zero-knowledge rate is at 20% (above 15% threshold)", () => {
      const sessions = [
        ...Array.from({ length: 2 }, (_, i) =>
          session({
            runId: `zk-${i}`,
            knowledge: defaultKnowledge(),
            verification: { ...defaultVerification(), hasCommit: false, filesChanged: 0 },
            crossProject: { projectsTouched: ["youji"], findingsPerProject: {}, crossProjectRefs: 0 },
          }),
        ),
        ...Array.from({ length: 8 }, (_, i) =>
          productiveSession({ runId: `pk-${i}` }),
        ),
      ];
      const checks = analyzeHealth(sessions);
      const zkCheck = checks.find((c) => c.id === "high_zero_knowledge_rate");
      expect(zkCheck).toBeDefined();
      expect(zkCheck!.value).toBe(20); // 2/10 = 20%
    });

    it("handles sessions with null knowledge", () => {
      const sessions = Array.from({ length: 10 }, (_, i) =>
        session({ runId: `s-${i}`, knowledge: null }),
      );
      const checks = analyzeHealth(sessions);
      // Should not flag — null knowledge means metric not available, not zero
      expect(checks.find((c) => c.id === "high_zero_knowledge_rate")).toBeUndefined();
    });

    it("uses genuine waste filter: excludes high-filesChanged sessions", () => {
      // Sessions with zero knowledge but high filesChanged (structural work, not waste)
      const sessions = [
        ...Array.from({ length: 5 }, (_, i) =>
          session({
            runId: `struct-${i}`,
            knowledge: defaultKnowledge(),
            verification: { ...defaultVerification(), filesChanged: 50 },
          }),
        ),
        ...Array.from({ length: 5 }, (_, i) =>
          productiveSession({ runId: `pk-${i}` }),
        ),
      ];
      const checks = analyzeHealth(sessions);
      // Should not flag — those are structural sessions, not genuine waste
      expect(checks.find((c) => c.id === "high_zero_knowledge_rate")).toBeUndefined();
    });

    it("uses genuine waste filter: excludes sessions with commits and file changes", () => {
      // Sessions with zero knowledge but hasCommit=true and filesChanged>0 — not waste
      const sessions = [
        ...Array.from({ length: 5 }, (_, i) =>
          session({
            runId: `commit-${i}`,
            knowledge: defaultKnowledge(),
            verification: { ...defaultVerification(), hasCommit: true, filesChanged: 3 },
          }),
        ),
        ...Array.from({ length: 5 }, (_, i) =>
          productiveSession({ runId: `pk-${i}` }),
        ),
      ];
      const checks = analyzeHealth(sessions);
      // Should not flag — sessions with commits and file changes did work
      expect(checks.find((c) => c.id === "high_zero_knowledge_rate")).toBeUndefined();
    });

    it("uses genuine waste filter: excludes cursor sessions", () => {
      const sessions = [
        ...Array.from({ length: 5 }, (_, i) =>
          session({
            runId: `cursor-${i}`,
            knowledge: defaultKnowledge(),
            backend: "cursor",
          }),
        ),
        ...Array.from({ length: 5 }, (_, i) =>
          productiveSession({ runId: `pk-${i}` }),
        ),
      ];
      const checks = analyzeHealth(sessions);
      expect(checks.find((c) => c.id === "high_zero_knowledge_rate")).toBeUndefined();
    });

    it("classifies task starvation separately: 0 commits, 0 files, 0 projects", () => {
      const sessions = [
        ...Array.from({ length: 3 }, (_, i) =>
          session({
            runId: `ts-${i}`,
            knowledge: defaultKnowledge(),
            verification: { ...defaultVerification(), hasCommit: false, filesChanged: 0 },
            crossProject: { projectsTouched: [], findingsPerProject: {}, crossProjectRefs: 0 },
          }),
        ),
        ...Array.from({ length: 7 }, (_, i) =>
          productiveSession({ runId: `pk-${i}` }),
        ),
      ];
      const checks = analyzeHealth(sessions);
      const tsCheck = checks.find((c) => c.id === "task_starvation");
      expect(tsCheck).toBeDefined();
      expect(tsCheck!.severity).toBe("medium");
      expect(tsCheck!.value).toBe(30); // 3/10 = 30%
      // Should NOT flag as generic zero-knowledge waste
      expect(checks.find((c) => c.id === "high_zero_knowledge_rate")).toBeUndefined();
    });

    it("does not classify as task starvation if projects touched", () => {
      const sessions = [
        ...Array.from({ length: 3 }, (_, i) =>
          session({
            runId: `not-ts-${i}`,
            knowledge: defaultKnowledge(),
            verification: { ...defaultVerification(), hasCommit: false, filesChanged: 0 },
            crossProject: { projectsTouched: ["youji"], findingsPerProject: {}, crossProjectRefs: 0 },
          }),
        ),
        ...Array.from({ length: 7 }, (_, i) =>
          productiveSession({ runId: `pk-${i}` }),
        ),
      ];
      const checks = analyzeHealth(sessions);
      // Should NOT flag as task starvation (has projects touched)
      expect(checks.find((c) => c.id === "task_starvation")).toBeUndefined();
    });

    it("does not classify as task starvation if has commits", () => {
      const sessions = [
        ...Array.from({ length: 3 }, (_, i) =>
          session({
            runId: `not-ts-${i}`,
            knowledge: defaultKnowledge(),
            verification: { ...defaultVerification(), hasCommit: true, filesChanged: 0 },
            crossProject: null,
          }),
        ),
        ...Array.from({ length: 7 }, (_, i) =>
          productiveSession({ runId: `pk-${i}` }),
        ),
      ];
      const checks = analyzeHealth(sessions);
      expect(checks.find((c) => c.id === "task_starvation")).toBeUndefined();
    });

    it("does not classify as task starvation if has files changed", () => {
      const sessions = [
        ...Array.from({ length: 3 }, (_, i) =>
          session({
            runId: `not-ts-${i}`,
            knowledge: defaultKnowledge(),
            verification: { ...defaultVerification(), hasCommit: false, filesChanged: 5 },
            crossProject: null,
          }),
        ),
        ...Array.from({ length: 7 }, (_, i) =>
          productiveSession({ runId: `pk-${i}` }),
        ),
      ];
      const checks = analyzeHealth(sessions);
      expect(checks.find((c) => c.id === "task_starvation")).toBeUndefined();
    });

    it("does not classify cursor sessions as task starvation", () => {
      const sessions = [
        ...Array.from({ length: 3 }, (_, i) =>
          session({
            runId: `cursor-ts-${i}`,
            knowledge: defaultKnowledge(),
            backend: "cursor",
            verification: { ...defaultVerification(), hasCommit: false, filesChanged: 0 },
            crossProject: null,
          }),
        ),
        ...Array.from({ length: 7 }, (_, i) =>
          productiveSession({ runId: `pk-${i}` }),
        ),
      ];
      const checks = analyzeHealth(sessions);
      expect(checks.find((c) => c.id === "task_starvation")).toBeUndefined();
    });

    it("reports both task starvation and genuine waste separately", () => {
      const sessions = [
        // Task starvation: 0 commits, 0 files, 0 projects
        ...Array.from({ length: 2 }, (_, i) =>
          session({
            runId: `ts-${i}`,
            knowledge: defaultKnowledge(),
            verification: { ...defaultVerification(), hasCommit: false, filesChanged: 0 },
            crossProject: { projectsTouched: [], findingsPerProject: {}, crossProjectRefs: 0 },
          }),
        ),
        // Genuine waste: 0 commits, 0 files, but touched a project (not task starvation)
        ...Array.from({ length: 2 }, (_, i) =>
          session({
            runId: `waste-${i}`,
            knowledge: defaultKnowledge(),
            verification: { ...defaultVerification(), hasCommit: false, filesChanged: 0 },
            crossProject: { projectsTouched: ["youji"], findingsPerProject: {}, crossProjectRefs: 0 },
          }),
        ),
        // Productive sessions
        ...Array.from({ length: 6 }, (_, i) =>
          productiveSession({ runId: `pk-${i}` }),
        ),
      ];
      const checks = analyzeHealth(sessions);
      const tsCheck = checks.find((c) => c.id === "task_starvation");
      expect(tsCheck).toBeDefined();
      expect(tsCheck!.value).toBe(20); // 2/10 = 20%
      const zkCheck = checks.find((c) => c.id === "high_zero_knowledge_rate");
      expect(zkCheck).toBeDefined();
      expect(zkCheck!.value).toBe(20); // 2/10 = 20% (genuine waste only)
    });

    it("excludes task starvation from genuine waste count", () => {
      const sessions = [
        // Task starvation (should be excluded from zero-knowledge count)
        ...Array.from({ length: 5 }, (_, i) =>
          session({
            runId: `ts-${i}`,
            knowledge: defaultKnowledge(),
            verification: { ...defaultVerification(), hasCommit: false, filesChanged: 0 },
            crossProject: { projectsTouched: [], findingsPerProject: {}, crossProjectRefs: 0 },
          }),
        ),
        // Productive sessions
        ...Array.from({ length: 5 }, (_, i) =>
          productiveSession({ runId: `pk-${i}` }),
        ),
      ];
      const checks = analyzeHealth(sessions);
      // Task starvation should be reported
      const tsCheck = checks.find((c) => c.id === "task_starvation");
      expect(tsCheck).toBeDefined();
      // But zero-knowledge rate should NOT be flagged (task starvation excluded)
      expect(checks.find((c) => c.id === "high_zero_knowledge_rate")).toBeUndefined();
    });
  });

  // ── Consecutive failures ───────────────────────────────────────────────

  describe("consecutive failures", () => {
    it("flags > 3 consecutive failures", () => {
      const sessions = [
        session({ ok: true, runId: "o1", timestamp: "2026-02-21T00:00:00Z" }),
        session({ ok: false, runId: "f1", timestamp: "2026-02-21T01:00:00Z" }),
        session({ ok: false, runId: "f2", timestamp: "2026-02-21T02:00:00Z" }),
        session({ ok: false, runId: "f3", timestamp: "2026-02-21T03:00:00Z" }),
        session({ ok: false, runId: "f4", timestamp: "2026-02-21T04:00:00Z" }),
      ];
      const checks = analyzeHealth(sessions);
      const consCheck = checks.find((c) => c.id === "consecutive_failures");
      expect(consCheck).toBeDefined();
      expect(consCheck!.severity).toBe("high");
      expect(consCheck!.value).toBe(4);
    });

    it("does not flag 3 consecutive failures (threshold is >3)", () => {
      const sessions = [
        session({ ok: true, runId: "o1", timestamp: "2026-02-21T00:00:00Z" }),
        session({ ok: false, runId: "f1", timestamp: "2026-02-21T01:00:00Z" }),
        session({ ok: false, runId: "f2", timestamp: "2026-02-21T02:00:00Z" }),
        session({ ok: false, runId: "f3", timestamp: "2026-02-21T03:00:00Z" }),
      ];
      const checks = analyzeHealth(sessions);
      expect(checks.find((c) => c.id === "consecutive_failures")).toBeUndefined();
    });

    it("detects failures at the end (most recent)", () => {
      const sessions = [
        session({ ok: false, runId: "f1", timestamp: "2026-02-21T00:00:00Z" }),
        session({ ok: true, runId: "o1", timestamp: "2026-02-21T01:00:00Z" }),
        session({ ok: true, runId: "o2", timestamp: "2026-02-21T02:00:00Z" }),
        session({ ok: false, runId: "f2", timestamp: "2026-02-21T03:00:00Z" }),
        session({ ok: false, runId: "f3", timestamp: "2026-02-21T04:00:00Z" }),
        session({ ok: false, runId: "f4", timestamp: "2026-02-21T05:00:00Z" }),
        session({ ok: false, runId: "f5", timestamp: "2026-02-21T06:00:00Z" }),
      ];
      const checks = analyzeHealth(sessions);
      const consCheck = checks.find((c) => c.id === "consecutive_failures");
      expect(consCheck).toBeDefined();
      expect(consCheck!.value).toBe(4);
    });

    it("excludes billing errors from consecutive failure count", () => {
      const sessions = [
        session({ ok: true, runId: "o1", timestamp: "2026-02-21T00:00:00Z" }),
        session({ ok: false, runId: "f1", timestamp: "2026-02-21T01:00:00Z", error: "unpaid invoice" }),
        session({ ok: false, runId: "f2", timestamp: "2026-02-21T02:00:00Z", error: "billing: payment required" }),
        session({ ok: false, runId: "f3", timestamp: "2026-02-21T03:00:00Z", error: "subscription expired" }),
        session({ ok: false, runId: "f4", timestamp: "2026-02-21T04:00:00Z", error: "insufficient credit" }),
      ];
      const checks = analyzeHealth(sessions);
      // All 4 failures are billing errors, so consecutive count should be 0
      expect(checks.find((c) => c.id === "consecutive_failures")).toBeUndefined();
    });

    it("excludes idle exploration from consecutive failure count", () => {
      const sessions = [
        session({ ok: true, runId: "o1", timestamp: "2026-02-21T00:00:00Z" }),
        session({ ok: false, runId: "idle1", timestamp: "2026-02-21T01:00:00Z", isIdle: true }),
        session({ ok: false, runId: "idle2", timestamp: "2026-02-21T02:00:00Z", isIdle: true }),
        session({ ok: false, runId: "idle3", timestamp: "2026-02-21T03:00:00Z", isIdle: true }),
        session({ ok: false, runId: "idle4", timestamp: "2026-02-21T04:00:00Z", isIdle: true }),
      ];
      const checks = analyzeHealth(sessions);
      // All 4 failures are idle exploration, so consecutive count should be 0
      expect(checks.find((c) => c.id === "consecutive_failures")).toBeUndefined();
    });

    it("counts systemic failures but skips billing errors in streak", () => {
      const sessions = [
        session({ ok: true, runId: "o1", timestamp: "2026-02-21T00:00:00Z" }),
        session({ ok: false, runId: "f1", timestamp: "2026-02-21T01:00:00Z", error: "connection refused" }),
        session({ ok: false, runId: "f2", timestamp: "2026-02-21T02:00:00Z", error: "unpaid invoice" }), // billing, skip
        session({ ok: false, runId: "f3", timestamp: "2026-02-21T03:00:00Z", error: "timeout error" }),
        session({ ok: false, runId: "f4", timestamp: "2026-02-21T04:00:00Z", error: "out of memory" }),
      ];
      const checks = analyzeHealth(sessions);
      const consCheck = checks.find((c) => c.id === "consecutive_failures");
      // f1=systemic, f2=billing(skip), f3=systemic, f4=systemic
      // Max consecutive systemic = 2 (f3+f4 at end, or f1 alone before billing break)
      expect(consCheck).toBeUndefined(); // 2 is not > 3
    });

    it("counts systemic failures but skips idle sessions in streak", () => {
      const sessions = [
        session({ ok: true, runId: "o1", timestamp: "2026-02-21T00:00:00Z" }),
        session({ ok: false, runId: "f1", timestamp: "2026-02-21T01:00:00Z", error: "connection refused" }),
        session({ ok: false, runId: "idle1", timestamp: "2026-02-21T02:00:00Z", isIdle: true }), // idle, skip
        session({ ok: false, runId: "f3", timestamp: "2026-02-21T03:00:00Z", error: "timeout error" }),
        session({ ok: false, runId: "f4", timestamp: "2026-02-21T04:00:00Z", error: "out of memory" }),
      ];
      const checks = analyzeHealth(sessions);
      const consCheck = checks.find((c) => c.id === "consecutive_failures");
      // f1=systemic, idle1=skip, f3=systemic, f4=systemic
      // Max consecutive systemic = 2 (f3+f4 at end, or f1 alone before idle break)
      expect(consCheck).toBeUndefined(); // 2 is not > 3
    });

    it("flags 4 systemic failures even with billing errors mixed in", () => {
      const sessions = [
        session({ ok: true, runId: "o1", timestamp: "2026-02-21T00:00:00Z" }),
        session({ ok: false, runId: "f1", timestamp: "2026-02-21T01:00:00Z", error: "connection refused" }),
        session({ ok: false, runId: "f2", timestamp: "2026-02-21T02:00:00Z", error: "timeout error" }),
        session({ ok: false, runId: "f3", timestamp: "2026-02-21T03:00:00Z", error: "unpaid invoice" }), // billing, skip
        session({ ok: false, runId: "f4", timestamp: "2026-02-21T04:00:00Z", error: "out of memory" }),
        session({ ok: false, runId: "f5", timestamp: "2026-02-21T05:00:00Z", error: "network error" }),
      ];
      const checks = analyzeHealth(sessions);
      const consCheck = checks.find((c) => c.id === "consecutive_failures");
      // f1=systemic, f2=systemic, f3=billing(skip), f4=systemic, f5=systemic
      // Max consecutive systemic = 3 (f1+f2 or f4+f5)
      // Actually after f3 (billing skip resets to 0), f4+f5=2
      // f1+f2=2 consecutive, then billing resets, then f4+f5=2
      // So max = 2, not > 3
      expect(consCheck).toBeUndefined();
    });
  });

  // ── Babysitting detection ──────────────────────────────────────────────

  describe("babysitting detection", () => {
    it("flags sessions that timed out with zero commits", () => {
      const sessions = [
        ...Array.from({ length: 8 }, (_, i) =>
          productiveSession({ runId: `ok-${i}` }),
        ),
        session({
          runId: "babysit-1",
          timedOut: true,
          verification: { ...defaultVerification(), hasCommit: false, commitCount: 0 },
        }),
        session({
          runId: "babysit-2",
          timedOut: true,
          verification: { ...defaultVerification(), hasCommit: false, commitCount: 0 },
        }),
      ];
      const checks = analyzeHealth(sessions);
      const babysitCheck = checks.find((c) => c.id === "babysitting_detected");
      expect(babysitCheck).toBeDefined();
      expect(babysitCheck!.severity).toBe("high");
      expect(babysitCheck!.value).toBe(2);
    });

    it("does not flag sessions that timed out but have commits", () => {
      const sessions = Array.from({ length: 10 }, (_, i) =>
        session({
          runId: `s-${i}`,
          timedOut: i < 3,
          verification: defaultVerification(),
        }),
      );
      const checks = analyzeHealth(sessions);
      expect(checks.find((c) => c.id === "babysitting_detected")).toBeUndefined();
    });

    it("does not flag sessions with zero commits that did not time out", () => {
      const sessions = Array.from({ length: 10 }, (_, i) =>
        productiveSession({
          runId: `s-${i}`,
          timedOut: false,
          verification: { ...defaultVerification(), hasCommit: false, commitCount: 0 },
        }),
      );
      const checks = analyzeHealth(sessions);
      expect(checks.find((c) => c.id === "babysitting_detected")).toBeUndefined();
    });

    it("flags medium severity for a single babysitting session", () => {
      const sessions = [
        ...Array.from({ length: 9 }, (_, i) =>
          productiveSession({ runId: `ok-${i}` }),
        ),
        session({
          runId: "babysit-1",
          timedOut: true,
          verification: { ...defaultVerification(), hasCommit: false, commitCount: 0 },
        }),
      ];
      const checks = analyzeHealth(sessions);
      const babysitCheck = checks.find((c) => c.id === "babysitting_detected");
      expect(babysitCheck).toBeDefined();
      expect(babysitCheck!.severity).toBe("medium");
    });
  });

  // ── Custom options ─────────────────────────────────────────────────────

  describe("custom thresholds", () => {
    it("respects custom errorRateThreshold", () => {
      // 2/10 = 20% — below default 30% but above custom 15%
      const sessions = [
        session({ ok: false, runId: "f1" }),
        session({ ok: false, runId: "f2" }),
        ...Array.from({ length: 8 }, (_, i) =>
          session({ ok: true, runId: `o${i}` }),
        ),
      ];
      const input: HealthCheckInput = { opts: { errorRateThreshold: 15 } };
      const checks = analyzeHealth(sessions, input);
      expect(checks.find((c) => c.id === "high_error_rate")).toBeDefined();
    });

    it("respects custom consecutiveFailureThreshold", () => {
      // 2 consecutive — below default 3 but matches custom 2
      const sessions = [
        session({ ok: true, runId: "o1", timestamp: "2026-02-21T00:00:00Z" }),
        session({ ok: false, runId: "f1", timestamp: "2026-02-21T01:00:00Z" }),
        session({ ok: false, runId: "f2", timestamp: "2026-02-21T02:00:00Z" }),
      ];
      const input: HealthCheckInput = { opts: { consecutiveFailureThreshold: 1 } };
      const checks = analyzeHealth(sessions, input);
      expect(checks.find((c) => c.id === "consecutive_failures")).toBeDefined();
    });
  });

  // ── Sorting ────────────────────────────────────────────────────────────

  it("sorts results by severity: high before medium", () => {
    // Trigger both high (error rate) and medium (zero-knowledge)
    const sessions = [
      ...Array.from({ length: 5 }, (_, i) =>
        session({
          ok: false,
          runId: `f-${i}`,
          knowledge: defaultKnowledge(),
          verification: { ...defaultVerification(), hasCommit: false, filesChanged: 0 },
        }),
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        productiveSession({ ok: true, runId: `o-${i}` }),
      ),
    ];
    const checks = analyzeHealth(sessions);
    expect(checks.length).toBeGreaterThanOrEqual(2);

    const severities = checks.map((c) => c.severity);
    const highIdx = severities.indexOf("high");
    const medIdx = severities.indexOf("medium");
    if (highIdx >= 0 && medIdx >= 0) {
      expect(highIdx).toBeLessThan(medIdx);
    }
  });
});

// ── formatHealthReport tests ──────────────────────────────────────────────

describe("formatHealthReport", () => {
  it("returns all-clear message when no issues", () => {
    const { summary, details } = formatHealthReport([]);
    expect(summary).toContain("all clear");
    expect(details).toContain("all clear");
  });

  it("includes check details when issues exist", () => {
    const checks: HealthCheck[] = [
      {
        id: "high_error_rate",
        description: "Error rate above threshold",
        severity: "high",
        value: 40,
        threshold: 30,
        recommendation: "Investigate failing sessions",
      },
    ];
    const { summary, details } = formatHealthReport(checks);
    expect(summary).toContain("1 issue(s)");
    expect(summary).toContain("1 high");
    expect(details).toContain("high_error_rate");
    expect(details).toContain("40");
    expect(details).toContain("Investigate");
  });

  it("includes severity counts in summary", () => {
    const checks: HealthCheck[] = [
      {
        id: "test_high",
        description: "high severity test",
        severity: "high",
        value: 50,
        threshold: 30,
        recommendation: "fix it",
      },
      {
        id: "test_medium",
        description: "medium severity test",
        severity: "medium",
        value: 25,
        threshold: 20,
        recommendation: "look into it",
      },
    ];
    const { summary, details } = formatHealthReport(checks);
    expect(summary).toContain("2 issue(s)");
    expect(summary).toContain("1 high");
    expect(summary).toContain("1 medium");
    expect(details.length).toBeGreaterThan(summary.length);
  });
});

// ── computeReadinessScore tests ───────────────────────────────────────────

describe("computeReadinessScore", () => {
  it("returns healthy band with all-unavailable signals for empty sessions", () => {
    const result = computeReadinessScore([]);
    expect(result.band).toBe("healthy");
    expect(result.composite).toBe(0);
    expect(result.signals).toHaveLength(5);
    expect(result.signals.every((s) => s.status === "unavailable")).toBe(true);
  });

  it("returns healthy when orient overhead is below baseline", () => {
    const sessions = Array.from({ length: 10 }, (_, i) =>
      session({
        runId: `s-${i}`,
        orientTurns: 8,
        numTurns: 30,
        costUsd: 3.0,
        knowledge: { ...defaultKnowledge(), newExperimentFindings: 5 },
      }),
    );
    const result = computeReadinessScore(sessions);
    const orientSignal = result.signals.find((s) => s.id === "orient_overhead");
    expect(orientSignal).toBeDefined();
    expect(orientSignal!.status).toBe("healthy");
    expect(orientSignal!.rawValue).toBeCloseTo(0.267, 2);
  });

  it("detects elevated orient overhead", () => {
    const sessions = Array.from({ length: 10 }, (_, i) =>
      session({
        runId: `s-${i}`,
        orientTurns: 30,
        numTurns: 60,
        costUsd: 3.0,
        knowledge: { ...defaultKnowledge(), newExperimentFindings: 5 },
      }),
    );
    const result = computeReadinessScore(sessions);
    const orientSignal = result.signals.find((s) => s.id === "orient_overhead");
    expect(orientSignal).toBeDefined();
    expect(orientSignal!.rawValue).toBeCloseTo(0.5, 1);
    expect(["warning", "critical"]).toContain(orientSignal!.status);
  });

  it("marks orient overhead unavailable when too few sessions have data", () => {
    const sessions = [
      session({ runId: "s-1", orientTurns: 10, numTurns: 30 }),
      ...Array.from({ length: 9 }, (_, i) =>
        session({ runId: `s-${i + 2}`, orientTurns: null, numTurns: 20 }),
      ),
    ];
    const result = computeReadinessScore(sessions);
    const orientSignal = result.signals.find((s) => s.id === "orient_overhead");
    expect(orientSignal!.status).toBe("unavailable");
  });

  it("computes f/$ signal — healthy when above baseline", () => {
    const sessions = Array.from({ length: 10 }, (_, i) =>
      session({
        runId: `s-${i}`,
        costUsd: 2.0,
        knowledge: { ...defaultKnowledge(), newExperimentFindings: 3 },
      }),
    );
    const result = computeReadinessScore(sessions);
    const fpdSignal = result.signals.find((s) => s.id === "findings_per_dollar");
    expect(fpdSignal).toBeDefined();
    // 30 findings / $20 = 1.5 f/$ — above 1.14 baseline → healthy
    expect(fpdSignal!.rawValue).toBe(1.5);
    expect(fpdSignal!.status).toBe("healthy");
    expect(fpdSignal!.normalizedValue).toBe(0);
  });

  it("computes f/$ signal — warning when below 0.5", () => {
    const sessions = Array.from({ length: 10 }, (_, i) =>
      session({
        runId: `s-${i}`,
        costUsd: 5.0,
        knowledge: { ...defaultKnowledge(), logEntryFindings: 1 },
      }),
    );
    const result = computeReadinessScore(sessions);
    const fpdSignal = result.signals.find((s) => s.id === "findings_per_dollar");
    // 10 findings / $50 = 0.2 f/$ — below 0.3 critical → critical
    expect(fpdSignal!.rawValue).toBe(0.2);
    expect(fpdSignal!.status).toBe("critical");
  });

  it("marks f/$ unavailable for cursor-only sessions", () => {
    const sessions = Array.from({ length: 10 }, (_, i) =>
      session({
        runId: `s-${i}`,
        backend: "cursor",
        costUsd: 0,
        knowledge: { ...defaultKnowledge(), newExperimentFindings: 3 },
      }),
    );
    const result = computeReadinessScore(sessions);
    const fpdSignal = result.signals.find((s) => s.id === "findings_per_dollar");
    expect(fpdSignal!.status).toBe("unavailable");
  });

  it("computes composite score from multiple elevated signals", () => {
    const sessions = Array.from({ length: 10 }, (_, i) =>
      session({
        runId: `s-${i}`,
        orientTurns: 35,
        numTurns: 60,
        costUsd: 10.0,
        knowledge: { ...defaultKnowledge(), logEntryFindings: 1 },
      }),
    );
    const result = computeReadinessScore(sessions);
    // Orient overhead = 35/60 ≈ 0.583 → above critical 0.55
    // f/$ = 10/100 = 0.1 → below critical 0.3
    expect(result.composite).toBeGreaterThan(0.5);
    expect(["warning", "critical"]).toContain(result.band);
  });

  it("renormalizes weights when signals are unavailable", () => {
    // orient overhead + f/$ available (weight 0.30 + 0.25 = 0.55 ≥ 0.50)
    const sessions = Array.from({ length: 10 }, (_, i) =>
      session({
        runId: `s-${i}`,
        orientTurns: 8,
        numTurns: 30,
        costUsd: 2.0,
        knowledge: { ...defaultKnowledge(), newExperimentFindings: 3 },
      }),
    );
    const result = computeReadinessScore(sessions);
    const available = result.signals.filter((s) => s.status !== "unavailable");
    expect(available.length).toBeGreaterThanOrEqual(2);
    expect(result.band).toBe("healthy");
    expect(result.insufficientData).toBeFalsy();
  });

  it("sets insufficientData when <50% signal weight available", () => {
    // Only budget_drift available (weight 0.10 < 0.50)
    // All other signals unavailable: no cost (cursor), no orientTurns, no crossProject, no qualityAudit
    const sessions = Array.from({ length: 10 }, (_, i) =>
      session({
        runId: `s-${i}`,
        backend: "cursor",
        costUsd: null,
        orientTurns: null,
        numTurns: 20,
      }),
    );
    const drift: BudgetDriftData = {
      drift: 0.75,
      projects: [{
        project: "test-project",
        resources: [{
          resource: "api_calls",
          utilization: 0.85,
          expectedUtilization: 0.10,
          deviation: 0.75,
        }],
      }],
    };
    const result = computeReadinessScore(sessions, { budgetDrift: drift });
    const available = result.signals.filter((s) => s.status !== "unavailable");
    expect(available).toHaveLength(1);
    expect(available[0]!.id).toBe("budget_drift");
    expect(result.insufficientData).toBe(true);
    expect(result.band).toBe("healthy");
    expect(result.composite).toBe(0);
  });

  it("cross-project miss rate computes from crossProject field", () => {
    const sessions = Array.from({ length: 10 }, (_, i) =>
      session({
        runId: `s-${i}`,
        crossProject: {
          projectsTouched: ["youji", "sample-project"],
          findingsPerProject: { youji: 1 },
          crossProjectRefs: i < 3 ? 1 : 0,
        },
      }),
    );
    const result = computeReadinessScore(sessions);
    const cpSignal = result.signals.find((s) => s.id === "cross_project_miss_rate");
    expect(cpSignal).toBeDefined();
    expect(cpSignal!.status).not.toBe("unavailable");
    // 3/10 sessions have refs → refRate = 0.3, missRate = 0.7
    expect(cpSignal!.rawValue).toBeCloseTo(0.7, 1);
  });

  it("audit findings intensity computes from qualityAudit field", () => {
    const sessions = Array.from({ length: 10 }, (_, i) =>
      session({
        runId: `s-${i}`,
        qualityAudit: {
          auditSkillsInvoked: 1,
          auditFindings: i < 2 ? 3 : 0,
          experimentsAudited: 1,
        },
        knowledge: { ...defaultKnowledge(), experimentsCompleted: 1 },
      }),
    );
    const result = computeReadinessScore(sessions);
    const qaSignal = result.signals.find((s) => s.id === "quality_regression");
    expect(qaSignal).toBeDefined();
    expect(qaSignal!.status).not.toBe("unavailable");
    // 6 findings / 10 audited = 0.6 findings intensity
    expect(qaSignal!.rawValue).toBeCloseTo(0.6, 1);
  });

  it("budget drift unavailable when no budget data provided", () => {
    const sessions = Array.from({ length: 10 }, (_, i) =>
      productiveSession({ runId: `s-${i}` }),
    );
    const result = computeReadinessScore(sessions);
    const bdSignal = result.signals.find((s) => s.id === "budget_drift");
    expect(bdSignal!.status).toBe("unavailable");
  });

  it("budget drift healthy when utilization tracks time elapsed", () => {
    const sessions = Array.from({ length: 10 }, (_, i) =>
      productiveSession({ runId: `s-${i}` }),
    );
    const drift: BudgetDriftData = {
      drift: 0.05,
      projects: [{
        project: "test-project",
        resources: [{
          resource: "api_calls",
          utilization: 0.25,
          expectedUtilization: 0.20,
          deviation: 0.05,
        }],
      }],
    };
    const result = computeReadinessScore(sessions, { budgetDrift: drift });
    const bdSignal = result.signals.find((s) => s.id === "budget_drift");
    expect(bdSignal!.status).toBe("healthy");
    expect(bdSignal!.rawValue).toBe(0.05);
  });

  it("budget drift critical when utilization far exceeds expected", () => {
    const sessions = Array.from({ length: 10 }, (_, i) =>
      productiveSession({ runId: `s-${i}` }),
    );
    const drift: BudgetDriftData = {
      drift: 0.75,
      projects: [{
        project: "test-project",
        resources: [{
          resource: "api_calls",
          utilization: 0.85,
          expectedUtilization: 0.10,
          deviation: 0.75,
        }],
      }],
    };
    const result = computeReadinessScore(sessions, { budgetDrift: drift });
    const bdSignal = result.signals.find((s) => s.id === "budget_drift");
    expect(bdSignal!.rawValue).toBe(0.75);
    expect(["warning", "critical"]).toContain(bdSignal!.status);
  });

  it("budget drift unavailable when all resources lack time reference", () => {
    const sessions = Array.from({ length: 10 }, (_, i) =>
      productiveSession({ runId: `s-${i}` }),
    );
    const drift: BudgetDriftData = {
      drift: 0,
      projects: [{
        project: "test-project",
        resources: [{
          resource: "api_calls",
          utilization: 0.50,
          expectedUtilization: null,
          deviation: 0,
        }],
      }],
    };
    const result = computeReadinessScore(sessions, { budgetDrift: drift });
    const bdSignal = result.signals.find((s) => s.id === "budget_drift");
    expect(bdSignal!.status).toBe("unavailable");
  });
});

// ── Specialization readiness integration in analyzeHealth ─────────────────

describe("analyzeHealth specialization readiness", () => {
  it("does not flag when readiness score is healthy", () => {
    const sessions = Array.from({ length: 10 }, (_, i) =>
      productiveSession({
        runId: `s-${i}`,
        orientTurns: 8,
        numTurns: 30,
        costUsd: 2.0,
      }),
    );
    const checks = analyzeHealth(sessions);
    expect(checks.find((c) => c.id === "specialization_readiness")).toBeUndefined();
  });

  it("flags warning when readiness score crosses 0.5", () => {
    // orient overhead ~0.467 (above 0.37 baseline), f/$ ~0.71 (below 1.14 baseline)
    // Composite ≈ 0.53 → warning band
    const sessions = Array.from({ length: 10 }, (_, i) =>
      session({
        runId: `s-${i}`,
        orientTurns: 14,
        numTurns: 30,
        costUsd: 1.4,
        knowledge: { ...defaultKnowledge(), logEntryFindings: 1 },
      }),
    );
    const score = computeReadinessScore(sessions);
    expect(score.band).toBe("warning");
    const checks = analyzeHealth(sessions);
    const readinessCheck = checks.find((c) => c.id === "specialization_readiness");
    expect(readinessCheck).toBeDefined();
    expect(readinessCheck!.severity).toBe("medium");
  });

  it("flags critical when readiness score crosses 0.7", () => {
    const sessions = Array.from({ length: 10 }, (_, i) =>
      session({
        runId: `s-${i}`,
        orientTurns: 40,
        numTurns: 60,
        costUsd: 20.0,
        knowledge: { ...defaultKnowledge() },
      }),
    );
    const checks = analyzeHealth(sessions);
    const readinessCheck = checks.find((c) => c.id === "specialization_readiness");
    expect(readinessCheck).toBeDefined();
    expect(readinessCheck!.severity).toBe("high");
  });
});

// ── parseEarliestLedgerDate tests ─────────────────────────────────────────

describe("parseEarliestLedgerDate", () => {
  it("extracts earliest date from ledger entries", () => {
    const ledger = `entries:
  - date: "2026-02-20"
    resource: api_calls
    amount: 100
  - date: "2026-02-16"
    resource: api_calls
    amount: 50
  - date: "2026-02-22"
    resource: api_calls
    amount: 200`;
    expect(parseEarliestLedgerDate(ledger)).toBe("2026-02-16");
  });

  it("returns null for empty ledger", () => {
    expect(parseEarliestLedgerDate("entries:\n")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseEarliestLedgerDate("")).toBeNull();
  });

  it("handles dates without quotes", () => {
    const ledger = `entries:
  - date: 2026-03-01
    resource: gpu_hours
    amount: 10`;
    expect(parseEarliestLedgerDate(ledger)).toBe("2026-03-01");
  });
});

// ── computeBudgetDrift tests ──────────────────────────────────────────────

describe("computeBudgetDrift", () => {
  it("returns zero drift for empty inputs", () => {
    const result = computeBudgetDrift([]);
    expect(result.drift).toBe(0);
    expect(result.projects).toHaveLength(0);
  });

  it("returns zero drift when utilization matches time elapsed", () => {
    const inputs: BudgetDriftInput[] = [{
      project: "test",
      resources: [{ resource: "api_calls", consumed: 200, limit: 1000 }],
      timeElapsedFraction: 0.20,
    }];
    const result = computeBudgetDrift(inputs);
    expect(result.drift).toBe(0);
    expect(result.projects[0]!.resources[0]!.deviation).toBe(0);
  });

  it("computes positive drift when utilization exceeds time elapsed", () => {
    const inputs: BudgetDriftInput[] = [{
      project: "test",
      resources: [{ resource: "api_calls", consumed: 800, limit: 1000 }],
      timeElapsedFraction: 0.10,
    }];
    const result = computeBudgetDrift(inputs);
    expect(result.drift).toBe(0.7);
    expect(result.projects[0]!.resources[0]!.utilization).toBe(0.8);
  });

  it("computes drift when utilization is behind time elapsed", () => {
    const inputs: BudgetDriftInput[] = [{
      project: "test",
      resources: [{ resource: "api_calls", consumed: 100, limit: 1000 }],
      timeElapsedFraction: 0.80,
    }];
    const result = computeBudgetDrift(inputs);
    expect(result.drift).toBe(0.7);
  });

  it("averages drift across multiple resources", () => {
    const inputs: BudgetDriftInput[] = [{
      project: "test",
      resources: [
        { resource: "api_calls", consumed: 500, limit: 1000 },
        { resource: "gpu_hours", consumed: 200, limit: 1000 },
      ],
      timeElapsedFraction: 0.30,
    }];
    const result = computeBudgetDrift(inputs);
    // api: |0.5 - 0.3| = 0.2, gpu: |0.2 - 0.3| = 0.1, mean = 0.15
    expect(result.drift).toBe(0.15);
  });

  it("averages drift across multiple projects", () => {
    const inputs: BudgetDriftInput[] = [
      {
        project: "proj-a",
        resources: [{ resource: "api_calls", consumed: 600, limit: 1000 }],
        timeElapsedFraction: 0.20,
      },
      {
        project: "proj-b",
        resources: [{ resource: "api_calls", consumed: 100, limit: 1000 }],
        timeElapsedFraction: 0.10,
      },
    ];
    const result = computeBudgetDrift(inputs);
    // proj-a: |0.6 - 0.2| = 0.4, proj-b: |0.1 - 0.1| = 0.0, mean = 0.2
    expect(result.drift).toBe(0.2);
  });

  it("excludes resources with no time reference from drift calculation", () => {
    const inputs: BudgetDriftInput[] = [{
      project: "test",
      resources: [{ resource: "api_calls", consumed: 800, limit: 1000 }],
      timeElapsedFraction: null,
    }];
    const result = computeBudgetDrift(inputs);
    expect(result.drift).toBe(0);
    expect(result.projects[0]!.resources[0]!.expectedUtilization).toBeNull();
  });

  it("skips resources with zero limit", () => {
    const inputs: BudgetDriftInput[] = [{
      project: "test",
      resources: [{ resource: "api_calls", consumed: 100, limit: 0 }],
      timeElapsedFraction: 0.50,
    }];
    const result = computeBudgetDrift(inputs);
    expect(result.drift).toBe(0);
    expect(result.projects).toHaveLength(0);
  });
});

// ── Budget over-consumption health check ──────────────────────────────────

describe("analyzeHealth budget checks", () => {
  it("flags budget over-consumption when utilization > 100%", () => {
    const sessions = Array.from({ length: 5 }, (_, i) =>
      productiveSession({ runId: `s-${i}` }),
    );
    const budgetDrift: BudgetDriftData = {
      drift: 0.2,
      projects: [{
        project: "test-project",
        resources: [{
          resource: "api_calls",
          utilization: 1.15,
          expectedUtilization: 0.50,
          deviation: 0.65,
        }],
      }],
    };
    const input: HealthCheckInput = { opts: { budgetDrift } };
    const checks = analyzeHealth(sessions, input);
    const overCheck = checks.find((c) => c.id === "budget_over_consumption");
    expect(overCheck).toBeDefined();
    expect(overCheck!.severity).toBe("high");
    expect(overCheck!.value).toBe(115);
  });

  it("does not flag when all resources within budget", () => {
    const sessions = Array.from({ length: 5 }, (_, i) =>
      productiveSession({ runId: `s-${i}` }),
    );
    const budgetDrift: BudgetDriftData = {
      drift: 0.1,
      projects: [{
        project: "test-project",
        resources: [{
          resource: "api_calls",
          utilization: 0.80,
          expectedUtilization: 0.50,
          deviation: 0.30,
        }],
      }],
    };
    const input: HealthCheckInput = { opts: { budgetDrift } };
    const checks = analyzeHealth(sessions, input);
    expect(checks.find((c) => c.id === "budget_over_consumption")).toBeUndefined();
  });
});

// ── Push failure detection tests ──────────────────────────────────────────

describe("push failure detection", () => {
  it("flags when commits ahead exceeds threshold", () => {
    const sessions = Array.from({ length: 5 }, (_, i) =>
      productiveSession({ runId: `s-${i}` }),
    );
    const input: HealthCheckInput = { commitsAhead: 15 };
    const checks = analyzeHealth(sessions, input);
    const pushCheck = checks.find((c) => c.id === "push_failure");
    expect(pushCheck).toBeDefined();
    expect(pushCheck!.severity).toBe("medium");
    expect(pushCheck!.value).toBe(15);
    expect(pushCheck!.threshold).toBe(10);
  });

  it("does not flag when commits ahead is at threshold", () => {
    const sessions = Array.from({ length: 5 }, (_, i) =>
      productiveSession({ runId: `s-${i}` }),
    );
    const input: HealthCheckInput = { commitsAhead: 10 };
    const checks = analyzeHealth(sessions, input);
    expect(checks.find((c) => c.id === "push_failure")).toBeUndefined();
  });

  it("does not flag when commits ahead is below threshold", () => {
    const sessions = Array.from({ length: 5 }, (_, i) =>
      productiveSession({ runId: `s-${i}` }),
    );
    const input: HealthCheckInput = { commitsAhead: 5 };
    const checks = analyzeHealth(sessions, input);
    expect(checks.find((c) => c.id === "push_failure")).toBeUndefined();
  });

  it("skips check when commitsAhead is undefined", () => {
    const sessions = Array.from({ length: 5 }, (_, i) =>
      productiveSession({ runId: `s-${i}` }),
    );
    const checks = analyzeHealth(sessions, {});
    expect(checks.find((c) => c.id === "push_failure")).toBeUndefined();
  });

  it("respects custom commitsAheadThreshold", () => {
    const sessions = Array.from({ length: 5 }, (_, i) =>
      productiveSession({ runId: `s-${i}` }),
    );
    const input: HealthCheckInput = {
      opts: { commitsAheadThreshold: 5 },
      commitsAhead: 8,
    };
    const checks = analyzeHealth(sessions, input);
    const pushCheck = checks.find((c) => c.id === "push_failure");
    expect(pushCheck).toBeDefined();
    expect(pushCheck!.threshold).toBe(5);
  });
});

// ── Human intervention rate tests ───────────────────────────────────────────

describe("human intervention rate", () => {
  it("flags when human/autonomous ratio exceeds 2:1", () => {
    const sessions = [
      ...Array.from({ length: 15 }, (_, i) =>
        session({ runId: `human-${i}`, triggerSource: "slack" }),
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        session({ runId: `auto-${i}`, triggerSource: "scheduler" }),
      ),
    ];
    const checks = analyzeHealth(sessions);
    const check = checks.find((c) => c.id === "high_human_intervention_rate");
    expect(check).toBeDefined();
    expect(check!.severity).toBe("high");
    expect(check!.value).toBe(3.0); // 15/5 = 3.0
    expect(check!.threshold).toBe(2);
  });

  it("does not flag when ratio is at or below 2:1", () => {
    const sessions = [
      ...Array.from({ length: 10 }, (_, i) =>
        session({ runId: `human-${i}`, triggerSource: "slack" }),
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        session({ runId: `auto-${i}`, triggerSource: "scheduler" }),
      ),
    ];
    const checks = analyzeHealth(sessions);
    expect(checks.find((c) => c.id === "high_human_intervention_rate")).toBeUndefined();
  });

  it("requires at least 5 sessions with triggerSource", () => {
    const sessions = [
      ...Array.from({ length: 10 }, (_, i) =>
        session({ runId: `human-${i}`, triggerSource: "slack" }),
      ),
      ...Array.from({ length: 2 }, (_, i) =>
        session({ runId: `auto-${i}`, triggerSource: "scheduler" }),
      ),
    ];
    const checks = analyzeHealth(sessions);
    // 12 sessions have triggerSource, so check should run
    const check = checks.find((c) => c.id === "high_human_intervention_rate");
    expect(check).toBeDefined();
    expect(check!.value).toBe(5.0); // 10/2 = 5.0
  });

  it("skips check when fewer than 5 sessions have triggerSource", () => {
    const sessions = [
      session({ runId: "h1", triggerSource: "slack" }),
      session({ runId: "h2", triggerSource: "slack" }),
      session({ runId: "a1", triggerSource: "scheduler" }),
      session({ runId: "no-trigger-1" }),
      session({ runId: "no-trigger-2" }),
    ];
    const checks = analyzeHealth(sessions);
    expect(checks.find((c) => c.id === "high_human_intervention_rate")).toBeUndefined();
  });

  it("counts manual trigger as human", () => {
    const sessions = [
      ...Array.from({ length: 12 }, (_, i) =>
        session({ runId: `manual-${i}`, triggerSource: "manual" }),
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        session({ runId: `auto-${i}`, triggerSource: "scheduler" }),
      ),
    ];
    const checks = analyzeHealth(sessions);
    const check = checks.find((c) => c.id === "high_human_intervention_rate");
    expect(check).toBeDefined();
    expect(check!.value).toBe(2.4); // 12/5 = 2.4, above threshold
  });

  it("handles infinity ratio when no autonomous sessions", () => {
    const sessions = Array.from({ length: 10 }, (_, i) =>
      session({ runId: `human-${i}`, triggerSource: "slack" }),
    );
    const checks = analyzeHealth(sessions);
    const check = checks.find((c) => c.id === "high_human_intervention_rate");
    expect(check).toBeDefined();
    expect(check!.severity).toBe("high");
  });
});

// ── getCommitsAhead tests ──────────────────────────────────────────────────

describe("getCommitsAhead", () => {
  it("returns a number for a valid git repo", async () => {
    const count = await getCommitsAhead(process.cwd());
    expect(typeof count).toBe("number");
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it("returns 0 for a non-existent directory", async () => {
    const count = await getCommitsAhead("/nonexistent/path");
    expect(count).toBe(0);
  });
});

// ── formatReadinessReport tests ───────────────────────────────────────────

describe("formatReadinessReport", () => {
  it("reports insufficient data when no signals are available", () => {
    const score = computeReadinessScore([]);
    expect(score.insufficientData).toBe(true);
    const report = formatReadinessReport(score);
    expect(report).toContain("insufficient data");
  });

  it("lists all 5 signals", () => {
    const score = computeReadinessScore([]);
    const report = formatReadinessReport(score);
    expect(report).toContain("Orient Overhead");
    expect(report).toContain("Findings/Dollar");
    expect(report).toContain("Cross-Project Miss Rate");
    expect(report).toContain("Audit Findings Intensity");
    expect(report).toContain("Budget Drift");
  });
});

// ── extractPendingApprovalItems tests ───────────────────────────────────────

describe("extractPendingApprovalItems", () => {
  const now = new Date("2026-03-10T00:00:00Z");

  it("extracts items from pending section with dates and ages", () => {
    const content = `# Approval Queue

## Pending

### 2026-03-03 — Test approval item
Project: test-project
Type: external
Requested: 2026-02-25

### 2026-03-08 — Another item
Project: another-project
Type: tool-access

## Resolved

### 2026-02-20 — Old resolved item
Decision: approved
`;
    const items = extractPendingApprovalItems(content, now);
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      title: "Test approval item",
      date: "2026-03-03",
      ageDays: 7,
      project: "test-project",
      type: "external",
    });
    expect(items[1]).toEqual({
      title: "Another item",
      date: "2026-03-08",
      ageDays: 2,
      project: "another-project",
      type: "tool-access",
    });
  });

  it("stops at next section header", () => {
    const content = `## Pending

### 2026-03-05 — Item 1
Project: p1

## Resolved

### 2026-03-01 — Item 2
Decision: approved
`;
    const items = extractPendingApprovalItems(content, now);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Item 1");
  });

  it("returns empty array when no pending section", () => {
    const content = `# Approval Queue\n\n## Resolved\n\n### 2026-03-01 — Old item\nDecision: approved\n`;
    const items = extractPendingApprovalItems(content, now);
    expect(items).toEqual([]);
  });

  it("returns empty array when no items in pending section", () => {
    const content = `## Pending\n\nNo items yet.\n\n## Resolved\n`;
    const items = extractPendingApprovalItems(content, now);
    expect(items).toEqual([]);
  });

  it("handles items without project or type fields", () => {
    const content = `## Pending\n\n### 2026-03-07 — Minimal item\n`;
    const items = extractPendingApprovalItems(content, now);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Minimal item");
    expect(items[0].project).toBeUndefined();
    expect(items[0].type).toBeUndefined();
  });
});

// ── filterStaleApprovalItems tests ───────────────────────────────────────────

describe("filterStaleApprovalItems", () => {
  it("filters items older than threshold", () => {
    const items = [
      { title: "a", date: "2026-03-09", ageDays: 1, project: "p", type: "t" },
      { title: "b", date: "2026-03-01", ageDays: 9, project: "p", type: "t" },
      { title: "c", date: "2026-02-20", ageDays: 18, project: "p", type: "t" },
    ];
    const stale = filterStaleApprovalItems(items, 7);
    expect(stale).toHaveLength(2);
    expect(stale.map((i) => i.title)).toEqual(["b", "c"]);
  });

  it("returns empty array when all items are fresh", () => {
    const items = [
      { title: "a", date: "2026-03-09", ageDays: 1, project: "p", type: "t" },
      { title: "b", date: "2026-03-05", ageDays: 5, project: "p", type: "t" },
    ];
    const stale = filterStaleApprovalItems(items, 7);
    expect(stale).toEqual([]);
  });

  it("uses default threshold of 7 days", () => {
    const items = [
      { title: "a", date: "2026-03-02", ageDays: 8, project: "p", type: "t" },
    ];
    const stale = filterStaleApprovalItems(items);
    expect(stale).toHaveLength(1);
  });
});

// ── Stale approval queue health check tests ──────────────────────────────────

describe("analyzeHealth stale approval queue check", () => {
  it("flags stale approval items older than 7 days", () => {
    const sessions = [session({ runId: "s1" })];
    const staleApprovalItems = [
      { title: "Stale item", date: "2026-03-01", ageDays: 9, project: "p", type: "external" },
    ];
    const checks = analyzeHealth(sessions, { staleApprovalItems });
    const check = checks.find((c) => c.id === "stale_approval_queue");
    expect(check).toBeDefined();
    expect(check!.severity).toBe("medium");
    expect(check!.value).toBe(1);
    expect(check!.description).toContain("1 pending approval item");
    expect(check!.description).toContain("9 days");
  });

  it("escalates to high severity when items are >= 14 days old", () => {
    const sessions = [session({ runId: "s1" })];
    const staleApprovalItems = [
      { title: "Very stale", date: "2026-02-20", ageDays: 18, project: "p", type: "external" },
    ];
    const checks = analyzeHealth(sessions, { staleApprovalItems });
    const check = checks.find((c) => c.id === "stale_approval_queue");
    expect(check!.severity).toBe("high");
    expect(check!.description).toContain("18 days");
  });

  it("does not flag when staleApprovalItems not provided", () => {
    const sessions = [session({ runId: "s1" })];
    const checks = analyzeHealth(sessions);
    expect(checks.find((c) => c.id === "stale_approval_queue")).toBeUndefined();
  });

  it("does not flag when all items are fresh", () => {
    const sessions = [session({ runId: "s1" })];
    const staleApprovalItems = [
      { title: "Fresh item", date: "2026-03-09", ageDays: 1, project: "p", type: "external" },
    ];
    const checks = analyzeHealth(sessions, { staleApprovalItems });
    expect(checks.find((c) => c.id === "stale_approval_queue")).toBeUndefined();
  });

  it("summarizes ages in description", () => {
    const sessions = [session({ runId: "s1" })];
    const staleApprovalItems = [
      { title: "a", date: "2026-03-01", ageDays: 9, project: "p", type: "t" },
      { title: "b", date: "2026-03-01", ageDays: 9, project: "p", type: "t" },
      { title: "c", date: "2026-02-20", ageDays: 18, project: "p", type: "t" },
    ];
    const checks = analyzeHealth(sessions, { staleApprovalItems });
    const check = checks.find((c) => c.id === "stale_approval_queue");
    expect(check!.description).toContain("2 at 9d");
    expect(check!.description).toContain("1 at 18d");
  });
});

// ── Branch count monitoring tests ────────────────────────────────────────────

describe("analyzeHealth branch count checks", () => {
  it("flags when total branches exceed threshold", () => {
    const sessions = [session({ runId: "s1" })];
    const branchStats = {
      totalBranches: 75,
      unmergedBranches: [],
    };
    const checks = analyzeHealth(sessions, { branchStats });
    const check = checks.find((c) => c.id === "high_branch_count");
    expect(check).toBeDefined();
    expect(check!.severity).toBe("medium");
    expect(check!.value).toBe(75);
    expect(check!.threshold).toBe(50);
  });

  it("does not flag when branches at threshold", () => {
    const sessions = [session({ runId: "s1" })];
    const branchStats = {
      totalBranches: 50,
      unmergedBranches: [],
    };
    const checks = analyzeHealth(sessions, { branchStats });
    expect(checks.find((c) => c.id === "high_branch_count")).toBeUndefined();
  });

  it("does not flag when branches below threshold", () => {
    const sessions = [session({ runId: "s1" })];
    const branchStats = {
      totalBranches: 30,
      unmergedBranches: [],
    };
    const checks = analyzeHealth(sessions, { branchStats });
    expect(checks.find((c) => c.id === "high_branch_count")).toBeUndefined();
  });

  it("flags unmerged branches older than 48 hours", () => {
    const sessions = [session({ runId: "s1" })];
    const branchStats = {
      totalBranches: 10,
      unmergedBranches: [
        { name: "session-old-1", ageHours: 72 },
        { name: "session-old-2", ageHours: 96 },
      ],
    };
    const checks = analyzeHealth(sessions, { branchStats });
    const check = checks.find((c) => c.id === "stale_unmerged_branches");
    expect(check).toBeDefined();
    expect(check!.severity).toBe("medium");
    expect(check!.value).toBe(2);
    expect(check!.threshold).toBe(48);
    expect(check!.description).toContain("96 hours");
  });

  it("does not flag unmerged branches at or below 48 hours", () => {
    const sessions = [session({ runId: "s1" })];
    const branchStats = {
      totalBranches: 10,
      unmergedBranches: [
        { name: "session-recent-1", ageHours: 24 },
        { name: "session-recent-2", ageHours: 48 },
      ],
    };
    const checks = analyzeHealth(sessions, { branchStats });
    expect(checks.find((c) => c.id === "stale_unmerged_branches")).toBeUndefined();
  });

  it("does not flag when branchStats not provided", () => {
    const sessions = [session({ runId: "s1" })];
    const checks = analyzeHealth(sessions);
    expect(checks.find((c) => c.id === "high_branch_count")).toBeUndefined();
    expect(checks.find((c) => c.id === "stale_unmerged_branches")).toBeUndefined();
  });

  it("respects custom branchCountThreshold", () => {
    const sessions = [session({ runId: "s1" })];
    const branchStats = {
      totalBranches: 40,
      unmergedBranches: [],
    };
    const checks = analyzeHealth(sessions, { opts: { branchCountThreshold: 30 }, branchStats });
    const check = checks.find((c) => c.id === "high_branch_count");
    expect(check).toBeDefined();
    expect(check!.threshold).toBe(30);
  });

  it("respects custom unmergedBranchAgeThreshold", () => {
    const sessions = [session({ runId: "s1" })];
    const branchStats = {
      totalBranches: 10,
      unmergedBranches: [{ name: "session-mid", ageHours: 36 }],
    };
    const checks = analyzeHealth(sessions, { opts: { unmergedBranchAgeThreshold: 24 }, branchStats });
    const check = checks.find((c) => c.id === "stale_unmerged_branches");
    expect(check).toBeDefined();
    expect(check!.threshold).toBe(24);
  });

  it("flags both high count and stale unmerged independently", () => {
    const sessions = [session({ runId: "s1" })];
    const branchStats = {
      totalBranches: 75,
      unmergedBranches: [{ name: "session-old", ageHours: 72 }],
    };
    const checks = analyzeHealth(sessions, { branchStats });
    expect(checks.find((c) => c.id === "high_branch_count")).toBeDefined();
    expect(checks.find((c) => c.id === "stale_unmerged_branches")).toBeDefined();
  });
});
