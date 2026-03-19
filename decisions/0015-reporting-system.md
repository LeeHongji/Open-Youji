# 0015: Reporting System

Date: 2026-02-17
Status: accepted

## Context

Youji collects substantial data (session metrics, budget/ledger YAML, experiment findings, README logs) but has no way to surface it as useful reports. All Slack notifications are reactive (post-event). There are no dashboards, periodic digests, cross-project rollups, or visualizations.

## Decision

Build a multi-channel reporting system (markdown files, Slack Block Kit, web dashboard) with:

1. **No database.** Data volume is tiny. Compute on-the-fly from source files (sessions.jsonl, budget.yaml, ledger.yaml, EXPERIMENT.md, README.md).
2. **Four report types:** operational dashboard, research digest, project status, experiment comparison.
3. **Skill-first delivery.** `/report` skill generates markdown reports with embedded chart images (Phase 1). Slack action tags and web dashboard follow in later phases.
4. **chartjs-node-canvas for figures.** One `ChartSpec` type renders to both interactive client-side charts (dashboard) and static PNG images (markdown, Slack).
5. **Dashboard embedded in scheduler.** Node `http` with HTML template strings, no extra process or framework.
6. **Three channels are independent.** Markdown, Slack, and HTML share the data layer but have separate renderers.

## Consequences

- New npm dependencies: `chartjs-node-canvas`, `chart.js`. System dependency: `libcairo2` (already present).
- New directory: `infra/scheduler/src/report/` with ~19 files for Phase 1.
- Report generation is on-demand (skill invocation) and scheduled (cron digest in Phase 4).
- The `/report` skill is auto-discovered — no registration needed.
