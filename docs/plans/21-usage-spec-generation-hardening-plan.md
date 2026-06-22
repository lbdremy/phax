# Plan — Harden the generated `phax.usage.kdl` pipeline

## Context and rationale

The `usage-cli` run (PR #34) shipped CLI help/docs/completions/parity built on
`phax.usage.kdl`. A plan-conformance review found one material deviation from the
original plan and accepted the new model going forward:

**The code is the source of truth, not the spec.** The Commander program in
`src/cli/` defines every command, flag, and argument. `phax.usage.kdl` is a
*generated, derived artifact* (`scripts/generate-usage-spec.ts`, `pnpm
gen:usage-spec`) — a portable, machine-readable projection of the live CLI
surface that downstream tooling consumes: the `--usage` output, generated docs,
shell completions, and external consumers such as a generated client
library/SDK, an MCP wrapper, or editor integrations that want the contract
without importing Commander. The original plan asked for a hand-authored
canonical spec; we are deliberately keeping the generated-from-code model and
hardening it instead of reverting.

Under that model the review surfaced two real gaps:

1. **No regeneration drift gate.** The phase-06 parity gate
   (`tests/integration/usageParity.test.ts`) only compares command/flag *names*
   between Commander and the spec. It cannot catch a stale committed spec: edit a
   `.description()`, forget `pnpm gen:usage-spec`, and `phax.usage.kdl` silently
   diverges from the code while every gate stays green. A generated artifact
   needs a byte-equality drift gate (like the docs drift gate in
   `tests/integration/docsCliDrift.test.ts`) to be trustworthy.

2. **The generated spec is structurally thin.** Because Commander did not carry
   the metadata and the generator did not emit it, the spec has no argument help
   (18 `missing-arg-help` lint infos), no root command help (1 `missing-cmd-help`
   info), no per-command long help, and zero `example` nodes. The
   original plan called for argument help, long help on the documentation-heavy
   commands, and at least one example per command. To deliver that *under the
   code-as-source-of-truth model*, the metadata must be added in the Commander
   layer and the generator taught to emit it — never by hand-editing the KDL.

This plan adds the drift gate, then enriches the code-owned CLI metadata so the
derived spec (and everything downstream of it) is complete, and finally enforces
an info-clean spec and corrects the parity gate's framing.

The misleading "hand-authored canonical contract" narrative from the original
run lived only in that run's `phase-02/phase-handoff.md` artifact; the committed
repo (generator header, KDL header) already describes the spec correctly as
generated/derived, so no repo narrative rewrite is needed beyond the small docs
note in phase-01.

A third gap surfaced after the spec shipped, this one at runtime in the release
build rather than in the gates:

3. **`--usage` is broken in the single-file binaries.** Both
   `src/cli/commands/usage.ts` and `src/cli/commands/completions.ts` resolve
   `phax.usage.kdl` from disk via a path derived from `import.meta.url` and then
   `readFileSync` it (or hand its path to the `usage` CLI). The release artifacts
   are produced by `deno compile` (`scripts/build-binaries.ts`,
   `deno task compile`), which bundles the **module graph** but not arbitrary data
   files. `phax.usage.kdl` is therefore absent on disk inside the binary, so
   `phax --usage` and `phax completions` fail there. (`phax --version` survives
   only because deno auto-embeds `package.json`.) A generated artifact that
   downstream tooling consumes via the shipped CLI must travel *inside* the
   binary, not beside it. Phase-05 closes this by making the spec part of the
   module graph.

## Required commands

- usage

## Required PHAX security configuration changes

`usage` is already present in `security.agentCommands` in `phax.json` (it was
required by the original `usage-cli` plan), so **no configuration change is
required**. The preflight check will confirm coverage before any agent spawns.

## Phases

1. `phase-01` — Regeneration drift gate for the generated spec.
2. `phase-02` — Argument and root help in the Commander layer and generator.
3. `phase-03` — Command long help and examples as code-owned metadata.
4. `phase-04` — Enforce an info-clean spec and reframe the parity gate as a drift guard.
5. `phase-05` — Embed the generated spec so `--usage` works in single-file binaries.

---

## phase-01 — Regeneration drift gate for the generated spec {#phase-01-drift-gate}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Make the committed `phax.usage.kdl` provably in sync with the code by adding a
byte-equality drift gate, and record in the docs that the spec is a generated
artifact protected by that gate. This closes the "forgot to regenerate" hole the
parity gate cannot catch.

### Detailed instructions

- Refactor `scripts/generate-usage-spec.ts` so the spec text is produced by an
  exported **pure** function (e.g. `export function generateUsageSpec(): string`)
  that takes no I/O beyond reading `package.json` and `buildProgram()`. The
  script's top level should become a thin runner that calls the function and
  `writeFileSync`s the result. Do not change the emitted bytes — `pnpm
  gen:usage-spec` must produce the identical file it does today.
- Add `tests/integration/usageSpecDrift.test.ts` that imports
  `generateUsageSpec()`, reads the committed `phax.usage.kdl`, and asserts the
  two are **byte-identical**. On mismatch, fail with an actionable message that
  names the fix (`pnpm gen:usage-spec`) and shows a readable diff. Mirror the
  structure of `tests/integration/docsCliDrift.test.ts`.
- Add a short note to the README (hand-written prose, not the generated CLI
  block) stating that `phax.usage.kdl` is generated from the Commander program,
  must be regenerated with `pnpm gen:usage-spec` after any CLI change, is held in
  sync by the drift gate, and exists to be consumed by downstream tooling
  (`--usage`, docs, completions, and external consumers like a generated client
  library). Optionally align `docs/cli/inventory.md` wording with the same
  framing.
- Do not change command/flag definitions or the spec content in this phase — it
  is purely the gate plus the supporting refactor and doc note.

### Planned files to create

- `tests/integration/usageSpecDrift.test.ts`

### Planned files to edit

- `scripts/generate-usage-spec.ts`
- `README.md`

### Optional files that may be edited

- `docs/cli/inventory.md`

### Boundary contracts

Generator → drift gate and downstream consumers: `generateUsageSpec(): string`
is the single pure projection of `buildProgram()` into Usage KDL text. The
committed `phax.usage.kdl` must equal its output byte-for-byte. Both the script
runner and the drift test depend on this exact shape.

### Test strategy

CLI contract / build-tooling layer → integration test
(`tests/integration/usageSpecDrift.test.ts`) that exercises the real generator
function against the committed file. Write it before the refactor so it proves
byte-stability across the extraction.

### Implementation order

1. Add the drift test importing the not-yet-exported function (red).
2. Extract `generateUsageSpec()` and reduce the script to a runner; drive the
   test green with the file unchanged.
3. Add the README note (and optional inventory wording).

### Excluded scope

- Any change to command/flag/argument definitions or spec content (phases 02–03).
- Lint-info enforcement (phase-04).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact exported signature and module path of `generateUsageSpec()`.
- The drift test path and the regeneration command it points failures at.
- Confirmation that the committed `phax.usage.kdl` bytes are unchanged by the
  refactor.
- Any deviation from the planned file lists, with the reason.

### Commit subject

test(cli): add a regeneration drift gate for phax.usage.kdl

### Commit body

Extract the spec text into a pure generateUsageSpec() function and add an
integration test asserting the committed phax.usage.kdl is byte-identical to its
output, so a CLI change without `pnpm gen:usage-spec` now fails the gate. The
generator script becomes a thin runner; emitted bytes are unchanged. Documents
phax.usage.kdl as a generated, drift-gated artifact intended for downstream
derivation.

---

## phase-02 — Argument and root help in the Commander layer and generator {#phase-02-arg-help}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Give every positional argument a description in the Commander definitions and
emit the program's own description as the spec's root help, then teach the
generator to project both. This closes all 19 `usage lint` info messages with the
code remaining the source of truth.

### Detailed instructions

- Add a concise description to every positional argument that currently lacks
  one (the 18 `missing-arg-help` cases): `short-name` on `unlock`, `enter`,
  `enter-phase`, `session-info`, `shell`, `path`, `open`, `archive`, `run`,
  `review-handoff`, `publish-pr`, `review-compliance`, `report`, `resume`,
  `reset-phase`; `phase-id` on `enter-phase` and `reset-phase`; and `shell` on
  `completions`. Keep them short and consistent; identical argument names get
  identical descriptions.
- Note the current code shape: there are **no** `.argument()` calls — every
  positional is declared inline in the command string (e.g.
  `.command("unlock <short-name>")`). Add descriptions with Commander's
  argument-description map on `.description()` (e.g.
  `.description("…", { "short-name": "Run short name, e.g. usage-cli" })`), or
  convert the inline positionals to `.argument("<short-name>", "…")`. Prefer the
  `.description()` map form to avoid restructuring the command definitions.
- Most commands live in `src/cli/program.ts`, but `resume` and `reset-phase`
  are defined in `src/cli/commands/resumeRegister.ts` and
  `src/cli/commands/resetPhaseRegister.ts` — add their argument descriptions
  there.
- Teach `scripts/generate-usage-spec.ts` `emitArg` to emit argument help when
  present, as `arg "<name>" { help "<description>" }` per the
  [Usage spec format](https://usage.jdx.dev/spec/). Confirm the exact KDL shape
  with `usage lint`.
- Emit the root program description as a top-level `help "<description>"` in the
  generated spec (the `missing-cmd-help` info at `cmd phax`). Source it from the
  program's `.description()`.
- Regenerate with `pnpm gen:usage-spec` and commit the updated `phax.usage.kdl`.
  The drift gate from phase-01 and the parity gate must both stay green (command
  and flag *names* are unchanged; only help text is added).
- Confirm `usage lint phax.usage.kdl` now reports **0 errors, 0 warnings, 0
  infos**.

### Planned files to create

- (none)

### Planned files to edit

- `src/cli/program.ts`
- `src/cli/commands/resumeRegister.ts`
- `src/cli/commands/resetPhaseRegister.ts`
- `scripts/generate-usage-spec.ts`
- `phax.usage.kdl`

### Optional files that may be edited

- (none)

### Boundary contracts

Commander argument metadata → generator → spec: argument descriptions declared
in `program.ts` are the source; the generator projects them into `arg { help }`
nodes. The stable contract is "every positional argument carries a description in
code, mirrored 1:1 in the generated spec."

### Test strategy

CLI contract layer → covered by the existing
`tests/integration/usageSpecLint.test.ts` (lint stays clean) and the phase-01
drift gate (committed spec matches the generator). No new test file; the lint and
drift gates verify the outcome mechanically.

### Implementation order

1. Extend the generator to emit arg help and root help.
2. Add argument descriptions in `program.ts`.
3. Regenerate the spec; drive lint to 0 infos and keep drift/parity green.

### Excluded scope

- Long help and examples (phase-03).
- Flipping lint infos to hard errors (phase-04).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The list of arguments given descriptions and the convention used for shared
  argument names.
- The KDL shapes now emitted for argument help and root help.
- Confirmation that `usage lint` reports 0 infos and that drift + parity gates
  pass.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(cli): add argument and root help to the generated Usage spec

### Commit body

Add descriptions to every positional CLI argument in the Commander program and
emit the program description as the spec's root help, then teach the generator to
project argument help and root help into phax.usage.kdl. Regenerates the spec and
closes all 19 usage-lint info messages, with code remaining the source of truth.

---

## phase-03 — Command long help and examples as code-owned metadata {#phase-03-long-help-examples}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** high

Introduce a typed, code-owned source of long help and runnable examples for the
documentation-heavy commands, wire it into both Commander's `--help` output and
the spec generator, and regenerate the spec and docs. This delivers the original
plan's accessibility intent (examples, long help, explicit side effects) without
hand-editing the derived spec.

### Detailed instructions

- Add `src/cli/cliDocs.ts`: a typed map from command path (e.g. `"run"`,
  `"agent resolve"`) to `{ longHelp?: string; examples?: string[] }`. Populate
  the documentation-heavy commands the original plan called out: `run`, `resume`,
  `init`, the `enter` / `enter-phase` / `session-info` / `shell` / `path` /
  `open` session family, `ls` (status filters `--active|--failed|--review-open|
  --archived|--json`), and `archive` (`--force`). Also cover the two commands
  added since the original plan, both with notable side effects:
  `publish-pr` / `report` (push a branch, open a GitHub PR/issue, create a gist)
  and `review-compliance` (run a non-mutating plan-compliance review). Each
  example must be a real, runnable invocation; long help must state side effects
  explicitly (worktree / session / file-affecting / network / scheduled-run
  commands).
- Wire `cliDocs` into `src/cli/program.ts` so the runtime `--help` surfaces the
  examples and long help (e.g. via `command.addHelpText("after", …)` and/or
  command long-description). The same metadata feeds the generator — keep
  `cliDocs.ts` the single source so `--help` and the spec never disagree. Apply
  the wiring by iterating `program.commands` by command path after all
  registrations (including `registerResumeCommand` / `registerResetPhaseCommand`)
  rather than editing each command site, so commands defined in the
  `*Register.ts` files are covered without touching those files.
- Teach `scripts/generate-usage-spec.ts` to emit `long_help "<text>"` and one
  `example "<cmd>"` node per example for commands present in `cliDocs`, following
  the [Usage spec format](https://usage.jdx.dev/spec/). Confirm exact KDL shapes
  with `usage lint`.
- Regenerate the spec (`pnpm gen:usage-spec`) and the docs (`pnpm docs:cli`, the
  script behind `tests/integration/docsCliDrift.test.ts`). Commit the updated
  `phax.usage.kdl`, `docs/cli/reference.md`, and the generated README CLI block.
  Keep the phase-01 drift gate, the docs drift gate, and the parity gate green.
- If `scripts/docs-cli.ts` does not already render `long_help` / `example` nodes
  into the reference and README output, extend it so the new content appears
  (otherwise the docs drift gate will not reflect the examples).
- Add `tests/integration/usageSpecExamples.test.ts` asserting that the generated
  spec contains `long_help` and at least one `example` node for the
  documentation-heavy commands listed above, so a future regression that drops
  the metadata fails the gate.

### Planned files to create

- `src/cli/cliDocs.ts`
- `tests/integration/usageSpecExamples.test.ts`

### Planned files to edit

- `src/cli/program.ts`
- `scripts/generate-usage-spec.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`
- `README.md`

### Optional files that may be edited

- `scripts/docs-cli.ts`

### Boundary contracts

`cliDocs` → Commander `--help` and spec generator: a single typed map of long
help and examples per command path. Both the runtime help renderer and the
generator read it; the stable contract is "long help and examples are authored
once in code and projected identically into `--help`, the spec, and the docs."

### Test strategy

- CLI contract layer → `tests/integration/usageSpecExamples.test.ts`
  (integration) asserts the generated spec carries long help and examples for the
  documentation-heavy commands. Write it before wiring the generator so it is red
  until the metadata flows through.
- Drift is covered by the existing docs drift gate and the phase-01 spec drift
  gate; lint stays info-clean.

### Implementation order

1. Add `cliDocs.ts` with metadata for the documentation-heavy commands.
2. Add the examples test (red).
3. Extend the generator to emit `long_help` / `example`; wire `cliDocs` into
   `--help`.
4. Regenerate spec and docs; drive all gates (examples, lint, both drift gates,
   parity) green.

### Excluded scope

- Argument help and root help (phase-02).
- Flipping lint infos to hard errors and parity-comment cleanup (phase-04).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The `cliDocs.ts` module path and its exported type/shape.
- The exact KDL shapes emitted for `long_help` and `example`.
- The list of commands given long help and examples.
- Confirmation that `--help`, the spec, and the generated docs all reflect the
  new metadata and that every gate passes.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(cli): add code-owned long help and examples to the CLI surface

### Commit body

Add src/cli/cliDocs.ts as the single typed source of per-command long help and
runnable examples for the documentation-heavy commands, wire it into both
Commander --help and the spec generator, and regenerate phax.usage.kdl and the
CLI docs. Delivers the original plan's examples/long-help/side-effect intent with
code as the source of truth. Covered by an integration test asserting the
generated spec carries the metadata.

---

## phase-04 — Enforce an info-clean spec and reframe the parity gate {#phase-04-enforce-and-reframe}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low

Lock in the now-clean spec by making `usage lint` infos fail the gate, and
correct the parity test's framing so its true role — a name-level drift guard
between Commander and the derived spec, not an independent-contract check — is
documented.

### Detailed instructions

- Update `tests/integration/usageSpecLint.test.ts` to treat `info` messages as
  failures in addition to warnings and errors (e.g. extend detection to
  `/^(warn|info)\b/m`, or assert the lint summary reports 0 infos). After phases
  02–03 the spec is info-clean, so this prevents regressions (a new argument or
  command without help). Keep the actionable "`usage` CLI not installed" message.
- Update the header comment block in `tests/integration/usageParity.test.ts` to
  describe its real role accurately: because `phax.usage.kdl` is generated from
  the same Commander tree it introspects, this gate guards against a *stale
  committed spec / name-level divergence*, complementing the byte-equality drift
  gate — it is not an independent hand-authored contract. Do not change the
  assertions; only the explanatory comment and, if present, the allowlist
  rationale wording.
- If flipping infos to errors or any wording change alters generated docs,
  regenerate and commit; otherwise leave generated files untouched.

### Planned files to create

- (none)

### Planned files to edit

- `tests/integration/usageSpecLint.test.ts`
- `tests/integration/usageParity.test.ts`

### Optional files that may be edited

- `docs/cli/reference.md`
- `README.md`

### Boundary contracts

(none — this phase tightens an existing gate and corrects documentation; it
crosses no new boundary.)

### Test strategy

CLI contract layer → the modified `usageSpecLint` test itself is the
verification; it must fail on any future `info` and pass on the current
info-clean spec. The parity test continues to pass unchanged.

### Implementation order

1. Tighten the lint test to fail on infos; confirm it passes on the current spec.
2. Rewrite the parity test's framing comment.

### Excluded scope

- Any change to command/flag/argument definitions, the generator, or spec
  content (phases 01–03).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact info-detection mechanism used and confirmation the spec is
  info-clean under it.
- The corrected description of what the parity gate guarantees.
- Any deviation from the planned file lists, with the reason.

### Commit subject

test(cli): fail the spec lint on infos and reframe the parity gate

### Commit body

Make tests/integration/usageSpecLint.test.ts treat usage-lint info messages as
failures so a new argument or command without help cannot regress the now
info-clean spec, and correct the parity test's header comment to describe its
real role as a name-level drift guard over the generated spec rather than an
independent contract check.

---

## phase-05 — Embed the generated spec so `--usage` works in single-file binaries {#phase-05-embed-spec}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Make the generated CLI spec travel *inside* the `deno compile` binary so
`phax --usage` and `phax completions` work in the release artifacts. Today both
commands read `phax.usage.kdl` from disk via an `import.meta.url`-derived path;
`deno compile` bundles only the module graph, so the file is absent in the binary
and both commands fail. Embed the spec as a TypeScript constant (part of the
module graph) and serve from it, materializing a temp file only where the
external `usage` CLI insists on a path.

### Detailed instructions

- Extend the phase-01 generator (`scripts/generate-usage-spec.ts`, which by then
  exposes the pure `generateUsageSpec()`) so its runner *also* writes
  `src/cli/generated/usageSpec.ts` containing
  `export const USAGE_SPEC_KDL = <JSON.stringify of generateUsageSpec()>;` with a
  "do not edit by hand — regenerate with `pnpm gen:usage-spec`" header. The
  committed `phax.usage.kdl` continues to be written unchanged. Use
  `JSON.stringify` for the literal so all escaping is correct. The file is a
  generated artifact and is excluded from lint/format (see the next bullet), so
  the generator does not need to emit oxfmt/oxlint-clean output.
- Exclude the generated directory from the linter and formatter: add
  `"src/cli/generated/"` to `ignorePatterns` in `.oxlintrc.json` and to
  `ignorePatterns` in `.oxfmtrc.json` (matching the existing `dist/` / `coverage/`
  entries). This keeps `pnpm lint` and `pnpm format:check` green without the
  generator having to produce formatter-stable output, and removes any risk of
  oxfmt rewriting the embedded string and drifting from `pnpm gen:usage-spec`.
  Note `typecheck` (tsc) and `knip` still cover the file — it is real TypeScript
  imported by `src/cli/usageSpec.ts`.
- Add `src/cli/usageSpec.ts` exporting a `withSpecFile<T>(fn: (specPath: string)
  => T): T` helper that writes `USAGE_SPEC_KDL` to a fresh temp dir
  (`mkdtempSync` under `os.tmpdir()`), invokes the synchronous `fn` with the path,
  and removes the temp dir in a `finally`. This serves the json + completions
  paths, which shell out to the external `usage` CLI and require a file path.
- Update `src/cli/commands/usage.ts`: for `--usage` (kdl) write `USAGE_SPEC_KDL`
  to stdout directly — delete `resolveSpecPath`, the `existsSync` check, and the
  `readFileSync` of the spec. For `--usage-format json`, wrap the existing
  `spawnSync("usage", ["generate", "json", "-f", specPath], …)` in
  `withSpecFile(...)`. Keep `readPackageVersion()` as-is (deno embeds
  `package.json`, so `--version` already works). Preserve all current error
  messages and exit codes.
- Update `src/cli/commands/completions.ts`: wrap its
  `spawnSync("usage", ["generate", "completion", shell, "phax", "-f", specPath],
  …)` in `withSpecFile(...)` and delete its own `resolveSpecPath` /`existsSync`
  block and the now-unused `node:fs` / `node:path` / `node:url` imports (it keeps
  `node:child_process`).
- Add `src/cli/usageSpec.ts` to `CLI_DIRECT_IO_ALLOWLIST` in
  `tests/unit/architecturalGuards.test.ts` (it imports `node:fs` and `node:os`).
  Both `usage.ts` and `completions.ts` stay in the allowlist and keep importing a
  Node I/O module, so the "kept honest" assertions still hold.
- Extend the phase-01 drift gate (`tests/integration/usageSpecDrift.test.ts`)
  with an assertion that the embedded constant matches the committed spec —
  `import { USAGE_SPEC_KDL }` and assert it is byte-identical to
  `generateUsageSpec()` / `phax.usage.kdl`. This is the hardening piece: it fails
  the gate if someone edits the CLI or the spec without regenerating the embed,
  so the binary can never serve a stale or missing spec.
- Extend `scripts/smoke-binary.sh` to additionally assert `./dist/bin/phax
  --usage` exits 0 and prints a non-empty spec (e.g. greps for `name "phax"`).
  This is the real proof the fix works in a compiled binary, since the `full`
  gate runs under tsx where the file exists on disk.
- Run `pnpm gen:usage-spec` to produce `src/cli/generated/usageSpec.ts`, then
  `pnpm format` and `pnpm check:full`; keep the phase-01 drift gate, the parity
  gate, and the lint gate green.

### Planned files to create

- `src/cli/generated/usageSpec.ts`
- `src/cli/usageSpec.ts`

### Planned files to edit

- `scripts/generate-usage-spec.ts`
- `src/cli/commands/usage.ts`
- `src/cli/commands/completions.ts`
- `tests/unit/architecturalGuards.test.ts`
- `tests/integration/usageSpecDrift.test.ts`
- `scripts/smoke-binary.sh`
- `.oxlintrc.json`
- `.oxfmtrc.json`

### Optional files that may be edited

- (none)

### Boundary contracts

Generator → embedded module → CLI commands: `generateUsageSpec()` is the single
projection of `buildProgram()` into Usage KDL text (phase-01). Phase-05 adds a
second sink for that exact text — `src/cli/generated/usageSpec.ts`'s
`USAGE_SPEC_KDL` — which `usage.ts` and `completions.ts` consume in place of a
disk read. The stable contract is "the committed `phax.usage.kdl`, the embedded
`USAGE_SPEC_KDL` constant, and `generateUsageSpec()` output are byte-identical,"
enforced by the drift gate.

### Test strategy

- CLI contract / build-tooling layer → integration: extend
  `tests/integration/usageSpecDrift.test.ts` to assert the embedded constant
  equals the committed spec (write this assertion before wiring the generator so
  it is red until the embed exists).
- Architecture layer → unit: the existing `tests/unit/architecturalGuards.test.ts`
  enforces the allowlist; the new helper must be added to keep it green.
- Binary smoke (real artifact) → `scripts/smoke-binary.sh` exercises a compiled
  `deno` binary; extend it to cover `--usage`. Run manually / in the release
  workflow, not in the `full` gate.

### Implementation order

1. Add the embedded-constant assertion to the drift test (red).
2. Teach the generator runner to emit `src/cli/generated/usageSpec.ts`; run
   `pnpm gen:usage-spec` to create it (drift test green).
3. Add `src/cli/usageSpec.ts` and allowlist it in the architecture guard.
4. Rewire `usage.ts` and `completions.ts` onto the constant + `withSpecFile`.
5. Extend `scripts/smoke-binary.sh`; verify with `pnpm deno:smoke-binary`.

### Excluded scope

- Any change to command/flag/argument definitions or the emitted spec *content*
  (phases 02–03) — phase-05 changes only where the spec is read from at runtime.
- Switching the binary build to `deno compile --include` (the considered
  alternative); phase-05 deliberately embeds in the module graph so npm dist and
  the binary share one code path.
- Routing `usage.ts` / `completions.ts` I/O through the FileSystem port (a broader
  refactor tracked by the CLI direct-I/O allowlist).

### Verification

- The project's configured `full` gate profile in `phax.json` (drift, parity, and
  lint gates plus the architecture guard).
- Manual: `pnpm deno:smoke-binary` confirms `--usage` works in a compiled binary.

### Expected handoff content

- The module path of the embedded constant (`src/cli/generated/usageSpec.ts`) and
  the `withSpecFile` helper (`src/cli/usageSpec.ts`) with its signature.
- Confirmation that the committed `phax.usage.kdl` bytes are unchanged and that
  `USAGE_SPEC_KDL` is byte-identical to it (drift gate green).
- Confirmation that `scripts/smoke-binary.sh` now asserts `--usage` in a compiled
  binary and that `pnpm deno:smoke-binary` passes.
- The architecture-guard allowlist entry added and why.
- Any deviation from the planned file lists, with the reason.

### Commit subject

fix(cli): embed the usage spec so --usage works in single-file binaries

### Commit body

Emit src/cli/generated/usageSpec.ts (USAGE_SPEC_KDL) from the spec generator and
serve `phax --usage` and `phax completions` from the embedded constant instead of
reading phax.usage.kdl from disk, with a withSpecFile helper materializing a temp
file only for the external usage CLI. deno compile bundles the module graph but
not data files, so the on-disk spec was absent in the release binaries; embedding
it fixes --usage there. Adds an embedded-vs-committed drift assertion and a
binary smoke check for --usage.
