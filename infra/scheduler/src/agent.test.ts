/** Tests for agent profiles and spawning. */

import { describe, it, expect, afterEach } from "vitest";
import { AGENT_PROFILES, BACKEND_PROFILE_OVERRIDES, resolveProfileForBackend } from "./agent.js";

const VALID_CLAUDE_MODELS = ["opus", "sonnet", "haiku"] as const;

describe("AGENT_PROFILES", () => {
  const originalChatModel = process.env["SLACK_CHAT_MODEL"];

  afterEach(() => {
    if (originalChatModel !== undefined) {
      process.env["SLACK_CHAT_MODEL"] = originalChatModel;
    } else {
      delete process.env["SLACK_CHAT_MODEL"];
    }
  });

  it("chat profile reflects SLACK_CHAT_MODEL changes at access time (not cached at import)", () => {
    process.env["SLACK_CHAT_MODEL"] = "test-model-abc";
    expect(AGENT_PROFILES.chat.model).toBe("test-model-abc");

    process.env["SLACK_CHAT_MODEL"] = "another-model";
    expect(AGENT_PROFILES.chat.model).toBe("another-model");
  });

  it("chat profile falls back to sonnet when SLACK_CHAT_MODEL is unset", () => {
    delete process.env["SLACK_CHAT_MODEL"];
    expect(AGENT_PROFILES.chat.model).toBe("sonnet");
  });
});

describe("AGENT_PROFILES model name validation", () => {
  const originalChatModel = process.env["SLACK_CHAT_MODEL"];

  afterEach(() => {
    if (originalChatModel !== undefined) {
      process.env["SLACK_CHAT_MODEL"] = originalChatModel;
    } else {
      delete process.env["SLACK_CHAT_MODEL"];
    }
  });

  it("all static profile models are Claude SDK-compatible", () => {
    const staticProfiles = ["workSession", "teamWorkSession", "autofix", "deepWork", "skillCycle"] as const;
    for (const key of staticProfiles) {
      const model = AGENT_PROFILES[key].model;
      expect(VALID_CLAUDE_MODELS, `${key}.model "${model}" should be Claude SDK-compatible`).toContain(model);
    }
  });

  it("chat profile model is Claude SDK-compatible with default env", () => {
    delete process.env["SLACK_CHAT_MODEL"];
    expect(VALID_CLAUDE_MODELS, "chat.model with default env should be Claude SDK-compatible").toContain(AGENT_PROFILES.chat.model);
  });

  it("chat profile model is Claude SDK-compatible with valid SLACK_CHAT_MODEL", () => {
    for (const validModel of VALID_CLAUDE_MODELS) {
      process.env["SLACK_CHAT_MODEL"] = validModel;
      expect(AGENT_PROFILES.chat.model).toBe(validModel);
    }
  });

  it("detects invalid SLACK_CHAT_MODEL value", () => {
    process.env["SLACK_CHAT_MODEL"] = "opus-4.6-thinking";
    expect(VALID_CLAUDE_MODELS, "opus-4.6-thinking is NOT Claude SDK-compatible").not.toContain(AGENT_PROFILES.chat.model);
  });
});

describe("BACKEND_PROFILE_OVERRIDES", () => {
  it("has overrides for the opencode backend", () => {
    expect(BACKEND_PROFILE_OVERRIDES).toHaveProperty("opencode");
  });

  it("opencode overrides cover work-session and deep-work profiles", () => {
    const oc = BACKEND_PROFILE_OVERRIDES["opencode"];
    expect(oc).toHaveProperty("work-session");
    expect(oc).toHaveProperty("deep-work");
  });

  it("opencode work-session has tighter limits than default", () => {
    const oc = BACKEND_PROFILE_OVERRIDES["opencode"]["work-session"];
    expect(oc.maxTurns).toBeLessThan(256);
    expect(oc.maxDurationMs!).toBeLessThan(AGENT_PROFILES.workSession.maxDurationMs);
  });

  it("opencode deep-work has same timeout as default (60 min for all backends)", () => {
    const oc = BACKEND_PROFILE_OVERRIDES["opencode"]["deep-work"];
    expect(oc.maxDurationMs).toBe(3_600_000);
    expect(oc.maxTurns).toBe(256);
  });
});

describe("resolveProfileForBackend", () => {
  it("returns the original profile for claude backend (no overrides)", () => {
    const result = resolveProfileForBackend(AGENT_PROFILES.workSession, "claude");
    expect(result).toBe(AGENT_PROFILES.workSession);
  });

  it("returns the original profile for unknown backends", () => {
    const result = resolveProfileForBackend(AGENT_PROFILES.workSession, "some-new-backend");
    expect(result).toBe(AGENT_PROFILES.workSession);
  });

  it("applies opencode overrides to work-session profile", () => {
    const result = resolveProfileForBackend(AGENT_PROFILES.workSession, "opencode");
    expect(result.maxTurns).toBe(64);
    expect(result.maxDurationMs).toBe(900_000);
    // Preserves non-overridden fields
    expect(result.model).toBe(AGENT_PROFILES.workSession.model);
    expect(result.label).toBe("work-session");
  });

  it("applies opencode overrides to deep-work profile", () => {
    const result = resolveProfileForBackend(AGENT_PROFILES.deepWork, "opencode");
    expect(result.maxTurns).toBe(256);
    expect(result.maxDurationMs).toBe(3_600_000);
    expect(result.label).toBe("deep-work");
  });

  it("applies opencode overrides to skill-cycle profile", () => {
    const result = resolveProfileForBackend(AGENT_PROFILES.skillCycle, "opencode");
    expect(result.maxTurns).toBe(64);
    expect(result.maxDurationMs).toBe(600_000);
    expect(result.label).toBe("skill-cycle");
  });

  it("does NOT override chat profile for opencode (already bounded)", () => {
    const result = resolveProfileForBackend(AGENT_PROFILES.chat, "opencode");
    // Chat has no opencode override — should return original
    expect(result).toBe(AGENT_PROFILES.chat);
  });

  it("does NOT override autofix profile for opencode (already bounded)", () => {
    const result = resolveProfileForBackend(AGENT_PROFILES.autofix, "opencode");
    expect(result).toBe(AGENT_PROFILES.autofix);
  });

  it("does not mutate the original profile", () => {
    const originalMaxDuration = AGENT_PROFILES.workSession.maxDurationMs;
    resolveProfileForBackend(AGENT_PROFILES.workSession, "opencode");
    expect(AGENT_PROFILES.workSession.maxDurationMs).toBe(originalMaxDuration);
  });
});
