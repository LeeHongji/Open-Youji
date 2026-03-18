import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @slack/bolt before importing slack-bot
const mockStart = vi.fn().mockResolvedValue(undefined);
const mockStop = vi.fn().mockResolvedValue(undefined);
const mockMessage = vi.fn();
const mockEvent = vi.fn();
const mockError = vi.fn();

vi.mock("@slack/bolt", () => ({
  App: vi.fn().mockImplementation(() => ({
    start: mockStart,
    stop: mockStop,
    message: mockMessage,
    event: mockEvent,
    error: mockError,
  })),
  LogLevel: {
    DEBUG: "debug",
    INFO: "info",
    WARN: "warn",
    ERROR: "error",
  },
}));

import { SlackBot, deriveConvKey } from "./slack-bot.js";
import type { SlackBotOptions, SlackMessage } from "./slack-bot.js";
import { App } from "@slack/bolt";

describe("deriveConvKey", () => {
  it("returns channel:thread_ts for threaded messages", () => {
    const key = deriveConvKey({ channel: "C123", thread_ts: "111.222", ts: "333.444" });
    expect(key).toBe("C123:111.222");
  });

  it("returns channel:ts for top-level messages", () => {
    const key = deriveConvKey({ channel: "C123", ts: "555.666" });
    expect(key).toBe("C123:555.666");
  });

  it("same thread produces same key", () => {
    const msg1 = { channel: "C123", thread_ts: "111.222", ts: "333.444" };
    const msg2 = { channel: "C123", thread_ts: "111.222", ts: "777.888" };
    expect(deriveConvKey(msg1)).toBe(deriveConvKey(msg2));
  });

  it("different channels produce different keys", () => {
    const msg1 = { channel: "C123", ts: "111.222" };
    const msg2 = { channel: "C456", ts: "111.222" };
    expect(deriveConvKey(msg1)).not.toBe(deriveConvKey(msg2));
  });

  it("new top-level messages produce unique keys", () => {
    const msg1 = { channel: "C123", ts: "111.222" };
    const msg2 = { channel: "C123", ts: "333.444" };
    expect(deriveConvKey(msg1)).not.toBe(deriveConvKey(msg2));
  });
});

describe("SlackBot", () => {
  let onMessage: ReturnType<typeof vi.fn>;
  let onReaction: ReturnType<typeof vi.fn>;
  let bot: SlackBot;

  beforeEach(() => {
    vi.clearAllMocks();
    onMessage = vi.fn().mockResolvedValue(undefined);
    onReaction = vi.fn().mockResolvedValue(undefined);
    bot = new SlackBot({
      botToken: "xoxb-test",
      appToken: "xapp-test",
      onMessage,
      onReaction,
    });
  });

  it("creates Bolt App with socketMode and correct tokens", () => {
    expect(App).toHaveBeenCalledWith(
      expect.objectContaining({
        token: "xoxb-test",
        appToken: "xapp-test",
        socketMode: true,
      }),
    );
  });

  it("registers message, event, and error handlers", () => {
    expect(mockMessage).toHaveBeenCalledOnce();
    expect(mockEvent).toHaveBeenCalledWith("reaction_added", expect.any(Function));
    expect(mockError).toHaveBeenCalledOnce();
  });

  describe("message handler", () => {
    function getMessageHandler(): (args: Record<string, unknown>) => Promise<void> {
      return mockMessage.mock.calls[0][0] as (args: Record<string, unknown>) => Promise<void>;
    }

    it("calls onMessage with correct SlackMessage for a normal DM", async () => {
      const handler = getMessageHandler();
      const say = vi.fn().mockResolvedValue(undefined);
      await handler({
        message: {
          type: "message",
          channel: "D123",
          user: "U456",
          text: "hello",
          ts: "100.200",
          channel_type: "im",
        },
        say,
      });

      expect(onMessage).toHaveBeenCalledWith(
        {
          channel: "D123",
          user: "U456",
          text: "hello",
          ts: "100.200",
          threadTs: "100.200",
        },
        expect.any(Function),
      );
    });

    it("calls onMessage with resolved threadTs for threaded message", async () => {
      const handler = getMessageHandler();
      const say = vi.fn().mockResolvedValue(undefined);
      await handler({
        message: {
          type: "message",
          channel: "D123",
          user: "U456",
          text: "reply",
          ts: "300.400",
          thread_ts: "100.200",
          channel_type: "im",
        },
        say,
      });

      expect(onMessage).toHaveBeenCalledWith(
        expect.objectContaining({ threadTs: "100.200" }),
        expect.any(Function),
      );
    });

    it("filters out messages with subtype (bot messages)", async () => {
      const handler = getMessageHandler();
      const say = vi.fn();
      await handler({
        message: {
          type: "message",
          channel: "D123",
          user: "U456",
          text: "bot msg",
          ts: "100.200",
          subtype: "bot_message",
          channel_type: "im",
        },
        say,
      });

      expect(onMessage).not.toHaveBeenCalled();
    });

    it("filters out messages without text field", async () => {
      const handler = getMessageHandler();
      const say = vi.fn();
      await handler({
        message: {
          type: "message",
          channel: "D123",
          user: "U456",
          ts: "100.200",
          channel_type: "im",
        },
        say,
      });

      expect(onMessage).not.toHaveBeenCalled();
    });

    it("filters out non-DM messages (channel_type !== 'im')", async () => {
      const handler = getMessageHandler();
      const say = vi.fn();
      await handler({
        message: {
          type: "message",
          channel: "C123",
          user: "U456",
          text: "channel msg",
          ts: "100.200",
          channel_type: "channel",
        },
        say,
      });

      expect(onMessage).not.toHaveBeenCalled();
    });
  });

  describe("reply function", () => {
    it("calls say with thread_ts set for threaded replies", async () => {
      const handler = mockMessage.mock.calls[0][0] as (args: Record<string, unknown>) => Promise<void>;
      const say = vi.fn().mockResolvedValue(undefined);
      await handler({
        message: {
          type: "message",
          channel: "D123",
          user: "U456",
          text: "hello",
          ts: "100.200",
          channel_type: "im",
        },
        say,
      });

      // Get the reply function passed to onMessage and call it
      const replyFn = onMessage.mock.calls[0][1] as (text: string) => Promise<void>;
      await replyFn("response text");

      expect(say).toHaveBeenCalledWith({
        text: "response text",
        thread_ts: "100.200",
      });
    });
  });

  describe("reaction handler", () => {
    it("calls onReaction with normalized event", async () => {
      const reactionHandler = mockEvent.mock.calls[0][1] as (args: Record<string, unknown>) => Promise<void>;
      await reactionHandler({
        event: {
          reaction: "thumbsup",
          user: "U789",
          item: {
            channel: "D123",
            ts: "100.200",
          },
        },
      });

      expect(onReaction).toHaveBeenCalledWith({
        reaction: "thumbsup",
        user: "U789",
        itemChannel: "D123",
        itemTs: "100.200",
      });
    });
  });

  describe("error handler", () => {
    it("logs error without throwing", async () => {
      const errorHandler = mockError.mock.calls[0][0] as (error: Error) => Promise<void>;
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      // Should not throw
      await expect(errorHandler(new Error("test error"))).resolves.toBeUndefined();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe("start", () => {
    it("calls app.start()", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      await bot.start();
      expect(mockStart).toHaveBeenCalledOnce();
      consoleSpy.mockRestore();
    });
  });

  describe("stop", () => {
    it("calls app.stop()", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      await bot.stop();
      expect(mockStop).toHaveBeenCalledOnce();
      consoleSpy.mockRestore();
    });
  });

  describe("getApp", () => {
    it("returns the internal Bolt App instance", () => {
      const app = bot.getApp();
      expect(app).toBeDefined();
      expect(app.start).toBe(mockStart);
    });
  });
});
