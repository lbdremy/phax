---
status: Completed
source-spec: docs/specs/30-provider-contract-discoverability.md
approved:
  date: 2026-09-03
  baseline: 097cd0c
---

# Provider contract discoverability

Implements spec 30: make the orient provider contract and the gate diagnostics
contract readable from the surfaces a developer already reaches for — the
usage spec for the command-owned contract, the generated config schema for the
config-owned contract, the error each emits when unmet, the README, and the
`examples/hello-world` project. No protocol or config shape changes.

---

## Required commands

- node

## Required PHAX security configuration changes

This plan requires the following commands to be added to
`security.agentCommands` in `phax.json` before running:

- `node`

Without this configuration the preflight check will fail before any agent
spawns. `node` is needed so the phase-03 agent can run the example provider
scripts directly while authoring them; the gates exercise them through
`pnpm test` regardless.

---

## Context

Two generators already carry documentation from source to the public surfaces:

- `src/cli/cliDocs.ts` is a command-path-keyed map of `longHelp` + `examples`.
  `src/cli/program.ts` reads it for `--help`, `scripts/generate-usage-spec.ts`
  emits it as `long_help` / `example` nodes in `phax.usage.kdl`
  (`pnpm gen:usage-spec`), and `scripts/docs-cli.ts` regenerates
  `docs/cli/reference.md` plus the README section between
  `<!-- BEGIN GENERATED CLI REFERENCE -->` / `<!-- END … -->` from that KDL
  (`pnpm docs:cli`, needs the `usage` binary). Drift gates:
  `tests/integration/usageSpecDrift.test.ts`, `docsCliDrift.test.ts`, and
  `usageSpecExamples.test.ts` (every `cliDocs` key must emit both nodes).
- `src/schemas/phaxConfig.ts` builds `phax.schema.json` and
  `phax.user.schema.json` with `JSONSchema.make`; Effect annotations surface as
  JSON Schema `description` (the `maxFixAttempts` field already shows one from
  its `between` filter). The committed root schemas are regenerated with
  `pnpm dev schema upgrade`. `tests/unit/phaxConfigJsonSchema.test.ts` pins the
  shape.

Runtime sites the spec touches: `src/cli/commands/orient.ts` (the unconfigured
error), `src/app/gates.ts` (the two "declared diagnostics output but returned
none" provider errors). Contract validation lives in `src/schemas/orient.ts`
and `src/schemas/gateDiagnostics.ts` and must not change.

`examples/hello-world` holds only `phax.json` and `plan.md` (the plan creates
`src/greet.ts` with "no side effects, no I/O"); `tests/unit/examplePlanDeterministic.test.ts`
is the precedent for a test that reads the example.

## Technical arbitrations

- **Contract text authored per surface, pinned by tests.** The orient long
  help (`cliDocs`), the two schema descriptions, and the diagnostics error
  suffix are written for their own reader rather than derived from one shared
  string. Loss accepted: wording can differ between surfaces. Guard: one test
  per contract asserts the normative tokens (spec §6) on every surface that
  carries it, so a fact cannot silently disappear from one of them.
- **`node` declared as a required command.** Loss accepted: a one-line
  `phax.json` edit before the run. The alternative (author the example scripts
  blind and rely on `pnpm test` alone) gives up the agent's ability to try the
  provider by hand while writing it.

---

## phase-01 — Orient contract in the usage spec {#phase-01-orient-usage-contract}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

`phax --usage`, `phax orient --help`, `docs/cli/reference.md` and the README
command list carry the full orient provider contract, and an unconfigured
`phax orient` names where that contract is read. (spec §5.1, §5.2, §5.3, §5.6)

### Detailed instructions

- Add an `orient` entry to `cliDocs` in `src/cli/cliDocs.ts`. Its `longHelp`
  must state every fact in spec §6 "after" block, in this order: the config
  block (`"orient": { "command": "node ./orient.mjs" }`), the no-shell
  whitespace split and its wrapper-script consequence, cwd (current directory;
  the phase worktree during a run), stdin request / stdout response / exit 0,
  the index request `{"files": [...]}` and response `{"rows": [...]}` with the
  `error|warn|info` severity set, the expand request `{"expand": "<id>"}` and
  response `{"row": {...}}` or `{"row": null}`, the all-fields-non-empty rule,
  the provider-error rule (non-zero exit, non-JSON stdout, or schema failure →
  exit 1), the empty-index / null-row → "No orientation available." exit 0
  rule, the run-time index push, and the implicit `phax orient` allowlist grant
  without an `agentCommands` entry. Use `\n\n` paragraph breaks like the other
  entries; avoid characters the KDL escaper does not handle (it escapes `\`,
  `"` and newlines only — see `esc` in `scripts/generate-usage-spec.ts`).
- `examples`: `phax orient core-no-adapters` and
  `phax orient --file src/jobs/sync.ts`.
- In `src/cli/commands/orient.ts`, change the unconfigured message to name
  both the key and the usage entry, per spec §6: keep
  `` Add an `orient: { command }` block to phax.json `` and append
  `` ; the provider contract is documented under `phax --usage` (cmd orient). ``
  Exit code stays 1.
- Run `pnpm gen:usage-spec` then `pnpm docs:cli` and commit the regenerated
  `phax.usage.kdl`, `docs/cli/reference.md`, and README generated section.
  Do not hand-edit any of the three.
- Tests, written first:
  - `tests/unit/cli/orientContractDocs.test.ts`: reads `cliDocs.orient` and
    asserts `longHelp` contains each normative token from spec §8 "Usage spec
    states the full orient contract" (`orient`, `command`, `whitespace`,
    `{"files"`, `{"expand"`, `{"rows"`, `{"row"`, `"error"`, `"warn"`,
    `"info"`, `null`, `exit`, `agentCommands`) and that `examples` has one
    entry starting `phax orient --file` and one `phax orient <id>`-shaped entry
    without `--file`.
  - Update the "no orient provider is configured" case in
    `tests/unit/cli/orient.test.ts` to also assert the error mentions
    `phax --usage`.
  - `usageSpecExamples.test.ts` covers the new key automatically; the two drift
    tests verify the regenerated files.

### Planned files to create

- `tests/unit/cli/orientContractDocs.test.ts`

### Planned files to edit

- `src/cli/cliDocs.ts`
- `src/cli/commands/orient.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`
- `README.md`
- `tests/unit/cli/orient.test.ts`

### Optional files that may be edited

- `tests/integration/usageOutput.test.ts`

### Test strategy

CLI layer: unit test on the `cliDocs` entry (cheapest pin on the normative
facts) and the existing unit test on the unconfigured error path. The
integration drift gates already exercise the generator and the docs pipeline.
Write the two unit tests before touching `cliDocs` and `orient.ts`.

### Implementation order

1. Write `orientContractDocs.test.ts` and extend `orient.test.ts` (red).
2. Add the `cliDocs.orient` entry; change the error message (green).
3. `pnpm gen:usage-spec`, `pnpm docs:cli`; run `pnpm test:integration` to
   confirm the drift gates are green.

### Excluded scope

- Schema descriptions and the diagnostics error (phase-02).
- The README "Orient provider" subsection and the example scripts (phase-03).

### Verification

- The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- The exact `cliDocs` key (`orient`) and the final long-help text, so
  phase-02 can align the schema description wording with it.
- Confirmation that `phax.usage.kdl`, `docs/cli/reference.md`, and the README
  generated section were regenerated, not hand-edited.
- Any deviation from the planned file lists, with the reason.

### Commit subject

docs(orient): document the provider contract in the usage spec

### Commit body

Add a cliDocs entry for `phax orient` carrying the full provider contract
(config key, no-shell tokenization, request/response shapes, exit-code rule,
implicit allowlist grant) and two examples; regenerate phax.usage.kdl, the
CLI reference and the README command list. The unconfigured error now points
at the usage entry. Pinned by a unit test on the normative tokens.

---

## phase-02 — Schema descriptions and the diagnostics error {#phase-02-schema-descriptions}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

`phax.schema.json` describes `orient.command` and the gate step `output` field
with their contracts, and a diagnostic step that returns no decodable document
fails with an error that states the expected document shape. (spec §5.4, §5.5,
§5.7)

### Detailed instructions

- In `src/schemas/phaxConfig.ts`, annotate with an Effect `description`:
  - `OrientConfigSchema.command`: what the command is, whitespace split with no
    shell, JSON request on stdin / JSON response on stdout, and
    "Full contract: `phax --usage`, cmd orient." (spec §6 wording is
    indicative; the three facts are normative).
  - The gate step `output` field: default `"log"` semantics; for
    `"diagnostics"` the document shape
    `{"diagnostics": [{"rule", "location": {"file", "line"?}, "message", "repair"}]}`,
    the three verdict rules (non-empty list fails whatever the exit code; exit 0
    with an empty list passes; missing/undecodable document or non-zero exit
    with an empty list is a provider error that fails the step with the raw
    log), and that a failing document is saved as
    `checks-attempt-NN.diagnostics.json` and drives the fix prompt. Put the
    annotation where `JSONSchema.make` emits it on the `output` property (on
    the field, not only on the shared literal union, if the union placement
    does not surface); verify by inspecting `getPhaxConfigJsonSchema()`.
  - Both config schemas (project and user overlay) share these definitions;
    both generated files change.
- In `src/app/gates.ts`, append the expected shape to both provider-error
  messages (`invalid JSON` and `schema mismatch` branches) via one shared
  constant, e.g.
  `` — expected {"diagnostics": [{"rule", "location": {"file", "line"?}, "message", "repair"}]} on stdout ``.
  Apply it to the `message` handed to `failGate` and to the `provider error:`
  log line. Verdict logic, persisted document, and attribution are untouched.
- Regenerate the committed root schemas with `pnpm dev schema upgrade` and
  commit `phax.schema.json` and `phax.user.schema.json`.
- Tests, written first:
  - `tests/unit/phaxConfigJsonSchema.test.ts`: add cases asserting
    `properties.orient.properties.command.description` contains `whitespace`
    and `phax --usage`, and that the gate step `output` property's
    `description` contains `diagnostics`, `rule`, `location`, `file`, `line`,
    `message`, `repair`, and phrases for the three verdict rules (e.g.
    `non-empty`, `empty list`, `provider error`). Reuse `findGateStepSchema`.
  - `tests/integration/gates.test.ts`, "diagnostics output" block: for a step
    that prints non-JSON, assert the `GateFailure` message names the step
    command and contains `"diagnostics"`, `"rule"`, `"location"`,
    `"message"`, `"repair"`; same for a schema-mismatch document.
  - `tests/unit/schemas/orientConfig.test.ts`: confirm decoding is unchanged
    (annotation must not alter validation).

### Planned files to create

- (none)

### Planned files to edit

- `src/schemas/phaxConfig.ts`
- `src/app/gates.ts`
- `phax.schema.json`
- `phax.user.schema.json`
- `tests/unit/phaxConfigJsonSchema.test.ts`
- `tests/integration/gates.test.ts`

### Optional files that may be edited

- `src/schemas/gateDiagnostics.ts`
- `tests/unit/schemas/orientConfig.test.ts`
- `tests/unit/upgradeConfigSchema.test.ts`

### Boundary contracts

- Consumer: an editor or agent reading `phax.schema.json`. Producer:
  `getPhaxConfigJsonSchema()` via `JSONSchema.make`. Contract: the two
  `description` strings appear on the `orient.command` and gate-step `output`
  properties; no other schema output changes.
- Consumer: the fix loop and the attempt log. Producer: `runGates` in
  `src/app/gates.ts`. Contract: the provider-error message keeps the step
  command and decode reason and gains the expected-shape suffix; `diagnostics`
  stays an empty list on that path.

### Test strategy

Schema layer: unit tests on the generated JSON Schema object (no file I/O).
Application layer: the existing integration test with the fake shell and fake
fs for the gate error path. Write both before changing source.

### Implementation order

1. Extend `phaxConfigJsonSchema.test.ts` and `gates.test.ts` (red).
2. Annotate the two fields; confirm `description` lands on the right nodes.
3. Add the expected-shape constant and suffix in `gates.ts` (green).
4. `pnpm dev schema upgrade`; commit both regenerated schema files.

### Excluded scope

- Descriptions for any other `phax.json` key (spec §7).
- Any change to diagnostics verdict rules or to `src/schemas/orient.ts` /
  `src/schemas/gateDiagnostics.ts` validation semantics.

### Verification

- The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- The final text of both schema descriptions and of the gates error suffix.
- Whether the `output` description required annotating the field or the
  shared literal union, so future schema descriptions follow the same pattern.
- Any deviation from the planned file lists, with the reason.

### Commit subject

docs(schema): describe the orient command and diagnostics output contracts

### Commit body

Annotate `orient.command` and the gate step `output` field so the generated
phax.schema.json states each provider contract next to its key: the orient
command's no-shell tokenization and JSON transport (pointing at `phax --usage`
for the full contract), and the diagnostics document shape with its verdict
rules. A diagnostic step that returns no decodable document now fails with an
error that names the expected document shape. Root schemas regenerated.

---

## phase-03 — README orient section and hello-world providers {#phase-03-readme-and-example}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

The README Configure section documents orient next to the existing diagnostics
bullet, and `examples/hello-world` ships a working orient provider and a
diagnostic gate step, both dependency-free Node scripts, with a test that
decodes their output against phax's validation. (spec §5.8, §5.9, §5.10)

### Detailed instructions

- README: add a `### Orient provider` subsection inside `## Configure`, after
  the paragraph that starts "The top-level `name` is the run namespace" and
  before `## Configuration layers`. Content: an `"orient": { "command": … }`
  block, a short contract summary in the same terms as the phase-01 long help
  (request/response shapes, exit rule, whitespace split, implicit allowlist),
  and a link `[`phax orient`](docs/cli/reference.md#phax-orient)`. Leave the
  existing `output` bullet (diagnostics) untouched. Do not edit inside the
  generated CLI reference markers.
- `examples/hello-world/orient.mjs` (ESM, Node built-ins only): read all of
  stdin, `JSON.parse` it; hold an inline row table of two or three rows, e.g.
  `keep-it-simple` (`info`, trigger `src/**`, "hello-world stays a single
  file") and `no-io` (`error`, trigger `src/**`, "greet has no side effects
  and no I/O"), each with a `body`. On `{files}` print
  `{"rows": [...]}` with the four index fields for rows whose trigger prefix
  (`src/`) matches any file; on `{expand}` print `{"row": …}` with `body`, or
  `{"row": null}` for an unknown id. Always exit 0; never print anything else
  on stdout.
- `examples/hello-world/audit.mjs`: walk `src/` (if present) for `.ts` files
  and report a diagnostic for every line matching `from "node:` or
  `require("node:`: rule `HW_NO_IO`, `location` `{file, line}`, message
  "greet must not perform I/O", repair `plan.md#phase-01-greet-function`.
  Print `{"diagnostics": [...]}` (an empty list on the current tree, which
  has no `src/`) and exit 0.
- `examples/hello-world/phax.json`: add `"orient": { "command": "node ./orient.mjs" }`
  and a step `{ "command": "node ./audit.mjs", "surface": "structural", "firing": "every-phase", "output": "diagnostics" }`
  to the `standard` profile. Also add `node` to a `security.agentCommands`
  list in the example config, since `node` is what the example's own run would
  need.
- `tests/integration/exampleProviders.test.ts`, written first. Spawn `node`
  with cwd `examples/hello-world` (use `node:child_process` synchronously,
  like `docsCliDrift.test.ts` does with `usage`):
  - index request for `["src/greet.ts"]` → decode with
    `decodeOrientIndexResponse`; at least one row.
  - expand request for that row's id → decode with
    `decodeOrientExpandResponse`; `row` non-null with a `body`.
  - expand of an unknown id → `{"row": null}` decodes.
  - `audit.mjs` on the example tree → decode with
    `decodeGateDiagnosticsDocument`; empty list, exit 0.
  - copy the example into a temp dir, add `src/x.ts` containing
    `import { readFileSync } from "node:fs";`, run `audit.mjs` there → one
    diagnostic with rule `HW_NO_IO` and a `line`.
  - decode `examples/hello-world/phax.json` with `decodePhaxConfig` from
    `src/schemas/phaxConfig.ts`; assert `orient` is set and one `standard`
    step has `output: "diagnostics"`.
- Keep both scripts lint- and format-clean under oxlint/oxfmt (they are inside
  the repo and not in the ignore patterns).

### Planned files to create

- `examples/hello-world/orient.mjs`
- `examples/hello-world/audit.mjs`
- `tests/integration/exampleProviders.test.ts`

### Planned files to edit

- `README.md`
- `examples/hello-world/phax.json`

### Optional files that may be edited

- `knip.json`
- `.oxlintrc.json`

### Test strategy

CLI/E2E layer for the example: an integration test that runs the real scripts
through `node` and decodes their stdout with the production decoders — the
same validation phax applies at runtime, so the example cannot drift from the
contract. Write it first; the scripts are its implementation.

### Implementation order

1. Write `exampleProviders.test.ts` (red).
2. Write `orient.mjs`, then `audit.mjs`, then the `phax.json` additions
   (green).
3. Add the README subsection last; run `pnpm format` before the gate.

### Excluded scope

- A `phax init` wizard question for either contract (spec §7).
- Any change to the hello-world `plan.md` or its deterministic-extraction test.

### Verification

- The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- The row ids the example provider serves and the diagnostic rule id, so the
  spec's acceptance criteria can be walked by hand in `examples/hello-world`.
- Whether knip or oxlint needed configuration for the `.mjs` files.
- Any deviation from the planned file lists, with the reason.

### Commit subject

docs(examples): add orient provider and diagnostic step to hello-world

### Commit body

Document the orient provider under Configure in the README next to the
diagnostics bullet, and ship two dependency-free Node scripts in
examples/hello-world: an orient provider serving a small row table and a
diagnostic gate step that reports `node:` imports under src/. An integration
test runs both through node and decodes their output with phax's own
decoders, so the example stays a conforming reference for each contract.
