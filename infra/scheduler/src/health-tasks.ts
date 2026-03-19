/** Convert monitoring check outputs into TASKS.md entries for autonomous task selection. */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { HealthCheck } from "./health-watchdog.js";
import type { Anomaly } from "./anomaly-detection.js";
import type { WarningEscalation } from "./warning-escalation.js";
import type { InteractionAuditCheck } from "./interaction-audit.js";

/** A task candidate generated from a monitoring check. */
export interface HealthTaskCandidate {
  /** The checkbox line: `- [ ] <description> [detected: YYYY-MM-DD]`. */
  line: string;
  /** The Why field with monitoring source. */
  why: string;
  /** The Done when condition. */
  doneWhen: string;
  /** Source identifier: `<system>:<checkId>` for deduplication. */
  source: string;
  /** Task priority derived from check severity. */
  priority: "high" | "medium";
}

// ── Task templates per check ID ─────────────────────────────────────────

const HEALTH_TEMPLATES: Record<string, { verb: string; doneWhen: string }> = {
  high_error_rate: {
    verb: "Investigate high session error rate",
    doneWhen: "Error rate drops below threshold or root cause documented",
  },
  cost_spike: {
    verb: "Investigate session cost spike",
    doneWhen: "Cost spike cause identified and either resolved or documented",
  },
  high_zero_knowledge_rate: {
    verb: "Investigate high zero-knowledge session rate",
    doneWhen: "Waste rate drops below threshold or causes documented",
  },
  consecutive_failures: {
    verb: "Diagnose consecutive session failures",
    doneWhen: "Failure streak broken or systemic issue documented",
  },
};

const ANOMALY_TEMPLATES: Record<string, { verb: string; doneWhen: string }> = {
  costUsd: {
    verb: "Investigate session cost anomaly",
    doneWhen: "Anomalous cost explained or cost driver resolved",
  },
  durationMs: {
    verb: "Investigate session duration anomaly",
    doneWhen: "Duration outlier explained or performance issue resolved",
  },
  numTurns: {
    verb: "Investigate session turn count anomaly",
    doneWhen: "Turn count outlier explained or inefficiency resolved",
  },
  knowledgeTotal: {
    verb: "Investigate low knowledge output anomaly",
    doneWhen: "Knowledge drop explained or task selection improved",
  },
};

const ESCALATION_TEMPLATES: Record<string, { verb: string; doneWhen: string }> = {
  no_log_entry: {
    verb: "Fix recurring missing log entries in sessions",
    doneWhen: "Sessions consistently produce log entries (0 warnings in 10 sessions)",
  },
  no_commit: {
    verb: "Fix recurring missing commits in sessions",
    doneWhen: "Sessions consistently commit (0 warnings in 10 sessions)",
  },
  incomplete_footer: {
    verb: "Fix recurring incomplete session footers",
    doneWhen: "Session footers consistently complete (0 warnings in 10 sessions)",
  },
  ledger_inconsistent: {
    verb: "Fix recurring ledger inconsistencies",
    doneWhen: "Ledger entries consistently match costs (0 warnings in 10 sessions)",
  },
  orphaned_files: {
    verb: "Fix recurring orphaned files after sessions",
    doneWhen: "Sessions consistently commit all files (0 warnings in 10 sessions)",
  },
};

const INTERACTION_TEMPLATES: Record<string, { verb: string; doneWhen: string }> = {
  low_fulfillment_rate: {
    verb: "Investigate low Slack interaction fulfillment rate",
    doneWhen: "Fulfillment rate above threshold or failure patterns documented",
  },
  high_correction_rate: {
    verb: "Investigate high user correction rate in Slack interactions",
    doneWhen: "Correction rate below threshold or interaction parsing improved",
  },
  problem_threads: {
    verb: "Investigate Slack threads with repeated user corrections",
    doneWhen: "Problem threads analyzed and interaction handling improved",
  },
  high_error_rate: {
    verb: "Investigate high Slack interaction error rate",
    doneWhen: "Error rate below threshold or error causes resolved",
  },
};

// ── Formatters ──────────────────────────────────────────────────────────

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Convert a HealthCheck to a task candidate. */
export function formatHealthTask(check: HealthCheck): HealthTaskCandidate | null {
  const template = HEALTH_TEMPLATES[check.id];
  if (!template) return null;

  const source = `health-watchdog:${check.id}`;
  return {
    line: `- [ ] ${template.verb} [detected: ${today()}]`,
    why: `${source} detected ${check.description.toLowerCase()}`,
    doneWhen: template.doneWhen,
    source,
    priority: check.severity,
  };
}

/** Convert an Anomaly to a task candidate. */
export function formatAnomalyTask(anomaly: Anomaly): HealthTaskCandidate | null {
  const template = ANOMALY_TEMPLATES[anomaly.metric];
  if (!template) return null;

  const source = `anomaly-detection:${anomaly.metric}`;
  return {
    line: `- [ ] ${template.verb} [detected: ${today()}]`,
    why: `${source} — ${anomaly.description}`,
    doneWhen: template.doneWhen,
    source,
    priority: anomaly.direction === "high" ? "high" : "medium",
  };
}

/** Convert a WarningEscalation to a task candidate. */
export function formatEscalationTask(esc: WarningEscalation): HealthTaskCandidate | null {
  const template = ESCALATION_TEMPLATES[esc.warningType];
  if (!template) return null;

  const source = `warning-escalation:${esc.warningType}`;
  return {
    line: `- [ ] ${template.verb} [detected: ${today()}]`,
    why: `${source} — ${esc.description}`,
    doneWhen: template.doneWhen,
    source,
    priority: esc.severity,
  };
}

/** Convert an InteractionAuditCheck to a task candidate. */
export function formatInteractionTask(check: InteractionAuditCheck): HealthTaskCandidate | null {
  const template = INTERACTION_TEMPLATES[check.id];
  if (!template) return null;

  const source = `interaction-audit:${check.id}`;
  return {
    line: `- [ ] ${template.verb} [detected: ${today()}]`,
    why: `${source} — ${check.description}`,
    doneWhen: template.doneWhen,
    source,
    priority: check.severity,
  };
}

// ── Deduplication ───────────────────────────────────────────────────────

/**
 * Check if a task candidate duplicates an existing task.
 * Uses source ID matching: if the existing tasks content contains the same
 * `<system>:<checkId>` source string, it's a duplicate.
 */
export function deduplicateHealthTask(
  candidate: HealthTaskCandidate,
  existingTasksContent: string,
): boolean {
  return existingTasksContent.includes(candidate.source);
}

/**
 * Check if a source ID was detected within the TTL window (7 days).
 * Scans existing tasks for `[detected: YYYY-MM-DD]` tags on lines mentioning the source.
 */
export function isWithinTTL(
  source: string,
  existingTasksContent: string,
  now: Date = new Date(),
): boolean {
  const lines = existingTasksContent.split("\n");
  const ttlMs = 7 * 24 * 60 * 60 * 1000;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // Check if any nearby line (current or next 2) mentions this source
    const chunk = lines.slice(i, i + 3).join("\n");
    if (!chunk.includes(source)) continue;

    // Extract [detected: YYYY-MM-DD] from the task line
    const dateMatch = line.match(/\[detected:\s*(\d{4}-\d{2}-\d{2})\]/);
    if (dateMatch) {
      const detectedDate = new Date(dateMatch[1]! + "T00:00:00Z");
      if (now.getTime() - detectedDate.getTime() < ttlMs) {
        return true;
      }
    }
  }

  return false;
}

// ── Task block formatting ───────────────────────────────────────────────

/** Format a HealthTaskCandidate as a full markdown task block. */
export function formatHealthTaskBlock(candidate: HealthTaskCandidate): string {
  return [
    candidate.line,
    `  Why: ${candidate.why}`,
    `  Done when: ${candidate.doneWhen}`,
    `  Priority: ${candidate.priority}`,
  ].join("\n");
}

// ── Orchestration ───────────────────────────────────────────────────────

export interface CreateHealthTasksOpts {
  repoDir: string;
  healthChecks?: HealthCheck[];
  anomalies?: Anomaly[];
  escalations?: WarningEscalation[];
  interactionChecks?: InteractionAuditCheck[];
}

/**
 * Convert monitoring outputs into tasks and append to projects/youji/TASKS.md.
 * Deduplicates by source ID and respects 7-day TTL. Returns count of tasks added.
 */
export async function createHealthTasks(opts: CreateHealthTasksOpts): Promise<number> {
  const tasksPath = join(opts.repoDir, "projects", "youji", "TASKS.md");

  let existing = "";
  try {
    existing = await readFile(tasksPath, "utf-8");
  } catch {
    // TASKS.md not found — nothing to append to
    return 0;
  }

  const now = new Date();
  const candidates: HealthTaskCandidate[] = [];

  for (const check of opts.healthChecks ?? []) {
    const task = formatHealthTask(check);
    if (task) candidates.push(task);
  }
  for (const anomaly of opts.anomalies ?? []) {
    const task = formatAnomalyTask(anomaly);
    if (task) candidates.push(task);
  }
  for (const esc of opts.escalations ?? []) {
    const task = formatEscalationTask(esc);
    if (task) candidates.push(task);
  }
  for (const check of opts.interactionChecks ?? []) {
    const task = formatInteractionTask(check);
    if (task) candidates.push(task);
  }

  // Filter: skip duplicates and tasks within TTL
  const newTasks = candidates.filter(
    (c) => !deduplicateHealthTask(c, existing) && !isWithinTTL(c.source, existing, now),
  );

  if (newTasks.length === 0) return 0;

  // Append tasks to TASKS.md
  const blocks = newTasks.map(formatHealthTaskBlock);
  const section = "\n" + blocks.join("\n\n") + "\n";
  await writeFile(tasksPath, existing.trimEnd() + "\n" + section, "utf-8");

  return newTasks.length;
}
