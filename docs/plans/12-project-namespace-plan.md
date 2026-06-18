# Plan — Project Namespaces and Repo-Scoped Run Names

Implements `docs/specs/12-project-namespace.md`.

## Summary

Today every PHAX run lives under a single global state root (`~/.phax`) keyed
only by its `shortName` (`runs/<shortName>`, `locks/<shortName>.lock`,
`worktrees/<shortName>`, `archive/<shortName>`). The registry index
(`registry.json`) is global too. As soon as two repositories generate a run with
the same short name (`fixbug`), they collide and overwrite each other, and the
CLI shows ambiguous bare short names everywhere.

This plan introduces a **project namespace** sourced from `phax.json` and makes
the **qualified run name** (`<namespace>.<shortName>`) the canonical on-disk key
and the default user-facing identity. Short names remain accepted as input when
the current project context provides the namespace.

The work is ordered inside-out, and — critically — **resolution before
re-keying**:

1. Config gains a validated `namespace` field (phase-01).
2. A pure qualified-name domain model + project-context helper (phase-02).
3. Namespace becomes a required, enforced part of every new run: persisted on run
   identity, registry keyed by `(namespace, shortName)`, and `phax run` requires
   it (phase-03).
4. A shared run-reference resolver that returns the located run, adopted in `phax
   resume` (phase-04).
5. The namespace-scoped `last` selector lands and the remaining existing-run
   commands adopt the resolver, printing qualified names (phase-05).
6. On-disk run/worktree/archive folder keys move to the qualified run name
   (phase-06).
7. The run lock is keyed by the qualified run name (phase-07).
8. Listings (`phax ls`, global reconciliation) expose qualified names as the
   primary identity (phase-08).

### Storage model decision

The on-disk key for a run becomes its **qualified run name**
`"<namespace>.<shortName>"` (the same string the user sees and copies). A
dedicated `runKey(namespace, shortName)` helper produces it so the separator
lives in one place. The `ShortName` brand (`^[a-z][a-z0-9-]*$`) and the
`Namespace` brand (same slug shape) both exclude `.`, so the qualified key parses
back unambiguously by splitting on the first `.`.

### Ordering decision — resolve before re-key

The on-disk folder/lock/interrupt path keys and the `resolveRunByShortName`
signature can only flip to qualified keys once **every caller already has the
namespace in scope**. `resolveRunByShortName` alone has ~12 callers
(`executePlan`, `resetPhase`, `resume`, `archive`, and most CLI commands), and
`setRunInterruptContext` / `withRunLock` are threaded from `run`/`resume`. So
resolution (registry-based, independent of folder layout — the registry carries
`namespace` from phase-03) lands first (phases 04–05), and the mechanical key
flips land last (phases 06–07) when the namespace is available everywhere. The
resolver returns the **located run info**, so CLI commands call it once (phase-05)
and are not re-touched when the folder key flips (phase-06).

### Schema decision — in-place, no version bump

PHAX is not public yet, so the persisted schemas are updated **in place**:
`registry.json` and `run-status.json` gain a **required** `namespace` field and
keep `version: 1`. There is no IO-boundary upgrader and no version migration.
This follows project convention (`feedback_no_backcompat`): the new field is
required, not optional-for-old-data.

### Pre-public migration note (spec §9 de-scoped)

Because there is no public install base, this plan does **not** implement the
spec §9 legacy-run migration (no folder relocation, no `_legacy` sentinel, no
backfill of namespace into existing runs). Any pre-existing runs in a developer's
own `~/.phax` predate the required `namespace` field and will fail to decode;
clearing `~/.phax` (or the affected run folders) is the expected recovery. New
runs are namespaced from phase-03 and qualified on disk once phase-06/07 land. If
PHAX gains real users before this ships, revisit spec §9 as a follow-up plan.

### Branch names are not namespaced (non-goal)

Run branches stay `phax/<shortName>`. Two projects sharing a short name live in
different git repositories, so their branches never collide. Namespacing is about
the global `~/.phax` state, not the per-repo branch namespace.

## Required commands

- (none)

This plan introduces no new tool, runtime, or CLI. It uses the existing
TypeScript + pnpm + vitest toolchain already configured in `phax.json` gate
profiles.

## Sequencing and boundaries

- Phases are sequential; assume the previous phase is merged.
- Each phase must compile and pass its own gates. The key-flip phases (06–07)
  change shared signatures (`resolveRunByShortName`, the `Lock` port,
  `setRunInterruptContext`, `withRunLock`) and therefore list **every** caller in
  their edit lists — the namespace is already threaded through those callers by
  phases 03–05.
- No data migration is performed (see the pre-public migration note); pre-existing
  local runs are expected to be cleared rather than upgraded.
- During the window between phase-03 (namespace enforced, folders still
  bare-keyed) and phase-06 (folders qualified), `phax run` never overwrites an
  existing run folder — uniqueness is scoped to the namespace via the registry
  **and** guarded against any existing bare folder. This is a dev-only,
  pre-public interim; it cannot cause data loss.

---

## phase-01 — Namespace config field and validation {#phase-01-namespace-config}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Add a validated `namespace` slug to the `phax.json` schema and surface it on
`ResolvedConfig`, so later phases have a single source of truth for project
identity. `loadConfig` still succeeds when the field is absent — only commands
that need a project identity fail, and that gate is added in phase-03 — but when
present the value must be a valid slug.

### Detailed instructions

- Add a `Namespace` branded type in `src/domain/branded.ts` mirroring the
  `ShortName` slug rules: `^[a-z][a-z0-9-]*$`, length 1–64, brand `"Namespace"`,
  with `decodeNamespace`. The shape must exclude `.` so qualified names split
  unambiguously.
- Extend `PhaxConfigSchema` in `src/schemas/phaxConfig.ts` with an **optional**
  top-level `namespace` field typed as a non-empty string. (Optional at the
  schema layer so existing configs still parse; the "required for run" gate is a
  command-level check added in phase-03, matching spec §5.4 / §6.8 which only
  fail commands that need a project identity.) Validate the slug shape with the
  same pattern as the brand and produce a clear `ConfigValidationError` when it
  is present but malformed (e.g. contains `.`, spaces, or uppercase), with
  `path: "namespace"`.
- Add `readonly namespace: string | undefined` to `ResolvedConfig` and populate
  it in `loadConfig` from `config.namespace`. Do not infer it from the folder
  name, git remote, `project.name`, or plan name (spec §5.1).
- Keep `onExcessProperty: "error"` behavior intact — the new field must be a
  recognized property.

### Planned files to create

- (none)

### Planned files to edit

- `src/domain/branded.ts`
- `src/schemas/phaxConfig.ts`
- `src/app/loadConfig.ts`
- `tests/unit/branded.test.ts`
- `tests/unit/loadConfig.test.ts`

### Optional files that may be edited

- `tests/unit/schemas.test.ts`
- `examples/hello-world/phax.json`
- `phax.json`

### Boundary contracts

Producer: `phax.json` config file → `ResolvedConfig.namespace`. Consumer: later
phases that stamp/resolve runs. The stable shape is `namespace: string |
undefined` on `ResolvedConfig` plus a `Namespace` brand for validated values.

### Test strategy

- Unit (write before implementation): `decodeNamespace` accepts valid slugs and
  rejects `.`, spaces, uppercase, leading digits, and over-length values
  (`tests/unit/branded.test.ts`).
- Unit (write before implementation): `loadConfig` exposes `namespace` when set,
  returns `undefined` when absent, and returns a `ConfigValidationError` with
  `path: "namespace"` when the value is a malformed slug
  (`tests/unit/loadConfig.test.ts`).

### Implementation order

Brand → schema field + validation → `ResolvedConfig` surfacing → tests.

### Excluded scope

- The "missing namespace fails the command" gate (phase-03).
- Any qualified-name parsing/formatting (phase-02).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The `Namespace` brand export name (`decodeNamespace`) and slug rule.
- The exact `ResolvedConfig` field name (`namespace: string | undefined`) and
  that `loadConfig` does not fail when it is absent.
- Whether `phax.json` / the example config gained a `namespace` value, and any
  deviation from the planned file lists with the reason.

### Commit subject

feat(config): add validated project namespace field to phax.json

### Commit body

Add an optional, slug-validated `namespace` field to the phax.json schema and
surface it as `ResolvedConfig.namespace`. Introduce a `Namespace` branded type
matching the short-name slug rules so qualified run names can split on `.`
unambiguously. loadConfig still succeeds when the field is absent; command-level
enforcement lands in a later phase. Covered by brand and loadConfig unit tests.

---

## phase-02 — Qualified-name domain model and project-context helper {#phase-02-qualified-name-model}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Add the pure functions that compose, parse, and key qualified run names, plus
helpers that turn a `ResolvedConfig` into a required namespace (or the spec's
error) and that resolve the effective state root even outside a project. These
are the building blocks every later phase consumes.

### Detailed instructions

- Create `src/domain/runRef.ts` with:
  - `runKey(namespace: string, shortName: string): string` returning
    `"${namespace}.${shortName}"`. This is the single place the `.` separator is
    defined (spec §4 leaves the separator to implementation).
  - `formatQualifiedName(namespace, shortName)` — one canonical display formatter
    so output is consistent (spec §8 "consistent naming").
  - `type RunRef = { namespace: string | undefined; shortName: string }`.
  - `parseRunRef(input: string): Either<string, RunRef>` — splits on the **first**
    `.`. If a `.` is present, the left part is the namespace and the right is the
    short name; both must satisfy their slug brands (`decodeNamespace`,
    `decodeShortName`) or it returns a clear error. If no `.` is present, the
    whole input is an unqualified `shortName` (namespace `undefined`), validated
    by `decodeShortName`. Reject inputs with more than one `.` or empty segments
    with an actionable message.
  - `parseRunKey(key: string): Either<string, { namespace: string; shortName:
    string }>` — the inverse of `runKey` for reading folder names, requiring both
    parts present.
- Create `src/app/projectContext.ts` with:
  - `requireNamespace(config: ResolvedConfig): Either<ConfigValidationError,
    string>` returning the namespace or the spec §5.4 error message
    (`PHAX project namespace is missing in phax.json. Add a namespace field, for
    example: namespace: "louloupapers".`). Reuse `ConfigValidationError` with
    `path: "namespace"`.
  - `effectiveStateRoot(config: ResolvedConfig | undefined): string` — returns
    `config.stateRoot` when in a project, else the default `~/.phax` (expanded).
    This lets qualified references resolve outside a project (spec §6.9 / Example
    5) by reading the global registry. Document that a custom per-project
    `state.root` outside its repo is best-effort, matching the spec's "enough
    metadata to locate the run safely."
- Keep these modules free of IO except `projectContext`, which only reads the
  resolved config object and (for the default root) the home directory.

### Planned files to create

- `src/domain/runRef.ts`
- `src/app/projectContext.ts`
- `tests/unit/runRef.test.ts`
- `tests/unit/projectContext.test.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- `src/domain/branded.ts`

### Boundary contracts

Producer: `src/domain/runRef.ts` (pure parse/format/key) and
`src/app/projectContext.ts` (`requireNamespace`, `effectiveStateRoot`).
Consumers: phases 03–08. Stable shapes: `runKey(ns, short) -> string`,
`parseRunRef(string) -> Either<string, RunRef>`, `requireNamespace(config) ->
Either<error, string>`, `effectiveStateRoot(config?) -> string`.

### Test strategy

- Unit (write before implementation, `tests/unit/runRef.test.ts`):
  - `runKey` joins with a single `.`.
  - `parseRunRef("fixbug")` → `{ namespace: undefined, shortName: "fixbug" }`.
  - `parseRunRef("louloupapers.fixbug")` → both parts populated.
  - rejects `"a.b.c"`, `"Foo.bar"`, `".bar"`, `"foo."`, empty input.
  - `parseRunKey` round-trips `runKey` output and rejects unqualified keys.
- Unit (write before implementation, `tests/unit/projectContext.test.ts`):
  - `requireNamespace` returns the value when present and the exact spec §5.4
    message (asserted on substring) when absent.
  - `effectiveStateRoot` returns the config root when present and the default when
    config is `undefined`.

### Implementation order

`runRef` (pure) → `projectContext` (config-only) → tests.

### Excluded scope

- Any registry lookup or resolution against stored runs (phase-04).
- Any persistence schema changes (phase-03).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- Exact module paths and exported signatures: `runKey`, `formatQualifiedName`,
  `parseRunRef`, `parseRunKey`, `RunRef`, `requireNamespace`,
  `effectiveStateRoot`.
- The separator choice (`.`) and the "split on first dot" rule.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(domain): add qualified run-name model and project-context helpers

### Commit body

Add pure helpers to compose (`runKey`), parse (`parseRunRef`, `parseRunKey`), and
format qualified run names `<namespace>.<shortName>`, plus a `requireNamespace`
project-context helper that returns the spec's missing-namespace error and an
`effectiveStateRoot` helper so qualified references can resolve outside a project.
Covered by unit tests for parsing edge cases, the error message, and the default
state root.

---

## phase-03 — Namespace required and enforced at run creation {#phase-03-namespace-at-creation}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** high

Make the namespace a required, enforced part of every new run: persist it on run
identity, key the registry index by `(namespace, shortName)`, stamp it at
creation, require it in `phax run`, scope uniqueness to the namespace, and print
the qualified run name. On-disk folders stay bare-keyed in this phase (they move
in phase-06); creation never overwrites an existing folder.

### Detailed instructions

- `src/schemas/registry.ts`: add a required `namespace: Schema.NonEmptyString` to
  `RegistryEntrySchema`. Leave `RegistrySchema.version` at `Schema.Literal(1)` —
  no version bump, no upgrader (pre-public; see the plan's schema decision).
- `src/schemas/status.ts`: add a required `namespace: Schema.NonEmptyString` to
  `RunStatusSchema`. Leave `version` at `Schema.Literal(1)`. `PhaseStatusSchema`
  is unchanged (phases do not carry a namespace).
- `src/app/registry.ts`: `upsertRun` and `setRunStatus` match entries by **both**
  `namespace` and `shortName`, not `shortName` alone, so two projects with the
  same short name are distinct registry rows. Thread `namespace` into these
  signatures (or take the full entry / a `{namespace, shortName}` key).
- `src/app/runFolder.ts`: `createRunFolder` takes a required `namespace: string`
  and writes it into both `run-status.json` and the registry entry. Folder path
  stays `runs/<shortName>` here (re-keyed in phase-06).
- Surface the namespace on the in-memory run model so non-CLI readers can stamp
  and display it: add `readonly namespace: string` to `RunReviewInfo` in
  `src/domain/runReviewInfo.ts` and populate it from `runStatus.namespace` in
  `loadRunReviewInfo` (`src/app/resolveRunInfo.ts`). This is the source every
  consumer (the status writer below, the resolver in phase-04, and the qualified
  display in phases 04–05) reads the namespace from.
- `src/cli/commands/run.ts`:
  - After `loadConfig`, call `requireNamespace(config)`; on the error path print
    the spec §5.4 message and exit non-zero **before** any extraction or run
    creation (spec §6.8 / Example 7). When `loadConfig` itself fails (not a PHAX
    repo), keep the existing config-error path but make its message actionable
    ("run from a PHAX repository") per spec §6.7 / Example 6.
  - Pass the namespace into `createRunFolder`.
  - Replace `ensureUniqueShortName` so collision detection is **scoped to the
    namespace via the registry** (so it also covers archived runs whose folders
    have moved — spec §6.12), and additionally never reuses an existing bare run
    folder (defensive during the bare-keyed interim). Preserve the `-2`, `-3`…
    bump and 64-char trim; the warning references the qualified name.
  - Print the qualified name `runKey(namespace, shortName)` in all start / pause /
    completion output and resume-instruction hints (spec §6.4, §6.5, §8).
- Update every `setRunStatus` caller to pass the namespace (the signature now
  keys by `(namespace, shortName)`): `src/app/archive.ts` (the `setRunStatus`
  call) and `src/app/effectRunner.ts` (the `review_open` transition, which reads
  the namespace from `cmd.info.namespace` now that `RunReviewInfo` carries it).
  Both must change or the phase will not compile. The `run-status.json` rewriters
  on the dispatcher path (`src/app/dispatcher.ts` / `src/app/eventAdapter.ts`)
  preserve the now-required `namespace` field automatically by spreading the
  decoded status — touch them only if a writer drops the field.
- `src/app/dryRun.ts`: show the qualified name (namespace from `config`, not the
  plan) in the dry-run report. Worktree/run path display stays bare-keyed here.

### Planned files to create

- `tests/unit/registryNamespace.test.ts`

### Planned files to edit

- `src/schemas/registry.ts`
- `src/schemas/status.ts`
- `src/app/registry.ts`
- `src/app/runFolder.ts`
- `src/domain/runReviewInfo.ts`
- `src/app/resolveRunInfo.ts`
- `src/app/effectRunner.ts`
- `src/cli/commands/run.ts`
- `src/app/archive.ts`
- `src/app/dryRun.ts`
- `tests/unit/schemas.test.ts`
- `tests/unit/runArgv.test.ts`
- `tests/unit/dryRun.test.ts`

### Optional files that may be edited

- `src/app/dispatcher.ts`
- `src/app/eventAdapter.ts`
- `src/app/phaseStatusUpdates.ts`
- `tests/unit/runFolder.test.ts`
- `tests/unit/cli/run.test.ts`
- `tests/unit/resolveRunInfo.test.ts`

### Boundary contracts

Producer: persistence schemas + writers stamping `namespace`; `phax run` enforces
and stamps it. Consumer: resolution and listings (phases 04–08). Stable shape:
`RegistryEntry` and `RunStatus` both carry required `namespace: string`; registry
rows are unique by `(namespace, shortName)`; a new run is created with a namespace
or `phax run` fails fast.

### Test strategy

- Unit (write before implementation, `tests/unit/registryNamespace.test.ts`):
  `upsertRun`/`setRunStatus` keep two same-`shortName` rows in different
  namespaces distinct and update the correct one.
- Unit (`tests/unit/schemas.test.ts`): decode of `RegistryEntry` / `RunStatus`
  requires `namespace` and rejects a blob without it.
- Unit (write before implementation, `tests/unit/runArgv.test.ts` /
  `tests/unit/cli/run.test.ts`): missing namespace → fast failure with the spec
  message and no run folder created; namespace-scoped uniqueness bumps within a
  namespace and never overwrites an existing folder; run output is qualified.
- Unit (`tests/unit/dryRun.test.ts`): dry-run output shows the qualified name.

### Implementation order

Schemas → registry keying → `RunReviewInfo` namespace field + loader → `createRunFolder`
stamping → `run` gate + uniqueness + output → other `setRunStatus` callers
(`archive`, `effectRunner`) → dry-run → tests.

### Excluded scope

- Resolving existing-run references (phases 04–05).
- Moving folders / locks to qualified keys (phases 06–07).
- Listing columns (phase-08).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The required `namespace` field on both schemas (version stays `1`), the new
  `RunReviewInfo.namespace` field, and the `upsertRun` / `setRunStatus` /
  `createRunFolder` signature changes.
- That every `setRunStatus` caller (`archive`, `effectRunner`) now passes the
  namespace, and where each reads it from (`cmd.info.namespace` for effectRunner).
- The `phax run` failure message + exit code for missing namespace and for
  not-a-PHAX-project, and the registry-scoped + no-overwrite uniqueness rule.
- Which optional status-writer files were actually touched, and any deviation
  from the planned file lists with the reason.

### Commit subject

feat(run): require and persist a project namespace for every run

### Commit body

Add a required `namespace` to registry entries and run-status in place (version
stays 1, no upgrader — pre-public), surface it on `RunReviewInfo`, key the
registry index by (namespace, shortName), and stamp the namespace at creation
(including the `effectRunner` review_open transition). `phax run` now fails fast with
the spec message outside a PHAX project or without a namespace, scopes short-name
uniqueness to the namespace via the registry (covering archived runs) while never
overwriting an existing folder, and prints qualified run names. Covered by
registry, schema, run-argv, and dry-run unit tests.

---

## phase-04 — Run-reference resolver and resume adoption {#phase-04-run-ref-resolver}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** high

Add the shared resolver that turns a user run reference into a **located run**
under the local-default / qualified-explicit / reject-unqualified-outside rules,
scope `last` selection per namespace, and adopt it in `phax resume`. The resolver
reads the registry (which carries `namespace` from phase-03) and is independent of
the on-disk folder layout, so it lands before the key flips. It returns the loaded
`RunReviewInfo` so consuming commands never call `resolveRunByShortName`
themselves (keeping them untouched when the folder key flips in phase-06).

### Detailed instructions

- Add `src/app/resolveRunRef.ts` exporting a resolver that, given the raw user
  argument, the loaded config (maybe `undefined`), and the state root from
  `effectiveStateRoot`, returns the located run
  (`{ namespace, shortName, info: RunReviewInfo }`) or a typed refusal:
  - Parse the argument with `parseRunRef` (phase-02).
  - **Unqualified inside a project**: combine with `requireNamespace(config)` →
    resolve `(ns, short)` (spec §6.3, Example 1/2). Do not search other
    namespaces.
  - **Unqualified outside a project** (no config / no namespace): refuse with the
    ambiguity variant, listing matching qualified candidates from the registry
    (spec §8 "clear ambiguity errors", Example 4).
  - **Qualified** (in or out of a project): resolve the exact `(ns, short)` via the
    registry; if it cannot be located safely, refuse with the spec §6.9 / Example
    5 message ("run from the owning repository"). Expose whether the explicit
    namespace differs from the current project's so the caller can print the
    target before acting (spec §6.9).
  - Refusal variants: `ambiguous-outside-project` (with candidates), `not-found`,
    `unresolvable-qualified` — each carrying the text the command renders.
  - Internally load the run via the existing (still bare-keyed) reader; in
    phase-06 that reader becomes qualified and the resolver passes the namespace.
- Rewire `src/cli/commands/resume.ts` to resolve via `resolveRunRef` instead of
  bare `decodeShortName`, consume the returned `info`, and print
  `runKey(namespace, shortName)` everywhere it currently prints the short name
  (banner, pause / resume-instruction hints, completion line). `resume` takes an
  explicit run reference (there is no `resume-last`), so it does not use the
  `last` selector — that lands with its `-last` consumers in phase-05. In this
  phase `resume` still passes the bare `shortName` to `executePlan`,
  `setRunInterruptContext`, and `withRunLock` (their signatures gain a namespace
  in phases 06–07); the resolved namespace is used for display only here.

### Planned files to create

- `src/app/resolveRunRef.ts`
- `tests/unit/resolveRunRef.test.ts`

### Planned files to edit

- `src/cli/commands/resume.ts`
- `tests/unit/resumeArgv.test.ts`

### Optional files that may be edited

- `src/app/resolveRunInfo.ts`
- `src/app/resume.ts`
- `tests/unit/resume.test.ts`

### Boundary contracts

Producer: `resolveRunRef` (raw arg + config? + state root → located run | typed
refusal). Consumer: `resume` now, every other existing-run command in phase-05.
Stable shape: one resolver enforces the local-default / qualified-explicit /
reject-unqualified-outside rules and returns the loaded `RunReviewInfo`, so
commands neither re-implement the rules nor touch the folder reader directly.
`resolveRunRef` calls the existing (still bare-keyed) folder reader internally;
phase-06 makes that reader qualified and the resolver passes the namespace.

### Test strategy

- Unit (write before implementation, `tests/unit/resolveRunRef.test.ts`):
  - unqualified inside project resolves to the current namespace and ignores a
    same-short-name run in another namespace;
  - unqualified outside project refuses and lists qualified candidates;
  - qualified resolves the exact run; unresolvable qualified refuses with the
    owning-repository message.
- Unit (`tests/unit/resumeArgv.test.ts`): resume accepts both bare and qualified
  forms and prints the qualified name.

### Implementation order

`resolveRunRef` → resume adoption → tests.

### Excluded scope

- The namespace-scoped `last` selector and adopting the resolver in the other
  commands (phase-05).
- Flipping the folder/lock keys (phases 06–07).
- `phax ls` / global reconciliation columns (phase-08).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The `resolveRunRef` signature, its return shape (`{ namespace, shortName, info }`
  | refusal), the resolution branches, and the refusal variants + messages —
  phase-05 wires every other command to these.
- That the namespace-scoped `last` selector is deferred to phase-05 (resume has no
  `-last`).
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(cli): add run-reference resolver and adopt it in resume

### Commit body

Introduce a shared run-reference resolver that returns the located run: unqualified
names resolve against the current project namespace, qualified names resolve
exactly (including outside a project via the global registry), and unqualified
names outside a project are refused with qualified candidates. Adopt it in `phax
resume`, which now accepts both forms and prints qualified names. Covered by
resolver and resume-argv unit tests.

---

## phase-05 — Adopt the resolver across the remaining run commands {#phase-05-resolver-fanout}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Add the namespace-scoped `last` selector and wire every remaining existing-run
command to it and to the phase-04 resolver, consuming the returned run info and
normalizing output to qualified names. Apart from the one `last` helper this is a
mechanical fan-out.

### Detailed instructions

- Add the namespace-scoped `last` selector: change `resolveLastReviewOpenRun` in
  `src/app/resolveRunInfo.ts` to take the current namespace and filter registry
  candidates to it (spec §6.11); a global last is out of scope. Its callers
  (`enter`, `path`, `open`, `shell`, `archive`) are all rewired in this same phase,
  so the signature change does not strand any caller.
- Replace each command's bare `decodeShortName` + `resolveRunByShortName` (or
  `resolveLastReviewOpenRun`) with `resolveRunRef` / the scoped `last` selector,
  consume `info`, and print `runKey(namespace, shortName)` everywhere a run
  identity is shown (spec §6.5, §6.10, §8). Commands:
  - `src/cli/commands/enter.ts` (incl. `enter-last`)
  - `src/cli/commands/sessionInfo.ts`
  - `src/cli/commands/path.ts` (incl. `path-last`)
  - `src/cli/commands/shell.ts` (incl. `shell-last`)
  - `src/cli/commands/open.ts` (incl. `open-last`)
  - `src/cli/commands/enterPhase.ts`
  - `src/cli/commands/reviewHandoff.ts`
  - `src/cli/commands/publishPr.ts`
  - `src/cli/commands/resetPhase.ts` (targets an existing run — spec §6.10)
  - `src/cli/commands/archive.ts` (incl. `archive-last`) — resolve the reference,
    display the qualified name, and pass the resolved `shortName` to the `archive`
    app function (whose signature still takes only a short name until phase-06).
- For `*-last` variants, pass the current project namespace into the scoped `last`
  selector and surface the spec §6.11 wording
  (e.g. `Entering last run for <namespace>: <namespace>.<short>`).
- For qualified references whose namespace differs from the current project, print
  the explicit target before acting (spec §6.9), using the signal the resolver
  result exposes.
- Keep each command thin: parse arg → resolver → render via `OutputPort`; no new
  business logic in the command files (cli-view-layer rule).

### Planned files to create

- (none)

### Planned files to edit

- `src/app/resolveRunInfo.ts`
- `src/cli/commands/enter.ts`
- `src/cli/commands/sessionInfo.ts`
- `src/cli/commands/path.ts`
- `src/cli/commands/shell.ts`
- `src/cli/commands/open.ts`
- `src/cli/commands/enterPhase.ts`
- `src/cli/commands/reviewHandoff.ts`
- `src/cli/commands/publishPr.ts`
- `src/cli/commands/resetPhase.ts`
- `src/cli/commands/archive.ts`

### Optional files that may be edited

- `src/app/resetPhase.ts`
- `tests/unit/cli`
- `tests/integration`

### Boundary contracts

Producer: the namespace-scoped `last` selector (in `resolveRunInfo.ts`). Consumer:
every remaining existing-run command, plus phase-04's `resolveRunRef`. Stable
shape: each command delegates all reference resolution to the resolver / scoped
`last` selector, consumes the returned `info`, and normalizes its output to the
qualified name; no command re-derives namespace rules or reads the run folder
directly.

### Test strategy

- Unit/argv (write before implementation for the higher-traffic commands): `enter`
  and `path` accept bare and qualified forms and print qualified names; `*-last`
  selects within the current namespace and prints the §6.11 wording.
- Integration/smoke: `archive` of a qualified reference targets the right run;
  `reset-phase` resolves a qualified reference.

### Implementation order

`enter`/`path` (representative single + `-last` pair) → remaining commands →
tests.

### Excluded scope

- Flipping the folder/lock keys (phases 06–07); the `archive` app signature still
  takes only a short name until phase-06.
- `phax ls` / global reconciliation columns (phase-08).
- The reference-resolution algorithm itself (it lives in phase-04's
  `resolveRunRef`); this phase only adds the scoped `last` selector and fans the
  resolver out.

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The list of commands rewired and confirmation each consumes `info`, prints
  qualified names, and uses the namespace-scoped `last` selector.
- The exact `*-last` wording chosen for spec §6.11.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(cli): resolve run references by namespace across all run commands

### Commit body

Wire enter(-last), session-info, path(-last), shell(-last), open(-last),
enter-phase, review-handoff, publish-pr, reset-phase, and archive(-last) to the
shared run-reference resolver and the namespace-scoped `last` selector, consuming
the located run info and normalizing all output to qualified run names. No new
resolution logic — this is the fan-out of the phase-04 contract. Covered by
per-command argv tests and archive/reset-phase smoke tests.

---

## phase-06 — Key run, worktree, and archive folders by qualified name {#phase-06-qualified-folder-keys}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** high

Flip the on-disk key for run folders, worktrees, archive entries, and the
interrupt-write path from the bare short name to the qualified run name
`runKey(namespace, shortName)`. Every caller already carries the namespace
(threaded by phases 03–05), so this is the mechanical key flip plus the signature
changes it forces. No data migration is performed (pre-public).

### Detailed instructions

- Introduce a single path helper (e.g. in `src/app/runFolder.ts` or a new
  `src/app/runPaths.ts`) that builds `runs/<key>`, `worktrees/<key>/...`, and
  `archive/<key>` from `runKey(namespace, shortName)`. Route all run/worktree/
  archive path construction through it. (Lock paths move in phase-07.)
- `src/app/resolveRunInfo.ts`: change `resolveRunByShortName` to resolve by
  `(namespace, shortName)` (rename to e.g. `resolveRunByKey`/`resolveRun`), and
  do the same for `resolvePhaseInfo` and `resolveLastReviewOpenRun` (already
  namespace-scoped from phase-05, with the namespace available per entry).
  `resolveRunRef` passes the namespace it resolved. Note `resolveLastReviewOpenRun`
  has a no-registry filesystem-scan fallback that iterates raw folder names — once
  folders are qualified, that branch must `parseRunKey` each folder name to recover
  the `(namespace, shortName)` it filters on (the registry path already has the
  namespace per entry).
- Update the remaining direct callers — all of which now have the namespace in
  scope — to pass it:
  - `src/app/executePlan.ts` (two `resolveRunByShortName` call sites + worktree
    paths) — take the run's namespace as a parameter from `run`/`resume`.
  - `src/app/resetPhase.ts` and `src/app/resume.ts` (`inspectResume`) — accept the
    namespace from their callers (resolved in phases 04–05).
  - `src/app/archive.ts` — run/worktree/archive paths via the helper; the
    `archive` app signature gains a namespace (the CLI passes the resolved one
    from phase-05).
  - `src/app/worktree.ts` — worktree paths via the helper.
  - `src/cli/commands/ls.ts` — the reconcile path builds the key from each entry's
    `(namespace, shortName)` (display columns stay in phase-08).
- `src/app/runFolder.ts`: `createRunFolder` writes the run folder at the qualified
  path.
- Interrupt path: change `setRunInterruptContext` in `src/cli/interruptHandler.ts`
  to carry the namespace and build `runs/<key>/run-status.json`; update its two
  callers `src/cli/commands/run.ts` and `src/cli/commands/resume.ts` to pass the
  namespace they already hold.
- `src/app/dryRun.ts`: worktree/run path display uses the qualified key.
- Thread the namespace from the CLI into the app/readers that gain a key:
  `src/cli/commands/archive.ts` (both call sites → `archive` app), and
  `src/cli/commands/resetPhase.ts` (→ `resetPhase` app), and
  `src/cli/commands/enterPhase.ts` (→ `resolvePhaseInfo`). Each already resolved
  the namespace in phase-05, so this is a one-argument change per call site.

### Planned files to create

- (none)

### Planned files to edit

- `src/app/runFolder.ts`
- `src/app/resolveRunInfo.ts`
- `src/app/resolveRunRef.ts`
- `src/app/executePlan.ts`
- `src/app/resetPhase.ts`
- `src/app/resume.ts`
- `src/app/archive.ts`
- `src/app/worktree.ts`
- `src/app/dryRun.ts`
- `src/cli/interruptHandler.ts`
- `src/cli/commands/run.ts`
- `src/cli/commands/resume.ts`
- `src/cli/commands/ls.ts`
- `src/cli/commands/archive.ts`
- `src/cli/commands/resetPhase.ts`
- `src/cli/commands/enterPhase.ts`
- `tests/unit/resolveRunInfo.test.ts`

### Optional files that may be edited

- `src/app/runPaths.ts`
- `tests/integration/archive.test.ts`
- `tests/unit/architecturalGuards.test.ts`

### Boundary contracts

Producer: qualified-key path helper for run/worktree/archive folders + the
re-keyed `resolveRunByKey` / `resolvePhaseInfo` / `resolveLastReviewOpenRun` and
`setRunInterruptContext`. Consumer: every folder reader/writer and the interrupt
handler. Stable shape: every run/worktree/archive path and the interrupt write
derive from `runKey(namespace, shortName)`. The `Lock` key is out of scope here
(phase-07).

### Test strategy

- Unit (write before implementation, `tests/unit/resolveRunInfo.test.ts`):
  resolution finds a run by its qualified key, and two runs with the same short
  name in different namespaces resolve to distinct folders.
- Integration: archive of a namespaced run targets the qualified archive path; a
  created run's folder is at `runs/<namespace>.<shortName>`.

### Implementation order

Path helper → `resolveRunInfo` readers re-keyed → app-internal callers
(`executePlan`, `resetPhase`, `resume`, `archive`, `worktree`) → `createRunFolder`
+ `resolveRunRef` → interrupt context + its callers → `dryRun` → tests.

### Excluded scope

- The `Lock` port keying (phase-07).
- Listing display columns (phase-08).
- Migration/relocation of pre-existing folders (de-scoped pre-public).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The path-helper module/function and the qualified-key format.
- The re-keyed signatures (`resolveRunByKey`/`resolvePhaseInfo`/
  `resolveLastReviewOpenRun`, `archive`, `executePlan`, `setRunInterruptContext`)
  so the lock phase and tests match.
- Any deviation from the planned file lists, with the reason (the architectural
  guard test is optional because the interrupt-handler allowlist may need a touch).

### Commit subject

feat(run): key run, worktree, and archive folders by qualified name

### Commit body

Route run, worktree, archive, and interrupt-write paths through a qualified-key
helper built from `<namespace>.<shortName>` so two projects' identically named
runs no longer collide on disk. Re-key the run-folder readers and thread the
namespace through every caller (executePlan, resetPhase, resume, archive,
worktree, the interrupt context, and createRunFolder). No migration of
pre-existing folders is performed (pre-public). Covered by resolution unit tests
plus an archive integration test.

---

## phase-07 — Key the run lock by qualified name {#phase-07-qualified-lock-key}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Re-key the run lock from the bare short name to the qualified run name so two
projects' identically named runs acquire independent locks. A focused `Lock` port
signature change plus its callers and fake; every caller already has the namespace
from phases 03–06.

### Detailed instructions

- `src/ports/lock.ts`: change the `Lock` operations (`acquire`, `renew`,
  `release`, `status`) to take the qualified run key rather than a `ShortName`.
  The simplest stable shape is an opaque key string produced by `runKey`
  (optionally a `RunLockKey` brand); update the `LockFile` schema's identifying
  field to store the qualified key.
- `src/infra/lock.ts`: `lockFilePath` keys `locks/<key>.lock` by the qualified
  key; update `classifyLock` / messages to reference the qualified name.
- `src/infra/fakes/lock.ts`: mirror the signature change so tests compile.
- Update lock callers to pass the qualified key (all have the namespace now):
  - `src/app/lock.ts` (`withRunLock`) — accept `(namespace, shortName)` or the
    pre-computed key and thread it to the port; update its two callers
    `src/cli/commands/run.ts` and `src/cli/commands/resume.ts`.
  - `src/app/archive.ts` — the `lock.status` call and the `lockPath` string in
    `LockConflictError` use the qualified key.
  - `src/cli/commands/ls.ts` — the reconcile path's `lock.status` lookup builds
    the key from each entry's `(namespace, shortName)`.
  - `src/cli/commands/unlock.ts` — resolve the reference via `resolveRunRef` (it
    targets an existing run) and release the qualified-key lock.
- Keep the change mechanical: no behavioral change beyond the key the lock scopes
  to.

### Planned files to create

- (none)

### Planned files to edit

- `src/ports/lock.ts`
- `src/infra/lock.ts`
- `src/infra/fakes/lock.ts`
- `src/app/lock.ts`
- `src/app/archive.ts`
- `src/cli/commands/run.ts`
- `src/cli/commands/resume.ts`
- `src/cli/commands/ls.ts`
- `src/cli/commands/unlock.ts`
- `tests/unit/lock.test.ts`

### Optional files that may be edited

- `tests/integration/archive.test.ts`
- `tests/unit/architecturalGuards.test.ts`

### Boundary contracts

Producer: `Lock` port keyed by the qualified run key. Consumer: every lock caller
(`withRunLock` via run/resume, archive, ls reconcile, unlock). Stable shape: lock
operations are scoped per `runKey(namespace, shortName)` so cross-project
short-name collisions never share a lock; the lock file records the qualified key.

### Test strategy

- Unit (write before implementation, `tests/unit/lock.test.ts`): two
  same-short-name runs in different namespaces acquire independent locks; acquire/
  status/release operate on the qualified key; the lock file records it.
- Integration: archive's active-lock refusal keys off the qualified lock.

### Implementation order

Port signature + `LockFile` field → infra adapter → fake → callers
(`withRunLock` + run/resume, archive, ls, unlock) → tests.

### Excluded scope

- Listing display columns (phase-08).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact `Lock` port signature, the key type passed (string vs. brand), and the
  `LockFile` identifying field name.
- How `withRunLock` now receives the namespace/key and which callers were updated.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(lock): scope the run lock by qualified run name

### Commit body

Change the Lock port to key acquire/renew/release/status by the qualified run name
`<namespace>.<shortName>` and record it in the lock file, so two projects'
identically named runs no longer share a lock. Update the infra adapter, the fake,
and all callers (withRunLock via run/resume, archive, ls reconcile, unlock).
Covered by lock unit tests and an archive integration test.

---

## phase-08 — Listings show qualified names {#phase-08-qualified-listings}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Make `phax ls` and the global reconciliation listing expose the qualified run name
as the primary, copyable identity, with namespace visible, so users can copy a
name straight into a resume-like command.

### Detailed instructions

- In `src/cli/commands/ls.ts`:
  - Add `namespace` to `LsRow` (from the registry entry, now required) and make
    the primary `NAME` column the qualified name `runKey(namespace, shortName)`
    (spec §6.6, Example 3). Optionally keep separate `NAMESPACE` / short-name
    columns, but the qualified name must be present and copyable.
  - Show the project identity column from the registry entry's `projectName`
    (already persisted). A repository **path** column is best-effort and out of
    scope unless already available — omit gracefully (spec §6.6 "when available").
  - In `--json` output, add `namespace` and a `qualifiedName` field so scripts get
    the canonical identity.
- Update the global reconciliation output
  (`src/app/generateGlobalReconciliation.ts` and/or
  `src/domain/reconciliation/global.ts`) so any run identity it prints is the
  qualified name (spec §6.13).

### Planned files to create

- (none)

### Planned files to edit

- `src/cli/commands/ls.ts`
- `src/app/generateGlobalReconciliation.ts`
- `tests/unit/cli/ls.test.ts`

### Optional files that may be edited

- `src/domain/reconciliation/global.ts`
- `src/domain/reconciliation/render.ts`
- `tests/unit/reconciliation`

### Boundary contracts

Consumer: `phax ls` and global reconciliation render the qualified name from the
registry's `(namespace, shortName)`. Producer: phase-03 registry namespace +
phase-02 `runKey`. Stable shape: the primary visible identity is the qualified
name; JSON exposes `namespace` and `qualifiedName`.

### Test strategy

- Unit (write before implementation, `tests/unit/cli/ls.test.ts`): the table's
  primary identity is `<namespace>.<shortName>`, two same-short-name runs in
  different namespaces both appear distinctly, and `--json` includes `namespace`
  and `qualifiedName`.
- Unit: global reconciliation renders qualified names.

### Implementation order

`ls` row/columns/JSON → global reconciliation → tests.

### Excluded scope

- A repository-path column requiring new persisted metadata (best-effort /
  follow-up).
- Any new filtering flags or registry UI beyond qualified-name display
  (non-goals, spec §10).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The final `ls` column layout and JSON field names (`namespace`,
  `qualifiedName`).
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(ls): show qualified run names as the primary identity

### Commit body

`phax ls` and the global reconciliation listing now show the qualified run name
`<namespace>.<shortName>` as the primary, copyable identity and expose `namespace`
and `qualifiedName` in JSON output. Two runs sharing a short name across projects
are now unambiguous in listings. Covered by ls and reconciliation unit tests.
