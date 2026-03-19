/** Fleet status tracking and reporting — cumulative metrics and Slack-formatted status reports (ADR 0042-v2). */

import type { FleetWorkerResult, SkillType } from "./types.js";

const ONE_HOUR_MS = 60 * 60 * 1000;

// ── Types ────────────────────────────────────────────────────────────────────

export interface IdleExplorationTypeMetrics {
  launched: number;
  completed: number;
  ok: number;
  failed: number;
}

export interface FleetStatusSnapshot {
  activeCount: number;
  maxWorkers: number;
  totalLaunched: number;
  totalCompleted: number;
  totalOk: number;
  totalFailed: number;
  /** Null when no completions yet. */
  successRate: number | null;
  /** Average duration of completed sessions in ms. Null when no completions. */
  avgDurationMs: number | null;
  activeWorkers: Array<{ sessionId: string; taskId: string; project: string; durationMs: number }>;
  /** Per-project ok/failed breakdown. */
  projectBreakdown: Record<string, { ok: number; failed: number }>;
  /** Idle exploration session counts (ADR 0048). */
  idleSessions: { launched: number; completed: number; ok: number; failed: number };
  /** Per-type idle exploration metrics. */
  idleByType: Record<string, IdleExplorationTypeMetrics>;
  /** Task (non-idle) session counts. */
  taskSessions: { launched: number; completed: number; ok: number; failed: number };
  /** Current active workers per project (for concurrency limit observability). */
  activePerProject: Record<string, number>;
  /** Per-project max workers limit. */
  maxWorkersPerProject: number;
  /** Cumulative count of tasks skipped due to per-project concurrency limit. */
  concurrencyLimitHits: Record<string, number>;
  /** Compute-time utilization: sum(worker_duration_ms) / (calendar_time_ms × maxWorkers).
   *  Null if tracking hasn't started or maxWorkers is 0. Range: [0, 1]. (ADR 0054) */
  utilization: number | null;
  /** Session utilization rate: active (non-idle) sessions / total sessions over rolling 1h window.
   *  Null if no sessions in the window. Range: [0, 1]. */
  utilizationRate: number | null;
  /** Cumulative count of workers parked due to insufficient task supply. */
  parkedWorkers: number;
  /** Per-skill completion counts (ADR 0062). */
  skillBreakdown: Record<string, { ok: number; failed: number }>;
  /** Degraded worker capacity due to backend rate limiting (opencode backend).
   *  Undefined = full capacity; number = reduced worker limit. */
  degradedCapacity?: number;
}

interface ActiveWorkerInfo {
  activeWorkers: Array<{ sessionId: string; taskId: string; project: string; durationMs: number }>;
  maxWorkers: number;
  maxWorkersPerProject: number;
  activePerProject: Record<string, number>;
  degradedCapacity?: number;
}

// ── FleetMetricsTracker ─────────────────────────────────────────────────────

/** Tracks cumulative fleet metrics across the scheduler lifecycle.
 *  Does not drain — metrics accumulate until the process restarts. */
export class FleetMetricsTracker {
  private startTimeMs = Date.now();
  private launched = 0;
  private completed = 0;
  private ok = 0;
  private failed = 0;
  private totalDurationMs = 0;
  private perProject = new Map<string, { ok: number; failed: number }>();
  private idle = { launched: 0, completed: 0, ok: 0, failed: 0 };
  private idlePerType = new Map<string, { launched: number; completed: number; ok: number; failed: number }>();
  private task = { launched: 0, completed: 0, ok: 0, failed: 0 };
  private concurrencyHits = new Map<string, number>();
  /** Rolling window of session completions for utilization calculation. Each entry: [timestampMs, durationMs, isIdle]. */
  private sessionHistory: Array<[number, number, boolean]> = [];
  private parkedWorkers = 0;
  private skillCompletions = new Map<SkillType, { ok: number; failed: number }>();

  recordLaunch(isIdle = false, explorationType?: string): void {
    this.launched++;
    if (isIdle) {
      this.idle.launched++;
      if (explorationType) {
        const t = this.idlePerType.get(explorationType) ?? { launched: 0, completed: 0, ok: 0, failed: 0 };
        t.launched++;
        this.idlePerType.set(explorationType, t);
      }
    } else {
      this.task.launched++;
    }
  }

  recordCompletion(result: FleetWorkerResult): void {
    this.launched = Math.max(this.launched, this.completed + 1);
    this.completed++;
    this.totalDurationMs += result.durationMs;

    const now = Date.now();
    const isIdle = result.isIdle ?? false;
    this.sessionHistory.push([now, result.durationMs, isIdle]);

    const bucket = isIdle ? this.idle : this.task;
    bucket.completed++;

    if (result.ok) {
      this.ok++;
      bucket.ok++;
    } else {
      this.failed++;
      bucket.failed++;
    }

    if (isIdle && result.explorationType) {
      const t = this.idlePerType.get(result.explorationType) ?? { launched: 0, completed: 0, ok: 0, failed: 0 };
      t.completed++;
      if (result.ok) {
        t.ok++;
      } else {
        t.failed++;
      }
      this.idlePerType.set(result.explorationType, t);
    }

    const proj = this.perProject.get(result.project) ?? { ok: 0, failed: 0 };
    if (result.ok) {
      proj.ok++;
    } else {
      proj.failed++;
    }
    this.perProject.set(result.project, proj);

    if (result.skillType) {
      const skill = this.skillCompletions.get(result.skillType) ?? { ok: 0, failed: 0 };
      if (result.ok) {
        skill.ok++;
      } else {
        skill.failed++;
      }
      this.skillCompletions.set(result.skillType, skill);
    }
  }

recordConcurrencyLimitHit(project: string): void {
    this.concurrencyHits.set(project, (this.concurrencyHits.get(project) ?? 0) + 1);
  }

recordParkedWorkers(count: number): void {
    this.parkedWorkers += count;
  }

  /** Compute rolling compute-time utilization over the specified window.
   *  Returns null if maxWorkers is 0 or window hasn't elapsed yet. */
  getRollingUtilization(windowMs: number, maxWorkers: number): number | null {
    if (maxWorkers <= 0) return null;

    const now = Date.now();
    const cutoff = now - windowMs;

    // Prune old entries
    this.sessionHistory = this.sessionHistory.filter(([ts]) => ts >= cutoff);

    if (this.sessionHistory.length === 0) return null;

    const totalWorkerMs = this.sessionHistory.reduce((sum, [, dur]) => sum + dur, 0);
    const availableMs = windowMs * maxWorkers;

    return Math.min(1, totalWorkerMs / availableMs);
  }

  /** Compute session utilization rate: active (non-idle) / total sessions over rolling window.
   *  Returns null if no sessions in the window. */
  getUtilizationRate(windowMs: number): number | null {
    const now = Date.now();
    const cutoff = now - windowMs;

    // Prune old entries (reuse from getRollingUtilization)
    this.sessionHistory = this.sessionHistory.filter(([ts]) => ts >= cutoff);

    if (this.sessionHistory.length === 0) return null;

    const activeSessions = this.sessionHistory.filter(([, , isIdle]) => !isIdle).length;
    return activeSessions / this.sessionHistory.length;
  }

  getSnapshot(info: ActiveWorkerInfo): FleetStatusSnapshot {
    const projectBreakdown: Record<string, { ok: number; failed: number }> = {};
    for (const [name, counts] of this.perProject) {
      projectBreakdown[name] = { ...counts };
    }

    const concurrencyLimitHits: Record<string, number> = {};
    for (const [name, count] of this.concurrencyHits) {
      concurrencyLimitHits[name] = count;
    }

    const idleByType: Record<string, IdleExplorationTypeMetrics> = {};
    for (const [type, counts] of this.idlePerType) {
      idleByType[type] = { ...counts };
    }

    const skillBreakdown: Record<string, { ok: number; failed: number }> = {};
    for (const [skill, counts] of this.skillCompletions) {
      skillBreakdown[skill] = { ...counts };
    }

    const snapshot: FleetStatusSnapshot = {
      activeCount: info.activeWorkers.length,
      maxWorkers: info.maxWorkers,
      totalLaunched: this.launched,
      totalCompleted: this.completed,
      totalOk: this.ok,
      totalFailed: this.failed,
      successRate: this.completed > 0 ? this.ok / this.completed : null,
      avgDurationMs: this.completed > 0 ? this.totalDurationMs / this.completed : null,
      activeWorkers: info.activeWorkers,
      projectBreakdown,
      idleSessions: { ...this.idle },
      idleByType,
      taskSessions: { ...this.task },
      activePerProject: { ...info.activePerProject },
      maxWorkersPerProject: info.maxWorkersPerProject,
      concurrencyLimitHits,
      utilization: this.getRollingUtilization(ONE_HOUR_MS, info.maxWorkers),
      utilizationRate: this.getUtilizationRate(ONE_HOUR_MS),
      parkedWorkers: this.parkedWorkers,
      skillBreakdown,
    };

    if (info.degradedCapacity !== undefined) {
      snapshot.degradedCapacity = info.degradedCapacity;
    }

    return snapshot;
  }
}

// ── Formatting ──────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m ${totalSeconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/** Format a fleet status snapshot as a Slack message. */
export function formatFleetStatusReport(snap: FleetStatusSnapshot): string {
  if (snap.maxWorkers === 0) {
    return `:blue_car: *Fleet Status* — disabled (FLEET_SIZE=0)`;
  }

  const lines: string[] = [];

// Header
  lines.push(`:blue_car: *Fleet Status* — ${snap.activeCount}/${snap.maxWorkers} active`);

  // Parked workers (supply < capacity)
  if (snap.parkedWorkers > 0) {
    lines.push(`Parked (no tasks): ${snap.parkedWorkers} cumulative`);
  }

  // Metrics summary
  if (snap.totalCompleted === 0) {
    lines.push(`Launched: ${snap.totalLaunched} | no completions yet`);
  } else {
    const rate = snap.successRate !== null ? `${(snap.successRate * 100).toFixed(1)}%` : "—";
    const avgDur = snap.avgDurationMs !== null ? formatDuration(snap.avgDurationMs) : "—";
    const util = snap.utilization !== null ? `${(snap.utilization * 100).toFixed(1)}%` : "—";
    lines.push(`${snap.totalCompleted} completed (${snap.totalOk} ok, ${snap.totalFailed} failed) | Success: ${rate} | Avg: ${avgDur} | Util: ${util}`);

    if (snap.idleSessions.completed > 0 || snap.taskSessions.completed > 0) {
      const parts: string[] = [];
      if (snap.taskSessions.completed > 0) {
        parts.push(`Tasks: ${snap.taskSessions.completed} (${snap.taskSessions.ok} ok)`);
      }
      if (snap.idleSessions.completed > 0) {
        parts.push(`Idle exploration: ${snap.idleSessions.completed} (${snap.idleSessions.ok} ok)`);
      }
      const taskRate = snap.utilizationRate !== null ? ` (${(snap.utilizationRate * 100).toFixed(0)}% task)` : "";
      lines.push(parts.join(" | ") + taskRate);

      // Per-type idle exploration breakdown
      const idleTypes = Object.entries(snap.idleByType);
      if (idleTypes.length > 0) {
        const typeParts = idleTypes.map(([type, m]) => {
          const total = m.completed;
          const ok = m.ok;
          const rate = total > 0 ? `${((ok / total) * 100).toFixed(0)}%` : "—";
          return `${type}: ${total} (${rate})`;
        });
        lines.push(`  Idle by type: ${typeParts.join(", ")}`);
      }
    }
  }

  // Active workers
  if (snap.activeWorkers.length > 0) {
    lines.push("");
    lines.push("*Active workers:*");
    for (const w of snap.activeWorkers) {
      const dur = formatDuration(w.durationMs);
      lines.push(`  • \`${w.project}\` — ${w.taskId.slice(0, 12)}… [${dur}]`);
    }
  }

  // Per-project breakdown (only if >1 project)
  const projects = Object.entries(snap.projectBreakdown);
  if (projects.length > 1) {
    lines.push("");
    lines.push("*By project:*");
    for (const [name, counts] of projects) {
      const total = counts.ok + counts.failed;
      const active = snap.activePerProject[name] ?? 0;
      const limitHits = snap.concurrencyLimitHits[name] ?? 0;
      let suffix = "";
      if (active > 0) {
        suffix += ` | ${active}/${snap.maxWorkersPerProject} active`;
      }
      if (limitHits > 0) {
        suffix += ` | ${limitHits} throttled`;
      }
      lines.push(`  • \`${name}\`: ${total} (${counts.ok} ok, ${counts.failed} failed)${suffix}`);
    }
  }

  // Concurrency limit summary
  const totalHits = Object.values(snap.concurrencyLimitHits).reduce((a, b) => a + b, 0);
  if (totalHits > 0) {
    lines.push("");
    lines.push(`Per-project limit (${snap.maxWorkersPerProject}): ${totalHits} task(s) throttled`);
  }

  return lines.join("\n");
}
