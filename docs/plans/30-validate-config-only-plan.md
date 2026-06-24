# Plan — phax validate: config-first, plan optional

## Overview

`phax validate` today validates two things and gets both wrong:

1. It **always** tries to load a `phax-plan.json` because `--plan` defaults to
   `"phax-plan.json"` (`src/cli/program.ts:75`). Run `phax validate` in a project
   that has no plan and it fails with a confusing "plan validation failed", even
   though you never asked it to check a plan.
2. Its `--config <path>` flag is **dead**: `runValidate` calls `loadConfig(cwd)`
   and ignores `opts.config` entirely (`src/cli/commands/validate.ts:14`).

What we actually want is a command that validates **the configuration** — the
project `phax.json` plus its two user overlays (`phax.local.json` and the global
`~/.phax/config.json`) — and treats plan validation as an **opt-in** extra for
when you want to check a `phax-plan.json` produced by `extract-plan` or written
by hand. There is intentionally **no** markdown/`plan.md` validation: `plan.md`
is the source for `extract-plan`, which already validates the extracted JSON
against the schema, so re-validating markdown here adds nothing.

The good news: `loadConfig` already reads and validates all three config layers
(`readUserOverlay` decodes both the global and local overlays and fails loudly if
either is malformed — `src/app/loadConfig.ts:193-201`). So validating the config
stack is already a single `loadConfig` call. The work is (a) exposing which files
that call touched so the command can report them, and (b) reshaping the command
so config is always checked and the plan is optional.

### Decisions locked in

- `validate` validates config **always**, plan **only** when `--plan <path>` is
  passed explicitly. No implicit default path.
- The dead `--config <path>` flag is **removed** — `loadConfig` auto-discovers
  `phax.json` from the cwd up to the git root, which is the correct behavior;
  a flag that is silently ignored is worse than no flag.
- No `plan.md` / markdown validation is added anywhere.
- Config-layer discovery is reported for transparency (which files were checked),
  reusing `loadConfig`'s existing discovery logic — no second discovery algorithm.

## Required commands

- (none)

## phase-01 — Config sources reporter {#phase-01-config-sources}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low

Expose which config files `loadConfig` would read for a given `cwd`, so the
`validate` command (phase-02) can tell the user exactly which layers it
validated. This is a pure, additive helper in the app layer; it does not change
`loadConfig`'s behavior or return type.

### Detailed instructions

- In `src/app/loadConfig.ts`, add an exported `ConfigSources` interface with
  three readonly fields: `project: string`, `localOverlay: string | undefined`,
  `globalOverlay: string | undefined`.
- Add an exported `describeConfigSources(cwd: string = process.cwd()):
  ConfigSources | undefined`. Implement it by reusing the existing module-private
  helpers — `findGitRoot`, `findPhaxConfig`, `localUserConfigPath` — and the
  same global path `loadConfig` uses (`join(homedir(), ".phax", "config.json")`):
  - Return `undefined` when there is no git root, or no project `phax.json` is
    found (the same two conditions under which `loadConfig` returns a `Left`).
  - Otherwise return `project` set to the discovered `phax.json` path,
    `localOverlay` set to the local overlay path **only if it exists**
    (`existsSync`) else `undefined`, and `globalOverlay` set the same way.
- Place the new code next to `locatePhaxConfig` (which already exposes discovery
  for callers) and document it with a short doc comment noting it mirrors
  `loadConfig`'s discovery and existence rules.
- This export is intentionally **not consumed yet** (phase-02 wires it into the
  CLI). `knip` would flag it as an unused export, which is why this phase's gate
  profile is `fast` (no `knip`); phase-02 runs the full profile once the consumer
  exists.

### Planned files to create

- (none)

### Planned files to edit

- `src/app/loadConfig.ts`
- `tests/unit/loadConfig.test.ts`

### Optional files that may be edited

- (none)

### Boundary contracts

Producer: `src/app/loadConfig.ts` exposes `describeConfigSources` returning a
`ConfigSources | undefined`. Consumer (phase-02): `src/cli/commands/validate.ts`
needs the resolved project path plus the two optional overlay paths to render
which layers were validated. Stable shape: the three-field `ConfigSources`
record; `undefined` signals "no config discoverable" (the same failure surface
`loadConfig` already reports).

### Test strategy

Application-layer helper → unit tests in `tests/unit/loadConfig.test.ts`,
following that file's existing fixture/setup style. Write these before
implementation:

- Project `phax.json` found, neither overlay present → `localOverlay` and
  `globalOverlay` are `undefined`, `project` is the resolved path.
- Local overlay (`phax.local.json`) present → `localOverlay` is its path.
- Global overlay (`~/.phax/config.json`) present → `globalOverlay` is its path.
- No project `phax.json` (or not in a git repo) → returns `undefined`.

### Implementation order

Tests first (they pin the four cases), then the helper.

### Excluded scope

- Any change to `loadConfig`'s signature, return type, or validation behavior.
- Wiring the helper into the CLI (phase-02).

### Verification

- The project's configured `fast` gate profile in `phax.json` (`knip` is
  deliberately deferred to phase-02, see Detailed instructions).

### Expected handoff content

- The exact `describeConfigSources` signature and the `ConfigSources` field
  names/types, so phase-02 can consume it without re-reading this phase.
- Confirmation that the export is unused as of this phase (knip deferred).
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(config): add describeConfigSources to report validated config layers

### Commit body

Add an additive app-layer helper that reports which config files loadConfig
would read for a cwd (project phax.json plus optional local and global
overlays), reusing the existing discovery helpers. Backs the reshaped validate
command. Covered by unit tests for the present/absent overlay cases and the
no-config case.

## phase-02 — validate validates config, plan optional {#phase-02-validate-config-first}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Reshape `phax validate` so it always validates the config stack and reports the
layers checked, validates a `phax-plan.json` only when `--plan` is given, drops
the dead `--config` flag, and removes the implicit `phax-plan.json` default.

### Detailed instructions

- `src/cli/commands/validate.ts`:
  - Change `ValidateOptions` to `{ plan?: string }` (drop `config`).
  - Import `describeConfigSources` alongside `loadConfig`.
  - Always `loadConfig(cwd)`; on `Left`, print the existing
    `Config validation failed` error (and `  at:` path when present) and return
    `1`.
  - On success, log `✓ config is valid (project: <namespace>)`, then call
    `describeConfigSources(cwd)` and, when it returns a value, log the three
    layer lines: `project:` path, `local:` path or `(none)`, `global:` path or
    `(none)`.
  - Only when `opts.plan !== undefined`: `loadPlan(opts.plan)`; on `Left` print
    `Plan validation failed` (and `  at:` path) and return `1`; on success log
    `✓ <path> is valid (run: <shortName>, <n> phase(s))`.
  - Return `0`.
- `src/cli/program.ts` (`validate` command, ~lines 72-79):
  - Update `.description(...)` to reflect config-first behavior, e.g. "Validate
    phax.json and its user overlays without any side effects; pass --plan to
    also validate a phax-plan.json".
  - **Remove** the `--config <path>` option.
  - Change `--plan` to optional with **no default**:
    `.option("--plan <path>", "Also validate a phax-plan.json at this path")`.
  - Update the action signature to `(opts: { plan?: string })` and keep the
    `runValidate(opts, consoleOutput)` / `process.exit(exitCode)` flow.
- `README.md`:
  - Update the usage example (~line 117) from
    `phax validate --config phax.json --plan phax-plan.json` to the config-first
    form (`phax validate`, and a second line showing the opt-in
    `phax validate --plan phax-plan.json`).
  - Update the command reference line (~line 456) to
    `phax validate [--plan <path>]` with a description matching the new behavior.

### Planned files to create

- `tests/unit/cli/validate.test.ts`

### Planned files to edit

- `src/cli/commands/validate.ts`
- `src/cli/program.ts`
- `README.md`

### Optional files that may be edited

- (none)

### Boundary contracts

`src/cli/commands/validate.ts` is a thin CLI view: it consumes `loadConfig`
(`Either<ResolvedConfig, …>`), `describeConfigSources` (`ConfigSources |
undefined`, from phase-01), and `loadPlan` (`Either<PhaxPlan, …>`), and renders
exclusively through the injected `OutputPort`. No business logic lives in the
command — it orchestrates the app calls and maps results to log/error lines and
an exit code.

### Test strategy

CLI command → unit tests in `tests/unit/cli/validate.test.ts`, following the
`tests/unit/cli/ls.test.ts` pattern (mock `../../../src/app/loadConfig.js` and
`../../../src/app/loadPlan.js`, use a fake `OutputPort` capturing `log`/`error`).
Write before implementation:

- Config valid, no `--plan` → returns `0`, logs the config-valid line and the
  three layer lines, and `loadPlan` is **never called**.
- Config invalid → returns `1`, prints the config error, `loadPlan` not called.
- Config valid + `--plan` to a valid plan → returns `0`, logs the plan-valid
  line with run short name and phase count.
- Config valid + `--plan` to an invalid plan → returns `1`, prints the plan
  error.
- `describeConfigSources` returning `undefined` does not crash the success path.

### Implementation order

Tests first (they pin the opt-in plan contract and the "loadPlan never called"
guarantee), then the command body, then `program.ts` wiring, then README.

### Excluded scope

- Any `plan.md` / markdown validation.
- Changes to `extract-plan`, `loadPlan`, or the plan schema.
- New gate commands or `phax.json` security changes.

### Verification

- The project's configured `full` gate profile in `phax.json` (includes `knip`,
  which now passes because `describeConfigSources` is consumed here).

### Expected handoff content

- The final `validate` CLI surface: that `--config` is gone, `--plan` is
  optional with no default, and config is always validated.
- Any deviation from the planned file lists, with the reason (e.g. if the
  `cliProgram.test.ts` top-level command count needed no change because the
  command name is unchanged).

### Commit subject

feat(cli): make phax validate config-first with optional plan check

### Commit body

phax validate now always validates the config stack (phax.json plus the local
and global user overlays) and reports which layers it checked, and validates a
phax-plan.json only when --plan is passed explicitly. Removes the dead --config
flag and the implicit phax-plan.json default that made validate fail in projects
without a plan. No markdown/plan.md validation is added. Covered by CLI unit
tests, including that loadPlan is never called without --plan.
