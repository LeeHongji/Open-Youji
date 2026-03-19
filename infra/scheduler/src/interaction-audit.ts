/** Interaction quality audit — detects degrading chat quality from interactions.jsonl. */

import { readInteractions } from "./metrics.js";
import type { InteractionRecord } from "./metrics.js";

// Evidence grade markers from cross-functional chat guidelines.
// Matches both the label itself and common contextual phrases.
const EVIDENCE_GRADE_PATTERNS = [
  /\bestab(?:lished)\b/i,
  /\bmeasured\b/i,
  /\bpreliminary\b/i,
  /\bhypothesis\b/i,
  /\bunknown\b/i,
  /we(?:'ve| have) tested this/i,
  /in our experiment/i,
  /early results suggest/i,
  /based on what we know/i,
  /we haven'?t tested/i,
  /high confidence/i,
  /single experiment/i,
  /untested reasoning/i,
  /no (?:relevant )?data/i,
];

/**
 * Detect whether a response text contains evidence grading markers.
 * Returns true if at least one evidence grade pattern is found.
 */
export function detectEvidenceGrading(text: string): boolean {
  return EVIDENCE_GRADE_PATTERNS.some((pattern) => pattern.test(text));
}

export interface InteractionAuditCheck {
  /** Machine-readable check identifier. */
  id: string;
  /** Human-readable description. */
  description: string;
  /** Severity: high (requires immediate attention), medium (investigate). */
  severity: "high" | "medium";
  /** The measured value (percentage or count). */
  value: number;
  /** The threshold that was exceeded. */
  threshold: number;
  /** Actionable recommendation. */
  recommendation: string;
  /** Thread keys involved (for problem_threads check). */
  threadKeys?: string[];
}

export interface InteractionAuditOpts {
  /** Fulfillment rate threshold as percentage — flag if below (default: 70). */
  fulfillmentRateThreshold?: number;
  /** Correction rate threshold as percentage — flag if above (default: 25). */
  correctionRateThreshold?: number;
  /** Error rate threshold as percentage — flag if above (default: 30). */
  errorRateThreshold?: number;
  /** Min corrections per thread to flag as a problem thread (default: 3, i.e. >2). */
  problemThreadCorrectionMin?: number;
  /** Minimum number of records before audit produces checks (default: 5). */
  minRecords?: number;
  /** Evidence grading rate threshold as percentage — flag if below (default: 50). */
  evidenceGradingRateThreshold?: number;
}

const DEFAULT_OPTS: Required<InteractionAuditOpts> = {
  fulfillmentRateThreshold: 70,
  correctionRateThreshold: 25,
  errorRateThreshold: 30,
  problemThreadCorrectionMin: 3,
  minRecords: 5,
  evidenceGradingRateThreshold: 50,
};

/**
 * Analyze interaction quality and return any triggered checks.
 * Pure function — no I/O. Takes an array of InteractionRecords.
 */
export function analyzeInteractions(
  records: InteractionRecord[],
  opts?: InteractionAuditOpts,
): InteractionAuditCheck[] {
  const o = { ...DEFAULT_OPTS, ...opts };
  if (records.length < o.minRecords) return [];

  const checks: InteractionAuditCheck[] = [];
  const total = records.length;

  // 1. Fulfillment rate — only count records that have the field set
  const withFulfillment = records.filter((r) => r.intentFulfilled != null);
  if (withFulfillment.length >= o.minRecords) {
    const fulfilledCount = withFulfillment.filter((r) => r.intentFulfilled === "fulfilled").length;
    const fulfillmentRate = Math.round((fulfilledCount / withFulfillment.length) * 100);
    if (fulfillmentRate < o.fulfillmentRateThreshold) {
      checks.push({
        id: "low_fulfillment_rate",
        description: `Fulfillment rate ${fulfillmentRate}% below ${o.fulfillmentRateThreshold}% threshold (${fulfilledCount}/${withFulfillment.length} fulfilled)`,
        severity: "high",
        value: fulfillmentRate,
        threshold: o.fulfillmentRateThreshold,
        recommendation:
          "Investigate unfulfilled interactions. Check for parsing failures, unsupported commands, or degraded agent reasoning.",
      });
    }
  }

  // 2. Correction rate — user had to rephrase
  const correctedCount = records.filter((r) => r.userCorrected === true).length;
  const correctionRate = Math.round((correctedCount / total) * 100);
  if (correctionRate > o.correctionRateThreshold) {
    checks.push({
      id: "high_correction_rate",
      description: `Correction rate ${correctionRate}% exceeds ${o.correctionRateThreshold}% threshold (${correctedCount}/${total} interactions required user rephrasing)`,
      severity: "medium",
      value: correctionRate,
      threshold: o.correctionRateThreshold,
      recommendation:
        "User is rephrasing frequently. Check if command parsing is too strict, or if the bot is misinterpreting common patterns.",
    });
  }

  // 3. Problem threads — threads where user corrected >2 times
  const correctionsByThread = new Map<string, number>();
  for (const r of records) {
    if (r.userCorrected === true) {
      correctionsByThread.set(r.threadKey, (correctionsByThread.get(r.threadKey) ?? 0) + 1);
    }
  }
  const problemThreads = [...correctionsByThread.entries()]
    .filter(([, count]) => count >= o.problemThreadCorrectionMin)
    .map(([key]) => key);
  if (problemThreads.length > 0) {
    checks.push({
      id: "problem_threads",
      description: `${problemThreads.length} thread(s) with >${o.problemThreadCorrectionMin - 1} user corrections: ${problemThreads.join(", ")}`,
      severity: "medium",
      value: problemThreads.length,
      threshold: 0,
      recommendation:
        "These threads had repeated user corrections. Review them for UX issues or misunderstood commands.",
      threadKeys: problemThreads,
    });
  }

  // 4. Error rate
  const errorCount = records.filter((r) => r.result === "error").length;
  const errorRate = Math.round((errorCount / total) * 100);
  if (errorRate > o.errorRateThreshold) {
    checks.push({
      id: "high_error_rate",
      description: `Error rate ${errorRate}% exceeds ${o.errorRateThreshold}% threshold (${errorCount}/${total} interactions errored)`,
      severity: "high",
      value: errorRate,
      threshold: o.errorRateThreshold,
      recommendation:
        "High interaction error rate. Check for infrastructure issues, API failures, or systematic parsing problems.",
    });
  }

  // 5. Evidence grading rate — only for chat-mode interactions with the field set
  const chatModeRecords = records.filter((r) => r.isChatMode === true && r.evidenceGraded != null);
  if (chatModeRecords.length >= o.minRecords) {
    const gradedCount = chatModeRecords.filter((r) => r.evidenceGraded === true).length;
    const gradingRate = Math.round((gradedCount / chatModeRecords.length) * 100);
    if (gradingRate < o.evidenceGradingRateThreshold) {
      checks.push({
        id: "low_evidence_grading_rate",
        description: `Evidence grading rate ${gradingRate}% below ${o.evidenceGradingRateThreshold}% threshold (${gradedCount}/${chatModeRecords.length} chat-mode responses included evidence grades)`,
        severity: "medium",
        value: gradingRate,
        threshold: o.evidenceGradingRateThreshold,
        recommendation:
          "Chat-mode responses are not consistently including evidence grades. Review the chat-mode prompt reference in infra/scheduler/reference-implementations/slack/chat/ and check if the agent is following the mandatory grading convention.",
      });
    }
  }

  // Sort by severity: high before medium
  const severityOrder: Record<string, number> = { high: 0, medium: 1 };
  checks.sort((a, b) => severityOrder[a.severity]! - severityOrder[b.severity]!);

  return checks;
}

export interface InteractionReportStats {
  totalRecords: number;
  fulfillmentRate: number;
  correctionRate: number;
  /** Evidence grading rate for chat-mode interactions (percentage, or -1 if no chat-mode data). */
  evidenceGradingRate: number;
}

export interface InteractionReport {
  summary: string;
  details: string;
}

/**
 * Format interaction audit results as a structured report with a short summary
 * line and full details.
 */
export function formatInteractionReport(
  checks: InteractionAuditCheck[],
  stats: InteractionReportStats,
): InteractionReport {
  const gradingPart = stats.evidenceGradingRate >= 0
    ? ` | Evidence grading: ${stats.evidenceGradingRate}%`
    : "";
  const statsSummary = `Interactions analyzed: ${stats.totalRecords} | Fulfillment: ${stats.fulfillmentRate}% | Correction: ${stats.correctionRate}%${gradingPart}`;

  if (checks.length === 0) {
    const msg = `:white_check_mark: Interaction quality audit: all clear. ${statsSummary}`;
    return { summary: msg, details: msg };
  }

  const highCount = checks.filter((c) => c.severity === "high").length;
  const mediumCount = checks.length - highCount;
  const severityParts: string[] = [];
  if (highCount > 0) severityParts.push(`${highCount} high`);
  if (mediumCount > 0) severityParts.push(`${mediumCount} medium`);
  const summary = `:warning: Interaction quality audit: ${checks.length} issue(s) — ${severityParts.join(", ")}`;

  const lines: string[] = [
    `:warning: *Interaction quality audit: ${checks.length} issue(s) detected*`,
    statsSummary,
    "",
  ];

  for (const check of checks) {
    const icon = check.severity === "high" ? ":red_circle:" : ":large_orange_circle:";
    lines.push(`${icon} *${check.id}* [${check.severity}] — value: ${check.value}, threshold: ${check.threshold}`);
    lines.push(`  ${check.description}`);
    lines.push(`  → ${check.recommendation}`);
    if (check.threadKeys && check.threadKeys.length > 0) {
      lines.push(`  Threads: ${check.threadKeys.join(", ")}`);
    }
    lines.push("");
  }

  return { summary, details: lines.join("\n").trim() };
}

/**
 * Run the interaction quality audit: read recent interactions, analyze, and return results.
 * This is the main entry point for CLI and scheduled invocations.
 */
export async function runInteractionAudit(opts?: {
  since?: string;
  limit?: number;
  checkOpts?: InteractionAuditOpts;
}): Promise<{ checks: InteractionAuditCheck[]; stats: InteractionReportStats }> {
  const records = await readInteractions({
    since: opts?.since,
    limit: opts?.limit,
  });

  const checks = analyzeInteractions(records, opts?.checkOpts);

  // Compute stats for the report
  const withFulfillment = records.filter((r) => r.intentFulfilled != null);
  const fulfilledCount = withFulfillment.filter((r) => r.intentFulfilled === "fulfilled").length;
  const correctedCount = records.filter((r) => r.userCorrected === true).length;

  const chatModeWithGrading = records.filter((r) => r.isChatMode === true && r.evidenceGraded != null);
  const gradedCount = chatModeWithGrading.filter((r) => r.evidenceGraded === true).length;

  const stats: InteractionReportStats = {
    totalRecords: records.length,
    fulfillmentRate: withFulfillment.length > 0
      ? Math.round((fulfilledCount / withFulfillment.length) * 100)
      : 0,
    correctionRate: records.length > 0
      ? Math.round((correctedCount / records.length) * 100)
      : 0,
    evidenceGradingRate: chatModeWithGrading.length > 0
      ? Math.round((gradedCount / chatModeWithGrading.length) * 100)
      : -1,
  };

  return { checks, stats };
}
