/**
 * Slack integration — public API surface.
 *
 * When SLACK_BOT_TOKEN and SLACK_APP_TOKEN are both set, delegates to
 * slack-bridge.ts for real Socket Mode connection. Otherwise falls back
 * to no-op stubs so the scheduler runs without Slack.
 */

import { startSlackBridge, stopSlackBridge, getBot } from "./slack-bridge.js";

export type YoujiCommandInput = Record<string, unknown>;
export type YoujiCommandResult = {
  ok: boolean;
  response: string;
};

function hint(): void {
  // Keep logs short: this can be called in hot paths.
  // Intentionally not throwing: scheduler should run without Slack.
  console.log("[slack] Slack not configured. Set SLACK_BOT_TOKEN and SLACK_APP_TOKEN to enable.");
}

export function isConfigured(): boolean {
  return !!(process.env.SLACK_BOT_TOKEN && process.env.SLACK_APP_TOKEN);
}

export function setBotUserId(_id: string): void {
  // no-op
}

export async function startSlackBot(opts: { repoDir: string } & Record<string, unknown>): Promise<void> {
  if (!isConfigured()) {
    hint();
    return;
  }
  await startSlackBridge({
    botToken: process.env.SLACK_BOT_TOKEN!,
    appToken: process.env.SLACK_APP_TOKEN!,
    repoDir: opts.repoDir,
  });
}

export async function stopSlackBot(): Promise<void> {
  if (!isConfigured()) return;
  await stopSlackBridge();
}

export async function dm(text: string): Promise<string | undefined> {
  const slackBot = getBot();
  const userId = process.env.SLACK_USER_ID;
  if (!slackBot || !userId) return undefined;

  try {
    const app = slackBot.getApp();
    // Open a DM channel with the mentor
    const conv = await app.client.conversations.open({ users: userId });
    const channel = conv.channel?.id;
    if (!channel) return undefined;

    const result = await app.client.chat.postMessage({ channel, text });
    return result.ts;
  } catch (err) {
    console.error("[slack] dm failed:", err instanceof Error ? err.message : err);
    return undefined;
  }
}

export async function dmThread(threadTs: string, text: string): Promise<void> {
  const slackBot = getBot();
  const userId = process.env.SLACK_USER_ID;
  if (!slackBot || !userId) return;

  try {
    const app = slackBot.getApp();
    const conv = await app.client.conversations.open({ users: userId });
    const channel = conv.channel?.id;
    if (!channel) return;

    await app.client.chat.postMessage({ channel, text, thread_ts: threadTs });
  } catch (err) {
    console.error("[slack] dmThread failed:", err instanceof Error ? err.message : err);
  }
}

export async function dmBlocks(_blocksText: string): Promise<string | undefined> {
  // no-op
  return undefined;
}

export async function dmFiles(_files: unknown[], _text?: string): Promise<void> {
  // no-op
}

export async function dmThreadFiles(_threadTs: string, _files: unknown[], _text?: string): Promise<void> {
  // no-op
}

export async function channelFiles(_channel: string, _files: unknown[], _text?: string): Promise<void> {
  // no-op
}

export async function resolveDisplayName(userId: string): Promise<string> {
  return userId;
}

export async function resolveThreadUserNames<T extends { user?: string }>(messages: T[]): Promise<T[]> {
  return messages;
}

export function gracefulRestartMessage(_runningCount: number): string {
  return "Scheduler restart requested (Slack integration disabled in youji).";
}

export function startupMessage(): string {
  return "Scheduler started (Slack integration disabled in youji).";
}

export async function handleYoujiCommand(_input: YoujiCommandInput): Promise<YoujiCommandResult> {
  hint();
  return { ok: false, response: "Slack integration is reference-only in youji." };
}

export async function handleBotChannelJoin(): Promise<void> {
  // no-op
}

// ── Notifications (no-op) ────────────────────────────────────────────────────

export async function notifyBotStarted(..._args: unknown[]): Promise<void> {}
export async function notifySessionStarted(..._args: unknown[]): Promise<{ channel: string; threadTs: string } | null> { return null; }
export async function notifySessionComplete(..._args: unknown[]): Promise<void> {}
export async function notifyPendingApprovals(..._args: unknown[]): Promise<void> {}
export async function notifyBudgetBlocked(..._args: unknown[]): Promise<void> {}
export async function notifyEvolution(..._args: unknown[]): Promise<void> {}
export async function notifyGracefulRestart(..._args: unknown[]): Promise<void> {}

export async function notifyFleetCompletion(..._args: unknown[]): Promise<void> {}
export async function notifyFleetEscalation(..._args: unknown[]): Promise<void> {}
export async function notifyFleetDrain(..._args: unknown[]): Promise<void> {}
export async function notifyFleetStarvation(..._args: unknown[]): Promise<void> {}
export async function notifyFleetLowUtilization(..._args: unknown[]): Promise<void> {}
export async function notifyFleetStatus(..._args: unknown[]): Promise<void> {}

export async function notifyBudgetExceeded(
  project: string,
  usedMinutes: number,
  limitMinutes: number,
): Promise<void> {
  const hours = (usedMinutes / 60).toFixed(1);
  const limit = (limitMinutes / 60).toFixed(0);
  await dm(`:no_entry: *${project}* — Budget exceeded: ${hours}h / ${limit}h. Worker stopped.`);
}

export async function notifyWorkerCompletion(
  project: string,
  taskText: string,
  summary: string,
  durationMs: number,
  costUsd: number,
  diffRef: string,
): Promise<void> {
  const mins = (durationMs / 60_000).toFixed(1);
  const task = taskText.length > 80 ? taskText.slice(0, 77) + "..." : taskText;
  await dm(`:white_check_mark: *${project}* — Task done: ${task}\n_${mins}min, $${costUsd.toFixed(2)}, branch: ${diffRef}_\n${summary.slice(0, 200)}`);
}

export async function notifyWorkerFailure(
  project: string,
  taskText: string,
  error: string,
  retried: boolean,
): Promise<void> {
  const task = taskText.length > 80 ? taskText.slice(0, 77) + "..." : taskText;
  const retryNote = retried ? " (retried once)" : "";
  await dm(`:x: *${project}* — Task failed${retryNote}: ${task}\n_Error: ${error.slice(0, 200)}_`);
}

export function formatThreadMessages(): string {
  return "";
}
