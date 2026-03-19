/** Tests for channel mode registry. */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  initChannelModes,
  getChannelMode,
  isDesignatedUser,
  listChannelConfigs,
  hasChannelConfigs,
  setChannelMode,
  removeChannelMode,
  setChannelModesPath,
  getChannelTeam,
} from "./channel-mode.js";

describe.sequential("channel-mode", () => {
  const originalEnv = { ...process.env };
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "channel-mode-test-"));
    setChannelModesPath(join(tmpDir, "channel-modes.json"));
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    setChannelModesPath(null);
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("initChannelModes", () => {
    it("parses dev and chat channels from env vars", () => {
      process.env["SLACK_DEV_CHANNELS"] = "C001,C002";
      process.env["SLACK_CHAT_CHANNELS"] = "C003,C004";
      process.env["SLACK_USER_ID"] = "U123";
      initChannelModes();

      expect(getChannelMode("C001")).toBe("dev");
      expect(getChannelMode("C002")).toBe("dev");
      expect(getChannelMode("C003")).toBe("chat");
      expect(getChannelMode("C004")).toBe("chat");
    });

    it("returns null for unregistered channels", () => {
      process.env["SLACK_DEV_CHANNELS"] = "C001";
      process.env["SLACK_CHAT_CHANNELS"] = "C002";
      initChannelModes();

      expect(getChannelMode("C999")).toBeNull();
    });

    it("handles empty env vars", () => {
      delete process.env["SLACK_DEV_CHANNELS"];
      delete process.env["SLACK_CHAT_CHANNELS"];
      initChannelModes();

      expect(getChannelMode("C001")).toBeNull();
      expect(hasChannelConfigs()).toBe(false);
    });

    it("handles whitespace in channel lists", () => {
      process.env["SLACK_DEV_CHANNELS"] = " C001 , C002 , ";
      initChannelModes();

      expect(getChannelMode("C001")).toBe("dev");
      expect(getChannelMode("C002")).toBe("dev");
    });

    it("resolves overlap in favor of dev mode", () => {
      process.env["SLACK_DEV_CHANNELS"] = "C001,C002";
      process.env["SLACK_CHAT_CHANNELS"] = "C002,C003";
      initChannelModes();

      expect(getChannelMode("C002")).toBe("dev");
      expect(getChannelMode("C003")).toBe("chat");
    });
  });

  describe("isDesignatedUser", () => {
    it("returns true for the designated user", () => {
      process.env["SLACK_USER_ID"] = "U0245FH83EE";
      initChannelModes();

      expect(isDesignatedUser("U0245FH83EE")).toBe(true);
    });

    it("returns false for other users", () => {
      process.env["SLACK_USER_ID"] = "U0245FH83EE";
      initChannelModes();

      expect(isDesignatedUser("U999")).toBe(false);
    });

    it("returns false when no user is configured", () => {
      delete process.env["SLACK_USER_ID"];
      initChannelModes();

      expect(isDesignatedUser("U0245FH83EE")).toBe(false);
    });
  });

  describe("listChannelConfigs", () => {
    it("lists all configured channels with modes", () => {
      process.env["SLACK_DEV_CHANNELS"] = "C001";
      process.env["SLACK_CHAT_CHANNELS"] = "C002,C003";
      initChannelModes();

      const configs = listChannelConfigs();
      expect(configs).toHaveLength(3);
      expect(configs).toContainEqual({ mode: "dev", channelId: "C001" });
      expect(configs).toContainEqual({ mode: "chat", channelId: "C002" });
      expect(configs).toContainEqual({ mode: "chat", channelId: "C003" });
    });
  });

  describe("hasChannelConfigs", () => {
    it("returns true when channels are configured", () => {
      process.env["SLACK_DEV_CHANNELS"] = "C001";
      initChannelModes();

      expect(hasChannelConfigs()).toBe(true);
    });

    it("returns false when no channels are configured", () => {
      delete process.env["SLACK_DEV_CHANNELS"];
      delete process.env["SLACK_CHAT_CHANNELS"];
      initChannelModes();

      expect(hasChannelConfigs()).toBe(false);
    });
  });

  describe("setChannelMode", () => {
    beforeEach(async () => {
      delete process.env["SLACK_DEV_CHANNELS"];
      delete process.env["SLACK_CHAT_CHANNELS"];
      initChannelModes();
    });

    it("adds a new channel in dev mode", async () => {
      await setChannelMode("C100", "dev");
      expect(getChannelMode("C100")).toBe("dev");
      expect(hasChannelConfigs()).toBe(true);
    });

    it("adds a new channel in chat mode", async () => {
      await setChannelMode("C200", "chat");
      expect(getChannelMode("C200")).toBe("chat");
    });

    it("changes an existing channel's mode", async () => {
      await setChannelMode("C300", "dev");
      expect(getChannelMode("C300")).toBe("dev");

      await setChannelMode("C300", "chat");
      expect(getChannelMode("C300")).toBe("chat");
    });

    it("persists to JSON file", async () => {
      await setChannelMode("C400", "dev");
      await setChannelMode("C401", "chat");

      const raw = await readFile(join(tmpDir, "channel-modes.json"), "utf-8");
      const data = JSON.parse(raw);
      expect(data.channels.C400).toBe("dev");
      expect(data.channels.C401).toBe("chat");
    });

    it("coexists with env-var channels", async () => {
      process.env["SLACK_DEV_CHANNELS"] = "C001";
      initChannelModes();

      await setChannelMode("C500", "chat");

      expect(getChannelMode("C001")).toBe("dev");
      expect(getChannelMode("C500")).toBe("chat");
    });
  });

  describe("removeChannelMode", () => {
    beforeEach(async () => {
      delete process.env["SLACK_DEV_CHANNELS"];
      delete process.env["SLACK_CHAT_CHANNELS"];
      initChannelModes();
    });

    it("removes a dynamically added channel", async () => {
      await setChannelMode("C600", "dev");
      expect(getChannelMode("C600")).toBe("dev");

      const removed = await removeChannelMode("C600");
      expect(removed).toBe(true);
      expect(getChannelMode("C600")).toBeNull();
    });

    it("returns false when removing a non-existent channel", async () => {
      const removed = await removeChannelMode("C999");
      expect(removed).toBe(false);
    });

    it("persists removal to JSON file", async () => {
      await setChannelMode("C700", "dev");
      await setChannelMode("C701", "chat");
      await removeChannelMode("C700");

      const raw = await readFile(join(tmpDir, "channel-modes.json"), "utf-8");
      const data = JSON.parse(raw);
      expect(data.channels.C700).toBeUndefined();
      expect(data.channels.C701).toBe("chat");
    });

    it("does not remove env-var channels from in-memory map", async () => {
      process.env["SLACK_DEV_CHANNELS"] = "C001";
      initChannelModes();

      const removed = await removeChannelMode("C001");
      expect(removed).toBe(true);
      // env-var channels are re-loaded on next initChannelModes()
      // but the in-memory map is updated immediately
      expect(getChannelMode("C001")).toBeNull();
    });
  });

  describe("persistence across init", () => {
    beforeEach(async () => {
      delete process.env["SLACK_DEV_CHANNELS"];
      delete process.env["SLACK_CHAT_CHANNELS"];
    });

    it("loads persisted channels on initChannelModes", async () => {
      initChannelModes();
      await setChannelMode("C800", "dev");
      await setChannelMode("C801", "chat");

      // Re-initialize — should load persisted channels
      initChannelModes();

      expect(getChannelMode("C800")).toBe("dev");
      expect(getChannelMode("C801")).toBe("chat");
    });

    it("env vars override persisted channels on overlap", async () => {
      initChannelModes();
      await setChannelMode("C001", "chat");

      // Set env var for same channel as dev — env var wins
      process.env["SLACK_DEV_CHANNELS"] = "C001";
      initChannelModes();

      expect(getChannelMode("C001")).toBe("dev");
    });
  });

  describe("team metadata", () => {
    beforeEach(() => {
      delete process.env["SLACK_DEV_CHANNELS"];
      delete process.env["SLACK_CHAT_CHANNELS"];
    });

    it("setChannelMode accepts optional team parameter", async () => {
      initChannelModes();
      await setChannelMode("C900", "dev", "art");

      expect(getChannelMode("C900")).toBe("dev");
      expect(getChannelTeam("C900")).toBe("art");
    });

    it("getChannelTeam returns null for channels without team", async () => {
      initChannelModes();
      await setChannelMode("C901", "dev");

      expect(getChannelTeam("C901")).toBeNull();
    });

    it("getChannelTeam returns null for unregistered channels", () => {
      initChannelModes();
      expect(getChannelTeam("C999")).toBeNull();
    });

    it("listChannelConfigs includes team when present", async () => {
      initChannelModes();
      await setChannelMode("C902", "chat", "product");
      await setChannelMode("C903", "dev");

      const configs = listChannelConfigs();
      const c902 = configs.find((c) => c.channelId === "C902");
      const c903 = configs.find((c) => c.channelId === "C903");

      expect(c902?.team).toBe("product");
      expect(c903?.team).toBeUndefined();
    });

    it("team persists across initChannelModes", async () => {
      initChannelModes();
      await setChannelMode("C904", "dev", "engineering");

      // Re-initialize — should load persisted team
      initChannelModes();

      expect(getChannelMode("C904")).toBe("dev");
      expect(getChannelTeam("C904")).toBe("engineering");
    });

    it("removeChannelMode also removes team", async () => {
      initChannelModes();
      await setChannelMode("C905", "chat", "research");
      await removeChannelMode("C905");

      expect(getChannelMode("C905")).toBeNull();
      expect(getChannelTeam("C905")).toBeNull();
    });

    it("supports all team types", async () => {
      initChannelModes();
      await setChannelMode("C910", "dev", "art");
      await setChannelMode("C911", "dev", "product");
      await setChannelMode("C912", "dev", "engineering");
      await setChannelMode("C913", "dev", "research");

      expect(getChannelTeam("C910")).toBe("art");
      expect(getChannelTeam("C911")).toBe("product");
      expect(getChannelTeam("C912")).toBe("engineering");
      expect(getChannelTeam("C913")).toBe("research");
    });

    it("loads team from persisted JSON format", async () => {
      // Write a JSON file with team info in the new format
      const { writeFile } = await import("node:fs/promises");
      await writeFile(
        join(tmpDir, "channel-modes.json"),
        JSON.stringify({
          channels: {
            C920: { mode: "dev", team: "art" },
            C921: "chat",
            C922: { mode: "chat", team: "product" },
          },
        }, null, 2) + "\n",
      );

      initChannelModes();

      expect(getChannelMode("C920")).toBe("dev");
      expect(getChannelTeam("C920")).toBe("art");
      expect(getChannelMode("C921")).toBe("chat");
      expect(getChannelTeam("C921")).toBeNull();
      expect(getChannelMode("C922")).toBe("chat");
      expect(getChannelTeam("C922")).toBe("product");
    });
  });
});
