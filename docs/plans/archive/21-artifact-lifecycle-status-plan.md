# Artifact lifecycle status

Status: Archived

Source-Spec: docs/specs/21-artifact-lifecycle-status.md

> Feed this `plan.md` to `phax extract-plan` to produce `phax-plan.json`, then
> run it with `phax run`. Source spec:
> [`docs/specs/21-artifact-lifecycle-status.md`](../specs/21-artifact-lifecycle-status.md).

---

## Overview

Specs under `docs/specs/` and plans under `docs/plans/` gain a required, enforced
lifecycle status (`Status:` header line): specs use `Draft | Approved | Abandoned |
Archived`, plans use `Draft | Approved | Stale | Abandoned | Archived`. Transitions go
through dedicated domain functions with an explicit legal-transition table per artifact
kind; `phax run` refuses any plan that is not `Approved` (`Stale`, `Draft`, and retired
refusals all distinct); transitioning to a terminal status (`Abandoned`, `Archived`)
moves the file into the artifact's `archive/` subdirectory; a new `phax artifact` command
group exposes inspection and transitions. Extraction stays ungated. A closing migration
phase normalizes every existing artifact and stamps the `Source-Spec:` declarations whose
grammar spec 22 pins.

Execution model caveat: none — this is ordinary feature work, fully verifiable by the
configured gates.

Traceability (spec §8 acceptance criteria → phase):

| Acceptance criterion                          | Phase    |
| --------------------------------------------- | -------- |
| A plan without status cannot run              | phase-04 |
| Unknown states are rejected per artifact kind | phase-01 |
| Illegal transitions are refused w/ legal set  | phase-01, phase-03 |
| Only an Approved plan runs                    | phase-04 |
| Stale refusal is distinct                     | phase-04 |
| Extraction is not gated                       | phase-04 |
| Archival moves the file                       | phase-02, phase-03 |
| Abandonment is terminal and moves the file    | phase-02, phase-03 |
| A retired plan does not run                   | phase-04 |
| Status/location disagreement fails validation | phase-01, phase-02 |
| Status is inspectable                         | phase-02, phase-03 |

## Technical arbitrations

- **Spec §9 defaults adopted as-is** (in-file header line; `Stale` reachable from
  `Approved` only; approve validates structure only). Not re-decided here.
- **Run gate lives in `src/cli/commands/run.ts`, before `loadOrExtractPlan`** — not in
  `executePlan`'s preflight block. Loss accepted: the gate is not shared by the `resume`
  path — deliberate, because resuming is not "starting a run from a plan" (§5.4), and
  this keeps `extract-plan` ungated for free.
- **New sibling error types** (`InvalidArtifactTransitionError` carrying the legal
  targets, `ArtifactValidationError`, `PlanNotApprovedError`) instead of widening
  `InvalidTransitionError.entity`. Loss accepted: two transition-error shapes coexist in
  `src/domain/errors.ts`; required because §5.3 refusals must name the legal transitions,
  which the run/phase error does not carry.
- **Migration outcomes (user-decided, 2026-08-10):** the 6 executed live plans (17, 37,
  38, 40, 42, 43 — verified against commit history) become `Archived` and move to
  `docs/plans/archive/`; the 4 pending plans (39, 41, 44, 45) become `Approved` and stay
  live. Loss accepted on the executed ones: the migration is a file move, not the spec's
  minimal line-edit.
- **`Abandoned` terminal state (user-decided 2026-08-10, spec 21 revised):** both kinds
  gain a terminal `Abandoned` distinct from `Archived` — completed vs dropped stays
  readable in the artifact record. Loss accepted: the previously frozen vocabulary was
  amended in an Approved spec, acceptable only because nothing was implemented yet.
- **Migration stamps `Source-Spec:` declarations (grammar pinned by spec 22):** plan 21
  does forward-work for spec 22 — the lines are inert until 22's implementation lands.
  Loss accepted: a 21-phase writes a 22 contract; taken to avoid a second whole-tree
  migration one spec later.
- **Manual `Stale` entry is spelled `phax artifact stale <path>`** — spelling is
  indicative per §6; chosen for symmetry with `approve`/`abandon`/`archive`/`reopen`.
- **Exit code 12 for all lifecycle refusals** (run gate and artifact-command failures);
  codes 1–11 are taken in `exitCodeForError`. Draft vs Stale distinctness lives in the
  message, not the code — §6 makes the code value indicative.
- **Status line grammar:** the first line matching `Status: <value>` in the header
  region, defined as everything before the first `## ` heading. Loss accepted: a
  `Status:` line placed below the first H2 is invisible to phax — this is what keeps the
  illustrative `Status:` block inside `docs/specs/22-plan-staleness-lineage.md` §6 inert.

## Required commands

- pnpm gen:usage-spec
- pnpm docs:cli

## Required PHAX security configuration changes

No changes required: `pnpm gen:usage-spec` and `pnpm docs:cli` are already present in
`security.agentCommands` in `phax.json`; the preflight will confirm coverage.

## phase-01 — Artifact status domain and schemas {#phase-01-artifact-status-domain}

**Recommended model:** claude-sonnet-5
**Recommended effort:** medium

Introduce the artifact lifecycle vocabulary as domain data: per-kind state sets, the
legal-transition tables, status-line parsing, path classification, and the boundary
schemas — the same state-machine discipline as `RunState`/`PhaseState`.

### Detailed instructions

- Create `src/domain/artifact/status.ts`:
  - `ArtifactKind = "spec" | "plan"`.
  - `SPEC_STATUSES = ["Draft", "Approved", "Abandoned", "Archived"] as const` and
    `PLAN_STATUSES = ["Draft", "Approved", "Stale", "Abandoned", "Archived"] as const`, with
    `SpecStatus` / `PlanStatus` types derived from the arrays (follow the
    `SKILL_TARGETS`/`parseSkillTarget` pattern in `src/domain/skills/types.ts`).
  - Legal-transition tables exactly per spec §5.3: spec `Draft → Approved`,
    `Draft → Abandoned`, `Approved → Abandoned`, `Approved → Archived`; plan
    `Draft → Approved`, `Draft → Abandoned`, `Approved → Approved` (re-approval no-op),
    `Approved → Stale`, `Approved → Abandoned`, `Approved → Archived`,
    `Stale → Approved`, `Stale → Draft`, `Stale → Abandoned`, `Stale → Archived`.
    `Abandoned` and `Archived` are terminal for both kinds. Export an
    `isTerminalStatus` helper — the location rule and the move logic both need it.
  - `legalTargetsFrom(kind, status)` returning the allowed target statuses.
  - `requestTransition(kind, from, to): Either.Either<status, InvalidArtifactTransitionError>`
    — table-driven, mirroring the `Either` style of `src/domain/state.ts`.
- Create `src/domain/artifact/document.ts` (pure, no I/O):
  - `classifyArtifactPath(repoRelPath)` → `{ kind: ArtifactKind; inArchive: boolean } | null`
    for paths under `docs/specs/`, `docs/specs/archive/`, `docs/plans/`,
    `docs/plans/archive/`; `null` for anything else.
  - `archivePathFor(repoRelPath)` → the path of the same file inside its kind's
    `archive/` subdirectory.
  - `readStatusLine(md)` → the raw `<value>` of the first line matching
    `Status: <value>` in the header region (all lines before the first line starting
    with `## `), or `null`. A `Status:` line after the first H2 must be ignored.
  - `replaceStatusLine(md, next)` → the markdown with that line's value replaced.
  - `validateArtifact(repoRelPath, md)` →
    `Either.Either<{ kind; status }, ArtifactValidationError>` covering: non-artifact
    path; missing status line (§5.1); status outside the kind's state set, message
    naming the allowed set (§5.2); status/location disagreement in both directions —
    terminal status outside `archive/`, non-terminal status inside it (§5.5).
- Create `src/schemas/artifactStatus.ts`: `SpecStatusSchema` and `PlanStatusSchema` as
  literal unions (idiom of `src/schemas/providerId.ts`), `decodeSpecStatus` /
  `decodePlanStatus` via `Schema.decodeUnknownEither`, and a compile-time bridge
  assertion to the domain types (idiom of `src/schemas/publication.ts:33`).
- Edit `src/domain/errors.ts`, adding:
  - `InvalidArtifactTransitionError` — `{ kind; from; to; legalTargets: readonly string[] }`
    with a `message` getter naming the legal transitions from the current status (§5.3).
  - `ArtifactValidationError` — `{ path; message }`.
  - `PlanNotApprovedError` — `{ path; status: string; message }` where `status` is the
    offending value, `"missing"`, or `"invalid"`; message wording distinct for `Draft`
    (approval is the remedy) vs `Stale` (re-planning is the remedy) per §5.4.

### Planned files to create

- src/domain/artifact/status.ts
- src/domain/artifact/document.ts
- src/schemas/artifactStatus.ts
- tests/unit/artifact/status.test.ts
- tests/unit/artifact/document.test.ts

### Planned files to edit

- src/domain/errors.ts

### Optional files that may be edited

- tests/type/stateTransitions.ts
- tests/unit/schemas.test.ts

### Boundary contracts

- Domain → schemas: `SpecStatus`/`PlanStatus` domain types are the source of truth; the
  schemas bridge-assert against them so drift is a compile error.
- Later phases (app, CLI) consume `requestTransition`, `legalTargetsFrom`,
  `validateArtifact`, `readStatusLine`, `replaceStatusLine`, `classifyArtifactPath`,
  `archivePathFor` — keep these names stable and export them all.

### Test strategy

Unit tests, written **before** implementation (domain invariants):

- `tests/unit/artifact/status.test.ts` — template `tests/unit/state.test.ts`: one
  `describe` per transition, `assertRight` on every legal pair, `it.each` over the full
  illegal complement per kind asserting `InvalidArtifactTransitionError` and that the
  error's `legalTargets` matches `legalTargetsFrom`. Cover: spec has no `Stale`; plan
  `Approved → Approved` is legal; `Abandoned` and `Archived` are terminal for both
  kinds; `Draft → Abandoned` is legal for both kinds.
- `tests/unit/artifact/document.test.ts` — status-line found on line 3 of a spec-shaped
  doc; `Status:` line after the first H2 ignored; missing line; replacement round-trip;
  path classification for all four directories plus a non-artifact path; §5.5
  disagreement both ways (a terminal status outside archive/, a non-terminal status
  inside archive/); unknown status message names the allowed set (§5.2, spec-`Stale`
  case from §8).
- Schema decode round-trips either inline in the document test or in
  `tests/unit/schemas.test.ts`.

### Implementation order

Tests first, then `status.ts`, then `document.ts`, then `schemas/artifactStatus.ts`,
then the error classes.

### Excluded scope

- Any file I/O or Effect services (phase-02).
- CLI surface (phase-03) and run gating (phase-04).
- Approval-record semantics for re-approval — deferred to the staleness & lineage spec.

### Verification

The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- Exact module paths and the exported symbol names/signatures listed above, so phase-02
  can import them without re-reading this phase.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(artifact): add lifecycle status domain model and schemas

### Commit body

Add per-kind artifact state sets (spec: Draft/Approved/Abandoned/Archived; plan:
Draft/Approved/Stale/Abandoned/Archived), table-driven legal transitions with two
terminal statuses and errors naming the legal set, status-line parsing scoped to the
pre-H2 header region, artifact path classification, and boundary schemas bridged to the
domain types. Implements spec 21 §5.2–§5.3 vocabulary with unit coverage over the full
transition matrix.

## phase-02 — Artifact inspect and transition use cases {#phase-02-artifact-use-cases}

**Recommended model:** claude-sonnet-5
**Recommended effort:** medium

Add the app-layer use cases: inspect an artifact's status, apply a transition (including
the archive move), and the pure runnability check the run gate will consume.

### Detailed instructions

- Create `src/app/artifactStatus.ts` following the `src/app/archive.ts` conventions
  (explicit error-channel union, explicit `R` union, `yield* FileSystem` inside
  `Effect.gen`):
  - `inspectArtifact(repoRelPath): Effect<ArtifactReport, FsError | ArtifactValidationError, FileSystem>`
    — `fs.readText`, `validateArtifact`, return `{ kind, status, legalTargets }` (§5.6).
  - `transitionArtifact(repoRelPath, target): Effect<{ status; path }, FsError | ArtifactValidationError | InvalidArtifactTransitionError, FileSystem>`
    — read, validate, `requestTransition`, `replaceStatusLine`. For a non-terminal
    target: `fs.writeAtomic` in place. For a terminal target (`Abandoned`, `Archived`):
    `fs.mkdirp` the archive directory, `fs.writeAtomic` the updated content at
    `archivePathFor(path)`, then `fs.remove` the original (§5.5 — the move is part of
    the transition; the infra `rename` does not create destination directories, hence
    write+remove). Return the new path.
  - `checkPlanRunnable(planMd, planPath): Either.Either<void, PlanNotApprovedError>` —
    pure, no ports: missing status line → `status: "missing"` (§5.1); value outside
    `PLAN_STATUSES` → `status: "invalid"` naming the allowed set (§5.2); `Draft` (remedy:
    approve), `Stale` (remedy: re-plan), `Abandoned`/`Archived` (retired — no remedy) →
    refusal with the §5.4-distinct wording per group; `Approved` → `void`. When
    `classifyArtifactPath(planPath)` classifies the path as an artifact, additionally
    enforce §5.5 location agreement (an `Approved` plan sitting inside `archive/`
    refuses as a disagreement rather than running); for non-artifact paths (e.g. test
    fixtures outside `docs/`) the check is deliberately line-only.
- Errors come from `src/domain/errors.ts` (phase-01); do not define errors locally.

### Planned files to create

- src/app/artifactStatus.ts
- tests/integration/artifactStatus.test.ts

### Planned files to edit

- (none)

### Optional files that may be edited

- src/domain/errors.ts

### Boundary contracts

- App → `FileSystem` port only (`readText`, `writeAtomic`, `mkdirp`, `remove`); no `Git`
  dependency — the archive move is a filesystem move, committed like any other change by
  the phase commit.
- CLI (phase-03) consumes `inspectArtifact` / `transitionArtifact`; the run gate
  (phase-04) consumes `checkPlanRunnable`. Keep the three signatures stable.

### Test strategy

Integration tests with `makeFakeFileSystem()` (`src/infra/fakes/fs.ts`), written
**before** implementation (application-command behavior):

- Inspect: Approved plan reports kind `plan`, status `Approved`, legal targets
  `Approved, Stale, Abandoned, Archived` (§8 "Status is inspectable").
- Transition: `approve` on a Draft spec rewrites the line in place; `archive` on an
  Approved spec relocates the file under `archive/` with status `Archived` and removes
  the original (§8 "Archival moves the file"); `abandon` on an Approved plan relocates
  likewise with status `Abandoned`, and a further transition on it is refused (§8
  "Abandonment is terminal and moves the file"); illegal transition surfaces
  `InvalidArtifactTransitionError`; validation failure (missing line, disagreement)
  surfaces `ArtifactValidationError` before any write.
- `checkPlanRunnable`: missing line, invalid value, `Draft`, `Stale`, `Abandoned`,
  `Archived` each refuse with distinguishable content; `Approved` passes; an `Approved`
  plan at a `docs/plans/archive/` path refuses (location disagreement); an `Approved`
  plan at a non-artifact path passes (fixtures stay line-only).

### Implementation order

Tests first, then `checkPlanRunnable` (pure), then `inspectArtifact`, then
`transitionArtifact`.

### Excluded scope

- CLI wiring and output rendering (phase-03).
- The `phax run` gate call site (phase-04).
- Any change to `resume` or `executePlan`.

### Verification

The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact export names and signatures of the three use cases in
  `src/app/artifactStatus.ts`.
- The terminal-move write order (mkdirp → writeAtomic at destination → remove original)
  so the CLI phase renders the returned new path correctly.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(artifact): add inspect, transition, and plan-runnability use cases

### Commit body

App-layer artifact lifecycle: inspectArtifact reports kind/status/legal transitions,
transitionArtifact applies table-checked transitions and moves files to archive/ on
terminal targets through the FileSystem port, and pure checkPlanRunnable produces the
Draft/Stale/retired-distinct refusals the run gate needs. Covered by fake-fs integration
tests over spec 21 §5.4–§5.6.

## phase-03 — phax artifact command group {#phase-03-artifact-cli}

**Recommended model:** claude-sonnet-5
**Recommended effort:** high

Expose the lifecycle over the CLI: `phax artifact status | approve | stale | abandon |
archive | reopen <path>`, with all four command satellites (cliDocs, usage KDL, CLI
docs, command-tree test) kept in sync.

### Detailed instructions

- Create `src/cli/commands/artifact.ts` exporting
  `registerArtifactCommand(program, out)`, modeled on
  `src/cli/commands/schema.ts` / `skills.ts`. Register a parent `artifact` command with
  six **nested** subcommands (`status`, `approve`, `stale`, `abandon`, `archive`,
  `reopen`), each taking a required `<path>` argument. Heed the warning in
  `src/cli/commands/security.ts:46` — never register `"artifact status"` as a single
  space-separated name. Normalize the `<path>` argument (absolute or cwd-relative
  input) to a repo-relative POSIX path before calling the use cases —
  `classifyArtifactPath` matches on repo-relative paths.
  - `status` → `inspectArtifact`; render kind, status, and legal transitions via
    `out.log` in the `session-info` label style (§5.6).
  - `approve` / `stale` / `abandon` / `archive` / `reopen` → `transitionArtifact` with
    targets `Approved` / `Stale` / `Abandoned` / `Archived` / `Draft`; log the resulting
    status, and for the terminal targets (`abandon`, `archive`) the new path.
  - Provide layers locally (`Layer` with `NodeFileSystemLayer` only, following the
    `buildLayer` shape in `src/cli/commands/archive.ts`); run with `Effect.either` and
    render failures with `out.error(err.message)`, exit code via `exitCodeForError`.
- Edit `src/cli/commands/runLayers.ts`: map `InvalidArtifactTransitionError`,
  `ArtifactValidationError`, and `PlanNotApprovedError` to exit code **12** in
  `exitCodeForError` (codes 1–11 are taken).
- Edit `src/cli/program.ts`: call `registerArtifactCommand(program, consoleOutput)`
  alongside the other `register*` calls.
- Edit `src/cli/cliDocs.ts`: add entries for `artifact`, `artifact status`,
  `artifact approve`, `artifact stale`, `artifact abandon`, `artifact archive`,
  `artifact reopen` — each with `longHelp` and at least one example (enforced by
  `tests/integration/usageSpecExamples.test.ts`).
- Regenerate `phax.usage.kdl` with `pnpm gen:usage-spec` and the CLI docs
  (`docs/cli/reference.md` + README section) with `pnpm docs:cli` — both drift-guarded.
- Edit `tests/integration/cliProgram.test.ts`: add `artifact` to `TOP_LEVEL_COMMANDS`
  (the test asserts exact length equality).

### Planned files to create

- src/cli/commands/artifact.ts
- tests/unit/cli/artifact.test.ts

### Planned files to edit

- src/cli/program.ts
- src/cli/cliDocs.ts
- src/cli/commands/runLayers.ts
- phax.usage.kdl
- docs/cli/reference.md
- README.md
- tests/integration/cliProgram.test.ts

### Optional files that may be edited

- src/cli/cliCompleters.ts

### Boundary contracts

- CLI → app only: the command file parses args, calls `inspectArtifact` /
  `transitionArtifact`, renders through `OutputPort`, and returns an exit code — no
  business logic (transition legality and validation all live below).
- CLI → infra restricted to layer composition (`NodeFileSystemLayer`), per the
  architectural guard.

### Test strategy

- `tests/unit/cli/artifact.test.ts` — template `tests/unit/cli/run.test.ts`: mock
  `src/app/artifactStatus.js`, capture output with a local `makeOutput()`, assert exit
  codes (0 success, 12 for refusals) and that a refused transition's message names the
  legal set (§8 "Illegal transitions are refused"), and that `status` output names kind,
  status, and legal transitions (§8 "Status is inspectable").
- The existing drift suites (`usageSpecDrift`, `usageSpecExamples`, `usageSpecLint`,
  `docsCliDrift`, `cliProgram`) are the mechanical proof the satellites are in sync — no
  new tests needed there beyond the `TOP_LEVEL_COMMANDS` edit.

### Implementation order

Command file + unit test first, then program registration, then cliDocs, then the two
regenerations, then the `TOP_LEVEL_COMMANDS` edit.

### Excluded scope

- Run gating (phase-04).
- Shell completions for artifact paths (no completer exists for file paths; leave
  `cliCompleters` untouched unless trivially useful).

### Verification

The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The final subcommand spellings and exit-code mapping (12) as implemented.
- Confirmation that `phax.usage.kdl`, `docs/cli/reference.md`, and the README section
  were regenerated via the package scripts (not hand-edited).
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(cli): add phax artifact command group for lifecycle transitions

### Commit body

New artifact command group over the lifecycle use cases: status inspection reporting
kind, current status, and legal transitions; transition commands for approve, stale,
abandon and archive (both with the file move), and reopen. Lifecycle refusals exit with
code 12. Usage KDL, CLI reference docs, README section, and the command-tree test are
regenerated and updated in the same commit.

## phase-04 — Gate phax run on Approved plans {#phase-04-run-gating}

**Recommended model:** claude-sonnet-5
**Recommended effort:** medium

`phax run` refuses to start from any plan whose status is not `Approved`, with the
`Stale` refusal distinct from the `Draft` one; extraction stays ungated.

### Detailed instructions

- Edit `src/cli/commands/run.ts`: after `planMdPath` is resolved and config loaded, and
  **before** the `loadOrExtractPlan` call, read the plan file (`readFileSync`, already
  on the Node-I/O allowlist for this file) and call `checkPlanRunnable(planMd,
  planMdPath)`. On `Left`: `out.error(err.message)` and return
  `exitCodeForError(err)` (12). If the file itself is unreadable, skip the gate and let
  the existing `loadOrExtractPlan` error path report it — the gate must not invent a new
  missing-file error.
- Refusal wording follows spec §6's shape: name the plan file, the offending status, and
  the remedy — approval for `Draft`, re-planning for `Stale` (§5.4). The exact strings
  come from `PlanNotApprovedError` (phase-01); adjust there if wording needs tuning.
- Do **not** touch `src/cli/commands/resume.ts`, `src/app/executePlan.ts`, or
  `src/app/loadOrExtractPlan.ts` — resuming and extraction are deliberately ungated.
- Update `tests/e2e/fixtures/minimal-repo/` plan fixture(s): add `Status: Approved`
  after the H1 so the real-flow e2e still starts (e2e is not in the gate profile; keep
  it honest anyway).
- If any integration test drives `phax run` through the CLI with a statusless plan
  fixture, give that fixture `Status: Approved`; tests that call `loadOrExtractPlan`
  directly are unaffected by design.

### Planned files to create

- (none)

### Planned files to edit

- src/cli/commands/run.ts
- tests/unit/cli/run.test.ts
- tests/integration/cliErrors.test.ts
- tests/e2e/fixtures/minimal-repo/plan.md

### Optional files that may be edited

- tests/integration/run.test.ts
- tests/e2e/helpers/runCli.ts

### Boundary contracts

- CLI → app: the gate is one call to `checkPlanRunnable` plus rendering; the
  Draft/Stale/missing distinction is produced in the domain error, not in the command
  file.

### Test strategy

Written **before** implementation (these encode spec §8 acceptance criteria):

- `tests/unit/cli/run.test.ts` — new cases: plan with no `Status:` line refuses naming
  the missing status (§8 "A plan without status cannot run"); `Draft` refuses; `Stale`
  refuses with wording distinct from Draft (§8 "Stale refusal is distinct"); `Abandoned`
  refuses as retired, distinct from both (§8 "A retired plan does not run"); `Approved`
  proceeds into the mocked pipeline (§8 "Only an Approved plan runs"). All refusals
  return 12 and never reach `loadOrExtractPlan` (assert the mock was not called).
- `tests/integration/cliErrors.test.ts` — spawn the real CLI against a Draft plan file:
  non-zero exit, message names the file and status, no stack trace.
- Extraction-not-gated (§8): assert `phax extract-plan` (or `loadOrExtractPlan`) on a
  Draft plan still succeeds — a one-case addition wherever extraction is already
  integration-tested.

### Implementation order

Unit-test cases first, then the gate in `run.ts`, then the integration case, then the
fixture updates.

### Excluded scope

- Gating `resume` or extraction.
- Any lineage/staleness triggers (spec 22).

### Verification

The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- Where exactly the gate sits in `run.ts` (line-level anchor) and the final refusal
  strings for missing/Draft/Stale.
- Which fixtures gained `Status: Approved` lines.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(run): refuse to start runs from non-Approved plans

### Commit body

phax run now validates the plan's lifecycle status before extraction wiring: missing,
invalid, Draft, Stale, Abandoned, and Archived statuses refuse with exit code 12, with
the Stale refusal naming re-planning as the remedy and terminal statuses refusing as
retired. Extraction and resume stay ungated per spec 21 §5.4. E2E and integration plan
fixtures gain Status: Approved.

## phase-05 — Migrate existing artifacts {#phase-05-artifact-migration}

**Recommended model:** claude-sonnet-5
**Recommended effort:** medium

One-time mechanical migration: every existing spec and plan gains a valid, agreeing
`Status:` line, every plan gains a `Source-Spec:` declaration (spec 22's normative
grammar — inert until 22 is implemented), and the six executed live plans are archived.
After this phase, absence of a status is an error everywhere (spec §10 — a migration,
not a shim).

### Detailed instructions

- Insertion rule everywhere: the `Status: <value>` line goes in the header region
  (after the H1, blank-line separated, before the first `## ` heading). If a `Status:`
  line already exists in the header region, replace its value; never touch `Status:`
  text below the first H2 (e.g. the illustrative block in
  `docs/specs/22-plan-staleness-lineage.md` §6) or inside code fences.
- Every **plan** file touched (live and archived; specs never carry one) also gains a
  `Source-Spec: <value>` line directly under its `Status:` line, per spec 22 §6: if the
  plan's preamble names the spec it implements, declare that spec's **current** path
  (its `archive/` path if the spec is archived); otherwise `Source-Spec: (none)`. Known
  mappings for the live plans: 17 → `docs/specs/archive/17-brief-profile-orient.md`,
  44 → `docs/specs/15-gate-profile-attributed-steps.md`; 45 states "No source spec" →
  `(none)`; 37, 38, 39, 41, 42, 43 name no source spec → `(none)`. For archived plans,
  apply the same read-the-preamble rule; a related-spec mention that is not the plan's
  source (e.g. plan 39 citing spec 14 as context) does not count.
- Pending live plans → insert `Status: Approved` (user decision 2026-08-10):
  `docs/plans/39-…`, `41-…`, `44-…`, `45-…` (full paths in the edit list).
- Executed live plans → set `Status: Archived` and move (plain `git mv`-style move in
  the worktree) into `docs/plans/archive/`: plans 17, 37, 38, 40, 42, 43. No filename
  collisions exist in the archive for these six.
- `docs/plans/archive/` (48 existing files) → insert `Status: Archived` in each.
- `docs/specs/archive/` → normalize to `Status: Archived`: 14 files need an insert or a
  replace (existing wrong values include `Draft`, `running`, `Draft specification`);
  `17-brief-profile-orient.md` and `20-model-catalog-equivalence-routing.md` already
  read `Status: Archived` — leave them untouched.
- Live specs under `docs/specs/` all already carry `Status: Approved` — untouched.
- Do not touch `docs/plans/21-artifact-lifecycle-status-plan.md` (this plan — it already
  carries its own status and source-spec lines).
- Sanity check before committing: `phax artifact status` (via `pnpm dev artifact
  status <path>`) on a sample from each group — a moved plan, a pending plan, an
  archived spec — must report a valid status with no validation error.
- Optionally update the in-repo skills to reflect enforcement: `phax-spec` (status line
  now normative/enforced), `phax-planning` (new plans start `Status: Draft`; approve
  before `phax run`), `phax-cli` (the `artifact` command group).

### Planned files to create

- docs/plans/archive/17-brief-profile-orient-plan.md
- docs/plans/archive/37-plans-overlap-command-plan.md
- docs/plans/archive/38-plan-extraction-cache-plan.md
- docs/plans/archive/40-deterministic-plan-extraction-plan.md
- docs/plans/archive/42-review-compliance-qualified-name-plan.md
- docs/plans/archive/43-security-hardening-plan.md

### Planned files to edit

- docs/plans/39-smolvm-isolation-spike-plan.md
- docs/plans/41-claude-protected-path-approval-hook-plan.md
- docs/plans/44-gate-profile-attributed-steps-plan.md
- docs/plans/45-typescript-7-migration-plan.md
- docs/plans/17-brief-profile-orient-plan.md
- docs/plans/37-plans-overlap-command-plan.md
- docs/plans/38-plan-extraction-cache-plan.md
- docs/plans/40-deterministic-plan-extraction-plan.md
- docs/plans/42-review-compliance-qualified-name-plan.md
- docs/plans/43-security-hardening-plan.md
- docs/plans/archive/01-plan.md
- docs/plans/archive/02-phax-planning-skill-update-plan.md
- docs/plans/archive/03-update-provider-effort-plan.md
- docs/plans/archive/03b-provider-e2e-validation.md
- docs/plans/archive/04-run-jail-plan.md
- docs/plans/archive/04b-run-jail-provider-validation.md
- docs/plans/archive/05-model-routing-enabled-gating-plan.md
- docs/plans/archive/06-model-routing-plan.md
- docs/plans/archive/07-observability-plan.md
- docs/plans/archive/08-provider-priority-override-plan.md
- docs/plans/archive/09-agent-commands.md
- docs/plans/archive/09-rename-claude-backend-errors-plan.md
- docs/plans/archive/10-init-command-plan.md
- docs/plans/archive/10-opus-frontier-tiers-plan.md
- docs/plans/archive/11-lock-agent-binding-phase-plan.md
- docs/plans/archive/11-review-handoff-plan.md
- docs/plans/archive/12-gate-first-resume-plan.md
- docs/plans/archive/12-project-namespace-plan.md
- docs/plans/archive/13-reset-phase-command-plan.md
- docs/plans/archive/13-usage-cli-plan.md
- docs/plans/archive/14-push-branch-pr-plan.md
- docs/plans/archive/14-remove-last-commands-plan.md
- docs/plans/archive/15-agent-binding-hardening-plan.md
- docs/plans/archive/15-typescript-6-migration-plan.md
- docs/plans/archive/16-deno-runtime-plan.md
- docs/plans/archive/16-enforce-architecture-boundaries-plan.md
- docs/plans/archive/17-install-planning-skill-plan.md
- docs/plans/archive/17-sealed-completion-extraction-plan.md
- docs/plans/archive/18-local-telemetry-report-plan.md
- docs/plans/archive/19-whats-next-guidance-plan.md
- docs/plans/archive/20-compliance-review-plan.md
- docs/plans/archive/20-model-catalog-equivalence-routing-plan.md
- docs/plans/archive/21-usage-spec-generation-hardening-plan.md
- docs/plans/archive/22-config-user-project-split-plan.md
- docs/plans/archive/23-handoff-deviation-justification-plan.md
- docs/plans/archive/24-interactive-init-plan.md
- docs/plans/archive/25-namespace-compliance-followups-plan.md
- docs/plans/archive/26-run-recap-and-reset-date-plan.md
- docs/plans/archive/27-compliance-handoff-access-and-resume-recap-plan.md
- docs/plans/archive/28-completions-binary-stdin-fix-plan.md
- docs/plans/archive/29-compliance-review-before-phase-details-plan.md
- docs/plans/archive/30-validate-config-only-plan.md
- docs/plans/archive/31-error-logging-and-reset-fixes-plan.md
- docs/plans/archive/32-resumable-handoff-failure-plan.md
- docs/plans/archive/33-resumable-postgate-failures.md
- docs/plans/archive/34-decouple-manual-publish-from-config.md
- docs/plans/archive/35-remove-last-commands.md
- docs/plans/archive/36-review-code-command-plan.md
- docs/specs/archive/01-feedback_ingest_spec.md
- docs/specs/archive/02-phax-planning-skill-update.md
- docs/specs/archive/03-update-provider-effort.md
- docs/specs/archive/04-run-jail.md
- docs/specs/archive/05-review-handoff.md
- docs/specs/archive/06-deno-runtime.md
- docs/specs/archive/07-push-branch-pr.md
- docs/specs/archive/08-install-planning-skill.md
- docs/specs/archive/09-agent-commands.md
- docs/specs/archive/10-init-command.md
- docs/specs/archive/11-lock-agent-binding-phase.md
- docs/specs/archive/12-project-namespace.md
- docs/specs/archive/13-usage-cli.md
- docs/specs/archive/14-remove-network-controls.md

### Optional files that may be edited

- .claude/skills/phax-spec/SKILL.md
- .claude/skills/phax-planning/SKILL.md
- .claude/skills/phax-cli/SKILL.md

### Test strategy

No new tests — enforcement is already covered by phases 01–04. The mechanical check is
the sanity pass with `pnpm dev artifact status` on one file from each migrated group,
recorded in the handoff.

### Implementation order

Pending plans, then the six moves, then plan archive, then spec archive, then the
optional skill notes, then the sanity pass.

### Excluded scope

- Any change under `src/` or `tests/`.
- Rewording or restructuring archived documents beyond the status and source-spec lines.
- The staleness triggers, approval records, and chain gates (spec 22) — only the
  mechanical `Source-Spec:` stamping happens here; nothing validates or consumes the
  declarations yet.

### Verification

The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The sanity-pass output for one artifact from each group.
- Note that the six executed plans appear in git as renames (moves plus a one-line
  edit) — the destination paths are in the create list and the source paths in the edit
  list; explain this pairing against the reconciliation report.
- Any deviation from the planned file lists, with the reason.

### Commit subject

chore(docs): migrate all specs and plans to enforced lifecycle status

### Commit body

One-time migration per spec 21 §10: pending live plans (39, 41, 44, 45) become
Approved; executed live plans (17, 37, 38, 40, 42, 43) become Archived and move to
docs/plans/archive/; all previously archived plans and specs are normalized to
Status: Archived; every plan gains its Source-Spec declaration per spec 22's grammar.
After this commit every artifact carries a valid status agreeing with its location, and
absence is an error.
