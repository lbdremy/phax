# Plan — Seal plan extraction behind a tool-less model-completion primitive

Today `phax run` and `phax extract-plan` turn `plan.md` into `phax-plan.json` by
calling the agent backend in the **least** restricted way possible:
`extractPlanCore` (`src/app/extractPlan.ts`) hard-codes `mode: "unsafe"` and
`provider: "claude-code"`, so the Claude adapter emits
`--permission-mode bypassPermissions` — blanket host access, every tool allowed,
no approval gate. For a step that needs *none* of that, we hand it *all* of it.

Extraction is structurally a pure model call: the parent process reads `plan.md`
itself and embeds the full text inline in the prompt
(`buildExtractionPrompt`), so the agent needs **no filesystem access, no network,
no tools, no MCP** — just "given this prompt, return JSON matching the schema."
The ideal would be to talk to the model API directly; we keep driving the
provider CLI only to reuse the auth/tooling already wired, but we should drive it
**sealed**.

## Design decision — a completion primitive, not a new SecurityMode

We deliberately do **not** add a fourth `SecurityMode`. `SecurityMode`
(`secure | unsafe | isolated`) answers one question — *how much do I trust this
agent to touch the codebase?* — graded for **runs**. The proof it assumes
code-work: every adapter's `secure` branch throws unless given ≥1 writable path
(`claudeCode.ts`, `codexCli.ts`, `mistralVibe.ts`). Extraction does not touch the
codebase, so the question does not apply; folding it into `SecurityMode` would
blur a run concept with a non-run one (the same reason extraction sits outside
the run state machine).

Instead we introduce a distinct **port operation** whose contract is
`prompt → text`, with the sealing **intrinsic** to the operation rather than a
`SecurityPolicy` parameter (so it cannot be misconfigured):

- New `Backend.complete(prompt, options)` method — `provider | model | effort |
  cwd` in, `{ finalText }` out. No `SecurityPolicy`, no `agentCommands`, no
  session id, no resume. The signature is API-shaped on purpose: the day a direct
  model-API client replaces the CLI workaround, it slides behind the same method
  (or is lifted into a `ModelCompletion` port) without touching callers.
- The adapter runs the call in a **throwaway temp directory** as cwd, created and
  deleted around the call. Per the throwaway-dir reasoning: even if the agent
  writes, we delete it and it is jailed to that directory, so we do not fight for
  read-only.

### What "sealed" means per provider

| Provider          | Sealing applied                                                                                                  | Status                    |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------- |
| **Claude Code**   | `--allowedTools` empty, deny `Bash`/`WebFetch`/`WebSearch`, `--strict-mcp-config` (no MCP), `--permission-mode default` (any tool attempt auto-denies in headless `--print`), cwd = temp dir | Fully sealed (phase-01)   |
| **Codex**         | `sandbox_mode="read-only"`, `approval_policy="never"`, `network_access=false`, cwd = temp dir                    | Fully sealed (phase-03)   |
| **Mistral Vibe**  | Cannot seal network or tools (`PROVIDER_SECURITY_CAPABILITIES` marks filesystem `partial`, network unsupported)  | **Not supported** — `complete` rejects vibe |

"Network off" governs the *agent's* egress only; the CLI process still
authenticates and calls the provider API — that is the completion itself and is
inherent, not something we pretend to airgap.

Extraction is Claude-pinned today, so phase-01 + phase-02 deliver the entire
present-day win; phase-03 (Codex) is forward-looking, for when extraction is
allowed to route off Claude.

## Required commands

- (none)

No new tool, runtime, or CLI is introduced. All verification runs through the
existing `full` gate profile in `phax.json` (`pnpm` scripts already allowed via
the configured `deno`/`ctx7`/`usage` set plus gate commands).

## Constraints and sequencing notes

- **Each phase must compile and pass `full` on its own.** Adding `complete` to
  `BackendOps` forces every implementer (node dispatcher + fake backend) to
  satisfy it in the *same* commit, or `tsc` breaks — so phase-01 lands the port
  method together with all implementations. Codex/vibe `complete` paths return an
  `AgentInvocationError` ("not yet supported") in phase-01 and are upgraded later.
- **No back-compat shims** (repo rule): `complete`, `CompletionOptions`, and
  `CompletionResult` are added as required surface; the fake is updated in lock
  step.
- **Reuse, don't duplicate, the spawn plumbing.** The sealed Claude/Codex
  completion runners share the existing `spawn*`/stream-parse helpers in their
  adapter; only the argument builder differs from `runAgent`.
- **knip-clean.** When `extractPlanCore` stops handing the repo path to the
  agent, the now-unused `cwd` field is removed from its options and from both
  call sites (phase-02), so knip stays green.

---

## phase-01 — Sealed model-completion port primitive (`Backend.complete`) {#phase-01-complete-port}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** high

Add a tool-less, policy-free `complete` operation to the `Backend` port, wire it
through the node dispatcher and fake backend, and implement the fully-sealed
Claude argument builder. Codex and Vibe completion paths return a clear
"not yet supported" error so the build stays green while extraction itself is
untouched in this phase.

### Detailed instructions

- In `src/ports/backend.ts`, add:
  - `interface CompletionOptions { readonly provider: ProviderId; readonly
    model: string; readonly effort: string; readonly cwd: string; }`
  - `interface CompletionResult { readonly finalText: string; }`
  - `complete(prompt: string, options: CompletionOptions): Effect.Effect<
    CompletionResult, AgentInvocationError | RateLimitError | UsageLimitError |
    FsError>` on `BackendOps`. **No `SecurityEnforcementError`** (no policy is
    enforced) and **no session/resume** surface.
- In `src/infra/providers/claudeCode.ts`, add a `buildCompletionArgs(options:
  CompletionOptions): string[]` that emits the sealed flag set:
  `--print --output-format stream-json --verbose`, `--permission-mode default`,
  `--allowedTools ""` (empty allowlist), `--disallowed-tools Bash,WebFetch,WebSearch`,
  `--strict-mcp-config` (with no `--mcp-config`), `--model <model>`,
  `--effort <effort>`. No `--add-dir`. Add a `runClaudeCompletion(prompt,
  options)` that spawns with `buildCompletionArgs` in `options.cwd`, reusing the
  existing `spawnClaude` + stream-parse path, and returns `{ finalText }`.
- In `src/infra/providers/dispatcher.ts`, implement `complete` on the `Backend`
  layer: route `claude-code` to `runClaudeCompletion`; for `codex-cli` and
  `mistral-vibe` return `Effect.fail(new AgentInvocationError({ message:
  "sealed completion is not yet supported for <provider>" }))`. Map any
  `AgentSessionIdMissingError` to `AgentInvocationError` as the existing
  `runAgent` wiring does.
- In `src/infra/fakes/backend.ts`, implement `complete`: record calls in a
  `completeCalls: Array<{ prompt: string; options: CompletionOptions }>` array,
  return queued results from `completeResponses` via `addCompletionResponse(...)`,
  and support a rate/usage-limit knob mirroring the existing `runAgent` knobs so
  app-layer error paths stay testable.

### Planned files to create

- (none)

### Planned files to edit

- `src/ports/backend.ts`
- `src/infra/providers/claudeCode.ts`
- `src/infra/providers/dispatcher.ts`
- `src/infra/fakes/backend.ts`
- `tests/unit/providers/claudeCode.test.ts`

### Optional files that may be edited

- `tests/unit/providerAdapter.test.ts`

### Boundary contracts

- **Producer:** the `Backend` port gains a `complete` operation. **Consumer**
  (phase-02): `extractPlanCore` needs "prompt in → text out, zero agent
  capability." The stable contract is `(prompt, { provider, model, effort, cwd })
  → { finalText }` with no security parameter; the sealing is the adapter's
  responsibility, not the caller's. The error channel intentionally excludes
  `SecurityEnforcementError` because there is no policy to enforce.

### Test strategy

- **Adapter (unit), test-first** in `tests/unit/providers/claudeCode.test.ts`:
  assert `buildCompletionArgs` emits the sealed set — `--permission-mode default`,
  an empty `--allowedTools`, `--disallowed-tools Bash,WebFetch,WebSearch`,
  `--strict-mcp-config`, **no** `--add-dir`, **no** `bypassPermissions`. These are
  the security-critical assertions; write them before the builder.
- **Port contract (optional)** in `tests/unit/providerAdapter.test.ts`: if it
  asserts the `BackendOps` shape, extend it for `complete`.
- The fake's `complete` is exercised indirectly by phase-02's tests; phase-01 may
  add a direct fake unit check if convenient.

### Implementation order

Port interface → fake implementation (keeps tests compilable) → Claude
`buildCompletionArgs` + `runClaudeCompletion` → dispatcher wiring (codex/vibe
rejection) → adapter unit tests.

### Excluded scope

- Any change to `extractPlanCore` or the extraction call site (phase-02).
- Codex sealed completion (phase-03).
- Mistral Vibe sealed completion — structurally unsupported; `complete` rejects
  it by design.

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact `complete` signature and the `CompletionOptions` / `CompletionResult`
  shapes as added to `src/ports/backend.ts`.
- The name and location of the Claude sealed runner (`runClaudeCompletion`) and
  builder (`buildCompletionArgs`) in `src/infra/providers/claudeCode.ts`.
- The fake helpers added (`addCompletionResponse`, `completeCalls`, the limit
  knob) so phase-02 can drive them.
- Confirmation that codex/vibe `complete` paths fail with `AgentInvocationError`
  and where that is wired.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(backend): add sealed model-completion port primitive

### Commit body

Add Backend.complete — a tool-less, policy-free prompt→text operation distinct
from runAgent — with a fully-sealed Claude argument builder (empty allowedTools,
denied Bash/WebFetch/WebSearch, strict MCP, default permission mode, no add-dir).
Wire it through the node dispatcher (codex/vibe rejected as not-yet-supported)
and the fake backend. No SecurityPolicy and no resume surface: the sealing is
intrinsic to the operation. Covered by adapter unit tests asserting the sealed
flag set.

---

## phase-02 — Route plan extraction through `Backend.complete` in a throwaway dir {#phase-02-extraction-sealed}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Switch `extractPlanCore` off the `unsafe` `runAgent` path onto `Backend.complete`,
running the agent in a temp directory created and removed around the call. This
is the present-day hardening win: extraction stops running with blanket host
access.

### Detailed instructions

- In `src/app/extractPlan.ts`:
  - Remove the `resolveSecurityPolicy` / `mode: "unsafe"` / `resolveSecurityConfig`
    block and the `backend.runAgent(...)` call. Replace with `backend.complete(
    prompt, { provider: "claude-code", model: opts.model, effort: opts.effort,
    cwd: <tempDir> })`.
  - Create the temp dir via the `FileSystem` port before the call and remove it
    after (in both success and failure paths — use `Effect.ensuring` /
    `acquireRelease`-style cleanup). Derive the path as
    `join(os.tmpdir(), "phax-extract-" + randomUUID())` (string construction only;
    `fs.mkdirp` / `fs.remove` are the port I/O). `randomUUID` from `node:crypto`
    is already used in `src/app/executePlan.ts`.
  - Use `runResult.finalText` from the `CompletionResult` exactly as the old
    `AgentRunResult.finalText` was used (`stripJsonCodeFence` → `JSON.parse` →
    schema decode are unchanged).
  - Remove the sentinel `extractRunId = "extract-plan" as ... RunId` and the three
    `contract.validate` `telemetry.recordEvent` calls. The validation outcome is
    already conveyed by the returned `PlanValidationError` / success value;
    dropping the events removes the need to fake a `RunId` and removes the
    `SystemTelemetry` dependency from `extractPlanCore`'s requirement channel.
  - Remove `cwd` from `ExtractPlanCoreOptions` (the agent no longer runs in the
    repo and nothing else uses it).
- In `src/cli/commands/run.ts` and `src/cli/commands/extractPlan.ts`: drop the
  now-removed `cwd` field from the `extractPlanCore` / `extractPlan` option
  objects.

### Planned files to create

- `tests/integration/extractPlanSealed.test.ts`

### Planned files to edit

- `src/app/extractPlan.ts`
- `src/cli/commands/run.ts`
- `src/cli/commands/extractPlan.ts`
- `tests/integration/extractPlanTitles.test.ts`

### Optional files that may be edited

- `src/infra/fakes/fs.ts`

### Boundary contracts

- **Consumer:** `extractPlanCore` now depends on `Backend.complete` instead of
  `Backend.runAgent` — it provides a prompt and a throwaway cwd and consumes only
  `finalText`. It no longer constructs or passes a `SecurityPolicy`, and no longer
  requires `SystemTelemetry`. The temp-dir lifecycle is owned by the app layer and
  routed through the `FileSystem` port (no direct `node:fs`).

### Test strategy

- **Application (integration with fake ports), test-first** in
  `tests/integration/extractPlanSealed.test.ts`: drive `extractPlanCore` with the
  fake backend; assert it calls `complete` (not `runAgent`), that the `cwd` passed
  is a temp path (not the repo), that no `SecurityPolicy` is involved, and that the
  temp dir is removed afterward (assert via the fake fs). Write these before the
  refactor.
- **Update** `tests/integration/extractPlanTitles.test.ts`: switch its fake
  wiring from `addRunResponse` to `addCompletionResponse` so the title-derivation
  assertions still pass through the new path.

### Implementation order

Write `extractPlanSealed.test.ts` (red) → refactor `extractPlanCore` (temp-dir
lifecycle + `complete` call + telemetry/RunId/cwd removal) → update call sites in
`run.ts` / `extractPlan.ts` → update `extractPlanTitles.test.ts` wiring.

### Excluded scope

- A dedicated telemetry/event type for non-run operations — out of scope. This
  phase *removes* the extraction `contract.validate` events rather than redesign
  the run-keyed event schema; reintroducing extraction observability via a
  non-run event type is a separate observability follow-up.
- Codex/vibe routing for extraction — extraction stays Claude-pinned.

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- Confirmation that `extractPlanCore` now calls `Backend.complete`, runs in a
  temp dir under `os.tmpdir()`, and removes it on both success and failure.
- That `mode: "unsafe"`, the security-policy plumbing, the sentinel `RunId`, the
  `contract.validate` telemetry events, and the `cwd` option were all removed,
  with the updated `ExtractPlanCoreOptions` shape.
- Any deviation from the planned file lists, with the reason (e.g. whether the
  fake fs needed a change to assert temp-dir removal).

### Commit subject

refactor(extract): run plan extraction sealed in a throwaway directory

### Commit body

Route extractPlanCore through Backend.complete instead of the unsafe runAgent
path, running the agent tool-less in a temp directory created and removed around
the call. Drops the unsafe security policy, the sentinel RunId, the
contract.validate telemetry events, and the now-unused cwd option. Extraction no
longer runs with blanket host access. Covered by an integration test asserting
the sealed call and temp-dir cleanup.

---

## phase-03 — Codex sealed completion (read-only sandbox, network off) {#phase-03-codex-completion}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Implement sealed completion for Codex so extraction can route off Claude in the
future. Forward-looking: no current caller selects Codex for extraction, but this
completes the multi-provider sealing story for the `complete` primitive.

### Detailed instructions

- In `src/infra/providers/codexCli.ts`, add `buildCodexCompletionArgs(entry,
  options: CompletionOptions): string[]` emitting the sealed Codex set:
  `exec -C <options.cwd>`, `--json`, `--skip-git-repo-check`,
  `-c sandbox_mode="read-only"`, `-c approval_policy="never"`,
  `-c sandbox_workspace_write.network_access=false`,
  `-m <model>`, `-c model_reasoning_effort="<mapped effort>"`. No writable roots
  (read-only). Add a `runCodexCompletion(options, entry)` reusing the existing
  `spawnCodex` + stream-parse path, returning `{ finalText }`.
- In `src/infra/providers/dispatcher.ts`, route the `codex-cli` branch of
  `complete` to `runCodexCompletion` (resolving the provider entry as `runAgent`
  does, failing with `AgentInvocationError` if the entry is absent).

### Planned files to create

- (none)

### Planned files to edit

- `src/infra/providers/codexCli.ts`
- `src/infra/providers/dispatcher.ts`
- `tests/unit/providers/codexCli.test.ts`

### Optional files that may be edited

- (none)

### Boundary contracts

- **Producer:** the `codex-cli` implementation of `Backend.complete`. Same
  `(prompt, CompletionOptions) → { finalText }` contract as the Claude path; the
  sealing differs (read-only sandbox + network off) but the surface is identical,
  so callers remain provider-agnostic.

### Test strategy

- **Adapter (unit), test-first** in `tests/unit/providers/codexCli.test.ts`:
  assert `buildCodexCompletionArgs` emits `sandbox_mode="read-only"`,
  `approval_policy="never"`, `network_access=false`, and **no**
  `--dangerously-bypass-approvals-and-sandbox` and **no** `writable_roots`.

### Implementation order

`buildCodexCompletionArgs` + unit test (red→green) → `runCodexCompletion` →
dispatcher wiring.

### Excluded scope

- Mistral Vibe sealed completion — structurally unsupported.
- Changing which provider extraction selects — extraction remains Claude-pinned;
  this phase only makes the Codex path *available*.

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The Codex sealed flag set as implemented, and confirmation the dispatcher now
  routes `codex-cli` completion to the real runner instead of the
  not-yet-supported error.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(backend): add Codex sealed completion path

### Commit body

Implement Backend.complete for codex-cli with a read-only sandbox, never-approval
policy, and network access disabled, reusing the existing Codex spawn/parse path.
Forward-looking support so extraction can route off Claude later; extraction
remains Claude-pinned. Covered by adapter unit tests asserting the sealed flags.
