/** Thin wrapper around the Claude Agent SDK query() to share message-drain logic across callers. */

import { query, type Options, type SDKMessage, type Query } from "@anthropic-ai/claude-agent-sdk";

export type { Query, SDKMessage };

export interface QueryOpts {
  prompt: string;
  cwd: string;
  model?: string;
  systemPrompt?: Options["systemPrompt"];
  permissionMode?: Options["permissionMode"];
  allowDangerouslySkipPermissions?: boolean;
  tools?: Options["tools"];
  allowedTools?: string[];
  disallowedTools?: string[];
  maxTurns?: number;
  maxBudgetUsd?: number;
  resume?: string;
  settingSources?: Options["settingSources"];
  /** Custom subagents available via the Task tool. */
  agents?: Options["agents"];
  /** SDK lifecycle hooks (team events, pre/post tool use, etc.). */
  hooks?: Options["hooks"];
  /** Extra environment variables to inject (e.g. experimental feature flags). */
  extraEnv?: Record<string, string>;
  onMessage?: (msg: SDKMessage) => void | Promise<void>;
}

export interface QueryResult {
  text: string;
  ok: boolean;
  sessionId?: string;
  costUsd?: number;
  numTurns?: number;
  durationMs: number;
  /** Per-model token usage and cost breakdown (available when using subagents with different models). */
  modelUsage?: Record<string, { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number; costUSD: number; contextWindow?: number; maxOutputTokens?: number }>;
  /** Per-tool invocation counts (e.g. { Read: 15, Bash: 5, Edit: 3 }). */
  toolCounts?: Record<string, number>;
  /** Number of assistant turns consumed by the /orient skill (from Skill invocation to first execution-phase tool). Null if orient was not detected. */
  orientTurns?: number;
}

export interface SupervisedQuery {
  query: Query;
  result: Promise<QueryResult>;
}

/** Tools that signal the execution phase has started (post-orient). */
const EXECUTION_PHASE_TOOLS = new Set(["Edit", "Write", "TodoWrite"]);

/** Tracks orient turn count from a stream of tool_use events.
 *  Exported for testing — call `onTool()` for each tool_use block in an assistant turn,
 *  and `onNewTurn()` at the start of each assistant message. */
export class OrientTurnTracker {
  private assistantTurnCount = 0;
  private orientStartTurn: number | null = null;
  private _orientTurns: number | undefined;

  /** Call at the start of each assistant message (before processing tool blocks). */
  onNewTurn(): void {
    this.assistantTurnCount++;
  }

  /** Call for each tool_use block in the current assistant message. */
  onTool(name: string, input?: Record<string, unknown>): void {
    // Detect orient start: Skill tool with orient skill name
    if (name === "Skill" && this.orientStartTurn === null) {
      if (input && typeof input.skill === "string" && input.skill.includes("orient")) {
        this.orientStartTurn = this.assistantTurnCount;
      }
    }
    // Detect orient end: first execution-phase tool after orient started
    if (EXECUTION_PHASE_TOOLS.has(name) && this.orientStartTurn !== null && this._orientTurns === undefined) {
      this._orientTurns = this.assistantTurnCount - this.orientStartTurn;
    }
  }

  /** Call when the session ends (result message received). Finalizes if orient started but no execution tool was seen. */
  finalize(): void {
    if (this.orientStartTurn !== null && this._orientTurns === undefined) {
      this._orientTurns = this.assistantTurnCount - this.orientStartTurn;
    }
  }

  /** Returns the computed orient turn count, or undefined if /orient was not detected. */
  get orientTurns(): number | undefined {
    return this._orientTurns;
  }
}

/** Strip CLAUDECODE env var to avoid nested-session guard when spawning from within Claude Code.
 *  Optionally merge extra env vars (e.g. CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS for team sessions). */
function cleanEnv(extra?: Record<string, string>): Record<string, string | undefined> {
  const env = { ...process.env };
  delete env["CLAUDECODE"];
  if (extra) Object.assign(env, extra);
  return env;
}

/** Create a query and return the live handle alongside a promise for the eventual result.
 *  The drain loop runs as a detached async function. */
export function runQuerySupervised(opts: QueryOpts): SupervisedQuery {
  const start = Date.now();

  const instance = query({
    prompt: opts.prompt,
    options: {
      cwd: opts.cwd,
      model: opts.model,
      systemPrompt: opts.systemPrompt,
      permissionMode: opts.permissionMode ?? "default",
      allowDangerouslySkipPermissions: opts.allowDangerouslySkipPermissions,
      tools: opts.tools,
      allowedTools: opts.allowedTools,
      disallowedTools: opts.disallowedTools,
      maxTurns: opts.maxTurns,
      maxBudgetUsd: opts.maxBudgetUsd,
      resume: opts.resume,
      settingSources: opts.settingSources,
      agents: opts.agents,
      hooks: opts.hooks,
      env: cleanEnv(opts.extraEnv),
    },
  });

  const result = (async (): Promise<QueryResult> => {
    let text = "";
    let sessionId: string | undefined;
    let costUsd: number | undefined;
    let numTurns: number | undefined;
    let modelUsage: QueryResult["modelUsage"];
    const toolCounts: Record<string, number> = {};
    const orientTracker = new OrientTurnTracker();

    for await (const msg of instance) {
      await opts.onMessage?.(msg);

      if (msg.type === "system" && "subtype" in msg && msg.subtype === "init") {
        sessionId = msg.session_id;
      }

      if (msg.type === "assistant" && msg.message?.content) {
        orientTracker.onNewTurn();

        for (const block of msg.message.content) {
          if (block.type === "text") text = block.text; // last text block wins
          if (block.type === "tool_use" && "name" in block && typeof block.name === "string") {
            toolCounts[block.name] = (toolCounts[block.name] ?? 0) + 1;
            orientTracker.onTool(block.name, "input" in block ? block.input as Record<string, unknown> : undefined);
          }
        }
      }

      if (msg.type === "result") {
        if ("result" in msg && msg.result) text = msg.result;
        costUsd = msg.total_cost_usd;
        numTurns = msg.num_turns;
        sessionId = msg.session_id;
        // Extract per-model usage breakdown (useful for subagent cost attribution)
        if ("modelUsage" in msg && msg.modelUsage) {
          modelUsage = msg.modelUsage as QueryResult["modelUsage"];
        }
        orientTracker.finalize();
      }
    }

    return { text, ok: true, sessionId, costUsd, numTurns, durationMs: Date.now() - start, modelUsage, toolCounts, orientTurns: orientTracker.orientTurns };
  })();

  return { query: instance, result };
}

export async function runQuery(opts: QueryOpts): Promise<QueryResult> {
  const { result } = runQuerySupervised(opts);
  return result;
}
