# PHAX Phase Planning Skill Update: File Intent, Boundary Contracts, and Phase Handoff Reporting

## Purpose

This document defines an update to the PHAX phase planning skill.

PHAX currently extracts phase-level execution metadata from a Markdown plan, such as:

```txt
phase number
model
model effort
commit message
phase instructions
```

The next version should also extract and use planned file-level intent:

```txt
files expected to be created
files expected to be edited
optional files that may be edited
tests expected to be created or updated
```

This enables PHAX to perform a simple but valuable end-of-phase reconciliation:

```txt
What did the plan say this phase should touch?
What did the agent actually touch?
What files were expected but not created or edited?
What extra files were created or edited?
Did the agent explain deviations in the phase handoff?
```

This is intentionally simpler than full STEME architectural analysis. It does not require PHAX to understand boundaries, domains, ViewModels, ports, adapters, or product-depth wiring yet. It only requires PHAX to extract planned file intent and compare it with actual git changes.

Later, STEME can use the same planning structure to perform higher-level checks around boundaries, wiring, product depth, and architectural guarantees.

## Core principle

PHAX should not only orchestrate phases.

It should orchestrate the expected movement of a behavior through the system.

A good phase plan should describe:

```txt
what capability is being added
which files are expected to be created
which files are expected to be edited
which boundaries the behavior crosses
which contracts are expected between consumer and producer
which tests should validate each layer
how the next phase should inherit context from previous phases
```

The phase plan is not a prison. It is a structured intent.

Agents may discover that additional files need to be created or edited. That is allowed. But deviations must be reported and explained.

## Planning doctrine

The planning skill should teach the agent to use this sequence:

```txt
Plan outside-in.
Implement inside-out.
Verify outside-in.
```

### Plan outside-in

Planning starts from the consumer’s need.

```txt
User need
→ Page / route / screen
→ View
→ ViewModel
→ Application command/query
→ Domain
→ Port
→ Adapter
→ Storage / external system
```

The goal is to understand the user-visible behavior and identify the architectural path required to support it.

### Implement inside-out

Once contracts are planned, implementation usually proceeds from the core toward the surface.

```txt
Domain
→ Ports
→ Application command/query
→ Adapters
→ ViewModel
→ View
→ Page / route
→ End-to-end verification
```

This reduces fake completion. The UI should not be built as an isolated shell that is later loosely connected to the system. The core behavior should exist before the surface claims to expose it.

### Verify outside-in

Final verification should return to the user-visible surface.

```txt
Can the user perform the intended action?
Does the UI call the ViewModel?
Does the ViewModel call the application layer?
Does the application layer use the domain and ports?
Do adapters produce the expected effect?
Are tests and gates passing?
```

## Consumer / producer contract negotiation

At each boundary, the planning agent should reason in terms of consumer and producer.

```txt
Consumer:
The layer that needs something.

Producer:
The layer that provides something.

Contract:
The shape that allows the consumer to express its need while allowing the producer to remain clean, stable, and coherent.
```

The semantic need belongs to the consumer.

The exact interface shape should be negotiated with the producer.

The principle:

```txt
Be strict on semantic intent.
Be adaptable on interface shape.
```

Example:

```txt
The page needs to create a project from user input.
The application layer should not receive raw UI state.
The contract should expose the necessary project creation data in a stable application-level shape.
```

Possible contract:

```ts
export type CreateProjectInput = {
  name: string;
  description?: string;
  ownerId: UserId;
};

export type CreateProjectResult =
  | { status: "created"; project: Project }
  | { status: "invalid"; errors: ProjectValidationError[] };
```

The page should not dictate a UI-shaped contract.

The application layer should not expose a domain shape that is inconvenient or leaky for the consumer.

The contract should preserve the consumer’s need while fitting the producer’s responsibility.

## Phase structure update

Each PHAX phase should include the following sections. The heading line,
`**Recommended model:**` / `**Recommended effort:**` lines, and
`### Commit subject` / `### Commit body` subsections are the existing extracted
fields (see `src/schemas/phaxPlan.ts`) and must keep their exact shape. The
file-list subsections are the additions this update introduces.

```md
## phase-NN — <Phase Title> {#phase-NN-<slug>}

**Recommended model:** <model-id>
**Recommended effort:** low | medium | high

### Intent

<What user-visible or system-visible capability this phase adds.>

### Detailed instructions

<Bullet list of what to implement.>

### Planned files to create

- <path/to/new-file.ts>
- <path/to/new-test.test.ts>

### Planned files to edit

- <path/to/existing-file.ts>
- <path/to/existing-test.test.ts>

### Optional files that may be edited

- <path/to/file-that-may-need-update.ts>

### Boundary contracts

<Consumer/producer contracts crossed by this phase.>

### Test strategy

<What should be tested, where, and whether tests should be written before implementation.>

### Implementation order

<Recommended implementation order, usually core-to-surface after planning.>

### Verification

<The phax.json gate profile that verifies this phase. Do not invent commands —
gates come from phax.json, never from the plan.>

### Handoff requirements

<What the agent must report at the end of the phase.>

### Commit subject

<Single-line conventional-commit subject.>

### Commit body

<Commit body paragraph explaining the change.>
```

Heading conventions (enforced by `phax extract-plan`):

- `## phase-NN — <Title> {#phase-NN-<slug>}` — `NN` is zero-padded to two
  digits, `<slug>` is lowercase letters and hyphens, and the `{#phase-NN-<slug>}`
  anchor must be on the same line as the heading. The extractor derives `id`
  (e.g. `"phase-01"`, matching `/^phase-\d{2}$/` — not `"1"`) and
  `planMarkdownAnchor` from this line and errors loudly if the anchor is missing.
- `model` is read from the `**Recommended model:**` line; use an exact model id
  (`claude-sonnet-4-6`, `claude-opus-4-7`, `claude-haiku-4-5-20251001`).
- `effort` is read from the `**Recommended effort:**` line: `low | medium | high`.
- `commit.subject` and `commit.body` are **both required** non-empty values,
  extracted from the `### Commit subject` and `### Commit body` subsections.

## Planned file sections

The planning skill should require these file lists.

### Planned files to create

Files that should not exist before the phase and are expected to be created.

Example:

```md
### Planned files to create

- src/projects/domain/Project.ts
- src/projects/application/CreateProjectCommand.ts
- src/projects/application/ports/ProjectRepository.ts
- src/projects/domain/**tests**/Project.test.ts
- src/projects/application/**tests**/CreateProjectCommand.test.ts
```

### Planned files to edit

Existing files that are expected to be modified.

Example:

```md
### Planned files to edit

- src/projects/index.ts
- src/app/projects/new/page.tsx
```

### Optional files that may be edited

Files that may need changes depending on implementation details.

Example:

```md
### Optional files that may be edited

- src/shared/test/factories/projectFactory.ts
- src/shared/config/routes.ts
```

Optional files should not trigger the same warning as required planned files. They exist to communicate likely impact without over-constraining the agent.

## End-of-phase file reconciliation

At the end of each phase, PHAX should compare:

```txt
planned files to create
planned files to edit
optional files that may be edited
actual files created
actual files edited
actual files deleted
actual files renamed
```

The first implementation can use git diff metadata. Each phase is committed on
its own branch in its own worktree, so the phase's changes are exactly its last
commit. phax already saves `git diff HEAD^ HEAD` as `diff.patch` after the
phase commit (`src/app/commit.ts`); reconciliation reuses the same range with
`--name-status`:

```txt
actual changes = git diff --name-status HEAD^ HEAD   # run in the phase worktree
```

Status codes map directly: `A` → created, `M` → edited, `D` → deleted,
`R` → renamed (the last two are deviations the agent must explain).

PHAX generates the file reconciliation report deterministically from this diff
and the planned file lists — the agent does not hand-author it.

Example:

```txt
File reconciliation report

Planned created files:
✓ src/projects/domain/Project.ts
✓ src/projects/application/CreateProjectCommand.ts
✗ src/projects/application/ports/ProjectRepository.ts

Planned edited files:
✓ src/projects/index.ts
✗ src/app/projects/new/page.tsx

Unplanned created files:
+ src/projects/application/CreateProjectResult.ts

Unplanned edited files:
~ src/shared/types.ts

Potential issues:
- ProjectRepository.ts was expected but not created.
- The project page was expected to be edited but was not touched.
- CreateProjectResult.ts was created but not declared in the plan.
- shared/types.ts was edited but not declared in the plan.

Required handoff explanation:
The agent must explain why the unplanned files were touched and why planned files were skipped.
```

## Default behavior

Missing or unplanned files should not automatically fail the phase at first.

The default behavior should be:

```txt
warn and report
```

Later, PHAX can support stricter modes.

Suggested modes (a new optional `fileReconciliation` block in `phax.json`,
camelCase to match the existing config schema in `src/schemas/phaxConfig.ts`):

```json
{ "fileReconciliation": { "mode": "report_only" } }
```

```json
{ "fileReconciliation": { "mode": "warn" } }
```

```json
{ "fileReconciliation": { "mode": "fail_on_missing_required_created_files" } }
```

```json
{ "fileReconciliation": { "mode": "fail_on_unexplained_deviation" } }
```

The first useful version should use `report_only` or `warn`. The `fail_*` modes
require a new failure transition in the run state machine (like the existing
`handoff_failed`) and should land in a later iteration.

The goal is not to block useful work. The goal is to make deviations visible and transmissible to the next phase.

## Phase handoff update

phax already requires every phase to end with a
`.phax-context/phase-handoff.md`, written by the agent after gates pass and
consumed by the next phase. `src/app/handoffGeneration.ts` validates that the
file contains **exactly these four sections, in order** — a missing heading
transitions the phase to `handoff_failed` and stops the run:

### Required handoff fields

```md
## What was delivered

## Key decisions and why

## Exact locations (file paths and exported names)

## What the next phase needs to know
```

This four-section contract is unchanged by this update. The file-reconciliation
report (the planned-vs-actual file comparison) is **generated by phax from git**,
not hand-authored by the agent. The agent's only new responsibility is to
**explain deviations**: when reconciliation flags a planned file that was not
touched, or an unplanned file that was, the agent must give the reason under
`## What the next phase needs to know`. phax flags _what_ deviated; only the
agent knows _why_. See `.skills/phax-phase-handoff.md` for the per-section
guidance.

## Accumulated phase context

PHAX should preserve phase handoff data across phases.

Each new phase should receive:

```txt
the original plan for the current phase
the file reconciliation report from previous phases
the handoff from previous phases
the cumulative list of files created or edited so far
```

This creates continuity across agent runs.

The next phase should know not only what the original plan said, but what actually happened.

Example cumulative context:

```yaml
previous_phase_context:
  files_created_so_far:
    - src/projects/domain/Project.ts
    - src/projects/application/CreateProjectCommand.ts
    - src/projects/application/CreateProjectResult.ts

  files_edited_so_far:
    - src/projects/index.ts
    - src/shared/types.ts

  unexplained_or_risky_changes:
    - src/shared/types.ts was edited in Phase 1 but was not planned.

  missing_expected_files:
    - src/projects/application/ports/ProjectRepository.ts was expected in Phase 1 but not created.

  notes_for_current_phase:
    - Verify whether ProjectRepository still needs to be introduced before implementing persistence.
```

This makes the phase plan adaptive without losing accountability.

## Boundary contracts in the plan

The current PHAX implementation does not need to understand boundary contracts.

However, the planning skill should already ask the agent to write them.

For now, they are human-readable planning artifacts.

Later, STEME can parse or analyze them.

Example:

```md
### Boundary contracts

#### Page -> ViewModel

Consumer:
`CreateProjectPage`

Producer:
`CreateProjectViewModel`

Semantic need:
The page needs to submit project creation input and display loading, success, and validation error states.

Contract shape:
`CreateProjectViewModel` exposes:

- `form`
- `submit(input)`
- `state`
- `errors`

Expected files:

- `src/app/projects/new/page.tsx`
- `src/projects/viewmodels/CreateProjectViewModel.ts`

Test strategy:
Integration test or component-level test with fake application command.

#### ViewModel -> Application Command

Consumer:
`CreateProjectViewModel`

Producer:
`CreateProjectCommand`

Semantic need:
The ViewModel needs to create a project from validated user input and map the result to UI state.

Contract shape:
`CreateProjectCommand.execute(input: CreateProjectInput): Promise<CreateProjectResult>`

Expected files:

- `src/projects/viewmodels/CreateProjectViewModel.ts`
- `src/projects/application/CreateProjectCommand.ts`

Test strategy:
Integration test using a fake ProjectRepository.
```

The planning skill should use these contracts to identify the files expected to be created or edited.

## Test strategy by layer

The planning skill should ask the agent to map tests to architectural layers.

Suggested default mapping:

| Layer                     | What to test                                       | Preferred test type                       |
| ------------------------- | -------------------------------------------------- | ----------------------------------------- |
| Domain                    | Invariants, transitions, validation, domain errors | Unit tests                                |
| Application command/query | Orchestration through ports                        | Unit or integration tests with fake ports |
| Ports                     | Expected contract shape                            | Type tests or contract tests              |
| Adapters                  | Side effects and external integration              | Integration tests                         |
| ViewModel                 | UI intent mapped to application behavior and state | Integration tests                         |
| View                      | Rendering, props, local interaction states         | Component/unit tests                      |
| Page/route                | Full wiring and user-visible flow                  | E2E or smoke tests                        |

The planning skill should avoid treating all tests as equivalent.

The important question is:

```txt
What is the cheapest reliable test for this layer?
```

## Test-first guidance

PHAX should not force dogmatic TDD everywhere.

Instead, the planning skill should use this rule:

```txt
When a phase introduces a stable contract or critical behavior, write the failing test or failing check before implementation.
```

Good candidates for test-first implementation:

```txt
domain invariants
application commands
queries
ports
adapters
critical ViewModel flows
product-depth wiring checks
bug fixes
regressions
```

Poor candidates for strict test-first implementation:

```txt
pure layout exploration
early visual design
unstable UI composition
temporary scaffolding
micro-interactions still being explored
```

The phase plan should mark test-first expectations explicitly.

Example:

```md
### Test strategy

Test-first:

- Create `CreateProjectCommand.test.ts` before implementation.
- The first failing test should prove that `CreateProjectCommand.execute` creates a valid project and calls `ProjectRepository.save`.

Implementation-after-test:

- Implement `Project`.
- Implement `ProjectRepository` port.
- Implement `CreateProjectCommand`.
```

## Product-depth connection

This PHAX update supports product-depth wiring without requiring STEME to exist yet.

The immediate check is simple:

```txt
Did the phase create or edit the files it claimed were needed?
```

Later, STEME can ask richer questions:

```txt
Does the page actually use the ViewModel?
Does the ViewModel actually call the application command?
Does the command actually use the domain model and port?
Does the adapter actually perform the side effect?
Does the user-visible flow prove the behavior is real?
```

So this PHAX structure is forward-compatible with STEME.

The short-term mechanism is file reconciliation.

The long-term mechanism is architectural and product-depth analysis.

## PHAX extraction requirements

PHAX extracts a fixed set of per-phase fields into `phax-plan.json`. The field
names below are the actual camelCase keys in `PhaseSchema`
(`src/schemas/phaxPlan.ts`).

Existing extracted fields (unchanged):

```jsonc
{
  "id": "phase-01", // matches /^phase-\d{2}$/
  "title": "Create Project domain and application command",
  "model": "claude-sonnet-4-6",
  "effort": "medium", // low | medium | high
  "planMarkdownAnchor": "#phase-01-create-project",
  "commit": {
    "subject": "feat(projects): add project domain and create command",
    "body": "...",
  },
}
```

New extracted fields — the only additions this update introduces, because they
are the only fields reconciliation consumes:

```jsonc
{
  "plannedFilesToCreate": [
    "src/projects/domain/Project.ts",
    "src/projects/application/CreateProjectCommand.ts",
  ],
  "plannedFilesToEdit": ["src/projects/index.ts"],
  "optionalFilesToEdit": ["src/shared/test/factories/projectFactory.ts"],
}
```

These three fields are **required arrays** (an empty `[]` is valid, but the key
must be present) — phax schemas do not add optional-for-back-compat fields. Note
the naming nuance: `optionalFilesToEdit` describes files whose _contents_ are
optional to touch; the _field itself_ is still required.

Boundary contracts, test strategy, implementation order, and test-first markers
stay as **human-readable sections** in the plan for the executing agent (and a
future STEME) — they are not extracted into `phax-plan.json` yet, mirroring how
the skill already treats the objective and scope sections as informational.
Verification is never a plan field: gates come from `phax.json`.

PHAX does not need to interpret all fields immediately.

Minimum useful implementation:

```txt
extract plannedFilesToCreate
extract plannedFilesToEdit
extract optionalFilesToEdit
compare them with `git diff --name-status HEAD^ HEAD` at end of phase
write the reconciliation report into the phase folder
inject the previous phase's reconciliation + handoff into the next phase prompt
```

## Suggested Markdown format for planning skill output

The planning skill should output each phase using a consistent structure.

Example:

```md
## phase-01 — Create Project domain and application command {#phase-01-create-project}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

### Intent

Introduce the core project creation behavior without wiring it to the UI yet.

### Planned files to create

- `src/projects/domain/Project.ts`
- `src/projects/domain/ProjectValidationError.ts`
- `src/projects/application/CreateProjectCommand.ts`
- `src/projects/application/CreateProjectResult.ts`
- `src/projects/application/ports/ProjectRepository.ts`
- `src/projects/domain/__tests__/Project.test.ts`
- `src/projects/application/__tests__/CreateProjectCommand.test.ts`

### Planned files to edit

- `src/projects/index.ts`

### Optional files that may be edited

- `src/shared/test/factories/projectFactory.ts`

### Boundary contracts

#### Application Command -> Domain

Consumer:
`CreateProjectCommand`

Producer:
`Project`

Semantic need:
The command needs to create a valid Project from project creation input.

Contract:
`Project.create(input): Result<Project, ProjectValidationError[]>`

#### Application Command -> Repository Port

Consumer:
`CreateProjectCommand`

Producer:
`ProjectRepository`

Semantic need:
The command needs to persist a valid Project after creation.

Contract:
`ProjectRepository.save(project): Promise<void>`

### Test strategy

Test-first:

- `src/projects/domain/__tests__/Project.test.ts`
- `src/projects/application/__tests__/CreateProjectCommand.test.ts`

Unit tests:

- Project validation and creation invariants.
- CreateProjectCommand behavior with fake ProjectRepository.

### Implementation order

1. Write failing domain tests.
2. Implement Project and ProjectValidationError.
3. Write failing command tests with fake ProjectRepository.
4. Implement ProjectRepository port.
5. Implement CreateProjectCommand and CreateProjectResult.
6. Export public project application API from `src/projects/index.ts`.

### Verification

Verified by the project's configured gate profile in `phax.json` (e.g.
typecheck, lint, tests, build). The plan does not invent commands.

### Handoff requirements

phax generates the file-reconciliation report (planned vs. actual) from git.
In `phase-handoff.md`, under the four required sections, the agent must explain
any deviation phax flags — e.g. if `CreateProjectResult.ts` is folded into
`CreateProjectCommand.ts` instead of created, or an optional file is left
untouched. Record exact paths and exported names under
`## Exact locations (file paths and exported names)` and surprises under
`## What the next phase needs to know`.

### Commit subject

feat(projects): add project domain and create-project command

### Commit body

Introduce the Project domain model, ProjectValidationError, the
CreateProjectCommand/Result application types, and the ProjectRepository port,
with unit tests for domain invariants and command orchestration against a fake
repository. No UI wiring yet.
```

## End-of-phase prompt addition

phax already appends handoff instructions to every phase prompt
(`src/app/promptGeneration.ts` and `src/app/handoffGeneration.ts`): the agent
writes `.phax-context/phase-handoff.md` with the four required sections. This
update adds **one** instruction to that prompt. The agent does not author the
reconciliation report — phax computes it from git — it only explains deviations:

```md
## File-plan deviations

phax will compare the files you actually changed against this phase's
`plannedFilesToCreate`, `plannedFilesToEdit`, and `optionalFilesToEdit`.

Before finishing, under `## What the next phase needs to know`, explain:

- any planned file you did NOT create or edit, and why;
- any file you created or edited that was NOT planned (and is not listed as an
  optional file), and why.

Do not hide deviations. Deviations are allowed, but they must be explained.
```

## Simple file reconciliation output

phax generates this report deterministically from git after the phase commit
and writes it to the phase folder (e.g. `phase-01/file-reconciliation.md`, with
a machine-readable `file-reconciliation.json` alongside `diff.patch`):

```md
## PHAX File Reconciliation

### Planned files to create

- [x] `src/projects/domain/Project.ts`
- [x] `src/projects/application/CreateProjectCommand.ts`
- [ ] `src/projects/application/ports/ProjectRepository.ts`

### Planned files to edit

- [x] `src/projects/index.ts`
- [ ] `src/app/projects/new/page.tsx`

### Optional files edited

- [x] `src/shared/test/factories/projectFactory.ts`

### Unplanned files created

- `src/projects/application/CreateProjectResult.ts`
  - Deviation — agent must explain in `phase-handoff.md`.

### Unplanned files edited

- `src/shared/types.ts`
  - Deviation — agent must explain in `phase-handoff.md`.

### Summary

This phase mostly followed the file plan, but one expected port file was not created and two unplanned files were changed. The next phase should verify whether `ProjectRepository.ts` is still required before implementing UI wiring.
```

## Future STEME integration

This PHAX update should remain simple.

The first version only needs file intent and file reconciliation.

Later, STEME can enrich the same structure with:

```txt
boundary-aware checks
required wiring checks
forbidden import checks
missing import checks
call-path analysis
product-depth guarantees
skill-based correction recommendations
```

At that point, PHAX can pass the planned boundary contracts and actual file diff to STEME.

STEME can then produce higher-level feedback:

```txt
The planned Page -> ViewModel boundary was not implemented.
The ViewModel exists but does not call the application command.
The command exists but bypasses the domain model.
The adapter was created but no runtime path reaches it.
```

For now, PHAX should not wait for STEME.

The immediate value is already high:

```txt
planned files
actual files
missing files
unplanned files
handoff explanation
cumulative phase context
```

## Summary

This update makes PHAX plans more concrete without making them rigid.

The agent is allowed to adapt during implementation.

But the adaptation must become visible.

PHAX should therefore track:

```txt
what the plan expected
what actually changed
what was missing
what was added
why deviations happened
what the next phase must know
```

This creates a simple foundation for better reviews now and deeper STEME guarantees later.
