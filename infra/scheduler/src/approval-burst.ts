/** Approval-triggered burst mode — detect approved burst requests and launch them. */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface ResolvedBurstItem {
  date: string;
  title: string;
  decision: "approved" | "denied" | string;
  job: string;
  maxSessions: number;
  maxCost: number;
  autofix: boolean;
  autofixRetries: number;
  executed: boolean;
  /** The raw text block from the Resolved section, used for write-back. */
  rawBlock: string;
}

/**
 * Parse the Resolved section of APPROVAL_QUEUE.md for burst-type items.
 * Only items with `Type: burst` are returned.
 */
export function parseResolvedBurstItems(content: string): ResolvedBurstItem[] {
  const resolvedMatch = content.match(/## Resolved\n([\s\S]*?)$/);
  if (!resolvedMatch) return [];

  const resolvedSection = resolvedMatch[1];
  const blocks = resolvedSection
    .split(/(?=^### )/m)
    .filter((b) => b.trim().startsWith("### "));

  const items: ResolvedBurstItem[] = [];
  for (const block of blocks) {
    const field = (name: string): string | undefined => {
      const m = block.match(new RegExp(`^${name}: (.+)$`, "m"));
      return m ? m[1].trim() : undefined;
    };

    const type = field("Type");
    if (type !== "burst") continue;

    const headerMatch = block.match(/^### (\d{4}-\d{2}-\d{2}) — (.+)/);
    if (!headerMatch) continue;

    const job = field("Job");
    const maxSessions = field("Max-sessions");
    const maxCost = field("Max-cost");
    if (!job || !maxSessions || !maxCost) continue;

    const autofixRaw = field("Autofix");
    const autofixRetriesRaw = field("Autofix-retries");

    items.push({
      date: headerMatch[1],
      title: headerMatch[2].trim(),
      decision: field("Decision") ?? "unknown",
      job,
      maxSessions: parseInt(maxSessions, 10),
      maxCost: parseFloat(maxCost),
      autofix: autofixRaw === "true",
      autofixRetries: autofixRetriesRaw ? parseInt(autofixRetriesRaw, 10) : 3,
      executed: !!field("Executed"),
      rawBlock: block,
    });
  }

  return items;
}

/** Filter burst items to those that are approved and not yet executed. */
export function findExecutableBursts(items: ResolvedBurstItem[]): ResolvedBurstItem[] {
  return items.filter((item) => item.decision === "approved" && !item.executed);
}

/** Add an `Executed: YYYY-MM-DD` marker to a resolved burst item in APPROVAL_QUEUE.md. */
export async function markBurstExecuted(
  repoDir: string,
  item: ResolvedBurstItem,
): Promise<void> {
  if (item.executed) return;

  const queuePath = join(repoDir, "APPROVAL_QUEUE.md");
  const content = await readFile(queuePath, "utf-8");

  const today = new Date().toISOString().slice(0, 10);
  const marker = `Executed: ${today}`;

  const augmented = item.rawBlock.trimEnd() + `\n${marker}\n`;
  const updated = content.replace(item.rawBlock, augmented);

  await writeFile(queuePath, updated, "utf-8");
}

/**
 * Read APPROVAL_QUEUE.md and return burst items ready for execution.
 * Returns an empty array if no queue file exists or no executable bursts are found.
 */
export async function getExecutableBursts(repoDir: string): Promise<ResolvedBurstItem[]> {
  let content: string;
  try {
    content = await readFile(join(repoDir, "APPROVAL_QUEUE.md"), "utf-8");
  } catch {
    return [];
  }
  const items = parseResolvedBurstItems(content);
  return findExecutableBursts(items);
}
