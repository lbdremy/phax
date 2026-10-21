---
status: Completed
source-spec: docs/specs/2610201350-assignment-bounds.md
completes-spec: true
approved:
  date: 2026-10-21
  baseline: 99fc91a
---
# Assignment bounds

The third and last plan of the spec `assignment-bounds`. Two plans have already landed: plan 1 (PR #150) added the structured architecture report and its glob syntax, and plan 2 (PR #151) added the `assignmentReason` rename, the `**Assignment reason:**` header reader in `src/domain/plan/phaseHeader.ts`, the `**Model reason:**` lint error and the 0.26.0 upgrade step. This plan adds what is left. The repository's owner declares an ordered `assignments` list of bounds in phax.json. `phax validate` checks each bound against the routing catalog. One pure domain check holds every phase to its governing bound, or to the policy default when no bound governs it. `phax plans lint` and the `phax run` / `phax resume` start preflight both call that check. Finally, `phax architecture`, the headless plan prompt and its command grant, the skills and the docs learn about the bounds.

The spec's arbitrations (q-learn, q-part, q-default, q-render, q-validate) and the joint phase-shape decisions (J1–J5) are settled and are not reopened here. Leave the refusals for interactive and oracle phases (`src/domain/plan/interactiveCheck.ts`, `src/domain/plan/oracleCheck.ts`) as they are.

This repository declares no bounds, so this plan's own phases fall under the policy default. Phase-02 edits `.claude/skills/phax-planning/SKILL.md` and `.claude/skills/phax-cli/SKILL.md`, so the plan must be run with `phax run --allow-skill-edits`. Fixtures are made up (`acme-guard`, `acme-billing`, `src/core/decide/**`, `refunds`). Tests never read `~/.phax`: they use the fake FileSystem and fake Shell layers, or a temporary HOME. They assert `$schema` URLs by format id and release pattern, never by the running version.

## Required commands

- `pnpm dev schema upgrade`
- `pnpm gen:usage-spec`
- `pnpm docs:cli`

These three commands regenerate the committed config JSON Schemas (`phax.schema.json`, `phax.user.schema.json`), `phax.usage.kdl`, and `docs/cli/reference.md` with the README CLI summary. All three are already listed in `security.agentCommands` in phax.json, so phax.json needs no change.

## Technical arbitrations

- Glob matching: phax uses its own matcher, `src/domain/architecture/glob.ts`, which implements exactly the dialect the `architecture-report` schema documents. Globs bounds reuse that schema's glob syntax check (`ArchitectureGlobSchema`, now exported), so parts and bounds share one dialect. Loss accepted: phax maintains a small matcher instead of using a library. Node's `path.matchesGlob` and the common libraries treat braces, leading dots and separators differently from the documented dialect.
- The order of efforts that bounds a range is the order of the `efforts` list in the bound model's catalog entry (`entryFor(model, providerConfig)`). phax never orders models. Loss accepted: an effort the model does not offer is never inside any range, so a phase at that effort departs.
- The catalog check of bounds (unknown model, unknown `min`/`max`, `min` after `max`) is one pure domain function. `phax validate` (exit 2), lint and the run preflight (one `models` error per invalid bound, with no phase compared) all call it. At decode time, every command checks only the shape. Loss accepted: `phax architecture` and authoring accept a bound that names a model the catalog lacks, as q-validate decided.
- `assignments` stays project-only, like `records`. A user overlay that carries the key is refused before it is decoded, with `"assignments" is accepted only in phax.json` and the overlay's path (exit 2). Loss accepted: this special-cases one key in the overlay reader instead of relying on the generic unknown-key error, so that the refusal names the remedy.
- How often the provider runs: every run of the shared preflight set resolves part bounds again. A fresh `phax run` therefore runs the architecture provider twice (in `freshRunPreflight`, then in executePlan's re-check), and `phax resume` runs it once. Loss accepted: a second call of up to 60 s. Also, a provider that answers differently between the two calls refuses after the run is named, as every other re-check already does (see NEXT_STEPS.md, Small follow-ups). Threading a cached answer from one call to the other would couple the two entry points for no change in verdict.
- `phax run --dry-run` stays as it is. It returns before the preflight, runs no architecture provider, and prints no bounds line. Loss accepted: the preview does not foretell a bounds refusal. The real run refuses before it is named, so it leaves nothing behind, and `phax plans lint` is the check meant for this.
- `phax architecture <path>...` with a path-scoped report that does not carry a bound's part shows that bound as `(not in this report: run \`phax architecture\` with no path for its globs)`. A whole-repository report that lacks the part shows `(unresolved: the report has no part <id>)`. Loss accepted: in the first case the planner must run the command once more, without a path, to see the globs.
- When the provider fails, `phax architecture` keeps its one stderr line and exit 1, and prints no bounds, as spec §6 shows. Loss accepted: that call does not show the globs bounds. Lint and the run preflight still name every bound.
- The headless prompt bullet: with a provider, it reads `before cutting phases and assigning models, run phax architecture…`, and it adds one sentence saying the command lists the bounds after the parts when bounds are declared. With bounds and no provider, it is the §6 bullet. With neither, it reads as today. The prompt lists no bound. Loss accepted: the provider bullet changes by three words even when no bounds are declared, so one wording serves both acceptance cases.
- Finding wording follows spec §6. Bound-level errors carry `phase: null` and read `assignments[N] (part <id>): unresolved: <cause>; no phase was compared with the bounds`, or `assignments[N].<field>: <problem>`. Phase-level findings name the bound as `assignments[N] (part <id>: <model>, <min>–<max>)` or `assignments[N] (globs <g1>, <g2>: <model>, <min>–<max>)`. A range with `min` equal to `max` prints one effort. The preflight refusal reads `Assignment preflight failed: N error(s) from the assignment bounds.`. Under that line it lists the phase errors grouped as `phase-NN (model/effort):` and the bound errors one per line, then `Check the plan with \`phax plans lint <plan>\`.`, and exits 11 through a new `AssignmentPreflightError`.
- Security: the only new grant is the one the spec decided. A headless plan authoring session is granted `phax architecture` when bounds alone are declared. That session is read-only on Claude Code and cannot edit phax.json or phax.local.json. Running the architecture provider from `phax plans lint` and from the run's start preflight was decided by spec §5.13 and q-validate. It runs on the operator's invocation, from the main checkout's config, with the working tree's root as cwd, never inside an agent session. No other command, grant or write scope changes.

---

## phase-01 — Bounds in phax.json, the bounds check, and lint and the run preflight holding plans to it {#phase-01-bounds-check}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high
**Assignment reason:** Designs a check no code shows yet: first-match governance over three file lists, conformity in each model's catalog effort order, and part resolution through the architecture provider. It threads that check through config decode, validate, lint and both run preflights, across schemas, domain, app and CLI.

The repository's owner can declare `assignments` in phax.json. A malformed bound, or a bound declared in a user overlay, is refused with exit 2 on every command, and `phax validate` refuses a bound the routing catalog lacks. One pure domain check finds each phase's governing bound (the first that matches any planned file) and judges whether the phase conforms. It returns `models` findings, which `phax plans lint` reports. The `phax run` and `phax resume` start preflight refuses with exit 11 on exactly the errors among them.

### Detailed instructions

- Bound schema, new `src/schemas/assignments.ts`. Export the plan's effort literal from `src/schemas/phaxPlan.ts` (today it is the private `EffortSchema`; export it as `PlanEffortSchema` and use it for the plan's `effort` as before). Export the glob schema from `src/schemas/architecture.ts` as `ArchitectureGlobSchema`, unchanged. Define `EffortRangeSchema = Schema.Struct({ min: PlanEffortSchema, max: PlanEffortSchema })`. Define `PartBoundSchema = Schema.Struct({ kind: Schema.Literal("part"), part: Schema.NonEmptyString, model: Schema.NonEmptyString, effort: EffortRangeSchema })` and `GlobsBoundSchema = Schema.Struct({ kind: Schema.Literal("globs"), globs: Schema.NonEmptyArray(ArchitectureGlobSchema), model: Schema.NonEmptyString, effort: EffortRangeSchema })`. Define `AssignmentBoundSchema = Schema.Union(PartBoundSchema, GlobsBoundSchema)` and `AssignmentsSchema = Schema.NonEmptyArray(AssignmentBoundSchema)`. Annotate with descriptions: the list is ordered from most to least demanding and the first bound that matches any planned file governs; a part bound covers the files of the architecture-report part whose id is `part`; the `globs` description restates the report's glob dialect word for word (`**` as a whole segment, `*`, `?`, leading dot not special, every other character literal, braces refused), because the spec requires the dialect in both JSON Schemas. Export the `AssignmentBound`, `PartBound`, `GlobsBound` and `Assignments` types. Every key is required and variants are explicit: no optional key and no superset.
- Config, `src/schemas/phaxConfig.ts`: add `assignments: Schema.optional(AssignmentsSchema)` to `PhaxConfigSchema` only, never to `PhaxUserOverlaySchema`, and give it a description saying it is accepted in phax.json only. Add `readonly assignments?: Assignments` to `ResolvedConfig`. Refresh the stale `architecture` descriptions in both schemas: the report is `{$schema, body, parts}` and phax renders it to Markdown (the command description still says `"body"` only, and the key description still says `as Markdown`).
- Merge, `src/domain/config/mergeLayers.ts`: `assignments` is project-only and never overlaid, exactly like `records`. Add `const assignments = project.assignments` with a comment like the one on `records`, and spread it into the result.
- Load, `src/app/loadConfig.ts`: in `readUserOverlay`, before decoding, refuse a parsed object that has an own `assignments` key with `new ConfigValidationError({ message: '"assignments" is accepted only in phax.json', path: filePath })`. In `loadConfig`, set `resolved.assignments` when the merged config carries it.
- Decode messages, `src/schemas/formatError.ts`: in `formatConfigParseError`, render an issue path that starts with `assignments` using bracketed indices (`assignments[1].kind: …`, `assignments[0].effort.min: …`). An empty list stays `assignments: …`. Leave every other path's rendering unchanged. Check the actual messages for `kind: "path"`, a part bound that also carries `globs`, `globs: []` and `assignments: []`: each must name `assignments[1]` (or `assignments` for the empty list) and the field.
- Regenerate the committed config JSON Schemas with `pnpm dev schema upgrade` (it writes `phax.schema.json` and `phax.user.schema.json`). Update `tests/unit/phaxConfigJsonSchema.test.ts` so the project schema's top-level keys include `assignments` and the user schema's do not.
- Glob matcher, new `src/domain/architecture/glob.ts`, pure: export `matchesGlob(glob: string, path: string): boolean` and `matchesAnyGlob(globs: readonly string[], paths: readonly string[]): boolean`. Match segment by segment on `/`. `**` as a whole segment matches zero or more segments. `*` matches zero or more characters within a segment. `?` matches exactly one character other than `/`. Every other character, including `[`, `]`, `!` and `.`, is literal. A leading dot is not special. Matching is case-sensitive and the same on every host, and the path is a working-tree-root-relative POSIX path. Build no RegExp from unescaped input: escape every literal, or match by hand. Remove the `Syntax only: matching ships with the bounds that use it.` comment in `src/schemas/architecture.ts` and point it at the new module.
- Domain check, new `src/domain/plan/assignmentCheck.ts`, pure, no Effect. First, `boundCatalogProblems(bounds, providerConfig): readonly string[]` returns one message per invalid bound, in list order: `assignments[N].model: <model> is not in the catalog`; `assignments[N].effort: min "<e>" is not an effort <model> offers` (the same for max); or `assignments[N].effort: min "<min>" comes after max "<max>" for <model>`. Effort order is the `efforts` array of `entryFor(model, providerConfig).entry`. Second, a `PartResolution` type: `{ kind: "resolved"; parts: ReadonlyMap<string, readonly string[]> }` or `{ kind: "unavailable"; cause: string }`. Third, `assignmentFindings(input)`, which takes `bounds: Assignments | undefined`, `phases` (each with `id`, `model`, `effort` and the three planned-file lists), `headers: readonly PhaseHeader[]` (the reason is `assignmentReason` of the header whose `phase` matches, null when there is none), `parts: PartResolution` and `providerConfig`, and returns `LintFinding[]` on the `models` check.
- The algorithm of `assignmentFindings`. (a) With bounds declared, compute catalog problems and unresolved part bounds first. A part bound is unresolved when `parts` is `unavailable` (cause `<cause>`) or when the map lacks its `part` (cause `the architecture report has no part <id>`). Each problem is one error with `phase: null`; the unresolved wording is in Technical arbitrations. When there is any such error, return only those errors: compare no phase with the bounds or with the policy default. (b) Otherwise, for each phase, take `files = create ∪ edit ∪ optional`. The governing bound is the first bound in list order that matches any file: a globs bound through its own globs, a part bound through its part's globs from the map. A phase with no planned file has no governing bound. (c) A phase with a governing bound conforms when `phase.model === bound.model` and the phase's effort lies between `min` and `max` inclusive in that model's catalog effort order; otherwise it departs. A departure with no reason is an error: `<model> / <effort>: outside <bound> with no **Assignment reason:** line`. A departure with a reason is a warning: `<model> / <effort>: outside <bound>: "<reason>"`. A conforming phase with a reason is a warning: `conforms to <bound> but carries an **Assignment reason:** line`. (d) A phase with no governing bound, including every phase when no bounds are declared, is compared with `PHASE_MODEL_POLICY.defaultAssignment` from `src/domain/routing/phaseModelPolicy.ts`, by equal model and equal effort. A departure with no reason is a warning: `<model> / <effort>: no bound governs; departs from the policy default (claude-sonnet-5-5 / medium) with no **Assignment reason:** line`. A phase at the default with a reason is a warning: `no bound governs; takes the policy default (claude-sonnet-5-5 / medium) but carries an **Assignment reason:** line`. Never rank models, and never write or change a model or effort. Update the `phaseModelPolicy.ts` comment that says phax never applies the policy: lint now compares against it.
- App, new `src/app/assignmentBounds.ts`. `resolveBoundParts(config): Effect<PartResolution, never, Shell>`: with no part bound, return `resolved` with an empty map and run nothing. With part bounds but no `config.architecture`, return `unavailable` with cause `no architecture provider is configured`. Otherwise call `pullArchitecture({ command, root: config.repoRoot, cwd: config.repoRoot, paths: [] })` from `src/app/architectureProvider.ts`: one call, `files: null`, under `ARCHITECTURE_TIMEOUT_MS`. A `failed` result becomes `unavailable` with its reason; an `answered` one becomes a map from part id to globs. `assignmentBoundFindings({ config, phases, headers, providerConfig }): Effect<readonly LintFinding[], never, Shell>` composes the two and calls `assignmentFindings`. `invalidBoundMessages(config): Effect<readonly string[], ConfigValidationError, FileSystem>` loads the catalog with `loadProviderConfig()` and returns `boundCatalogProblems` (an empty array without bounds).
- Lint, `src/app/lintPlan.ts`: only after the plan parses and finalizes, right after `modelFindings`, push the findings of `assignmentBoundFindings({ config, phases: plan.phases, headers, providerConfig })`, reusing the `headers` already read and the `providerConfig` already loaded. The `**Model reason:**` error stays where it is (`reasonLabelFindings`). The auditor still runs after this.
- Run preflight, `src/app/runPreflight.ts`: add `"assignment-bounds"` to `RUN_PREFLIGHT_CHECKS` directly after `"phase-sections"`. The check calls `assignmentBoundFindings({ config: input.config, phases: input.plan.phases, headers, providerConfig: input.providerConfig })`, where the headers are already read from the plan.md the run reads (the run folder's copy on resume). It keeps only the `error` findings and fails with a new `AssignmentPreflightError` (`message`, `findings: readonly LintFinding[]`, `planPath`) in `src/domain/errors.ts`, worded as in Technical arbitrations. Warnings are neither printed nor refusing. Widen the check record's requirement, `runPreflights` and `freshRunPreflight` to `FileSystem | Shell`, and add the error to `RunPreflightRefusal`. Map it to exit 11 in `src/cli/commands/runLayers.ts`. Provide `NodeShellLayer` to `freshRunPreflight` in `src/cli/commands/run.ts`. Add the error to executePlan's error union in `src/app/executePlan.ts` (executePlan already has Shell). With no bounds declared, the check runs no provider and can only yield warnings, so it always passes.
- `phax validate`, `src/cli/commands/validate.ts`: after the config is valid and the sources are printed, when `config.assignments` is declared, run `invalidBoundMessages` with `makeRepoRootedFileSystemLayer(config)`. On problems, print `Config validation failed: <message>` for each, then `  at: <project phax.json path>` (from `describeConfigSources`), and return 2. Otherwise print `  N assignment bounds (P part, G globs)`. `runValidate` becomes async, so make the `validate` action in `src/cli/program.ts` await it. The command holds no logic beyond calling the use case and rendering.
- Do not touch `phax architecture`, the authoring prompt, the grant, the skills or the docs: phase-02 owns them.

### Planned files to create

- `src/schemas/assignments.ts`
- `src/domain/architecture/glob.ts`
- `src/domain/plan/assignmentCheck.ts`
- `src/app/assignmentBounds.ts`
- `tests/unit/schemas/assignments.test.ts`
- `tests/unit/architecture/glob.test.ts`
- `tests/unit/assignmentCheck.test.ts`
- `tests/integration/assignmentBounds.test.ts`

### Planned files to edit

- `src/schemas/phaxPlan.ts`
- `src/schemas/architecture.ts`
- `src/schemas/phaxConfig.ts`
- `src/schemas/formatError.ts`
- `src/domain/config/mergeLayers.ts`
- `src/domain/routing/phaseModelPolicy.ts`
- `src/domain/errors.ts`
- `src/app/loadConfig.ts`
- `src/app/lintPlan.ts`
- `src/app/runPreflight.ts`
- `src/app/executePlan.ts`
- `src/cli/commands/runLayers.ts`
- `src/cli/commands/run.ts`
- `src/cli/commands/validate.ts`
- `src/cli/program.ts`
- `phax.schema.json`
- `phax.user.schema.json`
- `tests/unit/phaxConfigJsonSchema.test.ts`
- `tests/unit/mergeLayers.test.ts`
- `tests/integration/loadConfigLayers.test.ts`
- `tests/unit/cli/validate.test.ts`
- `tests/integration/lintPlan.test.ts`
- `tests/unit/runPreflight.test.ts`
- `tests/integration/runPreflightBeforeNaming.test.ts`
- `tests/integration/resumePreflightRechecks.test.ts`

### Optional files that may be edited

- `src/domain/plan/lint.ts`
- `src/cli/commands/plans.ts`
- `tests/unit/loadConfig.test.ts`
- `tests/unit/planLint.test.ts`
- `tests/unit/schemas/architecture.test.ts`

### Boundary contracts

The config consumers (lint, the run preflight, validate, and phase-02's `phax architecture` and authoring) need the owner's bounds as decoded data. `loadConfig` provides them as `ResolvedConfig.assignments?: Assignments`: a non-empty ordered list of `{ kind: "part", part, model, effort: { min, max } }` or `{ kind: "globs", globs, model, effort: { min, max } }`, always from phax.json alone. Lint and the run preflight need one verdict. `src/app/assignmentBounds.ts` provides `assignmentBoundFindings({ config, phases, headers, providerConfig })`, which yields `LintFinding[]` on the `models` check, with `phase: null` on bound-level errors. Lint reports all of them; the preflight refuses on the errors (exit 11, `AssignmentPreflightError`). The pure core is `assignmentFindings` and `boundCatalogProblems` in `src/domain/plan/assignmentCheck.ts`, fed a `PartResolution` that only the app layer builds through the Shell port. Phase-02 will consume `matchesGlob`-free data only: it renders bounds next to a report and needs no matcher.

### Test strategy

Write these first, before implementation. (1) `tests/unit/architecture/glob.test.ts`: `**` zero or more segments (`docs/**` matches `docs/a.md` and `docs/.vitepress/config.ts`), `*` within a segment (`*.md` matches `README.md`, not `docs/a.md`), `?`, case sensitivity, and literal `[`, `]`, `!`, `.`. (2) `tests/unit/assignmentCheck.test.ts`, with a fixture catalog built from DEFAULT_PROVIDER_CONFIG and the §6 bounds and parts (`acme-billing` names). It covers: first match wins (create `src/core/decide/refund.ts` + edit `src/http/schemas/refund.ts` → error naming `assignments[0]`; at opus/medium → no finding); optional files count; effort out of range (opus/low → error; opus/high → none); a stated departure → warning quoting the reason; a conforming phase with a reason → warning naming `assignments[1]`; an unresolved part bound (unavailable, or missing `docs`) → errors only, no phase finding; an invalid bound (`claude-opus-9`, min after max) → one error, no phase finding; policy default (no bounds, opus/high without reason → warning; with reason → none; sonnet/medium with reason → warning); a phase with no planned files → policy default; and a phase whose only reason line is `**Model reason:**` departing without a reason. (3) `tests/unit/schemas/assignments.test.ts`: decode the §6 example, and refuse `kind: "path"`, a part bound carrying `globs`, `globs: []`, an unknown key, an effort outside the vocabulary, and `[]`. Then, at the app and integration layer, with fakes only: `tests/integration/assignmentBounds.test.ts` checks, with a fake Shell, that the provider runs once with `{"$schema": <architecture-request URL by pattern>, "files": null}` when a part bound exists, and never when only globs bounds exist (provider configured or not). `tests/integration/lintPlan.test.ts` adds the spec §8 lint cases, including exit-relevant severities. `tests/unit/runPreflight.test.ts`, `tests/integration/runPreflightBeforeNaming.test.ts` (add the new step to its guard table) and `tests/integration/resumePreflightRechecks.test.ts` check that an unstated departure, an unresolved part bound and an invalid bound refuse with `AssignmentPreflightError`, that warnings and a repository without bounds pass with no provider call, that the reason is read from plan.md (the same `phax-plan.json` with and without the line), and that resume reads the run folder's plan.md. `tests/unit/mergeLayers.test.ts`: assignments come from the project only. `tests/integration/loadConfigLayers.test.ts`: the overlay refusal in phax.local.json and ~/.phax/config.json, using a temporary HOME. `tests/unit/cli/validate.test.ts`: the count line, and exit 2 for an unknown model and for min after max, never reading the real `~/.phax`.

### Implementation order

1. Export `PlanEffortSchema` and `ArchitectureGlobSchema`; write `src/schemas/assignments.ts` and its unit test.
2. Add `assignments` to the project config schema, the merge, the overlay refusal, `ResolvedConfig` and the decode-message rendering; regenerate the two config JSON Schemas.
3. Write the glob matcher and its test.
4. Write `src/domain/plan/assignmentCheck.ts` against its unit tests.
5. Write `src/app/assignmentBounds.ts` and its integration test with a fake Shell.
6. Wire lint's `models` check, then the `assignment-bounds` preflight check, its error, exit 11 and the Shell layer in `phax run`.
7. Wire `phax validate` and await it in program.ts.
8. Run the `standard` gate profile.

### Excluded scope

- `phax architecture` showing bounds, the headless prompt bullet and the session grant: phase-02.
- The phax-planning and phax-cli skills, cliDocs long help, usage spec, CLI reference, README, docs pages and NEXT_STEPS.md: phase-02.
- Any change to `phax-plan.json`, the plan document schema or the extraction: the reason stays plan.md-only.
- `phax run --dry-run`: unchanged, as settled in Technical arbitrations.
- Fixing a refused `phax resume` that marks the run failed (NEXT_STEPS.md Small follow-ups).
- The interactive and oracle refusals, and any runtime for those phases.
- Ranking, rewriting or proposing models or bounds.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

Name the exact modules and signatures phase-02 builds on: `Assignments`/`AssignmentBound` in `src/schemas/assignments.ts`, `ResolvedConfig.assignments`, `boundCatalogProblems` and `PartResolution` in `src/domain/plan/assignmentCheck.ts`, and `resolveBoundParts`/`assignmentBoundFindings` in `src/app/assignmentBounds.ts`. Give the final wording of the lint findings, the preflight refusal and the validate lines, so phase-02's docs quote them exactly. Say where `assignment-bounds` sits in `RUN_PREFLIGHT_CHECKS`, and that a fresh `phax run` runs the provider twice. List anything left for phase-02's docs (for example, how the decode error for an empty list reads). Explain every deviation phax flags from the planned file lists.

### Commit subject

`feat(plans): hold plans to the owner's assignment bounds in lint and the run preflight`

### Commit body

phax.json gains `assignments`: an ordered, non-empty list of part and globs bounds, each with a model and an effort range. phax.json alone declares it; a user overlay that carries it is refused with exit 2, and a malformed bound is refused at decode. `phax validate` also refuses a bound whose model or efforts the routing catalog lacks.

One pure check (src/domain/plan/assignmentCheck.ts) finds each phase's governing bound, the first that matches any planned file, through phax's own glob matcher. It judges conformity by equal model and an effort within the range, in the catalog's effort order, without ranking models. An unstated departure is an error, a stated one a warning that quotes the reason, and a conforming phase with a reason a warning. Where no bound governs, the policy default applies, as warnings. When a part bound exists, the architecture provider runs once with files null. An unresolved or invalid bound is an error, and no phase is then compared.

`phax plans lint` reports these findings on its `models` check. The `phax run` and `phax resume` start preflight runs the same check after phase-sections and refuses on its errors with exit 11. It reads the reason from plan.md, so phax-plan.json is unchanged.

---

## phase-02 — phax architecture shows the bounds, the planner is sent to them, and the skills and docs teach them {#phase-02-architecture-bounds-docs}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

`phax architecture` lists every declared bound after the parts, and after its no-provider line when no provider is configured. The headless plan prompt sends the planner to `phax architecture` whenever a provider or bounds are configured, and the session is granted the command in both cases. The phax-planning and phax-cli skills, the CLI help and the docs teach the bounds, the first-match rule and the conformity rule.

### Detailed instructions

- Read phase-01's handoff for the exact module paths and finding wording: `Assignments` in `src/schemas/assignments.ts`, `ResolvedConfig.assignments`, and the lint, preflight and validate lines.
- Rendering, `src/domain/architecture/render.ts`: add a pure `renderAssignmentBounds(bounds: Assignments, source)`. `source` is `{ kind: "report"; report: ArchitectureReport; scoped: boolean }` or `{ kind: "no-provider" }`. It returns `## Bounds (phax.json \`assignments\`; the first match governs)` and then one line per bound in list order. A part bound whose part the report carries: `- assignments[0] part core-decide — core · decide (\`src/core/decide/**\`): claude-opus-5-5, medium–high` (the name passes through `onOneLine`, the globs are code spans joined by `, `). A globs bound: `- assignments[1] globs \`src/*/schemas/**\`: claude-sonnet-5-5, medium–high`. A part bound with no provider: `(unresolved: no architecture provider)`. A part bound missing from a scoped report: `(not in this report: run \`phax architecture\` with no path for its globs)`. A part bound missing from a whole-repository report: `(unresolved: the report has no part <id>)`. The range uses an en dash and prints one effort when `min` equals `max`. No trailing newline, like `renderArchitectureReport`.
- Command, `src/cli/commands/architecture.ts`, kept thin. With no provider, log `NO_ARCHITECTURE_PROVIDER`. When `config.assignments` is declared, also log a blank line and the rendered bounds (`no-provider`). Return 1. On an answered report, log the rendered report, plus a blank line and the rendered bounds (`report`, `scoped: paths.length > 0`) when bounds are declared, and return 0. A refusal or provider failure is unchanged: one stderr line, exit 1, no bounds. No other phax output lists the bounds.
- Prompt, `src/domain/authoring/prompt.ts`: add `readonly assignmentBounds: boolean | null` to `AuthoringPromptInput` (null for a spec). Pick the first bullet from `architectureProvider` and `assignmentBounds`. With a provider: `- An architecture provider is configured: before cutting phases and assigning models, run \`phax architecture\` (or \`phax architecture <path>...\` for the parts the plan touches) and plan against its answer.`, followed, when bounds are declared, by ` It lists the assignment bounds (phax.json \`assignments\`) after the parts: assign each phase against them.` With bounds and no provider: `- Assignment bounds are declared (phax.json \`assignments\`), and no architecture provider is configured: before cutting phases and assigning models, run \`phax architecture\`. It exits 1 with its no-provider line, then lists the bounds; read the architecture from the code and its documentation (README, CLAUDE.md or equivalent).` With neither, keep today's absent line byte for byte. The prompt lists no bound and runs no provider.
- Grant, `src/domain/security/agentCommands.ts`: `authoringAgentCommands({ kind, architectureProvider, assignmentBounds })` returns `[ARCHITECTURE_AGENT_COMMAND]` for a plan when either flag is true, and `[]` otherwise. Update its doc comment and the comment in `src/domain/session/claudePermissionFlags.ts` if it names the provider-only condition. `src/app/authorArtifact.ts`: add `readonly assignmentBounds: boolean` to the input and pass it to both the grant and the prompt (`null` for a spec). `src/cli/commands/artifact.ts`: pass `assignmentBounds: config.assignments !== undefined`. Session `readOnly` is unchanged.
- phax-planning skill, `.claude/skills/phax-planning/SKILL.md`, editing only outside the `BEGIN generated` / `END generated` blocks. In "Choosing a model and effort", replace the reason bullet with bullets that: read the bounds before assigning, since `phax architecture` prints them after the parts, also when it exits 1 with its no-provider line; say the first bound that matches any file the phase plans to create, edit or optionally edit governs it, and with none the default above stands in; define conformity as the governing bound's model (or the default) at an effort inside the range; say `assignmentReason: null` and no line exactly on a conforming phase, and any other phase says why in `assignmentReason` or an `**Assignment reason:**` line; and say `phax plans lint` and the run's start preflight fail an unstated departure from a bound, while an unstated departure from the default is a warning. Update the per-phase field table row and the phase template line ("only on a phase that departs from its governing bound or the default"). Update "Lint before you run" (the `models` check now covers the bounds, and the preflight refuses the same errors with exit 11), "The repository's architecture" (the command also lists the bounds), and the Headless authoring `assignmentReason` bullet. The skill must never contain `modelReason` or the old bold label.
- phax-cli skill, `.claude/skills/phax-cli/SKILL.md`: rewrite the `architecture` bullet. The provider answers with an architecture report (`body` plus `parts`: id, name, description, globs) that phax renders to Markdown, and the command lists the bounds after the parts. With no provider it prints its one line, followed by the bounds when they are declared, and exits 1. A headless plan session is granted it when a provider or bounds are configured. Add an `assignments` bullet (phax.json only; part and globs bounds; first match governs; held by `phax plans lint` and the run's start preflight, exit 11; `phax validate` checks it against the catalog), and add `assignments` wherever the skill lists phax.json keys.
- CLI help, `src/cli/cliDocs.ts`. Update the `architecture` longHelp: the bounds after the parts; with no provider, the line followed by the bounds when declared, still exit 1; how a path-scoped report shows a missing part. Add a `validate` entry whose longHelp says what it checks, including bounds against the routing catalog (exit 2 naming `assignments[N]` and the field), with examples `phax validate` and `phax validate --plan phax-plan.json`, and wire it in `src/cli/program.ts` only if cliDocs entries are not picked up by command path. Update the `plans lint` longHelp: the `models` check includes the bounds, and the architecture provider runs once when a part bound exists. Update `run` and `resume`: exit 11 also covers the assignment preflight. Then run `pnpm gen:usage-spec` and `pnpm docs:cli` to regenerate `phax.usage.kdl`, `docs/cli/reference.md` and the README CLI summary.
- Docs. Add a new page, `docs/assignment-bounds.md`, following spec §11 for repository owners and architecture-provider authors. It walks through the §6 `assignments` example; `phax architecture` with the parts and then the bounds, and without a provider; a lint error naming `assignments[0]` and the same refusal from `phax run` with exit 11; an `**Assignment reason:**` line turning the error into a warning that quotes it, after which the run starts; a final catch-all `["**"]` globs bound that makes the policy default binding; and the overlay refusal and `phax validate`. Quote phase-01's final wording. Register the page in `site/pages.ts` (route `/guide/assignment-bounds`) and `site/build/sources.ts`, and link it from the README. `docs/architecture-provider.md`: the bounds shown after the parts, the no-provider case with bounds, a part's id as the name a bound uses, and the headless prompt and grant when bounds alone are declared. README config reference: add an `assignments` subsection beside Architecture provider. `NEXT_STEPS.md`: mark `assignment-bounds` done (plan 3 landed, spec complete).

### Planned files to create

- `docs/assignment-bounds.md`

### Planned files to edit

- `src/domain/architecture/render.ts`
- `src/cli/commands/architecture.ts`
- `src/domain/authoring/prompt.ts`
- `src/domain/security/agentCommands.ts`
- `src/app/authorArtifact.ts`
- `src/cli/commands/artifact.ts`
- `src/cli/cliDocs.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`
- `README.md`
- `docs/architecture-provider.md`
- `site/pages.ts`
- `site/build/sources.ts`
- `NEXT_STEPS.md`
- `.claude/skills/phax-planning/SKILL.md`
- `.claude/skills/phax-cli/SKILL.md`
- `tests/unit/architecture/render.test.ts`
- `tests/integration/architectureCommand.test.ts`
- `tests/unit/authoringPrompt.test.ts`
- `tests/unit/security/agentCommands.test.ts`
- `tests/integration/authorArtifact.test.ts`
- `tests/integration/authorArtifactRetry.test.ts`
- `tests/unit/skills.test.ts`

### Optional files that may be edited

- `src/cli/program.ts`
- `src/domain/session/claudePermissionFlags.ts`
- `tests/integration/persistedProducer.test.ts`
- `tests/integration/architectureProvider.test.ts`

### Boundary contracts

`phax architecture` and headless authoring need to know whether bounds are declared, and what the bounds are. phase-01 provides this as `ResolvedConfig.assignments?: Assignments` from `src/schemas/assignments.ts`. The CLI renders the bounds through the pure `renderAssignmentBounds(bounds, source)` in `src/domain/architecture/render.ts` and makes no decision of its own. The authoring use case (`src/app/authorArtifact.ts`) receives `assignmentBounds: boolean` from its command and passes it to the pure prompt builder and grant function. Neither runs a provider before the session, and neither lists a bound.

### Test strategy

Write these first, before implementation. (1) `tests/unit/architecture/render.test.ts`: the bounds section for the §6 bounds and report, in list order, with the part name and globs; the no-provider marks; a scoped report missing a part; a whole report missing a part; and a range with `min` equal to `max`. (2) `tests/unit/authoringPrompt.test.ts`: the three bullets (bounds only, provider with and without bounds, neither), none listing a bound. (3) `tests/unit/security/agentCommands.test.ts`: the grant for plan + provider, plan + bounds, plan + neither, and spec. Then integration, with fakes and made-up fixtures. `tests/integration/architectureCommand.test.ts` covers the §6 bounds after the parts (exit 0); no provider with bounds (line, then bounds, exit 1); no provider and no bounds (exactly one line, exit 1); and a provider failure with bounds (one stderr line, no bounds). `tests/integration/authorArtifact.test.ts` checks that a plan session with bounds alone is granted `phax architecture` and that no provider ran before the session. Update `tests/integration/authorArtifactRetry.test.ts` fixtures for the new input field. `tests/unit/skills.test.ts` asserts the new "Choosing a model and effort" text (first-match governing bound, conformity, default fallback, reading the bounds through `phax architecture` even on exit 1), and that the skill has neither `modelReason` nor the old bold label. The usage-spec drift test covers the regenerated `phax.usage.kdl`.

### Implementation order

1. `renderAssignmentBounds` and its unit test.
2. The `phax architecture` command and its integration test.
3. The prompt bullet, the grant, and the authorArtifact and artifact command wiring, with their tests.
4. The phax-planning and phax-cli skills, and `tests/unit/skills.test.ts`.
5. The cliDocs long help, then `pnpm gen:usage-spec` and `pnpm docs:cli`.
6. `docs/assignment-bounds.md`, site registration, `docs/architecture-provider.md`, the README and NEXT_STEPS.md.
7. Run the `standard` gate profile.

### Excluded scope

- The bounds check, lint, the run preflight and validate behaviour: phase-01 (only their help text and docs change here).
- Spec authoring prompts and grants: unchanged.
- The architecture request's shape and the report's shape.
- `docs/upgrading.md`: plan 2 already carries the 0.26.0 step.
- Any new command, grant or permission beyond `phax architecture` for a plan session with bounds alone.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

Give the final rendered bounds section and the three prompt bullets verbatim. List every doc and skill section changed. Confirm `phax.usage.kdl` and `docs/cli/reference.md` were regenerated with the package scripts. Confirm the skills contain neither `modelReason` nor the old bold label. Explain every deviation phax flags from the planned file lists, including whether `src/cli/program.ts` needed the `validate` help wiring.

### Commit subject

`feat(architecture): show the assignment bounds after the parts and send the planner to them`

### Commit body

`phax architecture` now lists the bounds after the parts, each as `assignments[N]`, with a part bound showing its part's name and globs. A bound whose part a path-scoped report does not carry is marked as such. With no provider and bounds declared, the command prints its no-provider line, then the bounds with part bounds marked unresolved, and still exits 1.

The headless plan prompt sends the planner to `phax architecture` whenever a provider or bounds are configured. The read-only session is granted the command in both cases. With neither, the prompt and the grant are unchanged.

The phax-planning skill teaches the first-match governing bound, conformity, the policy default as the fallback, and reading the bounds through `phax architecture`. The phax-cli skill, the CLI help, the usage spec, the CLI reference, the README, the architecture provider page and a new assignment bounds page follow.
