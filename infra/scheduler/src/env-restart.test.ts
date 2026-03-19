/** Tests for mergeEnvContent — ensures .env changes propagate through PM2 restarts. */

import { describe, it, expect } from "vitest";
import { mergeEnvContent } from "./cli.js";

describe("mergeEnvContent", () => {
  it("parses key=value pairs from .env content", () => {
    const target: Record<string, string> = {};
    mergeEnvContent(target, "FOO=bar\nBAZ=qux\n");
    expect(target).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  it("overwrites existing keys (the PM2 cache fix)", () => {
    // Simulates PM2 passing a stale AGENT_BACKEND=opencode in process.env,
    // and the .env file having AGENT_BACKEND=auto
    const target: Record<string, string> = { AGENT_BACKEND: "opencode" };
    mergeEnvContent(target, "AGENT_BACKEND=auto\n");
    expect(target.AGENT_BACKEND).toBe("auto");
  });

  it("skips comments and empty lines", () => {
    const target: Record<string, string> = {};
    mergeEnvContent(target, "# comment\n\n  \nFOO=bar\n# another\n");
    expect(target).toEqual({ FOO: "bar" });
  });

  it("skips lines without =", () => {
    const target: Record<string, string> = {};
    mergeEnvContent(target, "NOEQUALS\nFOO=bar\n");
    expect(target).toEqual({ FOO: "bar" });
  });

  it("preserves existing keys not in .env content", () => {
    const target: Record<string, string> = { EXISTING: "keep" };
    mergeEnvContent(target, "NEW=val\n");
    expect(target).toEqual({ EXISTING: "keep", NEW: "val" });
  });

  it("handles values with = signs", () => {
    const target: Record<string, string> = {};
    mergeEnvContent(target, "TOKEN=abc=def=ghi\n");
    expect(target.TOKEN).toBe("abc=def=ghi");
  });

  it("later .env file overrides earlier one (scheduler > common)", () => {
    const target: Record<string, string> = {};
    // Simulates the two-layer loading: common first, then scheduler
    mergeEnvContent(target, "SHARED=common\nCOMMON_ONLY=yes\n");
    mergeEnvContent(target, "SHARED=scheduler\nSCHEDULER_ONLY=yes\n");
    expect(target.SHARED).toBe("scheduler");
    expect(target.COMMON_ONLY).toBe("yes");
    expect(target.SCHEDULER_ONLY).toBe("yes");
  });
});
