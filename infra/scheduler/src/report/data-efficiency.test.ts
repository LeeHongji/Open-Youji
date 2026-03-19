import { describe, it, expect } from "vitest";
import { aggregateEfficiency } from "./data-efficiency.js";
import type { SessionMetrics } from "../metrics.js";

function makeSession(overrides: Partial<SessionMetrics> = {}): SessionMetrics {
  return {
    timestamp: "2026-03-05T12:00:00Z",
    sessionId: "test-session",
    backend: "claude",
    ...overrides,
  };
}

describe("aggregateEfficiency", () => {
  describe("fleet worker filtering", () => {
    it("excludes fleet workers from zeroKnowledgeRate", () => {
      const sessions: SessionMetrics[] = [
        makeSession({
          backend: "claude",
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
        }),
        makeSession({
          backend: "opencode",
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
        }),
        makeSession({
          backend: "claude",
          knowledge: {
            newExperimentFindings: 1,
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
        }),
      ];

      const result = aggregateEfficiency(sessions);

      expect(result.zeroKnowledgeRate).toBe(0.5);
      expect(result.fleet).not.toBeNull();
      expect(result.fleet!.totalSessions).toBe(1);
    });

    it("returns zeroKnowledgeRate=0 when no claude sessions present", () => {
      const sessions: SessionMetrics[] = [
        makeSession({
          backend: "opencode",
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
        }),
        makeSession({
          backend: "opencode",
          knowledge: {
            newExperimentFindings: 1,
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
        }),
      ];

      const result = aggregateEfficiency(sessions);

      expect(result.zeroKnowledgeRate).toBe(0);
      expect(result.fleet!.totalSessions).toBe(2);
    });
  });

  describe("fleet metrics", () => {
    it("computes task completion rate from hasCommit", () => {
      const sessions: SessionMetrics[] = [
        makeSession({
          backend: "opencode",
          verification: { hasCommit: true, hasLogEntry: true },
        }),
        makeSession({
          backend: "opencode",
          verification: { hasCommit: true, hasLogEntry: false },
        }),
        makeSession({
          backend: "opencode",
          verification: { hasCommit: false, hasLogEntry: false },
        }),
        makeSession({
          backend: "opencode",
          verification: { hasCommit: true, hasLogEntry: true },
        }),
      ];

      const result = aggregateEfficiency(sessions);

      expect(result.fleet!.taskCompletionRate).toBe(0.75);
    });

    it("computes verification pass rate from hasCommit && hasLogEntry", () => {
      const sessions: SessionMetrics[] = [
        makeSession({
          backend: "opencode",
          verification: { hasCommit: true, hasLogEntry: true },
        }),
        makeSession({
          backend: "opencode",
          verification: { hasCommit: true, hasLogEntry: false },
        }),
        makeSession({
          backend: "opencode",
          verification: { hasCommit: false, hasLogEntry: true },
        }),
        makeSession({
          backend: "opencode",
          verification: { hasCommit: false, hasLogEntry: false },
        }),
      ];

      const result = aggregateEfficiency(sessions);

      expect(result.fleet!.verificationPassRate).toBe(0.25);
    });

    it("computes log entry rate from hasLogEntry", () => {
      const sessions: SessionMetrics[] = [
        makeSession({
          backend: "opencode",
          verification: { hasCommit: true, hasLogEntry: true },
        }),
        makeSession({
          backend: "opencode",
          verification: { hasCommit: true, hasLogEntry: false },
        }),
        makeSession({
          backend: "opencode",
          verification: { hasCommit: false, hasLogEntry: true },
        }),
        makeSession({
          backend: "opencode",
          verification: { hasCommit: false, hasLogEntry: false },
        }),
      ];

      const result = aggregateEfficiency(sessions);

      expect(result.fleet!.logEntryRate).toBe(0.5);
    });

    it("computes avg commits per session", () => {
      const sessions: SessionMetrics[] = [
        makeSession({
          backend: "opencode",
          verification: { hasCommit: true, agentCommitCount: 2 },
        }),
        makeSession({
          backend: "opencode",
          verification: { hasCommit: true, agentCommitCount: 1 },
        }),
        makeSession({
          backend: "opencode",
          verification: { hasCommit: false, agentCommitCount: 0 },
        }),
      ];

      const result = aggregateEfficiency(sessions);

      expect(result.fleet!.avgCommitsPerSession).toBeCloseTo(1);
    });

    it("computes knowledge production rate for fleet", () => {
      const sessions: SessionMetrics[] = [
        makeSession({
          backend: "opencode",
          knowledge: {
            newExperimentFindings: 1,
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
        }),
        makeSession({
          backend: "opencode",
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
        }),
        makeSession({
          backend: "opencode",
          knowledge: {
            newExperimentFindings: 0,
            newDecisionRecords: 1,
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
        }),
        makeSession({
          backend: "opencode",
          knowledge: {
            newExperimentFindings: 1,
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
        }),
      ];

      const result = aggregateEfficiency(sessions);

      expect(result.fleet!.knowledgeProductionRate).toBe(0.75);
    });

    it("computes avg files changed per session", () => {
      const sessions: SessionMetrics[] = [
        makeSession({
          backend: "opencode",
          verification: { hasCommit: true, filesChanged: 3 },
        }),
        makeSession({
          backend: "opencode",
          verification: { hasCommit: true, filesChanged: 5 },
        }),
        makeSession({
          backend: "opencode",
          verification: { hasCommit: false, filesChanged: 0 },
        }),
      ];

      const result = aggregateEfficiency(sessions);

      expect(result.fleet!.avgFilesChanged).toBeCloseTo(8 / 3);
    });

    it("returns null fleet metrics when no fleet sessions", () => {
      const sessions: SessionMetrics[] = [
        makeSession({
          backend: "claude",
          knowledge: { newFiles: 1, newDecisions: 0, newExperimentFindings: 0, newLiteratureNotes: 0 },
        }),
      ];

      const result = aggregateEfficiency(sessions);

      expect(result.fleet).toBeNull();
    });

    it("handles fleet sessions without verification or knowledge", () => {
      const sessions: SessionMetrics[] = [
        makeSession({
          backend: "opencode",
        }),
        makeSession({
          backend: "opencode",
          verification: { hasCommit: true, hasLogEntry: true },
        }),
      ];

      const result = aggregateEfficiency(sessions);

      expect(result.fleet!.totalSessions).toBe(2);
      expect(result.fleet!.taskCompletionRate).toBe(0.5);
      expect(result.fleet!.verificationPassRate).toBe(0.5);
    });
  });

  describe("mixed backend scenarios", () => {
    it("correctly separates claude and fleet metrics", () => {
      const sessions: SessionMetrics[] = [
        makeSession({
          backend: "claude",
          costUsd: 1.0,
          knowledge: {
            newExperimentFindings: 1,
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
        }),
        makeSession({
          backend: "opencode",
          costUsd: 0,
          verification: { hasCommit: true, hasLogEntry: true },
          knowledge: {
            newExperimentFindings: 1,
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
        }),
        makeSession({
          backend: "claude",
          costUsd: 2.0,
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
        }),
        makeSession({
          backend: "opencode",
          costUsd: 0,
          verification: { hasCommit: false, hasLogEntry: false },
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
        }),
      ];

      const result = aggregateEfficiency(sessions);

      expect(result.findingsPerDollar).toBeCloseTo(2 / 3, 5);
      expect(result.zeroKnowledgeRate).toBe(0.5);
      expect(result.fleet!.totalSessions).toBe(2);
      expect(result.fleet!.taskCompletionRate).toBe(0.5);
      expect(result.fleet!.verificationPassRate).toBe(0.5);
      expect(result.fleet!.knowledgeProductionRate).toBe(0.5);
    });
  });
});
