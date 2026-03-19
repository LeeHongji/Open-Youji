import { describe, it, expect } from "vitest";
import { computeNextRunAtMs } from "./schedule.js";
import type { Schedule } from "./types.js";

describe("computeNextRunAtMs", () => {
  describe("cron schedule", () => {
    it("returns next occurrence for hourly cron", () => {
      const schedule: Schedule = { kind: "cron", expr: "0 * * * *" };
      const nowMs = new Date("2026-03-03T10:30:00Z").getTime();
      const result = computeNextRunAtMs(schedule, nowMs);

      expect(result).not.toBeNull();
      const nextDate = new Date(result!);
      expect(nextDate.getUTCHours()).toBe(11);
      expect(nextDate.getUTCMinutes()).toBe(0);
    });

    it("returns next occurrence for daily cron", () => {
      const schedule: Schedule = { kind: "cron", expr: "0 8 * * *" };
      const nowMs = new Date("2026-03-03T10:00:00Z").getTime();
      const result = computeNextRunAtMs(schedule, nowMs);

      expect(result).not.toBeNull();
      const nextDate = new Date(result!);
      expect(nextDate.getUTCDate()).toBe(4);
      expect(nextDate.getUTCHours()).toBe(8);
    });

    it("returns next occurrence for every-5-minutes cron", () => {
      const schedule: Schedule = { kind: "cron", expr: "*/5 * * * *" };
      const nowMs = new Date("2026-03-03T10:03:00Z").getTime();
      const result = computeNextRunAtMs(schedule, nowMs);

      expect(result).not.toBeNull();
      const nextDate = new Date(result!);
      expect(nextDate.getUTCMinutes()).toBe(5);
    });

    it("uses UTC timezone by default", () => {
      const schedule: Schedule = { kind: "cron", expr: "0 0 * * *" };
      const nowMs = new Date("2026-03-03T23:30:00Z").getTime();
      const result = computeNextRunAtMs(schedule, nowMs);

      expect(result).not.toBeNull();
      const nextDate = new Date(result!);
      expect(nextDate.getUTCDate()).toBe(4);
      expect(nextDate.getUTCHours()).toBe(0);
    });

    it("respects custom timezone (America/New_York)", () => {
      const schedule: Schedule = {
        kind: "cron",
        expr: "0 8 * * *",
        tz: "America/New_York",
      };
      const nowMs = new Date("2026-03-03T12:30:00Z").getTime();
      const result = computeNextRunAtMs(schedule, nowMs);

      expect(result).not.toBeNull();
      const nextDate = new Date(result!);
      expect(nextDate.getUTCHours()).toBe(13);
    });

    it("returns next time strictly after now (avoids re-trigger)", () => {
      const schedule: Schedule = { kind: "cron", expr: "0 * * * *" };
      const nowMs = new Date("2026-03-03T10:00:00Z").getTime();
      const result = computeNextRunAtMs(schedule, nowMs);

      expect(result).not.toBeNull();
      expect(result).toBeGreaterThan(nowMs);
    });

    it("returns null for invalid cron expression", () => {
      const schedule: Schedule = { kind: "cron", expr: "invalid" };
      const nowMs = Date.now();

      expect(() => computeNextRunAtMs(schedule, nowMs)).toThrow();
    });
  });

  describe("interval schedule", () => {
    it("returns next interval when no anchor provided", () => {
      const schedule: Schedule = { kind: "every", everyMs: 60000 };
      const nowMs = 1000000;
      const result = computeNextRunAtMs(schedule, nowMs);

      expect(result).toBe(1060000);
    });

    it("returns next interval from anchor", () => {
      const schedule: Schedule = {
        kind: "every",
        everyMs: 60000,
        anchorMs: 0,
      };
      const nowMs = 150000;
      const result = computeNextRunAtMs(schedule, nowMs);

      expect(result).toBe(180000);
    });

    it("handles anchor in the past", () => {
      const schedule: Schedule = {
        kind: "every",
        everyMs: 30000,
        anchorMs: 1000,
      };
      const nowMs = 100000;
      const result = computeNextRunAtMs(schedule, nowMs);

      const elapsed = nowMs - 1000;
      const intervals = Math.floor(elapsed / 30000);
      const expected = 1000 + (intervals + 1) * 30000;
      expect(result).toBe(expected);
    });

    it("handles anchor in the future (computes backwards from anchor)", () => {
      const schedule: Schedule = {
        kind: "every",
        everyMs: 60000,
        anchorMs: 200000,
      };
      const nowMs = 100000;
      const result = computeNextRunAtMs(schedule, nowMs);

      expect(result).toBe(140000);
    });

    it("handles now exactly at interval boundary", () => {
      const schedule: Schedule = {
        kind: "every",
        everyMs: 60000,
        anchorMs: 0,
      };
      const nowMs = 120000;
      const result = computeNextRunAtMs(schedule, nowMs);

      expect(result).toBe(180000);
    });

    it("handles hour intervals", () => {
      const schedule: Schedule = { kind: "every", everyMs: 3600000 };
      const nowMs = 5000000;
      const result = computeNextRunAtMs(schedule, nowMs);

      expect(result).toBe(8600000);
    });

    it("uses nowMs as anchor when anchorMs is undefined", () => {
      const schedule: Schedule = { kind: "every", everyMs: 10000 };
      const nowMs = 50000;
      const result = computeNextRunAtMs(schedule, nowMs);

      expect(result).toBe(60000);
    });
  });

  describe("unknown schedule kind", () => {
    it("returns null for unknown schedule kind", () => {
      const schedule = { kind: "unknown" } as unknown as Schedule;
      const nowMs = Date.now();
      const result = computeNextRunAtMs(schedule, nowMs);

      expect(result).toBeNull();
    });
  });
});
