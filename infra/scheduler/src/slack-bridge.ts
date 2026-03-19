import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { SlackBot, deriveConvKey } from "./slack-bot.js";
import { ThreadStore } from "./thread-store.js";
import { ConversationLock } from "./thread-mutex.js";
import { handleDirectorMessage } from "./director.js";
import { WorkerManager, type WorkerCompletionEvent } from "./worker-manager.js";
import { WorktreeManager } from "./worktree.js";
import { spawnAgent } from "./agent.js";
import { enqueuePushAndWait } from "./rebase-push.js";
import { notifyWorkerCompletion, notifyWorkerFailure } from "./slack.js";

import type { SlackMessage, ReplyFn } from "./slack-bot.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SlackBridgeOptions {
  botToken: string;
  appToken: string;
  repoDir: string;
  dbPath?: string;
}

// ── Module state ───────────────────────────────────────────────────────────────

let bot: SlackBot | null = null;
let store: ThreadStore | null = null;
let lock: ConversationLock | null = null;
let repoDir = "";
let workerManager: WorkerManager | null = null;

// ── Public API ─────────────────────────────────────────────────────────────────

export async function startSlackBridge(opts: SlackBridgeOptions): Promise<void> {
  const dbPath = opts.dbPath ?? join(opts.repoDir, ".youji", "threads.db");

  // Ensure .youji directory exists
  mkdirSync(join(opts.repoDir, ".youji"), { recursive: true });

  lock = new ConversationLock();
  store = new ThreadStore(dbPath);
  repoDir = opts.repoDir;

  bot = new SlackBot({
    botToken: opts.botToken,
    appToken: opts.appToken,
    onMessage: handleMessage,
    onReaction: async (event) => {
      console.log("[slack-bridge] Reaction:", event.reaction, "from", event.user);
    },
  });

  // Set up WorkerManager for director-triggered worker spawning
  const worktreeManager = new WorktreeManager({
    repoDir: opts.repoDir,
    maxWorktrees: 4,
  });

  // Recover stale worktrees from crashed sessions
  await worktreeManager.recover();

  workerManager = new WorkerManager({
    repoDir: opts.repoDir,
    worktreeManager,
    spawnAgent,
    enqueuePush: enqueuePushAndWait,
    readFile: (p) => readFileSync(p, "utf-8"),
    writeFile: (p, c) => writeFileSync(p, c, "utf-8"),
    onCompletion: handleWorkerCompletion,
  });

  await bot.start();
  console.log("[slack-bridge] Started — listening for DMs");
}

export async function stopSlackBridge(): Promise<void> {
  // Stop all active workers before tearing down
  if (workerManager) {
    for (const [project] of workerManager.getActiveWorkers()) {
      workerManager.stopProject(project);
    }
    workerManager = null;
  }

  if (bot) {
    await bot.stop();
    bot = null;
  }
  if (store) {
    store.close();
    store = null;
  }
  lock = null;
  console.log("[slack-bridge] Stopped");
}

/** Get the WorkerManager instance (null if bridge not started). */
export function getWorkerManager(): WorkerManager | null {
  return workerManager;
}

/** Get the SlackBot instance for sending proactive messages (null if bridge not started). */
export function getBot(): SlackBot | null {
  return bot;
}

// ── Worker completion handler ──────────────────────────────────────────────────

function handleWorkerCompletion(event: WorkerCompletionEvent): void {
  if (event.error) {
    notifyWorkerFailure(
      event.project,
      event.taskText,
      event.error,
      event.retried,
    ).catch((err) => console.error("[slack-bridge] Failed to notify worker failure:", err));
  } else if (event.result) {
    const summary = event.result.text.length > 500
      ? event.result.text.slice(0, 497) + "..."
      : event.result.text;
    notifyWorkerCompletion(
      event.project,
      event.taskText,
      summary,
      event.result.durationMs,
      event.result.costUsd,
      event.branch ?? "unknown",
    ).catch((err) => console.error("[slack-bridge] Failed to notify worker completion:", err));
  }
}

// ── Message handler ────────────────────────────────────────────────────────────

async function handleMessage(msg: SlackMessage, reply: ReplyFn): Promise<void> {
  if (!store || !lock) {
    console.error("[slack-bridge] Not initialized");
    return;
  }

  const convKey = deriveConvKey({ channel: msg.channel, thread_ts: msg.threadTs !== msg.ts ? msg.threadTs : undefined, ts: msg.ts });

  const release = await lock.acquire(convKey);
  try {
    // Ensure thread exists in store
    store.ensureThread(convKey, msg.channel, msg.threadTs);

    // Store user message
    store.addMessage(convKey, { role: "user", content: msg.text, slackTs: msg.ts });

    // Load conversation history
    const history = store.getMessages(convKey, { limit: 20 });

    // Director intelligence — Youji responds via Claude SDK session
    const response = await handleDirectorMessage({
      convKey,
      userMessage: msg.text,
      history,
      repoDir,
    });

    // Store assistant response
    store.addMessage(convKey, { role: "assistant", content: response });

    // Check for spawn-worker tag in director response
    const spawnMatch = response.match(/\[spawn-worker:\s*(\S+?)(?:\s+model=(\S+))?\]/);
    if (spawnMatch && workerManager) {
      const project = spawnMatch[1];
      const model = spawnMatch[2];
      workerManager.startProject(project, model ? { model } : undefined);
    }

    // Reply to user
    await reply(response);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("[slack-bridge] Error handling message:", errMsg);
    try {
      await reply(`Sorry, something went wrong: ${errMsg}`);
    } catch {
      // Reply itself failed — nothing more we can do
    }
    throw error;
  } finally {
    release();
  }
}
