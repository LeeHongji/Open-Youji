/** Tests for slack module — formatThreadMessages, notification helpers, /youji command handler,
 *  display name resolution, and thread mode integration. */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatThreadMessages, gracefulRestartMessage, startupMessage, handleYoujiCommand, resolveDisplayName, handleBotChannelJoin, setBotUserId, resolveThreadUserNames } from "./slack.js";
import { initChannelModes, setChannelModesPath, getChannelMode } from "./channel-mode.js";
import { getMaxTurns, clearAllThreadTurns } from "./thread-turns.js";
import { getThreadMode, setThreadMode, isThreadActive, parseThreadModeCommand, clearAllThreadModes } from "./thread-mode.js";
import { setBackendPreferencePath, getBackendPreference, initBackendPreference } from "./backend-preference.js";

describe("formatThreadMessages", () => {
  const humanUserId = "U_HUMAN";
  const botUserId = "U_BOT";

  it("labels human messages as User and bot messages as Bot", () => {
    const messages = [
      { ts: "1700000000.000000", user: humanUserId, text: "Hello" },
      { ts: "1700000001.000000", user: botUserId, bot_id: "B123", text: "Hi there" },
    ];
    const result = formatThreadMessages(messages, humanUserId);
    expect(result).toContain("User: Hello");
    expect(result).toContain("Bot: Hi there");
  });

  it("labels unknown non-bot users as User (safe default)", () => {
    const messages = [
      { ts: "1700000000.000000", user: "U_STRANGER", text: "Who am I?" },
    ];
    const result = formatThreadMessages(messages, humanUserId);
    expect(result).toContain("User: Who am I?");
  });

  it("regression: does not label human messages as Bot when humanUserId is passed", () => {
    // Before the fix, the parameter was named botUserId and the comparison was !==,
    // causing human messages (matching the passed ID) to be labeled "Bot:".
    const messages = [
      { ts: "1700000000.000000", user: humanUserId, text: "Am I the user?" },
      { ts: "1700000001.000000", user: botUserId, bot_id: "B123", text: "Yes you are" },
    ];
    const result = formatThreadMessages(messages, humanUserId);
    const lines = result.split("\n");
    expect(lines[0]).toMatch(/User: Am I the user\?/);
    expect(lines[1]).toMatch(/Bot: Yes you are/);
  });

  it("skips empty messages", () => {
    const messages = [
      { ts: "1700000000.000000", user: humanUserId, text: "" },
      { ts: "1700000001.000000", user: humanUserId, text: "  " },
      { ts: "1700000002.000000", user: humanUserId, text: "Real message" },
    ];
    const result = formatThreadMessages(messages, humanUserId);
    expect(result).toBe("[22:13:22] User: Real message");
  });

  it("truncates long messages to 1000 chars", () => {
    const longText = "x".repeat(1500);
    const messages = [
      { ts: "1700000000.000000", user: humanUserId, text: longText },
    ];
    const result = formatThreadMessages(messages, humanUserId);
    expect(result).toContain("x".repeat(1000) + "...");
    expect(result).not.toContain("x".repeat(1001));
  });

  it("formats timestamps correctly", () => {
    // 1700000000 = 2023-11-14T22:13:20Z
    const messages = [
      { ts: "1700000000.000000", user: humanUserId, text: "Hello" },
    ];
    const result = formatThreadMessages(messages, humanUserId);
    expect(result).toMatch(/^\[22:13:20\] User: Hello$/);
  });

  it("uses ??:?? for missing timestamps", () => {
    const messages = [
      { user: humanUserId, text: "No timestamp" },
    ];
    const result = formatThreadMessages(messages, humanUserId);
    expect(result).toContain("[??:??]");
  });

  it("works without humanUserId — non-bot messages labeled User, bot messages labeled Bot", () => {
    const messages = [
      { ts: "1700000000.000000", user: humanUserId, text: "Hello" },
      { ts: "1700000001.000000", user: botUserId, bot_id: "B123", text: "Hi" },
    ];
    const result = formatThreadMessages(messages);
    expect(result).toContain("User: Hello");
    expect(result).toContain("Bot: Hi");
  });

  it("uses display names from userNames map for non-bot users", () => {
    const userNames = new Map([
      ["U_ALICE", "Alice"],
      ["U_BOB", "Bob"],
    ]);
    const messages = [
      { ts: "1700000000.000000", user: "U_ALICE", text: "What's the status?" },
      { ts: "1700000001.000000", user: "U_BOB", text: "I was wondering too" },
      { ts: "1700000002.000000", user: "U_BOT", bot_id: "B123", text: "Here's the status" },
    ];
    const result = formatThreadMessages(messages, humanUserId, userNames);
    expect(result).toContain("Alice: What's the status?");
    expect(result).toContain("Bob: I was wondering too");
    expect(result).toContain("Bot: Here's the status");
  });

  it("falls back to User for users not in userNames map", () => {
    const userNames = new Map([["U_ALICE", "Alice"]]);
    const messages = [
      { ts: "1700000000.000000", user: "U_ALICE", text: "Hello" },
      { ts: "1700000001.000000", user: "U_UNKNOWN", text: "Hi" },
    ];
    const result = formatThreadMessages(messages, humanUserId, userNames);
    expect(result).toContain("Alice: Hello");
    expect(result).toContain("User: Hi");
  });

  it("uses userNames even for the humanUserId when name is available", () => {
    const userNames = new Map([[humanUserId, "TheHuman"]]);
    const messages = [
      { ts: "1700000000.000000", user: humanUserId, text: "Hello" },
    ];
    const result = formatThreadMessages(messages, humanUserId, userNames);
    expect(result).toContain("TheHuman: Hello");
  });

  it("works with empty userNames map — falls back to User/Bot", () => {
    const userNames = new Map<string, string>();
    const messages = [
      { ts: "1700000000.000000", user: humanUserId, text: "Hello" },
      { ts: "1700000001.000000", user: "U_BOT", bot_id: "B123", text: "Hi" },
    ];
    const result = formatThreadMessages(messages, humanUserId, userNames);
    expect(result).toContain("User: Hello");
    expect(result).toContain("Bot: Hi");
  });
});

describe("resolveDisplayName", () => {
  it("prefers profile.display_name over real_name", () => {
    const user = {
      real_name: "John Alexander Smith",
      name: "jsmith",
      profile: { display_name: "John" },
    };
    expect(resolveDisplayName(user)).toBe("John");
  });

  it("falls back to real_name when display_name is empty string", () => {
    const user = {
      real_name: "John Smith",
      name: "jsmith",
      profile: { display_name: "" },
    };
    expect(resolveDisplayName(user)).toBe("John Smith");
  });

  it("falls back to real_name when profile is missing", () => {
    const user = {
      real_name: "Jane Doe",
      name: "jdoe",
    };
    expect(resolveDisplayName(user)).toBe("Jane Doe");
  });

  it("falls back to name when both display_name and real_name are missing", () => {
    const user = {
      name: "botuser",
    };
    expect(resolveDisplayName(user)).toBe("botuser");
  });

  it("returns undefined when no name fields are present", () => {
    expect(resolveDisplayName({})).toBeUndefined();
    expect(resolveDisplayName(undefined)).toBeUndefined();
  });

  it("ignores whitespace-only display_name", () => {
    const user = {
      real_name: "Actual Name",
      profile: { display_name: "   " },
    };
    expect(resolveDisplayName(user)).toBe("Actual Name");
  });
});

describe("resolveThreadUserNames", () => {
  it("resolves unique user IDs from messages", async () => {
    const mockClient = {
      users: {
        info: async ({ user }: { user: string }) => {
          const users: Record<string, unknown> = {
            "U_A": { real_name: "Alice", profile: { display_name: "alice" } },
            "U_B": { real_name: "Bob", profile: { display_name: "" } },
          };
          return { user: users[user] };
        },
      },
    };

    const messages = [
      { user: "U_A", text: "hi" },
      { user: "U_B", text: "hello" },
      { user: "U_A", text: "again" },
      { user: "U_BOT", bot_id: "B123", text: "response" },
    ];

    const names = await resolveThreadUserNames(messages, mockClient);
    expect(names.size).toBe(2);
    expect(names.get("U_A")).toBe("alice");
    expect(names.get("U_B")).toBe("Bob");
    expect(names.has("U_BOT")).toBe(false);
  });

  it("skips users whose lookup fails", async () => {
    const mockClient = {
      users: {
        info: async ({ user }: { user: string }) => {
          if (user === "U_FAIL") throw new Error("not found");
          return { user: { real_name: "Good User" } };
        },
      },
    };

    const messages = [
      { user: "U_OK", text: "hi" },
      { user: "U_FAIL", text: "hello" },
    ];

    const names = await resolveThreadUserNames(messages, mockClient);
    expect(names.size).toBe(1);
    expect(names.get("U_OK")).toBe("Good User");
    expect(names.has("U_FAIL")).toBe(false);
  });

  it("returns empty map for all-bot messages", async () => {
    const mockClient = {
      users: { info: async () => ({ user: { real_name: "Test" } }) },
    };

    const messages = [
      { user: "U_BOT", bot_id: "B1", text: "hello" },
      { user: "U_BOT2", bot_id: "B2", text: "world" },
    ];

    const names = await resolveThreadUserNames(messages, mockClient);
    expect(names.size).toBe(0);
  });
});

describe("gracefulRestartMessage", () => {
  it("mentions draining when sessions are running", () => {
    const msg = gracefulRestartMessage(3);
    expect(msg).toContain("Graceful restart");
    expect(msg).toContain("3 running session(s)");
  });

  it("says no sessions when count is zero", () => {
    const msg = gracefulRestartMessage(0);
    expect(msg).toContain("Graceful restart");
    expect(msg).toContain("No sessions running");
  });

  it("handles singular session", () => {
    const msg = gracefulRestartMessage(1);
    expect(msg).toContain("1 running session(s)");
  });

  it("includes backend when provided", () => {
    const msg = gracefulRestartMessage(0, "cursor");
    expect(msg).toContain("cursor");
    expect(msg).toContain("Graceful restart");
  });

  it("includes auto backend with label", () => {
    const msg = gracefulRestartMessage(2, "auto");
    expect(msg).toContain("auto");
    expect(msg).toContain("2 running session(s)");
  });

  it("works without backend (backward compatible)", () => {
    const msg = gracefulRestartMessage(0);
    expect(msg).toContain("Graceful restart");
    expect(msg).not.toContain("undefined");
  });
});

describe("startupMessage", () => {
  it("includes job count and backend", () => {
    const msg = startupMessage({ totalJobs: 5, enabledJobs: 3, nextRun: "2026-02-22T10:00:00Z", backend: "claude" });
    expect(msg).toContain("5 total");
    expect(msg).toContain("3 enabled");
    expect(msg).toContain("claude");
    expect(msg).toContain("2026-02-22T10:00:00Z");
  });

  it("includes auto backend", () => {
    const msg = startupMessage({ totalJobs: 1, enabledJobs: 1, nextRun: "none", backend: "auto" });
    expect(msg).toContain("auto");
  });

  it("includes cursor backend", () => {
    const msg = startupMessage({ totalJobs: 0, enabledJobs: 0, nextRun: "none", backend: "cursor" });
    expect(msg).toContain("cursor");
  });
});

describe("handleYoujiCommand", () => {
  const OPERATOR = "U_OPERATOR";
  const OTHER_USER = "U_OTHER";
  let tmpDir: string;
  const originalEnv = { ...process.env };

beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "youji-cmd-test-"));
    setChannelModesPath(join(tmpDir, "channel-modes.json"));
    setBackendPreferencePath(join(tmpDir, "backend-preference.json"));
    process.env["SLACK_USER_ID"] = OPERATOR;
    delete process.env["SLACK_DEV_CHANNELS"];
    delete process.env["SLACK_CHAT_CHANNELS"];
    delete process.env["AGENT_BACKEND"];
    initChannelModes();
    initBackendPreference();
  });

  afterEach(async () => {
    setChannelModesPath(null);
    setBackendPreferencePath(null);
    clearAllThreadTurns();
    process.env = { ...originalEnv };
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("shows help when no subcommand is given", async () => {
    const result = await handleYoujiCommand({ text: "", userId: OPERATOR, channelId: "C001" });
    expect(result.text).toContain("/youji");
    expect(result.text).toContain("mode dev");
    expect(result.text).toContain("mode chat");
  });

  it("shows help for 'help' subcommand", async () => {
    const result = await handleYoujiCommand({ text: "help", userId: OPERATOR, channelId: "C001" });
    expect(result.text).toContain("/youji");
  });

  it("sets channel to dev mode", async () => {
    const result = await handleYoujiCommand({ text: "mode dev", userId: OPERATOR, channelId: "C001" });
    expect(result.text).toContain("dev");
    expect(result.text).toContain("full access");
    expect(getChannelMode("C001")).toBe("dev");
  });

  it("sets channel to chat mode", async () => {
    const result = await handleYoujiCommand({ text: "mode chat", userId: OPERATOR, channelId: "C002" });
    expect(result.text).toContain("chat");
    expect(result.text).toContain("read-only");
    expect(getChannelMode("C002")).toBe("chat");
  });

  it("removes channel mode with 'off'", async () => {
    await handleYoujiCommand({ text: "mode dev", userId: OPERATOR, channelId: "C003" });
    expect(getChannelMode("C003")).toBe("dev");

    const result = await handleYoujiCommand({ text: "mode off", userId: OPERATOR, channelId: "C003" });
    expect(result.text).toContain("removed");
    expect(getChannelMode("C003")).toBeNull();
  });

  it("reports nothing to remove for unconfigured channel", async () => {
    const result = await handleYoujiCommand({ text: "mode off", userId: OPERATOR, channelId: "C999" });
    expect(result.text).toContain("not configured");
  });

  it("rejects mode changes from non-designated users", async () => {
    const result = await handleYoujiCommand({ text: "mode dev", userId: OTHER_USER, channelId: "C001" });
    expect(result.text).toContain("Only the designated");
    expect(getChannelMode("C001")).toBeNull();
  });

  it("rejects invalid mode", async () => {
    const result = await handleYoujiCommand({ text: "mode banana", userId: OPERATOR, channelId: "C001" });
    expect(result.text).toContain("Unknown mode");
    expect(result.text).toContain("banana");
  });

  it("shows status for unconfigured channel", async () => {
    const result = await handleYoujiCommand({ text: "status", userId: OTHER_USER, channelId: "C001" });
    expect(result.text).toContain("no mode configured");
  });

  it("shows status for configured channel", async () => {
    await handleYoujiCommand({ text: "mode chat", userId: OPERATOR, channelId: "C001" });
    const result = await handleYoujiCommand({ text: "status", userId: OTHER_USER, channelId: "C001" });
    expect(result.text).toContain("chat");
  });

  it("allows any user to check status", async () => {
    await handleYoujiCommand({ text: "mode dev", userId: OPERATOR, channelId: "C001" });
    const result = await handleYoujiCommand({ text: "status", userId: OTHER_USER, channelId: "C001" });
    expect(result.text).toContain("dev");
  });

  it("rejects unknown subcommand", async () => {
    const result = await handleYoujiCommand({ text: "frobnicate", userId: OPERATOR, channelId: "C001" });
    expect(result.text).toContain("Unknown command");
    expect(result.text).toContain("frobnicate");
  });

  it("handles extra whitespace in input", async () => {
    const result = await handleYoujiCommand({ text: "  mode   dev  ", userId: OPERATOR, channelId: "C001" });
    expect(result.text).toContain("dev");
    expect(getChannelMode("C001")).toBe("dev");
  });

  it("is case-insensitive for subcommands", async () => {
    const result = await handleYoujiCommand({ text: "MODE DEV", userId: OPERATOR, channelId: "C001" });
    expect(result.text).toContain("dev");
    expect(getChannelMode("C001")).toBe("dev");
  });

  it("handles 'mode remove' as alias for 'mode off'", async () => {
    await handleYoujiCommand({ text: "mode dev", userId: OPERATOR, channelId: "C001" });
    const result = await handleYoujiCommand({ text: "mode remove", userId: OPERATOR, channelId: "C001" });
    expect(result.text).toContain("removed");
    expect(getChannelMode("C001")).toBeNull();
  });

  // max-turns subcommand tests

  it("sets max-turns limit for a channel", async () => {
    const result = await handleYoujiCommand({ text: "max-turns 10", userId: OPERATOR, channelId: "C001" });
    expect(result.text).toContain("10");
    expect(result.text).toContain("Turn limit set");
    expect(getMaxTurns("C001")).toBe(10);
  });

  it("shows current max-turns when no value given", async () => {
    await handleYoujiCommand({ text: "max-turns 5", userId: OPERATOR, channelId: "C001" });
    const result = await handleYoujiCommand({ text: "max-turns", userId: OPERATOR, channelId: "C001" });
    expect(result.text).toContain("5-turn");
  });

  it("shows 'no limit' when querying without a limit set", async () => {
    const result = await handleYoujiCommand({ text: "max-turns", userId: OPERATOR, channelId: "C001" });
    expect(result.text).toContain("No turn limit");
  });

  it("removes max-turns with 'off'", async () => {
    await handleYoujiCommand({ text: "max-turns 10", userId: OPERATOR, channelId: "C001" });
    const result = await handleYoujiCommand({ text: "max-turns off", userId: OPERATOR, channelId: "C001" });
    expect(result.text).toContain("removed");
    expect(getMaxTurns("C001")).toBeNull();
  });

  it("reports nothing to remove when no limit exists", async () => {
    const result = await handleYoujiCommand({ text: "max-turns off", userId: OPERATOR, channelId: "C001" });
    expect(result.text).toContain("No turn limit was set");
  });

  it("rejects max-turns from non-designated users", async () => {
    const result = await handleYoujiCommand({ text: "max-turns 10", userId: OTHER_USER, channelId: "C001" });
    expect(result.text).toContain("Only the designated");
    expect(getMaxTurns("C001")).toBeNull();
  });

  it("rejects invalid max-turns value", async () => {
    const result = await handleYoujiCommand({ text: "max-turns banana", userId: OPERATOR, channelId: "C001" });
    expect(result.text).toContain("Invalid");
    expect(getMaxTurns("C001")).toBeNull();
  });

  it("rejects zero as max-turns value", async () => {
    const result = await handleYoujiCommand({ text: "max-turns 0", userId: OPERATOR, channelId: "C001" });
    expect(result.text).toContain("Invalid");
  });

  it("rejects negative max-turns value", async () => {
    const result = await handleYoujiCommand({ text: "max-turns -5", userId: OPERATOR, channelId: "C001" });
    expect(result.text).toContain("Invalid");
  });

  it("includes turn limit in status when set", async () => {
    await handleYoujiCommand({ text: "mode dev", userId: OPERATOR, channelId: "C001" });
    await handleYoujiCommand({ text: "max-turns 15", userId: OPERATOR, channelId: "C001" });
    const result = await handleYoujiCommand({ text: "status", userId: OTHER_USER, channelId: "C001" });
    expect(result.text).toContain("dev");
    expect(result.text).toContain("15");
  });

  it("updates max-turns when called again with new value", async () => {
    await handleYoujiCommand({ text: "max-turns 10", userId: OPERATOR, channelId: "C001" });
    expect(getMaxTurns("C001")).toBe(10);
    await handleYoujiCommand({ text: "max-turns 20", userId: OPERATOR, channelId: "C001" });
    expect(getMaxTurns("C001")).toBe(20);
  });

it("includes max-turns in help output", async () => {
    const result = await handleYoujiCommand({ text: "help", userId: OPERATOR, channelId: "C001" });
    expect(result.text).toContain("max-turns");
  });

  it("includes backend in help output", async () => {
    const result = await handleYoujiCommand({ text: "help", userId: OPERATOR, channelId: "C001" });
    expect(result.text).toContain("backend");
    expect(result.text).toContain("claude");
    expect(result.text).toContain("cursor");
  });

  // backend subcommand tests

  it("sets backend preference", async () => {
    const result = await handleYoujiCommand({ text: "backend claude", userId: OPERATOR, channelId: "C001" });
    expect(result.text).toContain("claude");
    expect(result.text).toContain("Backend set");
    expect(getBackendPreference()).toBe("claude");
  });

  it("sets backend to cursor", async () => {
    const result = await handleYoujiCommand({ text: "backend cursor", userId: OPERATOR, channelId: "C001" });
    expect(result.text).toContain("cursor");
    expect(getBackendPreference()).toBe("cursor");
  });

  it("sets backend to opencode", async () => {
    const result = await handleYoujiCommand({ text: "backend opencode", userId: OPERATOR, channelId: "C001" });
    expect(result.text).toContain("opencode");
    expect(getBackendPreference()).toBe("opencode");
  });

  it("sets backend to auto with description", async () => {
    const result = await handleYoujiCommand({ text: "backend auto", userId: OPERATOR, channelId: "C001" });
    expect(result.text).toContain("auto");
    expect(result.text).toContain("fallback");
    expect(getBackendPreference()).toBe("auto");
  });

  it("shows current backend when no value given", async () => {
    const result = await handleYoujiCommand({ text: "backend", userId: OPERATOR, channelId: "C001" });
    expect(result.text).toContain("auto");
    expect(result.text).toContain("env default");
  });

  it("shows persisted backend in status", async () => {
    await handleYoujiCommand({ text: "backend cursor", userId: OPERATOR, channelId: "C001" });
    const result = await handleYoujiCommand({ text: "backend", userId: OPERATOR, channelId: "C001" });
    expect(result.text).toContain("cursor");
    expect(result.text).toContain("persisted");
  });

  it("resets backend preference with 'reset'", async () => {
    await handleYoujiCommand({ text: "backend claude", userId: OPERATOR, channelId: "C001" });
    expect(getBackendPreference()).toBe("claude");

    const result = await handleYoujiCommand({ text: "backend reset", userId: OPERATOR, channelId: "C001" });
    expect(result.text).toContain("reset");
    expect(getBackendPreference()).toBeNull();
  });

  it("clears backend preference with 'clear'", async () => {
    await handleYoujiCommand({ text: "backend cursor", userId: OPERATOR, channelId: "C001" });
    const result = await handleYoujiCommand({ text: "backend clear", userId: OPERATOR, channelId: "C001" });
    expect(result.text).toContain("reset");
    expect(getBackendPreference()).toBeNull();
  });

  it("rejects backend changes from non-designated users", async () => {
    const result = await handleYoujiCommand({ text: "backend claude", userId: OTHER_USER, channelId: "C001" });
    expect(result.text).toContain("Only the designated");
    expect(getBackendPreference()).toBeNull();
  });

  it("rejects invalid backend value", async () => {
    const result = await handleYoujiCommand({ text: "backend invalid", userId: OPERATOR, channelId: "C001" });
    expect(result.text).toContain("Unknown backend");
    expect(result.text).toContain("invalid");
    expect(getBackendPreference()).toBeNull();
  });

  it("includes backend in status output", async () => {
    await handleYoujiCommand({ text: "mode dev", userId: OPERATOR, channelId: "C001" });
    const result = await handleYoujiCommand({ text: "status", userId: OTHER_USER, channelId: "C001" });
    expect(result.text).toContain("Backend:");
    expect(result.text).toContain("auto");
  });

  it("shows persisted vs env in status", async () => {
    await handleYoujiCommand({ text: "backend cursor", userId: OPERATOR, channelId: "C001" });
    const result = await handleYoujiCommand({ text: "status", userId: OTHER_USER, channelId: "C001" });
    expect(result.text).toContain("cursor");
    expect(result.text).toContain("persisted");
  });
});

describe("handleBotChannelJoin", () => {
  const BOT_ID = "U_BOT";
  const OPERATOR = "U_OPERATOR";
  const OTHER_USER = "U_OTHER";
  const originalEnv = { ...process.env };

  function mockClient() {
    return {
      chat: {
        postMessage: async (_opts: { channel: string; text: string }) => ({ ok: true }),
      },
      conversations: {
        leave: async (_opts: { channel: string }) => ({ ok: true }),
      },
      _calls: [] as { method: string; args: unknown }[],
    };
  }

  function trackedClient() {
    const calls: { method: string; args: unknown }[] = [];
    return {
      chat: {
        postMessage: async (opts: { channel: string; text: string }) => {
          calls.push({ method: "chat.postMessage", args: opts });
          return { ok: true };
        },
      },
      conversations: {
        leave: async (opts: { channel: string }) => {
          calls.push({ method: "conversations.leave", args: opts });
          return { ok: true };
        },
      },
      calls,
    };
  }

  beforeEach(() => {
    process.env["SLACK_USER_ID"] = OPERATOR;
    initChannelModes();
    setBotUserId(BOT_ID);
  });

  afterEach(() => {
    setBotUserId(null);
    process.env = { ...originalEnv };
  });

  it("ignores events for non-bot users", async () => {
    const result = await handleBotChannelJoin(
      { user: OTHER_USER, channel: "C001" },
      mockClient(),
    );
    expect(result.action).toBe("ignored");
  });

  it("ignores events when botUserId is not set", async () => {
    setBotUserId(null);
    const result = await handleBotChannelJoin(
      { user: BOT_ID, channel: "C001" },
      mockClient(),
    );
    expect(result.action).toBe("ignored");
  });

  it("stays when invited by the designated user", async () => {
    const result = await handleBotChannelJoin(
      { user: BOT_ID, channel: "C001", inviter: OPERATOR },
      mockClient(),
    );
    expect(result.action).toBe("stayed");
  });

  it("leaves when invited by a non-designated user", async () => {
    const client = trackedClient();
    const result = await handleBotChannelJoin(
      { user: BOT_ID, channel: "C001", inviter: OTHER_USER },
      client,
    );
    expect(result.action).toBe("left");
    expect(client.calls).toHaveLength(2);
    expect(client.calls[0].method).toBe("chat.postMessage");
    expect(client.calls[1].method).toBe("conversations.leave");
  });

  it("leaves when no inviter is specified", async () => {
    const client = trackedClient();
    const result = await handleBotChannelJoin(
      { user: BOT_ID, channel: "C001" },
      client,
    );
    expect(result.action).toBe("left");
    expect(client.calls.some(c => c.method === "conversations.leave")).toBe(true);
  });

  it("posts a polite message before leaving", async () => {
    const client = trackedClient();
    await handleBotChannelJoin(
      { user: BOT_ID, channel: "C001", inviter: OTHER_USER },
      client,
    );
    const postCall = client.calls.find(c => c.method === "chat.postMessage");
    expect(postCall).toBeDefined();
    const args = postCall!.args as { channel: string; text: string };
    expect(args.channel).toBe("C001");
    expect(args.text).toContain("only the Youji operator");
  });

  it("still leaves even if posting the message fails", async () => {
    const calls: { method: string; args: unknown }[] = [];
    const client = {
      chat: {
        postMessage: async () => { throw new Error("no permission"); },
      },
      conversations: {
        leave: async (opts: { channel: string }) => {
          calls.push({ method: "conversations.leave", args: opts });
          return { ok: true };
        },
      },
    };
    const result = await handleBotChannelJoin(
      { user: BOT_ID, channel: "C001", inviter: OTHER_USER },
      client,
    );
    expect(result.action).toBe("left");
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("conversations.leave");
  });

  it("calls leave on the correct channel", async () => {
    const client = trackedClient();
    await handleBotChannelJoin(
      { user: BOT_ID, channel: "C_TARGET", inviter: OTHER_USER },
      client,
    );
    const leaveCall = client.calls.find(c => c.method === "conversations.leave");
    expect(leaveCall).toBeDefined();
    expect((leaveCall!.args as { channel: string }).channel).toBe("C_TARGET");
  });
});

describe("thread mode integration", () => {
  beforeEach(() => {
    clearAllThreadModes();
  });

  afterEach(() => {
    clearAllThreadModes();
  });

  it("/youji help mentions thread mode commands", async () => {
    const result = await handleYoujiCommand({ text: "help", userId: "U_OP", channelId: "C001" });
    expect(result.text).toContain("active on");
    expect(result.text).toContain("active off");
    expect(result.text).toContain("Thread commands");
  });

  it("thread defaults to mention mode", () => {
    expect(getThreadMode("C001:thread1")).toBe("mention");
    expect(isThreadActive("C001:thread1")).toBe(false);
  });

  it("toggle command sets thread to active mode", () => {
    const mode = parseThreadModeCommand("active on");
    expect(mode).toBe("active");
    setThreadMode("C001:thread1", mode!);
    expect(isThreadActive("C001:thread1")).toBe(true);
  });

  it("toggle command sets thread back to mention mode", () => {
    setThreadMode("C001:thread1", "active");
    const mode = parseThreadModeCommand("active off");
    expect(mode).toBe("mention");
    setThreadMode("C001:thread1", mode!);
    expect(isThreadActive("C001:thread1")).toBe(false);
  });

  it("thread modes are independent across threads", () => {
    setThreadMode("C001:thread1", "active");
    setThreadMode("C001:thread2", "mention");

    expect(isThreadActive("C001:thread1")).toBe(true);
    expect(isThreadActive("C001:thread2")).toBe(false);
    expect(isThreadActive("C001:thread3")).toBe(false);
  });

  it("non-toggle messages are not parsed as commands", () => {
    expect(parseThreadModeCommand("hello")).toBeNull();
    expect(parseThreadModeCommand("what is active?")).toBeNull();
    expect(parseThreadModeCommand("please active on")).toBeNull();
  });
});
