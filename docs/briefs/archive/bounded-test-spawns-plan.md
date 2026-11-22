Write the phax plan "Bounded test spawns" for the approved spec `docs/specs/2611201446-bounded-test-spawns.md`. It
is the spec's only plan: it carries `completes-spec: true`.

Read the spec in full, sidecar included, and its brief `docs/briefs/archive/bounded-test-spawns.md`. These are settled; do not
reopen them:
- the three operator decisions of 2026-11-20 in §9b: q-gate-bound `separate` (no gate-step limit here; it is a
  NEXT_STEPS item of its own), q-scope `all` (every spawn under `tests/`, no exemption list), q-bound-form `per-call`
  (a bound at every call, named constants allowed);
- everything §10 lists as settled, and its constraints; the non-goals of §7.

This plan takes every requirement, §5.1 to §5.12, every §6 surface and every §8 criterion.

## Facts measured on main at e824fd0f (2026-11-20)

- **171 files under `tests/` import `node:child_process`**: `tests/integration` 125, `tests/unit` 17, `tests/e2e` 13,
  `tests/fixtures` 10, `tests/helpers` 6. About 288 call sites of `spawnSync`, `execFileSync`, `execSync`, `spawn`
  and `execFile`. 79 files define a local wrapper (`git(…)`, `runCli(…)`, `run(…)`, `gitIn(…)`): moving the wrapper
  moves most of a file's calls at once.
- **29 files spawn the CLI** (`tsx` on `src/cli/main.ts`), most through a local `runCli` with no `timeout`. Alone,
  `tsx src/cli/main.ts --json-schema` answers in 0.7 s on the operator's machine.
- **Async spawns exist**: `tests/fixtures/records/bulkRecords.ts` runs `git fast-import` through `spawn`;
  `tests/helpers/fakeProviderCli.ts:167` signals itself on purpose (§5.8, a test expecting a signal).
- **The guard has a home**: `pnpm audit:architecture` is `vitest run tests/unit/architecturalGuards.test.ts`, which
  already refuses `node:child_process` in `src/domain` (`DIRECT_NODE_IO`, line 310). A guard over `tests/` fits there.
  `.oxlintrc.json` is protected: a lint rule is not an option a phase can take.
- **CI runs the suite on `ubuntu-latest`** (`.github/workflows/ci.yml`: `pnpm test:type`, `pnpm test`, the property
  tier). vitest 5.1 with its default pool (no `pool` key in `vitest.config.ts`); test timeouts 30 s unit, 90 s
  integration, 120 s hooks, all inert while a `spawnSync` blocks the worker.
- **The kills of 2026-11-20** (brief): `recordsJsonContracts`, `plansAnswersJson` (three times), `phaseGuard` on
  2026-11-19. All are `spawnSync` of `tsx … --json-schema` with no `timeout`, status 143, empty stderr.

## Settle in Technical arbitrations, with the dominant loss of each

- **How the sender is named (§5.1) given who can run what.** A phase runs on the operator's machine only; it cannot
  run CI. The CI half of the reproduction runs on the pull request's own CI, which the operator reads at review.
  Indicatively: an early phase lands the bounded spawn's ending report (signal, status, parent, timing) and, if needed,
  a diagnostic log the suite writes when a CLI spawn ends on a foreign signal; repeated full-suite runs on macOS in
  that phase, then the PR's CI, show who sends it. Say what the plan does if macOS never reproduces it.
- **Descendants (§5.5).** Ending a child and every descendant needs a process group (`detached` and a negative pid)
  or an equivalent; say which, and how a synchronous call gets a bound that kills a group (`spawnSync`'s own
  `timeout` and `killSignal` reach only the direct child).
- **The bound's numbers.** Named constants per kind of child (a git call, a CLI call, a long CLI call), stated at
  each call (§q-bound-form), sized from the measured times with headroom for a loaded machine.
- **The order of the migration** (q-scope `all`): which folders per phase, wrappers first. Every phase leaves the suite
  green; the guard lands last, when nothing is left for it to refuse, or first with the files still to move listed
  only inside the plan's own phases, never as a permanent exemption.

## Shape

Core to surface: the bounded spawn and its ending reports with their own tests first (§5.4 to §5.9); then the
investigation and the fix where the cause lies (§5.1 to §5.3), before the mass migration, so the migration moves to a
helper that already reports a foreign signal; then the migration, folder by folder, wrappers first; then the guard
(§5.10, §5.11); the repeated full suites last (§5.12). Every §8 criterion has its own named test, except the
repeated-suites one, which the last phase runs and records (as `test-worlds-built-once` did, in a file it commits).
`tests/e2e/**` moves with the rest; phases typecheck it but never run it (`PHAX_E2E_RUN` stays unset).

No acceptance phase: the change is to phax's tests (§11), and to phax itself only where the cause lies.

## Lessons from the runs on this repository

- **The last run's measuring needed `node_modules/.bin` on `PATH`** (`spikes/test-worlds/measure.mjs`): a script that
  spawns vitest itself must set it, as `pnpm` does, or every test that spawns `tsx` fails.
- **knip runs at every phase's gate**, default and `--production --strict`, against `knip-baseline.json` (protected).
  An export that only a later phase uses fails the gate: export it where it is first used.
- **`pnpm lint` is type-aware, against `lint-baseline.json` (protected).** Fix a lint error in the code; never add a
  disable directive. A phase that removes code carrying an accepted diagnostic leaves a stale entry that fails the
  gate: avoid it, or name it in the handoff for the operator's `pnpm lint --prune`.
- **Protected, untouched:** `vitest.config.ts` (no timeout raised, §7), `.oxlintrc.json`, both baselines, workflows.
- **CI rehearses the release cut and the next opening on every pull request.** No test may name the opened version.
- **Tests never read `~/.phax`, a real provider home or the global git config.**
- **A counter-example found during the run is a bug in the code under test unless the test made it.**

Every required command must equal an entry of `security.agentCommands` or a gate command exactly; an entry with a
space in it covers only itself. `node`, `pnpm exec tsx`, `pnpm test:unit`, `pnpm test:integration`, `git log`,
`git grep` are `agentCommands`; `pnpm test` is a gate command.
