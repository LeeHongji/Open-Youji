/** Tests for session summary footer validation in verify.ts. */

import { describe, it, expect } from "vitest";
import { parseSessionFooter, validateSessionFooter, REQUIRED_FOOTER_FIELDS } from "./verify.js";

describe("REQUIRED_FOOTER_FIELDS", () => {
  it("contains all 10 SOP-mandated fields", () => {
    expect(REQUIRED_FOOTER_FIELDS).toEqual([
      "Session-type",
      "Duration",
      "Task-selected",
      "Task-completed",
      "Approvals-created",
      "Files-changed",
      "Commits",
      "Compound-actions",
      "Resources-consumed",
      "Budget-remaining",
    ]);
  });
});

describe("parseSessionFooter", () => {
  it("extracts footer fields from a fenced code block", () => {
    const content = `### 2026-02-17 — Session summary

Some log text here.

\`\`\`
Session-type: autonomous
Duration: 15
Task-selected: fix the widget
Task-completed: yes
Approvals-created: 0
Files-changed: 3
Commits: 1
Compound-actions: none
Resources-consumed: none
Budget-remaining: n/a
\`\`\`
`;
    const fields = parseSessionFooter(content);
    expect(fields).not.toBeNull();
    expect(fields!.get("Session-type")).toBe("autonomous");
    expect(fields!.get("Duration")).toBe("15");
    expect(fields!.get("Budget-remaining")).toBe("n/a");
    expect(fields!.size).toBe(10);
  });

  it("returns the FIRST (most recent) footer when multiple fenced blocks exist", () => {
    const content = `### 2026-02-17b — New session (reverse-chronological: newest first)

\`\`\`
Session-type: autonomous
Duration: 25
Task-selected: new task
Task-completed: partial
Approvals-created: 1
Files-changed: 5
Commits: 2
Compound-actions: 1
Resources-consumed: llm_api_calls: 50
Budget-remaining: llm_api_calls: 950/1000
\`\`\`

### 2026-02-17a — Old session

\`\`\`
Session-type: autonomous
Duration: 10
Task-selected: old task
Task-completed: yes
Approvals-created: 0
Files-changed: 2
Commits: 1
Compound-actions: none
Resources-consumed: none
Budget-remaining: n/a
\`\`\`
`;
    const fields = parseSessionFooter(content);
    expect(fields).not.toBeNull();
    expect(fields!.get("Duration")).toBe("25");
    expect(fields!.get("Task-selected")).toBe("new task");
    expect(fields!.get("Task-completed")).toBe("partial");
  });

  it("returns null when no session footer exists", () => {
    const content = `### 2026-02-17

Just a regular log entry with no footer.

Sources: none
`;
    const fields = parseSessionFooter(content);
    expect(fields).toBeNull();
  });

  it("returns null for a code block without Session-type", () => {
    const content = `### 2026-02-17

\`\`\`python
print("hello")
\`\`\`
`;
    const fields = parseSessionFooter(content);
    expect(fields).toBeNull();
  });

  it("handles values with colons (e.g. budget remaining)", () => {
    const content = `\`\`\`
Session-type: autonomous
Duration: 20
Task-selected: optimize pipeline
Task-completed: yes
Approvals-created: 0
Files-changed: 4
Commits: 1
Compound-actions: none
Resources-consumed: simulation_calls: 60, cost_units: 300
Budget-remaining: simulation_calls: 119/300, cost_units: 52/800
\`\`\`
`;
    const fields = parseSessionFooter(content);
    expect(fields).not.toBeNull();
    expect(fields!.get("Resources-consumed")).toBe("simulation_calls: 60, cost_units: 300");
    expect(fields!.get("Budget-remaining")).toBe("simulation_calls: 119/300, cost_units: 52/800");
  });

  it("extracts unfenced footer (plain text key-value lines)", () => {
    const content = `### 2026-02-25 — Session summary

Some log text here.

Sources: commit abc123

Session-type: autonomous
Duration: 12
Task-selected: fix the widget
Task-completed: yes
Approvals-created: 0
Files-changed: 4
Commits: 2
Compound-actions: none
Resources-consumed: none
Budget-remaining: n/a

### 2026-02-24 — Old entry
`;
    const fields = parseSessionFooter(content);
    expect(fields).not.toBeNull();
    expect(fields!.get("Session-type")).toBe("autonomous");
    expect(fields!.get("Duration")).toBe("12");
    expect(fields!.get("Budget-remaining")).toBe("n/a");
    expect(fields!.size).toBe(10);
  });

  it("prefers unfenced footer that appears earlier over fenced footer that appears later", () => {
    const content = `### 2026-02-25 — Newest session (unfenced)

Session-type: autonomous
Duration: 20
Task-selected: new unfenced task
Task-completed: yes
Approvals-created: 0
Files-changed: 6
Commits: 3
Compound-actions: 1
Resources-consumed: none
Budget-remaining: n/a

### 2026-02-24 — Older session (fenced)

\`\`\`
Session-type: autonomous
Duration: 10
Task-selected: old fenced task
Task-completed: yes
Approvals-created: 0
Files-changed: 2
Commits: 1
Compound-actions: none
Resources-consumed: none
Budget-remaining: n/a
\`\`\`
`;
    const fields = parseSessionFooter(content);
    expect(fields).not.toBeNull();
    expect(fields!.get("Task-selected")).toBe("new unfenced task");
    expect(fields!.get("Duration")).toBe("20");
  });

  it("stops unfenced footer at blank line", () => {
    const content = `Session-type: autonomous
Duration: 15
Task-selected: test

Approvals-created: 0
`;
    const fields = parseSessionFooter(content);
    expect(fields).not.toBeNull();
    expect(fields!.size).toBe(3);
    expect(fields!.has("Approvals-created")).toBe(false);
  });

  it("stops unfenced footer at heading", () => {
    const content = `Session-type: autonomous
Duration: 15

### Next section
`;
    const fields = parseSessionFooter(content);
    expect(fields).not.toBeNull();
    expect(fields!.size).toBe(2);
  });

  it("does not detect unfenced footer inside a fenced block as unfenced", () => {
    const content = `\`\`\`
Session-type: autonomous
Duration: 10
Task-selected: fenced task
Task-completed: yes
Approvals-created: 0
Files-changed: 2
Commits: 1
Compound-actions: none
Resources-consumed: none
Budget-remaining: n/a
\`\`\`
`;
    const fields = parseSessionFooter(content);
    expect(fields).not.toBeNull();
    expect(fields!.get("Task-selected")).toBe("fenced task");
    // Should find exactly one footer (fenced), not two
  });

  it("handles tilde-fenced code blocks", () => {
    const content = `~~~
Session-type: autonomous
Duration: 10
Task-selected: test
Task-completed: yes
Approvals-created: 0
Files-changed: 1
Commits: 1
Compound-actions: none
Resources-consumed: none
Budget-remaining: n/a
~~~
`;
    const fields = parseSessionFooter(content);
    expect(fields).not.toBeNull();
    expect(fields!.get("Session-type")).toBe("autonomous");
  });
});

describe("validateSessionFooter", () => {
  it("returns no missing fields for a complete footer", () => {
    const content = `\`\`\`
Session-type: autonomous
Duration: 15
Task-selected: fix bug
Task-completed: yes
Approvals-created: 0
Files-changed: 3
Commits: 1
Compound-actions: none
Resources-consumed: none
Budget-remaining: n/a
\`\`\`
`;
    const missing = validateSessionFooter(content);
    expect(missing).toEqual([]);
  });

  it("returns missing fields when footer is incomplete", () => {
    const content = `\`\`\`
Session-type: autonomous
Duration: 15
Task-selected: fix bug
Task-completed: yes
Approvals-created: 0
Files-changed: 3
Commits: 1
Resources-consumed: none
\`\`\`
`;
    const missing = validateSessionFooter(content);
    expect(missing).toContain("Compound-actions");
    expect(missing).toContain("Budget-remaining");
    expect(missing).toHaveLength(2);
  });

  it("returns null when no footer is found (no code block to validate)", () => {
    const content = `### 2026-02-17

Just text, no footer.
`;
    const missing = validateSessionFooter(content);
    expect(missing).toBeNull();
  });

  it("validates an unfenced complete footer", () => {
    const content = `### 2026-02-25 — Session

Some text.

Session-type: autonomous
Duration: 15
Task-selected: fix bug
Task-completed: yes
Approvals-created: 0
Files-changed: 3
Commits: 1
Compound-actions: none
Resources-consumed: none
Budget-remaining: n/a

### Older entry
`;
    const missing = validateSessionFooter(content);
    expect(missing).toEqual([]);
  });

  it("detects missing fields in unfenced footer", () => {
    const content = `Session-type: autonomous
Duration: 15
Task-selected: fix bug
Task-completed: yes
Approvals-created: 0
Files-changed: 3
Commits: 1
Resources-consumed: none
`;
    const missing = validateSessionFooter(content);
    expect(missing).toContain("Compound-actions");
    expect(missing).toContain("Budget-remaining");
    expect(missing).toHaveLength(2);
  });

  it("reports all fields missing when footer has only Session-type", () => {
    const content = `\`\`\`
Session-type: autonomous
\`\`\`
`;
    const missing = validateSessionFooter(content);
    expect(missing).not.toBeNull();
    expect(missing).toHaveLength(9);
    expect(missing).not.toContain("Session-type");
  });
});
