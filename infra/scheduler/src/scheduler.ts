/**
 * Scheduler — the core daemon that manages Youji's autonomous sessions.
 */

import { randomUUID } from 'node:crypto';
import type { SchedulerConfig } from './types.js';

/** Load scheduler config from environment variables with defaults. */
export function loadConfig(
  repoDir: string,
  env: Record<string, string | undefined> = process.env,
): SchedulerConfig {
  return {
    cron: env.CRON_SCHEDULE ?? '0 * * * *',
    repoDir,
    maxConcurrent: parseInt(env.MAX_CONCURRENT ?? '4', 10),
    fleetSize: parseInt(env.FLEET_SIZE ?? '2', 10),
    apiPort: parseInt(env.API_PORT ?? '8420', 10),
    supervisorModel: env.SUPERVISOR_MODEL ?? 'opus',
    fleetModel: env.FLEET_MODEL ?? 'sonnet',
    supervisorTimeoutMs: parseInt(env.SUPERVISOR_TIMEOUT_MS ?? String(60 * 60 * 1000), 10),
    fleetTimeoutMs: parseInt(env.FLEET_TIMEOUT_MS ?? String(20 * 60 * 1000), 10),
    supervisorBudgetUsd: parseFloat(env.SUPERVISOR_BUDGET_USD ?? '5.00'),
    fleetBudgetUsd: parseFloat(env.FLEET_BUDGET_USD ?? '1.00'),
  };
}

export class Scheduler {
  readonly config: SchedulerConfig;
  private sessions = new Map<string, { label: string; startedAt: number }>();
  private running = false;

  constructor(config: SchedulerConfig) {
    this.config = config;
  }

  get activeSessions(): number {
    return this.sessions.size;
  }

  canStartSession(): boolean {
    return this.sessions.size < this.config.maxConcurrent;
  }

  nextSessionId(): string {
    return randomUUID().slice(0, 8);
  }

  registerSession(id: string, label = 'session'): void {
    this.sessions.set(id, { label, startedAt: Date.now() });
  }

  unregisterSession(id: string): void {
    this.sessions.delete(id);
  }

  getStatus(): {
    running: boolean;
    activeSessions: number;
    sessions: Array<{ id: string; label: string; durationMs: number }>;
    config: SchedulerConfig;
  } {
    const now = Date.now();
    return {
      running: this.running,
      activeSessions: this.sessions.size,
      sessions: Array.from(this.sessions.entries()).map(([id, s]) => ({
        id,
        label: s.label,
        durationMs: now - s.startedAt,
      })),
      config: this.config,
    };
  }

  start(): void {
    this.running = true;
  }

  stop(): void {
    this.running = false;
  }
}
