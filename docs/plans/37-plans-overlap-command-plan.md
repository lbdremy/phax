# Plan — `phax plans-overlap` — report which plans can run in parallel without merge conflict

## Overview

Add a read-only `phax plans-overlap <plan...>` command that takes a list of
`phax-plan.json` paths and reports, deterministically, which plans can be
executed in parallel by phax without colliding when their branches merge back.

The signal is **file-level**: every phase in a `phax-plan.json` already declares
`plannedFilesToCreate`, `plannedFilesToEdit`, and `optionalFilesToEdit`
(`src/schemas/phaxPlan.ts:40-42`), and these arrays are populated by the
extractor today (verified against real run artifacts). The command unions each
plan's phase file-sets into a per-plan **footprint**, intersects footprints
pairwise, and turns the result into a conflict graph: two plans that share no
file are parallel-safe; two plans that share a file are flagged with a severity.
From that graph it reports the clean pairs, the largest fully-disjoint
(parallel-safe) set, and a greedy "wave" schedule.

This is the deterministic version of the manual analysis a developer would
otherwise do by hand across a batch of plans. It is **advisory and read-only** —
it spawns no agent, runs no git, and mutates nothing.

### Input is `phax-plan.json`, not `plan.md`

The structured, schema-validated file lists live in `phax-plan.json` (produced by
`phax extract-plan`), not in the prose `plan.md`. The command therefore consumes
`phax-plan.json` paths and decodes each through the existing
`loadPlan`/`decodePhaxPlan` boundary (`src/app/loadPlan.ts`,
`src/schemas/phaxPlan.ts:82`). To analyse a `plan.md`, the developer runs
`phax extract-plan` first; the command's help and a clear decode error message
point this out. This keeps the analysis deterministic and reuses the validated
schema rather than re-parsing markdown.

### What "conflict" means here (and its honest limits)

The footprint is a **declared** intent, not a guarantee. phax already reconciles
declared vs. actual files after each phase (`src/domain/reconciliation/`) *because*
agents deviate — a phase can touch a file it never listed. So the command answers
"which plans are **declared** conflict-free," not "which provably never
conflict." Two further limits are surfaced in the output rather than hidden:

- **File-level, not hunk-level.** Two plans editing different regions of the same
  file are flagged as a (soft) conflict even though git would often auto-merge
  them. The command over-reports rather than under-reports.
- **Regenerated artifacts are special.** Files like `phax.usage.kdl` and
  `docs/cli/reference.md` are regenerated from the CLI definition; two plans that
  both regenerate them collide on merge even when neither "edits" them by hand.
  These are treated as a distinct hard-conflict class.

These limits are stated in the rendered report so a developer reads the result
as risk guidance, not a proof.

### Command name

Named `plans-overlap` (hyphenated) to match phax's existing CLI house style
(`review-compliance`, `enter-phase`, `publish-pr`, `reset-phase`) and the usage
spec's path convention; a `:`-style name is not used elsewhere in the program.

### Architecture

Layers `cli → app → domain`. The overlap computation is **pure domain** (mirrors
`src/domain/reconciliation/`): it takes a minimal, schema-free input shape and
returns a structured result plus a pure string renderer. The **app** use case
loads each `phax-plan.json` via `loadPlan`, maps the decoded `PhaxPlan` into the
domain input, and calls the engine. The **cli** command parses argv, calls the
use case, and prints the rendered report (or JSON) via `OutputPort` — no business
logic. The domain stays independent of `src/schemas` (the app does the mapping),
exactly as `reconciliation` defines its own `PlannedFiles` type rather than
importing schema types.

### Two modes

The same conflict graph answers two questions, so the command has two modes:

- **Predicted (phases 01–03), declared-vs-declared.** `phax plans-overlap <plan...>`
  intersects the *declared* footprints of all given plans to report which can run
  in parallel.
- **Confirmed (phase-04), actual-vs-declared.** `phax plans-overlap --landed <run> <plan...>`
  takes a run that has already produced changes and reports which of the remaining
  plans need re-adjustment because they touch a file the run *actually* changed.
  The landed run's footprint is read from its persisted
  `global-file-reconciliation.json` (the real `git` diff across its phases), not
  from its declared plan — so it has no false negatives from a phase that touched a
  file it never declared. Severity grades the *kind* of re-adjustment: `hard`
  (regenerated artifact / structural) means regenerate or restructure, `medium`
  (same source file) means rebase and re-verify the plan's line references, `soft`
  (docs) means a trivial textual rebase.

### Interactive follow-through: `adjust-plan` (phases 05–08)

Phases 01–04 are read-only reporters. Phases 05–08 add a **sibling** command,
`phax adjust-plan <plan.md> --landed <run>`, that opens an interactive,
pre-prompted AI session to help a developer adjust the **next plan** after a run
has landed. It reuses the same landed-change facts as the `--landed` mode but,
instead of printing a report, it **opens a session** (via the existing `Session`
port, like `phax enter`) seeded with: the landed run's actual changes, the target
`plan.md` content, and — when a `--plan-json` is supplied — the deterministic
shared-file impact.

The command is a **session-opener, not an editor**. It never mutates the plan
itself. The pre-prompt instructs the agent to:

1. **Establish the drift** the landed run introduced into the target plan (moved
   files, stale line references, decisions invalidated by what actually changed).
2. **Ask clarifying questions** where a call is needed before proposing.
3. **Propose the concrete changes** to the plan and **declare their impact**.
4. **Wait for the developer's explicit approval** — it is not a gate and applies
   nothing unprompted.
5. **Only after approval**, edit the `plan.md` and commit the changes with a clear
   message.

Re-invoking resumes the same session (a persisted session record) unless
`--new-session` is passed. The session machinery is **self-contained in plan 37**
(its own session-record schema, pre-prompt builder, and pre-prompted invocation
on the `Session` port); the overlap with plan 36 (`review-code`) is noted for
later consolidation but creates no ordering dependency. As with `review-code`,
only Claude Code gets a working pre-prompted start in this plan (the deterministic
`--session-id` resume design is Claude-specific); codex/mistral return a precise
`unsupported` refusal.

## Required commands

- pnpm gen:usage-spec
- pnpm docs:cli

These two regenerate the derived CLI artifacts (`phax.usage.kdl`,
`docs/cli/reference.md`, and the README CLI section) after the new command is
registered. They are **not** part of any `phax.json` gate profile and `pnpm` is
not in `security.agentCommands`, so they must be declared here and allowed before
running. All other commands the phases use (`pnpm typecheck`, `pnpm test`,
`pnpm knip`, `pnpm build`, etc.) are already covered as gate commands.

## Required PHAX security configuration changes

This plan requires the following commands to be added to `security.agentCommands`
in `phax.json` before running:

- `pnpm gen:usage-spec`
- `pnpm docs:cli`

(Alternatively, add the broad token `pnpm` to cover all `pnpm` sub-commands.)
Without this configuration the preflight check will fail before any agent spawns.

---

## phase-01 — Plan-overlap domain engine {#phase-01-domain-engine}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Add the pure domain that turns a set of plan footprints into a conflict graph,
the parallel-safe groupings, and a human-readable report. No I/O, no schema
coupling.

### Detailed instructions

- Create `src/domain/planOverlap/types.ts` with schema-free shapes:
  - `PlanFileSets { readonly create: readonly string[]; readonly edit: readonly string[]; readonly optional: readonly string[] }`.
  - `PlanInput { readonly id: string; readonly label: string; readonly phases: readonly PlanFileSets[] }`
    — `id` is a stable key (the plan path or short name), `label` is what the
    report prints.
  - `PlanFootprint { readonly id: string; readonly label: string; readonly create: ReadonlySet<string>; readonly edit: ReadonlySet<string>; readonly optional: ReadonlySet<string>; readonly all: ReadonlySet<string> }`
    — `all` is the union used for intersection.
  - `ConflictSeverity = "hard" | "medium" | "soft"`.
  - `SharedFile { readonly path: string; readonly severity: ConflictSeverity; readonly reason: string }`.
  - `OverlapEdge { readonly a: string; readonly b: string; readonly shared: readonly SharedFile[]; readonly severity: ConflictSeverity }`
    (edge severity = the max severity among its `shared` files).
  - `PlanOverlapResult { readonly footprints: readonly PlanFootprint[]; readonly edges: readonly OverlapEdge[]; readonly cleanPairs: readonly (readonly [string, string])[]; readonly largestParallelSafeSet: readonly string[]; readonly waves: readonly (readonly string[])[]; readonly exhaustiveSearchSkipped: boolean }`.
- Create `src/domain/planOverlap/generatedArtifacts.ts` exporting
  `REGENERATED_ARTIFACTS: ReadonlySet<string>` = `{ "phax.usage.kdl", "docs/cli/reference.md" }`
  with a comment that these are derived from the CLI definition and collide on
  merge when two plans both regenerate them. Keep the set small and named so it is
  easy to extend.
- Create `src/domain/planOverlap/compute.ts`:
  - `buildFootprint(input: PlanInput): PlanFootprint` — union the phase file-sets
    into `create`/`edit`/`optional` sets (a path that appears in both create and
    edit across phases counts in both), and `all = create ∪ edit ∪ optional`.
  - `classifyShared(path, a, b): SharedFile` — deterministic severity ladder:
    - `hard` when `path ∈ REGENERATED_ARTIFACTS`, OR both footprints `create` it,
      OR one `create`s and the other `edit`s it (a create-vs-edit structural
      clash). `reason` names which.
    - `medium` when both `edit` it and it is **not** a `.md` file (source-file
      hunk-overlap risk).
    - `soft` when it is a `.md` file not in `REGENERATED_ARTIFACTS`, or it is
      shared only via the `optional` lists (prose/optional — usually auto-merges).
  - `computePlanOverlap(inputs: readonly PlanInput[]): PlanOverlapResult`:
    1. `footprints = inputs.map(buildFootprint)`.
    2. For each unordered pair, compute the intersection of their `all` sets; for
       each shared path build a `SharedFile`; if non-empty, emit an `OverlapEdge`
       (severity = max of its shared files) — otherwise record the pair in
       `cleanPairs`. Iterate pairs in input order so output is stable.
    3. `largestParallelSafeSet` = the largest subset of plan ids with **no** edge
       among them (treat any edge as a conflict regardless of severity — strict).
       Compute by brute force over subsets. **Guard:** when `inputs.length > 16`,
       skip the exhaustive search, set `exhaustiveSearchSkipped: true`, and return
       an empty `largestParallelSafeSet` (the waves still give a usable schedule).
    4. `waves` = a greedy graph-colouring schedule: walking plans in input order,
       place each into the first wave containing no plan it shares a file with.
       Deterministic; every plan lands in exactly one wave.
  - Order all id comparisons by the input order, never by `Set` iteration order,
    so the function is referentially stable.
- Create `src/domain/planOverlap/render.ts` exporting
  `renderPlanOverlap(result: PlanOverlapResult): string` — a pure multi-line
  report: a footprint summary (id → file count), the pairwise matrix
  (`A <-> B: clean` or `A <-> B: <severity> -> file1, file2`), the clean pairs,
  the largest parallel-safe set (or a note when `exhaustiveSearchSkipped`), the
  greedy wave schedule, and a short trailing caveat block stating the
  declared-not-guaranteed, file-level-not-hunk-level, and regenerated-artifact
  limits. Keep it pure (no `Date`, no I/O).

### Planned files to create

- `src/domain/planOverlap/types.ts`
- `src/domain/planOverlap/generatedArtifacts.ts`
- `src/domain/planOverlap/compute.ts`
- `src/domain/planOverlap/render.ts`
- `tests/unit/planOverlap/compute.test.ts`
- `tests/unit/planOverlap/render.test.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- (none)

### Boundary contracts

Producer: `src/domain/planOverlap/` provides `buildFootprint`,
`computePlanOverlap`, and `renderPlanOverlap` over the schema-free `PlanInput`
shape. Consumer: the phase-02 use case maps decoded `PhaxPlan` values into
`PlanInput` and calls the engine. The stable contract is `PlanInput` in,
`PlanOverlapResult` (+ rendered string) out; the domain never imports from
`src/schemas`.

### Test strategy

Domain unit tests (write before implementation):

- `computePlanOverlap` with two disjoint plans → no edge, both in `cleanPairs`,
  `largestParallelSafeSet` has both, two single-plan waves collapse to one wave.
- Two plans sharing a `.ts` file both `edit` → one `medium` edge, not in
  `cleanPairs`, waves place them in separate waves.
- Two plans both listing `phax.usage.kdl` → `hard` edge with the
  regenerated-artifact reason.
- Create-vs-create and create-vs-edit on the same path → `hard`.
- Shared `README.md` (both edit) → `soft`.
- A four-plan set reproducing the 33/34/35/36 shape (use small synthetic inputs)
  → assert the expected clean pairs and that `largestParallelSafeSet` has size 2.
- The `> 16` guard → `exhaustiveSearchSkipped: true`, empty
  `largestParallelSafeSet`, waves still cover every plan.
- `renderPlanOverlap` includes each plan label, the matrix lines, and the caveat
  block; stable output for fixed input.

### Implementation order

`types.ts` and `generatedArtifacts.ts`, then `compute.ts` (footprint → pairwise →
independent set → waves) with its unit test, then `render.ts` with its test.

### Excluded scope

- Reading any file or decoding `phax-plan.json` (phase-02).
- The CLI command, registration, and docs (phase-03).
- Any severity-threshold/`--ignore` filtering — the engine reports all severities;
  consumers decide.

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The final `PlanInput` / `PlanFootprint` / `PlanOverlapResult` shapes and the
  three exported function names (`buildFootprint`, `computePlanOverlap`,
  `renderPlanOverlap`).
- The exact severity ladder used by `classifyShared` and the contents of
  `REGENERATED_ARTIFACTS`.
- The `> 16` exhaustive-search guard behaviour.
- Confirmation the domain imports nothing from `src/schemas`.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(domain): add plan-overlap computation engine

### Commit body

Add a pure domain module that unions each plan's declared phase file-sets into a
footprint, intersects footprints pairwise into a severity-graded conflict graph,
and derives the clean pairs, the largest fully-disjoint parallel-safe set, and a
greedy wave schedule, plus a pure report renderer. Regenerated artifacts
(phax.usage.kdl, docs/cli/reference.md) are a distinct hard-conflict class.
Schema-free (PlanInput in, PlanOverlapResult out). Covered by unit tests for the
severity ladder, clean/conflicting pairs, the independent-set search, and the
large-input guard.

---

## phase-02 — `analyzePlanOverlap` application use case {#phase-02-use-case}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low

Add the application use case that loads the given `phax-plan.json` paths, maps
each decoded plan into the domain input, and returns the overlap result (or a
clear load/decode error), so the CLI stays thin.

### Detailed instructions

- Create `src/app/analyzePlanOverlap.ts` exporting
  `analyzePlanOverlap(planPaths: readonly string[]): Either.Either<PlanOverlapResult, AnalyzePlanOverlapError>`:
  - Define `AnalyzePlanOverlapError` as a tagged error (mirror
    `PlanValidationError` usage in `loadPlan.ts`) carrying a `message`. Reuse
    `PlanValidationError` for per-file load failures and aggregate them.
  - Require at least two paths; if fewer, return a `Left` with a message that the
    command compares two or more plans.
  - For each path, call `loadPlan(path)` (`src/app/loadPlan.ts`). Collect every
    `Left`; if any path failed, return a single `Left` whose message lists each
    failing path and its decode error (so the user fixes all at once). The message
    for a decode failure should hint that the input must be a `phax-plan.json`
    (run `phax extract-plan` on a `plan.md` first).
  - Map each decoded `PhaxPlan` to a `PlanInput`: `id = path`,
    `label = `${plan.run.shortName} (${path})``,
    `phases = plan.phases.map(p => ({ create: p.plannedFilesToCreate, edit: p.plannedFilesToEdit, optional: p.optionalFilesToEdit }))`.
  - Guard against duplicate ids (same path passed twice) by de-duplicating on the
    resolved path, or returning a clear error — pick one and document it.
  - Call `computePlanOverlap(inputs)` and return `Right`.
- Keep the use case synchronous and `Either`-returning, exactly like `loadPlan`
  (which reads via `node:fs` directly); no `FileSystem` port or `Effect` is
  introduced, consistent with the existing plan/config loaders.

### Planned files to create

- `src/app/analyzePlanOverlap.ts`
- `tests/integration/analyzePlanOverlap.test.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- (none)

### Boundary contracts

Consumer/producer: the use case consumes a list of `phax-plan.json` paths, uses
`loadPlan` (which owns decode/validation) to produce `PhaxPlan` values, maps them
to the domain `PlanInput`, and produces a `PlanOverlapResult` for the CLI. It
depends only on `loadPlan` and the phase-01 domain engine; it performs no
rendering and spawns nothing.

### Test strategy

Integration tests (write the core cases before implementation), writing temporary
`phax-plan.json` fixtures to a temp dir (as the `extractPlan` integration tests
do) and asserting the returned `PlanOverlapResult`:

- Two valid plans with disjoint footprints → `Right`, both in `cleanPairs`.
- Two valid plans sharing a source file → `Right`, one edge of the expected
  severity.
- A non-existent path or a malformed/`onExcessProperty` JSON → `Left` whose
  message names the offending path and mentions `phax extract-plan`.
- Fewer than two paths → `Left` with the "two or more plans" message.
- The label carries the run short name and the path.

### Implementation order

Define the error and the load-and-aggregate loop, then the `PhaxPlan → PlanInput`
mapping, then call the engine; write the fixture-based integration test alongside.

### Excluded scope

- The conflict computation itself (phase-01).
- argv parsing, rendering, registration, and docs (phase-03).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The `analyzePlanOverlap` signature, the `AnalyzePlanOverlapError` shape, and how
  multiple load failures are aggregated into one message.
- The exact `PhaxPlan → PlanInput` mapping (label format, how phases map).
- The duplicate-path handling decision.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(app): add analyzePlanOverlap use case over phax-plan.json paths

### Commit body

Add analyzePlanOverlap, which loads the given phax-plan.json paths via loadPlan,
maps each decoded plan's phase file lists into the domain PlanInput, and returns
the PlanOverlapResult or an aggregated load/decode error that points malformed
inputs at phax extract-plan. Synchronous and Either-returning like the existing
plan/config loaders; no new port. Covered by integration tests over temp plan
fixtures for the disjoint, conflicting, malformed, and too-few-inputs cases.

---

## phase-03 — `plans-overlap` CLI command, registration, and usage spec {#phase-03-cli-command}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Wire the command surface: parse the variadic plan paths, call the use case, print
the rendered report (or JSON), register the command, document it, and regenerate
the derived CLI artifacts.

### Detailed instructions

- Create `src/cli/commands/plansOverlap.ts` exporting
  `runPlansOverlap(planPaths: string[], opts: { json?: boolean }, out: OutputPort): Promise<number>`
  (model on the thin command style of `src/cli/commands/reviewCompliance.ts`):
  - Call `analyzePlanOverlap(planPaths)`. On `Left`, `out.error(left.message)` and
    return `1`.
  - On `Right`: when `opts.json`, `out.log(JSON.stringify(result, replacer))`
    (convert the `Set` fields to arrays via a replacer or a small `toJSON` mapper);
    otherwise `out.log(renderPlanOverlap(result))`. Return `0`.
  - No business logic in the command — loading, mapping, and computation all live
    below it.
- Register in `src/cli/program.ts` after the `review-compliance` command:
  ```ts
  program
    .command("plans-overlap")
    .description("Report which plans can run in parallel without merge conflict")
    .argument("<plan...>", "Paths to two or more phax-plan.json files")
    .option("--json", "Emit the overlap result as JSON instead of a report")
    .action(async (plans: string[], opts: { json?: boolean }) => {
      const exitCode = await runPlansOverlap(plans, opts, consoleOutput);
      process.exit(exitCode);
    });
  ```
  Add the matching `import { runPlansOverlap } from "./commands/plansOverlap.js";`.
- Add a `"plans-overlap"` entry to `src/cli/cliDocs.ts` (the single source of
  truth the help output and the usage-spec generator both read): a `longHelp`
  describing the read-only file-level analysis, that input is `phax-plan.json`
  (run `phax extract-plan` on a `plan.md` first), and the
  declared-not-guaranteed / file-level / regenerated-artifact caveats, plus a
  "Side effects: none (read-only; spawns no agent, runs no git)." line; and
  `examples: ["phax plans-overlap a/phax-plan.json b/phax-plan.json"]`.
- Regenerate the derived artifacts, in order: `pnpm gen:usage-spec` (rewrites
  `phax.usage.kdl` from the Commander program + `cliDocs`), then `pnpm docs:cli`
  (rewrites `docs/cli/reference.md` and the README CLI section between the
  `<!-- BEGIN GENERATED CLI REFERENCE -->` / `<!-- END GENERATED CLI REFERENCE -->`
  markers). Do **not** hand-edit those three outputs.
- Update `tests/integration/cliProgram.test.ts`: add `"plans-overlap"` to the
  `TOP_LEVEL_COMMANDS` array (the exact-length assertion at the end of the file
  makes this mandatory).

### Planned files to create

- `src/cli/commands/plansOverlap.ts`
- `tests/integration/plansOverlapCommand.test.ts`

### Planned files to edit

- `src/cli/program.ts`
- `src/cli/cliDocs.ts`
- `tests/integration/cliProgram.test.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`
- `README.md`

### Optional files that may be edited

- `docs/cli/inventory.md`

### Boundary contracts

Consumer (cli) → producer (app): the command calls `analyzePlanOverlap` and
renders its `PlanOverlapResult` via `renderPlanOverlap` (or JSON) through
`OutputPort`. The command contains no business logic. `phax.usage.kdl`,
`docs/cli/reference.md`, and the README CLI section are derived from the Commander
program + `cliDocs` and must be regenerated, not hand-written; the
`usageSpecDrift` gate enforces byte-identity.

### Test strategy

CLI/route layer integration test `tests/integration/plansOverlapCommand.test.ts`
with a fake `OutputPort` (capture `log`/`error`) and temp `phax-plan.json`
fixtures:

- Two disjoint plans → exit `0` and the captured report names both plans and the
  parallel-safe set.
- Two conflicting plans → exit `0` and the report shows the shared file and
  severity.
- A malformed/missing path → exit `1` and the error mentions the path.
- `--json` → exit `0` and the captured output parses as JSON with `edges` /
  `cleanPairs` / `waves` keys (Sets emitted as arrays).
- Fewer than two paths → exit `1`.

Extend `tests/integration/cliProgram.test.ts` to assert the `plans-overlap`
command is registered with a variadic `<plan...>` argument and the `--json` flag.
`tests/integration/usageSpecDrift.test.ts` (in the `full` gate) verifies the
regenerated `phax.usage.kdl` matches the program.

### Implementation order

Command file → `cliDocs` entry → `program.ts` registration → regenerate
`phax.usage.kdl` (`pnpm gen:usage-spec`) then the docs (`pnpm docs:cli`) → update
`cliProgram.test.ts` → write the command integration test → run the `full` gate.

### Excluded scope

- Any change to other commands' behaviour or signatures.
- Hand-editing the generated artifacts (`phax.usage.kdl`,
  `docs/cli/reference.md`, README CLI section) instead of regenerating them.
- Auto-orchestrating parallel runs from the result — this command only reports.
- A severity-threshold filter flag — `--json` is the only option in this plan.

### Verification

- The project's configured `full` gate profile in `phax.json` — notably
  `pnpm test` (which runs `cliProgram.test.ts` and `usageSpecDrift.test.ts`),
  `pnpm knip`, `pnpm typecheck`, and the `usage`/spec-lint checks that read
  `phax.usage.kdl`.

### Expected handoff content

- The `runPlansOverlap` signature and `opts` shape, and the exit-code contract.
- The registered command name, description, the `<plan...>` argument, the `--json`
  flag, and the `cliDocs` key added.
- Confirmation that `phax.usage.kdl`, `docs/cli/reference.md`, and the README CLI
  section were regenerated (not hand-edited) via `pnpm gen:usage-spec` and
  `pnpm docs:cli`, and that `usageSpecDrift.test.ts` passes.
- The updated `TOP_LEVEL_COMMANDS` list and whether `docs/cli/inventory.md` was
  touched.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(cli): add plans-overlap command

### Commit body

Add `phax plans-overlap <plan...>`, a read-only command that reports which of the
given phax-plan.json files can run in parallel without merge conflict. It loads
each plan via analyzePlanOverlap, prints the severity-graded conflict matrix, the
clean pairs, the largest parallel-safe set, and a greedy wave schedule (or JSON
with --json). Registers the command, documents it in cliDocs, and regenerates
phax.usage.kdl, docs/cli/reference.md, and the README CLI section; updates the
cliProgram command-set test. Covered by a command integration test over temp plan
fixtures.

---

## phase-04 — `--landed` re-adjustment impact mode {#phase-04-landed-impact}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Add a `--landed <run>` mode to `plans-overlap` that reports which of the remaining
plans need re-adjustment after a run has actually changed files. The landed run's
footprint comes from its persisted `global-file-reconciliation.json` (the real git
diff across its phases), giving an actual-vs-declared impact list with no false
negatives from undeclared touches.

### Detailed instructions

- **Schema (boundary).** Add a decode schema for the persisted
  `global-file-reconciliation.json` if one does not already exist — search first;
  reuse it if it does. Create `src/schemas/globalReconciliation.ts` with a
  `Schema.Struct` mirroring the domain `GlobalFileReconciliation` /
  `GlobalFileEntry` shapes (`src/domain/reconciliation/global.ts`): `files` is an
  array of entries with `path`, `touchedInPhases`, `actualActions`
  (`"added" | "modified" | "deleted" | "renamed"`), and the boolean/status fields.
  Export `decodeGlobalFileReconciliation` (`Schema.decodeUnknownEither`). Per the
  validation-boundary rule, the persisted JSON must be decoded through a schema
  before it enters the domain — do not `JSON.parse` it raw in the use case.
- **Domain — landed footprint.** In `src/domain/planOverlap/compute.ts`, add
  `buildLandedFootprint(input: LandedInput): PlanFootprint`, where `LandedInput`
  (new type in `types.ts`) carries `{ id; label; added: readonly string[]; modified: readonly string[]; deletedOrRenamed: readonly string[] }`.
  Map `added → create`, `modified → edit`, `deletedOrRenamed → edit` (a delete or
  rename still "touches" the path for collision purposes) so the existing
  `classifyShared` severity ladder applies unchanged (regenerated artifact and
  create/edit clashes still grade as `hard`).
- **Domain — impact.** Add
  `computeReadjustmentImpact(landed: PlanFootprint, others: readonly PlanFootprint[]): ReadjustmentImpactResult`
  to `compute.ts`. For each `other`, intersect `landed.all ∩ other.all`; emit an
  `ImpactedPlan { id; label; shared: readonly SharedFile[]; severity }` (severity =
  max over shared files) for every plan with a non-empty intersection; plans with
  no intersection are reported as `unaffected` (ids only). `ReadjustmentImpactResult`
  (new type in `types.ts`): `{ landedLabel: string; impacted: readonly ImpactedPlan[]; unaffected: readonly string[] }`,
  with `impacted` ordered by descending severity then input order.
- **Domain — render.** In `src/domain/planOverlap/render.ts`, add
  `renderReadjustmentImpact(result: ReadjustmentImpactResult): string` — a pure
  report naming the landed run, then for each impacted plan its shared files +
  severity + the severity's meaning (regenerate/restructure, rebase + re-verify
  line refs, trivial textual rebase), then the unaffected list, then a one-line
  caveat that this is the run's *actual* changed files vs the others' *declared*
  footprints.
- **App.** In `src/app/analyzePlanOverlap.ts`, add
  `analyzeReadjustmentImpact(runPath: string, planPaths: readonly string[]): Either.Either<ReadjustmentImpactResult, AnalyzePlanOverlapError>`:
  - Read `join(runPath, "global-file-reconciliation.json")` and decode via
    `decodeGlobalFileReconciliation`. If the file is absent, return a `Left` whose
    message explains the run has not produced a reconciliation yet (it must have
    reached review); if it fails to decode, name the path.
  - Derive the `LandedInput` from the decoded entries: `added` = paths whose
    `actualActions` include `"added"`, `modified` = those including `"modified"`,
    `deletedOrRenamed` = those including `"deleted"` or `"renamed"`. `label` = the
    run folder name.
  - Load each plan path via `loadPlan` and map to `PlanInput`/`PlanFootprint` as in
    `analyzePlanOverlap` (factor the per-path load-and-map into a shared helper so
    both functions reuse it). Aggregate load failures the same way.
  - Call `buildLandedFootprint` + `computeReadjustmentImpact` and return `Right`.
- **CLI.** In `src/cli/commands/plansOverlap.ts`, accept `opts.landed?: string`.
  When set: load config (`loadConfig(process.cwd())`), resolve the run via
  `resolveRun`/`resolveRunRef` (as `reviewCompliance.ts` does) to get its
  `runPath`, call `analyzeReadjustmentImpact(runPath, planPaths)`, and print
  `renderReadjustmentImpact` (or JSON under `--json`). When `opts.landed` is absent,
  keep the existing predicted-mode path unchanged. Resolution/config errors print
  and return `1`.
- **Registration.** In `src/cli/program.ts`, add
  `.option("--landed <run>", "Report which of the given plans need re-adjustment after this run's actual changes")`
  to the `plans-overlap` command. Update the `src/cli/cliDocs.ts` entry's
  `longHelp` to describe both modes and add an example
  `phax plans-overlap --landed my-feature other/phax-plan.json`.
- **Regenerate** `phax.usage.kdl` (`pnpm gen:usage-spec`) then
  `docs/cli/reference.md` + README (`pnpm docs:cli`); do not hand-edit them.
- Update `tests/integration/cliProgram.test.ts` to assert the `--landed` flag is
  registered (the command itself already counts in `TOP_LEVEL_COMMANDS` from
  phase-03; no length change).

### Planned files to create

- `src/schemas/globalReconciliation.ts`
- `tests/unit/globalReconciliation.test.ts`
- `tests/unit/planOverlap/impact.test.ts`
- `tests/integration/plansOverlapLanded.test.ts`

### Planned files to edit

- `src/domain/planOverlap/types.ts`
- `src/domain/planOverlap/compute.ts`
- `src/domain/planOverlap/render.ts`
- `src/app/analyzePlanOverlap.ts`
- `src/cli/commands/plansOverlap.ts`
- `src/cli/program.ts`
- `src/cli/cliDocs.ts`
- `tests/integration/cliProgram.test.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`
- `README.md`

### Optional files that may be edited

- `tests/integration/analyzePlanOverlap.test.ts`
- `docs/cli/inventory.md`

### Boundary contracts

Validation boundary: `src/schemas/globalReconciliation.ts` decodes the persisted
`global-file-reconciliation.json` into a validated shape before it reaches the
domain. Consumer/producer: the app reads that artifact + the remaining
`phax-plan.json` files, derives a landed footprint and declared footprints, and
the domain `computeReadjustmentImpact` produces the impact result the CLI renders.
The domain still imports nothing from `src/schemas` — `analyzeReadjustmentImpact`
maps the decoded reconciliation into the schema-free `LandedInput`.

### Test strategy

- Schema unit test (`tests/unit/globalReconciliation.test.ts`, before
  implementation): a representative `global-file-reconciliation.json` decodes; an
  unknown field or missing required field fails.
- Domain unit tests (`tests/unit/planOverlap/impact.test.ts`, before
  implementation): a landed footprint sharing a `.ts` file with one of two plans →
  that plan is `impacted` (`medium`), the other `unaffected`; a landed `added`
  path that another plan also creates → `hard`; a landed `phax.usage.kdl` change →
  `hard` for any plan that regenerates it; `impacted` ordered by descending
  severity.
- Integration (`tests/integration/plansOverlapLanded.test.ts`): seed a temp run
  folder with a `global-file-reconciliation.json` and temp `phax-plan.json`
  fixtures; assert the command resolves the run, returns exit `0`, and the report
  lists the impacted plans with the right shared files; a run folder lacking the
  reconciliation file → exit `1` with the explanatory message; `--json` emits a
  parseable object with `impacted` / `unaffected`.
- Extend `cliProgram.test.ts` for the `--landed` flag.

### Implementation order

Schema + its decode test → domain `LandedInput`/`buildLandedFootprint`/
`computeReadjustmentImpact`/render + unit tests → app
`analyzeReadjustmentImpact` (factoring the shared per-path loader) → CLI `--landed`
branch and run resolution → registration + cliDocs → regenerate the derived
artifacts → integration test → `full` gate.

### Excluded scope

- Auto-rebasing or auto-editing the impacted plans — this mode only reports.
- Re-running reconciliation; it reads the already-persisted
  `global-file-reconciliation.json` and never invokes git.
- Hand-editing the generated artifacts instead of regenerating them.
- Supporting a run that has not yet produced a reconciliation (reported as a clean
  error, not handled).

### Verification

- The project's configured `full` gate profile in `phax.json` — notably
  `pnpm test` (`cliProgram.test.ts`, `usageSpecDrift.test.ts`), `pnpm knip`,
  `pnpm typecheck`, and the `usage`/spec-lint checks.

### Expected handoff content

- Whether a `global-file-reconciliation.json` decode schema already existed or was
  added, and its exported decoder name.
- The `LandedInput` shape, the `added/modified/deletedOrRenamed → create/edit`
  mapping, and the `analyzeReadjustmentImpact` signature.
- The `--landed` resolution path (config load → `resolveRun` → `runPath`) and the
  error message when the reconciliation artifact is absent.
- Confirmation the derived artifacts were regenerated and `usageSpecDrift.test.ts`
  passes, and that `TOP_LEVEL_COMMANDS` did not change (only a flag was added).
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(cli): add --landed re-adjustment impact mode to plans-overlap

### Commit body

Add `phax plans-overlap --landed <run> <plan...>`, which reports which of the
given plans need re-adjustment after a run's actual changes. The landed run's
footprint is read from its persisted global-file-reconciliation.json (the real git
diff across phases) via a new decode schema, then intersected against the
remaining plans' declared footprints and graded by severity, so the result is
actual-vs-declared with no false negatives from undeclared touches. Adds the
schema, the domain landed-footprint + impact computation and renderer, the
analyzeReadjustmentImpact use case, and the CLI flag; regenerates the derived CLI
artifacts. Covered by schema, domain, and command tests.

---

## phase-05 — adjust-plan session record schema and drift pre-prompt builder {#phase-05-adjust-schema-prompt}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Add the persisted session-record schema that lets `adjust-plan` resume its own
interactive session, and the pure builder that assembles the drift/proposal
pre-prompt from the landed changes, the target plan, and (optionally) the
deterministic impact.

### Detailed instructions

- Create `src/schemas/adjustPlanSession.ts` with a `Schema.Struct`
  `AdjustPlanSessionSchema` and `decodeAdjustPlanSession`
  (`Schema.decodeUnknownEither`, `onExcessProperty: "error"`) plus
  `encodeAdjustPlanSession` (`Schema.encodeSync`). Fields, all required (no
  optional-for-back-compat fields, per the project rule):
  - `version: Schema.Literal(1)`
  - `planPath: Schema.NonEmptyString` (the target `plan.md`, as given)
  - `landedRunKey: Schema.NonEmptyString` (the landed run's `namespace.shortName`)
  - `provider`: the same provider literal union used in
    `src/schemas/phaseAgentBinding.ts` (`"claude-code" | "codex-cli" | "mistral-vibe"`)
  - `sessionId: Schema.NonEmptyString`
  - `cwd: Schema.NonEmptyString` (repo root the session runs in)
  - `createdAt: Schema.NonEmptyString` / `updatedAt: Schema.NonEmptyString` (ISO)
  Export the inferred type.
- Create `src/domain/planOverlap/adjustPrompt.ts` (pure, no I/O / `Date` / random):
  - `ADJUST_PLAN_PROMPT_FILENAME = "adjust-plan-prompt.md"`.
  - `buildAdjustPlanPrompt(input): string` — the full pre-prompt. `input`:
    ```ts
    {
      readonly planPath: string;
      readonly planMarkdown: string;            // full target plan.md content
      readonly landedLabel: string;             // landed run label
      readonly landedChanges: {                 // from global reconciliation
        readonly added: readonly string[];
        readonly modified: readonly string[];
        readonly deletedOrRenamed: readonly string[];
      };
      readonly impact?: {                        // present only with --plan-json
        readonly shared: ReadonlyArray<{ path: string; severity: string; reason: string }>;
        readonly severity: string;
      };
    }
    ```
    The prompt must, in order:
    1. Frame the session as an **interactive plan adjustment** the developer will
       drive — explicitly NOT a gate, and nothing is applied without approval.
    2. Present the landed run's **actual changes** (`landedChanges`) as ground
       truth, and the **target plan** (its path + that its full text follows).
    3. Instruct the agent to **establish the drift**: which of the plan's declared
       `Planned files to create/edit`, line-number references, and decisions are
       invalidated or moved by the landed changes. When `impact` is present, seed
       it as the precise deterministic shared-file/severity list to start from.
    4. Instruct the agent to **ask clarifying questions** where a call is needed
       before proposing.
    5. Instruct the agent to **propose the concrete edits** to `<planPath>` and
       **declare the impact** of those edits, then **wait for the developer's
       explicit approval**.
    6. State that **only after approval** the agent edits `<planPath>` and commits
       the change with a clear conventional-commit message — and that the edit and
       commit happen interactively within this session, never pre-emptively.
    7. Append the full `planMarkdown` under a clear delimiter.
  - `buildAdjustPlanPositionalPrompt(promptFilePath: string): string` — the short
    argv pointer, e.g. "Read `<promptFilePath>` and begin the plan adjustment it
    describes. Do not propose or change anything until you have read it."
- Keep both functions pure; the caller supplies all text.

### Planned files to create

- `src/schemas/adjustPlanSession.ts`
- `src/domain/planOverlap/adjustPrompt.ts`
- `tests/unit/adjustPlanSession.test.ts`
- `tests/unit/planOverlap/adjustPrompt.test.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- (none)

### Boundary contracts

Producer: `adjustPlanSession.ts` provides a validated session-record shape;
`adjustPrompt.ts` provides the two prompt strings. Consumer: the phase-07 use case
persists/decodes the record and writes the full prompt to a file. Stable shapes:
the field set above and the `buildAdjustPlanPrompt` input object.

### Test strategy

- Unit (before implementation) `decodeAdjustPlanSession`: a full record decodes; a
  missing required field fails; an unknown key fails.
- Unit `buildAdjustPlanPrompt`: with no `impact`, the output names the plan path,
  lists the landed added/modified/deleted paths, includes the
  establish-drift / ask-questions / propose / wait-for-approval / apply-only-after-
  approval instructions, and embeds the plan markdown; with an `impact` block, it
  also lists the shared files and severity. `buildAdjustPlanPositionalPrompt`
  returns a non-empty instruction containing the file path.

### Implementation order

Schema first, then the positional-pointer helper, then the full-prompt assembler.

### Excluded scope

- Reading any file, resolving the run, generating the session id, or spawning
  anything (phases 06–08).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The final `AdjustPlanSessionSchema` field list and the decoder/encoder names.
- The `buildAdjustPlanPrompt` input shape, the two exported function names, and
  `ADJUST_PLAN_PROMPT_FILENAME`.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(schemas): add adjust-plan session record and drift pre-prompt builder

### Commit body

Add AdjustPlanSessionSchema (persisted record for the adjust-plan interactive
session) and a pure builder that assembles the drift/proposal pre-prompt from the
landed run's actual changes, the target plan.md, and an optional deterministic
impact block, plus the short positional pointer. The prompt drives the agent to
establish drift, ask questions, propose changes and wait for approval, and only
then edit and commit the plan within the session. Covered by unit tests for
decode and the with/without-impact prompt cases.

---

## phase-06 — Pre-prompted session invocation in the session adapters {#phase-06-session-invocation}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low

Teach the session adapters to build a pre-prompted interactive invocation — start
a new session with a fixed id and an initial prompt, or resume an existing one.

### Detailed instructions

- Extend `src/domain/session/types.ts`: add to `SessionAdapter`:
  ```ts
  buildPrePromptedInvocation(opts: {
    readonly cwd: string;
    readonly sessionId: string;
    readonly initialPrompt: string | null; // null => resume; string => start new
    readonly model?: string;
    readonly effort?: string;
  }): ResumeInvocation;
  ```
  Reuse the existing `ResumeInvocation` union. (Generic name on purpose: plan 36's
  `review-code` needs the same capability and can adopt this rather than adding a
  parallel `buildReviewInvocation` — noted, not required here.)
- Implement in `src/domain/session/claude.ts`, conditionally appending
  `--model`/`--effort` when provided (mirror the headless arg-building in
  `src/infra/providers/claudeCode.ts`):
  - Resume (`initialPrompt === null`):
    `{ executable: "claude", args: ["--resume", sessionId, ...(model ? ["--model", model] : []), ...(effort ? ["--effort", effort] : [])], cwd }`.
  - New (`initialPrompt` is a string):
    `{ executable: "claude", args: ["--session-id", sessionId, ...(model ? ["--model", model] : []), ...(effort ? ["--effort", effort] : []), initialPrompt], cwd }`.
- Implement in `src/domain/session/codex.ts` and `src/domain/session/mistral.ts`:
  return `{ unsupported: "<provider> does not support a pre-prompted interactive session yet; run `phax enter <short-name>` instead." }` for the **new** case; for the resume case, delegate to their existing `--resume` logic if they capture a session id, otherwise return an `unsupported` refusal consistent with `buildResumeInvocation`.
- Leave `buildResumeInvocation` and `describe` untouched.

### Planned files to create

- (none)

### Planned files to edit

- `src/domain/session/types.ts`
- `src/domain/session/claude.ts`
- `src/domain/session/codex.ts`
- `src/domain/session/mistral.ts`
- `tests/unit/sessionAdapters.test.ts`

### Optional files that may be edited

- (none)

### Boundary contracts

Producer: each `SessionAdapter` now provides `buildPrePromptedInvocation`.
Consumer: the phase-07 use case calls it via `getSessionAdapter(provider)`. Stable
shape: the `ResumeInvocation` union — an `{ executable, args, cwd }` to spawn or an
`{ unsupported }` refusal the use case turns into a clean error.

### Test strategy

- Unit (before implementation) in `tests/unit/sessionAdapters.test.ts`:
  - claude new: asserts `--session-id <id>`, the `--model`/`--effort` flags when
    provided, the positional prompt, and `cwd`.
  - claude resume without overrides: `["--resume", <id>]`, no `--model`/`--effort`,
    no positional prompt.
  - claude resume with a model override: `--model <m>` follows `--resume <id>`.
  - codex/mistral new: an `unsupported` refusal.

### Implementation order

Interface in `types.ts`, then claude, then codex/mistral.

### Excluded scope

- The prompt content (phase-05) and the use case / persistence (phase-07).
- Full pre-prompted support for codex/mistral.

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The final `buildPrePromptedInvocation` signature and the exact claude argv for
  the new and resume cases (flag positions; resume emits `--model`/`--effort` only
  when explicitly passed).
- The exact `unsupported` message for codex/mistral.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(session): add buildPrePromptedInvocation to session adapters

### Commit body

Add SessionAdapter.buildPrePromptedInvocation so a use case can start a
pre-prompted interactive session (claude --session-id … prompt) or resume one
(claude --resume …), with optional --model/--effort. codex/mistral return an
unsupported refusal for the pre-prompted start. Generic by design so review-code
can adopt it later. Covered by unit tests for the claude argv and the refusals.

---

## phase-07 — `prepareAdjustPlanSession` use case {#phase-07-use-case}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Add the application use case that starts or resumes the adjust-plan session: it
reads the landed reconciliation and the target plan, builds the pre-prompt,
persists the session record, and returns the invocation for the CLI to spawn. It
spawns nothing and mutates no plan.

### Detailed instructions

- Create `src/app/adjustPlan.ts` exporting `prepareAdjustPlanSession(opts)`:
  - `opts`: `{ planPath: string; planMarkdown: string; runPath: string; runKey: string; provider: <provider literal>; cwd: string; planJsonPath?: string; newSession: boolean; nowIso: string; modelOverride?: string; effortOverride?: string; model: string; effort: string }`.
    (The CLI resolves `runPath`/`provider`/`cwd` and reads `planMarkdown`; the use
    case stays oblivious to argv and `Date`.)
  - Returns `Effect.Effect<PrepareAdjustResult, FsError, FileSystem | SystemTelemetry>`
    where `PrepareAdjustResult` is `{ kind: "ready"; invocation; mode: "new" | "resume" }`
    or `{ kind: "unsupported"; message }` or `{ kind: "refused"; message }`.
  - Session-record + prompt-file dir: `join(runPath, "adjust-plan-sessions", slug(planPath))`;
    record at `…/session.json`, prompt at `…/${ADJUST_PLAN_PROMPT_FILENAME}`.
    Persisting under the run folder (not the repo tree) keeps the prompt out of the
    git worktree the session will commit in.
  - **Resume** (record exists, decodes, `!newSession`): build the resume invocation
    via `getSessionAdapter(provider).buildPrePromptedInvocation({ cwd, sessionId, initialPrompt: null, model: modelOverride, effort: effortOverride })`
    (only explicit overrides on resume). Refresh `updatedAt`, rewrite the record
    (`fs.writeAtomic`). Surface an adapter `unsupported` as `unsupported`.
  - **New** (no/undecodable record, or `newSession`):
    1. `sessionId = randomUUID()` (`node:crypto`, app-layer, as in
       `src/app/fixLoop.ts`).
    2. Read `join(runPath, "global-file-reconciliation.json")` and decode via
       `decodeGlobalFileReconciliation` (phase-04). Derive `landedChanges`
       (`added`/`modified`/`deletedOrRenamed`) from the entries' `actualActions`.
       If the file is absent, return `refused` (the run has not produced a
       reconciliation; it must have reached review).
    3. If `planJsonPath` is given, `loadPlan` it, build its footprint and the
       landed footprint (`buildLandedFootprint`), run `computeReadjustmentImpact`
       for that single plan, and set the prompt's `impact` block; otherwise omit it.
    4. Build the full prompt via `buildAdjustPlanPrompt({ planPath, planMarkdown, landedLabel: runKey, landedChanges, impact })`,
       ensure the session dir exists (`fs.mkdirp`), and `fs.writeAtomic` it to the
       prompt path.
    5. Build the positional via `buildAdjustPlanPositionalPrompt(promptPath)`.
    6. Build the start invocation via
       `buildPrePromptedInvocation({ cwd, sessionId, initialPrompt: positional, model, effort })`.
       If `unsupported`, return `unsupported` (persist no record).
    7. Persist the `AdjustPlanSession` record (`encodeAdjustPlanSession`,
       `fs.writeAtomic`) with `createdAt = updatedAt = nowIso`.
  - Emit `SystemTelemetry` step-started/step-completed and an artifact-generated
    event for the prompt file, mirroring `reviewCompliance.ts`.
  - Do **not** spawn the session and do **not** edit the plan — the CLI owns the
    `Session` layer; the plan edit happens interactively inside the session after
    the developer approves.

### Planned files to create

- `src/app/adjustPlan.ts`
- `tests/integration/adjustPlan.test.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- (none)

### Boundary contracts

Consumer/producer: the use case consumes the landed `global-file-reconciliation.json`,
the target `plan.md` text, an optional `phax-plan.json`, and the persisted session
record; it produces the session record, the prompt file, and a `PrepareAdjustResult`
invocation. Depends only on `FileSystem` + `SystemTelemetry` — no `Session`.

### Test strategy

- Integration (core cases before implementation) with fake `FileSystem` +
  `NoopSystemTelemetryLayer`, fixed `nowIso`:
  - New session, no `planJsonPath`: reads the seeded reconciliation, writes the
    prompt (assert it names the landed changes and the plan path), persists a
    record, returns `mode: "new"` with claude `--session-id` argv and `cwd`.
  - New session with `planJsonPath`: the written prompt includes the deterministic
    impact (shared files/severity).
  - Resume (no overrides): existing record + `newSession:false` → `mode:"resume"`,
    `--resume`, no `--model`/`--effort`, `updatedAt` refreshed.
  - Missing `global-file-reconciliation.json` → `kind:"refused"`, no record written.
  - Unsupported provider for new → `kind:"unsupported"`, no record written.

### Implementation order

Resume branch, then the new branch (reconciliation read → optional impact → prompt
write → record), then telemetry.

### Excluded scope

- argv parsing, run resolution, and spawning (phase-08).
- Editing or committing the plan — that is interactive, inside the session.

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The `prepareAdjustPlanSession` signature and the `PrepareAdjustResult` variants.
- The session-dir/prompt/record paths, how `landedChanges` are derived from
  `actualActions`, and how the optional impact is computed.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(app): add prepareAdjustPlanSession use case

### Commit body

Add prepareAdjustPlanSession, which starts or resumes the adjust-plan interactive
session: it reads the landed run's global-file-reconciliation.json and the target
plan.md, optionally computes the deterministic impact from a phax-plan.json, writes
the drift pre-prompt and a persisted session record under the run folder, and
returns the provider invocation for the CLI to spawn. It mutates no plan and spawns
nothing; the plan edit and commit happen interactively in the session after
approval. Covered by integration tests over the new/resume/refused/unsupported
branches with fake ports.

---

## phase-08 — `adjust-plan` CLI command, registration, and usage spec {#phase-08-cli-command}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Wire the command surface: parse the args, resolve the landed run, call the use
case, spawn the interactive session via the `Session` port, register the command,
and document it in the usage spec.

### Detailed instructions

- Create `src/cli/commands/adjustPlan.ts` exporting
  `runAdjustPlan(planPathArg, opts, out): Promise<number>`, modeled on
  `src/cli/commands/enter.ts` (resolve/spawn) and `reviewCompliance.ts` (config):
  - `opts: { landed: string; newSession?: boolean; planJson?: string; model?: string; effort?: string; verbose?: boolean }`.
  - Load config; on error print and return 1. Require `opts.landed`; resolve that
    run via `resolveRun`/`resolveRunRef` to get its `runPath` and `runKey`; print
    and return 1 on failure. (The run need not be `review_open`, but it must have a
    `global-file-reconciliation.json` — the use case returns `refused` otherwise.)
  - Read the target `plan.md` at `planPathArg` (via the same `FileSystem` layer);
    if it does not exist, print a clear error and return 1.
  - Read the provider from the landed run's final-phase `agent-binding.json`
    (`readAgentBinding`, as `enter.ts` does); on missing binding, print and return 1.
  - Validate `--effort` against the config `EffortLiteral` (`low|medium|high`) if
    given; compute effective `model`/`effort` (defaulting model to
    `claude-opus-4-8` and effort to `high`, matching the review default rationale).
  - Run `prepareAdjustPlanSession({ planPath: planPathArg, planMarkdown, runPath, runKey, provider, cwd: process.cwd(), planJsonPath: opts.planJson, newSession: opts.newSession ?? false, nowIso: new Date().toISOString(), modelOverride: opts.model, effortOverride: opts.effort, model, effort })`
    over a `FileSystem` + `SystemTelemetry` layer. Keep `new Date()` at the CLI edge.
  - On `kind: "unsupported"` / `"refused"`: print the message, return 1.
  - On `kind: "ready"`: log `Starting plan adjustment session …` / `Resuming …` by
    `mode`, provide `makeNodeSessionLayer()`, call `Session.resume(invocation)`,
    and return its exit code (as `enter.ts` does).
- Register in `src/cli/program.ts` after `plans-overlap`:
  ```ts
  program
    .command("adjust-plan")
    .description("Open an interactive session to adjust a plan after a landed run")
    .argument("<plan>", "Path to the plan.md to adjust")
    .requiredOption("--landed <run>", "The landed run whose actual changes drive the adjustment")
    .option("--plan-json <path>", "Optional phax-plan.json for the target plan, to seed a precise impact")
    .option("--new-session", "Start a fresh adjustment session instead of resuming")
    .option("--model <model>", "Override the model (default: claude-opus-4-8)")
    .option("--effort <effort>", "Override the effort (low | medium | high)")
    .action(async (plan: string, opts) => {
      const exitCode = await runAdjustPlan(plan, { ...opts, ...globalTraceOpts() }, consoleOutput);
      process.exit(exitCode);
    });
  ```
  Add the `import { runAdjustPlan } from "./commands/adjustPlan.js";`.
- Add an `"adjust-plan"` entry to `src/cli/cliDocs.ts`: a `longHelp` describing the
  interactive drift→questions→propose→approve→edit+commit flow, that it is a
  session-opener that mutates nothing itself, that input is the `plan.md` and
  `--landed` is required, and the side effect (spawns an interactive provider CLI;
  the developer-driven session may, after approval, edit and commit the plan.md);
  and `examples: ["phax adjust-plan docs/plans/40-foo.md --landed my-feature"]`.
- Add a fake `Session` layer at `src/infra/fakes/session.ts` (records the
  invocation, returns a configurable exit code) and export it from
  `src/infra/fakes/index.ts`, for the command test — **unless** it already exists
  (e.g. plan 36 landed first); reuse it if so and note that in the handoff.
- Regenerate `phax.usage.kdl` (`pnpm gen:usage-spec`) then `docs/cli/reference.md`
  + README (`pnpm docs:cli`); do not hand-edit them.
- Update `tests/integration/cliProgram.test.ts`: add `"adjust-plan"` to
  `TOP_LEVEL_COMMANDS` (the exact-length assertion requires it) and assert its
  `<plan>` arg and `--landed`/`--plan-json`/`--new-session`/`--model`/`--effort`
  flags.

### Planned files to create

- `src/cli/commands/adjustPlan.ts`
- `src/infra/fakes/session.ts`
- `tests/integration/adjustPlanCommand.test.ts`

### Planned files to edit

- `src/cli/program.ts`
- `src/cli/cliDocs.ts`
- `src/infra/fakes/index.ts`
- `tests/integration/cliProgram.test.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`
- `README.md`

### Optional files that may be edited

- `docs/cli/inventory.md`

### Boundary contracts

Consumer (cli) → producer (app): the command resolves the landed run, reads the
plan, calls `prepareAdjustPlanSession`, and spawns the returned invocation through
the `Session` port. The command holds no business logic — the new/resume decision,
drift-prompt assembly, and persistence live in the use case; the plan edit/commit
happens inside the spawned session.

### Test strategy

- Integration `tests/integration/adjustPlanCommand.test.ts` with fake `FileSystem`
  + fake `Session`:
  - A landed run with a reconciliation and a target plan.md → exit = the fake
    session's code, and the fake `Session` received a claude `--session-id`
    invocation with `cwd` the repo root.
  - `--plan-json` provided → the written prompt (via fake fs) includes the impact.
  - Re-invocation without `--new-session` → fake `Session` received `--resume`.
  - Missing `--landed` → Commander error / exit 1 without spawning.
  - Landed run lacking a reconciliation → exit 1 (`refused`) without spawning.
  - Invalid `--effort` → exit 1 without spawning.
- Extend `tests/integration/cliProgram.test.ts` for registration.
- The `usage`/spec-lint gate validates the new `phax.usage.kdl` block.

### Implementation order

Command file → `cliDocs` entry → `program.ts` registration → fake `Session`
(if absent) → regenerate `phax.usage.kdl` then docs → update `cliProgram.test.ts`
→ command integration test → `full` gate.

### Excluded scope

- Pre-prompted interactive start for codex/mistral (adapter returns `unsupported`,
  surfaced cleanly).
- Any auto-application of plan edits — editing and committing the plan is done by
  the developer-driven session after approval, never by the command.
- A `plans-overlap`-style read-only report (phases 01–04 already cover that).

### Verification

- The project's configured `full` gate profile in `phax.json` (includes the
  `usage`/spec-lint and completions checks that read `phax.usage.kdl`).

### Expected handoff content

- The `runAdjustPlan` signature and `opts` shape, the run-resolution path, the
  effort validation, the exit-code contract, and the `Session` layer provided.
- The registered command name, the `<plan>` arg and all flags, the `cliDocs` entry,
  and the `phax.usage.kdl` block added.
- Whether `src/infra/fakes/session.ts` was created or already existed.
- The updated `TOP_LEVEL_COMMANDS` list; confirmation the derived artifacts were
  regenerated and `usageSpecDrift.test.ts` passes.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(cli): add adjust-plan interactive plan-adjustment session command

### Commit body

Add `phax adjust-plan <plan.md> --landed <run>`, which opens an interactive,
pre-prompted session seeded with a landed run's actual changes, the target plan,
and an optional deterministic impact. The session establishes the drift, asks
clarifying questions, proposes changes and waits for the developer's approval, and
only then edits and commits the plan — all interactively within the session; the
command itself mutates nothing. Re-invocation resumes; --new-session starts fresh.
Registers the command, documents it in cliDocs/phax.usage.kdl, and adds a fake
Session layer for the command test.
