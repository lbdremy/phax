# Plan 42 — `review-compliance` accepts qualified run names

## Overview

`phax review-compliance <run>` rejects a qualified run reference such as
`louloupapers.article-series-taxonomy` with:

```
Invalid short name "louloupapers.article-series-taxonomy": must match ^[a-z][a-z0-9-]*$ (1–64 chars)
```

This is a parsing bug, not a real constraint. The command at
`src/cli/commands/reviewCompliance.ts:40` decodes the raw argument with
`decodeShortName(shortNameArg)`, whose pattern `^[a-z][a-z0-9-]*$` has no place
for the `.` that separates `<namespace>.<shortName>`. So any qualified name —
the canonical form phax prints everywhere via `runKey` — is wrongly refused.

Every other run-targeting command (including the parallel `review-code`
command) instead routes the raw argument through `resolveRunRef`
(`src/app/resolveRunRef.ts`), which already:

- accepts both unqualified (`my-run`) and qualified (`ns.my-run`) forms via
  `parseRunRef` (`src/domain/runRef.ts`),
- resolves unqualified names against the active project namespace,
- resolves qualified names through the registry across projects, and
- returns the located `RunReviewInfo` plus a `crossProject` flag.

The fix is to make `review-compliance` use `resolveRunRef` exactly like
`review-code` does, deleting the bespoke `decodeShortName` + `resolveRun`
path. This reuses already-tested resolution logic rather than adding new
parsing.

This is a single-phase, mechanical fix with a focused regression test. No
schema, domain, or port changes are involved.

## Required commands

- (none)

## phase-01 — Resolve run reference via resolveRunRef {#phase-01-resolve-run-ref}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low

Make `phax review-compliance` accept a qualified `<namespace>.<shortName>` run
reference (and keep accepting an unqualified short name) by replacing the
direct `decodeShortName` parse with `resolveRunRef`, matching the existing
`review-code` command.

### Detailed instructions

- In `src/cli/commands/reviewCompliance.ts`, replace the block that currently
  parses and resolves the run (the `decodeShortName(shortNameArg)` validation
  at lines ~40–52 and the subsequent `resolveRun(config.namespace, shortName,
  config.stateRoot)` call) with the `resolveRunRef` pattern used in
  `src/cli/commands/reviewCode.ts:56-66`:
  - Compute the state root with `effectiveStateRoot(config)` (import from
    `../../app/projectContext.js`).
  - Call `resolveRunRef(shortNameArg, config, stateRoot)` (import from
    `../../app/resolveRunRef.js`).
  - On `Either.isLeft`, render `resolveResult.left.message` via `out.error`
    and return `1` (the refusal messages are already user-facing and specific;
    do not wrap them).
  - On success, destructure `{ namespace, shortName, info, crossProject }`.
  - When `crossProject` is true, log `Target: ${runKey(namespace, shortName)}`
    (import `runKey` from `../../domain/runRef.js`) before proceeding, matching
    `review-code`.
  - Use the resolved `info` directly for the downstream `info.runState` check
    and the `reviewCompliance(info, …)` call — do not call `resolveRun`
    separately.
- Keep `shortName` (the resolved short name string) for the existing
  user-facing messages in this file (the `runState` mismatch error and the
  retry hint `phax review-compliance ${shortName}`). Leaving those unqualified
  preserves current behavior; do not change their wording in this phase.
- Remove the now-unused imports: `decodeShortName` (from
  `../../domain/branded.js`) and `resolveRun` (from
  `../../app/resolveRunInfo.js`). Confirm no other reference to them remains in
  the file. oxlint and knip will flag any unused import left behind.
- Do not change the `complianceReview.enabled` gate, the routing resolution,
  the layer construction, or the result rendering — only the run-reference
  parsing/resolution segment changes.

### Planned files to create

- `tests/unit/cli/reviewCompliance.test.ts`

### Planned files to edit

- `src/cli/commands/reviewCompliance.ts`

### Optional files that may be edited

- (none)

### Boundary contracts

CLI command → application resolver. The command consumes the existing
`resolveRunRef(rawArg, config, stateRoot)` contract from `src/app/resolveRunRef.ts`,
which returns `Either<ResolveRunRefRefusal, ResolveRunRefResult>` where
`ResolveRunRefResult` carries `{ namespace, shortName, info, crossProject }`.
No new interface is introduced; the command adopts the same contract
`review-code` already depends on.

### Test strategy

CLI command (Page/route/CLI layer) — write the test before implementation.

Add `tests/unit/cli/reviewCompliance.test.ts` mirroring the harness in
`tests/unit/cli/publishPr.test.ts`:

- `vi.mock` `../../../src/app/loadConfig.js`, `../../../src/app/resolveRunRef.js`,
  and `../../../src/app/reviewCompliance.js` (and any other use-case
  dependency the command imports that would otherwise touch real I/O — e.g.
  `loadRouting`), then drive `runReviewCompliance` directly with a fake
  `OutputPort` that records `log`/`error` lines.
- Regression test (the bug): with `complianceReview.enabled: true` and
  `resolveRunRef` mocked to return a located run, call
  `runReviewCompliance("louloupapers.article-series-taxonomy", …)` and assert
  the command does **not** emit any `Invalid short name` error and that
  `resolveRunRef` was called with the verbatim qualified argument. This test
  must fail against the current `decodeShortName` implementation.
- Resolution-refusal test: with `resolveRunRef` mocked to return
  `Either.left({ message })`, assert the command renders that exact message via
  `out.error` and returns `1`.
- Keep coverage of the existing `complianceReview.enabled === false` short
  circuit (asserts the not-enabled error fires before any resolution).

The existing `tests/integration/reviewComplianceCommand.test.ts` exercises the
`reviewCompliance` use case and is unaffected; do not modify it.

### Implementation order

1. Write `tests/unit/cli/reviewCompliance.test.ts` (red).
2. Apply the `resolveRunRef` swap in `reviewCompliance.ts` and remove dead
   imports (green).
3. Run the `full` gate.

### Excluded scope

- No change to `resolveRunRef`, `parseRunRef`, `decodeShortName`, or any
  branded-type validator — the resolver already handles both name forms.
- No change to `review-code`, `review-handoff`, or any other command.
- No rewording of the `runState` mismatch error or the retry hint.
- No new CLI flags or output format changes beyond the `crossProject`
  `Target:` line copied from `review-code`.

### Verification

- The project's configured `full` gate profile in `phax.json` (typecheck +
  unit + integration + type tests + lint + format check + architecture audit +
  knip).

### Expected handoff content

- Confirm `src/cli/commands/reviewCompliance.ts` now resolves the run via
  `resolveRunRef(shortNameArg, config, stateRoot)` with
  `stateRoot = effectiveStateRoot(config)`, and that `decodeShortName` and
  `resolveRun` imports were removed.
- State that `tests/unit/cli/reviewCompliance.test.ts` asserts a qualified
  `namespace.shortName` argument is accepted (no `Invalid short name` error).
- Note any deviation from the planned file lists with the reason (e.g. an extra
  use-case mock needed for the command's imports).

### Commit subject

fix(cli): accept qualified run names in review-compliance

### Commit body

review-compliance decoded its argument with decodeShortName, whose
^[a-z][a-z0-9-]*$ pattern rejected the qualified <namespace>.<shortName> form
that phax prints everywhere — e.g. `phax review-compliance
louloupapers.article-series-taxonomy` failed with "Invalid short name". Route
the raw argument through resolveRunRef instead, matching the review-code
command, so both qualified and unqualified references resolve (including
cross-project, registry-backed lookups). Add a CLI unit test covering the
qualified-name regression and the resolution-refusal path.
