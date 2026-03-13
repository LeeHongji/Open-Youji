/**
 * TASKS.md parser — extracts structured tasks from markdown task files.
 */

import { createHash } from 'node:crypto';
import type { FleetTask } from './types.js';

/** Generate a stable ID from task text. */
export function taskId(text: string): string {
  return createHash('sha256').update(text.trim().toLowerCase()).digest('hex').slice(0, 12);
}

/** Parse a TASKS.md string into structured tasks. */
export function parseTasks(content: string, project: string): FleetTask[] {
  const tasks: FleetTask[] = [];
  const lines = content.split('\n');

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const match = line.match(/^- \[([ x])\] (.+)$/);

    if (match) {
      const completed = match[1] === 'x';
      if (completed) {
        i++;
        continue;
      }

      const rawText = match[2].trim();

      // Extract tags like [fleet-eligible], [requires-opus], etc.
      const tagRegex = /\[([^\]]+)\]/g;
      const tags: string[] = [];
      let tagMatch;
      while ((tagMatch = tagRegex.exec(rawText)) !== null) {
        tags.push(tagMatch[1]);
      }

      // Clean text: remove tags for display
      const text = rawText.replace(/\s*\[[^\]]+\]/g, '').trim();

      // Parse continuation lines (Why, Done when, Priority)
      let why: string | undefined;
      let doneWhen: string | undefined;
      let priority: FleetTask['priority'] = 'none';

      let j = i + 1;
      while (j < lines.length) {
        const contLine = lines[j].trim();
        if (contLine.startsWith('- [') || contLine.startsWith('#') || contLine === '') {
          break;
        }
        if (contLine.startsWith('Why:')) {
          why = contLine.slice(4).trim();
        } else if (contLine.startsWith('Done when:')) {
          doneWhen = contLine.slice(10).trim();
        } else if (contLine.startsWith('Priority:')) {
          const p = contLine.slice(9).trim().toLowerCase();
          if (p === 'high' || p === 'medium' || p === 'low') {
            priority = p;
          }
        }
        j++;
      }

      tasks.push({
        id: taskId(text),
        text,
        project,
        priority,
        doneWhen,
        why,
        tags,
      });

      i = j;
    } else {
      i++;
    }
  }

  return tasks;
}

/** Check if a task is eligible for fleet assignment. */
export function isFleetEligible(task: FleetTask): boolean {
  // Explicitly blocked
  if (task.tags.some(t => t.startsWith('blocked-by:'))) return false;
  if (task.tags.some(t => t.startsWith('in-progress:'))) return false;
  if (task.tags.includes('approval-needed')) return false;

  // Explicitly requires opus
  if (task.tags.includes('requires-opus')) return false;

  return true;
}
