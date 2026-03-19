/** Tests for approval-burst: detect approved burst requests and trigger execution. */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseResolvedBurstItems,
  findExecutableBursts,
  markBurstExecuted,
  type ResolvedBurstItem,
} from "./approval-burst.js";

// ── Fixtures ──────────────────────────────────────────────────────────────

const QUEUE_WITH_APPROVED_BURST = `Coordination file for autonomous agent sessions requiring human decisions.

# Approval Queue

Items requiring human decision before autonomous execution can proceed. Agents append to "Pending"; humans resolve by moving items to "Resolved" with a decision.

## Pending

*No pending items.*

## Resolved

### 2026-02-22 — Burst: 5 sessions for youji-work-cycle
Decision: approved
By: human (via Slack)
Date: 2026-02-22
Type: burst
Job: youji-work-cycle
Max-sessions: 5
Max-cost: 25
Notes: Approved burst of 5 sessions

### 2026-02-21 — Tool access: LaTeX compiler
Decision: approved
By: human (via Slack)
Date: 2026-02-21
`;

const QUEUE_WITH_EXECUTED_BURST = `Coordination file for autonomous agent sessions requiring human decisions.

# Approval Queue

Items requiring human decision before autonomous execution can proceed. Agents append to "Pending"; humans resolve by moving items to "Resolved" with a decision.

## Pending

*No pending items.*

## Resolved

### 2026-02-22 — Burst: 5 sessions for youji-work-cycle
Decision: approved
By: human (via Slack)
Date: 2026-02-22
Type: burst
Job: youji-work-cycle
Max-sessions: 5
Max-cost: 25
Executed: 2026-02-22

### 2026-02-21 — Tool access: LaTeX compiler
Decision: approved
By: human (via Slack)
Date: 2026-02-21
`;

const QUEUE_WITH_DENIED_BURST = `Coordination file for autonomous agent sessions requiring human decisions.

# Approval Queue

Items requiring human decision before autonomous execution can proceed. Agents append to "Pending"; humans resolve by moving items to "Resolved" with a decision.

## Pending

*No pending items.*

## Resolved

### 2026-02-22 — Burst: 5 sessions for youji-work-cycle
Decision: denied
By: human (via Slack)
Date: 2026-02-22
Type: burst
Job: youji-work-cycle
Max-sessions: 5
Max-cost: 25
`;

const QUEUE_WITH_AUTOFIX_BURST = `Coordination file for autonomous agent sessions requiring human decisions.

# Approval Queue

Items requiring human decision before autonomous execution can proceed. Agents append to "Pending"; humans resolve by moving items to "Resolved" with a decision.

## Pending

*No pending items.*

## Resolved

### 2026-02-22 — Burst: 10 sessions with autofix
Decision: approved
By: human (via Slack)
Date: 2026-02-22
Type: burst
Job: youji-work-cycle
Max-sessions: 10
Max-cost: 50
Autofix: true
Autofix-retries: 5
`;

const QUEUE_WITH_MULTIPLE_BURSTS = `Coordination file for autonomous agent sessions requiring human decisions.

# Approval Queue

Items requiring human decision before autonomous execution can proceed. Agents append to "Pending"; humans resolve by moving items to "Resolved" with a decision.

## Pending

*No pending items.*

## Resolved

### 2026-02-22 — Burst: 3 sessions
Decision: approved
By: human (via Slack)
Date: 2026-02-22
Type: burst
Job: youji-work-cycle
Max-sessions: 3
Max-cost: 15

### 2026-02-22 — Burst: 5 sessions (second request)
Decision: approved
By: human (via Slack)
Date: 2026-02-22
Type: burst
Job: youji-work-cycle
Max-sessions: 5
Max-cost: 30
Executed: 2026-02-22
`;

const QUEUE_WITH_PENDING_BURST = `Coordination file for autonomous agent sessions requiring human decisions.

# Approval Queue

Items requiring human decision before autonomous execution can proceed. Agents append to "Pending"; humans resolve by moving items to "Resolved" with a decision.

## Pending

### 2026-02-22 — Burst: 5 sessions for youji-work-cycle
Project: youji
Type: burst
Request: Run 5 burst sessions of youji-work-cycle
Job: youji-work-cycle
Max-sessions: 5
Max-cost: 25

## Resolved

*No resolved items yet.*
`;

// ── parseResolvedBurstItems ───────────────────────────────────────────────

describe("parseResolvedBurstItems", () => {
  it("parses an approved burst item from the Resolved section", () => {
    const items = parseResolvedBurstItems(QUEUE_WITH_APPROVED_BURST);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      date: "2026-02-22",
      title: "Burst: 5 sessions for youji-work-cycle",
      decision: "approved",
      job: "youji-work-cycle",
      maxSessions: 5,
      maxCost: 25,
      autofix: false,
      autofixRetries: 3,
      executed: false,
    });
  });

  it("detects the Executed marker on already-executed bursts", () => {
    const items = parseResolvedBurstItems(QUEUE_WITH_EXECUTED_BURST);
    expect(items).toHaveLength(1);
    expect(items[0].executed).toBe(true);
  });

  it("parses a denied burst item", () => {
    const items = parseResolvedBurstItems(QUEUE_WITH_DENIED_BURST);
    expect(items).toHaveLength(1);
    expect(items[0].decision).toBe("denied");
  });

  it("parses autofix options", () => {
    const items = parseResolvedBurstItems(QUEUE_WITH_AUTOFIX_BURST);
    expect(items).toHaveLength(1);
    expect(items[0].autofix).toBe(true);
    expect(items[0].autofixRetries).toBe(5);
  });

  it("ignores non-burst resolved items", () => {
    const items = parseResolvedBurstItems(QUEUE_WITH_APPROVED_BURST);
    // Only the burst item, not the LaTeX one
    expect(items).toHaveLength(1);
    expect(items[0].title).toContain("Burst");
  });

  it("parses multiple burst items", () => {
    const items = parseResolvedBurstItems(QUEUE_WITH_MULTIPLE_BURSTS);
    expect(items).toHaveLength(2);
  });

  it("returns empty array when no burst items exist", () => {
    const content = `# Approval Queue\n\n## Pending\n\n*No pending items.*\n\n## Resolved\n\n### 2026-02-21 — Tool access\nDecision: approved\nBy: human\nDate: 2026-02-21\n`;
    const items = parseResolvedBurstItems(content);
    expect(items).toHaveLength(0);
  });

  it("does not parse pending burst items (only resolved)", () => {
    const items = parseResolvedBurstItems(QUEUE_WITH_PENDING_BURST);
    expect(items).toHaveLength(0);
  });
});

// ── findExecutableBursts ──────────────────────────────────────────────────

describe("findExecutableBursts", () => {
  it("returns approved, un-executed burst items", () => {
    const items = parseResolvedBurstItems(QUEUE_WITH_APPROVED_BURST);
    const executable = findExecutableBursts(items);
    expect(executable).toHaveLength(1);
    expect(executable[0].job).toBe("youji-work-cycle");
  });

  it("excludes already-executed burst items", () => {
    const items = parseResolvedBurstItems(QUEUE_WITH_EXECUTED_BURST);
    const executable = findExecutableBursts(items);
    expect(executable).toHaveLength(0);
  });

  it("excludes denied burst items", () => {
    const items = parseResolvedBurstItems(QUEUE_WITH_DENIED_BURST);
    const executable = findExecutableBursts(items);
    expect(executable).toHaveLength(0);
  });

  it("returns only un-executed from mixed list", () => {
    const items = parseResolvedBurstItems(QUEUE_WITH_MULTIPLE_BURSTS);
    const executable = findExecutableBursts(items);
    expect(executable).toHaveLength(1);
    expect(executable[0].maxSessions).toBe(3);
  });
});

// ── markBurstExecuted ─────────────────────────────────────────────────────

describe("markBurstExecuted", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "burst-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("adds Executed marker to a resolved burst item", async () => {
    const queuePath = join(tmpDir, "APPROVAL_QUEUE.md");
    await writeFile(queuePath, QUEUE_WITH_APPROVED_BURST);

    const items = parseResolvedBurstItems(QUEUE_WITH_APPROVED_BURST);
    await markBurstExecuted(tmpDir, items[0]);

    const updated = await readFile(queuePath, "utf-8");
    expect(updated).toContain("Executed: ");
    // Verify the item is now marked as executed on re-parse
    const reItems = parseResolvedBurstItems(updated);
    expect(reItems[0].executed).toBe(true);
  });

  it("does not modify other resolved items", async () => {
    const queuePath = join(tmpDir, "APPROVAL_QUEUE.md");
    await writeFile(queuePath, QUEUE_WITH_APPROVED_BURST);

    const items = parseResolvedBurstItems(QUEUE_WITH_APPROVED_BURST);
    await markBurstExecuted(tmpDir, items[0]);

    const updated = await readFile(queuePath, "utf-8");
    // The LaTeX item should still be intact
    expect(updated).toContain("Tool access: LaTeX compiler");
  });

  it("is idempotent — does not double-add Executed marker", async () => {
    const queuePath = join(tmpDir, "APPROVAL_QUEUE.md");
    await writeFile(queuePath, QUEUE_WITH_APPROVED_BURST);

    const items = parseResolvedBurstItems(QUEUE_WITH_APPROVED_BURST);
    await markBurstExecuted(tmpDir, items[0]);
    // Mark again
    const updated1 = await readFile(queuePath, "utf-8");
    const reItems = parseResolvedBurstItems(updated1);
    await markBurstExecuted(tmpDir, reItems[0]);

    const updated2 = await readFile(queuePath, "utf-8");
    const matches = updated2.match(/Executed:/g);
    expect(matches).toHaveLength(1);
  });
});
