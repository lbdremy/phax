# Plan — Interactive `phax init` (npm-init-style wizard)

Make `phax init` interactive instead of "write a stub and walk away". Today
`initProject` (`src/app/initProject.ts`) writes a minimal `phax.json` with a
placeholder `gateProfiles.fast` (`echo 'replace with…'`) and tells the user to
edit it by hand. This plan turns `init` into a guided wizard — like `npm init` —
that prompts for the required fields and the key opt-in toggles, pre-filling
sensible defaults detected from the surrounding project.

## Prerequisites — plans 12 and 22 land first

This plan assumes **plan 12 (`docs/plans/12-project-namespace-plan.md`) and
plan 22 (`docs/plans/22-config-user-project-split-plan.md`) have already
merged**. Every reference below targets the post-12 **and** post-22 shape. If
either has not landed when you start, stop — the schema this wizard writes will
not match.

After plan 12 the config shape is: a **required top-level `name`** field
(slug-validated via the `Namespace` brand, `^[a-z][a-z0-9-]*$`), and the
`project` struct is **removed** — `project.name` became `name` and
`project.type` (`single-package`/`monorepo`) is **deleted** (monorepo behaviour
comes from `workspaces[]`).

After plan 22 the configuration is split into layers and the wizard targets the
committed **project** file only:

- The project `phax.json`'s `state` block is now **optional** and is **no longer
  written** into generated config — the state root defaults to `~/.phax` in the
  resolver / user layer. `buildPhaxConfig` must therefore omit `state` entirely
  (writing it would re-introduce exactly what plan 22 removed).
- Schema emission now produces **two** files: `phax.schema.json` (project) and
  `phax.user.schema.json` (the user-overlay layer). `writeConfigSchemaFile` /
  `upgradeConfigSchema` were extended by plan 22 to emit both; the wizard reuses
  that and writes both.
- User layers (`~/.phax/config.json`, `phax.local.json`) are **not** scaffolded
  by `init` — the wizard only prompts for project-baseline settings (`name`,
  gate commands, `review.compliance`, `publish`) and writes the committed
  project file. Per-developer overrides (state root, `agent.*`, `security.mcp`)
  keep their defaults and are added by hand to a user layer later.

## Design decisions (resolved during planning)

These were settled with the maintainer before writing the plan. If you disagree,
stop before phase-01 — they shape every phase.

- **Prompt library: `@clack/prompts`.** Smallest TypeScript-first option with a
  good "npm-init" UX (select / multiselect / confirm / text with validation).
  It is promise-based, so it is wrapped behind a new `Prompt` **port** (Effect
  ops) — no `@clack/*` import is allowed outside `src/infra/`. This keeps the
  four-layer boundaries intact.
- **Scope: required fields + key toggles only.** The wizard prompts for the
  top-level `name` (slug) and the gate commands (the real pain point), then
  offers on/off toggles for **compliance review** (`review.compliance`) and
  **publish** (`publish` — push branch / create PR). It does *not* prompt for
  security profile, network/mcp, `agent.*`, or `fileReconciliation` — those keep
  their schema defaults and are edited by hand. It does **not** prompt for a
  project type (deleted by plan 12). Note: the schema has a single
  `review.compliance` toggle; there is no separate "performance review".
- **`name` is slug-validated.** The `name` prompt validates input against the
  `Namespace` brand (`^[a-z][a-z0-9-]*$`); the suggested default is derived by
  slugifying the detected name. The wizard never writes an invalid `name`.
- **Pre-fill from `package.json` only.** Detect the `name` default (slugified
  from `package.json` `name` — strip any `@scope/`, lowercase, replace invalid
  chars with `-`; fallback to a slugified directory basename) and **suggest gate
  commands** from existing scripts (`typecheck`, `lint`, `test`/`test:unit`,
  `format`/`format:check`, `build`), prefixed with the detected package manager
  (`packageManager` field → `pnpm`/`npm`/`yarn`, fallback `pnpm`).
- **No monorepo / type handling.** Do **not** read `pnpm-workspace.yaml`, infer
  `monorepo`, or write any `project.type` / `workspaces` — those are out of
  scope (plan 12 removed the type field).
- **No git-remote detection.** `publish.remote` keeps its default `origin`. The
  wizard only toggles `publish.enabled`, `publish.pushBranch`,
  `publish.createPullRequest`.
- **Interactivity is decided in the CLI layer.** The app use case receives an
  explicit `interactive: boolean`; the CLI computes it from `process.stdin.isTTY`
  and the `--yes` flag. When non-interactive, the wizard writes a config built
  from detected defaults with toggles off — no prompts, never hangs in CI.
- **The schema-writing helpers stay (as extended by plan 22).**
  `writeConfigSchemaFile` and `upgradeConfigSchema` (used by the `schema`
  command) keep their plan-22 behavior of emitting both `phax.schema.json` and
  `phax.user.schema.json`. The new wizard reuses the same serialization and
  likewise writes both schema files.

## Required commands

- (none)

No new tool/runtime/CLI is introduced. `@clack/prompts` is a library
dependency, not an agent command; `pnpm` is already in use.

## phase-01 — Prompt port, clack adapter, and fake {#phase-01-prompt-port}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Introduce a `Prompt` port so later phases can ask the user questions through
Effect dependency injection, with a `@clack/prompts`-backed adapter and a
scripted fake for tests. No command consumes it yet.

### Detailed instructions

- Add `@clack/prompts` (^1.6.0) to `dependencies` in `package.json` and install
  so `pnpm-lock.yaml` updates.
- Create `src/ports/prompt.ts` following the existing port shape
  (`src/ports/editor.ts` / `src/ports/fs.ts`):
  - A `PromptError extends Data.TaggedError("PromptError")<{ message; cause? }>`
    for adapter failures.
  - A `PromptCancelled extends Data.TaggedError("PromptCancelled")<{}>` for when
    the user aborts (clack cancel symbol / Ctrl-C).
  - A `PromptOps` interface whose methods return `Effect`:
    - `text(opts: { message: string; placeholder?: string; defaultValue?: string; required?: boolean; validate?: (value: string) => string | undefined }): Effect.Effect<string, PromptError | PromptCancelled>` — `validate` returns an error message string to reject input, or `undefined` to accept (passed straight to clack's `validate`)
    - `confirm(opts: { message: string; initialValue?: boolean }): Effect.Effect<boolean, PromptError | PromptCancelled>`
    - `select<A>(opts: { message: string; options: ReadonlyArray<{ value: A; label: string; hint?: string }>; initialValue?: A }): Effect.Effect<A, PromptError | PromptCancelled>`
    - `multiselect<A>(opts: { message: string; options: ReadonlyArray<{ value: A; label: string; hint?: string }>; initialValues?: ReadonlyArray<A>; required?: boolean }): Effect.Effect<ReadonlyArray<A>, PromptError | PromptCancelled>`
    - `note(message: string, title?: string): Effect.Effect<void, PromptError>`
    - `intro(message: string): Effect.Effect<void, PromptError>` and
      `outro(message: string): Effect.Effect<void, PromptError>`
  - A `Prompt extends Context.Tag("phax/Prompt")<Prompt, PromptOps>()` tag.
- Create `src/infra/prompt.ts` exporting `makeClackPromptLayer(): Layer.Layer<Prompt>`
  (mirror `src/infra/editor.ts`):
  - Wrap each clack call in `Effect.tryPromise`.
  - After every clack call, detect `clackPrompts.isCancel(result)` and fail with
    `PromptCancelled` instead of returning the cancel symbol.
  - Map thrown errors to `PromptError`.
- Create `src/infra/fakes/prompt.ts` (mirror `src/infra/fakes/editor.ts`):
  - `FakePromptImpl` takes a scripted queue of answers (one per call, in order),
    records the prompts it was asked (`asks: string[]`), and returns the next
    scripted answer. Provide a way to script a `PromptCancelled` for a given step.
  - Export `makeFakePrompt(answers)` returning `{ impl, layer }`.
- Register the fake in `src/infra/fakes/index.ts`.

### Planned files to create

- `src/ports/prompt.ts`
- `src/infra/prompt.ts`
- `src/infra/fakes/prompt.ts`
- `tests/unit/fakePrompt.test.ts`
- `tests/type/prompt.ts`

### Planned files to edit

- `src/infra/fakes/index.ts`
- `package.json`
- `pnpm-lock.yaml`

### Optional files that may be edited

- (none)

### Boundary contracts

Producer: `src/infra/prompt.ts` provides the `Prompt` tag via a Layer.
Consumer (future, phase-03): the init wizard requires `Prompt` in its `R`
channel. The stable contract is the `PromptOps` interface in `src/ports/prompt.ts`
— Effect-returning methods, failures expressed only as `PromptError` /
`PromptCancelled`. No `@clack/*` type leaks across the port.

### Test strategy

- Ports layer → type/contract test: `tests/type/prompt.ts` asserts `PromptOps`
  method signatures and that `FakePromptImpl` is assignable to `PromptOps`.
- Adapter/fake → unit test: `tests/unit/fakePrompt.test.ts` exercises the fake
  (scripted answers returned in order, `asks` recorded, scripted cancel fails
  with `PromptCancelled`). Write this test before the fake implementation.
- The clack adapter itself is not unit-tested (it drives a real TTY); it is
  covered indirectly by the CLI smoke path in phase-04.

### Implementation order

Port interface → fake (+ its unit/type tests) → clack adapter.

### Excluded scope

- Any wizard logic or command wiring (phases 03–04).
- Detection / schema work (phase-02).

### Verification

- The `fast` gate profile in `phax.json` (`pnpm format`, `pnpm typecheck`,
  `pnpm test:unit`). `knip`/`lint` run in the final phase's `full` profile, so
  the as-yet-unconsumed adapter export is expected and not flagged here.

### Expected handoff content

- The exact path `src/ports/prompt.ts` and the full `PromptOps` signature.
- The `makeClackPromptLayer` and `makeFakePrompt(answers)` signatures and import
  paths.
- That `@clack/prompts` is now a dependency.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(ports): add Prompt port with clack adapter and fake

### Commit body

Add a Prompt port (text/confirm/select/multiselect/note/intro/outro) returning
Effects, a @clack/prompts-backed adapter that maps cancellation to a
PromptCancelled error, and a scripted fake for tests. No command consumes it
yet; it backs the interactive init wizard in a later phase.

## phase-02 — package.json schema and default detection {#phase-02-detect-defaults}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Add the pure logic that turns the surrounding project into wizard defaults:
decode `package.json` through a schema and derive the suggested project name and
gate-command suggestions. No I/O and no prompting here — pure functions over
already-parsed input.

### Detailed instructions

- Create `src/schemas/packageJson.ts`: an Effect Schema decoding the *subset* of
  `package.json` the wizard needs — `name` (optional string), `scripts`
  (optional `Record<string, string>`), `packageManager` (optional string). Use a
  lenient decode (do not error on excess properties — `package.json` has many
  unrelated keys). Export a `decodePackageJson` (Either-returning) following the
  pattern in `src/schemas/phaxConfig.ts`.
- Create `src/domain/init/detect.ts` with pure functions:
  - `slugify(raw: string): string` — strip any leading `@scope/`, lowercase,
    replace runs of invalid characters with `-`, trim leading/trailing `-`, and
    ensure the result starts with a letter (prefix `p-` if it would start with a
    digit/`-`). The output must satisfy the `Namespace` brand
    (`^[a-z][a-z0-9-]*$`).
  - `detectName(pkg, cwdBasename): string` — `slugify(pkg.name)` if `pkg.name`
    is non-empty, else `slugify(cwdBasename)`, else `"project"`. This is only a
    *suggested default*; the wizard still validates the final value through the
    `Namespace` brand (phase-03).
  - `detectPackageManager(pkg): "pnpm" | "npm" | "yarn"` — parse the
    `packageManager` field prefix; fallback `"pnpm"`.
  - `suggestGateCommands(pkg, pm): ReadonlyArray<{ script: string; command: string; recommended: boolean }>` —
    for each known script key present in `pkg.scripts`
    (`typecheck`, `lint`, `test`, `test:unit`, `format`, `format:check`,
    `build`), produce `{ script, command: "<pm> <script>", recommended }`.
    Mark `typecheck`, `lint`, `test`/`test:unit` as `recommended: true`; prefer
    `test:unit` over `test` when both exist (only the more specific is
    recommended). Preserve a stable, sensible ordering.
- These functions take already-parsed inputs only; reading the file happens in
  phase-03 via the `FileSystem` port.

### Planned files to create

- `src/schemas/packageJson.ts`
- `src/domain/init/detect.ts`
- `tests/unit/initDetect.test.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- (none)

### Boundary contracts

Producer: `src/domain/init/detect.ts` (pure domain) and
`src/schemas/packageJson.ts` (boundary decoder). Consumer (phase-03): the app
wizard decodes the file text through `decodePackageJson`, then calls the detect
functions to seed prompt defaults. Contract: detect functions never perform I/O
and accept the decoded `PackageJson` type plus the cwd basename.

### Test strategy

- Domain → unit tests (`tests/unit/initDetect.test.ts`), written before
  implementation: cover `slugify` (scoped `@org/foo` → `foo`, uppercase/spaces/
  dots → hyphens, digit-leading → `p-`-prefixed, output always matches the
  `Namespace` brand), `detectName` (name present / empty / missing → falls back
  to slugified basename), `detectPackageManager` (pnpm/npm/yarn/missing), and
  `suggestGateCommands` (no scripts → empty; subset present → correct commands,
  ordering, recommended flags, `test:unit` preferred over `test`). Include a
  schema-decode case for a realistic `package.json` with extra unrelated keys.

### Implementation order

Schema → detect functions → tests (write the unit tests first per above).

### Excluded scope

- Reading any file from disk (phase-03 does that via the port).
- Building the `PhaxConfig` object (phase-03).
- Monorepo / `pnpm-workspace.yaml` detection (explicitly out of scope).

### Verification

- The `fast` gate profile in `phax.json`.

### Expected handoff content

- The exact paths and exported signatures of `decodePackageJson`, `slugify`,
  `detectName`, `detectPackageManager`, and `suggestGateCommands`, including the
  `PackageJson` type name and that `slugify`/`detectName` output satisfies the
  `Namespace` brand.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(init): add package.json schema and gate-command detection

### Commit body

Add a lenient package.json schema decoder and pure detection helpers that derive
the suggested slug name, package manager, and gate-command suggestions from
existing scripts. The name suggestion is slugified to satisfy the Namespace
brand. Pure domain + boundary decoder, fully unit-tested; consumed by the
interactive init wizard in a later phase.

## phase-03 — Interactive wizard orchestration {#phase-03-wizard}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** high

Add the Effect-based wizard that ties prompts, detection, and config assembly
together, and writes `phax.json` + both schema files (`phax.schema.json` and
`phax.user.schema.json`) through ports. Both an
interactive path (prompts) and a non-interactive path (detected defaults, no
prompts) are produced from one code path.

### Detailed instructions

- Create `src/domain/init/buildConfig.ts` with a pure
  `buildPhaxConfig(answers): PhaxConfig` that assembles a valid `PhaxConfig`
  object from resolved answers: `version: 1`, `$schema: "./phax.schema.json"`,
  top-level `name` (the slug — no `project` struct, no `type`), a `gateProfiles`
  map built from the chosen gate commands (profile name `fast`; if no commands
  were chosen, fall back to the existing placeholder `echo` so the profile stays
  non-empty), and only-when-enabled `review.compliance` / `publish` blocks (omit
  them entirely when toggled off so schema defaults apply). Do **not** write a
  `state` block — after plan 22 it is optional and the state root defaults in the
  resolver / user layer. The result must satisfy the post-22 `PhaxConfigSchema`
  (in which `state` is optional).
- Create `src/app/initWizard.ts` exporting
  `runInitWizard(input: { cwd: string; force?: boolean; interactive: boolean }): Effect.Effect<InitResult, PromptCancelled, Prompt | FileSystem>`:
  - Resolve `configPath`/`schemaPath` under `cwd`.
  - Read existing `phax.json` via `FileSystem.exists` / `readText`. If it exists
    and `!force` and `!interactive`, return `{ kind: "already_initialized" }`
    (preserve today's behavior). If it exists and `interactive`, decode it and
    use its values as prompt defaults (npm-init re-run feel) after confirming
    reconfiguration.
  - Read `package.json` via `FileSystem` (tolerate absence), decode through
    `decodePackageJson`, and compute detection defaults (phase-02 helpers).
  - **Interactive path:** `intro`, then prompt:
    - `text` for the top-level `name` slug (default = detected name), passing a
      `validate` that decodes through the `Namespace` brand and returns the
      brand's error message on failure — the wizard never accepts an invalid
      slug. No project-type prompt (plan 12 removed the field).
    - `multiselect` gate commands from `suggestGateCommands` (recommended ones
      pre-checked); if scripts are absent, a `text` fallback for one command.
    - `confirm` enable compliance review (default false). When enabled, keep the
      schema's default model/effort — do not prompt for them.
    - `confirm` enable publish (default false). When enabled, `confirm`
      push-branch (default true) and create-PR (default true).
    - `outro` with next steps.
  - **Non-interactive path:** skip all prompts; use detected defaults, all
    recommended gate commands selected, toggles off.
  - Build the config via `buildPhaxConfig`, serialize, and write `phax.json`
    (via `FileSystem.writeAtomic`) plus **both** schema files — `phax.schema.json`
    and `phax.user.schema.json` — reusing the same serialization as
    `writeConfigSchemaFile` from `src/app/initProject.ts` (as extended by plan
    22), written via the port. Return `{ kind: "created", … }`.
  - A `PromptCancelled` propagates out of the Effect so the CLI can print a
    clean "aborted" message (phase-04).
- Leave `src/app/initProject.ts`'s `writeConfigSchemaFile` / `upgradeConfigSchema`
  in place (with their plan-22 behavior of emitting both the project and
  user-overlay schemas); if helpful, export pure serialization helpers for both
  schema files from it and reuse them in the wizard (edit allowed for that
  extraction only).

### Planned files to create

- `src/domain/init/buildConfig.ts`
- `src/app/initWizard.ts`
- `tests/unit/buildConfig.test.ts`
- `tests/integration/initWizard.test.ts`

### Planned files to edit

- `src/app/initProject.ts`

### Optional files that may be edited

- (none)

### Boundary contracts

Consumer: `runInitWizard` requires `Prompt` and `FileSystem` in `R`; the CLI
(phase-04) provides `makeClackPromptLayer()` and the node FileSystem layer.
Producer: returns the existing `InitResult` shape so the CLI renderer is
unchanged in spirit. `buildPhaxConfig` (domain) crosses no boundary — pure,
returns a value satisfying `PhaxConfigSchema`.

### Test strategy

- Domain → unit (`tests/unit/buildConfig.test.ts`, written first): top-level
  `name` written (no `project`/`type` keys); **no `state` key written**; toggles
  off → no `review`/`publish` keys; toggles on → correct blocks; gate commands →
  `fast` profile; empty selection → placeholder fallback; output decodes cleanly
  through `decodePhaxConfig`.
- Application command → integration with fake ports (`tests/integration/initWizard.test.ts`):
  drive `runInitWizard` with `makeFakePrompt(scriptedAnswers)` and the fake
  FileSystem; assert the written `phax.json` content for both an interactive run
  and a non-interactive run (including the absence of a `state` block), that
  **both** `phax.schema.json` and `phax.user.schema.json` are written, the
  `already_initialized` path, and that a scripted cancel surfaces
  `PromptCancelled` and writes nothing.

### Implementation order

`buildConfig` (+ unit test) → `initWizard` Effect → integration tests.

### Excluded scope

- CLI flag parsing, TTY detection, and layer provision (phase-04).
- Changing the `schema` command or the legacy upgrade helpers (beyond an
  optional pure-serialization extraction).

### Verification

- The `fast` gate profile in `phax.json`.

### Expected handoff content

- The exact `runInitWizard` signature, its `R` requirements
  (`Prompt | FileSystem`) and error channel (`PromptCancelled`), and the
  module path `src/app/initWizard.ts`.
- The `buildPhaxConfig` signature and where the schema serialization is reused.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(init): add interactive init wizard orchestration

### Commit body

Add an Effect-based init wizard that reads package.json via the FileSystem port,
prompts via the Prompt port for the top-level name slug (validated via the
Namespace brand), gate commands, and the compliance-review / publish toggles,
then assembles and writes phax.json (no state block, per plan 22) plus both
phax.schema.json and phax.user.schema.json. A non-interactive path reuses the
same code with detected defaults and no prompts. Covered by domain unit tests
and fake-port integration tests.

## phase-04 — CLI wiring, TTY/--yes handling, and docs {#phase-04-cli-wiring}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Wire the wizard into the `init` command: provide the real layers, decide
interactivity from the TTY and a new `--yes` flag, render cancellation cleanly,
and update the README. This is the surface that makes the feature user-visible.

### Detailed instructions

- Edit `src/cli/commands/init.ts`:
  - Make `runInit` async and return a `Promise<number>`.
  - Compute `interactive = Boolean(process.stdin.isTTY) && !opts.yes` (TTY check
    lives here, in the CLI layer, not in the app).
  - Build the wizard Effect, `Effect.provide` `makeClackPromptLayer()` and the
    node FileSystem layer, run with `Effect.runPromise(Effect.either(...))`
    (mirror `src/cli/commands/open.ts`).
  - On `PromptCancelled`, print a friendly "init aborted, no changes written"
    via `OutputPort` and return a non-zero (or 0) code consistently; on other
    errors, print the message and return 1.
  - Preserve the `already_initialized` and `created` rendering and the existing
    "Next:" guidance.
- Edit `src/cli/program.ts`:
  - Add `.option("--yes", "Accept detected defaults without prompting")` to the
    `init` command (keep `--force`).
  - Make the action `async` and `await runInit(opts, consoleOutput)`.
- Update `README.md`: document the interactive `phax init`, the `--yes`
  non-interactive mode, and the `--force` reconfigure behavior.

### Planned files to create

- `tests/integration/initCommand.test.ts`

### Planned files to edit

- `src/cli/commands/init.ts`
- `src/cli/program.ts`
- `README.md`

### Optional files that may be edited

- `tests/integration/cliProgram.test.ts`

### Boundary contracts

Consumer: the `init` command provides `Prompt` (clack) and `FileSystem` (node)
layers to `runInitWizard` and renders the `InitResult` via `OutputPort`. The CLI
file stays thin — no business logic; it only parses args, computes interactivity,
provides layers, calls one use case, and renders.

### Test strategy

- CLI → integration smoke (`tests/integration/initCommand.test.ts`): run the
  command non-interactively (`--yes`) in a temp dir with a fixture
  `package.json`; assert exit code, the created `phax.json` (with no `state`
  block) and both `phax.schema.json` and `phax.user.schema.json`, the top-level
  `name` slug derived from the fixture, and that gate commands were detected.
  Cover `--force` reconfigure and the "already initialized" non-interactive path.
- The clack TTY path is not driven in tests; the non-interactive path exercises
  the full wiring.

### Implementation order

`init.ts` async + layer provision → `program.ts` flag/await → README → tests.

### Excluded scope

- Any change to wizard logic or detection (phases 02–03).
- Security profile / network / mcp prompts (out of scope by design).

### Verification

- The `full` gate profile in `phax.json` (`pnpm format`, `pnpm typecheck`,
  `pnpm lint`, `pnpm format:check`, `pnpm knip`, `pnpm test`,
  `pnpm audit:architecture`, `pnpm build`, `pnpm deno:smoke`,
  `pnpm deno:smoke-binary`). This final phase must pass `knip` (the prompt
  adapter is now consumed), `lint`, `audit:architecture` (no port-bypassing
  I/O in the new code), and `build`.

### Expected handoff content

- That `phax init` is now interactive by default, non-interactive under `--yes`
  or a non-TTY stdin, and reconfigures under `--force`.
- The final `runInit` signature and the layers it provides.
- Confirmation the `full` gate passed, and any deviation from the planned file
  lists with the reason.

### Commit subject

feat(cli): make phax init an interactive wizard

### Commit body

Wire the init wizard into the CLI: provide the clack Prompt and node FileSystem
layers, decide interactivity from process.stdin.isTTY and a new --yes flag,
render cancellation cleanly, and keep --force for reconfiguration. Update the
README and add an integration smoke test for the non-interactive path. Verified
by the full gate profile.
