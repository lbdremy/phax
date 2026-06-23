# Plan — Usage-Based CLI Help, Documentation, and Completions

Implements `docs/specs/13-usage-cli.md`.

This plan integrates [Usage](https://usage.jdx.dev/) as PHAX's explicit,
validated CLI contract. Commander.js remains the runtime router; a hand-authored
`phax.usage.kdl` becomes the canonical CLI spec, and an automated parity check
keeps Commander and the Usage spec from drifting. From the spec's two acceptable
models, this plan chooses **model 2** (dedicated `phax.usage.kdl` with parity
checks against Commander) because the Commander→Usage derivation path is an open
question and carries more risk than a hand-authored spec gated by a parity test.

## Open questions resolved by this plan

- **Spec source model:** dedicated `phax.usage.kdl`, parity-checked against the
  live Commander tree (not derived from Commander).
- **`--usage` output:** prints the packaged KDL spec to stdout (exit `0`) with no
  external dependency. `--usage --usage-format json` is explicit and shells out
  to the `usage` CLI, failing with an actionable error if `usage` is absent.
- **`phax completions <shell>`:** generated via the external `usage` CLI; the
  command fails with a clear, actionable error when `usage` is not installed.
  This dependency is documented explicitly.
- **Command surface:** the canonical list is the **live Commander tree** of the
  current codebase (see Phase 01 inventory), not the spec's illustrative minimum.
  This includes `init`, the nested `agent`, `security`, `skills`, and `schema`
  families, and excludes the `*-last` commands (`shell-last`, `path-last`,
  `open-last`, `archive-last`), which are removed before this plan runs. Whatever
  the live tree contains at authoring time is what the KDL must cover; the parity
  gate enforces this automatically.

## Required commands

- usage

`usage` is the external [Usage CLI](https://usage.jdx.dev/cli/). It is invoked by
documentation generation, completion generation, the JSON form of `--usage`, and
the lint/parity vitest tests. `pnpm` and `git` are already in use and are not
declared here. The `man`/manpage path is deferred (see Excluded scope) so no
`man` command is required.

## Required PHAX security configuration changes

None. `usage` is already present in `security.agentCommands` in `phax.json`
(current value: `["deno", "ctx7", "usage"]`), so the phases that shell out to the
`usage` CLI (spec lint, doc generation, completions, parity tests) pass the
preflight check as-is.

## Architecture overview

- **Canonical contract:** `phax.usage.kdl` at the repo root, shipped in the npm
  package via a new `files` allowlist.
- **Runtime exposure:** `phax --usage[ --usage-format json]` and
  `phax completions <shell>` read/transform the packaged KDL.
- **Generated artifacts:** `docs/cli/reference.md` (markdown reference) and a
  README CLI section, both regenerated from the KDL and drift-checked.
- **Drift defenses (all routed through existing gates as vitest tests):**
  - Usage spec lints clean (`usage lint`).
  - Generated docs match the committed files (regenerate-and-compare).
  - Commander↔Usage parity: every public Commander command/flag is present in
    the KDL and vice versa.
- **Testability seam:** `main.ts` is refactored into an exported
  `buildProgram()` factory so tests and the parity check can construct and walk
  the command tree without executing it.

All new validation is implemented as vitest tests so the existing `full` gate
profile in `phax.json` (which runs `pnpm test`) verifies them mechanically — no
new gate commands are invented.

---

## phase-01 — CLI program factory and surface inventory {#phase-01-program-factory}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Refactor the CLI entry into an exported `buildProgram()` factory (without parsing
argv) and capture the current Commander surface in a committed inventory
document. This gives every later phase a testable, introspectable program object
and a written source-of-truth for authoring the Usage spec.

### Detailed instructions

- Create `src/cli/program.ts` exporting `buildProgram(): Command` that contains
  all command registration currently in `src/cli/main.ts`, including the dynamic
  registrations (`registerResumeCommand`, `registerResetPhaseCommand`,
  `registerAgentCommand`, `registerSecurityCommand`, `registerSkillsCommand`,
  `registerSchemaCommand`) and the `globalTraceOpts` helper. `buildProgram` must **not** call
  `parseAsync`, `process.exit`, or `setupInterruptHandlers`; it only constructs
  and returns the configured `Command`. Keep all command names, aliases,
  arguments, options, defaults, and descriptions byte-identical — this is a
  pure move, not a behavior change.
- Reduce `src/cli/main.ts` to a thin entry: call `setupInterruptHandlers()`,
  build the program via `buildProgram()`, then `parseAsync(process.argv)` with
  the existing top-level `.catch` error handler. The `bin` target
  (`dist/cli/main.js`) and runtime behavior must be unchanged.
- The hardcoded `.version("0.1.0")` stays as-is in this phase (sourcing it from
  package.json is Phase 03's concern).
- Write `docs/cli/inventory.md`: a comparison table of the **current** Commander
  surface (command name, args, flags + defaults, one-line description) versus the
  intended Usage contract coverage. Walk the live tree by importing
  `buildProgram()` in a throwaway local check if helpful, but the committed file
  is hand-authored prose/table. Explicitly note the nested `agent`, `security`,
  `skills`, and `schema` subcommand families, and the top-level `init` command.
  The `*-last` commands are removed before this plan runs, so they should not
  appear in the inventory.
- Add `tests/integration/cliProgram.test.ts` that calls `buildProgram()` and
  asserts the set of top-level command names matches the known surface (a frozen
  list in the test), and that `agent`, `security`, `skills`, and `schema` expose
  their documented subcommands. This is the mechanical guard against accidental
  command loss.

### Planned files to create

- `src/cli/program.ts`
- `tests/integration/cliProgram.test.ts`
- `docs/cli/inventory.md`

### Planned files to edit

- `src/cli/main.ts`

### Optional files that may be edited

- (none)

### Boundary contracts

CLI surface → tests/tooling: `buildProgram(): Command` is the stable seam every
later phase consumes. Producer is `src/cli/program.ts`; consumers are the entry
(`main.ts`), the `--usage`/`completions` commands, and the parity test. The
contract is "returns a fully-configured Commander program with no side effects."

### Test strategy

CLI/program layer → integration smoke test (`tests/integration/cliProgram.test.ts`).
Write it **before** completing the refactor so the byte-identical move is
verified as you go. No domain logic changes, so no unit tests are added.

### Implementation order

1. Add `tests/integration/cliProgram.test.ts` asserting the expected command set
   (initially against the existing `main.ts` if you extract a temporary builder).
2. Move construction into `src/cli/program.ts` with `buildProgram()`.
3. Slim `src/cli/main.ts` to the thin entry.
4. Author `docs/cli/inventory.md`.

### Excluded scope

- Authoring `phax.usage.kdl` (phase-02).
- Any change to command behavior, names, flags, or descriptions.
- Sourcing the version from package.json (phase-03).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact export `buildProgram(): Command` and its module path
  `src/cli/program.ts`, plus confirmation that `main.ts` no longer constructs
  commands.
- The frozen top-level command list used in the test, so phase-02 can author the
  KDL against it.
- Any deviation from the planned file lists, with the reason.

### Commit subject

refactor(cli): extract buildProgram factory and capture surface inventory

### Commit body

Move all Commander command registration out of main.ts into an exported
buildProgram() factory that performs no side effects, leaving main.ts as a thin
entry that builds and parses. Add an integration test asserting the top-level and
nested (agent/security) command surface, and a docs/cli/inventory.md comparison
of the current CLI against the intended Usage contract. Pure refactor — no
behavior change. Enables the Usage spec, --usage exposure, and the parity gate in
later phases.

---

## phase-02 — Author the canonical phax.usage.kdl spec {#phase-02-usage-spec}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** high

Hand-author `phax.usage.kdl` covering every public PHAX command, argument, flag,
default, example, and metadata field, and add a test that lints it with the
`usage` CLI. This is the canonical CLI contract all later phases build on.

### Detailed instructions

- Create `phax.usage.kdl` at the repo root following the
  [Usage spec format](https://usage.jdx.dev/spec/). Use the live surface from
  phase-01's `docs/cli/inventory.md` and `buildProgram()` as the authoritative
  list — cover **all** public commands, not just the spec's illustrative minimum:
  `validate`, `unlock`, `extract-plan`, `enter`, `enter-phase`, `session-info`,
  `shell`, `path`, `open`, `ls`, `archive`, `run`, `review-handoff`,
  `publish-pr`, `init`, `resume`, `reset-phase`, and the nested `agent` (`models`,
  `resolve`, `probe`, `setup …`, `providers`, …), `security` (`status`),
  `skills` (`install`), and `schema` (`upgrade`) command families. Confirm the
  exact nested subcommands and flags against the source while authoring. The
  `*-last` commands are removed before this plan runs, so do not author them.
- Include top-level metadata: CLI name `phax`, bin `phax`, version, license (if
  present in package.json), author/project name, and `min_usage_version`.
- For each command provide: a one-sentence purpose, arguments, flags with
  defaults where meaningful, long help for the commands that need context
  (`run`, `resume`, `init`, session/enter family,
  delayed execution via `--startAfter` if/when present), and at least one
  example. Honor the per-command documentation details in spec §"Required
  command documentation details" (e.g. `run` duration formats, `ls` status
  filters `--active|--failed|--review-open|--archived|--json`, `archive --force`,
  side-effect warnings for worktree/session/scheduled-run/file-affecting
  commands).
- Do **not** add commands that do not exist in the runtime (no `completions` yet
  — `completions` is added to the KDL in phase-05, `--usage` metadata in
  phase-03; and no `*-last` commands, which are removed before this plan runs).
  Keeping the KDL aligned to the runtime is what the parity gate enforces later.
- Match the accessibility requirements (spec §"Accessibility requirements"):
  short purpose statements, concrete examples, explicit side effects, no
  unexplained internal vocabulary, no terse descriptions for commands with
  important side effects.
- Add `tests/integration/usageSpecLint.test.ts` that shells out to
  `usage lint phax.usage.kdl` (confirm the exact lint invocation against
  <https://usage.jdx.dev/cli/reference/lint>) and asserts a clean exit. Treat
  warnings as errors. If `usage` is not installed the test should fail with a
  message naming the required `usage` CLI (it is a declared required command, so
  the run environment must provide it).

### Planned files to create

- `phax.usage.kdl`
- `tests/integration/usageSpecLint.test.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- `docs/cli/inventory.md`

### Boundary contracts

Usage contract → all consumers: `phax.usage.kdl` is the canonical artifact read
by `--usage` (phase-03), docs generation (phase-04), completions (phase-05), and
the parity gate (phase-06). The stable shape is "a lint-clean Usage KDL document
whose command tree mirrors the runtime Commander tree."

### Test strategy

CLI contract layer → integration test that invokes the real `usage` linter
(`tests/integration/usageSpecLint.test.ts`). Write it first so the spec is kept
lint-clean as it is authored.

### Implementation order

1. Add the lint test (red until the file exists and is clean).
2. Author metadata and the simplest commands.
3. Fill in the complex commands (`run`, `resume`, session/enter family) with long
   help and examples.
4. Add nested `agent`/`security` command trees.
5. Drive the lint test to green; resolve all warnings.

### Excluded scope

- `--usage` runtime exposure and packaging (phase-03).
- Markdown/README generation (phase-04).
- `completions` command and its KDL entry (phase-05).
- The Commander↔Usage parity gate (phase-06).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact path `phax.usage.kdl` and the metadata block (name, bin, version,
  min_usage_version) so phase-03 can read/validate it.
- The exact `usage lint` invocation used, so later phases reuse it.
- Confirmation of the full command/subcommand list authored, flagging any
  runtime command intentionally omitted and why.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(cli): add canonical phax.usage.kdl spec covering all commands

### Commit body

Add a hand-authored Usage KDL contract covering every public PHAX command,
argument, flag, default, example, and long help, plus CLI metadata (name, bin,
version, license, min usage version). Add an integration test that lints the spec
with the usage CLI and treats warnings as errors. Establishes the canonical CLI
contract consumed by --usage, docs generation, completions, and the parity gate.

---

## phase-03 — Expose `phax --usage` and ship the spec {#phase-03-usage-output}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Expose the canonical spec at runtime via `phax --usage` (KDL by default,
`--usage-format json` explicit), source the version from package.json, and
include the spec in the published npm package so installed binaries serve their
own version's contract.

### Detailed instructions

- Add a global `--usage` option (and `--usage-format <kdl|json>`, default `kdl`)
  in `buildProgram()`/`program.ts`. When `--usage` is present, print the spec to
  stdout and exit `0` before any subcommand dispatch.
  - `kdl`: read and print the packaged `phax.usage.kdl` verbatim — **no** runtime
    dependency on the `usage` CLI.
  - `json`: shell out to the `usage` CLI to convert KDL→JSON (confirm the exact
    subcommand against the usage CLI docs). If `usage` is not installed, fail with
    a clear, actionable error (exit non-zero) naming the missing `usage` CLI and
    how to install it — never a stack trace.
- Implement spec loading in `src/cli/commands/usage.ts`: resolve `phax.usage.kdl`
  relative to the package root in a way that works both in dev (repo root) and in
  the built/installed package (`dist`). Add a robust resolver (e.g. walk up from
  `import.meta.url` to the package root, or have the build copy the KDL next to
  `dist`); document the chosen approach in the handoff.
- Source the CLI version from package.json (replace the hardcoded `"0.1.0"` in
  the `.version(...)` call) and ensure the KDL `version` metadata and the runtime
  `--version` agree. If the simplest reliable approach is to keep them in sync via
  a test rather than a shared import, add that test.
- Add `"files"` to package.json so the published package includes
  `phax.usage.kdl`, `dist`, and `README.md` (and the generated docs once they
  exist). Ensure `phax --usage` works from the packaged layout.
- Add `tests/integration/usageOutput.test.ts`: build the program, invoke with
  `--usage` and assert it prints valid KDL and exits 0; assert the JSON path
  errors actionably when `usage` is unavailable (mock/guard) and that
  `--version`/KDL version agree.

### Planned files to create

- `src/cli/commands/usage.ts`
- `tests/integration/usageOutput.test.ts`

### Planned files to edit

- `src/cli/program.ts`
- `package.json`

### Optional files that may be edited

- `phax.usage.kdl`

### Boundary contracts

Packaged artifact → installed CLI: the `files` allowlist must include
`phax.usage.kdl` so the resolver in `usage.ts` finds it post-install. Producer:
package.json `files`; consumer: `loadUsageSpec()` in `src/cli/commands/usage.ts`.
Version: package.json `version` is the single source; KDL metadata and
`--version` must reflect it.

### Test strategy

CLI surface → integration test (`tests/integration/usageOutput.test.ts`) driving
`buildProgram()` with `--usage`. Write the KDL-path assertions before wiring; the
JSON error path is a guard test. Packaging is verified by `pnpm build` plus
the resolver test.

### Implementation order

1. Add `loadUsageSpec()` + resolver in `usage.ts` with a unit/integration test.
2. Wire the `--usage`/`--usage-format` global option in `program.ts`.
3. Source the version from package.json and reconcile KDL metadata.
4. Add the `files` allowlist; confirm `pnpm build` output.

### Excluded scope

- Markdown/README doc generation (phase-04).
- Completions (phase-05).
- Parity gate (phase-06).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The `--usage`/`--usage-format` option names and exit semantics.
- The KDL resolution strategy (dev vs installed) and the exact path resolved.
- The version-sourcing approach and how KDL/`--version` are kept in sync.
- The final package.json `files` list.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(cli): expose phax --usage and ship the spec in the package

### Commit body

Add a global --usage flag that prints the canonical phax.usage.kdl to stdout and
exits 0 with no external dependency, plus --usage-format json that converts via
the usage CLI and fails with an actionable error when usage is missing. Source
the CLI version from package.json and reconcile it with the KDL metadata and
--version. Add a files allowlist so the published package ships phax.usage.kdl,
and resolve it for both dev and installed layouts. Covered by integration tests.

---

## phase-04 — Generated markdown docs and drift gate {#phase-04-docs-generation}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Generate reproducible CLI markdown docs from the Usage spec, inject a concise
README command section, and add a drift test so docs cannot fall out of sync with
the contract.

### Detailed instructions

- Add a `docs:cli` script to package.json that regenerates docs from
  `phax.usage.kdl` using the `usage` CLI markdown generator (confirm the exact
  subcommand against <https://usage.jdx.dev/cli/markdown>). Output the full
  reference to `docs/cli/reference.md` and inject/update a bounded CLI section in
  `README.md` (use stable marker comments so regeneration is idempotent).
- Generation must be **reproducible**: running it twice with an unchanged KDL
  produces no diff. Commit the generated `docs/cli/reference.md` and the updated
  README section.
- The generated reference must include, per spec §"Documentation generation
  requirements": synopsis, arguments, flags, defaults, examples, side-effect
  notes, and config/env references where relevant. Keep the README section to the
  most important command summary only; full detail lives in `docs/cli/reference.md`.
- Add `tests/integration/docsCliDrift.test.ts` that regenerates the docs into a
  temp location (or in-memory) and asserts they byte-match the committed
  `docs/cli/reference.md` and README section. This routes the drift check through
  the existing `pnpm test` gate. The agent can drive generation directly via the
  declared `usage` command; the `pnpm docs:cli` wrapper is for human convenience.

### Planned files to create

- `scripts/docs-cli.ts`
- `docs/cli/reference.md`
- `tests/integration/docsCliDrift.test.ts`

### Planned files to edit

- `package.json`
- `README.md`

### Optional files that may be edited

- `phax.usage.kdl`

### Boundary contracts

Usage spec → docs: `docs/cli/reference.md` and the README marker section are pure
derivations of `phax.usage.kdl`. The drift test is the contract that the
committed artifacts equal a fresh generation.

### Test strategy

Generated-artifact layer → integration drift test
(`tests/integration/docsCliDrift.test.ts`). Write it first; it stays red until
the committed docs match a fresh generation.

### Implementation order

1. Add `scripts/docs-cli.ts` and the `docs:cli` package script.
2. Generate `docs/cli/reference.md` and inject the README section.
3. Add the drift test; confirm idempotent regeneration.

### Excluded scope

- Completions (phase-05).
- Parity gate (phase-06).
- Manpage generation (deferred — see plan-level Excluded scope).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact `docs:cli` invocation and the `usage` markdown subcommand used.
- The README marker comments delimiting the generated section.
- Confirmation that regeneration is idempotent (no diff on second run).
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(docs): generate CLI reference from Usage spec with drift gate

### Commit body

Add a docs:cli script that generates docs/cli/reference.md and a bounded README
CLI section from phax.usage.kdl via the usage CLI, idempotently. Commit the
generated reference and README section, and add an integration test that
regenerates and asserts byte-equality so docs cannot drift from the contract.
Routed through the existing pnpm test gate.

---

## phase-05 — Shell completion generation {#phase-05-completions}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Add `phax completions <shell>` that emits a completion script for the requested
shell from the Usage spec, with an explicit, actionable failure when the external
`usage` CLI is missing, and document installation.

### Detailed instructions

- Add `src/cli/commands/completions.ts` registering `completions <shell>` in
  `buildProgram()`. Constrain `<shell>` to `zsh|bash|fish` at minimum; add
  `powershell|nushell` only if the `usage` CLI supports them reliably (confirm at
  <https://usage.jdx.dev/cli/completions>). Reject unsupported values with an
  actionable error listing valid choices (no stack trace).
- Generate the completion script by shelling out to the `usage` CLI against
  `phax.usage.kdl` and write it to stdout so users can redirect it. If `usage` is
  not installed, fail with a clear, actionable error naming the dependency and
  how to install it (this is the chosen, explicit UX from the spec's two options).
- Add the `completions` command to `phax.usage.kdl` so the contract and the
  runtime agree (the phase-06 parity gate will enforce this).
- Document installation in `docs/cli/reference.md` regeneration and a short
  README note, including that the external `usage` CLI is required to generate
  completions. Provide the zsh/bash/fish redirect examples from the spec.
- Add `tests/integration/completions.test.ts`: assert valid shells produce a
  non-empty script (skip/guard if `usage` unavailable in the environment, but the
  declared required command means it should be present), assert an invalid shell
  errors with the choices list, and assert the missing-`usage` path produces the
  actionable error.

### Planned files to create

- `src/cli/commands/completions.ts`
- `tests/integration/completions.test.ts`

### Planned files to edit

- `src/cli/program.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`
- `README.md`

### Optional files that may be edited

- `scripts/docs-cli.ts`

### Boundary contracts

Usage spec → completions: the completion script is generated from
`phax.usage.kdl`. The `completions` command must exist in both the KDL and the
runtime program so the parity gate passes. Producer: `completions.ts`; consumer:
end users redirecting stdout to their shell's completion path.

### Test strategy

CLI surface → integration test (`tests/integration/completions.test.ts`)
covering the happy path per shell, invalid-shell rejection, and the
missing-dependency error path.

### Implementation order

1. Add the `completions` command to `phax.usage.kdl`.
2. Implement `completions.ts` (shell validation + usage invocation + error UX).
3. Register it in `program.ts`.
4. Regenerate docs (README note + reference) and update examples.
5. Add the integration test.

### Excluded scope

- Parity gate implementation (phase-06).
- Error UX for unknown commands/flags generally (phase-07).
- Manpage generation (deferred).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The supported shell set and the exact `usage` completion subcommand used.
- The actionable error text for missing `usage` and for invalid shells.
- Confirmation that the `completions` command is present in both the KDL and the
  runtime program (so the phase-06 parity gate will pass).
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(cli): add phax completions <shell> generated from the Usage spec

### Commit body

Add a completions command that emits zsh/bash/fish completion scripts from
phax.usage.kdl via the usage CLI to stdout, rejecting unsupported shells and
failing with an actionable error when the usage CLI is missing. Add the
completions command to the Usage spec, document installation (including the usage
CLI requirement) in the README and generated reference, and cover the happy,
invalid-shell, and missing-dependency paths with an integration test.

---

## phase-06 — Commander↔Usage parity gate {#phase-06-parity-gate}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** high

Add a parity check that fails when the runtime Commander tree and `phax.usage.kdl`
disagree, so a command-behavior change without a matching spec update fails CI.

### Detailed instructions

- Add `src/cli/introspect.ts` exporting `extractCommandTree(program: Command):
  CommandTree` that walks the Commander program built by `buildProgram()` and
  returns a normalized structure of command names, nested subcommands, arguments,
  and flags (long names + whether they take a value). Cover nested `agent` and
  `security` families.
- Add `tests/integration/usageParity.test.ts` that:
  - builds the program via `buildProgram()` and extracts its tree;
  - loads `phax.usage.kdl` as structured data (prefer converting via the `usage`
    CLI to JSON — confirm the subcommand — rather than adding a KDL parser
    dependency; reuse the loader from phase-03 if it already exposes JSON);
  - asserts **every public Commander command has a matching Usage command** and
    vice versa, and **every public Commander flag is represented in Usage** (spec
    §"Validation and linting"). Report precise, human-readable diffs on failure
    (which command/flag is missing on which side).
  - Decide and document the policy for intentionally-internal commands (if any
    are excluded from the contract, maintain an explicit allowlist in the test so
    the exclusion is visible and reviewed).
- Ensure `extractCommandTree` is consumed by the parity test so it is not flagged
  as unused by `knip`.

### Planned files to create

- `src/cli/introspect.ts`
- `tests/integration/usageParity.test.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- `phax.usage.kdl`
- `docs/cli/inventory.md`

### Boundary contracts

Commander tree ↔ Usage spec: the parity test is the bidirectional contract.
Producer of the runtime tree: `extractCommandTree(buildProgram())`. Producer of
the contract tree: `phax.usage.kdl` (as JSON). The stable invariant is
"command/flag sets are equal modulo the documented internal allowlist."

### Test strategy

CLI contract layer → integration parity test
(`tests/integration/usageParity.test.ts`). Write the introspection unit
assertions and the parity comparison before finalizing; this is the gate that
enforces the spec's no-drift requirement.

### Implementation order

1. Implement `extractCommandTree` with focused assertions.
2. Load the KDL as JSON (via the usage CLI) in the test.
3. Implement bidirectional command + flag comparison with readable diffs.
4. Add the internal-command allowlist if needed and document it.

### Excluded scope

- Error UX for unknown commands/flags (phase-07).
- Manpage generation (deferred).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The `extractCommandTree` signature and `CommandTree` shape (module path
  `src/cli/introspect.ts`).
- The KDL→JSON conversion used in the test.
- Any internal-command allowlist entries and the rationale.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(cli): add Commander/Usage parity gate

### Commit body

Add extractCommandTree to introspect the runtime Commander program and an
integration test that loads phax.usage.kdl as JSON and asserts bidirectional
parity: every public Commander command/flag is in the Usage spec and vice versa,
with readable diffs on failure. A command change without a matching spec update
now fails the test gate. Any intentionally-internal command is held in a
documented allowlist.

---

## phase-07 — Discoverable error messages {#phase-07-error-ux}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low

Make invalid command/flag/argument errors readable and actionable: name what was
invalid, suggest the closest valid command when available, point to the relevant
help command, and never print a stack trace by default.

### Detailed instructions

- In `buildProgram()`, enable Commander's suggestion-after-error behavior
  (`showSuggestionAfterError(true)`) and configure error output so that unknown
  commands/flags, missing arguments, and invalid choices produce the format in
  spec §"Error message requirements": what was invalid, "Did you mean …?" when a
  close match exists, and a `Run \`phax <command> --help\` for usage.` pointer.
- Ensure no stack trace is printed for user-input errors by default; reserve the
  existing top-level `.catch` (with `Unexpected error: …`) for genuinely
  unexpected failures only. Use Commander's error configuration / `exitOverride`
  as needed, preserving correct non-zero exit codes.
- Match the spirit of the spec's worked examples, but adapt to the flags that
  actually exist in the codebase. The unknown-command example holds as-is
  (`phax resum` → suggest `phax resume`). The spec's `--startAfter` example does
  **not** apply — that flag does not exist on any current command — so use a real
  invalid-choice case instead, e.g. `phax run --security bogus` (valid choices
  `secure|unsafe|isolated`) or an invalid `phax completions <shell>` value, and
  assert the message lists the valid choices.
- Add `tests/integration/cliErrors.test.ts` asserting: unknown command yields a
  suggestion + help pointer + non-zero exit and no stack trace; unknown flag and
  invalid choice yield readable messages; a valid command still runs.

### Planned files to create

- `tests/integration/cliErrors.test.ts`

### Planned files to edit

- `src/cli/program.ts`

### Optional files that may be edited

- `src/cli/main.ts`

### Boundary contracts

CLI surface → user: error output is the contract. Producer: Commander error
configuration in `program.ts`. The stable shape is "actionable message + optional
suggestion + help pointer + correct exit code, no stack trace for user errors."

### Test strategy

CLI surface → integration test (`tests/integration/cliErrors.test.ts`) capturing
stdout/stderr and exit codes for invalid invocations. Write before wiring.

### Implementation order

1. Add the error-output integration test (red).
2. Configure Commander suggestions and error formatting in `program.ts`.
3. Verify the top-level `.catch` no longer swallows user-input errors as
   unexpected.

### Excluded scope

- Restructuring command behavior or flags.
- Manpage generation (deferred).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The Commander error-configuration approach used and how user errors are
  distinguished from unexpected errors.
- Confirmation that exit codes remain correct and no stack trace prints for user
  input errors.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(cli): readable, actionable errors with did-you-mean suggestions

### Commit body

Enable Commander suggestion-after-error and configure error output so unknown
commands, unknown flags, missing arguments, and invalid choices report what was
invalid, suggest the closest valid command, and point to the relevant --help
without printing a stack trace, while preserving non-zero exit codes. Reserve the
top-level catch for genuinely unexpected failures. Covered by an integration test
for the invalid-input paths.
