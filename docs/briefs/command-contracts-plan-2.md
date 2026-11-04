Write the second phax plan of the spec `command-contracts` (`docs/specs/2611031738-command-contracts.md`, approved 2026-11-03). Plan 1 (`command-runner-and-mod-answers`, PR #184) ported the command library and moved four commands; two later plans move the rest, so this run does not complete the spec (`completes-spec: false`). Title it "Inspection commands on the runner".

**Scope.** The inspection commands, moved onto the runner through plan 1's bridge, each with its output contract, its `render` (today's text), its declared errors with their documented codes, and its help, examples and completers moved out of `cliDocs` and `cliCompleters` into its definition:
- `validate`, `session-info`, `path`, `brief`, `architecture`, `completions`, `report`;
- the groups `cost` (`backfill`), `schema` (`upgrade`), `security` (`status`), `skills` (`install`) and `records` (`init`, `sync`, `status`, `list`, `explain`);
- the rest of `plans`: `status`, `overlap`, `estimate`. The `plans` group then holds only runner commands.

A group whose every command moves in this plan moves whole: the runner owns its help and its refusal when called alone, and the bridge's routing says so. `artifact` stays bridged until plan 3.

It covers, for these commands, the criteria plan 1 left open per command: "--json on every command", "Text output unchanged", "Error sentences and codes kept", "Unknown option refused", "The contracts catalogue" (one entry per moved command), "Groups alone at any depth" for the groups that move whole, "Help" and "No command reaches the parser" for every moved definition. "Written files are part of the answer" holds on each moved command that writes a file. List in the plan's overview which criteria this plan finishes and which still wait for plans 3 and 4.

**Settle in Technical arbitrations, each with its dominant loss:**
- **Each command's output contract.** The spec creates no format beyond the four plan 1 shipped (§6 `package` surface), so these outputs carry no `$schema`, as the spec's `unlock --json` example shows. `plans status`, `plans overlap` and `plans estimate` answer `--json` today with an unversioned object: say whether that object becomes the output contract as it is (byte for byte) or changes, and what a reader loses either way.
- **Commands whose text is a script's input.** `path` is read by `cd "$(phax path …)"`, `completions <shell>` prints a shell script, `records explain` prints a prompt, a diff, gate logs or a transcript. Say what each answers under `--json` (the value inside an object, or a document through the `document` hook) and that the text without `--json` stays byte for byte.
- **Commands that write files** (`skills install`, `schema upgrade`, `cost backfill`, `records init`) answer with the written-file records (§5.18); say which of them writes exactly one file and so takes `--out`, or why none does. `records sync` writes to a Git clone, not a file: say what it answers.
- **Commands that reach a provider, the network or a person.** `brief` and `architecture` ask a configured provider; `plans estimate` runs a one-message Claude Code probe unless `--no-probe`; `report` opens a GitHub issue and a gist through `gh`. Say which progress notes each writes while it runs (§5.19), and confirm none waits on a person under `--json` (§5.20).
- **Where the definitions live**: one file per group or per command under `src/cli/definitions/`, and what moves out of `src/cli/commands/`, `src/cli/cliDocs.ts` and `src/cli/cliCompleters.ts` (a moved command's entry is deleted, not kept beside its definition).
- **The bridge after this plan**: what its routing table holds, and that root help, `--version` and the `artifact` group stay Commander's until plan 4.

**What exists (read it first):**
- The spec: §5, §6, §8 and §10 in full.
- Plan 1, archived: `docs/plans/archive/2611031926-command-contracts-plan.md`, its Technical arbitrations and expected split.
- The port, `src/cli/commandLibrary/{contract,commander}/`, and plan 1's definitions, `src/cli/definitions/` (`program.ts`, `shared.ts`, `ls.ts`, `plansLint.ts`, `plansOverview.ts`, `artifactStatus.ts`): follow their pattern.
- The bridge, `src/cli/bridge.ts`: `route`, `leadingWords`, the help routing, and its tests (`tests/unit/cli/bridge.test.ts`).
- The hybrid generator, `scripts/generate-usage-spec.ts`, `phax.usage.kdl`, the frozen `tests/fixtures/usage/phax.usage.before-command-contracts.kdl` and `usageSpecDeclarations.test.ts` (its `REWORDED_LONG_HELP` allowlist), and the usage tests plan 1's brief listed.
- The commands as they are: `src/cli/commands/` for each command above, `src/cli/program.ts`, `src/cli/cliDocs.ts`, `src/cli/cliCompleters.ts`, and their tests.

**Lessons from plan 1 (do not repeat):**
- An acceptance test fails on its own assertions and is never edited by the phase that passes it. Plan 1 wrote its conformance cases with `it.fails`, the passing phase had to flip them, phax's acceptance check refused the edit and the run stopped.
- A command reading a run reads an archived one too (`phax archive` moves the run folder). Plan 1's `ls` gave `pullRequest` null for every archived run. `session-info`, `path`, `report`, `cost` and `records` read runs: say for each what it does on an archived run today, and keep it.
- No test holds a fact the release cut changes (a snapshot named `next`, the version in `package.json`): CI's release rehearsal runs the tests on the cut tree, and no phase gate does.
- A moved command's long help stays word for word; the frozen-file test allows a rewording only through its allowlist, so a rewording is a decision the plan names, not a drift.

**Constraints:**
- **Text and codes unchanged.** Without `--json`, each moved command prints today's text and error sentences and keeps its documented codes; a refusal exits 64 with today's sentence (plan 1's suggestion and hint). Existing tests keep passing as they are, except where `--json` is new.
- **No back-compat shims; no optional field in a persisted shape.** No document versioned today changes (§5.28).
- **This repository during the run.** The run is driven by the installed phax; nothing this plan changes is read by it. The phase guard keeps refusing inside a phase worktree with exit 1.
- **Isolation.** Tests never read `~/.phax`, a real `~/.claude`, `~/.codex` or `~/.vibe`, the global git config, or the real `gh`, and never run a real provider or a real Claude Code probe. Use `tests/helpers/isolateGit.ts`, temporary directories, the fake provider backends and `makeFakeGitHub()`. The runner is proved through its `Io` data.
- **Registries.** Respect `pnpm audit:architecture`, knip and the closure allowlist in `tests/unit/architecturalGuards.test.ts`. `pnpm gen:usage-spec` and `pnpm docs:cli` rewrite `phax.usage.kdl` and the README's generated block; list both as planned edits.
- **Gates.** The `standard` profile verifies every phase, and `phax.json` allows every command a phase runs.
- **Models.** Follow the phax-planning skill's model policy. Moving a command onto a settled pattern is Sonnet work; say why any phase needs Opus.
- **`### Test strategy`.** Use the line format with the spec's criterion ids.
- **Lint and skills.** The plan must pass `phax plans lint` with the installed phax. No skill changes, so the run needs no `--allow-skill-edits`.

**Docs:** `docs/upgrading.md`'s 0.34.0 entry gains the commands that now answer `--json` and exit 64 on a refused call. The docs page `reference/json-output` (§11) waits for plan 4.

**Phase shape:** as few phases as the gates allow, every commit green, split by family so each phase moves commands whose tests it can prove on its own. The acceptance tests of a family come in the phase before the one that moves it, or in the same phase as in-phase criteria.

**Output:** your final message is the plan document JSON and nothing else: no sentence before or after it, and no code fence.
