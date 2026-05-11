# Implementation plan — `phax` CLI

> Source spec: `.context/attachments/spec_orchestrateur_claude_code_phases (2).md`
> Deliverable location: `docs/plans/plan.md`
> Format: matches spec §27.3 so `phax extract-plan` can consume this file
> and produce `phax-plan.json`. Each phase carries an HTML anchor
> (`{#phase-NN-...}`) for the `planMarkdownAnchor` field.

---

## Context

`phax` is a deterministic local CLI that drives Claude Code through isolated,
gated phases — one Git worktree per phase, one commit per phase, a same-session
fix loop, and a kept-open final phase for human review. It is implemented in
TypeScript with Effect, strict TS settings, schema-validated boundaries,
discriminated-union state machines, typed errors, and a standalone Oxc-based
architecture audit runner.

The work is split into 15 phases. The spec recommends 13 (§26); I add an
explicit `extract-plan` phase (§8) and an early hygiene phase (oxlint /
oxfmt / knip) so every subsequent phase lands in a continuously clean repo.
Locks, dry-run, and resume are folded into adjacent phases where their
state-inspection logic naturally belongs.

Default execution model is **claude-sonnet-4-6**. **claude-opus-4-7** is
reserved for the architecture-audit phase, where rule design and AST
traversal benefit from deeper reasoning. Effort is calibrated to surface
area, not intrinsic difficulty.

## Architecture summary

```txt
src/
  cli/            View layer — commander shell, output formatting, exit codes
  app/            Use cases, orchestration, state transitions
  domain/         Pure types, state machines, branded types, plan validation
  ports/          Service interfaces (FS, Git, Claude, Shell, Clock, Editor)
  infra/          Effect adapters that implement the ports
  schemas/        Effect Schema definitions for every external boundary
scripts/
  audit-architecture.ts   Oxc-based architecture audit entry point
.skills/
  phax-planning.md
  phax-phase-handoff.md
  boundaries.md
  validation-boundaries.md
  state-machines.md
  effect-services.md
  cli-view-layer.md
  infrastructure-adapters.md
tests/
  unit/  integration/  type/
```

## Cross-phase invariants (apply to every phase)

- No `any` in `domain/` or `app/`.
- External inputs (config, plan, Claude JSON, git output, env) decoded through
  Effect Schema before crossing into the domain.
- `RunState` and `PhaseState` are discriminated unions; transitions go through
  explicit functions in `domain/`.
- Branded types for `ShortName`, `RunId`, `PhaseId`, `BranchName`,
  `WorktreePath`, `ClaudeSessionId`, `GateProfileId`, `WorkspaceId`.
- Filesystem, shell, git, Claude, editor, clock, and `process.env` are
  reachable only through infrastructure adapters.
- All writes listed in §27.7 use temp-file + rename atomicity.
- CLI is the only layer that prints; domain/app emit through output ports.
- Exit codes follow §27.9.
- Default test suite is hermetic — no real `claude`, real repos, or real
  editor in CI.
- After phase-02: every commit must pass `pnpm lint`, `pnpm format:check`,
  and `pnpm knip` before its phase commit lands.

---

## Model & effort summary

| #  | Phase                                                              | Model               | Effort  |
|----|--------------------------------------------------------------------|---------------------|---------|
| 01 | CLI skeleton, `phax.json` schema, plan validation                  | claude-sonnet-4-6   | medium  |
| 02 | Lint / format / dead-code hygiene (oxlint, oxfmt, knip)            | claude-sonnet-4-6   | low     |
| 03 | Run folder, status model, atomic writes                            | claude-sonnet-4-6   | low     |
| 04 | Git worktree, branch safety, run locks                             | claude-sonnet-4-6   | medium  |
| 05 | Claude Code CLI backend + session capture                          | claude-sonnet-4-6   | medium  |
| 06 | `extract-plan` (headless Claude + JSON Schema)                     | claude-sonnet-4-6   | medium  |
| 07 | Phase prompt generation + output capture                           | claude-sonnet-4-6   | low     |
| 08 | Gates runner + same-session fix loop                               | claude-sonnet-4-6   | medium  |
| 09 | Commit behavior + non-final worktree cleanup                       | claude-sonnet-4-6   | low     |
| 10 | Final review, terminal entry, editor, Conductor handoff            | claude-sonnet-4-6   | medium  |
| 11 | Run listing, registry, archive                                     | claude-sonnet-4-6   | medium  |
| 12 | Final report, resume, dry-run                                      | claude-sonnet-4-6   | medium  |
| 13 | Vitest setup + unit / integration / type-level tests               | claude-sonnet-4-6   | high    |
| 14 | Oxc architecture audit (runner, rules, diagnostics, skills)        | **claude-opus-4-7** | high    |
| 15 | Documentation, example plan, skill files                           | claude-sonnet-4-6   | low     |

---

## phase-01 — CLI skeleton, `phax.json` schema, and plan validation  {#phase-01-cli-skeleton}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

### Objective
Stand up the project (TypeScript strict, ESM, pnpm, Effect, commander, Vitest),
the four-layer source layout, the Effect Schema definitions for `phax.json`
and `phax-plan.json`, and a `phax validate` command that exercises validation
without any side effect. This is the foundation every later phase depends on.

### Detailed instructions
- Initialize `package.json` for `phax`: `"type": "module"`, `"bin": { "phax": "./dist/cli/main.js" }`, `"engines": { "node": ">=20" }`.
- Add deps: `effect`, `@effect/schema`, `@effect/platform`, `@effect/platform-node`, `commander`. Dev deps: `typescript`, `tsx`, `vitest`, `@types/node`.
- Create `tsconfig.json` with the strict flags from spec §strict-typescript-requirements (strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes, noImplicitOverride, noFallthroughCasesInSwitch, noImplicitReturns, useUnknownInCatchVariables) and `tsconfig.build.json` that emits to `dist/`.
- Scaffold the layer directories under `src/`: `cli/`, `app/`, `domain/`, `ports/`, `infra/`, `schemas/`.
- In `src/schemas/`:
  - `phaxConfig.ts` — Effect Schema mirroring §7 (project, state, editor, agent, commands.setup/cleanup, gates, gateProfiles, workspaces[]). Reject unknown fields. Enforce non-empty command arrays where required, unique workspace ids, workspace paths inside repo root (post-decode check).
  - `phaxPlan.ts` — schema matching §27.2 (version, run.{shortName,title,branch,backend}, phases[].{id,title,model,effort,planMarkdownAnchor,commit.{subject,body}}). Enforce required fields per §9.
- In `src/domain/branded.ts`: brand types for `ShortName`, `RunId`, `PhaseId`, `BranchName`, `WorktreePath`, `ClaudeSessionId`, `GateProfileId`, `WorkspaceId`. Each brand has a `decode(unknown)` returning `Either`.
- In `src/domain/errors.ts`: tagged error variants — `PlanValidationError`, `ConfigValidationError`, `UnsafeGitStateError`, `WorktreeCreationError`, `SetupCommandFailedError`, `ClaudeInvocationError`, `ClaudeSessionIdMissingError`, `GateFailedError`, `FixAttemptFailedError`, `ArchiveBlockedByDirtyWorktreeError`, `RegistryCorruptionError`, `LockConflictError`.
- In `src/cli/main.ts`: commander shell that registers commands. Each command file is thin: parse args → decode into an internal command object → call an application use case → render the result/error through a CLI output port. Wire exit codes from §27.9.
- In `src/cli/commands/validate.ts`: `phax validate --config phax.json --plan phax-plan.json` runs schema validation only.
- In `src/app/loadConfig.ts`: discover `phax.json` by walking up from `cwd` to git root; decode; resolve `state.root` (expand `~`); return a `ResolvedConfig` value.
- In `src/app/loadPlan.ts`: read and decode `phax-plan.json`; never accept an invalid plan.
- Provide a CLI output port (`src/ports/output.ts`) so domain/app never touch stdout.
- No worktree, git, or Claude calls in this phase.

### Included scope
- Project bootstrap (tsconfig, package, scripts).
- Four-layer skeleton.
- Effect Schema for `phax.json` and `phax-plan.json`.
- Branded types and tagged errors.
- `phax validate` command.
- CLI output port.

### Excluded scope
- Git, worktree, Claude, gates, shell execution.
- Run folder creation (phase-03).
- Locks, registry (phase-04 / phase-11).
- Lint / format / knip configuration (phase-02).
- Tests (phase-13 — only smoke-level coverage here).

### Validation expectations
`phax validate` succeeds on a valid sample pair, fails with a precise error
showing the path of the offending field for malformed input. Strict TS
compiles. Running with `--help` lists registered commands.

### Commit subject
`ai(phase-01): create cli skeleton and validate phax configuration`

### Commit body
Bootstrap the `phax` project with a strict TypeScript / Effect setup, the four-layer source structure (CLI / app / domain / infra), schema validation for `phax.json` and `phax-plan.json`, branded domain types, a tagged error model, and a `phax validate` command exercised against the schemas.

### Expected handoff content
- Schema file paths and the exact field set each one accepts.
- Branded-type module path and the list of brands defined.
- Tagged error module path and the error variants exported.
- CLI output port shape — every later phase must print through it.
- `loadConfig` / `loadPlan` signatures and where they live.

---

## phase-02 — Lint, format, and dead-code hygiene (oxlint, oxfmt, knip)  {#phase-02-hygiene}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low

### Objective
Configure `oxlint` (Oxc linter), `oxfmt` (Oxc formatter), and `knip` (dead
files / exports / dependencies finder), wire them into npm scripts, and add
them to the `full` gate profile. Every later phase must land in a clean repo
on `lint`, `format:check`, and `knip`.

### Detailed instructions
- Install dev dependencies: `oxlint`, `oxfmt` (or the closest maintained Oxc formatter package at implementation time — fall back to `prettier` only if `oxfmt` is not yet usable), `knip`.
- `.oxlintrc.json`:
  - Enable the `correctness` and `suspicious` categories.
  - Enable selected rules from `pedantic` where they reinforce the architecture doctrine (e.g. `no-floating-promises`, `no-explicit-any`, `prefer-const`).
  - Ignore `dist/`, `coverage/`, `examples/**/dist`, `tests/**/__fixtures__/`.
- `oxfmt`:
  - Default config; add `.oxfmt.toml` (or equivalent) only if a project-wide setting is needed.
  - If `oxfmt` is unavailable, use `prettier` with `printWidth: 100`, `singleQuote: true`, and leave a TODO comment to migrate to `oxfmt` later.
- `knip.json`:
  - `entry`: `["src/cli/main.ts", "scripts/**/*.ts", "vitest.config.ts", "tests/**/*.test.ts"]`.
  - `project`: `["src/**/*.ts", "scripts/**/*.ts", "tests/**/*.ts"]`.
  - Treat unused exports, files, and devDependencies as errors. Allow known-runtime-only deps (e.g. `commander` via `bin`) via the `ignoreDependencies` field if needed.
- Add npm scripts to `package.json`:
  - `lint`: `oxlint`.
  - `lint:fix`: `oxlint --fix`.
  - `format`: `oxfmt .` (or fallback).
  - `format:check`: `oxfmt --check .` (or fallback).
  - `knip`: `knip`.
- Update the proposed `phax.json` `gateProfiles.full` (in Appendix A) so it runs `pnpm lint`, `pnpm format:check`, and `pnpm knip` alongside the existing checks.
- The `fast` profile stays minimal: `typecheck` + `test:unit` only.
- Document in a short section of the README-to-come (phase-15) that:
  - format conflicts are fixed by running `pnpm format`, not by lint exceptions;
  - knip failures are fixed by removing the dead code or wiring it into an entry point — never by adding ignore entries casually.
- Optional, leave only as a note (do not implement in MVP): a pre-commit hook via `husky` or `lefthook`.

### Included scope
- oxlint, oxfmt (or prettier fallback), and knip configs.
- npm scripts.
- `phax.json` gate-profile update.
- A note documenting the fix-it convention.

### Excluded scope
- Pre-commit hooks (mentioned only as a future possibility).
- Custom architecture rules — those live in phase-14 (Oxc audit engine).
- CI workflow files (out of MVP unless trivial).

### Validation expectations
On the post-phase-01 tree, `pnpm lint`, `pnpm format:check`, and `pnpm knip`
all exit 0. Introducing a stylistic violation trips `oxlint`; a formatting
drift trips `format:check`; an unused export trips `knip`.

### Commit subject
`ai(phase-02): add oxlint, oxfmt, and knip hygiene gates`

### Commit body
Configure `oxlint` for linting, `oxfmt` (with a prettier fallback) for formatting, and `knip` for dead-file/export/dependency detection, expose them as npm scripts, and add them to the `full` gate profile so every subsequent phase lands in a continuously clean repository.

### Expected handoff content
- Paths of `.oxlintrc.json`, formatter config, and `knip.json`.
- The full set of new npm scripts.
- Updated `phax.json` gate profile contents.
- Convention for resolving failures (run the tool, do not add ignore entries casually).

---

## phase-03 — Run folder model and atomic writes  {#phase-03-run-folder}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low

### Objective
Create the `~/.phax/runs/<short-name>/` skeleton and the JSON status files
(`run-status.json`, `phase-NN/status.json`) using an atomic temp-rename write
helper. Introduce the `RunState` / `PhaseState` discriminated unions and their
transition functions.

### Detailed instructions
- In `src/ports/fs.ts`: define a `FileSystem` port with `readText`, `writeAtomic`, `mkdirp`, `exists`, `remove`, `rename`.
- In `src/infra/fs.ts`: implement on top of `@effect/platform/FileSystem`. `writeAtomic` writes to `<final>.tmp.<random>` in the same directory, fsyncs, then renames. On failure, leave the temp file in place for debugging.
- In `src/domain/state.ts`:
  - `RunState = 'created' | 'running' | 'failed' | 'review_open' | 'completed' | 'stopped' | 'archived' | 'interrupted'`.
  - `PhaseState = 'pending' | 'setting_up_worktree' | 'running' | 'gates_failed' | 'fixing' | 'failed' | 'passed' | 'committed' | 'cleaning_up' | 'cleaned_up' | 'review_open' | 'handoff_failed' | 'skipped'`.
  - Transition functions: `startRun`, `failRun`, `openRunReview`, `archiveRun`, `pendingToSettingUp`, `settingUpToRunning`, `runningToPassed`, `passedToCommitted`, `committedToCleanedUp`, etc. Each returns `Either<InvalidTransition, NewState>`.
- In `src/app/runFolder.ts`: `createRunFolder(shortName, planMd, planJson, resolvedConfig)` creates `~/.phax/runs/<short-name>/` and writes `plan.md`, `phax-plan.json`, the resolved `phax.json` snapshot, and an initial `run-status.json` atomically.
- In `src/app/phaseFolder.ts`: `createPhaseFolder(runPath, phaseId)` creates `phase-NN/` with an initial `status.json`.
- Schemas for `run-status.json` and `phase/status.json` live under `src/schemas/status.ts`.

### Included scope
- FS port and adapter with atomic writes.
- Run / phase state machines.
- Run folder bootstrap.

### Excluded scope
- Git, worktree, Claude, gates.
- Registry (phase-11).
- Locks (phase-04).

### Validation expectations
Calling `createRunFolder` on a temp directory produces the expected files;
status JSONs round-trip through their schemas; invalid transitions return
`Left`; partial-write failures do not corrupt existing files.

### Commit subject
`ai(phase-03): create run folder model and atomic status writes`

### Commit body
Add the file-system port and adapter, atomic temp-rename writes, run/phase status schemas, the `RunState` and `PhaseState` discriminated unions with explicit transition functions, and the run/phase folder bootstrap.

### Expected handoff content
- FS port surface and `writeAtomic` semantics.
- State machine module path and the transition function names available.
- Run folder layout produced (which files exist after `createRunFolder`).

---

## phase-04 — Git worktree, branch safety, and run locks  {#phase-04-git-worktree-locks}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

### Objective
Add a `Git` port + adapter that owns every git interaction, a worktree
lifecycle aligned with §11, and a lock manager under `~/.phax/locks/` that
prevents two `phax` processes from mutating the same run.

### Detailed instructions
- `src/ports/git.ts` — `Git` port: `isClean(repo)`, `currentBranch(repo)`, `createBranch(branch, from)`, `branchExists(branch)`, `addWorktree(branch, path)`, `removeWorktree(path, force?)`, `commit(repo, subject, body)`, `worktreeIsClean(path)`.
- `src/infra/git.ts` — adapter shelling out through `@effect/platform/Command`. Parse output through small schemas in `src/schemas/git.ts`. Never interpolate user data into command strings; pass branch/path as separate argv tokens.
- `src/app/worktree.ts`:
  - `prepareRunBranch(shortName, planBranch, repoRoot)` — verifies clean tree unless `--allow-dirty`, creates the branch if needed, returns the branch name.
  - `createPhaseWorktree(shortName, phaseId, branch)` — produces `~/.phax/worktrees/<short-name>/phase-NN/` via `git worktree add`; returns a branded `WorktreePath`.
  - `removePhaseWorktree(path, force)` — refuses on dirty worktrees unless forced.
- `src/ports/lock.ts` and `src/infra/lock.ts`: lock file at `~/.phax/locks/<short-name>.lock` containing `{ shortName, pid, status, createdAt, updatedAt }`. `acquire` is atomic create-or-fail; `renew` updates `updatedAt`; `release` removes the file. Stale-detection: lock with `pid` no longer running OR `updatedAt` older than a configurable threshold (default 30 min).
- `src/app/lock.ts`: `withRunLock(shortName, fn)` — Effect resource that releases on exit; refuses to enter when a non-stale lock exists, surfacing `LockConflictError`.
- CLI command `phax unlock <short-name>` removes stale locks; `--force` removes any lock.

### Included scope
- Git port + adapter.
- Worktree create/remove with safety checks.
- Run-branch preparation.
- Lock file lifecycle and `phax unlock`.

### Excluded scope
- Calling Claude (phase-05), running gates (phase-08), committing phases (phase-09).

### Validation expectations
On a temp git repo, the worktree adapter creates and removes worktrees, blocks
on dirty trees, and never destroys uncommitted work. Two simultaneous fake
`phax` processes against the same short name produce a `LockConflictError`.
Stale locks (synthetic old `updatedAt`) are reported by `phax unlock`.

### Commit subject
`ai(phase-04): add git worktree, branch safety, and run locks`

### Commit body
Add the Git port and adapter for safe branch/worktree operations, the run-branch and per-phase worktree lifecycle with dirty-state protection, the lock manager under `~/.phax/locks/`, and the `phax unlock` command with stale-lock detection.

### Expected handoff content
- Git port surface and which call goes to which `git` invocation.
- Worktree path convention (`~/.phax/worktrees/<short-name>/phase-NN/`).
- Lock file schema and the `withRunLock` resource pattern that later commands must wrap themselves in.
- Force-flag semantics for removal.

---

## phase-05 — Claude Code CLI backend and session capture  {#phase-05-claude-backend}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

### Objective
Introduce a minimal `Backend` port (§23) and a Claude Code CLI adapter that
runs `claude -p ... --output-format json`, captures `session_id`, persists
JSONL output, and supports `--resume <session_id>` for the fix loop.

### Detailed instructions
- `src/ports/backend.ts`:
  - `runAgent(prompt, options): Effect<AgentRunResult, ClaudeInvocationError>`.
  - `resumeAgentSession(sessionId, prompt, options): Effect<AgentRunResult, ClaudeInvocationError | ClaudeSessionIdMissingError>`.
  - `AgentRunResult` exposes `sessionId`, `outputPath`, and the parsed final text.
- `src/infra/claudeCli.ts`: shell out to `claude` through the Shell port. Stream stdout into `phase-NN/output.jsonl` as it arrives. Parse the final JSON line through a schema in `src/schemas/claudeOutput.ts` and extract `session_id`. Fail with `ClaudeSessionIdMissingError` when absent.
- Persist `phase-NN/claude-session-id.txt` and the parsed session id in `phase-NN/status.json` (using the phase state machine).
- `options` carries `model`, `effort`, `cwd` (the phase worktree path), and an optional `outputJsonlPath`. Do not interpolate prompt content into the command string — pass via stdin or `--input-file`, whichever Claude Code CLI supports today.
- Keep the abstraction thin: no Codex CLI, no SDK adapter (§23 forbids those in MVP).

### Included scope
- Backend port.
- Claude Code CLI adapter.
- JSONL output capture.
- Session id capture and persistence.

### Excluded scope
- Prompt content generation (phase-07).
- Gate execution and fix loop (phase-08).
- `extract-plan` use case (phase-06 builds on this).

### Validation expectations
Against a fake `claude` executable that emits a fixture JSONL stream, the
adapter captures a session id, writes the JSONL to disk, and exposes the final
text. `--resume` retains the same session id in the resumed run's status file.

### Commit subject
`ai(phase-05): invoke claude code cli and capture session ids`

### Commit body
Add the `Backend` port with `runAgent` and `resumeAgentSession`, a Claude Code CLI adapter that streams JSONL output, parses the final structured response, captures the session id, and persists it to the phase status alongside the JSONL log.

### Expected handoff content
- Backend port surface and `AgentRunResult` shape.
- Claude CLI command invocation pattern (flags actually used).
- Where session ids land on disk (`phase-NN/claude-session-id.txt` + `status.json`).
- The typed errors callers must handle.

---

## phase-06 — `extract-plan` from `plan.md` to `phax-plan.json`  {#phase-06-extract-plan}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

### Objective
Implement `phax extract-plan <short-name> --plan-md plan.md --out phax-plan.json` (§8, §27.4). It calls Claude Code headlessly with the `phax-plan.json` JSON Schema, validates the structured output locally, writes `phax-plan.json` atomically, and produces an `extract-report.md`.

### Detailed instructions
- In `src/schemas/phaxPlan.ts` (added in phase-01), expose a JSON Schema export derived from the Effect Schema (`@effect/schema/JSONSchema`).
- In `src/app/extractPlan.ts`:
  1. Decode `plan.md` as text.
  2. Build a prompt that contains `plan.md` plus the JSON Schema and instructs Claude Code to return only structured JSON.
  3. Call the Backend port with a structured-output option (pass the schema through the CLI flag Claude Code exposes for JSON-mode output, falling back to a strict parse-then-validate if needed).
  4. Decode the returned JSON through the same Effect Schema.
  5. Validate that no phase was invented vs. anchors detected in `plan.md` (best-effort heuristic against `## phase-NN` headings).
  6. Write `phax-plan.json` atomically.
  7. Write `extract-report.md` with: phases found, phases extracted, fields per phase, warnings, missing fields, refused assumptions, schema validation result.
  8. Fail loudly if any required field is missing — never guess.
- CLI command `phax extract-plan` in `src/cli/commands/extractPlan.ts` is thin.
- The extractor must refuse to overwrite an existing `phax-plan.json` belonging to an active locked run unless `--force` is provided.

### Included scope
- `extract-plan` use case + CLI command.
- JSON Schema export from Effect Schema.
- `extract-report.md` generation.
- Atomic write + force flag.

### Excluded scope
- Running phases (phase-07+).
- Conductor API integration.

### Validation expectations
Against a fixture `plan.md` and a stubbed backend that returns a known JSON
payload, `extract-plan` writes a schema-valid `phax-plan.json`. A `plan.md`
missing a required commit subject produces a failure with a precise diagnostic
and no output file.

### Commit subject
`ai(phase-06): extract phax-plan.json from plan.md`

### Commit body
Add `phax extract-plan` which calls Claude Code headlessly with the `phax-plan.json` JSON Schema, validates the returned structured output locally, writes the plan atomically, and produces an `extract-report.md` artifact summarising extracted fields and missing data.

### Expected handoff content
- JSON Schema export entry point.
- `extract-plan` CLI usage and behavior on ambiguous plans.
- `extract-report.md` shape.
- Force-flag semantics for overwriting.

---

## phase-07 — Phase prompt generation and output capture  {#phase-07-phase-prompts}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low

### Objective
Generate the per-phase prompt from §15's template, persist it as
`phase-NN/prompt.md`, and inject the previous phase's `phase-handoff.md` when
present.

### Detailed instructions
- `src/app/promptGeneration.ts`:
  - `buildPhasePrompt({ planMd, planJson, currentPhase, previousHandoff? }): string`.
  - Use the template from §15 verbatim, with `{{...}}` placeholders substituted.
  - When `previousHandoff` is `undefined`, replace its section with `"(no previous phase)"`.
- Persist the prompt to `phase-NN/prompt.md` (atomic write).
- A small `src/app/handoffInjection.ts` resolves the previous handoff path from the run folder.

### Included scope
- Prompt template materialization.
- Prompt persistence.
- Handoff lookup from the run folder.

### Excluded scope
- Calling the backend (already in phase-05).
- Running gates (phase-08).
- Producing handoffs (phase-09's post-gate step).

### Validation expectations
Snapshot tests over the rendered prompt for several phase configurations
(first phase, middle phase with handoff, missing handoff).

### Commit subject
`ai(phase-07): generate phase prompts and capture outputs`

### Commit body
Implement the per-phase prompt builder from the spec's template, persist `prompt.md` per phase, and inject the previous phase's `phase-handoff.md` when present.

### Expected handoff content
- Prompt builder signature.
- Where prompts land on disk.
- Handoff resolution rule.

---

## phase-08 — Gates runner and same-session fix loop  {#phase-08-gates-fix-loop}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

### Objective
Execute the gate profile resolved from `phax.json` inside the phase worktree,
log each attempt to `checks-attempt-NN.log`, send failures back to the same
Claude Code session once (§17), and stop the run if gates still fail.

### Detailed instructions
- `src/ports/shell.ts` + `src/infra/shell.ts`: a thin `Shell` port over `@effect/platform/Command` that runs an opaque pre-validated command array with an explicit `cwd`, captures stdout+stderr, and returns an exit code.
- `src/app/gates.ts`:
  - `resolveGateProfile(config, profileId, workspaceId?)` — workspace gates win when specified, otherwise top-level. Reject empty arrays.
  - `runGates(commands, cwd, attemptLogPath): Effect<GateOutcome, GateFailedError>` writes the log atomically.
- `src/app/fixLoop.ts`:
  - On gate failure, build the fix prompt from §17.
  - Call `resumeAgentSession` with the captured `claude_session_id`.
  - Run gates a second time.
  - If still failing, transition the phase to `failed` and stop the run.
- `maxFixAttempts` is read from `phax.json` (default 1).
- The selected gate profile is recorded in `run-status.json` once at start.

### Included scope
- Shell port + adapter.
- Gate profile resolution.
- Gate execution with log capture.
- Fix-loop on the same Claude session.
- Stop semantics on persistent failure.

### Excluded scope
- Commit creation (phase-09).
- Worktree cleanup (phase-09).
- Handoff file generation as a Claude-side artifact (phase-09's deliberate post-gate step per §27.12).

### Validation expectations
With a fake shell adapter, a passing gate set transitions the phase to `passed`
on first run; a failing-then-passing scenario does so after a single
`resumeAgentSession` call; a failing-then-failing scenario produces a
`GateFailedError`, marks the phase `failed`, and the run does not advance.

### Commit subject
`ai(phase-08): run gates and same-session fix loop`

### Commit body
Add the shell adapter, the gate-profile resolution from `phax.json` (workspace-aware), the gate runner with per-attempt log files, and the same-session fix loop bounded by `maxFixAttempts` with explicit stop-on-failure semantics.

### Expected handoff content
- Shell port shape and the no-interpolation rule.
- How `runGates` and the fix loop integrate with phase state transitions.
- Log file naming convention.
- Stop semantics — what happens to worktree/session on failure.

---

## phase-09 — Commit behavior, handoff generation, and non-final cleanup  {#phase-09-commit-and-cleanup}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low

### Objective
After passing gates: (1) resume the Claude session to produce
`phase-handoff.md` deliberately as a post-gate step (§27.12); (2) commit with
the planned message; (3) run cleanup commands and remove the worktree for
non-final phases.

### Detailed instructions
- `src/app/handoffGeneration.ts`: after gates pass, call `resumeAgentSession` with a small handoff prompt that references the `.skills/phax-phase-handoff.md` skill. Verify that `phase-handoff.md` exists in the worktree and contains the required section headings (§27.12). On failure, transition to `handoff_failed`, keep the worktree, and stop.
- `src/app/commit.ts`: build the commit body per §18 (run id, phase id, model, effort, worktree, session id, handoff path, checks, summary). Call `Git.commit` from inside the worktree. Skip the commit when there are no changes; record that in `status.json`.
- `src/app/cleanup.ts`: run `phax.json` `commands.cleanup` inside the worktree, then `git worktree remove`. Refuse to run cleanup on a failed phase or dirty worktree.
- Persist the per-phase `diff.patch` (from `git diff` against the parent commit) into `phase-NN/`.

### Included scope
- Post-gate handoff prompt + validation.
- Commit assembly.
- Per-phase cleanup + worktree removal.
- `diff.patch` artifact.

### Excluded scope
- Final-phase keep-open (phase-10).
- Registry update (phase-11).

### Validation expectations
With fake adapters, a happy-path phase produces a commit, a handoff file, a
diff patch, and removes the worktree. A handoff with missing required sections
transitions to `handoff_failed`. A no-change phase commits nothing and records
that fact.

### Commit subject
`ai(phase-09): commit phases and clean up non-final worktrees`

### Commit body
Add the deliberate post-gate handoff generation step that resumes the phase's Claude session, validates `phase-handoff.md`, commits the phase with the planned message including run/session metadata, persists `diff.patch`, and removes successful non-final worktrees through configured cleanup commands.

### Expected handoff content
- Handoff prompt entry point and the required-sections validator.
- Commit body assembly contract.
- Cleanup safety rules (no cleanup on failure, no removal of dirty trees).

---

## phase-10 — Final review, terminal entry commands, editor, Conductor handoff  {#phase-10-final-review}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

### Objective
Keep the final phase open by default. Provide `phax enter`, `phax shell`,
`phax path`, `phax open` (plus `*-last` variants) and write
`review-handoff.md` per §19.

### Detailed instructions
- `src/app/finalReview.ts` writes `review-handoff.md` with: run id, short name, branch, final phase id/title, worktree path, claude session id, the inspect/resume/shell/open command lines, the Conductor handoff message, completed-phase summary, final gates status, archive instructions.
- `src/ports/editor.ts` + `src/infra/editor.ts`: opens a path with the editor command from `phax.json` (default `zed`).
- CLI commands under `src/cli/commands/`:
  - `enter <short-name>` — calls Claude Code CLI `--resume <session-id>` from the final worktree in an interactive subprocess. `enter-last` resolves the most recent `review_open` run.
  - `shell <short-name>` — spawns `$SHELL` with `cwd` set to the final worktree.
  - `path <short-name>` — prints only the worktree path (script-friendly).
  - `open <short-name>` — invokes the editor adapter.
- Final-phase worktree retention is enforced: cleanup must not run, run state moves to `review_open`.

### Included scope
- `review-handoff.md`.
- Editor port + adapter.
- `enter`/`shell`/`path`/`open` and `-last` variants.
- Final phase retention semantics.

### Excluded scope
- Archive (phase-11).
- Final report (phase-12).

### Validation expectations
Snapshot the `review-handoff.md` output. `phax path` prints exactly one line.
`phax enter` constructs the `claude --resume <id>` invocation with the correct
`cwd`. Editor opens via a fake adapter.

### Commit subject
`ai(phase-10): keep final phase open for review and provide entry commands`

### Commit body
Keep the final phase worktree and Claude session open by default, write `review-handoff.md`, and add `phax enter / shell / path / open` plus the `-last` variants with a default editor of `zed`, including the Conductor branch/worktree handoff text.

### Expected handoff content
- `review-handoff.md` field set.
- Resolution rule for `-last` (most recently updated `review_open` run from registry).
- Editor port contract.

---

## phase-11 — Run listing, registry, and archive  {#phase-11-registry-archive}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

### Objective
Maintain `~/.phax/registry.json` atomically, expose `phax ls` with filters,
and implement `phax archive <short-name>` / `phax archive-last` as the
canonical safe finalization path (§27.11).

### Detailed instructions
- `src/schemas/registry.ts` mirrors §27.6.
- `src/app/registry.ts`: `read`, `upsertRun`, `setRunStatus`. All writes go through `writeAtomic`. Corruption raises `RegistryCorruptionError`.
- Wire registry updates into the existing use cases: on `createRunFolder`, on every run-state transition, on archive.
- `src/cli/commands/ls.ts`: filters `--active`, `--failed`, `--review-open`, `--archived`, `--json`. Default human-readable table columns: short name, status, branch, current phase, gate profile, updated-at, lock state.
- `src/app/archive.ts`:
  1. Refuse when lock is active.
  2. Refuse unless run is `review_open` or `completed`.
  3. Refuse on dirty final worktree unless `--force`.
  4. Move `runs/<short-name>` → `archive/<short-name>`.
  5. Remove the final worktree only if clean.
  6. Set registry entry `status: 'archived'` and `archivePath`.

### Included scope
- Registry schema + atomic ops.
- `phax ls` with filters + JSON output.
- `phax archive` + `phax archive-last`.

### Excluded scope
- Destructive `cleanup` command (§27.11 keeps it out unless explicitly added; not in MVP).
- Resume (phase-12).

### Validation expectations
On a temp `~/.phax`, `ls --json` returns the registry rows; `archive` blocks
on dirty worktree; `archive` succeeds on clean review_open run and leaves
artifacts under `archive/`. Concurrent writes via the atomic helper never
yield half-written JSON.

### Commit subject
`ai(phase-11): list runs, maintain registry, and archive runs safely`

### Commit body
Add the atomic run registry under `~/.phax/registry.json`, the `phax ls` command with status filters and JSON output, and the `phax archive` / `phax archive-last` commands that move run artifacts to `~/.phax/archive` while refusing to delete uncommitted work.

### Expected handoff content
- Registry schema and the entry points that mutate it.
- `phax ls` filter set.
- Archive preconditions and the exact safety refusals.

---

## phase-12 — Final report, resume, and dry-run  {#phase-12-final-report-resume-dry-run}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

### Objective
Produce `final-report.md` at the end of a run, implement `phax resume
<short-name>` with safe-state validation (§27.8), and add `phax run
--dry-run` (§27.14).

### Detailed instructions
- `src/app/finalReport.ts` writes `final-report.md` summarizing phases, gates, commits, durations, session ids, and links to per-phase summaries.
- `src/app/resume.ts`:
  - Read the registry entry.
  - Validate lock state (must not be active by another pid).
  - Inspect current phase status.
  - Verify the worktree still exists and matches the recorded path.
  - Detect uncommitted changes — abort if ambiguous.
  - Print the planned action; require `--yes` to proceed when state is non-trivial.
  - Resume from the next pending phase. Never re-run committed phases.
  - When status is `review_open`, refuse and point the user at `phax enter`.
- `src/app/dryRun.ts`: walks every step `phax run` would perform without side effects — validate configs, resolve workspace/profile, list phases/models/efforts, list setup/gate/cleanup commands, list planned worktree paths, detect lock conflicts.
- Interruption handling: trap `SIGINT`/`SIGTERM` in `src/cli/main.ts`, set run state to `interrupted`, keep worktree + logs + session id.

### Included scope
- `final-report.md`.
- `phax resume`.
- `phax run --dry-run`.
- Interrupt handler.

### Excluded scope
- Forking a failed phase (out of MVP).
- Conductor session-import.

### Validation expectations
Resume on a committed phase advances to the next pending one; on `review_open`
refuses with the entry-command hint; on a missing worktree refuses with a
diagnostic. Dry-run prints the plan with zero side effects.

### Commit subject
`ai(phase-12): add final report, resume, and dry-run`

### Commit body
Write `final-report.md` at the end of each run, add `phax resume` with strict safe-state validation, add `phax run --dry-run` that validates everything without side effects, and add an interruption handler that records the run as `interrupted` while preserving artifacts.

### Expected handoff content
- `final-report.md` shape.
- Resume preconditions and the user-confirmation rule.
- Dry-run scope (what it prints, what it never does).

---

## phase-13 — Vitest setup and tests (unit, integration, type-level)  {#phase-13-tests}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** high

### Objective
Stand up Vitest with the three test categories (§testing-strategy), add
fake/in-memory adapters for every infrastructure port, and cover the domain
state machines, schemas, command-to-use-case mapping, registry/archive flows,
worktree behavior, gate runner, Claude adapter, and final review handoff.

### Detailed instructions
- `vitest.config.ts` with project paths for `tests/unit`, `tests/integration`, `tests/type`.
- Scripts: `test`, `test:unit`, `test:integration`, `test:type` (uses `tsc --noEmit` with type-check fixtures).
- Fake adapters under `src/infra/fakes/`:
  - `FakeFileSystem` (in-memory tree).
  - `FakeGit` (recorded operations).
  - `FakeShell` (script of programmed exits per command match).
  - `FakeBackend` (programmed responses with session id).
  - `FakeEditor` (records open requests).
  - `FakeClock` (frozen time).
- Unit tests for: branded type decoding, plan/config schema acceptance and rejection, state machine transitions (legal + illegal), prompt builder snapshots, error renderer mapping to exit codes, gate profile resolution.
- Integration tests under `tests/integration/`, each in a temp directory:
  - Run-folder creation against `FakeFileSystem`.
  - Registry read/write/archive flow.
  - Worktree lifecycle against `FakeGit` and a small temp real-git repo (opt-in flag for the real-git variant only).
  - Gate runner with `FakeShell` (pass / fail+fix / fail+fail).
  - Claude adapter with a fake `claude` executable streaming a fixture JSONL.
  - `extract-plan` end-to-end with `FakeBackend`.
  - Final review: `review-handoff.md` snapshot.
- Type-level tests under `tests/type/`: branded-type misuse, state-transition illegal-input, schema decoded-vs-unknown.
- Default suite is hermetic — never touches `~/.phax`.

### Included scope
- Vitest configuration and scripts.
- Fake adapters for every port.
- Unit / integration / type test suites covering the surface above.

### Excluded scope
- A separate opt-in e2e suite against real `claude` (mentioned as future).
- CI workflow files (only if trivial; otherwise out of MVP).

### Validation expectations
`pnpm test` is green and deterministic, with no network and no host `~/.phax`
access. `pnpm test:type` catches at least one constructed illegal-state
example.

### Commit subject
`ai(phase-13): set up vitest and cover layers with tests`

### Commit body
Configure Vitest with unit, integration, and type-level projects; add in-memory and recorded fake adapters for every infrastructure port; and cover schemas, state machines, prompt building, gate runner, Claude adapter, registry/archive, worktree lifecycle, and the final review handoff with hermetic tests.

### Expected handoff content
- Where fakes live and how to compose them in new tests.
- Test commands.
- The opt-in path for real-tooling tests (kept disabled).

---

## phase-14 — Oxc architecture audit runner, rules, diagnostics, and skills  {#phase-14-architecture-audit}

**Recommended model:** **claude-opus-4-7**
**Recommended effort:** high

### Objective
Implement the Oxc-based architecture audit runner from §audit so
`pnpm audit:architecture` enforces the doctrine. Ship the nine initial rules
from §initial-architecture-audit-rules, an actionable diagnostic model linked
to skill files in `.skills/`, and an audit report formatter. Opus is used here
because rule design and AST traversal benefit from deeper reasoning.

### Detailed instructions
- `scripts/audit-architecture.ts` is the CLI entry point invoked by the npm
  script. It runs every registered rule, collects diagnostics, prints a
  formatted report, and exits non-zero on any anomaly.
- `src/audit/` houses the engine, independent from the rest of `phax`:
  - `rule.ts` — `ArchitectureRule` type: stable id, title, principle, smell, severity, list of signal extractors, diagnostic builder, linked skill path, allowed/disallowed examples.
  - `diagnostic.ts` — `ArchitectureDiagnostic` answers the six §audit-rules-and-skills-model questions.
  - `report.ts` — `ArchitectureAuditReport` formatter (human + `--json`).
  - `ast/oxcAdapter.ts` — wraps `oxc-parser` (or the closest maintained Oxc package at implementation time) to produce ASTs for `.ts`/`.tsx` files.
  - `ast/tsAdapter.ts` — optional ts-morph fallback used only by rules that need type-level info; rules opt-in.
  - `engine.ts` — file discovery, parser dispatch, rule iteration.
- Rules:
  - `PHAX_BOUNDARY_001` — CLI imports infrastructure adapters → diagnostic.
  - `PHAX_BOUNDARY_002` — Domain imports CLI/app/infra.
  - `PHAX_BOUNDARY_003` — App imports concrete infra (not ports).
  - `PHAX_VALIDATION_001` — External JSON/YAML/config decoded through schema before entering domain (detected via `JSON.parse`/`readFile` callers in non-infra layers).
  - `PHAX_STATE_001` — Run/phase status updates go through explicit transition functions (no direct mutation of state-bearing types outside `domain/state.ts`).
  - `PHAX_EFFECT_001` — Direct FS/shell/git/Claude/editor/clock/`process.env` access only inside `infra/`.
  - `PHAX_CLI_001` — Files under `src/cli/commands/` stay thin (no infra imports, must delegate to `app/`).
  - `PHAX_ANY_001` — `any` and unsafe casts forbidden in `domain/` and `app/`.
  - `PHAX_OUTPUT_001` — No `console.*` or `process.stdout.write` outside `cli/` or the output port adapter.
- Each rule wires to a skill file under `.skills/` (created in phase-15 but referenced here): `boundaries.md`, `validation-boundaries.md`, `state-machines.md`, `effect-services.md`, `cli-view-layer.md`, `infrastructure-adapters.md`.
- The engine includes a Vite-plugin adapter shim (`src/audit/adapters/vite-plugin.ts`) that calls the engine — left as the optional adapter slot for the future, no Vite dep required for MVP.
- The runner must produce diagnostics actionable enough for an agent to fix in
  the same Claude session: include file path, span, rule id, why it violates,
  which skill to consult, and a "kind of correction expected" hint.

### Included scope
- Audit engine and report formatter.
- Oxc parser adapter (default).
- Optional TS-API fallback adapter slot.
- Nine initial rules.
- Skill references.
- `pnpm audit:architecture` script.

### Excluded scope
- A live Vite/Rolldown plugin implementation beyond the adapter slot.
- Auto-fix; rules are diagnostic-only in MVP.
- Speculative rules beyond the nine specified.

### Validation expectations
On a curated fixture tree, each rule fires on at least one positive case and
stays silent on its negative case. The runner returns a non-zero exit code
when any anomaly is found and the formatted output is readable.

### Commit subject
`ai(phase-14): add oxc architecture audit runner, rules, and skills`

### Commit body
Implement the standalone Oxc-based architecture audit engine with the nine initial PHAX rules from the spec, the actionable diagnostic and report models, the `pnpm audit:architecture` entry point, and links to `.skills/` correction guides so failed audits feed back into the same Claude Code session.

### Expected handoff content
- Audit engine module layout.
- Rule registration mechanism for future rules.
- Diagnostic answer-the-six-questions contract.
- Skill files the rules reference (paths phase-15 must produce).

---

## phase-15 — Documentation, example plan, and skill files  {#phase-15-docs}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low

### Objective
Ship `README.md`, an example end-to-end `plan.md` and `phax-plan.json`, the
two planning/handoff skills, and the boundary-rule skill files referenced by
phase-14.

### Detailed instructions
- `README.md`: install, configure `phax.json`, write `plan.md`, `phax extract-plan`, `phax run`, the review loop (`enter`/`shell`/`path`/`open`), archive, exit codes, environment variables, troubleshooting, security notes (no command interpolation).
- `examples/` — a tiny example repo demonstrating a 3-phase run.
- `.skills/phax-planning.md` (§27.3) — instructs planning models to produce a `plan.md` that maps cleanly to `phax-plan.json`.
- `.skills/phax-phase-handoff.md` (§27.12) — instructs the executing model to write a concise, useful `phase-handoff.md`.
- Boundary/rule skills referenced by phase-14:
  - `boundaries.md`, `validation-boundaries.md`, `state-machines.md`,
    `effect-services.md`, `cli-view-layer.md`, `infrastructure-adapters.md`.
- Coverage check: every acceptance criterion in spec §25 maps to at least one
  earlier phase. Add a tiny `docs/acceptance-coverage.md` table.

### Included scope
- README + examples.
- Two planning skills.
- Six rule skills.
- Acceptance coverage table.

### Excluded scope
- Marketing material.
- A docs website (out of MVP).

### Validation expectations
`README` instructions walk a fresh user from install to first archive without
gaps. The example plan runs in dry-run mode without error.

### Commit subject
`ai(phase-15): document phax and ship example plan and skills`

### Commit body
Ship the README, an end-to-end example plan, the planning and phase-handoff skills, and the boundary-rule skill files referenced by the architecture audit, plus an acceptance-criteria coverage table mapping each item in the spec to the phase that delivers it.

### Expected handoff content
- Documentation entry points.
- Skill file locations the planner and audit refer to.
- Acceptance-coverage table location.

---

## Appendix A — Proposed `phax.json` for the `phax` repository itself

```json
{
  "$schema": "https://phax.dev/schema/phax.schema.json",
  "version": 1,
  "project": { "name": "phax", "type": "single-package" },
  "state":   { "root": "~/.phax" },
  "editor":  { "command": "zed" },
  "agent":   { "backend": "claude-code-cli", "maxFixAttempts": 1 },
  "commands": {
    "setup":   ["pnpm install"],
    "cleanup": ["rm -rf node_modules"]
  },
  "gateProfiles": {
    "fast": ["pnpm typecheck", "pnpm test:unit"],
    "full": [
      "pnpm typecheck",
      "pnpm lint",
      "pnpm format:check",
      "pnpm knip",
      "pnpm test",
      "pnpm audit:architecture",
      "pnpm build"
    ]
  }
}
```

## Appendix B — Acceptance-coverage mapping

| Spec §25 item                          | Phase   |
|----------------------------------------|---------|
| 1. plan.md + plan.json + config + name | 01      |
| 2. extract plan via structured output  | 06      |
| 3. validate before starting            | 01, 03  |
| 4. create run folder                   | 03      |
| 5. isolated worktree                   | 04      |
| 6. resolve setup/cleanup/gates         | 01, 08  |
| 7. run setup                           | 08      |
| 8. execute phases in order             | 05, 07  |
| 9. capture artifacts                   | 05, 07, 09 |
| 10. run gates from config              | 08      |
| 11. same-session fix loop              | 08      |
| 12. stop if gates still fail           | 08      |
| 13. commit per phase                   | 09      |
| 14. cleanup non-final worktrees        | 09      |
| 15. keep final phase open              | 10      |
| 16. entry command                      | 10      |
| 17. `phax ls`                          | 11      |
| 18. `phax archive[-last]`              | 11      |
| 19. final report + review handoff      | 10, 12  |
| 20. no silent failure                  | 08, 12  |
| 21. no dirty overwrite                 | 04      |
| 22. no final-worktree deletion         | 10, 11  |
| 23. archive ≠ delete                   | 11      |
| 24. `pnpm audit:architecture`          | 14      |
| 25. actionable diagnostics + skills    | 14, 15  |

## Verification end-to-end

Once all 15 phases are merged, the tool dogfoods on itself:

1. Run `phax extract-plan phax-self --plan-md docs/plans/plan.md --out phax-plan.json` against this file and confirm a valid output.
2. Run `phax run phax-self --plan-md docs/plans/plan.md --plan phax-plan.json --dry-run` and confirm the printed plan matches.
3. On a throwaway branch, run `phax run phax-self ...` and confirm the full loop works against the `fast` gate profile.
4. `pnpm audit:architecture`, `pnpm lint`, `pnpm format:check`, `pnpm knip` are all green on the `phax` source tree itself.
