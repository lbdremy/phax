# Plan — Durable agent error logging + reset-run resumability + MCP allowlist validation

## Overview

A real run (`louloupapers.louloupress-new-features`) failed on phase-01 with the
opaque message `phax run failed: claude exited with code 1`, then became
**unresumable** after `reset-phase` with `"… is in the registry but its files
could not be read."` Root-cause analysis surfaced four distinct defects, three of
which are about phax swallowing the actual reason for a failure.

### The four defects

1. **Agent stderr is never persisted.** When `claude` (or vibe/codex) exits
   non-zero, the adapter captures the child's `stderr` into
   `AgentInvocationError.stderr` (`src/infra/providers/claudeCode.ts:79-87`), but
   nothing writes it to disk. `output.jsonl` only ever receives **stdout**, so a
   startup failure (the process dies before emitting any stream-json) leaves a
   0-byte `output.jsonl` and no record of why. The reason is lost the moment the
   process exits.

2. **The failure reason is collapsed to `.message`.** `describeCause`
   (`src/domain/reducer.ts:20-24`) reduces any `Error` to `error.message`. For
   `AgentInvocationError` that is the bare string `"claude exited with code 1"`.
   `exitCode`, `stderr`, `stderrExcerpt`, and `argv` are all discarded before the
   value reaches `run-status.json`'s `lastError`. The CLI then prints that bare
   string (`src/cli/commands/run.ts:366`). The failing step is clear; the reason
   never is.

3. **Resetting the first/only-started phase makes the whole run unreadable.**
   `reset-phase` archives `phase-01` → `phase-01.reset-<ts>`
   (`src/app/resetPhase.ts:161-162`). `loadRunReviewInfo`
   (`src/app/resolveRunInfo.ts:79`) only scans directories matching
   `/^phase-\d{2}$/`, so after the only live phase folder is archived there are
   zero matches and it hard-fails with `"No phase statuses found"`
   (`resolveRunInfo.ts:91-93`). That propagates up as the
   `unresolvable-qualified` refusal in `resolveRunRef.ts:118-121`. `resume`'s own
   `findNextResumablePhase` is already designed to treat a missing phase folder as
   "not started" (`src/app/resume.ts:48-71`) — it just never gets the chance,
   because `resolveRun` fails first.

4. **`mcp.allow` is mis-handled and the misuse fails opaquely.** With
   `security.mcp.mode === "allowlist"`, the adapter passes each `allow` entry
   verbatim as a `--mcp-config <entry>` flag (`claudeCode.ts:165-169`). The
   Claude CLI treats `--mcp-config` arguments as **file paths**, so a config like
   `"allow": ["nx-mcp", "shadcn"]` (the run that failed) launches
   `claude … --mcp-config nx-mcp --mcp-config shadcn`; Claude cannot read those
   files and exits 1 **before** emitting any output — which is exactly how defect
   #1 manifested. The code comment at `claudeCode.ts:124` already states the
   intended contract (`--mcp-config <path>… one per file`), but `docs/security.md:50`
   documents `mcp.allow` as "Allowed MCP server names/patterns". The contract is
   ambiguous and nothing validates it.

### Decisions locked in

- **`mcp.allow` entries are paths to MCP server config files**, matching the
  adapter's existing `--mcp-config` contract (`claudeCode.ts:124`). This plan does
  **not** add name-based allowlisting (resolving a server name like `nx-mcp` to a
  filtered config). That is a larger feature and is explicitly out of scope; it is
  noted as a possible follow-up. The immediate fix is to **fail loudly at preflight**
  when an `allow` entry does not resolve to a readable file, and to correct the docs.
- **The reset fix lives in `loadRunReviewInfo`, not `reset-phase`.** Making the
  loader tolerate zero live phase folders (reconstructing run-level facts from
  `run-status.json` + the plan) fixes every consumer at once and matches `resume`'s
  existing "missing folder = not started" model. We do **not** change `reset-phase`
  to recreate a fresh `phase-01` folder.
- **The durable error log is `agent-error.log` in the phase folder**, written by
  the infra adapters on any non-zero exit or spawn error. It records the failing
  `argv`, the exit code, and the full captured stderr.
- **`lastError` and the CLI both carry the reason.** `describeCause` is extended to
  format `AgentInvocationError` with its exit code and a stderr excerpt; the CLI
  failure renderer points the user at `agent-error.log`.

## Required commands

- (none)

## phase-01 — Persist agent stderr to a durable error log {#phase-01-agent-error-log}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

When an agent process exits non-zero or fails to spawn, write the full captured
stderr — together with the failing `argv` and exit code — to `agent-error.log` in
the phase folder, so the reason for the failure survives even when `output.jsonl`
is empty. This is the foundation for the rest of the plan: the durable record must
exist before the surfacing layers (phase-02) can point at it.

### Detailed instructions

- Add a shared infra helper `writeAgentErrorLog(phaseFolderPath, { argv, exitCode,
  stderr })` that synchronously (or via the same `node:fs` surface the adapters
  already use) writes a human-readable `agent-error.log` into the phase folder:
  the joined `argv` on the first line, `exit code: <n>` on the next, a blank line,
  then the raw stderr. Tolerate a missing/undefined `phaseFolderPath` (no-op) and
  never throw out of the helper — a logging failure must not mask the underlying
  agent failure.
- Wire the helper into `src/infra/providers/claudeCode.ts` in **both** failure
  paths of `runClaudeAgent`: the `Effect.tryPromise` `catch` (spawn error) and the
  `exitCode !== 0` branch (`claudeCode.ts:339-366`). Use `options.phaseFolderPath`.
  Do **not** write the log on the rate/usage-limit reclassification path — those
  are paused, not failed, and already produce resume instructions.
- Wire the same helper into the non-zero-exit / spawn-error paths of
  `src/infra/providers/codexCli.ts` and `src/infra/providers/mistralVibe.ts` so all
  three providers behave identically. Pass each provider's own `argv` and captured
  stderr.
- Do not change `runClaudeCompletion` — completion calls have no phase folder; the
  enriched error message from phase-02 is sufficient there.

### Planned files to create

- `src/infra/providers/agentErrorLog.ts`
- `tests/unit/agentErrorLog.test.ts`

### Planned files to edit

- `src/infra/providers/claudeCode.ts`
- `src/infra/providers/codexCli.ts`
- `src/infra/providers/mistralVibe.ts`

### Optional files that may be edited

- `src/infra/providers/sessionWriter.ts`

### Boundary contracts

Producer: the infra provider adapters, which alone hold the captured stderr and
the spawn `argv`. Consumer: a human (or phase-02's CLI pointer) reading
`agent-error.log` from the phase folder. The stable shape is a plain-text file at
`<phaseFolder>/agent-error.log`; no other layer parses it, so its format is not a
schema-bound contract.

### Test strategy

Adapter-level behavior, but the log writer is a pure-ish infra helper — unit-test
`writeAgentErrorLog` directly (Adapters → integration normally, but a standalone
fs helper is cheapest as a unit test against a temp dir): assert the file is
created with argv, exit code, and stderr; assert a no-op on undefined
`phaseFolderPath`; assert it never throws when the directory is unwritable. Write
these tests before wiring the helper into the three adapters.

### Implementation order

Helper + its unit test first, then wire the three adapters.

### Excluded scope

- Surfacing the reason in `lastError` or the CLI (phase-02).
- Any change to `output.jsonl` capture.

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact path `src/infra/providers/agentErrorLog.ts` and the
  `writeAgentErrorLog` signature.
- The `agent-error.log` file name and on-disk format, for phase-02 to reference in
  its CLI pointer.
- Any deviation from the planned file lists, with the reason (e.g. if codex/vibe
  failure construction differs enough to need a different wiring point).

### Commit subject

feat(infra): persist agent stderr to agent-error.log on failure

### Commit body

When an agent process exits non-zero or fails to spawn, write the failing argv,
exit code, and full captured stderr to agent-error.log in the phase folder. Until
now stderr was captured into AgentInvocationError but never persisted, so a
startup failure (empty output.jsonl) left no record of the reason. Wired into the
claude, codex, and vibe adapters; covered by a unit test on the shared helper.

## phase-02 — Carry the failure reason into lastError and the CLI {#phase-02-surface-reason}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Stop collapsing agent failures to `"claude exited with code 1"`. Format
`AgentInvocationError` with its exit code and a stderr excerpt wherever the reason
reaches the user — the persisted `lastError` and the CLI failure line — and point
the user at the durable `agent-error.log` from phase-01.

### Detailed instructions

- In `src/domain/reducer.ts`, extend `describeCause` (`reducer.ts:20-24`) to
  special-case `AgentInvocationError` (import it from `src/domain/errors.ts`; same
  layer). Produce a single-line-friendly string of the form
  `claude exited with code <exitCode>: <stderr excerpt>` when an excerpt is
  available, falling back to the current `.message` when it is not. Bound the
  excerpt length (e.g. last ~500 chars of `stderrExcerpt ?? stderr`, trimmed) so
  `lastError` stays readable. Leave the behavior for non-`AgentInvocationError`
  causes unchanged.
- In `src/cli/commands/run.ts` (`run.ts:366`), when the caught error is an
  `AgentInvocationError`, render exit code + stderr excerpt and a final line
  pointing at the phase's `agent-error.log` for the full output. Keep the existing
  generic branch for all other errors.
- Apply the same enriched rendering to the failure branch in
  `src/cli/commands/resume.ts` so a resumed run that fails again reports the reason
  identically. Reuse a single shared formatting helper rather than duplicating the
  excerpt logic between the two commands.

### Planned files to create

- `tests/unit/describeCause.test.ts`

### Planned files to edit

- `src/domain/reducer.ts`
- `src/cli/commands/run.ts`
- `src/cli/commands/resume.ts`

### Optional files that may be edited

- `src/cli/commands/runLayers.ts`

### Boundary contracts

Producer: `AgentInvocationError` (domain), carrying `exitCode`, `stderr`,
`stderrExcerpt`, `argv`. Consumer A: the reducer, turning the cause into the
persisted `lastError` string. Consumer B: the CLI view layer, rendering the same
reason for the terminal. The stable need is "exit code + a bounded stderr excerpt";
the exact string format is not schema-bound and may differ slightly between the
persisted field and the terminal output.

### Test strategy

Domain: unit-test `describeCause` (write first) — an `AgentInvocationError` with a
stderr excerpt yields the enriched string; one without falls back to `.message`; a
plain `Error` and a string cause are unchanged; the excerpt is length-bounded. CLI
rendering is thin view logic verified by the `full` gate's existing CLI coverage;
do not add an e2e here.

### Implementation order

`describeCause` + its unit test first (this is the value that lands in
`lastError`), then the shared CLI formatter, then wire `run` and `resume`.

### Excluded scope

- Writing `agent-error.log` (phase-01).
- Reset/resume resolvability (phase-03).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The new `describeCause` output format for `AgentInvocationError`.
- The name/location of the shared CLI failure-formatting helper and which commands
  consume it.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(errors): surface agent exit code and stderr in lastError and CLI

### Commit body

describeCause now formats AgentInvocationError with its exit code and a bounded
stderr excerpt instead of collapsing to "claude exited with code 1", so
run-status.json's lastError records the actual reason. The run and resume CLI
failure renderers show the same reason and point at agent-error.log. Covered by a
describeCause unit test.

## phase-03 — Make reset runs resumable when no live phase folder remains {#phase-03-reset-resumable}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** high

After `reset-phase` archives the only live phase folder, the run currently becomes
unreadable. Make `loadRunReviewInfo` tolerate zero `phase-\d{2}` directories by
reconstructing the run-level facts from `run-status.json` and the plan, so
`resume` (whose `findNextResumablePhase` already handles a missing folder as
"not started") can pick the run back up.

### Detailed instructions

- In `src/app/resolveRunInfo.ts`, change `loadRunReviewInfo` so that an empty
  `phaseStatuses` (no directory matched `/^phase-\d{2}$/`) is **not** a hard
  failure. Today `resolveRunInfo.ts:91-93` returns `Either.left("No phase statuses
  found …")`; instead, when `phaseStatuses` is empty but `run-status.json` decoded
  successfully, return a valid `RunReviewInfo` with `phaseStatuses: []`.
- Derive the required `finalPhase*` fields from the plan in that case: use the
  **last** plan phase as the run's nominal final phase (`finalPhaseId`,
  `finalPhaseTitle`), and compute `finalPhaseBranch` from `${branch}--${finalPhaseId}`
  via `decodeBranchName` (same as the existing path). Set `worktreePath` to `""`
  and `claudeSessionId`/`commitHash` to undefined — there is no live phase on disk.
- If `run-status.json` itself is missing or invalid, keep failing exactly as today
  (`resolveRunInfo.ts:53-61`). The new tolerance applies **only** to the
  "no live phase folder, but run-status + plan are readable" case.
- Preserve the existing happy path unchanged: when at least one `phase-\d{2}`
  directory exists, behavior, ordering, and the `finalPhaseStatus`-derived fields
  must be identical to today.
- Confirm no other consumer of `RunReviewInfo` assumes a non-empty `phaseStatuses`
  in a way that would break for a freshly reset run. The relevant resumable flow is
  `resume` → `findNextResumablePhase`, which already handles `[]` plus `planPhases`.

### Planned files to create

- `tests/integration/resetResume.test.ts`

### Planned files to edit

- `src/app/resolveRunInfo.ts`

### Optional files that may be edited

- `tests/unit/resolveRunInfo.test.ts`

### Boundary contracts

Producer: `loadRunReviewInfo`, reading the run folder from disk. Consumers:
`resolveRun` / `resolveRunRef` (run lookup), `resume` (next-phase selection), and
review/publish flows. The stable contract is "a readable run-status.json plus a
plan is sufficient to resolve a run, even with no live phase folder"; consumers
that need per-phase status already tolerate an empty `phaseStatuses`.

### Test strategy

Application command with fake/real fs — integration test (write first): build a
run folder containing `run-status.json` (state `interrupted`, `phase_reset`),
`phax-plan.json`, and only a `phase-01.reset-<ts>` directory; assert `resolveRun`
returns `Right` and that `resume`'s next-phase selection yields `phase-01` as
not-started. Add a focused unit assertion that the happy path (one live
`phase-01`) is unchanged.

### Implementation order

Write the failing integration test reproducing the reset → unresumable bug, then
make `loadRunReviewInfo` tolerant.

### Excluded scope

- Changing `reset-phase` to recreate a fresh `phase-01` folder (rejected in the
  overview decisions).
- The MCP allowlist preflight (phase-04).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact reconstruction rule for `finalPhase*` when `phaseStatuses` is empty.
- Confirmation that the happy path is byte-for-byte unchanged.
- Any deviation from the planned file lists, with the reason.

### Commit subject

fix(resolve): keep reset runs resolvable with no live phase folder

### Commit body

loadRunReviewInfo no longer hard-fails when no phase-NN directory exists. After
reset-phase archives the only live phase folder, the run was unreadable
("its files could not be read"); now run-level facts are reconstructed from
run-status.json and the plan so resume can pick the run back up. Covered by an
integration test exercising reset -> resume.

## phase-04 — Validate mcp.allow at preflight and correct the docs {#phase-04-mcp-allowlist-validation}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Turn the opaque `claude exited with code 1` caused by a misconfigured MCP
allowlist into a clear, pre-spawn failure. When `mcp.mode === "allowlist"`, verify
every `allow` entry resolves to a readable file before any agent runs, and fix the
documentation so the path contract is unambiguous.

### Detailed instructions

- Add an MCP allowlist preflight to `executePlan` alongside the existing
  required-commands preflight (`src/app/executePlan.ts:239-257`), running **before**
  any branch/worktree/agent work. When `config.security.mcp.mode === "allowlist"`,
  check each entry in `config.security.mcp.allow` for existence/readability via the
  `FileSystem` port (this is an app-layer side effect routed through the port — do
  not call `node:fs` directly here).
- On any missing/unreadable entry, fail with a clear error (reuse
  `SecurityPreflightError` if its shape fits, otherwise add a sibling tagged error
  in `src/domain/errors.ts`) listing each offending entry and stating that
  `mcp.allow` entries must be paths to MCP server config files. The message must
  name the entries so the user immediately sees that `"nx-mcp"`/`"shadcn"` are not
  files.
- Keep the existing `--mcp-config <path>` flag construction in
  `src/infra/providers/claudeCode.ts:165-169` as-is — it is correct once the inputs
  are validated paths.
- Fix `docs/security.md:50`: change the `mcp.allow` description from "Allowed MCP
  server names/patterns" to state that entries are **paths to MCP server config
  files** passed to the agent via `--mcp-config`. Note in the doc that name-based
  allowlisting is not supported.
- Ensure `exitCodeForError` (`src/cli/commands/runLayers.ts:75-87`) maps the chosen
  preflight error to a sensible non-zero code (reuse the `SecurityEnforcementError`
  / preflight code path if applicable).

### Planned files to create

- `tests/unit/mcpAllowlistPreflight.test.ts`

### Planned files to edit

- `src/app/executePlan.ts`
- `docs/security.md`

### Optional files that may be edited

- `src/domain/errors.ts`
- `src/cli/commands/runLayers.ts`
- `src/cli/commands/run.ts`

### Boundary contracts

Producer: `phax.json` `security.mcp.allow` (decoded config). Consumer: the
`executePlan` preflight, which must confirm each entry is a readable file before
the claude adapter turns it into a `--mcp-config <path>` flag. The stable contract
is "every allowlist entry is a path to an existing readable MCP config file";
violation fails the run at preflight, never at agent spawn.

### Test strategy

Application command with a fake `FileSystem` port — unit test (write first): an
allowlist with a non-existent entry fails preflight with a message naming the
entry; an allowlist whose entries all exist passes; `mode !== "allowlist"` skips
the check entirely. The fake fs lets this run without touching real files.

### Implementation order

Add/confirm the error type, write the failing preflight unit test, implement the
preflight check in `executePlan`, then update the docs.

### Excluded scope

- Name-based allowlisting (resolving a server name like `nx-mcp` to a filtered
  generated `--mcp-config` file). Noted as a possible follow-up; not in this plan.
- Any change to the adapter's flag construction beyond what validated inputs allow.

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The preflight error type used and its message format.
- Confirmation that `mode !== "allowlist"` is a clean skip and that the happy path
  (valid file paths) is unaffected.
- Any deviation from the planned file lists, with the reason.

### Commit subject

fix(security): validate mcp.allow paths at preflight before spawning agents

### Commit body

When security.mcp.mode is "allowlist", phax now verifies every mcp.allow entry
resolves to a readable file during the run preflight, failing with a clear message
that names offending entries instead of letting claude exit 1 opaquely on an
unreadable --mcp-config path. docs/security.md is corrected to state that
mcp.allow entries are paths to MCP server config files, not server names. Covered
by a preflight unit test with a fake filesystem.
