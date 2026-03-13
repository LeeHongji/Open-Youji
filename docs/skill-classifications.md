Reference classification of skills by invocation context: which skills Youji can invoke autonomously vs. which require the researcher to trigger.

# Skill Classifications

Last updated: 2026-03-13
Source of truth: `.claude/skills/*/SKILL.md` frontmatter and skill descriptions.

## How to use this document

During autonomous work cycles (see [autonomous-work-cycle.md](sops/autonomous-work-cycle.md)), Youji selects and executes tasks. This document defines which skills may be invoked during autonomous task execution.

## Classification criteria

- **Autonomous-capable**: The skill can be invoked by an autonomous `claude -p` session without human input. All required inputs (files, project state, experiment results) are available in the repo.
- **Researcher-triggered**: The skill requires researcher-provided input (feedback text, specific report request, thread context) or operates in an interactive chat context. These skills should only run when the researcher explicitly invokes them.

## Autonomous-capable skills

Skills that autonomous sessions can invoke during task execution.

### Session lifecycle
| Skill | Auto-invocable | Description |
|-------|---------------|-------------|
| `/orient` | yes | Session-start situational awareness. Invoked as Step 1 of every autonomous session. |
| `/compound` | no | End-of-session learning embedding. Invoked as Step 5 of every autonomous session. |

### Adversarial review
| Skill | Auto-invocable | Description |
|-------|---------------|-------------|
| `/critique` | no | Broad adversarial review across failure dimensions. |
| `/review` | no | Experiment validation: metrics-first then findings. |
| `/audit-references` | yes | Verify literature note citations by fetching URLs and confirming paper identity. Pre-publication gate. |

### Analytical reasoning
| Skill | Auto-invocable | Description |
|-------|---------------|-------------|
| `/synthesize` | no | Cross-layer interpretation of accumulated findings. |
| `/diagnose` | no | Error analysis within a single result set. |

### Research methodology
| Skill | Auto-invocable | Description |
|-------|---------------|-------------|
| `/design` | no | Experiment and protocol design with methodological rigor. |
| `/lit-review` | yes | Literature triage with CI layer mapping. Can autonomously search, triage, and write literature notes. |
| `/project propose` | no | Identify research gaps and write formal project proposals for researcher review. |

### Infrastructure
| Skill | Auto-invocable | Description |
|-------|---------------|-------------|
| `/architecture` | no | Analyze, redesign, and refactor infrastructure. Auto mode supports autonomous diagnosis. |
| `/develop` | no | TDD workflow for infrastructure features and bug fixes. |
| `/self-audit` | yes | Check recent session compliance with CLAUDE.md conventions. All inputs are repo-resident. |

### System evolution
| Skill | Auto-invocable | Description |
|-------|---------------|-------------|
| `/gravity` | no | Assess whether recurring patterns should be formalized. |
| `/simplify` | no | Complexity review -- tests components against necessity. |

### Failure analysis
| Skill | Auto-invocable | Description |
|-------|---------------|-------------|
| `/postmortem` | no | Root-cause analysis of agent reasoning failures. |

## Researcher-triggered skills

Skills that require explicit researcher invocation. An autonomous session should never invoke these on its own.

| Skill | Reason | Description |
|-------|--------|-------------|
| `/feedback` | Requires researcher-provided feedback text | Process human feedback -- investigate root cause and implement improvements. |
| `/report` | Requires researcher to specify report type and scope | Generate formatted reports with charts. |
| `/project scaffold` | Requires researcher description and interactive interview | Scaffold a new project directory via structured interview. |

## Maintenance

When adding or modifying a skill:
1. Update this document's classification table.
2. If the skill is autonomous-capable, ensure the orient skill's selection guide includes it.
