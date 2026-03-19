/** Tests for approval-related verification functions in verify.ts. */

import { describe, it, expect } from "vitest";
import { extractApprovalNeededTasks, extractPendingApprovalTitles, extractDeniedApprovalTitles, extractApprovedApprovalTitles, extractBlockedByExternalTags, blockerMatchesCompletedTask, findCompletedBlockerMatches, checkRepoStaleness } from "./verify.js";
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

describe("extractApprovalNeededTasks", () => {
  it("extracts lines with [approval-needed] tag", () => {
    const content = `# Tasks

- [ ] Task without tag
- [ ] Task with tag [approval-needed]
- [ ] Another tagged task [zero-resource] [approval-needed]
- [x] Completed task
`;
    const result = extractApprovalNeededTasks(content);
    expect(result).toHaveLength(2);
    expect(result[0]).toContain("Task with tag");
    expect(result[1]).toContain("Another tagged task");
  });

  it("extracts heading lines with [approval-needed]", () => {
    const content = `### Youji: Phase 3 — Publication [approval-needed]

- [ ] Create public repo [approval-needed]
`;
    const result = extractApprovalNeededTasks(content);
    expect(result).toHaveLength(2);
  });

  it("returns empty array when no tags present", () => {
    const content = `# Tasks

- [ ] Normal task
- [x] Done task
`;
    const result = extractApprovalNeededTasks(content);
    expect(result).toEqual([]);
  });

  it("returns empty array for empty content", () => {
    expect(extractApprovalNeededTasks("")).toEqual([]);
  });
});

describe("extractPendingApprovalTitles", () => {
  it("extracts titles from Pending section", () => {
    const content = `# Approval Queue

## Pending

### 2026-02-27 — Adopt ADR 0042-v2: Persistent Subagent Fleet
Project: youji
Type: structural

### 2026-02-25 — Production PR: feature-xyz integration
Project: sample-project
Type: production-pr-request

## Resolved

### 2026-02-26 — Burst mode
Decision: approved
`;
    const result = extractPendingApprovalTitles(content);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe("adopt adr 0042-v2: persistent subagent fleet");
    expect(result[1]).toBe("production pr: feature-xyz integration");
  });

  it("stops at Resolved section", () => {
    const content = `## Pending

### 2026-02-27 — Pending item
Project: youji

## Resolved

### 2026-02-26 — Resolved item
Decision: approved
`;
    const result = extractPendingApprovalTitles(content);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe("pending item");
  });

  it("returns empty array when no pending items", () => {
    const content = `## Pending

## Resolved

### 2026-02-26 — Some resolved item
Decision: approved
`;
    const result = extractPendingApprovalTitles(content);
    expect(result).toEqual([]);
  });

  it("returns empty array for empty content", () => {
    expect(extractPendingApprovalTitles("")).toEqual([]);
  });

  it("handles content without Pending section", () => {
    const content = `# Approval Queue

Just some text.
`;
    const result = extractPendingApprovalTitles(content);
    expect(result).toEqual([]);
  });
});

describe("extractDeniedApprovalTitles", () => {
  it("extracts titles with Decision: denied from Resolved section", () => {
    const content = `# Approval Queue

## Pending

### 2026-02-27 — Pending item

## Resolved

### 2026-02-26 — Denied item one
Decision: denied
By: human

### 2026-02-25 — Approved item
Decision: approved

### 2026-02-24 — Denied item two
Decision: denied
Notes: rejected by user
`;
    const result = extractDeniedApprovalTitles(content);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe("denied item one");
    expect(result[1]).toBe("denied item two");
  });

  it("ignores approved items", () => {
    const content = `## Resolved

### 2026-02-26 — Approved item
Decision: approved

### 2026-02-25 — Another approved
Decision: approved
`;
    const result = extractDeniedApprovalTitles(content);
    expect(result).toEqual([]);
  });

  it("returns empty array when no denied items", () => {
    const content = `## Resolved

### 2026-02-26 — Some item
Decision: approved
`;
    expect(extractDeniedApprovalTitles(content)).toEqual([]);
  });

  it("returns empty array for empty content", () => {
    expect(extractDeniedApprovalTitles("")).toEqual([]);
  });

  it("handles content without Resolved section", () => {
    const content = `## Pending

### 2026-02-27 — Pending item
`;
    expect(extractDeniedApprovalTitles(content)).toEqual([]);
  });

  it("is case-insensitive for Decision field", () => {
    const content = `## Resolved

### 2026-02-26 — Denied item
Decision: DENIED
`;
    const result = extractDeniedApprovalTitles(content);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe("denied item");
  });
});

describe("extractApprovedApprovalTitles", () => {
  it("extracts titles with Decision: approved from Resolved section", () => {
    const content = `# Approval Queue

## Pending

### 2026-02-27 — Pending item

## Resolved

### 2026-02-26 — Approved item one
Decision: approved
By: human

### 2026-02-25 — Denied item
Decision: denied

### 2026-02-24 — Approved item two
Decision: approved
Notes: approved by PI
`;
    const result = extractApprovedApprovalTitles(content);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe("approved item one");
    expect(result[1]).toBe("approved item two");
  });

  it("ignores denied items", () => {
    const content = `## Resolved

### 2026-02-26 — Denied item
Decision: denied

### 2026-02-25 — Another denied
Decision: denied
`;
    const result = extractApprovedApprovalTitles(content);
    expect(result).toEqual([]);
  });

  it("returns empty array when no approved items", () => {
    const content = `## Resolved

### 2026-02-26 — Some item
Decision: denied
`;
    expect(extractApprovedApprovalTitles(content)).toEqual([]);
  });

  it("returns empty array for empty content", () => {
    expect(extractApprovedApprovalTitles("")).toEqual([]);
  });

  it("handles content without Resolved section", () => {
    const content = `## Pending

### 2026-02-27 — Pending item
`;
    expect(extractApprovedApprovalTitles(content)).toEqual([]);
  });

  it("is case-insensitive for Decision field", () => {
    const content = `## Resolved

### 2026-02-26 — Approved item
Decision: APPROVED
`;
    const result = extractApprovedApprovalTitles(content);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe("approved item");
  });
});

describe("stale approval-needed tag detection (integration)", () => {
  it("detects [approval-needed] task with matching approved resolution", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "stale-approval-"));
    const projectDir = join(tmpDir, "projects", "test-proj");
    await mkdir(projectDir, { recursive: true });

    const tasksContent = `# Test Tasks

- [ ] Create public repository [requires-opus] [approval-needed]
  Done when: Public repo exists.
`;
    await writeFile(join(projectDir, "TASKS.md"), tasksContent);

    const approvalContent = `# Approval Queue

## Pending

## Resolved

### 2026-02-27 — Create public repository
Decision: approved
By: human
Date: 2026-02-27
`;
    await writeFile(join(tmpDir, "APPROVAL_QUEUE.md"), approvalContent);

    const result = await checkRepoStaleness(tmpDir);
    const staleWarning = result.find((w) => w.detail.includes("Stale approval tag"));
    expect(staleWarning).toBeDefined();
    expect(staleWarning?.detail).toContain("approved in APPROVAL_QUEUE.md");
    expect(staleWarning?.detail).toContain("Create public repository");

    await rm(tmpDir, { recursive: true });
  });

  it("does not flag [approval-needed] with matching pending entry", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "stale-approval-pending-"));
    const projectDir = join(tmpDir, "projects", "test-proj");
    await mkdir(projectDir, { recursive: true });

    const tasksContent = `# Test Tasks

- [ ] Submit paper for review [requires-opus] [approval-needed]
  Done when: Paper submitted.
`;
    await writeFile(join(projectDir, "TASKS.md"), tasksContent);

    const approvalContent = `# Approval Queue

## Pending

### 2026-03-01 — Submit paper for review
Project: test-proj
Type: external

## Resolved
`;
    await writeFile(join(tmpDir, "APPROVAL_QUEUE.md"), approvalContent);

    const result = await checkRepoStaleness(tmpDir);
    const staleWarning = result.find((w) => w.detail.includes("Stale approval tag"));
    expect(staleWarning).toBeUndefined();
    const orphanedWarning = result.find((w) => w.detail.includes("Orphaned"));
    expect(orphanedWarning).toBeUndefined();

    await rm(tmpDir, { recursive: true });
  });

  it("prefers denied warning over stale-approved warning", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "stale-approval-denied-"));
    const projectDir = join(tmpDir, "projects", "test-proj");
    await mkdir(projectDir, { recursive: true });

    const tasksContent = `# Test Tasks

- [ ] Increase budget limits [requires-opus] [approval-needed]
  Done when: Budget increased.
`;
    await writeFile(join(projectDir, "TASKS.md"), tasksContent);

    const approvalContent = `# Approval Queue

## Pending

## Resolved

### 2026-02-28 — Increase budget limits
Decision: denied
By: human
`;
    await writeFile(join(tmpDir, "APPROVAL_QUEUE.md"), approvalContent);

    const result = await checkRepoStaleness(tmpDir);
    const deniedWarning = result.find((w) => w.detail.includes("Denied approval still tagged"));
    expect(deniedWarning).toBeDefined();
    const staleWarning = result.find((w) => w.detail.includes("Stale approval tag"));
    expect(staleWarning).toBeUndefined();

    await rm(tmpDir, { recursive: true });
  });
});

describe("extractBlockedByExternalTags", () => {
  it("detects [blocked-by: external:] tag in TASKS.md diff", () => {
    const diff = `diff --git a/projects/tree-gen-project/TASKS.md b/projects/tree-gen-project/TASKS.md
@@ -5 +5 @@
+- [ ] Some task [blocked-by: external: waiting for human researcher]
`;
    const result = extractBlockedByExternalTags(diff);
    expect(result).toHaveLength(1);
    expect(result[0].blockerDesc).toBe("waiting for human researcher");
    expect(result[0].projectName).toBe("tree-gen-project");
  });

  it("detects multiple external blockers", () => {
    const diff = `diff --git a/projects/youji/TASKS.md b/projects/youji/TASKS.md
@@ -5 +5 @@
+- [ ] Task one [blocked-by: external: need API key]
+- [ ] Task two [blocked-by: external: waiting for review]
`;
    const result = extractBlockedByExternalTags(diff);
    expect(result).toHaveLength(2);
    expect(result[0].blockerDesc).toBe("need API key");
    expect(result[1].blockerDesc).toBe("waiting for review");
  });

  it("ignores regular blocked-by tags (non-external)", () => {
    const diff = `diff --git a/projects/youji/TASKS.md b/projects/youji/TASKS.md
@@ -5 +5 @@
+- [ ] Some task [blocked-by: another task]
`;
    const result = extractBlockedByExternalTags(diff);
    expect(result).toHaveLength(0);
  });

  it("ignores removed lines (starting with -)", () => {
    const diff = `diff --git a/projects/youji/TASKS.md b/projects/youji/TASKS.md
@@ -5 +5 @@
-- [ ] Some task [blocked-by: external: old blocker]
+- [ ] Some task
`;
    const result = extractBlockedByExternalTags(diff);
    expect(result).toHaveLength(0);
  });

  it("returns empty for empty diff", () => {
    expect(extractBlockedByExternalTags("")).toHaveLength(0);
  });

  it("handles already-completed tasks with external blockers", () => {
    const diff = `diff --git a/projects/youji/TASKS.md b/projects/youji/TASKS.md
@@ -5 +5 @@
+- [x] Completed task [blocked-by: external: resolved]
`;
    const result = extractBlockedByExternalTags(diff);
    expect(result).toHaveLength(1);
    expect(result[0].blockerDesc).toBe("resolved");
  });
});

describe("blockerMatchesCompletedTask", () => {
  it("matches when blocker text is substring of completed task", () => {
    expect(
      blockerMatchesCompletedTask(
        "ScoringService",
        "Implement ScoringService class with CSV loading and aggregation methods [fleet-eligible]",
      ),
    ).toBe(true);
  });

  it("matches on keyword overlap (multiple significant words)", () => {
    expect(
      blockerMatchesCompletedTask(
        "scoring pipeline implementation",
        "Implement scoring pipeline with batch processing [fleet-eligible]",
      ),
    ).toBe(true);
  });

  it("does not match unrelated tasks", () => {
    expect(
      blockerMatchesCompletedTask(
        "prior experiment analysis",
        "Implement ScoringService class with CSV loading [fleet-eligible]",
      ),
    ).toBe(false);
  });

  it("does not match when only 1 word overlaps", () => {
    expect(
      blockerMatchesCompletedTask(
        "design abstraction",
        "Implement backend service [fleet-eligible]",
      ),
    ).toBe(false);
  });

  it("does not match on short substring (<5 chars)", () => {
    expect(
      blockerMatchesCompletedTask(
        "test",
        "Write unit tests for ScoringService [fleet-eligible]",
      ),
    ).toBe(false);
  });
});

describe("findCompletedBlockerMatches", () => {
  it("detects blocked task with completed blocker", () => {
    const blocked = [
      {
        project: "sample-project",
        taskText: "Implement dashboard frontend page",
        blockerDesc: "ScoringService implementation",
      },
    ];
    const completed = [
      {
        project: "sample-project",
        taskText: "Implement ScoringService class with CSV loading and aggregation methods [fleet-eligible]",
      },
    ];
    const warnings = findCompletedBlockerMatches(blocked, completed);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].type).toBe("completed_blocker");
    expect(warnings[0].file).toBe("projects/sample-project/TASKS.md");
    expect(warnings[0].detail).toContain("ScoringService");
    expect(warnings[0].detail).toContain("[x] completed");
  });

  it("does not warn for valid open blocker", () => {
    const blocked = [
      {
        project: "sample-project",
        taskText: "Implement dashboard frontend page",
        blockerDesc: "UI design spec",
      },
    ];
    const completed = [
      {
        project: "sample-project",
        taskText: "Define scoring criteria [fleet-eligible]",
      },
    ];
    const warnings = findCompletedBlockerMatches(blocked, completed);
    expect(warnings).toHaveLength(0);
  });

  it("does not warn when no completed tasks exist", () => {
    const blocked = [
      {
        project: "sample-project",
        taskText: "Build dashboard",
        blockerDesc: "backend service",
      },
    ];
    const warnings = findCompletedBlockerMatches(blocked, []);
    expect(warnings).toHaveLength(0);
  });

  it("matches completed tasks from different projects", () => {
    const blocked = [
      {
        project: "bench-project",
        taskText: "Calibrate metric output",
        blockerDesc: "ordinal ratings from human researchers",
      },
    ];
    const completed = [
      {
        project: "sample-benchmark",
        taskText: "Collect ordinal ratings from human researchers for benchmark calibration",
      },
    ];
    const warnings = findCompletedBlockerMatches(blocked, completed);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].detail).toContain("sample-benchmark");
  });
});

describe("checkCompletedBlockerTags (integration)", () => {
  it("detects completed blocker via file scan", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "completed-blocker-"));
    const projectDir = join(tmpDir, "projects", "test-proj");
    await mkdir(projectDir, { recursive: true });

    const tasksContent = `# Test Tasks

- [x] Implement ScoringService class [fleet-eligible]
  Done when: Service exists.
  Completed: 2026-03-02

- [ ] Implement dashboard frontend page [fleet-eligible]
  [blocked-by: ScoringService implementation]
  Done when: Dashboard renders.
`;
    await writeFile(join(projectDir, "TASKS.md"), tasksContent);

    const result = await checkRepoStaleness(tmpDir);
    expect(result.some((w) => w.type === "completed_blocker")).toBe(true);
    const blockerWarning = result.find((w) => w.type === "completed_blocker");
    expect(blockerWarning?.detail).toContain("ScoringService");

    await rm(tmpDir, { recursive: true });
  });

  it("does not trigger for external blockers", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "completed-blocker-ext-"));
    const projectDir = join(tmpDir, "projects", "test-proj");
    await mkdir(projectDir, { recursive: true });

    const tasksContent = `# Test Tasks

- [x] Implement some feature [fleet-eligible]
  Completed: 2026-03-02

- [ ] Run experiment on test set [fleet-eligible]
  [blocked-by: external: human researcher review pending since 2026-02-25]
  Done when: Evaluation complete.
`;
    await writeFile(join(projectDir, "TASKS.md"), tasksContent);

    const result = await checkRepoStaleness(tmpDir);
    expect(result.some((w) => w.type === "completed_blocker")).toBe(false);

    await rm(tmpDir, { recursive: true });
  });

  it("checks archived completed-tasks.md for matches", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "completed-blocker-archive-"));
    const projectDir = join(tmpDir, "projects", "test-proj");
    await mkdir(projectDir, { recursive: true });

    const tasksContent = `# Test Tasks

- [ ] Build dashboard [fleet-eligible]
  [blocked-by: scoring pipeline implementation]
  Done when: Dashboard works.
`;
    const completedTasks = `# Completed Tasks

- [x] Implement scoring pipeline with batch processing [fleet-eligible]
  Completed: 2026-03-01
`;
    await writeFile(join(projectDir, "TASKS.md"), tasksContent);
    await writeFile(join(projectDir, "completed-tasks.md"), completedTasks);

    const result = await checkRepoStaleness(tmpDir);
    expect(result.some((w) => w.type === "completed_blocker")).toBe(true);

    await rm(tmpDir, { recursive: true });
  });
});
