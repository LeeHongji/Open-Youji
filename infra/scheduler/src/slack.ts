/**
 * Slack integration — public API surface.
 *
 * When SLACK_BOT_TOKEN and SLACK_APP_TOKEN are both set, delegates to
 * slack-bridge.ts for real Socket Mode connection. Otherwise falls back
 * to no-op stubs so the scheduler runs without Slack.
 */

import { startSlackBridge, stopSlackBridge } from "./slack-bridge.js";

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

export async function dm(_text: string): Promise<string | undefined> {
  // no-op
  return undefined;
}

export async function dmThread(_threadTs: string, _text: string): Promise<void> {
  // no-op
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

export async function notifyBotStarted(): Promise<void> {}
export async function notifySessionStarted(): Promise<void> {}
export async function notifySessionComplete(): Promise<void> {}
export async function notifyPendingApprovals(): Promise<void> {}
export async function notifyBudgetBlocked(): Promise<void> {}
export async function notifyEvolution(): Promise<void> {}
export async function notifyGracefulRestart(): Promise<void> {}

export async function notifyFleetCompletion(): Promise<void> {}
export async function notifyFleetEscalation(): Promise<void> {}
export async function notifyFleetDrain(): Promise<void> {}
export async function notifyFleetStarvation(): Promise<void> {}
export async function notifyFleetLowUtilization(): Promise<void> {}
export async function notifyFleetStatus(): Promise<void> {}

export async function notifyBudgetExceeded(
  _project: string,
  _usedMinutes: number,
  _limitMinutes: number,
): Promise<void> {
  // no-op — real implementation wired when Slack is configured
}

export async function notifyWorkerCompletion(
  _project: string,
  _taskText: string,
  _summary: string,
  _durationMs: number,
  _costUsd: number,
  _diffRef: string,
): Promise<void> {
  // no-op — real implementation wired when Slack is configured
}

export async function notifyWorkerFailure(
  _project: string,
  _taskText: string,
  _error: string,
  _retried: boolean,
): Promise<void> {
  // no-op
}

export function formatThreadMessages(): string {
  return "";
}
