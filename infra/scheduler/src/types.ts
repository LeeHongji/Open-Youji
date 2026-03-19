/** Type definitions for the youji scheduler. Minimal extraction from OpenClaw cron types. */

export interface CronSchedule {
  kind: "cron";
  /** 5-field cron expression (minute hour day month weekday) */
  expr: string;
  /** IANA timezone, defaults to UTC */
  tz?: string;
}

export interface IntervalSchedule {
  kind: "every";
  /** Interval in milliseconds */
  everyMs: number;
  /** Anchor timestamp in ms (defaults to job creation time) */
  anchorMs?: number;
}

export type Schedule = CronSchedule | IntervalSchedule;

export type TaskType = "experiment" | "analysis" | "implementation" | "bugfix";

export interface JobPayload {
  /** Message to send to the agent */
  message: string;
  /** Model to use (e.g. "opus", "sonnet") */
  model?: string;
  /** Working directory for the agent session */
  cwd?: string;
  /** Agent backend: "claude" (SDK), "cursor" (CLI), "opencode" (CLI), or "auto" (claude → cursor → opencode fallback). Default: auto. */
  backend?: "claude" | "cursor" | "opencode" | "auto";
  /** Maximum session duration in milliseconds. Default: 3,600,000 (60 min). */
  maxDurationMs?: number;
  /** Agent profile key from AGENT_PROFILES (e.g. "skillCycle"). Overrides model/maxDurationMs defaults. */
  profile?: string;
  /** Specialist role for this session (e.g. "project-researcher", "infrastructure-engineer", "synthesizer"). */
  role?: string;
  /** Project scope for specialist roles (e.g. "sample-project"). Used with role to scope orient. */
  roleProject?: string;
  /** Task type for convention module injection. Determines which schema/convention files are loaded. */
  taskType?: TaskType;
}

export interface JobState {
  nextRunAtMs: number | null;
  lastRunAtMs: number | null;
  lastStatus: "ok" | "error" | null;
  lastError: string | null;
  lastDurationMs: number | null;
  runCount: number;
  /** Timestamp (ms) of the last session that ran a full /orient. Used for orient tiering (ADR 0030). */
  lastFullOrientAt?: number | null;
  /** Timestamp (ms) of the last session that ran a full /compound. Used for compound tiering. */
  lastFullCompoundAt?: number | null;
}

export interface Job {
  id: string;
  name: string;
  schedule: Schedule;
  payload: JobPayload;
  enabled: boolean;
  createdAtMs: number;
  state: JobState;
}

export interface JobCreate {
  name: string;
  schedule: Schedule;
  payload: JobPayload;
  enabled?: boolean;
}

export interface Store {
  version: 1;
  jobs: Job[];
}

// ── Fleet types (ADR 0042-v2) ────────────────────────────────────────────────

/** Fleet worker configuration. */
export interface FleetWorkerConfig {
  /** Maximum concurrent fleet workers. 0 = fleet disabled. */
  maxWorkers: number;
  /** Per-project concurrency limit. */
  maxWorkersPerProject: number;
  /** Fleet poll interval in ms. Default: 30000 (30s). */
  pollIntervalMs: number;
}

/** A task scanned from TASKS.md, ready for fleet assignment. */
export interface FleetTask {
  /** Stable hash of normalized task text. */
  taskId: string;
  /** Raw task text (first line). */
  text: string;
  /** "Done when" condition, if present. */
  doneWhen: string | null;
  /** "Why" context, if present. */
  why: string | null;
  /** Project name (directory name under projects/). */
  project: string;
  /** Task priority (high > medium > low). */
  priority: "high" | "medium" | "low";
  /** Whether the task is tagged [fleet-eligible]. */
  fleetEligible: boolean;
  /** Whether the task is tagged [requires-opus]. */
  requiresOpus: boolean;
  /** Whether the task is tagged [zero-resource]. */
  zeroResource: boolean;
  /** Skill type from [skill: ...] tag (ADR 0062). Null if no explicit tag. */
  skillType: SkillType | null;
}

/** Skill types for task routing (ADR 0062). */
export type SkillType =
  | "record"
  | "persist"
  | "govern"
  | "execute"
  | "diagnose"
  | "analyze"
  | "orient"
  | "multi";

/** Worker roles for skill-typed prompt routing (ADR 0062). */
export type WorkerRole = "knowledge" | "implementation" | "default";

/** Result from a completed fleet worker session. */
export interface FleetWorkerResult {
  taskId: string;
  project: string;
  sessionId: string;
  ok: boolean;
  durationMs: number;
  error?: string;
  /** Cost in USD (0 for opencode/local backends). */
  costUsd?: number;
  /** Number of LLM turns in the session. */
  numTurns?: number;
  /** Whether the session timed out. */
  timedOut?: boolean;
  /** Backend used (always "opencode" for fleet workers currently). */
  backend?: "claude" | "cursor" | "opencode";
  /** Per-model token usage and cost breakdown. */
  modelUsage?: Record<string, { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number; costUSD: number; contextWindow?: number; maxOutputTokens?: number }>;
  /** Per-tool invocation counts. */
  toolCounts?: Record<string, number>;
  /** Number of assistant turns consumed by /orient (should be null for fleet — no orient). */
  orientTurns?: number;
  /** Git HEAD commit before the session started. */
  headBefore?: string | null;
  /** Git HEAD commit after the session completed (after auto-commit and rebase-push). */
  headAfter?: string | null;
  /** Post-session verification metrics (compact format for SessionMetrics). */
  verification?: import("./metrics.js").VerificationMetrics | null;
  /** Post-session knowledge output metrics. */
  knowledge?: import("./metrics.js").KnowledgeMetrics | null;
  /** Cross-project metrics. */
  crossProject?: import("./metrics.js").CrossProjectMetrics | null;
  /** Quality audit metrics. */
  qualityAudit?: import("./metrics.js").QualityAuditMetrics | null;
  /** Whether this was an idle exploration session (ADR 0048). */
  isIdle?: boolean;
  /** Type of idle exploration (e.g., "horizon-scan", "self-audit"). */
  explorationType?: string;
  /** Fleet task supply at time of session (for starvation tracking). */
  fleetTaskSupply?: number;
  /** Skill type from task [skill: ...] tag. Null if task had no skill tag. */
  skillType?: SkillType | null;
  workerRole?: WorkerRole | null;
  pushQueueResult?: "queued-success" | "queued-rebase-failed" | "direct-push" | "no-push-needed";
  isRateLimited?: boolean;
  isRecycled?: boolean;
  recycledFrom?: string;
}
