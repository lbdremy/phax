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
   (15 `missing-arg-help` lint infos), no root command help (1 `missing-cmd-help`
   info), no per-command long help, and only 3 incidental `example` nodes. The
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
generator to project both. This closes all 16 `usage lint` info messages with the
code remaining the source of truth.

### Detailed instructions

- In `src/cli/program.ts`, add a concise description to every `.argument()` /
  `.addArgument()` call that currently lacks one (the 15 `missing-arg-help`
  cases: `short-name` on `unlock`, `enter`, `enter-phase`, `session-info`,
  `shell`, `path`, `open`, `archive`, `run`, `review-handoff`, `publish-pr`,
  `resume`, `reset-phase`, and `phase-id` on `enter-phase` and `reset-phase`).
  Use Commander's argument-description support (e.g. `.argument("<short-name>",
  "Run short name, e.g. usage-cli")`). Keep them short and consistent; identical
  argument names should get identical descriptions.
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
closes all 16 usage-lint info messages, with code remaining the source of truth.

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
  --archived|--json`), and `archive` (`--force`). Each example must be a real,
  runnable invocation; long help must state side effects explicitly (worktree /
  session / file-affecting / scheduled-run commands).
- Wire `cliDocs` into `src/cli/program.ts` so the runtime `--help` surfaces the
  examples and long help (e.g. via `command.addHelpText("after", …)` and/or
  command long-description). The same metadata feeds the generator — keep
  `cliDocs.ts` the single source so `--help` and the spec never disagree.
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
