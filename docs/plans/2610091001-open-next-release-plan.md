---
status: Draft
source-spec: docs/specs/2610081603-open-next-release.md
completes-spec: true
---
# Open next release

Implements the Approved spec `open-next-release`. After this plan, a `$schema` stamp names a format's shape, not the build that wrote it. phax stamps every document, request and hint with the format's current stamp: the release that last changed the format, or the opened version while the format has a `next` snapshot. That stamp comes from a per-format table generated into `src/schemas/release.ts` and held to the snapshots by the schemas check. Readers refuse only stamps newer than their running version. The package drops its fallback from `next`. The two answer readers take the current stamp as their lower bound and name the URL they read. The release tooling changes too: between releases the manifests name an opened version, the cut only renames `next` snapshots and appends the ledger, `release.sh` opens the next minor after pushing a tag and offers `--open`, and the site and the workflows accept a ledger that trails the opened version. The last phase opens 0.21.0 by editing the manifests and running the generators, and rewrites `docs/release.md` and the README's account of stamps.

Phases go inside-out and each is green on its own: writers, then a mechanical fixture sweep, then readers, then release tooling, then the opening and the docs. Execution caveat: no phase runs `scripts/release.sh`, `scripts/release-open.ts` or `scripts/release-cut.ts` on the real tree, and none tags, pushes or publishes. The cut and the opening are tested on temporary copies of the tree. `release.sh`'s tag, push and post-release opening are held only by static tests and `bash -n`. The 0.21.0 release is the first time they run for real. This plan implements only this spec: no `gate-report` or `brief-report`, and no change to the shape of `gate-diagnostics` or `brief-answer`.

## Required commands

- (none)

The plan adds no new command. Phases run `pnpm exec tsx scripts/schemas-check.ts --write`, `pnpm gen:usage-spec` and `pnpm docs:cli`, which `security.agentCommands` already allows, plus the `standard` gate profile. No phase runs `scripts/release.sh`.

## Technical arbitrations

- Stamp table (§9 Q4): `CURRENT_STAMPS` in the generated `src/schemas/release.ts`, one X.Y.Z per format id with `next` resolved to the opened version, plus a `currentSchemaUrl(formatId)` helper in `src/schemas/persisted.ts` that every writer, the gate hint and the answer refusals use. Loss accepted: a second generated copy of the shape names beside `CURRENT_SHAPES`, which the schemas check holds equal.
- Spelling of `--open`: `scripts/release.sh --open <X.Y.Z>`. Its file logic lives in a new `scripts/release-open.ts`, tested on copies like the cut and called by `release.sh` both by hand and after a release. Loss accepted: one more script module beside `release-cut.ts`, sharing its manifest and ledger helpers.
- `--open` commits only. The opening that `release.sh` makes after pushing a tag also pushes (§5.12). Abandons: a one-command re-opening that reaches origin. A hand re-opening is followed by `git push` or a pull request, and the failure remedy names both steps. Pushing from `--open` would push whatever branch the operator happens to be on.
- The opening runs no test suite before it commits or pushes, only the schemas write and the usage/CLI generators. Abandons: catching, before the push, a test that fails only on an opened tree. Accepted because every pull request's CI already runs on an opened tree after this change, and a full suite after the tag would widen the window in which a release is pushed but not opened.
- `docs-deploy.yml` gets the same ledger-equals-tag check as `release.yml`, inside its existing 'Verify the tag is this release' step. Abandons: a hand redeploy check held to the manifests alone. This costs one more line held by `releaseWorkflow.test.ts`. Without it, a tag on an opening commit would pass the redeploy's check.
- The README's `$schema` example literals join the example-stamp test, beside the hello-world scripts. Abandons: README examples kept up by hand. A format change must now update the README in the same commit. Without the test, the stamps providers copy from the README would drift unnoticed.
- Rehearsal (changed since the spec, PR #127): CI runs `scripts/release.sh --rehearse` on the version package.json names, which is the opened version, and keeps the narrow test set (typecheck, test:type, `tests/unit/schemasPackage`, `tests/unit/site`). Abandons: rehearsing the whole suite on every pull request's cut. The real release still runs it.
- Format-history tests (changed since the spec, e79dcdd7): once the `next` fallback is gone, `parity.test.ts`'s `releasedShapePath` has nothing left to describe and is removed. The `shapes.test.ts` case that asserted the fallback becomes the §5.5 refusal. Abandons nothing still in force.
- Answer readers (`guarantee-reports` deletes them next): the least change that meets §5.6–§5.8. That is an injectable `{ current, running }` bound, an `older` error kind and the current URL on every refusal. `LAST_SAVED_FILE_ONLY_DIAGNOSTICS_RELEASE` and `LAST_RELEASE_WITHOUT_BRIEF_ANSWER` stay as named constants. Abandons: a single lower bound per reader, which a reader with weeks to live does not need.
- Refusal spellings: the newer refusals in phax and in the package drop 'written by phax', because a stamp no longer names its writer: `<format> <X> is newer than this phax (<running>) — upgrade phax to read it`, and `… than @lbdremy/phax-schemas <version> — upgrade the package`. An older-shape answer reads `<format> <X> is an older shape — this phax reads <url>`. Abandons: message text that tests and steme might match on.
- Phase split: fixtures that stamp `PHAX_RELEASE` where they mean a format's shape are swept in their own mechanical phase (phase-02), after the writers change. Abandons: one commit per spec concern, in exchange for two reviewable diffs.
- Phase-05 opens 0.21.0 by editing the three manifests and running the generators, never through `release.sh` or `release-open.ts` on the real tree. Abandons: exercising the real opening path before the 0.21.0 release, which is the first time `release.sh` opens a version for real.

---

## phase-01 — The stamp table and the writers {#phase-01-stamp-table}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

phax stamps every document it writes, every request it hands a gate step or brief provider, and the missing-document hint with the format's current stamp, not the running version (§5.1, §5.8). The stamp comes from a per-format table generated into `src/schemas/release.ts`, which the schemas check holds to the snapshots (§5.2). The newer refusal keeps comparing against the running version (§5.3).

### Detailed instructions

- `packages/schemas/build/generated.ts`: `renderReleaseModule` takes `{ packageVersion, currentShapes }`. After `PHAX_RELEASE` it renders `export const CURRENT_STAMPS = { … } as const;` with one entry per id of `FORMAT_IDS`, in that order, keys quoted as `renderGeneratedIndex` quotes them. Each value is the current shape name when that is a release, or `packageVersion` when it is `next`. A format with no current shape name is left out; the snapshot check already reports it. Rewrite the header comments: `PHAX_RELEASE` is the running version that `phax --version` prints and that readers compare stamps against. `CURRENT_STAMPS` is each format's current stamp: its latest release-named snapshot, or `PHAX_RELEASE` while a `next` snapshot exists.
- `scripts/schemas-check.ts`: make `releaseModuleOf(state, currentShapes)`. `checkSchemas` renders with `state.currentShapes`. `writeSchemas` renders with the current shapes after its snapshot writes and removals, as it already does for the generated index, so one `--write` leaves the check green.
- When the committed release module differs from the expected one, report one `✗` finding per format whose committed stamp differs or is missing. Name the format, the committed stamp (or 'no stamp'), the expected stamp and `WRITE_COMMAND`. Read the committed entries with a line regex over the module text, never by importing it. When no stamp differs (only `PHAX_RELEASE` is stale, or the module is absent), keep today's package.json-version finding. Update the file's header comment to describe the stamp table.
- Regenerate `src/schemas/release.ts` with `pnpm exec tsx scripts/schemas-check.ts --write`. Never hand-edit it, and never edit a snapshot. At 0.20.0 no format has a `next` snapshot, so the table equals `CURRENT_SHAPES`.
- `src/schemas/persisted.ts`: export `currentSchemaUrl(formatId: FormatId): string`, equal to `schemaUrl(formatId, CURRENT_STAMPS[formatId])`, and make `withSchemaUrl` stamp with it. Its doc comment says the stamp names the format's current shape, not the running version. `readCurrent` keeps comparing a stamp against `PHAX_RELEASE` (§5.3). Respell its message as `<label> <release> is newer than this phax (<PHAX_RELEASE>) — upgrade phax to read it`, without 'written by phax'. Update the module header comment. Leave `readGateDiagnosticsAnswer` and `readBriefAnswer` unchanged; phase-03 handles them.
- `src/app/gates.ts`: `DIAGNOSTICS_EXPECTED_SHAPE` names `currentSchemaUrl("gate-diagnostics")`. Drop imports left unused, and change `serializeGateRequest`'s comment to say the request is stamped with gate-request's current stamp.
- Tests that assert a stamp phax writes now expect `currentSchemaUrl(<format>)` or `CURRENT_STAMPS[<format>]`, never `PHAX_RELEASE`. These are: `persisted.test.ts` (withSchemaUrl, the respelled newer message), `schemasPackage/documents.test.ts` (validDocuments' stamps), `schemasSmoke.test.ts` (the smoke record manifest), `schemas/approvalRecordFile.test.ts` (newer message), `dispatcher.test.ts` and `runFolder.test.ts` (run-status, phase-status, phax-plan), `reviewCompliance.test.ts`, `gateRequest.test.ts` (the gate request), `pushedBrief.test.ts` (the brief request it sends) and `gates.test.ts` (the expected-document hint). Fix any other test that fails because it expected a written stamp at `PHAX_RELEASE`. Fixtures that phax only reads are left for phase-02.
- `frozenHistory.test.ts`: on made-up inputs, `renderReleaseModule` renders a release-named current shape as itself and a `next` one as the package version. The check on the real state is green. A committed module with one format's stamp changed, and one with an entry removed, each give a finding that names that format (§5.2). A stale `PHAX_RELEASE` keeps its finding. Add a parity test: every `CURRENT_STAMPS[id]` equals `CURRENT_SHAPES[id]`, or `PACKAGE_VERSION` where that is `next`.
- No test names a literal release for a real format's stamp. Tests read `CURRENT_STAMPS`, so they hold across a cut and across a later format change. Made-up inputs to the renderer and the check may use literal releases.

### Planned files to create

- (none)

### Planned files to edit

- `packages/schemas/build/generated.ts`
- `scripts/schemas-check.ts`
- `src/schemas/release.ts`
- `src/schemas/persisted.ts`
- `src/app/gates.ts`
- `tests/unit/schemasPackage/frozenHistory.test.ts`
- `tests/unit/schemasPackage/documents.test.ts`
- `tests/unit/persisted.test.ts`
- `tests/unit/schemasSmoke.test.ts`
- `tests/unit/schemas/approvalRecordFile.test.ts`
- `tests/integration/dispatcher.test.ts`
- `tests/integration/runFolder.test.ts`
- `tests/integration/reviewCompliance.test.ts`
- `tests/integration/gateRequest.test.ts`
- `tests/integration/pushedBrief.test.ts`
- `tests/integration/gates.test.ts`

### Optional files that may be edited

- `tests/unit/schemasPackage/currentShapes.test.ts`
- `tests/unit/artifact/lineage.test.ts`
- `tests/unit/schemas/gateRequest.test.ts`
- `tests/unit/schemas/brief.test.ts`
- `tests/integration/approvalRecordMerge.test.ts`
- `tests/integration/authorArtifact.test.ts`
- `scripts/schemas-smoke.ts`

### Boundary contracts

Producer: the schemas generator (`scripts/schemas-check.ts` with `packages/schemas/build/generated.ts`), which reads the snapshots and the root package.json. Consumer: phax's `src/schemas/persisted.ts`, and through it every writer and `src/app/gates.ts`. Contract: `src/schemas/release.ts` exports `PHAX_RELEASE` (the running version) and `CURRENT_STAMPS`, a constant with exactly one X.Y.Z entry per `FormatId`. `currentSchemaUrl(formatId)` is the only way src/ builds a stamp. The dependency stays one-way: the generator imports `src/`, and nothing under `src/` imports `packages/`.

### Test strategy

Write first: the `renderReleaseModule` cases (`next` → package version, release → itself) and the per-format drift finding in `frozenHistory.test.ts`, on made-up inputs. Both are stable contracts of the generator. Then the parity test between `CURRENT_STAMPS` and `CURRENT_SHAPES`. Writer behavior is held by unit tests on `withSchemaUrl` and `currentSchemaUrl` in `persisted.test.ts`, and by the existing integration assertions on written files (run-status, phase-status, phax-plan, compliance review, gate request, brief request, the gate hint), moved to `CURRENT_STAMPS`. Under the real snapshots, run-status, phax-plan and the record manifests now stamp a release below `PHAX_RELEASE`, so those assertions show §5.1 directly.

### Implementation order

1. `renderReleaseModule` and its made-up-input tests
2. `schemas-check.ts`: render with current shapes, per-format finding, `--write` path, with its tests
3. Regenerate `src/schemas/release.ts` with `pnpm exec tsx scripts/schemas-check.ts --write`
4. `currentSchemaUrl` and `withSchemaUrl`, the respelled newer message
5. `gates.ts` hint
6. Move the written-stamp assertions, then run the standard gate

### Excluded scope

- Fixtures that phax only reads and that stamp `PHAX_RELEASE` (phase-02).
- The answer readers' bounds and refusals, and the package's `defineFormat` (phase-03).
- Release tooling, workflows and the site's ledger check (phase-04).
- Any manifest version bump or opening (phase-05).
- Any change to a published format's shape or to a snapshot.

### Verification

The `standard` gate profile in `phax.json`. Because `frozenHistory.test.ts` runs the schemas check on the real tree in `pnpm test`, a hand-edited or stale `src/schemas/release.ts` fails the gate.

### Expected handoff content

- The exact export names and paths: `CURRENT_STAMPS` in `src/schemas/release.ts`, and `currentSchemaUrl` in `src/schemas/persisted.ts`.
- The finding text the check prints for a drifted stamp.
- The list of test files whose written-stamp assertions moved, and any test outside the planned list that had to change, with the reason.
- Confirmation that `src/schemas/release.ts` was regenerated, not hand-edited.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(schemas): stamp each document with its format's current shape`

### Commit body

phax used to stamp every document it wrote with the running release. A consumer on the previous schemas package then refused a newer phax's file even when the format had not changed, and during a cycle one stamp named two shapes.

scripts/schemas-check.ts now generates CURRENT_STAMPS into src/schemas/release.ts from the snapshots. Each format maps to its latest release-named snapshot, or to the package.json version while a next snapshot exists. The check fails and names the format when a committed stamp drifts. withSchemaUrl, through the new currentSchemaUrl, and the gate's missing-document hint stamp the format's current shape. The newer-than-running refusal still compares against PHAX_RELEASE and no longer says 'written by phax'.

---

## phase-02 — Fixtures stamp the format's shape {#phase-02-fixture-stamps}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

Every test fixture that phax reads, and every answer a fake gate step or brief provider prints, carries the format's current stamp instead of `PHAX_RELEASE`. Tests then say what they mean and keep holding once the repository is opened at a version above the formats' shapes.

### Detailed instructions

- In each planned test, find each `schemaUrl(<format>, PHAX_RELEASE)` that builds a document phax reads. That covers run-status, phase-status, record manifests, approval records, compliance reviews, gate-diagnostics documents and brief answers printed by a fake step or provider, request fixtures, and foreign-format URLs used to provoke a refusal. Replace it with `currentSchemaUrl(<format>)` from `src/schemas/persisted.ts`, or with `schemaUrl(<format>, CURRENT_STAMPS[<format>])` where the test composes the URL itself.
- Default parameters such as `release = PHAX_RELEASE` in helpers that print answers or render record texts (`briefCommand.test.ts`'s `answer`, `gates.test.ts`'s `printed`, `lineage.test.ts`'s `planRecordText`/`specRecordText`) default to the format's current stamp instead.
- Keep `PHAX_RELEASE` wherever it stands for the running version: newer-release arithmetic (`major + 1`, `patch + 1`), 'newer than this phax (${PHAX_RELEASE})' expectations, `frozenHistory.test.ts`'s package.json equality and `artifactStatus.test.ts`'s major bump.
- Leave the `readGateDiagnosticsAnswer` and `readBriefAnswer` describe blocks in `tests/unit/persisted.test.ts` alone, because phase-03 rewrites them. Sweep the rest of that file.
- Remove imports left unused. Do not change any assertion's meaning and do not touch any file under `src/`, `scripts/` or `packages/`.
- When done, `git grep -n PHAX_RELEASE -- tests` lists only running-version uses and the two answer-reader blocks. Record that list in the handoff.

### Planned files to create

- (none)

### Planned files to edit

- `tests/integration/adjustPlanCommand.test.ts`
- `tests/integration/archive.test.ts`
- `tests/integration/briefCommand.test.ts`
- `tests/integration/briefProvider.test.ts`
- `tests/integration/briefRecords.test.ts`
- `tests/integration/enter.test.ts`
- `tests/integration/enterPhase.test.ts`
- `tests/integration/eventAdapter.test.ts`
- `tests/integration/executePlan.test.ts`
- `tests/integration/fixLoop.test.ts`
- `tests/integration/gates.test.ts`
- `tests/integration/perPhaseBranch.test.ts`
- `tests/integration/persistedProducer.test.ts`
- `tests/integration/pushedBrief.test.ts`
- `tests/integration/rateLimit.test.ts`
- `tests/integration/resetPhase.test.ts`
- `tests/integration/resetResume.test.ts`
- `tests/integration/resume.test.ts`
- `tests/integration/resumeFromCleanup.test.ts`
- `tests/integration/resumeFromCommit.test.ts`
- `tests/integration/resumeFromCompletion.test.ts`
- `tests/integration/resumeHandoff.test.ts`
- `tests/integration/resumePreflightRechecks.test.ts`
- `tests/integration/reviewCode.test.ts`
- `tests/integration/reviewCodeCommand.test.ts`
- `tests/integration/reviewHandoffCommand.test.ts`
- `tests/integration/sessionInfo.test.ts`
- `tests/integration/telemetry/adapterFailures.test.ts`
- `tests/unit/artifact/lineage.test.ts`
- `tests/unit/authoringRecord.test.ts`
- `tests/unit/persisted.test.ts`
- `tests/unit/phaseStatusUpdates.test.ts`
- `tests/unit/resolveRunInfo.test.ts`
- `tests/unit/resolveRunRef.test.ts`
- `tests/unit/resume.test.ts`
- `tests/unit/runRecord.test.ts`
- `tests/unit/schemas/approvalRecordFile.test.ts`
- `tests/unit/schemas/brief.test.ts`
- `tests/unit/schemas/gateDiagnostics.test.ts`
- `tests/unit/schemas/gateRequest.test.ts`

### Optional files that may be edited

- `tests/integration/artifactStatus.test.ts`
- `tests/integration/dispatcher.test.ts`
- `tests/integration/runFolder.test.ts`

### Test strategy

No new tests. This is a mechanical sweep, and the existing suite is its oracle: every touched test must still pass with unchanged meaning. Today every format's current stamp is at or below `PHAX_RELEASE`, so a fixture that phax reads stays readable either way. The sweep only makes each fixture name the shape it is written in.

### Implementation order

1. Unit tests under `tests/unit/` (schemas, persisted, records, lineage, resume helpers)
2. Integration tests under `tests/integration/`, file by file
3. Remove unused imports, run `pnpm lint` and the standard gate

### Excluded scope

- Any production code change.
- The answer-reader describe blocks of `tests/unit/persisted.test.ts` (phase-03).
- Tests in `tests/unit/schemasPackage/` that stamp `PACKAGE_VERSION`: those stand for the package's own version and hold across a cut.
- Written-stamp assertions already moved in phase-01.

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

- The remaining `PHAX_RELEASE` uses under `tests/`, each with the reason it stands for the running version.
- Any planned file that needed no change, and any unplanned file that did, with the reason.
- Confirmation that no file outside `tests/` changed.

### Commit subject

`test: stamp fixtures with their format's current shape`

### Commit body

Test fixtures stamped schemaUrl(format, PHAX_RELEASE) where they meant the format's shape. They held only because the running version and the shape happened to coincide. They now stamp currentSchemaUrl(format). PHAX_RELEASE remains only where a test means the running version: newer-release arithmetic and 'newer than this phax' messages. No production code changes.

---

## phase-03 — The readers {#phase-03-readers}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

Readers treat a stamp as a shape. The schemas package reads an opened stamp by `next` alone, with no fallback (§5.5), and keeps reading unchanged formats across releases (§5.4). phax's two answer readers accept only stamps from the format's current stamp up to the running version (§5.6). They refuse older shapes by name (§5.7), and every refusal names the URL phax reads (§5.8). The development-build refusal is unchanged (§5.11).

### Detailed instructions

- `packages/schemas/src/shapes.ts`, `bySchemaUrl`: when `current.name === "next"` and the stamp equals `packageVersion`, return the result of decoding with `next`, success or next's violation, and never try a released shape. Otherwise keep 'the latest release-named shape at or below the stamp', and keep `no <id> shape is known at release <X>` when none exists. Keep the order of the malformed, unknown-format, other-format, newer and development-build checks exactly as it is (§5.11). Rewrite step 2 of `defineFormat`'s doc comment to match.
- `newerReleaseMessage(formatId, release, packageVersion)` becomes `<formatId> <release> is newer than @lbdremy/phax-schemas <packageVersion> — upgrade the package`. Update the literal expectations in `shapes.test.ts`, `parseDocument.test.ts` and `phaseRecordManifestHistory.test.ts`; tests that call the function follow automatically.
- `tests/unit/schemasPackage/parity.test.ts`: remove `releasedShapePath`, its doc comment and its use. The hand-made reject fails at the wrong key for every format.
- `tests/unit/schemasPackage/shapes.test.ts`, using toy formats with injected `packageVersion` and `firstSupportedRelease` and literal releases only:
    - replace 'falls back to the latest released shape when next rejects it' with a case where a document at the package's own version that only the released shape accepts fails with next's violation and is never decoded as that shape (§5.5);
    - a package opened at 0.21.0 whose format last changed in 0.20.0 reads 0.20.0 and 0.21.0 stamps as shape 0.20.0, and a format with only 0.17.0 reads a 0.19.0 stamp as shape 0.17.0 (§5.4);
    - a package at 0.20.0 refuses 0.21.0 and 0.22.0 stamps as newer, naming both versions (§5.3, §5.10);
    - a package opened at 0.21.0 with first supported release 0.17.0 never gives a 0.21.0 stamp the development-build message, but still gives it to 0.16.0 (§5.11).
- `src/schemas/persisted.ts`, `readGateDiagnosticsAnswer(input, bounds = { current: CURRENT_STAMPS["gate-diagnostics"], running: PHAX_RELEASE })` checks in order:
    1. a non-object, a document without `$schema`, or a URL that does not name gate-diagnostics is malformed, as today;
    2. a stamp above `running` gives `newer`: `gate-diagnostics <X> is newer than this phax (<running>) — upgrade phax to read it`;
    3. a stamp at or below `LAST_SAVED_FILE_ONLY_DIAGNOSTICS_RELEASE` keeps its malformed saved-file refusal;
    4. a stamp below `current` gives a new `older` kind with message `gate-diagnostics <X> is an older shape — this phax reads <schemaUrl("gate-diagnostics", current)>`;
    5. otherwise the document is decoded as today.
    Remove the `release !== PHAX_RELEASE` exception, and rewrite the doc comments of the function and the constant.
- `readBriefAnswer(input, bounds = { current: CURRENT_STAMPS["brief-answer"], running: PHAX_RELEASE })` uses the same order. The newer reason is `brief-answer <X> is newer than this phax (<running>) — upgrade phax to read it`. A stamp at or below `LAST_RELEASE_WITHOUT_BRIEF_ANSWER` keeps `brief-answer <X> has no known shape`. A stamp below `current` gives a new `older` kind with reason `brief-answer <X> is an older shape — this phax reads <url>`. `describeBriefAnswerError` keeps its two prefixes, and every line it renders names the current brief-answer URL: the older reason already carries it, and the other kinds get it appended (e.g. `; this phax reads <url>`). A brief provider that answers without `$schema` therefore names `https://docs.phax.run/schemas/brief-answer/<current>.json` (§5.8). Keep both constants exported or private as they are today.
- `src/app/gates.ts`: a `newer` refusal's failure message and log line end with `DIAGNOSTICS_EXPECTED_SHAPE`, as malformed ones already do, so every refusal names the URL. An `older` refusal keeps its message as is, since it already names the URL. Check that `briefProvider.ts` and `pushedBrief.ts` need no change beyond what the new kinds imply.
- Keep the two 'is written for a single answer shape' guard tests in `persisted.test.ts`. Per the spec's §10 they must later fail and name the rule at 1.0, not be deleted.
- `tests/unit/persisted.test.ts`, rewriting the two answer-reader describe blocks with injected bounds and literal releases:
    - (current 0.20.0, running 0.21.0): `gate-diagnostics/0.20.0` and `/0.21.0` are read, `/0.22.0` is newer and names 0.22.0 and 0.21.0 (§5.6, §5.3);
    - (current 0.21.0, running 0.21.0): `/0.20.0` is refused as older, naming `https://docs.phax.run/schemas/gate-diagnostics/0.21.0.json` (§5.7);
    - `/0.18.0` keeps the saved-file refusal;
    - for brief-answer: 0.19.0 keeps 'has no known shape', `brief-answer/0.21.0` is read under (0.20.0, 0.21.0) and under (0.21.0, 0.21.0), and a refusal without `$schema` names the current URL;
    - the default bounds read an answer at `currentSchemaUrl(...)`.
    Add §5.9 cases on real constants: a registry, run-status, phase-status and phax-plan whose `$schema` is the literal 0.20.0, and a run-status stamped 0.19.0, are all read with no refusal. These hold whether `PHAX_RELEASE` is 0.20.0 or 0.21.0.
- `tests/integration/gates.test.ts`: the newer refusal's expected message gains the expected-document hint. Add one older-shape case with a made-up stamp between 0.19.0 and the current gate-diagnostics stamp (e.g. 0.19.5). It fails the step and names `currentSchemaUrl("gate-diagnostics")`. `tests/integration/pushedBrief.test.ts`: update the 'written by phax' reason to the new spelling and URL suffix.

### Planned files to create

- (none)

### Planned files to edit

- `packages/schemas/src/shapes.ts`
- `src/schemas/persisted.ts`
- `src/app/gates.ts`
- `tests/unit/schemasPackage/shapes.test.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/unit/schemasPackage/parseDocument.test.ts`
- `tests/unit/schemasPackage/phaseRecordManifestHistory.test.ts`
- `tests/unit/persisted.test.ts`
- `tests/integration/gates.test.ts`
- `tests/integration/pushedBrief.test.ts`

### Optional files that may be edited

- `packages/schemas/src/document.ts`
- `src/app/briefProvider.ts`
- `src/app/pushedBrief.ts`
- `src/schemas/gateDiagnostics.ts`
- `src/schemas/brief.ts`
- `tests/unit/schemas/gateDiagnostics.test.ts`
- `tests/unit/schemasPackage/repositoryFormats.test.ts`
- `tests/unit/schemasPackage/runDirectoryFormats.test.ts`
- `tests/unit/schemasPackage/recordTimeline.test.ts`
- `tests/unit/schemasPackage/recordManifests.test.ts`
- `tests/unit/schemasPackage/briefFormats.test.ts`
- `tests/integration/briefProvider.test.ts`
- `tests/integration/briefCommand.test.ts`
- `tests/integration/exampleProviders.test.ts`

### Boundary contracts

Producer: `src/schemas/persisted.ts` answer readers. Consumers: `src/app/gates.ts` (gate step verdicts and log lines) and `src/app/briefProvider.ts` / `src/app/pushedBrief.ts` (through `describeBriefAnswerError`). Contract: `GateDiagnosticsAnswerError` is `malformed { reason } | newer { message } | older { message }`. `BriefAnswerError` gains `older { reason }`. The one-line rendering a consumer shows always names the format's current-stamp URL. Producer: `@lbdremy/phax-schemas` `defineFormat`. Consumers: every package reader. Its `parse` result shape is unchanged; only which shape decodes an opened stamp, and the newer message text, change.

### Test strategy

Write first, as unit tests on toy formats and injected bounds with literal releases only: the §5.5 no-fallback case and the §5.4, §5.10 and §5.11 cases in `shapes.test.ts`, and the answer-reader window, older and URL-naming cases in `persisted.test.ts`. These are the spec's acceptance criteria for this phase and stable contracts. Then change `shapes.ts` and `persisted.ts` until they pass. Integration: `gates.test.ts` holds the step-level refusal text, and `pushedBrief.test.ts` holds the brief refusal line. `parity.test.ts` loses `releasedShapePath`, and its existing cases must stay green for every format. No test uses `PACKAGE_VERSION` or `PHAX_RELEASE` to stand for an older release.

### Implementation order

1. Toy-format tests in `shapes.test.ts`, then `defineFormat` without the fallback and the respelled newer message
2. `parity.test.ts` cleanup and the literal-message test updates in the package
3. Answer-reader tests with injected bounds in `persisted.test.ts`
4. `readGateDiagnosticsAnswer`, `readBriefAnswer`, `describeBriefAnswerError`
5. `gates.ts` hint on newer, then the integration tests

### Excluded scope

- Deleting or renaming `readGateDiagnosticsAnswer`, `readBriefAnswer` or their constants (`guarantee-reports`).
- Any change to the gate-diagnostics or brief-answer shapes, or frozen per-release decoders for older shapes (the 1.0 promise).
- `FIRST_SUPPORTED_RELEASE` and the development-build message.
- Release tooling and the opening (phase-04, phase-05).

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

- The final spelling of every refusal message: package newer, phax newer, gate older, brief older, and the URL suffix `describeBriefAnswerError` appends.
- The bounds parameter's exact type and default.
- The new `older` kinds and every consumer that handles them.
- Confirmation that `releasedShapePath` is gone and that the guard tests remain.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(schemas): read stamps as shapes, without the next fallback`

### Commit body

The schemas package no longer falls back from next to a released shape: a document stamped with the package's own version while the format's current shape is next is read by next alone, and next's violation is reported. The latest-shape-at-or-below rule, the newer refusal and the development-build refusal are unchanged. The newer message drops 'written by phax'.

The gate-diagnostics and brief-answer readers lose their running-release exception. They read a stamp only between the format's current stamp and the running version. They refuse an older shape by name, naming the URL phax reads, and every refusal names that URL. Stamps at or below 0.19.0 keep their existing refusals. Both readers take an injectable { current, running } bound so tests can play a development build.

---

## phase-04 — The release tooling {#phase-04-release-tooling}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

The release tooling works on opened versions. `release.sh <X>` cuts only the opened version (§5.15–§5.17), then opens the next minor (§5.12). `--open` re-opens by hand (§5.13). A failed opening names its remedy (§5.14). The site serves only cut releases (§5.19), a tag needs a cut (§5.20), and CI rehearses the opened version (§5.22). Example stamps are held to their formats (§5.18).

### Detailed instructions

- `scripts/release-cut.ts`, `cutRelease(repoRoot, version)`, refusing before writing anything:
    - when `version` is not X.Y.Z;
    - when it is not the opened version package.json names: `<version> is not the opened version <opened> — re-open first: scripts/release.sh --open <version>` (§5.15);
    - when a `<version>` snapshot exists;
    - when the ledger is missing, malformed or unordered (keep those checks);
    - when the ledger's last entry is not below `version`: `<version> is not newer than the last release <last> — nothing cut` (§5.16);
    - when a frozen module differs from its lock entry.
    Drop the requirement that the ledger end at package.json's version. Then rename every `next` snapshot to `version`, run `applySchemasWrite`, and append `version` to the ledger. Bump no manifest and rewrite no example: delete `bumpedManifest`'s use in the cut, `EXAMPLE_STAMPS`, `readExampleScript` and `stampPattern`. Export the manifest list, `bumpedManifest` and the ledger reader for `release-open.ts`. Rewrite the header comment and the doc comment.
- New `scripts/release-open.ts` exports `openRelease(repoRoot, version)`. Before writing anything it refuses a `version` that is not X.Y.Z, is not newer than the ledger's last entry (`<v> is not newer than the last release <last>`), or equals the version the manifests name (`<v> is already the opened version`). It then sets `version` in `package.json`, `npm/package.json` and `packages/schemas/package.json` (version line only), runs `applySchemasWrite` (regenerating `PACKAGE_VERSION`, `PHAX_RELEASE` and `CURRENT_STAMPS`), and returns the sorted repo-relative paths it changed. The ledger and snapshots are never touched. Its CLI mirrors `release-cut.ts`: `pnpm exec tsx scripts/release-open.ts <X.Y.Z> [--root <dir>]`, changed paths on stdout one per line, progress and `✗ …` on stderr, exit 1 on refusal.
- `scripts/release.sh`: add `--open <X.Y.Z>`, refused with `--rehearse` and on a dirty tree. It runs an `open_version` function: `release-open.ts`, `pnpm gen:usage-spec`, `pnpm docs:cli`, `git add -A --` on the opened paths plus `phax.usage.kdl` and `docs/cli/reference.md`, then `git commit -m "chore: open v<X>"`. It prints `committed chore: open v<X> (was <W>)` and does not push. Write `open_version` so every command checks its own status (`|| return 1`), because `set -e` does not apply inside a function called from an `if` condition.
- `scripts/release.sh <X>`: drop the echo lines about bumping and stamping examples. The cut now refuses anything but the opened version. Keep the cut → usage/docs regeneration → tests → commit → tag → push order. After `git push origin "v${VERSION}"`, compute the next minor X.(Y+1).0 in bash 3.2-compatible arithmetic, run `open_version` on it, then `git push`. If the opening fails, print `✗ v<X> is released but <next> is not opened — finish with: scripts/release.sh --open <next>`, then `git push`. Include how to discard a partial opening, e.g. `git reset --hard HEAD`, and exit 1. If only the push fails, print that the opening is committed and `git push` finishes it, and exit 1 (§5.14). The final three 'approve the staged npm packages' lines stay last. `--rehearse <X>` is unchanged apart from rehearsing the opened version.
- `site/build/schemas.ts`, `checkLedger`: replace the 'last entry must equal package.json' finding. A ledger whose last entry is at or below package.json's version passes. One above it fails with `✗ release ledger: last entry <last> is above package.json version <version>` (§5.19). Update the doc comments. The served schemas still come from the ledger only, so an opened version is never served.
- `.github/workflows/release.yml`, step 'Verify package versions match tag': also read the last entry of `packages/schemas/releases.json` (`node -p`) and fail on a mismatch with the tag, naming both. Update the step's comment: the cut appends the ledger, so a tag on an opening commit fails here (§5.20). The step keeps its name and its position before the deploy and the first stage publish. `.github/workflows/docs-deploy.yml`, step 'Verify the tag is this release': the same ledger-equals-tag check.
- `.github/workflows/ci.yml`, release rehearsal: run `scripts/release.sh --rehearse "$(node -p 'require("./package.json").version')"`, with no patch arithmetic, and update the comment above it (§5.22). It stays the last step, under Node 24.
- New `tests/unit/exampleStamps.test.ts` (§5.18): for `examples/hello-world/audit.mjs`, `examples/hello-world/brief.mjs` and `README.md`, collect every `$schema` key/value literal naming a `https://docs.phax.run/schemas/<format>/<X.Y.Z>.json` URL. JSON `"$schema": "…"` and JS `$schema: "…"` are both in scope; prose URLs are not. Each script holds at least one literal, and each literal names `CURRENT_STAMPS[<format>]`. A failure message names the file, the format, the stamp found and the current stamp. If a README literal is not current today, fix the README in this phase.
- `tests/unit/releaseCut.test.ts`, rewritten to hold both before and after the repository is opened:
    - A helper `openedCopy()` returns a copy whose manifests name an opened version O. If the real tree is already opened (package.json above the ledger's last entry), the copy is used as is. Otherwise it is opened with `openRelease` at the next minor of the ledger's last entry.
    - Cases: cutting O renames every `next` snapshot, regenerates `CURRENT_SHAPES`, appends O to the ledger, leaves the three manifests, `src/schemas/release.ts` and both hello-world scripts byte-identical, keeps the schemas check green, and reports exactly what changed (§5.16, §5.17).
    - Where the real tree has no `next` snapshot, one case plants a `next.schema.json` (a copy of a format's latest snapshot) and asserts the rename and the byte-identical files, not the schemas check.
    - Refusals write nothing: a version other than O names O and `scripts/release.sh --open <v>` (§5.15); a ledger that already ends at O; plus the existing malformed, missing, unordered-ledger and existing-snapshot refusals.
    - Every case still checks that the real tree is untouched.
- New `tests/unit/releaseOpen.test.ts`, on copies with versions derived from the ledger's last entry L:
    - opening L+2 minors sets the three manifests, `PACKAGE_VERSION`, `PHAX_RELEASE` and `CURRENT_STAMPS` (`next` resolved to the new version, using a planted `next` where needed), and leaves the ledger and snapshots byte-identical (§5.12);
    - opening L again is refused as not newer than the last release, and opening the same version twice is refused as already opened, each writing nothing (§5.13);
    - a malformed version is refused;
    - the real tree is untouched.
- `tests/unit/releaseWorkflow.test.ts`:
    - release.yml's version check reads `packages/schemas/releases.json` and still precedes the deploy and the first publish (§5.20);
    - docs-deploy's verify step reads it too;
    - CI's rehearsal reads package.json's version and does no patch arithmetic (§5.22);
    - release.sh has `--open`, commits `chore: open v`, runs the opening after `git push origin "v${VERSION}"` and before the final echo lines, and prints a remedy naming `scripts/release.sh --open`;
    - `bash -n scripts/release.sh` exits 0;
    - the existing invariants still hold.
    `tests/unit/site/schemas.test.ts`: `checkLedger` passes a ledger below package.json and fails one above it, naming the entry. The real tree's ledger passes. The served files of the real ledger include no `/schemas/*/<package.json version>.json` when package.json is above the ledger's last entry.
- Never run `scripts/release.sh`, `release-open.ts` or `release-cut.ts` on the real tree, and never tag, push or publish. Every test works on a temporary copy.

### Planned files to create

- `scripts/release-open.ts`
- `tests/unit/releaseOpen.test.ts`
- `tests/unit/exampleStamps.test.ts`

### Planned files to edit

- `scripts/release-cut.ts`
- `scripts/release.sh`
- `site/build/schemas.ts`
- `.github/workflows/release.yml`
- `.github/workflows/docs-deploy.yml`
- `.github/workflows/ci.yml`
- `tests/unit/releaseCut.test.ts`
- `tests/unit/releaseWorkflow.test.ts`
- `tests/unit/site/schemas.test.ts`

### Optional files that may be edited

- `scripts/schemas-check.ts`
- `site/build/site.ts`
- `README.md`
- `examples/hello-world/audit.mjs`
- `examples/hello-world/brief.mjs`

### Boundary contracts

Producers: `scripts/release-cut.ts` and `scripts/release-open.ts`. Consumer: `scripts/release.sh`. Contract: each takes one X.Y.Z argument (and `--root` for copies), prints every changed repo-relative path on stdout, one per line, and exits 1 with a `✗ …` line on stderr, having written nothing, on any refusal. Producer: the ledger `packages/schemas/releases.json`. Consumers: the site build (`checkLedger`, `servedSchemas`), `release.yml` and `docs-deploy.yml`. Contract: the ledger lists only cut releases, ends at or below package.json's version on every commit, and equals the tag on a tagged commit.

### Test strategy

Write first: the refusal cases of `cutRelease` and `openRelease` on copies, since they are the stable contract that release.sh relies on, and the `checkLedger` at-or-below cases on made-up ledgers. Then the cut and opening happy paths on copies, with versions derived from the ledger so the tests hold before the opening (phase-05) and after it, and across future cuts. `release.sh` and the workflows cannot run in a test: they are held by static invariants in `releaseWorkflow.test.ts` plus `bash -n`. The example-stamp test reads `CURRENT_STAMPS`, so it fails only when a format changes and its examples do not.

### Implementation order

1. Refusal tests, then `cutRelease`'s new checks and the removal of the manifest bump and example rewrite
2. `openRelease` in `scripts/release-open.ts` with `releaseOpen.test.ts`
3. Rewrite `releaseCut.test.ts` around `openedCopy()`
4. `checkLedger` and its tests
5. `release.sh` (`--open`, `open_version`, post-tag opening, remedies)
6. The three workflows, then `releaseWorkflow.test.ts`
7. `exampleStamps.test.ts`, then the standard gate

### Excluded scope

- Opening the real repository at 0.21.0 (phase-05).
- `docs/release.md` and the README's prose (phase-05).
- Pre-release suffixes, or choosing the opened version from commit messages.
- Changing which URLs the site serves for a ledger release, or the deploy guard.

### Verification

The `standard` gate profile in `phax.json`. Its terminal `pnpm site:build` exercises the loosened ledger check on the real tree.

### Expected handoff content

- The exported names and CLI usage of `scripts/release-open.ts`, and what `release-cut.ts` now exports for it.
- The exact refusal and remedy messages of the cut, the opening and `release.sh`.
- Whether the opening pushes (post-release only) and what `--open` prints.
- How `releaseCut.test.ts` obtains an opened copy, so phase-05 knows the tests hold after the real opening.
- Any README or example literal that the stamp test forced to change.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(release): cut only the opened version and open the next minor`

### Commit body

Between releases the manifests now name an opened version. The cut only accepts that version and requires it to be newer than the ledger. It renames next snapshots and appends the ledger, and changes no manifest, stamp or example. release.sh opens the next minor after pushing a tag, offers --open to re-open by hand, and prints the --open remedy when the opening fails.

The site build accepts a ledger that ends at or below package.json's version and refuses one above it. release.yml and docs-deploy.yml refuse a tag whose commit's ledger does not end at the tag. CI rehearses a cut of the opened version. A new test holds every $schema literal that the hello-world scripts and the README print to its format's current stamp.

---

## phase-05 — Open 0.21.0 and the docs {#phase-05-open-and-docs}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

main is opened at 0.21.0 with the ledger still ending at 0.20.0 (§5.23), and a development build reports the bare 0.21.0 (§5.21). Maintainers learn the new release process from `docs/release.md`. Gate-step and brief-provider authors learn from the README that a stamp names the format's shape.

### Detailed instructions

- Set the top-level `"version"` to `0.21.0` in `package.json`, `npm/package.json` and `packages/schemas/package.json`, changing only that line. Leave `packages/schemas/releases.json` and every snapshot untouched.
- Regenerate, never hand-edit: run `pnpm exec tsx scripts/schemas-check.ts --write` (`PACKAGE_VERSION` and `PHAX_RELEASE` become 0.21.0, and `CURRENT_STAMPS` is unchanged because no format has a `next` snapshot), then `pnpm gen:usage-spec` and `pnpm docs:cli`, which put 0.21.0 into `phax.usage.kdl` and `docs/cli/reference.md`. If `pnpm install` changes the lockfile, keep that change.
- Never run `scripts/release.sh`, `scripts/release-open.ts` or `scripts/release-cut.ts` on the real tree, and never tag or push.
- Run the full gate. Any test that fails now assumed that the manifests equal the ledger's last entry, or that `PHAX_RELEASE` equals a format's stamp. Fix it so it holds in both states and across a cut, and record it in the handoff as a deviation. Do not add a test that pins 0.21.0, because it would break at the cut.
- `docs/release.md`, Release process:
    - introduce the opened version: between releases the three manifests name it, it is never tagged, and `$schema` stamps name a format's shape. This amends the archived schemas-package spec's q-release-name;
    - step 2: `scripts/release.sh <opened version>` must be the version package.json names. The cut renames `next` snapshots, regenerates `CURRENT_SHAPES` and appends the ledger, and changes no manifest, stamp or example. Then the tests, commit, signed tag and push. Then the automatic `chore: open vX.(Y+1).0` commit and push, and the remedy printed when it fails;
    - a subsection on re-opening with `scripts/release.sh --open <X.Y.Z>`: when to use it (the cycle turned out bigger or smaller), its refusals, and that it commits without pushing;
    - the rehearsal now rehearses the opened version;
    - workflow step 5 also checks that the ledger's last entry equals the tag, and the hand redeploy checks the same;
    - the Verify list says the commit after the release commit is the opening;
    - update the dry-run example.
    Keep every heading and phrase that `tests/unit/site/releaseDocs.test.ts` reads, and extend that test so the Release process section names `scripts/release.sh --open` and the opened version.
- `README.md`, Extend phax:
    - replace the sentence about what `$schema` names in the gate-diagnostics section with the spec's text: `$schema` names the `gate-diagnostics` shape the document is written in, which is the release that last changed the format; phax names the shape it reads whenever it refuses a document; a document without `$schema` fails the step, and so does one stamped newer than the running phax or in an older shape;
    - rewrite the brief-answer bullet the same way;
    - in Persisted formats, say each file names its format and that format's shape (e.g. `run-status/0.17.0`), not the release that wrote it.
    Every `$schema` literal must still name its format's current stamp, which `tests/unit/exampleStamps.test.ts` checks. Add the spec §11 example in one or two sentences: phax 0.21.0 sends `gate-request/0.20.0` and reads `gate-diagnostics/0.20.0` for as long as neither format changes. If `packages/schemas/README.md` says `$schema` names the release that wrote the file, correct it the same way.
- `NEXT_STEPS.md`: mark step 1 (`open-next-release`) of the 'What steme now knows reaches phax' item as shipped, and tick the 'Small follow-ups' `open-next-release` entry as `[x]` with '(Shipped: the open-next-release spec.)', matching the neighbouring shipped entries.
- Search `.claude/skills/` for quoted `$schema` stamps or text saying a stamp names the running release. Do not edit any skill file; report every hit in the handoff.

### Planned files to create

- (none)

### Planned files to edit

- `package.json`
- `npm/package.json`
- `packages/schemas/package.json`
- `packages/schemas/src/generated/index.ts`
- `src/schemas/release.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`
- `docs/release.md`
- `README.md`
- `NEXT_STEPS.md`
- `tests/unit/site/releaseDocs.test.ts`

### Optional files that may be edited

- `packages/schemas/README.md`
- `pnpm-lock.yaml`

### Test strategy

No new behavior, so no new test pins the opened version. The schemas check, run inside `pnpm test`, holds `PACKAGE_VERSION`, `PHAX_RELEASE` and `CURRENT_STAMPS` to the manifests and snapshots. The site check accepts the ledger trailing package.json. The example-stamp test holds the README literals. `releaseDocs.test.ts` gains assertions that `docs/release.md` describes `--open` and the opened version. The whole standard gate run on the opened tree is the proof that the earlier phases' tests hold after an opening.

### Implementation order

1. Bump the three manifests' version lines
2. Run the schemas write, `pnpm gen:usage-spec` and `pnpm docs:cli`
3. Run the gate, and fix any test that held only while the manifests equaled the ledger
4. `docs/release.md` and `releaseDocs.test.ts`
5. README Extend phax and Persisted formats, then `packages/schemas/README.md` if needed
6. `NEXT_STEPS.md`, the skills search, then the standard gate

### Excluded scope

- Running `scripts/release.sh`, `--open`, the cut or any tag, push or publish.
- Editing `.claude/skills/` files (report only).
- Re-stamping existing files, or changing the ledger or snapshots.
- `guarantee-reports` work: no `gate-report` or `brief-report`.

### Verification

The `standard` gate profile in `phax.json`, including the terminal `pnpm build`, `pnpm site:build` and Deno smokes, run on the opened tree.

### Expected handoff content

- The versions now in the three manifests, `PACKAGE_VERSION`, `PHAX_RELEASE`, `phax.usage.kdl` and `docs/cli/reference.md`, and the ledger's unchanged last entry.
- Every test changed because it assumed manifests equal to the ledger, with the reason.
- The skill files that quote stamps or describe them as naming the running release, by path and line, left unedited.
- What the operator must do next: nothing until the 0.21.0 release, when `scripts/release.sh 0.21.0` cuts and opens 0.22.0.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`chore(release): open v0.21.0 and document shape stamps`

### Commit body

The repository is opened at 0.21.0. The three manifests, PACKAGE_VERSION, PHAX_RELEASE, phax.usage.kdl and docs/cli/reference.md name it, and the ledger still ends at 0.20.0. No format has a next snapshot, so every stamp phax writes is unchanged.

docs/release.md now describes the opened version, the cut that only renames and appends, the automatic opening of the next minor, --open, the rehearsal of the opened version and the workflows' ledger-equals-tag check. The README's Extend phax and Persisted formats sections say that $schema names the format's shape, and that phax names the URL it reads when it refuses a document. NEXT_STEPS ticks open-next-release.
