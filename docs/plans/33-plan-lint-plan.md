---
status: Draft
source-spec: docs/specs/33-plan-lint.md
---
# Plan lint

## Overview

Implements spec 33 (`docs/specs/33-plan-lint.md`): a read-only, model-free
`phax plans lint <plan>` that reports every mechanical defect of a plan phax can
establish before a run — the structural fields the deterministic extraction
requires, the coherence of the planned-file lists with the working tree and with
earlier phases, and the two run-start preflight conditions (required commands
covered, model/effort in the catalog) — and removes `extract-plan`.

Build order is inside-out: the parser learns to report every structural error
instead of the first (phase-01), the pure file-plan and run-readiness rules land
in the domain (phase-02, phase-03), the app use case assembles them over the
ports (phase-03), the CLI surfaces them (phase-04), then `extract-plan` is
removed from code and generated docs (phase-05) and from prose, skills and the
example (phase-06).

## Required commands

- (none)

Every gate step uses `pnpm` scripts already present in `package.json`. The two
regeneration scripts the plan calls, `pnpm gen:usage-spec` and `pnpm docs:cli`,
are already granted in `security.agentCommands`. No `## Required PHAX security
configuration changes` section is needed.

---

## Technical arbitrations

Decided while planning on 2026-09-08; recorded so phases execute without
re-litigating them. The four §9 questions of the spec were decided with the
operator the same day (verb `lint` under `plans`; ground is the working tree;
errors set a non-zero exit code; `commands` and `models` checks included).

- **The structural check is the existing parser made to accumulate, not a second
  walker.** `extractPlanDeterministic` keeps its signature and its behavior
  (`Left` = the first error, in the same order as today); the accumulation lives
  in a shared internal walk that a new exported function returns in full.
  Abandons: the parser's single-return-shape simplicity. Accepted: spec §10
  forbids a second parser, and a duplicated walker would drift from the run's
  fast path.
- **The file-plan rule is pure over a precomputed existence set.** The app layer
  collects every path a plan lists to create or edit, asks the `FileSystem` port
  whether each exists under the repo root, and hands the domain a
  `ReadonlySet<string>` of the existing ones. Abandons: a domain function that
  could probe lazily. Accepted: `src/domain/` does no I/O, and the candidate set
  is the plan's own paths, never the tree.
- **Run-readiness reuses the preflight functions unchanged.** `commands` wraps
  `checkRequiredCommands` with the same inputs `executePlan` gives it (security
  `agentCommands` ∪ the single gate profile's commands); `models` wraps
  `preflightPhaseModels` with the routing and provider config loaded from the
  state root, so a model/effort refused at run start is refused by the lint for
  the same reason, alternatives included in the message. Abandons: a lint that
  runs without `~/.phax` (the loaders fall back to built-in defaults when the
  files are absent, so this only matters for a corrupt global config).
- **An unreadable plan file or an invalid `phax.json` is a refusal, not a
  finding**: the command reports the error and exits 1 as `plans status` does.
  Findings describe the plan; they never describe the environment.
- **The one warning is `create ∩ optional`** (spec §6 sample): a path listed
  both to create and under optional files in the same phase. No other warning is
  introduced.
- **Exit code 1 on errors.** No new error class: the CLI returns 1 when at least
  one finding has severity `error`. Config and read failures keep the codes
  `exitCodeForError` already assigns.

## Context

Audited 2026-09-08 against `main` @ `7dd2b9d`.

- **Deterministic parser**: `extractPlanDeterministic(planMd)` in
  `src/domain/plan/parsePlanMarkdown.ts` returns
  `Either<ExtractedPhaxPlan, PlanValidationError>` and stops at the first
  error; the per-phase helpers (`extractPlannedList`, `extractCommitSubject`,
  `extractCommitBody`, `readRecommendedFields`) each return an `Either`.
  Messages are already phase-prefixed (`phase-02: missing "### Planned files
  to edit" section`) or plan-level (`missing "## Required commands" section`).
  `finalizeExtractedPlan` (`src/domain/plan/finalize.ts`) derives titles,
  slugifies the short name and reports anchor warnings. Tests:
  `tests/unit/parsePlanMarkdown.test.ts`, `tests/unit/examplePlanDeterministic.test.ts`.
- **Extraction at run time**: `loadOrExtractPlan` (`src/app/loadOrExtractPlan.ts`)
  tries the parser, then the cache, then `extractPlanLlm`
  (`src/app/extractPlan.ts:112`). Its cache-miss hint (`:68`) says "run `phax
  extract-plan` or drop --no-extract" and `tests/integration/loadOrExtractPlan.test.ts:229`
  asserts it. `extractPlan` (`src/app/extractPlan.ts:215`) is the wrapper only
  `src/cli/commands/extractPlan.ts` uses: lock check, `writeAtomic` of
  `phax-plan.json` and `extract-report.md` (`buildExtractReport`, `:49`).
  `extractPlanCore` (`:165`) stays — `tests/integration/extractPlanSealed.test.ts`
  and `extractPlanTitles.test.ts` exercise it.
- **Preflight functions**: `checkRequiredCommands({ requiredCommands,
  configCommands, gateCommands })` in `src/domain/security/agentCommands.ts:80`
  (used by `executePlan.ts:417` and `buildDryRunReport` in `src/app/dryRun.ts`);
  `preflightPhaseModels(phases, routing, providerConfig)` in
  `src/domain/routing/preflight.ts` returning `{ failures: PreflightFailure[] }`
  with `reasons` and `alternatives` (used by `executePlan.ts:456`). Routing and
  provider config load through `loadModelRouting()` / `loadProviderConfig()`
  (`src/app/loadRouting.ts`, need `FileSystem`). The single gate profile
  resolves through `resolveGateProfile(config, profileId)` (`src/app/gates.ts:43`)
  with `profileId = Object.keys(config.raw.gateProfiles)[0]` (`pickGateProfileId`
  in `src/cli/commands/run.ts:108`, and the same fallback in `dryRun.ts:44`).
- **CLI model**: `src/cli/commands/plans.ts` registers the `plans` parent with
  `status` and `overlap`; `runPlansStatus` loads config, provides a merged node
  layer (`makeRepoRootedFileSystemLayer`, git, noop telemetry), renders via
  `src/domain/artifact/render.ts` or emits JSON. `src/cli/cliDocs.ts:124-141`
  carries the long help and examples for `plans`, `plans status`, `plans
  overlap`. `tests/unit/cli/plans.test.ts` tests `runPlansStatus` with mocks.
  `exitCodeForError` lives in `src/cli/commands/runLayers.ts:122`.
- **Generated surfaces**: `phax.usage.kdl` from the Commander tree
  (`pnpm gen:usage-spec`, `scripts/generate-usage-spec.ts` reads `cliDocs`);
  `docs/cli/reference.md` and the README block between
  `<!-- BEGIN GENERATED CLI REFERENCE -->` / `END` (`README.md:565-622`) from
  `pnpm docs:cli`. `docs/cli/inventory.md` is hand-maintained.
  `tests/integration/cliProgram.test.ts:5-36` lists the top-level commands,
  `extract-plan` included.
- **Every other `extract-plan` mention** (phase-05 and phase-06 sweep):
  `README.md:239-249` ("Write a plan" / "Extract the plan"), `README.md:414`
  (link to `docs/extract-plan-model.md`), `docs/extract-plan-model.md`,
  `.claude/skills/phax-planning/SKILL.md` (frontmatter description + lines 9,
  13, 40, 85, 114, 188, 447), `.claude/skills/phax-cli/SKILL.md:66`,
  `.claude/skills/phax-spec/SKILL.md:19`, `examples/hello-world/plan.md:9`,
  `src/cli/commands/orient.ts:24` (comment), `tests/e2e/realFlow.test.ts:195-240`
  (the standalone `describe`), `tests/integration/run.test.ts:63-117`
  (comments only). Left alone on purpose: `docs/blog/`, `docs/vocabulary-review.md`,
  archived plans and specs.
- **Fakes for tests**: `makeFakeFileSystem` (`src/infra/fakes/fs.ts`, `files`
  map + `exists`), `makeFakeBackend`, `makeFakeShell`. Integration tests that
  drive a command against a temp repo follow
  `tests/integration/plansOverlapCommand.test.ts`.
- **Spec 19 hook**: the app use case of phase-03 is the "plan finalization"
  point spec 19 will extend with the external auditor; keep its result a plain
  `{ plan, findings }` so an `advisory` check can be appended later without
  changing the CLI.

---

## phase-01 — Parser reports every structural error {#phase-01-parser-accumulates}

**Recommended model:** claude-sonnet-5
**Recommended effort:** medium

Make the deterministic parser accumulate structural errors so the lint can
report each missing or malformed field (spec §5.2), while `extractPlanDeterministic`
keeps returning the first error exactly as today. Introduce the finding
vocabulary the later phases share.

### Detailed instructions

- In `src/domain/plan/parsePlanMarkdown.ts`, refactor the walk so that plan-level
  checks (title, `## Required commands`, phase headings) and each phase's checks
  (heading id/anchor, recommended model/effort, the three planned-file lists,
  commit subject, commit body) push into an ordered `errors` array instead of
  returning at the first failure. A phase whose heading cannot be parsed
  contributes its heading error and is skipped; a phase with a parseable heading
  runs every remaining check. Export a new pure function
  `collectPlanStructureErrors(planMd): readonly StructureError[]` where
  `StructureError = { phase: string | null; message: string }` — `phase` is the
  `phase-NN` id when the error concerns a phase, `null` for plan-level errors.
  Message texts stay verbatim (tests assert them); strip the `phase-NN: ` prefix
  from the message when you populate `phase`, so a message is never
  double-prefixed by the renderer.
- Keep `extractPlanDeterministic` as a thin wrapper: run the same walk; if
  `errors` is non-empty return `Left(new PlanValidationError({ message }))`
  built from the first error re-prefixed as today; otherwise decode the candidate
  through `ExtractedPhaxPlanSchema` as today. Existing tests must pass unchanged.
- Create `src/domain/plan/lint.ts` with the finding vocabulary only:
  `type LintSeverity = "error" | "warning"`, `type LintCheck = "structure" |
  "files" | "commands" | "models"` (closed sets, spec §6),
  `interface LintFinding { severity; check; phase: string | null; message }`,
  and `structureFindings(planMd): readonly LintFinding[]` mapping
  `collectPlanStructureErrors` to `error` findings with check `structure`.
- Tests (write first): in `tests/unit/parsePlanMarkdown.test.ts` add a plan
  with three defects across two phases (missing "Planned files to edit" in
  phase-02, empty commit subject in phase-03, missing "Recommended effort"
  value in phase-03) and assert `collectPlanStructureErrors` returns all three
  in document order with the right `phase`, and that `extractPlanDeterministic`
  still returns the first one with the prefixed message. Add a plan-level case
  (no `## Required commands`) with `phase: null`. In `tests/unit/planLint.test.ts`
  assert `structureFindings` maps to `{ severity: "error", check: "structure" }`
  and returns `[]` for a conforming plan (reuse the conforming fixture of
  `tests/unit/loadOrExtractPlan.test.ts:8`).

### Planned files to create

- `src/domain/plan/lint.ts`
- `tests/unit/planLint.test.ts`

### Planned files to edit

- `src/domain/plan/parsePlanMarkdown.ts`
- `tests/unit/parsePlanMarkdown.test.ts`

### Optional files that may be edited

- `tests/unit/examplePlanDeterministic.test.ts`

### Boundary contracts

None — everything stays inside `src/domain/plan/`. Consumers of
`extractPlanDeterministic` (`src/app/loadOrExtractPlan.ts`) see no change.

### Test strategy

Domain unit tests, written before the refactor. The regression guard is the
existing `parsePlanMarkdown.test.ts` suite passing untouched; the new
assertions pin accumulation order and the `phase` split.

### Implementation order

Tests → walk refactor with `errors` accumulator → `collectPlanStructureErrors`
export → `extractPlanDeterministic` wrapper → `lint.ts` vocabulary.

### Excluded scope

- File-plan, commands and models rules (phase-02, phase-03).
- Any change to `finalizeExtractedPlan` or to the LLM fallback.

### Verification

- The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- The exported names and signatures: `collectPlanStructureErrors`,
  `StructureError`, `LintFinding`, `LintSeverity`, `LintCheck`,
  `structureFindings`, with their module paths.
- Confirmation that the first-error message of `extractPlanDeterministic` is
  byte-identical to before for every existing test.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(plan): accumulate structural errors in the deterministic parser

### Commit body

Refactor the deterministic plan parser to collect every structural error in
document order and expose them through collectPlanStructureErrors, keeping
extractPlanDeterministic's first-error contract intact for the run's fast
path. Introduce the lint finding vocabulary (severity, check, phase, message)
and the structure check that maps parser errors to findings. Groundwork for
spec 33's plan lint.

## phase-02 — File-plan rule over the known-existing set {#phase-02-file-plan-rule}

**Recommended model:** claude-sonnet-5
**Recommended effort:** medium

Add the pure, sequence-aware file-plan check (spec §5.4–§5.7): edits must be
reachable, creates must be new, a phase cannot create and edit the same path,
optional files are never checked, and `create ∩ optional` in one phase is the
single warning.

### Detailed instructions

- In `src/domain/plan/lint.ts` add:
  - `plannedPaths(phases): readonly string[]` — the deduplicated union of every
    phase's `plannedFilesToCreate` and `plannedFilesToEdit`, in plan order. The
    app layer probes exactly these paths.
  - `filePlanFindings(phases, existing: ReadonlySet<string>): readonly LintFinding[]`
    walking phases in order with a mutable `known` map from path to origin
    (`"ground"` or the creating phase id), seeded from `existing`:
    - a path in both `plannedFilesToCreate` and `plannedFilesToEdit` of the same
      phase → `error`, check `files`, message `create and edit both list <path>`
      (report once, then treat the path as created for later phases);
    - `create <path>` already in `known` → `error`: `create <path>: exists in the
      working tree` or `create <path>: already created by phase-NN`;
    - `edit <path>` not in `known` → `error`: `edit <path>: does not exist and no
      earlier phase creates it`;
    - `create <path>` also in the same phase's `optionalFilesToEdit` → `warning`:
      `create <path>: also listed under optional files`;
    - after the checks, every path the phase creates joins `known` with the
      phase id as origin. Optional files never join `known` and never produce
      findings on their own.
  - Phases are typed on the `Pick<PhaxPlanPhase, "id" | "plannedFilesToCreate" |
    "plannedFilesToEdit" | "optionalFilesToEdit">` shape (same style as
    `ProjectablePhase` in `src/domain/plan/projection.ts`).
- Tests (write first) in `tests/unit/planLint.test.ts`, one per spec acceptance
  criterion: edit of a missing file; edit of a file created earlier is clean;
  create of an existing file; create of a file an earlier phase creates (names
  phase-01); create and edit in one phase; optional files never produce
  findings (one existing, one absent); the `create ∩ optional` warning; a clean
  multi-phase plan returns `[]`. Also assert `plannedPaths` excludes optional
  files and deduplicates.

### Planned files to create

- (none)

### Planned files to edit

- `src/domain/plan/lint.ts`
- `tests/unit/planLint.test.ts`

### Optional files that may be edited

- (none)

### Boundary contracts

None — pure domain code; the existence set is the contract the app layer
fulfils in phase-03 (`plannedPaths` → probe → `filePlanFindings`).

### Test strategy

Domain unit tests over in-memory sets, written before implementation. They are
the E2E-equivalent for spec §8's file-plan criteria: no filesystem involved.

### Implementation order

Tests → `plannedPaths` → `filePlanFindings`.

### Excluded scope

- Probing the working tree (phase-03).
- Any check of file contents or of optional files' existence.

### Verification

- The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- The exact message formats emitted per rule (the CLI renders them verbatim).
- The `plannedPaths` / `filePlanFindings` signatures.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(plan): add the sequence-aware file-plan lint rule

### Commit body

Add filePlanFindings: walk the phases in order over a known-existing set seeded
from the working tree, flagging edits of unreachable files, creates of existing
or already-created files, and a phase that both creates and edits a path; warn
on a path listed both to create and as optional. Optional files are never
checked. Pure domain code with one unit test per spec 33 acceptance criterion.

## phase-03 — Run-readiness rules and the lint use case {#phase-03-readiness-and-use-case}

**Recommended model:** claude-opus-5
**Recommended effort:** medium

Add the `commands` and `models` checks (spec §5.8, §5.9) as thin domain
wrappers over the run-start preflight functions, then the app use case that
reads the plan, runs every check over the ports, and returns the findings
(spec §5.1, §5.3).

### Detailed instructions

- In `src/domain/plan/lint.ts` add:
  - `commandFindings(requiredCommands, configCommands, gateCommands)` → one
    `error` finding per entry of `checkRequiredCommands(...).missing`, check
    `commands`, `phase: null`, message `required command "<cmd>" is not covered
    by security.agentCommands or the gate profile`.
  - `modelFindings(phases, routing, providerConfig)` → one `error` finding per
    `preflightPhaseModels(...).failures` entry, check `models`, `phase` = the
    failing phase id, message `<model> / <effort>: <reasons joined by "; ">`,
    followed by ` (alternatives: id1, id2)` when the failure lists any.
  - `hasLintErrors(findings): boolean`.
  - `src/domain/plan/lint.ts` may import from `src/domain/security/agentCommands.ts`
    and `src/domain/routing/preflight.ts` (domain → domain, no I/O).
- Create `src/app/lintPlan.ts` exporting
  `lintPlan(opts: { planMdPath; config: ResolvedConfig }): Effect<LintReport, FsError | ConfigValidationError, FileSystem>`
  with `LintReport = { plan: string; findings: readonly LintFinding[] }`
  (`plan` is the path as given). Steps, in order:
  1. `fs.readText(planMdPath)`; a read failure is the effect's error, not a
     finding.
  2. `structureFindings(planMd)`. If any, run `extractPlanDeterministic`; when
     it is `Left`, stop and return the structure findings only — the later
     checks need a plan. Never call the model or the cache (§5.3).
  3. `finalizeExtractedPlan(extracted, planMd)`: a `Left` becomes one
     `structure` error finding with `phase: null` (its message already names the
     phases); finalize warnings (anchor mismatches) become `structure` findings
     of severity `warning`.
  4. Files: `plannedPaths(plan.phases)` → `fs.exists(join(config.repoRoot, p))`
     for each → `filePlanFindings(plan.phases, existingSet)`.
  5. Commands: `resolveGateProfile(config, Object.keys(config.raw.gateProfiles)[0])`
     for the gate commands (an empty profile map yields no gate commands, not
     an error), `config.security.agentCommands` for the config commands →
     `commandFindings(...)`.
  6. Models: `loadModelRouting()` and `loadProviderConfig()` →
     `modelFindings(plan.phases, routing, providerConfig)`.
  7. Return findings in that order (structure, files, commands, models).
- Tests (write first) in `tests/integration/lintPlan.test.ts` with
  `makeFakeFileSystem`: a conforming plan whose files all resolve → `[]`; a
  structurally broken plan → only `structure` findings and no `Backend` in the
  layer (the effect must not require it — assert the type by providing only
  `FileSystem`); a plan editing an absent file → the `files` error; a plan
  declaring `deno` with no grant → the `commands` error; a plan naming an
  unknown model id → the `models` error naming the phase; the report's `plan`
  echoes the given path. Seed the fake fs with the plan text and the existing
  files under a fake repo root; leave routing/provider files absent so the
  loaders take their built-in defaults.

### Planned files to create

- `src/app/lintPlan.ts`
- `tests/integration/lintPlan.test.ts`

### Planned files to edit

- `src/domain/plan/lint.ts`
- `tests/unit/planLint.test.ts`

### Optional files that may be edited

- `src/app/loadRouting.ts`

### Boundary contracts

- **CLI → app**: `lintPlan({ planMdPath, config })` returns a `LintReport`;
  the CLI only renders it and derives the exit code with `hasLintErrors`.
- **app → domain**: the app feeds the domain a plan text, an existence set, the
  effective command lists, and the loaded routing/provider config; the domain
  returns findings. No port is touched from `src/domain/plan/lint.ts`.
- **app → ports**: `FileSystem` only (`readText`, `exists`), through the
  repo-rooted layer the CLI provides. No `Backend`, `Shell`, `Lock` or `Git`
  requirement may appear in `lintPlan`'s type — that is how §5.1 is enforced
  structurally.

### Test strategy

Domain unit tests for `commandFindings` / `modelFindings` (routing and
provider config built from `DEFAULT_MODEL_ROUTING` / `DEFAULT_PROVIDER_CONFIG`
in `src/domain/routing/defaults.ts`), written first. App integration tests with
the fake filesystem, one per spec criterion the use case owns (no trace, no
model, files, commands, models).

### Implementation order

Domain wrappers + unit tests → `lintPlan` skeleton with the structure short-cut
→ files → commands → models → integration tests green.

### Excluded scope

- Rendering, JSON output and the CLI command (phase-04).
- Any persistence of the report (spec non-goal) and the spec 19 auditor.

### Verification

- The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- The `lintPlan` signature, its exact requirement set (`FileSystem` only) and
  the `LintReport` shape.
- The message formats of the `commands` and `models` findings.
- Whether `loadRouting.ts` needed a touch, and why.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(plan): lint use case with run-readiness checks

### Commit body

Add commandFindings and modelFindings as thin domain wrappers over the
run-start preflight functions, and lintPlan, the read-only app use case that
reads a plan, reports structural errors without ever falling back to the model,
probes the planned paths through the FileSystem port for the file-plan rule,
and runs the required-commands and model-catalog checks with the same inputs
executePlan uses. Requires FileSystem only, which is what keeps it side-effect
free by construction.

## phase-04 — `phax plans lint` command, rendering and JSON {#phase-04-cli-command}

**Recommended model:** claude-opus-5
**Recommended effort:** medium

Expose the use case as `phax plans lint <plan> [--json]` (spec §5.10, §5.11,
§6): rendered report on stdout, JSON on demand, exit 1 when any finding is an
error, and the usage spec plus CLI reference regenerated.

### Detailed instructions

- Create `src/domain/plan/lintRender.ts` with `renderLintReport(report):
  string` producing the spec §6 sketch: a header line
  `<plan>: N error(s), M warning(s)` (or `<plan>: no findings`), then one line
  per finding `<severity padded>  <check padded>  <phase or "-">  <message>`.
  Pure formatting; the header is normative, the columns indicative.
- In `src/cli/commands/plans.ts` add `runPlansLint(plan, opts, out)`:
  `loadConfig(process.cwd())` (config error → `out.error`, return 1, as
  `runPlansStatus`); resolve the plan path against cwd; run `lintPlan` with
  `makeRepoRootedFileSystemLayer(config)` only; on failure `out.error` the
  message and return `exitCodeForError(err)`; with `--json`, `out.log(JSON.stringify(report, null, 2))`;
  otherwise `out.log(renderLintReport(report))`; return
  `hasLintErrors(report.findings) ? 1 : 0`. Register the `lint` subcommand on
  the `plans` parent with `.argument("<plan>", "Path to the plan.md")` and
  `.option("--json", "Emit the findings as JSON")`.
- In `src/cli/cliDocs.ts` add the `"plans lint"` entry (long help: what the four
  checks are, that it never writes or calls a model, that exit 1 means at
  least one error, that the file-plan ground is the working tree; examples
  `phax plans lint docs/plans/60-foo-plan.md` and `... --json`) and extend the
  `plans` parent description/examples to mention lint.
- Regenerate: `pnpm gen:usage-spec` (→ `phax.usage.kdl`) and `pnpm docs:cli`
  (→ `docs/cli/reference.md` and the README generated block). Add the `lint`
  row to `docs/cli/inventory.md` by hand.
- Tests (write first): `tests/unit/planLintRender.test.ts` for the header
  variants and one finding line; in `tests/unit/cli/plans.test.ts` add
  `runPlansLint` cases mocking `lintPlan` like `runPlansStatus` is tested —
  exit 0 with only warnings, exit 1 with one error, `--json` emits the report
  verbatim and nothing else, config error returns 1. In
  `tests/integration/cliProgram.test.ts` assert `plans` exposes `lint` with a
  `<plan>` argument and a `--json` option if the suite inspects subcommands;
  otherwise leave it for phase-05.

### Planned files to create

- `src/domain/plan/lintRender.ts`
- `tests/unit/planLintRender.test.ts`

### Planned files to edit

- `src/cli/commands/plans.ts`
- `src/cli/cliDocs.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`
- `docs/cli/inventory.md`
- `README.md`
- `tests/unit/cli/plans.test.ts`

### Optional files that may be edited

- `tests/integration/cliProgram.test.ts`
- `src/cli/cliCompleters.ts`

### Boundary contracts

- **CLI → app**: `runPlansLint` calls `lintPlan` and nothing else from `app/`;
  no business logic in the command file (render and exit-code derivation are
  domain functions).
- **CLI → OutputPort**: report and JSON go through `out.log`, errors through
  `out.error`.

### Test strategy

Renderer unit tests; CLI command unit tests with the use case mocked (the
pattern of `tests/unit/cli/plans.test.ts`). The generated `phax.usage.kdl`
and reference are verified by the gate's format/lint steps and by diffing the
regeneration output (the README block must change only inside its markers).

### Implementation order

Renderer + tests → `runPlansLint` + registration → `cliDocs` entry →
regenerate usage spec and docs → inventory row → CLI tests.

### Excluded scope

- Removing `extract-plan` (phase-05); the README prose sections (phase-06).

### Verification

- The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- The exact rendered header and line format, and the JSON top-level shape.
- The list of regenerated files and confirmation the README changed only
  between its generated markers.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(cli): add phax plans lint

### Commit body

Add `phax plans lint <plan> [--json]`: renders the lint report or emits it as
JSON and exits 1 when any finding is an error. Read-only, model-free: the
command provides the filesystem layer only. Long help in cliDocs; usage spec,
CLI reference, README generated block and the hand-maintained inventory
updated. Implements spec 33 §5.10, §5.11 and §6.

## phase-05 — Remove extract-plan from code and generated docs {#phase-05-remove-extract-plan}

**Recommended model:** claude-sonnet-5
**Recommended effort:** medium

Delete the `extract-plan` command and its wrapper (spec §5.12), update the
tests and hints that name it, and regenerate the usage spec and CLI reference
so `phax --usage` no longer lists it.

### Detailed instructions

- `src/cli/program.ts`: drop the `extract-plan` registration and its import.
  Delete `src/cli/commands/extractPlan.ts`.
- `src/app/extractPlan.ts`: remove `extractPlan`, `ExtractPlanOptions`,
  `ExtractPlanResult`, `ExtractPlanError`, `buildExtractReport` and the
  now-unused imports (`Lock`, `LockConflictError`, `parseShortNameFromPlanText`,
  `decodeShortName` if unused elsewhere in the file, `dirname`/`join` if unused).
  Keep `extractPlanLlm`, `extractPlanCore`, `ExtractPlanCoreOptions/Result/Error`
  and the header comment; update the comment at `:162` that says "cwd for
  `phax extract-plan`".
- `src/app/loadOrExtractPlan.ts:68`: the `--no-extract` cache-miss message
  becomes `No cached extraction for "<path>"; drop --no-extract to extract it.`
  Update `tests/integration/loadOrExtractPlan.test.ts:229` accordingly.
- `src/cli/commands/orient.ts:24`: reword the comment so it no longer cites
  `extract-plan` (it describes the "no run context yet" telemetry placeholder).
- Tests: remove `"extract-plan"` from `TOP_LEVEL_COMMANDS` in
  `tests/integration/cliProgram.test.ts`; delete the `describe("phax extract-plan
  (standalone)")` block in `tests/e2e/realFlow.test.ts` (`:190-240`) and any
  helper only it used; reword the two comments in `tests/integration/run.test.ts`
  (`:63`, `:72`, `:108`, `:117`) to "a prior `phax run`" — behavior of those
  tests is unchanged.
- Regenerate `pnpm gen:usage-spec` and `pnpm docs:cli`; remove the
  `extract-plan` row from `docs/cli/inventory.md`.
- Run `pnpm knip` locally before committing: the deleted wrapper must leave no
  unused export or dependency behind.

### Planned files to create

- (none)

### Planned files to edit

- `src/cli/program.ts`
- `src/app/extractPlan.ts`
- `src/app/loadOrExtractPlan.ts`
- `src/cli/commands/orient.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`
- `docs/cli/inventory.md`
- `README.md`
- `tests/integration/cliProgram.test.ts`
- `tests/integration/loadOrExtractPlan.test.ts`
- `tests/integration/run.test.ts`
- `tests/e2e/realFlow.test.ts`

### Optional files that may be edited

- `src/cli/cliDocs.ts`
- `src/cli/cliCompleters.ts`

### Boundary contracts

None crossed; the deletion removes a CLI → app edge (`runExtractPlan` →
`extractPlan`) and nothing else.

### Test strategy

The existing suites are the regression guard: `cliProgram.test.ts` pins the
command list, `loadOrExtractPlan.test.ts` pins the hint, the `extractPlanSealed`
/ `extractPlanTitles` suites keep covering the retained core. Deleting the e2e
block is a deletion, not a rewrite; `pnpm test:e2e:real` is not part of the
gate and is not run here.

### Implementation order

Delete command file + registration → prune the app wrapper → hint and comments
→ tests → regenerate → knip.

### Excluded scope

- Prose docs, skills and the example plan (phase-06).
- Any change to the `agent.extractPlan` config key, which `phax run` keeps
  using.

### Verification

- The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- Confirmation that `phax --usage` no longer lists `extract-plan` and that
  `phax extract-plan` fails as an unknown command.
- The final export list of `src/app/extractPlan.ts`.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(cli)!: remove extract-plan

### Commit body

Remove the standalone extract-plan command and the app wrapper that wrote
phax-plan.json and extract-report.md; phax run keeps extracting inline with
the cache and the model fallback, and phax plans lint is the way to check a
plan. Update the cache-miss hint, the command-list and e2e tests, and
regenerate the usage spec and CLI reference. Implements spec 33 §5.12.

BREAKING CHANGE: `phax extract-plan` no longer exists; use `phax plans lint`
to check a plan, and read a run's phax-plan.json from its run folder.

## phase-06 — Docs, skills and example follow the lint {#phase-06-docs-and-skills}

**Recommended model:** claude-sonnet-5
**Recommended effort:** low

Rewrite every prose mention of `extract-plan` so the documented flow is
write → lint → run (spec §6 README before → after), across the README, the
extraction-model doc, the three shipped skills and the example plan.

### Detailed instructions

- `README.md`: replace the "Extract the plan" section (`:244-249`) with "Lint
  the plan" showing `phax plans lint docs/plans/NN-<slug>-plan.md` and a
  three-line summary of the four checks and the exit code; in "Write a plan"
  (`:239-241`) say the skill defines the format `phax run` extracts and `phax
  plans lint` checks; at `:414` point to the renamed doc below and describe it
  as the model `phax run` uses for the fallback extraction.
- Rename `docs/extract-plan-model.md` to `docs/plan-extraction-model.md` and
  retitle it "Plan extraction model configuration": the precedence chain now
  has two levels (`phax.json` `agent.extractPlan.*`, then the built-in default —
  there is no CLI flag any more), and the text says the extraction runs inside
  `phax run` (and `plans status` / `plans overlap`) on the deterministic-parse
  fallback only. Update any relative link to the old name.
- `.claude/skills/phax-planning/SKILL.md`: frontmatter `description` → "Write
  or review a plan.md that `phax run` extracts and `phax plans lint` checks —
  …"; "What phax expects" (`:9-30`) → `phax run` performs the two-stage
  extraction; add a short "Lint before you run" paragraph right after it
  naming `phax plans lint <plan>` and the four checks, and saying a `Draft`
  plan lints like any other; replace the remaining `phax extract-plan` mentions
  (`:40`, `:85`, `:114`, `:188`, `:447`) with "extraction" / "`phax run`" as
  the sentence needs. Do not touch the spike or gate-profile paragraphs.
- `.claude/skills/phax-cli/SKILL.md:66`: the sentence becomes "`phax run`
  extracts the plan inline; `phax plans lint <plan>` checks a plan's
  structure, planned files and run readiness without running it."; add
  `phax plans lint docs/plans/NN-<slug>-plan.md` to the canonical flow block
  between the plan-authoring comment and `phax run`.
- `.claude/skills/phax-spec/SKILL.md:19`: the pipeline line becomes
  `spec (this skill) → plan.md (phax-planning) → phax plans lint → phax run
  (extraction + gates + reconciliation)`, keeping the caption row aligned.
- `examples/hello-world/plan.md:9`: the note points to `phax plans lint
  plan.md` then `phax run --plan plan.md`.
- Run `pnpm format` so the Markdown tables and wrapped lines stay clean; the
  skills ship in the npm package (`package.json` `files`), so keep their front
  matter valid.

### Planned files to create

- `docs/plan-extraction-model.md`

### Planned files to edit

- `README.md`
- `.claude/skills/phax-planning/SKILL.md`
- `.claude/skills/phax-cli/SKILL.md`
- `.claude/skills/phax-spec/SKILL.md`
- `examples/hello-world/plan.md`

### Optional files that may be edited

- `docs/extract-plan-model.md`

### Boundary contracts

None — documentation only. (`docs/extract-plan-model.md` is listed as optional
because a `git mv` shows as a delete of the old path plus a create of the new
one; the reconciliation reports the delete.)

### Test strategy

No automated tests. `tests/unit/skills/catalog.test.ts` and
`tests/unit/skills/destination.test.ts` keep verifying the skills still resolve;
the gate's format check covers the Markdown.

### Implementation order

README → extraction-model doc rename → the three skills → example plan →
format.

### Excluded scope

- The blog post, the vocabulary review and archived artifacts (kept as dated
  history).
- The stale `fast` gate-profile advice in the planning skill's spike section
  (unrelated to `extract-plan`; separate follow-up).

### Verification

- The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- A grep proof that `extract-plan` no longer appears outside `docs/blog/`,
  `docs/vocabulary-review.md`, `docs/plans/archive/`, `docs/specs/archive/`
  and the spec/plan of this feature.
- Any deviation from the planned file lists, with the reason.

### Commit subject

docs: document the write → lint → run flow and retire extract-plan

### Commit body

Rewrite the README flow around phax plans lint, rename the extraction-model
doc to describe the extraction phax run performs, and update the
phax-planning, phax-cli and phax-spec skills and the hello-world example so
no shipped document tells an agent to run extract-plan. Completes spec 33.
