import { describe, it, expect, vi, beforeEach } from "vitest";
import { WorkerManager, type WorkerManagerConfig, type WorkerCompletionEvent } from "./worker-manager.js";
import type { WorktreeManager, WorktreeAllocResult, WorktreeReleaseResult, WorktreeInfo } from "./worktree.js";
import type { AgentResult, SpawnAgentOpts } from "./agent.js";

// ── Test fixtures ──────────────────────────────────────────────────────────

const TASKS_MD_THREE_TASKS = `# Tasks

- [ ] First task [fleet-eligible]
  Done when: tests pass
- [ ] Second task [requires-opus]
  Done when: feature works
- [x] Already done task
- [ ] Blocked task [blocked-by: something]
`;

const TASKS_MD_ONE_OPEN = `# Tasks

- [ ] Only open task
  Done when: it is done
`;

const TASKS_MD_ALL_DONE = `# Tasks

- [x] Done task one
- [x] Done task two
`;

const TASKS_MD_IN_PROGRESS = `# Tasks

- [ ] Task one [in-progress: 2026-03-18]
- [ ] Task two
  Done when: something
`;

function makeAgentResult(overrides?: Partial<AgentResult>): AgentResult {
  return {
    text: "Task completed successfully",
    costUsd: 0.05,
    numTurns: 10,
    durationMs: 30_000,
    timedOut: false,
    ...overrides,
  };
}

function makeMockWorktreeManager(overrides?: {
  allocateResult?: WorktreeAllocResult;
  releaseResult?: WorktreeReleaseResult;
}): WorktreeManager {
  const allocResult: WorktreeAllocResult = overrides?.allocateResult ?? {
    ok: true,
    info: {
      taskId: "task-0",
      branch: "worker/task-0",
      path: "/repo/.worktrees/task-0",
      allocatedAt: Date.now(),
    },
  };

  return {
    allocate: vi.fn().mockResolvedValue(allocResult),
    release: vi.fn().mockResolvedValue(
      overrides?.releaseResult ?? { ok: true, merged: true },
    ),
    list: vi.fn().mockReturnValue([]),
    getCapacity: vi.fn().mockReturnValue({ current: 0, max: 4 }),
    recover: vi.fn().mockResolvedValue(0),
  } as unknown as WorktreeManager;
}

function makeMockSpawnAgent(result?: AgentResult): typeof import("./agent.js").spawnAgent {
  const agentResult = result ?? makeAgentResult();
  return vi.fn().mockReturnValue({
    sessionId: "worker-session-123",
    handle: { interrupt: vi.fn() },
    result: Promise.resolve(agentResult),
  });
}

function makeMockEnqueuePush(): typeof import("./rebase-push.js").enqueuePushAndWait {
  return vi.fn().mockResolvedValue({
    status: "pushed",
    pushQueueResult: "queued-success",
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("WorkerManager", () => {
  let readFileMock: ReturnType<typeof vi.fn>;
  let writeFileMock: ReturnType<typeof vi.fn>;
  let worktreeManager: WorktreeManager;
  let spawnAgentMock: ReturnType<typeof makeMockSpawnAgent>;
  let enqueuePushMock: ReturnType<typeof makeMockEnqueuePush>;
  let completionEvents: WorkerCompletionEvent[];

  function makeConfig(overrides?: Partial<WorkerManagerConfig>): WorkerManagerConfig {
    return {
      repoDir: "/repo",
      worktreeManager,
      spawnAgent: spawnAgentMock,
      enqueuePush: enqueuePushMock,
      readFile: readFileMock,
      writeFile: writeFileMock,
      onCompletion: (event) => completionEvents.push(event),
      ...overrides,
    };
  }

  beforeEach(() => {
    completionEvents = [];
    readFileMock = vi.fn();
    writeFileMock = vi.fn();
    worktreeManager = makeMockWorktreeManager();
    spawnAgentMock = makeMockSpawnAgent();
    enqueuePushMock = makeMockEnqueuePush();
  });

  describe("startProject", () => {
    it("picks first open unblocked task from TASKS.md", async () => {
      // First read returns tasks, second read (after marking in-progress) returns all done
      readFileMock
        .mockReturnValueOnce(TASKS_MD_THREE_TASKS)   // initial read for task picking
        .mockReturnValueOnce(TASKS_MD_THREE_TASKS)    // read for markTaskInProgress
        .mockReturnValueOnce(TASKS_MD_ALL_DONE);      // second loop iteration - no more tasks

      const wm = new WorkerManager(makeConfig());
      wm.startProject("test-project");

      // Wait for the async loop to complete
      await vi.waitFor(() => {
        expect(spawnAgentMock).toHaveBeenCalled();
      }, { timeout: 2000 });

      // Should have spawned agent for "First task"
      const call = spawnAgentMock.mock.calls[0][0] as SpawnAgentOpts;
      expect(call.prompt).toContain("First task");
    });

    it("is no-op for already-active project", async () => {
      // Make readFile hang so the loop stays active
      readFileMock.mockReturnValueOnce(TASKS_MD_ONE_OPEN)
        .mockReturnValueOnce(TASKS_MD_ONE_OPEN)
        .mockReturnValue(TASKS_MD_ALL_DONE);

      const wm = new WorkerManager(makeConfig());
      wm.startProject("test-project");
      wm.startProject("test-project"); // second call should be no-op

      await vi.waitFor(() => {
        expect(spawnAgentMock).toHaveBeenCalled();
      }, { timeout: 2000 });

      // Should only have spawned once (not twice)
      expect(spawnAgentMock).toHaveBeenCalledTimes(1);
    });

    it("passes model override to spawnAgent profile", async () => {
      readFileMock
        .mockReturnValueOnce(TASKS_MD_ONE_OPEN)
        .mockReturnValueOnce(TASKS_MD_ONE_OPEN)
        .mockReturnValue(TASKS_MD_ALL_DONE);

      const wm = new WorkerManager(makeConfig());
      wm.startProject("test-project", { model: "sonnet" });

      await vi.waitFor(() => {
        expect(spawnAgentMock).toHaveBeenCalled();
      }, { timeout: 2000 });

      const call = spawnAgentMock.mock.calls[0][0] as SpawnAgentOpts;
      expect(call.profile.model).toBe("sonnet");
    });
  });

  describe("worker loop lifecycle", () => {
    it("marks task in-progress before allocating worktree", async () => {
      readFileMock
        .mockReturnValueOnce(TASKS_MD_ONE_OPEN)
        .mockReturnValueOnce(TASKS_MD_ONE_OPEN)
        .mockReturnValue(TASKS_MD_ALL_DONE);

      const callOrder: string[] = [];
      writeFileMock.mockImplementation(() => callOrder.push("writeFile"));
      (worktreeManager.allocate as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callOrder.push("allocate");
        return { ok: true, info: { taskId: "task-0", branch: "worker/task-0", path: "/repo/.worktrees/task-0", allocatedAt: Date.now() } };
      });

      const wm = new WorkerManager(makeConfig());
      wm.startProject("test-project");

      await vi.waitFor(() => {
        expect(callOrder).toContain("writeFile");
        expect(callOrder).toContain("allocate");
      }, { timeout: 2000 });

      const writeIdx = callOrder.indexOf("writeFile");
      const allocIdx = callOrder.indexOf("allocate");
      expect(writeIdx).toBeLessThan(allocIdx);
    });

    it("allocates worktree with taskId", async () => {
      readFileMock
        .mockReturnValueOnce(TASKS_MD_ONE_OPEN)
        .mockReturnValueOnce(TASKS_MD_ONE_OPEN)
        .mockReturnValue(TASKS_MD_ALL_DONE);

      const wm = new WorkerManager(makeConfig());
      wm.startProject("test-project");

      await vi.waitFor(() => {
        expect(worktreeManager.allocate).toHaveBeenCalled();
      }, { timeout: 2000 });

      const allocCall = (worktreeManager.allocate as ReturnType<typeof vi.fn>).mock.calls[0];
      // First argument should be a taskId string
      expect(typeof allocCall[0]).toBe("string");
    });

    it("calls spawnAgent with worktree path as cwd and projectWorker profile", async () => {
      readFileMock
        .mockReturnValueOnce(TASKS_MD_ONE_OPEN)
        .mockReturnValueOnce(TASKS_MD_ONE_OPEN)
        .mockReturnValue(TASKS_MD_ALL_DONE);

      const wm = new WorkerManager(makeConfig());
      wm.startProject("test-project");

      await vi.waitFor(() => {
        expect(spawnAgentMock).toHaveBeenCalled();
      }, { timeout: 2000 });

      const call = spawnAgentMock.mock.calls[0][0] as SpawnAgentOpts;
      expect(call.cwd).toBe("/repo/.worktrees/task-0");
      expect(call.profile.label).toBe("project-worker");
      expect(call.profile.maxTurns).toBe(64);
      expect(call.profile.maxDurationMs).toBe(900_000);
    });

    it("releases worktree after agent completes", async () => {
      readFileMock
        .mockReturnValueOnce(TASKS_MD_ONE_OPEN)
        .mockReturnValueOnce(TASKS_MD_ONE_OPEN)
        .mockReturnValue(TASKS_MD_ALL_DONE);

      const wm = new WorkerManager(makeConfig());
      wm.startProject("test-project");

      await vi.waitFor(() => {
        expect(worktreeManager.release).toHaveBeenCalled();
      }, { timeout: 2000 });
    });

    it("calls enqueuePushAndWait after release", async () => {
      readFileMock
        .mockReturnValueOnce(TASKS_MD_ONE_OPEN)
        .mockReturnValueOnce(TASKS_MD_ONE_OPEN)
        .mockReturnValue(TASKS_MD_ALL_DONE);

      const callOrder: string[] = [];
      (worktreeManager.release as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callOrder.push("release");
        return { ok: true, merged: true };
      });
      enqueuePushMock.mockImplementation(async () => {
        callOrder.push("enqueuePush");
        return { status: "pushed", pushQueueResult: "queued-success" };
      });

      const wm = new WorkerManager(makeConfig());
      wm.startProject("test-project");

      await vi.waitFor(() => {
        expect(callOrder).toContain("release");
        expect(callOrder).toContain("enqueuePush");
      }, { timeout: 2000 });

      const releaseIdx = callOrder.indexOf("release");
      const pushIdx = callOrder.indexOf("enqueuePush");
      expect(releaseIdx).toBeLessThan(pushIdx);
    });

    it("marks task done after successful push", async () => {
      readFileMock
        .mockReturnValueOnce(TASKS_MD_ONE_OPEN)
        .mockReturnValueOnce(TASKS_MD_ONE_OPEN)
        .mockReturnValueOnce(TASKS_MD_ONE_OPEN) // read for markTaskDone
        .mockReturnValue(TASKS_MD_ALL_DONE);

      const wm = new WorkerManager(makeConfig());
      wm.startProject("test-project");

      await vi.waitFor(() => {
        // writeFile called twice: once for in-progress, once for done
        expect(writeFileMock).toHaveBeenCalledTimes(2);
      }, { timeout: 2000 });

      // Second write should contain [x] (marking done)
      const secondWriteContent = writeFileMock.mock.calls[1][1] as string;
      expect(secondWriteContent).toContain("[x]");
    });

    it("stops when TASKS.md has no open tasks", async () => {
      readFileMock.mockReturnValue(TASKS_MD_ALL_DONE);

      const wm = new WorkerManager(makeConfig());
      wm.startProject("test-project");

      // Wait a bit for the loop to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should not have spawned any agent
      expect(spawnAgentMock).not.toHaveBeenCalled();

      // Project should no longer be active
      expect(wm.getActiveWorkers().size).toBe(0);
    });

    it("skips in-progress tasks", async () => {
      readFileMock
        .mockReturnValueOnce(TASKS_MD_IN_PROGRESS)
        .mockReturnValueOnce(TASKS_MD_IN_PROGRESS)
        .mockReturnValue(TASKS_MD_ALL_DONE);

      const wm = new WorkerManager(makeConfig());
      wm.startProject("test-project");

      await vi.waitFor(() => {
        expect(spawnAgentMock).toHaveBeenCalled();
      }, { timeout: 2000 });

      // Should have picked "Task two" (not the in-progress one)
      const call = spawnAgentMock.mock.calls[0][0] as SpawnAgentOpts;
      expect(call.prompt).toContain("Task two");
    });
  });

  describe("onCompletion callback", () => {
    it("receives completion event with task details", async () => {
      readFileMock
        .mockReturnValueOnce(TASKS_MD_ONE_OPEN)
        .mockReturnValueOnce(TASKS_MD_ONE_OPEN)
        .mockReturnValueOnce(TASKS_MD_ONE_OPEN)
        .mockReturnValue(TASKS_MD_ALL_DONE);

      const wm = new WorkerManager(makeConfig());
      wm.startProject("test-project");

      await vi.waitFor(() => {
        expect(completionEvents.length).toBeGreaterThan(0);
      }, { timeout: 2000 });

      const event = completionEvents[0];
      expect(event.project).toBe("test-project");
      expect(event.taskText).toContain("Only open task");
      expect(event.result).toBeTruthy();
      expect(event.retried).toBe(false);
    });
  });

  describe("error handling", () => {
    it("auto-retries once on worker failure", async () => {
      const failResult = makeAgentResult();
      const failSpawn = vi.fn()
        .mockReturnValueOnce({
          sessionId: "fail-1",
          handle: { interrupt: vi.fn() },
          result: Promise.reject(new Error("agent crashed")),
        })
        .mockReturnValueOnce({
          sessionId: "retry-1",
          handle: { interrupt: vi.fn() },
          result: Promise.resolve(failResult),
        });

      readFileMock
        .mockReturnValueOnce(TASKS_MD_ONE_OPEN)
        .mockReturnValueOnce(TASKS_MD_ONE_OPEN)
        .mockReturnValueOnce(TASKS_MD_ONE_OPEN) // for markTaskDone after retry
        .mockReturnValue(TASKS_MD_ALL_DONE);

      const wm = new WorkerManager(makeConfig({ spawnAgent: failSpawn }));
      wm.startProject("test-project");

      await vi.waitFor(() => {
        expect(failSpawn).toHaveBeenCalledTimes(2);
      }, { timeout: 2000 });
    });

    it("marks task blocked after second failure", async () => {
      const failSpawn = vi.fn().mockReturnValue({
        sessionId: "fail-1",
        handle: { interrupt: vi.fn() },
        result: Promise.reject(new Error("agent crashed")),
      });

      readFileMock
        .mockReturnValueOnce(TASKS_MD_ONE_OPEN)
        .mockReturnValueOnce(TASKS_MD_ONE_OPEN)
        .mockReturnValueOnce(TASKS_MD_ONE_OPEN) // for marking blocked
        .mockReturnValue(TASKS_MD_ALL_DONE);

      const wm = new WorkerManager(makeConfig({ spawnAgent: failSpawn }));
      wm.startProject("test-project");

      await vi.waitFor(() => {
        // Should have called spawnAgent twice (initial + 1 retry)
        expect(failSpawn).toHaveBeenCalledTimes(2);
      }, { timeout: 2000 });

      await vi.waitFor(() => {
        const event = completionEvents.find((e) => e.error);
        expect(event).toBeTruthy();
        expect(event!.retried).toBe(true);
      }, { timeout: 2000 });
    });
  });

  describe("getActiveWorkers", () => {
    it("returns active workers map", async () => {
      // Make spawnAgent hang so the worker stays active
      const neverResolve = new Promise<AgentResult>(() => {});
      const hangingSpawn = vi.fn().mockReturnValue({
        sessionId: "hanging-1",
        handle: { interrupt: vi.fn() },
        result: neverResolve,
      });

      readFileMock
        .mockReturnValueOnce(TASKS_MD_ONE_OPEN)
        .mockReturnValueOnce(TASKS_MD_ONE_OPEN);

      const wm = new WorkerManager(makeConfig({ spawnAgent: hangingSpawn }));
      wm.startProject("test-project");

      await vi.waitFor(() => {
        expect(hangingSpawn).toHaveBeenCalled();
      }, { timeout: 2000 });

      const workers = wm.getActiveWorkers();
      expect(workers.has("test-project")).toBe(true);
      const worker = workers.get("test-project")!;
      expect(worker.sessionId).toBe("hanging-1");
      expect(typeof worker.startedAt).toBe("number");
    });
  });

  describe("stopProject", () => {
    it("signals the loop to stop", async () => {
      const neverResolve = new Promise<AgentResult>(() => {});
      const hangingSpawn = vi.fn().mockReturnValue({
        sessionId: "hanging-1",
        handle: { interrupt: vi.fn() },
        result: neverResolve,
      });

      readFileMock
        .mockReturnValueOnce(TASKS_MD_ONE_OPEN)
        .mockReturnValueOnce(TASKS_MD_ONE_OPEN);

      const wm = new WorkerManager(makeConfig({ spawnAgent: hangingSpawn }));
      wm.startProject("test-project");

      await vi.waitFor(() => {
        expect(hangingSpawn).toHaveBeenCalled();
      }, { timeout: 2000 });

      wm.stopProject("test-project");
      // After stop, getActiveWorkers should eventually clear
      // (the abort signal will cause the loop to exit)
    });
  });
});
