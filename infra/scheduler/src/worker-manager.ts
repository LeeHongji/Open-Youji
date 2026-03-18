/** WorkerManager: per-project worker lifecycle — picks tasks, spawns agents in worktrees, pushes results. */

import { createHash } from "node:crypto";
import type { WorktreeManager, WorktreeInfo } from "./worktree.js";
import type { AgentProfile, AgentResult, SpawnAgentOpts } from "./agent.js";
import type { EnqueuePushResult, EnqueuePushOptions } from "./rebase-push.js";
import { parseTasksFile, markTaskInProgress, markTaskDone } from "./task-parser.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface WorkerManagerConfig {
  /** Absolute path to the main repository. */
  repoDir: string;
  /** WorktreeManager instance for worktree lifecycle. */
  worktreeManager: WorktreeManager;
  /** Injected spawnAgent function (DI for testing). */
  spawnAgent: (opts: SpawnAgentOpts) => {
    sessionId: string;
    handle: { interrupt: () => Promise<void> };
    result: Promise<AgentResult>;
  };
  /** Injected enqueuePushAndWait function (DI for testing). */
  enqueuePush: (
    repoDir: string,
    sessionId: string,
    opts?: EnqueuePushOptions,
  ) => Promise<EnqueuePushResult>;
  /** Injected file reader (DI for testing). */
  readFile: (path: string) => string;
  /** Injected file writer (DI for testing). */
  writeFile: (path: string, content: string) => void;
  /** Callback for worker completion events. */
  onCompletion?: (event: WorkerCompletionEvent) => void;
}

export interface WorkerCompletionEvent {
  /** Project name the worker belongs to. */
  project: string;
  /** Generated task ID. */
  taskId: string;
  /** Task text from TASKS.md. */
  taskText: string;
  /** Agent result (null if agent failed to spawn). */
  result: AgentResult | null;
  /** Error message if the worker failed. */
  error?: string;
  /** Whether this was a retry attempt. */
  retried: boolean;
  /** Worktree branch name (e.g., "worker/task-abc123"). */
  branch?: string;
}

interface ActiveWorkerInfo {
  taskId: string;
  sessionId: string;
  startedAt: number;
  abortController: AbortController;
}

const PROJECT_WORKER_PROFILE: AgentProfile = {
  model: "opus",
  maxTurns: 64,
  maxDurationMs: 900_000,
  label: "project-worker",
};

// ── Worker prompt template ──────────────────────────────────────────────────

function buildWorkerPrompt(task: { text: string; doneWhen: string | null }, project: string, branch: string): string {
  const doneLine = task.doneWhen ? `\nDONE WHEN: ${task.doneWhen}` : "";
  return `TASK: ${task.text}${doneLine}
PROJECT: ${project}
BRANCH: ${branch}

Instructions:
- Complete the task described above
- Commit your work with descriptive messages
- Do not modify files outside this project's scope
- If blocked, explain what's needed and stop
- End with a one-line summary of what you accomplished`;
}

// ── TaskId generation ───────────────────────────────────────────────────────

function generateTaskId(taskText: string): string {
  const hash = createHash("sha256").update(taskText).digest("hex").slice(0, 8);
  return `task-${hash}`;
}

// ── WorkerManager ───────────────────────────────────────────────────────────

export class WorkerManager {
  private readonly config: WorkerManagerConfig;
  private readonly activeWorkers = new Map<string, ActiveWorkerInfo>();

  constructor(config: WorkerManagerConfig) {
    this.config = config;
  }

  /**
   * Start the worker loop for a project. No-op if already running.
   * Fires and forgets the async loop.
   */
  startProject(project: string, opts?: { model?: string }): void {
    if (this.activeWorkers.has(project)) return;

    const abortController = new AbortController();
    // Placeholder entry so duplicate calls are no-ops
    this.activeWorkers.set(project, {
      taskId: "",
      sessionId: "",
      startedAt: Date.now(),
      abortController,
    });

    // Fire-and-forget the worker loop
    this.runWorkerLoop(project, abortController.signal, opts?.model).catch((err) => {
      console.error(`[worker-manager] Loop error for ${project}: ${err}`);
    }).finally(() => {
      this.activeWorkers.delete(project);
    });
  }

  /** Signal the worker loop to stop for a project. */
  stopProject(project: string): void {
    const worker = this.activeWorkers.get(project);
    if (worker) {
      worker.abortController.abort();
    }
  }

  /** Get snapshot of active workers. */
  getActiveWorkers(): Map<string, { taskId: string; sessionId: string; startedAt: number }> {
    const snapshot = new Map<string, { taskId: string; sessionId: string; startedAt: number }>();
    for (const [project, info] of this.activeWorkers) {
      snapshot.set(project, {
        taskId: info.taskId,
        sessionId: info.sessionId,
        startedAt: info.startedAt,
      });
    }
    return snapshot;
  }

  // ── Private: worker loop ────────────────────────────────────────────────

  private async runWorkerLoop(
    project: string,
    signal: AbortSignal,
    modelOverride?: string,
  ): Promise<void> {
    const tasksPath = `${this.config.repoDir}/projects/${project}/TASKS.md`;

    while (!signal.aborted) {
      // 1. Read TASKS.md
      const content = this.config.readFile(tasksPath);
      const tasks = parseTasksFile(content);

      // 2. Find first open, unblocked, non-in-progress task
      const taskIdx = tasks.findIndex((t) => !t.isBlocked && !t.isInProgress);
      if (taskIdx === -1) {
        // No open tasks — stop
        return;
      }

      const task = tasks[taskIdx];
      const taskId = generateTaskId(task.text);

      // 3. Mark task in-progress
      const today = new Date().toISOString().slice(0, 10);
      const freshContent = this.config.readFile(tasksPath);
      const updatedContent = markTaskInProgress(freshContent, taskIdx, today);
      this.config.writeFile(tasksPath, updatedContent);

      // 4. Allocate worktree
      const allocResult = await this.config.worktreeManager.allocate(taskId);
      if (!allocResult.ok) {
        console.error(`[worker-manager] Worktree allocation failed for ${taskId}: ${allocResult.reason}`);
        return;
      }

      const worktreeInfo = allocResult.info;
      const branch = worktreeInfo.branch;

      // 5. Build profile with optional model override
      const profile: AgentProfile = {
        ...PROJECT_WORKER_PROFILE,
        ...(modelOverride ? { model: modelOverride } : {}),
      };

      // 6. Build prompt
      const prompt = buildWorkerPrompt(task, project, branch);

      // 7. Execute with retry logic
      let result: AgentResult | null = null;
      let error: string | undefined;
      let retried = false;

      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const spawned = this.config.spawnAgent({
            profile,
            prompt,
            cwd: worktreeInfo.path,
          });

          // Update active worker info
          const workerInfo = this.activeWorkers.get(project);
          if (workerInfo) {
            workerInfo.taskId = taskId;
            workerInfo.sessionId = spawned.sessionId;
            workerInfo.startedAt = Date.now();
          }

          result = await spawned.result;
          error = undefined;
          break; // success
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
          if (attempt === 0) {
            retried = true;
            console.log(`[worker-manager] Worker failed for ${taskId}, retrying: ${error}`);
          }
        }
      }

      // 8. Release worktree
      await this.config.worktreeManager.release(taskId);

      if (error) {
        // Both attempts failed — mark task blocked
        try {
          const blockedContent = this.config.readFile(tasksPath);
          // Replace the in-progress tag with blocked-by tag
          const blockedUpdated = blockedContent.replace(
            new RegExp(`(- \\[ \\].*?)\\s*\\[in-progress:[^\\]]+\\]`, "m"),
            `$1 [blocked-by: execution failure]`,
          );
          this.config.writeFile(tasksPath, blockedUpdated);
        } catch {
          // Best effort
        }

        this.config.onCompletion?.({
          project,
          taskId,
          taskText: task.text,
          result: null,
          error,
          retried,
          branch,
        });
        continue; // Try next task
      }

      // 9. Push results
      try {
        await this.config.enqueuePush(this.config.repoDir, `worker-${taskId}`);
      } catch (pushErr) {
        console.error(`[worker-manager] Push failed for ${taskId}: ${pushErr}`);
      }

      // 10. Mark task done
      const doneContent = this.config.readFile(tasksPath);
      // Find the task that was marked in-progress and mark it done
      // We need to find by original task index among ALL open tasks
      const doneTasks = parseTasksFile(doneContent);
      // Find by matching text since indices may have shifted
      const doneIdx = doneTasks.findIndex((t) => t.text.replace(/\s*\[in-progress:[^\]]+\]/, "") === task.text || t.text === task.text);
      if (doneIdx !== -1) {
        const doneUpdated = markTaskDone(doneContent, doneIdx);
        this.config.writeFile(tasksPath, doneUpdated);
      }

      // 11. Notify completion
      this.config.onCompletion?.({
        project,
        taskId,
        taskText: task.text,
        result,
        retried: false,
        branch,
      });
    }
  }
}
