---
status: Draft
source-spec: docs/specs/2611041417-gate-step-partial-commands.md
completes-spec: true
---
# Partial commands on gate steps

A gate step in `phax.json`, a workspace profile or the user overlay may carry an optional `partial` object with a `files` variant (holding a `<name>` placeholder) and/or a `diff` variant (holding none). Each is a command joined by pipes only. phax refuses a malformed `partial` at config load, naming the step's path, the variant and the construct. The phase prompt's `## Gate` section shows each variant under the step it narrows. In secure mode, phax adds the segment prefix of every pipe segment to the frozen agent commands with the new `source` "partial", both at phase start and on resume. phax never runs a partial command, and the gate is unchanged.

Prerequisite: the approved plan `phase-prompt-names-the-gate` (docs/plans/2611041421-phase-prompt-names-the-gate-plan.md) is merged before this plan runs. It adds `src/domain/gate/gateSection.ts` (`renderGateSection(steps)`), the `gateSteps: readonly GateStep[]` option of `buildPhasePrompt`, and the per-phase `phaseSteps = selectGateSteps(gateSteps, isFinal)` in `executePlan`. When this plan was written, `main` did not yet hold those (no `gateSection.ts`). Each phase plans against that prerequisite as written. If the merged code differs, the phase follows the code and records the difference in its handoff.

The plan is two acceptance pairs, then a real-CLI phase, then docs. phase-01 freezes the config surface tests and phase-02 passes them (schema, parser, load-time refusals, generated schemas). phase-03 freezes the run surface tests (prompt lines, allow rules, security.json, resume, providers) and phase-04 passes them (frozen-command wiring, security.json source, prompt lines). phase-05 adds the deliberate real-CLI checks for Claude Code and Vibe in the e2e tier, which `check:full` and the gate do not run. phase-06 updates README, docs/security.md and docs/upgrading.md.

Execution-model caveat: a phase agent cannot run the real-CLI suite, which needs the provider CLIs, sign-in and network. The Claude Code check asserts the probe's known result. The Vibe check records whatever result it observes. phase-06 writes the Vibe sentence in docs/security.md as the expected result and names the test that settles it. The operator runs `pnpm test:e2e:real` on the two files while reviewing the kept-open final phase, and corrects that sentence if Vibe refused the pipe. Until then the Vibe statement is provisional.

0.34.0 is the open release. This repository's own phax.json does not gain `partial` in this run (q-own-profile `follow-up`).

## Required commands

- `pnpm dev schema upgrade`

`pnpm dev schema upgrade` regenerates phax.schema.json and phax.user.schema.json. It is already in `security.agentCommands` in this repository's phax.json, so the preflight passes with no configuration change. Every other command the phases use is a step of the `standard` gate profile.

## Technical arbitrations

- Parser: a pure domain module `src/domain/gate/partialCommand.ts` exports `parsePartialCommand(command, variant)`, returning either a typed refusal `{ construct }` or `{ segments: [{ text, prefix }] }`, and `partialAllowPrefixes(steps)`. A placeholder is `<[a-z][a-z0-9-]*>`. Refusals are checked on the raw string before any split, in this fixed order: line break (`\n` or `\r`), `$(`, backtick, `&&`, `||`, a lone `&`, `>>`, `>`, a `<` that does not open a placeholder, `;`. The first construct found is the one named. Then the command is split on `|`, and each segment is trimmed and whitespace-normalized. Then: an empty segment is refused (`a |`, `| a`); a segment whose first word is a placeholder is refused, because an empty prefix would allow every command; a files variant with no placeholder anywhere is refused; a diff variant with any placeholder is refused. A segment's prefix is its words before the word that holds its first placeholder, or the whole segment when it holds none. Quotes are not parsed: a quoted `|`, `;`, `&`, `<` or `>` is split or refused like an unquoted one. Loss accepted: a project whose partial command needs a quoted metacharacter, or a leading placeholder, wraps it in a script.
- Where refusals happen: `src/app/loadConfig.ts` checks the raw JSON before the schema decode, as `protectedPathsError` does. It checks phax.json and each user overlay in `readUserOverlay`, walking `gateProfiles.<profile>[i]` and `workspaces[<id>].gateProfiles.<profile>[i]`. So each refusal reads `<path>.partial: declare "files", "diff" or both`, `<path>.partial: "<key>" is not a partial variant; declare "files", "diff" or both`, `<path>.partial.files: a files command needs a placeholder such as <files>`, `<path>.partial.diff: a diff command takes no placeholder`, or `<path>.partial.<variant>: "<construct>" is not allowed in a partial command; join commands with "|" only`, with indices bracketed. The refusal is a `ConfigValidationError`, so `phax validate` exits 2 as for every config refusal. The Effect schema still declares `partial` structurally (two exact-optional non-empty strings, at least one) for the type and the generated JSON Schema. Loss accepted: the refusal rules live in the loader, not the schema, so a decoder used outside `loadConfig` sees only the structural check. There is no such decoder of gate profiles today.
- Frozen agent commands: `computeFrozenAgentCommands` gains a `partialCommands` input. The source precedence becomes config, gate, partial, brief: a prefix already present as a config or gate command keeps that source and is recorded once. `executePlan` computes `partialAllowPrefixes(gateSteps)` once, next to `gateCommandStrings`, from the unfiltered resolved profile (every firing, per §5.10). It passes the result to `resolvePhaseAgent`, which serves the fresh launch and the declared-stop setup, and to the resume-session `computeFrozenAgentCommands` call. So both paths of §5.12 read one value. Providers need no change: Claude Code turns every frozen command into `Bash(<prefix>:*)`, Vibe puts it on its prefix allowlist, and Codex has no list. Loss accepted: like a terminal step's command, a terminal step's partial prefixes are allowed in non-terminal phases that are not shown them.
- security.json: `agentCommands[].source` becomes `Schema.Literal("config", "gate", "partial", "brief")`, and `version` stays 3. This follows the brief-provider precedent: security.json is phax-internal, not a `$schema`-stamped published format, and a widened literal adds no field, so there is nothing to lift and no shim. `AgentCommandRecord.source` widens the same way. docs/upgrading.md 0.34.0 tells records readers about the new value. Loss accepted: a 0.33.0 binary reading a 0.34.0 security.json that holds a "partial" entry refuses it, which is the usual direction of a records upgrade.
- Prompt lines: `renderGateSection(steps)` stays the single renderer and stays pure. Under a step that declares `partial`, it writes `  - on some files: <files command>` and then `  - on your changes: <diff command>`. That is a two-space-indented nested list item per declared variant, files first, with the command verbatim. When at least one listed step declares `partial`, two lines are inserted after "While you work, check each change with the narrowest command that covers it." and before "You need not run a whole gate step…": `A step's "on some files" and "on your changes" commands check part of what the step checks.` and `Replace a placeholder such as <files> with the files you choose. phax does not run these commands.` The lines come from the same per-phase `phaseSteps` the gate runs, so a terminal step's partial lines appear on the terminal phase only. Without any `partial`, the output is byte-identical to the prerequisite's. Loss accepted: the explanation names the placeholder `<files>` even when a project's placeholder has another name.
- requiredCommands coverage: `checkRequiredCommands` is unchanged, so segment prefixes do not cover a plan's required commands (the §10 default). Loss accepted: a plan that needs a command only a partial grants must still list it in `security.agentCommands` to pass the preflight.
- Real-CLI checks: the Claude Code check (`tests/e2e/claudePartialCommands.test.ts`) and the Vibe case added to `tests/e2e/vibeSecure.test.ts` use a tool-free diff command with the same shape as the spec's: two segments, the second through `xargs` (`git diff --name-only --diff-filter=d | xargs wc -l`). Their allow rules are derived through `parsePartialCommand`, because `pnpm exec oxlint` does not exist in a temporary repository. Loss accepted: the real-CLI checks prove the pipe-of-prefixes shape rather than the literal oxlint command; ac-claude-rules pins the oxlint rules at the medium tier.

## Open questions

### q-glued-placeholder — A placeholder may sit inside a word, as in `pnpm exec vitest run --dir=<dir>`. Where does that segment's allowed prefix end, given that the allow rule decides which commands a secure session may start?

- word-boundary — The prefix stops before the word that holds the placeholder (`pnpm exec vitest run`), and glued forms are accepted — abandons: A grant that covers only what the project wrote: the session may run `pnpm exec vitest run` with any options, not only `--dir=…`. That is no wider than what any prefix rule already allows after its last word, but it is wider than the command as written.
- whole-word — Refuse at load a placeholder glued to other characters; a placeholder must be a whole word — abandons: Glued forms such as `--dir=<dir>`: a project rewrites them as `--dir <dir>` or a script, and phax adds a refusal that §5 does not list.

Recommendation: word-boundary — Every `Bash(<prefix>:*)` rule already accepts any trailing options (the known prefix residual docs/security.md states). So stopping one word earlier lets the session do nothing that the glued option's leading words would not already allow it to do with other arguments. It also adds no refusal beyond the spec. The loss is still a wider grant than the literal command, which is why the operator decides it.

---

## phase-01 — Acceptance tests for the partial config surface {#phase-01-config-acceptance}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium
**Acceptance phase:** passed by phase-02
**Acceptance test files:** `tests/integration/partialCommandsConfig.test.ts`

Freeze acceptance tests for the config contract of `partial`, run through `loadConfig`, the use case `phax validate` calls. They cover acceptance of both variants in phax.json and the user overlay, and each refusal path named by the spec. Every test carries vitest's expected-failure marker, so the suite stays green until phase-02 makes the tests pass.

### Detailed instructions

- Create `tests/integration/partialCommandsConfig.test.ts`. Each test builds its own temporary git repository (follow `tests/helpers/tempGit.ts` and `isolateGit`, as `tests/integration/protectedPathsAdditive.test.ts` does), writes a phax.json and, where needed, a `phax.local.json` user overlay, and calls `loadConfig(<repo dir>)` from `src/app/loadConfig.ts`. Do not import any new module: phase-02 creates the parser and you must not depend on its name.
- Base fixture: a valid minimal phax.json (copy the minimum keys an existing loadConfig test uses) whose `gateProfiles.standard` has at least six steps, so `gateProfiles.standard[3]` and `gateProfiles.standard[5]` exist. Step 3 is `{ "command": "pnpm lint", "surface": "local", "firing": "every-phase" }`.
- `GateStep` has no `partial` field yet, so the tests must still typecheck under `pnpm test:type`. Read `partial` from the resolved config through an untyped view (`(step as Record<string, unknown>)["partial"]`).
- ac-accepted: step 3 carries `"partial": { "files": "pnpm exec oxlint <files>", "diff": "git diff --name-only --diff-filter=d | xargs pnpm exec oxlint" }`. A `phax.local.json` overlay declares a profile (for example `overlay`) whose one step carries only `"partial": { "files": "pnpm exec vitest run <files>" }`. Assert that loadConfig returns Right and that the resolved `gateProfiles.standard[3].partial` and the overlay step's `partial` equal the declared objects verbatim.
- ac-empty-refused: two cases, `"partial": {}` on step 3 and `"partial": { "all": "pnpm exec oxlint ." }` on step 3. Assert Left with a message containing `gateProfiles.standard[3].partial`, bracketed index included.
- ac-files-placeholder: step 5's `partial.files` is `pnpm exec oxlint src`. Assert Left with a message containing `gateProfiles.standard[5].partial.files`, using the step's own index.
- ac-diff-placeholder: step 3's `partial.diff` is `pnpm exec oxlint <files>`. Assert Left with a message containing `gateProfiles.standard[3].partial.diff`.
- ac-compound-refused: a table with one case per construct, each as step 3's `partial.diff`: `;` (`git diff --name-only; ls`), `&&`, `||`, a lone `&` (`ls &`), `$(` (`pnpm exec oxlint $(git diff --name-only)`), a backtick, a line break, `>` (`ls > out.txt`), `>>` and a bare `<` (`wc -l < a.txt`). Each case asserts Left with a message containing `gateProfiles.standard[3].partial.diff` and the construct itself, quoted as it appears (for example `"$("`). Assert the construct appears in the message, not the message's exact wording. Two more cases are accepted (Right): a diff of `ls | xargs wc -l`, and a files variant of `pnpm exec oxlint <files>`.
- Add one case beside the compound table showing that a refusal in the user overlay names the overlay's profile path. Today that case fails on its assertion like the others.
- Mark every test with `it.fails`, so `pnpm test` stays green against today's code, which refuses `partial` as an unexpected key with a dotted path. Check that each test, without its marker, fails on an assertion and not on a crash or type error.
- Keep the tests deterministic: fixed fixtures and their own temporary repository each, with HOME isolated as the existing loadConfig tests isolate it, so `~/.phax/config.json` cannot leak in.

### Planned files to create

- `tests/integration/partialCommandsConfig.test.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- `tests/helpers/tempGit.ts`

### Boundary contracts

Consumer: a project maintainer writing phax.json or phax.local.json, and `phax validate`. Producer: `loadConfig` (app). The contract pinned: a step's `partial` survives resolution verbatim, and each malformed form is a ConfigValidationError whose message names the bracketed step path, the variant and, for a compound form, the construct. `phax validate` turns any ConfigValidationError into exit 2, which this phase does not re-test.

### Test strategy

- a step with both variants in phax.json and a step with only files in the user overlay load, and the resolved config carries each partial verbatim — medium · example · the declared partial objects · acceptance · ac-accepted
- an empty partial and a partial with an unknown key are each refused naming gateProfiles.standard[3].partial — medium · example · Left whose message holds the bracketed step path · acceptance · ac-empty-refused
- a files command without a placeholder is refused naming the step path and partial.files — medium · example · Left whose message holds gateProfiles.standard[5].partial.files · acceptance · ac-files-placeholder
- a diff command with a placeholder is refused naming the step path and partial.diff — medium · example · Left whose message holds gateProfiles.standard[3].partial.diff · acceptance · ac-diff-placeholder
- each of the ten compound or nested constructs is refused naming the path, the variant and the construct, while a plain pipe and a files placeholder are accepted — medium · table · one row per construct: Left naming it; two Right rows · acceptance · ac-compound-refused

### Implementation order

1. Build the temporary-repository fixture, the base phax.json and the untyped `partial` reader.
2. Write the acceptance test (ac-accepted), then the empty and unknown-key cases.
3. Write the placeholder cases, then the compound table and the overlay-path case.
4. Add `it.fails` to every test and confirm `pnpm test` and `pnpm test:type` are green.

### Excluded scope

- Any change under `src/`: the schema, the parser and the loader checks belong to phase-02.
- The generated JSON Schema files (ac-schema is covered in-phase by phase-02).
- The prompt, the frozen agent commands and security.json (phase-03 and phase-04).

### Verification

The `standard` gate profile in `phax.json`. The configured acceptance provider checks the expected-failure markers at the gate.

### Expected handoff content

The path `tests/integration/partialCommandsConfig.test.ts`, each test's name and the criterion id it proves, the base fixture's step indices (which step is [3] and which is [5]), and the overlay file and profile used. The exact substrings each refusal test matches, path and construct quoting included, so phase-02 renders them. Any deviation from the planned files, with the reason.

### Commit subject

`test(config): acceptance tests for partial commands on gate steps`

### Commit body

Add frozen acceptance tests, marked as expected failures, that load phax.json and a user overlay through loadConfig. A step with both partial variants, and an overlay step with only files, resolve verbatim. An empty or unknown partial, a files command without a placeholder, a diff command with one, and each compound or nested construct are refused with the step's bracketed path, the variant and the construct.

---

## phase-02 — Partial command schema, parser and load-time refusals {#phase-02-schema-and-parser}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

Gate steps accept `partial` in phax.json, workspace profiles and the user overlay. A pure parser recognizes placeholders, splits pipe segments and computes each segment's allowed prefix. The loader refuses every malformed form with the step's path, the variant and the construct. The generated config JSON Schemas describe `partial`. phase-01's acceptance tests pass.

### Detailed instructions

- Create `src/domain/gate/partialCommand.ts`, pure with no I/O, exporting the following.
- `type PartialVariant = "files" | "diff"`.
- `parsePartialCommand(command: string, variant: PartialVariant)`, returning `Either<PartialCommandRefusal, ParsedPartialCommand>` (use Effect's Either, or a tagged result type consistent with the domain folder). `PartialCommandRefusal` is a tagged union: `{ kind: "construct", construct: string }`, `{ kind: "needs-placeholder" }`, `{ kind: "no-placeholder-allowed" }`, `{ kind: "empty-segment" }`, `{ kind: "leading-placeholder" }`. `ParsedPartialCommand` is `{ segments: readonly { text: string; prefix: string }[] }`.
- Placeholder: `<[a-z][a-z0-9-]*>`.
- Construct check on the raw string, before any split, in this order, the first found being named: a line break (`\n` or `\r`, named `line break`), `$(`, a backtick, `&&`, `||`, a lone `&`, `>>`, `>` (any `>` not closing a placeholder), a `<` that does not open a placeholder, `;`. Remove the placeholders before testing for `<` and `>`.
- Then split on `|`, then trim and normalize each segment's whitespace to single spaces. Refuse an empty segment, and a segment whose first word is a placeholder. Refuse a files variant with no placeholder, and a diff variant with one.
- Segment prefix: the segment's words before the first word that contains a placeholder, or the whole segment when it holds none. The open question q-glued-placeholder decides how a placeholder glued inside a word is handled. Follow its Decision in the plan preamble: with `word-boundary`, the prefix stops before that word and the form is accepted. With `whole-word`, a placeholder that is not a whole word is refused with its own refusal kind and message.
- `partialAllowPrefixes(steps: readonly GateStep[]): readonly string[]` is the segment prefix of every pipe segment of every declared variant of every step, in step order, files before diff, segments in order, deduplicated. It is only ever called on loaded config, so a refusal there is a defect: throw.
- `describePartialRefusal(refusal)` is the message tail the loader appends after the path, so the wording lives in one place.
- In `src/schemas/phaxConfig.ts`, add an exact-optional `partial` to `GateStepSchema`: a struct of exact-optional `files` and `diff` (non-empty strings), with descriptions. On `partial`: "Commands that check part of what this step checks. phax shows them in the phase prompt under the step and allows them in secure mode like the step, and never runs them." On `files`: that it holds a `<name>` placeholder (a lowercase word in angle brackets, for example `<files>`) which the agent replaces with files it chooses. On `diff`: that it runs on the phase's current, uncommitted changes and holds no placeholder. On both: that commands are joined with `|` only. Make the generated JSON Schema require at least one variant (`minProperties: 1`, or an `anyOf` of two `required` lists) and forbid other keys. Use the jsonSchema-annotation technique the file already uses for `input`, so the description reaches the generated output.
- In `src/app/loadConfig.ts`, add `partialCommandsError(raw, configPath)`, run on the raw JSON before the schema decode. In `loadConfig`, call it next to `protectedPathsError`. In `readUserOverlay`, call it before `decodePhaxUserOverlay`. It walks `gateProfiles.<profile>[i]` and `workspaces[i].gateProfiles.<profile>[j]`. For workspaces, follow the existing `workspaces[<id>]` naming when the id is a string. For every step whose `partial` key is present, it refuses: a non-object, or an object with no `files` and no `diff`, as `<path>.partial: declare "files", "diff" or both`; any other key, as `<path>.partial: "<key>" is not a partial variant; declare "files", "diff" or both`; and each variant's string through `parsePartialCommand` and `describePartialRefusal`, as `<path>.partial.<variant>: <tail>`. Construct tails read `"<construct>" is not allowed in a partial command; join commands with "|" only`, the files tail reads `a files command needs a placeholder such as <files>`, and the diff tail reads `a diff command takes no placeholder`. Leave a non-string variant to the schema decode. Return a `ConfigValidationError` with the message and the config file path.
- Regenerate `phax.schema.json` and `phax.user.schema.json` with `pnpm dev schema upgrade` at the repository root, and never hand-edit them. Confirm with `git diff` that phax.json is byte-identical and that only the two schema files changed.
- Add `tests/unit/partialCommand.test.ts`, a table test of `parsePartialCommand` covering:
- every refused construct, each named exactly;
- the construct order, when a command holds two constructs;
- an empty segment (`ls |`, `| ls`);
- a leading placeholder;
- files without a placeholder, and diff with one;
- accepted forms with their segments and prefixes: `pnpm exec oxlint <files>` gives `pnpm exec oxlint`; `git diff --name-only --diff-filter=d | xargs pnpm exec oxlint` gives two prefixes; `ls | xargs wc -l`; `pnpm exec vitest run <test-files>`; whitespace normalization; a mid-segment placeholder followed by more words (`tool <files> --flag` gives `tool`);
- the glued-placeholder case, per the decided option;
- `partialAllowPrefixes` order and dedup across steps.
- Then add a property test only if the project already has a property-testing library (check `package.json`). The property: no prefix ever holds `<`, `>` or `|`, and each prefix is a whole-word prefix of its segment. Otherwise write those invariants as table rows.
- Extend `tests/unit/phaxConfigJsonSchema.test.ts` (ac-schema). Both generated schemas' gate step properties include `partial`, whose only properties are `files` and `diff`, which needs at least one of them and allows no other key, and whose descriptions name the placeholder and say phax never runs these commands. Use the existing `findGateStepSchema` helper, and its user-overlay counterpart if it has one. The existing test that compares the committed schema files with the generated ones must keep passing.
- Remove the `it.fails` marker from every test in `tests/integration/partialCommandsConfig.test.ts`. That is the only change allowed to that file. If an acceptance test cannot pass unchanged, stop and say so in the handoff.
- Do not touch the gate runner, the prompt or the frozen agent commands: `partial` rides on `GateStep` and nothing reads it yet.

### Planned files to create

- `src/domain/gate/partialCommand.ts`
- `tests/unit/partialCommand.test.ts`

### Planned files to edit

- `src/schemas/phaxConfig.ts`
- `src/app/loadConfig.ts`
- `phax.schema.json`
- `phax.user.schema.json`
- `tests/unit/phaxConfigJsonSchema.test.ts`
- `tests/integration/partialCommandsConfig.test.ts`

### Optional files that may be edited

- `src/schemas/formatError.ts`
- `tests/unit/loadConfig.test.ts`

### Boundary contracts

app → domain: `loadConfig` (app) consumes `parsePartialCommand` and `describePartialRefusal` (domain, pure). The stable shape is a command string and variant in, and a typed refusal or segments with prefixes out. schemas → JSON Schema: `GateStepSchema` produces the editor schemas through the existing generator. The domain parser is the single owner of the grammar. phase-04 consumes `partialAllowPrefixes(steps)` for the frozen agent commands, and must not re-split commands itself.

### Test strategy

- every refused construct, empty segment, leading placeholder and wrong-variant placeholder is refused with its own typed refusal, and every accepted form yields the expected segments and prefixes — small · table · a table of command, variant and expected refusal or segment prefixes · in-phase · ac-compound-refused
- no computed prefix holds a placeholder, a pipe or a redirection, and each is a whole-word prefix of its segment — small · table · the invariant checked on every accepted row · in-phase · ac-claude-rules
- both generated config schemas describe partial with only files and diff, at least one required, and descriptions naming the placeholder and that phax never runs them — small · example · the generated JSON Schema objects and the committed files · in-phase · ac-schema
- phase-01's config acceptance tests pass with only their markers removed — medium · example · the frozen tests in partialCommandsConfig.test.ts · in-phase · ac-accepted

### Implementation order

1. Write `partialCommand.ts` and its table test.
2. Add `partial` to `GateStepSchema` with its descriptions and the at-least-one rule.
3. Add `partialCommandsError` to the loader for phax.json and the overlays.
4. Regenerate the schema files with `pnpm dev schema upgrade` and extend the JSON Schema test.
5. Remove the `it.fails` markers in `partialCommandsConfig.test.ts` and run the gate.

### Excluded scope

- The frozen agent commands, security.json and the provider allowlists (phase-04).
- The phase prompt's gate section (phase-04).
- Any change to the gate runner, `selectGateSteps` or required-command coverage.
- Adding `partial` to this repository's phax.json (q-own-profile `follow-up`).
- README and docs pages (phase-06).

### Verification

The `standard` gate profile in `phax.json`. The configured acceptance provider checks that phase-01's acceptance tests pass with only their markers removed.

### Expected handoff content

The path `src/domain/gate/partialCommand.ts` and the exact signatures of `parsePartialCommand`, `partialAllowPrefixes`, `describePartialRefusal` and the refusal union. The construct order and the names used for each construct. How the decided q-glued-placeholder option was implemented. The `partial` field's TypeScript type on `GateStep`. The refusal message formats, with an example for a workspace path. Confirmation that phax.json is byte-identical and that only the two schema files were regenerated. Any deviation from the planned files, with the reason.

### Commit subject

`feat(config): accept partial commands on gate steps`

### Commit body

A gate step in phax.json, a workspace profile or the user overlay may declare `partial` with a `files` variant, holding a `<name>` placeholder, and/or a `diff` variant, holding none. A pure parser in src/domain/gate/partialCommand.ts recognizes placeholders, splits pipe segments and computes each segment's allowed prefix. The loader refuses an empty or unknown partial, a misplaced placeholder and every non-pipe construct before decoding, naming the step's bracketed path, the variant and the construct. phax.schema.json and phax.user.schema.json are regenerated. Nothing reads `partial` yet.

---

## phase-03 — Acceptance tests for partial commands in a run {#phase-03-run-acceptance}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium
**Acceptance phase:** passed by phase-04
**Acceptance test files:** `tests/integration/partialCommandsRun.test.ts`

Freeze acceptance tests that drive real runs through the `executePlan` harness. They pin what a run does with partial commands: the prompt's partial lines and explanation, terminal steps' lines on the terminal phase only, the Claude Code allow rules, the `partial` source in security.json, the same lines and allowlist on resume, and the same section for every provider. Every test carries vitest's expected-failure marker until phase-04 passes it.

### Detailed instructions

- Create `tests/integration/partialCommandsRun.test.ts`. Drive runs through the existing `executePlan` integration harness, with fake backend, fake shell answering every gate command with exit 0, and a temporary repository per test. Model it on `tests/integration/protectedPathsAdditive.test.ts`, which routes a phase to claude-code, codex-cli and mistral-vibe and reads prompt.md and security.json. Also model it on `tests/integration/agentCommandGrants.test.ts` (security.json agentCommands) and the prerequisite's `tests/integration/phasePromptGate.test.ts` (the `## Gate` extractor and the resume scenario). The entries are the run, its prompt.md and security.json files, and the `AgentRunOptions` the fake backend receives. Do not import `src/domain/gate/partialCommand.ts`: compute expected prefixes by hand in the test.
- Profile fixture, built as `GateStep` values, which now type-check with `partial` after phase-02. Every-phase local `pnpm lint` with `partial: { files: "pnpm exec oxlint <files>", diff: "git diff --name-only --diff-filter=d | xargs pnpm exec oxlint" }`. Every-phase local `pnpm test` with `partial: { files: "pnpm exec vitest run <files>" }`. One every-phase step with no partial (for example `pnpm typecheck`). A terminal product `pnpm build` with `partial: { files: "pnpm exec vite build <files>" }`. A two-phase plan.
- ac-prompt-lines: in phase-01's prompt.md `## Gate` section, the line after `- local: pnpm lint` is `  - on some files: pnpm exec oxlint <files>`, the next is `  - on your changes: git diff --name-only --diff-filter=d | xargs pnpm exec oxlint`, and the line after `- local: pnpm test` is only its `  - on some files:` line. Steps without `partial` have no `on some files:` or `on your changes:` line under them. Match the indentation and labels exactly as the plan's Technical arbitrations fix them.
- ac-prompt-explains: the section contains `check part of what the step checks`, `Replace a placeholder such as <files> with the files you choose`, and `phax does not run these commands`. Then remove from the section every step line and every partial line: the remaining text contains none of `pnpm`, `npm`, `vitest`, `oxlint`, `git ` (with a trailing space or as a whole word) or `cargo`.
- ac-terminal-partials: phase-01's section has no `pnpm build` line and no `pnpm exec vite build` line, and phase-02's (terminal) section has `  - on some files: pnpm exec vite build <files>` right under `- product: pnpm build`.
- ac-claude-rules: a secure run routed to claude-code, with `security.agentCommands` empty. Take the `agentCommands` the fake backend received for phase-01 and build the Claude flags with `claudePermissionFlags` from `src/domain/session/claudePermissionFlags.ts`, using the phase's security policy. Assert that the `--allowedTools` value contains `Bash(pnpm exec oxlint:*)`, `Bash(git diff --name-only --diff-filter=d:*)`, `Bash(xargs pnpm exec oxlint:*)` and `Bash(pnpm exec vitest run:*)`. The terminal step's prefix `Bash(pnpm exec vite build:*)` is present in phase-01 too, because every firing is allowed. Assert also that no rule holds `<`, `>` or `|`.
- ac-security-json: the same secure claude-code run with `security.agentCommands: ["pnpm exec oxlint"]`. Read phase-01's security.json. `pnpm exec oxlint` appears exactly once, with `source` "config". `git diff --name-only --diff-filter=d` and `xargs pnpm exec oxlint` appear with `source` "partial", `explicit` false, `requiredByPlan` false. No entry's command holds `<` or `|`.
- ac-resume, two cases. (a) Fresh relaunch: let phase-01's gate exhaust its fix budget, then `reset-phase` and resume, as the prerequisite's resume test and the executePlan baseline 'case 3' do. The regenerated phase-01 prompt's partial lines equal the first prompt's, and the second session's received `agentCommands` hold the same partial prefixes. (b) Session resume: interrupt phase-01 while its agent session runs, so that agent-binding.json exists and the resume takes the binding path in `executePlan`. Find how an existing executePlan test interrupts a session (for example a backend that fails with an interruption on its first call). Assert that the resumed session's `agentCommands` hold the same partial prefixes as the first session's.
- ac-providers: run the same phase once routed to claude-code, once to codex-cli and once to mistral-vibe, using the routing fixtures of `protectedPathsAdditive.test.ts`. The three `## Gate` sections, partial lines included, are byte-identical, and each contains the `on some files:` line of `pnpm lint`.
- Each test first asserts the presence the criterion needs, such as a partial line, a partial-source entry or a partial prefix, so it fails today on that assertion and never passes vacuously. A test that would pass against today's code is not an acceptance test: leave the no-partial and never-run criteria to phase-04.
- Mark every test `it.fails` and confirm `pnpm test` and `pnpm test:type` are green. Keep the tests deterministic, with fixed fixtures.

### Planned files to create

- `tests/integration/partialCommandsRun.test.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- `tests/helpers/fakePorts.ts`

### Boundary contracts

Consumers: the phase agent, which reads prompt.md; the operator, who audits security.json; and the provider adapters, which receive `AgentRunOptions.agentCommands`. Producer: `executePlan`. The contracts pinned: the indicative prompt lines as fixed in Technical arbitrations, the normative security.json `source: "partial"` entry, and the allow rules the Claude flags builder derives from the frozen commands.

### Test strategy

- under each listed step that declares partial come its on-some-files then on-your-changes lines, verbatim and indented, and steps without partial have none — medium · example · the expected lines of phase-01's gate section · acceptance · ac-prompt-lines
- a gate section with partial lines explains them, and its fixed wording names no tool — medium · example · the explanation phrases and the absence of pnpm, npm, vitest, oxlint, git and cargo · acceptance · ac-prompt-explains
- a terminal step's partial line appears only on the terminal phase, under its step — medium · example · both phases' gate sections · acceptance · ac-terminal-partials
- a secure Claude Code phase's allowed tools hold one prefix rule per partial segment of every step, and no rule holds a placeholder or a pipe — medium · example · the --allowedTools value built from the received agent commands · acceptance · ac-claude-rules
- security.json records partial prefixes with source partial, a prefix also in config once as config, and no placeholder — medium · example · phase-01's security.json agentCommands · acceptance · ac-security-json
- a relaunched phase and a resumed session keep the same partial lines and partial prefixes as the first session — medium · example · the first session's prompt section and received agent commands · acceptance · ac-resume
- the gate section, partial lines included, is byte-identical on claude-code, codex-cli and mistral-vibe — medium · metamorphic · equality of the three routed prompts' gate sections · acceptance · ac-providers

### Implementation order

1. Build the fixture profile and two-phase plan, and reuse or copy the `## Gate` extractor.
2. Write the prompt tests (lines, explains, terminal).
3. Write the security tests (Claude rules, security.json).
4. Write the two resume cases, then the provider metamorphic test.
5. Add `it.fails` everywhere and confirm the suite is green.

### Excluded scope

- Any change under `src/` (phase-04).
- The criteria that already hold today, no-partial-unchanged and never-run: phase-04 covers them in-phase.
- Real provider CLIs (phase-05).

### Verification

The `standard` gate profile in `phax.json`. The configured acceptance provider checks the expected-failure markers at the gate.

### Expected handoff content

The path `tests/integration/partialCommandsRun.test.ts`, each test's name and criterion id, and the fixture profile. How the session-resume case interrupts the session, and which `executePlan` path it reaches. The exact lines and phrases matched, so phase-04 renders them. Which received-options record the allow-rule test reads. Any deviation from the planned files, with the reason.

### Commit subject

`test(run): acceptance tests for partial commands in phase prompts and allowlists`

### Commit body

Add frozen acceptance tests, marked as expected failures, that drive runs through the executePlan harness. They pin partial lines under their step in the gate section and their tool-free explanation, terminal steps' lines on the terminal phase only, one Claude allow rule per partial segment, the "partial" source in security.json, unchanged lines and allowlist on relaunch and on session resume, and a byte-identical section on every provider.

---

## phase-04 — Allow partial segments and show partial lines in the gate section {#phase-04-allow-and-show}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

A secure phase may run every segment of every partial command of its resolved profile, on the fresh launch, the declared stop and the session resume. security.json records each new prefix with the `partial` source. The phase prompt's `## Gate` section shows each step's partial commands under it and explains them. phax still never runs a partial command, and a profile without `partial` produces the same prompt as before. phase-03's acceptance tests pass.

### Detailed instructions

- Frozen-command wiring.
- In `src/domain/security/agentCommands.ts`, widen `AgentCommandRecord.source` to `"config" | "gate" | "partial" | "brief"`. Add a required `partialCommands: readonly string[]` input to `computeFrozenAgentCommands`, merged after gate entries and before brief entries with source "partial" and `explicit: false`. Update the precedence comment. Leave `checkRequiredCommands` unchanged: partial prefixes do not count toward requiredCommands coverage.
- In `src/schemas/securityPosture.ts`, widen the `agentCommands[].source` literal to `"config", "gate", "partial", "brief"`. `version` stays 3, with no new field and no lift.
- In `src/app/executePlan.ts`, next to `gateCommandStrings`, compute `const partialPrefixes = partialAllowPrefixes(gateSteps);` from `src/domain/gate/partialCommand.ts`, over the unfiltered resolved profile. Pass it to `resolvePhaseAgent` through a new arg, used by its `computeFrozenAgentCommands` call. Pass it also to both `resolvePhaseAgent` call sites (the declared-stop setup and the fresh launch) and to the session-resume `computeFrozenAgentCommands` call. Grep for every other `computeFrozenAgentCommands` caller (tests included) and give each `partialCommands`.
- No provider adapter changes. Claude's `gateCommandAllowRules`, Vibe's allowlist and Codex all consume the frozen command list as today. Check this by reading `src/infra/providers/mistralVibe.ts`, `src/domain/session/vibeFlags.ts` and `src/infra/providers/claudeCode.ts`, and record it in the handoff.
- Grep for readers that switch on `source` (for example the final report, `phax enter`, records explain) and handle "partial" wherever they enumerate sources.
- Prompt lines.
- In `src/domain/gate/gateSection.ts` (from the prerequisite), extend `renderGateSection(steps)`. Under each step line whose step declares `partial`, emit `  - on some files: <partial.files>` when declared, then `  - on your changes: <partial.diff>` when declared, verbatim.
- When at least one listed step declares `partial`, insert two lines right after the line "While you work, check each change with the narrowest command that covers it.": `A step's "on some files" and "on your changes" commands check part of what the step checks.` and `Replace a placeholder such as <files> with the files you choose. phax does not run these commands.`
- When no step declares `partial`, the output must be byte-identical to the prerequisite's. The section is fed by `phaseSteps`, the per-phase selection, unchanged, so terminal lines appear on the terminal phase only. `buildPhasePrompt` takes no provider input, so every provider gets the same text.
- Extend `tests/unit/gateSection.test.ts`:
- both variants, files only and diff only;
- indentation and order;
- explanation lines present only when some step declares partial;
- a fixture of steps without partial renders exactly the prerequisite's lines, pinned as a literal expected array (ac-unchanged-without);
- the fixed wording, minus step and partial lines, holds no pnpm, npm, vitest, oxlint, git or cargo.
- Extend `tests/unit/agentCommands.test.ts` (create it if absent; check `tests/unit/` for the existing frozen-commands test first) with a table of precedence. A command in config and partial is recorded once as config. In gate and partial, once as gate. In partial and brief, once as partial. Order is config, gate, partial, brief. A partial prefix is degraded exactly as a gate command is for each provider.
- Add `tests/integration/partialCommandsNeverRun.test.ts` (ac-never-run). Use a fixture repository whose steps declare `partial.files` and `partial.diff` commands that would each create a marker file (for example `touch .ran-files <files>` and `git diff --name-only | xargs touch .ran-diff`), and one phase whose gate fails once and passes after a fix attempt. Use the real shell adapter where the gate integration tests already do (check `tests/integration/gates.test.ts` and `tests/integration/fixLoop.test.ts` for which harness runs gate commands for real). Assert that no marker exists in the worktree or the state root, and that the commands each gate attempt executed, in order, equal the phase gate list's step commands. When only a fake shell is available, assert the executed list from the fake shell and state that in the handoff.
- Remove the `it.fails` marker from every test in `tests/integration/partialCommandsRun.test.ts`. That is the only change allowed to that file. If an acceptance test cannot pass unchanged, stop and say so in the handoff.
- The prompt snapshots of the prerequisite (`tests/unit/__snapshots__/promptGeneration.test.ts.snap`, `tests/integration/__snapshots__/executePlan.test.ts.snap`, `tests/integration/__snapshots__/protectedPathsAdditive.test.ts.snap`) must not change, because their profiles declare no partial. If one changes, the change is a defect: fix the code, not the snapshot. Snapshots that embed security.json agentCommands also stay unchanged, because a profile without partial adds no entry.

### Planned files to create

- `tests/integration/partialCommandsNeverRun.test.ts`

### Planned files to edit

- `src/domain/security/agentCommands.ts`
- `src/schemas/securityPosture.ts`
- `src/app/executePlan.ts`
- `src/domain/gate/gateSection.ts`
- `tests/unit/gateSection.test.ts`
- `tests/integration/partialCommandsRun.test.ts`

### Optional files that may be edited

- `tests/unit/agentCommands.test.ts`
- `src/app/finalReport.ts`
- `src/app/promptGeneration.ts`
- `tests/integration/agentCommandGrants.test.ts`
- `tests/helpers/fakePorts.ts`

### Boundary contracts

app → domain: `executePlan` consumes `partialAllowPrefixes(steps)` (domain/gate) and passes its result as `partialCommands` to `computeFrozenAgentCommands` (domain/security). The stable shape is an ordered, deduplicated list of normalized prefixes. domain → schemas: an `AgentCommandRecord` with source "partial" is persisted through `SecurityPostureSchema` (version 3). app → domain: `buildPhasePrompt` consumes `renderGateSection(phaseSteps)`, whose `GateStep` input now may carry `partial`. infra providers consume `AgentRunOptions.agentCommands` unchanged.

### Test strategy

- partial prefixes join the frozen set after gate and before brief, deduplicated with the earlier source kept, and degraded like any narrow command — small · table · a table of overlapping config, gate, partial and brief inputs and the expected records · in-phase · ac-security-json
- the gate section renders each declared variant under its step with the explanation, and with no partial it renders exactly the prerequisite's lines — small · example · literal expected section arrays · in-phase · ac-unchanged-without
- a profile without partial leaves every existing prompt and security.json snapshot unchanged — medium · example · the prerequisite's committed snapshots, unchanged · in-phase · ac-unchanged-without
- a run whose gate fails once then passes never executes a partial command, and each attempt executes exactly the step commands in order — medium · example · absence of marker files and the executed gate command list · in-phase · ac-never-run
- phase-03's run acceptance tests pass with only their markers removed — medium · example · the frozen tests in partialCommandsRun.test.ts · in-phase · ac-resume

### Implementation order

1. Widen the source literal and add `partialCommands` to `computeFrozenAgentCommands`, with its table test.
2. Wire `partialAllowPrefixes(gateSteps)` through `resolvePhaseAgent` and the session-resume path in `executePlan`.
3. Extend `renderGateSection` and its unit test.
4. Add the never-run integration test.
5. Remove the `it.fails` markers in `partialCommandsRun.test.ts`, check that the snapshots are unchanged, and run the gate.

### Excluded scope

- Changing the gate: its steps, commands, order, firing, fix budget or verdict.
- Counting partial prefixes toward requiredCommands coverage.
- Provider adapter changes, and per-provider prompt text.
- Authoring, decide, review, brief, plan-extraction and fix-attempt prompts, and the interactive stop guide.
- Real-CLI checks (phase-05) and docs (phase-06).

### Verification

The `standard` gate profile in `phax.json`. The configured acceptance provider checks that phase-03's acceptance tests pass with only their markers removed.

### Expected handoff content

The new `computeFrozenAgentCommands` input and the precedence. Where `executePlan` computes `partialPrefixes`, and each call site that consumes it, with line references. The final `renderGateSection` output for a step with both variants, as literal lines. Confirmation that no prompt or security snapshot changed, and that no provider adapter changed. Which shell the never-run test uses. Any reader of `source` that was updated. Any deviation from the planned files, with the reason.

### Commit subject

`feat(gate): allow and show partial commands of gate steps`

### Commit body

computeFrozenAgentCommands takes the segment prefixes of every partial command in the resolved profile, after gate and before brief commands. executePlan feeds them to the fresh launch, the declared stop and the session resume, so a secure phase may run each pipe segment, and security.json records each new prefix with source "partial" (still version 3). The phase prompt's gate section shows each step's "on some files" and "on your changes" commands under it, with a tool-free explanation. A profile without partial renders the section exactly as before. phax never runs a partial command, and the gate is unchanged.

---

## phase-05 — Real-CLI checks of a piped partial command on Claude Code and Vibe {#phase-05-real-cli-checks}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

The deliberate e2e tier checks that a piped diff command, allowed through its segment prefixes, runs under phax's secure flags on the real Claude Code CLI while a nested `$(…)` form is denied. It also records whether the same pipe runs on the real Mistral Vibe CLI. Neither check runs in `check:full` or the gate.

### Detailed instructions

- Create `tests/e2e/claudePartialCommands.test.ts`, modeled on `tests/e2e/claudeProtectedPaths.test.ts`: opt-in with `PHAX_E2E_RUN=1` and `probeProvider("claude")`, the same stream `toolCalls` parsing, and `buildArgs` from `src/infra/providers/claudeCode.ts` with a secure `SecurityPolicy`.
- In a temporary git repository with one committed file that is then modified and left uncommitted, define the diff command `git diff --name-only --diff-filter=d | xargs wc -l`. Derive its allowed prefixes with `parsePartialCommand(…, "diff")` from `src/domain/gate/partialCommand.ts`, and pass them as the agent commands, so the argv carries `Bash(git diff --name-only --diff-filter=d:*)` and `Bash(xargs wc -l:*)`. This tool-free stand-in replaces the spec's oxlint command; Technical arbitrations explains why.
- Ask the session to run the diff command verbatim, then `wc -l $(git diff --name-only)`, each as its own Bash call, and to make no other call.
- From the stream's tool calls, assert that the first Bash call ran (not an error, its result showing the modified file's line count) and that the second was denied (an error result carrying Claude's permission or nested-command refusal). Match the refusal loosely and print the tool calls on failure.
- In `tests/e2e/vibeSecure.test.ts`, add a case under the existing suite's guards (Vibe ≥ 3.0.3, provider enabled), in its own temporary repository with an uncommitted change. Set the session's agent commands to the same derived prefixes, ask Vibe to run the diff command verbatim, and read the stream's tool-call `effect` entries as the suite already does.
- The Vibe case asserts only that a bash call with that command was attempted and settled. It then writes the observed outcome (`ran` or `refused`, with the settlement text) to the test's output and to the artifacts the suite prints (`printArtifacts`), so the operator can copy it into docs/security.md. It must not assert which outcome occurred (q-vibe `check-and-record`).
- Update the header comment of `vibeSecure.test.ts` to list the new case, and give the Claude file a header comment that names the probe fact it guards.
- Do not run these tests in the phase: they need the real CLIs. Confirm only that `pnpm test:type` typechecks them and that the gate's `pnpm test` does not collect them (the e2e config is separate). State in the handoff the exact command the operator runs, `PHAX_E2E_RUN=1 pnpm test:e2e:real tests/e2e/claudePartialCommands.test.ts tests/e2e/vibeSecure.test.ts`, or the form the e2e config accepts.

### Planned files to create

- `tests/e2e/claudePartialCommands.test.ts`

### Planned files to edit

- `tests/e2e/vibeSecure.test.ts`

### Optional files that may be edited

- `tests/e2e/helpers/artifacts.ts`

### Boundary contracts

tests → domain and infra: the e2e checks consume `parsePartialCommand` (the single owner of prefixes) and the real adapters' argv builders (`buildArgs` for Claude Code, `runVibeAgent` for Vibe). The provider CLI is the producer of the observed behavior: a ran or refused tool call in its stream.

### Test strategy

- under phax's secure Claude flags with the segment rules, the piped diff command runs and the nested $(…) form is denied — large · smoke · the real Claude Code stream's tool calls and results · in-phase · ac-claude-real
- under phax's secure Vibe flags with the segment prefixes on its allowlist, the piped diff command is attempted and its outcome recorded — large · smoke · the real Vibe stream's tool-call effect entries, outcome recorded not asserted · in-phase · ac-vibe-real

### Implementation order

1. Write the Claude Code real-CLI file with its fixture, prompt and stream assertions.
2. Add the Vibe case to the existing secure suite.
3. Typecheck, and confirm the gate's test run does not collect the e2e files.

### Excluded scope

- Running the real CLIs in the phase or adding them to `check:full` or the gate.
- A Codex check: Codex has no per-command allowlist.
- Vibe-specific workarounds if the pipe is refused (q-vibe `check-and-record`).
- Docs (phase-06).

### Verification

The `standard` gate profile in `phax.json`, which typechecks the e2e files (`pnpm test:type`) but does not run them. The real-CLI result comes from the operator's deliberate `pnpm test:e2e:real` run.

### Expected handoff content

The two test names and paths, the exact command the operator runs, the derived allow rules they use, what the Claude test asserts for each call, and where the Vibe case writes its observed outcome. A note that neither was executed in the phase. Any deviation from the planned files, with the reason.

### Commit subject

`test(e2e): real-CLI checks of piped partial commands on Claude Code and Vibe`

### Commit body

Add a deliberate real-CLI check that, under phax's secure Claude Code flags with one prefix rule per pipe segment, a piped diff command runs and a nested $(…) form is denied. Add a Vibe secure-suite case that runs the same pipe with its segment prefixes on the bash allowlist and records whether Vibe ran it. Both live in the e2e tier, outside check:full.

---

## phase-06 — Document partial commands {#phase-06-docs}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

A project maintainer learns from the README's gate profiles section how to declare `partial`, what phax shows and allows, that phax never runs it, and the two traps of a piped diff command. An operator auditing security reads in docs/security.md that partial segments are allowlisted with their step, with the known prefix residual and the Vibe result. Records readers learn of the new `partial` source in docs/upgrading.md.

### Detailed instructions

- README.md, in the gate profiles section beside "Gate report steps" and "Gate request": add a "Partial commands" subsection with the §11 example. Add `"partial": { "files": "pnpm exec vitest run <files>", "diff": "pnpm exec vitest run --changed" }` to a `pnpm test` step.
- Explain the example: each phase prompt shows both commands under the step; a secure phase may run them without listing them in `security.agentCommands`; phax never runs them; the gate still runs `pnpm test`.
- State the grammar: `files` needs a `<name>` placeholder, `diff` takes none, and the parts are joined with `|` only; anything else is refused at load.
- Name the two traps of a piped diff command. With an empty diff, `xargs` may run the tool on the whole repository unless it skips empty input (`xargs -r`). And `git diff` does not list new untracked files, which a phase worktree holds until phax commits. Show the safer form `git diff --name-only --diff-filter=d | xargs -r pnpm exec oxlint`.
- Also state that this repository's phax.json does not use `partial` yet, but say it only if the README talks about this repository's own profile. Otherwise omit it.
- docs/security.md, "Shell command execution": add a paragraph and table notes. The allowlisted set now also holds the segment prefix of every pipe segment of every partial command in the profile, whatever the step's firing, recorded in `security.json` with `source` "partial".
- Write the Claude Code row note: each segment is its own `Bash(<prefix>:*)` rule; a pipe whose every segment is allowed runs, and a `$(…)` form is denied even when allowed as an exact string (guarded by `tests/e2e/claudePartialCommands.test.ts`).
- State the known residual: an allowed segment prefix accepts any further options and arguments, as gate commands already do. A placeholder-bearing prefix allows the tool on any files.
- Write the Vibe result sentence: "a pipe whose every segment is on the allowlist is expected to run; `tests/e2e/vibeSecure.test.ts` records the observed result". Mark the result as to be confirmed by a real-CLI run. The operator replaces the sentence with the observed outcome during final review (see the plan preamble).
- Also update the earlier provider bullets ("only the phase's gate commands are allowlisted") to say gate and partial commands.
- docs/upgrading.md, 0.34.0 section (create the section if absent, following the file's existing release-section format): gate steps accept `partial`, and records readers see `security.json` `agentCommands[].source` gain the value "partial", still version 3. No migration is needed.
- Check that every example is consistent with the refusal rules: no example partial command may hold a construct phax refuses.
- Do not edit phax.json.

### Planned files to create

- (none)

### Planned files to edit

- `README.md`
- `docs/security.md`
- `docs/upgrading.md`

### Optional files that may be edited

- `docs/cli/reference.md`

### Test strategy

- (none)

### Implementation order

1. README gate profiles subsection with the §11 example and the two traps.
2. docs/security.md shell execution paragraph, row notes, residual and Vibe sentence.
3. docs/upgrading.md 0.34.0 entry.

### Excluded scope

- Adding `partial` to this repository's phax.json (q-own-profile `follow-up`).
- Any code or test change.
- Release notes, which are cut by the maintainer.

### Verification

The `standard` gate profile in `phax.json` (terminal phase: its product steps, including `pnpm site:build`, run too).

### Expected handoff content

The sections added or changed in each file. The exact Vibe sentence in docs/security.md, and the instruction to the operator: run `PHAX_E2E_RUN=1 pnpm test:e2e:real` on `tests/e2e/claudePartialCommands.test.ts` and `tests/e2e/vibeSecure.test.ts` during final review, then replace the sentence with the observed Vibe outcome. Any deviation from the planned files, with the reason.

### Commit subject

`docs: document partial commands on gate steps`

### Commit body

Add a Partial commands subsection to the README's gate profiles. It covers the files and diff variants, the placeholder, the pipes-only grammar, that phax shows and allows them and never runs them, and the empty-diff and untracked-file traps of a piped diff command. docs/security.md states that partial segments are allowlisted with their step and recorded with source "partial", the prefix residual, the Claude Code nested-command denial, and the Vibe result from the real-CLI suite. docs/upgrading.md notes the new security.json source value.
