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

// ── Mock director ───────────────────────────────────────────────────────────────

const mockHandleDirectorMessage = vi.fn(async () => "Director response");

vi.mock("./director.js", () => ({
  handleDirectorMessage: (...args: unknown[]) => mockHandleDirectorMessage(...args),
}));

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
    mockHandleDirectorMessage.mockClear();
    mockHandleDirectorMessage.mockResolvedValue("Director response");
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

    vi.doMock("./director.js", () => ({
      handleDirectorMessage: (...args: unknown[]) => mockHandleDirectorMessage(...args),
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

  it("calls handleDirectorMessage and replies with its response", async () => {
    mockHandleDirectorMessage.mockResolvedValue("Youji says hello");

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

    expect(reply).toHaveBeenCalledOnce();
    expect(reply.mock.calls[0][0]).toBe("Youji says hello");
    expect(mockHandleDirectorMessage).toHaveBeenCalledOnce();
  });

  it("passes correct opts to handleDirectorMessage", async () => {
    await startSlackBridge({
      botToken: "xoxb-test",
      appToken: "xapp-test",
      repoDir: tmpDir,
    });

    const reply = vi.fn(async (_text: string) => {});
    await capturedOnMessage!(
      { channel: "C123", user: "U456", text: "Test message", ts: "1.0", threadTs: "1.0" },
      reply,
    );

    const callArgs = mockHandleDirectorMessage.mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs.convKey).toBe("C123:1.0");
    expect(callArgs.userMessage).toBe("Test message");
    expect(callArgs.repoDir).toBe(tmpDir);
    expect(Array.isArray(callArgs.history)).toBe(true);
  });

  it("stores user message and director response in ThreadStore", async () => {
    mockHandleDirectorMessage.mockResolvedValue("Director stored response");

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

    // Check ThreadStore has both user and assistant messages
    const { ThreadStore } = await import("./thread-store.js");
    const store = new ThreadStore(join(tmpDir, ".youji", "threads.db"));
    const messages = store.getMessages("C123:1234.5678");
    store.close();

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toBe("Hello");
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].content).toBe("Director stored response");
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

  it("releases lock and replies with error on director failure", async () => {
    mockHandleDirectorMessage.mockRejectedValueOnce(new Error("Director error"));

    await startSlackBridge({
      botToken: "xoxb-test",
      appToken: "xapp-test",
      repoDir: tmpDir,
    });

    const reply = vi.fn(async (_text: string) => {});

    // This should throw but still release the lock
    await expect(
      capturedOnMessage!(
        { channel: "C123", user: "U456", text: "Fail", ts: "5.0", threadTs: "5.0" },
        reply,
      ),
    ).rejects.toThrow("Director error");

    // Error reply should have been sent
    expect(reply).toHaveBeenCalledOnce();
    expect(reply.mock.calls[0][0]).toContain("Director error");

    // Verify lock is released by sending another message successfully
    mockHandleDirectorMessage.mockResolvedValue("Recovery response");
    const okReply = vi.fn(async (_text: string) => {});
    await capturedOnMessage!(
      { channel: "C123", user: "U456", text: "OK", ts: "6.0", threadTs: "5.0" },
      okReply,
    );
    expect(okReply).toHaveBeenCalledOnce();
  });
});
