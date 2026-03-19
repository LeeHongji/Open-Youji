/** Unified status dashboard — combines active sessions, running experiments, and jobs into a single view. */

// ── Types ────────────────────────────────────────────────────────────────────

export interface StatusSession {
  id: string;
  jobName: string;
  startedAtMs: number;
  elapsedMs: number;
  costUsd: number;
  numTurns: number;
  lastActivity: string;
}

export interface StatusExperiment {
  project: string;
  id: string;
  status: string;
  startedAt?: string;
  elapsedMs?: number;
  progress?: number;
  message?: string;
}

export interface StatusJob {
  id: string;
  name: string;
  enabled: boolean;
  schedule: string;
  nextRunAtMs: number | null;
  lastStatus: string | null;
  lastRunAtMs: number | null;
  runCount: number;
}

export interface StatusSummary {
  activeSessions: number;
  runningExperiments: number;
  totalJobs: number;
  enabledJobs: number;
}

export interface UnifiedStatus {
  timestamp: string;
  summary: StatusSummary;
  sessions: StatusSession[];
  experiments: StatusExperiment[];
  jobs: StatusJob[];
}

// ── Active statuses for experiments ──────────────────────────────────────────

const ACTIVE_EXPERIMENT_STATUSES = new Set(["running", "retrying", "stopping"]);

// ── Core function ────────────────────────────────────────────────────────────

export interface StatusSources {
  sessions: StatusSession[];
  experiments: StatusExperiment[];
  jobs: StatusJob[];
}

/** Combine sessions, experiments, and jobs into a unified status view.
 *  Filters experiments to only active ones (running/retrying/stopping). */
export function getUnifiedStatus(sources: StatusSources): UnifiedStatus {
  const activeExperiments = sources.experiments.filter(
    (e) => ACTIVE_EXPERIMENT_STATUSES.has(e.status),
  );

  return {
    timestamp: new Date().toISOString(),
    summary: {
      activeSessions: sources.sessions.length,
      runningExperiments: activeExperiments.length,
      totalJobs: sources.jobs.length,
      enabledJobs: sources.jobs.filter((j) => j.enabled).length,
    },
    sessions: sources.sessions,
    experiments: activeExperiments,
    jobs: sources.jobs,
  };
}

// ── Formatting ───────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m ${totalSeconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function formatRelative(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 1) return "< 1 min";
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  return `${hours}h ${totalMinutes % 60}m`;
}

/** Format unified status as human-readable text for CLI output. */
export function formatUnifiedStatus(status: UnifiedStatus): string {
  const lines: string[] = [];

  // Header
  lines.push("=== Unified Status ===");
  lines.push(`Active Sessions: ${status.summary.activeSessions}  |  Running Experiments: ${status.summary.runningExperiments}  |  Jobs: ${status.summary.enabledJobs}/${status.summary.totalJobs} enabled`);
  lines.push("");

  // Sessions
  if (status.sessions.length > 0) {
    lines.push("--- Sessions ---");
    for (const s of status.sessions) {
      const elapsed = formatDuration(s.elapsedMs);
      const cost = `$${s.costUsd.toFixed(2)}`;
      lines.push(`  ${s.jobName} (${s.id})`);
      lines.push(`    Elapsed: ${elapsed}  |  Cost: ${cost}  |  ${s.numTurns} turns`);
      lines.push(`    Last: ${s.lastActivity.slice(0, 100)}`);
    }
    lines.push("");
  }

  // Experiments
  if (status.experiments.length > 0) {
    lines.push("--- Experiments ---");
    for (const e of status.experiments) {
      let line = `  ${e.project}/${e.id} — ${e.status}`;
      if (e.progress !== undefined) {
        line += ` (${e.progress}%)`;
      }
      if (e.elapsedMs !== undefined) {
        line += ` [${formatDuration(e.elapsedMs)}]`;
      }
      lines.push(line);
      if (e.message) {
        lines.push(`    ${e.message}`);
      }
    }
    lines.push("");
  }

  // Jobs
  if (status.jobs.length > 0) {
    lines.push("--- Jobs ---");
    for (const j of status.jobs) {
      const state = j.enabled ? "enabled" : "disabled";
      let nextStr = "none";
      if (j.nextRunAtMs) {
        const delta = j.nextRunAtMs - Date.now();
        nextStr = delta > 0 ? `in ${formatRelative(delta)}` : "overdue";
      }
      const lastStr = j.lastStatus ?? "never";
      lines.push(`  ${j.name} [${state}]  schedule: ${j.schedule}  next: ${nextStr}  last: ${lastStr} (${j.runCount} runs)`);
    }
  }

  return lines.join("\n");
}
