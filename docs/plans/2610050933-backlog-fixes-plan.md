---
status: Approved
source-spec: null
approved:
  date: 2026-10-05
  baseline: 99a42cd
---
# Backlog fixes — authoring, records, overlap, newer documents

Five defects from `NEXT_STEPS.md` (§ *Small follow-ups* and § *Road to 1.0.0*). Each was found on a real run, and each fix was already chosen before this plan; the plan implements those fixes and does not reopen them. There is one phase per defect, in the brief's order. Each phase is green on its own and carries its own tests, so there are no oracle phases. Every fix starts with a regression test that reproduces the defect and fails before the change. A closing phase prunes the five items from `NEXT_STEPS.md`. No phase changes a CLI command, flag, exit code or persisted format, so `phax.usage.kdl`, `docs/cli/reference.md` and the README command tables stay as they are. Fixtures are made up: nothing from `~/.phax` or another repository enters this repository. The layers hold (`cli → app → domain ← ports ← infra`): no new `node:fs` or `node:child_process` import in `app/`, `domain/` or `cli/`.

## Required commands

- (none)

No new commands. Every phase is verified by the `standard` gate profile, whose `pnpm` scripts `phax.json` already allows.

## Technical arbitrations

- Defect 5: refuse a newer-release document at read, not only at write. This gives up running read-only commands (`phax ls`, `phax plans status`, `phax records status`) against a document from a newer release after a downgrade. Accepted because a downgrade is rare and the remedy is one upgrade, whereas refusing only writes would need every read to carry its document's release through to the writer.
- Defect 5: the semver comparison is not copied from `packages/`. `compareReleases` and `parseSchemaUrl` already live in `src/schemas/schemaUrl.ts`, and the schemas package imports them from there. So `persisted.ts` uses them directly, which honours "phax never imports packages/" without duplicating the rule. Nothing is lost: the rule stays single-sourced.
- Defect 3: `phax prune` removes a run's registry entry. Once that entry is gone, a pruned run cannot be told apart from an unknown one. The refusal says "pruned" only when an entry survives with an `archivePath` whose folder is gone. With no entry at all, it says the run is unknown and that a pruned run looks the same. Accepted: guessing would be worse than naming the ambiguity.

---

## phase-01 — Accept a JSON document surrounded by prose {#phase-01-authoring-json-in-prose}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

A headless `artifact new` session, or a plan-extraction call, whose final message wraps a valid JSON document in prose is accepted instead of refused as "not JSON". That covers a leading sentence, a trailing remark, and a fenced object inside prose. A message that holds no usable object is refused exactly as today.

### Detailed instructions

- Write the regression first, in `tests/integration/authorArtifact.test.ts`. A spec session whose final message is `Ground read. Writing the spec document now.\n` followed by `JSON.stringify(SPEC_DOCUMENT)` must commit the artifact and its sidecar, like the existing happy-path test. Run it and confirm it fails today with `AuthoringDocumentError` ("the session's final message is not JSON") before you change any code.
- In `src/domain/authoring/jsonText.ts`, replace `stripJsonCodeFence` with a pure function named for what it now does: `extractJsonDocumentText(text: string): string`. Keep it free of I/O and Effect.
- Step 1 of the algorithm: trim the text and strip one surrounding code fence exactly as today (same regex). If the result `JSON.parse`s, return it unchanged. This keeps today's behaviour for bare and fenced output, including non-object JSON, which the decoders go on rejecting with their schema message.
- Step 2: otherwise, scan the original text for balanced top-level `{…}` candidates. Outside a candidate, only `{` matters; quotes and apostrophes in prose are ignored. Inside a candidate, count `{`/`}` depth only outside string literals. A string literal starts and ends at an unescaped `"`, and a backslash escapes the next character. A candidate ends when its depth returns to 0. If a candidate never closes before the end of the text, resume the search at the next `{` after that candidate's start, so a stray `{` in prose cannot hide a later document.
- Step 3: return the text of the last candidate whose `JSON.parse` yields a plain object (not an array, not null). A later brace group that does not parse never displaces an earlier one that does.
- Step 4: if no candidate qualifies, return the fence-stripped text from step 1. The caller's `JSON.parse` then throws, and its existing refusal applies unchanged.
- Rewrite the module comment to state the contract: one fence stripped, else the last top-level object amid prose. Say that plan extraction and headless authoring share it.
- Update both callers to the new name: `parseAuthoredDocument` in `src/app/authorArtifact.ts` and the parse in `src/app/extractPlan.ts`. Their refusal messages stay byte-identical: "the session's final message is not JSON: …" and "Claude returned non-JSON output. Raw response: …". Update any comment there that still describes fence-only stripping.
- Do not change the authoring prompt or the extraction prompt; the fix is in the parser only.

### Planned files to create

- `tests/unit/authoring/jsonText.test.ts`

### Planned files to edit

- `src/domain/authoring/jsonText.ts`
- `src/app/authorArtifact.ts`
- `src/app/extractPlan.ts`
- `tests/integration/authorArtifact.test.ts`

### Optional files that may be edited

- `tests/unit/extractPlan.test.ts`

### Boundary contracts

Producer: `src/domain/authoring/jsonText.ts` exports `extractJsonDocumentText(text: string): string`, a pure function that returns the text the caller should `JSON.parse`. Consumers: `parseAuthoredDocument` in `src/app/authorArtifact.ts` and `extractPlan` in `src/app/extractPlan.ts`. Both keep their own try/catch and refusal message, so a message with no usable object still fails in the caller, with the caller's wording.

### Test strategy

Test-first. Write the integration regression in `tests/integration/authorArtifact.test.ts` (a prose-prefixed document commits) before the change; it fails today. In a new `tests/unit/authoring/jsonText.test.ts`, add a table of cases, each asserting that `JSON.parse(extractJsonDocumentText(input))` equals the expected object, or that it throws: bare object; ```json fence; bare ``` fence; leading sentence; trailing sentence; both; fenced object inside prose; braces and escaped quotes inside string values (e.g. `"a } b"`, `"say \"{\""`); a stray unbalanced `{` in prose before the document; two objects (the last one wins); a document followed by a brace group that does not parse (the document wins); prose with no object (throws); a bare top-level array still returned by step 1. Keep the existing "not JSON" refusal test green, and add one if none asserts the message for a message with no object at all.

### Implementation order

1. Regression test in tests/integration/authorArtifact.test.ts (red).
2. Unit test table in tests/unit/authoring/jsonText.test.ts.
3. extractJsonDocumentText in src/domain/authoring/jsonText.ts.
4. Rename at both callers (authorArtifact.ts, extractPlan.ts) and update their comments.
5. Run the standard gate.

### Excluded scope

- Changing the authoring or extraction prompt.
- Accepting top-level arrays or other non-object JSON from inside prose.
- Any change to the refusal messages or exit codes.

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

The new function name and path (`extractJsonDocumentText` in `src/domain/authoring/jsonText.ts`) and its four-step contract. Confirm that both callers' refusal messages are byte-identical to before, list the unit cases covered, and explain any deviation from the planned file lists.

### Commit subject

`fix(authoring): accept a JSON document surrounded by prose`

### Commit body

A headless authoring session that ended with "Ground read. Writing the spec document now." followed by a valid document was refused as "not JSON" (exit 5, nothing written): stripJsonCodeFence removed one code fence and nothing else.

The shared domain helper, renamed extractJsonDocumentText, now keeps the fence-stripped text when it parses. Otherwise it takes the last balanced top-level JSON object in the message that parses, using a scan that respects string literals and escapes. Prose before or after the object, and a fenced object inside prose, are accepted. With no such object, the callers' existing refusals and messages are unchanged. Plan extraction shares the helper.

---

## phase-02 — Push authoring records like publish does {#phase-02-authoring-records-push}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

With `records.autoPush` true, the record a headless `artifact new spec|plan` session writes is pushed to the remote right after it is written, under the same destination rules as the push at publish. A failed push leaves the authoring command successful and prints a warning that the record stays pending, with the exact `git push` that would share it.

### Detailed instructions

- Write the regressions first, in `tests/integration/authorArtifact.test.ts`. They use the fake git's recorded `pushBranch` calls and `failNextPushBranch`, with made-up remotes and paths.
- Regression (a): records enabled, autoPush true, in-repo destination. A committed session ends with one `pushBranch` call for `phax/records/v1` to the publish remote at the repo root. This fails today because there is no call.
- Regression (b): a `repo` destination pushes to `origin` at `recordsClonePath`.
- Regression (c): autoPush false, and records off, both produce no push.
- Regression (d): a failed session whose record is written (e.g. a refused document) still pushes.
- Regression (e): with `failNextPushBranch`, a committed session still returns Right with its commit, and the push warning is produced. On the failed-session path, that warning goes through `input.output.warn`.
- In `src/app/recordsSync.ts`, rename `pushRecordsAtPublish` to `pushRecordsBranch`, with the rules unchanged: in-repo uses `publishRemote` at `repoRoot`, repo uses `ORIGIN` at `recordsClonePath`, and disabled or not-auto returns `not-configured`. Keep its error channel `never`. Rewrite its doc comment: it pushes `phax/records/v1` when auto-push is on, and is called after publish and after a headless authoring record is written. Keep the "records mirror the work" rationale. Drop "at publish time" from the function's own wording, since that is no longer its only use.
- Update `src/app/publishRun.ts` to import and call `pushRecordsBranch`. Its `pushRecordsIfConfigured` comment still speaks of publish, which remains true there, so keep it.
- In `src/app/authorArtifact.ts`, add a required `publishRemote: string` to `AuthorArtifactInput`. Document it as `publish.remote` from `phax.json`, the push target for an in-repo records destination.
- After `recordSession`, when the record's kind is `written`, call `pushRecordsBranch({ records, repoRoot, publishRemote, recordsClonePath })`. Model the outcome as an explicit union: `type AuthoringRecordPush = RecordsPushResult | { readonly kind: "no-record" }`, where `no-record` means the record was not written, so there is nothing to push. Add it to `AuthorArtifactResult` as `recordPush`.
- Export `recordPushWarning(push: AuthoringRecordPush): string | undefined` next to `recordWarning`. It returns undefined for every kind except `failed`. For `failed`, it returns a message to this effect: `authoring record not pushed to <remote> (<message>) — it stays pending (\`phax records status\` lists it); share it with \`git -C <path> push <remote> phax/records/v1\``. Take the branch name from `RECORDS_BRANCH_NAME` in `src/app/writeRecord.ts`, not a new literal. There is no `phax records push` command, so do not name one.
- On the failed-session path of `authorArtifact`, warn the push warning (when there is one) through `input.output.warn`, after the existing record warning.
- In `src/cli/commands/artifact.ts`, pass `publishRemote: config.publish.remote` to `authorArtifact`. After the existing record line, `out.warn` the `recordPushWarning(result.recordPush)` when it is defined. Print no new line on a successful push. The exit code is unchanged.
- Update `tests/integration/recordsPush.test.ts` to the new name; its existing cases keep covering the publish rules.
- Do not touch `src/app/writeAuthoringRecord.ts`: the record is written exactly as before.

### Planned files to create

- (none)

### Planned files to edit

- `src/app/recordsSync.ts`
- `src/app/publishRun.ts`
- `src/app/authorArtifact.ts`
- `src/cli/commands/artifact.ts`
- `tests/integration/recordsPush.test.ts`
- `tests/integration/authorArtifact.test.ts`

### Optional files that may be edited

- `tests/unit/cli/artifact.test.ts`

### Boundary contracts

`src/app/recordsSync.ts` exports `pushRecordsBranch(input: RecordsPushInput): Effect<RecordsPushResult, never, Git>`, consumed by `publishRun.ts` and `authorArtifact.ts`, and never failing. The CLI provides `publishRemote` (from `config.publish.remote`) to `authorArtifact` and consumes `AuthorArtifactResult.recordPush` plus `recordPushWarning` from `src/app/authorArtifact.ts` to render a warning. The use case never reads `phax.json` itself.

### Test strategy

Test-first: the five authoring regressions in `tests/integration/authorArtifact.test.ts` (fake git, fake fs) are written before the change, and (a) fails today. The publish push rules stay covered by `tests/integration/recordsPush.test.ts` (real git), renamed only. Add a unit-level assertion on `recordPushWarning`'s text (remote, "stays pending", `phax records status`, `git -C <path> push <remote> phax/records/v1`) inside the authorArtifact test file.

### Implementation order

1. Regression tests in tests/integration/authorArtifact.test.ts (red).
2. Rename pushRecordsAtPublish → pushRecordsBranch in recordsSync.ts, with its doc comment; update publishRun.ts and recordsPush.test.ts.
3. authorArtifact.ts: publishRemote input, push after a written record, AuthoringRecordPush, recordPushWarning.
4. cli/commands/artifact.ts: pass publishRemote and render the warning.
5. Run the standard gate.

### Excluded scope

- A `phax records push` command, or any new CLI flag.
- Pushing records anywhere other than after a written authoring record and at publish.
- Changing how or where the authoring record is written.

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

The new name `pushRecordsBranch` in `src/app/recordsSync.ts`, the new `publishRemote` input, the `recordPush` result field (`AuthoringRecordPush`), and `recordPushWarning` in `src/app/authorArtifact.ts`. Give the exact warning text. Phase 04 edits `authorArtifact.ts` and its test again. Explain any file-plan deviation.

### Commit subject

`fix(records): push authoring records when auto-push is on`

### Commit body

With records.autoPush true, phase records reached the remote at publish, but the records written by headless `artifact new spec|plan` sessions were never pushed, so `phax records status` kept listing them as pending.

The push is factored into pushRecordsBranch, shared by publish and headless authoring, with the same rules as before. An in-repo destination pushes to the configured publish remote; a dedicated repo destination pushes to the records clone's origin; records off or autoPush false means no push. Authoring pushes after its record is written. A failed push never fails the authoring command: it becomes a warning that the record stays pending, naming the git push that would share it.

---

## phase-03 — Resolve archived and qualified runs for plans overlap --landed {#phase-03-landed-archived-runs}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

`phax plans overlap --landed <run>` accepts both `<short>` and `<namespace>.<short>`. It reads the landed diff of a live run as today, and of an archived run from its archive folder. A pruned or unknown run fails with a message that names which.

### Detailed instructions

- Write the CLI-level regressions first, in `tests/integration/plansOverlapLanded.test.ts`, with made-up names under a temp state root.
- Regression (a): an archived run. Write a registry entry in `registry.json`, written with `withSchemaUrl` and `encodeRegistryFile`, with state `archived` and `archivePath` `<stateRoot>/archive/test.<name>`. Put a `global-file-reconciliation.json` under `<archivePath>/runs/`, and no `<stateRoot>/runs/test.<name>`. `--landed <name>` must report the impact. Confirm it fails today with "No run-status.json".
- Regression (b): `--landed test.<name>` on a live run is accepted. It is refused today as an invalid run name.
- Create `src/app/resolveLandedRun.ts`. It exports `resolveLandedRun(input: { landed: string; namespace: string; stateRoot: string })`, returning `Effect<{ key: string; runPath: string; archived: boolean }, LandedRunResolutionError, FileSystem>`. `LandedRunResolutionError` is a `Data.TaggedError` with a `message`, defined in the same file so that `analyzePlanOverlap.ts` can import this module without a cycle. All I/O goes through the `FileSystem` port and `readRegistry` (`src/app/registry.ts`); add no `node:fs` import.
- Resolution step 1: `parseRunRef(landed)` from `src/domain/runRef.ts`. On Left, fail with its message.
- Step 2: `namespace = ref.namespace ?? input.namespace` and `key = runKey(namespace, shortName)`.
- Step 3, live run: if `<stateRoot>/runs/<key>/run-status.json` exists, return `runPath = <stateRoot>/runs/<key>` with `archived: false`.
- Step 4, archived run: otherwise, read the registry and find the entry for (namespace, shortName). If it has an `archivePath` and `<archivePath>/runs` exists, return that as `runPath` with `archived: true`. The archive layout is `<archivePath>/runs/` for the run folder; see `src/app/archive.ts`.
- Step 5, pruned: an entry with an `archivePath` whose folder is gone. Refuse with wording to this effect: `Run "<key>" was archived to "<archivePath>" but that folder is gone — the run was pruned, so its landed diff is no longer available`.
- Step 6, no folder at all: an entry with no `archivePath` and no live folder. Refuse with `Run "<key>" is in the registry but has no run folder under "<stateRoot>/runs/" and no archive`.
- Step 7, unknown: no entry. Refuse with wording to this effect: `Run "<key>" is unknown: no run folder under "<stateRoot>/runs/" and no registry entry. A pruned run looks the same — \`phax prune\` removes its registry entry`. Prune drops the entry, so this is the most the registry can say; do not guess.
- Step 8: a registry that fails to decode or parse fails with its own message (`RegistryCorruptionError.message`).
- In `src/app/analyzePlanOverlap.ts`, add a use case `analyzeLandedRunImpact(landed: { ref: string; namespace: string }, planMdPaths, opts)`. It resolves through `resolveLandedRun` (using `opts.stateRoot`), maps `LandedRunResolutionError` to `AnalyzePlanOverlapError` with the same message, then calls the unchanged `analyzeReadjustmentImpact(runPath, planMdPaths, opts)`.
- In `src/cli/commands/plansOverlap.ts`, remove `decodeShortName` and `resolveRun` and their imports. When `opts.landed` is set, call `analyzeLandedRunImpact({ ref: opts.landed, namespace: config.namespace }, …)` inside the existing `nodeLayer(config)`. On Left, `out.error` the message and return 1, as today. The command keeps parsing and rendering only, with no resolution logic.
- Leave `src/app/resolveRunInfo.ts` and `src/app/resolveRunRef.ts` unchanged. `adjust-plan --landed` is out of scope.

### Planned files to create

- `src/app/resolveLandedRun.ts`
- `tests/integration/resolveLandedRun.test.ts`

### Planned files to edit

- `src/app/analyzePlanOverlap.ts`
- `src/cli/commands/plansOverlap.ts`
- `tests/integration/plansOverlapLanded.test.ts`

### Optional files that may be edited

- `tests/integration/plansOverlapCommand.test.ts`

### Boundary contracts

CLI → app: `plansOverlap.ts` passes the raw `--landed` string and the configured namespace to `analyzeLandedRunImpact` (in `src/app/analyzePlanOverlap.ts`) and renders its `ReadjustmentImpactResult` or its `AnalyzePlanOverlapError.message`. Inside app: `resolveLandedRun` (in `src/app/resolveLandedRun.ts`) returns `{ key, runPath, archived }`, where `runPath` is the folder that holds `global-file-reconciliation.json`. App → port: only `FileSystem` (`exists`, `readText` via `readRegistry`).

### Test strategy

Test-first. The CLI regressions in `tests/integration/plansOverlapLanded.test.ts` (archived run, qualified name) fail today. A new `tests/integration/resolveLandedRun.test.ts` runs `resolveLandedRun` against the fake FileSystem (`src/infra/fakes/fs.ts`) with made-up registry content. Cases: live short; live qualified; qualified in another namespace; archived; archived but folder gone (pruned message); entry without `archivePath` and no folder; unknown (no entry); invalid ref (two dots, empty part); undecodable registry. Update any existing assertion on the old "Invalid run name" message to the `parseRunRef` message.

### Implementation order

1. CLI regressions in tests/integration/plansOverlapLanded.test.ts (red).
2. resolveLandedRun.ts and its test file.
3. analyzeLandedRunImpact in analyzePlanOverlap.ts.
4. Thin plansOverlap.ts down to the single use-case call.
5. Run the standard gate.

### Excluded scope

- `adjust-plan --landed`, which keeps its current resolution.
- Changes to `resolveRun`, `resolveRunRef` or the archive layout.
- Reading a pruned run's diff from `phax/records/v1`.
- Any CLI help or flag change.

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

The path and signature of `resolveLandedRun` (`src/app/resolveLandedRun.ts`) and `analyzeLandedRunImpact` (`src/app/analyzePlanOverlap.ts`). Give the exact refusal texts for the invalid-ref, pruned, no-folder and unknown cases, and confirm that `plansOverlap.ts` no longer imports `resolveRun` or `decodeShortName`. Explain any file-plan deviation.

### Commit subject

`fix(plans): resolve archived and qualified runs for overlap --landed`

### Commit body

`plans overlap --landed` decoded its argument as a bare short name and looked only under <stateRoot>/runs/. Once a merged run was archived, which is the normal next step, the check failed with "No run-status.json", although the archive still held global-file-reconciliation.json. It also refused the qualified <namespace>.<short> name other commands print.

The argument is now parsed with parseRunRef, the namespace defaulting to the configured one. A new app use case resolves a live run first, then an archived run through its registry entry's archivePath, all through the FileSystem port. A pruned or unknown run fails with a message that says which, as far as the registry can tell. The command keeps parsing and rendering only.

---

## phase-04 — Name the remedy when an artifact commit fails {#phase-04-commit-failure-remedy}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

When the commit of an artifact's write-set fails, the refusal tells the operator what probably happened and what to do. This applies to the headless authoring commit and to every transition (approve, complete, abandon, …). It names the paths, suspects a commit hook (often a formatter), and prints the exact commit to run with phax's intended message, trailers included. When a sidecar is involved, it adds that reformatting the sidecar is safe.

### Detailed instructions

- Write the regressions first. In a new `tests/unit/artifact/commitFailedError.test.ts`, assert that `new ArtifactCommitFailedError({ paths, cause, commitMessage }).message` names every path, the cause, a commit hook and a formatter, and a pasteable commit of exactly those paths that carries the subject and the body with its trailers (an `Authoring-Id:` line survives the quoting). Today's message only says "commit them manually", so this fails until the change.
- In `tests/integration/authorArtifact.test.ts`, extend the existing failed-commit test: the error's `commitMessage` is `authoringCommitMessage`'s (subject `docs(specs): draft <slug>`, body ending in the `Authoring-Id` trailer), and the message carries the sidecar sentence and that trailer.
- In `tests/integration/artifactStatus.test.ts`, extend the failed transition-commit test: the message carries that transition's subject and body (from `transitionCommitMessage`), and carries no sidecar sentence for a hand-authored artifact.
- In `src/domain/errors.ts`, give `ArtifactCommitFailedError` a required `commitMessage: { subject: string; body: string }` field: the full message phax tried to commit, trailers included (`Authoring-Id` for a headless-authored artifact, which `phax records explain` resolves). Rewrite `message` to say, in this order: `Wrote <paths> but the commit failed: <cause>.`; that a commit hook (often a formatter) may have rejected them; then the remedy: run the repository's formatter on those paths, then commit exactly them with phax's full message. Print the remedy as a pasteable command, `git commit -m '<subject>' -m '<body>' -- <path> <path>…`, each part POSIX single-quoted (a `'` inside becomes `'\''`), so a multi-line body pastes intact with its trailers.
- When a JSON sidecar is among the paths, append one sentence to the message to this effect: formatting the JSON sidecar is safe, because phax compares its parsed document with the Markdown, not its bytes. A path counts as a sidecar when it equals `sidecarPathFor(p)` for another listed `.md` path `p` (`src/domain/artifact/sidecar.ts`). If importing that module from `errors.ts` creates a cycle, apply the same `.md` → `.json` rule inline.
- Before writing the sidecar sentence, verify that it is true. `sidecarAgreement` in `src/domain/artifact/sidecar.ts` runs `JSON.parse`, decodes, renders, and compares with the normalised Markdown body, so the sidecar's bytes never matter. It is true; keep it only if it still is. Do not claim the Markdown may be reformatted freely: a formatter that rewrites the body can make it diverge from its sidecar.
- Word the message so that it holds for every caller. It must not mention authoring or a session; only the sidecar sentence is conditional.
- Update the only two constructors. In `src/app/authorArtifact.ts`, pass the `{ subject, body }` from `authoringCommitMessage`. In `src/app/artifactStatus.ts` `finalizeTransition`, pass the `{ subject, body }` from `transitionCommitMessage`. `src/app/completeRunArtifacts.ts` and `src/app/planStaleness.ts` only name the type and need no change.
- Update the test constructors that `pnpm test:type` would otherwise reject: `tests/unit/cli/artifact.test.ts` and the constructor near the end of `tests/integration/authorArtifact.test.ts`. Existing assertions on "commit failed" keep passing.
- Leave exit codes alone. `exitCodeForAuthoringError` still maps this error to 12, and a transition keeps `exitCodeForError`'s code. Do not edit `src/cli/commands/runLayers.ts`.
- No doc quotes the old message: `grep` finds "commit them manually" only in `src/domain/errors.ts`. So no docs change; re-check this before finishing.

### Planned files to create

- `tests/unit/artifact/commitFailedError.test.ts`

### Planned files to edit

- `src/domain/errors.ts`
- `src/app/authorArtifact.ts`
- `src/app/artifactStatus.ts`
- `tests/integration/authorArtifact.test.ts`
- `tests/integration/artifactStatus.test.ts`
- `tests/unit/cli/artifact.test.ts`

### Optional files that may be edited

- (none)

### Boundary contracts

Producer: `ArtifactCommitFailedError` (`src/domain/errors.ts`), now `{ paths, cause, commitMessage }`. Its `message` is the whole user-facing refusal. Constructors: `runAuthoringSession` (`src/app/authorArtifact.ts`) and `finalizeTransition` (`src/app/artifactStatus.ts`), each passing the full message (subject and body) it tried to commit with. Consumers: the CLI renders `err.message` unchanged and maps exit codes unchanged.

### Test strategy

Test-first. `tests/unit/artifact/commitFailedError.test.ts` (domain message: one case with a spec and its sidecar, one with a single hand-authored plan and the plan approvals ledger) is written before the change and fails today. Integration: the existing failed-commit tests in `tests/integration/authorArtifact.test.ts` and `tests/integration/artifactStatus.test.ts` are extended to assert the subject, the body (with the `Authoring-Id` trailer for authoring) and the conditional sidecar sentence. `pnpm test:type` keeps every test constructor in step with the new required field.

### Implementation order

1. Unit test for the message (red).
2. Extend the two integration failed-commit tests.
3. Add the commitMessage field and the new message in src/domain/errors.ts.
4. Pass the commit message from authorArtifact.ts and artifactStatus.ts; update the test constructors.
5. Run the standard gate.

### Excluded scope

- Running a repository's formatter from phax, or writing the sidecar in any repository's format.
- Changing exit codes or `runLayers.ts`.

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

The new field on `ArtifactCommitFailedError` and the exact message text for both the with-sidecar and without-sidecar cases. Confirm that the sidecar claim was verified against `sidecarAgreement`, and that the two constructors are the only ones. Explain any file-plan deviation.

### Commit subject

`fix(artifact): name the remedy when an artifact commit fails`

### Commit body

When a repo's pre-commit hook rejected the files phax had written (a formatter's `--check` on the JSON sidecar, in one case), ArtifactCommitFailedError only said "commit them manually". The plan and sidecar stayed staged and uncommitted, with no hint why.

The error now carries the full commit message phax would have used, trailers included. Its message names the paths, says that a commit hook (often a formatter) may have rejected them, and gives the remedy: run the repository's formatter on those paths, then commit exactly them with the printed message, so an authoring commit keeps the Authoring-Id trailer that records explain resolves. When a JSON sidecar is among the paths, it adds that formatting the sidecar is safe, because agreement compares the parsed document, not its bytes. The wording holds for headless authoring and for every artifact transition. Exit codes are unchanged.

---

## phase-05 — Refuse a persisted document from a newer release {#phase-05-refuse-newer-documents}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

phax no longer reads, and so can no longer rewrite, a persisted document that a newer phax release wrote. Every reader in `src/schemas/persisted.ts` refuses such a document with a message that names the file, both releases, and the remedy. Documents from the running release and older ones read exactly as today.

### Detailed instructions

- Write the regression first, in `tests/unit/persisted.test.ts`: one `it.each` table over every reader that `persisted.ts` exports. They are `readRegistryFile`, `readRunStatusFile`, `readPhaseStatusFile`, `readPhaxPlanFile`, `readComplianceReviewFile`, `readPlanApprovalsFile`, `readSpecApprovalsFile`, `readSpecDocumentFile`, `readPlanDocumentFile`, `readGateAttributionFile` and `readPhaseFileReconciliationFile`, plus `readRecordManifestFile` for both `phase-record-manifest` and `authoring-record-manifest`.
- For each reader, take `validDocuments[id]` from `tests/unit/schemasPackage/documents.ts` and restamp its `$schema` with `schemaUrl(id, release)`. A newer release must be Left: a `PersistedReadError` whose `message` starts with the file and names the writing release, `PHAX_RELEASE`, and the remedy to upgrade phax. Equal (`PHAX_RELEASE`) and older releases must be Right. Confirm that the newer cases are Right today, i.e. that the test is red.
- Derive every release in the table from `PHAX_RELEASE`, so that it stays right after a release cut. Newer: next patch, next minor, next major. Also include one newer release whose string sorts lower and one older release whose string sorts higher, so that lexical and numeric order disagree (for example a minor with more digits, or a single-digit minor while the current minor has two). Assert each case's precondition in the test, so that a future release cannot silently void it.
- In `readPersisted` (`src/schemas/persisted.ts`), in the `$schema` branch and before `decodeCurrent`, parse `input.$schema` with `parseSchemaUrl`. When it parses, names this spec's `format`, and `compareReleases(release, PHAX_RELEASE) > 0`, return `readError(file, format, …)` with wording to this effect: `<label> written by phax <release> is newer than this phax (<PHAX_RELEASE>) — upgrade phax to read it`. `readError` already prefixes the file.
- A `$schema` that does not parse, or that names another format, falls through to `decodeCurrent` exactly as today, which rejects it as before.
- Import `compareReleases` and `parseSchemaUrl` from `./schemaUrl.js`. They are already in `src/`, and the schemas package imports them from there. Do not import anything from `packages/`, and do not write a second comparison.
- Update the module header comment and `readPersisted`'s numbered doc comment to state the new first check: a document from a newer release is refused, so that it can never be rewritten without its newer fields.
- Keep `PersistedReadError`'s shape (`_tag`, `file`, `format`, `message`) unchanged; no caller changes are needed.
- Survey the read-modify-write paths (`src/app/registry.ts` `upsertRun`/`setRunStatus`/`removeRun`, which fail on a Left). In the handoff, note any reader that degrades a Left to an empty value before writing; do not change those readers in this phase.

### Planned files to create

- (none)

### Planned files to edit

- `src/schemas/persisted.ts`
- `tests/unit/persisted.test.ts`

### Optional files that may be edited

- `tests/unit/schemasPackage/documents.ts`

### Boundary contracts

`src/schemas/persisted.ts` is the bridge every app reader goes through. Its `Reader<T>` contract is unchanged: `(file, input) => Either<T, PersistedReadError>`. A document from a newer release is now one more Left case, whose message starts with the file. Consumers render `PersistedReadError.message` or wrap it (e.g. `RegistryCorruptionError`) as they already do.

### Test strategy

Test-first: the table-driven test in `tests/unit/persisted.test.ts` covers all 13 bridge formats × {newer patch, newer minor, newer major, newer-but-lexically-lower, equal, older, older-but-lexically-higher}. Its newer rows are Right today, so it is red before the change. The existing `readPersisted` and per-format tests stay green: they use `PHAX_RELEASE` or older releases such as `0.1.0`.

### Implementation order

1. Table-driven regression in tests/unit/persisted.test.ts (red).
2. Newer-release check in readPersisted, plus the doc comments.
3. Survey the read-modify-write paths for the handoff.
4. Run the standard gate.

### Excluded scope

- Refusing at write time, or carrying a document's release through to its writer (see Technical arbitrations).
- Changing `packages/schemas`, its messages, or its first-supported-release rule.
- Changing readers that swallow a read error; note them in the handoff only.
- README or docs changes.

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

The exact refusal message, and confirmation that the comparison reuses `compareReleases`/`parseSchemaUrl` from `src/schemas/schemaUrl.ts` with no `packages/` import. List the formats and release cases the table covers, and any reader found to degrade a read error to an empty value before a write. Explain any file-plan deviation.

### Commit subject

`fix(schemas): refuse a persisted document from a newer release`

### Commit body

persisted.ts read any document carrying $schema with phax's current decoder, whatever release the URL named, as long as the format id matched. After a downgrade, the registry and run/phase status, decoded tolerantly with unknown keys ignored, would be read, stripped of the newer fields and written back without them: silent data loss.

readPersisted now refuses, at read, a document whose $schema names a release newer than PHAX_RELEASE. Releases are compared as semver (major, minor, patch, numerically), using the compareReleases and parseSchemaUrl that already live in src/schemas/schemaUrl.ts. The PersistedReadError names the file, the release that wrote it, the running release, and the remedy (upgrade phax). Equal and older releases read as before. One table-driven test covers every format the bridge reads.

---

## phase-06 — Prune the fixed items from NEXT_STEPS {#phase-06-next-steps-prune}

**Recommended model:** claude-sonnet-5
**Recommended effort:** low

`NEXT_STEPS.md` stops listing the five defects this run fixed, and nothing else in it changes.

### Detailed instructions

- Under `## Small follow-ups`, delete these four bullets entirely, each with its continuation lines: **Headless authoring rejects a document preceded by a sentence.**; **Authoring records are not auto-pushed.**; **Headless authoring's commit fails under a repo's formatter hook.**; **`plans overlap --landed` cannot read an archived run.**
- Leave every other Small follow-up untouched, in its place and word for word: the run that completes its source spec, the approval conflicts, and the approval-ground staleness.
- Under `## Road to 1.0.0`, in the **A persisted-format stability promise.** bullet, delete only the passage from `Part of it: **phax must not rewrite a document from a newer release.**` through `(found in the PR #109 side review, 2026-10-02).`. Keep the bullet's first part, through `write it down in the README.`, unchanged.
- Leave no orphaned double blank lines where bullets were removed. Keep the list's existing spacing style.
- Change nothing else: not the `Last pruned` paragraph, not the other sections, not any wording.
- Then run `pnpm format`, as the gate does; it must leave the file's other lines unchanged.

### Planned files to create

- (none)

### Planned files to edit

- `NEXT_STEPS.md`

### Optional files that may be edited

- (none)

### Test strategy

No new tests: a documentation-only change. The `standard` gate's `pnpm format:check` verifies the file's formatting, and the diff must contain only deletions.

### Implementation order

1. Delete the four Small follow-ups bullets.
2. Delete the newer-release passage from the stability-promise bullet.
3. Run the standard gate.

### Excluded scope

- Any other edit to NEXT_STEPS.md, including the `Last pruned` note and the Road to 1.0.0 counts.
- Edits to any other file.

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

Confirm that the diff to `NEXT_STEPS.md` contains only deletions: the four bullets and the one passage. Explain any file-plan deviation.

### Commit subject

`docs: NEXT_STEPS — drop the five fixed backlog items`

### Commit body

Remove the four Small follow-ups this run fixed (prose before a headless document, authoring records not auto-pushed, the formatter-hook commit refusal, plans overlap --landed on an archived or qualified run). Also remove the "must not rewrite a document from a newer release" part of the persisted-format stability promise. Nothing else changes.
