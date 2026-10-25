---
name: phax-planning
description: Write or review a plan.md that `phax run` extracts and `phax plans lint` checks — phase structure, required fields, model/effort, commit metadata.
---

# phax planning skill

Use this skill when you are asked to write or review a `plan.md` that
`phax run` will extract and `phax plans lint` will check.

## What phax expects

`phax run` performs the extraction, turning your `plan.md` into `phax-plan.json`
in two stages:

1. **Deterministic first.** phax parses the Markdown structure directly (an
   mdast tree) and pulls out every required field. This is instant, free, and
   reproducible — no model call. It succeeds only when the plan follows the
   exact structure this skill describes: the `## phase-NN — <Title> {#anchor}`
   headings, the `**Recommended model:**` / `**Recommended effort:**` lines, the
   three planned-file sections, and the commit subsections. Authoring plans to
   this shape is what keeps extraction on the fast path.
2. **LLM fallback.** If the deterministic parse fails for any reason (a missing
   section, a malformed heading, prose where a list was expected), phax falls
   back to passing your `plan.md` to Claude Code with the `phax-plan.json` JSON
   Schema and asking it to return only structured JSON. A warning records why
   the deterministic path was skipped, so a plan that silently drops off the
   fast path is visible.

Either way, extraction succeeds only when every required field is present and
unambiguous, and it fails loudly when required data is missing — it never
guesses.

Each phase also declares the files it expects to touch. After a phase commits,
phax reconciles those declarations against the actual git diff and asks the
executing agent to explain any deviation in its handoff (see
[End-of-phase file reconciliation](#end-of-phase-file-reconciliation)).

## Lint before you run

`phax plans lint <plan>` reports every mechanical defect of a plan before a run
touches it — read-only, and model-free, so it never falls back to the extraction
model. Eight checks: **structure** (every field the deterministic parse requires,
reported in full rather than stopping at the first, plus an error for a phase
number missing from phase-01 … phase-NN, such as phase-02 in a plan with phase-01
and phase-03), **files** (the planned
create/edit lists walked in phase order against the working tree — an edit of a
file no earlier phase creates, or a create of a file that already exists, is an
error), **commands** (the plan's required commands against `security.agentCommands`
and the gate profile), **models** (each phase's model/effort against the routing
catalog, each declared assignment bound against the catalog, each phase against the bound that governs it or the policy default, and a line still using the old reason label, which is now `**Assignment reason:**`), **interactive**
and **oracles** (a malformed `**Mode:**` or oracle line; the interactive-phase rules below: placement, and no planned file to create or edit; and the oracle-phase rules below, including an oracle phase with no `oracles` provider configured and an interactive phase in an oracle role; one inside a pair is allowed), **tests** (a test line off the format, an oracle-loop line on a phase that is not an oracle phase, an oracle phase with no oracle-loop line and a criterion id the source spec does not have are errors; a criterion no phase covers, and a source spec with no readable criterion ids, are warnings; a phase with no line is not flagged), and **advisory** (when `phax.json` registers a `planAuditor`, every
finding it returns about the plan's shape — one warning per phase it names). It
exits 1 when any finding is an error; advisory findings are always warnings, so
they never fail the lint — treat them as planning advice. With no auditor
registered, or on a plan the deterministic parser cannot read, there are no
advisory findings. A `Draft` plan lints like any other — run it while drafting,
not only before approval. The run preflight (`phax run`, `phax resume`) also
refuses, with exit 11, a phase whose section it cannot locate in plan.md; a phase
is located by its `## phase-NN` id heading or by its `{#anchor}`. It refuses the same
`models`, `interactive` and `oracles` errors with exit 11: a departure from a bound
without a reason, an invalid bound, or a part bound the architecture provider does not
resolve (provider missing or failing, or the part gone) stops `phax run` before the run is
named and `phax resume` before its next phase starts ("Assignment preflight failed"), and
`phax plans lint` shows the same findings first. Extraction refuses a plan with a departing test line
before any model call, naming the line and `phax plans lint`. To see a plan's shape before you approve
or run it, `phax plans overview <plan>` lays it out phase by phase, with its planned files in the
architecture's parts and its criterion coverage.

## Run title and short name

The plan's single top-level `# ` heading is the run title. The extraction
derives both extracted run-level fields from it:

- `run.title` — the heading text verbatim.
- `run.shortName` — the same text slugified (lowercase, hyphen-separated). The
  short name is the run's identity: it names the run folder and the Git branch
  (`phax/<shortName>`).

Write exactly one `# ` heading per plan and keep it short and descriptive — a
long title becomes a long branch slug. Do not add a separate name or namespace
field; the top-level heading is the sole source of the run's identity.

## Plan frontmatter block

Create a repo-tracked plan with
`phax artifact new plan <slug> --spec <spec path> --last|--not-last`
(omit all three when there is no source spec; both flags are refused without `--spec`): it names the file
`docs/plans/<YYMMDDHHMM>-<slug>-plan.md` from the clock — the slug must equal the
source spec's slug, which `phax plans lint` checks — and writes the frontmatter
block; you fill in the body. Never compute the stamp yourself, and refer to a plan
by its slug in prose, commits and pull requests, never by its stamp.

Every plan carries a YAML frontmatter block at offset 0, before the `# ` title:

```markdown
---
status: Approved
source-spec: docs/specs/<YYMMDDHHMM>-<slug>.md
completes-spec: false
---
```

- **`status`** — the plan's lifecycle status, one of `Draft`, `Approved`,
  `Stale`, `Abandoned`, `Completed`. phax **enforces the run gate: only an
  `Approved` plan can run** — `phax run` refuses any other status (naming the
  remedy) before extraction. Approve a repo-tracked plan with
  `phax artifact approve docs/plans/<YYMMDDHHMM>-<slug>-plan.md`; for a loose `plan.md`, set
  the key by hand. `approve` takes `--by operator` or `--by machine:<grant>`, required
  without a terminal. `phax artifact reopen` moves an `Approved` or `Stale` plan back to
  `Draft`. Extraction is never gated, so a `Draft` still extracts for preview.
- **`source-spec`** — the spec this plan implements
  (`docs/specs/<YYMMDDHHMM>-<slug>.md`), or `null` when there is no source spec. It is the
  lineage anchor for staleness tracking.
- **`completes-spec`** — `true` when this plan is its spec's last and its run completes
  the spec, `false` when more plans of the spec follow. Required when `source-spec` names
  a spec; absent (refused) when it is `null`. Every plan of a spec except the last says
  `false`. The chain gate still applies on top of `true`. The value is fingerprinted, so
  changing it on an Approved plan makes the plan stale. `--last` writes `true`,
  `--not-last` writes `false`.
- **`approved`** — optional; a mapping with `date` and `baseline` written by
  `phax artifact approve` when it stamps the approval. Absent on a plan that has
  never been approved; `reopen` clears it.

This block is frontmatter, not preamble prose. It is **not** extracted into
`phax-plan.json` — it governs the run gate and lineage, not phase structure — but
the extractor skips the block before parsing the plan body, so keep it present
and accurate on every plan.

## Per-phase field set

Each phase section must contain all of the following. Fields marked **extracted**
are pulled by the extraction into `phax-plan.json`; the rest are
informational for the executing agent.

| Field                    | Location in section                                     | Extracted? |
| ------------------------ | ------------------------------------------------------- | ---------- |
| `id`                     | Derived from the heading (`phase-01` → `"phase-01"`)    | yes        |
| `title`                  | Section heading after the dash                          | yes        |
| `model`                  | `**Recommended model:** <model-id>` line                | yes        |
| `effort`                 | `**Recommended effort:** low\|medium\|high` line        | yes        |
| Assignment reason        | `**Assignment reason:** <reason>` line under the effort line, only on a phase that departs from its governing bound or the default | no         |
| `mode`                   | `**Mode:** interactive` line in the header paragraph, after the model, effort and Assignment reason lines; absent means `headless` | yes        |
| `oracle`                 | `**Oracle phase:**` and `**Oracle files:**` lines in the header paragraph, after the model, effort and Assignment reason lines; absent means `null` | yes        |
| `planMarkdownAnchor`     | `{#phase-NN-<slug>}` in the heading line                | yes        |
| `plannedFilesToCreate`   | `### Planned files to create` list                      | yes        |
| `plannedFilesToEdit`     | `### Planned files to edit` list                        | yes        |
| `optionalFilesToEdit`    | `### Optional files that may be edited` list            | yes        |
| `commit.subject`         | `### Commit subject` subsection                         | yes        |
| `commit.body`            | `### Commit body` subsection                            | yes        |
| Objective                | Opening paragraph of the phase section                  | no         |
| Detailed instructions    | `### Detailed instructions` bullet list                 | no         |
| Boundary contracts       | `### Boundary contracts` subsection                     | no         |
| Test strategy            | `### Test strategy` subsection (`testLines`)            | no         |
| Implementation order     | `### Implementation order` subsection                   | no         |
| Excluded scope           | `### Excluded scope` list                               | no         |
| Verification             | `### Verification` (names the `phax.json` gate profile) | no         |
| Expected handoff content | `### Expected handoff content`                          | no         |

The run-level field `requiredCommands` (extracted from `## Required commands` in
the plan preamble) is **not** per-phase — it applies to the whole run. See
[Required commands declaration](#required-commands-declaration).

`mode` and `oracle` are read by phax from the header lines, never by the extraction model.
An oracle phase runs when an `oracles` provider is configured (see
[Oracle phases](#oracle-phases)). An interactive phase stops the run for a person's review
(see [Interactive phases](#interactive-phases)); a plan writes a `**Mode:** interactive`
line only on such a phase, and no `**Mode:**` line on any other.

The three planned-file arrays are **required**: the section must be present even
when it is empty (write `- (none)` for an empty list). The extraction pulls
all three into `phax-plan.json`, where they back the end-of-phase file
reconciliation.

## Phase section structure

```markdown
## phase-NN — <Title> {#phase-NN-<slug>}

**Recommended model:** <model-id>
**Recommended effort:** low | medium | high
**Assignment reason:** <why this phase leaves its governing bound or the default — omit the line when it conforms>

<Objective — one short paragraph: the user- or system-visible capability this
phase adds.>

### Detailed instructions

- <what to implement, in enough detail for the chosen model/effort to succeed>

### Planned files to create

- <repo-relative path you expect to NOT exist before the phase>

### Planned files to edit

- <repo-relative path you expect to modify>

### Optional files that may be edited

- <repo-relative path that may need a touch depending on implementation>

### Boundary contracts

<consumer/producer contracts this phase crosses; omit if it crosses none>

### Test strategy

- <guarantee> — <size> · <technique> · <oracle> · <oracle | in-phase>[ · <acceptance criterion id>]

### Implementation order

<recommended order, usually core-to-surface>

### Excluded scope

- <what is explicitly NOT in this phase>

### Verification

<the phax.json gate profile that verifies this phase — do not invent commands>

### Expected handoff content

<what the agent must record in phase-handoff.md, including an explanation for
any file-plan deviation phax flags>

### Commit subject

<single-line conventional-commit subject>

### Commit body

<commit body explaining the change>
```

## Heading format

```
## phase-NN — <Title>  {#phase-NN-<slug>}
```

- `NN` is zero-padded to two digits.
- `<slug>` uses only lowercase letters and hyphens.
- The anchor must be on the same line as the heading.
- The extraction derives `id` as `"phase-NN"` (e.g. `"phase-01"`, matching
  `/^phase-\d{2}$/`) and `planMarkdownAnchor` from this line, and errors without
  the anchor.

## Planned files and end-of-phase reconciliation {#end-of-phase-file-reconciliation}

After a phase commits, phax compares the files it actually changed
(`git diff --name-status HEAD^ HEAD` in the phase worktree) against the phase's
`plannedFilesToCreate`, `plannedFilesToEdit`, and `optionalFilesToEdit`, and
writes a reconciliation report into the phase folder. phax computes this
deterministically — the agent does not author it. Touching a file from the
optional list is never flagged. Anything else that diverges — a planned file left
untouched, or an unplanned file created or edited — is a deviation the executing
agent must explain in `phase-handoff.md`.

Write the file lists to make this signal useful:

- List every file you genuinely expect the phase to create or edit. Accuracy
  beats optimism — an over-long list produces noise; an under-list produces
  false deviations.
- Use the optional list for files that may need a touch depending on
  implementation details (test factories, barrel/`index` files, route tables).
- Tests are files — list them in the create/edit sections too.
- Do not list files you only read. Reconciliation is about writes.
- Use repo-relative POSIX paths, exactly as they appear in `git`.

The planned files to create and edit (not the optional list) also leave phax as
facts. A gate step that declares `"input": "gate-request"` receives every phase's
planned files on stdin, and so does a brief provider. A report step can then
let a finding pass in this phase when a later phase plans to touch its file. A
phase's brief covers that phase's planned files. So, when a later phase is meant to
finish what an earlier one starts, list the shared file in the later phase's
create or edit section, not under optional. Otherwise a report-step gate sees
nothing still to come, and fails the earlier phase.

### Editing skill files

Claude Code protects `.claude/`, so a secure phase can write a `.claude/skills/...` file
only when that exact file is listed in the phase's planned-file sections. Declare every
skill file the phase writes, including new files such as `references/*.md`; undeclared
siblings, glob paths, and other `.claude/` paths stay denied. A plan that declares skill
files must be run with `phax run --allow-skill-edits`, or the preflight refuses it (see
`docs/security.md`).

## Oracle phases

An oracle phase writes the tests that a later phase discharges; a configured `oracles`
provider judges both gates.

- **Declare one only when an `oracles` provider is configured.** The headless authoring
  prompt says so; otherwise check `oracles` in phax.json and its overlays by hand. Without a
  provider, keep tests and code in one phase: `phax plans lint` reports an `oracles` error
  and exits 1, and `phax run` and `phax resume` refuse the plan with exit 11.
- **Two header lines** sit after the model, effort and Assignment reason lines of the oracle
  phase: `**Oracle phase:** yes` (the next phase discharges it) or
  `**Oracle phase:** discharged by phase-NN`, then `**Oracle files:** <paths>`.
- **The oracle files are a subset of the oracle phase's planned files** to create or edit.
  The phase may plan stubs that are not oracles.
- **The oracle phase marks its tests.** Every test it adds or modifies carries the test
  runner's expected-failure marker, so the test command stays green; it may delete tests.
- **The discharging phase** (the next phase, or the one named) removes the markers and writes
  the code. Removing the markers is its only change to the oracle files.
- **No phase in between** plans an oracle file, an interactive phase may sit in between and
  never takes an oracle role, and one phase discharges one oracle phase.

### What makes a good oracle

An oracle pair is the acceptance loop, not test-driven development: every oracle is written
before the code, in another phase, and frozen once committed. The discharging phase cannot
adjust one it disagrees with; the run pauses instead. So hold each oracle to these rules:

- **It tests the surface the spec shows, through a stable entry**: a use case, a port, a
  decoder, a command, a state transition. Never the code's internal design (helpers, private
  modules, call order): the code does not exist yet, and a frozen test of its internals pauses
  the run on a disagreement that is not one.
- **It traces to an acceptance criterion** of the source spec. Name the criterion id on its
  Test strategy line; a criterion with no oracle and no in-phase test is a gap in the plan.
- **What it judges with is frozen with it.** Property generators, model or transition
  tables, fixtures and expected files the oracle reads go on the `**Oracle files:**` line
  too; otherwise the discharging phase can narrow a generator or edit a table until the
  oracle passes. A generator derived from a type or schema the discharging phase may change
  is not frozen: freeze the schema in an earlier phase, or write the generator by hand.
- **It fails for the reason it states.** Against the oracle phase's stubs, each oracle must
  fail on its assertion, not because a module, export or type is missing. Plan the stubs the
  tests compile and load against, and make them fail recognizably (a stub that throws a
  not-implemented error). An oracle red for the wrong reason passes its marker, then cannot
  be repaired by the discharging phase.
- **It is deterministic.** A randomized oracle (property, fuzz) runs on a fixed seed in the
  gate, so a fix loop never chases a counterexample that moved.
- **Not every test is an oracle.** The unit tests that drive the code's design are the
  inner loop: the discharging phase and ordinary phases write them freely, test-first where
  the logic warrants it, and the gate judges them like any test.

## Interactive phases

An interactive phase stops the run after the phase so a person can review the work and
correct the pattern before later phases repeat it. `phax run` sets the phase up, runs one
read-only first turn, then stops in `awaiting_review` (exit 13); `phax resume` closes the stop
with the gate and a commit of the person's correction.

- **Declare one directly after the first phase that sets a pattern at least one later phase
  repeats**, and never by default. A plan with nothing to review writes no `**Mode:**` line:
  the operator can hold any other phase at run time with `phax run --hold`, so a plan does
  not declare a stop for a review the operator may or may not want.
- **One header line**, `**Mode:** interactive`, sits after the model, effort and Assignment
  reason lines of the phase.
- **It plans no file to create or edit.** Its optional files name what the person may touch;
  its Detailed instructions name what to review, the pattern at stake and the later phases
  that repeat it. Lint reports a planned file to create or edit as an error.
- **Placement.** It is never the first phase (no earlier phase has set a pattern), never the
  last (the final phase is already kept open for review), and never directly follows another
  interactive phase.
- **Bounds.** It is held to the assignment bounds through its optional files, like any phase.
- **Oracles.** It may sit inside an oracle pair, where a person reviews the oracles before
  their discharge and phax judges them again, and it never takes an oracle role.

## Boundary contracts (informational)

When a phase crosses a boundary of the repository's architecture (in the example
architecture: page/cli/surface → view-model, view-model → application command,
command → port, …), describe the contract in
consumer/producer terms: who needs something, who provides it, and the stable
shape between them. Be strict on the semantic need, adaptable on the exact
interface shape. These are not extracted (human-readable only). Omit the section for a phase that crosses no boundary.

## Test strategy

A phase's `### Test strategy` is data. phax reads each line into a test line (`testLines` in
`phax-plan.json`), `phax plans lint` checks the lines, and `phax plans overview <plan>` shows them
phase by phase with the coverage of the source spec's criteria. One line per guarantee the phase
adds or changes, each placed on four coordinates.

```markdown
- <guarantee> — <size> · <technique> · <oracle> · <oracle | in-phase>[ · <acceptance criterion id>]
```

For example:

```markdown
- every (state, transition) pair is accepted or refused as the table says — small · table · transition table · oracle · AC-3
- a gate-report decodes or is refused with a typed error, never a crash — small · fuzz · the decoder's refusal · in-phase
- the git adapter's fake and the real adapter agree on branch creation — medium · contract · shared suite · in-phase
```

**The coordinates.**

- **Size — what the test touches.** `small`: one process and memory only. `medium`: one
  machine (disk, subprocesses, a local repository, localhost). `large`: anything beyond (the
  network, a real provider or service). Size, not "unit" or "integration", decides speed
  and flakiness: pick the smallest size that still exercises the guarantee.
- **Technique — how inputs are chosen.** `example` (hand-picked cases), `table` (every case
  of a finite domain, such as every state × transition), `property` (generated inputs
  against an invariant: round-trip, idempotence, an invariant that must always hold),
  `metamorphic` (two runs whose outputs must relate: the same result with an irrelevant
  section added, reordered, or reformatted), `stateful` (generated command sequences against
  a model), `fuzz` (arbitrary or malformed input at a boundary), `contract` (one suite run
  against both a fake and the real adapter), `smoke` (the real entry, end to end).
- **Oracle — what judges the result.** An expected value, an invariant, a reference table or
  model, a relation between two runs, a typed refusal. Name it: a test whose oracle you
  cannot name guarantees nothing.
- **Where — which loop owns the test.** `oracle`: written in an oracle phase and frozen until
  its discharge (the acceptance loop, see [Oracle phases](#oracle-phases)). `in-phase`:
  written with the code in the same phase, free to change while the phase runs (the inner,
  test-driven loop). An oracle phase lists its oracle lines; its discharging phase lists only
  its own in-phase lines. Without an `oracles` provider every line is `in-phase`.

**Defaults by kind of code.** Read the kind from the repository's architecture, then start
from its default and depart only for a reason:

| Kind of code                                        | Size         | Technique                                         | Oracle candidate                        |
| --------------------------------------------------- | ------------ | ------------------------------------------------- | --------------------------------------- |
| Pure decision logic (rules, routing, computation)   | small        | example, then property or metamorphic             | yes, when the spec states its I/O       |
| State machine or lifecycle                          | small        | table over every (state, transition), stateful    | yes: the table is the spec              |
| Decoder, parser or codec at an external boundary    | small        | property (round-trip), fuzz (never a crash)       | the round-trip, yes; the fuzz in-phase  |
| Use case orchestrating ports                        | small        | example against fake ports                        | yes, at the use case's entry            |
| Adapter to an external tool or service              | medium       | example against the real thing, contract          | no: its behaviour is the tool's         |
| Composition root, CLI entry, route                  | medium/large | smoke                                             | yes, for the surface the spec shows     |
| Architecture rule (layering, dependency direction)  | small        | fitness check the project already runs            | no                                      |

**The grammar's settled points.**

- Separators are exactly ` — ` (U+2014) and ` · ` (U+00B7), each with one space either side; `--`, `-`
  or doubled spaces are errors.
- An oracle may hold ` · ` but never ` — `, and never starts with `— ` or ends with ` ·`. A guarantee
  may hold both.
- The criterion is an id from the source spec's sidecar (a headless session is given the list), and
  the last field when present.
- A phase that tests nothing writes `- (none)`, or omits the section.
- A wrapped line (no blank line between) continues its entry; any other text in the section, such as a
  sentence introducing the list, is an error.

**Rules.**

- **A fake earns its place by a contract suite.** A fake port used by small tests is only as
  true as its agreement with the real adapter; when a phase adds or changes a fake, it adds
  or extends the suite both run.
- **Randomized tests run on a fixed seed in the gate**, and a counterexample a property
  finds becomes an example test that stays.
- **Every acceptance criterion the phase serves appears on at least one line**, as an
  oracle or in-phase.
- **A new technique is a planned dependency.** A technique the project has no library for
  (a property-based testing library, a mutation tool) is not planned silently: adding the
  dependency is a phase of its own, or an arbitration.

## Planning doctrine

- **Plan outside-in.** Start from the need the consumer sees and trace the path
  it takes through the repository's parts. This is how you discover which files
  each phase touches.
- **Implement inside-out.** Order the work from the parts others depend on to
  the surface, so the surface never claims a behavior the core does not yet
  provide.
- **Verify outside-in.** End by checking the consumer-visible behavior end to
  end, then let the gates confirm it. With an `oracles` provider, the acceptance
  side of that check is written first, as oracles, and the code is implemented
  inside-out against them.

### The repository's architecture

Read the repository's architecture before cutting phases. Run `phax architecture`,
or `phax architecture <path>...` for the parts the plan touches: with an
architecture provider configured, it prints the repository's architecture, then the
owner's assignment bounds when `phax.json` declares any. Without a provider, it
exits 1 with one line saying so, followed by the bounds when declared. That exit
means: read the architecture from the code and its documentation (README, CLAUDE.md
or equivalent) instead, and carry on. It is not a failure of the repository.

Either way, plan against it: its parts, the direction of their dependencies, and
the boundaries its own checks enforce.

### One example architecture

A layered application: page → view-model → command → domain → port → adapter →
storage, implemented domain → ports → command → adapter → view-model → view →
route. Use it only where the repository is built this way.

## Technical arbitrations

Planning is where technical trade-offs get decided — contract shapes, phase
decomposition, which part owns a behavior. A phase's model and effort are not
an arbitration: see "Choosing a model and effort". The spec
deliberately leaves these open ("what, not how"); do not resolve them silently.

- **Surface real arbitrations as questions.** When two viable approaches differ
  in what they sacrifice, stop and ask the human **before writing the phases** —
  the same clarify gate the spec applies in its §9, applied at the plan layer.
  Bundle the questions in one pass; don't drip them one at a time. An arbitration
  is real when both options would pass the gates; a choice with only one viable
  option is not a question, just make it.
- **Never accept a security loss silently.** When an option's loss weakens a security
  boundary, the arbitration is always a question for the human, even when only one option
  seems viable and even when you would recommend it. It never appears as a "loss accepted" in
  `## Technical arbitrations`. A security loss is anything that lets an agent, or a process it
  starts, do more than it could before:
  - a command granted to a session;
  - a wider write scope, sandbox or network path;
  - a process that runs outside the sandbox;
  - a file an agent can edit that decides what another command runs, such as a config key
    naming a command;
  - a credential or token within reach.

  In the option's `abandons`, say what an agent could do with the loss, not only which
  mechanism changes. For example: "the session can edit `phax.local.json` and then run any
  command through the granted one", not "the granted command is not sandboxed". Headless, put
  the question in `openQuestions`: approval then waits for the operator's decision.
- **Frame every option by its dominant loss.** Do not weigh symmetric pros/cons
  lists — both columns fill endlessly and everything appears to weigh the same.
  Name, per option, the strongest thing you abandon by choosing it, and recommend
  the option whose loss is acceptable:

  ```markdown
  Question: <the arbitration>

  - Option A — abandons: <the strongest thing this choice gives up>
  - Option B — abandons: <the strongest thing this choice gives up>

  Recommendation: <option> — <why its loss is the acceptable one>.
  ```

  One line per option is enough. If you cannot name what an option abandons, you
  have not understood the option yet — dig further before asking.
- **Record the outcome in the plan.** Add a `## Technical arbitrations` section
  to the plan preamble (before the first phase heading) listing each resolved
  arbitration in one or two lines: the decision and the loss knowingly accepted.
  It is informational (not extracted), but it lets the executing agent and the
  reviewer read a phase without re-litigating the choice. Omit the section when
  the plan required no arbitration.
- **Questions in the preamble are optional.** A plan may also carry `## Open questions`,
  `## Arbitrated questions` and `## Decision log` sections in its preamble, before the first
  phase heading, each only when non-empty. A question follows the §9 format of the phax-spec
  skill: `### <id> — <question>`, option bullets `- <option id> — <label> — abandons: <loss>`,
  and `Recommendation: <option id> — <rationale>`; an arbitrated one also carries its
  `Decision:` block. `phax plans lint` and extraction accept these sections and read the same
  phases and required commands with or without them.
- **An arbitration you cannot settle stays an open question.** `phax artifact decide <plan>`
  answers the open questions with the operator, then writes each one, with its Decision block,
  into the arbitrated section. `phax artifact approve` refuses a plan while its open section is
  not empty, so a plan reaches Approved only once every question it raised is decided.

## Spike and discovery plans

phax is not only for feature work — it is a valid vehicle for spike / discovery /
feasibility plans. A discovery plan succeeds when it delivers **either the answers, or
the instrumentation to obtain them**. Hold the plan to that bar.

Such work fits awkwardly into the default model (autonomous agent + mechanical gate)
because a spike's value is in judgment, not in compiling code. Reconcile it like this:

- **Split deterministic scaffolding from real-world signal.** The agent authors what it
  can produce deterministically — harness scripts plus a findings-doc skeleton with
  empty `## Results` / `## Verdict` sections. The actual run (booting a VM, hitting a
  live API, observing a network block) happens out-of-band — a human or an e2e step —
  and its output is pasted into the findings doc. A closing synthesis phase
  rapatriates the judgment into a go/no-go.
- **Keep the spike project's gate profile light.** Spike artifacts (`spikes/`, docs) have
  no architecture/knip/build surface to protect, so gating them on heavy structural/product
  steps is a misleading "false green". Configure the spike's single gate profile with just
  the honest light steps (e.g. `typecheck` to cover any TypeScript scaffolding the spike
  produces). Gates passing trivially ("à vide") is acceptable for a spike — the real signal
  lives in the findings doc, not the gate.
- **State the execution-model caveat in the plan Overview.** A phase agent runs in a
  worktree and cannot reliably self-verify real-world effects (a microVM escape, a live
  egress block). Say so explicitly, so the synthesis reads as provisional until a real
  run fills the Results sections.

## Model catalog

Each entry below is a versioned model id from the provider catalog with its effort set and status. Plan phases reference concrete model ids (e.g. `claude-sonnet-4-6`); phax resolves them natively when the execution provider serves the same family, or translates through the Claude-hub equivalence table otherwise. The catalog is the source of truth — the run-start preflight rejects any phase whose id or effort is not listed here.

### Choosing a model and effort

Cut and write every phase first. Choose its model and effort last, from what the written phase asks for.

<!-- BEGIN generated: phase-model-policy -->
- Default: `claude-sonnet-5-5` at `medium`.
- Stronger (a higher effort, or `claude-opus-5-5`): the phase must design something no code in the repository shows yet — a new state machine, an adapter to a system the code does not reach yet, a choice that crosses several parts of the architecture.
- Lighter (`claude-haiku-5-5`): the phase reproduces a pattern the code already holds, and a configured gate checks it.
<!-- END generated: phase-model-policy -->

- Any other catalog model only for a stated reason.
- Read the assignment bounds before assigning: `phax architecture` prints them after the parts, also when it exits 1 with its no-provider line. A bound names the files it covers (an architecture part, or globs), one model and an effort range.
- The first bound that matches any file the phase plans to create, edit or optionally edit governs it. With no match, the default above stands in.
- A phase conforms when it takes the governing bound's model at an effort inside the bound's range; with no governing bound, when it takes the default's model and effort exactly.
- A conforming phase has `assignmentReason: null` and no `**Assignment reason:**` line. Any other phase says why: its `assignmentReason` (headless), or an `**Assignment reason:**` line under its model and effort (by hand).
- `phax plans lint` and the run's start preflight fail an unstated departure from a bound. An unstated departure from the default is a warning. A conforming phase that carries a reason is a defect.
- A lighter model needs the detail: see "Comprehensive instructions".
- A plan that changes the catalog itself must name only models already in the shipped catalog: the run-start preflight uses the running binary's catalog, not the one the plan adds.

<!-- BEGIN generated: model-catalog -->
| ID | Family | Status | Efforts |
| --- | --- | --- | --- |
| `claude-haiku-5-5` | `claude-haiku` | active | `low` \| `medium` \| `high` \| `xhigh` \| `max` \| `ultracode` |
| `claude-haiku-4-5-20251001` | `claude-haiku` | active | `none` |
| `claude-sonnet-5-5` | `claude-sonnet` | active | `low` \| `medium` \| `high` \| `xhigh` \| `max` \| `ultracode` |
| `claude-sonnet-5` | `claude-sonnet` | active | `low` \| `medium` \| `high` \| `xhigh` \| `max` \| `ultracode` |
| `claude-sonnet-4-6` | `claude-sonnet` | active | `low` \| `medium` \| `high` \| `max` |
| `claude-opus-5-5` | `claude-opus` | active | `low` \| `medium` \| `high` \| `xhigh` \| `max` \| `ultracode` |
| `claude-opus-5` | `claude-opus` | active | `low` \| `medium` \| `high` \| `xhigh` \| `max` \| `ultracode` |
| `claude-opus-4-8` | `claude-opus` | active | `low` \| `medium` \| `high` \| `xhigh` \| `max` \| `ultracode` |
| `claude-fable-5-1` | `claude-fable` | active | `low` \| `medium` \| `high` \| `xhigh` \| `max` \| `ultracode` |
| `claude-fable-5` | `claude-fable` | active | `low` \| `medium` \| `high` \| `xhigh` \| `max` \| `ultracode` |
| `phax-mistral-medium-3.5-off` | `mistral-medium` | active | `off` |
| `phax-mistral-medium-3.5-low` | `mistral-medium` | active | `low` |
| `phax-mistral-medium-3.5-medium` | `mistral-medium` | active | `medium` |
| `phax-mistral-medium-3.5-high` | `mistral-medium` | active | `high` |
| `phax-mistral-medium-3.5-max` | `mistral-medium` | active | `max` |
| `gpt-6-sol` | `openai-gpt` | active | `low` \| `medium` \| `high` \| `xhigh` \| `max` \| `ultra` |
| `gpt-6-luna` | `openai-gpt` | active | `low` \| `medium` \| `high` \| `xhigh` \| `max` |
| `gpt-6-astra` | `openai-gpt` | active | `low` \| `medium` \| `high` \| `xhigh` \| `max` \| `ultra` |
| `gpt-5.6-luna` | `openai-gpt` | deprecated | `low` \| `medium` \| `high` \| `xhigh` \| `max` |
| `gpt-5.6-terra` | `openai-gpt` | deprecated | `low` \| `medium` \| `high` \| `xhigh` \| `max` \| `ultra` |
| `gpt-5.6-sol` | `openai-gpt` | deprecated | `low` \| `medium` \| `high` \| `xhigh` \| `max` \| `ultra` |
| `gpt-5.5` | `openai-gpt` | active | `low` \| `medium` \| `high` \| `xhigh` |
<!-- END generated: model-catalog -->

## Required commands declaration

Every plan must include a top-level `## Required commands` section that lists the
shell commands the plan needs the agent to be able to run. The section must
appear in the plan before the first phase heading.

```markdown
## Required commands

- deno fmt
- deno lint
```

Write `- (none)` when the plan introduces no new commands. The extraction model
reads this section and emits `run.requiredCommands` in `phax-plan.json`. The
preflight check in `phax run` fails the run early — before any agent spawns —
if any required command is absent from the frozen effective set (security config
∪ gate commands).

### When to declare required commands

Declare a required command whenever a phase introduces a tool, runtime, package
manager, or CLI that was **not already in use** in the repository. Examples:
Deno, Bun, pnpm, Vitest, Playwright, ESLint, Biome, Cargo, Docker, `gh`, `az`,
`terraform`. If you are not sure whether the command is already allowed, declare
it — the preflight will confirm coverage.

Do **not** declare commands that are always available in the execution environment
(e.g. `git`, standard POSIX shell builtins) unless a phase actually calls them
as agent tasks.

### Broad vs narrow allowances

A _broad_ allowance is a single token (e.g. `deno`). It covers any sub-command
(`deno fmt`, `deno lint`, `deno run …`) via the token-prefix rule.

A _narrow_ allowance is a command with sub-commands or arguments
(e.g. `deno fmt`). It is more precise but may be degraded to `enforcement:
"none"` by providers that cannot enforce per-command precision (codex, vibe).
Degraded entries are recorded in `security.json` with a `command-precision` mark
but do **not** block the run.

Prefer narrow allowances when you want to constrain the agent precisely.
Prefer broad allowances when you need the agent to run many sub-commands of the
same tool.

### Required PHAX security configuration changes

When the plan declares new required commands, add a `## Required PHAX security
configuration changes` section in the plan so the developer knows to update
`phax.json` before running:

```markdown
## Required PHAX security configuration changes

This plan requires the following commands to be added to
`security.agentCommands` in `phax.json` before running:

- `deno fmt`
- `deno lint`

Without this configuration the preflight check will fail before any agent
spawns.
```

Omit this section if the plan's `## Required commands` is `(none)`.

### `requiredCommands` as a run-level extracted field

`requiredCommands` is a **run-level** field (not per-phase). It is extracted from
the `## Required commands` section into `phax-plan.json` as
`run.requiredCommands`. The preflight checks it against the full frozen set once,
before any phase begins. A command is "covered" by a configured allowance if an
exact normalised match exists or a configured broad allowance (single token)
is a token-prefix of the required command (`deno` covers `deno fmt`).

## Planning constraints

- **Sequential only.** Phases execute one at a time; phax has no parallel
  execution mode.
- **No invented repo commands.** Gates come from `phax.json`, not from
  `plan.md`. Never invent `pnpm` scripts or CLI commands that do not already
  exist in the project. `### Verification` names the configured gate profile; it
  does not introduce new commands.
- **Small, committable phases.** Each phase must produce a single coherent
  commit. If the diff would be hard to review, split the phase.
- **Gate-verifiable outcomes.** Every phase must have an outcome the configured
  gates can verify mechanically (type-check, tests, lint, build, etc.).
- **Accurate file lists.** The planned-file sections must match what the phase
  actually touches; they are reconciled against git at the end of the phase.
- **A phase reads its own section.** A phase's prompt carries the plan
  preamble, its own section, an outline of every phase (id, title, planned files
  to create and edit) and its phase definition; the full plan is at
  `.phax-context/plan.md` in the worktree. So:
  - put cross-phase decisions in the preamble, such as Technical arbitrations;
  - make each section self-contained, with no bare "as in phase-02";
  - rely on the planned file lists to show other phases' footprint;
  - give every phase a `## phase-NN — Title {#anchor}` heading, numbered without
    gaps.
- **Handoff-complete.** The handoff the executing agent writes must be enough
  for the next phase to proceed without re-reading earlier phases.
- **Comprehensive instructions.** Make sure each phase has enough detail for the
  model and effort you picked to execute it successfully.
- **No phax lifecycle commands in a phase.** A phase runs inside a phase worktree,
  where phax refuses every command except `phax brief`, `phax architecture` and the read-only ones
  (`plans lint`, `artifact status`, `records explain`, …). Never instruct a phase to
  approve, complete or abandon an artifact, or to run, resume, archive or publish.
  Those steps belong to the operator, in the main checkout. In a project whose tests
  start the phax CLI as a process, those tests also run inside the phase worktree,
  so give each one its own temporary repository as its working directory.
- **Briefs are already in the prompt.** When the project configures a `brief`
  provider, each phase's first prompt carries the brief for its planned files. Do not
  restate the project's standard in the instructions. A phase that works on paths
  outside its planned files can be told to run `phax brief <path>` before editing
  them.

## What makes a good phase boundary

- One clear outcome per phase (a file, a feature, a set of tests).
- Gates from `phax.json` must be able to verify the outcome mechanically.
- Phases that share state (e.g., a port defined in phase N used in phase N+1)
  must name the exact module path in the handoff expectations.

## Anti-patterns to avoid

- Phases with no mechanical verification step (gates must be able to pass/fail).
- Vague commit subjects — the subject is used in the git log; keep it precise.
- Scope creep — "and also clean up X" in a phase that has a different primary
  objective splits reviewer attention and risks the gate failing on unrelated work.
- Skipping the `{#phase-NN-<slug>}` anchor — the extraction uses it as the
  `planMarkdownAnchor` field and will error without it.
- Parallel or overlapping phase scope — each phase must be independently
  committable; assume the previous phase is done and merged.
- Inaccurate file lists — listing files you will not touch (noisy deviations),
  omitting files you will (false deviations), or listing files you only read.
- Putting "maybe" files in the create/edit lists instead of the optional list.
- A Test strategy in prose ("add unit tests") instead of one line per guarantee with its
  size, technique, oracle and loop.
- An oracle that pins the code's internal design, or that judges with a generator or table
  left outside its oracle files.
- Silently arbitrated trade-offs — picking between viable approaches without
  asking the human, or recording the decision without the loss accepted (see
  Technical arbitrations). Symmetric pros/cons lists are the same smell in
  disguise.

## Headless authoring

Everything above describes the Markdown plan you write in an interactive session. When the
session is spawned by `phax artifact new plan <slug> --headless --brief <file|->`, the
deliverable changes: you return the **plan document** — a JSON object — and phax renders it
deterministically to the phase structure above, writes the `.md` with its JSON sidecar
beside it, seeds the extraction cache so `phax run` never re-extracts it, and commits both.
The planning doctrine does not change; only the container does.

Skill files follow the same rule (see "Editing skill files"): the `plannedFilesToCreate` /
`plannedFilesToEdit` / `optionalFilesToEdit` arrays are the declaration.

- **The JSON object is your final message**, alone: no code fence, no commentary before or
  after it. The prompt carries the authoritative JSON Schema; `phax artifact schema plan`
  prints the same schema.
- **Write no files.** phax writes, renders and commits; a file you write is not the artifact.
- **Every key is required.** Unknown keys are rejected.
- **Lists are plain arrays.** An empty list is `[]`: phax renders it as `- (none)`. Paths,
  required commands and the commit subject are plain strings — phax renders them as code
  spans; do not add backticks.

Top-level keys:

- `version`: `1`; `kind`: `"plan"`.
- `sourceSpec`: the `--spec` path given to phax, or `null` without one (the prompt says
  which). phax sets it from `--spec` regardless, so frontmatter and sidecar agree.
- `completesSpec`: `true` or `false` beside a `sourceSpec` path, `null` without one. phax
  sets it from `--last`/`--not-last` regardless.
- `run`: `{ shortName, title, requiredCommands }` — the extracted run fields
  (`# <Title>`, `## Required commands`).
- `preamble`: `{ summary, requiredCommandsNote, technicalArbitrations, openQuestions,
  arbitratedQuestions }` — the prose under the title, the note after the required-commands
  list, and one string per arbitration (rendered as `## Technical arbitrations`, omitted when
  empty). `openQuestions` and `arbitratedQuestions` are required. Leave each arbitration you
  cannot settle in `openQuestions`, in the same shape as a spec's: `{ id, question, options:
  [{ id, label, abandons }], recommendation, rationale }`, with `recommendation` naming one
  option id. `other` is a reserved id, implicit on every question: never list it among the
  options and never recommend it. Settled arbitrations stay prose in `technicalArbitrations`. `arbitratedQuestions`
  is always `[]`: an authoring session arbitrates no question, and a non-empty one is refused
  as an invalid document. `phax artifact decide <plan>` answers the open questions, and
  approval waits until none is open.
- `phases`: a non-empty array, one object per phase.

A phase's keys, in the document's order: `id`, `title`, `objective`,
`detailedInstructions`, `planMarkdownAnchor`, `plannedFilesToCreate`, `plannedFilesToEdit`,
`optionalFilesToEdit`, `mode`, `oracle`, `boundaryContracts`, `testStrategy`,
`implementationOrder`, `excludedScope`, `verification`, `expectedHandoff`, `commit`, then
`assignmentReason`, `model`,
`effort` last. Write them in that order: the phase's content first, its assignment last,
because you assign a phase only once it is written (see "Choosing a model and effort").

Each phase carries the **extracted fields** — exactly what `phax run` reads, and exactly
the cache seed:

- `id` (`phase-NN`), `planMarkdownAnchor` (`#phase-NN-<slug>`, rendered as the heading's
  `{#phase-NN-<slug>}`).
- `plannedFilesToCreate`, `plannedFilesToEdit`, `optionalFilesToEdit`: string arrays.
- `mode`, `oracle`: write `mode: "interactive"` only on a phase meant for review (see
  [Interactive phases](#interactive-phases)), and `mode: "headless"` everywhere else. Write `oracle: null`,
  or `oracle: { dischargedBy: "phase-NN", files: [...] }` on an oracle phase when the authoring
  prompt says an `oracles` provider is configured (see [Oracle phases](#oracle-phases)).
- `commit`: `{ subject, body }`.
- `model`, `effort` (see the model catalog).

and the fields that only render the phase:

- `title` — the heading text after `phase-NN — `; phax derives the run's phase title from
  the rendered heading, as for any plan.md, so it is not part of the seed.
- `objective` — the paragraph under the model/effort lines.
- `detailedInstructions`, `implementationOrder` (rendered numbered), `excludedScope`:
  string arrays.
- `boundaryContracts`: a string, or `null` for a phase that crosses no boundary — the
  section is then omitted rather than filled.
- `testStrategy`: an array of test lines `{ guarantee, size, technique, oracle, loop, criterion }`,
  every key required and `criterion` null when the line names none; `[]` for a phase that tests
  nothing. See [Test strategy](#test-strategy).
- `verification`, `expectedHandoff`: strings.
- `assignmentReason` — why the phase leaves its governing bound or the default assignment, rendered as an
  `**Assignment reason:**` line under its effort line. Put each departure's reason in that
  phase's `assignmentReason`, and `assignmentReason: null` on every phase that conforms to its governing
  bound (or, with none, takes the default). Never put a
  reason in `preamble.technicalArbitrations`.

## Example well-formed phase

```markdown
## phase-03 — Run folder model and atomic writes {#phase-03-run-folder}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

Introduce the run-folder model and atomic file writes so later phases have a
durable place to persist run state.

### Detailed instructions

- Add `createRunFolder(shortName, …)` returning the run path.
- Route all writes through an atomic write helper.

### Planned files to create

- `src/app/runFolder.ts`
- `tests/unit/runFolder.test.ts`

### Planned files to edit

- `src/app/index.ts`

### Optional files that may be edited

- (none)

### Test strategy

- a run folder is created with its layout, and a second create of the same name is refused
  — medium · example · expected tree and typed error · in-phase
- an interrupted write leaves the previous file whole — medium · example · file content
  before and after · in-phase

### Excluded scope

- Phase-level worktree creation (phase-04).

### Verification

- The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- The exact path `src/app/runFolder.ts` and the `createRunFolder` signature.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(run): add run folder model and atomic writes

### Commit body

Add createRunFolder and an atomic write helper so later phases can persist run
state durably. Covered by a unit test exercising the folder layout.
```
