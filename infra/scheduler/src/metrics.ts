/** Structured session metrics — JSONL storage for Tier 1 (automatically collected) data. */

import { readFile, appendFile, mkdir, open, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";

const DEFAULT_METRICS_PATH = new URL(
  "../../../.scheduler/metrics/sessions.jsonl",
  import.meta.url,
).pathname;

const DEFAULT_INTERACTIONS_PATH = new URL(
  "../../../.scheduler/metrics/interactions.jsonl",
  import.meta.url,
).pathname;

export interface VerificationMetrics {
  uncommittedFiles: number;
  orphanedFiles: number;
  hasLogEntry: boolean;
  hasCommit: boolean;
  hasCompleteFooter: boolean;
  ledgerConsistent: boolean;
  filesChanged: number;
  commitCount: number;
  /** Commits made by the agent (excludes scheduler auto-commits). */
  agentCommitCount: number;
  warningCount: number;
  /** The command string that caused a stall violation (shell tool call >120s). */
  stallViolationCommand?: string;
  /** Number of L2 convention violations detected. L2 = convention-only (manual enforcement). */
  l2ViolationCount: number;
  /** Number of L2 convention checks that were performed (applicable checks only). */
  l2ChecksPerformed: number;
}

export interface KnowledgeMetrics {
  newExperimentFindings: number;
  newDecisionRecords: number;
  newLiteratureNotes: number;
  openQuestionsResolved: number;
  openQuestionsDiscovered: number;
  experimentsCompleted: number;
  crossReferences: number;
  newAnalysisFiles: number;
  logEntryFindings: number;
  infraCodeChanges: number;
  bugfixVerifications: number;
  /** Changes to governance/compound files: CLAUDE.md, skills, decisions, patterns, SOPs. */
  compoundActions: number;
  /** Organizational changes: TASKS.md, APPROVAL_QUEUE.md, budget, ledger, docs, log archives, completed-tasks. Excludes compound action files. */
  structuralChanges: number;
  /** New feedback files created in project feedback directories. */
  feedbackProcessed: number;
  /** New diagnosis or postmortem files created in project diagnosis or postmortem directories. */
  diagnosesCompleted: number;
  /** New unchecked tasks created in TASKS.md files. */
  tasksCreated: number;
}

export interface BudgetGateMetrics {
  allowed: boolean;
  reason?: string;
}

export interface CrossProjectMetrics {
  /** Projects that had files changed in this session (sorted). */
  projectsTouched: string[];
  /** Number of findings (experiment + log entry) per project. */
  findingsPerProject: Record<string, number>;
  /** Cross-project references: added lines in project A referencing project B. */
  crossProjectRefs: number;
}

export interface QualityAuditMetrics {
  /** Number of audit-related skills invoked (review, audit-references, self-audit). */
  auditSkillsInvoked: number;
  /** Number of audit finding lines added (NOT count of experiments with issues).
   * Each line matching issue patterns (numbered items, correction keywords) is counted.
   * One experiment may contribute multiple findings. See analysis/quality-audit-findings-semantics-2026-02-26.md.
   */
  auditFindings: number;
  /** Number of pre-existing EXPERIMENT.md files modified (reviewed/audited) this session. */
  experimentsAudited: number;
}

export interface SessionMetrics {
  timestamp: string;
  jobName: string;
  runId: string;
  triggerSource?: "scheduler" | "slack" | "manual" | "fleet";
  backend: "claude" | "cursor" | "opencode";
  durationMs: number;
  costUsd: number | null;
  numTurns: number | null;
  timedOut: boolean;
  ok: boolean;
  error?: string;
  verification: VerificationMetrics | null;
  knowledge: KnowledgeMetrics | null;
  budgetGate: BudgetGateMetrics | null;
  modelUsage: Record<string, { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number; costUSD: number; contextWindow?: number; maxOutputTokens?: number }> | null;
  toolCounts: Record<string, number> | null;
  orientTurns: number | null;
  injectedOrientTier?: "fast" | "full" | null;
  injectedCompoundTier?: "fast" | "full" | null;
  injectedRole?: string | null;
  crossProject: CrossProjectMetrics | null;
  qualityAudit: QualityAuditMetrics | null;
  skillType?: import("./types.js").SkillType | null;
  workerRole?: import("./types.js").WorkerRole | null;
  isIdle?: boolean;
  explorationType?: string;
  pushQueueResult?: "queued-success" | "queued-rebase-failed" | "direct-push" | "no-push-needed";
  isRecycled?: boolean;
  recycledFrom?: string;
  /** Worktree task ID (worker sessions only). */
  worktreeTaskId?: string;
  /** Worktree branch name. */
  worktreeBranch?: string;
  /** Time spent allocating the worktree (ms). */
  worktreeAllocMs?: number;
  /** Time spent cleaning up the worktree (ms). */
  worktreeCleanupMs?: number;
  /** Whether merge-back succeeded or fell back to branch. */
  worktreeMergeResult?: "merged" | "fallback" | "no-changes" | "error";
}

/** Generate a unique runId for session metrics. Uses cryptographic random bytes
 *  to avoid the race condition where concurrent executions read the same runCount. */
export function generateRunId(jobId: string): string {
  return `${jobId}-${randomBytes(4).toString("hex")}`;
}

/** Convert a FleetWorkerResult into a SessionMetrics record for JSONL storage. */
export function fleetResultToMetrics(fr: import("./types.js").FleetWorkerResult): SessionMetrics {
  return {
    timestamp: new Date().toISOString(),
    jobName: `fleet-worker:${fr.project}`,
    runId: fr.sessionId,
    triggerSource: "fleet",
    backend: fr.backend ?? "opencode",
    durationMs: fr.durationMs,
    costUsd: fr.costUsd ?? null,
    numTurns: fr.numTurns ?? null,
    timedOut: fr.timedOut ?? false,
    ok: fr.ok,
    error: fr.error,
    verification: fr.verification ?? null,
    knowledge: fr.knowledge ?? null,
    budgetGate: null,
    modelUsage: fr.modelUsage ?? null,
    toolCounts: fr.toolCounts ?? null,
    orientTurns: fr.orientTurns ?? null,
    crossProject: fr.crossProject ?? null,
    qualityAudit: fr.qualityAudit ?? null,
    skillType: fr.skillType ?? null,
    workerRole: fr.workerRole ?? null,
    pushQueueResult: fr.pushQueueResult,
    ...(fr.isIdle ? { isIdle: true, explorationType: fr.explorationType } : {}),
    ...(fr.isRecycled ? { isRecycled: true, recycledFrom: fr.recycledFrom } : {}),
  };
}

/** Append one session metrics record to the JSONL file. */
export async function recordMetrics(
  metrics: SessionMetrics,
  metricsPath?: string,
): Promise<void> {
  const path = metricsPath ?? DEFAULT_METRICS_PATH;
  await mkdir(dirname(path), { recursive: true });
  const line = JSON.stringify(metrics) + "\n";
  await appendFile(path, line, "utf-8");
}

/**
 * Read the last N lines from a file by reading backwards in chunks.
 * Returns lines in original order (oldest first).
 */
async function readTailLines(path: string, n: number): Promise<string[]> {
  const CHUNK_SIZE = 8192;
  const fileHandle = await open(path, "r");
  try {
    const { size } = await fileHandle.stat();
    if (size === 0) return [];

    const lines: string[] = [];
    let remaining = "";
    let pos = size;

    while (pos > 0 && lines.length < n) {
      const readSize = Math.min(CHUNK_SIZE, pos);
      pos -= readSize;
      const buf = Buffer.alloc(readSize);
      await fileHandle.read(buf, 0, readSize, pos);
      const chunk = buf.toString("utf-8") + remaining;
      const parts = chunk.split("\n");
      remaining = parts[0];

      for (let i = parts.length - 1; i >= 1 && lines.length < n; i--) {
        const line = parts[i].trim();
        if (line) lines.push(line);
      }
    }

    if (lines.length < n && remaining.trim()) {
      lines.push(remaining.trim());
    }

    lines.reverse();
    return lines;
  } finally {
    await fileHandle.close();
  }
}

/** Read session metrics from the JSONL file, optionally filtered. */
export async function readMetrics(opts?: {
  since?: string;
  limit?: number;
  metricsPath?: string;
}): Promise<SessionMetrics[]> {
  const path = opts?.metricsPath ?? DEFAULT_METRICS_PATH;

  // Optimization: when only limit is set (no since filter), use tail-read
  // to avoid parsing the entire file. Over-read by 2× to handle since-filtering edge cases.
  if (opts?.limit && !opts?.since) {
    try {
      const lines = await readTailLines(path, opts.limit);
      return lines.map((line) => JSON.parse(line) as SessionMetrics);
    } catch {
      return [];
    }
  }

  let content: string;
  try {
    content = await readFile(path, "utf-8");
  } catch {
    return [];
  }

  let records = content
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as SessionMetrics);

  if (opts?.since) {
    records = records.filter((r) => r.timestamp >= opts.since!);
  }

  if (opts?.limit) {
    records = records.slice(-opts.limit);
  }

  return records;
}

/**
 * Count total session records without parsing JSON.
 * Efficiently counts newlines in the file.
 */
export async function countMetrics(metricsPath?: string): Promise<number> {
  const path = metricsPath ?? DEFAULT_METRICS_PATH;
  let content: string;
  try {
    content = await readFile(path, "utf-8");
  } catch {
    return 0;
  }
  return content.split("\n").filter((line) => line.trim()).length;
}

// ── Interaction logging ───────────────────────────────────────────────────────

export interface InteractionRecord {
  timestamp: string;
  action: string;
  args: Record<string, unknown>;
  source: "chat_agent" | "direct_command";
  threadKey: string;
  result: "ok" | "error";
  detail?: string;
  /** User messages in thread before this action was dispatched. */
  turnsBeforeAction?: number;
  /** True if user had to rephrase (>1 message with same intent). */
  userCorrected?: boolean;
  /** Whether the user's intent was fulfilled by this interaction. */
  intentFulfilled?: "fulfilled" | "partial" | "failed" | "abandoned";
  /** Classification of the user's intent type. */
  intentType?: "status" | "approval" | "experiment" | "session" | "job" | "other";
  /** Whether the response included evidence grading (chat-mode compliance). */
  evidenceGraded?: boolean;
  /** Whether this interaction occurred in a chat-mode channel. */
  isChatMode?: boolean;
}

/** Read interaction records from the JSONL file, optionally filtered. */
export async function readInteractions(opts?: {
  since?: string;
  limit?: number;
  interactionsPath?: string;
}): Promise<InteractionRecord[]> {
  const path = opts?.interactionsPath ?? DEFAULT_INTERACTIONS_PATH;
  let content: string;
  try {
    content = await readFile(path, "utf-8");
  } catch {
    return [];
  }

  let records = content
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as InteractionRecord);

  if (opts?.since) {
    records = records.filter((r) => r.timestamp >= opts.since!);
  }

  if (opts?.limit) {
    records = records.slice(-opts.limit);
  }

  return records;
}

/** Append one interaction record to the interactions JSONL file. */
export async function recordInteraction(
  record: InteractionRecord,
  interactionsPath?: string,
): Promise<void> {
  const path = interactionsPath ?? DEFAULT_INTERACTIONS_PATH;
  await mkdir(dirname(path), { recursive: true });
  const line = JSON.stringify(record) + "\n";
  await appendFile(path, line, "utf-8");
}
