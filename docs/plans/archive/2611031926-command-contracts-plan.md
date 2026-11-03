---
status: Completed
source-spec: docs/specs/2611031738-command-contracts.md
completes-spec: false
approved:
  date: 2026-11-03
  baseline: 3c1b5b4
---
# Command runner and mod answers

The first plan of the spec `command-contracts`. It ports the operator's command library (vendor/command-library/, Effect 4) to Effect 3 inside phax's own source: the contract under src/cli/commandLibrary/contract/ and its Commander runner under src/cli/commandLibrary/commander/, with the conformance suite as phax tests and every gain §10 settles. It then puts a bridge between today's Commander program and the runner, and moves the four commands the Claude Code mod reads onto the runner: `artifact status`, `plans overview`, `plans lint` and `ls`. The formats `artifact-status`, `plan-overview` and `plan-lint` are born at 0.34.0, and `run-list` gains `pullRequest`.

Phases: phase-01 ports the contract and writes the conformance cases as acceptance tests against a stub runner. phase-02 ports the runner, passes them and deletes vendor/command-library/. phase-03 adds the bridge, the `refused` (64) and `defect` (70) codes and the hybrid usage-spec generator. phase-04 adds the four formats and writes the four commands' acceptance tests. phase-05 moves the four commands onto the runner and passes those tests.

Criteria this plan covers in full: ac-misdeclared, ac-json-schema-command, ac-lint-verdict, ac-artifact-status, ac-overview, ac-run-pr, ac-defect, ac-written-on-failure and ac-usage-flag.

Criteria this plan covers on the port and the four commands, finished by later plans:
- ac-catalogue: one entry per command.
- ac-unknown-option: a `refused` line on every command.
- ac-groups: the runner owns every group.
- ac-json-every-command.
- ac-text-unchanged.
- ac-help.
- ac-usage-parity: the file is the generator's output alone.
- ac-no-parser: every definition is free of Commander.
- ac-versioned-stable.
- ac-error-sentence: `resume`.
- ac-stdin-file-or-dash, ac-stdin-terminal and ac-stdin-bad: `artifact decide --verdicts`.
- ac-brief-text: `artifact new --brief`.
- ac-written: `artifact approve`.
- ac-progress: `run --dry-run`.

ac-no-person waits entirely for later plans, because `enter` and `artifact decide` move then. The spec's every-command criteria hold only once the last plan ships.

Expected split of the later plans (the operator writes each brief from it):
- Plan 2, inspection commands: validate, session-info, path, cost, brief, architecture, completions, report, the `schema`, `security`, `skills` and `records` groups, and the rest of `plans` (status, overlap, estimate).
- Plan 3, lifecycle and authoring: the rest of the `artifact` group, including `new spec|plan` with its text `--brief` document, approve, reopen, complete, abandon, stale, `decide` with `--verdicts`, and the migrate commands; the `agent` group; init, unlock, archive and prune.
- Plan 4, runs and sessions, with the bridge removed: run, resume, reset-phase, enter, enter-phase, shell, open, review-handoff, publish-pr, review-compliance, review-code and adjust-plan. The runner then owns the program, Commander is imported by the port alone, and `phax.usage.kdl` is the generator's output from the definitions alone. That plan also adds the docs page reference/json-output and completes the spec.

Execution caveat: this repository is driven by the installed phax 0.33.0 during the run, and nothing this plan changes is read by it. Every test proves the runner through its `Io` data or through `tsx src/cli/main.ts` spawned in a temporary repository. No test reads ~/.phax, a real ~/.claude, ~/.codex or ~/.vibe, the global git config, or the real `gh`.

## Required commands

- `pnpm exec tsx`
- `pnpm gen:usage-spec`
- `pnpm docs:cli`

Every command above is already in `security.agentCommands` in phax.json: `pnpm exec tsx` runs scripts/schemas-check.ts, `pnpm gen:usage-spec` rewrites phax.usage.kdl and `pnpm docs:cli` rewrites the README's generated CLI block. No security configuration change is needed. The plan declares no skill file, so the run needs no `--allow-skill-edits`.

## Technical arbitrations

- A migrated command and an unmigrated one share one program through a bridge. Today's Commander program stays the host until the last plan. src/cli/bridge.ts dispatches before Commander parses: a call whose words name a runner command, or the root `--json-schema`, goes to the runner; any other call goes to Commander. Each runner command is also mounted in the Commander tree as a stub, for help only. Loss accepted: until the last plan the runner does not own the program. Root help, `--version`, a group called alone and every refusal of an unmigrated command are bridge glue. On an unmigrated command meanwhile: `--json` keeps its own meaning where the command declares one, and is otherwise refused with 64 in text; `--json-schema` is refused with 64; the catalogue lists migrated commands only; a refusal exits 64 with today's sentence but no `refused` line; a crash exits 70 with `defect: …`. The alternative, the runner owning the program and mounting Commander commands through a hook, abandons the port's fidelity: a phax-only hook in the runner's parse path that upstream would never take. The bridge is internal, not a persisted shape, and the last plan removes it.
- This plan moves single commands inside a bridged group, not whole groups. `artifact` and `plans` stay Commander groups that list both their migrated and their unmigrated commands. The runner's program declares the same group holding only the migrated commands, so each one's name words, catalogue entry and help are the runner's. Loss accepted: a group's own behaviour (its help, and its refusal when called alone) stays Commander's until its last command moves. Moving whole groups would abandon this plan's scope: `artifact` alone holds more than a dozen commands, with authoring and decide sessions.
- `phax.usage.kdl` during the transition: scripts/generate-usage-spec.ts keeps today's walk for the root, the `complete` nodes and every unmigrated command. At each migrated command's position it splices that command's `cmd` block, cut from the port's `usageSpec(phaxProgram)`. The root gains the program-level `--json-schema` flag and documents the `refused` and `defect` codes. The parity gate (the file equals the generator's output) holds on every commit. A new test compares the file's declarations, node by node, with a frozen copy of today's file. Loss accepted: two KDL styles in one file until the last plan, child nodes for unmigrated commands and properties for migrated ones; `usage` reads both. The last plan makes the file the port's output alone.
- The port lives in the cli layer, as the library's two packages: src/cli/commandLibrary/contract/ (pure: imports neither `commander` nor a `node:` module) and src/cli/commandLibrary/commander/. In commander/, commanderAdapter.ts is the only importer of `commander`, and processIo.ts is the one process edge, listed in the CLI_DIRECT_IO_ALLOWLIST of tests/unit/architecturalGuards.test.ts. phax's migrated definitions live in src/cli/definitions/, which never imports `commander`. The conformance cases stay library source under contract/conformance/, as the library ships them. Their runner is tests/unit/commandLibrary/conformance.test.ts, and the other tests live under tests/unit/commandLibrary/{contract,commander}/. Loss accepted: the audit names the port by path, not by a layer of its own. A top-level src/commandLibrary/ would abandon the audit's four-layer model, adding a fifth folder its rules do not know.
- What Effect 3 changes from the Effect 4 source, per module; everything else keeps the library's export names and file split. Every module: `.ts` import suffixes become `.js` (NodeNext), and `@steme-lab/cli-command` imports become relative imports of src/cli/commandLibrary/contract/index.ts. command.ts: `Schema.Top` becomes `Schema.Schema.Any`, and the tuple and struct element types become their Effect 3 forms. define.ts: `reject`/`strip` and `DocumentOutput` are rebuilt on Effect 3 Schema. shapes.ts: the AST reads move to Effect 3 SchemaAST (identifier and description annotations, literal unions for choices), and a default comes from `Schema.optionalWith(…, { default })` instead of `withDecodingDefault`. catalogue.ts: the JSON Schemas come from Effect 3's `JSONSchema.make`, emitted in draft 2020-12 as the installed `effect` allows (target option or a dialect rewrite). runner run.ts and json.ts: `Schema.decodeUnknownExit` with `onExcessProperty` becomes `Schema.decodeUnknownEither` with the same option, and the refused line's path and expected value are read from `ParseResult.ArrayFormatter`. outcome.ts: the Cause reads use Effect 3's `Cause.failureOption` and `Cause.dieOption` (`Cause.squash` stays). Each API is checked against the installed `effect` in node_modules, not against memory.
- The gains the port makes, each written as the library would carry it and documented as a gain in its module. Groups hold groups. An argument's schema annotation declares its completer, written as top-level `complete` nodes. A command declares `verdicts`, codes its successful output answers with. A text stdin document is handed to run as read. `run` receives `progress`, written as note lines as they happen. A command declares `texts`, a declared error's sentence for a person. The program names its usage flag (`--usage`, `--usage-format`) instead of the hidden `--usage-spec`, and says where its usage spec lists `--json-schema` (on every command, the library's default, or once at the root). The usage spec writes the program's `refused` and `defect` codes at the root. The program declares options for every command (`--verbose`, `--trace`). A stdin flag may require its value, spaced or attached (`--verdicts <file|->`), per q-stdin-flag-value. phax lists `--json-schema` once at the root, so §5.21's "only `--json` added" holds.
- Under `--json` inside a phase worktree, the phase guard still refuses before any command runs, with exit 1. It writes one `refused` line: `source` "command", `path` the command's words, `expected` "a command allowed inside a phase worktree", `text` today's sentence and `exit` 1. Without `--json` it writes today's sentence. Loss accepted: a refused line whose exit is not the program's `refused` code. The guard's code is documented as 1 and the spec keeps it.

## Arbitrated questions

### q-ls-records-column — Today `phax ls` shows its RECORDS column whenever this project's records are configured, even when no listed run belongs to this project, so every cell is `-`. The run-list document cannot say this: a row's `recordsPending` is null both when records are off and when the row belongs to another project. A render reads only the output. How does the migrated `ls` keep today's table?

- derive — Render the RECORDS column when at least one row's `recordsPending` is a number, and read nothing beyond the run-list document — abandons: today's table in one case: records configured and no listed run of this project, where a column of `-` cells disappears
- view-gain — A further gain: `run` may hand `render` a view-only value beside the output, which `--json` never writes, so `ls` passes whether records are configured — abandons: the library's rule that a render reads only the output: one more gain outside §10's settled list for the published package to take upstream, for a single column

Recommendation: derive — The column it drops in that one case holds only `-` cells and carries no fact. A render that reads only the document is the pattern every later command follows, and the gain would widen the contract for one cosmetic column.

Decision: derive — by operator (Rémy Loubradou), 2026-11-03
Why: The column of `-` cells carries no fact; the render reads only the run-list document, as every later command will. Advocate: The strongest case for view-gain: it keeps today's table byte for byte in every case, including records configured with no run of this project, so the text a person reads from `ls` never changes, as §5.4 and §7 require. Principles: C1, C5. Reversibility: cheap. Revised: none. Phase: phase-05.

## Decision log

- 2026-11-03 q-ls-records-column decided derive — operator (Rémy Loubradou)

---

## phase-01 — The contract ported to Effect 3, with the conformance cases as acceptance tests {#phase-01-contract-port}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium
**Assignment reason:** The phase ports a library that no code in the repository holds yet and designs the contract shapes of ten gains across define, catalogue, usage and the conformance cases.
**Acceptance phase:** passed by phase-02
**Acceptance test files:** `tests/unit/commandLibrary/conformance.test.ts`, `src/cli/commandLibrary/contract/conformance/cases.ts`, `src/cli/commandLibrary/contract/conformance/memoryIo.ts`, `src/cli/commandLibrary/contract/conformance/suite.ts`

The command library's contract (what a command, a group and a program are, the policies, written-file records, the catalogue, the usage spec, the message lines) exists in phax's source on Effect 3, with every gain. The library's conformance cases, and one per gain, are written and frozen as acceptance tests against a stub runner that phase-02 replaces.

### Detailed instructions

- Read vendor/command-library/README.md, vendor/command-library/cli-command/ in full (src/, the samples program.ts and rename-todo.command.ts, refused.ts, tests/), the spec's §5, §6, §8, §9b and §10, and this plan's Technical arbitrations. Port from the vendor folder; never import it and never edit it (phase-02 deletes it).
- Create the contract under src/cli/commandLibrary/contract/, one file per library module, keeping each module's export names. command.ts is contracts/command.ts. conformanceReport.ts is contracts/conformance.ts. define.ts, written.ts, catalogue.ts, shapes.ts, usage.ts and messages.ts keep their names. index.ts re-exports exactly the library's src/index.ts names plus the gains' new names. conformance/index.ts is the library's `/conformance` entry and exports `conformance`. conformance/suite.ts, conformance/cases.ts and conformance/memoryIo.ts are internal/conformance/*.
- Apply the Effect 3 changes named in Technical arbitrations to command.ts, define.ts, shapes.ts and catalogue.ts. Check every API against the installed `effect` in node_modules. tsconfig is strict, with exactOptionalPropertyTypes, noUncheckedIndexedAccess and noPropertyAccessFromIndexSignature: fix the port to pass them without loosening any type the library declares.
- Add the gains to the contract, each with a doc comment saying it is a gain carried for upstream.
  - Groups holding groups: `defineGroup` takes commands and groups. A command's grouping becomes its chain of group names. The catalogue's name words, the usage spec's nested `cmd` nodes and `fullName` follow the chain.
  - Completers: an argument element's annotation declares `{ run, descriptions }` under its identifier. `usageSpec` writes one top-level `complete "<identifier>" run=… descriptions=#true` node per distinct identifier, in declaration order.
  - Verdict codes: `CommandDef.verdicts`, from code to a predicate over the output. The catalogue entry lists them. A program where a verdict code equals `refused`, `defect` or 0 is misdeclared.
  - A text stdin document: a stdin source declares that its contract reads text. The runner then hands `run` the string as read, under the same reading and refusal rules as JSON.
  - Progress: the run context gains `progress: (text) => Effect<void>`.
  - A declared error's text form: `CommandDef.texts`, from tag to a function of the error returning the sentence for a person.
  - The program's usage flag: `Program.usage`, with the flag's name, an optional format option, and where `--json-schema` is listed ("every-command", the default, or "program"). It replaces the hidden `--usage-spec` in `usageSpec`.
  - The program's exits documented: `usageSpec` writes the `refused` and `defect` codes at the root.
  - Options for every command: `Program.options`, a flags source decoded from the call's words wherever they stand and handed to every run as `context.program`. `usageSpec` writes them as `global=#true` flags.
  - A required stdin-flag value: a stdin source may declare its flag's value required, `<file|->`, spaced or attached (q-stdin-flag-value keep-value). The usage spec and the catalogue show `<file|->` for it.
- Port every library conformance case into conformance/cases.ts with its id and its meaning unchanged. Add one case per gain, each stating its expectation and naming the gain in a comment, with these ids:
  - `groups.nested-alone-refused`
  - `groups.nested-run`
  - `usage.complete-nodes`
  - `exits.verdict-code`
  - `exits.verdict-collides`
  - `stdin.text-document`
  - `stdin.flag-value-required`
  - `notes.progress-streamed`: a progress note reaches `err` before `out` gets the output
  - `error.text-form`: the sentence without `--json`, only the line with it
  - `usage.program-flag`
  - `usage.json-schema-listing`
  - `usage.program-exits`
  - `options.program-wide`
  conformance/memoryIo.ts records `out` and `err` writes in order, so `notes.progress-streamed` can see the order.
- Create the stub runner at src/cli/commandLibrary/commander/index.ts. It exports `runner: Runner`, whose `run` dies with `new Error("command runner not implemented (phase-02)")`. It exports nothing else.
- Write the acceptance test tests/unit/commandLibrary/conformance.test.ts, as the library's runner conformance test does. It computes `conformance(runner)` against the stub once, at module scope, then registers `it.fails(entry.id, …)` for every case not in a named constant CONTRACT_ONLY, each expecting `entry.held` to be true. CONTRACT_ONLY lists the ids that hold without a runner, such as a case that checks `written()` alone. Fix that list by running the suite against the stub. Those ids are checked as plain `it` in tests/unit/commandLibrary/contract/conformanceContractOnly.test.ts, which is not an acceptance test file.
- Port the contract's own tests to tests/unit/commandLibrary/contract/: define.test.ts, written.test.ts with its fixture fixtures/written-record.json, exports.test.ts (the index's names, the library's plus the gains', exactly) and caseIds.test.ts (case ids unique and well formed). Do not port package.test.ts: it checks npm packaging, which the port does not have.
- Port the samples as type tests: tests/type/commandLibrarySamples.ts holds program.ts and rename-todo.command.ts, and tests/type/commandLibraryRefused.ts holds refused.ts, each refused declaration under `@ts-expect-error`. Copy rename-todo.command.ts also to tests/unit/commandLibrary/support/renameTodo.ts, which phase-02's runner tests import at run time.
- Add to tests/unit/architecturalGuards.test.ts a guard that no file under src/cli/commandLibrary/contract/ imports `commander` or a `node:` module.
- No phax command uses the port yet. Keep knip green: every export is reached by a test, and the stub's only export is `runner`.

### Planned files to create

- `src/cli/commandLibrary/contract/index.ts`
- `src/cli/commandLibrary/contract/command.ts`
- `src/cli/commandLibrary/contract/conformanceReport.ts`
- `src/cli/commandLibrary/contract/define.ts`
- `src/cli/commandLibrary/contract/written.ts`
- `src/cli/commandLibrary/contract/catalogue.ts`
- `src/cli/commandLibrary/contract/shapes.ts`
- `src/cli/commandLibrary/contract/usage.ts`
- `src/cli/commandLibrary/contract/messages.ts`
- `src/cli/commandLibrary/contract/conformance/index.ts`
- `src/cli/commandLibrary/contract/conformance/suite.ts`
- `src/cli/commandLibrary/contract/conformance/cases.ts`
- `src/cli/commandLibrary/contract/conformance/memoryIo.ts`
- `src/cli/commandLibrary/commander/index.ts`
- `tests/unit/commandLibrary/conformance.test.ts`
- `tests/unit/commandLibrary/contract/conformanceContractOnly.test.ts`
- `tests/unit/commandLibrary/contract/define.test.ts`
- `tests/unit/commandLibrary/contract/written.test.ts`
- `tests/unit/commandLibrary/contract/exports.test.ts`
- `tests/unit/commandLibrary/contract/caseIds.test.ts`
- `tests/unit/commandLibrary/contract/fixtures/written-record.json`
- `tests/unit/commandLibrary/support/renameTodo.ts`
- `tests/type/commandLibrarySamples.ts`
- `tests/type/commandLibraryRefused.ts`

### Planned files to edit

- `tests/unit/architecturalGuards.test.ts`

### Optional files that may be edited

- `knip.json`
- `tsconfig.test.json`

### Boundary contracts

Producer: src/cli/commandLibrary/contract/index.ts. Consumers: the runner (phase-02), the bridge (phase-03) and phax's definitions (phase-05). Contract: the library's export names, unchanged, plus the gains' additions. Producer: contract/conformance/index.ts (`conformance(runner)`). Consumer: tests/unit/commandLibrary/conformance.test.ts. Contract: one report entry per case id, held or not with a reason. The cases are frozen from this phase on.

### Test strategy

- an unknown command, an undeclared argument or option, or a source that does not decode runs nothing, exits with the program's refused code and writes one refused line under --json — small · table · the refused.*, flags.* and undeclared conformance cases · acceptance · ac-unknown-option
- a death or an output that does not encode exits with the defect code, with a defect line under --json and defect text without it — small · example · the defect.* conformance cases · acceptance · ac-defect
- a program whose codes collide, a command declaring the defect code or a verdict code that collides, or an option json, json-schema or out beside writing a document, runs nothing and names the command — small · table · the defect.code, defect.command-maps-defect-code, exits.verdict-collides, json.reserved and out.reserved cases · acceptance · ac-misdeclared
- a command's --json-schema prints its catalogue entry, runs nothing, and equals that command's entry in the program's catalogue — small · example · the catalogue.command and groups.own-contracts cases · acceptance · ac-json-schema-command
- the program's --json-schema prints program, version, exits, one entry per command and the five message shapes — small · example · the catalogue.program case · acceptance · ac-catalogue
- a document read through its flag from a file or from stdin on `-` reaches run the same, an absent flag never reads stdin, and a required flag value may be spaced or attached — small · table · the stdin.flag-sources, stdin.flag-absent-unread, stdin.piped and stdin.flag-value-required cases · acceptance · ac-stdin-file-or-dash
- a call that would read stdin while it is a terminal is refused at once, naming the flag, without reading — small · example · the stdin.terminal-refused case and the memory Io's untouched stdin · acceptance · ac-stdin-terminal
- an unreadable file or a document that does not decode is refused before run, naming the path or stdin and the failing field — small · example · the stdin.unreadable-refused and refused.line cases · acceptance · ac-stdin-bad
- a text stdin document reaches run as read, under the same reading and refusal rules as a JSON one — small · example · the stdin.text-document case · acceptance · ac-brief-text
- a command's written files are its written-file records, path from the root, format or null, sha256 digest of 64 lowercase hex digits, and one written line each under --json — small · example · the written.record case and the written-record fixture · acceptance · ac-written
- a declared error raised after a write carries that file's record in its error line's written — small · example · the error.written case · acceptance · ac-written-on-failure
- a progress note reaches stderr as a note line before the output reaches stdout — small · example · the order of writes the memory Io records in the notes.progress-streamed case · acceptance · ac-progress
- a group called alone at any depth writes its help on stderr and is refused, while its nested commands run — small · example · the groups.nested-alone-refused and groups.nested-run cases · acceptance · ac-groups
- an output answering a declared verdict code is written in both modes and the call exits with that code — small · example · the exits.verdict-code case · acceptance · ac-lint-verdict
- a declared error writes its sentence and code without --json, and only its error line with --json — small · example · the error.text-form and error.line cases · acceptance · ac-error-sentence
- --json writes the output's encoded form two-space indented with one newline and $schema first, and stderr carries only message lines — small · table · the json.* and notes.lines cases · acceptance · ac-json-every-command
- --help and --version answer in text and a command's help lists --json — small · example · the help.program, help.command and version cases · acceptance · ac-help
- the usage spec is written from the definitions with complete nodes, the program's usage flag, --json-schema listed where the program says and the program's exits — small · example · the usage.* cases and their expected KDL · acceptance · ac-usage-parity
- program-wide options are decoded once from anywhere in the call and handed to every run — small · example · the options.program-wide case · acceptance
- the conformance cases that need no runner hold against the contract alone — small · example · the CONTRACT_ONLY cases of the suite · in-phase
- definitions, written-file records, the index's export names and the case ids behave as the library's own tests say — small · example · the library's contract tests, ported · in-phase
- the library's samples compile and every refused declaration fails to compile — small · example · tsc under pnpm test:type with @ts-expect-error · in-phase
- the contract imports neither commander nor a node: module — small · example · the architecture guard's import scan · in-phase

### Implementation order

1. command.ts, conformanceReport.ts and messages.ts
2. written.ts, define.ts and shapes.ts
3. catalogue.ts and usage.ts, with the gains
4. index.ts and the stub runner
5. conformance/memoryIo.ts, cases.ts, suite.ts and index.ts
6. contract tests and type samples
7. conformance.test.ts with its markers, and the contract-only test
8. architecture guard

### Excluded scope

- The runner: the Commander adapter, processIo, the decode and encode loop and the runner's own tests (phase-02).
- Deleting vendor/command-library/ (phase-02).
- Any phax command, src/cli/program.ts, main.ts or the usage generator (phase-03 onward).

### Verification

The `standard` gate profile in phax.json, with the configured acceptance provider judging the acceptance test files (authored).

### Expected handoff content

List the module paths under src/cli/commandLibrary/contract/ and the export names index.ts adds for the gains, with their shapes: Group with nested groups, the completer annotation key, `verdicts`, the text stdin declaration, `progress`, `texts`, `Program.usage`, `Program.options` and the required stdin-flag value. Give the Effect 3 API each module uses in place of the Effect 4 one. Give the full list of case ids, marking the new gain cases and the CONTRACT_ONLY ids with why each holds without a runner. Describe the stub runner's exact form. Explain any deviation from the planned file lists.

### Commit subject

`feat(cli): port the command library's contract to Effect 3 with its conformance cases`

### Commit body

Port the operator's command library contract into src/cli/commandLibrary/contract/ on
Effect 3, keeping the library's export names: commands, groups, programs, the reject
and strip policies, written-file records, the contracts catalogue, the usage spec
and the message lines. Add the gains the spec settles: nested groups, argument
completers, verdict codes, a text stdin document, progress notes, an error's text
form, the program's usage flag and exits, program-wide options and a required
stdin-flag value.

The library's conformance cases, and one per gain, are frozen as acceptance tests
against a stub runner that the next phase replaces.

---

## phase-02 — The Commander runner ported to Effect 3, the cases passed and the vendor copy removed {#phase-02-commander-runner}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high
**Assignment reason:** The runner's 760-line parse, decode, encode and render loop moves from Effect 4 to Effect 3 while the gains reshape it. Its acceptance cases are frozen, so the phase cannot adjust one it disagrees with: higher effort.

The runner (`runner` and `processIo`) runs any program of the contract over Commander on Effect 3 and holds every conformance case, including each gain's. The vendored library is gone from the repository.

### Detailed instructions

- Read vendor/command-library/cli-command-commander/ in full (src/, edge.ts, refused.ts, tests/ and tests/support/), the contract phase-01 wrote under src/cli/commandLibrary/contract/, and the handoff.
- Port the runner to src/cli/commandLibrary/commander/, keeping the library's export names:
  - commanderAdapter.ts is adapters/commander.ts, the only file of the port that imports `commander`.
  - processIo.ts is adapters/process-io.ts.
  - json.ts, outcome.ts, run.ts, shape.ts, stdin.ts and undeclared.ts keep their names.
  Replace the stub in index.ts with the library's exports, `runner` and `processIo`.
- Apply the Effect 3 changes named in Technical arbitrations to run.ts, json.ts and outcome.ts. Check each API against the installed `effect`.
- Carry the gains in the runner:
  - Nested groups: one Commander node per group, at any depth. A group called alone writes its help on stderr and is refused with the program's `refused`. The matched key is every word of the full name.
  - Verdict codes: the first matching code wins, after encoding the output and writing it in either mode.
  - A text stdin document: no JSON parse.
  - `progress`: each note is written as a note line (under `--json`) or a plain stderr line (without) at the moment `run` calls it.
  - `texts`: a declared error's sentence is written on stderr without `--json`; under `--json` only the error line, with the library's fields.
  - `Program.usage`: the runner answers the named flag with `usageSpec`, which no longer carries a hidden `--usage-spec`.
  - `Program.options`: read from the call's words wherever they stand and handed to every run.
  - The required stdin-flag value: `--verdicts <file|->`, spaced or attached.
  - The misdeclared-program check gains verdict collisions.
- Remove the `.fails` marker from tests/unit/commandLibrary/conformance.test.ts. That is the only change to the acceptance test files: cases.ts, memoryIo.ts and suite.ts stay as committed. When a case cannot hold, fix the runner, never the case. When the case itself is wrong, stop and say so in the handoff.
- Port the runner's own tests to tests/unit/commandLibrary/commander/, with support/memoryIo.ts and support/todos.ts from tests/support/: catalogue, exports, faultyRunners, groups, help, json, neverExits, outcomes, policies, processIo, reading, samples, stdinFlag, undeclared and usage. Each file is named after its library test in camelCase. Import the rename-todo sample from tests/unit/commandLibrary/support/renameTodo.ts. Skip package.test.ts (npm packaging). processIo.test.ts uses temporary files and a fake process object, never the real stdin. Add tests for the gains where the library's tests group them (groups, usage, stdinFlag, outcomes, json).
- Port edge.ts and refused.ts of the runner package as the type test tests/type/commandLibraryRunnerRefused.ts, each refused declaration under `@ts-expect-error`.
- tests/unit/architecturalGuards.test.ts:
  - add src/cli/commandLibrary/commander/processIo.ts to CLI_DIRECT_IO_ALLOWLIST, commented as the port's one process edge;
  - add a guard that, under src/cli/commandLibrary/, only commander/commanderAdapter.ts imports `commander`.
- Delete vendor/command-library/ entirely, every file listed in this phase's planned edits. Remove `vendor` from the ignore lists of knip.json, .oxlintrc.json and .oxfmtrc.json, unless another vendored path still needs it (none does today).
- No phax command uses the runner yet.

### Planned files to create

- `src/cli/commandLibrary/commander/commanderAdapter.ts`
- `src/cli/commandLibrary/commander/processIo.ts`
- `src/cli/commandLibrary/commander/json.ts`
- `src/cli/commandLibrary/commander/outcome.ts`
- `src/cli/commandLibrary/commander/run.ts`
- `src/cli/commandLibrary/commander/shape.ts`
- `src/cli/commandLibrary/commander/stdin.ts`
- `src/cli/commandLibrary/commander/undeclared.ts`
- `tests/unit/commandLibrary/commander/support/memoryIo.ts`
- `tests/unit/commandLibrary/commander/support/todos.ts`
- `tests/unit/commandLibrary/commander/catalogue.test.ts`
- `tests/unit/commandLibrary/commander/exports.test.ts`
- `tests/unit/commandLibrary/commander/faultyRunners.test.ts`
- `tests/unit/commandLibrary/commander/groups.test.ts`
- `tests/unit/commandLibrary/commander/help.test.ts`
- `tests/unit/commandLibrary/commander/json.test.ts`
- `tests/unit/commandLibrary/commander/neverExits.test.ts`
- `tests/unit/commandLibrary/commander/outcomes.test.ts`
- `tests/unit/commandLibrary/commander/policies.test.ts`
- `tests/unit/commandLibrary/commander/processIo.test.ts`
- `tests/unit/commandLibrary/commander/reading.test.ts`
- `tests/unit/commandLibrary/commander/samples.test.ts`
- `tests/unit/commandLibrary/commander/stdinFlag.test.ts`
- `tests/unit/commandLibrary/commander/undeclared.test.ts`
- `tests/unit/commandLibrary/commander/usage.test.ts`
- `tests/type/commandLibraryRunnerRefused.ts`

### Planned files to edit

- `src/cli/commandLibrary/commander/index.ts`
- `tests/unit/commandLibrary/conformance.test.ts`
- `tests/unit/architecturalGuards.test.ts`
- `knip.json`
- `.oxlintrc.json`
- `.oxfmtrc.json`
- `vendor/command-library/README.md`
- `vendor/command-library/cli-command-commander/README.md`
- `vendor/command-library/cli-command-commander/edge.ts`
- `vendor/command-library/cli-command-commander/package.json`
- `vendor/command-library/cli-command-commander/refused.ts`
- `vendor/command-library/cli-command-commander/src/adapters/commander.ts`
- `vendor/command-library/cli-command-commander/src/adapters/process-io.ts`
- `vendor/command-library/cli-command-commander/src/index.ts`
- `vendor/command-library/cli-command-commander/src/internal/json.ts`
- `vendor/command-library/cli-command-commander/src/internal/outcome.ts`
- `vendor/command-library/cli-command-commander/src/internal/run.ts`
- `vendor/command-library/cli-command-commander/src/internal/shape.ts`
- `vendor/command-library/cli-command-commander/src/internal/stdin.ts`
- `vendor/command-library/cli-command-commander/src/internal/undeclared.ts`
- `vendor/command-library/cli-command-commander/tests/catalogue.test.ts`
- `vendor/command-library/cli-command-commander/tests/conformance.test.ts`
- `vendor/command-library/cli-command-commander/tests/exports.test.ts`
- `vendor/command-library/cli-command-commander/tests/faulty-runners.test.ts`
- `vendor/command-library/cli-command-commander/tests/groups.test.ts`
- `vendor/command-library/cli-command-commander/tests/help.test.ts`
- `vendor/command-library/cli-command-commander/tests/json.test.ts`
- `vendor/command-library/cli-command-commander/tests/never-exits.test.ts`
- `vendor/command-library/cli-command-commander/tests/outcomes.test.ts`
- `vendor/command-library/cli-command-commander/tests/package.test.ts`
- `vendor/command-library/cli-command-commander/tests/policies.test.ts`
- `vendor/command-library/cli-command-commander/tests/process-io.test.ts`
- `vendor/command-library/cli-command-commander/tests/reading.test.ts`
- `vendor/command-library/cli-command-commander/tests/samples.test.ts`
- `vendor/command-library/cli-command-commander/tests/stdin-flag.test.ts`
- `vendor/command-library/cli-command-commander/tests/support/memory-io.ts`
- `vendor/command-library/cli-command-commander/tests/support/todos.ts`
- `vendor/command-library/cli-command-commander/tests/undeclared.test.ts`
- `vendor/command-library/cli-command-commander/tests/usage.test.ts`
- `vendor/command-library/cli-command-commander/tsconfig.build.json`
- `vendor/command-library/cli-command-commander/tsconfig.json`
- `vendor/command-library/cli-command-commander/vitest.config.ts`
- `vendor/command-library/cli-command/README.md`
- `vendor/command-library/cli-command/package.json`
- `vendor/command-library/cli-command/program.ts`
- `vendor/command-library/cli-command/refused.ts`
- `vendor/command-library/cli-command/rename-todo.command.ts`
- `vendor/command-library/cli-command/src/conformance.ts`
- `vendor/command-library/cli-command/src/contracts/command.ts`
- `vendor/command-library/cli-command/src/contracts/conformance.ts`
- `vendor/command-library/cli-command/src/index.ts`
- `vendor/command-library/cli-command/src/internal/catalogue.ts`
- `vendor/command-library/cli-command/src/internal/conformance/cases.ts`
- `vendor/command-library/cli-command/src/internal/conformance/memory-io.ts`
- `vendor/command-library/cli-command/src/internal/conformance/suite.ts`
- `vendor/command-library/cli-command/src/internal/define.ts`
- `vendor/command-library/cli-command/src/internal/messages.ts`
- `vendor/command-library/cli-command/src/internal/shapes.ts`
- `vendor/command-library/cli-command/src/internal/usage.ts`
- `vendor/command-library/cli-command/src/internal/written.ts`
- `vendor/command-library/cli-command/tests/case-ids.test.ts`
- `vendor/command-library/cli-command/tests/conformance.test.ts`
- `vendor/command-library/cli-command/tests/define.test.ts`
- `vendor/command-library/cli-command/tests/exports.test.ts`
- `vendor/command-library/cli-command/tests/fixtures/written-record.json`
- `vendor/command-library/cli-command/tests/package.test.ts`
- `vendor/command-library/cli-command/tests/written.test.ts`
- `vendor/command-library/cli-command/tsconfig.build.json`
- `vendor/command-library/cli-command/tsconfig.json`
- `vendor/command-library/cli-command/vitest.config.ts`

### Optional files that may be edited

- `src/cli/commandLibrary/contract/index.ts`
- `src/cli/commandLibrary/contract/command.ts`
- `src/cli/commandLibrary/contract/define.ts`
- `src/cli/commandLibrary/contract/catalogue.ts`
- `src/cli/commandLibrary/contract/usage.ts`
- `src/cli/commandLibrary/contract/messages.ts`
- `src/cli/commandLibrary/contract/shapes.ts`
- `tests/unit/commandLibrary/contract/exports.test.ts`
- `NEXT_STEPS.md`

### Boundary contracts

Producer: src/cli/commandLibrary/commander/index.ts (`runner.run(program, io)` gives `Effect<ExitCode, never, R>`, and `processIo(process)` gives an `Io`). Consumers: the bridge (phase-03) and the conformance suite. Contract: the library's Runner interface. The runner never exits, never reads the process except through `Io`, and maps every outcome to the program's codes or a command's declared ones.

### Test strategy

- the runner's own behaviour (json layout, groups at any depth, policies, catalogue, help, usage spec, stdin flag, undeclared input, outcomes, never exiting, faulty runners, reading) holds on Effect 3 with the gains — small · example · the library's runner tests, ported, and the gain tests added beside them · in-phase
- processIo reads stdin once, reports an unreadable or unwritable file as a short phrase, and creates a written file's directory — medium · example · temporary files and a fake process object · in-phase
- only the adapter imports commander inside the port, and processIo is the port's one process edge — small · example · the architecture guard's import scans · in-phase
- the runner's refused declarations fail to compile — small · example · tsc under pnpm test:type with @ts-expect-error · in-phase

### Implementation order

1. shape.ts, undeclared.ts and stdin.ts
2. commanderAdapter.ts with nested groups
3. json.ts and outcome.ts
4. run.ts with the gains
5. processIo.ts and index.ts
6. conformance markers removed, runner tests ported
7. guards, vendor removal and ignore lists

### Excluded scope

- Any phax command, the bridge, main.ts, program.ts and the usage generator (phase-03).
- Editing a conformance case or the memory Io the cases use.

### Verification

The `standard` gate profile in phax.json, with the configured acceptance provider judging phase-01's acceptance test files (passed).

### Expected handoff content

Give the runner's module paths and the exports of src/cli/commandLibrary/commander/index.ts. Say how each gain surfaces in the runner, and the exact form of the misdeclared-program check, including verdict collisions. Give the Effect 3 APIs used in run.ts, json.ts and outcome.ts. Confirm that every conformance case holds and that the acceptance test files are unchanged apart from the removed markers. Confirm that vendor/command-library/ is deleted and its ignore entries removed. Explain any deviation from the planned file lists.

### Commit subject

`feat(cli): port the command library's Commander runner and drop the vendored copy`

### Commit body

Port the runner of the command library into src/cli/commandLibrary/commander/ on
Effect 3: the Commander adapter, the process Io and the decode, run, encode and
render loop, with the gains it carries (nested groups, verdict codes, a text stdin
document, progress notes as they happen, an error's text form, the program's usage
flag, program-wide options and a required stdin-flag value).

The runner holds every conformance case. The library's runner tests are ported as
phax tests, and vendor/command-library/ is deleted now that the port is complete.

---

## phase-03 — The bridge between Commander and the runner, with the refused and defect codes {#phase-03-bridge}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium
**Assignment reason:** The bridge is a shape no code holds yet, and it crosses main.ts, program.ts, the usage generator and the phase guard.

phax's command line runs through a bridge that can hand a call to the runner. An unknown command or option and a bad argument now exit 64, and a crash exits 70 with `defect: …`. `phax --json-schema` prints the runner program's catalogue. The usage spec is written by a generator that can splice the runner's commands in, and the phase guard refuses before any command, on either path.

### Detailed instructions

- Read src/cli/main.ts, src/cli/program.ts, src/cli/introspect.ts, src/cli/cliDocs.ts, src/cli/cliCompleters.ts, src/cli/commands/usage.ts, src/cli/commands/runLayers.ts (EXIT_CODE_MEANINGS, exitCodeForError), scripts/generate-usage-spec.ts, phax.usage.kdl, src/domain/security/phaseGuard.ts and their tests. Also read the port's index files and this plan's Technical arbitrations on the bridge, groups, usage and the guard.
- Create src/cli/definitions/program.ts with `phaxProgram`, built with the port's defineProgram:
  - name "phax" and version PHAX_RELEASE (src/schemas/release.ts);
  - exits `{ refused: 64, defect: 70 }`;
  - `usage` naming `--usage` with its `--usage-format` option and listing `--json-schema` once at the root ("program");
  - `options` declaring `--verbose` and `--trace` with today's help;
  - no commands yet: phase-05 adds the four.
  A file under src/cli/definitions/ never imports `commander`.
- Create src/cli/bridge.ts, the transition's dispatcher, with the process at the edge and its decisions testable as functions. In order:
  1. `--usage` stays where main.ts handles it today.
  2. Inside a phase worktree, the phase guard runs first for every call, with today's phaseGuardRefusal and exit 1. For a runner command under `--json`, it writes the refused line the Technical arbitrations give.
  3. A call whose leading words, after program-wide options, name a runner command of `phaxProgram`, or a root call `phax --json-schema`, runs `runner.run(phaxProgram, processIo(process))` with any layers provided, then exits with the code.
  4. Any other call goes to today's Commander program from buildProgram(). Commander's errors are mapped:
     - every refusal (unknown command, unknown option, missing argument or option value, excess arguments, and a group called alone after its help is written on stderr) exits 64 and keeps Commander's text;
     - `--help` and `--version` exit 0;
     - a rejection or throw escaping an action exits 70, writing `defect: <message>` on stderr in place of `Unexpected error: …`.
  Export the help-only stub mounting and a function that cuts each runner command's `cmd` block out of the port's `usageSpec(phaxProgram)`, for the generator.
- src/cli/main.ts: keep the `--usage` early path, then call the bridge instead of `buildProgram().parseAsync`.
  src/cli/program.ts:
  - mount each runner command of `phaxProgram` as a help-only Commander stub at its group, with its summary, the arguments and options its shapes declare, plus `--json` and `--json-schema`, allowing unknown options;
  - mark the stubs through the bridge's registry, so the generator and introspection recognise them;
  - declare `--json-schema` on the root for help.
  The preAction guard stays for Commander's path.
- src/cli/commands/runLayers.ts: add 64 and 70 to EXIT_CODE_MEANINGS: 64 "Refused call: unknown command or option, or an argument that does not decode" and 70 "Defect: an unexpected failure, a bug in phax". Narrow 1's meaning to drop "bad arguments". Make README.md's Exit codes table match byte for byte, as tests/unit/readmeExitCodes.test.ts requires. The reference page /reference/exit-codes is built from that README section.
- scripts/generate-usage-spec.ts: keep today's walk for the root, the `complete` nodes and every unmigrated command. At a stub's position, splice the runner command's `cmd` block from the bridge at the same depth. Add the root `--json-schema` flag and the port's root documentation of the `refused` and `defect` codes, from `Program.exits`. Run `pnpm gen:usage-spec`. With no command migrated yet, the diff of phax.usage.kdl is only those root additions.
- Before regenerating, copy today's phax.usage.kdl to tests/fixtures/usage/phax.usage.before-command-contracts.kdl, frozen. Write tests/helpers/usageKdl.ts, a reader of the KDL subset both styles use: `cmd`, `arg`, `flag`, `help`, `long_help`, `example`, `complete`, `default`, `required`, `global`, `choices`, child nodes and properties. It returns each command's declarations by path. Write tests/integration/usageSpecDeclarations.test.ts:
  - the committed file declares exactly what the frozen one declares, except an allowlist of the root's added `--json-schema` and exit-code documentation, and, per migrated command, an added `--json` flag;
  - it starts empty of migrated commands.
- Tests:
  - tests/unit/cli/bridge.test.ts proves the dispatch decisions, the Commander error mapping and the defect text, with doubles for the legacy program and the runner, and no real process exit.
  - tests/unit/cli/phaxProgram.test.ts proves that `phaxProgram` passes the runner's misdeclared-program check and that a variant declaring an option `json` does not.
  - tests/integration/cliRefusedCodes.test.ts spawns `tsx src/cli/main.ts` in a temporary repository (isolateGit, phaxHomeEnv), as tests/integration/plansOverviewCommand.test.ts does. It proves:
    - `phax plans lnit x` and `phax ls --colour` exit 64 with today's text;
    - `phax artifact`, `phax artifact new` and `phax agent setup` alone write help on stderr and exit 64;
    - `phax --json-schema` prints a catalogue with program "phax", version 0.34.0, exits 64 and 70, and the five message shapes;
    - `phax --usage` and `phax --usage --usage-format kdl` print the committed file and exit 0.
  - Update tests/integration/cliErrors.test.ts, tests/integration/holdCli.test.ts (the `--hold` unknown option now exits 64) and any other test pinning exit 1 on a Commander refusal.
  - Extend tests/integration/phaseGuard.test.ts: the guard refuses before the runner path too.
  - Add a guard to tests/unit/architecturalGuards.test.ts: no file under src/cli/definitions/ imports `commander`.
- docs/upgrading.md: add a `### 0.34.0` entry above 0.33.0, in 0.33.0's style, for command-line callers:
  - an unknown command, an unknown option or a bad argument now exits 64 instead of 1;
  - an unexpected crash exits 70 with `defect: …` instead of 1 with `Unexpected error: …`;
  - `phax --json-schema` prints the contracts of the commands answering through the runner.
  End with one sentence saying later entries of this release follow. Do not edit earlier entries. Run `pnpm docs:cli` if the README's generated CLI block changes.

### Planned files to create

- `src/cli/bridge.ts`
- `src/cli/definitions/program.ts`
- `tests/unit/cli/bridge.test.ts`
- `tests/unit/cli/phaxProgram.test.ts`
- `tests/integration/cliRefusedCodes.test.ts`
- `tests/integration/usageSpecDeclarations.test.ts`
- `tests/helpers/usageKdl.ts`
- `tests/fixtures/usage/phax.usage.before-command-contracts.kdl`

### Planned files to edit

- `src/cli/main.ts`
- `src/cli/program.ts`
- `src/cli/commands/runLayers.ts`
- `scripts/generate-usage-spec.ts`
- `phax.usage.kdl`
- `README.md`
- `docs/upgrading.md`
- `tests/integration/cliErrors.test.ts`
- `tests/integration/holdCli.test.ts`
- `tests/integration/phaseGuard.test.ts`
- `tests/unit/architecturalGuards.test.ts`

### Optional files that may be edited

- `src/cli/introspect.ts`
- `src/cli/cliDocs.ts`
- `src/cli/commands/usage.ts`
- `src/domain/security/phaseGuard.ts`
- `src/cli/commandLibrary/contract/usage.ts`
- `src/cli/commandLibrary/commander/run.ts`
- `tests/unit/readmeExitCodes.test.ts`
- `tests/unit/generateUsageSpec.test.ts`
- `tests/unit/security/phaseGuard.test.ts`
- `tests/integration/cliProgram.test.ts`
- `tests/integration/usageParity.test.ts`
- `tests/integration/usageOutput.test.ts`
- `tests/integration/usageSpecDrift.test.ts`
- `tests/integration/usageSpecLint.test.ts`
- `tests/integration/usageSpecCompleters.test.ts`
- `tests/integration/usageSpecExamples.test.ts`
- `tests/integration/docsCliDrift.test.ts`
- `knip.json`

### Boundary contracts

Producer: src/cli/bridge.ts. Consumer: src/cli/main.ts. Contract: one call in, one process exit out. Runner commands go to `runner.run(phaxProgram, processIo(process))`. Everything else goes to the Commander program, with its refusals mapped to 64 and its crashes to 70. Producer: src/cli/definitions/program.ts (`phaxProgram`). Consumers: the bridge, program.ts's stubs and the usage generator. Contract: the runner's Program, which phase-05 fills with commands. Producer: the bridge's usage-block cutter. Consumer: scripts/generate-usage-spec.ts. Contract: each runner command's `cmd` block, keyed by its full name.

### Test strategy

- an unknown command or option, a missing argument and an excess one on an unmigrated command exit 64 with Commander's text — medium · table · the spawned CLI's exit code and stderr · in-phase · ac-unknown-option
- a throw escaping a command's action exits 70 and writes defect text on stderr — small · example · the bridge's exit code and err text with a throwing double · in-phase · ac-defect
- artifact, artifact new and agent setup called alone write their help on stderr and exit 64 — medium · table · the spawned CLI's exit code and stderr · in-phase · ac-groups
- phax's program passes the runner's misdeclared-program check, and a variant declaring an option json is refused — small · example · the runner's exit code and named command · in-phase · ac-misdeclared
- phax --json-schema prints program phax, version 0.34.0, exits refused 64 and defect 70, and the five message shapes — medium · example · the decoded catalogue · in-phase · ac-catalogue
- phax --usage and phax --usage --usage-format kdl print the committed phax.usage.kdl and exit 0 — medium · example · the committed file's bytes · in-phase · ac-usage-flag
- the committed usage spec is the generator's output and declares what the frozen pre-change file declares, apart from the allowlisted root additions — small · metamorphic · the frozen phax.usage.kdl compared node by node · in-phase · ac-usage-parity
- inside a phase worktree the guard refuses before any command, on the runner path and on Commander's, with exit 1 — medium · example · the guard's sentence and exit code · in-phase
- no file under src/cli/definitions/ imports commander — small · example · the architecture guard's import scan · in-phase · ac-no-parser
- the README exit-code table lists 64 and 70 exactly as EXIT_CODE_MEANINGS does — small · table · the readme exit-code test · in-phase

### Implementation order

1. src/cli/definitions/program.ts
2. src/cli/bridge.ts and its unit test
3. main.ts and program.ts wiring
4. runLayers.ts codes and README table
5. frozen usage fixture, KDL reader, generator splice and regeneration
6. integration tests and updated refusals
7. architecture guard and upgrading entry

### Excluded scope

- Moving any command onto the runner (phase-05).
- The formats artifact-status, plan-overview, plan-lint and the run-list pullRequest (phase-04).
- A refused line for an unmigrated command under --json: it waits for the command's move.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

Give the exact dispatch order of src/cli/bridge.ts and its exported names: the stub mounting, the stub registry and the usage-block cutter. Give `phaxProgram`'s declaration. Describe how program.ts mounts a runner command as a help-only stub. Name the KDL subset tests/helpers/usageKdl.ts reads, and the allowlist in usageSpecDeclarations.test.ts that phase-05 extends with `--json` on each migrated command. List the tests whose exit codes changed from 1 to 64. Show the 0.34.0 upgrading entry as written. Explain any deviation from the planned file lists.

### Commit subject

`feat(cli): bridge Commander and the command runner, with refused 64 and defect 70`

### Commit body

Route every call through a bridge that hands a runner command to the ported runner
and everything else to today's Commander program. phax's runner program declares the
refused (64) and defect (70) codes, its usage flag and its program-wide options.
Commander's refusals now exit 64 and an unexpected crash exits 70 with `defect: …`.

The usage spec generator can splice a runner command's node into today's walk, and
the declarations of phax.usage.kdl are checked against a frozen copy of the file.
`phax --json-schema` prints the runner program's catalogue, and the phase guard
still refuses first, with exit 1.

---

## phase-04 — The four answers' formats, the run list's pull request, and their acceptance tests {#phase-04-answer-formats}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium
**Acceptance phase:** passed by phase-05
**Acceptance test files:** `tests/integration/artifactStatusJson.test.ts`, `tests/integration/plansAnswersJson.test.ts`, `tests/integration/lsJsonContracts.test.ts`, `tests/fixtures/commandAnswers/before.ts`, `src/schemas/artifactStatusDocument.ts`, `src/schemas/planOverview.ts`, `src/schemas/planLint.ts`, `src/schemas/runList.ts`

The schemas package publishes `artifact-status`, `plan-overview` and `plan-lint`, born at 0.34.0, and a `run-list` whose rows carry `pullRequest`, with its 0.30.0 shape frozen. `phax ls --json` already fills `pullRequest`. The four commands' runner answers are written as frozen acceptance tests.

### Detailed instructions

- Read src/schemas/schemaUrl.ts, src/schemas/release.ts, src/schemas/runList.ts, src/schemas/publication.ts, src/domain/runList.ts, src/cli/commands/ls.ts, src/app/artifactStatus.ts (ArtifactAuthoring, ArtifactQuestions, the inspectArtifact result), src/domain/plan/overview.ts (PlanOverview), src/app/lintPlan.ts (LintReport) and packages/schemas/. For the steps of a format's birth and of a frozen shape with a `next` snapshot, read the archived plan docs/plans/archive/2610311031-acceptance-tests-plan.md, phase-05 (acceptance-request), and phase-01 (frozen modules).
- Before changing anything, capture today's `phax ls --json` and `phax plans overview --json` outputs for the fixtures the new tests use, as tests/fixtures/commandAnswers/before.ts, a module exporting them as values with fixed timestamps.
- Create the schemas:
  - src/schemas/artifactStatusDocument.ts: ArtifactStatusFileSchema, strict keys, with `$schema: schemaUrlField("artifact-status")`, then `path`, `kind`, `status` and `legalTransitions` (the status names).
    - `approval`: `{ kind: "none" }`, `{ kind: "unrecorded" }`, or `{ kind: "recorded", date, baseline, approver, editedSinceApproval }`, where `approver` is the arbiter as the approval record stores it.
    - `authoring`: `{ kind: "interactive" }`, or `{ kind: "headless", sidecar, agreement }`, where `agreement` is "in-sync", "diverged", `{ kind: "invalid", message }` or `{ kind: "stamped", format, shape }`.
    - `questions`: `{ kind: "none" }`, `{ kind: "departs", line, text }`, or `{ kind: "parsed", open, arbitrated, lifted }`, each a list of question ids.
    - Spellings follow §6, and every key is required.
  - src/schemas/planOverview.ts: PlanOverviewFileSchema, `$schema: schemaUrlField("plan-overview")` then exactly today's PlanOverview fields in today's key order, with a compile-time check that the schema's type and PlanOverview agree, as src/schemas/publication.ts does.
  - src/schemas/planLint.ts: PlanLintFileSchema, `$schema: schemaUrlField("plan-lint")` then today's LintReport fields, with the same check.
  - Each module exports its file decoder and encoder, named as every format's are.
- Freeze `run-list` and extend it. Create src/schemas/history/run-list/0.30.0.ts, a self-contained copy of today's run-list schema that inlines review-stop 0.30.0's shapes and imports only `effect`, as src/schemas/history/run-list/0.26.0.ts does. Then add `pullRequest: Schema.NullOr(Schema.NonEmptyString)` to RunListRowSchema after `stop`: required, with a description saying it is the URL of the pull request phax opened for the run, or null. There is no optional field and no shim.
- Fill `pullRequest` in `phax ls --json` (src/domain/runList.ts and src/cli/commands/ls.ts, still a Commander command). It is the run's publication record's `pullRequestUrl` (src/schemas/publication.ts, read where src/app/finalReport.ts reads it), or null when there is none or it cannot be read. `ls --complete` and the text table are unchanged.
- Register the formats:
  - src/schemas/schemaUrl.ts: append `artifact-status`, `plan-overview` and `plan-lint` to FORMAT_IDS and SCHEMA_BORN_FORMAT_IDS, and update the doc comments.
  - packages/schemas/build/jsonSchemas.ts: their definitions, and run-list's frozen 0.30.0 release.
  - packages/schemas/src/formats/commandAnswers.ts: the three formats with parse and toLatest functions, as packages/schemas/src/formats/acceptanceRequest.ts does for one.
  - packages/schemas/src/formats/interactive.ts: run-list lists 0.30.0 as a release.
  - packages/schemas/src/index.ts: exports and parseDocument.
  - tests/type/schemasPackage.ts.
  Run `pnpm exec tsx scripts/schemas-check.ts --write` twice, then the check. This writes the four next.schema.json snapshots and updates src/schemas/release.ts, packages/schemas/src/generated/index.ts and packages/schemas/history.lock.json.
- Update the registries:
  - README.md's persisted-formats table gains three rows, in the shape tests/unit/readmePersistedFormats.test.ts requires: Artifact status (`artifact-status`, the output of `phax artifact status --json`, never saved, `parseArtifactStatus`), Plan overview (`plan-overview`, …) and Plan lint (`plan-lint`, …).
  - NEVER_WRITTEN in tests/integration/persistedProducer.test.ts gains the three ids.
  - The closure allowlist and file-decoder map in tests/unit/architecturalGuards.test.ts take the new modules and src/schemas/history/run-list/0.30.0.ts.
  - tests/unit/schemaUrl.test.ts.
  - The package's documents, exports, jsonSchemas, currentShapes, parity and documents tests.
  - tests/unit/runList.test.ts and tests/integration/runList.test.ts for `pullRequest`.
- Write the acceptance tests. Every test carries vitest's `.fails` marker: the four commands are still Commander commands, so each fails on its assertion. Each spawns `tsx src/cli/main.ts` in a temporary repository (isolateGit, phaxHomeEnv, makeFakeGitHub where a publication is needed), as tests/integration/plansOverviewCommand.test.ts does.
  - tests/integration/artifactStatusJson.test.ts (ac-artifact-status):
    - a Draft headless spec with one open question `q-cadence`: `--json` decodes against ArtifactStatusFileSchema, `$schema` comes first and is stamped 0.34.0, `q-cadence` is open, and the sidecar is in sync;
    - an Approved spec edited since approval: the approval has its date, baseline and approver, and `editedSinceApproval` is true;
    - `artifact status --json-schema` names `["artifact","status"]`.
  - tests/integration/plansAnswersJson.test.ts:
    - ac-overview: `plans overview --json` starts with `"$schema": "https://docs.phax.run/schemas/plan-overview/0.34.0.json"`, and the rest equals before.ts's overview;
    - ac-lint-verdict: `plans lint --json` on a plan with one error finding writes a `plan-lint` document with `$schema` first and exits 1, without `--json` it writes today's text and exits 1, and a clean plan exits 0;
    - ac-json-schema-command: `plans lint --json-schema` names `["plans","lint"]`, has `stdin` null, `output` and `errors`, runs no lint, and equals the `plans lint` entry of `phax --json-schema`;
    - ac-catalogue: `phax --json-schema` holds entries for `artifact status`, `plans overview`, `plans lint` and `ls`;
    - ac-json-every-command: for the four, stdout parses as one value indented by two spaces with one trailing newline, and every stderr line is a message line.
  - tests/integration/lsJsonContracts.test.ts:
    - ac-unknown-option: `ls --colour --json` writes nothing on stdout and one `refused` line with `"source":"flags"` on stderr, and exits 64;
    - ac-help: `ls --help` lists `--json`;
    - `ls --json-schema` names `["ls"]` and points `output` at the run-list format.
- In-phase tests (no marker):
  - tests/unit/schemas/commandAnswers.test.ts: each new schema decodes a full document and refuses an extra key and a missing one; the 0.30.0 run-list decodes a document without `pullRequest`, and the current one refuses it.
  - tests/unit/schemasPackage/commandAnswersFormat.test.ts: parse and toLatest for the three formats, and parseDocument identifies each.
  - tests/integration/runList.test.ts: a run phax published carries its URL, and one it did not carries null (ac-run-pr).
  - The same file: today's `ls --json` bytes, from before.ts, equal the new output once `pullRequest` and the `$schema` stamp are set aside (ac-versioned-stable).
- docs/upgrading.md: in the 0.34.0 entry, add one bullet each for:
  - `phax ls --json` rows gaining the required `pullRequest` (run-list 0.34.0, 0.30.0 still parsed);
  - the three new formats in @lbdremy/phax-schemas.
  Do not edit earlier entries.

### Planned files to create

- `src/schemas/artifactStatusDocument.ts`
- `src/schemas/planOverview.ts`
- `src/schemas/planLint.ts`
- `src/schemas/history/run-list/0.30.0.ts`
- `packages/schemas/src/formats/commandAnswers.ts`
- `packages/schemas/snapshots/artifact-status/next.schema.json`
- `packages/schemas/snapshots/plan-overview/next.schema.json`
- `packages/schemas/snapshots/plan-lint/next.schema.json`
- `packages/schemas/snapshots/run-list/next.schema.json`
- `tests/fixtures/commandAnswers/before.ts`
- `tests/unit/schemas/commandAnswers.test.ts`
- `tests/unit/schemasPackage/commandAnswersFormat.test.ts`
- `tests/integration/artifactStatusJson.test.ts`
- `tests/integration/plansAnswersJson.test.ts`
- `tests/integration/lsJsonContracts.test.ts`

### Planned files to edit

- `src/schemas/schemaUrl.ts`
- `src/schemas/release.ts`
- `src/schemas/runList.ts`
- `src/domain/runList.ts`
- `src/cli/commands/ls.ts`
- `packages/schemas/build/jsonSchemas.ts`
- `packages/schemas/src/index.ts`
- `packages/schemas/src/formats/interactive.ts`
- `packages/schemas/src/generated/index.ts`
- `packages/schemas/history.lock.json`
- `README.md`
- `docs/upgrading.md`
- `tests/type/schemasPackage.ts`
- `tests/unit/schemaUrl.test.ts`
- `tests/unit/architecturalGuards.test.ts`
- `tests/unit/runList.test.ts`
- `tests/integration/runList.test.ts`
- `tests/integration/persistedProducer.test.ts`
- `tests/unit/schemasPackage/documents.ts`
- `tests/unit/schemasPackage/exports.test.ts`
- `tests/unit/schemasPackage/jsonSchemas.test.ts`
- `tests/unit/schemasPackage/currentShapes.test.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/unit/schemasPackage/documents.test.ts`

### Optional files that may be edited

- `src/schemas/persisted.ts`
- `src/app/resolveRunInfo.ts`
- `src/app/artifactStatus.ts`
- `src/app/lintPlan.ts`
- `src/domain/plan/overview.ts`
- `packages/schemas/build/snapshots.ts`
- `site/build/sources.ts`
- `tests/unit/cli/ls.test.ts`
- `tests/unit/readmePersistedFormats.test.ts`
- `tests/unit/schemasPackage/parseDocument.test.ts`
- `tests/unit/schemasPackage/snapshots.test.ts`
- `tests/integration/closeStopNetwork.test.ts`

### Boundary contracts

Producer: src/schemas/artifactStatusDocument.ts, planOverview.ts, planLint.ts and runList.ts. Consumers: phase-05's definitions (their output contracts), the schemas package and readers such as the Claude Code mod. Contract: one closed document per format, `$schema` first, stamped 0.34.0 while its next snapshot exists, every key required. Producer: `phax ls --json`. Consumer: the mod. Contract: each row's `pullRequest` is the URL of the pull request phax opened, or null.

### Test strategy

- artifact status --json answers an artifact-status document listing a Draft spec's open question and sidecar agreement, and an edited Approved spec's approval with editedSinceApproval true — medium · example · ArtifactStatusFileSchema and the fixture's known questions and approval · acceptance · ac-artifact-status
- plans overview --json starts with the plan-overview 0.34.0 $schema and the rest equals today's overview — medium · example · the overview captured before the change · acceptance · ac-overview
- plans lint answers a plan-lint document with --json and today's text without it, exiting 1 on an error finding and 0 on a clean plan — medium · example · PlanLintFileSchema, today's rendered report and the exit codes · acceptance · ac-lint-verdict
- plans lint --json-schema prints its entry without linting, equal to its entry in phax --json-schema — medium · example · the two decoded entries compared · acceptance · ac-json-schema-command
- the catalogue holds an entry for each of the four migrated commands — medium · example · the decoded catalogue's name words · acceptance · ac-catalogue
- each of the four commands answers --json with one indented JSON value and only message lines on stderr — medium · table · JSON.parse of stdout and each stderr line against the message shapes · acceptance · ac-json-every-command
- ls with an undeclared option under --json writes one refused line from flags and exits 64 — medium · example · the refused line's fields and the exit code · acceptance · ac-unknown-option
- ls --help lists --json — medium · example · the help text · acceptance · ac-help
- a run phax published carries its pull request URL in ls --json and an unpublished one carries null — medium · example · the fixture's publication record · in-phase · ac-run-pr
- ls --json is byte for byte today's output apart from pullRequest and the $schema stamp — medium · example · the output captured before the change · in-phase · ac-versioned-stable
- each new format decodes a full document and refuses an extra or a missing key, and run-list 0.30.0 still parses — small · boundary · the schemas' typed refusals · in-phase
- every format registry, snapshot, the README table and the closure allowlist name the three new formats and run-list's frozen 0.30.0 — small · table · the registry, package and README tests · in-phase

### Implementation order

1. capture before.ts
2. run-list freeze and pullRequest, then ls
3. the three schemas
4. format registration, schemas-check and registries
5. in-phase tests
6. acceptance tests with their markers
7. upgrading bullets

### Excluded scope

- Moving artifact status, plans overview, plans lint or ls onto the runner (phase-05).
- Changing the text any command prints.

### Verification

The `standard` gate profile in phax.json, with the configured acceptance provider judging the acceptance test files (authored).

### Expected handoff content

Give the module paths and exported names of the three schemas and of the frozen run-list 0.30.0. Give the field spellings of artifact-status, every variant included. Say where `ls` reads `pullRequest` from. Give the package exports added. Say which fixtures before.ts holds and how the acceptance tests build their repositories. For each acceptance test, say the assertion it fails on today. Explain any deviation from the planned file lists.

### Commit subject

`feat(schemas): artifact-status, plan-overview and plan-lint born, run-list gains pullRequest`

### Commit body

Add the artifact-status, plan-overview and plan-lint formats at 0.34.0 and publish
them through @lbdremy/phax-schemas. Freeze run-list at 0.30.0, and give each current
row a required pullRequest: the URL of the pull request phax opened for the run, or
null. `phax ls --json` fills it now.

The four commands' runner answers are written as acceptance tests, frozen until the
phase that moves the commands.

---

## phase-05 — artifact status, plans overview, plans lint and ls on the runner {#phase-05-four-commands}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium
**Assignment reason:** The first phax commands written as definitions set the pattern every later plan repeats: renders that reproduce today's text from documents, and declared errors that keep today's sentences and codes through the bridge.

`phax artifact status`, `phax plans overview`, `phax plans lint` and `phax ls` are command definitions on the runner. `--json` gives their versioned documents with message lines on stderr. `--json-schema` gives their contracts. Without `--json`, a person reads today's text with today's codes.

### Detailed instructions

- Read the acceptance test files phase-04 committed, src/cli/bridge.ts, src/cli/definitions/program.ts, the port's index files, src/cli/commands/artifact.ts (runArtifactStatus and its text helpers), plans.ts (runPlansLint, registration), plansOverview.ts, ls.ts, src/cli/cliDocs.ts and the commands' tests (tests/unit/cli/plans.test.ts, tests/unit/cli/ls.test.ts, tests/unit/cli/artifactStatusRender.test.ts, tests/integration/plansOverviewCommand.test.ts, tests/integration/artifactStatus.test.ts, tests/integration/runList.test.ts).
- Create one definition per command under src/cli/definitions/, written against the port's contract index and never against `commander`.
  - `input` declares the same arguments and options as today, with today's help as `description` annotations and the identifiers `plan` and `path`, so the usage spec declares the same things.
  - `output` is the phase-04 schema, encoded with `$schema` first.
  - `render` reproduces today's text exactly, from the output alone.
  - `notes` carries today's stderr warnings: artifact status's orphan-record warnings and plans overview's architecture-provider failure. Each is a note line under `--json` and today's line without it.
  - `exits` and `errors` declare each failure today's command maps through exitCodeForError or by hand, such as `Config error: …` (2 for lint and overview, 1 for ls). `texts` gives today's sentence for each.
  - `help` and `examples` move from src/cli/cliDocs.ts, and their cliDocs entries are removed.
  - artifactStatus.ts builds the artifact-status document from inspectArtifact's result. plansOverview.ts and plansLint.ts build theirs from planOverview's and lintPlan's results.
  - plansLint.ts declares `verdicts: { 1: (report) => hasLintErrors(report.findings) }`.
  - ls.ts answers the run-list document. Its `--complete` keeps printing `short-name:state` lines through the `document` hook, as a text document with format null, so completion never reaches render or the run-list encoding. The RECORDS column follows the decision on q-ls-records-column: with derive, render shows the column when a row's `recordsPending` is a number; with view-gain, add the gain to the port's contract and runner with a conformance case, and pass whether records are configured.
  - Provide each run's services inside it, from the layers src/cli/commands/runLayers.ts builds today, so each command's R is never.
- Add the four to `phaxProgram`: `ls` at the root, `status` in group `artifact` and `lint` and `overview` in group `plans`, in today's order, so help and the usage spec keep their positions. In src/cli/commands/artifact.ts and plans.ts, remove the Commander registrations of the four. The bridge mounts their stubs.

  Keep `runLs` (src/cli/commands/ls.ts), `runArtifactStatus` (src/cli/commands/artifact.ts), `runPlansLint` (plans.ts) and `runPlansOverview` (plansOverview.ts) only as compositions of the definition's run, render and notes, writing through the OutputPort and returning the code. Their existing text tests then exercise the migrated command unchanged. The last plan removes them with those tests' move to the runner.
- Remove the `.fails` markers from the three acceptance test files. That is their only change, and src/schemas/artifactStatusDocument.ts, planOverview.ts, planLint.ts and runList.ts and tests/fixtures/commandAnswers/before.ts stay as committed. When an acceptance test cannot pass, fix the definition, never the test.
- Update the tests that pinned the unversioned objects, and nothing else in them:
  - the `--json` cases of tests/unit/cli/plans.test.ts and tests/integration/plansOverviewCommand.test.ts now expect the documents;
  - the registration checks in tests/unit/cli/plans.test.ts and tests/integration/cliProgram.test.ts now expect the stubs' declared options.
- Run `pnpm gen:usage-spec`. The four commands' nodes now come from the port, each adding `--json` with the library's help text. Extend the allowlist of tests/integration/usageSpecDeclarations.test.ts with exactly those four `--json` additions or rewordings. Run `pnpm docs:cli` for the README's generated CLI block.
- docs/upgrading.md, in the 0.34.0 entry, add one bullet each for:
  - `plans overview --json` and `plans lint --json` now answer versioned `plan-overview` and `plan-lint` documents with `$schema` first, replacing the unversioned objects;
  - `artifact status --json` is new;
  - on these four commands, `--json` writes message lines on stderr and `--json-schema` prints their contracts.
  Do not edit earlier entries.

### Planned files to create

- `src/cli/definitions/artifactStatus.ts`
- `src/cli/definitions/plansOverview.ts`
- `src/cli/definitions/plansLint.ts`
- `src/cli/definitions/ls.ts`
- `tests/unit/cli/definitionsRender.test.ts`

### Planned files to edit

- `src/cli/definitions/program.ts`
- `src/cli/commands/artifact.ts`
- `src/cli/commands/plans.ts`
- `src/cli/commands/plansOverview.ts`
- `src/cli/commands/ls.ts`
- `src/cli/cliDocs.ts`
- `phax.usage.kdl`
- `README.md`
- `docs/upgrading.md`
- `tests/integration/artifactStatusJson.test.ts`
- `tests/integration/plansAnswersJson.test.ts`
- `tests/integration/lsJsonContracts.test.ts`
- `tests/integration/usageSpecDeclarations.test.ts`
- `tests/integration/plansOverviewCommand.test.ts`
- `tests/unit/cli/plans.test.ts`
- `tests/integration/cliProgram.test.ts`

### Optional files that may be edited

- `src/cli/bridge.ts`
- `src/cli/program.ts`
- `src/cli/introspect.ts`
- `src/cli/commands/runLayers.ts`
- `scripts/generate-usage-spec.ts`
- `src/cli/commandLibrary/contract/command.ts`
- `src/cli/commandLibrary/contract/index.ts`
- `src/cli/commandLibrary/contract/conformance/cases.ts`
- `src/cli/commandLibrary/commander/run.ts`
- `src/domain/runList.ts`
- `src/app/artifactStatus.ts`
- `tests/unit/cli/ls.test.ts`
- `tests/unit/cli/artifactStatusRender.test.ts`
- `tests/unit/architecturalGuards.test.ts`
- `tests/unit/generateUsageSpec.test.ts`
- `tests/unit/commandLibrary/contract/exports.test.ts`
- `tests/integration/runList.test.ts`
- `tests/integration/artifactStatus.test.ts`
- `tests/integration/lintPlan.test.ts`
- `tests/integration/usageParity.test.ts`
- `tests/integration/usageSpecExamples.test.ts`
- `tests/integration/docsCliDrift.test.ts`

### Boundary contracts

Producer: src/cli/definitions/*.ts. Consumers: the runner, through `phaxProgram`, and the bridge. Contract: one CommandDef each, with today's arguments and options, output a phase-04 document, render today's text, declared errors with today's codes and sentences, and plans lint's verdict 1. Producer: `phax artifact status|plans overview|plans lint|ls --json`. Consumer: the Claude Code mod. Contract: the versioned document on stdout, and message lines alone on stderr.

### Test strategy

- the four commands' existing text tests pass with their text assertions unchanged — medium · example · the existing tests' expected text · in-phase · ac-text-unchanged
- each render gives today's text from its document, including stop labels, the records column and approval conditions — small · table · today's rendered strings for fixed documents · in-phase · ac-text-unchanged
- a declared failure writes today's sentence and exits with today's code without --json, and one error line with --json — medium · example · today's sentences and codes from the existing tests · in-phase · ac-error-sentence
- ls --complete still prints short-name:state lines and nothing else — medium · example · the completer's expected lines · in-phase
- artifact status orphan warnings and the overview's architecture warning reach stderr as note lines under --json and as today's lines without it — medium · example · stderr lines parsed as message lines · in-phase
- phax.usage.kdl is the generator's output and differs from the frozen file only by the root additions and --json on the four commands — small · metamorphic · the frozen phax.usage.kdl compared node by node · in-phase · ac-usage-parity
- the four definitions import no commander — small · example · the architecture guard's import scan · in-phase · ac-no-parser

### Implementation order

1. plansLint and plansOverview definitions
2. artifactStatus definition
3. ls definition with its completion document
4. phaxProgram, removal of the Commander registrations, kept run functions
5. markers removed and pinned JSON tests updated
6. usage spec, docs:cli and upgrading bullets

### Excluded scope

- Any other command, including plans status, overlap and estimate, and every other artifact command (later plans).
- Removing the bridge, the Commander root or the run functions kept for tests (the last plan).
- The docs page reference/json-output (the last plan).

### Verification

The `standard` gate profile in phax.json, with the configured acceptance provider judging phase-04's acceptance test files (passed).

### Expected handoff content

Give the four definitions' paths and their input, output, errors, texts, verdicts, notes and document hooks. Give `phaxProgram`'s command list and the groups it declares. State which run functions remain as compositions over the definitions, and the tests that call them. Say how q-ls-records-column was applied. List the tests whose `--json` expectations changed. Give the usage allowlist entries added, and confirm the acceptance test files changed only by their markers. Name what the next plan inherits: the definition pattern, the bridge's stub mounting and the kept run functions. Explain any deviation from the planned file lists.

### Commit subject

`feat(cli): artifact status, plans overview, plans lint and ls answer through the command runner`

### Commit body

Write the four commands the Claude Code mod reads as command definitions on the
ported runner. `--json` now answers the versioned artifact-status, plan-overview,
plan-lint and run-list documents, with message lines on stderr. `--json-schema`
prints each command's contracts. plans lint answers with verdict code 1 when a
finding is an error.

Without `--json` each command prints today's text, notes and error sentences with
today's codes. The usage spec gains `--json` on the four, written from their
definitions.
