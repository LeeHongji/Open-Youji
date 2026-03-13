---
name: project
description: "Create new research projects — either propose (gap analysis then formal proposal) or scaffold (interview then project directory)"
argument-hint: "propose [topic] | scaffold <description>"
---

# /project <mode> [argument]

Unified skill for creating new research projects. Two modes:

- **`/project propose [topic]`** — Agent-initiated. Scans the repo for research gaps, assesses whether a gap warrants a project, and writes a formal proposal for researcher review. If topic is omitted, scans for candidate gaps first.

- **`/project scaffold <description>`** — Researcher-initiated. Interactive interview to understand what's needed, then scaffolds the project directory with all required files.

---

## Mode: propose

Agent-initiated project proposal. All inputs are repo-resident (experiment findings, open questions, literature gaps, operational patterns).

### Principles

1. **Ground in evidence, not speculation.** Every claim about a gap must cite a specific source.
2. **Research questions over implementation requests.** A proposal must center on a question that produces knowledge when answered.
3. **Proportionate scope.** Prefer focused investigations over broad surveys.
4. **Explicit uncertainty.** State what you don't know. If feasibility depends on an untested assumption, propose a pilot step.

### Step 1: Identify candidate gaps

If a topic was provided, skip to Step 2. Otherwise, scan these sources:

1. **Open questions** — Read `## Open questions` sections in all active project READMEs
2. **Experiment recommendations** — Scan completed experiments for unactioned recommendations beyond current project scope
3. **Literature gaps** — Check literature synthesis files for gaps
4. **Roadmap gaps** — Read `docs/roadmap.md` for capability gaps

Select the single most promising candidate.

### Step 2: Assess the gap

**Project-worthy if:**
- Investigation spans multiple experiments or sessions
- Question is orthogonal to all existing project missions
- Findings would inform system-wide decisions

**Better as an existing-project task if:**
- Natural extension of an active project's mission
- Fits within 1-2 experiments

**Better as an infrastructure task if:**
- Primarily code or configuration changes
- Success is binary, not a spectrum of findings

State your assessment explicitly.

### Step 3: Research context

1. Check existing knowledge in the repo.
2. Use WebSearch for 3-5 relevant papers. Fetch URLs to verify.
3. Check feasibility — what tools, APIs, data are needed?
4. Identify CI layers involved.

### Step 4: Write the proposal

Save to `docs/proposals/<slug>.md`:

```markdown
# Project Proposal: <Title>

Date: YYYY-MM-DD | Status: proposed (requires researcher approval)

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
```

### Step 5: Self-review

Check against:
1. Is the research question falsifiable?
2. Is the scope bounded?
3. Is gap evidence concrete (every claim cites a source)?
4. Is cost proportionate to expected knowledge?
5. Does "Done when" pass the verifiability test?

### Step 6: Save and commit

Commit message: `project propose: <title> — awaiting researcher approval`

---

## Mode: scaffold

Researcher-initiated project creation. Interactive — requires input at multiple steps.

### Step 1: Parse the initial description

Extract from the provided description:
- **Topic**: What domain or question?
- **Motivation**: Why?
- **Scope signals**: Scale, timeline, or resource hints?
- **Research vs. operational**: Investigation (produces knowledge) or infrastructure (produces tooling)?

Summarize in 2-3 sentences. Present for confirmation before proceeding.

### Step 2: Cross-project knowledge check

Before the interview, search for relevant prior work:
1. Similar task patterns across existing projects
2. Existing knowledge files
3. Recent decisions that might constrain the new project

If relevant knowledge exists, ask: "I found existing work on [topic] in [project]. Should this project leverage that?"

### Step 3: Interview

Ask clarifying questions to fill gaps. Adapt to what the description already covers.

**Required information (ask if missing):**
1. **Research question or objective**
2. **Success criteria** — push for specificity
3. **Scope boundaries** — in and out of scope
4. **Resources and constraints**

**Optional questions (ask if relevant):**
5. **CI layers** — only if the researcher is familiar with the framework
6. **Connection to existing work**
7. **Initial tasks**
8. **Context** — background reading, prior art

**Interview protocol:**
- Ask in batches of 2-3, not all at once
- Summarize after each batch
- Two rounds is usually sufficient, three is the maximum

### Step 4: Check existing landscape

Before creating the project:
1. Read all `projects/*/README.md` — check for mission overlap
2. If overlap exists: "This overlaps with `<project>`. New project or tasks within existing one?"

Wait for response before proceeding.

### Step 5: Scaffold the project

Create `projects/<slug>/` with:

**README.md** — following CLAUDE.md project README schema:
```markdown
# <Project Title>

Status: active
Priority: <from interview or medium>
Mission: <one-sentence objective>
Done when: <verifiable condition>

## Context
<3-5 sentences from interview.>

## Log

### YYYY-MM-DD — Project created
Project initiated via `/project scaffold`. <1-2 sentences.>

Sources: none (project creation)

## Open questions
- <any open question from the interview>
```

**TASKS.md** — initial tasks:
```markdown
# <Project Title> — Tasks

<Human-provided tasks, or 3-5 bootstrapping tasks>
```

### Step 6: Present for review

Show the created structure and wait for confirmation. Apply changes if requested.

### Step 7: Commit

Commit message: `project scaffold: <title>`

---

## Constraints (both modes)

- **CLAUDE.md compliance.** All generated files follow CLAUDE.md schemas. Mission and Done-when are immutable once set.
- **Deduplication.** Always check for overlap with existing projects before creating.
