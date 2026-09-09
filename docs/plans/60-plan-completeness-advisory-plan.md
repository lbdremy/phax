---
status: Draft
source-spec: docs/specs/19-plan-completeness-advisory.md
---

# Plan-completeness advisory

> Check this file with `phax plans lint`, then run it with
> `phax run --plan <this file>`. Source spec:
> [`docs/specs/19-plan-completeness-advisory.md`](../specs/19-plan-completeness-advisory.md)
> (approved 2026-09-08 against `main` @ `e07e35d`). Planned 2026-09-09 against
> `main` @ `1ba9bfe`.

Implements spec 19. `phax.json` may register one **plan auditor** (`planAuditor`,
next to `orient` and `scopes`). `phax plans lint` (spec 33 / plan 33) hands it
the **plan projection** — the ordered phases, each with its planned create/edit
files, and nothing else — on stdin, and renders every finding the auditor
returns as a **warning** on a fifth lint check, `advisory`. The check never sets
the exit code, a failing auditor is one warning, an absent auditor leaves the
lint unchanged, and a plan the deterministic parser cannot read is never
audited. The projection is the one spec 18 / plan 58 already built for the scope
provider (`projectPhases`), minus the gated-phase id; the transport is the shared
`runProviderQuery`. No new command; `phax run` never queries the auditor.

---

## Required commands

- (none)

Every gate step uses `pnpm` scripts already present in `package.json`; the plan
introduces no new tool, runtime, or CLI. JSON-schema regeneration runs through
`pnpm exec tsx`, and the CLI-contract regeneration through `pnpm gen:usage-spec`
and `pnpm docs:cli`, all already granted in `security.agentCommands`. No
`## Required PHAX security configuration changes` section is needed.

---

## Technical arbitrations

Resolved with the human on 2026-09-09; recorded so phases execute without
re-litigating them.

- **Findings live in the lint report only; lint stays read-only.** Spec 19 §9's
  "persist alongside the plan for traceability" is not implemented: advisory
  findings appear in the rendered report and in `--json` exactly like the four
  existing checks, and `phax plans lint` writes nothing. Abandons: the on-disk
  trace. Accepted: spec 33's read-only, side-effect-free lint is the contract
  the planning agent and the artifact write-set rules already rely on, and the
  agent that needs the findings is the one running the command.
- **One auditor finding fans out to one lint finding per phase it names.**
  `{"message", "phases": ["phase-01", "phase-03"]}` becomes two `advisory`
  warnings with the same message, `phase` set to each id in the order given;
  an empty `phases` list becomes a single warning with `phase: null`. Abandons:
  the finding's identity as a single observation (the message repeats).
  Accepted: `LintFinding`, the renderer and every `--json` consumer stay
  untouched, and the phase column stays filterable.
- **A failing auditor is one `warning` on the `advisory` check** (`phase: null`,
  message `plan auditor failed: <reason>`), never an effect error and never an
  exit-code change. Abandons: the lint rule that findings describe the plan and
  never the environment. Accepted: one channel and one shape, machine-visible in
  `--json`, so a consumer can tell "no findings" from "the auditor broke".

Decisions taken without a question (one viable option each):

- **Key spelling is `planAuditor: { command }`**, the spec's indicative form,
  registered top-level next to `orient` and `scopes`, merged as the same scalar
  override (local user > global user > project), present on the user overlay.
- **The auditor runs from `config.repoRoot`** — the lint has no worktree; the
  scope provider runs from the phase worktree only because the gate does.
- **The request is `{ "phases": [{ "id", "files" }] }`**: `projectPhases` from
  `src/domain/plan/projection.ts` verbatim, no `phase` key. `files` is
  `plannedFilesToCreate ∪ plannedFilesToEdit`, deduplicated, in plan order;
  `optionalFilesToEdit` is excluded (plan 58's arbitration). Models, efforts,
  prompts, anchors and commit metadata never leave phax (spec §5.5).
- **The response is `{ "findings": [{ "message", "phases" }] }`** with `message`
  a non-empty string and `phases` an array of non-empty strings, possibly empty.
  Unknown keys are ignored at decode, as for `scopes`; phase ids are opaque and
  not checked against the plan (an unknown id is still rendered — the auditor
  supplies all meaning).
- **The auditor is queried only after `extractPlanDeterministic` and
  `finalizeExtractedPlan` both succeed**, i.e. on the same early-return
  structure `lintPlan` already has; it is queried once per lint run, after the
  four existing checks, and its findings are appended last.
- **`lintPlan` gains `Shell` in its requirement set, still no `Backend`**: the
  CLI provides the node shell layer next to the repo-rooted filesystem, and the
  "cannot fall back to the extraction model" guarantee holds by construction.
- **`advisory` joins the closed `LintCheck` set**; `"structure"` remains the
  widest member, so the renderer's column widths do not move.
- **No telemetry event** — the scope and orient providers emit none either.

## Context

Since plan 33 (spec 33), `lintPlan` (`src/app/lintPlan.ts`) reads the plan
through `FileSystem`, collects `structureFindings`, returns early when
`extractPlanDeterministic` or `finalizeExtractedPlan` fails, then appends
`filePlanFindings`, `commandFindings` and `modelFindings` from
`src/domain/plan/lint.ts` (`LintFinding { severity, check, phase, message }`,
`LintCheck = "structure" | "files" | "commands" | "models"`, `hasLintErrors`).
`renderLintReport` (`src/domain/plan/lintRender.ts`) prints a header and one
padded row per finding. `runPlansLint` (`src/cli/commands/plans.ts:95-130`)
absolutizes the path, provides `makeRepoRootedFileSystemLayer(config)` alone
(comment: "no Backend layer, so the lint cannot reach a model"), prints the
report or its JSON, and exits 1 on any error finding. The long help lives in
`src/cli/cliDocs.ts:134-143` (`"plans lint"`), from which `pnpm gen:usage-spec`
derives `phax.usage.kdl` and `pnpm docs:cli` derives `docs/cli/reference.md`
and the README's generated CLI summary; `tests/integration/usageSpecDrift.test.ts`
and `tests/integration/docsCliDrift.test.ts` fail on drift.

Plan 58 (spec 18) is the provider model this plan reuses verbatim:
`ScopesConfigSchema` (`src/schemas/phaxConfig.ts:26-33`) with its long
`description` annotation, the optional `scopes` key on `PhaxConfigSchema`
(`:167`) and `PhaxUserOverlaySchema` (`:251`), `ResolvedConfig.scopes?`
(`:213`), the scalar override in `src/domain/config/mergeLayers.ts:138-140,245`,
the pass-through in `src/app/loadConfig.ts:276`, the projection in
`src/domain/plan/projection.ts` (`ProjectedPhase`, `projectPhases`,
`makeScopesRequest`), the response schema `src/schemas/scopes.ts`, the typed
`ScopesProviderError` (`src/domain/errors.ts:238-242`), and the query
`src/app/scopes.ts` built on `runProviderQuery` (`src/app/providerQuery.ts`:
split on whitespace, no shell, JSON on stdin, exit 0 + JSON on stdout, typed
failure otherwise, never a defect). Its tests are the models here:
`tests/unit/schemas/scopesConfig.test.ts`, `tests/unit/schemas/scopes.test.ts`,
`tests/unit/planProjection.test.ts`, `tests/integration/scopes.test.ts`, and
the `scopes` cases in `tests/unit/mergeLayers.test.ts`,
`tests/unit/phaxConfigJsonSchema.test.ts:65-76`,
`tests/unit/phaxUserOverlaySchema.test.ts:130-141`.

### Architecture seams (audited 2026-09-09 against `main` @ `1ba9bfe`)

- **Generated schemas**: `phax.schema.json` / `phax.user.schema.json` at the
  repo root come from `getPhaxConfigJsonSchema` / `getPhaxUserOverlayJsonSchema`
  (`src/schemas/phaxConfig.ts`); the two JSON-schema tests assert on their
  content. Regenerate with a `pnpm exec tsx` one-liner, never by hand.
- **Fakes**: `makeFakeFileSystem` (`src/infra/fakes/fs.ts`) drives
  `tests/integration/lintPlan.test.ts` (`runLint` at `:91-106` provides the
  filesystem layer alone, with a comment saying why); `makeFakeShell`
  (`src/infra/fakes/shell.ts`) records `calls[].command` / `.stdin` and takes
  `setDefaultResponse` — see `tests/integration/scopes.test.ts`.
- **Shell layer at the CLI edge**: `NodeShellLayer` from `src/infra/shell.ts`,
  merged with `Layer.mergeAll` in `src/cli/commands/orient.ts:28`.
- **knip**: `src/app/*.ts` and every test file are entries, so an export
  consumed only by its test (phase-02) is not dead code.
- **`tests/unit/cli/plans.test.ts:165-200`** mocks `lintPlan` and asserts on
  the arguments and rendering; it is indifferent to the layer provided.
- **Docs**: README "Scope provider" (`README.md:177-208`) is the subsection
  model; "Lint the plan" (`:243-252`) lists the four checks; the generated
  CLI block sits under `## CLI command reference` (`:566`).
  `.claude/skills/phax-planning/SKILL.md:39-50` ("Lint before you run") and
  `.claude/skills/phax-cli/SKILL.md:60-67` describe the four checks; the
  planning skill is shipped from that path (`src/domain/skills/catalog.ts:15`).
- **Example providers**: `examples/hello-world/{orient,scopes,audit}.mjs` are
  registered in `examples/hello-world/phax.json` and exercised by
  `tests/integration/exampleProviders.test.ts` (config decode at `:122-137`,
  scopes at `:139-`); the example plan creates `src/greet.ts` in phase-01 and
  `tests/greet.test.ts` in phase-02.

---

## phase-01 — Plan auditor registration {#phase-01-auditor-config}

**Recommended model:** claude-sonnet-5
**Recommended effort:** medium

Let `phax.json` (and the user overlay) register a `planAuditor: { command }`
provider next to `orient` and `scopes`, merged and resolved the same way. Pure
schema and config work; nothing reads the key yet.

### Detailed instructions

- **Config schema** (`src/schemas/phaxConfig.ts`):
  - `export const PlanAuditorConfigSchema = Schema.Struct({ command: Schema.NonEmptyString.annotations({ description }) })`
    right after `ScopesConfigSchema` (`:26-33`), with a description in the same
    voice as the scopes one: "The plan auditor command. The string is split on
    whitespace with no shell — use a wrapper script for paths with spaces or
    pipelines. phax writes the plan projection ({"phases": [{"id", "files"}]})
    to the provider's stdin from `phax plans lint` whenever the plan's
    deterministic extraction succeeds, and expects exit 0 with
    {"findings": [{"message", "phases": [...]}]} on stdout. Every finding is a
    warning on the lint's advisory check, one per phase it names; a failing
    auditor is one warning; findings never set the exit code. `phax run` never
    queries it. Full contract: `phax --usage`, cmd plans lint." Export
    `PlanAuditorConfig`.
  - Add `planAuditor: Schema.optional(PlanAuditorConfigSchema)` to
    `PhaxConfigSchema` (after `scopes`, `:167`) and `PhaxUserOverlaySchema`
    (after `scopes`, `:251`); add `readonly planAuditor?: PlanAuditorConfig`
    to `ResolvedConfig` after `scopes` (`:213`).
- **Layer merge** (`src/domain/config/mergeLayers.ts`): mirror the scopes
  scalar override (`:138-140`, `:245`) for `planAuditor` — local user > global
  user > project, `command` required when the block is present.
- **Resolution** (`src/app/loadConfig.ts:276`): pass `planAuditor` through next
  to `scopes`.
- **Regenerate** `phax.schema.json` and `phax.user.schema.json` with a
  `pnpm exec tsx` one-liner calling `getPhaxConfigJsonSchema()` /
  `getPhaxUserOverlayJsonSchema()` and writing
  `JSON.stringify(schema, null, 2) + "\n"`. Do not hand-edit the generated
  JSON; confirm `pnpm format:check` is clean.
- **Tests**:
  - New `tests/unit/schemas/planAuditorConfig.test.ts` mirroring
    `scopesConfig.test.ts`: valid block decodes; empty command rejected;
    unknown key rejected; `decodePhaxConfig` and `decodePhaxUserOverlay` accept
    `planAuditor` next to `orient` and `scopes`; a `planAuditor` without
    `command` is rejected.
  - `tests/unit/phaxConfigJsonSchema.test.ts`,
    `tests/unit/phaxUserOverlaySchema.test.ts`: `planAuditor.command` is
    present, not required, and carries a description naming `findings`
    (same shape as the `scopes` cases at `:65-76` / `:130-141`).
  - `tests/unit/mergeLayers.test.ts`: a user-layer `planAuditor.command`
    overrides the project one; absent everywhere → absent.

### Planned files to create

- `tests/unit/schemas/planAuditorConfig.test.ts`

### Planned files to edit

- `src/schemas/phaxConfig.ts`
- `src/domain/config/mergeLayers.ts`
- `src/app/loadConfig.ts`
- `phax.schema.json`
- `phax.user.schema.json`
- `tests/unit/phaxConfigJsonSchema.test.ts`
- `tests/unit/phaxUserOverlaySchema.test.ts`
- `tests/unit/mergeLayers.test.ts`

### Optional files that may be edited

- `tests/unit/loadConfig.test.ts`

### Boundary contracts

- Producer: `src/schemas/phaxConfig.ts` exposes `PlanAuditorConfig` and
  `ResolvedConfig.planAuditor?`. Consumers: phase-02 (query signature),
  phase-03 (wiring in `lintPlan`), phase-04 (example config).

### Test strategy

Unit tests on the schema and the merge rule, written first. No behaviour
change to verify at integration level.

### Implementation order

1. `PlanAuditorConfigSchema`, config/overlay keys, `ResolvedConfig`.
2. Merge and load pass-through, with their tests.
3. Regenerate JSON schemas; JSON-schema tests.

### Excluded scope

- The projection request, response schema, query, and lint wiring
  (phases 02–03).
- Docs and the example provider (phase-04).

### Verification

- The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- The exported names `PlanAuditorConfigSchema` / `PlanAuditorConfig` and the
  exact key path (`planAuditor.command`) on both config schemas.
- The one-liner used to regenerate the JSON schemas.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(config): register a plan auditor next to orient and scopes

### Commit body

`phax.json` and the user overlay may register `planAuditor: { command }`,
merged as the same scalar override as `orient` and `scopes` and passed through
`ResolvedConfig.planAuditor`. Nothing reads it yet; the lint wiring follows.
JSON schemas regenerated from the Effect schemas.

---

## phase-02 — Projection request, auditor query and advisory findings {#phase-02-request-query-findings}

**Recommended model:** claude-sonnet-5
**Recommended effort:** medium

Build the pieces the lint composes: the auditor request derived from the shared
projection, the response schema, the typed query on the shared provider
transport, and the pure mapping from an auditor response (or failure) to
`advisory` lint findings. Nothing is wired into `lintPlan` yet.

### Detailed instructions

- **Request** (`src/domain/plan/projection.ts`): add
  `export interface PlanAuditRequest { readonly phases: readonly ProjectedPhase[] }`
  and `export function makePlanAuditRequest(phases: ReadonlyArray<ProjectablePhase>): PlanAuditRequest`
  returning `{ phases: projectPhases(phases) }`. No `phase` key. Leave
  `makeScopesRequest` and `projectPhases` untouched.
- **Response schema** (new `src/schemas/planAudit.ts`, modelled on
  `src/schemas/scopes.ts`):
  - `PlanAuditFindingSchema = Schema.Struct({ message: Schema.NonEmptyString, phases: Schema.Array(Schema.NonEmptyString) })`.
  - `PlanAuditResponseSchema = Schema.Struct({ findings: Schema.Array(PlanAuditFindingSchema) })`.
  - Export the `PlanAuditFinding` / `PlanAuditResponse` types and
    `decodePlanAuditResponse = Schema.decodeUnknownEither(PlanAuditResponseSchema)`
    (default leniency: unknown keys ignored, as for scopes).
- **Error** (`src/domain/errors.ts`): `PlanAuditorError` as a
  `Data.TaggedError("PlanAuditorError")` with the same `{ message, exitCode?, stderrExcerpt? }`
  fields as `ScopesProviderError` (`:238-242`), placed right after it. It is
  never raised as an effect error and needs no exit-code mapping in
  `runLayers.ts`.
- **Query** (new `src/app/planAuditor.ts`, modelled on `src/app/scopes.ts`):
  `queryPlanAuditor(config: PlanAuditorConfig, request: PlanAuditRequest, cwd: string): Effect.Effect<Either.Either<PlanAuditResponse, PlanAuditorError>, never, Shell>`
  via `runProviderQuery("Plan auditor", config.command, cwd, request, decodePlanAuditResponse, (f) => new PlanAuditorError(f))`.
- **Findings mapping** (`src/domain/plan/lint.ts`):
  - Extend `LintCheck` with `"advisory"`.
  - `export function advisoryFindings(response: PlanAuditResponse): readonly LintFinding[]`
    — for each auditor finding, in order: one `{ severity: "warning", check: "advisory", phase: <id>, message }`
    per entry of `phases`, in the order given; when `phases` is empty, a
    single finding with `phase: null`. Severity is always `warning`.
  - `export function auditorFailureFinding(failure: { readonly message: string; readonly stderrExcerpt?: string }): LintFinding`
    — `{ severity: "warning", check: "advisory", phase: null, message: "plan auditor failed: <message>" }`;
    when `stderrExcerpt` is present, append `; stderr: <first line of the excerpt>`
    so the row stays single-line.
  - Do not touch `hasLintErrors`; advisory findings can never be errors by
    construction.
- **Renderer** (`src/domain/plan/lintRender.ts`): no change — `"structure"`
  is still the widest check name. Add a comment on `CHECK_WIDTH` naming
  `advisory` as a member if helpful; do not widen.
- **Tests**:
  - `tests/unit/planProjection.test.ts`: `makePlanAuditRequest` yields only a
    `phases` key (assert `Object.keys(...)` is `["phases"]`), whose entries
    equal `projectPhases(phases)`, in order, optional files excluded, create
    and edit deduplicated.
  - New `tests/unit/schemas/planAudit.test.ts` mirroring `scopes.test.ts`: a
    response with two findings decodes; `{ findings: [] }` decodes; a finding
    with `phases: []` decodes; a finding without `message` or with an empty
    `message` is rejected; a finding with a non-string phase is rejected; an
    unknown top-level key is ignored; `{}` is rejected.
  - New `tests/integration/planAuditor.test.ts` mirroring
    `tests/integration/scopes.test.ts`: happy path (decoded findings; one shell
    call whose `command` is the tokenised config and whose `stdin` is
    `JSON.stringify(request)`); non-zero exit (typed `PlanAuditorError` with
    `exitCode` and `stderrExcerpt`, message containing "Plan auditor"); garbage
    stdout; schema-invalid stdout; whitespace-only command (empty-command
    failure, no shell call).
  - `tests/unit/planLint.test.ts`: `advisoryFindings` fans out one finding per
    phase in order with the message repeated, maps an empty `phases` to
    `phase: null`, preserves auditor finding order, returns `[]` for no
    findings; `auditorFailureFinding` shape with and without a multi-line
    `stderrExcerpt`; `hasLintErrors` is `false` on an advisory-only report.

### Planned files to create

- `src/schemas/planAudit.ts`
- `src/app/planAuditor.ts`
- `tests/unit/schemas/planAudit.test.ts`
- `tests/integration/planAuditor.test.ts`

### Planned files to edit

- `src/domain/plan/projection.ts`
- `src/domain/plan/lint.ts`
- `src/domain/errors.ts`
- `tests/unit/planProjection.test.ts`
- `tests/unit/planLint.test.ts`

### Optional files that may be edited

- `src/domain/plan/lintRender.ts`
- `tests/unit/planLintRender.test.ts`

### Boundary contracts

- Producer: `src/domain/plan/projection.ts` exposes `PlanAuditRequest` /
  `makePlanAuditRequest`; `src/schemas/planAudit.ts` exposes
  `PlanAuditResponse` / `decodePlanAuditResponse`. Consumer: `src/app/planAuditor.ts`.
- Producer: `src/app/planAuditor.ts` exposes `queryPlanAuditor` (requires
  `Shell`, never fails). Consumer: phase-03 (`lintPlan`).
- Producer: `src/domain/plan/lint.ts` exposes `advisoryFindings` /
  `auditorFailureFinding` and the widened `LintCheck`. Consumers: phase-03
  (`lintPlan`), the renderer (unchanged), `--json` readers.

### Test strategy

Domain (projection, findings mapping) and schema: unit tests, written first.
Query: integration test with the fake shell, mirroring the scopes one. No
`lintPlan` change in this phase, so `tests/integration/lintPlan.test.ts` is
untouched.

### Implementation order

1. Response schema + test. 2. Request + projection test. 3. Error + query +
integration test. 4. `LintCheck`, `advisoryFindings`, `auditorFailureFinding`
+ unit tests.

### Excluded scope

- Calling the auditor from `lintPlan`, the CLI layer, the long help and
  contract regeneration (phase-03).
- Docs and the example provider (phase-04).

### Verification

- The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- The exact signatures of `makePlanAuditRequest`, `queryPlanAuditor`,
  `advisoryFindings`, `auditorFailureFinding`, and the decoded shape of
  `PlanAuditResponse`.
- The exact message format of the failure finding (with and without stderr).
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(plan): add the plan-audit request, auditor query and advisory findings

### Commit body

Introduce the pieces the advisory check composes: `makePlanAuditRequest`
(the shared phase projection, no gated phase), the auditor response schema
(`{"findings": [{"message", "phases"}]}`), a typed `queryPlanAuditor` on the
shared provider transport, `advisory` as a fifth lint check, and the pure
mapping from a response (one warning per named phase, `null` when none) or a
provider failure (one warning) to lint findings. Nothing is wired into
`lintPlan` yet. Covered by unit and integration tests.

---

## phase-03 — Advisory check in plans lint {#phase-03-lint-wiring}

**Recommended model:** claude-sonnet-5
**Recommended effort:** high

Query the registered plan auditor from `lintPlan`, append its findings to the
report as the `advisory` check, provide the shell at the CLI edge, and update
the `plans lint` contract text and its generated derivatives.

### Detailed instructions

- **Use case** (`src/app/lintPlan.ts`):
  - Requirement set becomes `FileSystem | Shell`; the error channel is
    unchanged (`FsError | ConfigValidationError`) — an auditor failure is a
    finding, never an error.
  - After `modelFindings`, when `config.planAuditor !== undefined`:
    `const audited = yield* queryPlanAuditor(config.planAuditor, makePlanAuditRequest(plan.phases), config.repoRoot);`
    then push `advisoryFindings(audited.right)` on `Right` or
    `[auditorFailureFinding(audited.left)]` on `Left`. The two existing early
    returns (structure errors, finalize error) stay above this, so an
    unparseable plan never spawns the auditor.
  - Update the docstring: the requirement set is `FileSystem` plus `Shell` for
    the auditor, still no `Backend`; advisory findings are the one check that
    reports on an external provider, and they are warnings by construction.
- **CLI** (`src/cli/commands/plans.ts:95-130`): provide
  `Layer.mergeAll(makeRepoRootedFileSystemLayer(config), NodeShellLayer)`
  (import from `../../infra/shell.js`); reword the comment — filesystem and
  shell only, no Backend, so the lint cannot reach a model. Exit code logic is
  unchanged (`hasLintErrors`).
- **Long help** (`src/cli/cliDocs.ts:134-143`, `"plans lint"`): "Five checks
  run: …" — append the fifth: "advisory — when phax.json registers a
  planAuditor, phax writes the plan projection (the ordered phases, each with
  its planned create/edit files, and nothing else) to that command's stdin and
  reports every finding it returns as a warning naming the phases it concerns;
  a failing auditor is a single warning; with no auditor, or a plan the parser
  cannot read, there are no advisory findings. Advisory findings never affect
  the exit code." Amend the side-effects sentence: "Side effects: none of
  phax's own; a registered plan auditor is spawned once with the projection
  on stdin." Leave the parent `plans` help as is.
- **Regenerate** `phax.usage.kdl` with `pnpm gen:usage-spec` and
  `docs/cli/reference.md` (plus the README generated block, if it changes)
  with `pnpm docs:cli`, in the same commit; `usageSpecDrift` and
  `docsCliDrift` fail otherwise.
- **Tests** (`tests/integration/lintPlan.test.ts`):
  - `runLint` takes an optional fake shell (default `makeFakeShell()` with a
    response of exit 0 / `{"findings":[]}`) and provides
    `Layer.mergeAll(fakeFs.layer, fakeShell.layer)`; keep the comment about
    the missing Backend. Add a config variant with
    `planAuditor: { command: "audit-plan" }`.
  - No auditor registered: the shell is never called and the findings are
    exactly those of today's cases.
  - Auditor registered, plan with two phases (phase-01 creates `src/a.ts` and
    edits `src/b.ts`, optional `src/c.ts`; phase-02 edits `src/a.ts`): the
    single shell call's `stdin` parses to exactly
    `{ phases: [{ id: "phase-01", files: ["src/a.ts", "src/b.ts"] }, { id: "phase-02", files: ["src/a.ts"] }] }`
    (assert deep equality — no `phase`, no models, no optional file); the
    command is `["audit-plan"]`; the cwd is the repo root.
  - Auditor returns one finding naming two phases and one naming none: three
    `advisory` warnings in that order, appended after every other finding.
  - Auditor exits 1 with stderr "boom": one warning
    `plan auditor failed: Plan auditor exited with code 1; stderr: boom`,
    `phase: null`, the rest of the report intact, `hasLintErrors` false.
  - Structurally broken plan with an auditor registered: the shell is never
    called.
- `tests/unit/cli/plans.test.ts` (optional): an advisory-only report renders
  and exits 0 — only if it adds a distinct assertion over the existing
  warning-only case.

### Planned files to create

- (none)

### Planned files to edit

- `src/app/lintPlan.ts`
- `src/cli/commands/plans.ts`
- `src/cli/cliDocs.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`
- `tests/integration/lintPlan.test.ts`

### Optional files that may be edited

- `README.md`
- `tests/unit/cli/plans.test.ts`
- `docs/cli/inventory.md`

### Boundary contracts

- Consumer: `lintPlan` needs a never-failing auditor query and the two
  findings mappers from phase-02; producer: `src/app/planAuditor.ts` and
  `src/domain/plan/lint.ts`, unchanged in shape.
- Consumer: `runPlansLint` needs `lintPlan` to declare `Shell`; producer: the
  CLI provides `NodeShellLayer` — the only infra addition.

### Test strategy

Integration tests on `lintPlan` with the fake filesystem and fake shell,
written first for the projection content (the spec's "only the projection"
acceptance criterion) and the never-blocking posture. The CLI unit test is
mock-based and needs no change to pass.

### Implementation order

1. `lintPlan.test.ts` cases (red). 2. `lintPlan` wiring. 3. CLI layer.
4. Long help, then regenerate the KDL and docs.

### Excluded scope

- README prose, the planning skill and the example provider (phase-04).
- Any persistence of findings (arbitrated out).

### Verification

- The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- The final `lintPlan` requirement set and where the auditor call sits.
- The exact long-help text added, and confirmation that the KDL and docs were
  regenerated (not hand-edited).
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(plan): run the registered plan auditor as an advisory lint check

### Commit body

`phax plans lint` now hands the plan projection — ordered phases with their
planned create/edit files, nothing else — to the `planAuditor` command
registered in `phax.json`, once the deterministic extraction succeeds, and
appends its findings as `advisory` warnings, one per phase named. A failing
auditor is one warning; no auditor leaves the report unchanged; the exit
code never depends on the advisory check. The CLI provides the shell next to
the repo-rooted filesystem; still no Backend. Long help and its generated
contract updated.

---

## phase-04 — Docs, planning skill and hello-world auditor {#phase-04-docs-example}

**Recommended model:** claude-sonnet-5
**Recommended effort:** medium

Document the plan auditor where the orient and scope providers are documented,
teach the planning skill the fifth check, and ship a working example auditor in
`examples/hello-world` covered by the example-providers test.

### Detailed instructions

- **README**:
  - New `### Plan auditor` subsection right after "Scope provider"
    (`README.md:177-208`, before `## Configuration layers`): registration
    snippet `"planAuditor": { "command": "node ./audit-plan.mjs" }`; command
    split on whitespace, no shell, same as `orient` / `scopes`; when it fires
    (`phax plans lint`, only after the deterministic extraction succeeds,
    never from `phax run`); the request
    `{ "phases": [{ "id": "phase-01", "files": [...] }, ...] }` — the same
    projection as the scope provider minus `phase`, `files` being planned
    create+edit deduplicated in plan order with optional files excluded,
    and nothing else (models, efforts, prompts, commit metadata are withheld);
    the response `{ "findings": [{ "message": "...", "phases": ["phase-01"] }] }`;
    the advisory posture: each finding renders as a `warning` on the
    `advisory` check, one row per phase named (`-` when none), never sets the
    exit code; a non-zero exit, non-JSON stdout or a schema-invalid response is
    one warning naming the reason; no auditor → lint unchanged.
  - "Lint the plan" (`:243-252`): extend the paragraph with the fifth check
    in one sentence and keep "exits 1 when any finding is an error".
- **Planning skill** (`.claude/skills/phax-planning/SKILL.md:39-50`, "Lint
  before you run"): "Four checks" becomes five with an `advisory` sentence
  (external auditor, warnings only, treat them as planning advice — revise the
  phase sequence or knowingly defer). `.claude/skills/phax-cli/SKILL.md:60-67`
  gets the same one-line touch only if its wording enumerates the checks.
- **Example auditor** (new `examples/hello-world/audit-plan.mjs`, in the style
  of `scopes.mjs`: read stdin as a stream, parse, write one JSON line): for
  every phase and every `files` entry matching `src/<name>.ts`, look for a
  phase at the same or a later index whose `files` contains
  `tests/<name>.test.ts`; when none exists, emit
  `{ "message": "<phase> touches src/<name>.ts; no later phase touches tests/<name>.test.ts", "phases": ["<phase>"] }`.
  Output `{ "findings": [...] }`. On the hello-world plan projection
  (phase-01 `src/greet.ts`, phase-02 `tests/greet.test.ts`) the result is
  `{ "findings": [] }`.
- **Example config** (`examples/hello-world/phax.json`): add
  `"planAuditor": { "command": "node ./audit-plan.mjs" }` after `scopes`.
- **Tests** (`tests/integration/exampleProviders.test.ts`): the config-decode
  case (`:122-137`) also asserts `config.planAuditor?.command`; new
  `describe("examples/hello-world plan auditor")`: the full hello-world
  projection decodes with `decodePlanAuditResponse` to zero findings; a
  projection with phase-02 removed decodes to one finding naming `phase-01`
  whose message mentions `tests/greet.test.ts`.
- **Housekeeping** (optional): `docs/plan-extraction-model.md` and
  `NEXT_STEPS.md` only where they enumerate the lint's checks or list spec 19
  as unplanned.

### Planned files to create

- `examples/hello-world/audit-plan.mjs`

### Planned files to edit

- `README.md`
- `examples/hello-world/phax.json`
- `tests/integration/exampleProviders.test.ts`
- `.claude/skills/phax-planning/SKILL.md`

### Optional files that may be edited

- `.claude/skills/phax-cli/SKILL.md`
- `docs/plan-extraction-model.md`
- `NEXT_STEPS.md`
- `examples/hello-world/plan.md`

### Test strategy

The example-providers integration test runs the script for real against the
decoder from phase-02; write the two cases first. Docs are checked by reading
them against the shipped behaviour of phase-03 (config key, request and
response shapes, exit-code rule).

### Implementation order

1. `audit-plan.mjs` + its test cases. 2. Example `phax.json`. 3. README
subsection and lint paragraph. 4. Skill text.

### Excluded scope

- Any behaviour change in `src/` (phases 01–03 are complete and merged).
- Persisting findings or any artifact next to the plan (arbitrated out).

### Verification

- The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- The README anchors added and the exact example command registered.
- The one-line behaviour of `audit-plan.mjs` and the two projections the test
  feeds it.
- Any deviation from the planned file lists, with the reason.

### Commit subject

docs(plan): document the plan auditor and ship a hello-world example

### Commit body

README gains a "Plan auditor" subsection next to the orient and scope
providers (registration, when the lint queries it, the projection it receives
and nothing else, the findings it returns, the warnings-only posture) and the
lint section names the fifth check. The planning skill tells authors to read
advisory findings as advice. `examples/hello-world` registers `audit-plan.mjs`,
which flags a `src/<name>.ts` no later phase pairs with `tests/<name>.test.ts`,
covered by the example-providers test.
