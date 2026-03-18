import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import type { SlackMessage, ReplyFn, SlackBotOptions } from "./slack-bot.js";

// ── Mock @slack/bolt ────────────────────────────────────────────────────────────

let capturedOnMessage: ((msg: SlackMessage, reply: ReplyFn) => Promise<void>) | null = null;
const mockStart = vi.fn(async () => {});
const mockStop = vi.fn(async () => {});

vi.mock("./slack-bot.js", () => {
  return {
    SlackBot: vi.fn(function (this: unknown, opts: SlackBotOptions) {
      capturedOnMessage = opts.onMessage;
      return { start: mockStart, stop: mockStop };
    }),
    deriveConvKey: (msg: { channel: string; thread_ts?: string; ts: string }) =>
      `${msg.channel}:${msg.thread_ts ?? msg.ts}`,
  };
});

// ── Tests ───────────────────────────────────────────────────────────────────────

describe("slack-bridge", () => {
  let tmpDir: string;
  let startSlackBridge: typeof import("./slack-bridge.js").startSlackBridge;
  let stopSlackBridge: typeof import("./slack-bridge.js").stopSlackBridge;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "slack-bridge-test-"));
    capturedOnMessage = null;
    mockStart.mockClear();
    mockStop.mockClear();
    vi.resetModules();

    // Re-mock after resetModules
    vi.doMock("./slack-bot.js", () => ({
      SlackBot: vi.fn(function (this: unknown, opts: SlackBotOptions) {
        capturedOnMessage = opts.onMessage;
        return { start: mockStart, stop: mockStop };
      }),
      deriveConvKey: (msg: { channel: string; thread_ts?: string; ts: string }) =>
        `${msg.channel}:${msg.thread_ts ?? msg.ts}`,
    }));

    const mod = await import("./slack-bridge.js");
    startSlackBridge = mod.startSlackBridge;
    stopSlackBridge = mod.stopSlackBridge;
  });

  afterEach(async () => {
    try {
      await stopSlackBridge();
    } catch {
      // already stopped
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Lifecycle ─────────────────────────────────────────────────────────

  it("startSlackBridge creates bot and starts it", async () => {
    await startSlackBridge({
      botToken: "xoxb-test",
      appToken: "xapp-test",
      repoDir: tmpDir,
    });

    expect(mockStart).toHaveBeenCalledOnce();
    expect(capturedOnMessage).toBeTypeOf("function");
  });

  it("stopSlackBridge cleans up resources", async () => {
    await startSlackBridge({
      botToken: "xoxb-test",
      appToken: "xapp-test",
      repoDir: tmpDir,
    });
    await stopSlackBridge();

    expect(mockStop).toHaveBeenCalledOnce();
  });

  it("creates .youji directory and threads.db", async () => {
    const { existsSync } = await import("node:fs");

    await startSlackBridge({
      botToken: "xoxb-test",
      appToken: "xapp-test",
      repoDir: tmpDir,
    });

    expect(existsSync(join(tmpDir, ".youji"))).toBe(true);
    expect(existsSync(join(tmpDir, ".youji", "threads.db"))).toBe(true);
  });

  // ── Message handling ──────────────────────────────────────────────────

  it("stores user message and assistant response", async () => {
    await startSlackBridge({
      botToken: "xoxb-test",
      appToken: "xapp-test",
      repoDir: tmpDir,
    });

    const reply = vi.fn(async (_text: string) => {});
    await capturedOnMessage!(
      { channel: "C123", user: "U456", text: "Hello", ts: "1234.5678", threadTs: "1234.5678" },
      reply,
    );

    // Verify reply was called with stub response
    expect(reply).toHaveBeenCalledOnce();
    expect(reply.mock.calls[0][0]).toContain("Got it.");

    // Check ThreadStore has both user and assistant messages
    const { ThreadStore } = await import("./thread-store.js");
    const store = new ThreadStore(join(tmpDir, ".youji", "threads.db"));
    const messages = store.getMessages("C123:1234.5678");
    store.close();

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toBe("Hello");
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].content).toContain("Got it.");
  });

  it("loads history and includes message count in response", async () => {
    await startSlackBridge({
      botToken: "xoxb-test",
      appToken: "xapp-test",
      repoDir: tmpDir,
    });

    const reply = vi.fn(async (_text: string) => {});

    // Send first message
    await capturedOnMessage!(
      { channel: "C123", user: "U456", text: "First", ts: "1.0", threadTs: "1.0" },
      reply,
    );
    // After first: 1 user + 1 assistant = 2 messages, but history is loaded AFTER adding user msg
    expect(reply.mock.calls[0][0]).toContain("1 messages");

    // Send second message in same thread
    await capturedOnMessage!(
      { channel: "C123", user: "U456", text: "Second", ts: "2.0", threadTs: "1.0" },
      reply,
    );
    // Now: 2 user + 1 assistant + 1 new user = 3 at time of getMessages
    expect(reply.mock.calls[1][0]).toContain("3 messages");
  });

  // ── Concurrency ───────────────────────────────────────────────────────

  it("serializes concurrent messages in the same thread", async () => {
    await startSlackBridge({
      botToken: "xoxb-test",
      appToken: "xapp-test",
      repoDir: tmpDir,
    });

    const order: string[] = [];
    const slowReply = vi.fn(async (_text: string) => {
      order.push("reply-start");
      await new Promise((r) => setTimeout(r, 50));
      order.push("reply-end");
    });

    // Fire two concurrent messages in the same thread
    const p1 = capturedOnMessage!(
      { channel: "C123", user: "U456", text: "Msg1", ts: "3.0", threadTs: "1.0" },
      slowReply,
    );
    const p2 = capturedOnMessage!(
      { channel: "C123", user: "U456", text: "Msg2", ts: "4.0", threadTs: "1.0" },
      slowReply,
    );

    await Promise.all([p1, p2]);

    // Should be serialized: reply-start, reply-end, reply-start, reply-end
    expect(order).toEqual(["reply-start", "reply-end", "reply-start", "reply-end"]);
  });

  // ── Error handling ────────────────────────────────────────────────────

  it("releases lock and replies with error on failure", async () => {
    await startSlackBridge({
      botToken: "xoxb-test",
      appToken: "xapp-test",
      repoDir: tmpDir,
    });

    // First, cause an error by sending a message, then send another
    // to verify the lock was released
    const errorReply = vi.fn(async (_text: string) => {
      throw new Error("Reply network error");
    });

    // This should throw but still release the lock
    await expect(
      capturedOnMessage!(
        { channel: "C123", user: "U456", text: "Fail", ts: "5.0", threadTs: "5.0" },
        errorReply,
      ),
    ).rejects.toThrow();

    // Verify lock is released by sending another message successfully
    const okReply = vi.fn(async (_text: string) => {});
    await capturedOnMessage!(
      { channel: "C123", user: "U456", text: "OK", ts: "6.0", threadTs: "5.0" },
      okReply,
    );
    expect(okReply).toHaveBeenCalledOnce();
  });
});
