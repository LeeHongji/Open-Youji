/** Recurring verification warning escalation — detects repeated warnings across sessions. */

import { readMetrics } from "./metrics.js";
import type { SessionMetrics, VerificationMetrics } from "./metrics.js";

/** Machine-readable warning types derived from VerificationMetrics fields. */
export type WarningType =
  | "no_log_entry"
  | "no_commit"
  | "incomplete_footer"
  | "ledger_inconsistent"
  | "orphaned_files";

export interface WarningEscalation {
  /** Machine-readable warning type. */
  warningType: WarningType;
  /** Human-readable description. */
  description: string;
  /** Number of sessions exhibiting this warning. */
  occurrences: number;
  /** Severity: high for session-breaking, medium for quality degradation. */
  severity: "high" | "medium";
  /** Actionable recommendation. */
  recommendation: string;
  /** Timestamps of sessions that triggered this warning. */
  sessionTimestamps: string[];
}

export interface EscalationOpts {
  /** Minimum occurrences to trigger escalation (default: 3, escalates when >threshold). */
  recurrenceThreshold?: number;
}

const DEFAULT_OPTS: Required<EscalationOpts> = {
  recurrenceThreshold: 3,
};

/** Warning type metadata: descriptions and recommendations. */
const WARNING_META: Record<WarningType, { description: string; recommendation: string; severity: "high" | "medium" }> = {
  no_log_entry: {
    description: "No project README log entry detected",
    recommendation: "Sessions are not writing log entries. Check SOP compliance — every session must append a log entry to a project README.",
    severity: "medium",
  },
  no_commit: {
    description: "No git commit in session",
    recommendation: "Sessions are completing without committing. Investigate whether sessions are finding actionable tasks or ending prematurely.",
    severity: "high",
  },
  incomplete_footer: {
    description: "Incomplete session summary footer in README",
    recommendation: "Session footers are missing required fields (Session-type, Duration, Task-selected, etc). Check if agent is following the SOP footer format.",
    severity: "medium",
  },
  ledger_inconsistent: {
    description: "Cost incurred but no ledger entry recorded",
    recommendation: "Sessions are consuming resources without recording to ledger.yaml. Budget tracking is unreliable — investigate experiment runner ledger integration.",
    severity: "high",
  },
  orphaned_files: {
    description: "Orphaned files from previous sessions",
    recommendation: "Auto-commit is not catching all orphaned files. Check auto-commit classification logic in verify.ts, or experiments may be producing files in unexpected locations.",
    severity: "medium",
  },
};

/**
 * Extract active warning types from a single session's verification metrics.
 * Returns the set of warning types that are active (failed conditions).
 */
function extractWarnings(v: VerificationMetrics): WarningType[] {
  const warnings: WarningType[] = [];
  if (!v.hasLogEntry) warnings.push("no_log_entry");
  if (!v.hasCommit) warnings.push("no_commit");
  if (!v.hasCompleteFooter) warnings.push("incomplete_footer");
  if (!v.ledgerConsistent) warnings.push("ledger_inconsistent");
  if (v.orphanedFiles > 0) warnings.push("orphaned_files");
  return warnings;
}

/**
 * Detect recurring verification warnings across recent sessions.
 * Pure function — no I/O. Takes an array of SessionMetrics (most recent last).
 *
 * Skips failed sessions (ok === false) because their verification data may be
 * unreliable — a session that crashes won't have a log entry or commit, but
 * that's expected behavior, not a recurring warning.
 */
export function detectRecurringWarnings(
  sessions: SessionMetrics[],
  opts?: EscalationOpts,
): WarningEscalation[] {
  if (sessions.length === 0) return [];

  const o = { ...DEFAULT_OPTS, ...opts };

  // Count occurrences per warning type across successful sessions with verification data
  const counts = new Map<WarningType, string[]>();

  for (const s of sessions) {
    if (!s.ok) continue;
    if (!s.verification) continue;
    // Idle exploration sessions are designed to produce zero commits/logs when
    // they find nothing new. Counting them as warnings inflates escalation counts.
    if (s.isIdle) continue;
    // No-work sessions: completed successfully but with no output (no commits, no files changed, no orphaned files).
    // These are expected when tasks are blocked, time-gated, or externally dependent.
    // Counting them as warnings inflates escalation counts.
    if (
      s.verification.commitCount === 0 &&
      s.verification.filesChanged === 0 &&
      s.verification.orphanedFiles === 0
    )
      continue;

    const warnings = extractWarnings(s.verification);
    for (const w of warnings) {
      // Fleet workers don't follow the full SOP (log entries, footer format).
      // Counting them inflates escalation counts for warnings they can't fix.
      if (w === "incomplete_footer" && s.triggerSource === "fleet") continue;
      if (w === "no_log_entry" && s.triggerSource === "fleet") continue;
      // Fleet workers run concurrently and see each other's in-flight files as orphaned.
      // This is expected in the shared-repo concurrency model (diagnosis 2026-03-05).
      // The auto-commit mechanism catches these files before the next session.
      if (w === "orphaned_files" && s.triggerSource === "fleet") continue;

      const timestamps = counts.get(w) ?? [];
      timestamps.push(s.timestamp);
      counts.set(w, timestamps);
    }
  }

  // Build escalations for types exceeding threshold
  const escalations: WarningEscalation[] = [];
  for (const [type, timestamps] of counts) {
    if (timestamps.length > o.recurrenceThreshold) {
      const meta = WARNING_META[type];
      escalations.push({
        warningType: type,
        description: meta.description,
        occurrences: timestamps.length,
        severity: meta.severity,
        recommendation: meta.recommendation,
        sessionTimestamps: timestamps,
      });
    }
  }

  // Sort by occurrence count descending
  escalations.sort((a, b) => b.occurrences - a.occurrences);

  return escalations;
}

export interface EscalationReport {
  summary: string;
  details: string;
}

/**
 * Format escalation results as a structured report with a short summary
 * line and full details.
 */
export function formatEscalationReport(escalations: WarningEscalation[]): EscalationReport {
  if (escalations.length === 0) {
    const msg = ":white_check_mark: Warning escalation: all clear. No recurring warnings detected.";
    return { summary: msg, details: msg };
  }

  const highCount = escalations.filter((e) => e.severity === "high").length;
  const mediumCount = escalations.length - highCount;
  const severityParts: string[] = [];
  if (highCount > 0) severityParts.push(`${highCount} high`);
  if (mediumCount > 0) severityParts.push(`${mediumCount} medium`);
  const summary = `:warning: Warning escalation: ${escalations.length} recurring warning(s) — ${severityParts.join(", ")}`;

  const lines: string[] = [
    `:warning: *Warning escalation: ${escalations.length} recurring warning(s) detected*`,
    "",
  ];

  for (const e of escalations) {
    const icon = e.severity === "high" ? ":red_circle:" : ":large_orange_circle:";
    lines.push(`${icon} *${e.warningType}* [${e.severity}] — ${e.occurrences} occurrences`);
    lines.push(`  ${e.description}`);
    lines.push(`  → ${e.recommendation}`);
    lines.push("");
  }

  return { summary, details: lines.join("\n").trim() };
}

/**
 * Run warning escalation: read recent sessions, analyze, and return results.
 * Main entry point for CLI and scheduled invocations.
 */
export async function runWarningEscalation(opts?: {
  limit?: number;
  escalationOpts?: EscalationOpts;
}): Promise<{ escalations: WarningEscalation[]; sessionsAnalyzed: number }> {
  const limit = opts?.limit ?? 20;
  const sessions = await readMetrics({ limit });
  const escalations = detectRecurringWarnings(sessions, opts?.escalationOpts);
  return { escalations, sessionsAnalyzed: sessions.length };
}
