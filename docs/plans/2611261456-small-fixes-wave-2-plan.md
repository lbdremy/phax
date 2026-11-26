---
status: Draft
source-spec: null
---
# Small fixes, wave 2

Seven small fixes from `NEXT_STEPS.md` (wave 2), in six phases. Each phase changes its own files, and no phase depends on another phase's code. There is no spec: each phase section says where its fix lives and how it should behave.

1. `phax resume` hints print `--yes`, and the protected-path restore command uses literal pathspecs (SEC-30), in `src/app/resumeInstructions.ts` and the reducer's trace details (phase-01).
2. `phax open`'s help claims an editor setting and an `$EDITOR` fallback that it does not have (phase-02).
3. and 4. Two skill texts: `phax-decide-review` names a command that does not exist, and `phax-spec` does not say which words a criterion id cannot be (phase-03).
5. A watchdog in the Codex adapter ends a session that only reconnects and reports a `network` failure (phase-04).
6. `phax agent setup providers --write` keeps a provider the person disabled disabled (phase-05).
7. Identifier-like schema leaves get their refusal labels back (phase-06).

**Start this run with `phax run --allow-skill-edits`.** phase-03 edits `.claude/skills/phax-decide-review/SKILL.md` and `.claude/skills/phax-spec/SKILL.md`, and both files are declared in that phase's planned files. Without the flag, the preflight refuses the plan.

The run declares no acceptance pair: every fix is small and its tests are written with the code, in the same phase.

Lessons from earlier runs that hold for every phase:

- knip runs at every gate, in default mode and in `--production --strict` mode. An export used only by tests counts as unused, so export only what `src/` uses.
- `pnpm lint` is type-aware. Fix a lint error in the code and never add a disable directive.
- `knip-baseline.json` and `lint-baseline.json` only shrink, and pruning them is the operator's job. A phase that removes debt fails its gate until the operator prunes, so the handoff says which debt the phase removes.
- These files are protected and stay untouched: `knip.json`, both baselines, `.oxlintrc.json`, `.oxfmtrc.json`, the tsconfigs, `vitest.config.ts`, the workflows and `tests/unit/architecturalGuards*.test.ts`.
- Tests never read `~/.phax`, a real provider home, the global git config or the network. A test that spawns a child process goes through `tests/helpers/boundedSpawn.ts`.
- A CLI help change regenerates `phax.usage.kdl` and `docs/cli/reference.md` (`pnpm gen:usage-spec`, then `pnpm docs:cli`, which also rewrites the README's generated block), in the same phase.
- A refusal text recorded in the behaviour corpus changes only together with the change that causes it, and the handoff lists each changed case.

## Gate profile

`standard`

## Required commands

- `pnpm test:unit`
- `pnpm test:integration`
- `pnpm gen:usage-spec`
- `pnpm docs:cli`
- `git grep`

Every command above is already an exact entry of `security.agentCommands` in `phax.json`; `pnpm test` is a gate command. No change to the phax security configuration is needed.

## Technical arbitrations

- Resume hints (phase-01): every printed command that tells the operator to run the resume becomes `phax resume <run> --yes`. Prose that only names the command ("`phax resume` re-runs only the completion step") and what a preview prints stay as they are. The restore command becomes `git --literal-pathspecs checkout <c> -- '<path>'`, so a protected path is always read as a file name. Loss accepted: none. A pasted command can no longer expand a pathspec, and no hint ever needed it to.
- `phax open` (phase-02): the help and summary are corrected, and the adapter stays as it is. `src/infra/editor.ts` opens the worktree with the OS's default opener (`open` on macOS, `xdg-open` elsewhere), and `phax.json` has no editor key. Loss accepted: there is still no way to choose an editor. A person who wants a particular editor runs it on the path that `phax path <run>` prints. Adding the `EDITOR` fallback would also mean handing a terminal editor the terminal, which the detached spawn with ignored stdio does not do, so it is not a small fix.
- Codex watchdog (phase-04): a network event is a Codex `error` event whose message starts with `Reconnecting...`, or whose text `classifyVerdictText` reads as `network`. Any other stdout event resets the count. After 8 consecutive network events the adapter ends the process and reports a `network` failure. That is Codex's 5 numbered reconnects plus 3 `waiting for network` events, about 2.5 to 3 minutes, close to how long Claude Code (about 3 min) and Vibe (about 4.5 min) retry. Loss accepted: a session that Codex would have recovered after a longer outage now ends as `network` (exit 14). The run pauses and can be resumed.
- Provider setup (phase-05): when `~/.phax/providers.json` exists, `--write` never turns an `enabled: false` entry back on (`--prune` can still turn an entry off). With no file, setup starts from the built-in catalog and enables the installed providers, as it does today. For models, `--write` keeps writing the file's own models: retired ids are dropped and their successors listed. It writes the built-in catalog only when no file exists. Writing fewer models on the first write would need a new meaning for an entry with no `families`, which today serves no model: that is a change to the routing format, not a small fix. Loss accepted: a provider installed after the file exists is never turned on by `--write`, so the person flips its `enabled` flag by hand. A first write still copies the built-in catalog into the file, and the retired-id refusal already names `--write` as the remedy.
- Refusal-label scope (phase-06): the identifier-like leaves are phase ids, decision and revision ids, finding ids, question and verdict ids, commit SHAs, SHA-256 digests, grants and the safe session id. Leaves that already carry a message or an identifier on their check keep it. Timestamps, dates, URLs, schema URLs and free-text patterns keep their pattern label. Schemas under `src/schemas/history/` are frozen and stay untouched. Loss accepted: a refused timestamp still prints its regular expression.

## Open questions

### refusal-label-site — Where does the label of an identifier-like leaf live: on the leaf's pattern check, or on the leaf's schema node as Effect 3 had it?

- check-annotation — An `identifier` annotation on the pattern check (passed through `isExportedPattern`'s annotations), with the refusal adapter preferring a pattern check's identifier over the built-in `a string matching the pattern …` label — abandons: keeping the label on the type itself as Effect 3 did: an invalid-type refusal (a number where the id belongs) still says `string`, and the adapter's label order changes for every pattern check that carries an identifier (today only `NonEmptyString`'s, whose message still decides its text)
- node-identifier — An `identifier` annotation on each leaf's schema node, with the adapter preferring the owner node's identifier for a filter refusal — abandons: an unchanged published format: a node identifier becomes a `$defs` entry and a `$ref` in every format that carries the leaf, so each of about twenty formats records a `next` snapshot under `packages/schemas/snapshots/` and its published JSON Schema changes shape

Recommendation: check-annotation — A refusal text is phax's own wording, while the JSON Schemas are a published contract. Putting the label on the check restores the label without changing any format, which keeps this fix small. Losing the label on a wrong-type refusal costs little: the type there is still named (`string`).

---

## phase-01 — Resume hints print --yes; restore commands use literal pathspecs {#phase-01-resume-hints}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

Every hint that tells the operator to resume a paused run prints a command that actually resumes it (`phax resume <run> --yes`), not one that only previews. The restore command printed for a changed protected path reads that path literally, so a path named `:(exclude)…` cannot turn the pasted command into a checkout of the whole tree that throws away the phase's work (SEC-30).

### Detailed instructions

- In `src/app/resumeInstructions.ts`, the `## Resume` code blocks of `buildHoldPointFailedInstructions` and `buildStopRecordRefusedInstructions`, and the `## Close the stop (from the main checkout)` block of `buildAwaitingReviewInstructions`, print `phax resume ${input.shortName}`. Make each print `phax resume ${input.shortName} --yes`, as `buildNetworkPausedInstructions` (the `--yes` block near line 340) already does. Leave prose that only names the command ("`phax resume` reaches the stop again…", "`phax resume` writes the record once…", "`phax resume` re-runs only the completion step") unchanged.
- In `src/domain/reducer.ts`, every `EmitTrace` named `resume.available` carries `details: { resumeCommand: `phax resume ${event.run}` }`. There are about ten of them (around lines 564, 645, 939, 996, 1055, 1172, 1238, 1303, 1620 and 1683). Find them with `git grep -n "resumeCommand" src/`, and make each `phax resume ${event.run} --yes`. Change the string only: the trace's name, status and boundary, and the reducer's transitions, stay as they are.
- SEC-30, `restoreCommand` in `src/app/resumeInstructions.ts`: `const checkout = `git checkout ${commit} -- ${path}`` becomes `git --literal-pathspecs checkout ${commit} -- ${path}`. Keep the `shellQuote` of the path. Every kind that uses `checkout` (edited, deleted, renamed, symlink, nested-repository) inherits the change. `git cat-file -e <commit>:<path>` and `rm -- <path>` take no pathspec, so leave them as they are. Update the function's doc comment to say that the path is read literally and why.
- Then sweep `src/` for every other printed hint that tells the operator to run the resume without `--yes`: `git grep -n "phax resume \${" src/`. Candidates: the `Suggested resume:` line of `src/cli/definitions/sessionInfo.ts`; the `closeCommand` that `src/app/interactiveStop.ts` hands to `src/domain/interactive/seed.ts`, which tells the person how to close the stop; the remedies in `src/app/closeStop.ts` (around lines 413 and 1234); `src/app/adjustPlan.ts` around line 52; and `src/app/enterPhase.ts` around line 92. Change each one that tells the operator to run the command so that it prints `--yes`, and list every site you changed or left in the handoff.
- Do not change what a preview prints: `phax resume <run>` without `--yes` writes what it would resume, and that output stays the same.
- Update the tests that assert the old strings: `tests/unit/resumeInstructions.test.ts` and `tests/unit/reducerHeldStop.test.ts` (it expects `resumeCommand: "phax resume invoice-export"`), plus any other reducer, seed or prompt-snapshot test that the sweep affects. A prompt snapshot (`tests/unit/__snapshots__/promptGeneration.test.ts.snap`) changes only where a hint changed.
- Add `tests/integration/restoreCommandLiteralPathspec.test.ts`. In a temporary git repository with a committed file literally named `:(exclude)x` and another changed file, run the restore command that `buildResumeInstructions` prints for that path. Check that only `:(exclude)x` is restored and that the other file's change survives. Isolate git from the global and system configuration (`GIT_CONFIG_GLOBAL`, `GIT_CONFIG_NOSYSTEM`, a temporary `HOME`), and run every child process through `tests/helpers/boundedSpawn.ts`. Then show that the old command form discards the other file's change, so the test proves the fix and not only the string.

### Planned files to create

- `tests/integration/restoreCommandLiteralPathspec.test.ts`

### Planned files to edit

- `src/app/resumeInstructions.ts`
- `src/domain/reducer.ts`
- `tests/unit/resumeInstructions.test.ts`
- `tests/unit/reducerHeldStop.test.ts`

### Optional files that may be edited

- `src/cli/definitions/sessionInfo.ts`
- `src/app/interactiveStop.ts`
- `src/domain/interactive/seed.ts`
- `src/app/closeStop.ts`
- `src/app/adjustPlan.ts`
- `src/app/enterPhase.ts`
- `tests/unit/reducer.test.ts`
- `tests/unit/reducerAwaitingReview.test.ts`
- `tests/unit/reducerArtifactCompletionPause.test.ts`
- `tests/unit/reducerCleanupPause.test.ts`
- `tests/unit/reducerCommitPause.test.ts`
- `tests/unit/reducerGateRefusal.test.ts`
- `tests/unit/reducerHandoffPause.test.ts`
- `tests/unit/interactive/seed.test.ts`
- `tests/unit/promptGeneration.test.ts`
- `tests/unit/__snapshots__/promptGeneration.test.ts.snap`
- `tests/unit/cli/run.test.ts`
- `tests/unit/cli/resume.test.ts`
- `tests/unit/resume.test.ts`

### Boundary contracts

Producer: the reducer (domain) and `buildResumeInstructions` (app) write `resume-instructions.md` and the `resume.available` trace. Consumer: the operator, who pastes the printed command. The contract is that every printed resume command resumes the run (`--yes`), and that every printed restore command touches exactly the named path.

### Test strategy

- the awaiting-review, hold-point and stop-record sections print `phax resume <run> --yes`, and the network section is unchanged — small · example · expected Markdown lines of resume-instructions.md · in-phase
- every `resume.available` trace the reducer emits carries `phax resume <run> --yes` — small · table · each pausing transition's expected trace details · in-phase
- the restore command of each protected-change kind uses `git --literal-pathspecs checkout` — small · table · expected command string per change kind · in-phase
- pasting the restore command for a path named `:(exclude)x` restores only that file and keeps the rest of the worktree — medium · example · file contents of a temporary git repository before and after · in-phase

### Implementation order

1. `restoreCommand` (SEC-30) and its tests.
2. The three `resume-instructions.md` sections and their tests.
3. The reducer's `resume.available` details and the reducer tests.
4. The sweep of the other hints, then the integration test.

### Excluded scope

- What `phax resume <run>` without `--yes` prints (the preview).
- Prose that names `phax resume` without telling the operator to run it.
- Any change to reducer transitions, trace names or statuses.
- Other SEC findings from the 2026-11-23 security report.

### Verification

The new integration test shows that the old restore command discards a sibling change and that the new one keeps it. `git grep -n "phax resume \${" src/` finds no operator hint without `--yes` other than those the handoff names and explains.

### Expected handoff content

Every site changed to print `--yes`, with file and function, and every `phax resume` string left as it is, with the reason (prose, or preview). The restore-command change and the kinds it covers. Every test or snapshot updated because a hint changed. Any behaviour-corpus case that changed (expected: none). Any deviation from the planned file lists, with the reason.

### Commit subject

`fix(resume): print --yes in every resume hint and restore with literal pathspecs`

### Commit body

The awaiting-review, hold-point and stop-record sections of
resume-instructions.md, and the reducer's resume.available trace details,
printed `phax resume <run>`, which only previews. Every hint that tells the
operator to resume now prints `phax resume <run> --yes`, as the network and
handoff sections already did.

SEC-30: the printed restore command for a protected path was
`git checkout <c> -- '<path>'`. A path named `:(exclude)…` turned the pasted
command into a whole-tree checkout that discarded the phase's work. It is now
`git --literal-pathspecs checkout <c> -- '<path>'`. An integration test runs
both forms in a temporary repository.

---

## phase-02 — phax open's help says what it opens the worktree with {#phase-02-open-help}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

`phax open`'s help and summary describe what the command actually does: it opens the worktree with the operating system's default opener. There is no editor setting in `phax.json` and no `EDITOR` fallback, so the help stops claiming them.

### Detailed instructions

- Read `src/infra/editor.ts` first: `makeNodeEditorLayer` spawns `open` on macOS and `xdg-open` elsewhere with the path, detached, and reads no environment variable. Read `src/schemas/phaxConfig.ts` too: it has no editor key.
- In `src/cli/definitions/sessions.ts`, rewrite `OPEN_HELP` to say that the command opens the final worktree with the system's default opener (`open` on macOS, `xdg-open` elsewhere), as if you ran that opener on the worktree path, and that for a run in `awaiting_review` it opens the stopped phase's worktree. Remove the phax.json and `EDITOR` claims. Add one sentence pointing to `phax path <run>` for opening the worktree in a chosen editor.
- Rewrite the command's `summary` ("Open the final worktree in the configured editor") to match, e.g. "Open the final worktree with the system's default opener".
- Leave `prompts: () => true` and its `unprompted` line as they are. Changing them would change `--json` behaviour, which is outside this fix. Reword the comment above them only if it is now false, and say what you did in the handoff.
- Regenerate the CLI contract: `pnpm gen:usage-spec` (rewrites `phax.usage.kdl`), then `pnpm docs:cli` (rewrites `docs/cli/reference.md` and the README's generated block). Update `tests/fixtures/help/phax-root-help.txt`, which records the root help's summary line for `open`.
- Check the hand-written docs that repeat the old wording: `docs/cli/inventory.md` (the `open` row) and `docs/json-output.md` (around line 122). Correct them only if they repeat the false claim.
- Do not edit `tests/fixtures/usage/phax.usage.before-command-contracts.kdl` or the archived plans under `docs/plans/archive/`: they record history.

### Planned files to create

- (none)

### Planned files to edit

- `src/cli/definitions/sessions.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`
- `README.md`
- `tests/fixtures/help/phax-root-help.txt`

### Optional files that may be edited

- `docs/cli/inventory.md`
- `docs/json-output.md`

### Test strategy

- the root help lists `open` with its new summary — medium · example · tests/fixtures/help/phax-root-help.txt · in-phase
- the generated usage spec and CLI reference carry the new help, and no `EDITOR` or phax.json editor claim — small · example · the regenerated phax.usage.kdl and docs/cli/reference.md · in-phase

### Implementation order

1. `OPEN_HELP` and the summary in `src/cli/definitions/sessions.ts`.
2. `pnpm gen:usage-spec`, then `pnpm docs:cli`.
3. The root-help fixture and any hand-written doc that repeats the claim.

### Excluded scope

- An `EDITOR` fallback or an editor key in `phax.json` (settled in Technical arbitrations).
- Any change to `src/infra/editor.ts` or to `phax open`'s `--json` and prompting behaviour.
- Historical fixtures and archived plans.

### Verification

`git grep -n "EDITOR environment\|configured editor"` finds the old wording only in historical fixtures and archived plans. The regenerated `phax.usage.kdl` and `docs/cli/reference.md` match the definition.

### Expected handoff content

The new help and summary text. The files that regeneration rewrote. The hand-written docs corrected or left as they were, with the reason. Whether the comment above `prompts` changed. Any deviation from the planned file lists, with the reason.

### Commit subject

`fix(cli): say phax open uses the system opener, not an EDITOR fallback`

### Commit body

phax open's help said it used the editor configured in phax.json or the
EDITOR environment variable. The editor adapter opens the worktree with the
OS's default opener (`open` on macOS, `xdg-open` elsewhere), and phax.json has
no editor key. The help and summary now say so and point to `phax path` for a
chosen editor. phax.usage.kdl, docs/cli/reference.md, the README's generated
block and the root-help fixture are regenerated.

---

## phase-03 — Skill texts: what loads phax-decide-review, and the reserved criterion ids {#phase-03-skill-texts}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

The `phax-decide-review` skill says what loads it today instead of naming `phax review-plan`, a command that does not exist. The `phax-spec` skill tells spec authors that a criterion id cannot be one of the reserved test-line words. Today only the schemas refuse those ids.

### Detailed instructions

- This phase edits two project skills. Each `SKILL.md` it writes is declared in its planned files, and the run is started with `--allow-skill-edits`. Write no other `.claude/` path.
- phax-decide-review: find what loads the skill today. `src/domain/skills/catalog.ts` declares `PHAX_DECIDE_REVIEW_SKILL` and lists it in `EXPOSED_SKILLS`. Only `findExposedSkill` and `EXPOSED_SKILL_NAMES` read that list, from `src/app/skills/installSkill.ts` and `src/cli/definitions/skills.ts` (`phax skills install`). The constant itself appears in `knip-baseline.json` as unused. `src/domain/decide/doctrine.ts` wires only `phax-decide-spec` and `phax-decide-plan` into `phax artifact decide`. Confirm this with `git grep -n "decide-review\|DECIDE_REVIEW" src/`. Then confirm that `phax review-plan` is absent from `phax.usage.kdl`.
- Rewrite the skill's frontmatter `description` and its opening note so they say what is true: no phax command loads this skill today; `phax skills install` installs it (with the other bundled skills); and an agent or person who turns a `phax review-code` report (`code-review.json`) into a plan reads it by hand. Keep the rest of the doctrine (severity scale, principles, how findings become phases). Where the body names `review-plan.json` as the output of a command, say it is the plan the reader writes in the `phax-plan` shape, not a file a phax command produces. Do not add the command, and do not name it as coming later.
- Keep the strings that `tests/unit/planningSkillAcceptance.test.ts` asserts on this skill ("**Acceptance tests are not fix targets.**", "no acceptance test files (`R4`)"). Add a test there that the skill no longer contains `phax review-plan`.
- phax-spec: first check the reserved words against the schema that refuses them. In `src/schemas/testLine.ts`, `RESERVED_CRITERIA` is `[...TEST_LOOPS, "oracle"]`, which is `acceptance`, `in-phase` and the retired `oracle`. The refusal message reads "a criterion is neither 'acceptance', 'in-phase' nor 'oracle'".
- In `.claude/skills/phax-spec/SKILL.md`, section `## Acceptance criteria and traceability`, add one bullet: a criterion id cannot be `acceptance` or `in-phase` (the test-line loop words) nor the retired `oracle`, because a plan's test line names the criterion in the same position, and `phax plans lint`, extraction and the plan-document schema refuse such an id. Add nothing else to the skill.
- In `tests/unit/planningSkillAcceptance.test.ts` (or `tests/unit/skills.test.ts` if it is the better home), add a test that reads `.claude/skills/phax-spec/SKILL.md` and checks that every word in `RESERVED_CRITERIA` (imported from `src/schemas/testLine.ts`) appears in backticks on that bullet. Then the skill and the schema cannot drift apart without a failing test.

### Planned files to create

- (none)

### Planned files to edit

- `.claude/skills/phax-decide-review/SKILL.md`
- `.claude/skills/phax-spec/SKILL.md`
- `tests/unit/planningSkillAcceptance.test.ts`

### Optional files that may be edited

- `tests/unit/skills.test.ts`

### Test strategy

- phax-decide-review names no `phax review-plan` and keeps its acceptance-test doctrine lines — small · example · the skill file's text · in-phase
- phax-spec's criterion bullet names exactly the words the schema reserves — small · example · RESERVED_CRITERIA in src/schemas/testLine.ts · in-phase

### Implementation order

1. Confirm what loads `phax-decide-review`, then rewrite its description, note and body references.
2. Check `RESERVED_CRITERIA`, then add the `phax-spec` bullet.
3. The two tests.

### Excluded scope

- A `phax review-plan` command, or wiring `phax-decide-review` into any command.
- Removing `PHAX_DECIDE_REVIEW_SKILL` or touching `knip-baseline.json`.
- Any other change to either skill's doctrine.

### Verification

`git grep -n "review-plan" .claude/skills/` finds no command named `phax review-plan`. The new test fails if a word is added to or removed from `RESERVED_CRITERIA` without the skill following.

### Expected handoff content

What loads `phax-decide-review` today, as found (files and functions), and the new description text. The exact `phax-spec` bullet added. The tests added. Any deviation from the planned file lists, with the reason.

### Commit subject

`docs(skills): say what loads phax-decide-review and teach reserved criterion ids`

### Commit body

phax-decide-review's description said `phax review-plan` follows it. No such
command exists: `phax skills install` installs the skill and nothing loads it
at run time, so the description and body now say that.

phax-spec now tells spec authors that a criterion id cannot be `acceptance`,
`in-phase` or the retired `oracle`. Until now only the schemas refused them. A
test ties the line to RESERVED_CRITERIA.

---

## phase-04 — A Codex watchdog ends a session that only reconnects {#phase-04-codex-watchdog}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium
**Assignment reason:** The brief assigns `claude-opus-5-5`: the phase designs new behaviour in a provider adapter (watching a live process stream and ending the process), which no code in the repository shows yet for Codex.

A Codex session whose API is unreachable now ends with a `network` failure (exit 14, the run pauses and can be resumed), as it does on the other providers. Before this fix it hung without end with nothing on the terminal.

### Detailed instructions

- Background, from `src/schemas/codexOutput.ts`'s header: when it loses the network, codex-cli 0.165 emits `{"type":"error","message":"Reconnecting... N/5 (…)"}` up to 5/5, then `Reconnecting... waiting for network (…)` every ~50 s, without end, and never `turn.failed`.
- The settled rule (Technical arbitrations): a network event is a Codex `error` event whose message starts with `Reconnecting...`, or whose message `classifyVerdictText` (`src/domain/session/signatures.ts`) reads as `network`. Any other stdout line resets the count: any other event, an `error` that is not a network one, or a line that does not decode. After 8 consecutive network events the watchdog trips.
- Create `src/domain/session/codexNetworkWatch.ts`, pure, with no I/O. It holds the threshold, a step function from (the current count, one stdout line) to (the next count, whether it tripped, the last network message), and a function that builds the `SessionFailure` for a tripped watch: `provider: "codex-cli"`, `kind: "network"`, the last network message as `message`, the thread id when the stream gave one, and `resetAt: null`. Decode each line through `src/schemas/codexOutput.ts`, never with ad-hoc `JSON.parse` checks. If you need a one-line decoder that the file does not export yet, add it there. Export only what `src/` uses: knip `--production --strict` flags an export that only tests use.
- In `src/infra/providers/codexCli.ts`, `spawnCodex` feeds each complete stdout line to the watch. When it trips, end the process the way `claudeCode.ts` ends a timed-out one: `SIGTERM`, then `SIGKILL` after the grace period, without waiting on a child that ignores the signal. Mark the result as ended by the watchdog. Both callers (`runCodexSession` and `runCodexCompletion`) then fail with `failSession(...)` / `sessionFailureError(...)` built from the watchdog's `network` failure, not from `readCodexOutcome`, which would read a killed process as `killed`. The transcript (`outputJsonlPath`) is flushed as it is today, and the agent-error log is written as for any failed session.
- Exit 14 needs no new mapping: an `AgentSessionFailedError` whose failure kind is `network` already maps to it. Confirm this by reading where that error is mapped, and do not add a mapping.
- Update the header comment of `src/schemas/codexOutput.ts` ("Only an interrupt ends it") to say phax's watchdog ends it after the threshold.
- Extend the fake CLI in `tests/helpers/fakeProviderCli.ts` with an option that keeps the process alive after it prints its `stream`, until it is signalled. Today it ends on `exitCode` or `signal` straight after printing. Document the option beside the others. Never run the real Codex CLI in a test.
- Tests: `tests/unit/session/codexNetworkWatch.test.ts` (small, table) for the step function. `tests/unit/providers/codexCli.test.ts` (medium, against the fake Codex with `HOME` stubbed as the existing tests do): a stream of 8 network `error` events followed by a hang ends as `network`, with the last message, for an agent run and for a completion; a stream with fewer than 8 network events followed by `turn.completed` answers normally. Keep each test's wait short: the fake prints its events at once, so the watchdog trips on event count, not on time.

### Planned files to create

- `src/domain/session/codexNetworkWatch.ts`
- `tests/unit/session/codexNetworkWatch.test.ts`

### Planned files to edit

- `src/infra/providers/codexCli.ts`
- `src/schemas/codexOutput.ts`
- `tests/helpers/fakeProviderCli.ts`
- `tests/unit/providers/codexCli.test.ts`

### Optional files that may be edited

- `src/domain/session/codexOutcome.ts`
- `src/domain/session/index.ts`
- `src/infra/providers/agentErrorLog.ts`

### Boundary contracts

Producer: the Codex adapter (infra), which watches the live stdout. Consumer: the run's session-failure handling (app), which reads a `network` `AgentSessionFailedError` and pauses the run with exit 14. The domain module owns the rule (what counts, the threshold, the failure's shape). The adapter owns ending the process.

### Test strategy

- 8 consecutive network events trip the watch, 7 do not, and any other event or non-network error resets the count — small · table · the settled threshold and event rule · in-phase
- a `Reconnecting... waiting for network` message and a classified network message both count; a rate-limit error does not — small · boundary · classifyVerdictText and the `Reconnecting...` prefix · in-phase
- a fake Codex that streams 8 network errors and then hangs ends as a `network` session failure with the last message, for an agent run and a completion — medium · example · AgentSessionFailedError with failure kind network and the fake's last message · in-phase
- a fake Codex that reconnects fewer than 8 times and then completes its turn answers normally — medium · example · the fake's final text as the answer · in-phase

### Implementation order

1. The pure watch in `src/domain/session/codexNetworkWatch.ts` and its table test.
2. Any line decoder it needs in `src/schemas/codexOutput.ts`.
3. The fake CLI's keep-alive option.
4. The adapter wiring in `codexCli.ts` and its medium tests.

### Excluded scope

- A progress line while a provider retries (a separate `NEXT_STEPS.md` item).
- Resuming the paused Codex session instead of starting a new one.
- Any change to the Claude Code or Vibe adapters, or to `readCodexOutcome`'s reading of an ended stream.

### Verification

The medium tests show that a hanging fake Codex ends on its own with `failure.kind === "network"`. Without the watchdog the same test would hang until vitest's timeout. Revert the wiring locally to confirm this before committing.

### Expected handoff content

The path `src/domain/session/codexNetworkWatch.ts` and its exported names and signatures. The threshold and the exact event rule as implemented. How the adapter ends the process. The fake CLI option's name and behaviour. Where the `network` to exit 14 mapping lives (as confirmed). Any deviation from the planned file lists, with the reason.

### Commit subject

`fix(codex): end a session that only reconnects and report network`

### Commit body

codex-cli 0.165, its API unreachable, emits `Reconnecting... N/5` and then
`Reconnecting... waiting for network` every ~50 s without end, and never
`turn.failed`, so a Codex phase hung with nothing on the terminal.

A watchdog in the Codex adapter counts consecutive network `error` events (a
`Reconnecting...` message, or one the signature table reads as network).
After 8 it ends the process and reports a `network` failure, which pauses the
run with exit 14 as on the other providers. The accepted cost: a session Codex
would have recovered after a longer outage. Tested against a fake Codex
stream.

---

## phase-05 — agent setup providers --write keeps a disabled provider disabled {#phase-05-provider-setup}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium
**Assignment reason:** The brief assigns `claude-opus-5-5`: the phase changes a decision that crosses the app and domain layers (where the config came from, and how that decides a provider's flag), and it must keep the command's output contract.

`phax agent setup providers --write` no longer turns on a provider the person disabled in `~/.phax/providers.json`. It still enables installed providers when it writes the file for the first time, and it keeps writing the file's own models.

### Detailed instructions

- Read the path end to end: `providerSetup` (`src/app/providerSetup.ts`) reads the file with `readProviderConfigFile` (`src/app/loadRouting.ts`). That function returns `DEFAULT_PROVIDER_CONFIG` when the file is absent, and the decoded file otherwise. `probeProviders` then runs, followed by `planProviderConfig` (`src/domain/routing/providerSetup.ts`). Today `planProviderConfig` turns every `available && !enabled` entry to `enabled: true`. That is the bug.
- Make `readProviderConfigFile` say whether the config came from the file or from the built-in defaults (e.g. a `source: "file" | "built-in"` field on its result; it has one caller), and pass it to `planProviderConfig` through its `opts`.
- In `planProviderConfig`: when the config came from the file, an entry with `enabled: false` stays `enabled: false` and is reported in `unchanged`, whether or not its executable is available. When it came from the built-in defaults (no file), keep today's behaviour of enabling an installed provider. `--prune` is unchanged: it can still disable an enabled provider that is unavailable. The retired-model handling (`withoutRetiredModels`, `retiredRemoved`, `retiredReplaced`) and `fieldsDropped` are unchanged.
- Models (settled in Technical arbitrations): `--write` writes the file's own models when the file exists, and the built-in catalog only when it does not. Verify with a test that a file listing a subset of models is written back with exactly that subset, retired ids removed and their successors listed, and no other built-in model added.
- Keep the command's `--json` output shape (`src/cli/definitions/agent.ts`, `AgentSetupProvidersOutput`) unchanged: a provider kept disabled appears in `unchanged`, as the plan reports it. Check that the command's help and flag descriptions promise nothing the new behaviour breaks. If one does, correct it and regenerate (`pnpm gen:usage-spec`, `pnpm docs:cli`).
- Tests: `tests/unit/routing/providerSetup.test.ts`. The existing "enables an available-but-disabled provider" case becomes the no-file case. Add the file case (stays disabled, in `unchanged`), and check that the idempotence case still holds. `tests/integration/agentSetupProviders.test.ts` runs on the in-memory fake file system and fake shell, never on `~/.phax`. Add a case where `PROVIDER_CONFIG_PATH` already holds a file with `codex-cli` `enabled: false` and `codex` installed, and `--write` leaves it disabled. Add a case where a file with a subset of models is written back with exactly those models. Only these fakes ever write `providers.json`: no test writes under the real home.

### Planned files to create

- (none)

### Planned files to edit

- `src/domain/routing/providerSetup.ts`
- `src/app/providerSetup.ts`
- `src/app/loadRouting.ts`
- `tests/unit/routing/providerSetup.test.ts`
- `tests/integration/agentSetupProviders.test.ts`

### Optional files that may be edited

- `src/cli/definitions/agent.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`
- `README.md`
- `tests/unit/routing/loadRouting.test.ts`

### Boundary contracts

Producer: `readProviderConfigFile` (app), which now says whether the config came from the file or the built-in defaults. Consumer: `planProviderConfig` (domain), which decides each provider's flag from that fact and the probes. The `--json` output of `phax agent setup providers` keeps its shape.

### Test strategy

- with a providers.json present, an installed provider whose entry says `enabled: false` stays disabled and is reported unchanged — small · example · the plan's config and its enabled and unchanged lists · in-phase
- with no providers.json, an installed provider is enabled as before — small · example · the plan's config and enabled list · in-phase
- for every (source, enabled, available, prune) combination the provider's new flag follows the settled rule — small · table · the decision table in Technical arbitrations · in-phase
- `--write` over an existing file keeps codex disabled and writes back exactly the file's models, with retired ids replaced — small · example · the written providers.json on the fake file system · in-phase

### Implementation order

1. `planProviderConfig`'s new input and rule, with the table test.
2. `readProviderConfigFile` reporting its source, and `providerSetup` passing it on.
3. The integration cases on the fake file system.

### Excluded scope

- Enabling only the providers named on the command line (`NEXT_STEPS.md` alternative, not chosen).
- Writing a slimmer catalog on the first write, or a new meaning for an entry without `families`.
- Any change to the `--json` output shape or to `model-routing.json` scaffolding.

### Verification

The integration test reproduces the 2026-10-28 report (an existing file with Codex disabled and Codex installed) and shows Codex still disabled after `--write`.

### Expected handoff content

The new field on `readProviderConfigFile`'s result and on `planProviderConfig`'s options, with names and types. The rule as implemented. The tests added or changed, and why the old "enables" case moved. Whether any help text changed and was regenerated. Any deviation from the planned file lists, with the reason.

### Commit subject

`fix(providers): keep a provider the person disabled disabled on --write`

### Commit body

On 2026-10-28 `phax agent setup providers --write` turned Codex on for an
operator who had disabled it. Setup turned every installed provider on.

When ~/.phax/providers.json exists, an entry with `enabled: false` now stays
disabled; --prune can still disable an unavailable one. With no file, setup
starts from the built-in catalog and enables installed providers, as before.
--write keeps writing the file's own models (retired ids replaced) and
writes the built-in catalog only when no file exists. Tests run on the fake
file system, never ~/.phax.

---

## phase-06 — Identifier-like schema leaves get their refusal labels back {#phase-06-refusal-labels}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium
**Assignment reason:** The brief assigns `claude-opus-5-5`: the phase changes the refusal adapter's labelling rule, which affects every format, and must keep the published JSON Schemas and every unrelated corpus expectation unchanged.

A refusal on an identifier-like leaf (a phase id, a decision id, a commit SHA, …) names what was expected (`Expected DecisionId, actual ""`) instead of printing the leaf's regular expression, as it did before the Effect 4 migration (#198).

### Detailed instructions

- This phase follows the operator's decision on the open question `refusal-label-site`. The steps below are for the recommended `check-annotation`. If the operator chose `node-identifier`, the last bullet says what changes.
- Read the refusal adapter first: `src/schemas/refusal/adapter.ts`. For a failed filter, `filterLabel` returns `checkLabel(check, owner) ?? checkIdentifier(check) ?? …`. For `effect/schema/isPattern`, `checkLabel` returns `a string matching the pattern <source>`, so an identifier on the check never wins today. Change the label order for a pattern check that carries an identifier: its identifier comes first. Leave every other built-in check's label as it is. `NonEmptyString` (`src/schemas/strictString.ts`) is the one existing pattern check with an identifier, and its `message` annotation still decides its rendered text. Confirm that its rendered refusal is unchanged.
- Find every identifier-like leaf in the current schemas: `git grep -n "isExportedPattern(" src/schemas -- ':!src/schemas/history'`. In scope (Technical arbitrations): phase ids (`/^phase-\d{2}$/`, e.g. `acceptanceRequest.ts`, `costLedger.ts`, `firstReading.ts`, `gateRequest.ts`, `interactiveSession.ts`, `phaseAgentBinding.ts`, `phaxPlan.ts`, `questions.ts` (`phase`), `reviewStop.ts`, `runRecord.ts`, `status.ts`); `decisionId` (`decisionRecord.ts`) and `revisionId` (`revisionRecord.ts`); finding ids (`codeReview.ts`, `complianceReview.ts`, `findingFateRecord.ts`); question and verdict ids (`questions.ts`, `handDecisionAnswer.ts`, `decideVerdicts.ts`); commit SHAs (`approvalRecord.ts`, `specApprovalRecord.ts`, `findingFateRecord.ts`, `status.ts`); SHA-256 digests (`decisionRecord.ts`, `interactiveSession.ts`, `runRecord.ts`); grants (`approvedBy.ts`, `findingFateRecord.ts`); and the safe session id (`sessionId.ts`). Skip a leaf whose check already carries a `message` or an identifier (e.g. `architecture.ts`, `phaxPlan.ts`'s criterion check, `testLine.ts`). Out of scope: timestamps, dates, URLs, schema URLs and free-text patterns (`specDocument.ts`'s `surface` and `summary`).
- Annotate each in-scope leaf in place: `isExportedPattern(<regex>, { identifier: "PhaseId" })`, and likewise `DecisionId`, `RevisionId`, `FindingId`, `QuestionId`, `CommitSha`, `Sha256`, `Grant` and `SafeSessionId`. Use one name per kind of leaf, PascalCase, as Effect 3 printed it. Do not create a shared module of leaf schemas: each format module keeps its own imports, which the schemas package depends on.
- Leave everything under `src/schemas/history/` untouched: those schemas are frozen, and `tests/unit/schemasPackage/frozenHistory.test.ts` checks them.
- The published JSON Schemas must not change: `tests/unit/schemasPackage/snapshots.test.ts` (in `pnpm test`) compares each generated schema with the latest released snapshot. If it fails, the annotation reached the JSON Schema. Find out why and fix it, and do not record a `next` snapshot under this option.
- Tests: in `tests/unit/schemas/refusal/adapter.test.ts`, add a pattern check with an identifier that is labelled by the identifier, and keep the existing pattern-filter case (no identifier) labelled by its pattern. Add a table test (e.g. `tests/unit/schemas/identifierLabels.test.ts`) that decodes one bad value per in-scope leaf through the format's public decoder and expects the identifier in the rendered refusal.
- The behaviour corpus (`tests/behaviourCorpus/cases/**`) records rendered refusals, and the corpus replay test compares against them. Run `pnpm test:unit`. Every case that now fails only because an identifier-like leaf's refusal now names the identifier gets its recorded `refusal` text changed to the new text, and nothing else in that case changes. Change no other recorded expectation. A case that fails for any other reason means the change went too far: fix the code, not the case. List each changed case (file, case name, old and new line) in the handoff.
- If the operator chose `node-identifier`: annotate each leaf's schema node (`.pipe(Schema.annotate({ identifier: … }))`, as `sessionId.ts` does). In the adapter, prefer the owner node's identifier for a failed pattern check. Record the `next` snapshots under `packages/schemas/snapshots/` that the snapshot check names, and list them in the handoff.

### Planned files to create

- `tests/unit/schemas/identifierLabels.test.ts`

### Planned files to edit

- `src/schemas/refusal/adapter.ts`
- `tests/unit/schemas/refusal/adapter.test.ts`
- `src/schemas/decisionRecord.ts`
- `src/schemas/revisionRecord.ts`
- `src/schemas/acceptanceRequest.ts`
- `src/schemas/costLedger.ts`
- `src/schemas/firstReading.ts`
- `src/schemas/gateRequest.ts`
- `src/schemas/interactiveSession.ts`
- `src/schemas/phaseAgentBinding.ts`
- `src/schemas/phaxPlan.ts`
- `src/schemas/questions.ts`
- `src/schemas/reviewStop.ts`
- `src/schemas/runRecord.ts`
- `src/schemas/status.ts`
- `src/schemas/codeReview.ts`
- `src/schemas/complianceReview.ts`
- `src/schemas/findingFateRecord.ts`
- `src/schemas/handDecisionAnswer.ts`
- `src/schemas/decideVerdicts.ts`
- `src/schemas/approvalRecord.ts`
- `src/schemas/specApprovalRecord.ts`
- `src/schemas/approvedBy.ts`
- `src/schemas/sessionId.ts`

### Optional files that may be edited

- `src/schemas/strictString.ts`
- `tests/behaviourCorpus/cases/formats/acceptance-request.json`
- `tests/behaviourCorpus/cases/formats/authoring-record-manifest.json`
- `tests/behaviourCorpus/cases/formats/brief-record.json`
- `tests/behaviourCorpus/cases/formats/brief-request.json`
- `tests/behaviourCorpus/cases/formats/code-review.json`
- `tests/behaviourCorpus/cases/formats/compliance-review.json`
- `tests/behaviourCorpus/cases/formats/cost-ledger.json`
- `tests/behaviourCorpus/cases/formats/decide-verdicts.json`
- `tests/behaviourCorpus/cases/formats/decision-record-manifest.json`
- `tests/behaviourCorpus/cases/formats/finding-fate-record-manifest.json`
- `tests/behaviourCorpus/cases/formats/finding-list.json`
- `tests/behaviourCorpus/cases/formats/first-reading.json`
- `tests/behaviourCorpus/cases/formats/gate-attribution.json`
- `tests/behaviourCorpus/cases/formats/gate-request.json`
- `tests/behaviourCorpus/cases/formats/hand-decision-answer.json`
- `tests/behaviourCorpus/cases/formats/interactive-handoff.json`
- `tests/behaviourCorpus/cases/formats/interactive-session.json`
- `tests/behaviourCorpus/cases/formats/oracle-request.json`
- `tests/behaviourCorpus/cases/formats/phase-record-manifest.json`
- `tests/behaviourCorpus/cases/formats/phase-status.json`
- `tests/behaviourCorpus/cases/formats/phax-plan.json`
- `tests/behaviourCorpus/cases/formats/phax-plan-extraction.json`
- `tests/behaviourCorpus/cases/formats/plan-approval-record.json`
- `tests/behaviourCorpus/cases/formats/plan-document.json`
- `tests/behaviourCorpus/cases/formats/plan-hand-decision-answer.json`
- `tests/behaviourCorpus/cases/formats/review-stop.json`
- `tests/behaviourCorpus/cases/formats/revision-record-manifest.json`
- `tests/behaviourCorpus/cases/formats/run-list.json`
- `tests/behaviourCorpus/cases/formats/run-status.json`
- `tests/behaviourCorpus/cases/formats/spec-approval-record.json`
- `tests/behaviourCorpus/cases/formats/spec-document.json`
- `tests/behaviourCorpus/cases/formats/spec-hand-decision-answer.json`
- `tests/behaviourCorpus/cases/answers/authoring-answer.json`
- `tests/behaviourCorpus/cases/answers/plan-extraction.json`

### Boundary contracts

Producer: the schemas (`src/schemas/`) and the refusal adapter. Consumer: every reader of a refusal line (the CLI's error output, `phax plans lint`, the behaviour corpus). The contract is that a refused identifier-like leaf is named by its identifier. The published JSON Schemas under `packages/schemas/snapshots/` are a second consumer and stay unchanged under the recommended option.

### Test strategy

- a failed pattern check that carries an identifier is labelled by the identifier; one without keeps its pattern label — small · example · the refusal adapter's expected refusal objects · in-phase
- each in-scope leaf's refusal names its identifier through its format's public decoder — small · table · one expected refusal line per leaf · in-phase
- the generated JSON Schema of every format equals its latest released snapshot — small · example · packages/schemas/snapshots via the snapshot check · in-phase
- the behaviour corpus changes only the refusal lines of identifier-like leaves — small · example · the recorded corpus cases, each change listed in the handoff · in-phase

### Implementation order

1. The adapter's label order for an identified pattern check, with its tests.
2. The leaf annotations, format by format, with the table test.
3. The snapshot check, then the corpus cases that changed.

### Excluded scope

- Schemas under `src/schemas/history/`.
- Timestamps, dates, URLs, schema URLs and free-text pattern leaves.
- A shared module of leaf schemas, or any change to a leaf's pattern.
- Any corpus expectation other than an identifier-like leaf's refusal line.

### Verification

`git grep -n "matching the pattern" tests/behaviourCorpus` shows that the remaining occurrences are timestamps, dates, URLs, free-text leaves or history-format cases only. The snapshot check passes with no `next` snapshot recorded (recommended option).

### Expected handoff content

The option followed (`check-annotation` or `node-identifier`). The adapter change. The identifier names used and the leaves (file and field) each covers, plus the leaves left out and why. Every behaviour-corpus case changed, with file, case name and old and new refusal line. Any `knip-baseline.json` or `lint-baseline.json` debt this removes. Any deviation from the planned file lists, with the reason.

### Commit subject

`fix(schemas): label refusals of identifier-like leaves by name, not regex`

### Commit body

Since the Effect 4 migration (#198), a refusal on a leaf such as decisionId
printed the leaf's regular expression instead of a label. Phase ids,
decision and revision ids, finding and question ids, commit SHAs, SHA-256
digests, grants and the safe session id now carry an identifier on their
pattern check. The refusal adapter labels such a check by its identifier, so
the refusal reads `Expected DecisionId, actual …`. The published JSON Schemas
are unchanged. The behaviour-corpus cases whose refusal text changed are
updated with this change, and the handoff lists them.
