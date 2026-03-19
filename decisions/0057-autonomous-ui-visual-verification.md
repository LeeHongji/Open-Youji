# 0057: Autonomous UI work must include visual verification artifacts

Date: 2026-03-04
Status: accepted

## Context

A scoring interface for a sample benchmark project was built entirely by a GLM-5 fleet worker with 10 passing E2E tests but zero screenshots. The tests verify DOM structure (text assertions) but not visual appearance. The UI was declared ready and a work package directed the human researchers to use it — despite no human or agent ever having seen the interface.

The example webapp already has mature visual verification infrastructure (Playwright `take_screenshot` fixture, PSNR/SSIM golden comparison, `tests/artifacts/<feature>/golden/` pattern). The fleet worker followed an existing reference feature's file structure but not its screenshot practices. No convention required it to.

This gap is particularly acute for autonomous UI development: when no human is in the loop, DOM-level tests are the only verification. A UI can "work" at the DOM level while being visually broken, unusable, or misaligned. Screenshots are the minimum viable visual verification when human eyeballs are absent.

See: `projects/sample-benchmark-project/postmortem/postmortem-autonomous-ui-no-visual-verification-2026-03-04.md`

## Decision

**Autonomous UI work must produce visual artifacts (screenshots) as a mandatory completion artifact.**

Specifically:

1. **Any task that creates or modifies UI** (templates, stylesheets, client-side JS, page layouts) must include at least one screenshot per new or changed page/view as a completion artifact.

2. **Screenshots must be committed** to the repository — either as golden images in `tests/artifacts/<feature>/golden/` (for example webapp E2E tests) or as PNG/WebP files in the project's experiment or artifact directory.

3. **E2E tests for new UI features must include `take_screenshot` calls** that capture the rendered state after page load and key interactions. DOM-only assertions are necessary but not sufficient.

4. **Task definitions for UI work should include "screenshots captured" in Done-when conditions.** This makes the visual artifact requirement explicit at the task level.

5. **This applies to all agents** (fleet workers, Opus sessions, any backend). The requirement is especially critical for fleet workers (GLM-5) where skill compliance is probabilistic.

## Consequences

- Fleet workers building UI features must capture and commit screenshots before marking tasks complete.
- Subsequent sessions reviewing UI work can verify visual state from committed artifacts instead of needing to launch the app.
- Human researchers or other consumers of UI features can preview the interface before using it.
- Adds a small overhead (~30 seconds) to UI tasks for screenshot capture. This is negligible compared to the cost of shipping a visually broken interface.
- L0 enforcement candidate: `verify.ts` could check for screenshot artifacts when commits touch template/CSS/JS files. Not implemented in this ADR — created as a task.

### Action items

1. Update `docs/conventions/testing.md` with visual verification section — **done in this session**
2. Update the webapp module's AGENTS.md to strengthen screenshot requirement — **done in this session**
3. Create task: Capture screenshots of existing scoring interface — **done in this session**
4. Create task: Add L0 enforcement for visual artifacts on UI changes — **created in this session**
