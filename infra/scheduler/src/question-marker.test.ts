/** Tests for question marker protocol — enables skills to post questions to Slack
 *  and end session, with continuation detection when user replies. */

import { describe, it, expect, beforeEach } from "vitest";
import {
  formatQuestionMarker,
  parseQuestionMarker,
  isWaitingForAnswer,
  setPendingQuestion,
  clearPendingQuestion,
  getPendingQuestion,
} from "./question-marker.js";

describe("formatQuestionMarker", () => {
  it("creates a properly formatted question marker", () => {
    const result = formatQuestionMarker("proj-abc-123", [
      "What is the research question?",
      "What are the success criteria?",
    ]);
    expect(result).toContain("[QUESTION: proj-abc-123]");
    expect(result).toContain("[/QUESTION]");
    expect(result).toContain("What is the research question?");
    expect(result).toContain("What are the success criteria?");
  });

  it("escapes closing tag in question content", () => {
    const result = formatQuestionMarker("id-1", [
      "Question with [/QUESTION] in it",
    ]);
    expect(result).not.toContain("Question with [/QUESTION] in it");
    expect(result).toContain("Question with [\\/QUESTION] in it");
  });

  it("includes metadata when provided", () => {
    const result = formatQuestionMarker(
      "proj-xyz",
      ["What is the goal?"],
      { skillName: "project", mode: "scaffold" },
    );
    expect(result).toContain('skill="project"');
    expect(result).toContain('mode="scaffold"');
  });
});

describe("parseQuestionMarker", () => {
  it("extracts question ID and content from valid marker", () => {
    const text = "Some text before\n[QUESTION: test-123]\nWhat is your goal?\n[/QUESTION]\nMore text";
    const result = parseQuestionMarker(text);
    expect(result).not.toBeNull();
    expect(result!.questionId).toBe("test-123");
    expect(result!.questions).toEqual(["What is your goal?"]);
  });

  it("extracts multiple questions separated by blank lines", () => {
    const text = "[QUESTION: multi-456]\nQ1: What?\n\nQ2: Why?\n\nQ3: How?\n[/QUESTION]";
    const result = parseQuestionMarker(text);
    expect(result).not.toBeNull();
    expect(result!.questions).toHaveLength(3);
    expect(result!.questions[0]).toBe("Q1: What?");
    expect(result!.questions[1]).toBe("Q2: Why?");
    expect(result!.questions[2]).toBe("Q3: How?");
  });

  it("returns null when no marker found", () => {
    const result = parseQuestionMarker("Just some text without markers");
    expect(result).toBeNull();
  });

  it("handles markers at the end of text", () => {
    const text = "Leading text\n[QUESTION: end-789]\nFinal question?\n[/QUESTION]";
    const result = parseQuestionMarker(text);
    expect(result).not.toBeNull();
    expect(result!.questionId).toBe("end-789");
  });

  it("extracts metadata from marker", () => {
    const text = '[QUESTION: meta-1]\nskill="project"\nmode="scaffold"\n\nWhat is the goal?\n[/QUESTION]';
    const result = parseQuestionMarker(text);
    expect(result).not.toBeNull();
    expect(result!.skillName).toBe("project");
    expect(result!.mode).toBe("scaffold");
  });
});

describe("pending question storage", () => {
  beforeEach(() => {
    // Clear all pending questions before each test by clearing the internal map
    // We can't iterate over the map directly from tests, so we just clear known keys
    clearPendingQuestion("C123:thread-abc");
    clearPendingQuestion("C123:thread-clear");
    clearPendingQuestion("C123:thread-wait");
    clearPendingQuestion("C123:thread-old");
  });

  it("stores and retrieves pending questions by thread key", () => {
    setPendingQuestion("C123:thread-abc", {
      questionId: "proj-xyz",
      skillName: "project",
      mode: "scaffold",
      questions: ["What is the goal?"],
      partialState: { description: "test project" },
      askedAt: Date.now(),
    });

    const pending = getPendingQuestion("C123:thread-abc");
    expect(pending).not.toBeNull();
    expect(pending!.questionId).toBe("proj-xyz");
    expect(pending!.skillName).toBe("project");
  });

  it("clears pending questions", () => {
    setPendingQuestion("C123:thread-clear", {
      questionId: "test",
      skillName: "test",
      mode: "test",
      questions: ["Q?"],
      partialState: {},
      askedAt: Date.now(),
    });

    clearPendingQuestion("C123:thread-clear");
    expect(getPendingQuestion("C123:thread-clear")).toBeNull();
  });

  it("returns null for non-existent thread", () => {
    expect(getPendingQuestion("nonexistent-thread")).toBeNull();
  });
});

describe("isWaitingForAnswer", () => {
  it("returns true when pending question exists and not timed out", () => {
    setPendingQuestion("C123:thread-wait", {
      questionId: "wait-1",
      skillName: "project",
      mode: "scaffold",
      questions: ["Q?"],
      partialState: {},
      askedAt: Date.now(),
    });

    expect(isWaitingForAnswer("C123:thread-wait")).toBe(true);
  });

  it("returns false when pending question has timed out (30 min)", () => {
    const oldTime = Date.now() - 31 * 60 * 1000; // 31 minutes ago
    setPendingQuestion("C123:thread-old", {
      questionId: "old-1",
      skillName: "project",
      mode: "scaffold",
      questions: ["Q?"],
      partialState: {},
      askedAt: oldTime,
    });

    expect(isWaitingForAnswer("C123:thread-old")).toBe(false);
  });

  it("returns false when no pending question", () => {
    expect(isWaitingForAnswer("no-question-thread")).toBe(false);
  });
});
