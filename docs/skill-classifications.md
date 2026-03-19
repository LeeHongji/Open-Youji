Reference classification of all skills by invocation context: which skills autonomous agent sessions can invoke vs. which require a human trigger.

# Skill Classifications

Last updated: 2026-02-25
Source of truth: `.claude/skills/*/SKILL.md` frontmatter and skill descriptions.

## How to use this document

During autonomous work cycles (see [autonomous-work-cycle.md](sops/autonomous-work-cycle.md)), agents select and execute tasks. This document tells agents which skills they may invoke during task execution. The orient skill's "Recommended skill" section suggests which skill to apply — but an agent should only invoke skills listed as **autonomous-capable** below.

## Classification criteria

- **Autonomous-capable**: The skill can be invoked by an autonomous agent session without human input. The skill's inputs (files, project state, experiment results) are available in the repo.
- **Human-triggered**: The skill requires human-provided input (feedback text, thread URL, specific report request) or operates in an interactive chat context. These skills should only run when a human explicitly invokes them.

## Autonomous-capable skills

Skills that autonomous sessions can invoke during task execution. Listed by function.

### Session lifecycle
| Skill | Auto-invocable | Description |
|-------|---------------|-------------|
| `/orient` | yes | Session-start situational awareness. Invoked as Step 1 of every autonomous session. |
| `/compound` | no | End-of-session learning embedding. Invoked as Step 5 of every autonomous session. |

### Adversarial review
| Skill | Auto-invocable | Description |
|-------|---------------|-------------|
| `/critique` | no | Broad adversarial review across 9 failure dimensions. |
| `/review` | no | Unified experiment validation: metrics-first (check computations) then findings (check conclusions). Replaces `/review-findings` + `/audit-metrics`. |
| `/audit-references` | yes | Verify literature note citations by fetching URLs and confirming paper identity. Pre-publication gate. |

### Analytical reasoning
| Skill | Auto-invocable | Description |
|-------|---------------|-------------|
| `/synthesize` | no | Cross-layer interpretation of accumulated findings. |
| `/diagnose` | no (infra-triggered) | Error analysis within a single result set. Not invoked by agent sessions directly, but the health watchdog can auto-trigger a diagnosis deep-work session when anomaly patterns are detected (`auto-diagnose.ts`). |

### Research methodology
| Skill | Auto-invocable | Description |
|-------|---------------|-------------|
| `/design` | no | Experiment and protocol design with methodological rigor. |
| `/lit-review` | yes | Literature triage with CI layer mapping. Can autonomously search, triage, and write literature notes. |
| `/project propose` | no | Identify research gaps and write formal project proposals for PI review. All inputs are repo-resident (experiment findings, open questions, literature gaps). |
| `/publish` | no | Prepare a paper draft for venue submission or arxiv preprint. Takes existing content through citation verification, formatting, anonymization, and submission checklist. |

### Infrastructure
| Skill | Auto-invocable | Description |
|-------|---------------|-------------|
| `/architecture` | no | Analyze, redesign, and refactor infrastructure. Auto mode supports autonomous diagnosis. |
| `/refresh-skills` | no | Audit skills against current codebase state. |
| `/develop` | no | TDD workflow for infrastructure features and bug fixes. |
| `/self-audit` | yes | Check recent session compliance with CLAUDE.md conventions. All inputs are repo-resident (git history, project files). |

### System evolution
| Skill | Auto-invocable | Description |
|-------|---------------|-------------|
| `/gravity` | no | Assess whether recurring patterns should be formalized. |
| `/simplify` | no | Complexity review — tests components against necessity. |

### Failure analysis
| Skill | Auto-invocable | Description |
|-------|---------------|-------------|
| `/postmortem` | no | Root-cause analysis of agent reasoning failures. |

## Human-triggered skills

Skills that require explicit human invocation. An autonomous session should never invoke these on its own.

| Skill | Reason | Description |
|-------|--------|-------------|
| `/coordinator` | Operates in interactive Slack chat context | Operational guidance for Slack actions (experiment launches, status queries, approval handling). |
| `/feedback` | Requires PI-provided feedback text | Process human feedback — investigate root cause and implement improvements. |
| `/report` | Requires human to specify report type and scope | Generate formatted reports with charts. |
| `/project scaffold` | Requires human description and interactive interview | Scaffold a new project directory via structured interview. |
| `/slack-diagnosis` | Requires human-reported problem or thread URL | Diagnose Slack bot thread failures. |

## Column definitions

- **Auto-invocable**: Whether an autonomous session should invoke this skill. All skills now have `disable-model-invocation: false` so the Skill tool works programmatically. Chat-bot safety is enforced by the Skill interception layer in `chat.ts` (any non-coordinator Skill tool call from chat is intercepted and delegated to deep work).

## Maintenance

When adding or modifying a skill:
1. Update this document's classification table.
2. Update the staleness-signal comment in `projects/youji/patterns/skills-architecture.md`.
3. If the skill is autonomous-capable, ensure the orient skill's selection guide includes it.
