/** Core type definitions for the Youji scheduler. */

export interface SessionConfig {
  /** Prompt to send to claude -p */
  prompt: string;
  /** Model to use (e.g., "opus", "sonnet") */
  model: string;
  /** Working directory for the session */
  cwd: string;
  /** Maximum duration in milliseconds */
  maxDurationMs: number;
  /** Session label for logging */
  label: string;
  /** Additional CLI flags */
  flags?: string[];
}

export interface SessionResult {
  /** Whether the session completed successfully */
  success: boolean;
  /** Exit code from claude process */
  exitCode: number;
  /** Duration in milliseconds */
  durationMs: number;
  /** Session label */
  label: string;
  /** Captured stdout (last 2000 chars) */
  output?: string;
  /** Error message if failed */
  error?: string;
}

export interface SchedulerConfig {
  /** Cron expression (e.g., "0 * * * *" for hourly) */
  cron: string;
  /** Path to the Youji repo */
  repoDir: string;
  /** Maximum concurrent sessions (supervisor + fleet) */
  maxConcurrent: number;
  /** Number of fleet workers (0 = disabled) */
  fleetSize: number;
  /** Port for control API */
  apiPort: number;
}

export interface FleetTask {
  /** Stable ID derived from task text */
  id: string;
  /** Raw task text from TASKS.md */
  text: string;
  /** Project name */
  project: string;
  /** Priority level */
  priority: 'high' | 'medium' | 'low' | 'none';
  /** Done-when condition */
  doneWhen?: string;
  /** Why this task matters */
  why?: string;
  /** Tags extracted from task text */
  tags: string[];
}

export interface PushResult {
  status: 'pushed' | 'branch-fallback' | 'nothing-to-push' | 'error';
  branch?: string;
  error?: string;
}
