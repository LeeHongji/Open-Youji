/** Tests for thread mode detection and parsing. */

import { describe, it, expect, beforeEach } from "vitest";
import {
  getThreadMode,
  setThreadMode,
  isThreadActive,
  parseThreadModeCommand,
  clearAllThreadModes,
} from "./thread-mode.js";

describe("thread-mode", () => {
  beforeEach(() => {
    clearAllThreadModes();
  });

  describe("getThreadMode", () => {
    it("returns 'mention' (default) for unregistered threads", () => {
      expect(getThreadMode("C123:1234567890.123456")).toBe("mention");
    });

    it("returns 'active' when set to active", () => {
      setThreadMode("C123:1234567890.123456", "active");
      expect(getThreadMode("C123:1234567890.123456")).toBe("active");
    });

    it("returns 'mention' when explicitly set to mention", () => {
      setThreadMode("C123:1234567890.123456", "active");
      setThreadMode("C123:1234567890.123456", "mention");
      expect(getThreadMode("C123:1234567890.123456")).toBe("mention");
    });

    it("handles different convKey formats", () => {
      setThreadMode("C001:1111111111.111111", "active");
      setThreadMode("D002:2222222222.222222", "active");

      expect(getThreadMode("C001:1111111111.111111")).toBe("active");
      expect(getThreadMode("D002:2222222222.222222")).toBe("active");
    });
  });

  describe("setThreadMode", () => {
    it("sets a thread to active mode", () => {
      setThreadMode("C456:1234567890.123456", "active");
      expect(getThreadMode("C456:1234567890.123456")).toBe("active");
    });

    it("removes entry when set to mention (default)", () => {
      setThreadMode("C789:1234567890.123456", "active");
      setThreadMode("C789:1234567890.123456", "mention");
      expect(getThreadMode("C789:1234567890.123456")).toBe("mention");
    });

    it("can change from active to active", () => {
      setThreadMode("C111:1234567890.123456", "active");
      setThreadMode("C111:1234567890.123456", "active");
      expect(getThreadMode("C111:1234567890.123456")).toBe("active");
    });

    it("handles multiple threads independently", () => {
      setThreadMode("C001:1111111111.111111", "active");
      setThreadMode("C002:2222222222.222222", "mention");

      expect(getThreadMode("C001:1111111111.111111")).toBe("active");
      expect(getThreadMode("C002:2222222222.222222")).toBe("mention");
    });
  });

  describe("isThreadActive", () => {
    it("returns false for unregistered threads (default mention)", () => {
      expect(isThreadActive("C999:1234567890.123456")).toBe(false);
    });

    it("returns true when thread is in active mode", () => {
      setThreadMode("C888:1234567890.123456", "active");
      expect(isThreadActive("C888:1234567890.123456")).toBe(true);
    });

    it("returns false when thread is in mention mode", () => {
      setThreadMode("C777:1234567890.123456", "mention");
      expect(isThreadActive("C777:1234567890.123456")).toBe(false);
    });
  });

  describe("parseThreadModeCommand", () => {
    it('parses "active on" to active mode', () => {
      expect(parseThreadModeCommand("active on")).toBe("active");
    });

    it('parses "active off" to mention mode', () => {
      expect(parseThreadModeCommand("active off")).toBe("mention");
    });

    it("is case-insensitive", () => {
      expect(parseThreadModeCommand("ACTIVE ON")).toBe("active");
      expect(parseThreadModeCommand("Active On")).toBe("active");
      expect(parseThreadModeCommand("ACTIVE OFF")).toBe("mention");
      expect(parseThreadModeCommand("Active Off")).toBe("mention");
    });

    it("trims whitespace", () => {
      expect(parseThreadModeCommand("  active on  ")).toBe("active");
      expect(parseThreadModeCommand("\tactive off\t")).toBe("mention");
    });

    it("returns null for invalid commands", () => {
      expect(parseThreadModeCommand("activate on")).toBeNull();
      expect(parseThreadModeCommand("active")).toBeNull();
      expect(parseThreadModeCommand("on")).toBeNull();
      expect(parseThreadModeCommand("")).toBeNull();
      expect(parseThreadModeCommand("hello world")).toBeNull();
    });

    it("returns null for similar but invalid phrases", () => {
      expect(parseThreadModeCommand("activeonn")).toBeNull();
      expect(parseThreadModeCommand("active  on")).toBeNull();
      expect(parseThreadModeCommand("active-on")).toBeNull();
    });
  });

  describe("clearAllThreadModes", () => {
    it("clears all registered thread modes", () => {
      setThreadMode("C001:1111111111.111111", "active");
      setThreadMode("C002:2222222222.222222", "active");

      clearAllThreadModes();

      expect(getThreadMode("C001:1111111111.111111")).toBe("mention");
      expect(getThreadMode("C002:2222222222.222222")).toBe("mention");
    });

    it("is safe to call when empty", () => {
      clearAllThreadModes();
      expect(getThreadMode("C999:1234567890.123456")).toBe("mention");
    });
  });
});
