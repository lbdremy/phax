# Plan — Content-addressed plan-extraction cache + `.md` loader

## Overview

`phax extract-plan` turns a `plan.md` into a structured `phax-plan.json` by calling
an LLM (`backend.complete` in `extractPlanCore`, `src/app/extractPlan.ts:135`).
That call is the **only non-deterministic, token-costing step** in phax — every
other step is deterministic. Today it re-runs from scratch every time, and the
structured `phax-plan.json` only exists *after* you run it, so any tool that wants
the structured plan (the upcoming `plans-overlap` / `adjust-plan` commands, and
`phax run` itself) either re-extracts or forces the user to extract first.

This plan adds a **content-addressed cache** of extractions keyed by the hash of
the `plan.md` (plus the extraction model/effort and an extractor version), and a
shared `loadOrExtractPlan(planMdPath)` use case that returns the structured plan
from the cache on a hit or extracts-then-caches on a miss. `phax run` and
`phax extract-plan` adopt it, so repeated work across commands reuses one
extraction instead of paying for the LLM again.

This is the **foundation** consumed by the revised plan 37 (`plans-overlap` /
`adjust-plan` accepting `.md`). Plan 37 depends on this plan landing first.

### What is cacheable, and why the split

Inspecting `extractPlanCore`: it reads the md, calls `backend.complete` (the LLM),
decodes the result to an `ExtractedPhaxPlan`, then does **purely deterministic**
post-processing — derive phase titles from the md headings, slugify the
`shortName`, set `branch = phax/<slug>`, detect anchors, collect warnings — to
produce the final `PhaxPlan`. The expensive non-deterministic part is just the LLM
call producing the validated `ExtractedPhaxPlan`; everything after it is a pure
function of `(planMd, ExtractedPhaxPlan)`.

So the cache stores the **`ExtractedPhaxPlan`** (the LLM output) and the finalize
step is re-run on read. This keeps the cached artifact independent of anything
environmental and lets the deterministic finalize evolve without invalidating
cached LLM work.

### Cache design

- **Key.** `sha256(planMd) ⊕ model ⊕ effort ⊕ extractorVersion`, hex. The md
  content is hashed (not its path), so moving/renaming the file is a hit and any
  edit is a miss. `model`/`effort` are included because a different extraction
  model can produce a different result. `extractorVersion` is a code constant
  bumped when the extraction **prompt** changes (the one input a hash of the md
  can't capture).
- **Location.** `<stateRoot>/cache/plans/<key>.json`, written atomically
  (`fs.writeAtomic`), under the existing phax state root (`~/.phax`), beside
  `runs/`.
- **Decode-on-read = free schema invalidation.** The cached entry is decoded
  through a strict schema; if the persisted shape has drifted from the current
  schema, decode fails and the entry is treated as a miss and re-extracted — no
  manual cache-busting for schema changes.
- **Provenance stays separate.** `phax run` still writes its own
  `phax-plan.json` into the run folder as the immutable record of what ran; the
  cache is only the *source* it reads to avoid re-extracting. The two never merge.

### Decisions locked in

- **Cache the `ExtractedPhaxPlan`, re-finalize on read.** Not the merged
  `PhaxPlan` — see the split above.
- **Strict decode-on-read**, no back-compat shim in the cache entry (consistent
  with the project's persisted-schema rule). A stale entry is a miss, not a
  migration.
- **`--refresh` forces a miss** (re-extract and overwrite); **`--no-extract`
  fails on a miss** (for read-only callers that must not spend tokens). Both are
  surfaced by the consuming commands.
- **No eviction policy in this plan.** Entries are content-addressed and small;
  a prune command is a documented follow-up, not in scope.

## Required commands

- pnpm gen:usage-spec
- pnpm docs:cli

These regenerate the derived CLI artifacts after `--refresh` / `--no-cache`
flags are added to `run` / `extract-plan`. They are not part of any gate profile
and `pnpm` is not in `security.agentCommands`, so they are declared here.

## Required PHAX security configuration changes

This plan requires the following commands to be added to `security.agentCommands`
in `phax.json` before running:

- `pnpm gen:usage-spec`
- `pnpm docs:cli`

(Alternatively, add the broad token `pnpm`.) Without this the preflight check
fails before any agent spawns.

---

## phase-01 — Split extraction into an LLM step and a deterministic finalize {#phase-01-split-extract}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Refactor `extractPlanCore` into two composable pieces — the cacheable LLM
extraction and the pure finalize — with no change to its external behavior, so
later phases can cache the LLM output and re-finalize on read.

### Detailed instructions

- In `src/app/extractPlan.ts`, extract two functions from `extractPlanCore`:
  - `extractPlanLlm(planMd: string, opts: { model; effort }): Effect.Effect<ExtractedPhaxPlan, ExtractPlanCoreError, Backend | FileSystem>`
    — builds the extraction prompt (`buildExtractionPrompt`), runs
    `backend.complete` in a temp dir (the existing `acquireUseRelease` block,
    `extractPlan.ts:155-166`), parses/strips the fence, and `decodeExtractedPlan`s
    the result, returning the validated `ExtractedPhaxPlan`. Takes the md **text**
    (not a path) so it is reusable by the cache loader.
  - `finalizeExtractedPlan(extracted: ExtractedPhaxPlan, planMd: string): Either.Either<{ plan: PhaxPlan; warnings: string[]; detectedAnchors: string[] }, PlanValidationError>`
    — the deterministic post-processing currently in
    `extractPlan.ts:189-245`: derive titles from `parsePhaseTitles`, fail on a
    missing title, slugify `shortName`, set `branch = phax/<slug>`, detect anchors,
    collect warnings. Pure (no `Backend`/`FileSystem`).
  - `extractPlanCore` keeps its current signature and behavior, now implemented as:
    read md (its existing `fs.readText`) → `extractPlanLlm` → `finalizeExtractedPlan`
    (raising the `Left` as a failure). Callers (`extractPlan`, `run.ts`) are
    unaffected.
- Keep `finalizeExtractedPlan` where the title/anchor helpers live; if cleaner,
  move it (and the helpers it needs) into a small `src/domain/plan/finalize.ts` —
  but only if that does not pull `Backend`/`FileSystem` into domain. If it must
  stay in `app`, leave it in `extractPlan.ts` and export it.

### Planned files to create

- `tests/unit/extractPlanFinalize.test.ts`

### Planned files to edit

- `src/app/extractPlan.ts`

### Optional files that may be edited

- `tests/integration/extractPlanSealed.test.ts`
- `tests/integration/extractPlanTitles.test.ts`

### Boundary contracts

Internal refactor within the app layer. `extractPlanLlm` (Backend) and
`finalizeExtractedPlan` (pure) compose into the unchanged `extractPlanCore`
contract its callers already depend on. The stable seam is `ExtractedPhaxPlan` in,
`{ plan, warnings, detectedAnchors }` out of finalize — phase-03's cache loader
depends on exactly that seam.

### Test strategy

- Unit (`tests/unit/extractPlanFinalize.test.ts`, before implementation): given a
  fixed `ExtractedPhaxPlan` + a `planMd`, `finalizeExtractedPlan` derives titles,
  slug, and `branch`, and fails on a missing title — no ports needed.
- The existing `extractPlanSealed` / `extractPlanTitles` integration tests must
  still pass unchanged, proving `extractPlanCore`'s behavior is preserved.

### Implementation order

Pull out `finalizeExtractedPlan` (pure) first with its unit test, then
`extractPlanLlm`, then rewire `extractPlanCore` to compose them; confirm the
existing integration tests stay green.

### Excluded scope

- Any caching (phases 02–03) and any caller changes (phase-04).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The `extractPlanLlm` and `finalizeExtractedPlan` signatures and where
  `finalizeExtractedPlan` lives.
- Confirmation `extractPlanCore`'s signature/behavior is unchanged and the
  existing extraction integration tests pass.
- Any deviation from the planned file lists, with the reason.

### Commit subject

refactor(extract): split extraction into LLM step and deterministic finalize

### Commit body

Factor extractPlanCore into extractPlanLlm (the cacheable backend.complete call
returning a validated ExtractedPhaxPlan) and finalizeExtractedPlan (the pure
title/slug/branch/anchor post-processing). extractPlanCore now composes them with
its signature and behavior unchanged, so later phases can cache the LLM output and
re-finalize on read. Covered by a finalize unit test; existing extraction
integration tests unchanged.

---

## phase-02 — Cache key, cache entry schema, and store helpers {#phase-02-cache-store}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Add the content-addressed key, the persisted cache-entry schema, and the
read/write helpers that store an `ExtractedPhaxPlan` under the state root.

### Detailed instructions

- Create `src/domain/planCache/key.ts` (pure): export `EXTRACTOR_VERSION = 1`
  (a code constant, bumped when `buildExtractionPrompt` changes) and
  `planCacheKey(planMd: string, model: string, effort: string, extractorVersion = EXTRACTOR_VERSION): string`
  returning a hex `sha256` over the concatenation (delimited) of those inputs.
  Use `node:crypto`'s `createHash` (deterministic; allowed — only
  `randomUUID`-style nondeterminism is avoided in domain, and a content hash is
  not that).
- Create `src/schemas/extractedPlanCacheEntry.ts`: a `Schema.Struct`
  `ExtractedPlanCacheEntrySchema` with all-required fields —
  `version: Schema.Literal(1)`, `key: Schema.NonEmptyString`,
  `planMdSha256: Schema.NonEmptyString`, `model: Schema.NonEmptyString`,
  `effort: Schema.NonEmptyString`, `extractorVersion: Schema.Number`,
  `extractedAt: Schema.NonEmptyString` (ISO), and
  `extracted: ExtractedPhaxPlanSchema` (reuse the schema exported from
  `src/schemas/phaxPlan.ts`). Export `decodeExtractedPlanCacheEntry`
  (`Schema.decodeUnknownEither`, `onExcessProperty: "error"`) and
  `encodeExtractedPlanCacheEntry` (`Schema.encodeSync`).
- Create `src/app/planCacheStore.ts` with helpers over the `FileSystem` port:
  - `cacheEntryPath(stateRoot: string, key: string): string` →
    `join(stateRoot, "cache", "plans", key + ".json")`.
  - `readCacheEntry(stateRoot, key): Effect.Effect<Option<ExtractedPhaxPlan>, never, FileSystem>`
    — if the file is absent or fails to decode (`decodeExtractedPlanCacheEntry`),
    return `Option.none()` (a miss); on success return `Option.some(entry.extracted)`.
    Decode failure must never throw — a corrupt/stale entry is a miss.
  - `writeCacheEntry(stateRoot, key, entry): Effect.Effect<void, FsError, FileSystem>`
    — `fs.mkdirp` the cache dir, then `fs.writeAtomic` the encoded entry.

### Planned files to create

- `src/domain/planCache/key.ts`
- `src/schemas/extractedPlanCacheEntry.ts`
- `src/app/planCacheStore.ts`
- `tests/unit/planCacheKey.test.ts`
- `tests/unit/extractedPlanCacheEntry.test.ts`
- `tests/integration/planCacheStore.test.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- (none)

### Boundary contracts

Validation boundary: `extractedPlanCacheEntry.ts` decodes the persisted cache
file before its `extracted` payload re-enters the app. Producer/consumer: `key.ts`
provides the content address; `planCacheStore.ts` reads/writes entries via the
`FileSystem` port. Phase-03's loader composes both: key → read (Option) → on
miss, extract + write.

### Test strategy

- Unit `planCacheKey`: stable hex for fixed inputs; different md / model / effort /
  extractorVersion each change the key; same inputs are identical.
- Unit `extractedPlanCacheEntry`: a full entry decodes; a missing field or unknown
  key fails.
- Integration `planCacheStore` (fake or temp `FileSystem`): write-then-read
  round-trips the `ExtractedPhaxPlan`; a missing file is `Option.none`; a
  hand-corrupted entry decodes to `Option.none` (miss), never throws.

### Implementation order

`key.ts` + its test, then the schema + its test, then the store helpers + their
integration test.

### Excluded scope

- The extract-on-miss decision and `--refresh`/`--no-extract` (phase-03).
- Adoption by `run`/`extract-plan` (phase-04).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- `planCacheKey` signature, the `EXTRACTOR_VERSION` value, and what is hashed.
- The `ExtractedPlanCacheEntrySchema` field list and the decoder/encoder names.
- The cache path layout and the read-miss-on-decode-failure guarantee.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(cache): add plan-extraction cache key, entry schema, and store

### Commit body

Add planCacheKey (content address over plan.md + model + effort + extractor
version), the strict ExtractedPlanCacheEntrySchema, and FileSystem-port store
helpers that read/write an ExtractedPhaxPlan under <stateRoot>/cache/plans. A
missing or undecodable entry reads as a miss and never throws, so schema drift
self-invalidates. Covered by key, schema, and store round-trip tests.

---

## phase-03 — `loadOrExtractPlan` cache-aware loader {#phase-03-load-or-extract}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Add the shared use case that returns the structured plan for a `plan.md` from the
cache on a hit, or extracts-and-caches on a miss, honoring `refresh` /
`noExtract`.

### Detailed instructions

- Create `src/app/loadOrExtractPlan.ts` exporting `loadOrExtractPlan(opts)`:
  - `opts`: `{ planMdPath: string; model: string; effort: string; stateRoot: string; nowIso: string; refresh?: boolean; noExtract?: boolean }`.
  - Returns `Effect.Effect<LoadOrExtractResult, ExtractPlanCoreError | PlanValidationError, Backend | FileSystem>`,
    where `LoadOrExtractResult = { plan: PhaxPlan; warnings: string[]; fromCache: boolean }`.
  - Read the md text (`fs.readText`). Compute `key = planCacheKey(planMd, model, effort)`.
  - When `!refresh`, `readCacheEntry(stateRoot, key)`; on `Some(extracted)`, run
    `finalizeExtractedPlan(extracted, planMd)` and return `{ plan, warnings, fromCache: true }`.
  - On a miss (or `refresh`): if `noExtract`, fail with a clear
    `PlanValidationError` ("no cached extraction for <path>; run `phax extract-plan`
    or drop --no-extract"). Otherwise `extractPlanLlm(planMd, { model, effort })`,
    `writeCacheEntry(stateRoot, key, { … extracted, extractedAt: opts.nowIso })`,
    then `finalizeExtractedPlan` and return `{ …, fromCache: false }`.
  - Thread a `nowIso` through `opts` (set at the CLI edge) so the use case stays
    `Date`-free, consistent with the rest of the app layer.
- Do not change `extractPlanCore`; `loadOrExtractPlan` is the cache-aware sibling
  built from the phase-01 pieces.

### Planned files to create

- `src/app/loadOrExtractPlan.ts`
- `tests/integration/loadOrExtractPlan.test.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- (none)

### Boundary contracts

Consumer/producer: `loadOrExtractPlan` consumes a `plan.md` path + the cache and
produces a finalized `PhaxPlan` plus a `fromCache` flag, depending on the
`Backend` (only on a miss) and `FileSystem` ports. It is the single entry point
phase-04 and plan 37 use to obtain a structured plan from a `.md`.

### Test strategy

- Integration (before implementation) with a fake `Backend` (counts
  `complete` calls) + temp/fake `FileSystem`, fixed `nowIso`:
  - Cold miss: extracts once, writes a cache entry, `fromCache: false`.
  - Warm hit: a second call with the same md does **not** call the backend,
    `fromCache: true`, same `plan`.
  - Edited md: changes the key → miss → re-extracts.
  - `refresh: true`: re-extracts even on a warm cache and overwrites.
  - `noExtract: true` on a miss: fails without calling the backend.

### Implementation order

Hit path (read → finalize) first, then the miss path (extract → write → finalize),
then the `refresh`/`noExtract` branches; write the backend-call-counting
integration test alongside.

### Excluded scope

- CLI flags and adoption by `run`/`extract-plan` (phase-04).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The `loadOrExtractPlan` signature, `LoadOrExtractResult` shape, and how
  `nowIso` is injected.
- The exact miss/hit/refresh/noExtract semantics and the backend-call counts the
  test asserts.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(app): add loadOrExtractPlan cache-aware plan loader

### Commit body

Add loadOrExtractPlan, which returns a finalized PhaxPlan for a plan.md from the
extraction cache on a hit or extracts-and-caches on a miss, honoring refresh and
noExtract. It composes extractPlanLlm + finalizeExtractedPlan with the phase-02
store, exposing a fromCache flag. Covered by integration tests asserting backend
calls happen only on cold/refresh/edited misses and never on a warm hit.

---

## phase-04 — Adopt the cache in `phax run` and `phax extract-plan` {#phase-04-adopt}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Route `phax run` and `phax extract-plan` through `loadOrExtractPlan` so they reuse
cached extractions, add `--refresh` / `--no-cache` flags, and regenerate the
derived CLI artifacts.

### Detailed instructions

- `src/cli/commands/run.ts`: replace the direct `extractPlanCore` call
  (`run.ts:182`) with `loadOrExtractPlan({ planMdPath, model: config.extractPlanModel, effort: config.extractPlanEffort, stateRoot: config.stateRoot, refresh: opts.refresh, nowIso: new Date().toISOString() })`.
  Keep writing the resulting `phax-plan.json` into the run folder exactly as today
  (provenance is unchanged). When `fromCache`, `out.log` a short "using cached
  extraction" line. Add a `--refresh` option to the `run` command to force
  re-extraction.
- `src/app/extractPlan.ts`: in the persistent `extractPlan` wrapper, source the
  plan via `loadOrExtractPlan` (passing `stateRoot`, `refresh`) instead of calling
  `extractPlanCore` directly, then write `outPath` + `extract-report.md` as today.
  Thread a `refresh` flag through `ExtractPlanOptions`.
- `src/cli/commands/extractPlan.ts`: add a `--no-cache` / `--refresh` option that
  maps to `loadOrExtractPlan`'s `refresh`. Default behavior reuses the cache.
- Confirm the cache is populated the same way regardless of entry point, so an
  `extract-plan` then a `run` of the same md is a single LLM call.
- Regenerate `phax.usage.kdl` (`pnpm gen:usage-spec`) then `docs/cli/reference.md`
  + README (`pnpm docs:cli`) for the new flags; update `src/cli/cliDocs.ts` if the
  long help should mention caching. Do not hand-edit the generated files.

### Planned files to create

- (none)

### Planned files to edit

- `src/cli/commands/run.ts`
- `src/app/extractPlan.ts`
- `src/cli/commands/extractPlan.ts`
- `src/cli/cliDocs.ts`
- `tests/integration/run.test.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`
- `README.md`

### Optional files that may be edited

- `tests/integration/extractPlanSealed.test.ts`
- `tests/integration/cliProgram.test.ts`

### Boundary contracts

Consumer (cli/app) → producer (app): `run` and `extract-plan` obtain the
structured plan via `loadOrExtractPlan` instead of `extractPlanCore`. The run
folder's `phax-plan.json` remains the provenance record; the cache is only the
source. The `--refresh`/`--no-cache` flags map to the loader's `refresh`.

### Test strategy

- Integration (`tests/integration/run.test.ts`): a run whose md is already cached
  does not invoke the backend (assert via a counting fake `Backend`); `--refresh`
  re-extracts. The run folder still contains a `phax-plan.json`.
- Existing `extractPlanSealed` behavior preserved; if it asserted a backend call,
  update it to account for the cache or clear the cache in setup.
- The `usageSpecDrift` gate validates the regenerated spec for the new flags.

### Implementation order

Wire `extract-plan` (app + command) first, then `run.ts`, then regenerate the
artifacts and update the integration tests; run the `full` gate.

### Excluded scope

- Cache eviction/pruning (documented follow-up).
- The `plans-overlap` / `adjust-plan` consumers (plan 37).

### Verification

- The project's configured `full` gate profile in `phax.json` (includes
  `usageSpecDrift` and the `usage`/spec-lint checks).

### Expected handoff content

- The exact call sites changed in `run.ts` and `extractPlan.ts`, the new
  `--refresh`/`--no-cache` flags, and confirmation the run folder still gets its
  `phax-plan.json`.
- Confirmation an `extract-plan` then `run` of the same md is a single backend
  call, with the test that proves it.
- Confirmation the derived artifacts were regenerated and `usageSpecDrift` passes.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(cli): reuse cached extractions in run and extract-plan

### Commit body

Route phax run and phax extract-plan through loadOrExtractPlan so they reuse a
cached extraction instead of re-calling the LLM, and add --refresh/--no-cache to
force a fresh extraction. The run folder still receives its own phax-plan.json as
the provenance record; the cache is only the source. Regenerates the CLI usage
spec and docs for the new flags. Covered by a run integration test asserting a
warm cache skips the backend and --refresh re-extracts.
