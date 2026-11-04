Write the third phax plan of the spec `command-contracts` (`docs/specs/2611031738-command-contracts.md`, approved 2026-11-03). Plans 1 (`command-runner-and-mod-answers`, PR #184) and 2 (`inspection-commands-on-the-runner`, PR #185) ported the command library and moved the inspection commands; plan 4 moves the run and session commands and completes the spec, so this run does not complete it (`completes-spec: false`). Title it "Lifecycle and authoring commands on the runner".

**Scope.** These commands, moved onto the runner through the bridge, each with its output contract, its `render` (today's text), its declared errors with today's sentences and codes, and its help, examples and completers moved into its definition:
- the rest of the `artifact` group: `new spec` and `new plan` (with the text `--brief` document), `approve`, `reopen`, `complete`, `abandon`, `stale`, `decide` (with the `--verdicts` document), `schema`, `migrate-approvals`, `migrate-documents`. `artifact` and `artifact new` are then groups the runner holds whole, and the bridge's partial groups list is empty;
- the `agent` group: `models`, `resolve`, `probe`, `setup` (`providers`, `mistral-vibe`), held whole;
- `init`, `unlock`, `archive`, `prune`.

It finishes, for these commands, the criteria plans 1 and 2 left open: "A document from a file or stdin", "stdin a terminal is refused at once", "A bad document is refused before run" (`artifact decide --verdicts`), "A Markdown brief is read as text" (`artifact new --brief`), "Written files reported" (`artifact approve`), "Written files on failure", "Groups alone at any depth" (`artifact`, `artifact new`, `agent setup`), "--json refuses an interactive mode" for `artifact decide` (`enter` waits for plan 4), and the every-command criteria for each moved command. List in the plan's overview which criteria this plan finishes and which wait for plan 4.

**Settle in Technical arbitrations, each with its dominant loss:**
- **Each command's output contract.** No new format (§6 `package`), so these outputs carry no `$schema`. `artifact decide --verdicts --json` and `agent resolve --json` print an unversioned object today, and `prune --json` too: say whether each object becomes the output contract byte for byte. `unlock --json` answers what §6's normative surface shows (`{ "shortName", "removed" }`): name its values.
- **Commands that prompt or hand over the terminal.** `artifact decide` without `--verdicts` opens an interactive session; `init` runs a wizard unless `--yes`; `artifact approve` without `--by` asks on a terminal; `prune` confirms unless `--yes` (and `prune --json` never prompts, as today, §10); `archive` and `unlock` may ask too. Say for each when it declares `prompts` and so refuses `--json` (§5.20), and keep `prune --json` meaning "never prompt".
- **The two stdin documents.** `--verdicts <file|->` (JSON, a `decide-verdicts` document) and `--brief <file|->` (text) use the port's stdin flag with a required value (§9b q-stdin-flag-value): a bad verdicts document is refused before `run` naming the path and field (§5.16), a terminal stdin is refused at once (§5.15).
- **Authoring and decide sessions.** `artifact new --headless` and `artifact decide` run agent sessions for minutes: say which progress lines each writes as it happens (§5.19), as note lines under `--json`, and what a session's failure answers (its written files on failure, §5.18).
- **Written files.** The artifact transitions write the artifact, its sidecar and approval records, then auto-commit them: say what each answers as written-file records (the commit is not a file) and what `migrate-approvals` and `migrate-documents` report. A command that fails after writing a file lists it in its error's `written`.
- **Where the definitions live** and what moves out of `src/cli/commands/`, `cliDocs` and `cliCompleters`, as plan 2 did.
- **The bridge after this plan**: only root help, `--version` and the plan-4 commands stay Commander's; say what the bridge still holds.

**What exists (read it first):**
- The spec: §5, §6, §8, §9b and §10 in full.
- Plans 1 and 2, archived: `docs/plans/archive/2611031926-command-contracts-plan.md` and `docs/plans/archive/2611040904-command-contracts-plan.md`, their Technical arbitrations; follow their patterns.
- The port, `src/cli/commandLibrary/{contract,commander}/`, with the gains plans 1 and 2 added, among them: `prompts`, variadic arguments, negated switches, group help, an option's value name from its field's `identifier`, and a declared error's text form `{ out, err }` for the lines a person read on stdout before a failure. Its conformance cases under `contract/conformance/`.
- The definitions, `src/cli/definitions/`, and the bridge, `src/cli/bridge.ts` (`PARTIAL_GROUPS`, the phase guard, `help` routing), with their tests.
- The usage generator and its tests, as plan 2's brief listed them, including the frozen-file test's allowlists in `tests/integration/usageSpecDeclarations.test.ts`.
- The commands as they are: `src/cli/commands/` for each command above (`artifact.ts`, `artifactDecide.ts`, `agent.ts`, `init.ts`, `unlock.ts`, `archive.ts`, `prune.ts`, `pruneRegister.ts`), `src/cli/program.ts`, `cliDocs`, `cliCompleters`, and their tests (among them `tests/integration/decideArtifact.test.ts`, `artifactNewHeadlessCommand.test.ts`, `initCommand.test.ts`, `initWizard.test.ts`, `pruneCommand.test.ts`).

**Lessons from plans 1 and 2 (do not repeat):**
- A command's text is its streams too. Lines it printed on stdout before failing stay on stdout (the `{ out, err }` text form), and a failure's sentence alone goes to stderr. Plan 2 moved `skills install`'s and `validate`'s stdout lines and dropped `path`'s.
- An option keeps its value name (`--by <arbiter>`, `--verdicts <file|->`, `--model <model>`): annotate the field's `identifier`, never allowlist a renamed value in the frozen-file test.
- Today's exit codes stay, success codes included: no new verdict a command did not have (plan 2 made `records init` exit 1 on a refused sync).
- A test fixture that commits sets its own git identity in the fixture repository: `isolateGit` leaves none, and CI has none to fall back on (plan 2's fixtures were green locally and red on CI).
- An acceptance test fails on its own assertions, its expected-failure marker on its own `it`; the passing phase removes only that marker.
- No test holds a fact the release cut changes (a snapshot named `next`, the version in `package.json`).
- `docs/upgrading.md` names every change a person or a script can observe; it never says "unchanged" for a command whose streams, codes or help moved.

**Constraints:**
- **Text and codes unchanged.** Without `--json`, each moved command prints today's text on today's streams with today's codes; a refused call exits 64 with today's sentence. Existing tests keep passing with their assertions unchanged, except where `--json` is new.
- **No back-compat shims; no optional field in a persisted shape.** No document versioned today changes (§5.28): the spec and plan sidecars, approval records, decision and authoring records stay byte for byte.
- **This repository during the run.** The run is driven by the installed phax 0.33.0, which runs `artifact` commands on this repository's plans while the run goes; nothing this plan changes is read by it. The phase guard keeps refusing inside a phase worktree with exit 1.
- **Isolation.** Tests never read `~/.phax`, a real `~/.claude`, `~/.codex` or `~/.vibe`, the global git config, or the real `gh`, and never start a real agent session or provider probe. Use `tests/helpers/isolateGit.ts`, temporary directories, the fake provider backends, the fake Prompt port and `makeFakeGitHub()`.
- **Registries.** Respect `pnpm audit:architecture`, knip and the closure allowlist in `tests/unit/architecturalGuards.test.ts`. `pnpm gen:usage-spec` and `pnpm docs:cli` rewrite `phax.usage.kdl` and the README's generated block; list both as planned edits.
- **Gates.** The `standard` profile verifies every phase, and `phax.json` allows every command a phase runs.
- **Models.** Follow the phax-planning skill's model policy. Moving a command onto the settled pattern is Sonnet work; say why any phase needs Opus (the stdin documents and the decide and authoring sessions may).
- **`### Test strategy`.** Use the line format with the spec's criterion ids.
- **Lint and skills.** The plan must pass `phax plans lint` with the installed phax. The skills that teach `artifact decide`, `artifact new` and `artifact approve` keep working as written; if one must change, the plan says so and the run needs `--allow-skill-edits`.

**Docs:** `docs/upgrading.md`'s 0.34.0 entry gains the moved commands, each change named. The docs page `reference/json-output` (§11) waits for plan 4.

**Phase shape:** as few phases as the gates allow, every commit green, split by family (the artifact transitions, the two stdin documents and their sessions, the agent group, the root lifecycle commands). The acceptance tests of a family come in the phase before the one that moves it, or in the same phase as in-phase criteria.

**Output:** your final message is the plan document JSON and nothing else: no sentence before or after it, and no code fence.
