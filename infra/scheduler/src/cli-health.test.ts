import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runHealthCheck, type HealthCheckOptions } from "./cli.js";

function makeStateFile(content: object): string {
  const path = join(tmpdir(), `youji-health-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(path, JSON.stringify(content, null, 2));
  return path;
}

function cleanup(path: string) {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {}
}

function createMockFetch(response: { ok: boolean; status: number; statusText: string }) {
  return vi.fn().mockResolvedValue(response);
}

function createFailingFetch(error: Error) {
  return vi.fn().mockRejectedValue(error);
}

function createMockSlack() {
  return {
    isConfigured: vi.fn().mockReturnValue(true),
    dm: vi.fn().mockResolvedValue(undefined),
  };
}

describe("runHealthCheck", () => {
  let stateFile: string;

  beforeEach(() => {
    stateFile = join(tmpdir(), `youji-health-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  });

  afterEach(() => {
    cleanup(stateFile);
  });

  it("returns healthy when scheduler responds OK", async () => {
    const mockFetch = createMockFetch({ ok: true, status: 200, statusText: "OK" });
    const mockSlack = createMockSlack();

    const result = await runHealthCheck({
      url: "http://localhost:8420",
      timeout: 5000,
      stateFile,
      notify: false,
      fetchImpl: mockFetch as unknown as typeof fetch,
      slackImpl: mockSlack as unknown as typeof import("./slack.js"),
    });

    expect(result.healthy).toBe(true);
    expect(result.consecutiveFailures).toBe(0);
    expect(result.errorMessage).toBe(null);
  });

  it("increments failure count on connection error", async () => {
    const mockFetch = createFailingFetch(new Error("Connection refused"));
    const mockSlack = createMockSlack();

    const result = await runHealthCheck({
      url: "http://localhost:8420",
      timeout: 5000,
      stateFile,
      notify: false,
      fetchImpl: mockFetch as unknown as typeof fetch,
      slackImpl: mockSlack as unknown as typeof import("./slack.js"),
    });

    expect(result.healthy).toBe(false);
    expect(result.consecutiveFailures).toBe(1);
    expect(result.errorMessage).toBe("Connection refused");
  });

  it("sends Slack alert on second consecutive failure", async () => {
    stateFile = makeStateFile({
      consecutiveFailures: 1,
      lastFailureTime: new Date().toISOString(),
      lastSuccessTime: null,
      alertSent: false,
    });

    const mockFetch = createFailingFetch(new Error("ECONNREFUSED"));
    const mockSlack = createMockSlack();

    const result = await runHealthCheck({
      url: "http://localhost:8420",
      timeout: 5000,
      stateFile,
      notify: true,
      fetchImpl: mockFetch as unknown as typeof fetch,
      slackImpl: mockSlack as unknown as typeof import("./slack.js"),
    });

    expect(result.healthy).toBe(false);
    expect(result.consecutiveFailures).toBe(2);
    expect(result.alertSent).toBe(true);
    expect(mockSlack.dm).toHaveBeenCalledTimes(1);
  });

  it("does not send duplicate alerts", async () => {
    stateFile = makeStateFile({
      consecutiveFailures: 3,
      lastFailureTime: new Date().toISOString(),
      lastSuccessTime: null,
      alertSent: true,
    });

    const mockFetch = createFailingFetch(new Error("Still down"));
    const mockSlack = createMockSlack();

    const result = await runHealthCheck({
      url: "http://localhost:8420",
      timeout: 5000,
      stateFile,
      notify: true,
      fetchImpl: mockFetch as unknown as typeof fetch,
      slackImpl: mockSlack as unknown as typeof import("./slack.js"),
    });

    expect(result.healthy).toBe(false);
    expect(result.consecutiveFailures).toBe(4);
    expect(result.alertSent).toBe(false);
    expect(mockSlack.dm).not.toHaveBeenCalled();
  });

  it("sends recovery notification when scheduler comes back", async () => {
    stateFile = makeStateFile({
      consecutiveFailures: 3,
      lastFailureTime: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      lastSuccessTime: null,
      alertSent: true,
    });

    const mockFetch = createMockFetch({ ok: true, status: 200, statusText: "OK" });
    const mockSlack = createMockSlack();

    const result = await runHealthCheck({
      url: "http://localhost:8420",
      timeout: 5000,
      stateFile,
      notify: true,
      fetchImpl: mockFetch as unknown as typeof fetch,
      slackImpl: mockSlack as unknown as typeof import("./slack.js"),
    });

    expect(result.healthy).toBe(true);
    expect(result.consecutiveFailures).toBe(0);
    expect(result.recoverySent).toBe(true);
    expect(mockSlack.dm).toHaveBeenCalledTimes(1);
  });

  it("handles HTTP error responses", async () => {
    const mockFetch = createMockFetch({ ok: false, status: 503, statusText: "Service Unavailable" });
    const mockSlack = createMockSlack();

    const result = await runHealthCheck({
      url: "http://localhost:8420",
      timeout: 5000,
      stateFile,
      notify: false,
      fetchImpl: mockFetch as unknown as typeof fetch,
      slackImpl: mockSlack as unknown as typeof import("./slack.js"),
    });

    expect(result.healthy).toBe(false);
    expect(result.errorMessage).toBe("HTTP 503 Service Unavailable");
  });

  it("handles timeout correctly", async () => {
    const mockFetch = vi.fn().mockImplementation(() => {
      const error = new Error("Aborted");
      error.name = "AbortError";
      throw error;
    });
    const mockSlack = createMockSlack();

    const result = await runHealthCheck({
      url: "http://localhost:8420",
      timeout: 100,
      stateFile,
      notify: false,
      fetchImpl: mockFetch as unknown as typeof fetch,
      slackImpl: mockSlack as unknown as typeof import("./slack.js"),
    });

    expect(result.healthy).toBe(false);
    expect(result.errorMessage).toBe("Timeout after 100ms");
  });

  it("persists state to file on success", async () => {
    const mockFetch = createMockFetch({ ok: true, status: 200, statusText: "OK" });
    const mockSlack = createMockSlack();

    await runHealthCheck({
      url: "http://localhost:8420",
      timeout: 5000,
      stateFile,
      notify: false,
      fetchImpl: mockFetch as unknown as typeof fetch,
      slackImpl: mockSlack as unknown as typeof import("./slack.js"),
    });

    const raw = await import("node:fs/promises").then((fs) => fs.readFile(stateFile, "utf-8"));
    const state = JSON.parse(raw);
    expect(state.consecutiveFailures).toBe(0);
    expect(state.lastSuccessTime).toBeTruthy();
  });

  it("persists state to file on failure", async () => {
    const mockFetch = createFailingFetch(new Error("ECONNREFUSED"));
    const mockSlack = createMockSlack();

    await runHealthCheck({
      url: "http://localhost:8420",
      timeout: 5000,
      stateFile,
      notify: false,
      fetchImpl: mockFetch as unknown as typeof fetch,
      slackImpl: mockSlack as unknown as typeof import("./slack.js"),
    });

    const raw = await import("node:fs/promises").then((fs) => fs.readFile(stateFile, "utf-8"));
    const state = JSON.parse(raw);
    expect(state.consecutiveFailures).toBe(1);
    expect(state.lastFailureTime).toBeTruthy();
  });

  it("skips notification when Slack not configured", async () => {
    stateFile = makeStateFile({
      consecutiveFailures: 1,
      lastFailureTime: new Date().toISOString(),
      lastSuccessTime: null,
      alertSent: false,
    });

    const mockFetch = createFailingFetch(new Error("Down"));
    const mockSlack = {
      isConfigured: vi.fn().mockReturnValue(false),
      dm: vi.fn().mockResolvedValue(undefined),
    };

    const result = await runHealthCheck({
      url: "http://localhost:8420",
      timeout: 5000,
      stateFile,
      notify: true,
      fetchImpl: mockFetch as unknown as typeof fetch,
      slackImpl: mockSlack as unknown as typeof import("./slack.js"),
    });

    expect(result.healthy).toBe(false);
    expect(result.alertSent).toBe(false);
    expect(mockSlack.dm).not.toHaveBeenCalled();
  });
});
