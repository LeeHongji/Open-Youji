/** Fleet executor — spawns and manages fleet worker sessions (ADR 0042-v2 Phase 1).
 *
 *  Extracted from FleetScheduler.launchWorker() to enable independent testing
 *  and future integration with the metrics pipeline. */

import { spawnAgent, AGENT_PROFILES, resolveProfileForBackend } from "./agent.js";
import { autoCommitOrphanedFiles } from "./auto-commit.js";
import { findActiveExperimentDirs, getHeadCommit, verifySession, countKnowledgeOutput, countCrossProjectMetrics, countQualityAuditMetrics } from "./verify.js";
import { enqueuePushAndWait } from "./rebase-push.js";
import { releaseClaim, releaseAgentClaims } from "./task-claims.js";
import { scanTaskSupply } from "./fleet-supply.js";
import { isRateLimitError } from "./backend.js";
import type { FleetWorkerResult } from "./types.js";
import type { SpawnAgentOpts } from "./agent.js";
import type { VerificationMetrics, KnowledgeMetrics, CrossProjectMetrics, QualityAuditMetrics } from "./metrics.js";

export interface FleetExecutionOpts {
  /** Task ID (stable hash from task text). */
  taskId: string;
  /** Project name. */
  project: string;
  /** Pre-generated session ID for the fleet worker. */
  sessionId: string;
  /** Claim ID from task-claims (released on completion). Omit for idle exploration sessions. */
  claimId?: string;
  /** Self-contained prompt built by fleet-prompt.ts. */
  prompt: string;
  /** Absolute path to repo root. */
  cwd: string;
  /** Skill type from task [skill: ...] tag for metrics tracking. */
  skillType?: import("./types.js").SkillType | null;
  /** Worker role derived from skillType for metrics tracking. */
  workerRole?: import("./types.js").WorkerRole;
  /** Callback invoked when the agent increments its turn count. */
  onTurnIncrement?: () => void;
}

export interface FleetExecutorDeps {
  /** Override spawn function for testing. */
  spawnFn?: typeof spawnAgent;
}

/** Execute a single fleet worker session.
 *
 *  Handles the full lifecycle: spawn agent → wait for completion →
 *  auto-commit orphaned files → rebase and push → release claims.
 *  Returns a FleetWorkerResult with success/failure status. */
export async function executeFleetWorker(
  opts: FleetExecutionOpts,
  deps: FleetExecutorDeps = {},
): Promise<FleetWorkerResult> {
  const startedAt = Date.now();
  const spawn = deps.spawnFn ?? spawnAgent;

  // Resolve fleet worker profile with backend overrides (opencode)
  const baseProfile = AGENT_PROFILES.fleetWorker;
  const profile = resolveProfileForBackend(baseProfile, "opencode");

  // Capture HEAD before the agent runs (for verification diff)
  // Stored outside try block so it's available in error handling
  const headBefore = await getHeadCommit(opts.cwd);

  try {
    const { result } = spawn({
      profile,
      prompt: opts.prompt,
      cwd: opts.cwd,
      sessionId: opts.sessionId,
      backend: "opencode",
      onMessage: opts.onTurnIncrement
        ? (msg) => {
            if (msg.type === "assistant" || msg.type === "result") {
              opts.onTurnIncrement!();
            }
          }
        : undefined,
    });

    const agentResult = await result;

    // Post-session: auto-commit any orphaned files
    const activeExpDirs = await findActiveExperimentDirs(opts.cwd).catch(() => [] as string[]);
    await autoCommitOrphanedFiles(opts.cwd, activeExpDirs).catch(() => {});

    // Post-session verification (mirrors cli.ts onAfterRun)
    const postSession = await runPostSessionChecks(opts.cwd, headBefore, agentResult.costUsd, agentResult.numTurns, agentResult.durationMs, agentResult.sleepViolation, agentResult.stallViolation);

    // Post-session: rebase and push
    const pushResult = await enqueuePushAndWait(opts.cwd, opts.sessionId, { priority: "fleet" });
    if (pushResult.status === "branch-fallback") {
      console.log(`[fleet-executor] Worker [${opts.sessionId}] conflict — pushed to branch ${pushResult.branch}`);
    } else if (pushResult.status === "error") {
      console.error(`[fleet-executor] Worker [${opts.sessionId}] push error: ${pushResult.error}`);
    }

    // Capture HEAD after all post-session operations (auto-commit, rebase-push)
    const headAfter = await getHeadCommit(opts.cwd);

    // Post-session: run verification and knowledge counting (same as regular sessions in cli.ts)
    const [verification, knowledge, crossProject, qualityAudit] = await Promise.all([
      verifySession(opts.cwd, headBefore, agentResult.costUsd, agentResult.numTurns, agentResult.durationMs, undefined, agentResult.sleepViolation, agentResult.stallViolation).catch((err) => {
        console.error(`[fleet-executor] Verification error for [${opts.sessionId}]: ${err}`);
        return null;
      }),
      countKnowledgeOutput(opts.cwd, headBefore).catch((err) => {
        console.error(`[fleet-executor] Knowledge counting error for [${opts.sessionId}]: ${err}`);
        return null;
      }),
      countCrossProjectMetrics(opts.cwd, headBefore).catch((err) => {
        console.error(`[fleet-executor] Cross-project metrics error for [${opts.sessionId}]: ${err}`);
        return null;
      }),
      countQualityAuditMetrics(opts.cwd, headBefore).catch((err) => {
        console.error(`[fleet-executor] Quality audit metrics error for [${opts.sessionId}]: ${err}`);
        return null;
      }),
    ]);

    return {
      taskId: opts.taskId,
      project: opts.project,
      sessionId: opts.sessionId,
      ok: !(agentResult.sleepViolation || agentResult.stallViolation),
      durationMs: agentResult.durationMs,
      costUsd: agentResult.costUsd,
      numTurns: agentResult.numTurns,
      timedOut: agentResult.timedOut,
      backend: "opencode" as const,
      modelUsage: agentResult.modelUsage,
      toolCounts: agentResult.toolCounts,
      orientTurns: agentResult.orientTurns,
      headBefore,
      headAfter,
      verification: postSession.verification,
      knowledge: postSession.knowledge,
      crossProject: postSession.crossProject,
      qualityAudit: postSession.qualityAudit,
      skillType: opts.skillType,
      workerRole: opts.workerRole,
      pushQueueResult: pushResult.pushQueueResult,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[fleet-executor] Worker [${opts.sessionId}] failed: ${errMsg}`);

    // Capture HEAD after error (best effort)
    const headAfter = await getHeadCommit(opts.cwd).catch(() => null);

    // Count fleet task supply even on error
    let supply: number | undefined;
    try {
      supply = scanTaskSupply(opts.cwd).fleetEligibleUnblocked;
    } catch {
      // Ignore supply scan errors during error handling
    }

    return {
      taskId: opts.taskId,
      project: opts.project,
      sessionId: opts.sessionId,
      ok: false,
      durationMs: Date.now() - startedAt,
      error: errMsg,
      backend: "opencode" as const,
      headBefore,
      headAfter,
      fleetTaskSupply: supply,
      skillType: opts.skillType,
      workerRole: opts.workerRole,
      isRateLimited: isRateLimitError(err),
    };
  } finally {
    if (opts.claimId) {
      releaseClaim(opts.claimId);
    }
    releaseAgentClaims(opts.sessionId);
  }
}

/** Run post-session verification and knowledge counting (mirrors cli.ts onAfterRun). */
async function runPostSessionChecks(
  cwd: string,
  headBefore: string | null,
  costUsd?: number,
  numTurns?: number,
  durationMs?: number,
  sleepViolationCommand?: string,
  stallViolationCommand?: string,
): Promise<{
  verification: VerificationMetrics | null;
  knowledge: KnowledgeMetrics | null;
  crossProject: CrossProjectMetrics | null;
  qualityAudit: QualityAuditMetrics | null;
}> {
  const [verificationRaw, knowledgeRaw, crossProjectRaw, qualityAuditRaw] = await Promise.all([
    verifySession(cwd, headBefore, costUsd, numTurns, durationMs, undefined, sleepViolationCommand, stallViolationCommand).catch((err) => {
      console.error(`[fleet-executor] Verification error: ${err}`);
      return null;
    }),
    countKnowledgeOutput(cwd, headBefore).catch((err) => {
      console.error(`[fleet-executor] Knowledge counting error: ${err}`);
      return null;
    }),
    countCrossProjectMetrics(cwd, headBefore).catch((err) => {
      console.error(`[fleet-executor] Cross-project metrics error: ${err}`);
      return null;
    }),
    countQualityAuditMetrics(cwd, headBefore).catch((err) => {
      console.error(`[fleet-executor] Quality audit error: ${err}`);
      return null;
    }),
  ]);

  const verification: VerificationMetrics | null = verificationRaw ? {
    uncommittedFiles: verificationRaw.uncommittedFiles.length,
    orphanedFiles: verificationRaw.orphanedFiles.length,
    hasLogEntry: verificationRaw.hasLogEntry,
    hasCommit: verificationRaw.hasCommit,
    hasCompleteFooter: verificationRaw.hasCompleteFooter,
    ledgerConsistent: verificationRaw.ledgerConsistent,
    filesChanged: verificationRaw.filesChanged,
    commitCount: verificationRaw.commitCount,
    agentCommitCount: verificationRaw.agentCommitCount,
    warningCount: verificationRaw.warnings.length,
    l2ViolationCount: verificationRaw.l2ViolationCount,
    l2ChecksPerformed: verificationRaw.l2ChecksPerformed,
    stallViolationCommand: verificationRaw.stallViolationCommand,
  } : null;

  return {
    verification,
    knowledge: knowledgeRaw,
    crossProject: crossProjectRaw,
    qualityAudit: qualityAuditRaw,
  };
}
