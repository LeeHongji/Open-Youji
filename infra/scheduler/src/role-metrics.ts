/** Per-role metrics aggregation for the specialization experiment. */

import { readMetrics, type SessionMetrics } from "./metrics.js";

export interface RoleDistribution {
  role: string;
  sessionCount: number;
  orientOverhead: { mean: number; median: number; sd: number; ci95: [number, number] } | null;
  findingsPerDollar: { mean: number; median: number; sd: number; ci95: [number, number] } | null;
  taskCompletionRate: number | null;
  crossProjectRefRate: number;
  sessionCost: { mean: number; median: number; sd: number; ci95: [number, number] } | null;
  avgTurns: number;
  avgDurationMs: number;
  timedOutRate: number;
}

export interface RoleComparison {
  roles: RoleDistribution[];
  generalistBaseline: RoleDistribution | null;
}

function median(vals: number[]): number {
  if (vals.length === 0) return 0;
  const sorted = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function stddev(vals: number[], mean: number): number {
  if (vals.length < 2) return 0;
  const sq = vals.reduce((sum, v) => sum + (v - mean) ** 2, 0);
  return Math.sqrt(sq / (vals.length - 1));
}

function ci95(vals: number[]): [number, number] {
  if (vals.length < 2) return [vals[0] ?? 0, vals[0] ?? 0];
  const m = vals.reduce((a, b) => a + b, 0) / vals.length;
  const se = stddev(vals, m) / Math.sqrt(vals.length);
  return [m - 1.96 * se, m + 1.96 * se];
}

function computeDistStats(vals: number[]): { mean: number; median: number; sd: number; ci95: [number, number] } | null {
  if (vals.length === 0) return null;
  const m = vals.reduce((a, b) => a + b, 0) / vals.length;
  return { mean: m, median: median(vals), sd: stddev(vals, m), ci95: ci95(vals) };
}

export function groupByRole(sessions: SessionMetrics[]): Map<string, SessionMetrics[]> {
  const groups = new Map<string, SessionMetrics[]>();
  for (const s of sessions) {
    const role = s.injectedRole ?? "generalist";
    const arr = groups.get(role) ?? [];
    arr.push(s);
    groups.set(role, arr);
  }
  return groups;
}

export function computeRoleDistribution(role: string, sessions: SessionMetrics[]): RoleDistribution {
  const orientOverheadVals: number[] = [];
  for (const s of sessions) {
    if (s.orientTurns != null && s.numTurns != null && s.numTurns > 0) {
      orientOverheadVals.push(s.orientTurns / s.numTurns);
    }
  }

  const fpdVals: number[] = [];
  for (const s of sessions) {
    if (s.costUsd != null && s.costUsd > 0 && s.knowledge) {
      const findings = (s.knowledge.newExperimentFindings ?? 0) + (s.knowledge.logEntryFindings ?? 0);
      fpdVals.push(findings / s.costUsd);
    }
  }

  const crossProjectSessions = sessions.filter(
    (s) => s.crossProject && s.crossProject.crossProjectRefs > 0,
  );

  const costVals = sessions
    .filter((s) => s.costUsd != null && s.costUsd > 0)
    .map((s) => s.costUsd!);

  const turnVals = sessions.filter((s) => s.numTurns != null).map((s) => s.numTurns!);

  return {
    role,
    sessionCount: sessions.length,
    orientOverhead: computeDistStats(orientOverheadVals),
    findingsPerDollar: computeDistStats(fpdVals),
    taskCompletionRate: null,
    crossProjectRefRate: sessions.length > 0 ? crossProjectSessions.length / sessions.length : 0,
    sessionCost: computeDistStats(costVals),
    avgTurns: turnVals.length > 0 ? turnVals.reduce((a, b) => a + b, 0) / turnVals.length : 0,
    avgDurationMs: sessions.length > 0
      ? sessions.reduce((a, s) => a + s.durationMs, 0) / sessions.length
      : 0,
    timedOutRate: sessions.length > 0
      ? sessions.filter((s) => s.timedOut).length / sessions.length
      : 0,
  };
}

export function compareRoles(sessions: SessionMetrics[]): RoleComparison {
  const groups = groupByRole(sessions);
  const roles: RoleDistribution[] = [];

  for (const [role, group] of groups) {
    roles.push(computeRoleDistribution(role, group));
  }

  roles.sort((a, b) => b.sessionCount - a.sessionCount);

  const generalistBaseline = roles.find((r) => r.role === "generalist") ?? null;

  return { roles, generalistBaseline };
}

export function formatRoleComparison(comparison: RoleComparison): string {
  const lines: string[] = ["## Per-Role Metrics Comparison", ""];

  for (const dist of comparison.roles) {
    lines.push(`### ${dist.role} (n=${dist.sessionCount})`);
    lines.push("");

    if (dist.orientOverhead) {
      lines.push(`- Orient overhead: ${(dist.orientOverhead.mean * 100).toFixed(1)}% (median: ${(dist.orientOverhead.median * 100).toFixed(1)}%, 95% CI: [${(dist.orientOverhead.ci95[0] * 100).toFixed(1)}%, ${(dist.orientOverhead.ci95[1] * 100).toFixed(1)}%])`);
    } else {
      lines.push("- Orient overhead: N/A (no orientTurns data)");
    }

    if (dist.findingsPerDollar) {
      lines.push(`- Findings/dollar: ${dist.findingsPerDollar.mean.toFixed(2)} f/$ (median: ${dist.findingsPerDollar.median.toFixed(2)}, 95% CI: [${dist.findingsPerDollar.ci95[0].toFixed(2)}, ${dist.findingsPerDollar.ci95[1].toFixed(2)}])`);
    } else {
      lines.push("- Findings/dollar: N/A (no cost data)");
    }

    lines.push(`- Cross-project ref rate: ${(dist.crossProjectRefRate * 100).toFixed(1)}%`);

    if (dist.sessionCost) {
      lines.push(`- Session cost: $${dist.sessionCost.mean.toFixed(2)} avg (median: $${dist.sessionCost.median.toFixed(2)})`);
    } else {
      lines.push("- Session cost: N/A");
    }

    lines.push(`- Avg turns: ${dist.avgTurns.toFixed(1)}`);
    lines.push(`- Avg duration: ${Math.round(dist.avgDurationMs / 1000)}s`);
    lines.push(`- Timed out: ${(dist.timedOutRate * 100).toFixed(1)}%`);
    lines.push("");
  }

  return lines.join("\n");
}

export async function aggregateRoleMetrics(opts?: {
  since?: string;
  limit?: number;
  metricsPath?: string;
}): Promise<RoleComparison> {
  const sessions = await readMetrics(opts);
  return compareRoles(sessions);
}
