---
status: Completed
source-spec: docs/specs/2611261455-e2e-phax-home.md
completes-spec: true
approved:
  date: 2026-11-27
  baseline: e9146b0
---
# E2e phax home

phax resolves its own home (config.json, providers.json, model-routing.json, telemetry.json, the daily telemetry journals and the default state root) in exactly one place, `src/app/phaxHome.ts`, once per call and never as a constant frozen at module load. The PHAX_HOME environment variable moves that home. The user's home, which holds the provider CLIs' stores and sign-ins, the user-scope skills install and the `~` written in a PR body, never moves. A run keeps one home: it is fixed when `phax run` starts, recorded in the run's folder, handed to the sessions the run spawns and used by every phax command inside its phase worktrees. Every real-provider e2e that spawns phax then runs it in a temporary phax home built from the branch's own provider and routing defaults.

The phases go inside-out. phase-01 keeps an exported PHAX_HOME out of the unit and integration tests before anything reads the variable. phase-02 adds the resolution point and moves routing, providers.json, telemetry.json, the journal and `phax report` onto it. phase-03 moves the global config layer and the default state root (loadConfig, projectContext, init). phase-04 adds the invalid-home refusal and the stderr notice. phase-05 makes `phax validate` name the home in text and JSON. phase-06 builds the e2e temporary home and moves the three e2e files that spawn phax onto it. phase-07 pins the home to the run. phase-08 documents the phax home (docs/phax-home.md wired into the site, the README configuration-layers paragraph) and corrects docs/e2e-testing.md.

**The real e2e does not run at the gate.** PHAX_E2E_RUN=1 is opt-in and `pnpm check:full` never runs it. phase-06 is checked by `pnpm test:type` and by integration tests of the e2e helpers that need no provider: the temporary home's files decode, a bare directory is refused, the child's HOME and PHAX_HOME are right, and `phax validate` is spawned through the helper. Before merging, the operator runs `PHAX_E2E_RUN=1 pnpm test:e2e:real` on the run's branch for tests/e2e/realFlow.test.ts, tests/e2e/headlessAuthoring.test.ts and tests/e2e/vibeSecure.test.ts. That run is what proves ac-e2e-vibe-runs, ac-e2e-realflow and ac-e2e-untouched.

**The architecture guard for r-one-point is the operator's to write after the run** (tests/unit/architecturalGuards*.test.ts is protected; no phase edits it). It meets the criterion ac-guard, which no phase covers, so `phax plans lint` warns about that criterion. The rule, exactly:
1. Only `src/app/phaxHome.ts` reads the PHAX_HOME environment variable. No other file under src/ reads `process.env["PHAX_HOME"]`, `process.env.PHAX_HOME` or `env["PHAX_HOME"]`.
2. No file under src/ other than `src/app/phaxHome.ts` builds a phax-home path from the user's home. The guard refuses `homedir()` followed by a `".phax"` segment in one call (regex `homedir\(\)\s*,\s*["'`]\.phax["'`]`) and the exact string literal `"~/.phax"` (regex `["'`]~/\.phax["'`]`). Help and message strings that mention `~/.phax/...` inside longer text are not matched.
3. An import of `homedir` from node:os is allowed only in: `src/app/phaxHome.ts` (the resolution point), `src/app/loadConfig.ts` (expandTilde only: an explicit `~` in state.root or a security path is the user's home, read as written), `src/app/publishRun.ts` (the PR body's `~`), `src/infra/providerStoreRoots.ts` and `src/infra/providers/mistralVibe.ts` (the providers' own stores), and `src/cli/definitions/skills.ts` (the user-scope skills install).
The guard should pass on the tree this run leaves.

**Baselines.** phase-02 removes the exported constants MODEL_ROUTING_PATH, PROVIDER_CONFIG_PATH, PHAX_HOME_DIR and TELEMETRY_CONFIG_PATH. None of them is in knip-baseline.json today. If a removal drops an entry of either baseline (knip or lint), the gate stops until the operator prunes it, and that phase's handoff names the entry.

## Gate profile

`standard`

## Required commands

- `pnpm test:unit`
- `pnpm test:integration`
- `pnpm gen:usage-spec`
- `pnpm docs:cli`

Every command above is already in `security.agentCommands`: `pnpm test:unit` and `pnpm test:integration` for the focused test loops, and `pnpm gen:usage-spec` and `pnpm docs:cli` for regenerating phax.usage.kdl, docs/cli/reference.md and the README's generated block after phase-05 changes the help of `phax validate`. No change to phax.json's security configuration is needed.

## Technical arbitrations

- Where the home is resolved: one module, `src/app/phaxHome.ts`, reads PHAX_HOME and `homedir()` on every call. It decodes the raw value through `src/schemas/phaxHome.ts`, checks that an existing path is a directory, and builds the answer `{ path, from: "PHAX_HOME" | "default" }` from the pure rules in `src/domain/phaxHome.ts`. Every reader (loadRouting, providerSetup, loadTelemetryConfig, the journal layer in runLayers, report, loadConfig, projectContext, initWizard, validate) calls it when it runs. No Effect port or layer threads the home through. Loss accepted: app/ reads the process environment directly instead of through a port, so a test drives the home by setting PHAX_HOME or HOME, not by providing a value. The alternative, a PhaxHome port threaded through loadConfig's roughly fifty call sites and the sync callers in app/, changes signatures widely for no behaviour gain, and app/ already reads files directly in loadConfig.
- An invalid PHAX_HOME is a ConfigValidationError with `path: "PHAX_HOME"` and the message `PHAX_HOME must be an absolute path to a directory, got "<value>"`, exit 2 (config validation), not a new tagged error. Loss accepted: a `--json` consumer cannot tell an invalid home from another config error by its tag alone; it reads the error's path.
- Which commands check the home: the program's guard in `src/cli/definitions/program.ts` checks PHAX_HOME first, then the phase guard. The runner asks the guard only about a located command, never about help, `--version`, the `--json-schema` contracts or `--usage` (main.ts answers `--usage` first), and the guard also lets `completions` through. Every other command is refused before anything is decoded or read. Loss accepted: `phax help`, `--version` and `phax completions` say nothing about a broken PHAX_HOME, so a shell that sources completions starts cleanly while the next real command fails.
- Where the stderr notice is written: the command library's Program gains one optional hook, `notice(call)`, beside `guard`. The runner calls it once, right after the guard lets a call through and before the command runs, and writes its text on stderr: a plain line without `--json`, a `note` message line with it. It never writes to stdout and is never asked for help or contracts. Loss accepted: the command library's contract grows a program-level hook that one program uses, rather than phax writing to process.stderr from its own guard (which would break the `--json` stderr contract).
- Unit and integration isolation: PHAX_HOME is cleared, and `isolatePhaxHome` keeps mocking `homedir()` and setting HOME. `tests/setup/phaxHomeGuard.ts` (a setup file both projects already load, so vitest.config.ts is untouched) removes an exported PHAX_HOME from the test process when it loads, and records it in the guard's per-worker state. When the recorded value is absolute, the guard also refuses any test-process fs call inside it, at its path and realpath, like the real ~/.phax; the repository under test stays exempt. `phaxHomeEnv()` never hands a child a PHAX_HOME. Loss accepted: most unit and integration tests exercise only the default-home path, and PHAX_HOME-set behaviour is covered only by the tests that set it on purpose. The alternative, isolatePhaxHome setting PHAX_HOME itself, would put the notice on every spawned child's stderr and break the exact-stderr assertions of the integration suites: about fourteen `stderr` toBe("") checks across ten files, plus their JSON note expectations.
- E2e helper shapes: `createTempEnv({ enable?, routing? })` writes the temporary home's providers.json from DEFAULT_PROVIDER_CONFIG with exactly the declared providers plus claude-code enabled. It writes model-routing.json from the suite's ModelRouting, or DEFAULT_MODEL_ROUTING when none is given. Both are typed by the branch's own ProviderConfig and ModelRouting and decoded by its decoders before they are written. It still overrides the fixture's explicit state.root with the temporary home. `runCli(args, env: TempEnv, opts)` takes the test environment instead of a directory. TempEnv carries a unique-symbol brand that only createTempEnv sets, so a string does not compile, and runCli also refuses at run time, before spawning, an argument without the brand or whose phax home is gone. The child's environment is process.env plus `opts.env`, then `PHAX_HOME` set to the temporary home. HOME is never changed, and an `opts.env` carrying HOME or PHAX_HOME is refused. Loss accepted: every e2e call site of runCli changes, and no suite can spawn phax against a hand-made directory, even for a deliberate experiment.
- q-explicit-root as written (operator's verdict): the state root resolves weakest first as the built-in ~/.phax, then PHAX_HOME when set, then an explicit state.root in any config layer (phax.json, phax.local.json, the phax home's config.json), which always wins and expands `~` against the user's home. `phax init` keeps not writing state.root. Loss accepted, as decided: a repository that pins "~/.phax" keeps its runs in the real ~/.phax under a moved home.
- ac-e2e-untouched's oracle reads the operator's real ~/.phax read-only, through `os.userInfo().homedir`, not HOME. The snapshot is the sha256 of every regular file directly under it (the four home files, the daily journals, registry and ledgers) plus the entry names directly under `runs/` and `worktrees/`; the repository under test is skipped. Loss accepted: a change deep inside an existing run folder is not caught. Hashing every run's tree would make the e2e slow, and it would be flaky while the operator's own runs are active.
- The home is pinned to the run (q-phase-worktree-home, operator's verdict). `phax run` records `{ path, from }` in `<stateRoot>/runs/<run>/phax-home.json`. The sessions of the run get PHAX_HOME set to that path. A phax command whose cwd is inside one of the run's phase worktrees uses the recorded home and refuses a PHAX_HOME that differs. `phax resume` refuses a current home that differs, naming the recorded one. The record must be outside every phase sandbox's write set, so `phax run` and `phax resume` refuse a `security.filesystem.allowWrite` entry that covers it. A phase worktree is recognised from its location (`<stateRoot>/worktrees/<run>/<phase>` beside `<stateRoot>/runs/<run>/`), not from `.phax-context/`, which a session can delete. A missing record is refused exactly like a record that does not decode: inside one of the run's phase worktrees the call fails with a ConfigValidationError on path PHAX_HOME naming the missing file, exit 2, and `phax resume` refuses the same way before it changes anything. No call falls back to the default home, because the project allows no back-compat shim in persisted state. Loss accepted: a run started by an older phax and still in flight at upgrade time cannot use phax inside its phase worktrees or be resumed. Limits of the pin: a phax call made from a directory outside every phase worktree honours the PHAX_HOME it is given; a state root inside a directory the provider's sandbox always lets a session write, such as a temporary directory, leaves the record writable. With the default state root, `phax resume` under another home does not find the run at all, so the refusal naming the recorded home is reached only when state.root is explicit.

## Arbitrated questions

### q-phase-worktree-home — Inside a phase worktree, does phax honour a PHAX_HOME the agent session sets itself?

- honour — PHAX_HOME is honoured inside a phase worktree as everywhere else; agent sessions inherit the operator's PHAX_HOME unchanged — abandons: A phase session can write a config.json anywhere it can write (its worktree, a temporary directory) and point PHAX_HOME at it. The commands it may run inside a phase worktree (`phax brief`, `phax architecture`, `phax plans lint`) then run any brief, architecture or plan-auditor command that file names: any command, through a granted phax command, outside its command allowlist, though still inside its sandbox.
- refuse-in-worktree — phax removes PHAX_HOME from the environment of the agent sessions it spawns, and inside a phase worktree every phax command refuses when PHAX_HOME is set — abandons: A run under a moved home gives its sessions the wrong global layer. A session's `phax brief`, `phax architecture` and `phax plans lint` read the operator's ~/.phax config layer (or none), not the run's home. In the real e2e, an in-session phax call would read, and write its telemetry journal into, the operator's real ~/.phax, against ac-e2e-untouched.

Recommendation: honour — The session's phax child runs inside the session's sandbox, so a command named by a planted config.json runs in that same sandbox. The worktree's own phax.local.json is not a protected path (only phax.json is) and is already read as a config layer next to the worktree's phax.json, so a session can already name the same commands there. PHAX_HOME adds a second route to a reach the session already has, not a new reach. Removing the variable from sessions instead breaks second-configuration runs and the e2e isolation this spec exists for. The phases below are written for `honour`. Choosing `refuse-in-worktree` adds the environment strip to the provider adapters and a phase-guard rule in phase-04.

Decision: other — by operator (Rémy Loubradou), 2026-11-27
Why: Pinned to the run. The phax home is fixed when phax run starts and serves the whole run: phax records it in the run's folder under the state root, outside every phase sandbox's write set; the sessions it spawns get that home explicitly; a phax command inside a phase worktree uses the recorded home and refuses a PHAX_HOME that differs from it; phax resume refuses when the current home differs, naming the recorded one. Accepted loss: one more phase than honour. Neither listed option keeps one home per run: honour lets an in-session phax call read another home, refuse-in-worktree sends it to the operator's ~/.phax. Advocate: The strongest case for honour: a session can already name the same provider commands in its worktree's phax.local.json, so pinning the home closes only a second route, while honour needs no new persisted record, no extra phase and no change to the provider adapters. Principles: E0, C2, C4. Reversibility: costly. Revised: preamble.summary, preamble.technicalArbitrations, phase-04, phase-05, phase-06, phase-07, phase-08. Phase: phase-07.

## Decision log

- 2026-11-27 q-phase-worktree-home decided other — operator (Rémy Loubradou) — revised 7 sections

---

## phase-01 — Keep an exported PHAX_HOME out of unit and integration tests {#phase-01-test-isolation}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium
**Assignment reason:** The guard's per-worker state and the realpath rules are subtle test infrastructure that every suite loads; a mistake fails or silently weakens the whole test tier, so this phase takes claude-opus-5-5 at medium rather than the default claude-sonnet-5-5.

Before any phax code reads PHAX_HOME, no unit or integration test can be steered by a developer's exported PHAX_HOME. The test process drops it when the setup file loads, the guard refuses test-process fs calls inside it, and a spawned CLI child never inherits it.

### Detailed instructions

- In `tests/setup/phaxHomeGuard.ts`, add an exported pure function `takeExportedPhaxHome(env: NodeJS.ProcessEnv): string | undefined`. It returns `env["PHAX_HOME"]` and deletes the key from `env`, or returns undefined when the key is absent. An empty value is still removed.
- At setup load, before `installPhaxHomeGuard()`, call it on `process.env` and store a returned value in the guard's global state (the `STATE_KEY` record). Store it only the first time per worker: the setup file loads again for every test file, after the variable is already gone.
- Extend the guarded roots. The module-level `PHAX_ROOTS` stays the real ~/.phax at its path and realpath, from `userInfo().homedir`. When the recorded exported value is an absolute path, `guardedPath` also refuses paths inside it and inside its realpath, using the same `isInsidePhaxHome` rule. Compute the realpath with the unwrapped `realOrSelf`. The repository under test stays exempt (`EXEMPT_ROOTS`). The refusal message names the exported PHAX_HOME, not ~/.phax, so a developer sees which root was hit, and keeps the same remedy line.
- Keep the guard idempotent: the install is still marked once per worker, and the exported root is read from state, not recomputed from `process.env`.
- In `tests/helpers/isolatePhaxHome.ts`, make `phaxHomeEnv()` return the environment without a `PHAX_HOME` key, in both branches (active per-test home and spawn home), even when a test set `process.env.PHAX_HOME` itself. Add one sentence to the header comment: PHAX_HOME is cleared by the setup file and never handed to a child, so a test that wants it sets it in the child's env explicitly.
- Do not edit `vitest.config.ts`, `vitest.e2e.config.ts` or `tests/setup/providerStores.ts`.
- Write the tests in `tests/unit/phaxHomeGuard.test.ts` (extend) and a new `tests/unit/phaxHomeEnvIsolation.test.ts` for `phaxHomeEnv()`. Call `takeExportedPhaxHome` on plain objects, never on the real `process.env`.

### Planned files to create

- `tests/unit/phaxHomeEnvIsolation.test.ts`

### Planned files to edit

- `tests/setup/phaxHomeGuard.ts`
- `tests/helpers/isolatePhaxHome.ts`
- `tests/unit/phaxHomeGuard.test.ts`

### Optional files that may be edited

- `tests/helpers/boundedSpawn.ts`

### Boundary contracts

Test-support only. The unit and integration suites (consumers) rely on the setup file (producer) to guarantee that `process.env.PHAX_HOME` is undefined when their first hook runs, and that `phaxHomeEnv()` never carries PHAX_HOME. Later phases rely on this when a test sets PHAX_HOME on purpose and restores it.

### Test strategy

- takeExportedPhaxHome removes PHAX_HOME from the env it is given and returns its value, including an empty one, and returns undefined when it is absent — small · boundary · the env object before and after, and the returned value · in-phase · ac-leak
- a test-process fs call inside a recorded exported PHAX_HOME or its realpath is refused, a sibling directory is not, and a path inside the repository under test is exempt — small · table · isInsidePhaxHome over a table of (path, roots, exempt) rows · in-phase · ac-leak
- phaxHomeEnv() never carries PHAX_HOME, with or without an active per-test home, even after a test sets process.env.PHAX_HOME — small · example · the returned env has no PHAX_HOME key and HOME is the temporary home · in-phase · ac-leak

### Implementation order

1. takeExportedPhaxHome and its unit test
2. record the value in guard state and extend guardedPath
3. phaxHomeEnv drops PHAX_HOME, with its test
4. header comment of isolatePhaxHome

### Excluded scope

- Any change under src/: nothing reads PHAX_HOME yet.
- Setting PHAX_HOME inside isolatePhaxHome: rejected in Technical arbitrations.
- The e2e helpers (phase-06).

### Verification

Run `PHAX_HOME=/tmp/phax-leak-probe pnpm test:unit tests/unit/phaxHomeGuard.test.ts tests/unit/phaxHomeEnvIsolation.test.ts`: the suites pass, and a probe in the new test that reads `process.env.PHAX_HOME` in a test body finds it undefined.

### Expected handoff content

The exported name and signature of `takeExportedPhaxHome` and where its value is kept (the guard state key). The exact refusal text for a path inside an exported PHAX_HOME. The fact that `phaxHomeEnv()` strips PHAX_HOME, so later phases that spawn a child with PHAX_HOME set it after spreading phaxHomeEnv(). Any deviation from the planned files, with its reason.

### Commit subject

`test(isolation): keep an exported PHAX_HOME out of unit and integration tests`

### Commit body

The setup file that guards the real ~/.phax now removes an exported PHAX_HOME from the test process, records it, and refuses test-process fs calls inside it as it does for ~/.phax. phaxHomeEnv() never hands PHAX_HOME to a spawned CLI child. This lands before phax reads the variable, so no later phase's tests can be steered by a developer's environment (r-test-isolation).

---

## phase-02 — One phax home resolution point for routing, providers and telemetry {#phase-02-resolution-point}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium
**Assignment reason:** This phase designs the resolution point every later phase builds on and moves four readers across app/ and cli/ while keeping the gate green on knip production mode; that cross-layer design takes claude-opus-5-5 at medium, not the default claude-sonnet-5-5.

phax resolves its home in one place, on every call, from PHAX_HOME or ~/.phax. providers.json, model-routing.json, telemetry.json, the global telemetry journal and `phax report` all follow that home, with no fallback read of ~/.phax.

### Detailed instructions

- Create `src/schemas/phaxHome.ts`: an Effect Schema decoder for the raw variable, `decodePhaxHomeVariable(raw: string | undefined)`. It answers `{ kind: "unset" }` for undefined and `{ kind: "set", path }` for a non-empty absolute path. It refuses an empty string and any non-absolute value, including an unexpanded `~/...` and `relative/dir`. Absolute means POSIX absolute (a leading `/`). Do not import node:path or node:fs into this module, and do not add it to the schemas package entry.
- Create `src/domain/phaxHome.ts` (pure, no I/O): the `PhaxHome` type `{ readonly path: string; readonly from: "PHAX_HOME" | "default" }`, the file names it holds (`config.json`, `providers.json`, `model-routing.json`, `telemetry.json`), `phaxHomeFile(home, name)` built with node:path's join semantics without importing node:fs or node:os, and `invalidPhaxHomeMessage(value)`, which returns exactly `PHAX_HOME must be an absolute path to a directory, got "<value>"`. Export only what this phase's production code uses (knip runs `--production --strict`). The notice text is phase-04's to add.
- Create `src/app/phaxHome.ts`, the single resolution point: `resolvePhaxHome(env: NodeJS.ProcessEnv = process.env, userHome: string = homedir()): Result<PhaxHome, ConfigValidationError>`. Unset gives `{ path: join(userHome, ".phax"), from: "default" }`. Set and valid gives `{ path, from: "PHAX_HOME" }`. A set path that exists and is not a directory (`statSync`, symlinks followed) is refused. A set path that does not exist is accepted: it is created on first write. A refusal is a `ConfigValidationError` with `path: "PHAX_HOME"` and `invalidPhaxHomeMessage(value)`. Nothing is cached at module level: every call reads env and homedir again.
- Move `src/app/loadRouting.ts` onto it: delete `MODEL_ROUTING_PATH` and `PROVIDER_CONFIG_PATH`, and have `loadModelRouting`, `loadProviderConfig` and `readProviderConfigFile` resolve the home at the start of their Effect (fail with the ConfigValidationError on an invalid home), then compute the path from it. Every message that named the constants now names the resolved path. An absent file still falls back to the built-in default and never reads another home.
- Move `src/app/providerSetup.ts` onto it: compute both paths per call (backup path, writes, `providerConfigPath`/`modelRoutingPath` in its answer). Make sure the write creates the home directory when PHAX_HOME names one that does not exist yet (check `fs.writeAtomic`'s behaviour; create the parent through the FileSystem port if it does not).
- Move `src/app/loadTelemetryConfig.ts` onto it: delete `PHAX_HOME_DIR` and `TELEMETRY_CONFIG_PATH`, and make `loadTelemetryConfig(configPath: string)` take its path with no default. The scaffold of a missing telemetry.json writes into the resolved home.
- In `src/cli/commands/runLayers.ts`, `makeGlobalTelemetryJournalLayerOrNoop()` resolves the home on each call. On an invalid home it returns `NoopSystemTelemetryLayer`, because phase-04's guard refuses the call earlier. Otherwise it loads telemetry.json from the home and writes the journal under `home.path`. Update the doc comments that name PHAX_HOME_DIR.
- In `src/cli/definitions/report.ts`, take `phaxHomeDir` from the resolved home. An invalid home fails with the existing `ReportConfigError` carrying the message.
- Update every test that imported the removed constants to compute the path at call time, after its isolation set HOME, through `phaxHomeFile(resolvePhaxHome()…)` or a local helper in the test: tests/unit/routing/loadRouting.test.ts, tests/unit/loadTelemetryConfig.test.ts, tests/integration/agentGroupJson.test.ts, tests/integration/agentSetupProviders.test.ts, tests/integration/assignmentBounds.test.ts, tests/integration/estimatePlan.test.ts, tests/integration/vibeInstallerRemoved.test.ts, tests/integration/vibeProviderUpgrade.test.ts. Check tests/unit/runPreflight.test.ts and tests/unit/routing/vibeModelCatalog.test.ts, which matched the constant names, and fix them if they import them.
- A test that sets PHAX_HOME sets `process.env.PHAX_HOME` in the test and deletes it in afterEach (phase-01's setup cleared any exported value). Tests that read real directories use isolatePhaxHome (and isolateGit if they commit). A test that records which paths were opened uses the fake FileSystem the routing tests already use.
- Write `tests/unit/phaxHome.test.ts` for the schema, the domain rules and the resolution point.

### Planned files to create

- `src/schemas/phaxHome.ts`
- `src/domain/phaxHome.ts`
- `src/app/phaxHome.ts`
- `tests/unit/phaxHome.test.ts`

### Planned files to edit

- `src/app/loadRouting.ts`
- `src/app/providerSetup.ts`
- `src/app/loadTelemetryConfig.ts`
- `src/cli/commands/runLayers.ts`
- `src/cli/definitions/report.ts`
- `tests/unit/routing/loadRouting.test.ts`
- `tests/unit/loadTelemetryConfig.test.ts`
- `tests/integration/agentGroupJson.test.ts`
- `tests/integration/agentSetupProviders.test.ts`
- `tests/integration/assignmentBounds.test.ts`
- `tests/integration/estimatePlan.test.ts`
- `tests/integration/vibeInstallerRemoved.test.ts`
- `tests/integration/vibeProviderUpgrade.test.ts`

### Optional files that may be edited

- `tests/unit/runPreflight.test.ts`
- `tests/unit/routing/vibeModelCatalog.test.ts`
- `tests/unit/cli/agent.test.ts`
- `tests/integration/report.test.ts`
- `tests/helpers/isolatePhaxHome.ts`
- `src/app/report.ts`
- `src/infra/telemetry/globalJournal.ts`
- `src/cli/definitions/agent.ts`

### Boundary contracts

PHAX_HOME is external input: the schema in src/schemas/phaxHome.ts decodes it before anything uses it. The pure rules live in src/domain/phaxHome.ts. The resolution point in src/app/phaxHome.ts is the only reader of the variable and of homedir() for phax's home. The readers in app/ (routing, provider setup, telemetry config) and the CLI edge (journal layer, report) need a home path for the current invocation; the resolution point provides `Result<PhaxHome, ConfigValidationError>` with `PhaxHome = { path, from }`. Later phases (config, state root, guard, validate) consume the same function and type.

### Test strategy

- the resolution table holds: unset gives <user home>/.phax from default; an absolute existing directory or a not-yet-existing absolute path gives that path from PHAX_HOME; an empty value, ~/phax-ci, relative/dir and an existing regular file are refused naming PHAX_HOME and the value — small · table · the expected PhaxHome or the exact refusal message per row · in-phase · ac-invalid
- the home is resolved per call: changing PHAX_HOME or HOME between two calls in one process changes the answer — small · example · two successive results differ as the environment did · in-phase
- with PHAX_HOME set, loadProviderConfig, loadModelRouting and the telemetry config read only the files under PHAX_HOME, while the user's ~/.phax holds different valid versions of each — small · example · the decoded values equal the PHAX_HOME versions and a recording fake FileSystem opened no path under ~/.phax · in-phase · ac-moves
- with telemetry on and PHAX_HOME set, the global journal entry lands under PHAX_HOME and the user's ~/.phax listing is unchanged — medium · example · directory listings with content hashes of both homes before and after · in-phase · ac-moves
- PHAX_HOME naming an empty directory while ~/.phax/providers.json enables mistral-vibe yields the built-in provider config, and routing forced to mistral-vibe does not select it — small · example · DEFAULT_PROVIDER_CONFIG, the resolved provider, and no ~/.phax path opened on the recording fake FileSystem · in-phase · ac-no-fallback
- with PHAX_HOME unset and HOME at a temporary home whose .phax/providers.json enables codex-cli, the provider config treats codex-cli as enabled — medium · example · the decoded provider config's codex-cli entry · in-phase · ac-default-unchanged
- with PHAX_HOME set outside the user's home, the provider store roots still resolve under the user's home and the PR body still abbreviates the user's home, not PHAX_HOME, as ~ — small · example · resolveProviderStoreRoots output and the rendered run-folder line of the PR body · in-phase · ac-never-moves

### Implementation order

1. schema decoder
2. domain type, file names and message
3. resolution point and its table test
4. loadRouting and providerSetup, then their tests
5. loadTelemetryConfig, runLayers journal and report, then their tests
6. remaining tests that imported the removed constants

### Excluded scope

- loadConfig's global layer and the default state root, projectContext and initWizard (phase-03).
- The CLI refusal of an invalid PHAX_HOME and the stderr notice (phase-04).
- phax validate's home line (phase-05).
- The architecture guard for the single resolution point (the operator's, after the run).
- Help strings that mention ~/.phax/providers.json in agent.ts: they stay true for the default home.

### Verification

In a scratch shell, `PHAX_HOME=$(mktemp -d) pnpm dev agent setup providers --write` writes providers.json into that directory and leaves ~/.phax/providers.json untouched (compare its sha256 before and after). The new unit table covers every row of the resolution table.

### Expected handoff content

The exact module paths and exported signatures: `src/schemas/phaxHome.ts` (`decodePhaxHomeVariable`), `src/domain/phaxHome.ts` (`PhaxHome`, `phaxHomeFile`, `invalidPhaxHomeMessage`) and `src/app/phaxHome.ts` (`resolvePhaxHome`). The removed constants and every test that changed because of them. Whether `fs.writeAtomic` creates a missing home directory or a mkdir was added. Any lint- or knip-baseline entry the removals dropped, so the operator can prune it. Any deviation from the planned files, with its reason.

### Commit subject

`feat(home): resolve the phax home in one place, per call, from PHAX_HOME`

### Commit body

Add the PHAX_HOME schema, the pure phax-home rules and src/app/phaxHome.ts, the one point that reads PHAX_HOME and homedir() for phax's home, on every call. providers.json, model-routing.json, telemetry.json, the global telemetry journal and phax report now follow it. With PHAX_HOME set, a missing file falls back to its built-in default and ~/.phax is never read. The module-load path constants are gone. Provider stores and the PR body's ~ still resolve against the user's home.

---

## phase-03 — Global config layer and default state root follow the phax home {#phase-03-config-and-state-root}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium
**Assignment reason:** The state-root precedence crosses three config layers and the resolution point, and a wrong order silently moves every user's runs; this cross-layer change takes claude-opus-5-5 at medium rather than the default claude-sonnet-5-5.

The global config layer is read from the phax home's config.json. When no config layer names state.root, the default state root is the phax home, for runs and for the root `phax init` offers. An explicit state.root in any layer is still honoured as written.

### Detailed instructions

- In `src/app/loadConfig.ts`, resolve the home once at the start of `loadConfig(cwd)` with `resolvePhaxHome()` from `src/app/phaxHome.ts`. An invalid home returns its ConfigValidationError before the global layer is read. Read the global overlay from `phaxHomeFile(home, "config.json")` (src/domain/phaxHome.ts) instead of `join(homedir(), ".phax", "config.json")`.
- Change the state root to `config.state?.root !== undefined ? expandTilde(config.state.root) : home.path`, where `config` is the merged layers. This is the operator's settled order, weakest first: built-in ~/.phax, then PHAX_HOME when set, then an explicit state.root in phax.json, phax.local.json or the phax home's config.json, read as written with `~` as the user's home. Remove the `"~/.phax"` literal. `expandTilde` keeps using `homedir()` (the user's home), which is correct for an explicit path.
- In `describeConfigSources(cwd)`, take the global path from the resolved home. On an invalid home, report the global overlay as undefined; phase-04's guard refuses the call before it gets here.
- In `src/app/projectContext.ts`, delete `DEFAULT_STATE_ROOT`. `effectiveStateRoot(undefined)` returns the resolved home's path. On an invalid home it returns the default ~/.phax path: the guard refuses such calls first, and the function stays total. Remove the now-unused `homedir` import.
- In `src/app/initWizard.ts`, delete `DEFAULT_STATE_ROOT` and use the resolved home's path where the wizard offers or uses the state root (the records sync at the `stateRoot:` use). `buildPhaxConfig` keeps writing no `state` key. Remove the unused `homedir` import.
- Update `src/cli/commands/reportConfigError.ts` only if its sentence should name the phax home's config.json rather than ~/.phax/config.json. If you change it, keep its exit and shape and update its tests in the same phase.
- Tests: extend tests/unit/loadConfig.test.ts with the precedence table and the global-layer source, tests/unit/projectContext.test.ts with PHAX_HOME set and unset, and tests/integration/initWizard.test.ts with the offered state root under PHAX_HOME. A test that sets PHAX_HOME restores it in afterEach. Temporary repositories use the existing temp-git helpers with isolatePhaxHome and isolateGit.

### Planned files to create

- (none)

### Planned files to edit

- `src/app/loadConfig.ts`
- `src/app/projectContext.ts`
- `src/app/initWizard.ts`
- `tests/unit/loadConfig.test.ts`
- `tests/unit/projectContext.test.ts`
- `tests/integration/initWizard.test.ts`

### Optional files that may be edited

- `src/cli/commands/reportConfigError.ts`
- `tests/integration/initCommand.test.ts`
- `tests/helpers/isolatePhaxHome.ts`
- `src/domain/phaxHome.ts`
- `src/app/phaxHome.ts`

### Boundary contracts

loadConfig (producer) gives every command its `ResolvedConfig.stateRoot` and the merged layers. Commands and use cases (consumers) need a state root that obeys the settled precedence and a global layer read from the phax home. The shape of ResolvedConfig does not change. describeConfigSources keeps its `ConfigSources` shape for `phax validate` (phase-05).

### Test strategy

- the state root follows the settled precedence: no layer and PHAX_HOME unset gives <user home>/.phax; PHAX_HOME set gives PHAX_HOME; an explicit state.root in phax.json, in phax.local.json or in the phax home's config.json wins over both and expands ~ against the user's home — medium · table · the precedence table in the plan's Technical arbitrations · in-phase · ac-state-root
- with PHAX_HOME set and phax.json naming no state.root, the run folder phax run derives from the resolved stateRoot lies under $PHAX_HOME/runs/ — medium · example · the run folder path is prefixed by PHAX_HOME/runs · in-phase · ac-state-root
- with PHAX_HOME set, phax init's wizard offers and uses PHAX_HOME as the state root, and still writes no state key into phax.json — medium · example · the wizard's answer and the written phax.json · in-phase · ac-state-root
- with PHAX_HOME set, the applied global config layer and describeConfigSources' global path are PHAX_HOME/config.json, while ~/.phax/config.json holds a different valid layer that is not applied — medium · example · a scalar the two layers set differently, and the reported global path · in-phase · ac-moves

### Implementation order

1. loadConfig global layer and state root, with the precedence table
2. describeConfigSources
3. projectContext
4. initWizard and its integration test

### Excluded scope

- Special-casing the literal "~/.phax" in an explicit state.root: rejected by the operator (q-explicit-root as-written).
- Making phax init write state.root.
- The CLI guard and notice (phase-04) and validate's home line (phase-05).

### Verification

In a scratch repository whose phax.json has no state.root, `PHAX_HOME=$(mktemp -d) pnpm dev ls` lists runs from that directory, and adding `"state": { "root": "~/elsewhere" }` to phax.local.json moves it to ~/elsewhere, whatever PHAX_HOME says.

### Expected handoff content

The final precedence as implemented, and the place in loadConfig.ts where it is computed. The removed DEFAULT_STATE_ROOT constants and imports. Whether reportConfigError's sentence changed and which tests followed it. Any deviation from the planned files, with its reason.

### Commit subject

`feat(home): read the global config layer and default state root from the phax home`

### Commit body

loadConfig reads the global layer from the phax home's config.json and defaults the state root to the phax home. An explicit state.root in any layer still wins and is read as written, with ~ as the user's home (q-explicit-root). projectContext and the init wizard drop their own ~/.phax copies and use the resolution point.

---

## phase-04 — Refuse an invalid PHAX_HOME and announce a moved home on stderr {#phase-04-refusal-and-notice}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium
**Assignment reason:** This phase adds a program-level hook to the command library's contract and runner that no code shows yet and must keep the --json stderr contract intact; that design work takes claude-opus-5-5 at medium rather than the default claude-sonnet-5-5.

Every phax command refuses an empty, relative or non-directory PHAX_HOME before it reads anything, exit 2, naming the variable and its value. When PHAX_HOME is set and valid, every command says once on stderr which home it uses: a plain line, or a note line under `--json`.

### Detailed instructions

- Command library contract (`src/cli/commandLibrary/contract/command.ts`): add an optional `notice?: (call: GuardedCall) => string | undefined` to `Program`, documented beside `guard` in the same "Gain carried for upstream" style. If `defineProgram` (`src/cli/commandLibrary/contract/define.ts`) copies fields explicitly, carry it through. Keep the contract free of node: and commander imports.
- Runner (`src/cli/commandLibrary/commander/run.ts`): in `guarded`, once the guard lets the call through (or there is no guard), call `program.notice` on the same `GuardedCall`. When it returns text, write it to stderr before `next()`: `noteLines(text)` under `--json`, `line(text)` otherwise, as the progress notes do. A throwing notice is a defect, like a throwing guard. It is never asked for help, contracts or anything but a located command, which `guarded` already ensures.
- Add one example to the conformance cases (`src/cli/commandLibrary/contract/conformance/cases.ts`) only if the library's conformance suite is where program-level behaviour like the guard is pinned. Otherwise test the hook in `tests/unit/cli/runnerNotice.test.ts` against the library's memory io.
- In `src/domain/phaxHome.ts`, add `phaxHomeNotice(home)`, which returns `phax home: <path> (PHAX_HOME)` for a home from PHAX_HOME and undefined for the default.
- In `src/cli/definitions/program.ts`: a `homeGuard(call)` that lets `completions` through and otherwise calls `resolvePhaxHome()`. On failure it returns `{ text: <the error message>, exit: 2, expected: "PHAX_HOME: an absolute path to a directory" }`. The program's guard runs `homeGuard` first, then the existing `phaseGuard`. The program's `notice` returns `phaxHomeNotice` of the resolved home, and undefined for `completions` or an invalid home. Import only from app/ and domain/; program.ts may not import node: modules or infra logic.
- In this phase PHAX_HOME is read inside a phase worktree like anywhere else. phase-07 then pins a phase worktree to its run's recorded home through the same resolution point, so this guard and notice follow it without a second check: add no phase-worktree rule here.
- Integration tests in a new `tests/integration/phaxHomeEnv.test.ts`. Spawn the CLI through `tests/helpers/boundedSpawn.ts` with `{ ...phaxHomeEnv(), PHAX_HOME: <value> }` in a temporary repository (isolatePhaxHome and isolateGit), with the four invalid values: empty, `~/phax-ci`, `relative/dir`, and an existing regular file. Assert exit 2, stderr naming PHAX_HOME and the value, and that the isolated home's `.phax` gained no telemetry.json or journal and no `relative/dir` was created. Also assert the notice: exactly one stderr line `phax home: <dir> (PHAX_HOME)` with a valid PHAX_HOME, none when unset, none on stdout, and a `{"kind":"note","text":"phax home: …"}` line under `--json`. Finally assert that `phax --help`, `phax --version`, `phax --usage` and `phax completions zsh` still exit 0 with an invalid PHAX_HOME.
- Existing integration tests do not see the notice: phase-01 clears PHAX_HOME in every unit and integration test. Change no existing exact-stderr assertion.

### Planned files to create

- `tests/integration/phaxHomeEnv.test.ts`
- `tests/unit/cli/runnerNotice.test.ts`

### Planned files to edit

- `src/cli/commandLibrary/contract/command.ts`
- `src/cli/commandLibrary/commander/run.ts`
- `src/cli/definitions/program.ts`
- `src/domain/phaxHome.ts`

### Optional files that may be edited

- `src/cli/commandLibrary/contract/define.ts`
- `src/cli/commandLibrary/contract/conformance/cases.ts`
- `src/cli/commandLibrary/contract/index.ts`
- `src/app/phaxHome.ts`
- `tests/integration/cliProgram.test.ts`

### Boundary contracts

The program definition (consumer) needs two things from the command library (producer). First, a way to refuse a call before decoding: the existing `guard`, returning a GuardRefusal with its own exit. Second, a way to say one line to a person on stderr before the command runs, without breaking the `--json` stderr contract: the new `notice` hook, written by the runner as a line or a `note` message. Both receive the same GuardedCall. The program in turn consumes `resolvePhaxHome` (app) and `phaxHomeNotice` (domain).

### Test strategy

- phax validate with PHAX_HOME empty, ~/phax-ci, relative/dir or an existing regular file exits 2 before any phax home file is read, with a stderr message naming PHAX_HOME and the value — medium · table · exit code, stderr text, and no telemetry.json, journal or relative/dir created · in-phase · ac-invalid
- with a valid PHAX_HOME every command writes exactly one stderr notice naming the home, none on stdout, a note line under --json, and nothing when PHAX_HOME is unset — medium · example · the spawned CLI's stdout and stderr · in-phase
- help, --version, --usage and completions are neither refused nor noticed with an invalid PHAX_HOME — medium · example · exit 0 and stderr without PHAX_HOME · in-phase
- the runner writes a program notice after the guard passes and before the command runs, as a note under --json, never for help or contracts, and treats a throwing notice as a defect — small · example · the memory io's ordered writes and exit code · in-phase

### Implementation order

1. contract hook and runner support, with the runner test
2. phaxHomeNotice in domain
3. homeGuard and notice in program.ts
4. integration tests

### Excluded scope

- phax validate's home line (phase-05).
- A notice in --verbose only or validate only: the operator chose the stderr notice (q-notice).
- Pinning the home to the run, inside phase worktrees and on resume (phase-07).

### Verification

`PHAX_HOME='~/phax-ci' pnpm dev validate` exits 2 with `PHAX_HOME must be an absolute path to a directory, got "~/phax-ci"`. `PHAX_HOME=$(mktemp -d) pnpm dev ls --json 2>&1 >/dev/null` prints one note line naming the home.

### Expected handoff content

The contract addition (`Program.notice`), where the runner writes it, and how it behaves under --json. The exact refusal text, exit code and the `expected` phrase of the refused line. The list of commands the home guard skips. Confirmation that no existing integration assertion changed. Any deviation from the planned files, with its reason.

### Commit subject

`feat(home): refuse an invalid PHAX_HOME and print the moved home on stderr`

### Commit body

The program's guard refuses every located command, except completions, when PHAX_HOME is empty, relative or names a non-directory, exit 2, naming the variable and its value, before anything is read. A new optional program hook in the command library, notice, lets the runner write one stderr line (a note under --json) after the guard passes. phax uses it to say `phax home: <path> (PHAX_HOME)` whenever the variable is set (q-notice).

---

## phase-05 — phax validate names the phax home {#phase-05-validate-home}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium
**Assignment reason:** The default would be claude-sonnet-5-5, but the brief asks for claude-opus-5-5 at medium on every code phase of this run: the output change spans the command's schema, help, regenerated usage files and several pinned integration expectations, which one stronger pass keeps consistent.

`phax validate` reports the phax home in use, and whether PHAX_HOME or the default chose it, as a `home:` line in its text and a `home` object in its JSON answer.

### Detailed instructions

- In `src/cli/definitions/validate.ts`, add a required `home: Schema.Struct({ path: Schema.String, from: Schema.Literals(["PHAX_HOME", "default"]) })` to `ValidateOutput`. Use the Effect 4 literal API this repository already uses elsewhere; check the effect version in package.json. Fill it from `resolvePhaxHome()`. A failure there is a `ConfigInvalidError` with the message, though phase-04's guard normally refuses first.
- Render: after `✓ config is valid (project: …)` and before `project:`, write `  home:    <path> (PHAX_HOME)` or `  home:    <path> (default)`. Keep the existing two-space indent and the column alignment of `project:`, `local:` and `global:`. The `global:` line already shows `<home>/config.json` once phase-03 moved describeConfigSources.
- Update the command's `help` text: name the global layer as the phax home's config.json (~/.phax/config.json unless PHAX_HOME is set) and say that validate prints the home and its source. Then run `pnpm gen:usage-spec` and `pnpm docs:cli` to regenerate phax.usage.kdl, docs/cli/reference.md and the README's generated block, and commit what they write.
- Update tests/unit/cli/validate.test.ts and any integration test that pins validate's exact text or JSON. Check tests/integration/codeLinkConfig.test.ts, tests/integration/protectedPathsConfig.test.ts, tests/integration/inspectionCommandsJson.test.ts and tests/integration/everyCommandJson.test.ts, and change only what the new line or key requires.
- New `tests/integration/validateHome.test.ts`, spawning through boundedSpawn in a temporary repository with isolatePhaxHome and isolateGit. (a) PHAX_HOME set to a temporary directory holding a config.json: the text has `home:    <dir> (PHAX_HOME)` and `global:  <dir>/config.json`, and `--json` has `"home": { "path": <dir>, "from": "PHAX_HOME" }`. (b) PHAX_HOME unset: the text has `home:    <isolated home>/.phax (default)`. (c) Leak check: set `process.env.PHAX_HOME` in the test to a sentinel directory holding a sentinel config.json, spawn validate with `phaxHomeEnv()`, and assert the child reports the isolated default home and the sentinel directory's listing and hashes are unchanged. Restore the variable in afterEach.

### Planned files to create

- `tests/integration/validateHome.test.ts`

### Planned files to edit

- `src/cli/definitions/validate.ts`
- `tests/unit/cli/validate.test.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`
- `README.md`

### Optional files that may be edited

- `tests/integration/codeLinkConfig.test.ts`
- `tests/integration/protectedPathsConfig.test.ts`
- `tests/integration/inspectionCommandsJson.test.ts`
- `tests/integration/everyCommandJson.test.ts`
- `tests/integration/cliProgram.test.ts`
- `tests/integration/usageSpecDeclarations.test.ts`

### Boundary contracts

`phax validate --json` (producer) answers with a ValidateOutput that now carries `home: { path, from }`. Scripts and agents reading it (consumers) need the home's absolute path and whether PHAX_HOME chose it. The answer has no `$schema` and is not a published format, so adding a required key is not a format move.

### Test strategy

- with PHAX_HOME naming a directory that holds config.json, validate's text carries the home line marked (PHAX_HOME) and the global line naming that config.json, and its JSON carries home with path and from PHAX_HOME — medium · example · the exact lines of the spec's surface and the parsed JSON home object · in-phase · ac-validate-home
- with PHAX_HOME unset and HOME at a temporary home, validate prints the home line naming <home>/.phax marked (default) — medium · example · the exact home line · in-phase · ac-default-unchanged
- a test that sets PHAX_HOME in its own process and spawns phax with the isolation helper's environment never makes the child read or write that directory — medium · example · the child's reported home is the isolated default and the sentinel directory's hashed listing is unchanged · in-phase · ac-leak
- the rendered validate text keeps its existing lines and order, with the home line inserted after the success line — small · example · renderValidated output for a fixed ValidateOutput · in-phase

### Implementation order

1. ValidateOutput and the render
2. help text, then regenerate the usage spec, CLI reference and README block
3. unit test, then the integration test

### Excluded scope

- A `phax doctor` command (spec non-goal).
- Help text of other commands that mention ~/.phax.
- README's configuration-layers paragraph and docs pages (phase-08); only the README's generated block changes here.

### Verification

`PHAX_HOME=$(mktemp -d) pnpm dev validate` in this repository prints `home:    <that dir> (PHAX_HOME)` on the line after the success line, and `pnpm gen:usage-spec` followed by `git diff --exit-code phax.usage.kdl` shows nothing left to regenerate.

### Expected handoff content

The new ValidateOutput key and the exact text line. The regenerated files and the commands that produced them. Each existing test that changed, with why. Any deviation from the planned files, with its reason.

### Commit subject

`feat(validate): report the phax home and whether PHAX_HOME chose it`

### Commit body

phax validate prints a home line after its success line (the path, then PHAX_HOME or default), and its --json answer carries home with path and from. The help names the global layer as the phax home's config.json. phax.usage.kdl, docs/cli/reference.md and the README's generated block are regenerated. An integration test also proves that an exported PHAX_HOME does not reach a child spawned with the isolation helper's environment.

---

## phase-06 — Real-provider e2e runs in a temporary phax home {#phase-06-e2e-temporary-home}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium
**Assignment reason:** The helper design (branded test environment, format-following home, child environment rules) is new to the e2e tier and must hold without the real e2e running at the gate; this takes claude-opus-5-5 at medium rather than the default claude-sonnet-5-5.

Every real-provider e2e that spawns phax runs it in a temporary phax home holding the providers.json and routing the suite declares, built from the branch's own types and defaults. The provider CLIs keep their real HOME and sign-ins, and the operator's ~/.phax is neither read for routing nor written.

### Detailed instructions

- `tests/e2e/helpers/tempEnv.ts`: `createTempEnv(options: { readonly enable?: readonly ProviderId[]; readonly routing?: ModelRouting } = {})`. Type ProviderId from the branch's own provider config: the keys of ProviderConfig["providers"], or the E2EProvider id union in providers.ts if that is the same set. It still copies the fixture, pins the fixture's `state.root` to the temporary home (as written, per q-explicit-root) and initialises git as today. Into the temporary home it writes `providers.json`: DEFAULT_PROVIDER_CONFIG from `src/domain/routing/defaults.ts`, with `enabled: true` on claude-code and every declared provider and `enabled: false` on every other. It writes `model-routing.json`: `options.routing ?? DEFAULT_MODEL_ROUTING`. Before writing, it checks each value with the branch's `decodeProviderConfig` and `decodeModelRouting`, and throws on failure, so a format change on the branch fails here instead of in a provider run. Never write a hand-written JSON fixture.
- TempEnv gains a brand: declare `const TEMP_PHAX_HOME: unique symbol` in tempEnv.ts and add `readonly [TEMP_PHAX_HOME]: true` to TempEnv, set only by createTempEnv. Export a `tempPhaxHomeOf(env: unknown): string`. It returns `env.phaxHome` when the brand is present and the directory still holds providers.json. Otherwise it throws `runCli: no temporary phax home: pass the TempEnv createTempEnv returned, not a directory`.
- `tests/e2e/helpers/runCli.ts`: change the signature to `runCli(args: string[], env: TempEnv, opts: RunCliOptions)`. Call `tempPhaxHomeOf(env)` first, before any spawn. Build the child environment with an exported pure function `childEnvironment(phaxHome, extra)`: `{ ...process.env, ...extra, PHAX_HOME: phaxHome }`. It throws if `extra` names HOME or PHAX_HOME, and it never touches HOME. Spawn with `cwd: env.repoDir`. Keep `cliThrewIn` keyed by repoDir, and replace `stateRootOf` with `env.phaxHome` in printArtifacts.
- Move the three e2e files onto it. In realFlow.test.ts, each provider's suite calls `createTempEnv({ enable: [provider.id] })` and passes `env` to runCli; the existing assertions keep checking that the run folder is under `env.phaxHome` and that security.json records the forced provider. In headlessAuthoring.test.ts, call `createTempEnv()` and pass `env` to runCli. In vibeSecure.test.ts, delete `vibeProviderEnabled()` and its skip reason (the phax run cases now skip only on PHAX_E2E_RUN, the vibe executable and its version), use `createTempEnv({ enable: ["mistral-vibe"] })`, pass `env` to runCli, drop the now-unused imports, and update the header comment. The direct `runVibeAgent` cases do not change.
- Create `tests/e2e/helpers/operatorPhaxHome.ts` with `snapshotOperatorPhaxHome()`. It returns a sorted list: the sha256 of every regular file directly under `join(os.userInfo().homedir, ".phax")`, plus the entry names directly under its `runs/` and `worktrees/`, skipping the repository under test. A missing ~/.phax gives an empty list. Use it in realFlow (the claude-code suite) and headlessAuthoring: snapshot in beforeAll, assert equality in afterAll, and assert that today's daily telemetry journal (the name `dailyJournalFileName` in src/infra/telemetry/globalJournal.ts gives) exists under `env.phaxHome`. In vibeSecure, also assert that ~/.phax/providers.json's sha256 is unchanged.
- Integration tests of the helpers that need no provider: create `tests/integration/e2eTempHome.test.ts`, with isolatePhaxHome and isolateGit. (a) createTempEnv({ enable: ["mistral-vibe"] }): its providers.json and model-routing.json load through the branch's `loadProviderConfig` and `loadModelRouting` with PHAX_HOME pointed at the temporary home, and the enabled set is exactly mistral-vibe plus claude-code. (b) runCli with a string or a plain `{ repoDir, phaxHome }` object throws the no-temporary-home error, and no child was spawned (no telemetry appears in the given directory). (c) childEnvironment keeps HOME equal to process.env.HOME, sets PHAX_HOME, overrides a PHAX_HOME the test set in process.env, and refuses an extra HOME or PHAX_HOME. (d) runCli(["validate"], env, …) exits 0, stdout carries `home:    <env.phaxHome> (PHAX_HOME)`, and the temporary home then holds only phax home files and run state: providers.json, model-routing.json, telemetry.json, daily journals, runs/, worktrees/ and lock or registry files phax itself writes. Nothing else, and no credential or sign-in file. (e) With process.env.PHAX_HOME set to a sentinel directory holding a sentinel config.json, runCli's child reads only the temporary home, and the sentinel's hashed listing is unchanged.
- Do not run the real e2e tier at the gate and do not edit vitest.e2e.config.ts. `pnpm test:type` typechecks the e2e files.

### Planned files to create

- `tests/e2e/helpers/operatorPhaxHome.ts`
- `tests/integration/e2eTempHome.test.ts`

### Planned files to edit

- `tests/e2e/helpers/tempEnv.ts`
- `tests/e2e/helpers/runCli.ts`
- `tests/e2e/realFlow.test.ts`
- `tests/e2e/headlessAuthoring.test.ts`
- `tests/e2e/vibeSecure.test.ts`

### Optional files that may be edited

- `tests/e2e/helpers/artifacts.ts`
- `tests/e2e/helpers/providers.ts`
- `tests/e2e/fixtures/minimal-repo/phax.json`

### Boundary contracts

The e2e suites (consumers) declare which providers they need, and optionally a routing table. The e2e helpers (producers) give back a TempEnv whose temporary phax home holds providers.json and model-routing.json in the branch's own format, plus a runCli that spawns phax only against such a TempEnv. The child gets PHAX_HOME set to that home and HOME unchanged. The helpers consume the branch's DEFAULT_PROVIDER_CONFIG, DEFAULT_MODEL_ROUTING, decodeProviderConfig and decodeModelRouting, so a format change on the branch moves the e2e home with it.

### Test strategy

- a test environment created with mistral-vibe declared has a providers.json and model-routing.json that the phax under test decodes without error, enabling exactly mistral-vibe and claude-code — medium · example · loadProviderConfig and loadModelRouting results with PHAX_HOME at the temporary home · in-phase · ac-e2e-shape
- runCli given a bare directory or an object createTempEnv did not make throws before spawning, naming the missing temporary phax home — small · example · the thrown message, and no child output in the given directory · in-phase · ac-e2e-guard
- the child environment keeps HOME equal to the test process's HOME, sets PHAX_HOME to the temporary home, and refuses an extra HOME or PHAX_HOME — small · example · childEnvironment's returned env and its refusals · in-phase · ac-e2e-signins
- after phax validate is spawned through runCli, the temporary home holds only phax home files and run state, with no provider sign-in or credential file — medium · example · the home's listing against the allowed file names · in-phase · ac-e2e-signins
- a PHAX_HOME exported in the test process is overridden for the e2e child, which reads only the temporary home and leaves the exported directory untouched — medium · example · validate's home line and the sentinel directory's hashed listing · in-phase · ac-leak
- vibeSecure's phax run cases run instead of skipping whatever the operator's providers.json holds, each phase's security.json records mistral-vibe, and the operator's providers.json is byte-identical afterwards — large · smoke · security.json provider and the sha256 of ~/.phax/providers.json before and after · in-phase · ac-e2e-vibe-runs
- realFlow for codex-cli and mistral-vibe records the forced provider in each phase's security.json, with the run folder under the temporary phax home, when the operator's providers.json does not enable that provider — large · smoke · security.json provider and the run folder's location · in-phase · ac-e2e-realflow
- realFlow for claude-code and headlessAuthoring leave the operator's ~/.phax snapshot identical and write today's telemetry journal under the temporary phax home — large · smoke · snapshotOperatorPhaxHome before and after, and the journal file under env.phaxHome · in-phase · ac-e2e-untouched

### Implementation order

1. createTempEnv options, files and brand
2. tempPhaxHomeOf, childEnvironment and the new runCli signature
3. the helper integration tests
4. operatorPhaxHome snapshot
5. realFlow, headlessAuthoring and vibeSecure

### Excluded scope

- Converting the in-process e2e suites (semanticTrace*, gateExhaustionResume, resetPhase) to spawn the CLI (spec non-goal).
- Copying or moving any provider sign-in or home (spec non-goal).
- Running the real e2e tier at the gate: the operator runs the three files on the branch before merging.
- docs/e2e-testing.md (phase-08).

### Verification

`pnpm test:type` typechecks every e2e file against the new runCli signature, and a `runCli(["ls"], "/tmp", …)` written in a scratch e2e test fails to compile. The new integration test passes without any provider installed. The large lines are proved by the operator's run of `PHAX_E2E_RUN=1 pnpm test:e2e:real` on the three named files, before merging.

### Expected handoff content

The final signatures of createTempEnv, runCli, tempPhaxHomeOf, childEnvironment and snapshotOperatorPhaxHome. The exact files a temporary home holds after a validate spawn. The skip conditions vibeSecure keeps. The command the operator runs before merging: `PHAX_E2E_RUN=1 pnpm test:e2e:real tests/e2e/realFlow.test.ts tests/e2e/headlessAuthoring.test.ts tests/e2e/vibeSecure.test.ts`. Any deviation from the planned files, with its reason.

### Commit subject

`test(e2e): run every phax-spawning e2e in a temporary phax home`

### Commit body

createTempEnv writes a temporary phax home holding providers.json and model-routing.json built from the branch's own defaults, with the declared providers plus claude-code enabled. runCli spawns phax only against such an environment, with PHAX_HOME set to it and HOME unchanged, so the provider CLIs keep their sign-ins. realFlow, headlessAuthoring and vibeSecure use it. vibeSecure no longer skips on the operator's providers.json. realFlow and headlessAuthoring check that the operator's ~/.phax is left untouched. Integration tests cover the helpers without a provider.

---

## phase-07 — Pin the phax home to the run {#phase-07-pin-run-home}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high
**Assignment reason:** This phase designs a new persisted record, a recognition rule that is security-relevant and a session environment contract across every provider adapter, which no code shows yet; it takes claude-opus-5-5 at high rather than the default claude-sonnet-5-5 at medium.

A run keeps the phax home it started with. `phax run` records it in the run's folder, the run's sessions get it explicitly, a phax command inside one of the run's phase worktrees uses it and refuses a differing PHAX_HOME, and `phax resume` refuses a differing current home, naming the recorded one.

### Detailed instructions

- The record: `<stateRoot>/runs/<run key>/phax-home.json`, holding `{ path, from }` with both fields required. `createRunFolder` (`src/app/runFolder.ts`) writes it from `resolvePhaxHome()` before the first session of the run can start. Decode it through a schema in `src/schemas/runHome.ts`. Read the persisted-format and file-decoder guards in tests/unit/architecturalGuards*.test.ts before shaping that module, follow them, and never edit them; if the record cannot be added without a guard change, stop and report it.
- Recognising a run's phase worktree (`src/app/runHome.ts`): walk the real path of the cwd and its ancestors for a directory `<root>/worktrees/<key>/<phase>` whose `<root>/runs/<key>/run-status.json` exists. Take the outermost match, so a look-alike tree built inside a worktree cannot override the real one. Use only the location: not git, not `.phax-context/` (a session can delete it), and not the loaded config (the state root itself depends on the home).
- The recorded home of such a worktree is the record's `{ path, from }`. A missing record is refused exactly like a record that does not decode: the call fails with a ConfigValidationError, `path: "PHAX_HOME"`, naming the missing or undecodable file, exit 2. No call ever falls back to the default home: the project allows no back-compat shim in persisted state.
- Pinning: `src/app/runHome.ts` exports `pinRunHome(cwd, env)`, and `src/cli/main.ts` calls it once before handing the call to the runner. It sets the pin on the resolution point in `src/app/phaxHome.ts`: from then on `resolvePhaxHome()` returns the recorded home. When the env's PHAX_HOME is set and its normalised path differs from the recorded path, `resolvePhaxHome()` fails with a ConfigValidationError, `path: "PHAX_HOME"`, message `PHAX_HOME "<value>" differs from this run's phax home "<recorded>"`, so phase-04's guard refuses the call with exit 2. A missing or undecodable record sets a pin that fails the same way, naming the file. Only phaxHome.ts reads the variable. Help, `--version`, `--usage` and `completions` stay unaffected.
- The pin is set only at the process entry, never inside the program definition or a use case: in-process tests run from the repository's own cwd, which is itself a phase worktree under the real ~/.phax during a phax run, and must not read it. `pnpm test` has to pass from inside this phase's worktree.
- The notice and validate follow the recorded `from`: a run on the default home prints no notice even though its sessions carry PHAX_HOME.
- Sessions: add `src/ports/sessionPhaxHome.ts`, a Context.Reference in the manner of `src/ports/providerStores.ts`, provided beside the backend in `makeProviderBackendLayer` (`src/cli/commands/runLayers.ts`). The Claude Code, Codex and Vibe adapters set PHAX_HOME to it in every session they spawn, on top of the environment they build today (including Claude's project-only environment). Interactive sessions (`phax enter`, `enter-phase`, `shell`, interactive stops, review and adjust-plan sessions) pass it through their invocation's env. For a command that targets an existing run, the value is that run's recorded home, not the current one. Nothing but PHAX_HOME is added to a session's environment.
- `phax resume`: before it changes anything, read the run's record. A missing or undecodable record is refused with a ConfigValidationError, `path: "PHAX_HOME"`, exit 2, naming the file. Otherwise compare the recorded home with the current resolved home. When they differ, refuse with a ConfigValidationError, `path: "PHAX_HOME"`, exit 2, message `this run's phax home is "<recorded>", but the current phax home is "<current>"`, followed by how to fix it: set PHAX_HOME to the recorded path, or unset it when the record is from `default`.
- Write set: `phax run` and `phax resume` refuse, in the security preflight (`src/app/runPreflight.ts`, SecurityPreflightError, exit 11), a resolved `security.filesystem.allowWrite` entry that equals or contains the run's record path, naming the entry and the record. This repository's phax.json declares no allowWrite.
- Tests in `tests/integration/runHome.test.ts`, on temporary state roots with isolatePhaxHome and isolateGit, spawning through boundedSpawn where the process entry matters. Cover: the record written by createRunFolder; the worktree table (record present, record absent refused naming the file, corrupt record refused naming the file, `.phax-context` removed, nested look-alike tree, a directory outside any run worktree) against PHAX_HOME unset, equal and differing; resume with an equal home, a differing home and an absent record; the allowWrite refusal; and the PHAX_HOME each provider adapter hands its spawn, using the fake executables or fakes the adapter tests already use.

### Planned files to create

- `src/schemas/runHome.ts`
- `src/app/runHome.ts`
- `src/ports/sessionPhaxHome.ts`
- `tests/integration/runHome.test.ts`

### Planned files to edit

- `src/app/phaxHome.ts`
- `src/app/runFolder.ts`
- `src/app/resume.ts`
- `src/app/runPreflight.ts`
- `src/cli/main.ts`
- `src/cli/commands/runLayers.ts`
- `src/cli/definitions/resume.ts`
- `src/cli/definitions/sessions.ts`
- `src/cli/definitions/review.ts`
- `src/cli/definitions/adjustPlan.ts`
- `src/infra/providers/claudeCode.ts`
- `src/infra/providers/codexCli.ts`
- `src/infra/providers/mistralVibe.ts`
- `src/app/enterPhase.ts`
- `src/app/interactiveStop.ts`
- `src/app/closeStop.ts`
- `src/app/reviewCode.ts`
- `src/app/adjustPlan.ts`

### Optional files that may be edited

- `src/infra/session.ts`
- `src/domain/phaxHome.ts`
- `src/cli/definitions/run.ts`

### Boundary contracts

The run (producer) states its home once, in the record under its run folder, outside the phase sandboxes' write set. Phase-worktree phax commands and `phax resume` (consumers) need that home and must not take another from their environment; without the record they refuse. The provider adapters and interactive session launchers (consumers) need the home to hand to a session; the CLI edge provides it through the SessionPhaxHome reference. `resolvePhaxHome` keeps its signature and result type, so every reader moved in phase-02 and phase-03 follows the pin unchanged.

### Test strategy

- a call from a run's phase worktree uses the recorded home with PHAX_HOME unset or equal, refuses a differing one, refuses an absent or corrupt record naming the file, and is not misled by a removed .phax-context or a nested look-alike tree — medium · table · the resolved home or the refusal message per (worktree, record, PHAX_HOME) row · in-phase
- phax run records the home it started with in the run folder, with its source — medium · example · the decoded phax-home.json against the environment the run folder was created under · in-phase
- phax resume under a differing home or with an absent record is refused before anything changes, naming the recorded home or the missing file, and proceeds under the same home — medium · example · exit code, message, and the run folder's unchanged hashes on refusal · in-phase
- every provider adapter and interactive launcher hands its session PHAX_HOME set to the run's home, and adds nothing else — medium · table · the captured spawn environment per provider against the environment built before this phase plus PHAX_HOME · in-phase
- an allowWrite entry that equals or contains the record path stops run and resume before any session, and an unrelated entry does not — small · boundary · the SecurityPreflightError naming the entry, or its absence · in-phase

### Implementation order

1. the record's schema and its write in createRunFolder
2. worktree recognition and the pin in runHome and phaxHome, with the table test
3. main.ts pins at the process entry
4. resume refusal and the write-set preflight
5. the session reference, provider adapters and interactive launchers

### Excluded scope

- Removing PHAX_HOME from sessions, or refusing every set PHAX_HOME inside a phase worktree: rejected by the operator.
- Pinning a call made from outside every phase worktree.
- Changing the phase guard's classification or detection rule.
- Moving or rewriting the home of an existing run, or a flag that overrides the recorded home (spec non-goal on migration).
- Any fallback for a run with no record: a missing record is refused.
- The docs page (phase-08).

### Verification

On a temporary state root holding a run with a recorded home A: from its phase worktree, `PHAX_HOME=<B>` with `phax validate` (run through the integration test's launcher) exits 2 naming both paths, and without PHAX_HOME it reports A. With the record deleted, the same call exits 2 naming the missing phax-home.json. `pnpm test` passes from inside the phase worktree with no refusal from the real-home guard.

### Expected handoff content

The record's path, shape and schema module. The recognition rule and where the pin is set. The exact refusal texts and exit codes for the worktree, missing-record, resume and allowWrite cases. Every spawn site that now sets PHAX_HOME. The limits that remain (a call from outside every phase worktree; a state root in a sandbox's temporary directory; a run started before this change cannot be used from its worktrees or resumed), for the docs phase. Any deviation from the planned files, with its reason.

### Commit subject

`feat(home): pin the phax home to the run`

### Commit body

phax run records its phax home in the run folder. The run's sessions get PHAX_HOME set to it, a phax command inside one of the run's phase worktrees uses it and refuses a differing PHAX_HOME, and phax resume refuses a differing current home, naming the recorded one. run and resume refuse an allowWrite entry that would let a session write the record. A missing record is refused like an undecodable one, with no fallback to the default home.

---

## phase-08 — Document the phax home and correct the e2e testing guide {#phase-08-docs}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

Operators learn from a docs page and the README that PHAX_HOME moves phax's own home, for a second configuration beside the daily one or for a CI machine, and that the provider CLIs' sign-ins never move. docs/e2e-testing.md says truthfully how the real e2e isolates itself.

### Detailed instructions

- Create `docs/phax-home.md` for the reader §11 of the spec names: an operator who wants a second phax configuration beside the daily one (a release candidate, a branch under test), or a CI machine whose phax files live outside the CI user's home. Cover: what the phax home holds (config.json, providers.json, model-routing.json, telemetry.json, the daily telemetry journals, runs/ and worktrees/ when no layer names state.root); what never moves (~/.claude, ~/.codex, Vibe's home, the user-scope skills install, the ~ in a PR body); the rules for the variable (an absolute path to a directory, created on first write; empty, relative, `~/…` unexpanded or a non-directory is refused with exit 2); no fallback to ~/.phax and no migration; the stderr notice `phax home: <path> (PHAX_HOME)` and the `home:` line of `phax validate` (text and --json); and the state-root order, weakest first: built-in ~/.phax, then PHAX_HOME, then an explicit state.root in any layer, which wins and is read as written. Use the spec's §11 example verbatim as the worked example.
- In the same page, cover the run's pinned home: `phax run` records it in the run folder, the run's sessions get it, a phax command inside the run's phase worktrees uses it and refuses a differing PHAX_HOME, `phax resume` refuses a differing home (with the default state root it does not find the run at all), a run with no record (one started by an older phax and still in flight at upgrade time) is refused inside its phase worktrees and by `phax resume`, naming the missing file, and an allowWrite entry covering the record is refused. State the limits phase-07's handoff records.
- Wire the page into the site: add its entry to `site/pages.ts`, following the neighbouring entries' fields, and its source to `site/build/sources.ts`.
- README.md: in the configuration-layers paragraph (the **Layers.** paragraph), name the global layer as the phax home's config.json (`~/.phax/config.json` unless PHAX_HOME is set) and link docs/phax-home.md. Do not touch the README's generated CLI block.
- docs/e2e-testing.md: remove the claim that the real ~/.phax is never read or written, and every `PHAX_STATE_ROOT` command (phax does not read that variable). Describe what the helpers now do: createTempEnv({ enable, routing }) writes a temporary phax home in the branch's format, runCli takes that environment and sets PHAX_HOME, HOME is unchanged so the provider CLIs keep their sign-ins, and the operator's ~/.phax is left untouched. Replace the resume and enter suggestions with `PHAX_HOME=<temporary home> phax resume <short-name>` (and enter-phase), run in the temporary repository.
- Read the source files you describe (src/app/phaxHome.ts, src/app/runHome.ts, src/domain/phaxHome.ts, tests/e2e/helpers/tempEnv.ts, tests/e2e/helpers/runCli.ts) so every sentence matches the code.

### Planned files to create

- `docs/phax-home.md`

### Planned files to edit

- `site/pages.ts`
- `site/build/sources.ts`
- `README.md`
- `docs/e2e-testing.md`

### Optional files that may be edited

- `docs/security.md`
- `docs/upgrading.md`

### Test strategy

- (none)

### Implementation order

1. docs/phax-home.md
2. site wiring
3. README paragraph
4. docs/e2e-testing.md correction

### Excluded scope

- Any change under src/ or tests/.
- The README's generated CLI block (regenerated in phase-05).
- A --home flag or phax.json key (spec non-goal).

### Verification

The site build includes docs/phax-home.md as a page. `git grep -n PHAX_STATE_ROOT -- docs README.md` finds nothing. The README's Layers paragraph links docs/phax-home.md.

### Expected handoff content

The new page's path and its site entry. The README sentence as changed. The sections of docs/e2e-testing.md that were rewritten or removed. Any deviation from the planned files, with its reason.

### Commit subject

`docs(home): document PHAX_HOME and correct the e2e testing guide`

### Commit body

Add docs/phax-home.md for operators running a second phax configuration or a CI machine: what the phax home holds, what PHAX_HOME never moves, how an invalid value is refused, the stderr notice, validate's home line, the state-root order and the home a run keeps. Wire it into the site and link it from the README's configuration-layers paragraph (q-docs user-facing). docs/e2e-testing.md drops the false claim that ~/.phax is never read and the PHAX_STATE_ROOT commands, and describes the temporary phax home.
