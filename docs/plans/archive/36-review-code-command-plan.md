# Plan 36 — `phax review-code <short-name>` interactive code-review session

## Overview

Add a `phax review-code <short-name>` command that opens an interactive,
pre-prompted AI agent session in the run's final worktree so a developer can
start addressing the compliance deviations and attention points surfaced by a
run, then take over the session by hand.

This is deliberately different from `phax review-compliance`:

| | `review-compliance` | `review-code` (this plan) |
| --- | --- | --- |
| Execution | headless, one-shot `backend.runAgent` | interactive session via the `Session` port (like `phax enter`) |
| Mutations | non-mutating; writes only the two artifacts | developer-driven; the developer may edit code in their own session |
| Output | `compliance-review.{md,json}` | a live terminal session, pre-seeded with a code-review prompt |
| Reuse | re-runs from scratch each time | **reuses the same session** on re-invocation unless `--new-session` is passed |

The pre-prompt is built from the artifacts the run already produced: the
**global file reconciliation** attention points (always present for a
`review_open` run) plus, when present, the **compliance review**
(`compliance-review.json`) attention points, pointers, and per-phase deviation
findings. The compliance review is an *enrichment* input, not a hard
prerequisite — a developer can run `review-code` after only a plain run, and is
told to run `review-compliance` first for a richer seed.

### Session lifecycle

- **First invocation** (no stored session, or `--new-session`): generate a
  session UUID, write the full pre-prompt to `.phax-context/code-review-prompt.md`
  in the worktree, persist a session record to `code-review-session.json` in the
  run folder, and launch the provider's interactive CLI with that fixed session
  id and a short positional prompt pointing the agent at the prompt file.
- **Subsequent invocations** (stored session present, no `--new-session`):
  resume the same session id interactively (no new pre-prompt) so the developer
  continues exactly where they left off.
- **`--new-session`**: ignore and overwrite any stored record, regenerating the
  session and re-seeding the pre-prompt.

### Provider support (why Claude only, for now)

The `SessionAdapter` interface is extended for **all three** providers, but only
Claude Code gets a working pre-prompted interactive start in this plan. This is
not an arbitrary exclusion — it mirrors the repo's existing posture and is forced
by two facts:

1. **No verified interactive invocation exists for codex/mistral.** Even plain
   `phax enter` (a bare resume) returns `unsupported` for both today — see the
   comments in `src/domain/session/codex.ts` and `src/domain/session/mistral.ts`
   ("Until the interactive form is verified against the installed CLI, interactive
   re-entry is unsupported"). The repo deliberately refuses to emit unverified
   interactive invocations.
2. **The deterministic-resume design is Claude-specific.** phax controls the
   session id up front via `claude --session-id <uuid>` so it can reliably
   `--resume <uuid>` later. Codex and vibe do not accept a caller-supplied
   session id — they mint their own, which phax captures *post-hoc* (codex from
   the result event, vibe from `meta.json`). Supporting them needs a different
   id-capture strategy plus CLI-flag verification, which belongs in the
   `e2e:real` tier.

Accordingly, codex/mistral adapters return a precise `unsupported` refusal for
the pre-prompted start (the command surfaces it cleanly), and full codex/mistral
support is a documented follow-up (see Excluded scope in phase-05).

### Why a positional pointer instead of inlining the prompt

The pre-prompt embeds plan/reconciliation/compliance text and can be large.
Passing it as a single positional argv risks length and quoting problems, so the
use case writes the prompt to `.phax-context/code-review-prompt.md` and launches
the agent with a short positional instruction to read that file. The `Session`
port spawns the executable directly (no shell), so argv escaping is not a
concern, but keeping argv short is still the robust choice.

## Required commands

- (none)

This plan introduces no new tool, runtime, package manager, or CLI. All gates
continue to run through the existing `pnpm`-based `full` gate profile in
`phax.json`, and the interactive session reuses the already-allowed provider CLI
(`claude`).

## Architecture notes (read before implementing)

- Layers: `cli → app → domain ← ports ← infra`. All I/O goes through a port; the
  use case reads/writes files via `FileSystem` and the command spawns the
  session via `Session`.
- The `Session` port (`src/ports/session.ts`) exposes
  `resume({ executable, args, cwd }) => Effect<number, SessionError>`. The
  command provides `makeNodeSessionLayer()` from `src/infra/session.ts`, exactly
  as `src/cli/commands/enter.ts` does.
- Session *invocations* are built by the per-provider adapters in
  `src/domain/session/` (`SessionAdapter`), selected via `getSessionAdapter(provider)`.
  The provider for a run is read from the final phase's `agent-binding.json` via
  `readAgentBinding` (`src/app/agentBinding.ts`), as in `enter.ts`.
- UUID generation in the app layer uses `randomUUID` from `node:crypto` directly,
  consistent with existing app-layer usage (`src/app/fixLoop.ts`,
  `src/app/resetPhase.ts`).
- External inputs are decoded through an Effect Schema at the boundary; the new
  persisted `code-review-session.json` gets its own schema with all-required
  fields (no optional-for-back-compat fields).

---

## phase-01 — Code-review session record schema and `review.code` config {#phase-01-schema-config}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low

Add the persisted session-record schema that lets `review-code` find and resume
its own interactive session, and an optional `review.code` config block so a team
can pin the model used to seed a new review session.

### Detailed instructions

- Create `src/schemas/codeReviewSession.ts` with an Effect `Schema.Struct`
  `CodeReviewSessionSchema` and a `decodeCodeReviewSession`
  (`Schema.decodeUnknownEither`, `onExcessProperty: "error"`). Fields (all
  required — no optional-for-back-compat fields, per the project rule):
  - `version: Schema.Literal(1)`
  - `shortName: Schema.NonEmptyString`
  - `runId: Schema.NonEmptyString`
  - `provider`: reuse the same provider literal union used elsewhere
    (`"claude-code" | "codex-cli" | "mistral-vibe"`); mirror the inline union in
    `src/schemas/phaseAgentBinding.ts`.
  - `sessionId: Schema.NonEmptyString`
  - `worktreePath: Schema.NonEmptyString`
  - `createdAt: Schema.NonEmptyString` (ISO timestamp)
  - `updatedAt: Schema.NonEmptyString` (ISO timestamp; refreshed on resume)
  Export the inferred type and an `encodeCodeReviewSession` (`Schema.encodeSync`)
  to match the `phaseAgentBinding.ts` export shape.
- Extend `src/schemas/phaxConfig.ts`:
  - Add `CodeReviewConfigSchema = Schema.Struct({ model: Schema.optional(Schema.NonEmptyString), effort: Schema.optional(EffortLiteral) })`.
    Note this block has **no `enabled` field** — `review-code` is a manual command
    that is always available, unlike `review.compliance`.
  - Add `code: Schema.optional(CodeReviewConfigSchema)` to the `review` struct in
    **both** `PhaxConfigSchema` and `PhaxUserOverlaySchema`.
  - Add `ResolvedCodeReviewConfig { readonly model: string; readonly effort: Effort }`,
    a `DEFAULT_CODE_REVIEW_MODEL = "claude-opus-4-8"` constant, and
    `resolveCodeReviewConfig(raw)` defaulting `model` to the constant and `effort`
    to `"high"`. (Opus 4.8 + `high` is the intended out-of-the-box default for a
    code review; `EffortLiteral` already admits `"high"`.)
  - Add `readonly codeReview: ResolvedCodeReviewConfig` to `ResolvedConfig`.
- Wire `src/app/loadConfig.ts`: import `resolveCodeReviewConfig`, and set
  `codeReview: resolveCodeReviewConfig(config.review?.code)` in the resolved
  config object (next to `complianceReview`).

### Planned files to create

- `src/schemas/codeReviewSession.ts`
- `tests/unit/codeReviewSession.test.ts`

### Planned files to edit

- `src/schemas/phaxConfig.ts`
- `src/app/loadConfig.ts`
- `tests/unit/loadConfig.test.ts`

### Optional files that may be edited

- `tests/unit/phaxConfigJsonSchema.test.ts`
- `tests/unit/phaxUserOverlaySchema.test.ts`

### Boundary contracts

Producer: `src/schemas/codeReviewSession.ts` provides a validated session-record
shape and `resolveCodeReviewConfig` provides resolved config. Consumer: the
phase-04 use case reads/writes the record and reads `config.codeReview`. Stable
shape: the field set above; the resolver always returns a fully-populated
`ResolvedCodeReviewConfig`.

### Test strategy

- Unit-test (write before implementation) `decodeCodeReviewSession`: a fully-valid
  record decodes; a missing required field fails; an unknown key fails.
- Unit-test `resolveCodeReviewConfig`: `undefined` yields `claude-opus-4-8` and
  `"high"` effort; partial input is filled (e.g. `{ effort: "medium" }` keeps the
  default model but overrides effort).
- Extend `tests/unit/loadConfig.test.ts` to assert `codeReview` is present and
  defaulted when no `review.code` block is configured, and honored when it is.
- If the JSON-schema snapshot tests fail because the `review` struct gained a
  `code` property, update those snapshots (optional files).

### Implementation order

Schema and config (domain/schema layer) first, then the `loadConfig.ts` wiring.

### Excluded scope

- The prompt builder, adapter changes, use case, and CLI command (later phases).
- Any `enabled` gating for `review-code`.

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact path `src/schemas/codeReviewSession.ts`, the final field list of
  `CodeReviewSessionSchema`, and the names `decodeCodeReviewSession` /
  `encodeCodeReviewSession`.
- The `ResolvedCodeReviewConfig` shape, `DEFAULT_CODE_REVIEW_MODEL`, the
  `resolveCodeReviewConfig` signature, and the `config.codeReview` access path.
- Whether the JSON-schema snapshot tests were updated, and why if so.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(schemas): add code-review session record and review.code config

### Commit body

Add CodeReviewSessionSchema (persisted record for the review-code interactive
session) and an optional review.code config block resolved into
config.codeReview, so a later phase can locate, resume, and model-pin the
review-code session. Covered by unit tests for decode/resolve and loadConfig
defaulting.

---

## phase-02 — Interactive review invocation in session adapters {#phase-02-session-adapter}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low

Teach the session adapters how to build an interactive invocation for a
review-code session — either starting a new pre-prompted session with a fixed
session id, or resuming an existing review-code session id.

### Detailed instructions

- Extend `src/domain/session/types.ts`: add a method to `SessionAdapter`:
  ```ts
  buildReviewInvocation(opts: {
    readonly worktreePath: string;
    readonly sessionId: string;
    readonly initialPrompt: string | null; // null => resume; string => start new
    readonly model?: string;
    readonly effort?: string;
  }): ResumeInvocation;
  ```
  Reuse the existing `ResumeInvocation` union (`{ executable, args, cwd } | { unsupported }`).
- Implement in `src/domain/session/claude.ts`. In **both** cases, conditionally
  append `--model <model>` and/or `--effort <effort>` when provided — the only
  structural difference between resume and new is `--resume <id>` vs
  `--session-id <id> … <prompt>`:
  - Resume (`initialPrompt === null`): `{ executable: "claude", args: ["--resume", sessionId, ...(model ? ["--model", model] : []), ...(effort ? ["--effort", effort] : [])], cwd: worktreePath }`.
    Passing `--model` on resume lets the developer switch model before entering
    (e.g. `phax review-code foo --model claude-sonnet-4-6`). The use case passes
    `model`/`effort` here **only when the developer explicitly overrode them**;
    otherwise it passes `undefined`, so the resumed session keeps its existing
    model.
  - New (`initialPrompt` is a string): `{ executable: "claude", args: ["--session-id", sessionId, ...(model ? ["--model", model] : []), ...(effort ? ["--effort", effort] : []), initialPrompt], cwd: worktreePath }`.
  This mirrors how the headless path passes `--model`/`--effort` in
  `src/infra/providers/claudeCode.ts` (`buildArgs`, line ~211). The `initialPrompt`
  is the short positional pointer string produced by the phase-04 use case (it
  points the agent at the prompt file), not the full pre-prompt.
- Implement in `src/domain/session/codex.ts` and `src/domain/session/mistral.ts`:
  return `{ unsupported: "<provider> does not support a pre-prompted review-code session yet; run `phax enter <short-name>` instead." }` for the **new** case
  (`initialPrompt` is a string). For the resume case (`initialPrompt === null`),
  delegate to the same logic those adapters already use for `--resume`-style
  resumption if they capture a session id, otherwise return an `unsupported`
  refusal consistent with their existing `buildResumeInvocation`.
- Leave the existing `buildResumeInvocation` and `describe` methods untouched.

### Planned files to create

- (none)

### Planned files to edit

- `src/domain/session/types.ts`
- `src/domain/session/claude.ts`
- `src/domain/session/codex.ts`
- `src/domain/session/mistral.ts`
- `tests/unit/sessionAdapters.test.ts`

### Optional files that may be edited

- (none)

### Boundary contracts

Producer: each `SessionAdapter` now provides `buildReviewInvocation`. Consumer:
the phase-04 use case calls it via `getSessionAdapter(provider)`. Stable shape:
the `ResumeInvocation` union — an `{ executable, args, cwd }` to spawn or an
`{ unsupported }` refusal the use case turns into a clean error.

### Test strategy

- Unit-test (write before implementation) in `tests/unit/sessionAdapters.test.ts`:
  - claude new-session: asserts `--session-id <id>`, the `--model`/`--effort`
    flags when provided, and the positional prompt are present, with
    `cwd === worktreePath`.
  - claude resume without overrides: asserts `["--resume", <id>]` with no
    `--model`/`--effort` and no positional prompt.
  - claude resume with a model override: asserts `--model <model>` follows
    `--resume <id>`.
  - codex/mistral new-session: asserts an `unsupported` refusal is returned.

### Implementation order

Interface in `types.ts`, then the claude implementation, then codex/mistral.

### Excluded scope

- The content of the pre-prompt (phase-03) and the short positional pointer
  (phase-04); this phase only shapes argv.
- Full pre-prompted interactive support for codex/mistral.

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The final `buildReviewInvocation` signature and the exact claude argv for both
  the new and resume cases (including the `--model`/`--effort` flag positions and
  that resume emits them only when an explicit override is passed). Note: `--model`
  and `--effort` are confirmed supported alongside `--resume`.
- The exact `unsupported` message returned by codex/mistral for the new case.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(session): add buildReviewInvocation to session adapters

### Commit body

Add SessionAdapter.buildReviewInvocation so the review-code use case can start a
pre-prompted interactive session (claude --session-id … prompt) or resume an
existing review-code session (claude --resume …). codex/mistral return an
unsupported refusal for the pre-prompted start. Covered by unit tests for the
claude argv and the codex/mistral refusals.

---

## phase-03 — Code-review pre-prompt builder {#phase-03-prompt-builder}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Add the pure function that assembles the full code-review pre-prompt from the
run's attention points and compliance findings, plus the short positional
pointer the agent receives on the command line.

### Detailed instructions

- Create `src/domain/review/codeReviewPrompt.ts` exporting:
  - `CODE_REVIEW_PROMPT_FILENAME = "code-review-prompt.md"`.
  - `buildCodeReviewPrompt(input): string` — the full pre-prompt written to the
    worktree. `input` shape:
    ```ts
    {
      readonly worktreePath: string;
      readonly reconciliationMd: string;          // global-file-reconciliation.md
      readonly attentionPoints: ReadonlyArray<{ path: string; status: string; phaseRef: string }>;
      readonly compliance?: {                      // present only if compliance-review.json was read
        readonly attentionPoints: readonly string[];
        readonly pointers: readonly string[];
        readonly deviationFindings: ReadonlyArray<{ phaseId: string; dimension: string; severity: string; message: string }>;
      };
      readonly complianceMissing: boolean;         // true => suggest running review-compliance first
    }
    ```
  - `buildCodeReviewPositionalPrompt(promptFilePath: string): string` — the short
    instruction passed as argv, e.g. "Read `<promptFilePath>` and begin the code
    review it describes. Do not start until you have read it."
- The full pre-prompt must:
  - Frame the session as an **interactive code review** the developer will take
    over — the agent should investigate, explain findings, and propose/apply fixes
    only with the developer in the loop. It is explicitly NOT a gate.
  - List the **attention points** (from reconciliation) as the primary worklist,
    each with its file path, status, and the phase to consult.
  - When `compliance` is present, add the compliance attention points, the
    pointers ("possible bug at X — confirm via code review"), and the per-phase
    deviation findings as prioritized review targets.
  - When `complianceMissing` is true, add a one-line note suggesting
    `phax review-compliance <short-name>` first for a richer seed.
  - State the worktree path for code inspection.
- Keep this module pure (no I/O, no `Date`/random). The caller supplies all text.

### Planned files to create

- `src/domain/review/codeReviewPrompt.ts`
- `tests/unit/review/codeReviewPrompt.test.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- (none)

### Boundary contracts

Producer: `buildCodeReviewPrompt` / `buildCodeReviewPositionalPrompt`. Consumer:
the phase-04 use case writes the full prompt to a file and passes the positional
prompt to the adapter. Stable shape: the `input` object above and the two string
return values.

### Test strategy

- Unit-test (write before implementation) in
  `tests/unit/review/codeReviewPrompt.test.ts`:
  - With attention points and no compliance: the output lists each attention
    point, includes the worktree path, and includes the "run review-compliance
    first" note.
  - With a compliance block: the output also includes the compliance attention
    points, pointers, and deviation findings, and omits the "run first" note.
  - `buildCodeReviewPositionalPrompt` returns a non-empty instruction containing
    the supplied file path.

### Implementation order

Positional-prompt helper first (trivial), then the full-prompt assembler.

### Excluded scope

- Reading any file, generating the session id, or persisting anything (phase-04).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact `buildCodeReviewPrompt` input shape and the two exported function
  names plus `CODE_REVIEW_PROMPT_FILENAME`.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(review): add code-review pre-prompt builder

### Commit body

Add a pure builder that assembles the review-code pre-prompt from reconciliation
attention points and (optionally) compliance-review findings, plus the short
positional pointer the interactive agent receives on argv. Covered by unit tests
for the with- and without-compliance cases.

---

## phase-04 — `review-code` use case (prepare/resume session) {#phase-04-use-case}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Add the application use case that decides whether to start or resume the
review-code session, reads the seed artifacts, persists the session record and
prompt file, and returns the invocation for the CLI to spawn.

### Detailed instructions

- Create `src/app/reviewCode.ts` exporting `prepareCodeReviewSession(info, config, opts)`:
  - Signature roughly:
    ```ts
    function prepareCodeReviewSession(
      info: RunReviewInfo,
      config: ResolvedCodeReviewConfig,
      opts: {
        readonly newSession: boolean;
        readonly nowIso: string;
        readonly modelOverride?: string;   // explicit --model only; applied on resume
        readonly effortOverride?: string;  // explicit --effort only; applied on resume
      },
    ): Effect.Effect<
      PrepareCodeReviewResult,
      FsError,
      FileSystem | SystemTelemetry
    >;
    ```
    where `PrepareCodeReviewResult` is a tagged result, e.g.
    `{ kind: "ready"; invocation: { executable; args; cwd }; mode: "new" | "resume" }`
    or `{ kind: "unsupported"; message: string }`
    or `{ kind: "refused"; message: string }`.
  - Resolve the final worktree (`info.worktreePath`) and final phase folder
    (`join(info.runPath, info.finalPhaseId)`). Read the provider from
    `readAgentBinding(finalPhaseFolder)` (as `enter.ts` does); on missing binding
    return `refused` with a clear message.
  - Session-record path: `join(info.runPath, "code-review-session.json")`.
  - **Resume path** (record exists, decodes, and `!opts.newSession`): build the
    resume invocation via
    `getSessionAdapter(provider).buildReviewInvocation({ worktreePath, sessionId, initialPrompt: null, model: opts.modelOverride, effort: opts.effortOverride })`.
    Pass only the **explicit** CLI overrides here (never the default-filled
    `config`), so resuming without `--model`/`--effort` keeps the session's existing
    model, and a `--model` switch takes effect before the developer enters. Refresh
    `updatedAt` and rewrite the record (`fs.writeAtomic`). If the adapter returns
    `unsupported`, surface it as `unsupported`.
  - **New path** (no record, undecodable record, or `opts.newSession`):
    1. Generate `sessionId = randomUUID()` (import from `node:crypto`, app-layer,
       as in `src/app/fixLoop.ts`).
    2. Read `global-file-reconciliation.md` from the run folder; derive the
       attention-point list from `info`'s global reconciliation if already
       available, otherwise pass the markdown through. (Prefer reading the
       structured attention points the run already computed; if only the markdown
       is available, pass it as `reconciliationMd` and an empty structured list.)
    3. If `compliance-review.json` exists in the run folder, read and
       `decodeComplianceReview` it; on success populate the `compliance` block of
       the prompt input and set `complianceMissing: false`; otherwise
       `complianceMissing: true`.
    4. Build the full pre-prompt via `buildCodeReviewPrompt(...)`, ensure
       `<worktree>/.phax-context/` exists (`fs.mkdirp`), and
       `fs.writeAtomic` it to `join(worktree, ".phax-context", CODE_REVIEW_PROMPT_FILENAME)`.
    5. Build the positional prompt via `buildCodeReviewPositionalPrompt(promptPath)`.
    6. Build the start invocation via
       `buildReviewInvocation({ worktreePath, sessionId, initialPrompt: positional, model: config.model, effort: config.effort })`.
       `config` here is the **effective** `ResolvedCodeReviewConfig` the command
       passes in — already overlaid with any `--model`/`--effort` CLI overrides
       (see phase-05), so the use case stays oblivious to flag parsing. If
       `unsupported`, return `unsupported` (do not persist a record).
    7. Persist the `code-review-session.json` record (`encodeCodeReviewSession`,
       `fs.writeAtomic`) with `createdAt = updatedAt = opts.nowIso`.
  - Emit `SystemTelemetry` step-started/step-completed and an artifact-generated
    event for the prompt file, mirroring `reviewCompliance.ts`.
- Do not spawn the session here — that is the CLI's job (it owns the `Session`
  layer). This use case only does `FileSystem`/telemetry work and returns the
  invocation.

### Planned files to create

- `src/app/reviewCode.ts`
- `tests/integration/reviewCode.test.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- (none)

### Boundary contracts

Consumer/producer: the use case consumes `RunReviewInfo`,
`ResolvedCodeReviewConfig`, the persisted `code-review-session.json`,
`global-file-reconciliation.md`, and optional `compliance-review.json`; it
produces a `code-review-session.json` record, a `.phax-context/code-review-prompt.md`
file, and a `PrepareCodeReviewResult` invocation for the CLI. It depends on the
`FileSystem` and `SystemTelemetry` ports only — no `Session` dependency.

### Test strategy

- Integration tests (write the core cases before implementation) with the fake
  `FileSystem` and `NoopSystemTelemetryLayer`:
  - New session, no compliance file: generates a session record, writes the
    prompt file, returns `mode: "new"` with claude argv containing `--session-id`
    plus the `--model`/`--effort` taken from the effective config.
  - New session, compliance present: prompt file reflects compliance content
    (assert via the written file), record persisted.
  - Resume (no overrides): with an existing valid record and `newSession: false`,
    returns `mode: "resume"` with `--resume`, no `--model`/`--effort`, and refreshes
    `updatedAt`.
  - Resume with `modelOverride`: argv contains `--model <m>` after `--resume`.
  - `newSession: true` with an existing record: regenerates and overwrites.
  - Unsupported provider for new session: returns `kind: "unsupported"` and does
    not persist a record.
  - Pass a fixed `nowIso` so the assertions are deterministic (no `Date` in the
    use case).

### Implementation order

Resume branch first (smaller), then the new-session branch, then telemetry.

### Excluded scope

- Spawning the session and rendering output (phase-05).
- Capturing/parsing the session's streamed output — the session is interactive
  and the id is fixed up front via `--session-id`, so no stream parsing is needed.

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact `prepareCodeReviewSession` signature (including `modelOverride` /
  `effortOverride` and that they apply only on resume) and the
  `PrepareCodeReviewResult` variants (`ready` / `unsupported` / `refused`) and
  their fields.
- The session-record path, the prompt-file path, and how `nowIso` is injected.
- Whether attention points came from structured `info` data or the reconciliation
  markdown, and the exact accessor used.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(app): add review-code session preparation use case

### Commit body

Add prepareCodeReviewSession, which starts or resumes the review-code interactive
session: it reads the run's reconciliation attention points and optional
compliance findings, writes the pre-prompt and a persisted session record, and
returns the provider invocation for the CLI to spawn. Session id is fixed via a
generated UUID so resume is deterministic. Covered by integration tests over the
new/resume/unsupported branches with fake ports.

---

## phase-05 — `review-code` CLI command, registration, and usage spec {#phase-05-cli-command}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Wire the command surface: parse the args, call the use case, spawn the
interactive session via the `Session` port, register the command, and document
it in the usage spec.

### Detailed instructions

- Create `src/cli/commands/reviewCode.ts` exporting
  `runReviewCode(shortNameArg, opts, out): Promise<number>`, modeled on
  `src/cli/commands/enter.ts` (resolution/spawn) and
  `src/cli/commands/reviewCompliance.ts` (config/layers):
  - `opts: { newSession?: boolean; model?: string; effort?: string; verbose?: boolean }`.
  - Load config (`loadConfig(process.cwd())`); on error, print and return 1.
  - **Validate and overlay model/effort overrides** onto `config.codeReview` to
    form the *effective* `ResolvedCodeReviewConfig`:
    - `effectiveModel = opts.model ?? config.codeReview.model` (any non-empty
      string is accepted; the routing layer validates the model downstream).
    - If `opts.effort` is provided, it must be one of `low | medium | high` (the
      config `EffortLiteral`); otherwise print a clear error naming the allowed
      values and return 1. `effectiveEffort = opts.effort ?? config.codeReview.effort`.
    - Pass the effective `{ model: effectiveModel, effort: effectiveEffort }` to
      the use case as `config` (used when starting a **new** session), and pass the
      **raw** `opts.model` / `opts.effort` through as `modelOverride` /
      `effortOverride` (used when **resuming**). On resume, only an explicitly
      passed `--model`/`--effort` takes effect; without it the resumed session
      keeps its model. `--model`/`--effort` are confirmed supported alongside
      `--resume`.
  - Resolve the run via `resolveRunRef(shortNameArg, config, effectiveStateRoot(config))`;
    print `resolveResult.left.message` and return 1 on failure. Log the qualified
    target when `crossProject`.
  - Require `info.runState === "review_open"`; otherwise print the same
    state-guard error style used by `reviewCompliance.ts` and return 1.
  - Build the layer (`FileSystem` + `SystemTelemetry` for the use case). Run
    `prepareCodeReviewSession(info, effectiveConfig, { newSession: opts.newSession ?? false, nowIso: new Date().toISOString(), modelOverride: opts.model, effortOverride: opts.effort })`.
    Keep `new Date()` in the **command** (cli edge), not the use case.
  - On `kind: "unsupported"` or `kind: "refused"`: print the message and return 1.
  - On `kind: "ready"`: log a short line (e.g. `Starting code review session …`
    or `Resuming code review session …` based on `mode`), then provide
    `makeNodeSessionLayer()` and call `Session.resume(invocation)`; return its
    exit code (matching `enter.ts`).
- Register in `src/cli/program.ts` after the `review-compliance` command:
  ```ts
  program
    .command("review-code")
    .description("Open an interactive, pre-prompted code-review session for a review_open run")
    .argument("<short-name>", "Run short name, e.g. usage-cli")
    .option("--new-session", "Start a fresh review session instead of resuming the existing one")
    .option("--model <model>", "Override the model, including on resume (default: review.code.model, else claude-opus-4-8)")
    .option("--effort <effort>", "Override the effort (low | medium | high), including on resume (default: review.code.effort, else high)")
    .action(async (shortName: string, opts: { newSession?: boolean; model?: string; effort?: string }) => {
      const exitCode = await runReviewCode(shortName, { ...opts, ...globalTraceOpts() }, consoleOutput);
      process.exit(exitCode);
    });
  ```
- Add a matching `cmd "review-code"` block to `phax.usage.kdl` (after
  `review-compliance`), with `help`, a `long_help` describing the interactive,
  resumable, developer-takeover behavior and the side effect (spawns an
  interactive provider CLI; may mutate the worktree since the developer drives
  it), an `example "phax review-code usage-cli"`, the `<short-name>` arg, the
  `--new-session` flag, and the `--model <model>` / `--effort <effort>` flags.
  Note in their help that `--model`/`--effort` apply to both new and resumed
  sessions (on resume they switch model/effort before the developer enters).
- Add a fake `Session` layer at `src/infra/fakes/session.ts` (records the
  invocation and returns a configurable exit code) and export it from
  `src/infra/fakes/index.ts`, for the command integration test.

### Planned files to create

- `src/cli/commands/reviewCode.ts`
- `src/infra/fakes/session.ts`
- `tests/integration/reviewCodeCommand.test.ts`

### Planned files to edit

- `src/cli/program.ts`
- `phax.usage.kdl`
- `src/infra/fakes/index.ts`
- `tests/integration/cliProgram.test.ts`

### Optional files that may be edited

- `README.md`

### Boundary contracts

Consumer (cli) → producer (app): the command calls `prepareCodeReviewSession` and
spawns the returned invocation through the `Session` port. The command contains
no business logic — the new/resume decision, prompt assembly, and persistence all
live in the use case.

### Test strategy

- Integration test `tests/integration/reviewCodeCommand.test.ts` with fake
  `FileSystem` + fake `Session`:
  - A `review_open` run with no prior session: command returns the fake session's
    exit code and the fake `Session` received a claude `--session-id` invocation
    in the worktree.
  - `--model`/`--effort` overrides: the fake `Session` invocation argv contains
    the overridden values, not the config defaults.
  - Invalid `--effort` (e.g. `--effort max`): returns 1 without spawning, with an
    error naming `low | medium | high`.
  - Re-invocation without `--new-session` and no overrides: the fake `Session`
    received a `--resume` invocation with no `--model`/`--effort`.
  - Re-invocation with `--model <m>`: the fake `Session` received `--resume` plus
    `--model <m>` (model switch on resume).
  - A run not in `review_open`: returns 1 without spawning.
- Extend `tests/integration/cliProgram.test.ts` to assert the `review-code`
  command is registered with the `--new-session`, `--model`, and `--effort`
  flags and a `<short-name>` arg.
- The `usage`/spec-lint gate inside the `full` profile validates the new
  `phax.usage.kdl` block; keep the `cmd` shape consistent with the existing
  commands so it passes.

### Implementation order

Command file, then registration in `program.ts`, then `phax.usage.kdl`, then the
fake `Session` and tests.

### Excluded scope

- Pre-prompted interactive start for codex/mistral providers (the adapter returns
  an `unsupported` refusal, which the command reports cleanly). **Follow-up:**
  supporting them requires (a) verifying each CLI's interactive launch + initial
  prompt syntax against the installed binary, and (b) a non-`--session-id`
  id-capture strategy (codex mints its own id in the result event; vibe writes it
  to `meta.json`) so resume can target the right session. Both are `e2e:real`-tier
  concerns, out of scope here.
- An `init`-wizard toggle for `review.code` — the config is optional and works
  without wizard support; add it in a follow-up if desired.
- Auto-running `review-compliance` as part of `review-code` — the compliance
  review remains a separate, explicit command; `review-code` only consumes its
  output when present.

### Verification

- The project's configured `full` gate profile in `phax.json` (includes the
  `usage`/spec-lint and completions checks that read `phax.usage.kdl`).

### Expected handoff content

- The `runReviewCode` signature and `opts` shape (including `model`/`effort`), the
  effort-validation rule, how overrides overlay onto `config.codeReview` for new
  sessions and pass through as explicit overrides on resume, the exit-code
  contract, and the exact `Session` layer it provides.
- The registered command name, description, the `--new-session` / `--model` /
  `--effort` flags, and the `phax.usage.kdl` block added.
- The fake `Session` layer's surface and how the integration test asserts the
  invocation.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(cli): add review-code interactive review session command

### Commit body

Add `phax review-code <short-name>`, which opens an interactive, pre-prompted
code-review session in a review_open run's final worktree, seeded from the run's
attention points and compliance findings. Re-invocation resumes the same session;
--new-session starts fresh. Registers the command, documents it in
phax.usage.kdl, and adds a fake Session layer for the command integration test.
