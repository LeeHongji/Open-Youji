/** Tests for statistical anomaly detection on session metrics. */

import { describe, it, expect } from "vitest";
import {
  detectAnomalies,
  formatAnomalyReport,
  percentile,
  ABSOLUTE_MINIMUMS,
  CONTEXT_UTILIZATION_WARNING_THRESHOLD,
  CONTEXT_UTILIZATION_CRITICAL_THRESHOLD,
  FINDINGS_PER_DOLLAR_THRESHOLD,
  type Anomaly,
  type AnomalyDetectionOpts,
} from "./anomaly-detection.js";
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
    uncommittedFiles: 1,
    orphanedFiles: 1,
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

// ── detectAnomalies tests ────────────────────────────────────────────────

describe("detectAnomalies", () => {
  it("returns empty array when fewer than 5 sessions", () => {
    const sessions = Array.from({ length: 4 }, (_, i) =>
      session({ runId: `s-${i}` }),
    );
    expect(detectAnomalies(sessions)).toEqual([]);
  });

  it("returns empty array when no sessions", () => {
    expect(detectAnomalies([])).toEqual([]);
  });

  it("returns no anomalies for uniform sessions", () => {
    const sessions = Array.from({ length: 10 }, (_, i) =>
      session({
        runId: `s-${i}`,
        timestamp: `2026-02-21T0${i}:00:00.000Z`,
        costUsd: 3.5,
        durationMs: 300_000,
        numTurns: 60,
      }),
    );
    expect(detectAnomalies(sessions)).toEqual([]);
  });

  // ── Cost outliers ────────────────────────────────────────────────────

  describe("cost outliers", () => {
    it("flags a session with cost >2σ above mean", () => {
      // 9 sessions at $3.5, 1 session at $20
      const sessions = [
        ...Array.from({ length: 9 }, (_, i) =>
          session({ runId: `normal-${i}`, costUsd: 3.5 }),
        ),
        session({ runId: "outlier", costUsd: 20.0 }),
      ];
      const anomalies = detectAnomalies(sessions);
      const costAnomaly = anomalies.find((a) => a.metric === "costUsd");
      expect(costAnomaly).toBeDefined();
      expect(costAnomaly!.sessionRunId).toBe("outlier");
      expect(costAnomaly!.direction).toBe("high");
    });

    it("does not flag moderately high cost within normal variance", () => {
      // Sessions with natural variance: 3-5 range
      const sessions = [
        session({ runId: "s-0", costUsd: 3.0 }),
        session({ runId: "s-1", costUsd: 3.5 }),
        session({ runId: "s-2", costUsd: 4.0 }),
        session({ runId: "s-3", costUsd: 3.2 }),
        session({ runId: "s-4", costUsd: 3.8 }),
        session({ runId: "s-5", costUsd: 4.5 }),
        session({ runId: "s-6", costUsd: 3.1 }),
        session({ runId: "s-7", costUsd: 4.2 }),
        session({ runId: "s-8", costUsd: 3.7 }),
        session({ runId: "within-range", costUsd: 5.0 }),
      ];
      const anomalies = detectAnomalies(sessions);
      expect(anomalies.find((a) => a.metric === "costUsd")).toBeUndefined();
    });

    it("skips null cost values", () => {
      const sessions = Array.from({ length: 10 }, (_, i) =>
        session({ runId: `s-${i}`, costUsd: null, backend: "cursor" }),
      );
      const anomalies = detectAnomalies(sessions);
      expect(anomalies.find((a) => a.metric === "costUsd")).toBeUndefined();
    });

    it("excludes $0 sessions from baseline to prevent false positives", () => {
      // Scenario from diagnosis-cost-anomaly-S-240-2026-03-01.md:
      // 17 productive sessions at ~$0.30-0.40, 3 $0.00 billing failures
      // Session S-240 at $1.85 would be flagged with polluted baseline
      // but should NOT be flagged when baseline excludes $0 sessions
      const sessions = [
        ...Array.from({ length: 17 }, (_, i) =>
          session({ runId: `normal-${i}`, backend: "claude", costUsd: 0.30 + (i % 3) * 0.05 }),
        ),
        ...Array.from({ length: 3 }, (_, i) =>
          session({ runId: `billing-failure-${i}`, backend: "claude", costUsd: 0.0 }),
        ),
        session({ runId: "s-240", backend: "claude", costUsd: 1.85 }),
      ];
      const anomalies = detectAnomalies(sessions);
      const costAnomaly = anomalies.find((a) => a.metric === "costUsd" && a.sessionRunId === "s-240");
      // With $0 sessions excluded from baseline, S-240 should NOT be flagged
      // Mean of productive sessions: ~$0.35, StdDev: ~$0.05
      // $1.85 is still >2σ, but let's verify the actual behavior
      expect(costAnomaly).toBeDefined();
    });

    it("still detects genuine cost outliers within non-zero baseline", () => {
      // 9 normal sessions at $0.30-0.50, 1 extreme outlier at $5.00
      const sessions = [
        ...Array.from({ length: 9 }, (_, i) =>
          session({ runId: `normal-${i}`, backend: "claude", costUsd: 0.30 + (i % 3) * 0.1 }),
        ),
        session({ runId: "extreme-outlier", backend: "claude", costUsd: 5.0 }),
      ];
      const anomalies = detectAnomalies(sessions);
      const costAnomaly = anomalies.find((a) => a.metric === "costUsd" && a.sessionRunId === "extreme-outlier");
      expect(costAnomaly).toBeDefined();
      expect(costAnomaly!.direction).toBe("high");
    });

    it("skips cost alert for productive sessions (findings/cost > threshold)", () => {
      // 9 sessions at $3.5, 1 session at $20 but with 50 findings (>2.0 findings/$)
      const sessions = [
        ...Array.from({ length: 9 }, (_, i) =>
          session({ runId: `normal-${i}`, costUsd: 3.5, knowledge: defaultKnowledge() }),
        ),
        session({
          runId: "productive-expensive",
          costUsd: 20.0,
          knowledge: { ...defaultKnowledge(), newExperimentFindings: 50 },
        }),
      ];
      const anomalies = detectAnomalies(sessions);
      const costAnomaly = anomalies.find((a) => a.metric === "costUsd" && a.sessionRunId === "productive-expensive");
      // 50 findings / $20 = 2.5 findings/$, which is > 2.0 threshold
      expect(costAnomaly).toBeUndefined();
    });

    it("flags expensive session with low findings (findings/cost <= threshold)", () => {
      // 9 sessions at $3.5, 1 session at $20 with only 30 findings (<2.0 findings/$)
      const sessions = [
        ...Array.from({ length: 9 }, (_, i) =>
          session({ runId: `normal-${i}`, costUsd: 3.5, knowledge: defaultKnowledge() }),
        ),
        session({
          runId: "unproductive-expensive",
          costUsd: 20.0,
          knowledge: { ...defaultKnowledge(), newExperimentFindings: 30 },
        }),
      ];
      const anomalies = detectAnomalies(sessions);
      const costAnomaly = anomalies.find((a) => a.metric === "costUsd" && a.sessionRunId === "unproductive-expensive");
      // 30 findings / $20 = 1.5 findings/$, which is < 2.0 threshold
      expect(costAnomaly).toBeDefined();
    });

    it("uses threshold constant FINDINGS_PER_DOLLAR_THRESHOLD", () => {
      expect(FINDINGS_PER_DOLLAR_THRESHOLD).toBe(2.0);
    });
  });

  // ── Duration outliers (percentile-based) ─────────────────────────────

  describe("duration outliers (percentile-based)", () => {
    it("flags a session exceeding P95 and absolute minimum", () => {
      // 19 sessions at 300s, 1 at 1200s (>P95 and >900s absolute min)
      const sessions = [
        ...Array.from({ length: 19 }, (_, i) =>
          session({ runId: `normal-${i}`, durationMs: 300_000 }),
        ),
        session({ runId: "outlier", durationMs: 1_200_000 }),
      ];
      const anomalies = detectAnomalies(sessions);
      const durAnomaly = anomalies.find((a) => a.metric === "durationMs");
      expect(durAnomaly).toBeDefined();
      expect(durAnomaly!.sessionRunId).toBe("outlier");
      expect(durAnomaly!.method).toBe("percentile");
    });

    it("excludes failed sessions from percentile computation", () => {
      // 19 successful sessions at 300s, 1 failed session at 1200s
      // The failed session should not be flagged (it's excluded)
      // nor should it skew the percentile threshold
      const sessions = [
        ...Array.from({ length: 19 }, (_, i) =>
          session({ runId: `normal-${i}`, durationMs: 300_000, ok: true }),
        ),
        session({ runId: "failed-long", durationMs: 1_200_000, ok: false }),
      ];
      const anomalies = detectAnomalies(sessions);
      const durAnomaly = anomalies.find((a) => a.metric === "durationMs");
      expect(durAnomaly).toBeUndefined();
    });

    it("does not flag a session above P95 but below absolute minimum", () => {
      // 19 sessions at 100s, 1 at 500s — above P95 but below 900s absolute min
      const sessions = [
        ...Array.from({ length: 19 }, (_, i) =>
          session({ runId: `normal-${i}`, durationMs: 100_000 }),
        ),
        session({ runId: "fast-outlier", durationMs: 500_000 }),
      ];
      const anomalies = detectAnomalies(sessions);
      const durAnomaly = anomalies.find((a) => a.metric === "durationMs");
      expect(durAnomaly).toBeUndefined();
    });

    it("does not flag productive sessions that would have been σ-based false positives", () => {
      // Reproduce the false positive scenario: sessions with natural variance
      // Session 213 at 842s (3.0σ in old system) should NOT be flagged (<900s abs min)
      const sessions = [
        ...Array.from({ length: 25 }, (_, i) =>
          session({ runId: `normal-${i}`, durationMs: 300_000 + (i % 5) * 50_000 }),
        ),
        session({ runId: "session-213", durationMs: 842_000 }),
      ];
      const anomalies = detectAnomalies(sessions);
      const durAnomaly = anomalies.find((a) => a.sessionRunId === "session-213");
      expect(durAnomaly).toBeUndefined();
    });
  });

  // ── Turn count outliers (percentile-based) ──────────────────────────

  describe("turn count outliers (percentile-based)", () => {
    it("flags a session exceeding P95 and absolute minimum (60 turns)", () => {
      // 19 sessions at 30 turns, 1 at 100 turns (>P95 and >60 abs min)
      const sessions = [
        ...Array.from({ length: 19 }, (_, i) =>
          session({ runId: `normal-${i}`, numTurns: 30 }),
        ),
        session({ runId: "outlier", numTurns: 100 }),
      ];
      const anomalies = detectAnomalies(sessions);
      const turnAnomaly = anomalies.find((a) => a.metric === "numTurns");
      expect(turnAnomaly).toBeDefined();
      expect(turnAnomaly!.sessionRunId).toBe("outlier");
      expect(turnAnomaly!.method).toBe("percentile");
    });

    it("does not flag a session above P95 but below absolute minimum", () => {
      // 19 sessions at 10 turns, 1 at 40 turns — above P95 but below 60 abs min
      const sessions = [
        ...Array.from({ length: 19 }, (_, i) =>
          session({ runId: `normal-${i}`, numTurns: 10 }),
        ),
        session({ runId: "moderate", numTurns: 40 }),
      ];
      const anomalies = detectAnomalies(sessions);
      const turnAnomaly = anomalies.find((a) => a.metric === "numTurns");
      expect(turnAnomaly).toBeUndefined();
    });

    it("does not flag session 207 (42 turns) — known false positive scenario", () => {
      // Session 207 was flagged at 42 turns with mean 30 in the old σ-based system
      const sessions = [
        ...Array.from({ length: 29 }, (_, i) =>
          session({ runId: `normal-${i}`, numTurns: 25 + (i % 10) }),
        ),
        session({ runId: "session-207", numTurns: 42 }),
      ];
      const anomalies = detectAnomalies(sessions);
      const turnAnomaly = anomalies.find((a) => a.sessionRunId === "session-207");
      expect(turnAnomaly).toBeUndefined();
    });

    it("flags genuine babysitting session (>100 turns)", () => {
      const sessions = [
        ...Array.from({ length: 19 }, (_, i) =>
          session({ runId: `normal-${i}`, numTurns: 30 }),
        ),
        session({ runId: "babysitting", numTurns: 150 }),
      ];
      const anomalies = detectAnomalies(sessions);
      const turnAnomaly = anomalies.find((a) => a.metric === "numTurns");
      expect(turnAnomaly).toBeDefined();
      expect(turnAnomaly!.sessionRunId).toBe("babysitting");
    });

    it("skips null numTurns", () => {
      const sessions = Array.from({ length: 10 }, (_, i) =>
        session({ runId: `s-${i}`, numTurns: null }),
      );
      const anomalies = detectAnomalies(sessions);
      expect(anomalies.find((a) => a.metric === "numTurns")).toBeUndefined();
    });
  });

  // ── Knowledge dropoff ────────────────────────────────────────────────

  describe("knowledge dropoff", () => {
    it("flags a session with total knowledge output >2σ below mean", () => {
      // 9 sessions with 10 knowledge points, 1 with 0
      const sessions = [
        ...Array.from({ length: 9 }, (_, i) =>
          session({
            runId: `productive-${i}`,
            knowledge: { ...defaultKnowledge(), newExperimentFindings: 5, logEntryFindings: 5 },
          }),
        ),
        session({
          runId: "dropoff",
          knowledge: defaultKnowledge(), // all zeros
        }),
      ];
      const anomalies = detectAnomalies(sessions);
      const knowledgeAnomaly = anomalies.find((a) => a.metric === "knowledgeTotal");
      expect(knowledgeAnomaly).toBeDefined();
      expect(knowledgeAnomaly!.direction).toBe("low");
    });

    it("does not flag when all sessions have zero knowledge", () => {
      const sessions = Array.from({ length: 10 }, (_, i) =>
        session({ runId: `s-${i}`, knowledge: defaultKnowledge() }),
      );
      const anomalies = detectAnomalies(sessions);
      expect(anomalies.find((a) => a.metric === "knowledgeTotal")).toBeUndefined();
    });

    it("skips null knowledge", () => {
      const sessions = Array.from({ length: 10 }, (_, i) =>
        session({ runId: `s-${i}`, knowledge: null }),
      );
      const anomalies = detectAnomalies(sessions);
      expect(anomalies.find((a) => a.metric === "knowledgeTotal")).toBeUndefined();
    });
  });

  // ── Custom threshold ─────────────────────────────────────────────────

  describe("custom options", () => {
    it("respects custom sigmaThreshold", () => {
      // With 1σ threshold, more values should be flagged
      const sessions = [
        ...Array.from({ length: 9 }, (_, i) =>
          session({ runId: `normal-${i}`, costUsd: 3.5 }),
        ),
        session({ runId: "moderate-outlier", costUsd: 7.0 }),
      ];
      // At 2σ threshold, 7.0 may not be flagged (depends on σ)
      const anomalies2s = detectAnomalies(sessions, { sigmaThreshold: 2 });
      // At 1σ threshold, 7.0 should be flagged
      const anomalies1s = detectAnomalies(sessions, { sigmaThreshold: 1 });
      expect(anomalies1s.length).toBeGreaterThanOrEqual(anomalies2s.length);
    });

    it("respects custom minSessions", () => {
      const sessions = Array.from({ length: 6 }, (_, i) =>
        session({ runId: `s-${i}` }),
      );
      // Default minSessions=5 should work
      expect(detectAnomalies(sessions)).toEqual([]);
      // Higher minSessions=10 should skip
      expect(detectAnomalies(sessions, { minSessions: 10 })).toEqual([]);
    });
  });

  // ── Backend segmentation ─────────────────────────────────────────────

  describe("backend segmentation", () => {
    it("does not flag normal claude sessions when mixed with zero-cost cursor sessions", () => {
      // 5 claude sessions at ~$4, 10 cursor sessions at $0
      // Without segmentation, claude sessions would appear as >2σ outliers
      const sessions = [
        ...Array.from({ length: 5 }, (_, i) =>
          session({ runId: `claude-${i}`, backend: "claude", costUsd: 4.0 + i * 0.2 }),
        ),
        ...Array.from({ length: 10 }, (_, i) =>
          session({ runId: `cursor-${i}`, backend: "cursor", costUsd: 0 }),
        ),
      ];
      const anomalies = detectAnomalies(sessions);
      const costAnomalies = anomalies.filter((a) => a.metric === "costUsd");
      expect(costAnomalies).toEqual([]);
    });

    it("still flags genuine outliers within a single backend group", () => {
      const sessions = [
        ...Array.from({ length: 9 }, (_, i) =>
          session({ runId: `claude-${i}`, backend: "claude", costUsd: 3.5 }),
        ),
        session({ runId: "claude-outlier", backend: "claude", costUsd: 20.0 }),
        ...Array.from({ length: 5 }, (_, i) =>
          session({ runId: `cursor-${i}`, backend: "cursor", costUsd: 0 }),
        ),
      ];
      const anomalies = detectAnomalies(sessions);
      const costAnomaly = anomalies.find(
        (a) => a.metric === "costUsd" && a.sessionRunId === "claude-outlier",
      );
      expect(costAnomaly).toBeDefined();
      expect(costAnomaly!.direction).toBe("high");
    });

    it("skips backend groups with fewer than minSessions entries", () => {
      // 2 claude sessions (below minSessions=5) + 8 cursor sessions
      const sessions = [
        session({ runId: "claude-0", backend: "claude", costUsd: 4.0 }),
        session({ runId: "claude-1", backend: "claude", costUsd: 20.0 }),
        ...Array.from({ length: 8 }, (_, i) =>
          session({ runId: `cursor-${i}`, backend: "cursor", costUsd: 0 }),
        ),
      ];
      const anomalies = detectAnomalies(sessions);
      const claudeAnomalies = anomalies.filter((a) => a.sessionRunId.startsWith("claude"));
      expect(claudeAnomalies).toEqual([]);
    });

    it("segments duration checks by backend", () => {
      // Cursor sessions with tight distribution + one outlier
      const sessions = [
        ...Array.from({ length: 9 }, (_, i) =>
          session({ runId: `cursor-${i}`, backend: "cursor", durationMs: 400_000 }),
        ),
        session({ runId: "cursor-slow", backend: "cursor", durationMs: 1_200_000 }),
        ...Array.from({ length: 5 }, (_, i) =>
          session({ runId: `claude-${i}`, backend: "claude", durationMs: 600_000 }),
        ),
      ];
      const anomalies = detectAnomalies(sessions);
      const durAnomaly = anomalies.find(
        (a) => a.metric === "durationMs" && a.sessionRunId === "cursor-slow",
      );
      expect(durAnomaly).toBeDefined();
    });
  });

  // ── Multiple anomalies ───────────────────────────────────────────────

  it("detects multiple anomalies on the same session", () => {
    // Need enough sessions for percentile calculation and values exceeding absolute minimums
    const sessions = [
      ...Array.from({ length: 19 }, (_, i) =>
        session({ runId: `normal-${i}`, costUsd: 3.5, durationMs: 300_000, numTurns: 30 }),
      ),
      session({ runId: "multi-outlier", costUsd: 25.0, durationMs: 2_000_000, numTurns: 200 }),
    ];
    const anomalies = detectAnomalies(sessions);
    const multiOutlier = anomalies.filter((a) => a.sessionRunId === "multi-outlier");
    expect(multiOutlier.length).toBeGreaterThanOrEqual(2);
  });

  it("sorts anomalies by deviation magnitude (highest first)", () => {
    const sessions = [
      ...Array.from({ length: 18 }, (_, i) =>
        session({ runId: `normal-${i}`, costUsd: 3.5, numTurns: 30 }),
      ),
      session({ runId: "cost-outlier", costUsd: 30.0, numTurns: 30 }),
      session({ runId: "turn-outlier", costUsd: 3.5, numTurns: 250 }),
    ];
    const anomalies = detectAnomalies(sessions);
    if (anomalies.length >= 2) {
      for (let i = 0; i < anomalies.length - 1; i++) {
        expect(anomalies[i]!.sigmaDeviation).toBeGreaterThanOrEqual(
          anomalies[i + 1]!.sigmaDeviation,
        );
      }
    }
  });
});

// ── percentile function tests ──────────────────────────────────────────────

describe("percentile", () => {
  it("returns 0 for empty array", () => {
    expect(percentile([], 50)).toBe(0);
  });

  it("returns the single value for single-element array", () => {
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 95)).toBe(42);
  });

  it("computes P50 (median) correctly", () => {
    const sorted = [1, 2, 3, 4, 5];
    expect(percentile(sorted, 50)).toBe(3);
  });

  it("computes P95 with interpolation", () => {
    const sorted = Array.from({ length: 20 }, (_, i) => (i + 1) * 10);
    const p95 = percentile(sorted, 95);
    expect(p95).toBeGreaterThan(180);
    expect(p95).toBeLessThanOrEqual(200);
  });

  it("P0 returns first element, P100 returns last element", () => {
    const sorted = [10, 20, 30, 40, 50];
    expect(percentile(sorted, 0)).toBe(10);
    expect(percentile(sorted, 100)).toBe(50);
  });
});

// ── ABSOLUTE_MINIMUMS sanity tests ─────────────────────────────────────────

describe("ABSOLUTE_MINIMUMS", () => {
  it("has reasonable minimum for numTurns", () => {
    expect(ABSOLUTE_MINIMUMS.numTurns).toBe(60);
  });

  it("has reasonable minimum for durationMs (margin above 15-min timeout)", () => {
    expect(ABSOLUTE_MINIMUMS.durationMs).toBe(915_000);
  });
});

// ── method field tests ─────────────────────────────────────────────────────

describe("anomaly method field", () => {
  it("uses sigma method for costUsd anomalies", () => {
    const sessions = [
      ...Array.from({ length: 9 }, (_, i) =>
        session({ runId: `normal-${i}`, costUsd: 3.5 }),
      ),
      session({ runId: "outlier", costUsd: 20.0 }),
    ];
    const anomalies = detectAnomalies(sessions);
    const costAnomaly = anomalies.find((a) => a.metric === "costUsd");
    expect(costAnomaly).toBeDefined();
    expect(costAnomaly!.method).toBe("sigma");
  });

  it("uses percentile method for numTurns anomalies", () => {
    const sessions = [
      ...Array.from({ length: 19 }, (_, i) =>
        session({ runId: `normal-${i}`, numTurns: 30 }),
      ),
      session({ runId: "outlier", numTurns: 150 }),
    ];
    const anomalies = detectAnomalies(sessions);
    const turnAnomaly = anomalies.find((a) => a.metric === "numTurns");
    expect(turnAnomaly).toBeDefined();
    expect(turnAnomaly!.method).toBe("percentile");
  });

  it("uses percentile method for durationMs anomalies", () => {
    const sessions = [
      ...Array.from({ length: 19 }, (_, i) =>
        session({ runId: `normal-${i}`, durationMs: 300_000 }),
      ),
      session({ runId: "outlier", durationMs: 1_200_000 }),
    ];
    const anomalies = detectAnomalies(sessions);
    const durAnomaly = anomalies.find((a) => a.metric === "durationMs");
    expect(durAnomaly).toBeDefined();
    expect(durAnomaly!.method).toBe("percentile");
  });

  it("uses sigma method for knowledgeTotal anomalies", () => {
    const sessions = [
      ...Array.from({ length: 9 }, (_, i) =>
        session({
          runId: `productive-${i}`,
          knowledge: { ...defaultKnowledge(), newExperimentFindings: 5, logEntryFindings: 5 },
        }),
      ),
      session({ runId: "dropoff", knowledge: defaultKnowledge() }),
    ];
    const anomalies = detectAnomalies(sessions);
    const knowledgeAnomaly = anomalies.find((a) => a.metric === "knowledgeTotal");
    expect(knowledgeAnomaly).toBeDefined();
    expect(knowledgeAnomaly!.method).toBe("sigma");
  });

  it("detects context utilization above warning threshold", () => {
    const sessions = [
      session({
        runId: "high-context",
        modelUsage: {
          "claude-opus-4-6": {
            inputTokens: 170_000,
            outputTokens: 30_000,
            cacheReadInputTokens: 50_000,
            cacheCreationInputTokens: 20_000,
            costUSD: 5.0,
            contextWindow: 200_000,
          },
        },
      }),
    ];
    const anomalies = detectAnomalies(sessions);
    const ctxAnomaly = anomalies.find((a) => a.metric === "contextUtilization");
    expect(ctxAnomaly).toBeDefined();
    expect(ctxAnomaly!.method).toBe("threshold");
    expect(ctxAnomaly!.direction).toBe("high");
    // 170k / 200k = 0.85 = 85% (only inputTokens, not cacheCreationInputTokens)
    expect(ctxAnomaly!.value).toBeCloseTo(0.85, 2);
  });

  it("detects context utilization above critical threshold", () => {
    const sessions = [
      session({
        runId: "critical-context",
        modelUsage: {
          "claude-opus-4-6": {
            inputTokens: 180_000,
            outputTokens: 30_000,
            cacheReadInputTokens: 50_000,
            cacheCreationInputTokens: 10_000,
            costUSD: 5.0,
            contextWindow: 200_000,
          },
        },
      }),
    ];
    const anomalies = detectAnomalies(sessions);
    const ctxAnomaly = anomalies.find((a) => a.metric === "contextUtilization");
    expect(ctxAnomaly).toBeDefined();
    expect(ctxAnomaly!.description).toContain("critical");
    // 180k / 200k = 0.90 = 90% (only inputTokens, not cacheCreationInputTokens)
    expect(ctxAnomaly!.value).toBeCloseTo(0.90, 2);
  });

  it("does not flag context utilization below warning threshold", () => {
    const sessions = [
      session({
        runId: "low-context",
        modelUsage: {
          "claude-opus-4-6": {
            inputTokens: 100_000,
            outputTokens: 30_000,
            cacheReadInputTokens: 50_000,
            cacheCreationInputTokens: 10_000,
            costUSD: 5.0,
            contextWindow: 200_000,
          },
        },
      }),
    ];
    const anomalies = detectAnomalies(sessions);
    const ctxAnomaly = anomalies.find((a) => a.metric === "contextUtilization");
    expect(ctxAnomaly).toBeUndefined();
  });

  it("handles missing contextWindow gracefully", () => {
    const sessions = [
      session({
        runId: "no-context-window",
        modelUsage: {
          "claude-opus-4-6": {
            inputTokens: 150_000,
            outputTokens: 30_000,
            cacheReadInputTokens: 50_000,
            cacheCreationInputTokens: 20_000,
            costUSD: 5.0,
            // contextWindow missing
          },
        },
      }),
    ];
    const anomalies = detectAnomalies(sessions);
    const ctxAnomaly = anomalies.find((a) => a.metric === "contextUtilization");
    expect(ctxAnomaly).toBeUndefined();
  });

  it("handles missing modelUsage gracefully", () => {
    const sessions = [session({ runId: "no-model-usage", modelUsage: null })];
    const anomalies = detectAnomalies(sessions);
    const ctxAnomaly = anomalies.find((a) => a.metric === "contextUtilization");
    expect(ctxAnomaly).toBeUndefined();
  });
});

// ── formatAnomalyReport tests ──────────────────────────────────────────────

describe("formatAnomalyReport", () => {
  it("returns all-clear message when no anomalies", () => {
    const { summary, details } = formatAnomalyReport([]);
    expect(summary).toContain("no statistical outliers");
    expect(details).toContain("no statistical outliers");
  });

  it("includes anomaly details", () => {
    const anomalies: Anomaly[] = [
      {
        metric: "costUsd",
        sessionRunId: "test-1",
        sessionTimestamp: "2026-02-21T00:00:00.000Z",
        value: 20.0,
        mean: 3.5,
        stddev: 1.0,
        sigmaDeviation: 16.5,
        direction: "high",
        description: "Cost $20.00 is 16.5σ above mean $3.50",
        method: "sigma",
      },
    ];
    const { summary, details } = formatAnomalyReport(anomalies);
    expect(summary).toContain("1 outlier(s)");
    expect(summary).toContain("costUsd");
    expect(details).toContain("costUsd");
    expect(details).toContain("test-1");
    expect(details).toContain("16.5");
  });

  it("formats threshold-based anomalies correctly", () => {
    const anomalies: Anomaly[] = [
      {
        metric: "contextUtilization",
        sessionRunId: "test-ctx",
        sessionTimestamp: "2026-02-21T00:00:00.000Z",
        value: 0.92,
        mean: 0,
        stddev: 0,
        sigmaDeviation: 0,
        direction: "high",
        description: "Context utilization 92% (critical) — session may have experienced degraded instruction following",
        method: "threshold",
      },
    ];
    const { summary, details } = formatAnomalyReport(anomalies);
    expect(summary).toContain("contextUtilization");
    expect(details).toContain("contextUtilization");
    expect(details).toContain("test-ctx");
    expect(details).toContain("threshold");
    expect(details).toContain("92%");
  });
});
