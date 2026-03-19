/** Autonomous diagnosis triggering — spawns diagnosis sessions when health monitoring detects anomaly patterns. */

import type { HealthCheck } from "./health-watchdog.js";
import type { Anomaly } from "./anomaly-detection.js";
import type { WarningEscalation } from "./warning-escalation.js";
import { spawnDeepWork } from "./event-agents.js";
import * as slack from "./slack.js";

/** Cooldown period: minimum 6 hours between auto-diagnosis sessions. */
const COOLDOWN_MS = 6 * 60 * 60 * 1000;

// ── Types ────────────────────────────────────────────────────────────────

export interface DiagnosisTriggerInput {
  healthChecks: HealthCheck[];
  anomalies: Anomaly[];
  escalations: WarningEscalation[];
  /** Epoch ms of the last auto-diagnosis, or null if never run. */
  lastDiagnosisTimestamp: number | null;
}

export interface DiagnosisPromptInput {
  healthChecks: HealthCheck[];
  anomalies: Anomaly[];
  escalations: WarningEscalation[];
}

// ── Trigger logic ────────────────────────────────────────────────────────

/**
 * Decide whether to trigger an autonomous diagnosis session.
 *
 * Trigger conditions:
 * - At least one HIGH-severity health check, OR
 * - Two or more MEDIUM-severity signals across all monitoring systems
 *
 * Suppressed when:
 * - Within cooldown period (< 6 hours since last auto-diagnosis)
 * - No monitoring signals at all
 */
export function shouldTriggerDiagnosis(input: DiagnosisTriggerInput): boolean {
  // Cooldown check
  if (
    input.lastDiagnosisTimestamp !== null &&
    Date.now() - input.lastDiagnosisTimestamp < COOLDOWN_MS
  ) {
    return false;
  }

  // Count signals by severity
  let highCount = 0;
  let mediumCount = 0;

  for (const check of input.healthChecks) {
    if (check.severity === "high") highCount++;
    else mediumCount++;
  }

  // Anomalies count as medium signals
  mediumCount += input.anomalies.length;

  // Escalations count by their severity
  for (const esc of input.escalations) {
    if (esc.severity === "high") highCount++;
    else mediumCount++;
  }

  // Trigger on any high signal, or compound medium signals (2+)
  if (highCount > 0) return true;
  if (mediumCount >= 2) return true;

  return false;
}

// ── Prompt builder ───────────────────────────────────────────────────────

/**
 * Build a prompt for an autonomous diagnosis session that investigates
 * health monitoring signals by reading sessions.jsonl and project state.
 */
export function buildDiagnosisPrompt(input: DiagnosisPromptInput): string {
  const sections: string[] = [];

  sections.push(
    `You are an autonomous research agent starting a diagnosis session triggered by the health monitoring system.`,
    `Your cwd is the youji repo root. Follow CLAUDE.md conventions.`,
    ``,
    `## Context`,
    `The scheduler's health monitoring detected anomaly patterns that warrant investigation.`,
    `Your job is to analyze session data (.scheduler/metrics/sessions.jsonl), identify root causes,`,
    `and document findings. Use the /diagnose skill approach: characterize the distribution,`,
    `generate hypotheses, assess validity, and recommend actions.`,
    ``,
  );

  // Health checks
  if (input.healthChecks.length > 0) {
    sections.push(`## Health checks`);
    for (const check of input.healthChecks) {
      sections.push(
        `- **${check.id}** [${check.severity}]: ${check.description}`,
        `  Recommendation: ${check.recommendation}`,
      );
    }
    sections.push(``);
  }

  // Anomalies
  if (input.anomalies.length > 0) {
    sections.push(`## Anomalies`);
    for (const a of input.anomalies) {
      sections.push(
        `- **${a.metric}** [${a.direction}]: ${a.description}`,
        `  Session: ${a.sessionRunId} (${a.sessionTimestamp})`,
      );
    }
    sections.push(``);
  }

  // Escalations
  if (input.escalations.length > 0) {
    sections.push(`## Warning escalations`);
    for (const esc of input.escalations) {
      sections.push(
        `- **${esc.warningType}** [${esc.severity}]: ${esc.description}`,
      );
    }
    sections.push(``);
  }

  sections.push(
    `## Instructions`,
    `1. Read .scheduler/metrics/sessions.jsonl (recent sessions) to understand the pattern.`,
    `2. For each signal above, investigate root causes:`,
    `   - What sessions are affected?`,
    `   - What tasks were they working on?`,
    `   - Is this a systemic issue or a transient anomaly?`,
    `3. Check recent project README logs for context on what work was happening.`,
    `4. Write a diagnosis file to projects/youji/diagnosis/ following the /diagnose output format.`,
    `5. If you find actionable fixes (config issues, convention gaps), apply them.`,
    `6. Commit your diagnosis file and any fixes.`,
    ``,
    `## Session discipline`,
    `Do NOT run /orient. This is a targeted diagnosis session, not a scheduled work cycle.`,
    `Focus on the monitoring signals above. Be concise — diagnose the issue, document findings, and commit.`,
    ``,
    `CRITICAL: Never produce a text-only message announcing your next action. Always include a tool call in the same turn.`,
  );

  return sections.join("\n");
}

// ── Cooldown state ───────────────────────────────────────────────────────

/** In-memory timestamp of the last auto-diagnosis. Resets on process restart. */
let lastDiagnosisMs: number | null = null;

/** Get the last diagnosis timestamp (for testing/external use). */
export function getLastDiagnosisTimestamp(): number | null {
  return lastDiagnosisMs;
}

/** Reset the cooldown (for testing). */
export function resetCooldown(): void {
  lastDiagnosisMs = null;
}

// ── Orchestration ────────────────────────────────────────────────────────

export interface TriggerDiagnosisOpts {
  healthChecks: HealthCheck[];
  anomalies: Anomaly[];
  escalations: WarningEscalation[];
  repoDir: string;
}

/**
 * Check monitoring signals and, if warranted, spawn an autonomous diagnosis session.
 * Returns the sessionId if a diagnosis was triggered, or null if suppressed.
 */
export async function triggerAutoDiagnosis(
  opts: TriggerDiagnosisOpts,
): Promise<string | null> {
  const shouldTrigger = shouldTriggerDiagnosis({
    healthChecks: opts.healthChecks,
    anomalies: opts.anomalies,
    escalations: opts.escalations,
    lastDiagnosisTimestamp: lastDiagnosisMs,
  });

  if (!shouldTrigger) return null;

  const prompt = buildDiagnosisPrompt({
    healthChecks: opts.healthChecks,
    anomalies: opts.anomalies,
    escalations: opts.escalations,
  });

  const signalCount =
    opts.healthChecks.length + opts.anomalies.length + opts.escalations.length;
  const highCount =
    opts.healthChecks.filter((c) => c.severity === "high").length +
    opts.escalations.filter((e) => e.severity === "high").length;

  console.log(
    `[auto-diagnose] Triggering diagnosis session: ${signalCount} signals (${highCount} high)`,
  );
  await slack
    .dm(
      `:mag: *Auto-diagnosis triggered* — ${signalCount} monitoring signal(s) (${highCount} high severity). Spawning diagnosis session...`,
    )
    .catch((err) =>
      console.error(`[auto-diagnose] Slack notification failed: ${err}`),
    );

  // Update cooldown before spawning (prevents double-trigger if tick runs again before session completes)
  lastDiagnosisMs = Date.now();

  const sessionId = await spawnDeepWork(
    prompt,
    opts.repoDir,
    {
      onProgress: async (text) => {
        // Progress is forwarded to Slack DM (best-effort, no thread)
        console.log(`[auto-diagnose] progress: ${text.slice(0, 100)}`);
      },
      onComplete: async (text) => {
        const summary = `:mag: Auto-diagnosis complete — ${signalCount} signal(s) investigated`;
        const details = text.slice(0, 3000);
        await slack
          .dm(summary)
          .then((ts) => {
            if (ts) return slack.dmThread(ts, details);
          })
          .catch((err) =>
            console.error(
              `[auto-diagnose] Completion notification failed: ${err}`,
            ),
          );
      },
    },
    "auto-diagnose",
  );

  console.log(`[auto-diagnose] Diagnosis session spawned: ${sessionId}`);
  return sessionId;
}
