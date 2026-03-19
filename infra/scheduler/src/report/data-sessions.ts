/** Session data aggregation — parse sessions.jsonl and compute rollups. */

import type { SessionMetrics } from "../metrics.js";
import type { SessionSummary, DaySummary } from "./types.js";

/** Aggregate raw session metrics into a summary with by-day rollups. */
export function aggregateSessions(sessions: SessionMetrics[]): SessionSummary {
  if (sessions.length === 0) {
    return {
      totalSessions: 0,
      successRate: 0,
      totalCostUsd: 0,
      avgCostPerSession: 0,
      avgDurationMs: 0,
      avgTurns: 0,
      byDay: [],
    };
  }

  const successes = sessions.filter((s) => s.ok).length;
  const totalCost = sessions.reduce((sum, s) => sum + (s.costUsd ?? 0), 0);
  const totalDuration = sessions.reduce((sum, s) => sum + s.durationMs, 0);
  const turnsEntries = sessions.filter((s) => s.numTurns != null);
  const totalTurns = turnsEntries.reduce((sum, s) => sum + (s.numTurns ?? 0), 0);

  // Group by day (YYYY-MM-DD from timestamp)
  const dayMap = new Map<string, SessionMetrics[]>();
  for (const s of sessions) {
    const day = s.timestamp.slice(0, 10);
    const arr = dayMap.get(day) ?? [];
    arr.push(s);
    dayMap.set(day, arr);
  }

  const byDay: DaySummary[] = [...dayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, daySessions]) => {
      const daySuccesses = daySessions.filter((s) => s.ok).length;
      const dayCost = daySessions.reduce((sum, s) => sum + (s.costUsd ?? 0), 0);
      const dayDuration = daySessions.reduce((sum, s) => sum + s.durationMs, 0);
      const dayTurns = daySessions.filter((s) => s.numTurns != null);
      const avgT = dayTurns.length > 0
        ? dayTurns.reduce((sum, s) => sum + (s.numTurns ?? 0), 0) / dayTurns.length
        : 0;

      return {
        date,
        sessions: daySessions.length,
        successes: daySuccesses,
        failures: daySessions.length - daySuccesses,
        totalCostUsd: dayCost,
        totalDurationMs: dayDuration,
        avgTurns: Math.round(avgT),
      };
    });

  return {
    totalSessions: sessions.length,
    successRate: successes / sessions.length,
    totalCostUsd: totalCost,
    avgCostPerSession: totalCost / sessions.length,
    avgDurationMs: totalDuration / sessions.length,
    avgTurns: turnsEntries.length > 0 ? Math.round(totalTurns / turnsEntries.length) : 0,
    byDay,
  };
}
