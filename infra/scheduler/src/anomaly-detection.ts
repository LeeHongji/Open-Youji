/**
 * Statistical anomaly detection on session metrics.
 *
 * Uses percentile-based detection (P95 + absolute minimum guard) for right-skewed
 * metrics (numTurns, durationMs) and σ-based detection for symmetric metrics
 * (costUsd, knowledgeTotal). See 7 diagnosis files documenting σ-based false
 * positives on productive sessions: diagnosis-high-turns-duration-sessions-207-213.md.
 */

import { readMetrics } from "./metrics.js";
import type { SessionMetrics, KnowledgeMetrics } from "./metrics.js";

export interface Anomaly {
  /** Which metric triggered the anomaly. */
  metric: "costUsd" | "durationMs" | "numTurns" | "knowledgeTotal" | "contextUtilization";
  /** The runId of the session that triggered the anomaly. */
  sessionRunId: string;
  /** ISO timestamp of the anomalous session. */
  sessionTimestamp: string;
  /** The actual value observed. */
  value: number;
  /** Rolling mean of the metric. */
  mean: number;
  /** Rolling standard deviation of the metric. */
  stddev: number;
  /** How many σ from the mean (absolute). For percentile-based metrics, set to 0. */
  sigmaDeviation: number;
  /** Whether the outlier is above or below the mean. */
  direction: "high" | "low";
  /** Human-readable description. */
  description: string;
  /** Detection method used: "sigma" or "percentile" or "threshold". */
  method: "sigma" | "percentile" | "threshold";
}

export interface AnomalyDetectionOpts {
  /** Number of standard deviations to flag as anomalous (for σ-based metrics). Default: 2. */
  sigmaThreshold?: number;
  /** Minimum number of sessions required to compute statistics. Default: 5. */
  minSessions?: number;
  /** Percentile threshold for percentile-based metrics (0-100). Default: 95. */
  percentileThreshold?: number;
}

/**
 * Absolute minimum guards for percentile-based metrics.
 * A session is only flagged if it exceeds BOTH the percentile threshold
 * AND the absolute minimum. This prevents flagging productive sessions
 * that are statistically outliers but operationally reasonable.
 *
 * Note: durationMs has a margin above the session timeout (900s) to avoid
 * false positives when P95 converges to the timeout limit. Sessions that
 * timeout at exactly 900s are expected behavior (2% rate is healthy), not
 * anomalies. See diagnosis-session-duration-anomaly-false-positive-2026-02-28.md.
 */
export const ABSOLUTE_MINIMUMS = {
  numTurns: 60,
  durationMs: 915_000, // 15.25 min (margin above 15-min timeout)
} as const;

/**
 * Context utilization thresholds (percentage of contextWindow used).
 * Sessions exceeding WARNING_THRESHOLD are flagged; CRITICAL_THRESHOLD triggers escalation.
 */
export const CONTEXT_UTILIZATION_WARNING_THRESHOLD = 0.80; // 80%
export const CONTEXT_UTILIZATION_CRITICAL_THRESHOLD = 0.90; // 90%

/**
 * Findings-per-dollar threshold for cost anomaly filtering.
 * Sessions with findings/cost ratio above this threshold are considered
 * productive and skipped from cost alerts, even if expensive.
 * This prevents false positives on high-value sessions.
 * See 3 diagnosis files recommending this fix.
 */
export const FINDINGS_PER_DOLLAR_THRESHOLD = 2.0;

const DEFAULT_OPTS: Required<AnomalyDetectionOpts> = {
  sigmaThreshold: 2,
  minSessions: 5,
  percentileThreshold: 95,
};

/** Compute mean and standard deviation of a numeric array. */
function stats(values: number[]): { mean: number; stddev: number } {
  if (values.length === 0) return { mean: 0, stddev: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return { mean, stddev: Math.sqrt(variance) };
}

/** Compute the p-th percentile (0-100) of a sorted numeric array using linear interpolation. */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}

/** Sum all knowledge metric fields for a session. */
function knowledgeTotal(k: KnowledgeMetrics): number {
  return (
    k.newExperimentFindings +
    k.newDecisionRecords +
    k.newLiteratureNotes +
    k.openQuestionsResolved +
    k.openQuestionsDiscovered +
    k.experimentsCompleted +
    k.crossReferences +
    k.newAnalysisFiles +
    k.logEntryFindings +
    k.infraCodeChanges +
    k.bugfixVerifications +
    (k.structuralChanges ?? 0) +
    (k.feedbackProcessed ?? 0) +
    (k.diagnosesCompleted ?? 0)
  );
}

/** Compute findings-per-dollar ratio for a session. Returns null if cost is 0 or missing. */
function findingsPerDollar(session: SessionMetrics): number | null {
  const cost = session.costUsd ?? 0;
  if (!session.knowledge || cost <= 0) return null;
  return knowledgeTotal(session.knowledge) / cost;
}

/**
 * Metrics that use percentile-based detection (right-skewed distributions).
 * These were previously σ-based, causing 7 false positive diagnosis cycles
 * on productive sessions (sessions 179, 191, 201, 207, 213, plus Claude-era).
 */
const PERCENTILE_METRICS = new Set<Anomaly["metric"]>(["numTurns", "durationMs"]);

/**
 * Detect statistical outliers across session metrics.
 * Pure function — no I/O. Segments sessions by backend before computing
 * statistics, so each backend is compared against its own baseline.
 * This prevents false positives when backends have different cost profiles
 * (e.g., Claude reports real costs while Cursor reports $0).
 *
 * Detection methods:
 * - costUsd: σ-based, high outliers (symmetric distribution)
 * - knowledgeTotal: σ-based, low outliers (symmetric distribution)
 * - durationMs: percentile-based (P95) + absolute minimum guard (right-skewed)
 * - numTurns: percentile-based (P95) + absolute minimum guard (right-skewed)
 */
export function detectAnomalies(
  sessions: SessionMetrics[],
  opts?: AnomalyDetectionOpts,
): Anomaly[] {
  const o = { ...DEFAULT_OPTS, ...opts };
  const anomalies: Anomaly[] = [];

  // Threshold-based: context utilization check (runs regardless of session count)
  for (const session of sessions) {
    const utilization = computeContextUtilization(session);
    if (utilization !== null && utilization >= CONTEXT_UTILIZATION_WARNING_THRESHOLD) {
      const pct = Math.round(utilization * 100);
      const isCritical = utilization >= CONTEXT_UTILIZATION_CRITICAL_THRESHOLD;
      anomalies.push({
        metric: "contextUtilization",
        sessionRunId: session.runId,
        sessionTimestamp: session.timestamp,
        value: utilization,
        mean: 0,
        stddev: 0,
        sigmaDeviation: 0,
        direction: "high",
        description: `Context utilization ${pct}%${isCritical ? " (critical)" : " (warning)"} — session may have experienced degraded instruction following`,
        method: "threshold",
      });
    }
  }

  // Statistical checks require minimum session count
  if (sessions.length < o.minSessions) return anomalies;

  // Group sessions by backend to avoid bimodal-population false positives
  const byBackend = new Map<string, SessionMetrics[]>();
  for (const s of sessions) {
    const key = s.backend ?? "unknown";
    const group = byBackend.get(key);
    if (group) group.push(s);
    else byBackend.set(key, [s]);
  }

  /** σ-based anomaly check for symmetric distributions. */
  function checkMetricSigma(
    group: SessionMetrics[],
    metric: Anomaly["metric"],
    extract: (s: SessionMetrics) => number | null,
    direction: "high" | "low",
    filterBaseline?: (value: number) => boolean,
    skipAlert?: (session: SessionMetrics) => boolean,
  ): void {
    const entries: { session: SessionMetrics; value: number }[] = [];
    for (const s of group) {
      const v = extract(s);
      if (v !== null) entries.push({ session: s, value: v });
    }
    if (entries.length < o.minSessions) return;

    const baselineValues = filterBaseline
      ? entries.map((e) => e.value).filter(filterBaseline)
      : entries.map((e) => e.value);
    if (baselineValues.length < o.minSessions) return;

    const { mean, stddev } = stats(baselineValues);

    if (stddev === 0) return;

    for (const entry of entries) {
      if (skipAlert?.(entry.session)) continue;

      const deviation = (entry.value - mean) / stddev;
      const shouldFlag =
        direction === "high"
          ? deviation > o.sigmaThreshold
          : deviation < -o.sigmaThreshold;

      if (shouldFlag) {
        const absDeviation = Math.abs(deviation);
        const label = metricLabel(metric);
        const valueStr = formatMetricValue(metric, entry.value);
        const meanStr = formatMetricValue(metric, mean);

        anomalies.push({
          metric,
          sessionRunId: entry.session.runId,
          sessionTimestamp: entry.session.timestamp,
          value: entry.value,
          mean,
          stddev,
          sigmaDeviation: Math.round(absDeviation * 10) / 10,
          direction,
          description: `${label} ${valueStr} is ${(Math.round(absDeviation * 10) / 10).toFixed(1)}σ ${direction === "high" ? "above" : "below"} mean ${meanStr}`,
          method: "sigma",
        });
      }
    }
  }

  /** Percentile-based anomaly check for right-skewed distributions. */
  function checkMetricPercentile(
    group: SessionMetrics[],
    metric: Anomaly["metric"],
    extract: (s: SessionMetrics) => number | null,
    direction: "high" | "low",
  ): void {
    const entries: { session: SessionMetrics; value: number }[] = [];
    for (const s of group) {
      if (!s.ok) continue;
      const v = extract(s);
      if (v !== null) entries.push({ session: s, value: v });
    }
    if (entries.length < o.minSessions) return;

    const values = entries.map((e) => e.value);
    const sorted = [...values].sort((a, b) => a - b);
    const { mean, stddev } = stats(values);

    const pThreshold = direction === "high"
      ? percentile(sorted, o.percentileThreshold)
      : percentile(sorted, 100 - o.percentileThreshold);

    const absMin = ABSOLUTE_MINIMUMS[metric as keyof typeof ABSOLUTE_MINIMUMS];

    for (const entry of entries) {
      const exceedsPercentile = direction === "high"
        ? entry.value > pThreshold
        : entry.value < pThreshold;

      const exceedsAbsMin = absMin === undefined || (
        direction === "high"
          ? entry.value > absMin
          : entry.value < absMin
      );

      if (exceedsPercentile && exceedsAbsMin) {
        const label = metricLabel(metric);
        const valueStr = formatMetricValue(metric, entry.value);
        const thresholdStr = formatMetricValue(metric, pThreshold);
        const pLabel = direction === "high"
          ? `P${o.percentileThreshold}`
          : `P${100 - o.percentileThreshold}`;

        anomalies.push({
          metric,
          sessionRunId: entry.session.runId,
          sessionTimestamp: entry.session.timestamp,
          value: entry.value,
          mean,
          stddev,
          sigmaDeviation: stddev > 0 ? Math.round(Math.abs((entry.value - mean) / stddev) * 10) / 10 : 0,
          direction,
          description: `${label} ${valueStr} exceeds ${pLabel} threshold ${thresholdStr}`,
          method: "percentile",
        });
      }
    }
  }

  // Run anomaly checks per backend group
  for (const group of byBackend.values()) {
    // σ-based: symmetric distributions
    // Cost: exclude $0.00 sessions (billing failures) from baseline to avoid skew
    // Also skip cost alerts for productive sessions (findings/cost > threshold)
    checkMetricSigma(
      group,
      "costUsd",
      (s) => s.costUsd,
      "high",
      (v) => v > 0,
      (s) => {
        const fpd = findingsPerDollar(s);
        return fpd !== null && fpd > FINDINGS_PER_DOLLAR_THRESHOLD;
      },
    );
    checkMetricSigma(
      group,
      "knowledgeTotal",
      (s) => (s.knowledge ? knowledgeTotal(s.knowledge) : null),
      "low",
    );

    // Percentile-based: right-skewed distributions
    checkMetricPercentile(group, "durationMs", (s) => s.durationMs, "high");
    checkMetricPercentile(group, "numTurns", (s) => s.numTurns, "high");
  }

  // Sort by sigma deviation descending (most anomalous first)
  anomalies.sort((a, b) => b.sigmaDeviation - a.sigmaDeviation);

  return anomalies;
}

/** Human-readable label for a metric. */
function metricLabel(metric: Anomaly["metric"]): string {
  switch (metric) {
    case "costUsd":
      return "Cost";
    case "durationMs":
      return "Duration";
    case "numTurns":
      return "Turns";
    case "knowledgeTotal":
      return "Knowledge output";
    case "contextUtilization":
      return "Context utilization";
  }
}

/** Format a metric value for display. */
function formatMetricValue(metric: Anomaly["metric"], value: number): string {
  switch (metric) {
    case "costUsd":
      return `$${value.toFixed(2)}`;
    case "durationMs":
      return `${Math.round(value / 1000)}s`;
    case "numTurns":
      return `${Math.round(value)}`;
    case "knowledgeTotal":
      return `${Math.round(value)}`;
    case "contextUtilization":
      return `${Math.round(value * 100)}%`;
  }
}

/**
 * Compute context utilization for a session.
 * Returns the highest utilization across all models used, or null if unavailable.
 *
 * Formula: inputTokens / contextWindow
 *
 * Note: We use only inputTokens, not inputTokens + cacheCreationInputTokens.
 * cacheCreationInputTokens is cumulative cache write size across the session,
 * not simultaneous context occupancy. Adding it produces false positives.
 * See diagnosis/diagnosis-context-utilization-formula-bug-2026-02-26.md.
 */
export function computeContextUtilization(session: SessionMetrics): number | null {
  if (!session.modelUsage) return null;

  let maxUtilization = 0;
  for (const model of Object.values(session.modelUsage)) {
    if (model.contextWindow && model.contextWindow > 0) {
      // Use only inputTokens (uncached tokens). This is a lower bound on actual context
      // occupancy since most tokens are served from cache, but it avoids false positives
      // from cumulative cacheCreationInputTokens counts.
      const utilization = model.inputTokens / model.contextWindow;
      maxUtilization = Math.max(maxUtilization, utilization);
    }
  }
  return maxUtilization > 0 ? maxUtilization : null;
}

export interface AnomalyReport {
  summary: string;
  details: string;
}

/**
 * Format anomaly detection results as a structured report with a short summary
 * line and full details.
 */
export function formatAnomalyReport(anomalies: Anomaly[]): AnomalyReport {
  if (anomalies.length === 0) {
    const msg = ":white_check_mark: Anomaly detection: no statistical outliers detected.";
    return { summary: msg, details: msg };
  }

  const metrics = [...new Set(anomalies.map((a) => a.metric))];
  const summary = `:mag: Anomaly detection: ${anomalies.length} outlier(s) — ${metrics.join(", ")}`;

  const lines: string[] = [
    `:mag: *Anomaly detection: ${anomalies.length} outlier(s) detected*`,
    "",
  ];

  for (const a of anomalies) {
    let icon: string;
    let label: string;
    if (a.method === "threshold") {
      const isCritical = a.value >= CONTEXT_UTILIZATION_CRITICAL_THRESHOLD;
      icon = isCritical ? ":red_circle:" : ":large_orange_circle:";
      label = `${a.direction}, threshold`;
    } else {
      icon = a.sigmaDeviation >= 3 ? ":red_circle:" : ":large_orange_circle:";
      label = `${a.direction}, ${a.sigmaDeviation.toFixed(1)}σ`;
    }
    lines.push(
      `${icon} *${a.metric}* [${label}] — session \`${a.sessionRunId}\``,
    );
    lines.push(`  ${a.description}`);
    lines.push("");
  }

  return { summary, details: lines.join("\n").trim() };
}

/**
 * Run anomaly detection: read recent sessions, analyze, and return results.
 * Main entry point for CLI and scheduled invocations.
 */
export async function runAnomalyDetection(opts?: {
  limit?: number;
  detectionOpts?: AnomalyDetectionOpts;
}): Promise<{ anomalies: Anomaly[]; sessionsAnalyzed: number }> {
  const limit = opts?.limit ?? 20;
  const sessions = await readMetrics({ limit });
  const anomalies = detectAnomalies(sessions, opts?.detectionOpts);
  return { anomalies, sessionsAnalyzed: sessions.length };
}
