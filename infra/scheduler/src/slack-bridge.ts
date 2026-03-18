import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { SlackBot, deriveConvKey } from "./slack-bot.js";
import { ThreadStore } from "./thread-store.js";
import { ConversationLock } from "./thread-mutex.js";

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

// ── Public API ─────────────────────────────────────────────────────────────────

export async function startSlackBridge(opts: SlackBridgeOptions): Promise<void> {
  const dbPath = opts.dbPath ?? join(opts.repoDir, ".youji", "threads.db");

  // Ensure .youji directory exists
  mkdirSync(join(opts.repoDir, ".youji"), { recursive: true });

  lock = new ConversationLock();
  store = new ThreadStore(dbPath);

  bot = new SlackBot({
    botToken: opts.botToken,
    appToken: opts.appToken,
    onMessage: handleMessage,
    onReaction: async (event) => {
      console.log("[slack-bridge] Reaction:", event.reaction, "from", event.user);
    },
  });

  await bot.start();
  console.log("[slack-bridge] Started — listening for DMs");
}

export async function stopSlackBridge(): Promise<void> {
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

    // Phase 2 stub response — director intelligence is Phase 3
    const response = `Got it. (${history.length} messages in this thread)`;

    // Store assistant response
    store.addMessage(convKey, { role: "assistant", content: response });

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
