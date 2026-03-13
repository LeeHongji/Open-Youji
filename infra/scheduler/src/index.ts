#!/usr/bin/env node
/**
 * Youji Scheduler — autonomous session daemon.
 *
 * Usage:
 *   node dist/index.js              # Start daemon (cron mode)
 *   node dist/index.js run          # Run one supervisor session now
 *   node dist/index.js status       # Show scheduler status
 */

import { Cron } from 'croner';
import { resolve } from 'node:path';
import { existsSync, writeFileSync, unlinkSync, readFileSync, mkdirSync, appendFileSync } from 'node:fs';

import { Scheduler, loadConfig } from './scheduler.js';
import { buildSupervisorPrompt, buildFleetPrompt, spawnSession } from './session.js';
import { parseTasks, isFleetEligible } from './tasks.js';
import { autoCommitOrphans, rebasePush } from './git.js';
import type { SessionConfig, SessionResult, FleetTask } from './types.js';

const LOCK_FILE = '.scheduler/scheduler.lock';
const LOG_DIR = '.scheduler/logs';
const HISTORY_FILE = '.scheduler/history.jsonl';

function log(msg: string): void {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

/** Persist session output to a log file and append to history. */
function persistSessionLog(repoDir: string, sessionId: string, result: SessionResult): void {
  const logsDir = resolve(repoDir, LOG_DIR);
  if (!existsSync(logsDir)) mkdirSync(logsDir, { recursive: true });

  // Write full session output to individual log file
  const logFile = resolve(logsDir, `${sessionId}-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
  const content = [
    `Session: ${sessionId}`,
    `Label: ${result.label}`,
    `Success: ${result.success}`,
    `Exit code: ${result.exitCode}`,
    `Duration: ${Math.round(result.durationMs / 1000)}s`,
    `---`,
    result.output ?? '(no output)',
    result.error ? `\n--- ERROR ---\n${result.error}` : '',
  ].join('\n');
  writeFileSync(logFile, content);

  // Append to JSONL history for trend analysis
  const historyPath = resolve(repoDir, HISTORY_FILE);
  const record = {
    sessionId,
    label: result.label,
    success: result.success,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    timestamp: new Date().toISOString(),
  };
  appendFileSync(historyPath, JSON.stringify(record) + '\n');
}

/** Run a single supervisor session. */
async function runSupervisor(scheduler: Scheduler): Promise<void> {
  const { repoDir } = scheduler.config;
  const sessionId = scheduler.nextSessionId();

  if (!scheduler.canStartSession()) {
    log(`Skip: ${scheduler.activeSessions} session(s) already running`);
    return;
  }

  log(`Starting supervisor session ${sessionId}`);
  scheduler.registerSession(sessionId, 'supervisor');

  try {
    // Pre-session: auto-commit orphans
    if (autoCommitOrphans(repoDir)) {
      log('Auto-committed orphaned files from previous session');
    }

    // Spawn claude -p
    const config: SessionConfig = {
      prompt: buildSupervisorPrompt(repoDir),
      model: scheduler.config.supervisorModel,
      cwd: repoDir,
      maxDurationMs: scheduler.config.supervisorTimeoutMs,
      maxBudgetUsd: scheduler.config.supervisorBudgetUsd,
      label: 'supervisor',
    };

    const result = await spawnSession(config);
    log(`Supervisor ${sessionId} finished: ${result.success ? 'OK' : 'FAIL'} (${Math.round(result.durationMs / 1000)}s)`);
    if (result.output) log(`Output (last 2000 chars):\n${result.output}`);
    if (result.error) log(`Error: ${result.error}`);
    persistSessionLog(repoDir, sessionId, result);

    // Post-session: auto-commit any remaining orphans
    autoCommitOrphans(repoDir);

    // Push
    const pushResult = rebasePush(repoDir, sessionId);
    log(`Push: ${pushResult.status}${pushResult.branch ? ` → ${pushResult.branch}` : ''}`);
  } finally {
    scheduler.unregisterSession(sessionId);
  }
}

/** Scan for fleet-eligible tasks and spawn workers. */
async function runFleet(scheduler: Scheduler): Promise<void> {
  const { repoDir, fleetSize } = scheduler.config;
  if (fleetSize <= 0) return;

  // Scan all TASKS.md files
  const { readdirSync } = await import('node:fs');
  const projectsDir = resolve(repoDir, 'projects');
  if (!existsSync(projectsDir)) return;

  const allTasks: FleetTask[] = [];
  for (const project of readdirSync(projectsDir)) {
    const tasksFile = resolve(projectsDir, project, 'TASKS.md');
    if (!existsSync(tasksFile)) continue;
    const content = readFileSync(tasksFile, 'utf-8');
    allTasks.push(...parseTasks(content, project));
  }

  const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2, none: 3 };
  const eligible = allTasks
    .filter(isFleetEligible)
    .sort((a, b) => (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3));
  const slotsAvailable = fleetSize - scheduler.activeSessions + 1; // +1 because supervisor slot is separate
  const toSpawn = Math.min(eligible.length, Math.max(0, slotsAvailable));

  const promises: Promise<void>[] = [];
  for (let i = 0; i < toSpawn; i++) {
    const task = eligible[i];
    promises.push(runFleetWorker(scheduler, task));
  }

  await Promise.all(promises);
}

/** Run a single fleet worker for a specific task. */
async function runFleetWorker(scheduler: Scheduler, task: FleetTask): Promise<void> {
  const { repoDir } = scheduler.config;
  const sessionId = scheduler.nextSessionId();

  log(`Fleet worker ${sessionId}: "${task.text}" (${task.project})`);
  scheduler.registerSession(sessionId, `fleet:${task.project}`);

  try {
    const config: SessionConfig = {
      prompt: buildFleetPrompt(task),
      model: scheduler.config.fleetModel,
      cwd: repoDir,
      maxDurationMs: scheduler.config.fleetTimeoutMs,
      maxBudgetUsd: scheduler.config.fleetBudgetUsd,
      label: `fleet:${task.project}`,
    };

    const result = await spawnSession(config);
    log(`Fleet ${sessionId} finished: ${result.success ? 'OK' : 'FAIL'} (${Math.round(result.durationMs / 1000)}s)`);
    persistSessionLog(repoDir, sessionId, result);

    // Push
    const pushResult = rebasePush(repoDir, sessionId);
    log(`Fleet push: ${pushResult.status}`);
  } finally {
    scheduler.unregisterSession(sessionId);
  }
}

/** Acquire instance lock. */
function acquireLock(repoDir: string): boolean {
  const lockPath = resolve(repoDir, LOCK_FILE);
  const lockDir = resolve(repoDir, '.scheduler');
  if (!existsSync(lockDir)) mkdirSync(lockDir, { recursive: true });

  if (existsSync(lockPath)) {
    const pid = readFileSync(lockPath, 'utf-8').trim();
    // Check if process is still alive
    try {
      process.kill(parseInt(pid), 0);
      return false; // Process alive, lock held
    } catch {
      // Process dead, stale lock
      log(`Removing stale lock (PID ${pid})`);
    }
  }

  writeFileSync(lockPath, String(process.pid));
  return true;
}

function releaseLock(repoDir: string): void {
  const lockPath = resolve(repoDir, LOCK_FILE);
  try { unlinkSync(lockPath); } catch { /* ignore */ }
}

// --- Main ---

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'start';
  const repoDir = resolve(process.env.REPO_DIR ?? resolve(import.meta.dirname, '../../..'));
  const config = loadConfig(repoDir);
  const scheduler = new Scheduler(config);

  switch (command) {
    case 'run': {
      log('Running single supervisor session...');
      await runSupervisor(scheduler);
      break;
    }

    case 'status': {
      const status = scheduler.getStatus();
      console.log(JSON.stringify(status, null, 2));
      break;
    }

    case 'start':
    default: {
      if (!acquireLock(repoDir)) {
        console.error('Another scheduler instance is already running. Exiting.');
        process.exit(1);
      }

      log(`Youji scheduler starting (cron: ${config.cron}, supervisor: ${config.supervisorModel}, fleet: ${config.fleetSize}×${config.fleetModel}, max-concurrent: ${config.maxConcurrent})`);
      scheduler.start();

      // Graceful shutdown
      const shutdown = () => {
        log('Shutting down...');
        scheduler.stop();
        releaseLock(repoDir);
        process.exit(0);
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);

      // Cron job
      const job = new Cron(config.cron, async () => {
        log('Cron tick');
        await runSupervisor(scheduler);
        await runFleet(scheduler);
      });

      log(`Next run: ${job.nextRun()?.toISOString()}`);
      log('Scheduler running. Press Ctrl+C to stop.');
    }
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
