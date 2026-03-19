/** Session health watchdog — detects anomalies in recent session metrics. */

import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { readMetrics } from "./metrics.js";
import type { SessionMetrics, KnowledgeMetrics } from "./metrics.js";
import { readAllBudgetStatuses } from "./notify.js";
import { EXCLUDED_PROJECTS } from "./constants.js";
import { isBillingError } from "./backend.js";
import { listSessionBranches, getBranchLastCommitDate } from "./branch-cleanup.js";

// ── Specialization readiness ────────────────────────────────────────────────

export interface ReadinessSignal {
  id: string;
  name: string;
  rawValue: number | null;
  normalizedValue: number;
  weight: number;
  status: "healthy" | "monitor" | "warning" | "critical" | "unavailable";
}

export interface ReadinessScore {
  composite: number;
  band: "healthy" | "monitor" | "warning" | "critical";
  signals: ReadinessSignal[];
  sessionsAnalyzed: number;
  /** True when <50% of signal weight is available — composite is suppressed to avoid fleet-confounded inflation. */
  insufficientData?: boolean;
}

// Thresholds from architecture/specialization-readiness-metrics.md
const READINESS_WEIGHTS = {
  orient_overhead: 0.30,
  findings_per_dollar: 0.25,
  cross_project_miss_rate: 0.20,
  quality_regression: 0.15,
  budget_drift: 0.10,
} as const;

const ORIENT_BASELINE = 0.37;
const ORIENT_CRITICAL = 0.55;
const FPD_BASELINE = 1.14;
const FPD_CRITICAL = 0.30;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function normalizeSignal(value: number, baseline: number, critical: number): number {
  if (critical === baseline) return 0;
  return clamp01((value - baseline) / (critical - baseline));
}

function signalStatus(normalized: number): ReadinessSignal["status"] {
  if (normalized >= 0.78) return "critical";
  if (normalized >= 0.56) return "warning";
  if (normalized >= 0.17) return "monitor";
  return "healthy";
}

// ── Budget drift ────────────────────────────────────────────────────────────

export interface BudgetDriftInput {
  project: string;
  resources: Array<{ resource: string; consumed: number; limit: number }>;
  /** Fraction of budget period elapsed (0 to 1), or null if cannot be computed. */
  timeElapsedFraction: number | null;
}

export interface BudgetDriftResourceDetail {
  resource: string;
  utilization: number;
  expectedUtilization: number | null;
  deviation: number;
}

export interface BudgetDriftData {
  /** Mean absolute deviation between utilization and expected utilization. */
  drift: number;
  projects: Array<{
    project: string;
    resources: BudgetDriftResourceDetail[];
  }>;
}

export interface BranchStats {
  totalBranches: number;
  unmergedBranches: Array<{ name: string; ageHours: number }>;
}

const BUDGET_DRIFT_BASELINE = 0.20;
const BUDGET_DRIFT_CRITICAL = 1.00;

/**
 * Extract the earliest entry date from ledger YAML text.
 * Returns ISO date string (YYYY-MM-DD) or null if no entries found.
 */
export function parseEarliestLedgerDate(ledgerText: string): string | null {
  let earliest: string | null = null;
  for (const line of ledgerText.split("\n")) {
    const m = line.match(/^\s+-?\s*date:\s*["']?(\d{4}-\d{2}-\d{2})["']?/);
    if (m) {
      const date = m[1]!;
      if (earliest === null || date < earliest) {
        earliest = date;
      }
    }
  }
  return earliest;
}

export async function getBranchStats(cwd: string, now?: Date): Promise<BranchStats> {
  const nowMs = (now ?? new Date()).getTime();
  const branches = await listSessionBranches(cwd);
  const unmergedBranches: Array<{ name: string; ageHours: number }> = [];

  for (const branch of branches) {
    if (!branch.merged) {
      const lastCommitDate = await getBranchLastCommitDate(cwd, branch.name);
      if (lastCommitDate) {
        const ageMs = nowMs - lastCommitDate.getTime();
        const ageHours = Math.floor(ageMs / (1000 * 60 * 60));
        unmergedBranches.push({ name: branch.name, ageHours });
      }
    }
  }

  return {
    totalBranches: branches.length,
    unmergedBranches,
  };
}

/**
 * Compute budget drift: mean |utilization - expected_utilization| across all resources.
 * When timeElapsedFraction is available, expected_utilization = timeElapsedFraction
 * (assumes linear consumption over the budget period).
 * When unavailable, the resource is excluded from the drift calculation.
 */
export function computeBudgetDrift(inputs: BudgetDriftInput[]): BudgetDriftData {
  const projects: BudgetDriftData["projects"] = [];
  const deviations: number[] = [];

  for (const input of inputs) {
    const resources: BudgetDriftResourceDetail[] = [];
    for (const r of input.resources) {
      if (r.limit <= 0) continue;
      const utilization = r.consumed / r.limit;
      const expected = input.timeElapsedFraction;
      if (expected !== null) {
        const deviation = Math.abs(utilization - expected);
        deviations.push(deviation);
        resources.push({
          resource: r.resource,
          utilization: Math.round(utilization * 1000) / 1000,
          expectedUtilization: Math.round(expected * 1000) / 1000,
          deviation: Math.round(deviation * 1000) / 1000,
        });
      } else {
        resources.push({
          resource: r.resource,
          utilization: Math.round(utilization * 1000) / 1000,
          expectedUtilization: null,
          deviation: 0,
        });
      }
    }
    if (resources.length > 0) {
      projects.push({ project: input.project, resources });
    }
  }

  const drift =
    deviations.length > 0
      ? deviations.reduce((sum, d) => sum + d, 0) / deviations.length
      : 0;

  return { drift: Math.round(drift * 1000) / 1000, projects };
}

/**
 * Compute the specialization readiness score from session metrics.
 * Implements the composite score formula from specialization-readiness-metrics.md.
 * Signals without sufficient data are marked 'unavailable' and excluded from the composite.
 */
export function computeReadinessScore(
  sessions: SessionMetrics[],
  opts?: { budgetDrift?: BudgetDriftData },
): ReadinessScore {
  const signals: ReadinessSignal[] = [];
  const MIN_SIGNAL_SESSIONS = 5;

  // Signal 1: Orient overhead
  const orientSessions = sessions.filter(
    (s) => s.ok && s.orientTurns !== null && s.numTurns !== null && s.numTurns > 10,
  );
  if (orientSessions.length >= MIN_SIGNAL_SESSIONS) {
    const overhead =
      orientSessions.reduce((sum, s) => sum + s.orientTurns! / s.numTurns!, 0) /
      orientSessions.length;
    const norm = normalizeSignal(overhead, ORIENT_BASELINE, ORIENT_CRITICAL);
    signals.push({
      id: "orient_overhead",
      name: "Orient Overhead",
      rawValue: Math.round(overhead * 1000) / 1000,
      normalizedValue: norm,
      weight: READINESS_WEIGHTS.orient_overhead,
      status: signalStatus(norm),
    });
  } else {
    signals.push({
      id: "orient_overhead",
      name: "Orient Overhead",
      rawValue: null,
      normalizedValue: 0,
      weight: READINESS_WEIGHTS.orient_overhead,
      status: "unavailable",
    });
  }

  // Signal 2: Findings per dollar (inverted — low f/$ is bad)
  const costSessions = sessions.filter(
    (s) => s.ok && s.costUsd !== null && s.costUsd > 0 && s.knowledge !== null,
  );
  if (costSessions.length >= MIN_SIGNAL_SESSIONS) {
    const totalFindings = costSessions.reduce(
      (sum, s) => sum + s.knowledge!.newExperimentFindings + s.knowledge!.logEntryFindings,
      0,
    );
    const totalCost = costSessions.reduce((sum, s) => sum + s.costUsd!, 0);
    const fPerDollar = totalCost > 0 ? totalFindings / totalCost : 0;
    const norm = normalizeSignal(FPD_BASELINE - fPerDollar, 0, FPD_BASELINE - FPD_CRITICAL);
    signals.push({
      id: "findings_per_dollar",
      name: "Findings/Dollar",
      rawValue: Math.round(fPerDollar * 100) / 100,
      normalizedValue: norm,
      weight: READINESS_WEIGHTS.findings_per_dollar,
      status: signalStatus(norm),
    });
  } else {
    signals.push({
      id: "findings_per_dollar",
      name: "Findings/Dollar",
      rawValue: null,
      normalizedValue: 0,
      weight: READINESS_WEIGHTS.findings_per_dollar,
      status: "unavailable",
    });
  }

  // Signal 3: Cross-project miss rate — proxy from crossProjectRefs
  // Full miss rate requires crossProjectOpportunities (not yet instrumented).
  // Proxy: 1 - (sessions with cross-project refs / sessions touching >1 project).
  const cpSessions = sessions.filter((s) => s.ok && s.crossProject !== null);
  if (cpSessions.length >= MIN_SIGNAL_SESSIONS) {
    const withRefs = cpSessions.filter((s) => (s.crossProject!.crossProjectRefs ?? 0) > 0).length;
    const refRate = withRefs / cpSessions.length;
    const missRate = 1 - refRate;
    const norm = normalizeSignal(missRate, 0.50, 0.85);
    signals.push({
      id: "cross_project_miss_rate",
      name: "Cross-Project Miss Rate",
      rawValue: Math.round(missRate * 1000) / 1000,
      normalizedValue: norm,
      weight: READINESS_WEIGHTS.cross_project_miss_rate,
      status: signalStatus(norm),
    });
  } else {
    signals.push({
      id: "cross_project_miss_rate",
      name: "Cross-Project Miss Rate",
      rawValue: null,
      normalizedValue: 0,
      weight: READINESS_WEIGHTS.cross_project_miss_rate,
      status: "unavailable",
    });
  }

  // Signal 4: Audit findings intensity (findings per experiment reviewed)
  const qaSessions = sessions.filter((s) => s.ok && s.qualityAudit !== null);
  if (qaSessions.length >= MIN_SIGNAL_SESSIONS) {
    const totalAudited = qaSessions.reduce(
      (sum, s) => sum + (s.qualityAudit!.experimentsAudited ?? 0),
      0,
    );
    const totalAuditFindings = qaSessions.reduce(
      (sum, s) => sum + (s.qualityAudit!.auditFindings ?? 0),
      0,
    );
    const totalCompleted = sessions
      .filter((s) => s.ok && s.knowledge !== null)
      .reduce((sum, s) => sum + (s.knowledge!.experimentsCompleted ?? 0), 0);

    const findingsIntensity = totalAudited > 0 ? totalAuditFindings / totalAudited : 0;
    const coverage = totalCompleted > 0 ? Math.min(1, totalAudited / totalCompleted) : 1;
    const s4Rate = normalizeSignal(findingsIntensity, 0.5, 1.0);
    const s4Coverage = normalizeSignal(1 - coverage, 0.70, 0.90);
    const norm = Math.max(s4Rate, s4Coverage);
    signals.push({
      id: "quality_regression",
      name: "Audit Findings Intensity",
      rawValue: Math.round(findingsIntensity * 1000) / 1000,
      normalizedValue: norm,
      weight: READINESS_WEIGHTS.quality_regression,
      status: signalStatus(norm),
    });
  } else {
    signals.push({
      id: "quality_regression",
      name: "Audit Findings Intensity",
      rawValue: null,
      normalizedValue: 0,
      weight: READINESS_WEIGHTS.quality_regression,
      status: "unavailable",
    });
  }

  // Signal 5: Budget drift — computed from budget.yaml + ledger.yaml when available
  const bd = opts?.budgetDrift;
  if (bd && bd.projects.some((p) => p.resources.some((r) => r.expectedUtilization !== null))) {
    const norm = normalizeSignal(bd.drift, BUDGET_DRIFT_BASELINE, BUDGET_DRIFT_CRITICAL);
    signals.push({
      id: "budget_drift",
      name: "Budget Drift",
      rawValue: bd.drift,
      normalizedValue: norm,
      weight: READINESS_WEIGHTS.budget_drift,
      status: signalStatus(norm),
    });
  } else {
    signals.push({
      id: "budget_drift",
      name: "Budget Drift",
      rawValue: null,
      normalizedValue: 0,
      weight: READINESS_WEIGHTS.budget_drift,
      status: "unavailable",
    });
  }

  // Composite score — renormalize weights for available signals.
  // Require ≥50% of total weight to be available; otherwise the composite is
  // unreliable (e.g., 2/5 fleet-confounded signals can inflate to "critical").
  const MIN_AVAILABLE_WEIGHT = 0.50;
  const available = signals.filter((s) => s.status !== "unavailable");
  const totalWeight = available.reduce((sum, s) => sum + s.weight, 0);
  let composite = 0;
  const insufficientData = totalWeight < MIN_AVAILABLE_WEIGHT;
  if (totalWeight > 0 && !insufficientData) {
    composite = available.reduce((sum, s) => sum + s.weight * s.normalizedValue, 0) / totalWeight;
  }

  const band: ReadinessScore["band"] = insufficientData
    ? "healthy"
    : composite >= 0.7
      ? "critical"
      : composite >= 0.5
        ? "warning"
        : composite >= 0.3
          ? "monitor"
          : "healthy";

  return {
    composite: Math.round(composite * 1000) / 1000,
    band,
    signals,
    sessionsAnalyzed: sessions.length,
    ...(insufficientData ? { insufficientData: true } : {}),
  };
}

/**
 * Format readiness score as a Slack-friendly report.
 */
export function formatReadinessReport(score: ReadinessScore): string {
  const bandEmoji: Record<ReadinessScore["band"], string> = {
    healthy: ":white_check_mark:",
    monitor: ":large_blue_circle:",
    warning: ":warning:",
    critical: ":red_circle:",
  };
  const lines: string[] = [
    score.insufficientData
      ? `:large_blue_circle: *Specialization readiness: insufficient data (<50% signal weight available)*`
      : `${bandEmoji[score.band]} *Specialization readiness: ${score.composite.toFixed(2)} (${score.band})*`,
  ];
  for (const s of score.signals) {
    const val = s.rawValue !== null ? String(s.rawValue) : "N/A";
    const statusIcon =
      s.status === "unavailable"
        ? ":black_circle:"
        : s.status === "healthy"
          ? ":white_check_mark:"
          : s.status === "monitor"
            ? ":large_blue_circle:"
            : s.status === "warning"
              ? ":warning:"
              : ":red_circle:";
    lines.push(`  ${statusIcon} ${s.name}: ${val} (weight ${s.weight}, norm ${s.normalizedValue.toFixed(2)})`);
  }
  return lines.join("\n");
}

// ── Stale approval queue detection ───────────────────────────────────────────

export interface PendingApprovalItem {
  title: string;
  date: string;
  ageDays: number;
  project: string;
  type: string;
}

/**
 * Extract pending approval items with dates from APPROVAL_QUEUE.md content.
 * Returns items with their title, date (from header), age in days, project, and type.
 * Pure function — no I/O.
 */
export function extractPendingApprovalItems(
  content: string,
  now?: Date,
): PendingApprovalItem[] {
  const items: PendingApprovalItem[] = [];
  const nowMs = (now ?? new Date()).getTime();
  let inPending = false;
  let currentItem: Partial<PendingApprovalItem> | null = null;

  for (const line of content.split("\n")) {
    if (/^## Pending\b/.test(line)) {
      inPending = true;
      continue;
    }
    if (inPending && /^## /.test(line) && !/^## Pending/.test(line)) {
      break;
    }
    if (inPending && /^### /.test(line)) {
      if (currentItem && currentItem.title && currentItem.date) {
        items.push(currentItem as PendingApprovalItem);
      }
      const headerMatch = line.match(/^###\s+(\d{4}-\d{2}-\d{2})\s*—\s*(.+)/);
      if (headerMatch) {
        const date = headerMatch[1];
        const title = headerMatch[2].trim();
        const dateMs = new Date(date + "T00:00:00Z").getTime();
        const ageDays = Math.floor((nowMs - dateMs) / (1000 * 60 * 60 * 24));
        currentItem = { title, date, ageDays };
      } else {
        currentItem = null;
      }
      continue;
    }
    if (inPending && currentItem) {
      const projectMatch = line.match(/^Project:\s*(.+)/);
      if (projectMatch) {
        currentItem.project = projectMatch[1].trim();
      }
      const typeMatch = line.match(/^Type:\s*(.+)/);
      if (typeMatch) {
        currentItem.type = typeMatch[1].trim();
      }
    }
  }
  if (currentItem && currentItem.title && currentItem.date) {
    items.push(currentItem as PendingApprovalItem);
  }
  return items;
}

/**
 * Filter pending approval items to only those older than the threshold.
 * @param items - Pending approval items
 * @param thresholdDays - Age threshold in days (default: 7)
 * @returns Items older than threshold
 */
export function filterStaleApprovalItems(
  items: PendingApprovalItem[],
  thresholdDays: number = 7,
): PendingApprovalItem[] {
  return items.filter((item) => item.ageDays > thresholdDays);
}

// ── Health checks ───────────────────────────────────────────────────────────

export interface HealthCheck {
  /** Machine-readable check identifier. */
  id: string;
  /** Human-readable description. */
  description: string;
  /** Severity: high (requires immediate attention), medium (investigate). */
  severity: "high" | "medium";
  /** The measured value (percentage, count, or ratio). */
  value: number;
  /** The threshold that was exceeded. */
  threshold: number;
  /** Actionable recommendation. */
  recommendation: string;
}

export interface HealthCheckOpts {
  /** Error rate threshold as percentage (default: 30). */
  errorRateThreshold?: number;
  /** Cost spike threshold as percentage above baseline (default: 50). */
  costSpikeThreshold?: number;
  /** Zero-knowledge rate threshold as percentage (default: 15).
   *  Lowered from 20% to 15% after genuine-waste-overcount-analysis-2026-02-27
   *  found true waste rate is ~10% once isGenuineWaste() correctly excludes
   *  sessions with commits+file changes. */
  zeroKnowledgeRateThreshold?: number;
  /** Consecutive failure count threshold (default: 3). Flag when exceeded. */
  consecutiveFailureThreshold?: number;
  /** Commits-ahead threshold for push failure detection (default: 10). */
  commitsAheadThreshold?: number;
  /** Stale approval queue age threshold in days (default: 7). */
  staleApprovalDaysThreshold?: number;
  /** Total branch count threshold (default: 50). Alert when exceeded. */
  branchCountThreshold?: number;
  /** Unmerged branch age threshold in hours (default: 48). Alert when exceeded. */
  unmergedBranchAgeThreshold?: number;
}

export interface HealthCheckInput {
  opts?: HealthCheckOpts & { budgetDrift?: BudgetDriftData };
  /** Number of commits local is ahead of origin. If not provided, push failure check is skipped. */
  commitsAhead?: number;
  /** Stale approval items from APPROVAL_QUEUE.md. If not provided, stale approval check is skipped. */
  staleApprovalItems?: PendingApprovalItem[];
  /** Branch statistics from getBranchStats(). If not provided, branch count check is skipped. */
  branchStats?: BranchStats;
}

const DEFAULT_OPTS: Required<HealthCheckOpts> = {
  errorRateThreshold: 30,
  costSpikeThreshold: 50,
  zeroKnowledgeRateThreshold: 15,
  consecutiveFailureThreshold: 3,
  commitsAheadThreshold: 10,
  staleApprovalDaysThreshold: 7,
  branchCountThreshold: 50,
  unmergedBranchAgeThreshold: 48,
};

/** Check if all knowledge counts are zero. Matches patterns.ts isZeroKnowledge(). */
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

/**
 * Check if a zero-knowledge session is genuine waste (not structural work, orphan management, or cursor).
 * Matches the genuine waste taxonomy from analysis/zero-knowledge-session-analysis.md.
 */
function isGenuineWaste(s: SessionMetrics): boolean {
  if (s.backend === "cursor") return false;
  // Idle exploration sessions are designed to produce zero output when nothing
  // relevant is found. They are not waste — they checked and confirmed "nothing new".
  if (s.isIdle) return false;
  if (s.verification) {
    // High filesChanged indicates structural refactoring, not waste
    if (s.verification.filesChanged >= 50) return false;
    // Sessions with commits and file changes did work, not waste
    if (s.verification.hasCommit && s.verification.filesChanged > 0) return false;
  }
  return true;
}

/**
 * Check if a zero-knowledge session is task starvation (supply problem, not quality problem).
 * Task starvation: session had no work to do (0 commits, 0 files, 0 projects touched).
 * This indicates a supply problem (no tasks available), not a quality problem (agent failed).
 */
function isTaskStarvation(s: SessionMetrics): boolean {
  if (!s.verification) return false;
  if (s.backend === "cursor") return false;
  // Idle exploration sessions are designed to produce zero output when nothing
  // needs attention. They are not task starvation — they checked and found nothing.
  if (s.isIdle) return false;
  const noCommits = !s.verification.hasCommit;
  const noFiles = s.verification.filesChanged === 0;
  const noProjects = !s.crossProject || s.crossProject.projectsTouched.length === 0;
  return noCommits && noFiles && noProjects;
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
 * Get the number of commits HEAD is ahead of origin/main.
 * Returns 0 if git command fails or origin/main does not exist.
 */
export async function getCommitsAhead(repoDir: string): Promise<number> {
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);
    
    const { stdout } = await execFileAsync(
      "git",
      ["rev-list", "--count", "HEAD", "--not", "origin/main"],
      { cwd: repoDir, timeout: 5000 },
    );
    const count = parseInt(stdout.trim(), 10);
    return Number.isFinite(count) ? count : 0;
  } catch {
    return 0;
  }
}

/**
 * Analyze session health metrics and return any triggered checks.
 * Pure function — no I/O. Takes an array of SessionMetrics (most recent last).
 */
export function analyzeHealth(
  sessions: SessionMetrics[],
  input?: HealthCheckInput,
): HealthCheck[] {
  if (sessions.length === 0) return [];

  const o = { ...DEFAULT_OPTS, ...input?.opts };
  const checks: HealthCheck[] = [];
  
  // Filter out idle exploration sessions — they should not count toward operational metrics
  const taskBearing = sessions.filter((s) => !s.isIdle);
  const total = taskBearing.length;

  // 1. Error rate (excludes idle exploration)
  const failedCount = taskBearing.filter((s) => !s.ok).length;
  const errorRate = total > 0 ? Math.round((failedCount / total) * 100) : 0;
  if (total > 0 && errorRate > o.errorRateThreshold) {
    checks.push({
      id: "high_error_rate",
      description: `Error rate ${errorRate}% exceeds ${o.errorRateThreshold}% threshold (${failedCount}/${total} task-bearing sessions failed, ${sessions.length - taskBearing.length} idle)`,
      severity: "high",
      value: errorRate,
      threshold: o.errorRateThreshold,
      recommendation:
        "Investigate failing sessions. Check for infrastructure issues, budget blocks, or recurring agent errors.",
    });
  }

  // 2. Cost spike — compare recent half vs older half median (uses all sessions)
  const costs = sessions
    .map((s) => s.costUsd)
    .filter((c): c is number => c !== null && c > 0);
  if (costs.length >= 8) {
    const midpoint = Math.floor(costs.length / 2);
    const olderMedian = median(costs.slice(0, midpoint));
    const recentMedian = median(costs.slice(midpoint));
    if (olderMedian > 0) {
      const spikePercent = Math.round(
        ((recentMedian - olderMedian) / olderMedian) * 100,
      );
      if (spikePercent > o.costSpikeThreshold) {
        checks.push({
          id: "cost_spike",
          description: `Cost spike: recent median $${recentMedian.toFixed(2)} is ${spikePercent}% above baseline $${olderMedian.toFixed(2)}`,
          severity: "medium",
          value: spikePercent,
          threshold: o.costSpikeThreshold,
          recommendation:
            "Check whether high-cost sessions are productive (complex tasks) or wasteful (loops, retries, oversized context).",
        });
      }
    }
  }

  // 3. Zero-knowledge rate (genuine waste only, excluding task starvation)
  const withKnowledge = sessions.filter((s) => s.knowledge !== null);
  if (withKnowledge.length > 0) {
    const zeroKnowledgeSessions = withKnowledge.filter((s) => isZeroKnowledge(s.knowledge!));
    const taskStarvationSessions = zeroKnowledgeSessions.filter((s) => isTaskStarvation(s));
    const genuineWasteSessions = zeroKnowledgeSessions.filter(
      (s) => !isTaskStarvation(s) && isGenuineWaste(s),
    );

    // Report task starvation separately
    if (taskStarvationSessions.length > 0) {
      const tsRate = Math.round((taskStarvationSessions.length / withKnowledge.length) * 100);
      checks.push({
        id: "task_starvation",
        description: `${taskStarvationSessions.length}/${withKnowledge.length} sessions had no work to do (0 commits, 0 files, 0 projects) — task starvation rate ${tsRate}%`,
        severity: "medium",
        value: tsRate,
        threshold: 0,
        recommendation:
          "Fleet workers had no tasks available. Review fleet supply: check for stale tasks blocking supply, or add more fleet-eligible tasks. Task starvation is a supply problem, not a quality problem.",
      });
    }

    // Report genuine waste (excluding task starvation)
    const genuineWasteCount = genuineWasteSessions.length;
    const zkRate = Math.round((genuineWasteCount / withKnowledge.length) * 100);
    if (zkRate > o.zeroKnowledgeRateThreshold) {
      checks.push({
        id: "high_zero_knowledge_rate",
        description: `Zero-knowledge rate ${zkRate}% exceeds ${o.zeroKnowledgeRateThreshold}% threshold (${genuineWasteCount}/${withKnowledge.length} genuine waste sessions, excluding task starvation)`,
        severity: "medium",
        value: zkRate,
        threshold: o.zeroKnowledgeRateThreshold,
        recommendation:
          "Review task selection. Sessions may be picking operational tasks with no measurable output, or knowledge metrics may need expansion.",
      });
    }
  }

  // 4. Consecutive failures (most recent streak, excludes idle exploration)
  // Billing errors are transient external issues, not infrastructure faults — exclude from count
  // Idle exploration timeouts are expected behavior, not systemic failures — exclude from count
  function isSystemicFailure(s: SessionMetrics): boolean {
    if (s.ok) return false;
    if (s.isIdle) return false; // Idle exploration timeouts are not systemic failures
    if (s.error && isBillingError(s.error)) return false;
    return true;
  }

  let maxConsecutive = 0;
  let currentStreak = 0;
  for (let i = sessions.length - 1; i >= 0; i--) {
    if (isSystemicFailure(sessions[i]!)) {
      currentStreak++;
      maxConsecutive = Math.max(maxConsecutive, currentStreak);
    } else {
      // Once we hit a success or transient failure after counting from the end, check if the trailing streak is already maxed
      if (currentStreak > 0) break;
      // If no systemic failures yet from the end, just continue
    }
  }
  // Also scan for any consecutive block in the array
  currentStreak = 0;
  for (const s of sessions) {
    if (isSystemicFailure(s)) {
      currentStreak++;
      maxConsecutive = Math.max(maxConsecutive, currentStreak);
    } else {
      currentStreak = 0;
    }
  }
  if (maxConsecutive > o.consecutiveFailureThreshold && maxConsecutive > 0) {
    checks.push({
      id: "consecutive_failures",
      description: `${maxConsecutive} consecutive session failures detected (threshold: ${o.consecutiveFailureThreshold})`,
      severity: "high",
      value: maxConsecutive,
      threshold: o.consecutiveFailureThreshold,
      recommendation:
        "Multiple consecutive failures suggest a systemic issue. Check infrastructure, dependencies, or agent configuration.",
    });
  }

  // 5. Babysitting detection: sessions that timed out with no agent commits.
  // This pattern indicates the agent was watching a long-running process in-process
  // (training, rendering) instead of using fire-and-forget (ADR 0017).
  const babysittingSessions = sessions.filter(
    (s) => s.timedOut && s.verification && !s.verification.hasCommit,
  );
  if (babysittingSessions.length > 0) {
    const rate = Math.round((babysittingSessions.length / total) * 100);
    checks.push({
      id: "babysitting_detected",
      description: `${babysittingSessions.length}/${total} session(s) timed out with zero commits — likely babysitting (watching training/rendering in-process)`,
      severity: babysittingSessions.length >= 2 ? "high" : "medium",
      value: babysittingSessions.length,
      threshold: 0,
      recommendation:
        "Sessions must use fire-and-forget via experiment runner for long-running processes (ADR 0017). " +
        "Check if agents are running training loops in-process instead of using `run.py --detach`.",
    });
  }

  // 6. Uncommitted work detection: sessions that ended with orphaned files.
  // Uses orphanedFiles (classified work artifacts) rather than uncommittedFiles (raw count),
  // because persistent expected files (.scheduler/jobs.json, .failed-evolution.json, modules/)
  // are always present and would cause false positives with raw uncommittedFiles.
  // Excludes idle exploration sessions — they inherit orphaned files from the shared working
  // tree but didn't create them. Only task-bearing sessions are responsible for committing.
  const orphanedWorkSessions = sessions.filter(
    (s) =>
      !s.isIdle &&
      s.verification &&
      s.verification.orphanedFiles &&
      s.verification.orphanedFiles > 0,
  );
  if (orphanedWorkSessions.length > 0) {
    const rate = Math.round((orphanedWorkSessions.length / total) * 100);
    checks.push({
      id: "uncommitted_work_detected",
      description: `${orphanedWorkSessions.length}/${total} session(s) ended with orphaned work files — sessions must commit before ending`,
      severity: orphanedWorkSessions.length >= 2 ? "high" : "medium",
      value: orphanedWorkSessions.length,
      threshold: 0,
      recommendation:
        "Sessions must commit work before ending. Check if agents are timing out before commit step, " +
        "or if verification should fail on uncommitted files.",
    });
  }

  // 7. Budget over-consumption
  if (input?.opts?.budgetDrift) {
    for (const p of input.opts.budgetDrift.projects) {
      for (const r of p.resources) {
        if (r.utilization > 1.0) {
          checks.push({
            id: "budget_over_consumption",
            description: `${p.project}/${r.resource}: consumed ${Math.round(r.utilization * 100)}% of budget limit`,
            severity: "high",
            value: Math.round(r.utilization * 100),
            threshold: 100,
            recommendation: `Project ${p.project} has exceeded its ${r.resource} budget. Scale down or request budget increase via APPROVAL_QUEUE.md.`,
          });
        }
      }
    }
  }

  // 8. Push failure: commits ahead of origin
  if (input?.commitsAhead !== undefined && input.commitsAhead > o.commitsAheadThreshold) {
    checks.push({
      id: "push_failure",
      description: `Local branch is ${input.commitsAhead} commits ahead of origin/main (threshold: ${o.commitsAheadThreshold}). Git push may be blocked or failing.`,
      severity: "medium",
      value: input.commitsAhead,
      threshold: o.commitsAheadThreshold,
      recommendation:
        "Check if git push is failing (large files, auth issues, network). " +
        "Run `git push` manually to diagnose. Consider the pre-commit hook for oversized files.",
    });
  }

  // 9. Specialization readiness score
  const readiness = computeReadinessScore(sessions, { budgetDrift: input?.opts?.budgetDrift });
  if (readiness.band === "warning" || readiness.band === "critical") {
    const elevated = readiness.signals.filter(
      (s) => s.status === "warning" || s.status === "critical",
    );
    const elevatedDesc = elevated
      .map((s) => `${s.name}: ${s.rawValue ?? "N/A"}`)
      .join(", ");
    checks.push({
      id: "specialization_readiness",
      description: `Specialization readiness score ${readiness.composite.toFixed(2)} in ${readiness.band} band. Elevated: ${elevatedDesc || "composite threshold crossed"}`,
      severity: readiness.band === "critical" ? "high" : "medium",
      value: Math.round(readiness.composite * 100),
      threshold: readiness.band === "critical" ? 70 : 50,
      recommendation:
        readiness.band === "critical"
          ? "Readiness score critical. Create APPROVAL_QUEUE.md entry proposing specialization evaluation per architecture/specialization-readiness-metrics.md."
          : "Readiness score in warning band. Run /diagnose on elevated signals to verify structural trend vs temporary fluctuation.",
    });
  }

  // 10. Human intervention rate (primary health metric for autonomous operation)
  // Target: <2:1 ratio of human-triggered to autonomous sessions
  const sessionsWithTrigger = sessions.filter((s) => s.triggerSource !== undefined);
  if (sessionsWithTrigger.length >= 5) {
    const autonomousCount = sessionsWithTrigger.filter((s) => s.triggerSource === "scheduler").length;
    const humanCount = sessionsWithTrigger.filter((s) => s.triggerSource === "slack" || s.triggerSource === "manual").length;
    const ratio = autonomousCount > 0 ? humanCount / autonomousCount : humanCount > 0 ? Infinity : 0;
    if (ratio > 2) {
      checks.push({
        id: "high_human_intervention_rate",
        description: `Human intervention ratio ${ratio.toFixed(1)}:1 exceeds target 2:1 (${humanCount} human-triggered vs ${autonomousCount} autonomous sessions)`,
        severity: "high",
        value: Math.round(ratio * 10) / 10,
        threshold: 2,
        recommendation:
          "High human intervention indicates autonomous operation is not scaling. " +
          "Per feedback-frequent-human-interventions-root-cause, consider L2→L0 migration to reduce convention fragility under weaker models.",
      });
    }
  }

  // 11. Stale approval queue items
  if (input?.staleApprovalItems && input.staleApprovalItems.length > 0) {
    const staleItems = filterStaleApprovalItems(input.staleApprovalItems, o.staleApprovalDaysThreshold);
    if (staleItems.length > 0) {
      const maxAge = Math.max(...staleItems.map((i) => i.ageDays));
      const ageGroups: Record<number, number> = {};
      for (const item of staleItems) {
        ageGroups[item.ageDays] = (ageGroups[item.ageDays] || 0) + 1;
      }
      const ageSummary = Object.entries(ageGroups)
        .sort((a, b) => parseInt(b[0]) - parseInt(a[0]))
        .map(([days, count]) => `${count} at ${days}d`)
        .join(", ");
      checks.push({
        id: "stale_approval_queue",
        description: `${staleItems.length} pending approval item(s) older than ${o.staleApprovalDaysThreshold} days (ages: ${ageSummary}). Oldest: ${maxAge} days. Items block downstream work until resolved.`,
        severity: maxAge >= 14 ? "high" : "medium",
        value: staleItems.length,
        threshold: o.staleApprovalDaysThreshold,
        recommendation:
          `Review stale items in APPROVAL_QUEUE.md. Items pending >7 days may indicate: ` +
          `(1) external dependency needing follow-up, (2) PI decision needed, or (3) task no longer relevant. ` +
          `Stale items block downstream autonomous work.`,
      });
    }
  }

  // 12. Branch count monitoring
  if (input?.branchStats) {
    const { totalBranches, unmergedBranches } = input.branchStats;
    
    if (totalBranches > o.branchCountThreshold) {
      checks.push({
        id: "high_branch_count",
        description: `${totalBranches} remote session branches exceed threshold of ${o.branchCountThreshold}. Consider running branch cleanup to remove merged/stale branches.`,
        severity: "medium",
        value: totalBranches,
        threshold: o.branchCountThreshold,
        recommendation:
          "Run scheduled branch cleanup or manually clean up old session branches. " +
          "High branch counts can slow down git operations and indicate cleanup is not running.",
      });
    }

    const oldUnmerged = unmergedBranches.filter((b) => b.ageHours > o.unmergedBranchAgeThreshold);
    if (oldUnmerged.length > 0) {
      const maxAge = Math.max(...oldUnmerged.map((b) => b.ageHours));
      const maxAgeHours = Math.round(maxAge);
      checks.push({
        id: "stale_unmerged_branches",
        description: `${oldUnmerged.length} unmerged session branch(es) older than ${o.unmergedBranchAgeThreshold} hours. Oldest: ${maxAgeHours} hours. These may contain abandoned work.`,
        severity: "medium",
        value: oldUnmerged.length,
        threshold: o.unmergedBranchAgeThreshold,
        recommendation:
          "Review old unmerged branches for potentially lost work. " +
          "If work was completed, ensure branches are properly rebased and merged. " +
          "If abandoned, clean up via branch cleanup.",
      });
    }
  }

  // Sort by severity: high before medium
  const severityOrder: Record<string, number> = { high: 0, medium: 1 };
  checks.sort(
    (a, b) => severityOrder[a.severity]! - severityOrder[b.severity]!,
  );

  return checks;
}

export interface HealthReport {
  summary: string;
  details: string;
}

/**
 * Format health check results as a structured report with a short summary
 * line and full details. The summary is suitable for a top-level Slack DM;
 * details can be posted as a threaded reply or printed to the console.
 */
export function formatHealthReport(checks: HealthCheck[]): HealthReport {
  if (checks.length === 0) {
    const msg = ":white_check_mark: Session health watchdog: all clear. No anomalies detected.";
    return { summary: msg, details: msg };
  }

  const highCount = checks.filter((c) => c.severity === "high").length;
  const mediumCount = checks.length - highCount;
  const severityParts: string[] = [];
  if (highCount > 0) severityParts.push(`${highCount} high`);
  if (mediumCount > 0) severityParts.push(`${mediumCount} medium`);
  const summary = `:warning: Session health watchdog: ${checks.length} issue(s) — ${severityParts.join(", ")}`;

  const lines: string[] = [
    `:warning: *Session health watchdog: ${checks.length} issue(s) detected*`,
    "",
  ];

  for (const check of checks) {
    const icon = check.severity === "high" ? ":red_circle:" : ":large_orange_circle:";
    lines.push(`${icon} *${check.id}* [${check.severity}] — value: ${check.value}, threshold: ${check.threshold}`);
    lines.push(`  ${check.description}`);
    lines.push(`  → ${check.recommendation}`);
    lines.push("");
  }

  return { summary, details: lines.join("\n").trim() };
}

/**
 * Read ledger.yaml from a project directory and return the earliest entry date.
 * Returns null if ledger doesn't exist or has no date entries.
 */
async function readEarliestLedgerDate(projectDir: string): Promise<string | null> {
  try {
    const text = await readFile(join(projectDir, "ledger.yaml"), "utf-8");
    return parseEarliestLedgerDate(text);
  } catch {
    return null;
  }
}

/**
 * Build BudgetDriftInput[] from budget statuses by reading ledger dates
 * and computing time-elapsed fractions.
 */
export async function buildBudgetDriftInputs(
  repoDir: string,
  statuses: Array<{ project: string; status: { resources: Array<{ resource: string; consumed: number; limit: number; pct: number }>; deadline?: string; hoursToDeadline?: number } }>,
  now?: Date,
): Promise<BudgetDriftInput[]> {
  const inputs: BudgetDriftInput[] = [];
  const nowMs = (now ?? new Date()).getTime();

  for (const { project, status } of statuses) {
    let timeElapsedFraction: number | null = null;

    if (status.deadline && status.hoursToDeadline != null && status.hoursToDeadline > 0) {
      const projectDir = join(repoDir, "projects", project);
      const earliestDate = await readEarliestLedgerDate(projectDir);
      if (earliestDate) {
        const startMs = new Date(earliestDate + "T00:00:00Z").getTime();
        const deadlineMs = nowMs + status.hoursToDeadline * 3600 * 1000;
        const totalMs = deadlineMs - startMs;
        const elapsedMs = nowMs - startMs;
        if (totalMs > 0 && elapsedMs >= 0) {
          timeElapsedFraction = Math.min(1, elapsedMs / totalMs);
        }
      }
    }

    inputs.push({
      project,
      resources: status.resources.map((r) => ({
        resource: r.resource,
        consumed: r.consumed,
        limit: r.limit,
      })),
      timeElapsedFraction,
    });
  }

  return inputs;
}

/**
 * Run the health watchdog: read recent sessions, analyze, and return results.
 * This is the main entry point for CLI and scheduled invocations.
 */
export async function runHealthWatchdog(opts?: {
  limit?: number;
  checkOpts?: HealthCheckOpts;
  repoDir?: string;
}): Promise<{ checks: HealthCheck[]; sessionsAnalyzed: number; budgetDrift?: BudgetDriftData }> {
  const limit = opts?.limit ?? 20;
  const sessions = await readMetrics({ limit });

  let budgetDrift: BudgetDriftData | undefined;
  let commitsAhead: number | undefined;
  let staleApprovalItems: PendingApprovalItem[] | undefined;
  let branchStats: BranchStats | undefined;

  if (opts?.repoDir) {
    const statuses = await readAllBudgetStatuses(opts.repoDir, EXCLUDED_PROJECTS);
    if (statuses.length > 0) {
      const inputs = await buildBudgetDriftInputs(opts.repoDir, statuses);
      budgetDrift = computeBudgetDrift(inputs);
    }
    commitsAhead = await getCommitsAhead(opts.repoDir);

    try {
      const approvalContent = await readFile(join(opts.repoDir, "APPROVAL_QUEUE.md"), "utf-8");
      staleApprovalItems = extractPendingApprovalItems(approvalContent);
    } catch {
      // APPROVAL_QUEUE.md not found or unreadable — skip stale approval check
    }

    try {
      branchStats = await getBranchStats(opts.repoDir);
    } catch {
      // Git operations failed — skip branch check
    }
  }

  const checks = analyzeHealth(sessions, { opts: { ...opts?.checkOpts, budgetDrift }, commitsAhead, staleApprovalItems, branchStats });
  return { checks, sessionsAnalyzed: sessions.length, budgetDrift };
}
