---
status: Approved
source-spec: null
approved:
  date: 2026-10-25
  baseline: 0ba1aed
---
# Small fixes for 0.27

Six entries from `NEXT_STEPS.md` § *Small follow-ups*, for the open 0.27.0 release (0.26.0 is the last one shipped; `package.json` is already at 0.27.0). The operator settled the scope and the footer's shape on 2026-10-25, and this plan does not reopen them. Two follow-ups stay out because they touch the state machine and need their own design: a refused `phax resume` that leaves the run `failed`, and a person's handoff set aside after a crashed turn.

The six fixes, in four phases ordered from the cheapest:

1. **Test isolation (fix 4).** It comes first, so every later phase's tests are isolated from the start. Every unit and integration suite runs against a temporary home, and a guard in the shared test setup fails any test that touches the real `~/.phax`.
2. **Two refusals (fixes 5 and 6).** `phax plans lint` and the run preflight refuse an oracle file listed twice. `phax reset-phase` without `--yes` now runs the same refusals as the reset itself.
3. **Resume (fixes 2 and 3).** `phax resume` first rewrites a committed phase's missing `phase-handoff.md`, and the next prompt can tell a missing handoff from a first phase. The run's final message counts every committed phase from disk.
4. **The PR footer (fix 1) and the close.** A phax footer ends every run's pull request: the version, the plan and spec as permalinks at the published head commit, the agents that ran the phases, and the run's name. The summary's `**Plan**` line moves to the plan's path at that commit. The same phase removes the six entries from `NEXT_STEPS.md`.

Each phase is green on its own and carries its own tests. There are no oracle phases.

What stays unchanged:
- No CLI command, flag or exit code changes. Two help texts do change: `phax plans lint` lists the repeated-oracle-file rule (phase-02) and `phax resume` describes the handoff re-entry and its refusal (phase-03). Those phases edit `src/cli/cliDocs.ts` and regenerate `phax.usage.kdl` (`pnpm gen:usage-spec`), `docs/cli/reference.md` and the README's generated CLI section (`pnpm docs:cli`); nobody edits the generated files by hand.
- No persisted format changes: no schema, snapshot or `docs/upgrading.md` entry is needed.
- The layers hold (`cli → app → domain ← ports ← infra`). The footer text, the phase-count rule and the shared reset refusals are pure domain code. Every new I/O goes through a port. No new `node:fs` or `node:child_process` import appears in `app/`, `domain/` or `cli/`.
- Fixtures are made up. No test reads the real `~/.phax`, `~/.claude`, `~/.codex`, `~/.vibe` or the global git config.
- Every refusal names its remedy, and every README sentence a phase adds is checked against the code.

## Required commands

- `pnpm gen:usage-spec`
- `pnpm docs:cli`

Every phase is verified by the `standard` gate profile, whose commands `phax.json` already allows. A single suite runs with `pnpm test <path>`, which the `pnpm test` gate command covers. Phases 02 and 03 change CLI help text, so they regenerate `phax.usage.kdl` with `pnpm gen:usage-spec` and `docs/cli/reference.md` plus the README's generated CLI section with `pnpm docs:cli`; both are allowed in `phax.json`.

## Technical arbitrations

- Settled by the operator, recorded here so no phase reopens them: (1) The footer has no `phax.json` key; every run's pull request carries it. Loss: someone who does not want phax named in their pull requests edits each description by hand. (2) The plan and spec links are permalinks at the published head commit: `<repo web URL>/blob/<sha>/<path>`. Loss: a link does not follow corrections pushed to the pull request later.
- Fix 4, the guard: a vitest setup file (`tests/setup/phaxHomeGuard.ts`) wraps the path-taking `node:fs` and `node:fs/promises` calls of the test process and refuses any path inside the real `~/.phax` (taken from `os.userInfo().homedir`), except paths inside the repository under test. That repository's root is computed from the setup file's own location (`new URL("../..", import.meta.url)`), both as given and as its realpath. The exemption is needed because phase worktrees live under `~/.phax/worktrees/`, so the gate's `pnpm test` runs inside `~/.phax`; without it the guard would refuse every read of the repository itself. A refused call raises `EACCES` in the call's own style (thrown, rejected or passed to the callback), so nothing is read or written there, and it is recorded. A global `afterEach` then fails the test, so a refusal that the code under test swallowed is still caught. Loss: only the test process's `node:fs` calls are watched. A child process (git, a spawned `phax`) or a native addon reaching `~/.phax` is not caught, so spawned CLI children get a temporary `HOME` through `phaxHomeEnv()` instead, checked by a static test. Inside a phase worktree, a test that reached into its own run's worktree tree is not refused either; that tree is the repository under test. The other homes (`~/.claude`, `~/.codex`, `~/.vibe`, the global git config) are not guarded: `tests/setup/providerStores.ts` and `tests/helpers/isolateGit.ts` already keep those away. Rejected: one blanket `node:os` mock in the setup file for every suite. It would hide what each suite reads and collide with the suites that mock `node:os` themselves.
- Fix 4, the helper: `tests/helpers/isolatePhaxHome.ts` combines one hoisted `vi.mock("node:os", …)` line per suite, built from the helper's factory, with `isolatePhaxHome()` called in `beforeEach`, which also points `HOME` at a fresh per-test temporary home. The hoisted mock is needed because `PHAX_HOME_DIR`, `TELEMETRY_CONFIG_PATH`, `MODEL_ROUTING_PATH` and the default state root are computed when their module loads, so a `HOME` stub set later does not move them; the `HOME` variable covers child processes. The contract has two homes: the module-level constants point at a per-file import-time home, created with an empty `.phax/` the first time the mocked `homedir()` is called and removed in `afterAll`; `homedir()` and `HOME` follow the per-test home from `isolatePhaxHome()`. A file a suite writes at a module-level path therefore lands in the import-time home. Moving `HOME` also drops the developer's git identity, so a suite that commits pairs this helper with `isolateGit`. Loss: each isolated suite carries one boilerplate line that a helper cannot hoist for it. Rejected: making those constants lazy in `src/`, a production change made only for tests that would also touch every test using them.
- Fix 2, a phase that owes its handoff: a phase owes it when its status is `committed`, its `stop` is `null`, and its run-folder `phase-handoff.md` is absent or lacks a required section. The resume decision and `executePlan`'s re-entry read this through the FileSystem port with one shared predicate. Such a phase, final or not, re-enters through the existing handoff path: its session id, its worktree and the persisted `file-reconciliation.json`. No new event or state is added.
- Fix 2, when the worktree or the session is gone: decided by the operator on 2026-10-25. `phax resume` refuses (exit 1, nothing changed) with a new explicit reason, `handoff_unrecoverable`. The message names the phase, what is gone, and one remedy per case. Worktree gone (the session id is recorded): restore it with `git worktree add <recorded worktree path> <phase branch>`, then run `phax resume <run> --yes` again; phax then writes the handoff itself, for a final phase as well as an earlier one. Session id gone: write `<run folder>/<phase>/phase-handoff.md` with the four required sections by hand, then resume again; when the worktree is gone as well and the phase is final, the message also names the `git worktree add` step, since completion needs the worktree. Loss: autonomy in this rare case, since a person restores the worktree or writes the file. A non-final phase settled by a hand-written handoff also gets no record and keeps its worktree, because the steps after a handoff never run for it. Rejected: carrying on without the handoff. `review-handoff` would then fail at the end of the run with "Missing phase artifacts", far from the cause. A possible follow-up: a fresh read-only headless turn that writes the handoff from the phase commit when the session is gone.
- Fix 3: the count rule is an explicit set of the states a phase reaches only after its commit lands: `committed`, `handoff_failed`, `cleaning_up`, `cleaned_up` and `review_open`. `executePlan` returns `completedPhaseCount`, read from disk at the end, in place of the per-invocation `committedPhases` array. Nothing is lost: `final-report.md` is untouched.
- Fix 1, the paths at the head commit: phax resolves the final phase branch's head (`Git.resolveRef` on `refs/heads/<branch>`, so a tag of the same name is never picked) and reads that commit's tree (`Git.readTree`). It names the plan at its recorded path if the path is in that tree, else at its `archive/` counterpart (`archivePathFor`). It treats the spec the same way, starting from the `source-spec` of the run's `plan.md` copy. Loss: one recursive tree listing of the head commit per publish. Rejected: deriving the archive path from the run's state alone, which cannot tell a spec the run completed from one the chain gate kept. When the tree cannot be read, the plan falls back to its archive counterpart in a code span (run completion moves a lifecycle plan there before review opens), and the footer names no spec.
- Fix 1, the version: `phaxVersion` is a required option of both `publishRun` and `executePlan`. The CLI reads it with `readPackageVersion()`; the app layer never reads `package.json`. Loss: every `executePlan` call in the test suite (34 files) gains a made-up version. This is mechanical, and preferred over an optional field that a forgotten caller would leave as no version. A CLI unit test asserts that `run`, `resume` and `publish-pr` pass `readPackageVersion()`'s value, so the threading is not guarded by the typecheck alone.
- Fix 6: the shared reset refusals live in pure domain code. The caller passes the composed `PhaxState` and the `PhaseResetRequested` event, so the domain needs no clock and no random ids. Building the event needs the decoded phase id, so the "Invalid phase id" check (`phase_not_found`, today after the later-committed refusal in `resetPhaseLocked`) moves ahead of the shared check in both paths. Every refusal message stays byte-identical. Loss: the later-committed and `not_resettable` refusals still name no remedy. Rewording them is out of scope.
- Fix 1, the web URL: `gh repo view --json url` is decoded at the boundary with an Effect Schema (`src/schemas/githubRepoView.ts`: an object with one `url` field, an `https://` URL with no whitespace), as CLAUDE.md asks for external input. Loss: none beyond one more small schema; rejected: `-q .url` with a prefix check, which is not a decode.

---

## phase-01 — Isolate every test suite from the real ~/.phax {#phase-01-isolate-phax-home}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** high
**Assignment reason:** The fs guard, which wraps node:fs and syncs the ESM exports, is a mechanism no code in the repository shows yet. The suites it flags must be found by running the whole suite, so the phase takes a higher effort than the default.

Every unit and integration suite runs against a temporary home. No suite reads or writes the developer's `~/.phax`: `config.json`, `telemetry.json`, `model-routing.json`, `providers.json`, runs, worktrees or the telemetry journal. A guard in the shared test setup fails any test that touches the real `~/.phax`, naming the call, the path and the helper to use, so the leak cannot come back.

### Detailed instructions

- Write the guard first: `tests/setup/phaxHomeGuard.ts`. Add it to `setupFiles` in `vitest.config.ts`, after `tests/setup/providerStores.ts`. Do not add it to `vitest.e2e.config.ts`: the real e2e drives real providers.
- When the setup file loads, capture the real home once from `os.userInfo().homedir`, not from `HOME`, which suites stub. The guarded root is `<real home>/.phax`. The exempted root is the repository under test: `fileURLToPath(new URL("../..", import.meta.url))` (the setup file sits in `tests/setup/`), kept both as given and as its `realpathSync` result. It is exempted because phase worktrees live under `~/.phax/worktrees/`, so the gate's `pnpm test` runs inside `~/.phax`; a guard without the exemption refuses every read of the repository itself and the suite fails before any test runs.
- Wrap the path-taking entry points of `node:fs` (sync and callback) and of `node:fs/promises` that read, write, stat, open, list, create, remove, link or rename. At least: `readFileSync`/`readFile`, `writeFileSync`/`writeFile`, `appendFileSync`/`appendFile`, `existsSync`/`exists`, `statSync`/`stat`, `lstatSync`/`lstat`, `accessSync`/`access`, `openSync`/`open`, `opendirSync`/`opendir`, `readdirSync`/`readdir`, `mkdirSync`/`mkdir`, `mkdtempSync`/`mkdtemp`, `rmSync`/`rm`, `rmdirSync`/`rmdir`, `unlinkSync`/`unlink`, `renameSync`/`rename`, `copyFileSync`/`copyFile`, `cpSync`/`cp`, `readlinkSync`/`readlink`, `symlinkSync`/`symlink`, `linkSync`/`link`, `chmodSync`/`chmod`, `utimesSync`/`utimes`, `truncateSync`/`truncate`, `realpathSync`/`realpath`, and the streams `createReadStream`/`createWriteStream` (the provider adapters use them, e.g. `src/infra/providers/claudeCode.ts`). For the two-path calls (rename, copy, cp, symlink, link), check both paths. Patch them on the CommonJS `fs` object and on `fs.promises`. Keep the `realpathSync.native` and `realpath.native` properties on the wrappers, guarded the same way. Then call `syncBuiltinESMExports()` from `node:module`, so that ESM named and namespace imports see the wrapped functions. That covers `src/`, `src/infra/fs.ts` and `@effect/platform-node`. Make the install idempotent: mark it with a global symbol, so a test that imports the setup file again does not wrap twice.
- A wrapped call resolves its path arguments: a string, a Buffer or a file URL. Resolve a relative string against `process.cwd()`, and skip a file descriptor. When a path equals the guarded root or lies inside it, and does not lie inside the exempted root, record a violation `{ call, path }` and refuse with an `Error` whose `code` is `'EACCES'`. Its message names the call and the path, and says to isolate the suite with `tests/helpers/isolatePhaxHome.ts`. Refuse in the call's own style: a sync call throws; a `fs.promises` call returns a rejected promise (never throws synchronously, so `.rejects` and `.catch` chains still work); a callback call invokes its callback with the error on the next tick; a stream call returns a stream that emits the error. Never delegate such a call. Every other call delegates unchanged.
- Export the pure predicate `isInsidePhaxHome(path: string, phaxRoot: string, exemptRoots: readonly string[]): boolean`. It is true when the path is the root or below it and is not inside any exempted root. It must refuse siblings such as `~/.phaxx` and `~/.phax-backup`. Also export `takeGuardViolations()`, which drains and returns the recorded violations, and `assertNoGuardViolations()`, which drains them and throws one error listing each `call path` followed by the remedy line. Register a global `afterEach` in the setup file that calls `assertNoGuardViolations()`, so a violation the code under test swallowed still fails the test. loadConfig's overlay reader and an `orElseSucceed` are examples that swallow errors.
- Before isolating anything, run `pnpm test tests/integration/runPreflightBeforeNaming.test.ts` with the guard in place and confirm it fails on the real `~/.phax/config.json`. Record that in the handoff as the regression evidence.
- Write `tests/helpers/isolatePhaxHome.ts` on the model of `tests/helpers/isolateGit.ts`. Start with a header comment saying what it isolates and why a `HOME` stub alone is not enough: `PHAX_HOME_DIR` and `TELEMETRY_CONFIG_PATH` (`src/app/loadTelemetryConfig.ts`), `MODEL_ROUTING_PATH` and `PROVIDER_CONFIG_PATH` (`src/app/loadRouting.ts`) and the default state root (`src/app/projectContext.ts`) are computed from `homedir()` when their module loads.
- The helper exports three things. (a) A factory for the suite's hoisted `node:os` mock, written in the suite as one line: `vi.mock("node:os", async (importOriginal) => (await import("../helpers/isolatePhaxHome.js")).isolatedOs(await importOriginal()))`. Its `homedir()` returns the helper's current home. The first call creates the per-file import-time home (a temporary directory with an empty `.phax/` inside), so constants computed at import point inside it, never at the real home. That import-time home is removed in `afterAll`: export `removeImportTimeHome()` for the suite to register, or register it from the helper if Vitest allows that from a hoisted mock; either way it must not leak. (b) `isolatePhaxHome(): { readonly home: string; readonly restore: () => void }`, for `beforeEach`. It creates a fresh per-test temporary home with an empty `.phax/` inside, makes it current for the mocked `homedir()`, and sets `process.env.HOME` to it so child processes inherit it. `restore` puts `HOME` back and removes the directory with `removeTempDir` from `tests/helpers/tempGit.ts`. Nested calls share one saved environment, as in `isolateGit.ts`. (c) `phaxHomeEnv(): NodeJS.ProcessEnv`, the environment a test passes to a spawned phax CLI child: `process.env` with `HOME` set to a temporary home (the current per-test home when one is active, otherwise a fresh one removed in `afterAll`). Document the contract in the header comment: the module-level constants live in the import-time home and `homedir()`/`HOME` in the per-test home, so a file a suite writes at a module-level path lands in the import-time home. Moving `HOME` drops the developer's git identity, so a suite that commits pairs `isolatePhaxHome()` with `isolateGit()`. Adjust the exact signatures if Vitest's hoisting rules require it, but keep one hoisted line per suite plus one `beforeEach`/`afterEach` pair.
- Isolate the two confirmed suites with the helper: `tests/integration/runPreflightBeforeNaming.test.ts` and `tests/integration/resumePreflightRechecks.test.ts`. Keep an existing mock of the telemetry or routing loaders where a test uses it for its own purpose, such as `mockReturnValueOnce` on `loadModelRouting` or `loadProviderConfig`. Remove a mock whose only purpose was keeping `~/.phax` away, or keep it and say why in the handoff.
- Check the four likely suites and isolate each one the guard flags: `tests/integration/resume.test.ts`, `tests/integration/reviewHandoffCommand.test.ts`, `tests/integration/pruneCommand.test.ts` and `tests/unit/loadConfig.test.ts`. The last one calls `loadConfig`, which reads `homedir()/.phax/config.json`. Isolate also the three suites a prototype of the guard flagged during the plan review: `tests/integration/artifactNewHeadlessCommand.test.ts` (`access ~/.phax/model-routing.json`; its `HOME` stub comes after import), `tests/integration/costBackfill.test.ts` and `tests/integration/recordsExplain.test.ts` (`existsSync ~/.phax/config.json`).
- Spawned CLI children are out of the guard's reach, so give each one a temporary home. `tests/integration/usageSpecCompleters.test.ts` (`ls --complete`, run with `env: { ...process.env }` and `cwd` at the repository root, reads the real config and run registry) and `tests/integration/cliErrors.test.ts` (`run --plan` runs `loadConfig` and the telemetry config in the child) pass `phaxHomeEnv()` as the child's `env`. Check every other suite that spawns `src/cli/main.ts` or `dist/cli/main.js` (`authorArtifact`, `completions`, `heldStopCommands`, `lintPlan`, `plansEstimateCommand`, `phaseGuard`, `stoppedRunCommands`, `usageOutput`) and do the same where the child inherits the real `HOME`; a suite that already sets a temporary `HOME` for its child may keep it.
- Add a static test in `tests/unit/phaxHomeGuard.test.ts`: every file under `tests/unit/` and `tests/integration/` that names `src/cli/main.ts` or `dist/cli/main.js` also names `phaxHomeEnv` or `isolatePhaxHome`, or appears in an explicit exemption list in that test with a one-line reason per entry (a suite that sets its own temporary `HOME`).
- Then run the whole suite (`pnpm test`) with the guard and isolate every other suite it flags, in the same way. List each one in the handoff as an unplanned edit, with the guarded path it touched. Suites that already isolate themselves (`holdConfigRefused`, `holdCli`) may move to the helper, but need not.
- Do not change `src/`. The isolation and the guard live in `tests/` and `vitest.config.ts`. If a suite cannot be isolated without a `src/` change, finish the rest of the phase, keep that suite isolated with mocks of the loaders that read the home (as `holdCli.test.ts` does), and give the reason in the handoff. Never leave a suite reading the real `~/.phax`.
- Write the guard's own tests in `tests/unit/phaxHomeGuard.test.ts`. A guarded call (for example `readFileSync` on `<real home>/.phax/guard-probe-does-not-exist`) throws the guard's `EACCES`, never reaches the disk, and is returned by `takeGuardViolations()`. Drain it so the test's own `afterEach` stays green. The `fs.promises` variant rejects (assert with `.rejects`, not a synchronous throw), and the callback variant calls back with the error. A swallowed guarded call makes `assertNoGuardViolations()` throw a message naming the call, the path and the helper. A call outside the guarded root passes through. Cover `isInsidePhaxHome` with a table, including: a path inside the exempted tree passes; with the repository under `<home>/.phax/worktrees/phax.x/phase-01`, `<home>/.phax/config.json` is still refused and `<home>/.phax/worktrees/phax.x/phase-01/src/cli/main.ts` passes; siblings `~/.phaxx` and `~/.phax-backup` pass. Show that under `isolatePhaxHome`, `homedir()` and `process.env.HOME` lie inside the per-test home, and that the import-time constants `PHAX_HOME_DIR`, `TELEMETRY_CONFIG_PATH` and `MODEL_ROUTING_PATH` lie inside the import-time home and outside the real home. Installing the guard twice wraps once.

### Planned files to create

- `tests/setup/phaxHomeGuard.ts`
- `tests/helpers/isolatePhaxHome.ts`
- `tests/unit/phaxHomeGuard.test.ts`

### Planned files to edit

- `vitest.config.ts`
- `tests/integration/runPreflightBeforeNaming.test.ts`
- `tests/integration/resumePreflightRechecks.test.ts`
- `tests/integration/resume.test.ts`
- `tests/integration/reviewHandoffCommand.test.ts`
- `tests/integration/pruneCommand.test.ts`
- `tests/unit/loadConfig.test.ts`
- `tests/integration/artifactNewHeadlessCommand.test.ts`
- `tests/integration/costBackfill.test.ts`
- `tests/integration/recordsExplain.test.ts`
- `tests/integration/usageSpecCompleters.test.ts`
- `tests/integration/cliErrors.test.ts`

### Optional files that may be edited

- `tests/integration/holdConfigRefused.test.ts`
- `tests/integration/holdCli.test.ts`
- `tests/setup/providerStores.ts`
- `tests/helpers/tempGit.ts`
- `tests/helpers/isolateGit.ts`
- `tests/integration/authorArtifact.test.ts`
- `tests/integration/completions.test.ts`
- `tests/integration/heldStopCommands.test.ts`
- `tests/integration/lintPlan.test.ts`
- `tests/integration/plansEstimateCommand.test.ts`
- `tests/integration/phaseGuard.test.ts`
- `tests/integration/stoppedRunCommands.test.ts`
- `tests/integration/usageOutput.test.ts`

### Boundary contracts

Producer: `tests/setup/phaxHomeGuard.ts` exports `isInsidePhaxHome`, `takeGuardViolations` and `assertNoGuardViolations`, and installs the global `afterEach`. Producer: `tests/helpers/isolatePhaxHome.ts` exports the `node:os` mock factory, `isolatePhaxHome()` returning `{ home, restore }`, the import-time home's cleanup, and `phaxHomeEnv()` for spawned CLI children. Consumers: every unit and integration suite that runs phax code reading the home directory. Phases 02–04 isolate their new tests with this helper whenever those tests reach `loadConfig`, the routing loaders, telemetry or the default state root.

### Test strategy

- a node:fs call on a path inside the real ~/.phax is refused with EACCES in the call's own style (thrown, rejected, called back), recorded, and never reaches the disk — medium · example · the thrown or rejected error and takeGuardViolations() · in-phase
- a call on a path outside the real ~/.phax passes through the guard unchanged — medium · example · the file content read back · in-phase
- isInsidePhaxHome refuses the root and the paths below it, exempts the repository under test even when it sits under ~/.phax/worktrees/, still refuses ~/.phax/config.json then, and passes siblings such as ~/.phaxx — small · table · expected booleans · in-phase
- a guarded call the code under test swallowed still fails the test, naming the call, the path and the helper — medium · example · assertNoGuardViolations()'s message · in-phase
- installing the guard twice wraps each call once — small · example · one recorded violation per guarded call · in-phase
- under isolatePhaxHome, homedir() and HOME lie in the per-test home, and PHAX_HOME_DIR, TELEMETRY_CONFIG_PATH and MODEL_ROUTING_PATH in the import-time home, outside the real one — small · example · path prefixes · in-phase
- every suite that spawns the phax CLI gives the child a temporary HOME or is listed with a reason — small · static · the file scan · in-phase
- runPreflightBeforeNaming and resumePreflightRechecks fail under the guard before isolation and pass after it — medium · smoke · the guard's afterEach failure, then a green run · in-phase
- no unit or integration suite touches the real ~/.phax — medium · smoke · pnpm test green with the guard installed · in-phase

### Implementation order

1. The guard in tests/setup/phaxHomeGuard.ts and its registration in vitest.config.ts.
2. Its unit tests in tests/unit/phaxHomeGuard.test.ts.
3. Confirm runPreflightBeforeNaming fails under the guard (red).
4. The helper tests/helpers/isolatePhaxHome.ts.
5. Isolate the two confirmed suites, then the four likely ones.
6. Run pnpm test and isolate every other flagged suite.
7. Run the standard gate.

### Excluded scope

- Any change under src/, including making the module-level home paths lazy.
- Guarding ~/.claude, ~/.codex, ~/.vibe or the global git config (already covered by tests/setup/providerStores.ts and tests/helpers/isolateGit.ts).
- The real e2e config (vitest.e2e.config.ts).
- Moving suites that already isolate themselves to the helper, beyond what the guard requires.

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

The guard's path and exports (`isInsidePhaxHome`, `takeGuardViolations`, `assertNoGuardViolations`) and the exact set of `fs` entry points it wraps, how the exempted repository root is computed, and how each call style (sync, promise, callback, stream) refuses. The helper's path, its exports, and the one-line hoisted mock a suite writes, copied verbatim so later phases can paste it, the two-homes contract, and how `phaxHomeEnv()` is used for spawned CLI children. Evidence that `runPreflightBeforeNaming` failed under the guard before isolation. The full list of suites isolated, each with the guarded path it touched; list every suite beyond the planned ones as an unplanned edit with that reason. Any mock kept or removed in the confirmed suites, and why. Any deviation from the planned file lists, with the reason.

### Commit subject

`test: isolate every suite from the real ~/.phax and guard against a regression`

### Commit body

Several suites read the developer's ~/.phax: config.json through loadConfig, and telemetry.json and model-routing.json through module-level paths computed from homedir() at import. These included runPreflightBeforeNaming and resumePreflightRechecks. A HOME stub set after import did not move those paths.

tests/helpers/isolatePhaxHome.ts gives a suite a temporary home on the model of isolateGit.ts. A hoisted node:os mock moves homedir() and the import-time constants, and HOME moves child processes. A new setup file wraps the path-taking node:fs and node:fs/promises calls and refuses any path inside the real ~/.phax. A global afterEach fails the test even when the code under test swallowed the refusal. Every suite the guard flagged is isolated.

---

## phase-02 — Refuse a repeated oracle file; the reset-phase preview refuses what a reset refuses {#phase-02-lint-and-reset-refusals}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

`phax plans lint` reports an oracle file listed twice on an `**Oracle files:**` line as an error on the `oracles` check, naming the phase and the path. `phax run` and `phax resume` refuse such a plan with exit 11. `phax reset-phase` without `--yes` runs every refusal the reset runs, through one shared check, and refuses with the same message and exit code as `--yes` instead of printing "Would reset …".

### Detailed instructions

- Fix 5. In `src/domain/plan/oracleCheck.ts`, add a `repeated` row. For each declared oracle phase, each path that appears more than once in its oracle files yields one error on the `oracles` check, on that phase, with the message: oracle file <path> is listed more than once on **Oracle files:**: list each oracle file once. One finding per repeated path, in first-appearance order, however many times the path repeats.
- Place the row right after `noFiles` and before `unplanned` in the list `oracleFindings` returns, and update its doc comment. The row reads only the header, so it reports when `phases` is null too, like `noFiles`.
- The `unplanned` and `between` rows must read each oracle path once (deduplicated in first-appearance order). A repeated path that is also unplanned then gives one `unplanned` finding, not two.
- Do not change `splitEntries` (`src/domain/plan/phaseHeader.ts`) or the `oracle-request`. A plan with a repeated path is refused before any request is built: lint exits 1, and the run and resume preflights (`src/app/runPreflight.ts` and `src/app/executePlan.ts` share `oracleFindings`) refuse with exit 11, "Oracle preflight failed".
- Tests in `tests/unit/oracleCheck.test.ts`: a path repeated once; a path repeated three times gives one finding; two different repeated paths give two findings in order; a repeated path that is also unplanned gives one `unplanned` finding; an unparsed plan (`phases: null`) still reports the repeat. Keep the ordering test at line 314 passing unchanged, and add one ordering test that puts the repeat between `noFiles` and `unplanned`.
- In `tests/unit/runPreflight.test.ts`, next to the existing "Oracle preflight failed" cases, add one case as its own `it` (the refusal table there is `satisfies Record<RunPreflightCheck, RefusalCase>`, one case per key, so do not add a row to it): a plan whose oracle phase repeats an oracle file is refused, and the refusal names the repeated path.
- In `docs/oracle-phases.md`, in the paragraph after the oracle-phase header example (around line 104), say that each oracle file is listed once: a repeated path is an error on the `oracles` check of `phax plans lint`, and `phax run` and `phax resume` refuse the plan with exit 11.
- In `src/cli/cliDocs.ts`, in the `plans lint` long help's list of oracle-phase rules, add the repeated-file rule: an oracle file listed more than once on the **Oracle files:** line. Then regenerate `phax.usage.kdl` with `pnpm gen:usage-spec` and `docs/cli/reference.md` plus the README's generated CLI section with `pnpm docs:cli`. Never edit the generated files by hand; the drift tests compare them.
- Fix 6. Create `src/domain/resetPhaseRefusal.ts`, pure: no I/O, no clock, no random ids. Move `stoppedPhaseOf`, `checkTargetAtStop`, `TERMINAL_COMMITTED_STATES` and `STOPPED_AT_GATE_STATES` from `src/app/resetPhase.ts` into it, exporting what `resetPhase.ts` still needs (`stoppedPhaseOf`, and the committed-state set used by `selectTargetPhase`).
- It exports `type ResetRefusalReason = "phase_not_at_stop" | "phase_blocked_by_discharge" | "phase_blocked_by_later_committed" | "not_resettable"`, `interface ResetRefusal { readonly reason: ResetRefusalReason; readonly message: string }`, and `resetPhaseRefusal(input): ResetRefusal | null`. The input carries: the run's short name; the target `PhaseStatus`; every phase status; the plan phases (`readonly PhaxPlanPhase[] | undefined`, undefined when `phax-plan.json` is unreadable, as today); the composed `PhaxState` for the target (computed by the caller with `composePhaxState`); and the `PhaseResetRequested` event to interpret (built by the caller).
- It runs the refusals in today's order: the target is not the stopped phase; an oracle phase whose discharge has started; a closed stop of outcome `corrected` with `oracleStep: authored` whose pair's discharge has started; a later phase that is committed or cleaned up; and the reducer's disposition is not `Handled` (`not_resettable`). Keep every message byte-identical to today, including the single-quoted wording of the authored-stop refusal and the `--skip-oracle` recovery suffix when the discharge is stopped at its gate.
- In `src/app/resetPhase.ts`, `ResetPhaseError`'s `reason` becomes `"run_not_found" | "phase_not_found" | ResetRefusalReason`. `resetPhaseLocked` and `previewResetPhase` both resolve the run, select the target, decode the phase id (the "Invalid phase id" `phase_not_found` failure, today after the later-committed refusal, moves ahead of the shared check, since building the event needs the decoded id), read the plan phases (`readPlanPhases`), compose the state, build the event, call `resetPhaseRefusal`, and fail with `ResetPhaseError({ reason, message })` when it returns a refusal. The preview then goes on as today: at a stop it gathers the corrections, the person's handoff and the phase commit. The reset goes on as today: dispatch, archive, worktree, branch, `lastError`. Rewrite the preview's doc comment: it runs every refusal of the run's state that the reset runs. The preview still takes no lock; the reset runs the shared check under the lock, on what it read under the lock.
- `src/cli/commands/resetPhase.ts` needs no change: both paths print `phax reset-phase failed: <message>` and return 1. Confirm this, and edit it only if the check shows otherwise.
- Tests in a new `tests/unit/resetPhaseRefusal.test.ts`: a table of made-up phase statuses, one row per refusal reason, rows where the reset is allowed (null), and the order when two refusals apply (the first in the order above wins).
- Tests in `tests/integration/resetPhase.test.ts`, next to the existing refusal cases: one preview test per refusal, covering a later committed phase, an oracle phase whose discharge has started (with and without the `--skip-oracle` suffix), a closed authored stop whose discharge has started, and `not_resettable`. Each test asserts that `previewResetPhase` fails with the same reason and message as `resetPhase` on the same run, and that the run folder, worktree and branch are unchanged. The existing not-at-stop preview case stays.
- In the README, under "When a run stops", add one sentence: without `--yes`, `phax reset-phase` previews the reset, and it applies the same refusals of the run's state as `--yes`, with the same message and exit 1. (Only `--yes` takes the run lock, so a held lock is refused there alone, with its own exit code.) Check the sentence against the code.

### Planned files to create

- `src/domain/resetPhaseRefusal.ts`
- `tests/unit/resetPhaseRefusal.test.ts`

### Planned files to edit

- `src/domain/plan/oracleCheck.ts`
- `tests/unit/oracleCheck.test.ts`
- `tests/unit/runPreflight.test.ts`
- `docs/oracle-phases.md`
- `src/app/resetPhase.ts`
- `tests/integration/resetPhase.test.ts`
- `README.md`
- `src/cli/cliDocs.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`

### Optional files that may be edited

- `src/cli/commands/resetPhase.ts`
- `tests/e2e/resetPhase.test.ts`

### Boundary contracts

Producer: `src/domain/resetPhaseRefusal.ts` exports `resetPhaseRefusal(input): ResetRefusal | null`, `ResetRefusalReason`, `stoppedPhaseOf` and the committed-state set. Consumers: `resetPhaseLocked` and `previewResetPhase` in `src/app/resetPhase.ts`, which compose the state and build the event, then wrap a refusal in `ResetPhaseError`. Producer: `oracleFindings` in `src/domain/plan/oracleCheck.ts`. Consumers: `src/app/lintPlan.ts`, `src/app/runPreflight.ts` and `src/app/executePlan.ts`, unchanged; they gain the new row through the shared function.

### Test strategy

- an oracle file listed twice on one phase is one oracles error naming the phase and the path, however often it repeats — small · example · the finding list · in-phase
- the repeated row sits after the noFiles row and before the unplanned row, and the existing order test still holds — small · example · the ordered finding list · in-phase
- a repeated path that is also unplanned yields one unplanned finding — small · example · the finding list · in-phase
- the run preflight refuses a plan that repeats an oracle file — small · example · the preflight's refusal naming the path · in-phase
- every (target, run state) row gives the refusal or the null the reset rules state, the first refusal in order winning — small · table · the refusal reason and message · in-phase
- the preview fails with the same reason and message as the reset for each of the five refusals, and changes nothing — medium · example · the two ResetPhaseError values and the run folder before and after · in-phase

### Implementation order

1. The repeated row in oracleCheck.ts and its unit tests.
2. The run preflight case in tests/unit/runPreflight.test.ts.
3. docs/oracle-phases.md.
4. src/domain/resetPhaseRefusal.ts and its table test.
5. Wire resetPhaseLocked and previewResetPhase through it.
6. Preview refusal tests in tests/integration/resetPhase.test.ts.
7. The README sentence.
8. Run the standard gate.

### Excluded scope

- Rewording any reset refusal message, or adding remedies to the messages that lack one.
- Deduplicating oracle paths in splitEntries or in the oracle-request.
- Any change to the reducer's PhaseResetRequested rules.
- Any new CLI flag or exit code.

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

The exact message of the repeated-oracle-file finding and where its row sits in `oracleFindings`. The path and signature of `resetPhaseRefusal`, the order of its refusals, and confirmation that every message is byte-identical to before. Whether `src/cli/commands/resetPhase.ts` needed a change. The new `plans lint` help line, and confirmation that `phax.usage.kdl`, `docs/cli/reference.md` and the README's generated section were regenerated, not hand-edited. The list of preview tests added, one per refusal. Any deviation from the planned file lists, with the reason.

### Commit subject

`fix(lint,reset-phase): refuse a repeated oracle file; preview refuses what a reset refuses`

### Commit body

An **Oracle files:** line accepted a repeated path, and phax sent it twice in the oracle-request. oracleFindings now reports each repeated path once, as an error on the oracles check, right after the empty-list row. Because the run preflight shares the check, phax run and phax resume refuse such a plan with exit 11.

phax reset-phase without --yes ran only the not-at-stop refusal, so it printed "Would reset …" for a reset the use case would refuse. The refusals now live in one pure domain check: not at the stop, an oracle discharge started, a closed authored stop with its discharge started, a later committed phase, and the reducer's not_resettable. The preview and the reset both run it, so the preview refuses with the same message and exit 1 as --yes.

---

## phase-03 — Resume regenerates a missing handoff and counts every committed phase {#phase-03-resume-handoff-and-count}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium
**Assignment reason:** The phase changes executePlan's resume re-entry and the resume decision together, around a path where the run stays running with a committed phase. No existing branch shows that design, and a wrong order would re-run or skip work.

A usage or rate limit hit inside a committed phase's handoff turn no longer leaves later phases without that handoff. `phax resume` first writes the missing `phase-handoff.md` through the existing handoff re-entry, for a final phase as well as an earlier one, and refuses with a named remedy when the worktree or the session is gone. A next-phase prompt says when an earlier phase's handoff is missing, never "(no previous phase)". The run's final message, from `phax run` and from `phax resume`, counts every committed phase of the run from its phase statuses on disk, across resumes.

### Detailed instructions

- Confirm the facts before changing code, and cite them in the handoff. `RateLimitDetected` on a `running` run whose phase is `committed` is ignored (`src/domain/reducer.ts`), so a limit inside `generatePhaseHandoff` leaves the run `running`, the phase `committed`, no run-folder `phase-handoff.md`, and the worktree in place. `findNextResumablePhase` (`src/app/resume.ts`) skips a non-final `committed` phase. A `committed` final phase takes `resumeFromCompletion`, which skips the handoff.
- Move `copiedHandoffIsValid` out of `src/app/executePlan.ts` into `src/app/handoffInjection.ts`, as an exported Effect over the FileSystem port (for example `committedHandoffIsValid(phaseFolderPath)`): true when the run-folder `phase-handoff.md` exists and `validateHandoffSections` finds no missing section. A phase owes its handoff when its status is `committed`, its `stop` is `null`, and that predicate is false. Use this one predicate in the resume decision and in `executePlan`.
- In `src/app/resume.ts`, `findNextResumablePhase` takes a required fourth argument, `owedHandoffs: ReadonlySet<string>` (phase ids). A non-final `committed` phase whose id is in the set is resumable. Add an Effect `readOwedHandoffs(runPath, phaseStatuses)` that applies the predicate through the FileSystem port. `inspectResumeFromInfo(info, hold, owedHandoffs)` takes the set; `inspectResume` reads it itself. Add no new `node:fs` import to `app/` or `cli/`.
- Add `handoff_unrecoverable` to `ResumeRefusalReason` (decided by the operator on 2026-10-25: refuse, with a remedy per case). When the next resumable phase owes its handoff and either its recorded worktree no longer exists or its status has no `claudeSessionId`, refuse with that reason. Check this before the generic `missing_worktree` check, so the message carries the remedy. The message names the phase and what is gone (the worktree path, the session id, or both), then the remedy for that case. Worktree gone, session id recorded: `git worktree add <recorded worktree path> <phase branch>` (the phase's recorded branch, e.g. `phax/<run>--<phase>`), then `phax resume <run> --yes`; phax then writes the handoff itself, final phase or not. Session id gone: write `<run folder>/<phase>/phase-handoff.md` with the four required sections (list `REQUIRED_HANDOFF_SECTIONS`), then `phax resume <run> --yes`; when the worktree is gone too and the phase is final, also name the `git worktree add` step, because completion needs the worktree (a committed final phase whose worktree is gone is otherwise refused as `missing_worktree`). The CLI prints it and exits 1, as for every refusal; nothing changes on disk.
- In `src/cli/commands/resume.ts`, compute the owed handoffs through the FileSystem port, with `makeRepoRootedFileSystemLayer(config)` as the routing load already does, before the decision, and pass them in. When the decision's phase owes its handoff, the preview prints one more line right after the "would resume from phase …" line: `  Writing the missing handoff of <phase> first (its handoff turn did not finish).`
- In `src/app/executePlan.ts`'s resume re-entry, add a branch before the final-committed (`resumeFromCompletion`) branch. A `committed` phase whose `stop` is null and whose handoff is not valid takes `resumeFromHandoff`, with the session id and worktree from its status, whether it is final or not. Keep every other branch in its current order: a held phase at its hold point first, then `handoff_failed` or a held committed phase, `passed`, `cleaning_up`, the final committed phase (now reached only with a valid handoff) going to completion, and the closed stop. The re-entry reads the persisted `file-reconciliation.json` (the existing path) and runs `generatePhaseHandoff`. A non-final phase then continues through the briefs, the hold point, the record and the cleanup; a final phase through completion, review and publish. Add no new event, state or reducer change.
- A second limit inside the regenerated handoff turn leaves the phase `committed` and still owing; the next resume re-enters it the same way. A test covers this.
- In `src/app/handoffInjection.ts`, `readPreviousHandoff` returns an explicit union, `type PreviousHandoff = { readonly kind: "first-phase" } | { readonly kind: "present"; readonly text: string } | { readonly kind: "missing"; readonly phaseId: string }`. It returns `first-phase` when there is no earlier headless phase, and `missing` when that phase's file is absent.
- In `src/app/promptGeneration.ts`, `BuildPhasePromptOptions.previousHandoff` becomes a required `PreviousHandoff`. `first-phase` renders `(no previous phase)` as today; `present` renders the text; `missing` renders: (The handoff of <phase> is missing: that phase committed, but phax holds no phase-handoff.md for it. Read its commit on this branch for what it delivered.)
- Fix 3. Create `src/domain/completedPhases.ts` exporting `countCompletedPhases(statuses: readonly { readonly state: PhaseState }[]): number`. It counts the states a phase reaches only after its commit lands, as an explicit set: `committed`, `handoff_failed`, `cleaning_up`, `cleaned_up` and `review_open`. A comment says why `awaiting_review` (a declared stop before its close commits) and `skipped` are out.
- In `ExecutePlanResult`, replace `committedPhases: readonly string[]` with `completedPhaseCount: number`. Compute it at the end of a successful execution from the run's phase statuses on disk (`resolveRun` after `FinalReviewOpened`) with `countCompletedPhases`. Remove the in-memory `committedPhases` array once nothing else reads it.
- `src/cli/commands/run.ts` reads `completedPhaseCount` for its "reached review — N phase(s) complete" line and for `buildWhatsNext`; `src/cli/commands/resume.ts` prints no such line of its own, and passes `completedPhaseCount` to `buildWhatsNext`, whose headline carries the count. The `review_open` refusal branch in `resume.ts` uses `countCompletedPhases(info.phaseStatuses)` in place of its inline filter. `run.ts`'s "all phases" fallback goes, since the count is always known. `final-report.md` is untouched. `src/domain/whatsNext.ts` may make `phaseCount` a required number.
- Tests, with made-up plans, in `tests/integration/rateLimit.test.ts` and/or `tests/integration/resumeHandoff.test.ts`, using the fake backend's `failResumeWithRateLimit` at the handoff turn's resume index:
- (a) In a three-phase plan, a limit on phase-01's handoff turn pauses the run with phase-01 committed and no run-folder `phase-handoff.md`. `inspectResumeOnDisk` picks phase-01. The resume writes phase-01's handoff with every section, phase-02's prompt carries phase-01's handoff text and not "(no previous phase)", the run reaches `review_open`, and `completedPhaseCount` is 3.
- (b) A limit on the final phase's handoff turn: the resume writes the final handoff, completes the plan, writes `review-handoff.md`, and leaves the run at `review_open`.
- (c) A second limit inside the regenerated handoff turn: the phase still owes it, and a third invocation finishes.
- (d) An owing phase whose worktree was removed, with its session id recorded: refused with `handoff_unrecoverable`; the message names the worktree path and the `git worktree add <path> <phase branch>` remedy, and nothing changes on disk. Restoring the worktree at that path from the phase branch lifts the refusal: the next resume writes the handoff itself.
- (e) An owing phase with no `claudeSessionId`: the same reason; the message names the missing session id and the file to write by hand. A final phase with both gone also names the `git worktree add` step.
- (f) On the session-gone case of (e), a hand-written valid `phase-handoff.md` lifts the refusal, and the resume goes on to the next phase.
- Fix 3's own regression: a limit pauses phase-02 of three, the run is resumed, and `completedPhaseCount` is 3, not 2.
- Unit tests: `findNextResumablePhase` with `owedHandoffs` in `tests/unit/resume.test.ts`; the three `PreviousHandoff` variants in `tests/unit/promptGeneration.test.ts`; a table over every `PhaseState` in a new `tests/unit/completedPhases.test.ts`. Update `tests/unit/cli/resume.test.ts` and `tests/unit/cli/run.test.ts` (its module mocks, and the new `completedPhaseCount` field) and the `committedPhases` assertion in `tests/integration/executePlan.test.ts`. Isolate every touched suite that reaches `~/.phax` with `tests/helpers/isolatePhaxHome.ts`; the guard from phase-01 fails it otherwise.
- Leave `NEXT_STEPS.md` alone: the cost row of interactive-phases plan 3 mentions this follow-up and stays as it is, and phase-04 closes the entries.
- In `src/cli/cliDocs.ts`, extend the `resume` long help: a committed phase whose handoff turn was cut short (a rate or usage limit) gets its handoff written first, in that phase's session and worktree; when the worktree is gone, or the session id, resume refuses with exit 1 and names the remedy (restore the worktree with `git worktree add`, or write the handoff by hand). Then regenerate `phax.usage.kdl` with `pnpm gen:usage-spec` and `docs/cli/reference.md` plus the README's generated CLI section with `pnpm docs:cli`; never hand-edit them.
- In the README, under "When a run stops", check each sentence against the code. Two sentences become false and change as follows. In the code block, the `phax resume <run>` comment becomes `# continue from the next phase, or finish a committed phase's cut-short handoff`. The sentence "`resume` never re-runs a committed phase." becomes "`resume` never re-runs a committed phase's work; it only runs that phase's handoff turn again when the turn was cut short." Then add that a phase that committed but whose handoff turn was cut short (a rate or usage limit) gets its handoff written first: `phax resume` runs the handoff turn again in that phase's session and worktree, then goes on. Add that when that worktree is gone, resume refuses with exit 1 and names the `git worktree add` command that restores it, and when the session id is gone, it names the file to write by hand. Add that the final message counts every phase of the run that committed, across resumes.

### Planned files to create

- `src/domain/completedPhases.ts`
- `tests/unit/completedPhases.test.ts`

### Planned files to edit

- `src/app/resume.ts`
- `src/app/executePlan.ts`
- `src/app/handoffInjection.ts`
- `src/app/promptGeneration.ts`
- `src/cli/commands/resume.ts`
- `src/cli/commands/run.ts`
- `tests/unit/resume.test.ts`
- `tests/unit/promptGeneration.test.ts`
- `tests/unit/cli/resume.test.ts`
- `tests/unit/cli/run.test.ts`
- `tests/integration/rateLimit.test.ts`
- `tests/integration/resumeHandoff.test.ts`
- `tests/integration/executePlan.test.ts`
- `README.md`
- `src/cli/cliDocs.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`

### Optional files that may be edited

- `src/domain/whatsNext.ts`
- `tests/unit/whatsNext.test.ts`
- `src/app/handoffGeneration.ts`
- `tests/helpers/inspectResume.ts`
- `tests/integration/reviewCorrectionsPrompt.test.ts`
- `src/infra/fakes/backend.ts`
- `tests/unit/__snapshots__/promptGeneration.test.ts.snap`

### Boundary contracts

Producer: `src/app/handoffInjection.ts` exports the owed-handoff predicate and `PreviousHandoff`; `src/app/resume.ts` exports `readOwedHandoffs` and the decision taking `owedHandoffs`. Consumers: `src/cli/commands/resume.ts` (decision and preview line) and `executePlan`'s re-entry branch, which need the same answer to "does this committed phase still owe its handoff". Producer: `src/domain/completedPhases.ts` exports `countCompletedPhases`, pure over phase states. Consumers: `executePlan` (`completedPhaseCount`) and `resume.ts`'s review_open refusal branch. Producer: `buildPhasePrompt`, whose `previousHandoff` is the explicit union; consumer: `executePlan` via `readPreviousHandoff`.

### Test strategy

- a limit inside a non-final phase's handoff turn is followed, on resume, by that handoff being written before the next phase, whose prompt carries it — medium · example · the run-folder handoff file and the next prompt's text · in-phase
- a limit inside the final phase's handoff turn is followed, on resume, by the handoff, the plan's completion and review-handoff.md — medium · example · the files and the run state review_open · in-phase
- a second limit in the regenerated handoff turn leaves the phase owing, and the next resume finishes it — medium · example · the phase state and handoff file after each invocation · in-phase
- an owing phase whose worktree is gone is refused with handoff_unrecoverable naming the git worktree add remedy, and restoring the worktree lets resume write the handoff — medium · example · the typed refusal, the run folder before and after, then the handoff file · in-phase
- an owing phase whose session id is gone is refused naming the file to write by hand, and a hand-written handoff lifts the refusal — medium · example · the typed refusal, then the next phase starting · in-phase
- findNextResumablePhase returns a committed phase exactly when it owes its handoff — small · table · the chosen phase id · in-phase
- the prompt tells a first phase, a present handoff and a missing one apart — small · example · the rendered Previous phase handoff section · in-phase
- countCompletedPhases counts exactly the states reached after a commit, over every PhaseState — small · table · the state set · in-phase
- a run paused by a limit at phase-02 of three and resumed reports 3 completed phases — medium · example · completedPhaseCount · in-phase

### Implementation order

1. countCompletedPhases and its table test.
2. The owed-handoff predicate in handoffInjection.ts and readOwedHandoffs in resume.ts.
3. findNextResumablePhase and inspectResumeFromInfo, with the handoff_unrecoverable refusal, and their unit tests.
4. PreviousHandoff, readPreviousHandoff and buildPhasePrompt, with their tests.
5. executePlan's re-entry branch and completedPhaseCount.
6. The resume and run CLI wiring and the preview line.
7. Integration tests (a)–(f) and the count regression.
8. The README sentences.
9. Run the standard gate.

### Excluded scope

- Any reducer or state-machine change: no new event or state, and RateLimitDetected on a committed phase stays ignored.
- Writing resume-instructions.md for a limit during the handoff.
- Cleaning up a non-final committed phase whose handoff is valid but whose cleanup never ran.
- A refused phax resume leaving the run failed, and a person's handoff set aside after a crashed turn (operator-excluded).
- final-report.md.

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

The facts confirmed in the code, with file and line. The owed-handoff predicate's name and module. The new signatures of `findNextResumablePhase`, `inspectResumeFromInfo` and `readOwedHandoffs`. The exact `handoff_unrecoverable` message for each case (worktree gone, session id gone, both) and the preview line. The new `resume` help text, and confirmation that the generated docs were regenerated. The `executePlan` re-entry branch order as it now stands. The `PreviousHandoff` union and the missing-handoff wording. The `countCompletedPhases` state set and where `completedPhaseCount` is computed. The tests added, (a)–(f) and the count regression, with their files. Every suite isolated with the phase-01 helper. Any deviation from the planned file lists, with the reason.

### Commit subject

`fix(resume): regenerate a committed phase's missing handoff; count every committed phase`

### Commit body

A usage limit inside a committed phase's handoff turn left no phase-handoff.md. phax resume then started the next phase, whose prompt read "(no previous phase)". On a final phase, it skipped to completion, and review-handoff failed with "Missing phase artifacts".

A committed phase whose handoff is missing or invalid now owes it. Resume selects that phase and re-runs only its handoff, through the existing handoff re-entry (session, worktree, persisted reconciliation), before the next phase or the final review. When the worktree or the session id is gone, resume refuses with handoff_unrecoverable and names the file to write by hand. The prompt now tells a missing handoff from a first phase.

The final "N phase(s) complete" counted only the last invocation's commits. executePlan now returns completedPhaseCount, read from the phase statuses on disk with one domain rule that the review_open refusal shares.

---

## phase-04 — A phax footer on every run's pull request {#phase-04-pr-footer}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium
**Assignment reason:** The phase designs a new GitHub port call and the head-commit path resolution across ports, app and domain, which no code in the repository shows yet. It also threads a required option through every executePlan caller.

Every pull request phax creates ends with a footer that is never cut when the body is shortened. It carries the line `🛤️ Generated with [phax](https://docs.phax.run) <version> — the golden path, just facts`, then the plan and the spec as permalinks at the published head commit, the agents that ran the phases (provider, model and effort, with the number of phases each ran), and the run's qualified name. The summary's `**Plan**` line names the plan where it lives at that commit, under `docs/plans/archive/`. A footer lookup that fails never fails a publish, and a reused pull request keeps its body. The phase also removes the six closed entries from `NEXT_STEPS.md`.

### Detailed instructions

- Port. In `src/ports/github.ts`, add `repoWebUrl(repo: string): Effect.Effect<string, GitHubError>`, documented as the repository's web URL as the host reports it, never rebuilt from a git remote. Create `src/schemas/githubRepoView.ts`: an Effect Schema for `gh repo view --json url`'s answer, an object with one `url` field that is an `https://` URL with no whitespace, and a decode function. In `src/infra/github.ts`, implement `repoWebUrl` with `gh repo view --json url` (no `-q`): parse the stdout as JSON and decode it with that schema, failing with a `GitHubError` naming the refusal when the JSON is invalid or the decode refuses. In `src/infra/fakes/github.ts`, record the call (`{ method: "repoWebUrl", repo }`), return a configurable URL (default `https://github.com/example/repo`), and add a way to make the next call fail. Extend `tests/unit/publish/githubFake.test.ts` for both, and add `tests/unit/githubRepoView.test.ts`: a valid answer decodes; a missing `url`, an `http://` URL, a URL holding whitespace and an extra key are each refused.
- Write the real adapter's test in a new `tests/integration/githubRepoWebUrl.test.ts`. Put a temporary executable `gh` script first on `PATH` (`vi.stubEnv`), with made-up output. A `{"url": …}` answer on stdout is returned. Output that is not JSON, and JSON the schema refuses, are each a `GitHubError`. A non-zero exit is a `GitHubError`.
- Domain. Create `src/domain/publish/prFooter.ts`, pure, with explicit per-variant unions. `PrPlanRef` = `{ kind: "permalink"; path; url }` | `{ kind: "path"; path }` | `{ kind: "unrecorded" }`. `PrSpecRef` = `{ kind: "permalink"; path; url }` | `{ kind: "path"; path }` | `{ kind: "none" }`. `PrAgentGroup` = `{ provider; model; effort; phases: number }`. `PrFooterInput` = `{ version; plan: PrPlanRef; spec: PrSpecRef; agents: readonly PrAgentGroup[]; qualifiedName }`.
- The module also exports: `locateAtHead(recorded: string, headPaths: ReadonlySet<string>): string | null`, which returns `recorded` when it is in the set, else `archivePathFor(recorded)` when `classifyArtifactPath(recorded)` is not null and that path is in the set, else null; `permalink(webUrl, sha, path)`, which builds `<webUrl without a trailing slash>/blob/<sha>/<path>` with each path segment URI-encoded; `groupAgents(phases)`, which groups `{ provider, model, effort }` entries in order of first appearance and counts each group; and `renderPrFooter(input): string`.
- The footer's exact shape, one fact per line, joined with the same trailing-backslash Markdown hard break as the summary:
- Footer layout: a `---` line, a blank line, then the generated line `🛤️ Generated with [phax](https://docs.phax.run) <version> — the golden path, just facts`.
- Next comes `**Plan** <plan>`, followed by ` · **Spec** <spec>` unless the spec is `none`.
- Next comes `**Agents** <group>; <group>…`, where a group reads `<provider> \`<model>\` at <effort>: <n> phase` (`phases` when n is not 1). This line is left out when there is no group.
- Last comes `**Run** \`<qualifiedName>\``.
- A permalink renders as a Markdown link whose text is the path in a code span. A plain path renders as a code span. `unrecorded` renders as `loose plan`.
- In `src/domain/publish/prBody.ts`, the body takes the footer input (add it to `ShortPrBodyInput`), and the summary's `**Plan**` fact renders the same `PrPlanRef`, from one source, so the summary and the footer always agree. The footer is the body's last section. When the body is shortened, `SHORTENED_NOTE` comes before the footer. The footer counts among the never-cut sections: it is inside `render`, so `fits` measures it and the fully cut fallback still carries it.
- App. In `src/app/publishRun.ts`, add a required `phaxVersion: string` to `PublishRunOpts`. After the existing-pull-request check, so a reused pull request (`prStatus: "exists"`) does no new lookup and keeps its body as today, and before building the body, gather the footer facts. Each lookup is wrapped so that it never fails the publish:
- Head commit and tree: `sha = git.resolveRef(opts.repoRoot, "refs/heads/" + finalPhaseBranch)` (the full ref name, so a tag of the same name is never picked), null on an error or a missing ref. `headPaths` is the set of the `git.readTree(opts.repoRoot, sha)` entry paths, or null when there is no sha or the tree cannot be read.
- Web URL: `webUrl = github.repoWebUrl(opts.repoRoot)`, null on an error.
- The plan. With no recorded `planRepoRelPath`, it is `unrecorded`. A path that is not an artifact path (a loose plan) gives `path(recorded)`. An artifact path is located with `locateAtHead` when `headPaths` is known: with a sha and a web URL it becomes a permalink, otherwise a `path`. When `headPaths` is null or the plan is in neither place, use `path(archivePathFor(recorded))`.
- The spec. Read the run folder's `plan.md` copy through the FileSystem port; when it is absent or unreadable, the spec is `none`. `readSourceSpec` gives a declared spec path; `source-spec: null` gives `none`, and so does its `null` return on undecodable frontmatter. The declared path is located with `locateAtHead` only when `headPaths` is known. With a sha and a web URL it becomes a permalink; located but without them, a `path`; not located, or with no tree, `none`.
- The agents. For each phase with status `passed`, in plan order, read `<run folder>/<phaseId>/agent-binding.json` through the FileSystem port and decode it with `decodePhaseAgentBinding`. A missing or undecodable binding leaves that phase out (an interactive phase has none). Then group with `groupAgents`.
- The version: `opts.phaxVersion`. The qualified name: `runKey(namespace, shortName)`.
- Version threading. Add a required `phaxVersion: string` to `executePlan`'s options and pass it to `publishRun` on auto-publish. `src/cli/commands/run.ts`, `src/cli/commands/resume.ts` and `src/cli/commands/publishPr.ts` pass `readPackageVersion()` from `./usage.js`. The app layer never reads `package.json`. Every `executePlan` call in `tests/` passes a made-up version (e.g. `0.0.0-test`). That is mechanical; touch nothing else in those files. Add CLI unit assertions in `tests/unit/cli/run.test.ts` and `tests/unit/cli/resume.test.ts` (and a `publish-pr` case where its command is unit-tested, else in `tests/integration/publishRun.test.ts` through the command) that the option carries `readPackageVersion()`'s value.
- Tests in a new `tests/unit/publish/prFooter.test.ts`: the exact footer for a full input; a spec of `none`; a plan as a `path` (no link); `unrecorded`; agents grouped in order of first appearance, singular and plural; a permalink for a path holding a space; a `locateAtHead` table (recorded present, archived present, neither, and a loose path never mapped to an archive).
- Tests in `tests/unit/publish/prBody.test.ts`: the footer is the last section, after Full detail. A shortened body keeps the footer whole, after the shortened note. A body pushed over the cap only by the footer is shortened. The summary's `**Plan**` line shows the same ref as the footer. Update the existing fixtures to the new input. `tests/integration/reviewedPhasesSurfaces.test.ts` builds `ShortPrBodyInput` (around line 192) and no longer typechecks once the footer input is required: update it.
- Tests in `tests/integration/publishRun.test.ts`, with the fake git seeded with a head commit for the final phase branch and its tree, plus the fake GitHub:
- (a) A plan and spec both archived at the head give two permalinks at the head sha in `pr-body.md`, and the summary names `docs/plans/archive/…`.
- (b) A spec kept live at `docs/specs/…` gets that path's permalink.
- (c) A failed `repoWebUrl` gives code spans, and the publish is still `published`.
- (d) A null `resolveRef` gives no links, the plan at its archive counterpart, and no spec.
- (e) A loose plan gives a code span.
- (f) `source-spec: null` gives no Spec part.
- (g) Three agent bindings with two assignments give one grouped Agents line.
- (h) An existing pull request gives no `repoWebUrl` call and no body written, as today.
- (i) The version from the option appears in the generated line.
- Update the existing summary expectation at about line 511 to the archived path. Add `phaxVersion` to every `publishRun` call there and in `tests/integration/recordsPush.test.ts`.
- In the README, in "Review and land", right after the `phax publish-pr` paragraph, describe the footer: a made-up example; the plan and spec are permalinks at the published head commit, each named where it lives in that commit's tree (its recorded path, else its `archive/` counterpart); a loose plan, a missing web URL or an unreadable head gives a code span, and no spec line when there is none; the footer is never cut when the body is shortened; a pull request that already exists keeps its body; there is no setting to turn the footer off. Check every sentence against the code.
- In `NEXT_STEPS.md` § Small follow-ups, remove the six entries this plan closes: the PR footer, a usage limit during the handoff, the final message's phase count, the older tests reading the real `~/.phax`, the repeated oracle file, and the reset-phase preview. Keep the other entries. Leave the cost row of interactive-phases plan 3 as it is.
- Isolate every touched suite that reaches `~/.phax` with `tests/helpers/isolatePhaxHome.ts` (phase-01).

### Planned files to create

- `src/domain/publish/prFooter.ts`
- `tests/unit/publish/prFooter.test.ts`
- `tests/integration/githubRepoWebUrl.test.ts`
- `src/schemas/githubRepoView.ts`
- `tests/unit/githubRepoView.test.ts`

### Planned files to edit

- `src/ports/github.ts`
- `src/infra/github.ts`
- `src/infra/fakes/github.ts`
- `src/domain/publish/prBody.ts`
- `src/app/publishRun.ts`
- `src/app/executePlan.ts`
- `src/cli/commands/run.ts`
- `src/cli/commands/resume.ts`
- `src/cli/commands/publishPr.ts`
- `tests/unit/publish/githubFake.test.ts`
- `tests/unit/publish/prBody.test.ts`
- `tests/integration/publishRun.test.ts`
- `tests/integration/recordsPush.test.ts`
- `README.md`
- `NEXT_STEPS.md`
- `tests/helpers/heldRunFixture.ts`
- `tests/integration/runCarriesCompletion.test.ts`
- `tests/integration/declaredStopRun.test.ts`
- `tests/integration/stateMachineContract.test.ts`
- `tests/integration/skillEditGrants.test.ts`
- `tests/integration/routing.test.ts`
- `tests/integration/resumeFromCleanup.test.ts`
- `tests/integration/resumeFromCompletion.test.ts`
- `tests/integration/resume.test.ts`
- `tests/integration/resumeHandoff.test.ts`
- `tests/integration/perPhaseBranch.test.ts`
- `tests/integration/modelPreflight.test.ts`
- `tests/integration/rateLimit.test.ts`
- `tests/integration/resumeFromCommit.test.ts`
- `tests/integration/skillEditConsent.test.ts`
- `tests/integration/gateRefusal.test.ts`
- `tests/integration/agentCommandGrants.test.ts`
- `tests/integration/executePlan.test.ts`
- `tests/integration/briefRecords.test.ts`
- `tests/integration/pushedBrief.test.ts`
- `tests/integration/gateLogTrailer.test.ts`
- `tests/integration/costLedger.test.ts`
- `tests/integration/oraclePhases.test.ts`
- `tests/integration/reconciliation.test.ts`
- `tests/integration/gateRequest.test.ts`
- `tests/integration/runBranchDirtyTree.test.ts`
- `tests/integration/telemetry/end-to-end.test.ts`
- `tests/integration/setupFailure.test.ts`
- `tests/e2e/resetPhase.test.ts`
- `tests/e2e/gateExhaustionResume.test.ts`
- `tests/e2e/semanticTrace.test.ts`
- `tests/e2e/semanticTrace.declaredStop.test.ts`
- `tests/e2e/semanticTrace.heldStop.test.ts`
- `tests/e2e/semanticTrace.providers.test.ts`
- `tests/integration/reviewedPhasesSurfaces.test.ts`
- `tests/unit/cli/run.test.ts`
- `tests/unit/cli/resume.test.ts`

### Optional files that may be edited

- `src/domain/publish/types.ts`
- `src/cli/commands/usage.ts`
- `tests/unit/cli/publishPr.test.ts`

### Boundary contracts

Port contract. `GitHubOps.repoWebUrl(repo)` returns the repository's `https://` web URL as `gh` reports it, or fails with a `GitHubError`. It is never rebuilt from a git remote. The real adapter and the fake honour the same contract.

Domain. `src/domain/publish/prFooter.ts` gives `publishRun` and `buildShortPrBody` the pure footer: the `PrPlanRef`, `PrSpecRef` and `PrAgentGroup` unions, plus `locateAtHead`, `permalink`, `groupAgents` and `renderPrFooter`. The body consumes one `PrFooterInput`, and its summary reads the same plan ref.

Version. The CLI (`readPackageVersion`) supplies the version as a required `phaxVersion` option, to `executePlan` and then to `publishRun`, and to `publishRun` directly from `publish-pr`.

### Test strategy

- the footer renders the generated line, the plan and spec refs, the grouped agents and the run name exactly — small · example · the expected footer text · in-phase
- locateAtHead returns the recorded path, else its archive counterpart, else null, and never maps a loose path — small · table · expected paths · in-phase
- a permalink is the web URL, /blob/, the sha and the URI-encoded path — small · example · the expected URL · in-phase
- groupAgents keeps first-appearance order and counts each assignment — small · example · the expected groups · in-phase
- the footer is the body's last section, survives every shortening stage and counts toward the cap — small · example · the body text and its byte size · in-phase
- publish names the plan and spec where they live in the head commit's tree, linked at that sha — medium · example · pr-body.md against the seeded tree · in-phase
- a failed web URL, an unresolved head, a loose plan or a spec-less plan degrades to code spans or no spec, and never fails the publish — medium · example · the body text and the published result · in-phase
- a reused pull request makes no web URL lookup and writes no body — medium · example · the fake GitHub's recorded calls · in-phase
- the gh repo view answer is decoded by its schema: a valid https url passes; a missing url, http, whitespace or an extra key is refused — small · table · the decode verdict · in-phase
- the GitHub fake and the gh adapter agree on repoWebUrl: a decoded url is returned, anything else is a GitHubError — medium · contract · shared expectations against the fake and a fake gh on PATH · in-phase
- run, resume and publish-pr pass readPackageVersion()'s value as phaxVersion — small · example · the option the mocked use case receives · in-phase

### Implementation order

1. The repoWebUrl port, adapter, fake and their tests.
2. src/domain/publish/prFooter.ts and its unit tests.
3. prBody.ts: footer input, plan ref in the summary, footer never cut.
4. publishRun.ts: the footer facts and the required phaxVersion.
5. executePlan's required phaxVersion and the three CLI call sites.
6. Add the made-up version to every executePlan call in tests/.
7. The publishRun integration tests.
8. README and NEXT_STEPS.md.
9. Run the standard gate.

### Excluded scope

- A phax.json key to turn the footer off (operator decision: none).
- Rewriting the body of a pull request that already exists.
- A session URL in the footer: phax's sessions are local and headless.
- Any persisted format change: publication.json and final-report.md stay as they are.
- Rebuilding the web URL from a git remote.

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

The `repoWebUrl` signature and the exact `gh` invocation. The footer module's exports and the footer text for a made-up example, copied verbatim. How the plan and spec paths are determined at the head commit, and each fallback. Where the footer sits relative to `SHORTENED_NOTE`. Confirmation that a reused pull request does no lookup. The `phaxVersion` option on `publishRun` and `executePlan`, and the three CLI call sites. The list of test files that only gained the made-up version. The `NEXT_STEPS.md` entries removed. Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(publish): a phax footer on every run's pull request`

### Commit body

Every pull request phax creates now ends with a footer. It carries "🛤️ Generated with phax <version> — the golden path, just facts", the plan and the spec as permalinks at the published head commit, the agents that ran the phases (provider, model and effort, with their phase counts), and the run's qualified name. The footer is never cut when the body is shortened, and a pull request that already exists keeps its body.

The paths come from the head commit's tree. Each file is named at its recorded path, else at its archive/ counterpart. The summary's Plan line therefore names the archived plan, no longer its pre-completion path. The web URL comes from a new GitHub port call (gh repo view --json url). A loose plan, a failed lookup or an unreadable head gives a code span, and no spec when there is none; no footer lookup fails a publish. The version reaches publishRun and executePlan as a required option read by the CLI.

NEXT_STEPS.md: the six Small follow-ups this plan closes are removed.
