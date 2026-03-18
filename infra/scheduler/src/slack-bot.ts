import { App, LogLevel } from "@slack/bolt";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SlackMessage {
  channel: string;
  user: string;
  text: string;
  ts: string;
  threadTs: string;
}

export type ReplyFn = (text: string) => Promise<void>;

export interface ReactionEvent {
  reaction: string;
  user: string;
  itemChannel: string;
  itemTs: string;
}

export interface SlackBotOptions {
  botToken: string;
  appToken: string;
  onMessage: (msg: SlackMessage, reply: ReplyFn) => Promise<void>;
  onReaction?: (event: ReactionEvent) => Promise<void>;
  logLevel?: LogLevel;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Derive a canonical conversation key from a Slack message.
 * Threaded messages share the parent thread_ts; top-level messages use their own ts.
 */
export function deriveConvKey(message: {
  channel: string;
  thread_ts?: string;
  ts: string;
}): string {
  return `${message.channel}:${message.thread_ts ?? message.ts}`;
}

// ── SlackBot ───────────────────────────────────────────────────────────────────

/**
 * Thin wrapper around @slack/bolt App for Socket Mode connection.
 * Receives DM messages and reactions, delegates processing to callbacks.
 */
export class SlackBot {
  private readonly app: App;

  constructor(opts: SlackBotOptions) {
    this.app = new App({
      token: opts.botToken,
      appToken: opts.appToken,
      socketMode: true,
      logLevel: opts.logLevel ?? LogLevel.WARN,
    });

    // ── Message handler ──────────────────────────────────────────────────
    this.app.message(async ({ message, say }) => {
      const msg = message as {
        channel: string;
        user: string;
        text?: string;
        ts: string;
        thread_ts?: string;
        channel_type?: string;
        subtype?: string;
      };

      // Guard: filter bot messages (subtype present)
      if (msg.subtype) return;

      // Guard: filter messages without text
      if (!("text" in msg) || !msg.text) return;

      // Guard: DMs only
      if (msg.channel_type !== "im") return;

      const threadTs = msg.thread_ts ?? msg.ts;

      const slackMessage: SlackMessage = {
        channel: msg.channel,
        user: msg.user,
        text: msg.text,
        ts: msg.ts,
        threadTs,
      };

      const replyFn: ReplyFn = async (text: string) => {
        await say({ text, thread_ts: threadTs });
      };

      await opts.onMessage(slackMessage, replyFn);
    });

    // ── Reaction handler ─────────────────────────────────────────────────
    this.app.event("reaction_added", async ({ event }) => {
      if (!opts.onReaction) return;

      const reactionEvent: ReactionEvent = {
        reaction: event.reaction,
        user: event.user,
        itemChannel: (event.item as { channel: string }).channel,
        itemTs: (event.item as { ts: string }).ts,
      };

      await opts.onReaction(reactionEvent);
    });

    // ── Error handler ────────────────────────────────────────────────────
    this.app.error(async (error) => {
      console.error("[slack-bot] Error:", error);
    });
  }

  async start(): Promise<void> {
    await this.app.start();
    console.log("[slack-bot] Connected via Socket Mode");
  }

  async stop(): Promise<void> {
    await this.app.stop();
    console.log("[slack-bot] Disconnected");
  }

  getApp(): App {
    return this.app;
  }
}
