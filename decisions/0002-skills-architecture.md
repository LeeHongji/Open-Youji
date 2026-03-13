# ADR-0002: Skills as encoded judgment procedures

Date: 2026-03-13
Status: accepted

## Context

Certain research workflows require consistent judgment across sessions — how to design experiments, how to diagnose results, how to review literature. Simple prompting is insufficient because the judgment involves multiple steps, validity checks, and domain awareness that must be applied consistently.

## Decision

Encode key research judgment procedures as "skills" in `.claude/skills/`. Each skill is a markdown file with:
- Metadata (name, description)
- Step-by-step procedure
- Output format
- Commit convention

Skills are invoked via `/skill-name` in Claude Code sessions.

Initial skills: orient, research, design, analyze, write, diagnose, critique, lit-review, compound.

## Consequences

- Skills ensure consistent quality across sessions for complex workflows
- New skills can be added as patterns emerge (gravity-driven migration)
- Skills are plain text and can be improved incrementally
- The compound skill specifically handles the feedback loop of improving the system itself
