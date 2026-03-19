/** Tests for recurring verification warning escalation. */

import { describe, it, expect } from "vitest";
import {
  detectRecurringWarnings,
  formatEscalationReport,
  type WarningEscalation,
  type EscalationOpts,
} from "./warning-escalation.js";
import type { SessionMetrics, VerificationMetrics, KnowledgeMetrics } from "./metrics.js";

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
    warningCount: 0,
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

// ── detectRecurringWarnings tests ─────────────────────────────────────────

describe("detectRecurringWarnings", () => {
  it("returns empty array when no sessions", () => {
    expect(detectRecurringWarnings([])).toEqual([]);
  });

  it("returns empty array when all verifications are clean", () => {
    const sessions = Array.from({ length: 10 }, (_, i) =>
      session({ runId: `s-${i}`, timestamp: `2026-02-21T0${i}:00:00.000Z` }),
    );
    expect(detectRecurringWarnings(sessions)).toEqual([]);
  });

  it("returns empty array when sessions have null verification", () => {
    const sessions = Array.from({ length: 10 }, (_, i) =>
      session({ runId: `s-${i}`, verification: null }),
    );
    expect(detectRecurringWarnings(sessions)).toEqual([]);
  });

  // ── no_log_entry recurrence ─────────────────────────────────────────

  describe("no_log_entry", () => {
    it("flags when hasLogEntry is false in >3 sessions", () => {
      const sessions = Array.from({ length: 5 }, (_, i) =>
        session({
          runId: `s-${i}`,
          timestamp: `2026-02-21T0${i}:00:00.000Z`,
          verification: { ...defaultVerification(), hasLogEntry: false, warningCount: 1 },
        }),
      );
      const escalations = detectRecurringWarnings(sessions);
      const found = escalations.find((e) => e.warningType === "no_log_entry");
      expect(found).toBeDefined();
      expect(found!.occurrences).toBe(5);
      expect(found!.severity).toBe("medium");
    });

    it("does not flag when hasLogEntry is false in exactly 3 sessions", () => {
      const sessions = [
        ...Array.from({ length: 3 }, (_, i) =>
          session({
            runId: `bad-${i}`,
            timestamp: `2026-02-21T0${i}:00:00.000Z`,
            verification: { ...defaultVerification(), hasLogEntry: false, warningCount: 1 },
          }),
        ),
        ...Array.from({ length: 7 }, (_, i) =>
          session({
            runId: `ok-${i}`,
            timestamp: `2026-02-21T0${i + 3}:00:00.000Z`,
          }),
        ),
      ];
      const escalations = detectRecurringWarnings(sessions);
      expect(escalations.find((e) => e.warningType === "no_log_entry")).toBeUndefined();
    });
  });

  // ── no_commit recurrence ────────────────────────────────────────────

  describe("no_commit", () => {
    it("flags when hasCommit is false in >3 sessions", () => {
      const sessions = Array.from({ length: 4 }, (_, i) =>
        session({
          runId: `s-${i}`,
          timestamp: `2026-02-21T0${i}:00:00.000Z`,
          verification: { ...defaultVerification(), hasCommit: false, warningCount: 1 },
        }),
      );
      const escalations = detectRecurringWarnings(sessions);
      const found = escalations.find((e) => e.warningType === "no_commit");
      expect(found).toBeDefined();
      expect(found!.occurrences).toBe(4);
    });
  });

  // ── incomplete_footer recurrence ────────────────────────────────────

  describe("incomplete_footer", () => {
    it("flags when hasCompleteFooter is false in >3 sessions", () => {
      const sessions = Array.from({ length: 4 }, (_, i) =>
        session({
          runId: `s-${i}`,
          timestamp: `2026-02-21T0${i}:00:00.000Z`,
          verification: { ...defaultVerification(), hasCompleteFooter: false, warningCount: 1 },
        }),
      );
      const escalations = detectRecurringWarnings(sessions);
      expect(escalations.find((e) => e.warningType === "incomplete_footer")).toBeDefined();
    });
  });

  // ── ledger_inconsistent recurrence ──────────────────────────────────

  describe("ledger_inconsistent", () => {
    it("flags when ledgerConsistent is false in >3 sessions", () => {
      const sessions = Array.from({ length: 4 }, (_, i) =>
        session({
          runId: `s-${i}`,
          timestamp: `2026-02-21T0${i}:00:00.000Z`,
          verification: { ...defaultVerification(), ledgerConsistent: false, warningCount: 1 },
        }),
      );
      const escalations = detectRecurringWarnings(sessions);
      expect(escalations.find((e) => e.warningType === "ledger_inconsistent")).toBeDefined();
    });
  });

  // ── orphaned_files recurrence ───────────────────────────────────────

  describe("orphaned_files", () => {
    it("flags when orphanedFiles > 0 in >3 sessions", () => {
      const sessions = Array.from({ length: 5 }, (_, i) =>
        session({
          runId: `s-${i}`,
          timestamp: `2026-02-21T0${i}:00:00.000Z`,
          verification: { ...defaultVerification(), orphanedFiles: 2, warningCount: 1 },
        }),
      );
      const escalations = detectRecurringWarnings(sessions);
      expect(escalations.find((e) => e.warningType === "orphaned_files")).toBeDefined();
    });

    it("does not flag when orphanedFiles is 0", () => {
      const sessions = Array.from({ length: 5 }, (_, i) =>
        session({
          runId: `s-${i}`,
          timestamp: `2026-02-21T0${i}:00:00.000Z`,
        }),
      );
      const escalations = detectRecurringWarnings(sessions);
      expect(escalations.find((e) => e.warningType === "orphaned_files")).toBeUndefined();
    });
  });

  // ── Multiple warning types ──────────────────────────────────────────

  it("detects multiple recurring warning types simultaneously", () => {
    const sessions = Array.from({ length: 5 }, (_, i) =>
      session({
        runId: `s-${i}`,
        timestamp: `2026-02-21T0${i}:00:00.000Z`,
        verification: {
          ...defaultVerification(),
          hasLogEntry: false,
          hasCompleteFooter: false,
          orphanedFiles: 3,
          warningCount: 3,
        },
      }),
    );
    const escalations = detectRecurringWarnings(sessions);
    expect(escalations.length).toBe(3);
    const types = escalations.map((e) => e.warningType).sort();
    expect(types).toEqual(["incomplete_footer", "no_log_entry", "orphaned_files"]);
  });

  // ── Custom threshold ────────────────────────────────────────────────

  it("respects custom recurrence threshold", () => {
    const sessions = Array.from({ length: 2 }, (_, i) =>
      session({
        runId: `s-${i}`,
        timestamp: `2026-02-21T0${i}:00:00.000Z`,
        verification: { ...defaultVerification(), hasLogEntry: false, warningCount: 1 },
      }),
    );
    const opts: EscalationOpts = { recurrenceThreshold: 1 };
    const escalations = detectRecurringWarnings(sessions, opts);
    expect(escalations.find((e) => e.warningType === "no_log_entry")).toBeDefined();
  });

  // ── Skips failed sessions ───────────────────────────────────────────

  it("skips sessions where ok is false (failures have unreliable verification)", () => {
    const sessions = Array.from({ length: 5 }, (_, i) =>
      session({
        runId: `s-${i}`,
        timestamp: `2026-02-21T0${i}:00:00.000Z`,
        ok: false,
        verification: { ...defaultVerification(), hasLogEntry: false, warningCount: 1 },
      }),
    );
    const escalations = detectRecurringWarnings(sessions);
    // Failed sessions should be excluded — no log entry is expected when the session failed
    expect(escalations).toEqual([]);
  });

  // ── Includes session timestamps ─────────────────────────────────────

  it("includes timestamps of affected sessions", () => {
    const sessions = Array.from({ length: 4 }, (_, i) =>
      session({
        runId: `s-${i}`,
        timestamp: `2026-02-21T0${i}:00:00.000Z`,
        verification: { ...defaultVerification(), hasLogEntry: false, warningCount: 1 },
      }),
    );
    const escalations = detectRecurringWarnings(sessions);
    const found = escalations.find((e) => e.warningType === "no_log_entry");
    expect(found).toBeDefined();
    expect(found!.sessionTimestamps).toHaveLength(4);
    expect(found!.sessionTimestamps[0]).toBe("2026-02-21T00:00:00.000Z");
  });

  // ── Skips idle exploration sessions ─────────────────────────────────

  it("skips idle exploration sessions (zero commits are by design)", () => {
    const sessions = Array.from({ length: 5 }, (_, i) =>
      session({
        runId: `idle-${i}`,
        timestamp: `2026-02-21T0${i}:00:00.000Z`,
        isIdle: true,
        explorationType: "horizon-scan",
        verification: {
          ...defaultVerification(),
          hasCommit: false,
          hasLogEntry: false,
          hasCompleteFooter: false,
          warningCount: 3,
        },
      }),
    );
    const escalations = detectRecurringWarnings(sessions);
    expect(escalations).toEqual([]);
  });

  it("counts warnings from non-idle sessions even when idle sessions are present", () => {
    const sessions = [
      ...Array.from({ length: 4 }, (_, i) =>
        session({
          runId: `task-${i}`,
          timestamp: `2026-02-21T0${i}:00:00.000Z`,
          verification: { ...defaultVerification(), hasCommit: false, warningCount: 1 },
        }),
      ),
      ...Array.from({ length: 4 }, (_, i) =>
        session({
          runId: `idle-${i}`,
          timestamp: `2026-02-21T0${i + 4}:00:00.000Z`,
          isIdle: true,
          verification: { ...defaultVerification(), hasCommit: false, warningCount: 1 },
        }),
      ),
    ];
    const escalations = detectRecurringWarnings(sessions);
    const found = escalations.find((e) => e.warningType === "no_commit");
    expect(found).toBeDefined();
    expect(found!.occurrences).toBe(4);
  });

  // ── Skips no-work sessions ───────────────────────────────────────────

  it("skips no-work sessions (zero commits, zero files changed, zero orphaned files)", () => {
    const sessions = Array.from({ length: 5 }, (_, i) =>
      session({
        runId: `nowork-${i}`,
        timestamp: `2026-02-21T0${i}:00:00.000Z`,
        verification: {
          ...defaultVerification(),
          hasCommit: false,
          commitCount: 0,
          filesChanged: 0,
          orphanedFiles: 0,
          warningCount: 1,
        },
      }),
    );
    const escalations = detectRecurringWarnings(sessions);
    expect(escalations).toEqual([]);
  });

  it("flags sessions with orphaned files even when commitCount and filesChanged are zero", () => {
    const sessions = Array.from({ length: 5 }, (_, i) =>
      session({
        runId: `orphan-${i}`,
        timestamp: `2026-02-21T0${i}:00:00.000Z`,
        verification: {
          ...defaultVerification(),
          hasCommit: false,
          commitCount: 0,
          filesChanged: 0,
          orphanedFiles: 3,
          warningCount: 4,
        },
      }),
    );
    const escalations = detectRecurringWarnings(sessions);
    // Should still flag because orphanedFiles > 0 (session produced output but didn't commit it)
    expect(escalations.find((e) => e.warningType === "no_commit")).toBeDefined();
    expect(escalations.find((e) => e.warningType === "orphaned_files")).toBeDefined();
  });

  // ── Skips fleet sessions for incomplete_footer ───────────────────────

  it("skips fleet sessions for incomplete_footer (expected behavior)", () => {
    const sessions = Array.from({ length: 5 }, (_, i) =>
      session({
        runId: `fleet-${i}`,
        timestamp: `2026-02-21T0${i}:00:00.000Z`,
        triggerSource: "fleet",
        verification: {
          ...defaultVerification(),
          hasCompleteFooter: false,
          warningCount: 1,
        },
      }),
    );
    const escalations = detectRecurringWarnings(sessions);
    expect(escalations.find((e) => e.warningType === "incomplete_footer")).toBeUndefined();
  });

  it("skips fleet sessions for no_log_entry (expected behavior)", () => {
    const sessions = Array.from({ length: 5 }, (_, i) =>
      session({
        runId: `fleet-${i}`,
        timestamp: `2026-02-21T0${i}:00:00.000Z`,
        triggerSource: "fleet",
        verification: {
          ...defaultVerification(),
          hasLogEntry: false,
          warningCount: 1,
        },
      }),
    );
    const escalations = detectRecurringWarnings(sessions);
    expect(escalations.find((e) => e.warningType === "no_log_entry")).toBeUndefined();
  });

  it("skips fleet sessions for orphaned_files (expected concurrent worker behavior)", () => {
    const sessions = Array.from({ length: 5 }, (_, i) =>
      session({
        runId: `fleet-${i}`,
        timestamp: `2026-02-21T0${i}:00:00.000Z`,
        triggerSource: "fleet",
        verification: {
          ...defaultVerification(),
          orphanedFiles: 3,
          warningCount: 1,
        },
      }),
    );
    const escalations = detectRecurringWarnings(sessions);
    expect(escalations.find((e) => e.warningType === "orphaned_files")).toBeUndefined();
  });

  it("still flags non-fleet sessions with orphaned_files", () => {
    const sessions = Array.from({ length: 4 }, (_, i) =>
      session({
        runId: `opus-${i}`,
        timestamp: `2026-02-21T0${i}:00:00.000Z`,
        triggerSource: "scheduler",
        verification: {
          ...defaultVerification(),
          orphanedFiles: 2,
          warningCount: 1,
        },
      }),
    );
    const escalations = detectRecurringWarnings(sessions);
    expect(escalations.find((e) => e.warningType === "orphaned_files")).toBeDefined();
  });

  it("still flags non-fleet sessions with incomplete_footer", () => {
    const sessions = Array.from({ length: 4 }, (_, i) =>
      session({
        runId: `opus-${i}`,
        timestamp: `2026-02-21T0${i}:00:00.000Z`,
        triggerSource: "scheduler",
        verification: {
          ...defaultVerification(),
          hasCompleteFooter: false,
          warningCount: 1,
        },
      }),
    );
    const escalations = detectRecurringWarnings(sessions);
    expect(escalations.find((e) => e.warningType === "incomplete_footer")).toBeDefined();
  });

  it("counts non-fleet incomplete_footer even when fleet sessions are present", () => {
    const sessions = [
      ...Array.from({ length: 5 }, (_, i) =>
        session({
          runId: `fleet-${i}`,
          timestamp: `2026-02-21T0${i}:00:00.000Z`,
          triggerSource: "fleet",
          verification: {
            ...defaultVerification(),
            hasCompleteFooter: false,
            warningCount: 1,
          },
        }),
      ),
      ...Array.from({ length: 4 }, (_, i) =>
        session({
          runId: `opus-${i}`,
          timestamp: `2026-02-21T0${i + 5}:00:00.000Z`,
          triggerSource: "scheduler",
          verification: {
            ...defaultVerification(),
            hasCompleteFooter: false,
            warningCount: 1,
          },
        }),
      ),
    ];
    const escalations = detectRecurringWarnings(sessions);
    const found = escalations.find((e) => e.warningType === "incomplete_footer");
    expect(found).toBeDefined();
    expect(found!.occurrences).toBe(4);
  });

  // ── Sorting ─────────────────────────────────────────────────────────

  it("sorts by occurrence count descending", () => {
    // 5 sessions missing log + footer, 4 with orphaned files
    const sessions = [
      ...Array.from({ length: 5 }, (_, i) =>
        session({
          runId: `a-${i}`,
          timestamp: `2026-02-21T0${i}:00:00.000Z`,
          verification: {
            ...defaultVerification(),
            hasLogEntry: false,
            hasCompleteFooter: false,
            orphanedFiles: 1,
            warningCount: 3,
          },
        }),
      ),
    ];
    // Remove orphaned_files from the last session to make it 4 instead of 5
    sessions[4] = session({
      runId: "a-4",
      timestamp: "2026-02-21T04:00:00.000Z",
      verification: {
        ...defaultVerification(),
        hasLogEntry: false,
        hasCompleteFooter: false,
        orphanedFiles: 0,
        warningCount: 2,
      },
    });
    const escalations = detectRecurringWarnings(sessions);
    expect(escalations.length).toBe(3);
    // First two should have 5 occurrences, last should have 4
    expect(escalations[0]!.occurrences).toBe(5);
    expect(escalations[2]!.occurrences).toBe(4);
  });
});

// ── formatEscalationReport tests ──────────────────────────────────────────

describe("formatEscalationReport", () => {
  it("returns all-clear when no escalations", () => {
    const { summary, details } = formatEscalationReport([]);
    expect(summary).toContain("all clear");
    expect(details).toContain("all clear");
  });

  it("includes warning type and occurrence count", () => {
    const escalations: WarningEscalation[] = [
      {
        warningType: "no_log_entry",
        description: "No project README log entry",
        occurrences: 5,
        severity: "medium",
        recommendation: "Check if sessions are writing log entries.",
        sessionTimestamps: ["2026-02-21T00:00:00.000Z"],
      },
    ];
    const { summary, details } = formatEscalationReport(escalations);
    expect(summary).toContain("1 recurring warning(s)");
    expect(summary).toContain("1 medium");
    expect(details).toContain("no_log_entry");
    expect(details).toContain("5");
  });

  it("includes severity counts in summary", () => {
    const escalations: WarningEscalation[] = [
      {
        warningType: "orphaned_files",
        description: "Orphaned files from previous sessions",
        occurrences: 4,
        severity: "medium",
        recommendation: "Check auto-commit.",
        sessionTimestamps: [],
      },
      {
        warningType: "no_commit",
        description: "No commit in session",
        occurrences: 4,
        severity: "high",
        recommendation: "Check agent.",
        sessionTimestamps: [],
      },
    ];
    const { summary, details } = formatEscalationReport(escalations);
    expect(summary).toContain("2 recurring warning(s)");
    expect(summary).toContain("1 high");
    expect(summary).toContain("1 medium");
    expect(details).toContain("2");
  });
});
