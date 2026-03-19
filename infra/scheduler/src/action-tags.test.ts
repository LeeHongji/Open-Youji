/** Tests for action tag parsing, including run_burst. */

import { describe, it, expect } from "vitest";
import { findActionTag, findAllActionTags, eagerlySetPendingAction, buildConfirmPrompt, stripActionTags } from "./action-tags.js";

describe("findActionTag — run_burst", () => {
  it("parses run_burst with all parameters", () => {
    const text = `Starting burst! [ACTION:run_burst job="youji-work-cycle" max_sessions=5 max_cost=15 autofix=true]`;
    const result = findActionTag(text);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("run_burst");
    expect(result!.params.job).toBe("youji-work-cycle");
    expect(result!.params.max_sessions).toBe("5");
    expect(result!.params.max_cost).toBe("15");
    expect(result!.params.autofix).toBe("true");
  });

  it("parses run_burst with only job (uses defaults)", () => {
    const text = `[ACTION:run_burst job="my-job"]`;
    const result = findActionTag(text);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("run_burst");
    expect(result!.params.job).toBe("my-job");
    expect(result!.params.max_sessions).toBe("10");
    expect(result!.params.max_cost).toBe("20");
    expect(result!.params.autofix).toBe("true");
  });

  it("parses run_burst with autofix=false", () => {
    const text = `[ACTION:run_burst job="test-job" max_sessions=3 max_cost=10 autofix=false]`;
    const result = findActionTag(text);
    expect(result).not.toBeNull();
    expect(result!.params.autofix).toBe("false");
  });
});

describe("eagerlySetPendingAction — run_burst", () => {
  it("sets pendingAction for run_burst", () => {
    const parsed = findActionTag(`[ACTION:run_burst job="youji-work-cycle" max_sessions=5 max_cost=15 autofix=true]`);
    const action = eagerlySetPendingAction(parsed!);
    expect(action).not.toBeNull();
    expect(action!.kind).toBe("run_burst");
    expect(action!.jobId).toBe("youji-work-cycle");
    expect(action!.maxSessions).toBe(5);
    expect(action!.maxCost).toBe(15);
    expect(action!.autofix).toBe(true);
  });

  it("defaults autofix to true when not 'false'", () => {
    const parsed = findActionTag(`[ACTION:run_burst job="test"]`);
    const action = eagerlySetPendingAction(parsed!);
    expect(action).not.toBeNull();
    expect(action!.autofix).toBe(true);
  });
});

describe("buildConfirmPrompt — run_burst", () => {
  it("generates confirmation prompt for burst", () => {
    const prompt = buildConfirmPrompt({
      kind: "run_burst",
      jobId: "youji-work-cycle",
      maxSessions: 10,
      maxCost: 20,
      autofix: true,
    });
    expect(prompt).toContain("youji-work-cycle");
    expect(prompt).toContain("10 sessions");
    expect(prompt).toContain("$20");
    expect(prompt).toContain("autofix on");
  });

  it("omits autofix mention when disabled", () => {
    const prompt = buildConfirmPrompt({
      kind: "run_burst",
      jobId: "test-job",
      maxSessions: 5,
      maxCost: 10,
      autofix: false,
    });
    expect(prompt).not.toContain("autofix on");
  });
});

describe("stripActionTags — run_burst", () => {
  it("strips run_burst tags from text", () => {
    const text = `Burst starting! [ACTION:run_burst job="youji-work-cycle" max_sessions=5 max_cost=15 autofix=true]`;
    const stripped = stripActionTags(text);
    expect(stripped).toBe("Burst starting!");
    expect(stripped).not.toContain("ACTION");
  });
});

describe("findActionTag — await_response", () => {
  it("parses await_response with context", () => {
    const text = `I need your input. [ACTION:await_response context="project scaffold interview step 2"]`;
    const result = findActionTag(text);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("await_response");
    expect(result!.params.context).toBe("project scaffold interview step 2");
  });

  it("parses await_response with empty context", () => {
    const text = `[ACTION:await_response context=""]`;
    const result = findActionTag(text);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("await_response");
    expect(result!.params.context).toBe("");
  });

  it("parses await_response with complex context containing spaces", () => {
    const text = `[ACTION:await_response context="project scaffold: waiting for user to answer interview questions about success criteria"]`;
    const result = findActionTag(text);
    expect(result).not.toBeNull();
    expect(result!.params.context).toBe("project scaffold: waiting for user to answer interview questions about success criteria");
  });
});

describe("stripActionTags — await_response", () => {
  it("strips await_response tags from text", () => {
    const text = `I need your input. [ACTION:await_response context="interview step 2"]`;
    const stripped = stripActionTags(text);
    expect(stripped).toBe("I need your input.");
    expect(stripped).not.toContain("ACTION");
  });
});

describe("findActionTag — restart", () => {
  it("parses restart action", () => {
    const text = `Restarting the scheduler. [ACTION:restart]`;
    const result = findActionTag(text);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("restart");
    expect(result!.tag).toBe("[ACTION:restart]");
  });

  it("parses restart action at start of text", () => {
    const text = `[ACTION:restart]`;
    const result = findActionTag(text);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("restart");
  });
});

describe("stripActionTags — restart", () => {
  it("strips restart tags from text", () => {
    const text = `Restarting now. [ACTION:restart]`;
    const stripped = stripActionTags(text);
    expect(stripped).toBe("Restarting now.");
    expect(stripped).not.toContain("ACTION");
  });
});

describe("findActionTag — fleet_control", () => {
  it("parses fleet_control enable with size", () => {
    const text = `Enabling fleet! [ACTION:fleet_control op="enable" size=4]`;
    const result = findActionTag(text);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("fleet_control");
    expect(result!.params.op).toBe("enable");
    expect(result!.params.size).toBe("4");
  });

  it("parses fleet_control disable", () => {
    const text = `[ACTION:fleet_control op="disable"]`;
    const result = findActionTag(text);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("fleet_control");
    expect(result!.params.op).toBe("disable");
    expect(result!.params.size).toBe("");
  });

  it("parses fleet_control status", () => {
    const text = `Checking fleet status. [ACTION:fleet_control op="status"]`;
    const result = findActionTag(text);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("fleet_control");
    expect(result!.params.op).toBe("status");
  });

  it("parses fleet_control resize", () => {
    const text = `[ACTION:fleet_control op="resize" size=8]`;
    const result = findActionTag(text);
    expect(result).not.toBeNull();
    expect(result!.params.op).toBe("resize");
    expect(result!.params.size).toBe("8");
  });
});

describe("eagerlySetPendingAction — fleet_control", () => {
  it("sets pendingAction for fleet_control enable", () => {
    const parsed = findActionTag(`[ACTION:fleet_control op="enable" size=4]`);
    const action = eagerlySetPendingAction(parsed!);
    expect(action).not.toBeNull();
    expect(action!.kind).toBe("fleet_control");
    expect(action!.fleetOp).toBe("enable");
    expect(action!.fleetSize).toBe(4);
  });

  it("returns null for fleet_control status (immediate)", () => {
    const parsed = findActionTag(`[ACTION:fleet_control op="status"]`);
    const action = eagerlySetPendingAction(parsed!);
    expect(action).toBeNull();
  });

  it("defaults enable size to 2", () => {
    const parsed = findActionTag(`[ACTION:fleet_control op="enable"]`);
    const action = eagerlySetPendingAction(parsed!);
    expect(action).not.toBeNull();
    expect(action!.fleetSize).toBe(2);
  });

  it("sets fleetSize to 0 for disable", () => {
    const parsed = findActionTag(`[ACTION:fleet_control op="disable"]`);
    const action = eagerlySetPendingAction(parsed!);
    expect(action).not.toBeNull();
    expect(action!.fleetOp).toBe("disable");
    expect(action!.fleetSize).toBe(0);
  });
});

describe("buildConfirmPrompt — fleet_control", () => {
  it("generates confirmation for fleet enable", () => {
    const prompt = buildConfirmPrompt({
      kind: "fleet_control",
      fleetOp: "enable",
      fleetSize: 4,
    });
    expect(prompt).toContain("enable");
    expect(prompt).toContain("size=4");
  });

  it("generates confirmation for fleet disable", () => {
    const prompt = buildConfirmPrompt({
      kind: "fleet_control",
      fleetOp: "disable",
      fleetSize: 0,
    });
    expect(prompt).toContain("disable");
  });
});

describe("stripActionTags — fleet_control", () => {
  it("strips fleet_control tags from text", () => {
    const text = `Fleet enabled! [ACTION:fleet_control op="enable" size=4]`;
    const stripped = stripActionTags(text);
    expect(stripped).toBe("Fleet enabled!");
    expect(stripped).not.toContain("ACTION");
  });
});

describe("findActionTag — create_task", () => {
  it("parses create_task with all fields", () => {
    const text = `Creating task! [ACTION:create_task project="youji" task="Write log entry" done_when="Log entry exists in README"]`;
    const result = findActionTag(text);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("create_task");
    expect(result!.params.project).toBe("youji");
    expect(result!.params.task).toBe("Write log entry");
    expect(result!.params.done_when).toBe("Log entry exists in README");
  });

  it("returns null for missing done_when", () => {
    const text = `[ACTION:create_task project="youji" task="Write log"]`;
    const result = findActionTag(text);
    expect(result).toBeNull();
  });
});

describe("eagerlySetPendingAction — create_task", () => {
  it("returns null for create_task (immediate, no confirmation)", () => {
    const parsed = findActionTag(`[ACTION:create_task project="youji" task="Write log" done_when="Log exists"]`);
    const action = eagerlySetPendingAction(parsed!);
    expect(action).toBeNull();
  });
});

describe("stripActionTags — create_task", () => {
  it("strips create_task tags from text", () => {
    const text = `Task created! [ACTION:create_task project="youji" task="Write log" done_when="Log exists"]`;
    const stripped = stripActionTags(text);
    expect(stripped).toBe("Task created!");
    expect(stripped).not.toContain("ACTION");
  });
});

describe("findAllActionTags — multiple action tags", () => {
  it("returns all matches from text with 2+ tags", () => {
    const text = `First action. [ACTION:create_task project="youji" task="Task one" done_when="Done"] Second action. [ACTION:create_task project="youji" task="Task two" done_when="Done"]`;
    const results = findAllActionTags(text);
    expect(results).toHaveLength(2);
    expect(results[0].kind).toBe("create_task");
    expect(results[0].params.task).toBe("Task one");
    expect(results[1].kind).toBe("create_task");
    expect(results[1].params.task).toBe("Task two");
  });

  it("returns all matches for different action types", () => {
    const text = `[ACTION:create_task project="youji" task="New task" done_when="Done"] [ACTION:restart] [ACTION:fleet_control op="enable" size=2]`;
    const results = findAllActionTags(text);
    expect(results).toHaveLength(3);
    expect(results[0].kind).toBe("create_task");
    expect(results[1].kind).toBe("restart");
    expect(results[2].kind).toBe("fleet_control");
  });

  it("returns all matches for 3+ tags", () => {
    const text = `[ACTION:create_task project="p1" task="T1" done_when="D1"] [ACTION:create_task project="p2" task="T2" done_when="D2"] [ACTION:create_task project="p3" task="T3" done_when="D3"]`;
    const results = findAllActionTags(text);
    expect(results).toHaveLength(3);
    expect(results[0].params.project).toBe("p1");
    expect(results[1].params.project).toBe("p2");
    expect(results[2].params.project).toBe("p3");
  });
});

describe("findAllActionTags — single action tag", () => {
  it("returns single-element array for text with 1 tag", () => {
    const text = `Starting task! [ACTION:create_task project="youji" task="Single task" done_when="Complete"]`;
    const results = findAllActionTags(text);
    expect(results).toHaveLength(1);
    expect(results[0].kind).toBe("create_task");
    expect(results[0].params.task).toBe("Single task");
  });

  it("returns single-element array for restart action", () => {
    const text = `[ACTION:restart]`;
    const results = findAllActionTags(text);
    expect(results).toHaveLength(1);
    expect(results[0].kind).toBe("restart");
  });
});

describe("findAllActionTags — multiple suggest_task/note_question tags", () => {
  it("returns all suggest_task tags from multi-action response", () => {
    const text = `Great ideas! [ACTION:suggest_task project="youji" task="Add batch processing"] Also: [ACTION:suggest_task project="youji" task="Improve error handling"]`;
    const results = findAllActionTags(text);
    expect(results).toHaveLength(2);
    expect(results[0].kind).toBe("suggest_task");
    expect(results[0].params.task).toBe("Add batch processing");
    expect(results[1].kind).toBe("suggest_task");
    expect(results[1].params.task).toBe("Improve error handling");
  });

  it("returns mixed suggest_task and note_question tags", () => {
    const text = `[ACTION:suggest_task project="youji" task="New feature"] Also a question: [ACTION:note_question project="youji" question="Why does X fail?"]`;
    const results = findAllActionTags(text);
    expect(results).toHaveLength(2);
    expect(results[0].kind).toBe("suggest_task");
    expect(results[1].kind).toBe("note_question");
    expect(results[1].params.question).toBe("Why does X fail?");
  });

  it("can filter chat-mode actions from mixed response", () => {
    const text = `[ACTION:suggest_task project="youji" task="Feature A"] [ACTION:create_task project="youji" task="Task B" done_when="Done"] [ACTION:note_question project="youji" question="Q1"]`;
    const all = findAllActionTags(text);
    expect(all).toHaveLength(3);
    const chatActions = all.filter(t => t.kind === "suggest_task" || t.kind === "note_question");
    expect(chatActions).toHaveLength(2);
    expect(chatActions[0].kind).toBe("suggest_task");
    expect(chatActions[1].kind).toBe("note_question");
  });
});

describe("findAllActionTags — no action tags", () => {
  it("returns empty array for text with no tags", () => {
    const text = `This is a regular message with no action tags.`;
    const results = findAllActionTags(text);
    expect(results).toEqual([]);
  });

  it("returns empty array for text with malformed tag", () => {
    const text = `This has a malformed tag [ACTION:create_task] without required params.`;
    const results = findAllActionTags(text);
    expect(results).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    const results = findAllActionTags("");
    expect(results).toEqual([]);
  });
});
