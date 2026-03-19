/** Tests for team session SDK integration — Phases 0 and 1.
 *  Phase 0: Custom Subagents approach (SDK `agents` option) for headless execution.
 *  Phase 1: buildTeamSession composition + AGENT_PROFILES integration. */

import { describe, it, expect, beforeEach } from "vitest";
import {
  buildTeamAgents,
  buildTeamHooks,
  buildTeamSession,
  TEAM_AGENT_CONFIGS,
  type TeamEventLog,
  type SkillAgentConfig,
} from "./team-session.js";
import { AGENT_PROFILES } from "./agent.js";

// ── buildTeamAgents ──────────────────────────────────────────────────────────

describe("buildTeamAgents", () => {
  const skills: SkillAgentConfig[] = [
    {
      name: "analyst",
      description: "Analyzes code and produces findings",
      prompt: "You are an analyst.",
      model: "sonnet",
      tools: ["Read", "Grep", "Glob"],
      maxTurns: 16,
    },
    {
      name: "builder",
      description: "Implements code changes",
      prompt: "You are a builder.",
      model: "opus",
      tools: ["Read", "Edit", "Write", "Bash", "Grep", "Glob"],
      maxTurns: 48,
      skills: ["develop", "design"],
    },
  ];

  it("converts skill configs to SDK AgentDefinition record", () => {
    const agents = buildTeamAgents(skills);

    expect(Object.keys(agents)).toEqual(["analyst", "builder"]);

    expect(agents.analyst).toEqual({
      description: "Analyzes code and produces findings",
      prompt: "You are an analyst.",
      model: "sonnet",
      tools: ["Read", "Grep", "Glob"],
      maxTurns: 16,
    });

    expect(agents.builder).toEqual({
      description: "Implements code changes",
      prompt: "You are a builder.",
      model: "opus",
      tools: ["Read", "Edit", "Write", "Bash", "Grep", "Glob"],
      maxTurns: 48,
      skills: ["develop", "design"],
    });
  });

  it("returns empty record for empty skill list", () => {
    expect(buildTeamAgents([])).toEqual({});
  });

  it("omits optional fields when not specified", () => {
    const agents = buildTeamAgents([
      {
        name: "helper",
        description: "Helps with tasks",
        prompt: "You are a helper.",
        tools: ["Read"],
        maxTurns: 8,
      },
    ]);

    expect(agents.helper.model).toBeUndefined();
    expect(agents.helper.skills).toBeUndefined();
  });
});

// ── buildTeamHooks ───────────────────────────────────────────────────────────

describe("buildTeamHooks", () => {
  let events: TeamEventLog[];

  beforeEach(() => {
    events = [];
  });

  it("creates hooks for SubagentStart, SubagentStop, TaskCompleted, TeammateIdle", () => {
    const hooks = buildTeamHooks(events);
    const hookKeys = Object.keys(hooks);

    expect(hookKeys).toContain("SubagentStart");
    expect(hookKeys).toContain("SubagentStop");
    expect(hookKeys).toContain("TaskCompleted");
    expect(hookKeys).toContain("TeammateIdle");
  });

  it("SubagentStart hook logs event with agent info", async () => {
    const hooks = buildTeamHooks(events);
    const handler = hooks.SubagentStart![0].hooks[0];

    await handler(
      {
        hook_event_name: "SubagentStart",
        session_id: "test-session",
        transcript_path: "/tmp/transcript",
        cwd: "/repo",
        agent_id: "agent-123",
        agent_type: "analyst",
      } as any,
      undefined,
      { signal: new AbortController().signal },
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event: "SubagentStart",
      agentId: "agent-123",
      agentType: "analyst",
    });
    expect(events[0].timestamp).toBeGreaterThan(0);
  });

  it("SubagentStop hook logs event with agent info", async () => {
    const hooks = buildTeamHooks(events);
    const handler = hooks.SubagentStop![0].hooks[0];

    await handler(
      {
        hook_event_name: "SubagentStop",
        session_id: "test-session",
        transcript_path: "/tmp/transcript",
        cwd: "/repo",
        agent_id: "agent-456",
        agent_type: "builder",
        agent_transcript_path: "/tmp/agent-transcript",
        stop_hook_active: false,
      } as any,
      undefined,
      { signal: new AbortController().signal },
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event: "SubagentStop",
      agentId: "agent-456",
      agentType: "builder",
    });
  });

  it("TaskCompleted hook logs event with task details", async () => {
    const hooks = buildTeamHooks(events);
    const handler = hooks.TaskCompleted![0].hooks[0];

    await handler(
      {
        hook_event_name: "TaskCompleted",
        session_id: "test-session",
        transcript_path: "/tmp/transcript",
        cwd: "/repo",
        task_id: "task-789",
        task_subject: "Analyze code quality",
        task_description: "Review all TS files",
        teammate_name: "analyst",
        team_name: "research-team",
      } as any,
      undefined,
      { signal: new AbortController().signal },
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event: "TaskCompleted",
      taskId: "task-789",
      taskSubject: "Analyze code quality",
      teammateName: "analyst",
    });
  });

  it("TeammateIdle hook logs event", async () => {
    const hooks = buildTeamHooks(events);
    const handler = hooks.TeammateIdle![0].hooks[0];

    await handler(
      {
        hook_event_name: "TeammateIdle",
        session_id: "test-session",
        transcript_path: "/tmp/transcript",
        cwd: "/repo",
        teammate_name: "analyst",
        team_name: "research-team",
      } as any,
      undefined,
      { signal: new AbortController().signal },
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event: "TeammateIdle",
      teammateName: "analyst",
    });
  });

  it("multiple events accumulate in order", async () => {
    const hooks = buildTeamHooks(events);

    await hooks.SubagentStart![0].hooks[0](
      { hook_event_name: "SubagentStart", session_id: "s", transcript_path: "", cwd: "", agent_id: "a1", agent_type: "analyst" } as any,
      undefined,
      { signal: new AbortController().signal },
    );

    await hooks.TaskCompleted![0].hooks[0](
      { hook_event_name: "TaskCompleted", session_id: "s", transcript_path: "", cwd: "", task_id: "t1", task_subject: "analyze" } as any,
      undefined,
      { signal: new AbortController().signal },
    );

    await hooks.SubagentStop![0].hooks[0](
      { hook_event_name: "SubagentStop", session_id: "s", transcript_path: "", cwd: "", agent_id: "a1", agent_type: "analyst", agent_transcript_path: "", stop_hook_active: false } as any,
      undefined,
      { signal: new AbortController().signal },
    );

    expect(events).toHaveLength(3);
    expect(events.map((e) => e.event)).toEqual(["SubagentStart", "TaskCompleted", "SubagentStop"]);
  });

  it("hooks return continue: true so they don't block execution", async () => {
    const hooks = buildTeamHooks(events);
    const result = await hooks.SubagentStart![0].hooks[0](
      { hook_event_name: "SubagentStart", session_id: "s", transcript_path: "", cwd: "", agent_id: "a1", agent_type: "t" } as any,
      undefined,
      { signal: new AbortController().signal },
    );
    expect(result).toEqual({ continue: true });
  });

  it("computes parallel execution windows from start/stop pairs", async () => {
    const hooks = buildTeamHooks(events);

    // Simulate two overlapping agents
    await hooks.SubagentStart![0].hooks[0](
      { hook_event_name: "SubagentStart", session_id: "s", transcript_path: "", cwd: "", agent_id: "a1", agent_type: "analyst" } as any,
      undefined,
      { signal: new AbortController().signal },
    );

    await hooks.SubagentStart![0].hooks[0](
      { hook_event_name: "SubagentStart", session_id: "s", transcript_path: "", cwd: "", agent_id: "a2", agent_type: "builder" } as any,
      undefined,
      { signal: new AbortController().signal },
    );

    // Both started — events should show 2 SubagentStart events
    const starts = events.filter((e) => e.event === "SubagentStart");
    expect(starts).toHaveLength(2);
    expect(starts.map((e) => e.agentType)).toEqual(["analyst", "builder"]);
  });
});

// ── Phase 1: buildTeamSession ───────────────────────────────────────────────

describe("buildTeamSession", () => {
  it("returns agents record and hooks from default TEAM_AGENT_CONFIGS", () => {
    const session = buildTeamSession();

    expect(session.agents).toBeDefined();
    expect(Object.keys(session.agents)).toContain("analyst");
    expect(Object.keys(session.agents)).toContain("builder");

    expect(session.hooks).toBeDefined();
    expect(Object.keys(session.hooks)).toContain("SubagentStart");
    expect(Object.keys(session.hooks)).toContain("SubagentStop");
  });

  it("accepts custom agent configs", () => {
    const custom: SkillAgentConfig[] = [
      {
        name: "reviewer",
        description: "Reviews code",
        prompt: "You review code.",
        model: "haiku",
        maxTurns: 8,
      },
    ];
    const session = buildTeamSession(custom);

    expect(Object.keys(session.agents)).toEqual(["reviewer"]);
    expect(session.agents.reviewer.model).toBe("haiku");
  });

  it("provides mutable events array for hook event tracking", async () => {
    const session = buildTeamSession();

    // Fire a hook and check events
    const handler = session.hooks.SubagentStart![0].hooks[0];
    await handler(
      { hook_event_name: "SubagentStart", session_id: "s", transcript_path: "", cwd: "", agent_id: "a1", agent_type: "analyst" } as any,
      undefined,
      { signal: new AbortController().signal },
    );

    expect(session.events).toHaveLength(1);
    expect(session.events[0].event).toBe("SubagentStart");
  });
});

// ── Phase 1: TEAM_AGENT_CONFIGS ─────────────────────────────────────────────

describe("TEAM_AGENT_CONFIGS", () => {
  it("defines analyst and builder agents", () => {
    const names = TEAM_AGENT_CONFIGS.map((c) => c.name);
    expect(names).toContain("analyst");
    expect(names).toContain("builder");
  });

  it("analyst uses sonnet model", () => {
    const analyst = TEAM_AGENT_CONFIGS.find((c) => c.name === "analyst");
    expect(analyst?.model).toBe("sonnet");
  });

  it("builder uses opus model", () => {
    const builder = TEAM_AGENT_CONFIGS.find((c) => c.name === "builder");
    expect(builder?.model).toBe("opus");
  });

  it("all configs have required fields", () => {
    for (const cfg of TEAM_AGENT_CONFIGS) {
      expect(cfg.name).toBeTruthy();
      expect(cfg.description).toBeTruthy();
      expect(cfg.prompt).toBeTruthy();
    }
  });
});

// ── Phase 1: AGENT_PROFILES.teamWorkSession ─────────────────────────────────

describe("AGENT_PROFILES.teamWorkSession", () => {
  it("exists in AGENT_PROFILES", () => {
    expect(AGENT_PROFILES.teamWorkSession).toBeDefined();
  });

  it("uses opus model", () => {
    expect(AGENT_PROFILES.teamWorkSession.model).toBe("opus");
  });

  it("has 2-hour max duration", () => {
    expect(AGENT_PROFILES.teamWorkSession.maxDurationMs).toBe(7_200_000);
  });

  it("has team-work-session label", () => {
    expect(AGENT_PROFILES.teamWorkSession.label).toBe("team-work-session");
  });

  it("has maxTurns set to 256", () => {
    expect(AGENT_PROFILES.teamWorkSession.maxTurns).toBe(256);
  });
});
