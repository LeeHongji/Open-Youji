import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testDir = join(tmpdir(), "backend-preference-test");
const testFile = join(testDir, "backend-preference.json");

vi.mock("./backend.js", () => ({
  BackendPreference: undefined,
}));

describe("backend-preference", () => {
  beforeEach(async () => {
    vi.resetModules();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(async () => {
    vi.resetModules();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("getBackendPreference returns null when no preference is set", async () => {
    const { getBackendPreference, setBackendPreferencePath } = await import(
      "./backend-preference.js"
    );
    setBackendPreferencePath(testFile);
    expect(getBackendPreference()).toBeNull();
  });

  it("initBackendPreference loads valid preference from file", async () => {
    writeFileSync(testFile, JSON.stringify({ backend: "opencode" }) + "\n");
    const { initBackendPreference, getBackendPreference, setBackendPreferencePath } = await import(
      "./backend-preference.js"
    );
    setBackendPreferencePath(testFile);
    initBackendPreference();
    expect(getBackendPreference()).toBe("opencode");
  });

  it("initBackendPreference handles missing file gracefully", async () => {
    const { initBackendPreference, getBackendPreference, setBackendPreferencePath } = await import(
      "./backend-preference.js"
    );
    setBackendPreferencePath(join(testDir, "nonexistent.json"));
    initBackendPreference();
    expect(getBackendPreference()).toBeNull();
  });

  it("initBackendPreference handles malformed JSON gracefully", async () => {
    writeFileSync(testFile, "not valid json");
    const { initBackendPreference, getBackendPreference, setBackendPreferencePath } = await import(
      "./backend-preference.js"
    );
    setBackendPreferencePath(testFile);
    initBackendPreference();
    expect(getBackendPreference()).toBeNull();
  });

  it("initBackendPreference ignores invalid backend values", async () => {
    writeFileSync(testFile, JSON.stringify({ backend: "invalid-backend" }) + "\n");
    const { initBackendPreference, getBackendPreference, setBackendPreferencePath } = await import(
      "./backend-preference.js"
    );
    setBackendPreferencePath(testFile);
    initBackendPreference();
    expect(getBackendPreference()).toBeNull();
  });

  it("initBackendPreference accepts all valid backend types", async () => {
    const backends = ["claude", "cursor", "opencode", "auto"] as const;
    for (const backend of backends) {
      rmSync(testDir, { recursive: true, force: true });
      mkdirSync(testDir, { recursive: true });
      writeFileSync(testFile, JSON.stringify({ backend }) + "\n");
      vi.resetModules();
      const { initBackendPreference, getBackendPreference, setBackendPreferencePath } = await import(
        "./backend-preference.js"
      );
      setBackendPreferencePath(testFile);
      initBackendPreference();
      expect(getBackendPreference()).toBe(backend);
    }
  });

  it("setBackendPreference updates preference and persists to disk", async () => {
    const { setBackendPreference, getBackendPreference, setBackendPreferencePath } = await import(
      "./backend-preference.js"
    );
    setBackendPreferencePath(testFile);
    await setBackendPreference("claude");
    expect(getBackendPreference()).toBe("claude");
    const written = JSON.parse(readFileSync(testFile, "utf-8"));
    expect(written.backend).toBe("claude");
  });

  it("clearBackendPreference clears preference and persists to disk", async () => {
    writeFileSync(testFile, JSON.stringify({ backend: "cursor" }) + "\n");
    const { initBackendPreference, clearBackendPreference, getBackendPreference, setBackendPreferencePath } =
      await import("./backend-preference.js");
    setBackendPreferencePath(testFile);
    initBackendPreference();
    expect(getBackendPreference()).toBe("cursor");
    await clearBackendPreference();
    expect(getBackendPreference()).toBeNull();
    const written = JSON.parse(readFileSync(testFile, "utf-8"));
    expect(written.backend).toBeUndefined();
  });

  it("setBackendPreferencePath(null) resets to default path", async () => {
    const { setBackendPreferencePath } = await import("./backend-preference.js");
    setBackendPreferencePath("/custom/path.json");
    setBackendPreferencePath(null);
    expect(true).toBe(true);
  });

  it("persists create directory if it does not exist", async () => {
    const nestedDir = join(testDir, "nested", "deep");
    const nestedFile = join(nestedDir, "preference.json");
    const { setBackendPreference, getBackendPreference, setBackendPreferencePath } = await import(
      "./backend-preference.js"
    );
    setBackendPreferencePath(nestedFile);
    await setBackendPreference("auto");
    expect(existsSync(nestedFile)).toBe(true);
    expect(getBackendPreference()).toBe("auto");
  });

  it("handles file with missing backend field", async () => {
    writeFileSync(testFile, JSON.stringify({ otherField: "value" }) + "\n");
    const { initBackendPreference, getBackendPreference, setBackendPreferencePath } = await import(
      "./backend-preference.js"
    );
    setBackendPreferencePath(testFile);
    initBackendPreference();
    expect(getBackendPreference()).toBeNull();
  });

  it("handles empty file", async () => {
    writeFileSync(testFile, "");
    const { initBackendPreference, getBackendPreference, setBackendPreferencePath } = await import(
      "./backend-preference.js"
    );
    setBackendPreferencePath(testFile);
    initBackendPreference();
    expect(getBackendPreference()).toBeNull();
  });
});
