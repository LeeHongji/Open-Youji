/** Persistent backend preference storage.
 *  Allows switching the agent backend via Slack slash command.
 *  Persisted preference takes precedence over AGENT_BACKEND env var. */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { BackendPreference } from "./backend.js";

interface PersistedBackendPreference {
  backend?: BackendPreference;
}

let currentPreference: BackendPreference | null = null;

const DEFAULT_PERSIST_PATH = new URL(
  "../../../.scheduler/backend-preference.json",
  import.meta.url,
).pathname;

let persistPath: string | null = DEFAULT_PERSIST_PATH;

/** Override the persistence file path (for testing). Pass null to reset to default. */
export function setBackendPreferencePath(path: string | null): void {
  persistPath = path ?? DEFAULT_PERSIST_PATH;
}

/** Load persisted backend preference from disk. Called once at startup. */
export function initBackendPreference(): void {
  currentPreference = loadPersistedPreference();
  if (currentPreference) {
    console.log(`[backend-preference] Loaded persisted preference: ${currentPreference}`);
  }
}

/** Get the persisted backend preference, or null if not set. */
export function getBackendPreference(): BackendPreference | null {
  return currentPreference;
}

/** Set the backend preference and persist to disk. */
export async function setBackendPreference(backend: BackendPreference): Promise<void> {
  currentPreference = backend;
  await persistBackendPreference();
  console.log(`[backend-preference] Set backend to ${backend}`);
}

/** Clear the persisted backend preference. */
export async function clearBackendPreference(): Promise<void> {
  currentPreference = null;
  await persistBackendPreference();
  console.log(`[backend-preference] Cleared backend preference`);
}

function loadPersistedPreference(): BackendPreference | null {
  if (!persistPath) return null;
  try {
    const raw = readFileSync(persistPath, "utf-8");
    const data = JSON.parse(raw) as PersistedBackendPreference;
    if (data.backend && ["claude", "cursor", "opencode", "auto"].includes(data.backend)) {
      return data.backend;
    }
    return null;
  } catch {
    return null;
  }
}

async function persistBackendPreference(): Promise<void> {
  if (!persistPath) return;
  const data: PersistedBackendPreference = {
    backend: currentPreference ?? undefined,
  };
  try {
    mkdirSync(dirname(persistPath), { recursive: true });
    writeFileSync(persistPath, JSON.stringify(data, null, 2) + "\n", "utf-8");
  } catch (err) {
    console.error(`[backend-preference] Failed to persist: ${err}`);
  }
}
