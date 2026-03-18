/** Scheduler service: timer loop that checks for due jobs and executes them. */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { JobStore } from "./store.js";
import { computeNextRunAtMs } from "./schedule.js";
import { executeJob, type ExecutionResult } from "./executor.js";
import { setDraining } from "./drain-state.js";
import { runBranchCleanup } from "./branch-cleanup.js";
import { dm, notifyBudgetExceeded } from "./slack.js";
import { checkTimeBudget } from "./budget-gate.js";
import { backgroundPushRetry } from "./rebase-push.js";
import { getWorkerManager } from "./slack-bridge.js";
import { buildProjectSnapshot, hasChanged, formatProactiveReport, type ProjectSnapshot } from "./proactive-report.js";
import type { WorkerManager } from "./worker-manager.js";
import type { Job } from "./types.js";

const DEFAULT_DRAIN_TIMEOUT_MS = 300_000; // 5 minutes

export interface ServiceOptions {
  storePath?: string;
  /** Polling interval in ms. Default: 30000 (30s) */
  pollIntervalMs?: number;
  /** Maximum concurrent sessions across all jobs. Default: 1. Set to 0 for unlimited. */
  maxConcurrentSessions?: number;
  /** Called before executing a job. Return false to skip. */
  onBeforeRun?: (job: Job) => boolean | Promise<boolean>;
  /** Called after a job completes. */
  onAfterRun?: (job: Job, result: ExecutionResult) => void | Promise<void>;
  /** Called on each poll cycle. */
  onTick?: (dueCount: number) => void | Promise<void>;
  /** Repository directory for branch cleanup. Required for scheduled branch cleanup. */
  repoDir?: string;
  /** Returns true when the push queue is actively processing a push. Used to
   *  prevent the background push retry from racing with session pushes. */
  isPushQueueBusy?: () => boolean;
}

export class SchedulerService {
  private store: JobStore;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private pollIntervalMs: number;
  private maxConcurrentSessions: number;
  private opts: ServiceOptions;
  /** Job names currently executing — prevents overlapping runs of the same job type. */
  private runningJobs = new Set<string>();
  /** Drain mode: stop accepting new jobs, wait for running jobs to complete. */
  private _draining = false;
  private drainPromise: Promise<void> | null = null;
  /** Last branch cleanup timestamp (ms). */
  private lastBranchCleanupMs = 0;
  /** Last background push retry timestamp (ms). */
  private lastBackgroundPushMs = 0;
  /** Last worker respawn check timestamp (ms). */
  private lastWorkerCheckMs = 0;
  private readonly WORKER_CHECK_INTERVAL_MS = 60_000;
  /** Last proactive report check timestamp (ms). */
  private lastProactiveCheckMs = 0;
  private readonly PROACTIVE_CHECK_INTERVAL_MS = 3_600_000; // 1 hour
  private lastSnapshots = new Map<string, ProjectSnapshot>();

  constructor(opts: ServiceOptions = {}) {
    this.opts = opts;
    this.store = new JobStore(opts.storePath);
    this.pollIntervalMs = opts.pollIntervalMs ?? 30_000;
    this.maxConcurrentSessions = opts.maxConcurrentSessions ?? 1;
  }

  async start(): Promise<void> {
    await this.store.load();
    this.running = true;
    log(`Scheduler started. ${this.store.list().length} jobs loaded.`);
    for (const job of this.store.list()) {
      if (job.enabled && job.state.nextRunAtMs === null) {
        log(`WARNING: enabled job "${job.name}" (${job.id}) has null nextRunAtMs — it will never fire`);
      }
    }
    logNextWake(this.store);

    // Run immediately on start, then on interval
    await this.tick();
    this.timer = setInterval(() => {
      this.tick().catch((err) => log(`Tick error: ${err}`));
    }, this.pollIntervalMs);
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    log("Scheduler stopped.");
  }

  getStore(): JobStore {
    return this.store;
  }

  getRunningCount(): number {
    return this.runningJobs.size;
  }

  isDraining(): boolean {
    return this._draining;
  }

  /**
   * Enter drain mode: stop accepting new jobs and wait for running jobs to finish.
   * Resolves when all running jobs complete or after timeoutMs (default 5 min).
   * Idempotent — repeated calls return the same promise.
   */
  startDrain(timeoutMs = DEFAULT_DRAIN_TIMEOUT_MS): Promise<void> {
    if (this.drainPromise) return this.drainPromise;

    this._draining = true;
    setDraining(true);
    log("Drain started — refusing new jobs, waiting for running jobs to finish.");

    this.drainPromise = new Promise<void>((resolve) => {
      // Fast path: nothing running
      if (this.runningJobs.size === 0) {
        log("Drain complete — no jobs were running.");
        resolve();
        return;
      }

      const timer = setTimeout(() => {
        log(`Drain timeout (${timeoutMs}ms) — ${this.runningJobs.size} job(s) still running, proceeding.`);
        resolve();
      }, timeoutMs);

      // Poll for completion every second
      const check = setInterval(() => {
        if (this.runningJobs.size === 0) {
          clearInterval(check);
          clearTimeout(timer);
          log("Drain complete — all jobs finished.");
          resolve();
        }
      }, 1000);
    });

    return this.drainPromise;
  }

  private async tick(): Promise<void> {
    if (!this.running || this._draining) return;

    // Reload store in case it was modified externally (e.g. by CLI add)
    await this.store.load();

    const now = Date.now();
    const dueJobs = this.store.getDueJobs(now);

    await this.opts.onTick?.(dueJobs.length);

    for (const job of dueJobs) {
      if (!this.running) break;

      // Guard: skip jobs that are already executing
      if (this.runningJobs.has(job.name)) {
        continue;
      }

      // Guard: respect max concurrent sessions limit
      if (this.maxConcurrentSessions > 0 && this.runningJobs.size >= this.maxConcurrentSessions) {
        log(`Max concurrent sessions (${this.maxConcurrentSessions}) reached, skipping ${job.name}`);
        continue;
      }

      const shouldRun = this.opts.onBeforeRun
        ? await this.opts.onBeforeRun(job)
        : true;

      if (!shouldRun) {
        log(`Skipping job ${job.name} (${job.id}): onBeforeRun returned false`);
        continue;
      }

      // Mark as running and advance nextRunAtMs BEFORE execution starts,
      // so subsequent ticks won't re-trigger this job.
      this.runningJobs.add(job.name);
      const nextRun = computeNextRunAtMs(job.schedule, Date.now());
      await this.store.updateState(job.id, { nextRunAtMs: nextRun });

      log(`Executing job: ${job.name} (${job.id})`);
      let result: ExecutionResult;
      try {
        result = await executeJob(job, "scheduler");
      } catch (err) {
        result = {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          durationMs: 0,
          exitCode: null,
          stdout: "",
          triggerSource: "scheduler",
        };
      } finally {
        this.runningJobs.delete(job.name);
      }

      // Update job state with execution results
      await this.store.updateState(job.id, {
        lastRunAtMs: Date.now(),
        lastStatus: result.ok ? "ok" : "error",
        lastError: result.error ?? null,
        lastDurationMs: result.durationMs,
        runCount: job.state.runCount + 1,
      });

      log(
        `Job ${job.name} finished: ${result.ok ? "ok" : "error"} (${Math.round(result.durationMs / 1000)}s)`,
      );

      await this.opts.onAfterRun?.(job, result);
    }

    if (dueJobs.length > 0) {
      logNextWake(this.store);
    }

    // Scheduled branch cleanup (ADR 0055): runs every 6 hours.
    const BRANCH_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
    if (
      this.opts.repoDir &&
      now - this.lastBranchCleanupMs >= BRANCH_CLEANUP_INTERVAL_MS &&
      !this._draining
    ) {
      this.lastBranchCleanupMs = now;
      try {
        const result = await runBranchCleanup(this.opts.repoDir, {
          keepDays: 3,
          dryRun: false,
        });
        if (result.deleted.length > 0) {
          log(`Branch cleanup: deleted ${result.deleted.length} branch(es)`);
          const report = `🗑️ Branch cleanup: deleted ${result.deleted.length} stale branch(es)\n${result.deleted.map((b) => `  - ${b}`).join("\n")}`;
          await dm(report).catch((err) => log(`Failed to send cleanup DM: ${err}`));
        } else {
          log("Branch cleanup: no stale branches found");
        }
      } catch (err) {
        log(`Branch cleanup error: ${err}`);
      }
    }

    // Background push retry: drains accumulated local commits that failed to
    // push via the push queue. Prevents cascade failures where one failed push
    // causes all subsequent pushes to fail. Runs every 60s, skipped when the
    // push queue is actively processing to avoid git lock contention.
    const BACKGROUND_PUSH_INTERVAL_MS = 60_000; // 60 seconds
    if (
      this.opts.repoDir &&
      now - this.lastBackgroundPushMs >= BACKGROUND_PUSH_INTERVAL_MS &&
      !this._draining
    ) {
      this.lastBackgroundPushMs = now;
      if (this.opts.isPushQueueBusy?.() !== true) {
        try {
          const result = await backgroundPushRetry(this.opts.repoDir);
          if (result.status === "pushed") {
            log(`Background push: pushed ${result.unpushedCount} accumulated commit(s)`);
          } else if (result.status === "failed") {
            log(`Background push: failed (${result.unpushedCount} unpushed) — ${result.error}`);
          }
        } catch (err) {
          log(`Background push error: ${err}`);
        }
      }
    }

    // Hourly proactive check: survey all projects and report changes
    if (this.shouldRunProactiveCheck()) {
      await this.runProactiveCheck();
    }

    // Worker respawn check: scan for projects with open tasks
    if (this.shouldCheckWorkers()) {
      const wm = getWorkerManager();
      if (wm) {
        await this.checkAndRespawnWorkers(wm);
      }
    }
  }

  private shouldCheckWorkers(): boolean {
    const now = Date.now();
    if (now - this.lastWorkerCheckMs < this.WORKER_CHECK_INTERVAL_MS) return false;
    this.lastWorkerCheckMs = now;
    return true;
  }

  private async checkAndRespawnWorkers(wm: WorkerManager): Promise<void> {
    if (!this.opts.repoDir) return;
    const projectsDir = join(this.opts.repoDir, "projects");
    if (!existsSync(projectsDir)) return;

    try {
      const entries = readdirSync(projectsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const tasksPath = join(projectsDir, entry.name, "TASKS.md");
        if (!existsSync(tasksPath)) continue;

        try {
          const content = readFileSync(tasksPath, "utf-8");
          // Check for open tasks: unchecked checkboxes
          if (/^- \[ \]/m.test(content)) {
            // Check time budget before spawning worker
            const budgetResult = await checkTimeBudget(entry.name, this.opts.repoDir!);
            if (!budgetResult.allowed) {
              wm.stopProject(entry.name);
              notifyBudgetExceeded(entry.name, budgetResult.usedMinutes, budgetResult.limitMinutes)
                .catch((err) => log(`Failed to send budget exceeded notification: ${err}`));
              continue;
            }
            wm.startProject(entry.name);
          }
        } catch {
          // Skip unreadable TASKS.md
        }
      }
    } catch (err) {
      log(`Worker respawn scan error: ${err}`);
    }
  }

  private shouldRunProactiveCheck(): boolean {
    const now = Date.now();
    if (now - this.lastProactiveCheckMs < this.PROACTIVE_CHECK_INTERVAL_MS) return false;
    this.lastProactiveCheckMs = now;
    return true;
  }

  private async runProactiveCheck(): Promise<void> {
    if (!this.opts.repoDir) return;
    const projectsDir = join(this.opts.repoDir, "projects");
    if (!existsSync(projectsDir)) return;

    try {
      const entries = readdirSync(projectsDir, { withFileTypes: true });
      const changedSnapshots: ProjectSnapshot[] = [];

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const tasksPath = join(projectsDir, entry.name, "TASKS.md");
        if (!existsSync(tasksPath)) continue;

        const snapshot = await buildProjectSnapshot(entry.name, this.opts.repoDir!, 0);
        const prev = this.lastSnapshots.get(entry.name) ?? null;

        if (hasChanged(snapshot, prev)) {
          changedSnapshots.push(snapshot);
        }
        this.lastSnapshots.set(entry.name, snapshot);
      }

      if (changedSnapshots.length > 0) {
        const report = formatProactiveReport(changedSnapshots);
        await dm(report).catch((err) => log(`Proactive report DM failed: ${err}`));
      }
    } catch (err) {
      log(`Proactive check error: ${err}`);
    }
  }
}

function log(msg: string): void {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

function logNextWake(store: JobStore): void {
  const nextMs = store.getNextWakeMs();
  if (nextMs) {
    log(`Next job due: ${new Date(nextMs).toISOString()}`);
  } else {
    log("No upcoming jobs.");
  }
}
