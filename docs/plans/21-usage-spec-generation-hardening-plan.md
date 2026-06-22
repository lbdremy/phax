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

Two related gaps surfaced after the spec shipped, both in the release build
rather than in the gates:

3. **The single-file binaries are ~360 MB, and `--usage` is broken in them.**
   The release artifacts are produced by `deno compile`
   (`scripts/build-binaries.ts`, `deno task compile`) pointed at the raw source.
   `deno compile` does **not** tree-shake: it embeds the *files* of every module
   reachable from the entrypoint into the binary's virtual filesystem. Because the
   Effect packages ship large amounts of redundant files (CJS + ESM + `.d.ts` +
   source maps + hundreds of small internal modules), this vacuums ~274 MB of
   `node_modules` into each binary (~360 MB total) for ~1.5 MB of actually-reached
   code — so the bloat is the un-tree-shaken bundle, not Effect's runtime cost.
   Separately, `src/cli/commands/usage.ts` and `src/cli/commands/completions.ts`
   resolve `phax.usage.kdl` from disk via a path derived from `import.meta.url`;
   `deno compile` embeds only the module graph, not arbitrary data files, so the
   spec is absent inside the binary and `phax --usage` / `phax completions` fail
   there. (`phax --version` survives only because deno auto-embeds
   `package.json`.) Phase-05 closes both gaps at once: bundle the CLI with esbuild
   first (tree-shaken to ~1.5 MB) so the compiled binary drops to the ~74 MB
   Deno-runtime floor, and embed the runtime-read data files with
   `deno compile --include` so `--usage`, `completions`, `--version`, and
   `skills install` all work inside the binary with no source changes.

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
5. `phase-05` — Shrink the single-file binaries (esbuild bundle) and make `--usage` work in them.
6. `phase-06` — Dynamic shell completion of run short-names via a usage completer.

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

## phase-05 — Shrink the single-file binaries and make `--usage` work in them {#phase-05-embed-spec}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Cut the `deno compile` artifacts from ~360 MB to the ~74 MB Deno-runtime floor by
bundling the CLI with esbuild before compiling, and make the runtime-read data
files (`phax.usage.kdl`, `package.json`, `.claude/skills`) travel *inside* the
binary via `deno compile --include`, so `phax --usage`, `phax completions`,
`phax --version`, and `phax skills install` all work in the release artifacts
with no source changes.

### Detailed instructions

- Diagnosis to preserve in code comments: `deno compile` does not tree-shake —
  pointed at `src/cli/main.ts` it embeds the *files* of every reachable module
  (~274 MB of `node_modules`) for ~1.5 MB of actually-used code. Bundling with
  esbuild first collapses the embedded files to the reachable, tree-shaken set;
  `--include` then adds back the three data files the CLI reads at runtime. This
  was validated empirically (362 MB → 74 MB; `--version` and `--usage` both work
  in the bundled binary).
- Add `esbuild` to `devDependencies` in `package.json` (it is currently only a
  transitive dependency) and refresh `pnpm-lock.yaml` with `pnpm install`. Pin a
  recent version (e.g. `^0.28.0`).
- Add `esbuild` to `ignoreDependencies` in `knip.json`: the Deno build script
  spawns the `node_modules/.bin/esbuild` binary rather than importing the
  package, so knip cannot trace the usage and would otherwise flag it as an
  unused dependency in the `full` gate.
- Rewrite `scripts/build-binaries.ts` to bundle once, then compile per target:
  - **Bundle step:** spawn `node_modules/.bin/esbuild src/cli/main.ts --bundle
    --platform=node --format=esm --target=node20 --outfile=<BUNDLE_PATH>
    --banner:js=<createRequire banner>`. The banner is required because CommonJS
    deps (commander) call `require("node:events")`, which an ESM bundle has no
    `require` for:
    `import{createRequire as __cr}from"node:module";const require=__cr(import.meta.url);`.
    The bundle is platform-independent, so it is produced once and reused for
    every target.
  - **Bundle path depth is load-bearing.** Emit the bundle exactly three
    directories deep (e.g. `dist/release/bundle/phax.mjs`). The CLI resolves
    `package.json`, `phax.usage.kdl`, and `.claude/skills` via `import.meta.url`
    joined with `../../../`; at that depth those paths resolve to the compiled
    binary's VFS root, which is exactly where `--include` drops the data files.
    Flattening the bundle would break `--version` / `--usage` / `skills` in the
    binary. State this constraint in a comment in the script.
  - **Compile step:** `deno compile --no-check --allow-read --allow-write
    --allow-env --allow-sys --allow-run --include package.json --include
    phax.usage.kdl --include .claude/skills --target <triple> --output <out>
    <BUNDLE_PATH>`. Drop `--sloppy-imports` — the bundle needs no import
    rewriting. Keep `RELEASE_TARGETS`, the SHA-256 sidecar writing, and the
    `import.meta.main` cross-compile loop; factor the bundle step so it runs once
    before the per-target loop.
  - Add a `--host` mode (no `--target`, `--output dist/bin/phax`) so
    `deno task compile` and the smoke script build a host binary through the same
    bundle-then-compile path.
- Update the `compile` task in `deno.json` to route through the script's host
  mode: `deno run --allow-read --allow-write --allow-run --allow-env
  scripts/build-binaries.ts --host` (replacing the direct
  `deno compile … src/cli/main.ts`). This keeps `pnpm deno:compile`,
  `deno task compile`, and the smoke script on the small-binary path.
- Extend `scripts/smoke-binary.sh` to additionally assert `./dist/bin/phax
  --usage` exits 0 and prints a non-empty spec (grep for `name "phax"`), and to
  fail if the binary is larger than a sane bound (e.g. 150 MB) so a regression to
  the un-bundled path is caught on a real artifact. Keep the existing `--version`
  check.
- Do **not** change `src/cli/commands/usage.ts` or
  `src/cli/commands/completions.ts`: their existing `import.meta.url`-relative
  disk reads work unchanged once `--include` places the files at the matching VFS
  location. No embedded constant, no `withSpecFile` helper, no generated module,
  and no architecture-guard allowlist change are needed — this is the key
  simplification over the previously-planned module-graph embedding.
- Document shell completions in the README (hand-written prose, outside the
  generated `BEGIN/END GENERATED CLI REFERENCE` block). Add a short "Shell
  completions" section that: states `phax completions <shell>` supports `zsh`,
  `bash`, `fish`, `nu`, `powershell`; calls out the `usage` CLI as a prerequisite
  (`brew install jdx/tap/usage`) needed both to generate the script and at
  Tab-time, because the generated script calls back into `usage complete-word`;
  gives the per-shell install one-liners (zsh → a `_phax` file on `$fpath`;
  bash → `source <(phax completions bash)`; fish →
  `~/.config/fish/completions/phax.fish`; nu/powershell → profile sourcing); and
  notes that `phax --usage` and `phax completions` now work from the release
  binary as well as from source. Keep it consistent with the phase-01 note that
  `phax.usage.kdl` is the generated spec these features derive from.
- Run `pnpm check:full` (knip stays green with the new devDep + ignore entry),
  then `pnpm deno:smoke-binary` to prove `--version` and `--usage` work in a
  compiled binary and the size dropped.

### Planned files to create

- (none)

### Planned files to edit

- `scripts/build-binaries.ts`
- `scripts/smoke-binary.sh`
- `deno.json`
- `package.json`
- `pnpm-lock.yaml`
- `knip.json`
- `README.md`

### Optional files that may be edited

- (none)

### Boundary contracts

CLI runtime file resolution → binary VFS layout: the CLI resolves `package.json`,
`phax.usage.kdl`, and `.claude/skills` via `import.meta.url` joined with
`../../../`. The build emits the esbuild bundle three directories deep and
`--include`s those files so they land at the matching VFS path. The stable
contract is "the bundle's directory depth equals the `../../../` the CLI walks,
and every runtime-read data file is in the `--include` list." The binary smoke
test enforces this on a real artifact; it is the one thing that breaks silently
if either side drifts.

### Test strategy

- Build-tooling / CLI artifact layer → binary smoke (real artifact):
  `scripts/smoke-binary.sh`, run via `pnpm deno:smoke-binary`, asserts
  `--version`, `--usage` (non-empty spec), and the size bound in a compiled
  binary. This is the real verification for the phase, since the `full` gate runs
  under tsx where the data files exist on disk and so cannot catch the binary-only
  breakage.
- Dead-code layer → `knip` (in `full`) covers the new `esbuild` devDependency
  declaration and its ignore entry.

### Implementation order

1. Add `esbuild` to devDependencies and `knip.json` ignore; run `pnpm install`.
2. Rewrite `scripts/build-binaries.ts` (bundle + `--include` + `--host`) and
   point the `deno.json` `compile` task at the host mode.
3. Extend `scripts/smoke-binary.sh`; run `pnpm deno:smoke-binary` to confirm the
   size dropped and `--version` / `--usage` work in the binary.
4. Add the README "Shell completions" section.

### Excluded scope

- Any change to command/flag/argument definitions or the emitted spec content
  (phases 02–03) — phase-05 changes only the build pipeline and where data files
  travel.
- Embedding the spec as a module-graph TypeScript constant (`src/cli/generated/`,
  `src/cli/usageSpec.ts`, `withSpecFile`): the previously-planned approach,
  deliberately superseded by `deno compile --include`, which needs no source
  changes and reuses the existing disk-read code path in both the npm dist and the
  binary.
- Routing `usage.ts` / `completions.ts` I/O through the FileSystem port (a broader
  refactor tracked by the CLI direct-I/O allowlist).

### Verification

- The project's configured `full` gate profile in `phax.json` (knip in particular,
  for the new devDependency).
- Manual: `pnpm deno:smoke-binary` confirms the binary is small (~74 MB) and that
  `--version` and `--usage` both work inside it.

### Expected handoff content

- The bundle path and its directory depth, and why the depth must equal the CLI's
  `../../../` resolution.
- The full `deno compile --include` flag set used and the esbuild flags + banner.
- Confirmation that no files under `src/cli/` were changed.
- The measured binary size before and after (expected ~360 MB → ~74 MB).
- The `esbuild` devDependency version added and the `knip.json` ignore entry.
- Any deviation from the planned file lists, with the reason.

### Commit subject

fix(build): bundle the CLI so single-file binaries are small and --usage works

### Commit body

deno compile does not tree-shake, so pointing it at the raw source embedded
~274 MB of node_modules into each binary (~360 MB) and still left phax.usage.kdl
absent, breaking --usage. Bundle the CLI with esbuild first (tree-shaken to
~1.5 MB) and deno compile --include package.json / phax.usage.kdl / .claude/skills,
dropping the artifacts to the ~74 MB Deno-runtime floor and making --usage,
completions, --version, and skills install work inside the binary with no source
changes. The bundle is emitted three directories deep so the CLI's import.meta
relative reads resolve to the VFS root where --include drops the files. Adds
esbuild as a devDependency (knip-ignored, spawned not imported), routes
deno task compile through the bundle path, and extends the binary smoke test to
assert --usage and a size bound.

---

## phase-06 — Dynamic shell completion of run short-names via a usage completer {#phase-06-short-name-completers}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Make Tab complete actual run short-names (not just commands and flags) for every
command that takes one. The `usage` spec supports dynamic completers
(`complete "<arg-name>" run="<shell command>"`) keyed by argument *name*, so a
single declaration covers every command with a `<short-name>` / `[short-name]`
positional (`enter`, `enter-phase`, `session-info`, `shell`, `path`, `open`,
`archive`, `run`, `review-handoff`, `publish-pr`, `review-compliance`, `report`,
`resume`, `reset-phase`). Author the completer as code-owned metadata and teach
the generator to emit it — never hand-edit the KDL — sourced from a fast,
machine-readable `phax ls` mode.

### Detailed instructions

- Add a completion-friendly output to `ls`: a `--complete` flag on the `ls`
  command (give it a short help string, e.g. "Print run short-names for shell
  completion") that prints one `short-name:state` line per run and nothing else
  (no table, no lock-status computation — completion must be fast). Reuse the
  existing `runLs` reconciliation; gate the output format on the new flag.
  `state` becomes the candidate description (the completer sets
  `descriptions=#true`, which splits each line on `:`). Run short-names are
  kebab-case slugs and never contain `:`, so the split is unambiguous.
- Add `src/cli/cliCompleters.ts`: a typed, code-owned map from argument name to
  its completer, e.g.
  `{ "short-name": { run: "phax ls --complete", descriptions: true } }`. This is
  the single source of truth for completers, mirroring the `cliDocs.ts` pattern
  from phase-03.
- Teach `scripts/generate-usage-spec.ts` to emit a top-level
  `complete "<name>" run="<cmd>" descriptions=#true` node for each entry in
  `cliCompleters`, following the [Usage spec format](https://usage.jdx.dev/spec/)
  (`complete` reference). Confirm the exact KDL shape with `usage lint`.
- Regenerate with `pnpm gen:usage-spec` (which rewrites `phax.usage.kdl`) and
  `pnpm docs:cli`. The release binary picks up the regenerated spec automatically
  on the next build, since phase-05 embeds `phax.usage.kdl` via
  `deno compile --include` rather than a committed constant. Keep the phase-01
  drift gate, the docs drift gate, the parity gate, and `usage lint` all green.
  The new `ls --complete` flag is introspected by the parity gate automatically;
  ensure it carries help so the spec stays info-clean (phase-04).
- Update the README "Shell completions" section (added in phase-05) to note that,
  once installed, Tab now completes run short-names for commands like
  `phax enter` / `phax resume`, and that completion invokes `phax ls` at Tab-time
  (so it reflects live runs).

### Planned files to create

- `src/cli/cliCompleters.ts`
- `tests/integration/usageSpecCompleters.test.ts`

### Planned files to edit

- `src/cli/program.ts`
- `src/cli/commands/ls.ts`
- `scripts/generate-usage-spec.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`
- `README.md`

### Optional files that may be edited

- `tests/integration/usageParity.test.ts` (only if the `--complete` flag needs an
  allowlist entry or a framing note)

### Boundary contracts

`cliCompleters` → generator → spec → `usage` runtime: argument-name-keyed
completer commands are authored once in code and projected 1:1 into top-level
`complete` nodes. The runtime contract is "`phax ls --complete` prints
newline-delimited `short-name:state` candidates"; the `usage` CLI invokes it at
Tab-time. The stable shape is the `{ run, descriptions }` completer record and
the `short-name:state` line format.

### Test strategy

- CLI contract layer → `tests/integration/usageSpecCompleters.test.ts`
  (integration): assert the generated spec contains
  `complete "short-name" run="phax ls --complete"` with `descriptions=#true`
  (write before wiring the generator so it is red), and assert
  `phax ls --complete` (spawned via tsx) prints `short-name:state` lines and no
  table chrome. Use the existing run-fixture/registry harness used by other
  `ls`/integration tests.
- Drift, parity, and lint are covered by the existing gates; regeneration keeps
  them green.

### Implementation order

1. Add `ls --complete` output and its test assertion (red → green).
2. Add `cliCompleters.ts`; add the spec-emission assertion (red).
3. Teach the generator to emit `complete` nodes; regenerate spec + embed + docs
   (drive the spec assertion green; keep all gates green).
4. Update the README "Shell completions" section.

### Excluded scope

- Context-sensitive `phase-id` completion (completing a phase id *for the chosen
  run*) — it needs a "list phases for run X" source and `{{words[PREV]}}`
  templating; track as a follow-up.
- Static value `choices` for other args/flags (`completions <shell>`,
  `--security`, `--usage-format`, `--profile`) — same generator machinery, but
  out of scope here; follow-up.
- Per-command filtering of candidates (e.g. only `review_open` runs for `resume`)
  — the global, arg-name-keyed completer lists all runs; refine later if needed.

### Verification

- The project's configured `full` gate profile in `phax.json` (spec-completer
  test, drift gates, parity, lint).
- Manual: install the completion script (per the README), then confirm
  `phax enter <TAB>` offers live run short-names, and `phax ls --complete` prints
  `short-name:state` lines.

### Expected handoff content

- The `cliCompleters.ts` module path and its exported record shape.
- The exact KDL shape emitted for `complete` nodes and the `ls --complete` line
  format.
- Confirmation that the spec and docs were regenerated and that drift, parity,
  and lint gates pass.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(cli): complete run short-names via a usage spec completer

### Commit body

Add a code-owned completer map (src/cli/cliCompleters.ts) and teach the spec
generator to emit usage `complete` nodes, so shell completion offers live run
short-names for every command that takes one. Add a fast `phax ls --complete`
output as the completion source, regenerate phax.usage.kdl, the embedded spec
constant, and the CLI docs, and document short-name completion in the README.
Covered by an integration test asserting the completer node and the ls --complete
output.
