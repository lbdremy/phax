---
name: phax-planning
description: Write or review a plan.md that `phax extract-plan` will turn into phax-plan.json — phase structure, required fields, model/effort, commit metadata.
---

# phax planning skill

Use this skill when you are asked to write or review a `plan.md` that will be
fed to `phax extract-plan`.

## What phax expects

`phax extract-plan` passes your `plan.md` to Claude Code with the
`phax-plan.json` JSON Schema and asks it to return only structured JSON. The
extraction succeeds when every required field is present and unambiguous. It
fails loudly when required data is missing — it never guesses.

Each phase also declares the files it expects to touch. After a phase commits,
phax reconciles those declarations against the actual git diff and asks the
executing agent to explain any deviation in its handoff (see
[End-of-phase file reconciliation](#end-of-phase-file-reconciliation)).

## Per-phase field set

Each phase section must contain all of the following. Fields marked **extracted**
are pulled by `phax extract-plan` into `phax-plan.json`; the rest are
informational for the executing agent.

| Field                    | Location in section                                     | Extracted? |
| ------------------------ | ------------------------------------------------------- | ---------- |
| `id`                     | Derived from the heading (`phase-01` → `"phase-01"`)    | yes        |
| `title`                  | Section heading after the dash                          | yes        |
| `model`                  | `**Recommended model:** <model-id>` line                | yes        |
| `effort`                 | `**Recommended effort:** low\|medium\|high` line        | yes        |
| `planMarkdownAnchor`     | `{#phase-NN-<slug>}` in the heading line                | yes        |
| `plannedFilesToCreate`   | `### Planned files to create` list                      | yes        |
| `plannedFilesToEdit`     | `### Planned files to edit` list                        | yes        |
| `optionalFilesToEdit`    | `### Optional files that may be edited` list            | yes        |
| `commit.subject`         | `### Commit subject` subsection                         | yes        |
| `commit.body`            | `### Commit body` subsection                            | yes        |
| Objective                | Opening paragraph of the phase section                  | no         |
| Detailed instructions    | `### Detailed instructions` bullet list                 | no         |
| Boundary contracts       | `### Boundary contracts` subsection                     | no         |
| Test strategy            | `### Test strategy` subsection                          | no         |
| Implementation order     | `### Implementation order` subsection                   | no         |
| Excluded scope           | `### Excluded scope` list                               | no         |
| Verification             | `### Verification` (names the `phax.json` gate profile) | no         |
| Expected handoff content | `### Expected handoff content`                          | no         |

The run-level field `requiredCommands` (extracted from `## Required commands` in
the plan preamble) is **not** per-phase — it applies to the whole run. See
[Required commands declaration](#required-commands-declaration).

The three planned-file arrays are **required**: the section must be present even
when it is empty (write `- (none)` for an empty list). They back the end-of-phase
file reconciliation. The current extractor does not yet pull these three arrays
into `phax-plan.json`, so include them now to keep plans forward-compatible.

## Phase section structure

```markdown
## phase-NN — <Title> {#phase-NN-<slug>}

**Recommended model:** <model-id>
**Recommended effort:** low | medium | high

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

<what to test, at which layer, and which tests to write before implementation>

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
- `phax extract-plan` derives `id` as `"phase-NN"` (e.g. `"phase-01"`, matching
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

## Boundary contracts (informational)

When a phase crosses an architectural boundary (page/cli/surface → view-model,
view-model → application command, command → port, …), describe the contract in
consumer/producer terms: who needs something, who provides it, and the stable
shape between them. Be strict on the semantic need, adaptable on the exact
interface shape. These are human-readable today (not extracted);. Omit the section for a phase that crosses no boundary.

## Test strategy (informational)

Map tests to the layer they exercise and pick the cheapest reliable test for
that layer:

| Layer                     | Preferred test type                       |
| ------------------------- | ----------------------------------------- |
| Domain                    | Unit tests                                |
| Application command/query | Unit or integration tests with fake ports |
| Ports                     | Type/contract tests                       |
| Adapters                  | Integration tests                         |
| ViewModel                 | Integration tests                         |
| View                      | Component/unit tests                      |
| Page/route/CLI            | E2E or smoke tests                        |

Mark which tests to write **before** implementation. Do it for stable contracts
and critical behavior (domain invariants, application commands, ports, bug
fixes, regressions); skip strict test-first for exploratory UI and scaffolding.

## Planning doctrine

- **Plan outside-in.** Start from the user-visible need and trace the path it
  must take through the system (page → view-model → command → domain → port →
  adapter → storage). This is how you discover which files each phase touches.
- **Implement inside-out.** Order the work core-to-surface (domain → ports →
  command → adapter → view-model → view → route) so the surface never claims a
  behavior the core does not yet provide.
- **Verify outside-in.** End by checking the user-visible behavior works end to
  end, then let the gates confirm it.

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
- **Use the `fast` gate profile, not `full`.** Spike artifacts (`spikes/`, docs) have no
  architecture/knip/build surface to protect, so a passing `full` gate is misleading
  "false green". `fast` is honest and `typecheck` still covers any TypeScript
  scaffolding the spike produces. Gates passing trivially ("à vide") is acceptable for a
  spike — the real signal lives in the findings doc, not the gate.
- **State the execution-model caveat in the plan Overview.** A phase agent runs in a
  worktree and cannot reliably self-verify real-world effects (a microVM escape, a live
  egress block). Say so explicitly, so the synthesis reads as provisional until a real
  run fills the Results sections.

## Model IDs

Use exact model IDs:

- `claude-sonnet-4-6` — default for most phases
- `claude-opus-4-8` — reserve for deep reasoning (architecture audit, etc.)
- `claude-haiku-4-5-20251001` — reserve for trivial tasks

## Effort values

Plans prefer Claude-oriented naming because Claude is the routing reference scale. Valid efforts per model family:

| Family           | Valid efforts                                                  |
| ---------------- | -------------------------------------------------------------- |
| `claude-haiku`   | `none`                                                         |
| `claude-sonnet`  | `low` \| `medium` \| `high` \| `max`                           |
| `claude-opus`    | `low` \| `medium` \| `high` \| `xhigh` \| `max` \| `ultracode` |
| `mistral-medium` | `off` \| `low` \| `medium` \| `high` \| `max`                  |
| `openai-gpt`     | `low` \| `medium` \| `high` \| `xhigh`                         |

The superset across all families: `none | off | low | medium | high | xhigh | max | ultracode`. Per-family validity is enforced by the routing layer — the plan schema accepts the full superset.

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
- **Handoff-complete.** The handoff the executing agent writes must be enough
  for the next phase to proceed without re-reading earlier phases.
- **Comprehensive instructions.** Make sure each phase has enough detail for the
  model and effort you picked to execute it successfully.

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
- Skipping the `{#phase-NN-<slug>}` anchor — `phax extract-plan` uses it as the
  `planMarkdownAnchor` field and will error without it.
- Parallel or overlapping phase scope — each phase must be independently
  committable; assume the previous phase is done and merged.
- Inaccurate file lists — listing files you will not touch (noisy deviations),
  omitting files you will (false deviations), or listing files you only read.
- Putting "maybe" files in the create/edit lists instead of the optional list.

## Example well-formed phase

```markdown
## phase-03 — Run folder model and atomic writes {#phase-03-run-folder}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low

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

### Excluded scope

- Phase-level worktree creation (phase-04).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact path `src/app/runFolder.ts` and the `createRunFolder` signature.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(run): add run folder model and atomic writes

### Commit body

Add createRunFolder and an atomic write helper so later phases can persist run
state durably. Covered by a unit test exercising the folder layout.
```
