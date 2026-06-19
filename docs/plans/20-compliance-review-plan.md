# Plan — Plan-compliance review at end of run

## Context and rationale

When a phax run reaches `review_open`, the final phase worktree is kept open and the
agent-binding status is patched to `awaiting_manual_review` (`src/app/executePlan.ts:806`).
Today the human reviewer does the next step by hand: they open a fresh agent session,
usually at the same "brain" level used to author the plan, and ask it to judge whether what
was actually built matches `plan.md` — leaning on `global-file-reconciliation.json` to see
what changed beyond the plan, and asking for a justification of every unplanned change.

This plan turns that manual habit into a first-class, **opt-in** feature: a non-mutating
**plan-compliance review** that an agent performs against the kept-open final worktree. It
does not fix anything — it reads the plan, the global reconciliation, and the actual code,
then writes two verdict artifacts (`compliance-review.md` + `compliance-review.json`). The
design mirrors the existing publish/PR subsystem exactly, which already has the two-trigger
shape we want:

- a use case (`publishRun`) invoked **automatically** at end of run when `publish.enabled`
  (`src/app/executePlan.ts:837`), **and** the same use case exposed as a manual command
  `phax publish-pr` (`src/cli/commands/publishPr.ts`).

The compliance review follows the same mould: one `reviewCompliance` use case, auto-fired
after `FinalReviewOpened` **before** `publishRun` (so the verdict lands in the PR body), and
also runnable on demand via `phax review-compliance <short-name>` against the worktree that
`review_open` keeps live.

Three decisions are settled and drive the schema and wiring:

1. **Dedicated model.** The reviewer model/effort is its own config (`review.compliance.model`
   / `effort`), independent of `agent.extractPlan`.
2. **Opt-in.** `review.compliance.enabled` defaults to `false`, exactly like `publish.enabled`.
3. **Advisory only (v1).** The review always produces its artifact and never fails the run.
   No `warn`/`block` modes in this plan.

Two structural guarantees come from the design, not from prompt wording:

- **Independent reviewer.** The review runs in a **fresh agent session** (a fresh
  `Backend.runAgent` invocation), never a resume of the execution session — so it cannot
  self-justify decisions it "remembers" making.
- **Read-only on source.** The review runs under a dedicated security policy whose only
  writable path is the worktree's gitignored `.phax-context/` directory — **not** the worktree
  root and **not** any tracked source. The agent writes its verdict artifacts there (the same
  place phase agents already write `phase-handoff.md`, see `promptGeneration.ts:39`), and phax
  (the unsandboxed parent) harvests them into the run folder afterward. The agent therefore
  *cannot* edit tracked source even if asked, and writing to `.phax-context/` produces no git
  diff. This matches phax's sandbox model, which deliberately never grants the agent write
  access to the `~/.phax` state root (`resolvePolicy.ts:38-46`).

### Content shape (settled)

The review judges **fidelity to the plan**, not code quality — it is deliberately *not* a
code review (`/code-review` is the dedicated quality lens) and *not* a gate. Decisions that
fix the content:

- **Per-phase + roll-up.** The plan is structured per phase, so findings are produced per
  phase (the agent inspects each phase's commit) and rolled up into one run-level verdict.
- **Dual artifact.** The agent authors `compliance-review.md` (human prose) **and**
  `compliance-review.json` (machine-readable verdict + findings), decoded by phax through an
  Effect Schema at the boundary. The structured form unlocks `phax report` and a future
  `warn`/`block` mode.
- **Three-level verdict.** Run- and phase-level: `conformant` |
  `conformant-with-deviations` | `divergent` (plus `unknown` when the structured verdict is
  absent or undecodable). Findings carry a severity: `info` | `deviation` | `concern`. v1 is
  advisory — no verdict ever fails the run.
- **Conformance-only, with a pointer valve.** The review judges only plan-vs-execution. If
  the agent incidentally spots something broken while reading code, it records it as a
  *pointer* under attention points ("possible bug at X — confirm via code review") **without
  judging it** and outside the verdict, so the signal is not lost but the focus stays clean.

## Required commands

- (none)

This plan introduces no new external tool, runtime, or CLI. The compliance review reuses the
existing `Backend` agent invocation, `FileSystem`, and `SystemTelemetry` ports, and is
verified through the existing `pnpm`-based gate profiles already in `phax.json`. (The PR-body
surfacing in phase-04 also touches the existing `Git`/`GitHub` path inside `publishRun`.)

## Phases

1. `phase-01` — Config: `review.compliance` schema, resolution, and JSON-schema export.
2. `phase-02` — Domain: compliance prompt builder and read-only review security policy.
3. `phase-03` — App: `reviewCompliance` use case and the `compliance-review.json` verdict schema.
4. `phase-04` — Wire the auto-trigger into `executePlan` and surface the verdict in the PR body.
5. `phase-05` — `phax review-compliance <short-name>` CLI command.

---

## phase-01 — Compliance review config and schema export {#phase-01-config}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low

Add the `review.compliance` configuration block to the phax config contract, with a resolver
that applies defaults, and surface it in the exported JSON Schema. This is the foundation the
later phases read from; it ships no behavior on its own.

### Detailed instructions

- In `src/schemas/phaxConfig.ts`, add a `ComplianceReviewConfigSchema` struct mirroring the
  shape and optionality conventions of `ExtractPlanConfigSchema`:
  - `enabled: Schema.Boolean`
  - `model: Schema.optional(Schema.NonEmptyString)`
  - `effort: Schema.optional(EffortLiteral)` (reuse the existing `EffortLiteral` =
    `low | medium | high`).
- Add a top-level optional `review` struct to `PhaxConfigSchema` (parallel to `publish`):
  `review: Schema.optional(Schema.Struct({ compliance: Schema.optional(ComplianceReviewConfigSchema) }))`.
  Keep `onExcessProperty: "error"` working — the decoder is `decodePhaxConfig` and must reject
  unknown keys, so do not loosen it.
- Add `ResolvedComplianceReviewConfig` (fields: `enabled: boolean`, `model: string`,
  `effort: Effort`) and a `resolveComplianceReviewConfig(raw)` function following the
  `resolvePublishConfig` pattern. Defaults: `enabled: false`, `model: "claude-sonnet-4-6"`,
  `effort: "medium"`. The model default is intentionally a capable reasoning model, not the
  cheap extract-plan default — this reviewer is the "planning brain".
- Extend `ResolvedConfig` with `readonly complianceReview: ResolvedComplianceReviewConfig` and
  populate it wherever `publish` is resolved into `ResolvedConfig` (find the resolver in
  `src/app/loadConfig.ts`).
- Regenerate the committed JSON Schema: the `review.compliance` block must appear in
  `phax.schema.json`. It is produced from `getPhaxConfigJsonSchema()`; regenerate via the
  `phax schema` regeneration path (`src/cli/commands/schema.ts`) rather than hand-editing.

### Planned files to create

- `tests/unit/schemas/complianceReviewConfig.test.ts`

### Planned files to edit

- `src/schemas/phaxConfig.ts`
- `src/app/loadConfig.ts`
- `phax.schema.json`

### Optional files that may be edited

- `tests/unit/loadConfig.test.ts`
- `tests/unit/schemas/phaxConfigJsonSchema.test.ts`

### Boundary contracts

Producer: `src/schemas/phaxConfig.ts` exposes `ResolvedComplianceReviewConfig` and
`resolveComplianceReviewConfig`. Consumers (phase-03 use case, phase-04 wiring, phase-05 CLI)
need a resolved, default-applied config off `ResolvedConfig.complianceReview`. The stable
shape is `{ enabled, model, effort }` — adaptable on field naming, strict that resolution
applies defaults so consumers never see `undefined`.

### Test strategy

Schema/domain layer → unit tests, written before implementation:

- `enabled` decodes; defaults fill in `model`/`effort` when omitted.
- An unknown key under `review.compliance` is rejected by `decodePhaxConfig`.
- An invalid `effort` (e.g. `"xhigh"`, outside the `low|medium|high` literal) is rejected.
- `getPhaxConfigJsonSchema()` includes the `review.compliance` properties.

### Implementation order

Schema struct → resolver + `ResolvedConfig` field → `loadConfig` wiring → JSON-schema regen.

### Excluded scope

- Any use of the config (prompt, policy, invocation, CLI) — later phases.
- `warn`/`block` severity modes — out of scope for v1 (advisory only).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact resolver name and signature `resolveComplianceReviewConfig(raw)` and the
  `ResolvedConfig.complianceReview` field name.
- The resolved defaults (`enabled: false`, `model`, `effort`).
- Confirmation `phax.schema.json` was regenerated (not hand-edited) and any deviation from the
  planned file lists with the reason.

### Commit subject

feat(config): add opt-in review.compliance configuration block

### Commit body

Add review.compliance { enabled, model?, effort? } to the phax config schema, a
resolveComplianceReviewConfig resolver with advisory-friendly defaults (disabled,
claude-sonnet-4-6, medium), a ResolvedConfig.complianceReview field, and the regenerated
phax.schema.json. No behavior yet — this is the contract later phases consume.

---

## phase-02 — Compliance prompt builder and read-only review policy {#phase-02-domain}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Add the pure domain pieces the use case needs: a deterministic prompt builder that frames the
review against the plan and the global reconciliation, and a security-policy builder that
makes the worktree readable with only its gitignored `.phax-context/` writable (tracked source
is never writable).

### Detailed instructions

- Create `src/domain/review/compliancePrompt.ts` exporting `buildCompliancePrompt(input)`:
  - Input: `{ planMd: string; reconciliationMd: string; phases: ReadonlyArray<{ id: string;
    title: string }>; worktreePath: string; mdArtifactPath: string; jsonArtifactPath: string }`.
  - **Trust the reconciliation.** Instruct the agent to treat the supplied global
    reconciliation as the authoritative file-level fact source (planned vs
    unplanned/missing/extra-touched) and **not** recompute diffs — it spends its reasoning on
    the *semantic* judgments below, not on re-deriving what changed.
  - **Per-phase + roll-up.** For each phase, judge conformance against that phase's plan
    section across these dimensions: objective delivered? `Excluded scope` respected (no scope
    creep)? planned-file deviations **justified** (cross-check the phase's `phase-handoff.md`
    explanation)? promised tests from `Test strategy` present at the named layer? declared
    `Boundary contracts` respected? actual commit vs planned `commit.subject/body`? Then roll
    up into one run-level verdict.
  - **Conformance only, with a pointer valve.** Judge only plan-vs-execution — never code
    quality or correctness. If the agent incidentally notices something broken while reading
    code, it records it as a *pointer* under attention points ("possible bug at X — confirm via
    code review") **without judging it and outside the verdict**.
  - **No edits.** Its only writes are the two artifacts at the provided absolute paths, which
    lie under the worktree's gitignored `.phax-context/`. It must not touch tracked source.
  - **Dual artifact.** The agent must write both: (1) `compliance-review.md` — human prose in
    the agreed structure (Verdict → per-phase findings → unplanned ledger → unmet-promise
    ledger → attention points); (2) `compliance-review.json` — machine-readable, matching the
    phase-03 schema: run-level `verdict`, `summary`, `perPhase[]` (each `{ phaseId, verdict,
    findings[] }` with `findings` = `{ dimension, severity, message }`), `attentionPoints[]`,
    and `pointers[]` (the conformance-out-of-scope signals). Verdict enum: `conformant |
    conformant-with-deviations | divergent`; severity enum: `info | deviation | concern`;
    dimension enum: `objective | excluded-scope | files | tests | boundaries | commit |
    handoff`. The prompt embeds the exact JSON shape so the agent emits a decodable file.
  - Embed `planMd` and `reconciliationMd` inline; reference the worktree path for code
    inspection. Keep the output a single deterministic string (no I/O in this module).
  - Export `COMPLIANCE_REVIEW_MD_FILENAME = "compliance-review.md"` and
    `COMPLIANCE_REVIEW_JSON_FILENAME = "compliance-review.json"` constants. Reference both in
    `compliancePrompt.test.ts` (assert the prompt names them) so they are not flagged as unused
    exports by `knip` in this phase's commit — they are first consumed by phase-03.
- Create `src/domain/security/resolveReviewPolicy.ts` exporting `resolveReviewSecurityPolicy`:
  - Build a `SecurityPolicy` (see `src/domain/security/types.ts`) for a **read-only review**.
  - Mirror `resolveSecurityPolicy` (`src/domain/security/resolvePolicy.ts:14`, input
    `{ mode, worktreePath, config }`) but invert the write grant: `allowRead` includes the
    worktree (so the agent can inspect code) plus `config.filesystem.allowRead`; `allowWrite`
    is **only** `join(worktreePath, ".phax-context")` — the gitignored metadata dir — **not**
    the worktree root. That is the structural read-only-on-source guarantee.
  - Accept input `{ mode, worktreePath, config }` (`config: ResolvedSecurityConfig`); set
    `mode` to the run's `securityMode`, `network.profile: "provider-only"`,
    `mcp.mode: "disabled"`, `failClosed: true`.
  - `agentCommands`: allow read-only git inspection the reviewer needs (e.g. `git`), plus any
    commands required to read the diff; do not add build/test/write commands. Note the
    **read-only guarantee is the filesystem jail** (`allowWrite` excludes tracked source), not
    the command allowlist — even if a broad `git` token would permit `git commit`, the FS jail
    blocks any write outside `.phax-context/`. Do not rely on command precision for it.

### Planned files to create

- `src/domain/review/compliancePrompt.ts`
- `src/domain/security/resolveReviewPolicy.ts`
- `tests/unit/review/compliancePrompt.test.ts`
- `tests/unit/security/resolveReviewPolicy.test.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- `src/domain/security/types.ts`

### Boundary contracts

Producer: `buildCompliancePrompt` and `resolveReviewSecurityPolicy` are pure functions
consumed by the phase-03 use case. The prompt's stable contract is "plan + reconciliation +
phase list in, single review-instruction string out, naming the two absolute artifact paths
and embedding the exact `compliance-review.json` shape". The policy's stable contract is
"worktree readable, only `.phax-context/` writable, tracked source never writable".

### Test strategy

Domain layer → unit tests, written before implementation:

- `buildCompliancePrompt` includes the plan text, the reconciliation text, both absolute
  artifact paths, a per-phase instruction over every supplied phase, the embedded
  `compliance-review.json` shape (verdict/severity/dimension enums), and an explicit no-edit /
  conformance-only instruction.
- `resolveReviewSecurityPolicy` produces `allowWrite` containing **only**
  `<worktreePath>/.phax-context` (not the worktree root), `allowRead` containing the worktree;
  `failClosed` is `true`.

### Implementation order

Prompt builder (with filename constant) → review policy builder.

### Excluded scope

- Invoking the agent or reading/writing files — phase-03.
- Changing the existing `resolveSecurityPolicy` used by phase execution.

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact module paths and exported names (`buildCompliancePrompt`,
  `COMPLIANCE_REVIEW_MD_FILENAME`, `COMPLIANCE_REVIEW_JSON_FILENAME`,
  `resolveReviewSecurityPolicy`) and their input shapes.
- The `resolveReviewSecurityPolicy` input shape `{ mode, worktreePath, config }` and that
  `allowWrite` is only `<worktreePath>/.phax-context` (read-only on tracked source).
- Any deviation from the planned file lists with the reason (note if `types.ts` was touched).

### Commit subject

feat(review): add compliance prompt builder and read-only review policy

### Commit body

Add pure-domain buildCompliancePrompt (plan + global reconciliation + phase list framed into a
non-mutating, conformance-only, per-phase review instruction naming both artifact paths and
embedding the compliance-review.json shape) and resolveReviewSecurityPolicy (worktree readable,
only .phax-context writable, fail-closed). Covered by unit tests. No I/O and no callers yet.

---

## phase-03 — `reviewCompliance` use case {#phase-03-use-case}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** high

Add the application use case that runs the review: it builds the prompt and read-only policy,
invokes a fresh agent session in the final worktree, harvests the agent's `.phax-context/`
outputs into the run folder, and **decodes the agent-authored `compliance-review.json` verdict
through an Effect Schema** at the boundary so callers get a typed verdict. This is the
structural analogue of `publishRun` (`src/app/publishRun.ts`): the verdict *content* is authored
by the agent, while phax (the parent) writes the durable run-folder copies and validates them.

### Detailed instructions

- Create `src/schemas/complianceReview.ts` defining the **agent-authored verdict** schema and
  its decoder (this is a validation boundary — agent output is external input):
  - `VerdictSchema = Schema.Literal("conformant", "conformant-with-deviations", "divergent")`.
  - `SeveritySchema = Schema.Literal("info", "deviation", "concern")`.
  - `DimensionSchema = Schema.Literal("objective", "excluded-scope", "files", "tests",
    "boundaries", "commit", "handoff")`.
  - `FindingSchema = { dimension, severity, message }`.
  - `PhaseVerdictSchema = { phaseId, verdict, findings: Finding[] }`.
  - `ComplianceReviewSchema = { version: 1, verdict, summary, perPhase: PhaseVerdict[],
    attentionPoints: string[], pointers: string[] }` (`pointers` = the conformance-out-of-scope
    bug pointers from the valve).
  - Export `decodeComplianceReview` (a `Schema.decodeUnknownEither`, `onExcessProperty: "error"`)
    and the `ComplianceReview` type. No `encode` codec is needed — phax never *authors* the
    verdict (the agent does); it copies the agent's bytes into the run folder and *decodes* the
    json to surface a typed verdict.
- Create `src/app/reviewCompliance.ts` exporting
  `reviewCompliance(info, config, resolution, security, opts)`:
  - Params: `info: RunReviewInfo`, `config: ResolvedComplianceReviewConfig`,
    `resolution`: the already-resolved model/provider (resolved by the caller via
    `resolveModel`, the same way `executePlan` resolves phase models),
    `security: { mode: SecurityMode; config: ResolvedSecurityConfig }` (needed to build the
    review policy — the use case does not own routing or security resolution), and
    `opts: { verbose? }`. The use case does no git operations and writes no timestamped record,
    so it needs neither `repoRoot` nor a `now` clock.
  - Early return `{ kind: "disabled" }` when `!config.enabled`, exactly like `publishRun`'s
    disabled branch.
  - Read `global-file-reconciliation.md` from `info.runPath` via `FileSystem`. If absent,
    return a `failed` result with a clear reason (the review needs the reconciliation map).
  - Read `plan.md` from the run folder at `join(info.runPath, "plan.md")` via `FileSystem`
    (it is persisted there by `createRunFolder`, `src/app/runFolder.ts:38`, and read the same
    way by `resume.ts:89`). If absent, return `failed` with a clear reason.
  - The agent writes into the worktree's gitignored `.phax-context/`. Compute the agent-side
    paths `agentMd = join(info.worktreePath, ".phax-context", COMPLIANCE_REVIEW_MD_FILENAME)`
    and `agentJson = join(info.worktreePath, ".phax-context", COMPLIANCE_REVIEW_JSON_FILENAME)`,
    pass them to `buildCompliancePrompt` (with `info.planPhases` as the phase list), and ensure
    `<worktreePath>/.phax-context` exists before invoking (the parent may `mkdir` it; phase runs
    already create it). The agent never reads `runPath` — the plan and reconciliation are
    embedded in the prompt by phax.
  - Build the policy with `resolveReviewSecurityPolicy({ mode: security.mode, worktreePath:
    info.worktreePath, config: security.config })`.
  - Invoke the agent with `Backend.runAgent(prompt, options)` (`src/ports/backend.ts:50`),
    a **fresh** invocation (no `sessionId` resume), `cwd: info.worktreePath`,
    `security: <review policy>`, `outputJsonlPath: join(info.runPath,
    "compliance-review.session.jsonl")` (written by the unsandboxed parent, not the agent).
    Use the caller-resolved `resolution.selected` provider/model.
  - **Harvest + artifact handling (advisory-robust):** after the agent returns, phax (the
    unsandboxed parent) reads the agent's outputs from `.phax-context/` and writes the durable
    copies into `runPath` via `fs.writeAtomic` (`compliance-review.md` + `.json`), mirroring how
    other run artifacts land in the run folder. `compliance-review.md` is the primary
    deliverable:
    - agent `.phax-context/compliance-review.md` missing ⇒ `failed` (nothing a human can read).
    - md present, `.phax-context/compliance-review.json` present and decodes via
      `decodeComplianceReview` ⇒ `generated`, durable copies written, parsed `verdict` +
      `perPhase` carried on the result.
    - md present but json missing or undecodable ⇒ still `generated` (durable md written), but
      `verdict: "unknown"` and `structuredVerdictMissing: true` on the result. Record a warning
      via telemetry; do not hard-fail. *(Rationale: v1 is advisory; a flaky structured emit must
      not discard a good prose review. Tighten to hard-fail later if warranted.)*
  - Emit `makeStepStarted/Completed` + `makeArtifactGenerated` telemetry events
    (`src/domain/telemetry/events.ts`) following `publishRun`'s usage. **Do not** add the
    verdict to the telemetry event in v1: `StepCompletedTelemetryEvent` has a fixed field set
    (`events.ts:144`) and extending it is an `observability`-skill change out of scope here —
    the verdict is durably captured in `compliance-review.json`.
  - Return `ComplianceReviewResult { kind: "disabled" | "generated" | "failed"; verdict?:
    Verdict | "unknown"; review?: ComplianceReview; structuredVerdictMissing?: boolean;
    mdArtifactPath?; failureReason? }`.
- The use case must be **non-fatal by contract**: catch the entire `Backend.runAgent` error
  union (`AgentInvocationError | RateLimitError | UsageLimitError | SecurityEnforcementError |
  FsError`, `src/ports/backend.ts:55`) plus any file-read error and map them to a `failed`
  result with a reason — never let them throw as a defect. The Effect error channel of
  `reviewCompliance` may surface `FsError` from the durable run-folder writes/harvest reads, so
  phase-04's auto-trigger keeps its `catchAll`; the phase-05 CLI maps any residual error to a
  non-zero exit. Agent-invocation failures are mapped to the `failed` result, never thrown.

### Planned files to create

- `src/app/reviewCompliance.ts`
- `src/schemas/complianceReview.ts`
- `tests/integration/reviewCompliance.test.ts`
- `tests/unit/schemas/complianceReview.test.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- (none)

### Boundary contracts

Consumer→producer across the app/port edge: `reviewCompliance` needs a side-effecting agent
run, file reads (plan, reconciliation, the agent's `.phax-context/` outputs), file writes (the
durable run-folder copies), and telemetry — all via the `Backend`, `FileSystem`, and
`SystemTelemetry` ports (no direct fs/shell calls). It needs a resolved model and a resolved
security config from the caller (it owns neither routing nor security resolution). The
agent→phax artifact edge is a **validation boundary**: the harvested
`compliance-review.json` is decoded through `decodeComplianceReview` before its verdict enters
the result. The stable result shape is the `ComplianceReviewResult` union; callers distinguish
`disabled` / `generated` / `failed` and read `verdict` without inspecting internals.

### Test strategy

Application command → integration tests with fake ports (a fake `Backend` whose behavior is
parameterized to write the artifacts, a fake/temp `FileSystem`, a noop `SystemTelemetry`),
written before implementation:

- `disabled` config short-circuits with no agent invocation.
- Happy path: reconciliation present, the fake `Backend` writes valid `compliance-review.md` +
  `compliance-review.json` into `<worktree>/.phax-context/` ⇒ `generated`, durable copies
  written into `runPath`, parsed `verdict` carried on the result, agent invoked **fresh** (no
  resume session id).
- Missing `global-file-reconciliation.md` ⇒ `failed` with a reason, no throw.
- `Backend` writes no md in `.phax-context/` ⇒ `failed`, no throw.
- md present but json missing ⇒ `generated`, `verdict: "unknown"`, `structuredVerdictMissing`.
- md present but json undecodable (bad enum / excess key) ⇒ `generated`, `verdict: "unknown"`,
  `structuredVerdictMissing` (the decode failure is swallowed, not thrown).
- Also (schema unit test): `decodeComplianceReview` accepts a well-formed verdict and rejects
  an invalid `severity`/`dimension`/`verdict` literal and unknown keys.

### Implementation order

Verdict schema + decoder → use case skeleton with disabled/failed branches → prompt+policy
assembly → fresh agent invocation → harvest `.phax-context/` artifacts + durable run-folder
writes + json decode (with the unknown-verdict fallback) → telemetry.

### Excluded scope

- Auto-triggering from `executePlan` and PR-body surfacing — phase-04.
- The CLI command — phase-05.
- Model resolution itself (the caller passes a resolved model).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact signature of `reviewCompliance`, the `ComplianceReviewResult` union variants
  (including `verdict` and `structuredVerdictMissing`), and the `ComplianceReview` verdict
  schema field set.
- The artifact flow: the agent authors `compliance-review.md`/`.json` into
  `<worktree>/.phax-context/`; phax harvests them into `runPath` and *decodes* the json via
  `decodeComplianceReview` (phax does not author the verdict, only copies + validates it).
- The unknown-verdict fallback semantics (md present + json missing/undecodable ⇒ still
  `generated`).
- That the agent invocation is a fresh session under the read-only review policy.
- Any deviation from the planned file lists with the reason.

### Commit subject

feat(review): add reviewCompliance use case and compliance-review verdict schema

### Commit body

Add reviewCompliance, mirroring publishRun: it reads the plan and global reconciliation, runs a
fresh read-only agent session in the final worktree to author compliance-review.md +
compliance-review.json, then decodes the agent-authored verdict through decodeComplianceReview
at the boundary and carries it on the result. The md is the primary deliverable; a missing or
undecodable json yields a generated result with verdict "unknown" rather than a failure (v1 is
advisory). Failures are returned, never thrown. Covered by integration and schema tests.

---

## phase-04 — Auto-trigger in executePlan and PR-body surfacing {#phase-04-wiring}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Fire the compliance review automatically at the end of a run when enabled — ordered **before**
publishing so the verdict can be carried into the PR — and include the verdict in the PR body
when both are produced.

### Detailed instructions

- In `src/app/executePlan.ts`, in the `isFinal` block after `FinalReviewOpened` is dispatched
  and the agent-binding status is patched to `awaiting_manual_review`
  (`src/app/executePlan.ts:822-832`), and **before** the existing `if (config.publish?.enabled)`
  publish block (`src/app/executePlan.ts:837`):
  - When `config.complianceReview.enabled`, resolve the reviewer model via the same
    `resolveModel` path already used for phase models (`src/app/executePlan.ts:549`), using
    `config.complianceReview.model` / `effort` and the existing `securityFilter`.
    Use `resolution.selected` (provider/concreteModel/thinking) as `executePlan` already does.
  - Call `reviewCompliance(infoResult.right, config.complianceReview, resolution,
    { mode: securityMode, config: config.security }, opts)` — `securityMode` and `config.security`
    are already in scope here (the phase loop resolved both). `opts` carries only `verbose`,
    guarded for `exactOptionalPropertyTypes` like the publish block
    (`...(opts.verbose !== undefined ? { verbose: opts.verbose } : {})`). Swallow `FsError`
    non-fatally as the publish block does (`.pipe(Effect.catchAll(() => Effect.void))`); the
    review's own agent failures are already folded into a `failed` result. The run must stay in
    `review_open` regardless of review outcome.
- Surface the verdict in the PR body:
  - In `src/domain/publish/body.ts`, extend `buildPrBody` to accept an optional
    `complianceReviewMd?: string`; when present, append it as a clearly delimited
    `## Plan compliance review` section (respecting the existing `maxBytes` truncation logic
    and the byte-budget accounting).
  - In `src/app/publishRun.ts`, before calling `buildPrBody` (`src/app/publishRun.ts:368`),
    read `compliance-review.md` from `info.runPath` if it exists and pass its content through.
    A missing file is fine — pass nothing.

### Planned files to create

- (none)

### Planned files to edit

- `src/app/executePlan.ts`
- `src/domain/publish/body.ts`
- `src/app/publishRun.ts`
- `tests/unit/publish/body.test.ts`
- `tests/integration/publishRun.test.ts`

### Optional files that may be edited

- `tests/integration/executePlan.test.ts`

### Boundary contracts

`executePlan` (orchestrator) consumes `reviewCompliance`; the ordering contract is
*review-before-publish*. `publishRun` → `buildPrBody`: the producer (`publishRun`) supplies an
optional compliance section; the consumer (`buildPrBody`) renders it within the existing size
budget. Absence of the artifact is a valid, non-error state on both edges.

### Test strategy

- Domain (`buildPrBody`) → unit tests: a `complianceReviewMd` is rendered under its own
  heading; truncation still respects `maxBytes` when the combined body is large; omitting it
  reproduces today's body.
- Application (`publishRun`) → integration test: when `compliance-review.md` exists, the PR
  body includes the compliance section; when absent, the body is unchanged.
- Auto-trigger ordering is asserted in an `executePlan` integration test if a fake `Backend`
  is already wired there; otherwise document the manual verification.

### Implementation order

`buildPrBody` signature + rendering → `publishRun` read-and-pass → `executePlan` auto-trigger
(resolve model, call, swallow failures) placed before the publish block.

### Excluded scope

- The CLI command — phase-05.
- Changing publish behavior beyond adding the optional compliance section.

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact insertion point in `executePlan` (before the publish block) and that failures are
  swallowed so the run stays `review_open`.
- The `buildPrBody` signature change and the heading used for the compliance section.
- Any deviation from the planned file lists with the reason.

### Commit subject

feat(review): auto-run compliance review before publish and surface it in the PR body

### Commit body

Run reviewCompliance at end of run when review.compliance.enabled, ordered before publishRun so
the verdict can be carried into the PR. Extend buildPrBody with an optional compliance section
(within the existing size budget) and have publishRun pass compliance-review.md through when it
exists. Review failures are non-fatal; the run stays in review_open. Covered by unit and
integration tests.

---

## phase-05 — `phax review-compliance` CLI command {#phase-05-cli}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low

Expose the same use case as an on-demand command so a reviewer can run (or re-run) the
compliance review against a `review_open` run without re-executing the whole run — mirroring
`phax publish-pr`.

### Detailed instructions

- Create `src/cli/commands/reviewCompliance.ts` exporting
  `runReviewCompliance(shortNameArg, opts, out)`, modeled on
  `src/cli/commands/publishPr.ts`:
  - Load config; error if `!config.complianceReview.enabled`, with a message telling the user
    to add `review.compliance.enabled: true` to `phax.json`.
  - Decode the short name; resolve the run via `resolveRunByShortName`.
  - Require `info.runState === "review_open"` (same guard as `publishPr.ts:63`); otherwise
    error.
  - Resolve the reviewer model (load routing/provider config the way the `run` command does;
    see `src/cli/commands/runLayers.ts`) and build the layer with the **`Backend`** layer plus
    `FileSystem` and a telemetry layer — the `Backend` is required because this use case invokes
    an agent (unlike `publish-pr`, which does not). Do **not** add the `Git` layer:
    `reviewCompliance` does no git operations (the agent inspects git inside its sandbox), so
    the layer must match the phase-03 requirement set (`Backend | FileSystem | SystemTelemetry`).
  - Run `reviewCompliance(info, config.complianceReview, resolution, { mode:
    config.security.profile, config: config.security }, { verbose })` (in the manual path the
    security mode is `config.security.profile` — there is no per-run override flag here) and
    render: `generated` → print the run-level `verdict` (or `unknown` when
    `structuredVerdictMissing`) followed by the `compliance-review.md` path; `failed` → print
    the reason and a retry hint; `disabled` → the not-enabled error.
- Register the command in `src/cli/main.ts` next to `publish-pr`
  (`src/cli/main.ts:215-221`): `program.command("review-compliance <short-name>")` with a
  description like "Run a non-mutating plan-compliance review for a review_open run", calling
  `runReviewCompliance(shortName, globalTraceOpts(), consoleOutput)`.

### Planned files to create

- `src/cli/commands/reviewCompliance.ts`
- `tests/integration/reviewComplianceCommand.test.ts`

### Planned files to edit

- `src/cli/main.ts`

### Optional files that may be edited

- `src/cli/commands/runLayers.ts`

### Boundary contracts

CLI (view layer) → application: the command parses args, builds the layer (including
`Backend`), resolves the model, and calls the single `reviewCompliance` use case, then renders
via `OutputPort`. No business logic in the command file — it only translates the
`ComplianceReviewResult` union into exit codes and `out` lines.

### Test strategy

Page/CLI layer → integration/smoke test: invoking `runReviewCompliance` against a fake
`review_open` run with a fake `Backend` returns exit `0` and prints the artifact path; a run
not in `review_open` returns a non-zero exit with a clear message; disabled config returns the
not-enabled error.

### Implementation order

Command function (guards → layer/model resolution → call → render) → router registration.

### Excluded scope

- Any change to the use case behavior (phase-03) or auto-trigger (phase-04).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The command name `review-compliance`, its `review_open` guard, and that its layer is
  `Backend + FileSystem + SystemTelemetry` (no `Git` layer — the use case does no git work).
- Any deviation from the planned file lists with the reason.

### Commit subject

feat(cli): add phax review-compliance command for on-demand plan-compliance review

### Commit body

Add runReviewCompliance and register the review-compliance <short-name> command, mirroring
publish-pr: it guards on review_open, builds an agent-capable layer (Backend + FileSystem +
SystemTelemetry), resolves the reviewer model and security config, runs the reviewCompliance
use case, and renders the verdict path or failure reason. Covered by an integration test.
