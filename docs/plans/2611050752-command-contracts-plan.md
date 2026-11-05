---
status: Draft
source-spec: docs/specs/2611031738-command-contracts.md
completes-spec: true
---
# Run and session commands on the runner

The fourth and last plan of the spec `command-contracts`. Plan 1 (`command-runner-and-mod-answers`, PR #184) ported the command library to Effect 3, put the bridge between Commander and the runner and moved `ls`, `artifact status`, `plans lint` and `plans overview`. Plan 2 (`inspection-commands-on-the-runner`, PR #185) moved the inspection commands and the `plans`, `cost`, `schema`, `security`, `skills` and `records` groups. Plan 3 (`lifecycle-and-authoring-commands-on-the-runner`, PR #187) moved the `artifact` and `agent` groups, `init`, `unlock`, `archive` and `prune`. This plan moves the run and session commands onto the runner (`review-handoff`, `publish-pr`, `review-compliance`, `review-code`, `enter`, `enter-phase`, `shell`, `open`, `adjust-plan`, `run`, `resume`, `reset-phase`). Each gets its output contract, its render (today's text), its declared errors with today's sentences and codes, and its help, examples and completer moved into its definition. The plan then retires the run functions kept for tests and gives the runner the program itself: root help, `--version` and the phase guard. It removes the bridge, `src/cli/program.ts`, `cliDocs` and `cliCompleters`, makes phax.usage.kdl the generator's output from the definitions alone, and writes the docs page reference/json-output. It completes the spec.

Phases: phase-01 gives the port four command-level gains: an option with an optional value, a command's retired options, a render that writes nothing, and a handed-over process's exit. It also pins today's root help in a fixture. phase-02 moves the review and publication commands, and phase-03 moves the commands that hand over the terminal. phase-04 writes the acceptance tests of `run` and `resume`, and phase-05 moves `run`, `resume` and `reset-phase` and passes them. phase-06 and phase-07 retire the run functions plans 1 to 4 kept for tests, and phase-07 adds the every-command table. phase-08 gives the port the program-level gains: the guard, root help, `-V`, the usage header and plain groups. phase-09 hands the program to the runner and removes the bridge, and phase-10 writes the docs page.

Every criterion of the spec, with the plan that finished it:
- Plan 1: ac-misdeclared, ac-json-schema-command, ac-lint-verdict, ac-artifact-status, ac-overview, ac-run-pr, ac-defect, ac-written-on-failure (the port's case) and ac-usage-flag. This plan re-proves ac-usage-flag and ac-defect once main.ts no longer goes through the bridge (phase-09).
- Plan 3: ac-stdin-file-or-dash, ac-stdin-terminal, ac-stdin-bad, ac-brief-text, ac-written (`artifact approve`), ac-written-on-failure (decide's failed commit) and ac-groups. This plan re-proves ac-groups and the stdin criteria once the bridge is gone (phase-09).
- This plan: ac-json-every-command, ac-text-unchanged, ac-unknown-option, ac-help, ac-catalogue and ac-no-parser on the last commands and the whole program (phases 02 to 09). ac-error-sentence, with its `resume` case (phase-04, passed by phase-05). ac-no-person for `enter` and every command that hands over the terminal (phases 02, 03 and 07). ac-progress's own case, `phax run --dry-run --json` (phase-04, passed by phase-05). ac-usage-parity, with the file the generator's output from the definitions alone (phase-09). ac-versioned-stable: plans 1 to 3 pinned the bytes of every versioned document a command prints, and this plan keeps run and resume's persisted documents in today's shapes (phase-05).

Execution caveat: the installed phax 0.33.0 drives this repository during the run, and nothing this plan changes is read by it. Every test proves the runner in one of three ways: through its `Io` data (tests/helpers/runnerCall.ts over the memory Io), through a run function kept until phase-07, or through `tsx src/cli/main.ts` spawned in a temporary repository (tests/helpers/isolateGit.ts, a temporary PHAX home). A fixture that commits sets its own git identity (user.name, user.email). No test reads ~/.phax, a real ~/.claude, ~/.codex or ~/.vibe, the global git config or the real `gh`. No test starts a real agent session, shell, editor or provider probe, or holds a fact the release cut changes (a snapshot named `next`, the version in package.json). Instead, sessions use the fake Session port (src/infra/fakes/session.ts), editors the fake Editor (src/infra/fakes/editor.ts), agents the fake backend (src/infra/fakes/backend.ts), and GitHub `makeFakeGitHub()`. The e2e files tests/e2e/realFlow.test.ts, gateExhaustionResume.test.ts and resetPhase.test.ts are run by a person after the run.

## Required commands

- `pnpm gen:usage-spec`
- `pnpm docs:cli`

Both commands are already in `security.agentCommands` in phax.json: `pnpm gen:usage-spec` rewrites phax.usage.kdl and `pnpm docs:cli` rewrites the README's generated CLI block. No security configuration change is needed. The skills that teach `phax run`, `resume`, `enter`, `enter-phase`, `reset-phase` and `review-handoff` keep working as written. Without `--json` each command keeps its arguments, options, text, streams and codes, `--verbose` and `--trace` keep working anywhere in the call, and `-y` stays beside `--yes`. The plan declares no skill file, so the run needs no `--allow-skill-edits`.

## Technical arbitrations

- Output contracts. The spec creates no format beyond plan 1's four (§6 `package`), so none of these outputs carries a `$schema`. Every value is required, with null for an absent one. Run and resume answer `{ qualifiedName, crossProject, outcome }`, where `outcome` is tagged by `kind`: `dry-run` (run only: the dry-run report formatDryRunReport prints), `preview` (resume without --yes: fromState, nextPhaseId, nextPhaseIndex, skippedPhaseIds, owedStep, skipAcceptance), `already-in-review` (resume on a review_open run: phaseCount, pullRequest), `review_open` (phaseCount, pullRequest, completions as renderArtifactCompletions reads them, finalReport path), `stopped` (the stop report renderStop reads) and the pauses that q-run-pauses decides. Every code run and resume exit with today stays, success codes included. These answers exit 0: dry-run, preview, already-in-review and review_open. `stopped` keeps exit 13 as a verdict, since its text is on stdout today. A refusal or failure before the run starts or outside a pause is a declared error with today's code and sentence: the hold value (1), config and plan errors (2), plan status and staleness (12), preflight (11), lock (7), agent invocation (5), a session failure outside a pause (5 or 14) and anything else (1). reset-phase answers `{ qualifiedName, crossProject, outcome }`, with `preview` (phaseId, atStop, phaseCommit, corrections, personHandoff) or `reset` (phaseId, archivedPath, worktreeRemoved, branchDeleted, wasStopped). review-handoff answers `{ qualifiedName, crossProject, reviewHandoff, written }`. publish-pr answers `{ qualifiedName, crossProject, pullRequest }`, pullRequest null when it pushed without opening one. review-compliance answers `{ qualifiedName, crossProject, verdict, review, notice, warnings, written }`. review-code --headless answers `{ kind: "headless", qualifiedName, crossProject, findings, findingsPath, fixHint, notice, warnings, written }`. The commands that hand over the terminal answer `{ qualifiedName, crossProject, executable, cwd, exit }`, and `open` answers `{ qualifiedName, crossProject, opened }`. A cross-project run's `Target: <q>` line is written as plan 3's `archive` writes it: the render's first line, and the `out` of an error's text form when the command fails after resolving the run. Loss accepted: a reader of these answers gets no `$schema` to validate them by URL, only the contract `--json-schema` prints.
- Progress on long commands (§5.19). run and resume hand their use cases an OutputPort built from the run context, the pattern plan 3's `artifact decide` uses: `log` is `say` (stdout at once without --json, a note line under it), and `warn` and `error` are `progress` (stderr at once, a note line under --json). It is handed to everything that writes as the run goes: the telemetry layer, so that --verbose event lines (`output.log` today) stay on stdout and `phax·error` lines (`output.error` today) stay on stderr; readBundledReviewSkillForRun; and the stop-closed callback. The lines run and resume print before their outcome are written the same way, at the moment they happen. On stdout through say: `using cached extraction`, `Run: <q>`, resume's `Skipping …`, `would resume …`, owed-step and --skip-acceptance lines, and `Pass --yes to proceed.`. On stderr through progress: extract warnings, the unsafe-mode box and `already exists; using …`. The outcome's lines are the render (stdout) and the notes (stderr). For review_open: `reached review`, the completions and `See …final-report.md` in the render, the what's-next lines in the notes. For stopped, renderStop's lines in the render. For already-in-review and each pause, an empty render and today's stderr lines in the notes. So without --json every line stays on today's stream, in today's order within that stream. Loss accepted: under --json the order of stdout lines against stderr lines is not a contract, and the `Run: <q>` line is a note, not part of the answer, which carries qualifiedName.
- Commands that hand over the terminal or prompt (§5.20). These declare `prompts` that always holds: `enter`, `enter-phase` (with or without --new-session), `shell`, `open` (the configured editor may be a terminal one) and `adjust-plan`. `review-code` declares it unless --headless. Under --json each is refused with 64 before anything is read or started. Each `unprompted` remedy names what lifts the refusal: --headless for review-code; `phax session-info <run> --json` for enter and enter-phase; `phax path <run> --json` for shell and open. adjust-plan has no flag to name, so its remedy says to run it from a terminal without --json. `resume` and `reset-phase` never wait on a person, because without --yes they print a preview and exit 0 and take no lock today. They declare no `prompts`: under --json without --yes they answer their preview. `run`, `publish-pr`, `review-compliance` and `review-handoff` never wait on a person either, and declare nothing. Loss accepted: `phax open --json` is refused even when the editor is a GUI one that would have returned at once.
- The phase guard. Today Commander's preAction hook guards the commands Commander holds inside a phase worktree (exit 1), and the bridge guards the runner's before it runs. Once the hook and the bridge are gone, the one guard lives in the runner, as a program gain (phase-08): `Program.guard`. The runner calls it with the located command's words and the option names the call gives, after it locates the command and before it decodes anything. Its refusal carries its own text and exit: today's sentence and 1, or one refused line with exit 1 under --json, as plan 1 settled. `--help`, `-h` and `--json-schema` pass it, as plan 2 learned. phaxProgram declares it from phaseGuardRefusal and isInPhaseWorktree (phase-09). PHASE_GUARD_CLASSIFICATION's completeness test then reads phaxProgram's commands instead of Commander's tree. Loss accepted: the guard sees the call's option names before decoding, not decoded values, so `plans status --apply=false` is refused as `--apply` is today.
- Root help, --version and --usage. The runner writes root help through its Commander adapter, from program gains (phase-08). Its description is the program's summary. Its options appear in today's order: `-V, --version`, `--verbose`, `--trace`, `--usage`, `--usage-format <format>` with today's help and `(default: "kdl")`, `--json-schema` and `-h, --help`. Its commands come in phaxProgram's order, which is today's, each written with Commander's term, then `help [command]`. The program also gains a `help [command]` command that answers that command's or group's help, as the bridge does today. Phase-01 pins today's root help in tests/fixtures/help/phax-root-help.txt, and every later phase keeps it word for word, with one exception. Each command that declared no option before gains `[options]` in its term because it now takes --json (§5.23): `enter`, `shell`, `open`, `publish-pr` and `review-compliance`, each fixture change named in its phase's handoff and in docs/upgrading.md. `--version` and `-V` print PHAX_RELEASE. `--usage` keeps main.ts's catch before any parser: `--usage` anywhere in the call prints the committed phax.usage.kdl, `--usage-format json` goes through the `usage` CLI, and an unknown format is refused with today's sentence and exit 1. Once the splice is gone the committed file is the generator's output from the definitions, so the catch prints the definitions' usage spec. Loss accepted: the runner's own usage-flag path (answered alone, kdl only) stays unused by phax, and main.ts reads its arguments for one flag ahead of the runner, because §5.22 and tests/integration/usageOutput.test.ts keep today's `--usage validate`, `--usage-format json` and `--usage-format toml` answers.
- Written files. A command reports as written-file records only the files it wrote on this call, each read back after the write. Paths under the repository are written from its root, and paths under the state root (~/.phax) are absolute, as plans 2 and 3 do. review-handoff reports review-handoff.md and the global file reconciliation it regenerated. review-compliance reports the compliance review's Markdown and JSON when it generated them, and none on a failure that kept the earlier review. review-code --headless reports the code review files it wrote. Each use case returns the paths it wrote: src/app/reviewHandoff.ts, reviewCompliance.ts and reviewCode.ts gain the field if they lack it. These report none: publish-pr (it pushes a branch and opens a pull request, and publication.json is phax's own state), the commands that hand over the terminal (what a person or a session writes is not the command's), run and resume (their work is commits on the run branch and phax's own state under the run folder; the answer names finalReport and pullRequest), and reset-phase (it moves a folder, named by archivedPath, and removes a worktree and a branch). None answers one document, so none takes --out. Loss accepted: a reader of `run --json` learns of final-report.md by its path, not by a digest.
- Retired option. `resume --skip-oracle` is hidden and refused today with `--skip-oracle is no longer read: write --skip-acceptance` and exit 1. Phase-01 adds a port gain, a command's retired options. The resume definition retires `skip-oracle` with that sentence, refused by the runner with the program's `refused` code (64) and, under --json, one refused line from `flags`. It is never listed in help, the catalogue or the usage spec, as plan 3 settled for `artifact archive`. Loss accepted: the undocumented exit 1 becomes 64, like every call no command accepts (§9b q-program-codes).
- `--hold [selection]` keeps its optional value. Phase-01 adds a port gain: an option whose value is optional. It decodes to `true` when given bare and to its string when given a value, and is declared to Commander as `--hold [selection]` and written in the usage spec as `flag "--hold [selection]"`. run's definition hands the decoded value to parseHoldValue as today. Loss accepted: one more gain for the published package to take upstream.
- A handed-over session in tests. `shell` spawns $SHELL with node:child_process today. Its definition hands `{ executable: $SHELL ?? "bash", args: [], cwd: worktree, env: {} }` to the Session port, whose Node adapter spawns with the same options, inherited stdio and `status ?? 0`, so `shell` is proved through the fake Session and its CLI_DIRECT_IO_ALLOWLIST entry goes with src/cli/commands/shell.ts. `adjust-plan` reads its plan.md through the FileSystem port (makeRepoRootedFileSystemLayer, the path resolved against the invocation directory), and its allowlist entry goes too. The definitions of `run` and `resume` still read plan.md, the registry, run-status.json and publication.json directly, so their entries move from src/cli/commands/run.ts and resume.ts to src/cli/definitions/run.ts and resume.ts with their reason, never dropped. Loss accepted: `shell`'s spawn error now reads through SessionError, and its sentence stays `Failed to launch shell: <message>`.
- Where the definitions live, and the order of removal. One file per family goes under src/cli/definitions/, as in plans 1 to 3. review.ts holds `makeReviewHandoffCommand`, `makeReviewComplianceCommand` and `makeReviewCodeCommand`. publishPr.ts holds `makePublishPrCommand`. sessions.ts holds `makeEnterCommand`, `makeEnterPhaseCommand`, `makeShellCommand` and `makeOpenCommand`. adjustPlan.ts holds `makeAdjustPlanCommand`. run.ts holds `makeRunCommand`, resume.ts `makeResumeCommand`, resetPhase.ts `makeResetPhaseCommand`, and runOutcome.ts the shared outcome schema, renders and notes of run and resume. A factory takes the layers a test swaps (backend, session, editor, GitHub, shell, lock), and its program instance the real adapters. Phases 02, 03 and 05 move a family each, with the bridge holding what has not moved. Each moved registration is deleted from src/cli/program.ts or its register file and replaced by `mountRunnerStub` at its place. Each moved command's cliDocs entry is deleted, and its run function is kept only as a `runThroughOutput` composition for its tests until phase-07. Phases 06 and 07 retire every kept run function as q-kept-run-functions decides. Phase-09 then deletes src/cli/bridge.ts, src/cli/program.ts, src/cli/cliDocs.ts, src/cli/cliCompleters.ts, src/cli/introspect.ts (if nothing else imports it), src/cli/commands/resumeRegister.ts and resetPhaseRegister.ts. What stays of src/cli/commands/ is only what a definition or main.ts imports: runLayers.ts (layers, exitCodeForError, EXIT_CODE_MEANINGS), sessionFailureOutput.ts, stopOutput.ts, reportConfigError.ts, bundledReviewSkill.ts, usage.ts and usageSpec.ts (the --usage catch, readPackageVersion), and any module a definition imports a helper from, such as skills.ts's defaultBundleRoot. Phase-09 lists the final set in its handoff. Loss accepted: the helpers keep their old directory name, `commands`, which no longer holds commands.
- The usage spec after the bridge. scripts/generate-usage-spec.ts writes a two-line comment header (generated from phax's command definitions, regenerate with pnpm gen:usage-spec) and then the port's `usageSpec(phaxProgram)`, with nothing walked from Commander. The program declares what the root needs through phase-08's gains, so that the root keeps the frozen file's declarations: its summary (`about`), its licence, `min_usage_version`, and the usage flags with today's help, `<format>` and default. A program-level usage option writes groups without `subcommand_required`, which ends plan 2's whole-group exception. Every command block is then in the runner's property style. The frozen-file test, tests/integration/usageSpecDeclarations.test.ts, keeps its node-by-node comparison and only these allowlists, each still named: the root's `after_long_help` and `flag --json-schema`; `--json` on every command (MIGRATED_COMMANDS becomes every command); REWORDED_JSON; REWORDED_LONG_HELP; CHOICES_DECLARED; and q-security-bare's DROPPED_SECURITY_FLAGS, plus what q-local-trace-flags decides for `resume` and `reset-phase`. WHOLE_GROUPS and the PARTIAL_GROUPS import go. Loss accepted: the usage spec no longer tells `usage` that a group needs a subcommand, a declaration the frozen file never had; the runner still refuses a group called alone (§5.11).
- The resume case of ac-error-sentence calls `phax resume <run> --yes`, without and with --json. Without --yes resume previews and exits 0 and takes no lock today, and §7 forbids changing that, so only --yes reaches the lock the criterion speaks of. The error line copies §6's normative example key for key: `{"kind":"error","error":"LockConflictError","exit":7,"fields":{"run":<short name>,"pid":<number>},"written":[]}`, with fields exactly `run` and `pid`, the pid a number. Without --json the text is today's `phax resume failed: <the lock's message>` with exit 7. Loss accepted: the acceptance test's call differs from the criterion's literal command by `--yes`.
- Tests. The run and resume family, whose streams, verdicts and progress the spec states (ac-error-sentence's resume case, ac-progress), gets an acceptance pair: phase-04, passed by phase-05. It runs through the runner's memory Io over the definition factories with fake layers and a real lock file held by the test's own pid. Every acceptance test carries its own `.fails` marker on its own `it`, fails on its own assertion against phase-04's stubs, and is changed by the passing phase only by removing that marker. The other families add their --json, error-sentence, written-file and prompting tests in the phase that moves them. Plan 2's tests/unit/cli/runnerCommandContracts.test.ts covers each command's --json-schema, --help and undeclared option as it joins phaxProgram. Phase-07 adds the every-command table: each command of `phax --usage` has a row, or names the family test that proves it with fakes, and the table fails on a command with neither. Existing tests keep their assertions, except where --json is new, a harness is a deleted registration or run function (as q-kept-run-functions decides), or the spec changes an answer. Each such change is named in the phase's handoff and in docs/upgrading.md. Loss accepted: the other families' tests are written with the code, not frozen before it.
- Docs. Each moving phase adds one bullet to docs/upgrading.md's 0.34.0 entry, naming each change a person or a script can observe. That includes new --json answers, refusals of prompting calls under --json, the retired `--skip-oracle` exit, the `[options]` terms in root help, note lines under --json, and what the open questions decide. It never says a moved command is unchanged. Phase-09 adds the bullet for the program itself, and phase-10 writes the page reference/json-output (§11) and links it from the docs site's map (site/pages.ts).

## Arbitrated questions

### q-run-pauses — A run that pauses (rate or usage limit 8, network 14, a handoff turn 5 or 14, gates exhausted or a gate step refused 4, a phase with no changes 9, and on resume a refused close 1, 4, 5, 8 or 14) persists its state, writes everything on stderr today and exits with that code. What do run and resume answer for a pause?

- pause-verdicts — A pause is the run's answer: the output's outcome is `paused` with its reason, phase, resume command, resume-instructions path and resetAt when known, the code a verdict read from it, an empty render and today's stderr lines as notes — abandons: telling an answer from a failure by the code alone: verdict codes 1, 4, 5, 8 and 14 are also the codes of declared errors of the same command (a lock-free failure 1, an agent invocation 5, a network failure outside a pause 14), so a script reads stdout to know which it got
- pause-errors — A pause is a declared error per reason, its fields carrying the phase, resume command, resume-instructions path and resetAt, its text today's stderr lines; only stopped (13) is a verdict — abandons: the run's answer on stdout for its most frequent non-success outcomes: under --json a paused run writes nothing on stdout, and an agent learns the run's state only from an error line's fields

Recommendation: pause-verdicts — A paused run is a resumable state with a known next command, the outcome an agent most needs to read. As a verdict it answers on stdout like review_open and stopped, through the same outcome contract. The empty-render gain phase-01 adds is needed anyway (resume's already-in-review answer writes nothing on stdout today), and the shared codes were never unambiguous: today an exit 5 is already either a failed handoff turn or a failed invocation.

Decision: pause-verdicts — by operator (Rémy Loubradou), 2026-11-05
Why: A paused run is a resumable state with a known next command, the outcome an agent most needs to read. As a verdict it answers on stdout like review_open and stopped, through the same outcome contract. The empty-render gain phase-01 adds is needed anyway (resume's already-in-review answer writes nothing on stdout today), and the shared codes were never unambiguous: today an exit 5 is already either a failed handoff turn or a failed invocation. Advocate: The strongest case for pause-errors: a pause with code 1, 4, 5, 8 or 14 is indistinguishable by its code from a declared failure of the same command, and an error line is the one place a script already looks to learn why a call did not succeed, so keeping every non-success outcome an error leaves the code's meaning unambiguous and stdout reserved for success. Principles: C3, C5. Reversibility: costly. Revised: none. Phase: phase-05.

### q-session-exit — `enter`, `enter-phase`, `shell`, `review-code` (interactive) and `adjust-plan` exit with the code of the process they handed the terminal to, any of 0 to 255, 64 and 70 included. The runner exits only declared codes, and §5.10 forbids a command declaring the `defect` code. How do these commands keep the code?

- pass-through — A port gain, `handsOver`: the command's output names the exit of the process it handed the terminal to, and the runner exits that code after the render, whatever it is; the catalogue marks the entry as handing over; the gain applies only without --json, since each of these commands declares `prompts` and is refused under it — abandons: the rule that every code a command exits with is declared and means one thing: a session that exits 64 or 70 reads to a script as a refused call or a phax defect, as it does today
- verdict-table — Declare every code 1 to 255 except 64 and 70 as a verdict read from the output's exit, and answer a session's 64 or 70 with 1 — abandons: today's code for a session that exits 64 or 70, which §7 and the brief's no-new-code rule keep, and a catalogue entry listing 253 verdicts per command

Recommendation: pass-through — These commands are a door to another process, and their code has always been that process's. Under --json they are refused before anything starts, so only a person at a terminal ever sees the passed-through code. A verdict table would change two codes and bury each catalogue entry under hundreds of verdicts.

Decision: pass-through — by operator (Rémy Loubradou), 2026-11-05
Why: These commands are a door to another process, and their code has always been that process's. Under --json they are refused before anything starts, so only a person at a terminal ever sees the passed-through code. A verdict table would change two codes and bury each catalogue entry under hundreds of verdicts. Advocate: The strongest case for verdict-table: every code a command exits with stays declared and means one thing, so a session exiting 64 or 70 can never be mistaken for a refused call or a phax defect, and the runner needs no new gain for a single family of commands. Principles: C1, E0. Reversibility: costly. Revised: none. Phase: phase-01.

### q-local-trace-flags — `resume` and `reset-phase` each declare their own `--verbose` and `--trace` in phax.usage.kdl today, as `security` did before q-security-bare. On the runner `--verbose` and `--trace` are the program's options, read anywhere in the call. What do the two commands declare?

- drop-local — Drop the four local declarations as q-security-bare did: the program's options cover them anywhere in the call, and the frozen-file test allows dropping exactly these four, named beside DROPPED_SECURITY_FLAGS — abandons: §5.21 for four declarations in phax.usage.kdl, and the brief's rule that the frozen-file allowlists hold only what plans 1 to 3 named
- redeclare — A port gain: a command may redeclare a program option, written in its block and decoded into the program's value, so `resume` and `reset-phase` keep their four declarations — abandons: the runner's rule that a program option belongs to the program alone: one more gain for the published package to take upstream, for two commands, with the catalogue listing the option twice

Recommendation: drop-local — q-security-bare already settled this for `security`. `phax resume x --yes --verbose` still works and the skills keep working, and the four declarations only ever restated the root's global flags. Keeping them would widen the contract with a redundant gain.

Decision: drop-local — by operator (Rémy Loubradou), 2026-11-05
Why: q-security-bare already settled this for `security`. `phax resume x --yes --verbose` still works and the skills keep working, and the four declarations only ever restated the root's global flags. Keeping them would widen the contract with a redundant gain. Advocate: The strongest case for redeclare: the usage spec keeps declaring exactly what each command declared before, four declarations included, so §5.21 holds without an allowlist exception and shell completion for `resume --` and `reset-phase --` still offers both flags. Principles: C1, E0. Reversibility: cheap. Revised: none. Phase: phase-05.

### q-kept-run-functions — Plans 1 to 4 keep a run function per moved command (runLs, runResume, runEnterPhase, …), each a `runThroughOutput` composition over an OutputPort, and about forty test files call them, some asserting a line as `out.warn` rather than `out.error`. When the bridge goes, where do those tests run?

- runner-harness — Move every such test onto the runner: tests/helpers/runnerCall.ts runs the command's definition over the memory Io, and the test asserts stdout, stderr and the code; an assertion that told a warning from an error asserts the same text on stderr, each named in the handoff; the run functions and runThroughOutput are deleted — abandons: assertions unchanged for every test that told `out.warn` from `out.error`: both are stderr on the runner, so that split is no longer asserted, and phases 06 and 07 rewrite the harness of about forty files
- output-harness — Move runThroughOutput and the run functions into tests/helpers/ unchanged, so the tests change only their import path and src/ holds none of them — abandons: the tests' proof of the real streams: they keep passing through a second, test-only runner that reimplements verdicts, documents, checks and notes over an OutputPort, which can drift from the runner phax actually runs

Recommendation: runner-harness — The runner is what a person and an agent meet. A test that passes through a reimplementation of it proves nothing about the streams §5.4 and the brief's first lesson are about, and the warn/error split it would keep is not observable outside the process. The rewrite is mechanical, split over two Sonnet phases, and each changed assertion is named.

Decision: runner-harness — by operator (Rémy Loubradou), 2026-11-05
Why: The runner is what a person and an agent meet. A test that passes through a reimplementation of it proves nothing about the streams §5.4 and the brief's first lesson are about, and the warn/error split it would keep is not observable outside the process. The rewrite is mechanical, split over two Sonnet phases, and each changed assertion is named. Advocate: The strongest case for output-harness: about forty test files change only an import path and keep every assertion, the warn/error split included, so the move is cheap to review and no assertion is weakened, while src/ still ends with no run functions. Principles: C4, C1. Reversibility: cheap. Revised: none. Phase: phase-06.

## Decision log

- 2026-11-05 q-run-pauses decided pause-verdicts — operator (Rémy Loubradou)
- 2026-11-05 q-session-exit decided pass-through — operator (Rémy Loubradou)
- 2026-11-05 q-local-trace-flags decided drop-local — operator (Rémy Loubradou)
- 2026-11-05 q-kept-run-functions decided runner-harness — operator (Rémy Loubradou)

---

## phase-01 — Runner gains for the run and session commands: optional option values, retired options, empty renders and a handed-over exit {#phase-01-runner-gains}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium
**Assignment reason:** The phase designs up to four contract members the port does not hold, and where the runner applies each, across the contract, the Commander adapter, the bridge and the conformance suite.

The port can carry the run and session commands without changing what they declare or print. An option such as `--hold [selection]` takes an optional value. A command refuses a retired option with its own sentence. A render that answers nothing writes no line. A command that hands over the terminal exits with its process's code, as q-session-exit decides. Today's root help is pinned in a fixture that every later phase keeps. Each gain is a conformance case, and no command moves.

### Detailed instructions

- Read this plan's Technical arbitrations (output contracts, progress, retired option, `--hold`, tests) and the open question q-session-exit as decided in its Decision block. Then read src/cli/commandLibrary/contract/{command,define,shapes,usage,catalogue,messages,index}.ts, src/cli/commandLibrary/commander/{commanderAdapter,run,undeclared,shape}.ts, contract/conformance/cases.ts and suite.ts, tests/unit/commandLibrary/conformance.test.ts (its CONTRACT_ONLY list), tests/unit/commandLibrary/commander/lifecycleGains.test.ts (plan 3's gains, the pattern to follow), src/cli/bridge.ts (mountStub, runThroughOutput) and tests/unit/cli/bridge.test.ts. Check every Effect API against the installed `effect` in node_modules.
- Gain, an option with an optional value: export an annotation id from the contract, as CompleterAnnotationId is, marking a flag field whose schema is a union of `true` and a string. `flagShapes` gives `valueOptional: true`. The Commander adapter declares `--<option> [<valueName>]` and decodes a bare flag to `true` and a given value to its string. Help shows `--hold [selection]`, the catalogue lists the union, and `usageSpec` writes `flag "--hold [selection]"` with its help. Conformance case `flags.optional-value`: bare, spaced value, attached value (`--hold=phase-02`), and absent.
- Gain, a command's retired options: `CommandDef.retiredOptions?: Readonly<Record<string, string>>`, an option name with the sentence naming its replacement. The runner reads the call's words before decoding. A retired option is refused with its sentence then the refusal hint without --json, and under --json with one refused line (`source` "flags", `path` [option], `expected` "no such option", `text` the sentence), exiting the program's `refused` code. It is never in help, the catalogue, a suggestion or the usage spec. A retired option equal to a declared option of the same command stops the program as misdeclared (§5.10). Conformance case `flags.retired-option`. The bridge's mountStub declares a retired option hidden (Commander's hideHelp), so the stub does not list it.
- Gain, an empty render writes nothing: when `render` answers the empty string, the runner writes no stdout line without --json, and the notes are still written on stderr. Under --json the encoded output is written as always. Conformance case `output.empty-render`. runThroughOutput in src/cli/bridge.ts logs nothing for an empty render too.
- If q-session-exit decided pass-through, add the gain `handsOver`. `CommandDef.handsOver?: (value) => number` names the exit of the process the command handed the terminal to. Without --json the runner writes the render and notes, then exits that code, whatever it is (64 and 70 included). A command declaring `handsOver` and no `prompts` stops the program as misdeclared, and the catalogue entry carries `handsOver: true`. Add conformance case `exits.handed-over` (codes 0, 1, 64 and 70), and have runThroughOutput answer the same code. If q-session-exit decided verdict-table, add no gain, and say so in the handoff.
- The bridge's mountStub declares an optional-value flag as `--<option> [<valueName>]`.
- Pin today's root help. Write tests/fixtures/help/phax-root-help.txt with the exact stdout of `tsx src/cli/main.ts --help`, run in a temporary directory (not a phase worktree) with COLUMNS=80, before anything in this phase changes it. Write tests/integration/rootHelp.test.ts, spawning the CLI the same way, to assert stdout equals the fixture byte for byte and exit 0. It also asserts that `--version` and `-V` each print PHAX_RELEASE (imported from src/schemas/release.ts, never a literal) plus a newline and exit 0. Later phases change the fixture only where this plan's Root help arbitration says.
- Write tests/unit/commandLibrary/commander/runSessionGains.test.ts. It exercises each gain through `runner.run` over the memory Io of tests/unit/commandLibrary/commander/support/memoryIo.ts, beyond the conformance cases. `--hold` bare and `--hold phase-02` decode as `true` and `"phase-02"`. A retired option is refused with its sentence and 64 in both modes and is absent from --help. An empty render leaves stdout empty while a note reaches stderr. A handed-over exit of 70 exits 70 without --json, and the command is refused under --json because it prompts (if pass-through was decided).
- Add each new case to CONTRACT_ONLY in tests/unit/commandLibrary/conformance.test.ts only if it holds without a runner. Run `pnpm gen:usage-spec`; phax.usage.kdl must not change in this phase.

### Planned files to create

- `tests/unit/commandLibrary/commander/runSessionGains.test.ts`
- `tests/integration/rootHelp.test.ts`
- `tests/fixtures/help/phax-root-help.txt`

### Planned files to edit

- `src/cli/commandLibrary/contract/command.ts`
- `src/cli/commandLibrary/contract/define.ts`
- `src/cli/commandLibrary/contract/shapes.ts`
- `src/cli/commandLibrary/contract/usage.ts`
- `src/cli/commandLibrary/contract/conformance/cases.ts`
- `src/cli/commandLibrary/commander/commanderAdapter.ts`
- `src/cli/commandLibrary/commander/run.ts`
- `src/cli/bridge.ts`
- `tests/unit/cli/bridge.test.ts`

### Optional files that may be edited

- `src/cli/commandLibrary/contract/index.ts`
- `src/cli/commandLibrary/contract/catalogue.ts`
- `src/cli/commandLibrary/contract/messages.ts`
- `src/cli/commandLibrary/contract/conformance/suite.ts`
- `src/cli/commandLibrary/commander/undeclared.ts`
- `src/cli/commandLibrary/commander/shape.ts`
- `src/cli/commandLibrary/commander/suggest.ts`
- `tests/unit/commandLibrary/conformance.test.ts`
- `tests/unit/commandLibrary/contract/exports.test.ts`
- `tests/unit/commandLibrary/commander/exports.test.ts`
- `scripts/generate-usage-spec.ts`
- `phax.usage.kdl`
- `knip.json`

### Boundary contracts

Producer: the port's contract (src/cli/commandLibrary/contract/index.ts) and runner. Consumers: phases 02, 03 and 05's definitions. Contract: the optional-value annotation, decoding to `true | string`; `CommandDef.retiredOptions` as option name to sentence; an empty render writing nothing; and, if q-session-exit decided pass-through, `CommandDef.handsOver(value) => number`. Producer: src/cli/bridge.ts. Consumers: src/cli/program.ts and the kept run functions. Contract: stubs declare `--x [value]` and hide retired options, and runThroughOutput honours an empty render and a handed-over exit. Producer: tests/fixtures/help/phax-root-help.txt. Consumers: every later phase and phase-09's runner-written root help. Contract: today's root help, byte for byte.

### Test strategy

- an option with an optional value decodes to true when bare and to its string when given one, and shows as --hold [selection] in help and the usage spec — small · table · the flags.optional-value case's decoded input, help text and KDL line for bare, spaced, attached and absent · in-phase · ac-usage-parity
- a retired option is refused with its own sentence and 64 in both modes, and never appears in help, the catalogue or the usage spec — small · example · the flags.retired-option case's stderr, refused line, exit code, help and KDL · in-phase · ac-unknown-option
- a retired option equal to a declared option stops the program as misdeclared, naming the command — small · example · the defect exit and the offending command named on stderr · in-phase · ac-misdeclared
- a render answering the empty text writes no stdout line, while its notes still reach stderr — small · example · the output.empty-render case's stdout and stderr · in-phase · ac-text-unchanged
- a command handing over the terminal exits the code its process answered, 64 and 70 included, and is refused under --json — small · table · the exits.handed-over case's exit for each code and the refused line · in-phase · ac-no-person
- the root help printed today is pinned, and --version and -V print the release — medium · smoke · the captured fixture and PHAX_RELEASE · in-phase · ac-help
- phax.usage.kdl is unchanged by this phase — small · metamorphic · the frozen pre-change file compared node by node · in-phase · ac-usage-parity

### Implementation order

1. root-help fixture and rootHelp.test.ts, captured first
2. command.ts and define.ts: optional-value annotation, retiredOptions, handsOver
3. shapes.ts, usage.ts and catalogue: optional value, retired options hidden
4. commanderAdapter.ts and run.ts: decoding, refusal, empty render, handed-over exit
5. conformance cases and runSessionGains.test.ts
6. bridge.ts stubs and runThroughOutput, bridge tests

### Excluded scope

- Moving any command (phases 02, 03 and 05).
- The program-level gains: guard, root help, version alias, usage header, plain groups (phase-08).
- Any change to phax.usage.kdl's content.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

Give each new contract member's exact shape and export: the optional-value annotation id, `retiredOptions`, the empty-render rule and, if decided, `handsOver`. Say where the runner applies each among locate, guard, decode, prompts, check and run. List the conformance case ids added and whether each is in CONTRACT_ONLY. Give the root-help fixture's capture command and environment (COLUMNS, cwd), and say what q-session-exit decided and how it was carried out. Explain any deviation from the planned file lists.

### Commit subject

`feat(cli): optional option values, retired options, empty renders and handed-over exits on the runner`

### Commit body

Give the ported command library what the run and session commands need to keep
their declarations and streams: an option whose value is optional (--hold [selection]),
a command's retired options refused with their own sentence, a render that answers
nothing writing no line, and the exit of a process a command hands the terminal to.
Each is a conformance case.

Pin today's root help in a fixture, with --version and -V, for the phases that move
the program onto the runner.

---

## phase-02 — The review and publication commands on the runner {#phase-02-review-and-publication}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

`phax review-handoff`, `publish-pr`, `review-compliance` and `review-code` are command definitions on the runner. Under --json each answers one object, the review commands listing the files they wrote on this call, and `review-code` without --headless is refused because it hands the terminal to a session. Without --json each prints today's text on today's streams with today's codes.

### Detailed instructions

- Read this plan's Technical arbitrations (output contracts, prompting commands, written files, definitions, tests), the decided q-session-exit and phase-01's handoff. Then read src/cli/commands/{reviewHandoff,publishPr,reviewCompliance,reviewCode,sessionFailureOutput}.ts, src/cli/cliDocs.ts (the `publish-pr`, `review-compliance` and `review-code` entries; `review-handoff` has none), src/app/{reviewHandoff,reviewCompliance,reviewCode,reviewEntry,publishRun}.ts, and src/cli/definitions/{program,shared,archive,artifactDecide}.ts. archive's `Target:` text form and decide's OutputPort over `say` and `progress` are the patterns to follow. Read the tests of these commands too: tests/unit/cli/{publishPr,reviewCompliance,reviewCode}.test.ts and tests/integration/{reviewHandoffCommand,reviewCodeCommand}.test.ts.
- If generateReviewHandoff, reviewComplianceAndRecord or reviewCodeAndRecord does not return the paths it wrote on this call, add a required field naming them, absolute, the files actually written (never a planned set). Change no write.
- src/cli/definitions/review.ts. `makeReviewHandoffCommand(layers)` takes args `<short-name>` (ShortNameArg from shared.ts) and flag `allowPartial` with today's help. It answers `{ qualifiedName, crossProject, reviewHandoff, written }`, and its render writes the optional `Target:` line, then `Review handoff regenerated for run "<q>". See <runPath>/review-handoff.md`. Its declared errors exit 1 with today's sentences: config, resolve, not review_open, the missing artifacts naming --allow-partial, and the generation failure.
- `makeReviewComplianceCommand(layers)` takes the backend, GitHub and Git layers. It answers `{ qualifiedName, crossProject, verdict, review, notice, warnings, written }`, its render writes `Target:`, `Verdict:`, `Compliance review:` and the notice, and its notes write the warnings. Its errors keep today's sentences and codes: disabled (1), config (1), resolve (1), not review_open (1), routing (1), a session failure (renderSessionFailure's lines with the retry, then the kept-review line; 14 for a network failure, else 1), and a review failure (1). The use case's `output` is an OutputPort whose `log` is `say` and whose `warn` is `progress`.
- `makeReviewCodeCommand(layers)` takes the backend, session, GitHub and Git layers, with flags `newSession`, `model` (identifier `model`), `effort` (a string, identifier `effort`; an invalid one is refused by run with today's sentence and 1) and `headless`, each with today's help. `prompts`: `--headless` absent; `unprompted` names --headless. With --headless it answers the headless object, with a render of today's `Target:`, `Code review:`, `Findings:`, fix-hint and notice lines, the warnings as notes, and errors as today. Without --headless, `say` writes `Starting code review session in <cwd>` or `Resuming code review session in <cwd>` before the session. The session runs through the Session layer, the answer is `{ qualifiedName, crossProject, executable, cwd, exit }`, and the render is empty. The exit follows q-session-exit: `handsOver` for pass-through, or the verdict table. A launch failure exits 1 with `Failed to launch <executable>: <message>`.
- src/cli/definitions/publishPr.ts: `makePublishPrCommand(layers)` (Git and GitHub layers) takes args `<short-name>`. It answers `{ qualifiedName, crossProject, pullRequest }`, with a render of `Target:`, then `Pull request: <url>` or `Run "<q>" published (branch pushed, no PR created).`. Its errors exit 1: config, resolve, not review_open, the unexpected publication error, and `Publication failed: … To retry, run: phax publish-pr <q>`. `--verbose` is read from the run context's program options.
- Move each command's help, long help and examples word for word from cliDocs into its definition, and delete those cliDocs entries. src/cli/definitions/program.ts lists the four where Commander lists them today: review-handoff, publish-pr, review-compliance and review-code, after `cost` and `run`'s place. Keep `run`'s position free for phase-05, so that help keeps today's order. In src/cli/program.ts, replace each registration with `mountRunnerStub(program, phaxProgram, [<name>])` at its place. Keep runReviewHandoff, runPublishPr, runReviewCompliance and runReviewCode with their signatures, only as `runThroughOutput` compositions over the factories for their existing tests, which pass with their assertions unchanged.
- Write tests/integration/reviewCommandsJson.test.ts through tests/helpers/runnerCall.ts, over the factories with the fake backend, makeFakeGitHub(), the fake Session and a review_open run fixture built as the existing tests build theirs, in a temporary PHAX home and an isolated git repository with its own identity. It checks five things. `review-handoff <run> --json` answers one indented JSON value whose `written` lists review-handoff.md and the reconciliation with absolute paths and `sha256:` digests equal to the files' bytes. `review-compliance <run> --json` and `review-code <run> --headless --json` answer one value each, with every stderr line a message line. `publish-pr <run> --json` answers `pullRequest` as the fake's URL. A run not in review_open exits 1 with today's sentence without --json, and one error line with `"exit":1` with it. `review-code <run> --json` without --headless writes one refused line, exits 64 and makes no Session call.
- Update tests/fixtures/help/phax-root-help.txt only where publish-pr and review-compliance gain `[options]` in their terms (they declared no option before), and name both lines in the handoff. Run `pnpm gen:usage-spec`. Extend tests/integration/usageSpecDeclarations.test.ts so that MIGRATED_COMMANDS gains the four commands in the program's order, and nothing else is allowed. Run `pnpm docs:cli`.
- docs/upgrading.md, 0.34.0 entry, one bullet: review-handoff, publish-pr, review-compliance and review-code answer through the runner. Under --json each answers an object, and the review commands list the files they wrote. `review-code --json` without --headless is refused with 64 before any session. Warnings are note lines under --json. In `phax --help`, publish-pr and review-compliance show `[options]`. Do not edit earlier entries.

### Planned files to create

- `src/cli/definitions/review.ts`
- `src/cli/definitions/publishPr.ts`
- `tests/integration/reviewCommandsJson.test.ts`

### Planned files to edit

- `src/cli/definitions/program.ts`
- `src/cli/program.ts`
- `src/cli/commands/reviewHandoff.ts`
- `src/cli/commands/publishPr.ts`
- `src/cli/commands/reviewCompliance.ts`
- `src/cli/commands/reviewCode.ts`
- `src/cli/cliDocs.ts`
- `phax.usage.kdl`
- `README.md`
- `docs/upgrading.md`
- `tests/integration/usageSpecDeclarations.test.ts`
- `tests/fixtures/help/phax-root-help.txt`

### Optional files that may be edited

- `src/app/reviewHandoff.ts`
- `src/app/reviewCompliance.ts`
- `src/app/reviewCode.ts`
- `src/app/reviewEntry.ts`
- `src/app/publishRun.ts`
- `src/cli/definitions/shared.ts`
- `src/cli/bridge.ts`
- `scripts/generate-usage-spec.ts`
- `tests/unit/cli/publishPr.test.ts`
- `tests/unit/cli/reviewCompliance.test.ts`
- `tests/unit/cli/reviewCode.test.ts`
- `tests/integration/reviewHandoffCommand.test.ts`
- `tests/integration/reviewCodeCommand.test.ts`
- `tests/integration/cliProgram.test.ts`
- `tests/integration/docsCliDrift.test.ts`
- `tests/unit/cli/runnerCommandContracts.test.ts`
- `docs/cli/reference.md`
- `knip.json`

### Boundary contracts

Producers: generateReviewHandoff, reviewComplianceAndRecord and reviewCodeAndRecord (src/app/). Consumers: the review definitions. Contract: each result names the absolute paths it wrote on this call. Producers: `phax review-handoff|publish-pr|review-compliance|review-code`. Consumers: scripts, agents and the skills. Contract: one object per call under --json, written files as written-file records, message lines alone on stderr, `review-code` refused under --json without --headless; today's text and codes without it.

### Test strategy

- review-handoff, publish-pr, review-compliance and review-code --headless each answer one indented JSON value under --json with only message lines on stderr — medium · table · JSON.parse of stdout and of each stderr line against the message shapes · in-phase · ac-json-every-command
- review-handoff lists review-handoff.md and the reconciliation it wrote on this call as written-file records — medium · example · the files under the run folder and the sha256 of their bytes · in-phase · ac-written
- a run not in review_open keeps today's sentence and exit 1, and is one error line under --json — medium · example · today's refusal sentence and exit code · in-phase · ac-error-sentence
- review-code --json without --headless is refused with 64 before any session starts, naming --headless — small · example · the refused line, the exit code and the fake Session's empty call list · in-phase · ac-no-person
- the existing tests of the four commands pass with their assertions unchanged — medium · example · the existing tests' expected text, streams and codes · in-phase · ac-text-unchanged
- phax.usage.kdl differs from the frozen file only by --json on the four moved commands — small · metamorphic · the frozen pre-change file compared node by node · in-phase · ac-usage-parity
- no review or publication definition imports commander — small · example · the architecture guard's import scan · in-phase · ac-no-parser

### Implementation order

1. use cases' written paths, where missing
2. review.ts and publishPr.ts
3. program.ts entries, program.ts stubs, cliDocs deletions, kept run functions
4. reviewCommandsJson.test.ts
5. root-help fixture lines, usage spec, docs:cli, upgrading bullet

### Excluded scope

- The commands that hand over the terminal (phase-03) and run, resume and reset-phase (phase-05).
- Changing a review's prompt, verdict, record or the publication logic.
- Retiring the kept run functions (phases 06 and 07).

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

Give each definition's input, output, render, notes, `prompts` and `unprompted`, errors with codes, and written files, plus the field added to each use case result. List the stubs mounted in src/cli/program.ts, the run functions kept and the tests that call them, the root-help fixture lines changed, and the usage allowlist entries added. Explain any deviation from the planned file lists.

### Commit subject

`feat(cli): the review and publication commands answer through the command runner`

### Commit body

Write review-handoff, publish-pr, review-compliance and review-code as command
definitions. Under --json each answers one object, and the review commands list the
files they wrote on this call as written-file records. review-code refuses --json
without --headless, because it hands the terminal to a session.

Without --json each command prints today's text and error sentences with today's codes.

---

## phase-03 — The commands that hand over the terminal on the runner {#phase-03-session-handovers}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

`phax enter`, `enter-phase`, `shell`, `open` and `adjust-plan` are command definitions on the runner. Each declares that it prompts, so under --json it is refused with 64 before any session, shell or editor starts, its remedy naming the command that answers instead. Without --json each writes today's lines before handing over and exits as q-session-exit decides. `shell` goes through the Session port and `adjust-plan` reads its plan through the FileSystem port, so both are proved through fakes.

### Detailed instructions

- Read this plan's Technical arbitrations (output contracts, prompting commands, a handed-over session in tests, definitions), the decided q-session-exit, and phase-01's and phase-02's handoffs (phase-02's `review-code` session path is the pattern). Then read src/cli/commands/{enter,enterPhase,shell,open,adjustPlan}.ts, src/app/{enterPhase,adjustPlan,agentBinding}.ts, src/ports/{session,editor}.ts, src/infra/fakes/{session,editor}.ts, src/cli/cliDocs.ts (enter, enter-phase, shell, open, adjust-plan), and the tests: tests/unit/cli/{enterPhase,adjustPlanDefaults}.test.ts, and tests/integration/{enter,enterPhase,enterPhaseStop,adjustPlanCommand,stoppedRunCommands,heldStopCommands}.test.ts.
- src/cli/definitions/sessions.ts. `makeEnterCommand(layers)` (Session) takes args `<short-name>`. `say` writes the optional `Target:` line, then `Entering <executable> session in <cwd>` before the session. It answers `{ qualifiedName, crossProject, executable, cwd, exit }` with an empty render. Errors exit 1 with today's sentences: resolve, no agent binding, the unsupported invocation, `Failed to launch …`. `makeEnterPhaseCommand(layers)` (Session, backend, lock) takes args `<short-name> <phase-id>` and flag `newSession` with today's help. It writes the announce through `say`, and its notices through `say` or `progress` by kind, as today. Errors keep today's codes: exitCodeForError for the use case's failures, 1 for a refusal, an unknown phase or a launch failure.
- `makeShellCommand(layers)` (Session) hands `{ executable: process.env.SHELL ?? "bash", args: [], cwd: worktreePath, env: {} }` to the Session port after saying `Opening shell in <path>`. Missing worktree: `No worktree path found for run "<q>".` and 1. Launch failure: `Failed to launch shell: <message>` and 1. `makeOpenCommand(layers)` (Editor) answers `{ qualifiedName, crossProject, opened }` with a render of `Target:` and `Opened <path>`, exits 0, and keeps today's missing-worktree and `Failed to open worktree: …` sentences with 1.
- src/cli/definitions/adjustPlan.ts: `makeAdjustPlanCommand(layers)` (Session, backend) takes args `<plan>` and flags `landed` (required, identifier `run`), `newSession`, `model` (identifier `model`) and `effort` (a string, identifier `effort`; refused by run with today's sentence and 1), each with today's help. It reads the plan through the FileSystem port, the path resolved against the invocation directory, keeping today's `Cannot read plan.md at "<arg>": file not found or not readable.`. `say` writes `Starting|Resuming plan adjustment session in <cwd>` before the session. Keep DEFAULT_MODEL and DEFAULT_EFFORT exported where tests/unit/cli/adjustPlanDefaults.test.ts imports them, moving the constants into the definition and re-exporting them from src/cli/commands/adjustPlan.ts, or moving the test's import with its assertions unchanged.
- Every one of the five declares `prompts: () => true`. Its `unprompted` is `phax session-info <run> --json names the session` for enter and enter-phase, `phax path <run> --json names the worktree` for shell and open, and for adjust-plan that it runs from a terminal without --json. Exits follow q-session-exit: `handsOver` reading the output's `exit` for pass-through, or the verdict table. `open` exits 0 and declares neither.
- Move help, long help and examples word for word from cliDocs and delete those five entries. src/cli/definitions/program.ts lists enter and enter-phase after `unlock`, shell after `session-info`, open after `path`, and adjust-plan after review-code, matching today's root help. In src/cli/program.ts, replace each registration with `mountRunnerStub` at its place. Keep runEnter, runEnterPhase, runShell, runOpen and runAdjustPlan only as `runThroughOutput` compositions over the factories with the real layers, for their existing tests, which pass with their assertions unchanged. Remove the CLI_DIRECT_IO_ALLOWLIST entries of src/cli/commands/shell.ts and adjustPlan.ts in tests/unit/architecturalGuards.test.ts, since neither file imports a Node I/O module now, and say so in the handoff.
- Write tests/integration/sessionHandoversJson.test.ts through tests/helpers/runnerCall.ts, over the factories with the fake Session (answering a chosen code) and the fake Editor, a run fixture with an agent binding built as tests/integration/enter.test.ts builds it, a temporary PHAX home, and an isolated git repository with its own identity. It checks five things. `enter <run> --json`, `enter-phase <run> phase-01 --json`, `shell <run> --json`, `open <run> --json` and `adjust-plan <plan> --landed <run> --json` each write one refused line, exit 64, and record no Session or Editor call (ac-no-person). Without --json, enter writes `Entering … session in …` on stdout and exits the fake's code. shell hands the fake `$SHELL` in the worktree with an empty env. open writes `Opened <path>` and exits 0. A run with no worktree keeps today's sentence and 1 for shell and open.
- Update tests/fixtures/help/phax-root-help.txt only where enter, shell and open gain `[options]` in their terms, and name each line in the handoff. Run `pnpm gen:usage-spec`. Extend tests/integration/usageSpecDeclarations.test.ts so that MIGRATED_COMMANDS gains the five commands in the program's order. Run `pnpm docs:cli`.
- docs/upgrading.md, 0.34.0 entry, one bullet: enter, enter-phase, shell, open and adjust-plan answer through the runner. Under --json each is refused with 64 before any session, shell or editor starts, its message naming `phax session-info --json` or `phax path --json`. Without --json each prints what it printed and exits as before. In `phax --help`, enter, shell and open show `[options]`.

### Planned files to create

- `src/cli/definitions/sessions.ts`
- `src/cli/definitions/adjustPlan.ts`
- `tests/integration/sessionHandoversJson.test.ts`

### Planned files to edit

- `src/cli/definitions/program.ts`
- `src/cli/program.ts`
- `src/cli/commands/enter.ts`
- `src/cli/commands/enterPhase.ts`
- `src/cli/commands/shell.ts`
- `src/cli/commands/open.ts`
- `src/cli/commands/adjustPlan.ts`
- `src/cli/cliDocs.ts`
- `phax.usage.kdl`
- `README.md`
- `docs/upgrading.md`
- `tests/integration/usageSpecDeclarations.test.ts`
- `tests/fixtures/help/phax-root-help.txt`
- `tests/unit/architecturalGuards.test.ts`

### Optional files that may be edited

- `src/app/enterPhase.ts`
- `src/app/adjustPlan.ts`
- `src/infra/fakes/session.ts`
- `src/infra/fakes/editor.ts`
- `src/cli/definitions/shared.ts`
- `src/cli/bridge.ts`
- `scripts/generate-usage-spec.ts`
- `tests/unit/cli/enterPhase.test.ts`
- `tests/unit/cli/adjustPlanDefaults.test.ts`
- `tests/integration/enter.test.ts`
- `tests/integration/enterPhase.test.ts`
- `tests/integration/adjustPlanCommand.test.ts`
- `tests/integration/cliProgram.test.ts`
- `tests/integration/docsCliDrift.test.ts`
- `tests/unit/cli/runnerCommandContracts.test.ts`
- `docs/cli/reference.md`
- `knip.json`

### Boundary contracts

Producer: the Session port (src/ports/session.ts) and its Node adapter. Consumers: the shell, enter, enter-phase and adjust-plan definitions. Contract: `resume({ executable, args, cwd, env })` answers the process's exit and spawns with inherited stdio, with an empty env inheriting the person's environment. Producer: `phax enter|enter-phase|shell|open|adjust-plan`. Consumers: a person at a terminal, and agents that must be refused. Contract: refused with 64 under --json before anything starts, the remedy naming the command that answers; today's lines and codes without it.

### Test strategy

- enter, enter-phase, shell, open and adjust-plan under --json are refused with 64 before any session, shell or editor starts — small · table · the refused line, the exit code and the fake Session's and Editor's empty call lists · in-phase · ac-no-person
- without --json each writes today's lines on stdout before handing over and exits as q-session-exit decides — small · table · today's announce lines and the fake Session's chosen exit code · in-phase · ac-text-unchanged
- shell hands $SHELL to the Session port in the run's worktree with an empty env — small · example · the fake Session's recorded invocation · in-phase
- a run with no worktree, an unknown phase or a launch failure keeps today's sentence and exit 1 — small · example · today's sentences and exit code · in-phase · ac-error-sentence
- the existing tests of the five commands pass with their assertions unchanged — medium · example · the existing tests' expected text, streams and codes · in-phase · ac-text-unchanged
- phax.usage.kdl differs from the frozen file only by --json on the five moved commands — small · metamorphic · the frozen pre-change file compared node by node · in-phase · ac-usage-parity

### Implementation order

1. sessions.ts: enter, enter-phase, shell over the Session port, open
2. adjustPlan.ts with its plan read through the FileSystem port
3. program.ts entries, program.ts stubs, cliDocs deletions, kept run functions, allowlist entries removed
4. sessionHandoversJson.test.ts
5. root-help fixture lines, usage spec, docs:cli, upgrading bullet

### Excluded scope

- run, resume and reset-phase (phase-05).
- Changing what a session, shell or editor is started with, or enter-phase's new-session turn.
- Retiring the kept run functions (phases 06 and 07).

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

Give each definition's input, output, `say` lines, `prompts`, `unprompted`, errors with codes, and how its exit follows q-session-exit. Confirm that shell goes through the Session port and adjust-plan through the FileSystem port, and give the allowlist entries removed. List the stubs mounted, the run functions kept and the tests that call them, the root-help fixture lines changed, and the usage allowlist entries added. Explain any deviation from the planned file lists.

### Commit subject

`feat(cli): the commands that hand over the terminal answer through the command runner`

### Commit body

Write enter, enter-phase, shell, open and adjust-plan as command definitions. Each
hands the terminal to a session, a shell or an editor, so under --json each is refused
with 64 before anything starts, naming the command that answers instead. shell now
goes through the Session port and adjust-plan reads its plan through the FileSystem
port.

Without --json each writes today's lines before handing over, with today's codes.

---

## phase-04 — Acceptance tests of run and resume on the runner {#phase-04-run-resume-acceptance}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium
**Acceptance phase:** passed by phase-05
**Acceptance test files:** `tests/integration/runCommandsAnswers.test.ts`, `tests/fixtures/run/runCommandsRepo.ts`

What `phax run` and `phax resume` answer on the runner is written as frozen acceptance tests: resume's lock conflict with today's sentence and code and §6's error line under --json, `run --dry-run --json` streaming its progress as note lines before its answer, resume's preview answered as one JSON value without a lock, and run's dry-run text unchanged. Each fails today on its own assertion against stub definitions and is passed by phase-05.

### Detailed instructions

- Read this plan's Technical arbitrations (output contracts, progress, the resume case of ac-error-sentence, tests) and the decided q-run-pauses. Then read src/cli/commands/{run,resume,stopOutput,sessionFailureOutput}.ts, src/app/{loadOrExtractPlan,lock,resume,dryRun}.ts, src/infra/lock.ts, tests/helpers/runnerCall.ts, tests/fixtures/artifact/stdinDocumentsRepo.ts (plan 3's acceptance fixture, the pattern), and the run-folder builders of tests/integration/resume.test.ts and tests/unit/cli/resume.test.ts.
- Write the two stubs the tests load against, each failing recognizably. src/cli/definitions/run.ts exports `interface RunDeps { backendLayer?, githubLayer?, shellLayer? }` and `makeRunCommand(deps)`. src/cli/definitions/resume.ts exports `interface ResumeDeps { backendLayer?, githubLayer?, shellLayer? }` and `makeResumeCommand(deps)`. Each is a `defineCommand` named `run` or `resume` with today's summary, `input: {}`, `exits: {}`, and a run that dies with `not implemented: <name> on the runner (phase-05)`. Neither is added to `phaxProgram`.
- Write tests/fixtures/run/runCommandsRepo.ts. It is a builder that makes, in temporary directories, a git repository (isolateGit) with its own user.name and user.email, phax.json with one gate profile, a temporary PHAX home, and a loose plan.md at the repository root with `status: Approved` frontmatter. The plan is shaped so that extraction takes the deterministic path with no model call. Read loadOrExtractPlan to confirm, and seed the extraction cache the way it reads it if the deterministic path does not fill it. The builder also makes a resumable run of that plan under the state root, built as the existing resume tests build theirs: registry entry, run folder, run-status.json in a resumable state, phax-plan.json and plan.md. Its lock file is held by the test process's own pid, in src/infra/lock.ts's format. The builder returns the paths, the run's short name, the pid, and `program(commands)`: a runner program (`defineProgram`: name phax, exits refused 64 and defect 70, phaxProgram's options and refusal hint) holding the given commands. It reads nothing outside its temporary directories.
- Write tests/integration/runCommandsAnswers.test.ts. Every test is its own `it.fails(...)`, runs `runner.run(program(...), io)` over a memory Io with process.cwd spied to the fixture repository and the factories given fake layers, and fails today on its own assertion: the stubs declare no argument or option, so today every call is refused as undeclared or dies as a defect. The tests:
- `resume <run> --yes` without --json writes on stderr exactly today's sentence, `phax resume failed: ` followed by the lock's message for the fixture's run and pid, written literally in the test with the pid and paths substituted, as today's runResume prints it for this fixture. It exits 7. The same call with --json writes, among its stderr lines, exactly one error line equal key for key, types included, to `{"kind":"error","error":"LockConflictError","exit":7,"fields":{"run":<short name>,"pid":<pid as a number>},"written":[]}`. It exits 7, and every other stderr line is a note line (ac-error-sentence).
- `run --plan plan.md --dry-run` once to fill the cache, then `run --plan plan.md --dry-run --json`. The second call writes on stderr a note line `{"kind":"note","text":"using cached extraction"}`, written to the Io before the stdout write. Stdout holds exactly one JSON value, two-space indented with one trailing newline, whose `outcome.kind` is `dry-run`. It exits 0 (ac-progress).
- `resume <run> --json` without --yes exits 0. Stdout holds one indented JSON value whose `outcome.kind` is `preview` and whose `outcome.nextPhaseId` names the fixture's next phase. Every stderr line is a message line, and the lock file is untouched: same pid, same bytes (ac-json-every-command).
- `run --plan plan.md --dry-run` without --json writes on stdout today's dry-run report for the fixture, written literally in the test as today's runRun prints it, with paths substituted, and exits 0 (ac-text-unchanged).
- Change no other source file. The tests judge only what the spec and this plan's arbitrations state, through the factories and the runner, never a definition's internals.

### Planned files to create

- `tests/integration/runCommandsAnswers.test.ts`
- `tests/fixtures/run/runCommandsRepo.ts`
- `src/cli/definitions/run.ts`
- `src/cli/definitions/resume.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- `knip.json`

### Boundary contracts

Producer: phase-05's `makeRunCommand(deps)` and `makeResumeCommand(deps)` (src/cli/definitions/run.ts and resume.ts). Consumer: these acceptance tests, through the runner over a memory Io. Contract: the factories take the fake layers RunDeps and ResumeDeps name. Resume's lock conflict is today's sentence with exit 7, and §6's error line under --json. Run's progress lines are note lines written before the answer. Resume's preview is an answer with exit 0 that takes no lock, and run's dry-run text is today's.

### Test strategy

- resume --yes on a run locked by a live process writes today's sentence and exits 7, and under --json one LockConflictError error line with fields run and pid, exit 7 — medium · example · today's sentence for the fixture and §6's error line key for key · acceptance · ac-error-sentence
- run --dry-run --json writes its progress as note lines on stderr before stdout's one JSON answer — medium · example · the memory Io's ordered writes and JSON.parse of stdout · acceptance · ac-progress
- resume --json without --yes answers its preview as one indented JSON value with exit 0 and takes no lock — medium · example · JSON.parse of stdout, the exit code and the lock file's bytes before and after · acceptance · ac-json-every-command
- run --dry-run without --json prints today's report on stdout — medium · example · today's dry-run text for the fixture, written literally · acceptance · ac-text-unchanged

### Implementation order

1. the two stubs
2. runCommandsRepo.ts
3. runCommandsAnswers.test.ts with a marker on each test
4. run the gate to see each marked test fail on its assertion

### Excluded scope

- Moving run, resume or reset-phase (phase-05).
- The outcomes of an actual run with agents (review_open, stopped, pauses), tested in-phase by phase-05 through the existing tests.
- reset-phase, covered in-phase by phase-05.

### Verification

The `standard` gate profile in phax.json, with the configured acceptance provider judging the acceptance test files (authored).

### Expected handoff content

Give the stubs' exports and deps interfaces, and what runCommandsRepo.ts builds and returns, including `program(commands)`, the lock file's format and how the extraction cache is filled. Give the literal expected texts and how they were captured from today's code. For each acceptance test, give the assertion it fails on today. Confirm every test carries its own `.fails` marker and that no other source file changed. Explain any deviation from the planned file lists.

### Commit subject

`test(cli): acceptance tests for run and resume on the command runner`

### Commit body

Freeze what run and resume answer once they move onto the runner: resume's lock
conflict with today's sentence and exit 7, and the spec's error line under --json; run
--dry-run --json writing its progress as note lines before its answer; resume's preview
answered without a lock; and run's dry-run text unchanged.

The tests load stub factories, and each is marked as an expected failure until the
phase that moves the two commands.

---

## phase-05 — run, resume and reset-phase on the runner {#phase-05-run-resume-reset}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high
**Assignment reason:** A passing phase whose acceptance tests are frozen, over the two longest-running commands: their progress, verdicts and error texts must stay byte for byte on today's streams through a new outcome contract shared by run and resume. Opus at high, kept small by leaving the kept run functions to phases 06 and 07.

`phax run`, `resume` and `reset-phase` are command definitions on the runner. Their progress is written as it happens (stdout and stderr lines on today's streams, note lines under --json), and their outcomes are answers with today's codes: dry-run, preview, review_open, stopped (13) and the pauses as q-run-pauses decides. `--hold [selection]` keeps its optional value, `-y` stays beside `--yes`, and `--skip-oracle` stays refused with its sentence. phase-04's acceptance tests pass with only their markers removed.

### Detailed instructions

- Read phase-04's acceptance test files and handoff, phase-01's handoff, this plan's Technical arbitrations (all of them), and the decided q-run-pauses and q-local-trace-flags. Then read src/cli/commands/{run,resume,resumeRegister,resetPhase,resetPhaseRegister,stopOutput,sessionFailureOutput,runLayers,bundledReviewSkill}.ts, src/app/{executePlan,resume,resetPhase,dryRun,runPreflight}.ts, src/domain/whatsNext.ts, src/cli/definitions/{program,shared,artifactDecide,prune}.ts (decide's OutputPort over `say` and `progress`, prune's `-y` alias), and tests/unit/cli/{run,resume}.test.ts, tests/unit/resumeArgv.test.ts, and tests/integration/{holdCli,resume,resumePreflightRechecks,runPreflightBeforeNaming}.test.ts.
- src/cli/definitions/runOutcome.ts: the outcome schema of run and resume (`{ qualifiedName, crossProject, outcome }`, with outcome tagged dry-run, preview, already-in-review, review_open, stopped, and paused if q-run-pauses decided pause-verdicts), its render and its notes. These write today's lines on today's streams for each outcome. For review_open: render `Run "<q>" reached review — N phase(s) complete.` (run only), the completions (renderArtifactCompletions) and `See …final-report.md for details.`, and notes the what's-next lines. For stopped: render renderStop's lines, verdict 13. For already-in-review: empty render, notes the refusal message and the what's-next lines. For each pause: empty render and today's stderr lines as notes, the verdict codes read from the outcome (pause-verdicts). Or declared errors per reason with today's lines as their text and fields phase, resumeCommand, resumeInstructions and resetAt (pause-errors). Also add `outputPortOf(context)`: log to `say`, warn and error to `progress`.
- src/cli/definitions/run.ts, replacing the stub with `makeRunCommand(deps)`. It takes args `[short-name]` (ShortNameArg, optional) and flags `plan` (required, identifier `path`), `allowDirty`, `providerPriority` (identifier `list`), `dryRun`, `security` (a string, identifier `mode`, refused by run with today's sentence and 2), `refresh`, `allowSkillEdits`, and `hold` with phase-01's optional value (identifier `selection`), each with today's help. It reads `verbose` and `trace` from the context's program options. Run keeps runRun's order and sentences step for step, writing each early line through outputPortOf at the moment it happens and handing the same port to buildSystemTelemetryLayer and readBundledReviewSkillForRun. Errors are declared with today's codes and texts, each a text form whose `out` carries the stdout lines already said: the hold value (1), config (2), security (2), no gate profile (2), priority (2), plan status (exitCodeForError), extraction (including its paused form), staleness (12), short-name mismatch and invalid short name (2), preflight, session failure with retry and follow-ups, agent invocation with its log hint, and the generic `phax run failed: …`. Its LockConflictError carries fields exactly `run` (the short name) and `pid` (a number).
- src/cli/definitions/resume.ts, replacing the stub with `makeResumeCommand(deps)`. It takes args `<short-name>` and flags `yes` with the alias `y`, `providerPriority` and `skipAcceptance`, with today's help, and `retiredOptions: { "skip-oracle": "--skip-oracle is no longer read: write --skip-acceptance" }`. Its local `--verbose` and `--trace` follow q-local-trace-flags. It declares no `prompts`, and without --yes it answers its preview after writing its lines through `say`. With --yes it runs as runResume does, its stop-closed lines said as they happen, the outcome per runOutcome.ts, and errors as today, `phax resume failed: <message>` with exit 7 for the lock and fields `run` and `pid`.
- src/cli/definitions/resetPhase.ts: `makeResetPhaseCommand(layers)` takes args `<short-name>` and `[phase-id]`, and flag `yes` with the alias `y`, each with today's help. Local `--verbose` and `--trace` follow q-local-trace-flags. It declares no `prompts`, and answers per this plan's Output contracts arbitration. The render writes `Target:`, then the preview's lines or the reset's lines in today's order and words. Errors: `phax reset-phase failed: …` with 7 for a lock and 1 otherwise, plus config and resolve with 1.
- Move help, long help and examples word for word from cliDocs (run, resume, reset-phase) and delete those entries. src/cli/definitions/program.ts lists run after `cost`, and resume and reset-phase after completions, as today. In src/cli/program.ts, replace the `run` registration and the two register calls with `mountRunnerStub` at their places, and delete src/cli/commands/resumeRegister.ts and resetPhaseRegister.ts. Keep runRun, runResume and runResetPhase with their signatures only as `runThroughOutput` compositions over the factories, for their existing tests. Move the harness of tests/unit/resumeArgv.test.ts and tests/integration/holdCli.test.ts, which build Commander registrations, to tests/helpers/runnerCall.ts, keeping their assertions except that a Commander parse error becomes the runner's refusal with 64; name each change. In tests/unit/architecturalGuards.test.ts, move the CLI_DIRECT_IO_ALLOWLIST entries of src/cli/commands/run.ts and resume.ts to src/cli/definitions/run.ts and resume.ts with a reason comment, if the definitions import node:fs and the compositions no longer do.
- Remove the `.fails` marker from each test of tests/integration/runCommandsAnswers.test.ts. That is the only change to the acceptance test files; tests/fixtures/run/runCommandsRepo.ts stays as committed. When a test cannot pass, fix the definitions, never the test. When the test itself is wrong, stop and say so in the handoff.
- Run `pnpm gen:usage-spec`. Extend tests/integration/usageSpecDeclarations.test.ts so that MIGRATED_COMMANDS gains run, resume and reset-phase. If q-local-trace-flags decided drop-local, add the four dropped declarations (`resume` and `reset-phase`, each `--verbose` and `--trace`) as a named list beside DROPPED_SECURITY_FLAGS. Run `pnpm docs:cli`.
- docs/upgrading.md, 0.34.0 entry, one bullet: run, resume and reset-phase answer through the runner. Under --json each answers an object naming its outcome, and every progress line is a note line on stderr. resume and reset-phase without --yes answer their preview under --json. Every exit code stays. `resume --skip-oracle` keeps its sentence and exits 64. Add what q-run-pauses and q-local-trace-flags decided.

### Planned files to create

- `src/cli/definitions/runOutcome.ts`
- `src/cli/definitions/resetPhase.ts`

### Planned files to edit

- `src/cli/definitions/run.ts`
- `src/cli/definitions/resume.ts`
- `src/cli/definitions/program.ts`
- `src/cli/program.ts`
- `src/cli/commands/run.ts`
- `src/cli/commands/resume.ts`
- `src/cli/commands/resumeRegister.ts`
- `src/cli/commands/resetPhase.ts`
- `src/cli/commands/resetPhaseRegister.ts`
- `src/cli/cliDocs.ts`
- `phax.usage.kdl`
- `README.md`
- `docs/upgrading.md`
- `tests/integration/usageSpecDeclarations.test.ts`
- `tests/integration/runCommandsAnswers.test.ts`
- `tests/unit/resumeArgv.test.ts`
- `tests/integration/holdCli.test.ts`
- `tests/unit/architecturalGuards.test.ts`

### Optional files that may be edited

- `src/cli/definitions/shared.ts`
- `src/cli/commands/stopOutput.ts`
- `src/cli/commands/sessionFailureOutput.ts`
- `src/cli/commands/runLayers.ts`
- `src/cli/commands/bundledReviewSkill.ts`
- `src/cli/bridge.ts`
- `src/app/resetPhase.ts`
- `src/app/dryRun.ts`
- `scripts/generate-usage-spec.ts`
- `tests/unit/cli/run.test.ts`
- `tests/unit/cli/resume.test.ts`
- `tests/integration/resume.test.ts`
- `tests/integration/resumePreflightRechecks.test.ts`
- `tests/integration/runPreflightBeforeNaming.test.ts`
- `tests/integration/cliProgram.test.ts`
- `tests/integration/docsCliDrift.test.ts`
- `tests/unit/cli/runnerCommandContracts.test.ts`
- `tests/unit/security/phaseGuard.test.ts`
- `docs/cli/reference.md`
- `knip.json`

### Boundary contracts

Producer: src/cli/definitions/run.ts, resume.ts and resetPhase.ts, with runOutcome.ts. Consumers: the runner, phase-04's acceptance tests, the skills that teach run and resume, and scripts. Contract: one outcome object per call under --json with today's codes (13 for stopped, the pauses per q-run-pauses), progress as note lines as it happens, today's text on today's streams without --json, and resume's LockConflictError line with fields run and pid. Producer: outputPortOf (runOutcome.ts). Consumers: the telemetry layer, executePlan's callbacks and readBundledReviewSkillForRun. Contract: log is say, warn and error are progress.

### Test strategy

- each outcome of run and resume keeps today's lines on today's streams and today's exit code — small · table · today's stdout and stderr lines and exitCodeForError's code for review_open, stopped, already-in-review and each pause · in-phase · ac-error-sentence
- the existing run, resume and reset-phase tests pass with their assertions unchanged through the kept run functions — medium · example · the existing tests' expected text, streams and codes · in-phase · ac-text-unchanged
- run and resume leave run-status.json, phase records, the cost ledger and the final report in today's shapes — medium · example · the existing run and resume tests decoding those files through src/schemas · in-phase · ac-versioned-stable
- reset-phase answers its preview and its reset as one JSON value each, and -y and --yes reset alike — medium · example · JSON.parse of stdout and the two calls' answers compared · in-phase · ac-json-every-command
- resume --skip-oracle is refused with today's sentence and 64 before anything is read — small · example · today's sentence, the refused line and the exit code · in-phase · ac-unknown-option
- run's --hold bare, with a selection and absent reaches parseHoldValue as today — small · table · parseHoldValue's input and the dry-run report's hold line for each form · in-phase
- phax.usage.kdl differs from the frozen file only by --json on the three commands and what q-local-trace-flags decided — small · metamorphic · the frozen pre-change file compared node by node · in-phase · ac-usage-parity

### Implementation order

1. runOutcome.ts: outcome schema, renders, notes, outputPortOf
2. resetPhase.ts
3. resume.ts
4. run.ts
5. program.ts entries, program.ts stubs, deleted register files and cliDocs entries, kept run functions, moved harnesses and allowlist entries
6. markers removed
7. usage spec, docs:cli, upgrading bullet

### Excluded scope

- Changing what a run does: phases, gates, stops, pauses, records or the persisted run documents.
- Retiring the kept run functions (phases 06 and 07) and the bridge (phase-09).
- The docs page reference/json-output (phase-10).

### Verification

The `standard` gate profile in phax.json, with the configured acceptance provider judging phase-04's acceptance test files (passed).

### Expected handoff content

Give the outcome schema and, for each outcome, its render lines, notes and code. Give each definition's input (aliases, optional value, retired option), errors with codes and text forms, and outputPortOf's mapping. Give what q-run-pauses and q-local-trace-flags decided and how each was carried out. Confirm the acceptance test files changed only by their markers. List the harnesses moved and each assertion changed, the run functions kept and the tests that call them, the allowlist entries moved, and the usage allowlist entries added. Explain any deviation from the planned file lists.

### Commit subject

`feat(cli): run, resume and reset-phase answer through the command runner`

### Commit body

Write run, resume and reset-phase as command definitions. Their progress is written as
it happens, on today's streams without --json and as note lines with it, and each
answers its outcome as one object: a dry run, a preview, a run in review, a stop (13)
or a pause, with every exit code kept.

--hold keeps its optional value, -y stays beside --yes, and --skip-oracle is refused
with its sentence. The acceptance tests pass with their markers removed.

---

## phase-06 — Retire the kept run functions of the inspection and mod commands {#phase-06-retire-run-functions-inspection}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

The run functions that plans 1 and 2 kept in src/cli/commands/ for tests are gone, along with their tests' dependence on them. That covers runLs, runArtifactStatus, runPlansLint, runPlansOverview, runPlansStatus, runPlansOverlap, runPlansEstimate, runValidate, runSessionInfo, runPath, runBrief, runArchitecture, runCostBackfill, runSchemaUpgrade and runSkillsInstall. Their tests run as q-kept-run-functions decides, with their assertions kept, and each changed assertion is named.

### Detailed instructions

- Read this plan's Technical arbitrations (definitions and order of removal, tests) and the decided q-kept-run-functions. Then read tests/helpers/runnerCall.ts, src/cli/bridge.ts (runThroughOutput), and the run functions in src/cli/commands/{ls,artifact,plans,plansOverview,plansOverlap,validate,sessionInfo,path,brief,architecture,cost,schema,skills}.ts.
- Find every test that imports one of these run functions: `grep -rn` under tests/ for each name. Among them are tests/unit/cli/{ls,plans,validate,schemaUpgrade,artifactStatusRender}.test.ts, tests/unit/skillsArgv.test.ts, and tests/integration/{runList,legacyRunFiles,plansOverlapLanded,plansOverlapCommand,sessionInfo,briefCommand,architectureCommand,costBackfill,holdConfigRefused,artifactQuestionsStatus,stoppedRunCommands,heldStopCommands,runPreflightBeforeNaming}.test.ts. Some of these import only a few of the functions, so move only those calls.
- If runner-harness was decided: extend tests/helpers/runnerCall.ts with what these tests need, if it lacks it: a call over phaxProgram or a single definition, the cwd, and stdout and stderr as lines. Rewrite each call as a runner call with the same words a person would type, keeping every expected string and code. An assertion on `out.log` lines reads stdout. An assertion on `out.warn` or `out.error` lines reads stderr, and where it distinguished the two, it now asserts the same text on stderr; name each such assertion in the handoff. If output-harness was decided: move runThroughOutput and these run functions into tests/helpers/keptRunFunctions.ts, unchanged but for imports, change each test's import path only, and delete them from src/.
- Delete each run function from src/cli/commands/, and delete each file left with nothing a definition or a test helper imports. Keep a file whose helpers a definition imports (for example artifact.ts if a definition still imports from it), and list what stays. Do not touch runThroughOutput in src/cli/bridge.ts while phase-07's run functions still use it.
- Run knip and the architecture audit, and remove from knip.json any entry made obsolete. Nothing in phax.usage.kdl, the README or the docs changes in this phase.

### Planned files to create

- (none)

### Planned files to edit

- `tests/helpers/runnerCall.ts`
- `src/cli/commands/ls.ts`
- `src/cli/commands/plans.ts`
- `src/cli/commands/plansOverview.ts`
- `src/cli/commands/plansOverlap.ts`
- `src/cli/commands/validate.ts`
- `src/cli/commands/sessionInfo.ts`
- `src/cli/commands/path.ts`
- `src/cli/commands/brief.ts`
- `src/cli/commands/architecture.ts`
- `src/cli/commands/cost.ts`
- `src/cli/commands/schema.ts`
- `src/cli/commands/skills.ts`
- `tests/unit/cli/ls.test.ts`
- `tests/unit/cli/plans.test.ts`
- `tests/unit/cli/validate.test.ts`
- `tests/unit/cli/schemaUpgrade.test.ts`
- `tests/unit/skillsArgv.test.ts`
- `tests/integration/runList.test.ts`
- `tests/integration/legacyRunFiles.test.ts`
- `tests/integration/plansOverlapLanded.test.ts`
- `tests/integration/plansOverlapCommand.test.ts`
- `tests/integration/sessionInfo.test.ts`
- `tests/integration/briefCommand.test.ts`
- `tests/integration/architectureCommand.test.ts`
- `tests/integration/costBackfill.test.ts`
- `tests/integration/holdConfigRefused.test.ts`

### Optional files that may be edited

- `src/cli/commands/artifact.ts`
- `tests/unit/cli/artifactStatusRender.test.ts`
- `tests/unit/cli/artifact.test.ts`
- `tests/integration/artifactQuestionsStatus.test.ts`
- `tests/integration/stoppedRunCommands.test.ts`
- `tests/integration/heldStopCommands.test.ts`
- `tests/integration/runPreflightBeforeNaming.test.ts`
- `tests/helpers/keptRunFunctions.ts`
- `src/cli/bridge.ts`
- `knip.json`

### Boundary contracts

Producer: tests/helpers/runnerCall.ts (or, for output-harness, tests/helpers/keptRunFunctions.ts). Consumers: the tests of the inspection and mod commands. Contract: a call by the words a person types, answering stdout and stderr lines and the exit code (or the moved run functions' unchanged signatures).

### Test strategy

- the tests of ls, artifact status, plans and the inspection commands pass through the new harness with their expected strings and codes kept — medium · example · the existing tests' expected text and codes, each changed assertion named · in-phase · ac-text-unchanged
- ls --json, plans lint --json, plans overview --json and artifact status --json keep their documents through the runner — medium · example · the moved tests' expected documents for each command · in-phase · ac-overview
- plans lint still exits 1 on an error finding and 0 on a clean plan through the runner — medium · example · the moved plans lint tests' expected codes · in-phase · ac-lint-verdict
- artifact status and ls answer their versioned documents through the runner as the moved tests expect — medium · example · the moved tests' decoded artifact-status and run-list documents · in-phase · ac-artifact-status
- the run list's pullRequest stays the URL or null through the runner — medium · example · the moved runList tests' expected rows · in-phase · ac-run-pr
- no deleted run function is still exported or imported — small · example · knip's unused-export report and the typecheck · in-phase

### Implementation order

1. runnerCall.ts extensions (or keptRunFunctions.ts)
2. each test file's calls, one family at a time
3. run functions and emptied files deleted
4. knip and the architecture audit

### Excluded scope

- The run functions of plans 3 and 4's commands and runThroughOutput itself (phase-07).
- Any change to a definition's behaviour, phax.usage.kdl or the docs.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

Say what q-kept-run-functions decided. List each run function deleted, each file deleted or kept with what it still exports, and each test file moved. Name every assertion changed, with why. Explain any deviation from the planned file lists, including a test file not listed that imported one of these functions.

### Commit subject

`test(cli): the inspection and mod commands' tests run through the command runner`

### Commit body

Retire the run functions that plans 1 and 2 kept for tests (ls, artifact status, the
plans commands, validate, session-info, path, brief, architecture, cost backfill,
schema upgrade, skills install). Their tests now call the commands as a person types
them, with their expected text and codes kept.

---

## phase-07 — Retire the remaining run functions and check every command's --json {#phase-07-retire-run-functions-and-every-command}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

The run functions kept for plans 3 and 4's commands are gone, and so is `runThroughOutput`. Their tests run as q-kept-run-functions decides. A table test proves that every command of `phax --usage` answers --json as §5.2 and §5.3 say, or names the family test that proves it, and that the contracts catalogue holds one entry per command.

### Detailed instructions

- Read this plan's Technical arbitrations (output contracts, prompting commands, tests), the decided q-kept-run-functions, phase-06's handoff (the harness and its conventions), and src/cli/bridge.ts (runThroughOutput).
- Find every test that imports one of these run functions: runArtifactStatus if kept, runArtifactTransition, runCreateArtifact, runArtifactSchema, runArtifactMigrateApprovals, runArtifactMigrateDocuments, runAgentModels, runAgentResolve, runAgentProbe, runAgentSetupMistralVibe, runAgentSetupProviders, runInit, runUnlock, runArchive, runPrune, runReviewHandoff, runPublishPr, runReviewCompliance, runReviewCode, runEnter, runEnterPhase, runShell, runOpen, runAdjustPlan, runRun, runResume and runResetPhase. Among the test files are tests/unit/cli/{artifact,agent,init,publishPr,reviewCompliance,reviewCode,enterPhase,run,resume}.test.ts and tests/integration/{approvalAttribution,decideLifecycle,migrateDocuments,pruneCommand,initCommand,reviewHandoffCommand,reviewCodeCommand,enter,enterPhase,enterPhaseStop,adjustPlanCommand,heldStopClose,declaredStopClose,heldStopRun,stoppedRunCommands,heldStopCommands,resume,resumePreflightRechecks,runPreflightBeforeNaming,holdCli}.test.ts. A command that hands over the terminal is called through its factory with the fake Session or Editor, never a real one.
- Move each call as phase-06 did under the decided option, keeping every expected string and code, and naming each changed assertion. Then delete the run functions, and delete runThroughOutput and its options from src/cli/bridge.ts along with the tests of it in tests/unit/cli/bridge.test.ts. Delete each src/cli/commands/ file left with nothing a definition imports, and keep and list the helpers that stay. DEFAULT_MODEL and DEFAULT_EFFORT follow tests/unit/cli/adjustPlanDefaults.test.ts's import.
- Write tests/integration/everyCommandJson.test.ts. Read the command list from the committed phax.usage.kdl (tests/helpers/usageKdl.ts). Hold a table with one row per command: either a call that succeeds without a provider, network or person, run through tests/helpers/runnerCall.ts in a temporary repository with phax.json, a temporary PHAX home and fixtures as needed (for example `run --plan <plan> --dry-run`, `resume <run>` without --yes, `reset-phase <run>` without --yes, `artifact schema spec`, `plans lint <plan>`), or the path of the family test that proves the command with fakes (sessions, providers, GitHub, terminal handovers). The table fails on a command of the usage spec with neither, and on a row naming a command the usage spec does not list. For each runnable row with --json, stdout parses as one JSON value, indented by two spaces with one trailing newline, with `$schema` its first key when the output has one, and every stderr line parses as a message line whose `kind` is note, written, error, refused or defect. For each command whose `prompts` always holds, the row asserts one refused line and 64 instead (§5.20).
- In the same file, assert that `phax --json-schema` lists exactly the commands of phax.usage.kdl, each entry equal to that command's `<words> --json-schema`, with `program` "phax", `version` equal to PHAX_RELEASE (never a literal), `exits` with refused 64 and defect 70, and `messages` with the five message line shapes.
- Run knip and the architecture audit, and clean knip.json. Nothing in phax.usage.kdl or the docs changes in this phase.

### Planned files to create

- `tests/integration/everyCommandJson.test.ts`

### Planned files to edit

- `src/cli/bridge.ts`
- `tests/unit/cli/bridge.test.ts`
- `src/cli/commands/artifact.ts`
- `src/cli/commands/agent.ts`
- `src/cli/commands/init.ts`
- `src/cli/commands/prune.ts`
- `src/cli/commands/reviewHandoff.ts`
- `src/cli/commands/publishPr.ts`
- `src/cli/commands/reviewCompliance.ts`
- `src/cli/commands/reviewCode.ts`
- `src/cli/commands/enter.ts`
- `src/cli/commands/enterPhase.ts`
- `src/cli/commands/shell.ts`
- `src/cli/commands/open.ts`
- `src/cli/commands/adjustPlan.ts`
- `src/cli/commands/run.ts`
- `src/cli/commands/resume.ts`
- `src/cli/commands/resetPhase.ts`
- `tests/unit/cli/artifact.test.ts`
- `tests/unit/cli/agent.test.ts`
- `tests/unit/cli/init.test.ts`
- `tests/unit/cli/publishPr.test.ts`
- `tests/unit/cli/reviewCompliance.test.ts`
- `tests/unit/cli/reviewCode.test.ts`
- `tests/unit/cli/enterPhase.test.ts`
- `tests/unit/cli/run.test.ts`
- `tests/unit/cli/resume.test.ts`
- `tests/integration/pruneCommand.test.ts`
- `tests/integration/initCommand.test.ts`
- `tests/integration/reviewHandoffCommand.test.ts`
- `tests/integration/reviewCodeCommand.test.ts`
- `tests/integration/enter.test.ts`
- `tests/integration/enterPhase.test.ts`
- `tests/integration/adjustPlanCommand.test.ts`
- `tests/integration/resume.test.ts`
- `tests/integration/resumePreflightRechecks.test.ts`
- `tests/integration/holdCli.test.ts`

### Optional files that may be edited

- `tests/helpers/runnerCall.ts`
- `tests/helpers/usageKdl.ts`
- `tests/helpers/keptRunFunctions.ts`
- `src/cli/commands/unlock.ts`
- `src/cli/commands/archive.ts`
- `src/cli/definitions/adjustPlan.ts`
- `tests/unit/cli/adjustPlanDefaults.test.ts`
- `tests/integration/approvalAttribution.test.ts`
- `tests/integration/decideLifecycle.test.ts`
- `tests/integration/migrateDocuments.test.ts`
- `tests/integration/enterPhaseStop.test.ts`
- `tests/integration/heldStopClose.test.ts`
- `tests/integration/declaredStopClose.test.ts`
- `tests/integration/heldStopRun.test.ts`
- `tests/integration/stoppedRunCommands.test.ts`
- `tests/integration/heldStopCommands.test.ts`
- `tests/integration/runPreflightBeforeNaming.test.ts`
- `tests/integration/archive.test.ts`
- `knip.json`

### Boundary contracts

Producer: every definition of phaxProgram. Consumer: the every-command table. Contract: under --json, one JSON value on stdout as §5.2 lays it out and only message lines on stderr, or one refused line for a command that prompts; and a catalogue entry per command of the usage spec.

### Test strategy

- every command of phax --usage has a row in the table or names the family test that proves it, and the table fails on a command with neither — medium · table · the command list read from the committed phax.usage.kdl · in-phase · ac-json-every-command
- each runnable row's --json answer is one value indented by two spaces with one trailing newline and $schema first when present, and each stderr line is a message line — medium · table · JSON.parse of stdout, its raw text and key order, and each stderr line against the five message shapes · in-phase · ac-json-every-command
- each command that always prompts is refused with 64 under --json in the table — medium · table · the refused line and the exit code per row · in-phase · ac-no-person
- phax --json-schema lists exactly the usage spec's commands, each entry equal to its own --json-schema, with the program's exits and the five message shapes — medium · table · the committed phax.usage.kdl command list and each command's --json-schema output · in-phase · ac-catalogue
- the moved tests of plans 3 and 4's commands pass with their expected strings and codes kept — medium · example · the existing tests' expected text and codes, each changed assertion named · in-phase · ac-text-unchanged
- decide's and new's stdin tests and approve's written records still pass through the runner — medium · example · plan 3's tests of decide, new and approve, unchanged · in-phase · ac-written

### Implementation order

1. test files moved family by family under the decided option
2. run functions, runThroughOutput and emptied files deleted
3. everyCommandJson.test.ts table and catalogue check
4. knip and the architecture audit

### Excluded scope

- Removing the bridge's routing, stubs, usage splice, src/cli/program.ts, cliDocs or cliCompleters (phase-09).
- Any change to a definition's behaviour, phax.usage.kdl or the docs.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

List each run function deleted, each src/cli/commands/ file deleted or kept with what it still exports, and each test file moved. Name every assertion changed, with why. Give the every-command table: each command's row (its call) or the family test it names. Confirm runThroughOutput is gone and what remains of src/cli/bridge.ts. Explain any deviation from the planned file lists.

### Commit subject

`test(cli): every command's tests run through the runner, and every command answers --json`

### Commit body

Retire the run functions kept for the lifecycle, authoring, run and session commands,
and runThroughOutput with them. Their tests now call the commands as a person types
them, with their expected text and codes kept.

A table proves that every command of phax --usage answers --json with one value on
stdout and message lines on stderr, or is refused because it prompts, and that the
contracts catalogue has one entry per command.

---

## phase-08 — Program gains: the guard, root help, the version alias, the usage header and plain groups {#phase-08-program-gains}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium
**Assignment reason:** The phase designs the program-level members the runner needs to own phax's whole command line (where the guard sits in the runner's order, and root help matching Commander's text) across the contract, the runner, the adapter and the usage spec.

The port can hold phax's program on its own. A program may declare a guard run on the located command before anything is decoded, with its own exit and text, passing help and contracts. The runner writes the program's root help as Commander does: summary, `-V, --version`, the usage flags with their help and default, the commands in order, and a `help [command]` command. The usage spec writes the program's `about`, `license` and `min_usage_version`, and writes groups without `subcommand_required` when the program says so. Each gain is a conformance case. phax's program does not adopt them yet, and phax.usage.kdl does not change.

### Detailed instructions

- Read this plan's Technical arbitrations (the phase guard, root help, --version and --usage, the usage spec after the bridge). Then read src/cli/commandLibrary/contract/{command,define,usage,index}.ts, src/cli/commandLibrary/commander/{commanderAdapter,run,undeclared}.ts, the conformance cases and suite, src/cli/bridge.ts (runnerGuard, NOTHING_RUN_OPTIONS, the `help` dispatch), src/cli/program.ts (the root's options, configureOutput and help text), tests/fixtures/help/phax-root-help.txt, and the frozen file tests/fixtures/usage/phax.usage.before-command-contracts.kdl's root.
- Gain, the program's guard: `Program.guard?: (call: { words, options }) => { text, exit } | undefined`, where `options` are the camelCase names of the options the call gives before `--`. The runner calls it once the command is located and before any source is decoded, the `prompts` refusal included. It never calls it for `--help`, `-h` or `--json-schema`. A refusal writes its text then a newline without --json, and under --json one refused line (`source` "command", `path` the words, `expected` "a command allowed inside a phase worktree" or the guard's own, `text` and `exit` the guard's). It exits the guard's code, which may differ from the program's `refused`. Conformance case `program.guard`.
- Gain, root help. `Program.summary` is written under the usage line of root help and as the usage spec's `about`. The version option is declared as `-V, --version`, so both forms print the version. The usage flag and its format option carry their help and the format's default from `ProgramUsage` (`help`, `formatHelp`, `formatDefault`), shown as Commander shows a default. Root help lists the root options in the order the program gives them, and the commands in program order with Commander's terms, then `help [command]`. Gain, the root's help command: `<program> help <words>` answers that command's or group's help as `<words> --help` does, exit 0, and an unknown word is refused like any unknown command. Conformance cases `program.root-help` and `program.help-command`.
- Gain, the usage header: `Program.license` and `ProgramUsage.minUsageVersion` are written as the root's `license` and `min_usage_version`, in the order the frozen file has them (name, bin, version, license, min_usage_version, about). Gain, plain groups: `ProgramUsage.groups?: "subcommand-required" | "plain"`, defaulting to the library's `subcommand-required`. With `plain`, a group's `cmd` line carries no `subcommand_required=#true`, and the runner still refuses a group called alone (§5.11). Conformance cases `usage.root-header` and `usage.plain-groups`.
- Write tests/unit/commandLibrary/commander/programGains.test.ts. It exercises each gain through `runner.run` over the memory Io. A guard refusing `run` writes its text and exits 1 without --json, and one refused line with exit 1 under it. It passes `run --help`, `run -h` and `run --json-schema` and is never called for them. A test program's root help equals an expected text written literally, with its summary, `-V, --version`, a usage format with `(default: "kdl")` and `help [command]`. `help run` equals `run --help`. The usage spec of a plain-groups program has no `subcommand_required`.
- Add each new case to CONTRACT_ONLY only if it holds without a runner. Do not change phaxProgram, the bridge or main.ts. Run `pnpm gen:usage-spec`; phax.usage.kdl must not change.

### Planned files to create

- `tests/unit/commandLibrary/commander/programGains.test.ts`

### Planned files to edit

- `src/cli/commandLibrary/contract/command.ts`
- `src/cli/commandLibrary/contract/define.ts`
- `src/cli/commandLibrary/contract/usage.ts`
- `src/cli/commandLibrary/contract/conformance/cases.ts`
- `src/cli/commandLibrary/commander/commanderAdapter.ts`
- `src/cli/commandLibrary/commander/run.ts`

### Optional files that may be edited

- `src/cli/commandLibrary/contract/index.ts`
- `src/cli/commandLibrary/contract/catalogue.ts`
- `src/cli/commandLibrary/contract/conformance/suite.ts`
- `src/cli/commandLibrary/commander/undeclared.ts`
- `src/cli/commandLibrary/commander/suggest.ts`
- `tests/unit/commandLibrary/conformance.test.ts`
- `tests/unit/commandLibrary/contract/exports.test.ts`
- `tests/unit/commandLibrary/commander/exports.test.ts`
- `tests/unit/commandLibrary/commander/usage.test.ts`
- `tests/unit/commandLibrary/commander/help.test.ts`
- `knip.json`

### Boundary contracts

Producer: the port's contract and runner. Consumer: phase-09's phaxProgram and main.ts. Contract: `Program.guard`, called on the located command before decoding and skipped for help and contracts; `Program.summary`, `Program.license` and the usage options `help`, `formatHelp`, `formatDefault`, `minUsageVersion` and `groups`; `-V, --version`; and the root's `help [command]`.

### Test strategy

- a program guard refuses a located command before anything is decoded, with its own text and exit, and is never called for --help, -h or --json-schema — small · table · the program.guard case's stderr, refused line and exit for each call · in-phase
- the runner writes a program's root help with its summary, -V, the usage format's default and help [command], as Commander writes it — small · example · the expected root help written literally in the program.root-help case · in-phase · ac-help
- help <words> answers that command's or group's help, and an unknown word is refused — small · example · the same words' --help text and the refused exit · in-phase · ac-groups
- the usage spec writes license, min_usage_version and about at the root, and plain groups without subcommand_required — small · example · the usage.root-header and usage.plain-groups cases' KDL · in-phase · ac-usage-parity
- phax.usage.kdl is unchanged by this phase — small · metamorphic · the frozen pre-change file compared node by node · in-phase · ac-usage-parity

### Implementation order

1. command.ts and define.ts: guard, summary, license, usage options
2. run.ts: the guard's place, the help command, version alias
3. commanderAdapter.ts: root help
4. usage.ts: root header and plain groups
5. conformance cases and programGains.test.ts

### Excluded scope

- Adopting the gains in phaxProgram, main.ts or the generator (phase-09).
- Removing the bridge (phase-09).

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

Give each new contract member's exact shape and export. Give where the guard runs among locate, decode, prompts, check and run, and which words skip it. Give the root help's layout rules and the conformance case ids added. Explain any deviation from the planned file lists.

### Commit subject

`feat(cli): a program's guard, root help, version alias, usage header and plain groups on the runner`

### Commit body

Give the ported command library what a whole program needs to run without a host
parser: a guard called on the located command before anything is decoded, root help
with the program's summary, -V, the usage flags' defaults and a help command, and a
usage spec writing the program's licence, minimum usage version and description, with
groups optionally written without subcommand_required. Each is a conformance case.

---

## phase-09 — The runner owns the program: the bridge and the Commander program removed {#phase-09-runner-owns-program}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium
**Assignment reason:** The phase removes the transition's dispatcher and hands the entry point, the phase guard, root help and the usage spec to the runner at once. A mistake there breaks every command, across the entry point, the generator, the guards and a dozen tests.

`phax` runs every call through the runner. main.ts keeps only its `--usage` catch and hands everything else to `runner.run(phaxProgram, processIo)`. phaxProgram declares the phase guard, its summary, licence and usage header, and plain groups. src/cli/bridge.ts, src/cli/program.ts, cliDocs, cliCompleters and the register files are gone, and Commander is imported by the runner's adapter alone. phax.usage.kdl is the generator's output from the definitions alone, differing from the frozen file only by the named allowlists, and root help, `--version`, `-V` and `--usage` print what they print today.

### Detailed instructions

- Read this plan's Technical arbitrations (the phase guard, root help, --version and --usage, definitions and order of removal, the usage spec after the bridge) and the decided q-local-trace-flags. Read phase-08's and phase-07's handoffs. Then read src/cli/main.ts, src/cli/bridge.ts, src/cli/program.ts, src/cli/cliDocs.ts, src/cli/cliCompleters.ts, src/cli/introspect.ts, scripts/generate-usage-spec.ts, src/cli/definitions/program.ts, src/domain/security/phaseGuard.ts, and the tests naming them: tests/unit/cli/{bridge,phaxProgram,runnerCommandContracts}.test.ts, tests/integration/{cliProgram,usageParity,usageSpecDeclarations,usageOutput,cliErrors,phaseGuard,rootHelp}.test.ts, tests/unit/security/phaseGuard.test.ts and tests/unit/architecturalGuards.test.ts.
- src/cli/definitions/program.ts. phaxProgram gains `summary: "Drive AI coding agents through isolated, gated phases"`, `license` from package.json's value (Apache-2.0, read at build time as the generator reads it today, or declared literally with a test that it equals package.json's), `usage` with today's `--usage` and `--usage-format` help, `<format>`, default `kdl`, `minUsageVersion: "1.0.0"` and `groups: "plain"`. Its `guard` calls isInPhaseWorktree(process.cwd()) and phaseGuardRefusal(words.join(" "), options), answering exit 1 with the refusal. Its commands stay in today's root order.
- src/cli/main.ts: keep setupInterruptHandlers and the `--usage` catch (runUsageFlagAndExit) as they are. Otherwise run `runner.run(phaxProgram, processIo(process))` and exit with its code after stdout and stderr are flushed, as runBridge's exitAfterFlush does. A rejection writes `defect: <message>` and exits 70.
- Delete src/cli/bridge.ts, src/cli/program.ts, src/cli/cliDocs.ts, src/cli/cliCompleters.ts, src/cli/commands/resumeRegister.ts and src/cli/commands/resetPhaseRegister.ts (if phase-05 left them), and src/cli/introspect.ts if nothing imports it. Remove PARTIAL_GROUPS and every import of these modules. Move any surviving helper a definition needs (for example readPackageVersion) to where the definitions import it. List what stays of src/cli/commands/ in the handoff, each file with the definition or main.ts that imports it.
- scripts/generate-usage-spec.ts writes `// Generated from phax's command definitions — do not edit by hand.`, then `// Regenerate with: pnpm gen:usage-spec`, then a blank line, then `usageSpec(phaxProgram)`. It walks no Commander tree and reads no cliDocs or cliCompleters. Run `pnpm gen:usage-spec` and `pnpm docs:cli`.
- tests/integration/usageSpecDeclarations.test.ts: drop the PARTIAL_GROUPS import, WHOLE_GROUPS and the `subcommand_required` test and allowances. MIGRATED_COMMANDS becomes every command of phaxProgram in order. Keep REWORDED_JSON, REWORDED_LONG_HELP, CHOICES_DECLARED, DROPPED_SECURITY_FLAGS and phase-05's resume and reset-phase list if drop-local was decided, each with its comment, plus the root's `after_long_help` and `flag --json-schema`. Assert the file has no `subcommand_required`. If the comparison finds any other difference (a root declaration, a flag's arg or default), fix the definitions or the program, never the allowlist.
- Tests: delete tests/unit/cli/bridge.test.ts. Move its phase-guard cases (help and contracts pass, a refused line with exit 1 under --json, today's sentence without) to tests/integration/phaseGuard.test.ts or a new runner test, assertions unchanged, and name each one moved and each one dropped with the routing it tested. tests/unit/security/phaseGuard.test.ts's completeness check reads phaxProgram's commands (fullName joined) instead of Commander's tree. tests/integration/cliProgram.test.ts and usageParity.test.ts read phaxProgram and the catalogue instead of buildProgram and introspect, keeping their assertions where the fact still exists. tests/integration/rootHelp.test.ts must pass against the fixture unchanged, now written by the runner. tests/integration/usageOutput.test.ts and cliErrors.test.ts pass unchanged.
- tests/unit/architecturalGuards.test.ts: replace the definitions-only commander check with: in src/, only src/cli/commandLibrary/commander/commanderAdapter.ts imports `commander` (ac-no-parser). Remove allowlist entries of deleted files, and move any whose file moved, with its reason. Keep the closure allowlist in step. Clean knip.json.
- docs/upgrading.md, 0.34.0 entry, one bullet for the program: every command answers through the runner. `phax --json-schema` lists every command, and `--json-schema` after any command prints its contracts. `phax help <command>` answers that command's help. phax.usage.kdl is written in one style, from the definitions, and its groups no longer declare subcommand_required. Root help, `--version`, `-V` and `--usage` print as before, apart from the `[options]` terms the earlier bullets name. The phase guard refuses as before.

### Planned files to create

- (none)

### Planned files to edit

- `src/cli/main.ts`
- `src/cli/definitions/program.ts`
- `src/cli/bridge.ts`
- `src/cli/program.ts`
- `src/cli/cliDocs.ts`
- `src/cli/cliCompleters.ts`
- `scripts/generate-usage-spec.ts`
- `phax.usage.kdl`
- `README.md`
- `docs/upgrading.md`
- `tests/integration/usageSpecDeclarations.test.ts`
- `tests/unit/cli/bridge.test.ts`
- `tests/unit/security/phaseGuard.test.ts`
- `tests/integration/phaseGuard.test.ts`
- `tests/integration/cliProgram.test.ts`
- `tests/unit/architecturalGuards.test.ts`

### Optional files that may be edited

- `src/cli/introspect.ts`
- `src/cli/commands/resumeRegister.ts`
- `src/cli/commands/resetPhaseRegister.ts`
- `src/cli/commands/usage.ts`
- `src/cli/commands/usageSpec.ts`
- `src/cli/definitions/shared.ts`
- `src/cli/commandLibrary/commander/processIo.ts`
- `src/domain/security/phaseGuard.ts`
- `tests/integration/usageParity.test.ts`
- `tests/unit/cli/phaxProgram.test.ts`
- `tests/unit/cli/runnerCommandContracts.test.ts`
- `tests/integration/docsCliDrift.test.ts`
- `tests/integration/rootHelp.test.ts`
- `tests/helpers/usageKdl.ts`
- `docs/cli/reference.md`
- `knip.json`

### Boundary contracts

Producer: phaxProgram (src/cli/definitions/program.ts) and the runner. Consumers: main.ts, the usage spec generator, the shell completions and every person and agent calling phax. Contract: the runner answers every call but `--usage`; the phase guard refuses inside a phase worktree with exit 1 before anything is decoded; root help, `--version` and `-V` print as today; phax.usage.kdl is `usageSpec(phaxProgram)` under a two-line comment. Producer: main.ts's `--usage` catch. Consumer: `usage` and the completion scripts. Contract: the committed phax.usage.kdl, or its JSON through the `usage` CLI, as today.

### Test strategy

- phax.usage.kdl is the generator's output from the definitions alone and differs from the frozen file only by the named allowlists — small · metamorphic · the frozen pre-change file compared node by node · in-phase · ac-usage-parity
- phax --usage and phax --usage --usage-format kdl print the committed file and exit 0 — medium · smoke · the committed phax.usage.kdl bytes · in-phase · ac-usage-flag
- phax --help equals the root-help fixture, and --version and -V print the release, now written by the runner — medium · smoke · tests/fixtures/help/phax-root-help.txt and PHAX_RELEASE · in-phase · ac-help
- in src/, only the runner's Commander adapter imports commander — small · example · the architecture guard's import scan · in-phase · ac-no-parser
- a mistyped command or option exits 64 with today's sentence and suggestion — medium · smoke · §6's refused example text and tests/integration/cliErrors.test.ts's expectations · in-phase · ac-unknown-option
- a crash still exits 70 with defect: text, and a group called alone at any depth writes its help and exits 64 — medium · smoke · the existing defect and group tests' expectations · in-phase · ac-groups
- a crash escaping the runner in main.ts writes defect: and exits 70 — medium · smoke · tests/integration/cliErrors.test.ts's defect expectation · in-phase · ac-defect
- inside a phase worktree a refused command exits 1 with today's sentence, one refused line under --json, while --help and --json-schema answer — medium · example · today's guard sentence and exit code · in-phase
- the phase guard classification names exactly phaxProgram's commands — small · table · PHASE_GUARD_CLASSIFICATION's keys against each command's full name · in-phase
- a command's --json-schema still equals its catalogue entry once the bridge's root routing is gone — small · example · phax plans lint --json-schema against the plans lint entry of phax --json-schema · in-phase · ac-json-schema-command
- plan 3's stdin document tests pass unchanged with the program on the runner — medium · example · tests/integration/artifactStdinDocuments.test.ts unchanged · in-phase · ac-stdin-bad

### Implementation order

1. phaxProgram's guard, summary, licence and usage options
2. main.ts on the runner
3. generator from the definitions, gen:usage-spec, frozen-file test
4. bridge, program.ts, cliDocs, cliCompleters, register files and introspect deleted
5. tests moved off the bridge and Commander, architecture guard, knip
6. docs:cli and the upgrading bullet

### Excluded scope

- The docs page reference/json-output (phase-10).
- Changing any command's behaviour, text or codes.
- Moving the helpers left in src/cli/commands/ to another directory.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

Give phaxProgram's new members and main.ts's flow. List every file deleted and what stays of src/cli/commands/, each with its importer. Give the frozen-file test's final allowlists and any difference fixed in the definitions. Name each bridge test moved or dropped, and each assertion changed with why. Give the architecture guard's new check and the allowlist entries moved or removed. Explain any deviation from the planned file lists.

### Commit subject

`refactor(cli): the command runner owns phax's program, and the bridge is gone`

### Commit body

Hand every call to the runner from main.ts, which keeps only its --usage catch. The
program declares the phase guard, its summary, licence and usage header, and writes
its groups plainly. Remove the bridge, the Commander program, cliDocs, cliCompleters
and the register files: Commander is imported by the runner's adapter alone.

phax.usage.kdl is now the generator's output from the definitions, differing from the
file before command-contracts only by --json and the rewordings plans 1 to 4 named.
Root help, --version, -V and --usage print what they printed.

---

## phase-10 — The docs page: machine answers, message lines and --json-schema {#phase-10-json-output-docs}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

The docs site gains the page reference/json-output (§11), for an agent author or script writer who drives phax and must read its answers and act on its failures without parsing text. The page covers what `--json` writes on stdout, the five message lines on stderr, `--json-schema` and the contracts catalogue, the `refused` (64) and `defect` (70) codes, documents read from stdin, written-file records, and the commands that refuse `--json` because they hand over the terminal. It is linked from the site map.

### Detailed instructions

- Read the spec's §3, §5, §6, §8 and §11, this plan's Technical arbitrations, docs/upgrading.md's 0.34.0 entry, docs/structured-answers.md and docs/plan-overview.md (the house style of a reference page), site/pages.ts and the site tests (tests/unit/site/{pageMap,links,schemas}.test.ts).
- Write docs/json-output.md. Title: "Machine answers: --json, message lines and --json-schema". Address the reader §11 names. Sections:
- "Answers on stdout": one JSON value, two-space indented with one trailing newline, `$schema` first when the answer is a published document (artifact-status, plan-overview, plan-lint, run-list), otherwise an object described by its contract. It never carries a render's text.
- "Message lines on stderr": one compact object per line, tagged note, written, error, refused or defect, with each one's fields, and none with a `$schema`. Use §6's examples verbatim.
- "Exit codes": a command's documented codes stay. A verdict code is written with its answer: `plans lint` exits 1, and `run` and `resume` 13 at a stop, plus the pause codes as q-run-pauses decided. 64 is refused and 70 is defect. Link /reference/exit-codes.
- "Contracts": `phax --json-schema` and `phax <command> --json-schema`, with §6's example.
- "Documents read from a file or stdin": `--verdicts <file|->` and `--brief <file|->`, a terminal stdin refused at once, a bad document refused before anything runs.
- "Written files": the written-file record and where it appears.
- "Commands that never answer --json": the commands that hand over the terminal or prompt, each refused with 64 and the command its remedy names.
- "Progress on long commands": run and resume's note lines.
- "Examples": §11's three examples verbatim, each with one sentence.
- Use only facts the spec, this plan or the code state. Use no em dash in prose where the site's style forbids it; follow docs/structured-answers.md.
- site/pages.ts: add a `files` entry with route `/reference/json-output`, title `Machine answers`, source `docs/json-output.md`, and a one-sentence description, placed beside `/reference/cli`. Make every internal link resolve per tests/unit/site/links.test.ts. If the site build needs a navigation entry elsewhere (site/build/), add it there.
- docs/upgrading.md, 0.34.0 entry: add one sentence to the first command-line bullet linking the new page. Do not reword other bullets.

### Planned files to create

- `docs/json-output.md`

### Planned files to edit

- `site/pages.ts`
- `docs/upgrading.md`

### Optional files that may be edited

- `site/build/pageMap.ts`
- `site/build/generate.ts`
- `tests/unit/site/pageMap.test.ts`
- `tests/unit/site/links.test.ts`
- `README.md`

### Test strategy

- the page is mapped once in the site's page map and every link on it resolves — small · example · the site page-map and link checks · in-phase

### Implementation order

1. docs/json-output.md
2. site/pages.ts entry and any navigation file
3. upgrading link

### Excluded scope

- Any change to phax's behaviour, phax.usage.kdl or the generated CLI reference.
- Rewriting other docs pages beyond a link.

### Verification

The `standard` gate profile in phax.json (its terminal steps include `pnpm site:build`).

### Expected handoff content

Give the page's sections, the site map entry and any navigation file touched, and confirm the site build and link checks pass. Explain any deviation from the planned file lists.

### Commit subject

`docs: machine answers, message lines and --json-schema`

### Commit body

Add the reference page for agents and scripts that drive phax: the answer --json writes
on stdout, the five message lines on stderr, the exit codes with the refused and defect
codes, the contracts --json-schema prints, documents read from a file or stdin, written
files, and the commands that refuse --json because they hand over the terminal. Link it
from the site map.
