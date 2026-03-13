# Open-Youji

A personal AI research assistant that runs 24/7, powered by Claude Code.

**Remote**: https://github.com/LeeHongji/Open-Youji

## What is Youji?

Youji is a repo-as-brain system — her memory, knowledge, skills, and research state all live in this Git repository. A scheduler daemon wakes her up periodically, she reads the repo to orient herself, picks a task, does the work, commits the results, and pushes. She can run multiple workers in parallel for throughput.

She can also research and evolve herself — maintaining this infrastructure IS research.

## Architecture

Adapted from [OpenAkari](https://github.com/victoriacity/openakari). See [docs/design.md](docs/design.md).

```
CLAUDE.md              Youji's operating manual (loaded every session)
APPROVAL_QUEUE.md      Human approval coordination
.claude/skills/        Encoded judgment procedures
decisions/             Recorded choices (prevent re-litigation)
infra/scheduler/       Autonomous session daemon (cron + fleet)
projects/              Research projects with logs, tasks, experiments
knowledge/             Cross-project insights
```

## Quick start

```bash
# Interactive session
cd /path/to/Open-Youji && claude

# Autonomous mode
cd infra/scheduler && npm install && npm run build
FLEET_SIZE=4 node dist/index.js   # 1 Opus supervisor + 4 Sonnet workers
```

## Research domain

AI agents, model development, and related fields.

## License

MIT
