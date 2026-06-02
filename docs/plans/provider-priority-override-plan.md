# Implementation plan — Per-invocation provider-priority override for `phax run` / `phax resume`

> Deliverable location: `docs/plans/provider-priority-override-plan.md`.
> Format: matches the `.skills/phax-planning.md` skill so `phax extract-plan`
> can consume this file and produce a `phax-plan.json`. Each phase carries an
> HTML anchor (`{#phase-NN-...}`) for the `planMarkdownAnchor` field.

---

## Context

Today the provider priority — the order in which PHAX walks candidate
providers when resolving a phase's model — comes **only** from the persisted
routing config. Both `phax run` and `phax resume` load it the same way and
have no per-invocation override:

- `src/cli/commands/run.ts:129-138` and `src/cli/commands/resume.ts:126-133`
  call `loadModelRouting()` / `loadProviderConfig()` (defined in
  `src/app/loadRouting.ts`), which read `~/.phax/model-routing.json` and
  `~/.phax/providers.json` (falling back to `DEFAULT_MODEL_ROUTING` /
  `DEFAULT_PROVIDER_CONFIG` when absent).
- The resolved `routing` / `providerConfig` are passed straight into
  `executePlan(...)`. Nothing from the CLI options can alter them.
- `executePlan` (`src/app/executePlan.ts:313`) calls the pure
  `resolveModel(request, routing, providerConfig)` per phase, which walks
  `routing.providerPriority` in order (`src/domain/routing/resolve.ts:164`)
  and picks the first provider present in the matched tier. `claude-code`
  remains the guaranteed terminal fallback **after** the priority loop is
  exhausted, regardless of whether it appears in `providerPriority`.

To change which provider wins, a user currently has to hand-edit
`~/.phax/model-routing.json`. This plan adds a `--provider-priority <list>`
flag to `phax run` and `phax resume` that overrides
`routing.providerPriority` for that single invocation, without touching any
file on disk.

### Design

- **Surface**: `--provider-priority <list>` where `<list>` is a
  comma-separated list of provider ids, e.g.
  `--provider-priority mistral-vibe,claude-code`.
- **Valid provider ids**: `claude-code | mistral-vibe | codex-cli`
  (the `ProviderIdSchema` literals in `src/schemas/modelRouting.ts:3` and the
  `ProviderId` union in `src/domain/routing/types.ts:1`).
- **Parsing rules**: split on commas, trim each token, drop empty tokens
  (so a trailing comma is tolerated), reject any unknown token, dedupe while
  preserving first-seen order, and reject a resulting empty list. Invalid
  input fails fast with a clear message and a non-zero exit code — never a
  silent fallback (consistent with how PHAX treats malformed config).
- **Application**: a pure transform returns a new `ModelRouting` with only
  `providerPriority` replaced; every other field is preserved. The terminal
  `claude-code` fallback inside `resolveModel` is unaffected, so an override
  like `--provider-priority mistral-vibe` still degrades to `claude-code` when
  Mistral cannot serve a tier — this must be documented so it is not mistaken
  for a bug.
- **Purity**: the parser/transform live in `src/domain/routing/` and stay
  pure (no Effect, no infra, no FileSystem port) — enforced by the existing
  "routing domain purity" architectural guard
  (`tests/unit/architecturalGuards.test.ts`).
- **No schema/back-compat shims**: the override is computed in-memory at the
  CLI boundary; the on-disk `ModelRoutingSchema` is unchanged.

### Constraints that shape the phase boundaries

- **`knip` is a full-profile gate.** `src/domain/routing/*.ts` is in knip's
  `project` set but not its `entry` set; `tests/**/*.test.ts` **is** an entry
  (`knip.json`). So a new pure export is "reachable" the moment a routing
  unit test imports it — Phase 01 ships the helper together with its tests and
  passes `pnpm knip`.
- **Docs are only weakly gated** (`oxfmt`/`oxlint`/`knip` ignore Markdown).
  A docs-only phase would have no real mechanical gate, so the docs ride along
  with the final code phase rather than forming a standalone phase.
- Each phase is verified by the project's `full` gate profile from
  `phax.json`: `pnpm typecheck`, `pnpm lint`, `pnpm format:check`,
  `pnpm knip`, `pnpm test`, `pnpm audit:architecture`, `pnpm build`.

The work is split into **3 sequential phases**: Phase 01 adds the pure
parse/apply helper and its unit tests; Phase 02 wires the flag into
`phax run`; Phase 03 wires it into `phax resume` and documents the feature.

---

## phase-01 — Pure provider-priority override helper {#phase-01-override-helper}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Add a new pure module `src/domain/routing/priorityOverride.ts` that parses a
raw `--provider-priority` string into a validated provider-id list and applies
it to a `ModelRouting`. This is the only phase that introduces routing-domain
logic; Phases 02–03 merely call it. Keep it pure so the routing-domain purity
guard stays green.

### Detailed instructions

- Create `src/domain/routing/priorityOverride.ts` exporting two functions:
  - `parseProviderPriority(raw: string): Either<string, NonEmptyArray<ProviderId>>`
    — split `raw` on `,`, `trim` each token, drop empty tokens, validate every
    remaining token against the known provider ids
    (`claude-code`, `mistral-vibe`, `codex-cli`), dedupe keeping first-seen
    order, and return `Left<string>` (a human-readable error message) when the
    list is empty or any token is unknown, otherwise `Right` of the
    non-empty list. Use `effect`'s `Either` (`Either.left` / `Either.right`)
    to match the codebase convention (see `src/cli/commands/run.ts`,
    `loadRouting.ts`). Derive the set of valid ids from a single
    `readonly ProviderId[]` constant declared in this file (do **not** import
    Effect Schema here — keep the module pure and Schema-free, consistent with
    the rest of `src/domain/routing/`).
  - `applyProviderPriorityOverride(routing: ModelRouting, priority: NonEmptyArray<ProviderId>): ModelRouting`
    — return `{ ...routing, providerPriority: priority }`. Do not mutate the
    input. Every other field is preserved verbatim.
- The error message from `parseProviderPriority` should name the offending
  token and list the valid ids, e.g.
  `Invalid provider id "gpt" in --provider-priority. Valid ids: claude-code, mistral-vibe, codex-cli`,
  and for an empty list:
  `--provider-priority must list at least one provider id`.
- Import types from `src/schemas/modelRouting.ts` (`ModelRouting`) and
  `src/domain/routing/types.ts` (`ProviderId`). Reuse the existing
  `NonEmptyArray` type from `effect` (matching how `providerPriority` is typed
  via `Schema.NonEmptyArray`) — the return type must be assignable to
  `ModelRouting["providerPriority"]`.
- Add unit tests `tests/unit/routing/priorityOverride.test.ts` covering:
  - single id, multiple ids, all three ids;
  - whitespace trimming (`" mistral-vibe , claude-code "`);
  - trailing/empty tokens dropped (`"claude-code,"`);
  - duplicate collapse preserving first-seen order
    (`"claude-code,mistral-vibe,claude-code"` → `["claude-code","mistral-vibe"]`);
  - unknown token → `Left` with a message naming the token;
  - empty / whitespace-only input → `Left`;
  - `applyProviderPriorityOverride` replaces `providerPriority` and leaves all
    other `DEFAULT_MODEL_ROUTING` fields untouched (deep-equal the rest), and
    does not mutate the input object.

### Included scope

- `src/domain/routing/priorityOverride.ts` (new).
- `tests/unit/routing/priorityOverride.test.ts` (new).

### Excluded scope

- Any CLI wiring (`main.ts`, `run.ts`, `resume.ts`, `resumeRegister.ts`).
- Any change to `ModelRoutingSchema`, `loadRouting.ts`, `defaults.ts`, or
  `resolve.ts`.
- Docs.

### Expected handoff content

- The exact module path `src/domain/routing/priorityOverride.ts` and the
  exported signatures of `parseProviderPriority` and
  `applyProviderPriorityOverride` (param and return types), so Phases 02–03
  can call them without re-reading this phase.
- Confirmation that the routing-domain purity guard and `pnpm knip` pass with
  the new export (the unit test is what makes it reachable).
- The precise error-message strings emitted by `parseProviderPriority`, so the
  CLI phases can surface them verbatim.

### Commit subject

feat(routing): add pure provider-priority override helper

### Commit body

Add `src/domain/routing/priorityOverride.ts` with `parseProviderPriority`
(comma-separated string → validated, deduped non-empty provider-id list, or a
descriptive error) and `applyProviderPriorityOverride` (returns a new
ModelRouting with only `providerPriority` replaced). The module is pure — no
Effect Schema, no infra — so the routing-domain purity guard stays green, and
its unit tests make the exports reachable for knip. No CLI is wired yet.

---

## phase-02 — Wire `--provider-priority` into `phax run` {#phase-02-run-flag}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Expose `--provider-priority <list>` on the `run` command, validate it early
(so `--dry-run` also reports it and bad input fails fast), and apply the
override to the loaded routing before `executePlan`.

### Detailed instructions

- In `src/cli/commands/run.ts`:
  - Add `providerPriority?: string` to `RunCommandOptions`.
  - Immediately after the config check (around `run.ts:53`, before plan
    extraction), if `opts.providerPriority !== undefined` call
    `parseProviderPriority`. On `Left`, `out.error(...)` the message and
    `return 2`. On `Right`, keep the validated `NonEmptyArray<ProviderId>` in
    a local (e.g. `priorityOverride`). Validating here means even
    `--dry-run --provider-priority …` reports the override and rejects bad
    input without first spending an LLM call on plan extraction.
  - After `loadModelRouting()` succeeds (`run.ts:138`), when
    `priorityOverride` is set, replace `routing` with
    `applyProviderPriorityOverride(routing, priorityOverride)` before it is
    passed into `executePlan`.
  - Plumb the override into the dry-run preview: extend `buildDryRunReport` /
    `formatDryRunReport` in `src/app/dryRun.ts` with an optional
    `providerPriorityOverride?: readonly string[]` field on `DryRunReport`,
    and when present print a line such as
    `  Priority:     mistral-vibe → claude-code (override)` in the report
    header block. Pass the validated override (mapped to a plain
    `string[]` via `[...priorityOverride]`) into `buildDryRunReport`. When the
    flag is absent, the report is unchanged (omit the line).
- In `src/cli/main.ts`:
  - Add `.option("--provider-priority <list>", "Comma-separated provider priority override (e.g. mistral-vibe,claude-code)")`
    to the `run` command (after `--allow-dirty`, before `--dry-run`).
  - Add `providerPriority?: string` to the inline `opts` type in the `run`
    action and ensure it flows through the existing `merged` object into
    `runRun`.
- Tests:
  - Add `tests/unit/runArgv.test.ts` (mirroring `tests/unit/resumeArgv.test.ts`):
    register only the `run` command against a fresh `commander` `Command` with
    a stubbed `runRun` impl, and assert that
    `run foo --provider-priority mistral-vibe,claude-code` forwards
    `providerPriority: "mistral-vibe,claude-code"` to `runRun`. To keep this a
    pure argv test, factor the `run` command registration the same way
    `resume` is factored — i.e. if `main.ts` does not already expose a
    `registerRunCommand`-style hook, register the command inline in the test
    using the same `.option(...).action(...)` shape and a `vi.fn()` for
    `runRun`. (Do **not** call the real `runRun`.)
  - Extend `tests/unit/dryRun.test.ts` if it exists (else add a focused test)
    to assert the override line renders when `providerPriorityOverride` is set
    and is omitted otherwise.

### Included scope

- `src/cli/commands/run.ts`, `src/cli/main.ts`, `src/app/dryRun.ts`.
- `tests/unit/runArgv.test.ts` (new) and dry-run report test.

### Excluded scope

- `phax resume` wiring (Phase 03).
- Docs (Phase 03).
- Any change to `priorityOverride.ts` (consume it as-is from Phase 01).

### Expected handoff content

- Confirmation that `parseProviderPriority` is called **before** plan
  extraction in `run.ts` and that the override is applied to `routing` before
  `executePlan`, with the exact line numbers/anchors touched.
- The exact `DryRunReport` field name added (`providerPriorityOverride`) and
  the format of the rendered line, so Phase 03 docs describe it accurately.
- The test helper/pattern used for the `run` argv test, so Phase 03 can mirror
  it for `resume` if needed.

### Commit subject

feat(cli): add --provider-priority override to `phax run`

### Commit body

Add a `--provider-priority <list>` flag to `phax run`. The comma-separated
list is validated via `parseProviderPriority` right after config load — before
plan extraction — so bad input fails fast and `--dry-run` reports the override.
When valid, `applyProviderPriorityOverride` replaces `routing.providerPriority`
in memory before `executePlan`; no config file is touched. The dry-run report
gains an optional override line. Adds argv and dry-run unit tests.

---

## phase-03 — Wire `--provider-priority` into `phax resume` and document {#phase-03-resume-flag-and-docs}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Expose the same flag on `phax resume`, apply it on top of whatever routing the
resume path resolves (loaded config or the default fallback), and document the
feature across the routing docs.

### Detailed instructions

- In `src/cli/commands/resume.ts`:
  - Add `providerPriority?: string` to `ResumeCommandOptions`.
  - Validate it early (right after the short-name decode, near `resume.ts:43`)
    with `parseProviderPriority`; on `Left`, `out.error(...)` and `return 1`
    (resume's existing early-exit code for bad arguments — match the
    surrounding `return 1` style, not `2`).
  - The resume path tolerates a routing-load failure by falling back to
    `DEFAULT_PROVIDER_CONFIG` and `routing: undefined` (`resume.ts:131-133`).
    Apply the override on top of the effective routing: compute
    `const effectiveRouting = routing ?? DEFAULT_MODEL_ROUTING` and, when the
    override is present, pass
    `applyProviderPriorityOverride(effectiveRouting, priorityOverride)` into
    `executePlan` (import `DEFAULT_MODEL_ROUTING` from
    `src/domain/routing/defaults.js`, which `resume.ts` does not yet import).
    When the override is absent, keep passing `routing` exactly as today (do
    not change the no-override behaviour, including the `undefined` →
    `executePlan` default).
- In `src/cli/commands/resumeRegister.ts`:
  - Add `.option("--provider-priority <list>", "Comma-separated provider priority override (e.g. mistral-vibe,claude-code)")`
    to the `resume` command and add `providerPriority?: string` to the inline
    `opts` type in the action so it flows through `merged` into `runResume`.
- Tests — extend `tests/unit/resumeArgv.test.ts` to assert
  `resume foo --provider-priority codex-cli,claude-code` forwards
  `providerPriority: "codex-cli,claude-code"` to the stubbed `runResume`.
- Docs:
  - `docs/model-routing.md` — under "Editing the routing config", add a
    subsection documenting `--provider-priority` on `phax run` / `phax resume`:
    the comma-separated syntax, that it overrides `providerPriority` for one
    invocation only without writing any file, the valid ids, and the key
    caveat that `claude-code` remains the guaranteed terminal fallback (so an
    override that omits it can still resolve to `claude-code`).
  - `README.md` — add the flag to the `phax run` / `phax resume` usage so the
    surface is discoverable (mirror the existing options documentation style).
  - `.skills/model-routing.md` — add the flag to the `phax agent`/routing
    command reference so the skill reflects the override path.

### Included scope

- `src/cli/commands/resume.ts`, `src/cli/commands/resumeRegister.ts`.
- `tests/unit/resumeArgv.test.ts` (extend).
- `docs/model-routing.md`, `README.md`, `.skills/model-routing.md`.

### Excluded scope

- Any change to `run.ts` / `main.ts` (done in Phase 02).
- Any change to `priorityOverride.ts` or `resolve.ts`.

### Expected handoff content

- Confirmation that `phax run --provider-priority …` and
  `phax resume --provider-priority …` are both wired, validated early, and
  apply the override before `executePlan`, and that the resume path correctly
  layers the override over the `DEFAULT_MODEL_ROUTING` fallback when config
  load fails.
- A one-line summary of the documented behaviour, including the terminal
  `claude-code` fallback caveat.

### Commit subject

feat(cli): add --provider-priority override to `phax resume` and document it

### Commit body

Add the `--provider-priority <list>` flag to `phax resume`, validated early and
applied on top of the effective routing (loaded config or the
DEFAULT_MODEL_ROUTING fallback) before `executePlan`, mirroring `phax run`.
Extend the resume argv test. Document the override in docs/model-routing.md,
README.md, and .skills/model-routing.md, including the caveat that claude-code
remains the guaranteed terminal fallback regardless of the override.
