/** Cross-session pattern detector — analyzes SessionMetrics for recurring violations. */

import { readMetrics } from "./metrics.js";
import type { SessionMetrics, KnowledgeMetrics } from "./metrics.js";

export interface DetectedPattern {
  /** Machine-readable pattern identifier. */
  id: string;
  /** Human-readable description of the pattern. */
  description: string;
  /** Severity: high (prevents knowledge output), medium (degrades quality), low (cosmetic). */
  severity: "high" | "medium" | "low";
  /** Number of sessions exhibiting this pattern. */
  occurrences: number;
  /** Total number of sessions analyzed. */
  total: number;
  /** Actionable recommendation. */
  recommendation: string;
}

export interface PatternDetectorOpts {
  /** Minimum number of occurrences to flag a pattern. Default: 3. */
  minOccurrences?: number;
}

/** Check if all knowledge counts are zero. */
function isZeroKnowledge(k: KnowledgeMetrics): boolean {
  return (
    k.newExperimentFindings === 0 &&
    k.newDecisionRecords === 0 &&
    k.newLiteratureNotes === 0 &&
    k.openQuestionsResolved === 0 &&
    k.openQuestionsDiscovered === 0 &&
    k.experimentsCompleted === 0 &&
    k.crossReferences === 0 &&
    k.newAnalysisFiles === 0 &&
    k.logEntryFindings === 0 &&
    k.infraCodeChanges === 0 &&
    k.bugfixVerifications === 0 &&
    (k.structuralChanges ?? 0) === 0 &&
    (k.feedbackProcessed ?? 0) === 0 &&
    (k.diagnosesCompleted ?? 0) === 0
  );
}

/** Compute median of a numeric array. Returns 0 for empty arrays. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

/**
 * Detect recurring patterns across session metrics.
 * Pure function — no I/O. Operates on an array of SessionMetrics.
 *
 * @param sessions - Array of session metrics records (most recent last).
 * @param opts - Configuration options.
 * @returns Array of detected patterns, sorted by severity (high first).
 */
export function detectPatterns(
  sessions: SessionMetrics[],
  opts?: PatternDetectorOpts,
): DetectedPattern[] {
  const minOcc = opts?.minOccurrences ?? 3;
  if (sessions.length < minOcc) return [];

  const patterns: DetectedPattern[] = [];
  const total = sessions.length;

  // Filter sessions with verification data
  const withVerification = sessions.filter((s) => s.verification !== null);
  const withKnowledge = sessions.filter((s) => s.knowledge !== null);

  // 1. Recurring commit failures
  if (withVerification.length >= minOcc) {
    const noCommitCount = withVerification.filter(
      (s) =>
        !s.verification!.hasCommit &&
        // Skip idle exploration sessions (ADR 0048)
        !s.isIdle &&
        // Skip no-work sessions: completed successfully but with no output.
        // These are expected when tasks are blocked, time-gated, or externally dependent.
        !(s.verification!.commitCount === 0 && s.verification!.filesChanged === 0 && s.verification!.orphanedFiles === 0),
    ).length;
    if (noCommitCount >= minOcc) {
      patterns.push({
        id: "recurring_no_commit",
        description: "Sessions ending without commits",
        severity: "high",
        occurrences: noCommitCount,
        total,
        recommendation:
          "Investigate why agents are not committing. Check if sessions are ending prematurely or if the commit step is being skipped.",
      });
    }
  }

  // 2. Recurring zero-knowledge sessions
  if (withKnowledge.length >= minOcc) {
    const zeroKCount = withKnowledge.filter((s) =>
      isZeroKnowledge(s.knowledge!),
    ).length;
    if (zeroKCount >= minOcc) {
      patterns.push({
        id: "recurring_zero_knowledge",
        description: "Sessions producing zero detected knowledge output",
        severity: "medium",
        occurrences: zeroKCount,
        total,
        recommendation:
          "Review task selection — agents may be picking operational tasks that produce no measurable knowledge, or the knowledge detector may be missing output types.",
      });
    }
  }

  // 3. Recurring uncommitted files
  if (withVerification.length >= minOcc) {
    const uncommittedCount = withVerification.filter(
      (s) => s.verification!.uncommittedFiles > 0,
    ).length;
    if (uncommittedCount >= minOcc) {
      patterns.push({
        id: "recurring_uncommitted_files",
        description: "Sessions ending with uncommitted files",
        severity: "high",
        occurrences: uncommittedCount,
        total,
        recommendation:
          "Sessions are leaving work uncommitted. Consider adding a pre-close commit check or strengthening the SOP commit convention.",
      });
    }
  }

  // 4. Recurring missing log entries
  if (withVerification.length >= minOcc) {
    const noLogCount = withVerification.filter(
      (s) =>
        !s.verification!.hasLogEntry &&
        // Skip idle exploration sessions (ADR 0048)
        !s.isIdle &&
        // Fleet workers don't follow the full SOP (log entries).
        // Counting them inflates pattern counts for warnings they can't fix.
        s.triggerSource !== "fleet",
    ).length;
    if (noLogCount >= minOcc) {
      patterns.push({
        id: "recurring_no_log_entry",
        description: "Sessions ending without a project README log entry",
        severity: "medium",
        occurrences: noLogCount,
        total,
        recommendation:
          "Agents are skipping the log entry step. Reinforce the inline logging convention or add a pre-commit check.",
      });
    }
  }

  // 5. Recurring missing footers
  if (withVerification.length >= minOcc) {
    const noFooterCount = withVerification.filter(
      (s) =>
        !s.verification!.hasCompleteFooter &&
        // Skip idle exploration sessions (ADR 0048)
        !s.isIdle &&
        // Fleet workers don't follow the full SOP (footer format).
        // Counting them inflates pattern counts for warnings they can't fix.
        s.triggerSource !== "fleet",
    ).length;
    if (noFooterCount >= minOcc) {
      patterns.push({
        id: "recurring_no_footer",
        description: "Sessions ending without a complete session summary footer",
        severity: "low",
        occurrences: noFooterCount,
        total,
        recommendation:
          "Footer completion is a cosmetic issue but aids longitudinal analysis. Consider adding footer generation to the session close step.",
      });
    }
  }

  // 6. Recurring timeouts
  {
    const timeoutCount = sessions.filter((s) => s.timedOut).length;
    if (timeoutCount >= minOcc) {
      patterns.push({
        id: "recurring_timeouts",
        description: "Sessions hitting the timeout limit",
        severity: "high",
        occurrences: timeoutCount,
        total,
        recommendation:
          "Sessions are running out of time. Check if tasks are too large, agents are stuck in loops, or the timeout limit is too short.",
      });
    }
  }

  // 7. Recurring high-cost sessions (>2x median)
  {
    const costs = sessions
      .map((s) => s.costUsd)
      .filter((c): c is number => c !== null && c > 0);
    if (costs.length >= minOcc) {
      const med = median(costs);
      if (med > 0) {
        const highCostCount = costs.filter((c) => c > med * 2).length;
        if (highCostCount >= minOcc) {
          patterns.push({
            id: "recurring_high_cost",
            description: `Sessions with cost >2x median ($${med.toFixed(2)})`,
            severity: "medium",
            occurrences: highCostCount,
            total,
            recommendation:
              "Multiple sessions are significantly more expensive than typical. Investigate whether these are productive (complex tasks) or wasteful (loops, retries, oversized context).",
          });
        }
      }
    }
  }

  // Sort by severity: high > medium > low
  const severityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  patterns.sort(
    (a, b) => severityOrder[a.severity]! - severityOrder[b.severity]!,
  );

  return patterns;
}

/**
 * Read recent sessions from the JSONL store and detect patterns.
 * Convenience wrapper combining readMetrics + detectPatterns.
 *
 * @param limit - Number of recent sessions to analyze. Default: 10.
 * @param opts - Pattern detection options.
 */
export async function readAndDetectPatterns(
  limit = 10,
  opts?: PatternDetectorOpts,
): Promise<DetectedPattern[]> {
  const sessions = await readMetrics({ limit });
  return detectPatterns(sessions, opts);
}

/** Format detected patterns as a human-readable string, or null if none. */
export function formatPatterns(patterns: DetectedPattern[]): string | null {
  if (patterns.length === 0) return null;
  return patterns
    .map(
      (p) =>
        `- **${p.id}** [${p.severity}]: ${p.description} (${p.occurrences}/${p.total} sessions)\n  → ${p.recommendation}`,
    )
    .join("\n");
}
