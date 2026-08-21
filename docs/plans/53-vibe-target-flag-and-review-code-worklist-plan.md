---
status: Approved
source-spec: null
approved:
  date: 2026-08-21
  baseline: 02f5770
---
# Vibe target flag and review-code worklist fixes

> Feed this `plan.md` to `phax extract-plan` to produce `phax-plan.json`, then run it
> with `phax run`. No source spec — these are two independent defect fixes carried over
> from `NEXT_STEPS.md` ("Small follow-ups"), each small enough that a spec would add no
> information the plan does not already carry. Same shape as plan 50.

---

## Required commands

- (none)

Both phases use `pnpm` scripts already present in `package.json`; the plan introduces no
new tool, runtime, or CLI. No `## Required PHAX security configuration changes` section
is needed.

---

## Overview

Two unrelated defects, one phase each. They share no files and no concepts, so the phases
are independently committable and could land in either order; phase-01 goes first because
it is a two-line fix that unbreaks a whole provider.

**1. `buildVibeArgs` passes a `--target` flag that `vibe` does not accept.** Found
2026-08-20 while probing provider transcript shapes for spec 29.
`src/infra/providers/mistralVibe.ts:105-115` always appends `--target <model>` to the
argv; vibe 2.13.0 answers `vibe: error: unrecognized arguments: --target` and exits 2, so
**every** `mistral-vibe` phase fails at spawn. The flag has been there since the adapter
was written (`871c40a`, 2026-06-26 — the only commit that ever touched the literal), so
there is no "regression point" to bisect: it was wrong from the start and never exercised,
because `mistral-vibe` ships `enabled: false` (`src/domain/routing/defaults.ts:123`) and no
e2e run covers it. Model selection already works through the env var the same adapter
sets: `spawnVibe` builds `env` with `[entry.modelEnvVar]: modelAlias`
(`mistralVibe.ts:136-139`, `modelEnvVar` defaults to `VIBE_ACTIVE_MODEL` in the provider
config), and the aliases it names (`phax-mistral-medium-3.5-*`) are what
`phax agent setup mistral-vibe --install-model-aliases` writes into `~/.vibe/config.toml`.
So the fix is to **drop the flag**, not to replace it — the env var is the one selection
mechanism, and the argv stops claiming a second.

**2. `phax review-code`'s prompt never carries its worklist.** `prepareCodeReviewSession`
reads `global-file-reconciliation.md` and passes it as `reconciliationMd`
(`src/app/reviewCode.ts:206-210,247-253`), but `buildCodeReviewPrompt` never destructures
it (`src/domain/review/codeReviewPrompt.ts:25`), and the same call site hardcodes
`attentionPoints: []`. The prompt's `## Primary worklist — attention points from
reconciliation` section therefore renders `_No attention points recorded._` on **every**
review, and the md file is read from disk and discarded. The compliance block is the only
real content the prompt has ever carried. The unused field is a used *interface* member,
which is why neither `knip` nor `oxlint` flags it.

The structured data the section was designed for sits one file over:
`global-file-reconciliation.json`, written alongside the md at review time, already
decoded by `phax adjust-plan` through `decodeGlobalFileReconciliation`
(`src/schemas/globalReconciliation.ts:50`, consumed at `src/app/adjustPlan.ts:158-195`).
Its `attentionPoints` array is exactly the per-file worklist — each `GlobalFileEntry`
carries `path`, `status`, and the `plannedInPhases` / `touchedInPhases` /
`optionalInPhases` the prompt's `phaseRef` wants. This phase wires it through and deletes
the md read.

---

## Technical arbitrations

Two arbitrations were settled with the user before the phases were written.

1. **Wire the worklist from `global-file-reconciliation.json`, rather than deleting the
   section.** Knowingly abandoned: the `reconciliationMd` input and the md read — the
   prompt now has a single structured source, decoded through a schema at the boundary
   as the architecture requires. Deleting the section was rejected because it would
   retire the per-file worklist the command was built around while the structured data
   that populates it already exists and already has a decoder.
2. **A missing or undecodable JSON yields an empty worklist, not a refusal.** Same
   leniency the same call site already applies to `compliance-review.json`: render
   `_No attention points recorded._` and continue. Knowingly abandoned: surfacing a
   broken run artifact at review time the way `adjust-plan` does (`kind: "refused"`).
   Refusing was rejected because `review-code` must stay usable on a run whose
   reconciliation was never written (interrupted or older runs), whereas `adjust-plan`
   cannot do anything without it.

---

## phase-01 — Drop the unsupported `--target` flag from the Vibe argv {#phase-01-drop-vibe-target-flag}

**Recommended model:** claude-sonnet-5
**Recommended effort:** low

Make a `mistral-vibe` phase spawn at all: `vibe` rejects `--target` and exits 2 before
reading the prompt, so the adapter currently cannot run a single phase.

### Detailed instructions

- In `src/infra/providers/mistralVibe.ts`, `buildVibeArgs`: remove the two argv entries
  `"--target", options.model`. Leave everything else in the argv untouched and in the same
  order (`-p <prompt>`, `--agent <agent>`, `--output streaming`, security flags, optional
  `--resume <id>`).
- Do **not** change `spawnVibe` or the `env` it builds: `[entry.modelEnvVar]: modelAlias`
  (with `options.model` passed as `modelAlias` from the `runAgent` call at
  `mistralVibe.ts:233`) is now the sole model-selection mechanism, and it already works.
- Add a short comment above the argv literal stating that model selection goes through
  `modelEnvVar` (`VIBE_ACTIVE_MODEL`) and that `vibe` has no `--target` flag, so nobody
  reintroduces it.
- In `tests/unit/providers/mistralVibe.test.ts`:
  - Update the exact-argv expectation (currently lists `"--target", "mistral-large"`) to the
    new argv.
  - Add one assertion that `buildVibeArgs(...)` does not contain `"--target"` for both the
    unsafe and the secure policy — a regression guard that names the defect.
  - If the file has no test pinning that the model alias is *not* in the argv at all, add
    `expect(args).not.toContain("mistral-large")` to the unsafe-policy case to document
    that selection is env-only.
- Search `docs/model-routing.md`, `README.md`, and `docs/cli/` for any mention of a Vibe
  `--target` flag and remove it if present (the 2026-08-21 grep found none — README's
  `--target` hits are `phax skills install --target`, unrelated; leave those alone).

### Planned files to create

- (none)

### Planned files to edit

- `src/infra/providers/mistralVibe.ts`
- `tests/unit/providers/mistralVibe.test.ts`

### Optional files that may be edited

- `docs/model-routing.md`

### Test strategy

Adapter layer → the existing unit tests on the pure `buildVibeArgs` builder are the
cheapest reliable test; no spawn is needed to prove the argv. Write the `not.toContain("--target")`
assertions **first** and watch them fail against the current argv, then drop the flag.

No e2e against a real `vibe` is added: `pnpm test:e2e:real` is run deliberately and
`mistral-vibe` stays `enabled: false` by default. Manual confirmation, if wanted, is
`phax agent setup mistral-vibe --dry-run` plus a one-phase plan with
`--provider-priority mistral-vibe` — out of the gate's scope.

### Implementation order

1. Tests: add the `--target` regression assertions, update the exact-argv expectation.
2. `buildVibeArgs`: remove the two entries, add the comment.
3. Docs sweep for a stray `--target` mention.

### Excluded scope

- Enabling `mistral-vibe` by default or touching `src/domain/routing/defaults.ts`.
- Any change to how `modelEnvVar` is configured or to `phax agent setup mistral-vibe`.
- Adding a real-CLI e2e for Vibe.
- Checking or migrating other Vibe flags (`--agent`, `--output`, `--workdir`,
  `--add-dir`, `--trust`, `--resume`) — only `--target` is known-bad.

### Verification

- The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- The final argv shape `buildVibeArgs` produces (one example for unsafe, one for secure).
- Confirmation that model selection is env-only via `modelEnvVar`, with the
  `spawnVibe` line reference.
- Any deviation from the planned file lists, with the reason (in particular whether
  `docs/model-routing.md` needed a touch).

### Commit subject

fix(vibe): drop the --target flag vibe does not accept

### Commit body

`buildVibeArgs` appended `--target <model>` to every invocation; `vibe` has no such flag
and exits 2 with "unrecognized arguments: --target", so no mistral-vibe phase could spawn.
Model selection already goes through the `VIBE_ACTIVE_MODEL` env var `spawnVibe` sets from
`modelEnvVar`, so the flag is dropped rather than replaced. Present since the adapter was
written; unnoticed because mistral-vibe ships disabled and no e2e exercises it. Unit tests
now assert the flag is absent.

---

## phase-02 — Feed the review-code worklist from the reconciliation JSON {#phase-02-review-code-worklist}

**Recommended model:** claude-opus-4-8
**Recommended effort:** medium

Make `phax review-code`'s `## Primary worklist` section list the files the run actually
flagged, sourced from the structured reconciliation the run already writes, instead of
rendering `_No attention points recorded._` on every review.

### Detailed instructions

- In `src/domain/review/codeReviewPrompt.ts`:
  - Remove `reconciliationMd` from `BuildCodeReviewPromptInput`. It was never read.
  - Keep `attentionPoints` as the worklist input. Widen `phaseRef` semantics rather than
    the type: it stays a `string`, and the app layer formats it (see below). Keep the
    rendered line shape `- **<path>** — status: <status>, phase: <phaseRef>` so the
    existing `codeReviewPrompt.test.ts` expectations keep holding.
  - When the list is empty, keep rendering `_No attention points recorded._` (arbitration 2).
- Add a pure mapping helper in the domain — `toCodeReviewAttentionPoints(reconciliation:
  GlobalFileReconciliation)` in a new `src/domain/review/codeReviewWorklist.ts` — that maps
  `reconciliation.attentionPoints` to `{ path, status, phaseRef }[]`:
  - `path` ← `entry.path`.
  - `status` ← `entry.status` (the `GlobalFileStatus` literal, e.g. `unplanned`,
    `missing`, `action-mismatch`).
  - `phaseRef` ← the sorted, de-duplicated union of `touchedInPhases ∪ plannedInPhases ∪
    optionalInPhases`, joined with `", "`; `"—"` when all three are empty (should not
    happen, but the prompt must never render an empty `phase:`).
  - Preserve the input order; the reconciler already orders `attentionPoints`.
  - Import the `GlobalFileReconciliation` type from `src/schemas/globalReconciliation.ts`
    (domain may depend on schema types; check `audit:architecture` agrees — if it does
    not, declare a structural input type in the helper instead and let the app pass the
    decoded value).
- In `src/app/reviewCode.ts`, new-session branch:
  - Replace the `global-file-reconciliation.md` read with a read of
    `global-file-reconciliation.json` (rename the `GLOBAL_RECONCILIATION_FILENAME`
    constant's value; `reviewCompliance.ts` and `reviewHandoff.ts` keep reading the md for
    their own purposes — do not touch them).
  - Decode it with `decodeGlobalFileReconciliation` exactly like the compliance JSON is
    handled a few lines below: read with `Effect.either`, `JSON.parse` in a `try`, decode
    with `Either`; on **any** failure (absent, unparsable, undecodable) use an empty
    worklist and continue — never refuse (arbitration 2). Do not log or surface the
    failure beyond the empty section; mirror the compliance code path's silence.
  - Pass `attentionPoints: toCodeReviewAttentionPoints(reconciliation)` (or `[]`) and drop
    the `reconciliationMd` key from the `buildCodeReviewPrompt` call.
- Tests:
  - `tests/unit/review/codeReviewWorklist.test.ts` (new): mapping of a three-entry
    fixture (one `unplanned` touched in two phases, one `missing` planned in one phase,
    one `optional-touched`), phase-list union/sort/dedup, `"—"` fallback, empty input →
    empty output.
  - `tests/unit/review/codeReviewPrompt.test.ts`: drop `reconciliationMd` from the base
    input; existing attention-point assertions stay.
  - `tests/integration/reviewCode.test.ts`: the three "new session" cases currently seed
    `global-file-reconciliation.md`; switch them to seed a valid
    `global-file-reconciliation.json` fixture (two attention points) and assert the
    written prompt contains both paths under the worklist heading and **not**
    `_No attention points recorded._`. Add one case with no JSON at all and one with a
    malformed JSON body, both asserting `kind: "ready"` and the empty-worklist sentinel.

### Planned files to create

- `src/domain/review/codeReviewWorklist.ts`
- `tests/unit/review/codeReviewWorklist.test.ts`

### Planned files to edit

- `src/domain/review/codeReviewPrompt.ts`
- `src/app/reviewCode.ts`
- `tests/unit/review/codeReviewPrompt.test.ts`
- `tests/integration/reviewCode.test.ts`

### Optional files that may be edited

- `src/schemas/globalReconciliation.ts`
- `tests/integration/reviewCodeCommand.test.ts`

### Boundary contracts

- **app → domain (prompt builder).** Consumer: `prepareCodeReviewSession` needs a prompt
  string from a worklist. Producer: `buildCodeReviewPrompt({ worktreePath,
  attentionPoints, compliance?, complianceMissing })` — `reconciliationMd` leaves the
  contract. The line shape `- **path** — status: s, phase: p` is stable.
- **schema → domain (worklist mapping).** Consumer: the app holds a decoded
  `GlobalFileReconciliation`. Producer: `toCodeReviewAttentionPoints(reconciliation)`
  returns the prompt's `attentionPoints` shape. Pure; no I/O.
- **app → port (fs).** `fs.readText(join(runPath, "global-file-reconciliation.json"))`,
  failure tolerated. Same `FileSystem` port the call site already uses.

### Test strategy

Domain → unit test on the pure mapping helper, written **first** against the
`GlobalFileEntry` shape. Application → the existing integration tests with the fake
`fs` port, extended with the JSON fixture plus the two degraded cases (absent, malformed);
these are the bug-fix regressions and should be written before the app change. Prompt
builder → the existing unit test, adjusted for the removed field. No CLI-level test is
needed: `src/cli/commands/` is untouched.

### Implementation order

1. Unit test + `codeReviewWorklist.ts` helper.
2. `codeReviewPrompt.ts`: remove `reconciliationMd`; fix its unit test.
3. Integration tests: switch fixtures to JSON, add absent/malformed cases (red).
4. `reviewCode.ts`: JSON read + decode + mapping (green).

### Excluded scope

- Changing what `reviewCompliance.ts` and `reviewHandoff.ts` read — they consume the md
  deliberately and are not part of this defect.
- Changing the reconciler, `GlobalFileReconciliationSchema`, or which entries count as
  attention points.
- Enriching the worklist with compliance data — the compliance block already renders
  separately below it.
- Refusing on a missing JSON (arbitration 2).
- Any CLI or `OutputPort` change.

### Verification

- The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- The final `BuildCodeReviewPromptInput` shape and the `toCodeReviewAttentionPoints`
  signature with its module path.
- How `phaseRef` is formatted (union order, separator, fallback).
- Confirmation that absent and malformed `global-file-reconciliation.json` both yield
  `kind: "ready"` with the empty-worklist sentinel, with the integration test names.
- Whether `audit:architecture` accepted the domain → schema type import or the helper
  had to declare a structural type instead.
- Any deviation from the planned file lists, with the reason.

### Commit subject

fix(review): feed the review-code worklist from the reconciliation JSON

### Commit body

`buildCodeReviewPrompt` accepted a `reconciliationMd` it never read, and
`prepareCodeReviewSession` hardcoded `attentionPoints: []`, so every review-code prompt
rendered "No attention points recorded" under its primary worklist while the
reconciliation md was read and discarded. The worklist is now built from
`global-file-reconciliation.json` — decoded through the existing schema and mapped by a
pure domain helper to path / status / phases — and the dead md input is removed. A missing
or malformed JSON degrades to an empty worklist rather than refusing, matching how the
compliance block is handled. Covered by a unit test on the mapping and integration tests
on the populated, absent, and malformed cases.
