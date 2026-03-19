---
name: project
description: "Create new research projects — either propose (agent-initiated gap analysis → formal proposal) or scaffold (human-initiated interview → project directory)"
complexity: opus-only
model-minimum: opus
disable-model-invocation: false
allowed-tools: ["Read", "Grep", "Glob", "WebSearch", "WebFetch", "Write", "Bash(git diff *)", "Bash(git log *)", "Bash(git status)", "Bash(git add *)", "Bash(git commit *)", "Bash(mkdir -p *)"]
argument-hint: "propose [topic] | scaffold <description>"
interview: true
---

# /project <mode> [argument]

Unified skill for creating new research projects. Two modes:

- **`/project propose [topic]`** — Agent-initiated. Scans the repo for research gaps, assesses whether a gap warrants a project, and writes a formal proposal for PI review. Proposals require approval to activate. If topic is omitted, scans for candidate gaps first.

- **`/project scaffold <description>`** — Human-initiated. Interactive interview to understand what the human wants, then scaffolds the project directory with all required files. No approval needed — the human requesting it has authority.

**When to use which mode:**
- You identified a research gap and want to propose an investigation → `propose`
- A human asked you to set up a new project → `scaffold`

---

## Mode: propose

Agent-initiated project proposal. All inputs are repo-resident (experiment findings, open questions, literature gaps, operational patterns).

### Principles

1. **Ground in evidence, not speculation.** Every claim about a gap must cite a specific source: an experiment finding, an operational pattern, a literature gap, an open question.

2. **Research questions over implementation requests.** A proposal must center on a question that produces knowledge when answered. "Build a dashboard" is not a project — "Does real-time visualization reduce PI intervention rate?" is.

3. **Proportionate scope.** Prefer focused investigations over broad surveys. A project that answers one specific question well is more valuable than one that vaguely addresses five.

4. **Explicit uncertainty.** State what you don't know. If feasibility depends on an untested assumption, propose a pilot step.

### Step 1: Identify candidate gaps

If a topic was provided, skip to Step 2. Otherwise, scan these sources:

1. **Open questions** — Read `## Open questions` sections in all active project READMEs. Look for questions not addressed by existing experiments.
2. **Experiment recommendations** — Scan completed `EXPERIMENT.md` files for unactioned recommendations (Recommendations, Proposed solutions, Next steps) beyond current project scope.
3. **Cross-session patterns** — Check `.scheduler/metrics/sessions.jsonl` for recurring operational issues.
4. **Literature gaps** — Check `literature/synthesis.md` files for gaps between existing literature and current questions.
5. **Roadmap gaps** — Read `docs/roadmap.md` and `projects/youji/plans/long-term-roadmap.md` for capability gaps.

Select the single most promising candidate — strongest evidence and clearest path to actionable findings.

### Step 2: Assess the gap

Evaluate whether the gap warrants a full project:

**Project-worthy if:**
- Investigation spans multiple experiments or sessions
- Question is orthogonal to all existing project missions
- Findings would inform system-wide decisions
- Dedicated budget, timeline, and mission add value

**Better as an existing-project task if:**
- Natural extension of an active project's mission
- Fits within 1-2 experiments
- Findings primarily benefit one project

**Better as an infrastructure task if:**
- Primarily code or configuration changes
- Success is binary, not a spectrum of findings

State your assessment explicitly. If the gap is better handled as a task, write the task instead.

### Step 3: Research context

1. **Check existing knowledge.** Read relevant READMEs, experiment records, and decision records.
2. **Check literature.** Use WebSearch to find 3-5 relevant papers. Fetch URLs to verify they exist.
3. **Check feasibility.** What tools, APIs, data, or compute are needed? Available or approval-needed?
4. **Identify CI layers.** Which layers does this investigation address?

### Step 4: Write the proposal

Save to `projects/youji/proposals/<slug>.md`:

```markdown
# Project Proposal: <Title>

Date: YYYY-MM-DD | Status: proposed (requires PI approval)

## Research question
<One sentence, falsifiable.>

## Gap evidence
<Specific evidence citing file paths or URLs.>

## CI layers
<Which layers are involved.>

## Proposed investigation
Mission: <One sentence.> | Done when: <Verifiable condition.>
Method: <3-5 steps.> | Expected findings: <What this produces.>

## Feasibility
Resources: | Resource | Estimate | Available? |
Dependencies: <What must be true.> | Risks: <What could go wrong.>

## Scope
In: <bulleted> | Out: <bulleted>

## Alternatives & Roadmap
Alternatives: <Other approaches.> | Roadmap: <Link to docs/roadmap.md.>
```

### Step 5: Self-review

Check against:
1. Is the research question falsifiable?
2. Is the scope bounded?
3. Is gap evidence concrete (every claim cites a source)?
4. Is cost proportionate to expected knowledge?
5. Does "Done when" pass the agent-verifiability test?

Revise if any check fails.

### Step 6: Save and commit

Follow `docs/sops/commit-workflow.md`. Commit message: `project propose: <title> — awaiting PI approval`

Add an entry to `APPROVAL_QUEUE.md` under Pending:
```
### YYYY-MM-DD — New project proposal: <title>
Project: youji
Type: structural
Request: Activate new research project based on proposal at `projects/youji/proposals/<slug>.md`
Context: <1-2 sentence summary of gap evidence>
```

---

## Mode: scaffold

Human-initiated project creation. Interactive — requires human input at multiple steps. Do not proceed past interview questions until the human has answered.

### Human Input Protocol (Deep Work Sessions)

When running in a deep work session (autonomous, headless), use the question marker protocol to request human input:

1. **Format your questions** using the `[QUESTION: <id>]...[/QUESTION]` marker
2. **Include metadata** to enable continuation detection
3. **End the session** after posting — a new session will spawn when the human replies

**Marker format:**
```
[QUESTION: project-scaffold-<unique-id>]
skill="project"
mode="scaffold"

1. What is the research question or objective?
2. What are the success criteria?
[/QUESTION]
```

The marker will be detected by the scheduler, the questions posted to Slack, and the session ended. When the human replies, a new deep work session will spawn with the answers in the thread context.

**Continuation detection:** When resuming, check the thread context for human answers. Parse the previous messages for responses to your questions and continue from where you left off.

### Step 1: Parse the initial description

Extract from the provided description:
- **Topic**: What domain or question?
- **Motivation**: Why does the human want this?
- **Scope signals**: Scale, timeline, or resource hints?
- **Research vs. operational**: Investigation (produces knowledge) or infrastructure (produces tooling)?

Summarize in 2-3 sentences. Present to the human for confirmation before proceeding.

### Step 2: Cross-project knowledge check

**Before the interview, search for relevant prior work.** This prevents suggesting approaches that contradict existing knowledge.

Search in parallel:
1. **Similar task patterns** — `grep -r "collect.*images\|user.*image\|data.*access" projects/*/experiments/*/EXPERIMENT.md projects/*/*.md 2>/dev/null | head -20`
2. **Infrastructure docs** — Check for `production-code.md`, `*-data-access.md`, `infrastructure-audit.md` in project directories
3. **Recent decisions** — `projects/<project>/decisions/*.md` and `decisions/*.md` for constraints

If relevant knowledge exists:
- Note it in your working context
- During interview, ask: "I found existing work on [topic] in [project]. Should this project leverage that?"
- If the human confirms, incorporate the knowledge into scope/tasks

**Example:** When scaffolding a project that needs user image collection, the bot should search for existing `user-image-data-access.md` or similar docs in other projects and ask whether to use the same approach.

### Step 3: Interview

Ask clarifying questions to fill gaps. Adapt to what the description already covers.

**Required information (ask if missing):**

1. **Research question or objective** — "What specific question are you trying to answer?" or "What capability are you trying to build?"
2. **Success criteria** — "How will we know when this is done?" Push for specificity.
3. **Scope boundaries** — "What is in scope?" and "What should we exclude?"
4. **Resources and constraints** — LLM API calls, GPU, external APIs? Budget or deadline?

**Optional questions (ask if relevant):**

5. **CI layers** — only if the human is familiar with the CI framework
6. **Connection to existing work** — check `projects/` for potential connections
7. **Initial tasks** — does the human have first steps in mind?
8. **Context** — background reading, prior art, existing data?

**Interview protocol:**
- Ask in batches of 2-3, not all at once
- Summarize after each batch, identify remaining gaps
- Accept terse answers — fill in reasonable defaults and note assumptions
- Two rounds is usually sufficient, three is the maximum

### Step 4: Check existing landscape

Before creating the project:
1. Read all `projects/*/README.md` — check for mission overlap
2. Check `projects/youji/proposals/` for pending proposals on the same topic
3. If overlap exists: "This overlaps with `<project>` which has mission: `<mission>`. New project or tasks within existing one?"

Wait for response before proceeding.

### Step 5: Scaffold the project

Create `projects/<slug>/` with the following files:

**README.md** — following CLAUDE.md project README schema:
```markdown
# <Project Title>

Status: active
Mission: <one-sentence objective — synthesized from interview>
Done when: <verifiable condition — from success criteria>

## Context

<3-5 sentences from motivation, research question, and scope.>

## Log

### YYYY-MM-DD — Project created

Project initiated via `/project scaffold`. <1-2 sentences from interview.>

Sources: none (project creation)

## Open questions

- <any open question from the interview>
```

**TASKS.md** — initial tasks using CLAUDE.md task schema:
```markdown
# <Project Title> — Tasks

<Human-provided tasks, or 3-5 bootstrapping tasks:>

Research project:
- [ ] Literature review on <topic>
- [ ] Design first experiment

Operational project:
- [ ] Define requirements and constraints
- [ ] Survey existing tools and approaches
```

**budget.yaml + ledger.yaml** — only if the human indicated resource consumption.

### Step 6: Present for review

Show the human:
```
Created project: <title>
Directory: projects/<slug>/

Files:
- README.md — Mission: <summary>
- TASKS.md — <N> initial tasks
- budget.yaml — <resource summary> (if created)

Does this look right? I can adjust anything before committing.
```

Wait for confirmation. Apply changes if requested.

### Step 7: Commit

Follow `docs/sops/commit-workflow.md`. Commit message: `project scaffold: <title>`

### Step 8: Log in youji project

Add a log entry to `projects/youji/README.md`:
```markdown
### YYYY-MM-DD — New project: <title>

Created `projects/<slug>/` via `/project scaffold`. Mission: <one-sentence>.

Sources: projects/<slug>/README.md
```

---

## Constraints (both modes)

- **CLAUDE.md compliance.** All generated files follow CLAUDE.md schemas exactly. Mission and Done-when are immutable once set.
- **Deduplication.** Always check for overlap with existing projects before creating.
- **No push.** Pushing is handled at the session lifecycle level, not per-skill.
