# Plan — Decouple manual `publish-pr` from the publish config flag

## Overview

Today `phax publish-pr <run>` refuses to run unless `phax.json` contains a
`publish` block with the flag turned on:

```
$ phax publish-pr steme-lab.steme-lab
publish is not enabled in phax.json. Add a "publish": { "enabled": true } block
to phax.json to use this command.
```

That gate is wrong for a **manual** invocation. If a developer types
`phax publish-pr` against a `review_open` run, they have already expressed the
intent to publish — requiring a config flag on top of the explicit command is
redundant friction. The config flag should govern **automatic** publishing only:
"when a run reaches review, push the branch and open a PR without me asking."

### Current behavior (three gates on one flag)

Both the manual and automatic paths gate on the same `publish.enabled`:

- **Manual** — `src/cli/commands/publishPr.ts:41-47` hard-errors and returns
  exit 1 when `!config.publish.enabled`, and `publishPr.ts:81-87` re-emits the
  same error if `publishRun` returns `{ kind: "disabled" }`.
- **Automatic** — `src/app/executePlan.ts:913` calls `publishRun` after the
  final phase only when `config.publish?.enabled`; failure there is non-fatal and
  the run stays `review_open`.
- **Inner** — `src/app/publishRun.ts:63-65` short-circuits to
  `{ kind: "disabled" }` when `!publish.enabled`, a redundant third gate that
  exists only because the manual path forwards the resolved config in.

All the *other* publish settings already default in
`resolvePublishConfig` (`src/schemas/phaxConfig.ts:26-36`): `remote` →
`"origin"`, `provider` → `"github"`, `pushBranch`/`createPullRequest` → `true`.
So a manual publish can run with **no `publish` block at all** once the flag gate
is removed — the precondition checks in `publishRun` (branch exists, remote
configured, `gh` available and authenticated) still protect against a misconfigured
environment.

### Decisions locked in

- **The config flag governs auto-publish only.** Manual `phax publish-pr`
  ignores it and always proceeds (subject to the existing `review_open` state
  check and `publishRun` preconditions).
- **Rename `publish.enabled` → `publish.auto`.** The flag now means "publish
  automatically when a run reaches review," and the name should say so. This is a
  breaking schema change with **no back-compat shim** — `publish.enabled` will no
  longer decode (`onExcessProperty: "error"`). Existing `phax.json` files with
  `publish.enabled` must be edited to `publish.auto`.
- **`publication.json`'s `enabled` field is out of scope.** That field on the
  persisted `PublicationRecord` (`src/domain/publish/types.ts:6`,
  `src/schemas/publication.ts:19`) records the publication artifact, not config; a
  record is only ever written when publishing actually runs, so the hardcoded
  `enabled: true` in `publishRun`'s `baseRecord` stays as-is. Cleaning it up is a
  separate concern.

### Phase ordering

`phase-01` delivers the user-visible behavior (manual publish no longer needs the
flag) while the flag keeps its current `enabled` name. `phase-02` is the
semantic rename (`enabled` → `auto`) across the schema, config merge, init
wizard, and docs. The two are independently committable; phase-02 does not depend
on phase-01 touching the same lines.

## Required commands

- (none)

## phase-01 — Manual publish-pr ignores the publish flag {#phase-01-manual-ignores-flag}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Make `phax publish-pr` always attempt publication for a `review_open` run,
regardless of the config flag, and remove the now-dead `"disabled"` publication
result path. The automatic path in `executePlan` keeps its `config.publish?.enabled`
guard (renamed in phase-02); this phase does not touch the auto gate's condition.

### Detailed instructions

- In `src/cli/commands/publishPr.ts`:
  - Delete the `if (!config.publish.enabled) { … return 1; }` block
    (lines 41-47). The `review_open` state check (lines 60-66) and everything
    after it stay.
  - Delete the `if (publication.kind === "disabled") { … return 1; }` block
    (lines 81-87), since `publishRun` will no longer return that kind.
- In `src/app/publishRun.ts`:
  - Delete the early return `if (!publish.enabled) { return { kind: "disabled" }; }`
    (lines 63-65).
  - Remove `"disabled"` from the `PublicationResultKind` union (line 26) so the
    type reflects the two reachable outcomes (`"published" | "failed"`).
  - Leave `baseRecord.enabled: true` (line 103) untouched — see Excluded scope.
- `publishRun` still reads `publish.remote`, `publish.pushBranch`,
  `publish.createPullRequest`, `publish.baseBranch`, `publish.title` from the
  resolved config; those are unchanged and fully defaulted, so a missing
  `publish` block yields a valid resolved config.

### Planned files to create

- (none)

### Planned files to edit

- `src/cli/commands/publishPr.ts`
- `src/app/publishRun.ts`
- `tests/unit/cli/publishPr.test.ts`
- `tests/integration/publishRun.test.ts`

### Optional files that may be edited

- `tests/integration/executePlan.test.ts`

### Boundary contracts

CLI (`publishPr`) → application (`publishRun`): the command no longer pre-filters
on the flag; it forwards the resolved `publish` config and the `review_open`
`RunReviewInfo` and renders whatever `PublicationResult` comes back. The contract
shrinks: `publishRun` now returns only `"published" | "failed"`, never
`"disabled"`.

### Test strategy

- Unit (`tests/unit/cli/publishPr.test.ts`): remove the assertion that a missing
  / disabled `publish` block produces the "publish is not enabled" error and exit
  1. Add a case proving that with **no `publish` block** (or the flag off) the
  command proceeds to `publishRun` for a `review_open` run. Keep the `review_open`
  state-guard test.
- Integration (`tests/integration/publishRun.test.ts`): remove any test asserting
  `kind === "disabled"` when the flag is off; confirm `publishRun` attempts
  publication with a default-resolved config. Write these test edits before the
  source edits.

### Implementation order

1. Update the unit/integration tests to the new contract (no "disabled", manual
   always proceeds).
2. Remove the inner gate and `"disabled"` kind in `publishRun.ts`.
3. Remove both gates in `publishPr.ts`.

### Excluded scope

- The `config.publish?.enabled` condition in `src/app/executePlan.ts:1079` — left
  as `enabled` here and renamed in phase-02.
- The `enabled` field on `PublicationRecord` / `publication.json`
  (`src/domain/publish/types.ts`, `src/schemas/publication.ts`) — unchanged.
- Any renaming of the config field (phase-02).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- Confirmation that `PublicationResultKind` is now `"published" | "failed"` and
  that no caller references `"disabled"` (cite `src/app/publishRun.ts:26`).
- The exact lines removed from `publishPr.ts` and `publishRun.ts`.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(publish): let manual publish-pr run without the config flag

### Commit body

Manual `phax publish-pr` no longer requires a `publish` block in phax.json. The
explicit command is intent enough; the config flag is reserved for automatic
publishing on review. Removes the flag gate from the CLI command and the inner
`disabled` short-circuit from publishRun, dropping the now-unreachable
`"disabled"` PublicationResultKind. Tests updated to the two-outcome contract.

## phase-02 — Rename `publish.enabled` to `publish.auto` {#phase-02-rename-enabled-to-auto}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Rename the publish config flag from `enabled` to `auto` across the schema, the
resolved config, the config-layer merge, the init wizard, the auto-publish gate,
and the docs, so the field name states that it governs automatic publishing only.
Breaking change, no back-compat shim.

### Detailed instructions

- `src/schemas/phaxConfig.ts`:
  - `PublishConfigSchema`: rename `enabled: Schema.Boolean` → `auto: Schema.Boolean`
    (line 5). This schema is reused by both `PhaxConfigSchema` and
    `PhaxUserOverlaySchema`, so both pick up the rename.
  - `ResolvedPublishConfig`: rename `readonly enabled: boolean` → `readonly auto: boolean`
    (line 17).
  - `resolvePublishConfig`: `enabled: raw?.enabled ?? false` → `auto: raw?.auto ?? false`
    (line 28).
- `src/domain/config/mergeLayers.ts`: rename the `publishEnabled` merge variable
  to `publishAuto` and read `.auto` from each layer (line ~114), and write it back
  under the `auto` key wherever the merged `publish` block is assembled. Keep the
  per-field scalar-override semantics.
- `src/app/executePlan.ts:1079`: `if (config.publish?.enabled)` → `if (config.publish?.auto)`.
- `src/app/initWizard.ts`: rename the `publishEnabled` answer to `publishAuto`;
  reword the prompt (lines 114-115) to make the auto-only meaning explicit, e.g.
  "Automatically publish (push branch / create PR) when a run reaches review?".
  Update the gating `if (publishEnabled)` (line 121) and the answer object keys
  (lines 136, 147).
- `src/domain/init/buildConfig.ts`: rename `publishEnabled` → `publishAuto`
  (line 7) and emit `publish: { auto: true, … }` instead of `enabled: true`
  (lines 24-28).
- `README.md`: update every `publish.enabled` / `"enabled": true` reference in a
  publish context — the config example (line 122), the auto-publish bullet
  (line 213, `publish.enabled` → `publish.auto`), and the surrounding prose
  (lines 98, 134, 246) so they describe the flag as automatic-publish-on-review.

### Planned files to create

- (none)

### Planned files to edit

- `src/schemas/phaxConfig.ts`
- `src/domain/config/mergeLayers.ts`
- `src/app/executePlan.ts`
- `src/app/initWizard.ts`
- `src/domain/init/buildConfig.ts`
- `README.md`
- `tests/unit/schemas/publishConfig.test.ts`
- `tests/unit/mergeLayers.test.ts`
- `tests/unit/buildConfig.test.ts`
- `tests/integration/initWizard.test.ts`

### Optional files that may be edited

- `tests/unit/cli/run.test.ts`
- `tests/integration/executePlan.test.ts`
- `tests/integration/publishRun.test.ts`

### Boundary contracts

Validation boundary (`src/schemas/phaxConfig.ts`) → domain/app: the decoded
`PublishConfig` now exposes `auto` instead of `enabled`; every consumer
(`resolvePublishConfig`, `mergeLayers`, `executePlan` auto gate, `buildConfig`)
must read/write `auto`. Decoding a legacy `publish.enabled` block fails at the
boundary (`onExcessProperty: "error"`), which is the intended breaking behavior.

### Test strategy

- Unit (`tests/unit/schemas/publishConfig.test.ts`): assert `auto` decodes and a
  block using `enabled` is rejected. Write before the schema edit.
- Unit (`tests/unit/mergeLayers.test.ts`): update the publish-override cases to
  use `auto`.
- Unit (`tests/unit/buildConfig.test.ts`): assert the wizard answers produce
  `publish: { auto: true, … }`.
- Integration (`tests/integration/initWizard.test.ts`): update expectations for
  the reworded prompt and the `auto` output key.
- Grep the suite for any remaining `publish: { enabled` / `publish.enabled`
  fixtures (e.g. `tests/unit/cli/run.test.ts`, `executePlan`/`publishRun`
  integration fixtures) and migrate them to `auto`.

### Implementation order

1. Schema (`phaxConfig.ts`) + its unit test.
2. `mergeLayers.ts` + test.
3. `executePlan.ts` auto gate.
4. `initWizard.ts` + `buildConfig.ts` + their tests.
5. `README.md`.
6. Sweep remaining test fixtures for `enabled` → `auto`.

### Excluded scope

- Manual publish-pr behavior (delivered in phase-01).
- The `enabled` field on `publication.json` — that artifact is unrelated to the
  config flag and keeps its name.
- Any migration helper or back-compat acceptance of `publish.enabled`.

### Verification

- The project's configured `full` gate profile in `phax.json` (typecheck + tests
  + lint + format + knip + architecture audit + build).

### Expected handoff content

- Confirmation that no source or test references `publish.enabled` / the
  `publishEnabled` variable anymore (cite a clean grep).
- The new prompt wording in `initWizard.ts`.
- Any deviation from the planned file lists, with the reason.

### Commit subject

refactor(publish): rename publish.enabled to publish.auto

### Commit body

The publish config flag now governs automatic publishing on review only, so
rename it from `enabled` to `auto` to match. Updates the config schema, resolved
config, config-layer merge, the executePlan auto-publish gate, the init wizard
prompt and buildConfig output, and the README. Breaking change with no back-compat
shim: phax.json files using `publish.enabled` must switch to `publish.auto`.
