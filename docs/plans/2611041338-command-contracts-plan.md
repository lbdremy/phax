---
status: Draft
source-spec: docs/specs/2611031738-command-contracts.md
completes-spec: false
---
# Lifecycle and authoring commands on the runner

The third plan of the spec `command-contracts`. Plan 1 (`command-runner-and-mod-answers`, PR #184) ported the command library to Effect 3, put the bridge between Commander and the runner, and moved `ls`, `artifact status`, `plans lint` and `plans overview`. Plan 2 (`inspection-commands-on-the-runner`, PR #185) gave the port group help, variadic arguments, negated switches, `prompts` and whole groups, and moved the inspection commands and the `plans`, `cost`, `schema`, `security`, `skills` and `records` groups. This plan moves the lifecycle and authoring commands onto the runner through the bridge, each with its output contract, its render (today's text), its declared errors with today's sentences and codes, and its help, examples and completers moved into its definition: the rest of the `artifact` group (`approve`, `reopen`, `stale`, `abandon`, `complete`, `schema`, `migrate-approvals`, `migrate-documents`, `decide` with its `--verdicts` document, and `new spec` and `new plan` with their text `--brief` document), after which `artifact` and `artifact new` are groups the runner holds whole and the bridge's PARTIAL_GROUPS is empty; the `agent` group (`models`, `resolve`, `probe`, `setup providers`, `setup mistral-vibe`), held whole; and `init`, `unlock`, `archive` and `prune`. Plan 4 moves the run and session commands and completes the spec.

Phases: phase-01 gives the port and the bridge what these commands need (an option's short alias, a progress line on stdout, the document as read, a document's check before run, a group's retired words, and stubs of required-value stdin flags). phase-02 moves the artifact transitions, `artifact schema` and the two migrations. phase-03 writes the acceptance tests of the two stdin documents and their sessions, and phase-04 moves `artifact decide` and `artifact new` and passes them, holding `artifact` whole. phase-05 moves the `agent` group. phase-06 moves `init`, `unlock`, `archive` and `prune`.

Criteria this plan finishes, for the commands it moves: ac-stdin-file-or-dash, ac-stdin-terminal and ac-stdin-bad (`artifact decide --verdicts`), ac-brief-text (`artifact new --brief`), ac-written (`artifact approve`, the criterion's own case), ac-written-on-failure (decide's failed commit), and ac-groups in full (`artifact`, `artifact new` and `agent setup` were the last groups it names).

Criteria this plan advances, finished by plan 4 once the last command moves: ac-json-every-command, ac-text-unchanged, ac-error-sentence (its `resume` case is plan 4's), ac-unknown-option, ac-help, ac-no-parser, ac-catalogue and ac-usage-parity on every moved command; ac-no-person for `artifact decide`, `init` and the approving transitions (`enter` waits for plan 4); ac-versioned-stable through `artifact schema`, whose bytes stay today's. ac-progress's own case (`phax run --dry-run --json`) is plan 4's; this plan's decide and authoring notes advance §5.19 only. ac-lint-verdict, ac-artifact-status, ac-overview, ac-run-pr, ac-misdeclared, ac-defect, ac-json-schema-command and ac-usage-flag were finished by plans 1 and 2 and are not touched.

Execution caveat: this repository is driven by the installed phax 0.33.0 during the run, which runs `artifact` commands on this repository's plans; nothing this plan changes is read by it. Every test proves the runner through its `Io` data (the memory Io of src/cli/commandLibrary/contract/conformance/memoryIo.ts), through a kept run function, or through `tsx src/cli/main.ts` spawned in a temporary repository (tests/helpers/isolateGit.ts, a temporary PHAX home), and a fixture that commits sets its own git identity (user.name, user.email) in its repository. No test reads ~/.phax, a real ~/.claude, ~/.codex or ~/.vibe, the global git config or the real `gh`, starts a real agent session or provider probe, or holds a fact the release cut changes (a snapshot named `next`, the version in package.json): sessions use the fake backend (src/infra/fakes/backend.ts), prompts the fake Prompt port, probes the fake Shell, and GitHub `makeFakeGitHub()`.

## Required commands

- `pnpm gen:usage-spec`
- `pnpm docs:cli`

Both commands are already in `security.agentCommands` in phax.json: `pnpm gen:usage-spec` rewrites phax.usage.kdl and `pnpm docs:cli` rewrites the README's generated CLI block. No security configuration change is needed. The skills that teach `artifact decide`, `artifact new` and `artifact approve` (phax-cli, phax-spec, phax-planning, phax-decide-spec, phax-decide-plan) keep working as written: what they say of these commands (exit 12 for an artifact refusal, `--json` and `--by` needing `--verdicts`, interactive decide needing a terminal) stays true. The plan declares no skill file, so the run needs no `--allow-skill-edits`.

## Technical arbitrations

- Output contracts. The spec creates no format beyond plan 1's four (§6 `package`), so no output in this plan carries a `$schema`; every value an output holds is required, with null for what is absent, except where a byte-for-byte object omits a key today. The artifact transitions answer `{ status, previousStatus, path, approvedBaseline, approvedBy, reopenedBy, deletedRecord, boundPlans, commit, written }`; `artifact new spec|plan` without `--headless` answers `{ path, kind, sourceSpec, completesSpec, written }`; with `--headless` `{ path, sidecarPath, commit, record, written }`, `record` the authoring record's outcome (written with its key, off, or not written with its warning). `artifact decide --verdicts --json` keeps today's object's twelve keys in today's order (artifact, status, session, provider, model, requestedModel, effort, verdicts, open, diff, commit, decisionId), then gains `written` (the artifact and its sidecar) and `record` (the decision record's outcome), and is written two-space indented with one trailing newline as §5.2 requires: not byte for byte, since today it is one compact line and its record line went to stderr. Interactive `artifact decide` answers `{ kind, path, commit, written, record }` by outcome (nothing, undecided, declined, committed). `agent resolve --json` keeps today's object byte for byte (today it is already `JSON.stringify(resolution, null, 2)`; `selected.thinking` stays absent when the resolution has none). `agent models` answers the routing table and priority it prints, `agent probe` `{ providers: [{ provider, available, enabled }] }`, `agent setup providers` and `agent setup mistral-vibe` their use case's result with `written`. `init` answers created (configPath, schemaPath, schemaReference, interactive, written) or aborted; `archive` `{ qualifiedName, crossProject }`. `prune --json` keeps today's object byte for byte for every outcome it can answer under --json (see q-prune-json), and `unlock` answers what q-unlock-answer decides, with `removed` one of `stale` (the holder's process is gone), `expired` (the lock outlived its lifetime), `forced` or `none`. Loss accepted: decide's object loses its one-line layout and gains two keys, and a reader of these answers gets no `$schema` to validate them by URL, only the contract `--json-schema` prints.
- Commands that prompt or hand over the terminal, and `--json` (§5.20). `artifact decide` declares `prompts` when `--verdicts` is absent (it opens an interactive session) or `--by` is absent (a terminal stands for the operator); `artifact approve` and `artifact reopen` declare it when `--by` is absent, because a terminal standing for the operator is a person's gesture, not a program's; `init` declares it unless `--yes`, whether or not stdin is a terminal (its predicate reads only the call); `prune` per q-prune-json. Each is refused under `--json` with the program's `refused` code before anything starts; without `--json` each runs as today. `unlock`, `archive`, `stale`, `abandon`, `complete`, `artifact new`, `artifact schema`, the migrations and the `agent` commands never wait on a person and declare nothing. Decide's own refusal `✗ --json needs --verdicts` (exit 12) becomes the runner's prompting refusal (exit 64). Loss accepted: `approve --json` and `reopen --json` from a terminal need `--by operator` written out, and `init --json` needs `--yes` even off a terminal.
- The two stdin documents use the port's stdin flag with a required value (§9b q-stdin-flag-value): `--verdicts <file|->` reads a JSON document whose contract is the decide-verdicts file schema of src/schemas/decideVerdicts.ts, and `--brief <file|->` a text document (`text: true`); neither is `required`, so stdin is never opened when its flag is absent (§5.14). A terminal stdin, an unreadable file and a document that does not decode are refused by the runner before `run`, with exit 64 and a refused line naming the path or stdin and the field (§5.15, §5.16), where today decide answers each with exit 12 and `artifact new` blocks on a terminal. A verdicts file that decodes but does not fit the artifact (an unknown question or option, another artifact's path, a missing note) is refused by decide's `check` (a gain, below) before `run`, with a refused line naming the field, as §6 shows (`"path":["verdicts",0,"chosen"]`, `"expected":"an option id of q-cadence"`, text `error: verdicts.json: verdicts[0].chosen is not an option of q-cadence`); an artifact that cannot be read passes the check and is refused by `run` as today. The document reaches `run` as read (its origin and text, a gain), so the decision folder keeps verdicts.json byte for byte, and the retry lines keep naming `--verdicts -`/`--brief -` with `(pipe the same … again)`. decideVerdicts gains a source variant `{ kind: "read", text }`, the only one the definition passes; its `stdin` and `file` variants and their refusals stay for the use case's own tests. `--brief` is still required with `--headless` by `run` (exit 12, today's sentence). Loss accepted: these refusals exit 64 with the runner's text instead of 12 with today's sentence, `--brief` given without `--headless` is now read and refused when unreadable where today it is ignored, and the use case keeps two reading paths its CLI no longer takes.
- Authoring and decide sessions. Their progress lines are written as they happen: what they print on stdout today (`authoring <kind> <slug> — <model> / <effort>`, decide's session and model lines, and interactive decide's body diff and verdict lines before its confirmation) through the gain `say`, on stdout without `--json`; what they print on stderr today (authoring's retry warning, decide's warnings) through `progress`. Under `--json` both are note lines at the moment they happen (§5.19). The answer's record outcome, its record warnings and its push warning are written after the answer as today: the record line by the render, the warnings as `notes`. A session's failure is a declared error with today's code (exitCodeForAuthoringError: 5, 8, 12, 14 or 1) and today's text on stderr (renderSessionFailure's lines with the retry command, then the follow-ups); its `written` is empty when nothing reached the repository (a refused or failed session) and lists the artifact and its sidecar when the commit failed after they were written (ArtifactCommitFailedError's paths), under `--json` in the error line's `written` (§5.18). Loss accepted: under `--json` the `record <key>` line no longer reaches stderr; it is the answer's `record`.
- Written files. A command reports as written-file records (src/cli/commandLibrary/contract/written.ts) the files that are its deliverable, each digest computed from the bytes read back after the write, a path inside the repository from its root and one outside (~/.phax, ~/.vibe) absolute, as plan 2 did. The transitions report what their commit holds and they wrote: the artifact at its path after the transition (in archive/ after `complete` or `abandon`), its sidecar when the transition rewrote or moved it, and its approval record file when approve wrote it; a record a transition deleted is its `deletedRecord`, never a written-file record, and the commit is its `commit`, never a file. transitionArtifactBy returns these paths. `artifact new` reports the artifact (and with `--headless` its sidecar), decide the artifact and its sidecar it committed (the hand-authored artifact alone when it has no sidecar), `migrate-approvals` each record file it wrote, `migrate-documents` each sidecar and body it rewrote, `init` phax.json and phax.schema.json, `agent setup providers --write` providers.json, its backup and a scaffolded model-routing.json, `agent setup mistral-vibe --install-model-aliases` ~/.vibe/config.toml and its backup. Phax's own side state is not reported: the extraction cache seeded by plans, the decide and authoring folders under the state root, the records branch, locks, the registry, archived worktrees, and prune's kept cost-ledger copies. None of these commands answers one document, so none takes `--out` (a new option §7 forbids). A command that fails after writing lists what it wrote in its error's `written`: decide's and headless authoring's failed commit, `migrate-documents`' failed commit, and a transition whose commit failed. Loss accepted: a reader of `prune --json` learns of the kept cost ledgers only from the long help.
- Gains the port takes in phase-01, each written as the library would carry it, with a doc comment and a conformance case, because without them these commands cannot keep their streams and declarations (§5.4, §5.21, §7): an option's short alias, an annotation on its field, declared to Commander as `-y, --yes`, shown in help and written by the usage spec as `flag "--yes -y"` (prune here, `resume` and `reset-phase` in plan 4); `say`, a progress line written on stdout at once without `--json` and as a note line under it, for the lines a person reads on stdout while a command runs; `document`, the stdin document as read (its origin, `stdin` or the path as given, and its text) handed to `run` beside the decoded input; `check`, an effect a command declares over its decoded input and document, run after decoding and `prompts` and before `run`, whose `Refused` failure (source, path, expected, text) the runner writes as a refused line with the program's `refused` code; and a group's `retired` words, each with the sentence that names its replacement, refused by the runner with that sentence and the `refused` code, never listed in help, the catalogue or the usage spec. The bridge's help-only stub declares a required-value stdin flag as `--<flag> <file|->`, and an alias as `-y, --yes`. Loss accepted: five more items for the published package to take upstream.
- The retired `phax artifact archive`. Today a hidden Commander command refuses it with `unknown transition "archive" — the completion transition is: phax artifact complete <path>` and exit 1. Once the runner holds `artifact` whole, the group declares `archive` as a retired word with that sentence: same sentence on stderr, exit 64, a refused line from `command` under `--json`, never in help or phax.usage.kdl (it is hidden there today). Loss accepted: the undocumented exit 1 becomes 64, as every other call no command accepts (§9b q-program-codes).
- Where the definitions live: one file per family under src/cli/definitions/, as plans 1 and 2 did: artifactTransitions.ts (approve, reopen, stale, abandon, complete, from one table), artifactSchema.ts, artifactMigrations.ts, artifactDecide.ts (`makeArtifactDecideCommand(deps)` and decide's renders), artifactNew.ts (`makeArtifactNewSpecCommand(deps)`, `makeArtifactNewPlanCommand(deps)`), artifact.ts (the `artifact` group and its nested `new` group, with the help and examples of cliDocs `artifact` and `artifact new`), agent.ts (the `agent` group, its nested `setup` group and a probe factory taking the Shell layer), init.ts (`makeInitCommand(layers)`), unlock.ts, archive.ts and prune.ts (`makePruneCommand(layers)`). A factory takes the layers a test swaps (backend, session, prompt, terminal, GitHub, shell), its program instance the real adapters. A moved command's Commander registration is deleted from src/cli/program.ts or its register function, and its cliDocs entry is deleted, not kept beside the definition. A file under src/cli/commands/ is deleted, or kept only as the run functions existing tests import, each a `runThroughOutput` composition (runArtifactTransition, runCreateArtifact, runArtifactSchema, runArtifactMigrateApprovals, runArtifactMigrateDocuments, runAgentModels, runAgentResolve, runAgentProbe, runAgentSetupProviders, runAgentSetupMistralVibe, runInit, runUnlock, runArchive, runPrune). runArtifactDecide and runCreateArtifactHeadless are deleted, because the runner reads their documents: their tests move to the runner's harness (a memory Io over the definition factory with fake layers), keeping their assertions except those the spec changes, each named in the phase's handoff. src/cli/commands/pruneRegister.ts and src/cli/commands/artifactDecide.ts are deleted. src/cli/cliCompleters.ts keeps its `short-name` entry for plan 4's commands; `unlock` and `archive` declare the completer on their argument's annotation, and the generator writes one `complete "short-name"` node.
- The bridge after this plan. PARTIAL_GROUPS is empty (the constant stays, empty, until plan 4 removes the bridge): `artifact`, `artifact new`, `agent` and `agent setup` are whole groups, each mounted as a help-only group stub at its place. Commander keeps root help, `--version`, the `--usage` catch in main.ts, the phase guard of its preAction hook, and plan 4's commands: `enter`, `enter-phase`, `shell`, `open`, `run`, `review-handoff`, `publish-pr`, `review-compliance`, `review-code`, `adjust-plan`, `resume` and `reset-phase`. The bridge keeps routing, the runner's phase guard (exit 1, a refused line under `--json`), the stubs, runThroughOutput and the usage splice. Loss accepted: until plan 4 each new whole group's block in phax.usage.kdl gains `subcommand_required=#true`, allowed by plan 2's rule.
- Long help and the usage spec. Every moved command and group keeps its help, long help, examples and argument and option help word for word, and every option its value name through its field's `identifier` (`--by <arbiter>`, `--verdicts <file|->`, `--brief <file|->`, `--spec <path>`, `--question <id>`, `--doctrine <file>`, `--model <model>`, `--model <id>`, `--effort <effort>`, `--effort <level>`). The frozen-file test's allowlists grow by `--json` on each moved command (reworded where it declared its own: `artifact decide`, `agent resolve`, `prune`), `subcommand_required` on each new whole group, and one reworded long help: `artifact decide`, whose verdicts paragraph says today that a bad file, a terminal stdin and `--json` without `--verdicts` exit 12 and that `--json` prints one object with record lines on stderr; it is reworded to say they are refused with exit 64 and that the object is indented and carries `written` and `record`. No other long help is reworded.
- Tests. Each family adds its `--json`, error-sentence and written-file tests in the phase that moves it, and plan 2's runnerCommandContracts.test.ts covers every moved command's `--json-schema`, `--help` and undeclared option as it joins `phaxProgram`. The two stdin documents and their sessions, the family whose behaviour changes most and whose refusals the spec states, get an acceptance pair (phase-03, passed by phase-04), run through the runner's memory Io over the definition factories with fake layers, because a session cannot run for real and a terminal stdin cannot be simulated in a spawned process. Every acceptance test carries its own `.fails` marker on its own `it`, fails on its own assertion against phase-03's stubs, and is changed by the passing phase only by removing that marker. Existing tests keep passing with their assertions unchanged; a test whose harness is a deleted registration or run function gets the runner's harness, and an assertion the spec changes (decide's read refusals from 12 to 64, decide's `--json` layout) is the only kind rewritten, each named in the handoff and in docs/upgrading.md. Loss accepted: the other families' tests are written with the code, not frozen before it.
- docs/upgrading.md's 0.34.0 entry gains one bullet per family, naming each change a person or a script can observe (new `--json` answers, refusals moved to 64, decide's `--json` layout and keys, the retired `artifact archive` exit, `--json` refusals of prompting calls, note lines under `--json`). It never says a moved command is unchanged. The docs page reference/json-output (§11) waits for plan 4.

## Arbitrated questions

### q-prune-json — `prune --json` never prompts, as today (§10). Today, without `--yes` or `--dry-run`, it prints the preview document on stdout, `✗ prune refused: --json never prompts; pass --yes to proceed or --dry-run to preview only` on stderr, and exits 1. A command's run cannot tell whether `--json` was given. What does `prune --json` answer without `--yes` or `--dry-run`?

- refuse-unconfirmed — prune declares that it prompts unless --yes or --dry-run: under --json the call is refused with 64 before anything runs; without --json a declined confirmation and a missing TTY are declared errors with today's sentences and exit 1, the preview written as say lines before the prompt — abandons: today's answer to `prune --json` without --yes or --dry-run: the preview document on stdout and exit 1 become one refused line and exit 64, a code a script checking for 1 would miss
- mode-in-run — a further gain: run is told whether --json is given; prune keeps today's answer under --json (preview document, refusal note, exit 1), and its object gains an `outcome` key so that its render and notes can tell the declined, refused and previewed outcomes apart — abandons: the library's rule that a command's run is blind to --json, so that one call answers the same value in both modes, for one more upstream gain; and prune's object byte for byte, which gains a key

Recommendation: refuse-unconfirmed — §5.20 already says a call that would prompt is refused under --json, and an agent that wants the preview has --dry-run, whose answer stays byte for byte. The other option keeps one exit code by teaching every run to branch on the mode, the one thing the output contract exists to prevent, and still changes prune's object.

Decision: refuse-unconfirmed — by operator (Rémy Loubradou), 2026-11-04
Why: §5.20 refuses a call that would prompt under --json; an agent wanting the preview passes --dry-run, whose answer stays byte for byte. Teaching run the mode would break the output contract's rule for one command. Advocate: The strongest case for mode-in-run: it keeps today's observable behaviour of prune --json without --yes or --dry-run (preview document on stdout, exit 1), so no script checking for exit 1 breaks, at the price of one more upstream gain. Principles: C2, C4. Reversibility: cheap. Revised: none. Phase: phase-06.

### q-unlock-answer — §6's normative surface shows `phax unlock garden-sync --json` answering `{ "shortName": "garden-sync", "removed": "stale" }`. Today's text names the qualified run (`Stale lock for "garden.garden-sync" removed (process no longer running).`), and a render reads only the encoded answer. What does unlock answer?

- three-keys — `{ shortName, removed, qualifiedName }`, `removed` one of stale, expired, forced or none; the render writes today's sentences from the answer — abandons: §6's answer key for key: a third key a reader of the spec's example does not expect, after the two it shows
- two-keys — `{ shortName, removed }` exactly as §6; run writes today's sentence as a say line as it removes the lock, and the render writes nothing, which takes one more fix in the port (an empty render writes no line) — abandons: the rule every other command keeps, that its text is its render of its answer: unlock's text is no longer derivable from its JSON, and under --json the sentence becomes a note line

Recommendation: three-keys — A key added after the two §6 shows breaks no reader of those two, and keeps unlock's text a pure view of its answer like every other command's; the other option bends the port and the text rule for one command to keep the example's exact key set.

Decision: three-keys — by operator (Rémy Loubradou), 2026-11-04
Why: A third key after the two §6 shows breaks no reader of them, and keeps unlock's text a pure view of its answer like every other command's. Advocate: The strongest case for two-keys: it matches §6's normative example key for key, so a reader built from the spec sees exactly the answer it documents, and no extra key has to be explained. Principles: C1, E0. Reversibility: cheap. Revised: none. Phase: phase-06.

## Decision log

- 2026-11-04 q-prune-json decided refuse-unconfirmed — operator (Rémy Loubradou)
- 2026-11-04 q-unlock-answer decided three-keys — operator (Rémy Loubradou)

---

## phase-01 — Runner gains: short aliases, stdout progress, the document as read, a document's check and retired words {#phase-01-runner-gains}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium
**Assignment reason:** The phase designs five contract members the port does not hold, and their order in the runner, across the contract, the Commander adapter, the bridge and the conformance suite.

The port and the bridge can carry the lifecycle and authoring commands without changing their streams or declarations: an option has a short alias, a running command writes a person's line on stdout at once, `run` receives its stdin document as read, a command checks its document against the world before it runs, a group refuses a retired word with its own sentence, and the help-only stub of a required-value stdin flag declares `<file|->`. Each is a conformance case; no command moves and phax.usage.kdl does not change.

### Detailed instructions

- Read this plan's Technical arbitrations (gains, stdin documents, sessions, retired archive, tests), src/cli/commandLibrary/contract/{command,define,shapes,usage,catalogue,messages,index}.ts, src/cli/commandLibrary/commander/{commanderAdapter,run,stdin,undeclared,suggest}.ts, contract/conformance/cases.ts and suite.ts, tests/unit/commandLibrary/conformance.test.ts (its CONTRACT_ONLY list), tests/unit/commandLibrary/commander/{stdinFlag,reading,groups,help,usage}.test.ts, src/cli/bridge.ts (mountStub, runThroughOutput) and tests/unit/cli/bridge.test.ts. Check every Effect API against the installed `effect` in node_modules.
- Gain, short alias: an option's field carries an alias annotation (export its id from the contract, as CompleterAnnotationId is), one letter. `flagShapes` gives `alias`; the Commander adapter declares `-y, --yes`; help shows `-y, --yes`; the catalogue lists it on the option's entry; `usageSpec` writes `flag "--yes -y"`, as phax.usage.kdl writes prune's today. A program where two options of one command share an alias, or an alias collides with `-h`, stops as misdeclared (§5.10). Conformance case `flags.short-alias`.
- Gain, say: `RunContext.say(text)`, the progress line for a person on stdout: without `--json` one line on stdout at once (an empty text writes nothing), under `--json` a note line on stderr like `progress`. Doc comment: for the lines a command writes on stdout while it runs (before a prompt, before a session), never its answer. Conformance case `progress.say-on-stdout`, asserting the order of stdout lines against the render's in both modes.
- Gain, the document as read: `RunContext.document`, set when the command declares `stdin` and a document was read: `{ origin: { kind: "stdin" } | { kind: "file", path }, text }`, the path as the call wrote it and the text as read before decoding; undefined otherwise. Conformance case `stdin.document-as-read` (file and stdin, JSON and text).
- Gain, a document's check: `CommandDef.check?: (context: { input, document }) => Effect<void, Refused, R>`, `Refused` a tagged class exported by the contract with `source`, `path`, `expected` and `text`. The runner runs it after decoding and after the `prompts` refusal, before `run`; a `Refused` failure is written as one refused line (its fields, the program's `refused` exit) under `--json` and as its text then the refusal hint without, exiting the `refused` code; any other failure or a death is a defect. Conformance case `stdin.check-refused`: the check's refusal runs nothing, a passing check runs `run`.
- Gain, retired words: `defineGroup({ retired: { [word]: sentence } })`. A call naming the group then a retired word, at any depth, is refused with the sentence (then the hint without `--json`; one refused line with `source` "command", `path` the words, `expected` "a command of <group>" under it) and the `refused` code. A retired word is never in help, the catalogue, `suggest`'s candidates or the usage spec; a retired word equal to a command's name stops the program as misdeclared. Conformance case `groups.retired-word`.
- src/cli/bridge.ts: `mountStub` declares a stdin flag with `valueRequired` as `--<flag> <file|->` (the optional `[path]` form only without it) and an aliased option as `-<a>, --<option>`; `runThroughOutput` hands its run `say` (to `out.log`), `progress` (to `out.warn`), `document` from a new optional `document` option, and runs the command's `check` before `run`, answering the program's `refused` code with the check's text through `out.error`. Extend tests/unit/cli/bridge.test.ts for the two stub forms and runThroughOutput's check and say.
- Write tests/unit/commandLibrary/commander/lifecycleGains.test.ts: each gain through `runner.run` over the memory Io of tests/unit/commandLibrary/commander/support/memoryIo.ts, beyond the conformance cases: `-y` and `--yes` decode alike and an unknown `-z` is refused with 64; `say` lines precede the render on stdout and become note lines under `--json`; `document` carries `stdin` or the path as written; a check refusal names its field under `--json` and runs nothing; a retired word is refused with its sentence at depth two and absent from `--help`.
- Add each new case to CONTRACT_ONLY in tests/unit/commandLibrary/conformance.test.ts only if it holds without a runner. Run `pnpm gen:usage-spec`: phax.usage.kdl must not change in this phase.

### Planned files to create

- `tests/unit/commandLibrary/commander/lifecycleGains.test.ts`

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
- `src/cli/commandLibrary/commander/stdin.ts`
- `src/cli/commandLibrary/commander/shape.ts`
- `src/cli/commandLibrary/commander/undeclared.ts`
- `src/cli/commandLibrary/commander/suggest.ts`
- `tests/unit/commandLibrary/conformance.test.ts`
- `tests/unit/commandLibrary/contract/exports.test.ts`
- `tests/unit/commandLibrary/commander/exports.test.ts`
- `tests/unit/commandLibrary/commander/stdinFlag.test.ts`
- `tests/unit/commandLibrary/commander/groups.test.ts`
- `tests/unit/commandLibrary/commander/usage.test.ts`
- `scripts/generate-usage-spec.ts`
- `phax.usage.kdl`
- `knip.json`

### Boundary contracts

Producer: the port's contract (src/cli/commandLibrary/contract/index.ts) and runner. Consumers: phases 02 to 06's definitions. Contract: an alias annotation on an option's field; `RunContext.say(text)`; `RunContext.document` as `{ origin, text }` or undefined; `CommandDef.check` failing with `Refused { source, path, expected, text }`; `defineGroup({ retired })`. Producer: src/cli/bridge.ts. Consumers: src/cli/program.ts, the generator and the kept run functions. Contract: stubs declare `--<flag> <file|->` and `-<a>, --<option>`, and runThroughOutput runs `check` and hands `say`, `progress` and `document`.

### Test strategy

- an aliased option decodes from its short and long forms alike, and shows as -y, --yes in help and as flag "--yes -y" in the usage spec — small · example · the flags.short-alias case's decoded input, help text and KDL line · in-phase · ac-usage-parity
- a say line reaches stdout at once and before the render without --json, and is a note line on stderr under it — small · example · the memory Io's ordered stdout and stderr writes · in-phase
- run receives the document as read, with its origin as the call wrote it and its text before decoding — small · table · the recorded context for file and stdin, JSON and text documents · in-phase · ac-stdin-file-or-dash
- a check's refusal writes one refused line naming its field, exits 64 and runs nothing; a passing check runs run — small · example · the stdin.check-refused case's refused line, exit code and untouched run · in-phase · ac-stdin-bad
- a retired word is refused at any depth with its sentence and 64, and never appears in help, the catalogue or the usage spec — small · example · the groups.retired-word case's stderr, exit code, help and KDL · in-phase
- a duplicated alias or a retired word naming a command stops the program as misdeclared — small · example · the defect exit and the offending command named on stderr · in-phase · ac-misdeclared
- a required-value stdin flag's stub declares <file|->, and runThroughOutput runs the check and hands say, progress and document — small · example · the stub's Commander option and the OutputPort's recorded lines · in-phase
- phax.usage.kdl is unchanged by this phase — small · metamorphic · the frozen pre-change file compared node by node · in-phase · ac-usage-parity

### Implementation order

1. command.ts and define.ts: alias annotation, say, document, check and Refused, retired
2. shapes.ts, usage.ts and catalogue: alias and retired words
3. commanderAdapter.ts and run.ts: alias, say, document, check, retired refusal
4. conformance cases and lifecycleGains.test.ts
5. bridge.ts stubs and runThroughOutput, bridge tests

### Excluded scope

- Moving any command (phases 02 to 06).
- Any change to phax.usage.kdl's content.
- A run that is told whether --json is given, or an empty render that writes nothing: phase-06 adds one only if q-prune-json or q-unlock-answer asks for it.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

Give each new contract member's exact shape and export (the alias annotation id, `RunContext.say`, `RunContext.document`, `CommandDef.check`, `Refused`, `Grouping.retired`), the order the runner applies decode, prompts, check and run, the conformance case ids added and whether each is in CONTRACT_ONLY, and the refused lines the check and a retired word write. Give runThroughOutput's new option and how it maps say and progress. Explain any deviation from the planned file lists.

### Commit subject

`feat(cli): short aliases, stdout progress, the document as read, checks and retired words on the runner`

### Commit body

Give the ported command library what the lifecycle and authoring commands need to keep
their streams and declarations: an option's short alias, a progress line written on stdout
while a command runs, the stdin document handed to run as read, a check that refuses a
document against the world before run, and a group's retired words refused with their own
sentence. Each is a conformance case.

The bridge's help-only stubs declare a required-value stdin flag as <file|-> and an aliased
option with its letter, and runThroughOutput runs a command's check.

---

## phase-02 — The artifact transitions, schema and migrations on the runner {#phase-02-artifact-transitions}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

`phax artifact approve`, `reopen`, `stale`, `abandon`, `complete`, `schema`, `migrate-approvals` and `migrate-documents` are command definitions on the runner. Under `--json` each answers one object, the transitions and migrations listing the files they wrote; without it each prints today's text, sentences and codes. `artifact` stays a group Commander holds in part, with `decide` and `new` its.

### Detailed instructions

- Read this plan's Technical arbitrations (output contracts, prompting commands, written files, definitions, long help), src/cli/definitions/{program,artifactStatus,shared,schema,records}.ts, src/cli/bridge.ts (`mountRunnerStub`, `runThroughOutput`), src/cli/commands/artifact.ts in full, src/cli/cliDocs.ts (the eight commands' entries), src/app/artifactStatus.ts (transitionArtifactBy and its write set), src/app/migrateApprovals.ts, src/app/migrateDocuments.ts, src/domain/artifact/render.ts, and the tests of these commands (tests/unit/cli/artifact.test.ts, tests/integration/artifactReopen.test.ts, migrateDocuments.test.ts, approvalAttribution.test.ts).
- src/app/artifactStatus.ts: ArtifactTransitionResult gains `written: readonly string[]`, the repo-relative paths the transition wrote and committed (the artifact at its path after the transition, its sidecar when rewritten or moved, its approval record when written), never a deleted one. If migrateApprovals' or migrateDocuments' report does not already name the paths they wrote, they gain the same field.
- src/cli/definitions/artifactTransitions.ts: one definition per transition from a table (name, summary, target, takesBy), in today's order approve, stale, abandon, complete, reopen. Args `<path>` (today's help). approve and reopen: flag `by` with identifier `arbiter` and today's help, and `prompts: (input) => input.flags.by === undefined`. Output `{ status, previousStatus, path, approvedBaseline, approvedBy, reopenedBy, deletedRecord, boundPlans, commit, written }`, null for each absent value, `written` the records of the result's paths read back after the commit. Render today's lines in today's order (Status with its deleted-record form, Approver, Reopened-By, Bound, Path for the terminal targets, Baseline, Commit). Errors: every tag transitionArtifactBy fails with, exit by exitCodeForError (12 for the lifecycle refusals), text its message; a failed commit's error lists its written files.
- src/cli/definitions/artifactSchema.ts: args `<kind>` as a literal union spec | plan | verdicts with today's help (choices as today). It answers a document through the `document` hook: today's bytes, `JSON.stringify(schema, null, 2)` plus one newline, in both modes, format null, no `--out`.
- src/cli/definitions/artifactMigrations.ts: migrate-approvals answers its report with `written` (each record file), render renderMigrationReport's lines, notes one renderOrphanRecordWarning line per orphan; migrate-documents answers its report with `written` (each sidecar and body rewritten), render renderDocumentMigrationReport's lines; a config error exits 1 with `Config error: …`, other errors exitCodeForAuthoringError's codes with their messages, a failed commit listing its written files.
- Each definition moves its help, long help and examples word for word from cliDocs and its argument and option help from today's registration, and provides its layers inside its run, as plan 2's definitions do. Delete the eight cliDocs entries.
- src/cli/definitions/program.ts: the partial `artifact` group lists `status`, then the five transitions, `schema`, `migrate-approvals` and `migrate-documents`. src/cli/commands/artifact.ts: replace each registration by `mountRunnerStub(artifactCmd, phaxProgram, ["artifact", <name>])` at its place, so that help keeps today's order; keep `decide`, `new`, `new spec`, `new plan` and the hidden `archive` as Commander's; keep runArtifactTransition, runCreateArtifact, runArtifactSchema, runArtifactMigrateApprovals and runArtifactMigrateDocuments with their signatures, runArtifactTransition, runArtifactSchema and the migrations as `runThroughOutput` compositions.
- Write tests/integration/artifactTransitionsJson.test.ts, spawning `tsx src/cli/main.ts` in a temporary repository (isolateGit, a temporary PHAX home, the repository's own user.name and user.email): `artifact approve <draft spec> --by operator --json` answers the spec and its approval record as written-file records with repo-relative paths, a format or null and a `sha256:` digest of 64 lowercase hex digits, equal to the sha256 of the committed bytes (ac-written); `reopen --by operator --json`, `stale`, `abandon` and `complete --json` each answer one indented JSON value with only message lines on stderr; an illegal transition exits 12 with today's sentence without `--json` and one `error` line with `"exit":12` with it; `artifact approve <spec> --json` without `--by` writes one refused line, exits 64 and leaves the spec and the index untouched; `artifact schema spec|plan|verdicts` prints the same bytes with and without `--json`; `artifact migrate-approvals --json` with nothing to migrate answers its report and exits 0.
- Run `pnpm gen:usage-spec`. Extend tests/integration/usageSpecDeclarations.test.ts: MIGRATED_COMMANDS gains the eight commands in the program's order; nothing else is allowed. Run `pnpm docs:cli`.
- docs/upgrading.md, 0.34.0 entry, one bullet: the artifact transitions, `artifact schema` and the migrations answer through the runner; under `--json` the transitions and migrations answer an object listing the files they wrote; `approve --json` and `reopen --json` without `--by` are refused with 64 before anything is written; `artifact schema` prints the same bytes in both modes; under `--json` migrate-approvals' orphan warnings are note lines. Do not edit earlier entries.

### Planned files to create

- `src/cli/definitions/artifactTransitions.ts`
- `src/cli/definitions/artifactSchema.ts`
- `src/cli/definitions/artifactMigrations.ts`
- `tests/integration/artifactTransitionsJson.test.ts`

### Planned files to edit

- `src/cli/definitions/program.ts`
- `src/cli/commands/artifact.ts`
- `src/app/artifactStatus.ts`
- `src/cli/cliDocs.ts`
- `phax.usage.kdl`
- `README.md`
- `docs/upgrading.md`
- `tests/integration/usageSpecDeclarations.test.ts`

### Optional files that may be edited

- `src/app/migrateApprovals.ts`
- `src/app/migrateDocuments.ts`
- `src/cli/definitions/shared.ts`
- `src/domain/artifact/render.ts`
- `src/cli/bridge.ts`
- `scripts/generate-usage-spec.ts`
- `tests/unit/cli/artifact.test.ts`
- `tests/unit/cli/definitionsRender.test.ts`
- `tests/unit/arbitrationDocs.test.ts`
- `tests/integration/artifactReopen.test.ts`
- `tests/integration/migrateDocuments.test.ts`
- `tests/integration/cliProgram.test.ts`
- `tests/integration/docsCliDrift.test.ts`
- `docs/cli/reference.md`
- `knip.json`

### Boundary contracts

Producer: transitionArtifactBy (src/app/artifactStatus.ts). Consumer: the transitions' definitions. Contract: its result names the repo-relative paths it wrote and committed. Producer: `phax artifact approve|reopen|stale|abandon|complete|schema|migrate-approvals|migrate-documents`. Consumers: scripts, agents and the Claude Code mod. Contract: one object per call under `--json`, the files written as written-file records, message lines alone on stderr, today's text and codes without it.

### Test strategy

- artifact approve --by operator --json lists the spec and its approval record as written-file records with their committed bytes' digests — medium · example · the committed files' paths and the sha256 of their bytes · in-phase · ac-written
- each transition, schema and migration answers one indented JSON value under --json with only message lines on stderr — medium · table · JSON.parse of stdout and of each stderr line against the message shapes · in-phase · ac-json-every-command
- the existing tests of these commands pass with their assertions unchanged — medium · example · the existing tests' expected text and codes · in-phase · ac-text-unchanged
- an illegal transition keeps today's sentence and exit 12, and gives one error line under --json — medium · example · today's refusal sentence and exit code · in-phase · ac-error-sentence
- approve and reopen under --json without --by are refused with 64 before anything is written — medium · example · the refused line, the exit code and the spec's bytes and index before the call · in-phase · ac-no-person
- artifact schema prints today's bytes for each kind, with and without --json — medium · table · JSON.stringify of each schema with two-space indent and a newline · in-phase · ac-versioned-stable
- phax.usage.kdl differs from the frozen file only by --json on the eight moved commands — small · metamorphic · the frozen pre-change file compared node by node · in-phase · ac-usage-parity

### Implementation order

1. transitionArtifactBy's written paths (and the migrations' if needed)
2. artifactTransitions.ts, artifactSchema.ts, artifactMigrations.ts
3. program.ts group list, artifact.ts stubs and kept run functions, cliDocs deletions
4. artifactTransitionsJson.test.ts
5. usage spec, docs:cli, upgrading bullet

### Excluded scope

- `artifact decide`, `artifact new` and the retired `artifact archive` (phase-04).
- Holding `artifact` whole (phase-04).
- Changing the transitions' rules, write sets or commit messages.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

Give the three definition files, each command's input, output, errors with codes, `prompts` and notes, and the written field added to the use case results. Give the artifact group's runner command list and the stubs mounted in artifact.ts, the run functions kept and the tests that call them, and the usage allowlist entries added. Explain any deviation from the planned file lists.

### Commit subject

`feat(cli): the artifact transitions, schema and migrations answer through the command runner`

### Commit body

Write approve, reopen, stale, abandon, complete, schema, migrate-approvals and
migrate-documents as command definitions. Under --json the transitions and migrations
answer an object listing the files they wrote as written-file records; approve and reopen
refuse --json without --by, because a terminal standing for the operator is a person's
gesture. artifact schema prints the same bytes in both modes.

Without --json each command prints today's text and error sentences with today's codes.

---

## phase-03 — Acceptance tests of the stdin documents and their sessions {#phase-03-stdin-documents-acceptance}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium
**Acceptance phase:** passed by phase-04
**Acceptance test files:** `tests/integration/artifactStdinDocuments.test.ts`, `tests/fixtures/artifact/stdinDocumentsRepo.ts`

What `phax artifact decide --verdicts` and `phax artifact new --brief` answer on the runner is written as frozen acceptance tests: a document read from a file or from stdin alike, a terminal stdin and a bad document refused before anything runs, the Markdown brief handed to the session as read, `decide --json` refused without `--verdicts`, decide's answer under `--json`, and a failed commit's written files. Each fails today on its own assertion against stub definitions and is passed by phase-04.

### Detailed instructions

- Read this plan's Technical arbitrations (output contracts, prompting commands, stdin documents, sessions, written files, tests), phase-01's handoff (`say`, `document`, `check`), src/cli/commands/artifactDecide.ts and src/cli/commands/artifact.ts (runCreateArtifactHeadless), src/app/decideVerdicts.ts, src/schemas/decideVerdicts.ts, tests/helpers/decideVerdictsHarness.ts, tests/unit/decide/verdictsFixtures.ts, tests/integration/artifactDecideVerdictsCommand.test.ts, decideVerdicts.test.ts (its failed-commit test's pre-commit hook), artifactNewHeadlessCommand.test.ts (the fake backend answering a spec document), and src/cli/commandLibrary/contract/conformance/memoryIo.ts.
- Write the two stubs the tests load against, each failing recognizably. src/cli/definitions/artifactDecide.ts exports `interface ArtifactDecideDeps { backendLayer?, sessionLayer?, promptLayer?, terminalLayer?, githubLayer? }` (the layers of today's DecideCommandDeps) and `makeArtifactDecideCommand(deps)`, a `defineCommand` named `decide` with today's summary, `input: {}`, `exits: {}` and a run that dies with `not implemented: artifact decide on the runner (phase-04)`. src/cli/definitions/artifactNew.ts exports `interface ArtifactNewDeps { backendLayer?, githubLayer? }`, `makeArtifactNewSpecCommand(deps)` and `makeArtifactNewPlanCommand(deps)`, stubs of the same form named `spec` and `plan`. Neither is added to `phaxProgram`.
- Write tests/fixtures/artifact/stdinDocumentsRepo.ts: a builder that makes, in a temporary directory, a git repository (isolateGit) with its own user.name and user.email, phax.json, a Draft headless spec with its sidecar and two open questions from tests/unit/decide/verdictsFixtures.ts, a temporary PHAX home, and returns the paths, a valid verdicts text, a verdicts text whose first verdict chooses an option the question does not have, a Markdown brief text, the fake backend answers both sessions need, and `program(commands)`, a runner program (`defineProgram`: name phax, exits refused 64 and defect 70, the refusal hint) holding an `artifact` group with the given decide command and a nested `new` group with the given spec and plan commands. It reads nothing outside its temporary directories.
- Write tests/integration/artifactStdinDocuments.test.ts. Every test is its own `it.fails(...)`, runs `runner.run(program(...), io)` over a memory Io (its files, its stdin text, `stdinIsTerminal`, and a stdin effect that counts its reads) with process.cwd spied to the fixture repository, the factories given fake layers, and fails today on its own assertion (the stubs declare no argument or option, so today every call is refused with an undeclared argument or dies as a defect):
- `artifact decide <spec> --verdicts verdicts.json --by operator` and, on a fresh fixture, `--verdicts -` with the same text piped in both exit 0 and commit the same chosen option for each question in the sidecar; the first never reads stdin (ac-stdin-file-or-dash).
- `artifact decide <spec> --verdicts - --by operator` with `stdinIsTerminal` exits 64 at once, stderr naming `--verdicts`, stdin never read, no backend call; under `--json` one refused line whose `path` names `--verdicts` (ac-stdin-terminal).
- `--verdicts <bad file> --by operator --json` writes one refused line with `"source":"stdin"` and `"path":["verdicts",0,"chosen"]` and exits 64; `--verdicts missing.json --by operator --json` one refused line naming `missing.json` and exits 64; in both the spec, its sidecar and the index are byte for byte as before and no backend call was made (ac-stdin-bad).
- `artifact new spec <slug> --headless --brief brief.md` and, on a fresh fixture, `--brief -` with the same text piped in both exit 0 and the fake backend's prompt carries the brief's text under `## Brief`, the same in both; `--brief -` with `stdinIsTerminal` exits 64 at once naming `--brief`, with no backend call (ac-brief-text).
- `artifact decide <spec> --json` with no `--verdicts`, stdin and stdout terminals, writes one refused line, exits 64, and no session or backend call starts (ac-no-person).
- `artifact decide <spec> --verdicts verdicts.json --by operator --json` writes on stdout one JSON value indented by two spaces with one trailing newline, whose keys are today's twelve in order followed by `written` and `record`, and every stderr line parses as a message line (ac-json-every-command).
- With a pre-commit hook that exits 1 in the fixture repository, `artifact decide <spec> --verdicts verdicts.json --by operator --json` exits 12 and its one `error` line's `written` lists the spec and its sidecar, each with its repo-relative path and a `sha256:` digest of 64 lowercase hex digits (ac-written-on-failure).
- Change no other source file. The tests judge only what the spec and this plan's arbitrations state, through the factories and the runner, never a definition's internals.

### Planned files to create

- `tests/integration/artifactStdinDocuments.test.ts`
- `tests/fixtures/artifact/stdinDocumentsRepo.ts`
- `src/cli/definitions/artifactDecide.ts`
- `src/cli/definitions/artifactNew.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- `knip.json`

### Boundary contracts

Producer: phase-04's `makeArtifactDecideCommand(deps)`, `makeArtifactNewSpecCommand(deps)` and `makeArtifactNewPlanCommand(deps)`. Consumer: these acceptance tests, through the runner over a memory Io. Contract: the factories take the fake layers named by ArtifactDecideDeps and ArtifactNewDeps; `--verdicts <file|->` and `--brief <file|->` are read by the runner, refused with 64 and a refused line naming the path and field before any session; decide answers today's keys then written and record.

### Test strategy

- a verdicts document from a file and the same piped on stdin decide the same verdicts, and the file case never reads stdin — medium · metamorphic · the two runs' committed sidecar verdicts compared and the Io's stdin read count · acceptance · ac-stdin-file-or-dash
- --verdicts - with a terminal on stdin is refused at once with 64 naming --verdicts, without reading — medium · example · the refused line, the exit code and a stdin read count of zero · acceptance · ac-stdin-terminal
- a verdicts file choosing an unknown option, and a missing path, are refused with a refused line naming the path and the field, the spec untouched — medium · example · the refused line's source and path, the exit code and the spec's bytes before the call · acceptance · ac-stdin-bad
- a Markdown brief from a file and the same piped in reach the session as the same text, and a terminal stdin is refused naming --brief — medium · metamorphic · the fake backend's two prompts compared and the refused line · acceptance · ac-brief-text
- artifact decide --json without --verdicts is refused before any session starts — medium · example · the refused line, the exit code and the fake backend's empty call list · acceptance · ac-no-person
- decide --verdicts --json answers one indented JSON value with today's keys then written and record, with only message lines on stderr — medium · example · JSON.parse of stdout, its key order and each stderr line against the message shapes · acceptance · ac-json-every-command
- a decide whose commit fails lists the spec and its sidecar in its error line's written — medium · example · the error line's written records against the files left on disk · acceptance · ac-written-on-failure

### Implementation order

1. the two stubs
2. stdinDocumentsRepo.ts
3. artifactStdinDocuments.test.ts with a marker on each test
4. run the gate to see each marked test fail on its assertion

### Excluded scope

- Moving decide or new (phase-04).
- The interactive decide session's own text, tested in-phase by phase-04 through the existing tests.
- `artifact` and `artifact new` alone, held whole in phase-04 and covered in-phase.

### Verification

The `standard` gate profile in phax.json, with the configured acceptance provider judging the acceptance test files (authored).

### Expected handoff content

Give the stubs' exports and deps interfaces, what stdinDocumentsRepo.ts builds and returns (including `program(commands)`), and for each acceptance test the assertion it fails on today. Confirm every test carries its own `.fails` marker and that no other source file changed. Explain any deviation from the planned file lists.

### Commit subject

`test(cli): acceptance tests for the stdin documents of artifact decide and artifact new`

### Commit body

Freeze what decide --verdicts and new --brief answer once they move onto the runner:
a document from a file or stdin alike, a terminal stdin and a bad document refused with
64 before any session, the brief handed to the session as read, decide --json refused
without --verdicts, decide's answer under --json, and a failed commit's written files.

The tests load stub factories, and each is marked as an expected failure until the
phase that moves the two commands.

---

## phase-04 — artifact decide and artifact new on the runner, artifact held whole {#phase-04-decide-and-new}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high
**Assignment reason:** A passing phase whose acceptance tests are frozen, over two stdin documents and two agent sessions whose text, streams and codes must stay today's, with a check that crosses the runner, the domain and a use case: Opus at high, so the phase does not stop on a disagreement it could have avoided.

`phax artifact decide` and `phax artifact new spec|plan` are command definitions on the runner, reading `--verdicts` and `--brief` as stdin documents, and the runner holds `artifact` and `artifact new` whole, refusing the retired `artifact archive`. phase-03's acceptance tests pass with only their markers removed; without `--json` both commands print today's text on today's streams with today's codes, except the read refusals the spec moves to 64.

### Detailed instructions

- Read phase-03's acceptance test files and handoff, phase-01's handoff, this plan's Technical arbitrations (all of them), src/cli/commands/artifactDecide.ts and artifact.ts in full, src/cli/commands/sessionFailureOutput.ts, src/app/decideVerdicts.ts, decideArtifact.ts and authorArtifact.ts, src/domain/decide/verdicts.ts, src/schemas/decideVerdicts.ts, src/cli/definitions/{program,shared,artifactTransitions}.ts, src/cli/bridge.ts, and the tests of decide and new.
- src/domain/decide/verdicts.ts: add `bindVerdictsAt`, answering bindVerdicts' refusal as `{ path, expected, message }` (path the field in the file, e.g. ["verdicts", 0, "chosen"]; expected e.g. `an option id of q-cadence`); bindVerdicts keeps its signature and messages, mapping it. src/app/decideVerdicts.ts: the verdicts source gains `{ kind: "read", text }`, parsed and bound like the others, the text kept as read in the decision folder; the stdin and file variants stay.
- src/cli/definitions/artifactDecide.ts, replacing the stub: `makeArtifactDecideCommand(deps)`. Args `<path>`; flags `question` (identifier `id`), `by` (`arbiter`), `doctrine` (`file`), `model` (`model`), `effort` (`effort`), with today's help; stdin `{ flag: "verdicts", valueRequired: true }`, the decide-verdicts file schema with identifier `decide-verdicts`. `prompts`: verdicts absent or by absent. `check`: with a document, read the artifact and bind with bindVerdictsAt; a refusal is `Refused { source: "stdin", path, expected, text: "error: <origin>: <dotted path> <message>" }`; an artifact that cannot be read passes. Run: today's flag refusals (`--by needs --verdicts`, `--question and --verdicts are exclusive …`, exit 12, today's sentences), then decideVerdicts with `{ kind: "read", text }` and the origin as label, or decideArtifact; the use cases' `output.log` is `say`, `output.warn` is `progress`. Output with verdicts: today's twelve keys in order, then `written` and `record`; without: `{ kind, path, commit, written, record }`. Render: renderVerdictsReport's lines then the record line, or renderResult's lines; notes: the record and push warnings. Errors: exitCodeForAuthoringError's codes, text renderSessionFailure's lines with the retry command (` (pipe the same verdicts again)` after `--verdicts -`), then the follow-ups; ArtifactCommitFailedError's error carries `written`. Move renderVerdictsReport and verdictsReportJson here.
- src/cli/definitions/artifactNew.ts, replacing the stubs: spec and plan with today's args, `--headless`, `--brief` as a text stdin flag with a required value (identifier `brief`), `--model`, `--effort`, and for plan `--spec` (`path`), `--last`, `--not-last`. Without `--headless` createArtifact, output `{ path, kind, sourceSpec, completesSpec, written }`, render today's `created …` line. With it: `--brief` absent fails with today's sentence and 12, an invalid effort with today's sentence and 1, a config error `Config error: …` and 1; `say` writes `authoring <kind> <slug> — <model> / <effort>` before the session; authorArtifact's warnings are `progress`; output `{ path, sidecarPath, commit, record, written }`, render today's four lines, notes the record and push warnings; errors as decide's, the retry naming `--brief -` with ` (pipe the same brief again)`.
- src/cli/definitions/artifact.ts: the `artifact` group (help and examples from cliDocs `artifact`) holding, in today's order, status, approve, stale, abandon, complete, reopen, decide, the nested `new` group (help and examples from cliDocs `artifact new`) with spec and plan, schema, migrate-approvals and migrate-documents, and `retired: { archive: 'unknown transition "archive" — the completion transition is: phax artifact complete <path>' }`, its instance built with the real layers. program.ts uses it in place of the partial group. src/cli/bridge.ts: PARTIAL_GROUPS becomes empty, its comment saying plan 4 removes the bridge. src/cli/program.ts: replace registerArtifactCommand with `mountRunnerGroupStub(program, phaxProgram, ["artifact"])` at its place.
- Delete registerArtifactCommand, runCreateArtifactHeadless and the decide and new code from src/cli/commands/artifact.ts (keep runArtifactStatus and phase-02's kept functions), delete src/cli/commands/artifactDecide.ts, and delete the cliDocs entries of `artifact`, `artifact new`, `artifact new spec`, `artifact new plan` and `artifact decide`. Reword decide's long help as this plan's Long help arbitration says, and nothing else in it.
- Write tests/helpers/runnerCall.ts: run a program built of given commands over a memory Io, answering stdout, stderr and the exit code. Move to it the harness of tests/integration/artifactDecideVerdictsCommand.test.ts, sessionFailureReport.test.ts, decideFailureOrder.test.ts, artifactNewHeadlessCommand.test.ts, tests/unit/cli/artifactDecideVerdicts.test.ts and tests/unit/arbitrationDocs.test.ts (help read from the runner): their calls go through the factories with their fake layers, their assertions stay, except that a refused verdicts file now exits 64 with a refused line (§5.16) and the `--json` report is one indented value with `written` and `record` (§5.2); name each changed assertion in the handoff.
- Remove the `.fails` marker from each test of tests/integration/artifactStdinDocuments.test.ts. That is the only change to the acceptance test files; tests/fixtures/artifact/stdinDocumentsRepo.ts, tests/helpers/decideVerdictsHarness.ts and tests/unit/decide/verdictsFixtures.ts stay as committed. When a test cannot pass, fix the definitions, never the test; when the test itself is wrong, stop and say so in the handoff.
- Run `pnpm gen:usage-spec`. Extend tests/integration/usageSpecDeclarations.test.ts: MIGRATED_COMMANDS gains decide, new spec and new plan; REWORDED_JSON gains `artifact decide`; REWORDED_LONG_HELP gains `artifact decide`; the `subcommand_required` of `artifact` and `artifact new` is allowed by plan 2's rule. Run `pnpm docs:cli`.
- docs/upgrading.md, 0.34.0 entry, one bullet: decide and new answer through the runner; `--verdicts` and `--brief` are read before anything runs, a terminal stdin, an unreadable file and a verdicts file that does not decode or fit the artifact are refused with 64 and a refused line naming the field (decide answered 12 before, new waited on a terminal); `--brief` given without `--headless` is now read; `decide --json` without `--verdicts` is refused with 64; decide's `--json` object is indented and gains `written` and `record`, its record line no longer on stderr; progress lines are note lines under `--json`; `phax artifact` and `phax artifact new` alone are refused with 64 and their help; `phax artifact archive` keeps its sentence and exits 64.

### Planned files to create

- `src/cli/definitions/artifact.ts`
- `tests/helpers/runnerCall.ts`

### Planned files to edit

- `src/cli/definitions/artifactDecide.ts`
- `src/cli/definitions/artifactNew.ts`
- `src/cli/definitions/program.ts`
- `src/cli/bridge.ts`
- `src/cli/program.ts`
- `src/cli/commands/artifact.ts`
- `src/cli/commands/artifactDecide.ts`
- `src/app/decideVerdicts.ts`
- `src/domain/decide/verdicts.ts`
- `src/cli/cliDocs.ts`
- `phax.usage.kdl`
- `README.md`
- `docs/upgrading.md`
- `tests/integration/usageSpecDeclarations.test.ts`
- `tests/integration/artifactStdinDocuments.test.ts`
- `tests/integration/artifactDecideVerdictsCommand.test.ts`
- `tests/integration/sessionFailureReport.test.ts`
- `tests/integration/decideFailureOrder.test.ts`
- `tests/integration/artifactNewHeadlessCommand.test.ts`
- `tests/unit/cli/artifactDecideVerdicts.test.ts`
- `tests/unit/arbitrationDocs.test.ts`

### Optional files that may be edited

- `src/cli/definitions/shared.ts`
- `src/cli/definitions/artifactTransitions.ts`
- `src/cli/commands/sessionFailureOutput.ts`
- `src/cli/commands/runLayers.ts`
- `src/app/decideArtifact.ts`
- `src/app/authorArtifact.ts`
- `src/schemas/decideVerdicts.ts`
- `src/cli/introspect.ts`
- `scripts/generate-usage-spec.ts`
- `tests/unit/cli/artifact.test.ts`
- `tests/unit/cli/bridge.test.ts`
- `tests/unit/cli/runnerCommandContracts.test.ts`
- `tests/unit/decide/verdicts.test.ts`
- `tests/integration/cliProgram.test.ts`
- `tests/integration/docsCliDrift.test.ts`
- `docs/cli/reference.md`
- `knip.json`

### Boundary contracts

Producer: src/cli/definitions/artifactDecide.ts and artifactNew.ts. Consumers: the runner, holding `artifact` whole, and phase-03's acceptance tests. Contract: the factories of phase-03's stubs, the stdin documents read by the runner, decide's check refusing a misfit verdicts file before run, and today's text and codes otherwise. Producer: decideVerdicts (src/app/decideVerdicts.ts). Consumer: decide's definition. Contract: a `{ kind: "read", text }` source parsed, bound and kept as read. Producer: bindVerdictsAt (src/domain/decide/verdicts.ts). Consumer: decide's check. Contract: a refusal's field path, expected and message.

### Test strategy

- the existing decide and new tests pass under the runner's harness with their assertions unchanged, except the named ones the spec changes — medium · example · the existing tests' expected text, codes and commits · in-phase · ac-text-unchanged
- a session failure keeps today's sentences, retry line and code, and is one error line with an empty written under --json — medium · example · renderSessionFailure's lines and exitCodeForAuthoringError's code · in-phase · ac-error-sentence
- artifact and artifact new alone write their help on stderr and exit 64, while artifact new spec still runs — small · example · the runner contract test's whole-group rows and a blank spec created · in-phase · ac-groups
- phax artifact archive is refused with today's sentence and 64, and is absent from help and the usage spec — small · example · today's retired-verb sentence and the help text · in-phase
- bindVerdictsAt names the field and expected value of every binding refusal bindVerdicts makes, with the same message — small · table · bindVerdicts' messages for each refusal case · in-phase · ac-stdin-bad
- a decision folder keeps verdicts.json as the runner read it, byte for byte — medium · example · the piped bytes and the folder file's bytes · in-phase
- phax.usage.kdl differs from the frozen file only by the allowlisted --json, decide's reworded long help and the two groups' subcommand_required — small · metamorphic · the frozen pre-change file compared node by node · in-phase · ac-usage-parity
- no artifact definition imports commander — small · example · the architecture guard's import scan · in-phase · ac-no-parser

### Implementation order

1. bindVerdictsAt and decideVerdicts' read source
2. artifactNew.ts
3. artifactDecide.ts with its check, say and progress
4. artifact.ts group with retired archive, program.ts, PARTIAL_GROUPS, program.ts stub, deleted registrations and cliDocs entries
5. runnerCall.ts and the moved test harnesses
6. markers removed
7. usage spec, docs:cli, upgrading bullet

### Excluded scope

- The agent group and the root lifecycle commands (phases 05 and 06).
- Removing the bridge, the kept run functions or decideVerdicts' stdin and file sources (plan 4 and later).
- Changing a session's prompt, a sidecar, an authoring or decision record, or a commit message.
- The docs page reference/json-output (plan 4).

### Verification

The `standard` gate profile in phax.json, with the configured acceptance provider judging phase-03's acceptance test files (passed).

### Expected handoff content

Give the decide and new definitions' inputs, prompts, check, outputs, say and progress lines, errors with codes and texts. Confirm the acceptance test files changed only by their markers. List each test whose harness moved and each assertion changed, with the spec section that changes it. Give phaxProgram's command list and PARTIAL_GROUPS after the phase. Explain any deviation from the planned file lists.

### Commit subject

`feat(cli): artifact decide and artifact new answer through the command runner`

### Commit body

Write decide and new spec|plan as command definitions reading --verdicts and --brief as
stdin documents: a terminal stdin, an unreadable file and a verdicts file that does not
decode or fit the artifact are refused with 64 before any session, naming the field.
The sessions' progress lines are written as they happen, note lines under --json, and a
failed commit lists the files it left written.

The runner now holds artifact and artifact new whole, and refuses the retired artifact
archive with its sentence. Without --json both commands print today's text with today's
codes. The acceptance tests pass with their markers removed.

---

## phase-05 — The agent group on the runner {#phase-05-agent-group}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

`phax agent models`, `resolve`, `probe`, `setup providers` and `setup mistral-vibe` are command definitions, and the runner holds `agent` and `agent setup` whole. Under `--json` each answers one object, `agent resolve` today's object byte for byte and the setup commands the files they wrote; without it each prints today's text with today's codes.

### Detailed instructions

- Read this plan's Technical arbitrations (output contracts, written files, definitions, long help), src/cli/commands/agent.ts in full, src/app/vibeSetup.ts, providerSetup.ts and providerProbe.ts, src/cli/definitions/{program,shared,skills}.ts, src/cli/bridge.ts, and tests/unit/cli/agent.test.ts, tests/integration/agentSetupProviders.test.ts.
- src/cli/definitions/agent.ts: the group `agent` (today's summary) holding models, resolve, probe and the nested group `setup` (today's summary) with mistral-vibe and providers, in today's order. `makeAgentGroup(layers)` takes the Shell and FileSystem layers; the program instance uses the real ones.
- models: output the routing table and provider priority as runAgentModels prints them, render today's lines. resolve: flags `model` (required, identifier `id`) and `effort` (required, a string, identifier `level`), today's help; an effort outside THINKING_LEVELS fails with today's sentence and 2; output today's resolution object, its schema written so that encoding gives exactly `JSON.stringify(resolution, null, 2)` (key order kept, `thinking` absent when the resolution has none); render today's lines. probe: output `{ providers: [{ provider, available, enabled }] }`, render today's lines. A config that does not load exits 2 with today's message, in each.
- setup mistral-vibe: flags `dryRun` and `installModelAliases`; output the use case's result with `written` (~/.vibe/config.toml and its backup, absolute, only when written); render today's lines for each case. setup providers: flags `write`, `prune`, `withRouting`; output the use case's result with `written` (providers.json, its backup, model-routing.json when scaffolded, absolute); render today's lines. `Setup failed: …` exits 2.
- src/cli/definitions/program.ts: add the agent group where Commander lists `agent`. src/cli/program.ts: replace registerAgentCommand with `mountRunnerGroupStub(program, phaxProgram, ["agent"])` at its place. src/cli/commands/agent.ts keeps runAgentModels, runAgentResolve, runAgentProbe, runAgentSetupMistralVibe and runAgentSetupProviders only as `runThroughOutput` compositions for the tests that call them; delete registerAgentCommand.
- Write tests/integration/agentGroupJson.test.ts, through the runner over a memory Io with `makeAgentGroup` given a fake Shell (src/infra/fakes/shell.ts) and a temporary PHAX home, or spawning `tsx src/cli/main.ts` with `HOME` and the PHAX home temporary where no probe runs: models, resolve, probe and both setup commands answer one indented JSON value with only message lines on stderr; `agent resolve --json` writes the same bytes as `JSON.stringify(resolution, null, 2)` plus a newline for a model with and without a thinking level; an invalid `--effort` exits 2 with today's sentence and one error line under `--json`; `agent setup providers --write --json` lists providers.json and its backup as written-file records with absolute paths and `sha256:` digests; `agent` and `agent setup` alone write their help on stderr and exit 64, while `agent setup providers` runs. No test probes a real executable.
- Run `pnpm gen:usage-spec`. Extend tests/integration/usageSpecDeclarations.test.ts: MIGRATED_COMMANDS gains the five agent commands, REWORDED_JSON `agent resolve`; the `subcommand_required` of `agent` and `agent setup` is allowed by plan 2's rule. Run `pnpm docs:cli`.
- docs/upgrading.md, 0.34.0 entry, one bullet: the agent commands answer `--json`; `agent resolve --json` is unchanged in its bytes; the setup commands list the files they wrote; `phax agent` and `phax agent setup` alone are refused with 64 and their help.

### Planned files to create

- `src/cli/definitions/agent.ts`
- `tests/integration/agentGroupJson.test.ts`

### Planned files to edit

- `src/cli/definitions/program.ts`
- `src/cli/program.ts`
- `src/cli/commands/agent.ts`
- `phax.usage.kdl`
- `README.md`
- `docs/upgrading.md`
- `tests/integration/usageSpecDeclarations.test.ts`

### Optional files that may be edited

- `src/cli/definitions/shared.ts`
- `src/cli/bridge.ts`
- `src/cli/cliDocs.ts`
- `src/app/vibeSetup.ts`
- `src/app/providerSetup.ts`
- `src/app/providerProbe.ts`
- `scripts/generate-usage-spec.ts`
- `tests/unit/cli/agent.test.ts`
- `tests/integration/agentSetupProviders.test.ts`
- `tests/integration/agentCommandGrants.test.ts`
- `tests/integration/cliProgram.test.ts`
- `tests/integration/docsCliDrift.test.ts`
- `docs/cli/reference.md`
- `knip.json`

### Boundary contracts

Producer: src/cli/definitions/agent.ts (`makeAgentGroup(layers)`). Consumers: the runner, holding `agent` and `agent setup` whole, and tests with a fake Shell. Contract: today's text and codes without `--json`; one object per command under it, `agent resolve` byte for byte, the setup commands' written files with absolute paths.

### Test strategy

- every agent command answers one indented JSON value under --json with only message lines on stderr — medium · table · JSON.parse of stdout and of each stderr line against the message shapes · in-phase · ac-json-every-command
- agent resolve --json writes today's bytes, with and without a thinking level — small · table · JSON.stringify of the same resolution with two-space indent and a newline · in-phase · ac-versioned-stable
- the existing agent tests pass with their assertions unchanged — medium · example · the existing tests' expected text and codes · in-phase · ac-text-unchanged
- an invalid effort keeps today's sentence and exit 2, and is one error line under --json — small · boundary · today's sentence and exit code for a level just outside THINKING_LEVELS · in-phase · ac-error-sentence
- agent setup providers --write lists providers.json and its backup as written-file records — medium · example · the files under the temporary PHAX home and the sha256 of their bytes · in-phase · ac-written
- agent and agent setup alone write their help on stderr and exit 64, while agent setup providers runs — small · example · the runner contract test's whole-group rows and the dry-run text · in-phase · ac-groups
- phax.usage.kdl differs from the frozen file only by --json on the five commands and the two groups' subcommand_required — small · metamorphic · the frozen pre-change file compared node by node · in-phase · ac-usage-parity

### Implementation order

1. models, resolve and probe
2. the setup group
3. program.ts group, program.ts stub, kept run functions
4. agentGroupJson.test.ts
5. usage spec, docs:cli, upgrading bullet

### Excluded scope

- The root lifecycle commands (phase-06).
- Changing routing, probing or provider setup logic.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

Give the agent definitions' inputs, outputs, errors with codes and written files, and the factory's layers. Confirm agent resolve's bytes equal today's. List the run functions kept, the tests that call them and the usage allowlist entries added. Explain any deviation from the planned file lists.

### Commit subject

`feat(cli): the agent group answers through the command runner`

### Commit body

Write agent models, resolve, probe and setup providers|mistral-vibe as command
definitions, and let the runner hold agent and agent setup whole. agent resolve --json
keeps today's bytes; the setup commands list the files they wrote.

Without --json each command prints today's text and error sentences with today's codes.

---

## phase-06 — init, unlock, archive and prune on the runner {#phase-06-root-lifecycle-commands}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

`phax init`, `phax unlock`, `phax archive` and `phax prune` are command definitions on the runner. Under `--json` each answers one object (prune today's object byte for byte, unlock what q-unlock-answer decides), `init` and `prune` never wait on a person, and without `--json` each prints today's text on today's streams, prune's preview before its prompt, with today's codes.

### Detailed instructions

- Read this plan's Technical arbitrations and the decided q-prune-json and q-unlock-answer, phase-01's handoff (the alias annotation, `say`), src/cli/commands/{init,unlock,archive,prune,pruneRegister}.ts, src/app/initWizard.ts, src/app/prune.ts, src/domain/prune.ts, src/app/archive.ts, src/cli/definitions/{program,shared,path,records}.ts, src/cli/cliDocs.ts (init, archive, prune), and tests/integration/{initCommand,initWizard,pruneCommand,prune,archive}.test.ts and tests/unit/cli/init.test.ts.
- src/cli/definitions/init.ts: `makeInitCommand(layers)` (Prompt, FileSystem, Git, GitHub). Flags `force`, `yes` with today's help; `prompts: (input) => input.flags.yes !== true`. Output created `{ kind, configPath, schemaPath, schemaReference, interactive, written }` (phax.json and phax.schema.json) or aborted; render today's lines (the `Next:` line only when not interactive, `phax init aborted — no changes written.` with exit 0). Already initialized is a declared error, exit 1, text today's two lines; any other failure exit 1 with its message.
- src/cli/definitions/unlock.ts: args `<short-name>` with the short-name completer annotation and today's help; flag `force`. Output per q-unlock-answer, `removed` one of stale, expired, forced, none; render today's sentences (`No lock found for …`, `Lock for … forcibly removed.`, `Stale lock for … removed (process no longer running|lock expired).`). If two-keys was decided, write the sentence with `say` and add to the port, with a conformance case, that an empty render writes no line. A held lock is a declared error, exit 1, today's sentence; `Config error: …`, the resolve message and `Unlock failed: …` exit 1.
- src/cli/definitions/archive.ts: args `<short-name>` (completer annotation), flag `force`. Output `{ qualifiedName, crossProject }`; render `Target: <q>` when cross-project, then `Run "<q>" archived successfully.`. `Archive refused: …` and `Archive failed: …` exit 1, their text form carrying the `Target:` line on stdout when the run is cross-project; config and resolve errors exit 1 with today's sentences.
- src/cli/definitions/prune.ts: `makePruneCommand(layers)` (FileSystem, Git, Lock, Prompt). Args `[short-name...]` (variadic, today's help); flags `all`, `force`, `dryRun`, `yes` with the alias `y` and today's help. Output today's prune object (namespace, dryRun, runs, totals) byte for byte for nothing-to-prune, previewed and applied; verdict codes 1 and 3 as pruneExitCode answers them today; render today's lines. The preview is written with `say` line by line from onPreview, before the confirmation, as today. If q-prune-json decided refuse-unconfirmed: `prompts` holds unless `yes` or `dryRun`, and declined and confirmation-missing are declared errors, exit 1, text today's `✗ prune declined: nothing deleted.` and the no-TTY sentence. If it decided mode-in-run: add to the port, with a conformance case, a `json` member of RunContext; under `--json` the confirmation never prompts, the object gains `outcome` after `totals`, and the `--json never prompts` sentence is a note. Refusals keep today's `✗ prune refused: …` lines and exitCodeForError's codes (7 for a lock, 1 otherwise); a config error is reportConfigError's text with 1.
- Each definition moves its help, long help and examples word for word from cliDocs and its option help from today's registration; delete the cliDocs entries of init, archive and prune. src/cli/definitions/program.ts: add the four commands where Commander lists them (unlock after validate, archive and prune after ls, init after architecture). src/cli/program.ts: replace each registration by `mountRunnerStub` at its place, and delete registerPruneCommand with src/cli/commands/pruneRegister.ts. Keep runInit, runUnlock, runArchive and runPrune only as `runThroughOutput` compositions for the tests that call them (runPrune's `json` option giving the runner's `--json` behaviour, its prompt the clack layer as today).
- Write tests/integration/lifecycleCommandsJson.test.ts, spawning `tsx src/cli/main.ts` in temporary repositories (isolateGit with its own identity, a temporary PHAX home), or through the runner with the factories and the fake Prompt port: `init --yes --json` answers phax.json and phax.schema.json as written-file records; `init --json` without `--yes` writes one refused line, exits 64 and writes no file; `unlock <run> --json` answers per q-unlock-answer for a stale and a missing lock; a held lock exits 1 with today's sentence and one error line under `--json`; `archive <run> --json` answers one object; `prune --all --dry-run --json` and `prune <run> --yes --json` write today's object byte for byte with only message lines on stderr; `prune <run> -y` and `--yes` prune alike; `prune --json` without `--yes` or `--dry-run` answers as q-prune-json decided, never prompting.
- Run `pnpm gen:usage-spec`. Extend tests/integration/usageSpecDeclarations.test.ts: MIGRATED_COMMANDS gains the four commands, REWORDED_JSON `prune`; no long help is reworded. Run `pnpm docs:cli`.
- docs/upgrading.md, 0.34.0 entry, one bullet: init, unlock, archive and prune answer `--json`; `init --json` needs `--yes`; `prune --json` keeps its object, and without `--yes` or `--dry-run` answers as q-prune-json decided; prune's preview lines are note lines under `--json`; unlock's answer names its values.

### Planned files to create

- `src/cli/definitions/init.ts`
- `src/cli/definitions/unlock.ts`
- `src/cli/definitions/archive.ts`
- `src/cli/definitions/prune.ts`
- `tests/integration/lifecycleCommandsJson.test.ts`

### Planned files to edit

- `src/cli/definitions/program.ts`
- `src/cli/program.ts`
- `src/cli/commands/init.ts`
- `src/cli/commands/unlock.ts`
- `src/cli/commands/archive.ts`
- `src/cli/commands/prune.ts`
- `src/cli/commands/pruneRegister.ts`
- `src/cli/cliDocs.ts`
- `phax.usage.kdl`
- `README.md`
- `docs/upgrading.md`
- `tests/integration/usageSpecDeclarations.test.ts`

### Optional files that may be edited

- `src/cli/definitions/shared.ts`
- `src/cli/bridge.ts`
- `src/cli/cliCompleters.ts`
- `src/cli/commandLibrary/contract/command.ts`
- `src/cli/commandLibrary/contract/conformance/cases.ts`
- `src/cli/commandLibrary/commander/run.ts`
- `src/domain/prune.ts`
- `src/app/prune.ts`
- `src/app/initWizard.ts`
- `scripts/generate-usage-spec.ts`
- `tests/unit/cli/init.test.ts`
- `tests/unit/commandLibrary/conformance.test.ts`
- `tests/integration/initCommand.test.ts`
- `tests/integration/initWizard.test.ts`
- `tests/integration/pruneCommand.test.ts`
- `tests/integration/archive.test.ts`
- `tests/integration/cliProgram.test.ts`
- `tests/integration/docsCliDrift.test.ts`
- `docs/cli/reference.md`
- `knip.json`

### Boundary contracts

Producer: src/cli/definitions/init.ts, unlock.ts, archive.ts and prune.ts. Consumers: the runner, scripts and agents. Contract: today's text, streams and codes without `--json`; one object per call under it, prune's today's bytes, unlock's per q-unlock-answer, init's written files; `init` and `prune` never waiting on a person under `--json`.

### Test strategy

- init, unlock, archive and prune answer one indented JSON value under --json with only message lines on stderr — medium · table · JSON.parse of stdout and of each stderr line against the message shapes · in-phase · ac-json-every-command
- prune's object encodes today's value to exactly today's bytes for nothing-to-prune, previewed and applied — small · table · JSON.stringify of the same document with two-space indent and a newline · in-phase · ac-json-every-command
- init --json without --yes is refused with 64 before any prompt, and prune --json without --yes or --dry-run never prompts — medium · example · the refused line or the decided answer, the exit code and the untouched directory · in-phase · ac-no-person
- init --yes --json lists phax.json and phax.schema.json as written-file records — medium · example · the created files' paths and the sha256 of their bytes · in-phase · ac-written
- the existing init, prune and archive tests pass with their assertions unchanged, prune's preview before its prompt — medium · example · the existing tests' expected text, order and codes · in-phase · ac-text-unchanged
- a held lock keeps today's sentence and exit 1 for unlock, and is one error line under --json — medium · example · today's held-lock sentence and exit code · in-phase · ac-error-sentence
- prune -y and prune --yes decode and prune alike — small · example · the two calls' decoded input and answers compared · in-phase
- phax.usage.kdl differs from the frozen file only by --json on the four commands — small · metamorphic · the frozen pre-change file compared node by node · in-phase · ac-usage-parity

### Implementation order

1. unlock and archive
2. init with its factory
3. prune with its factory, say preview and the q-prune-json branch
4. program.ts entries, program.ts stubs, deleted registrations and cliDocs entries, kept run functions
5. lifecycleCommandsJson.test.ts
6. usage spec, docs:cli, upgrading bullet

### Excluded scope

- The run and session commands (plan 4).
- Removing the bridge, PARTIAL_GROUPS or the kept run functions (plan 4).
- Changing the prune, archive, unlock or init logic, or prune's kept cost ledgers.
- The docs page reference/json-output (plan 4).

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

Give the four definitions' inputs, prompts, outputs, verdicts, errors with codes, and what q-prune-json and q-unlock-answer decided and how each was carried out (with any port change and its conformance case). List the run functions kept and the tests that call them, and the usage allowlist entries added. Name what plan 4 inherits: the commands Commander still holds, the bridge's remaining roles, the gains of plans 1 to 3 and the frozen-file allowlists. Explain any deviation from the planned file lists.

### Commit subject

`feat(cli): init, unlock, archive and prune answer through the command runner`

### Commit body

Write init, unlock, archive and prune as command definitions. Under --json each answers
one object: prune keeps today's object, init lists the files it wrote and needs --yes,
and prune never prompts. prune keeps -y beside --yes and writes its preview before its
confirmation, as today.

Without --json each command prints today's text and error sentences with today's codes.
