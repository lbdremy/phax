Write the phax plan "Gate step times" for the approved spec `docs/specs/2611231007-gate-step-times.md`. It is
the spec's only plan: it carries `completes-spec: true`.

Read the spec in full, sidecar included, and its brief `docs/briefs/gate-step-times.md`. These are settled; do not
reopen them:
- the operator's verdicts of 2026-11-23 in §9b: q-step-shape `start-duration`, q-where `in-attribution`,
  q-phax-work `attempt-and-check`, q-explain-view `default-view`;
- everything §10 lists as settled, and its constraints; the non-goals of §7.

This plan takes every requirement of §5, every §6 surface and every §8 criterion.

## Facts read on main at 9a24073 (2026-11-23)

- **The format.** `src/schemas/gateAttribution.ts` (91 lines) is the 0.33.0 shape; `gate-attribution` is stamped
  0.33.0 in `packages/schemas/src/generated/index.ts`. Frozen decoders live in `src/schemas/history/gate-attribution/`
  (`pre-schema`, 0.17.0, 0.20.0, 0.21.0, 0.26.0, 0.31.0); 0.33.0 is not frozen yet. `readGateAttributionFile` in
  `src/schemas/persisted.ts` (about line 1565) lifts the older shapes into the current one. Main is open at 0.43.0:
  the new stamp is 0.43.0.
- **The precedent for a format bump** is 375af754 (`plan-approval-record` gains a required `code` key): the frozen
  history decoder, `persisted.ts`, `packages/schemas` (`formats/repository.ts`, `index.ts`, `history.lock.json`,
  `shipped-json.json`, the `next.schema.json` snapshot), `src/schemas/release.ts`, the behaviour corpus cases
  (`tests/behaviourCorpus/cases/encode|formats/`, `subjects.ts`) and `tests/helpers/property/formatRegistry.ts`.
  Follow it file for file.
- **The steps.** `src/app/gates.ts` `runGates` runs each configured step through `shell.run` (about line 340), a
  report step through `judgeReport`, and the acceptance step through `shell.run` with `timeoutMs` inside
  `Effect.result` (about line 390), where a spawn failure or a timeout is a failed step. `stepResults` is the list
  the attribution receives. `gates.ts` reads no `Clock` today.
- **The clock precedent** is `src/app/costLedger.ts`: `Clock.currentTimeMillis` before and after, `endedAt` written
  with `new Date(ms).toISOString()`.
- **The protected-paths check** runs in `src/app/fixLoop.ts` (`checkProtectedPaths`, from
  `src/app/protectedPathsCheck.ts`), and `recordProtectedPaths` in `src/app/gateAttribution.ts` rewrites the step
  record and `gate-attribution.json` with its result. `src/app/closeStop.ts` runs `runGates` with no check.
- **The reader.** `src/app/recordsExplain.ts` (817 lines) and `src/cli/definitions/recordsExplain.ts` (754 lines):
  today the phase view reads only the acceptance step from `gate-attribution.json`; `--gates` prints the logs and
  reports, not the step records. Check that every `checks-attempt-NN.attribution.json` reaches the record
  (`src/app/writeRecord.ts`) before relying on it.
- **The docs page** is `guide/records` (spec §11); `docs/upgrading.md` takes the format entry.

## Settle in Technical arbitrations, with the dominant loss of each

- **Where the time is taken around a step**: inside `runGates` around each `shell.run` (and around `judgeReport`
  for a report step, or not), so a step's duration is the command's and the attempt's covers phax's own work.
- **How the attempt time reaches the protected-paths rewrite** so §5.7 holds: `recordProtectedPaths` keeps the times
  it re-reads, and the check's own time is taken in `fixLoop.ts`.
- **The per-variant time types** of §10's constraints (a skipped acceptance step is `not-run` only) as Effect
  Schema unions, and how the 0.33.0 and older readers produce `unknown` and `not-run`.
- **How `records explain` reads the step records**: from the record's artifacts, attempt by attempt, with the
  `steps unknown` answer for an absent or unreadable one.

## Shape

Core to surface: the new shape, its frozen 0.33.0 decoder, the upgrade of every older stamp and the schemas package
first; then the recording in `runGates`, the check and the close, under `TestClock`; then `phax records explain`'s
text and `--json`, the `guide/records` page and `docs/upgrading.md`. Models: `claude-opus-5-5` at medium for the
reasoning phases; a mechanical docs phase may run on `claude-sonnet-5`.

No acceptance phase: the surface is a file format and command output that tests read in full.

## Lessons from the runs on this repository

- **knip runs at every phase's gate**, default and `--production --strict`, against `knip-baseline.json`
  (protected). An export that only a later phase uses fails the gate: export it where it is first used.
- **`pnpm lint` is type-aware, against `lint-baseline.json` (protected).** Fix a lint error in the code; never add
  a disable directive.
- **Protected, untouched**: `knip.json`, both baselines, `.oxlintrc.json`, `.oxfmtrc.json`, the tsconfigs,
  `vitest.config.ts`, the workflows.
- **CI rehearses the release cut and the next opening on every pull request.** No test may name the opened version;
  follow how 375af754's tests reach the new stamp.
- **Tests never read `~/.phax`, a real provider home or the global git config.** A test that spawns a child goes
  through `tests/helpers/boundedSpawn.ts`; the architectural guard refuses a new unbounded spawn.
- **No test measures wall-clock time**: every time comes from `TestClock` or a fixed clock layer.

Every required command must equal an entry of `security.agentCommands` or a gate command exactly; an entry with a
space in it covers only itself. `node`, `pnpm exec tsx`, `pnpm test:unit`, `pnpm test:integration`, `git log`,
`git grep` are `agentCommands`; `pnpm test` is a gate command.
