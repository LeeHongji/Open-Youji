/** Tests for cross-session pattern detector. */

import { describe, it, expect } from "vitest";
import { detectPatterns, type DetectedPattern, type PatternDetectorOpts } from "./patterns.js";
import type { SessionMetrics } from "./metrics.js";

/** Build a minimal SessionMetrics with sensible defaults, overridable per-field. */
function session(overrides: Partial<SessionMetrics> = {}): SessionMetrics {
  return {
    timestamp: "2026-02-19T00:00:00Z",
    jobName: "youji-work-cycle",
    runId: "test-1",
    backend: "claude",
    durationMs: 300_000,
    costUsd: 2.0,
    numTurns: 40,
    timedOut: false,
    ok: true,
    verification: {
      uncommittedFiles: 0,
      orphanedFiles: 0,
      hasLogEntry: true,
      hasCommit: true,
      hasCompleteFooter: true,
      ledgerConsistent: true,
      filesChanged: 5,
      commitCount: 2,
          agentCommitCount: 2,
      warningCount: 0,
      l2ViolationCount: 0,
      l2ChecksPerformed: 0,
    },
    knowledge: {
      newExperimentFindings: 2,
      newDecisionRecords: 0,
      newLiteratureNotes: 0,
      openQuestionsResolved: 0,
      openQuestionsDiscovered: 0,
      experimentsCompleted: 0,
      crossReferences: 1,
      newAnalysisFiles: 0,
      logEntryFindings: 0,
      infraCodeChanges: 0,
      bugfixVerifications: 0,
      compoundActions: 0,
      structuralChanges: 0,
      feedbackProcessed: 0,
      diagnosesCompleted: 0,
    },
    budgetGate: { allowed: true },
    modelUsage: null,
    toolCounts: null,
    orientTurns: null,
    crossProject: null,
    qualityAudit: null,
    ...overrides,
  };
}

/** Helper: build a session with specific verification overrides. */
function sessionV(
  vOverrides: Partial<SessionMetrics["verification"] & {}>,
  extra: Partial<SessionMetrics> = {},
): SessionMetrics {
  return session({
    verification: {
      uncommittedFiles: 0,
      orphanedFiles: 0,
      hasLogEntry: true,
      hasCommit: true,
      hasCompleteFooter: true,
      ledgerConsistent: true,
      filesChanged: 5,
      commitCount: 2,
      agentCommitCount: 2,
      warningCount: 0,
      l2ViolationCount: 0,
      l2ChecksPerformed: 0,
      ...vOverrides,
    },
    ...extra,
  });
}

/** Helper: build a session with all-zero knowledge. */
function zeroKnowledgeSession(extra: Partial<SessionMetrics> = {}): SessionMetrics {
  return session({
    knowledge: {
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
    },
    ...extra,
  });
}

describe("detectPatterns", () => {
  it("returns empty array for healthy sessions", () => {
    const sessions = Array.from({ length: 10 }, () => session());
    const patterns = detectPatterns(sessions);
    expect(patterns).toEqual([]);
  });

  it("returns empty array for empty input", () => {
    expect(detectPatterns([])).toEqual([]);
  });

  it("returns empty array for fewer than 3 sessions", () => {
    const sessions = [
      sessionV({ hasCommit: false }),
      sessionV({ hasCommit: false }),
    ];
    expect(detectPatterns(sessions)).toEqual([]);
  });

  // ── Recurring commit failures ──

  it("detects recurring commit failures (3+ of last 10)", () => {
    const sessions = [
      session(),
      sessionV({ hasCommit: false }),
      session(),
      sessionV({ hasCommit: false }),
      session(),
      sessionV({ hasCommit: false }),
    ];
    const patterns = detectPatterns(sessions);
    const commitPattern = patterns.find((p) => p.id === "recurring_no_commit");
    expect(commitPattern).toBeDefined();
    expect(commitPattern!.occurrences).toBe(3);
    expect(commitPattern!.severity).toBe("high");
  });

  it("does not flag commit failures below threshold", () => {
    const sessions = [
      session(),
      sessionV({ hasCommit: false }),
      session(),
      sessionV({ hasCommit: false }),
      session(),
      session(),
    ];
    const patterns = detectPatterns(sessions);
    expect(patterns.find((p) => p.id === "recurring_no_commit")).toBeUndefined();
  });

  it("skips no-work sessions (zero commits, zero files, zero orphans)", () => {
    const sessions = [
      session(),
      sessionV({ hasCommit: false, commitCount: 0, filesChanged: 0, orphanedFiles: 0 }),
      sessionV({ hasCommit: false, commitCount: 0, filesChanged: 0, orphanedFiles: 0 }),
      sessionV({ hasCommit: false, commitCount: 0, filesChanged: 0, orphanedFiles: 0 }),
    ];
    const patterns = detectPatterns(sessions);
    // No-work sessions should not be counted as commit failures
    expect(patterns.find((p) => p.id === "recurring_no_commit")).toBeUndefined();
  });

  it("flags sessions with orphaned files even when commitCount/filesChanged are zero", () => {
    const sessions = [
      session(),
      sessionV({ hasCommit: false, commitCount: 0, filesChanged: 0, orphanedFiles: 3 }),
      sessionV({ hasCommit: false, commitCount: 0, filesChanged: 0, orphanedFiles: 2 }),
      sessionV({ hasCommit: false, commitCount: 0, filesChanged: 0, orphanedFiles: 1 }),
    ];
    const patterns = detectPatterns(sessions);
    // Sessions with orphaned files should be flagged (they produced output but didn't commit)
    expect(patterns.find((p) => p.id === "recurring_no_commit")).toBeDefined();
  });

  // ── Recurring zero-knowledge sessions ──

  it("detects recurring zero-knowledge sessions", () => {
    const sessions = [
      zeroKnowledgeSession(),
      session(),
      zeroKnowledgeSession(),
      zeroKnowledgeSession(),
    ];
    const patterns = detectPatterns(sessions);
    const zeroK = patterns.find((p) => p.id === "recurring_zero_knowledge");
    expect(zeroK).toBeDefined();
    expect(zeroK!.occurrences).toBe(3);
  });

  it("does not flag zero-knowledge when sessions have knowledge", () => {
    const sessions = Array.from({ length: 5 }, () => session());
    const patterns = detectPatterns(sessions);
    expect(patterns.find((p) => p.id === "recurring_zero_knowledge")).toBeUndefined();
  });

  // ── Recurring uncommitted files ──

  it("detects recurring uncommitted files", () => {
    const sessions = [
      sessionV({ uncommittedFiles: 5 }),
      sessionV({ uncommittedFiles: 3 }),
      session(),
      sessionV({ uncommittedFiles: 10 }),
    ];
    const patterns = detectPatterns(sessions);
    const uncomm = patterns.find((p) => p.id === "recurring_uncommitted_files");
    expect(uncomm).toBeDefined();
    expect(uncomm!.occurrences).toBe(3);
    expect(uncomm!.severity).toBe("high");
  });

  // ── Recurring missing log entries ──

  it("detects recurring missing log entries", () => {
    const sessions = [
      sessionV({ hasLogEntry: false }),
      sessionV({ hasLogEntry: false }),
      sessionV({ hasLogEntry: false }),
      session(),
    ];
    const patterns = detectPatterns(sessions);
    const noLog = patterns.find((p) => p.id === "recurring_no_log_entry");
    expect(noLog).toBeDefined();
    expect(noLog!.occurrences).toBe(3);
    expect(noLog!.severity).toBe("medium");
  });

  it("excludes fleet sessions from recurring missing log entries", () => {
    const sessions = [
      sessionV({ hasLogEntry: false }, { triggerSource: "fleet" }),
      sessionV({ hasLogEntry: false }, { triggerSource: "fleet" }),
      sessionV({ hasLogEntry: false }, { triggerSource: "fleet" }),
      session(),
    ];
    const patterns = detectPatterns(sessions);
    expect(patterns.find((p) => p.id === "recurring_no_log_entry")).toBeUndefined();
  });

  it("excludes idle sessions from recurring missing log entries", () => {
    const sessions = [
      sessionV({ hasLogEntry: false }, { isIdle: true }),
      sessionV({ hasLogEntry: false }, { isIdle: true }),
      sessionV({ hasLogEntry: false }, { isIdle: true }),
      session(),
    ];
    const patterns = detectPatterns(sessions);
    expect(patterns.find((p) => p.id === "recurring_no_log_entry")).toBeUndefined();
  });

  // ── Recurring missing footers ──

  it("detects recurring missing session footers", () => {
    const sessions = [
      sessionV({ hasCompleteFooter: false }),
      sessionV({ hasCompleteFooter: false }),
      sessionV({ hasCompleteFooter: false }),
      session(),
      session(),
    ];
    const patterns = detectPatterns(sessions);
    const noFooter = patterns.find((p) => p.id === "recurring_no_footer");
    expect(noFooter).toBeDefined();
    expect(noFooter!.occurrences).toBe(3);
    expect(noFooter!.severity).toBe("low");
  });

  it("excludes fleet sessions from recurring missing footers", () => {
    const sessions = [
      sessionV({ hasCompleteFooter: false }, { triggerSource: "fleet" }),
      sessionV({ hasCompleteFooter: false }, { triggerSource: "fleet" }),
      sessionV({ hasCompleteFooter: false }, { triggerSource: "fleet" }),
      session(),
    ];
    const patterns = detectPatterns(sessions);
    expect(patterns.find((p) => p.id === "recurring_no_footer")).toBeUndefined();
  });

  it("excludes idle sessions from recurring missing footers", () => {
    const sessions = [
      sessionV({ hasCompleteFooter: false }, { isIdle: true }),
      sessionV({ hasCompleteFooter: false }, { isIdle: true }),
      sessionV({ hasCompleteFooter: false }, { isIdle: true }),
      session(),
    ];
    const patterns = detectPatterns(sessions);
    expect(patterns.find((p) => p.id === "recurring_no_footer")).toBeUndefined();
  });

  // ── Recurring timeouts ──

  it("detects recurring timeouts", () => {
    const sessions = [
      session({ timedOut: true }),
      session({ timedOut: true }),
      session({ timedOut: true }),
      session(),
    ];
    const patterns = detectPatterns(sessions);
    const timeouts = patterns.find((p) => p.id === "recurring_timeouts");
    expect(timeouts).toBeDefined();
    expect(timeouts!.occurrences).toBe(3);
    expect(timeouts!.severity).toBe("high");
  });

  // ── Cost anomalies ──

  it("detects recurring high-cost sessions (>2x median)", () => {
    const sessions = [
      session({ costUsd: 2.0 }),
      session({ costUsd: 2.0 }),
      session({ costUsd: 2.0 }),
      session({ costUsd: 2.0 }),
      session({ costUsd: 5.0 }), // 2.5x median
      session({ costUsd: 6.0 }), // 3x median
      session({ costUsd: 7.0 }), // 3.5x median
    ];
    const patterns = detectPatterns(sessions);
    const highCost = patterns.find((p) => p.id === "recurring_high_cost");
    expect(highCost).toBeDefined();
    expect(highCost!.occurrences).toBe(3);
    expect(highCost!.severity).toBe("medium");
  });

  it("does not flag cost anomalies when costs are uniform", () => {
    const sessions = Array.from({ length: 5 }, () =>
      session({ costUsd: 2.0 }),
    );
    const patterns = detectPatterns(sessions);
    expect(patterns.find((p) => p.id === "recurring_high_cost")).toBeUndefined();
  });

  // ── Custom threshold ──

  it("respects custom minOccurrences threshold", () => {
    const sessions = [
      sessionV({ hasCommit: false }),
      sessionV({ hasCommit: false }),
      session(),
    ];
    // Default threshold (3) should not detect
    expect(detectPatterns(sessions).find((p) => p.id === "recurring_no_commit")).toBeUndefined();
    // Lower threshold (2) should detect
    const patterns = detectPatterns(sessions, { minOccurrences: 2 });
    expect(patterns.find((p) => p.id === "recurring_no_commit")).toBeDefined();
  });

  // ── Sessions without verification data ──

  it("gracefully handles sessions with null verification", () => {
    const sessions = [
      session({ verification: null }),
      session({ verification: null }),
      session({ verification: null }),
      session(),
    ];
    // Should not crash; null verification sessions are skipped for verification-based patterns
    const patterns = detectPatterns(sessions);
    expect(Array.isArray(patterns)).toBe(true);
  });

  it("gracefully handles sessions with null knowledge", () => {
    const sessions = [
      session({ knowledge: null }),
      session({ knowledge: null }),
      session({ knowledge: null }),
      session(),
    ];
    const patterns = detectPatterns(sessions);
    expect(Array.isArray(patterns)).toBe(true);
  });

  // ── Multiple patterns simultaneously ──

  it("detects multiple patterns simultaneously", () => {
    const badSession = session({
      timedOut: true,
      verification: {
        uncommittedFiles: 5,
        orphanedFiles: 3,
        hasLogEntry: false,
        hasCommit: false,
        hasCompleteFooter: false,
        ledgerConsistent: true,
        filesChanged: 0,
        commitCount: 0,
        agentCommitCount: 0,
        warningCount: 3,
        l2ViolationCount: 0,
        l2ChecksPerformed: 0,
      },
      knowledge: {
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
      },
    });
    const sessions = [badSession, badSession, badSession, session()];
    const patterns = detectPatterns(sessions);
    // Should detect at least: no_commit, uncommitted_files, no_log_entry, no_footer, timeouts, zero_knowledge
    expect(patterns.length).toBeGreaterThanOrEqual(5);
    const ids = patterns.map((p) => p.id);
    expect(ids).toContain("recurring_no_commit");
    expect(ids).toContain("recurring_uncommitted_files");
    expect(ids).toContain("recurring_no_log_entry");
    expect(ids).toContain("recurring_timeouts");
    expect(ids).toContain("recurring_zero_knowledge");
  });

  // ── Pattern structure ──

  it("returns well-formed pattern objects", () => {
    const sessions = [
      sessionV({ hasCommit: false }),
      sessionV({ hasCommit: false }),
      sessionV({ hasCommit: false }),
    ];
    const patterns = detectPatterns(sessions);
    const p = patterns[0]!;
    expect(typeof p.id).toBe("string");
    expect(typeof p.description).toBe("string");
    expect(typeof p.severity).toBe("string");
    expect(["high", "medium", "low"]).toContain(p.severity);
    expect(typeof p.occurrences).toBe("number");
    expect(typeof p.total).toBe("number");
    expect(p.occurrences).toBeLessThanOrEqual(p.total);
    expect(typeof p.recommendation).toBe("string");
  });

  // ── formatPatterns ──

  it("formats patterns as human-readable string", async () => {
    const { formatPatterns } = await import("./patterns.js");
    const patterns: DetectedPattern[] = [
      {
        id: "recurring_no_commit",
        description: "Sessions ending without commits",
        severity: "high",
        occurrences: 4,
        total: 10,
        recommendation: "Investigate why agents are not committing",
      },
    ];
    const formatted = formatPatterns(patterns);
    expect(formatted).toContain("recurring_no_commit");
    expect(formatted).toContain("4/10");
    expect(formatted).toContain("high");
  });

  it("formatPatterns returns null for empty patterns", async () => {
    const { formatPatterns } = await import("./patterns.js");
    expect(formatPatterns([])).toBeNull();
  });
});
