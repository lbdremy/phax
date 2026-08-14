---
status: Draft
source-spec: null
---
# Migrate to TypeScript 7 — implementation plan

> Feed this `plan.md` to `phax extract-plan` to produce `phax-plan.json`, then
> run it with `phax run`. No source spec — this is a tooling/infrastructure
> migration.

---

## Required commands

- (none)

TypeScript 7 ships as the mainline `typescript` package with the usual `tsc`
binary, invoked through the existing `pnpm` scripts (`pnpm typecheck`, `pnpm
build`, `pnpm test:type`). The bump uses `pnpm add`/`pnpm install`, already
covered. The plan introduces no new tool, runtime, or CLI. No `## Required PHAX
security configuration changes` section is needed.

---

## Context

The repo pins `typescript@^6.0.3` (`package.json` devDependencies). **TypeScript
7 is now GA** — as of the plan date the `typescript` package's `latest` dist-tag
is `7.0.2`. TS7 is the native (Go) rewrite of the compiler graduated into the
mainline `typescript` package; it keeps the same `tsc` binary, the same
`tsconfig` surface, and the same script invocations. The migration is therefore
a **major-version bump of a single dev dependency**, not a package swap or a new
CLI — but because the underlying compiler is a rewrite, it can surface
behavioral differences (option validation, type-inference edge cases, and
`.d.ts` emit) that must be resolved in the same commit.

### Migration seams (discovered)

- The compiler is invoked only via three `package.json` scripts — `typecheck`
  (`tsc --noEmit`), `build` (`tsc -p tsconfig.build.json`), and `test:type`
  (`tsc --noEmit -p tsconfig.test.json`). All three use the **same `tsc`
  binary**, so a version bump flips all three at once — they cannot be migrated
  independently.
- No code imports the `typescript` package programmatically — zero `from
  "typescript"` / `require("typescript")` references in `src`, `scripts`, or
  `tests`. The compiler is consumed purely as a CLI, so only CLI/emit
  compatibility matters.
- CI (`.github/workflows/ci.yml`) calls the scripts by name (`pnpm typecheck`,
  `pnpm build`), so the bump flows to CI with no workflow edit.
- `tsconfig.json` is the base; `tsconfig.build.json` and `tsconfig.test.json`
  both `extends` it. Options in use (`strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `module`/`moduleResolution: NodeNext`,
  `declaration`/`declarationMap`/`sourceMap`, `skipLibCheck: true`) are all
  standard and expected to be accepted by TS7, but each must be confirmed.
- `skipLibCheck: true` is already set, limiting exposure to type-checking
  differences inside Effect / `@effect/platform` `.d.ts` files.
- `build` emits `dist/**` (JS + `.d.ts` + declaration maps + source maps) and
  backs the published `phax` bin at `dist/cli/main.js`. TS7's emit is a rewrite,
  so the emitted `dist/` must be validated as complete and runnable.
- `deno:*` scripts use Deno's own type-checker (`deno check`), not `tsc`, and
  are unaffected.
- `knip` internally depends on the `typescript` package; a major bump should be
  transparent to it, but the `knip` gate confirms this.

### Strategy carried into the phases

- Do the migration as **one atomic version bump** (phase-01): bump `typescript`
  to `^7`, reinstall, then resolve every compiler diagnostic and emit difference
  the new compiler surfaces across type-check, build, and type-tests, until the
  `full` gate is green.
- Documentation touch-ups (phase-02) are separated so the migration commit stays
  a focused, reviewable dependency bump.
- Every outcome is mechanically verified by the existing `full` gate profile
  (which runs `typecheck`, `build`, `knip`, `deno:smoke`, `deno:smoke-binary`,
  and the test suites).

---

## phase-01 — Bump `typescript` to v7 and resolve compiler diffs {#phase-01-bump}

**Recommended model:** claude-opus-4-8
**Recommended effort:** high

Upgrade the `typescript` dev dependency from `^6.0.3` to `^7`, reinstall, and
resolve every diagnostic and emit difference the native TS7 compiler surfaces
across the `typecheck`, `build`, and `test:type` invocations — leaving all gates
green and the published bin runnable.

### Detailed instructions

- Bump the dependency: `pnpm add -D typescript@^7` (targets the current `7.x`
  `latest`, `7.0.2` at plan time). Run `pnpm install` and confirm `npx tsc
  --version` reports `7.x`.
- Validate config acceptance: run `pnpm typecheck` and confirm no `TS5023
  Unknown compiler option` errors against `tsconfig.json`. If TS7 rejects any
  option, resolve it (remove the deprecated option or use the supported
  equivalent) and record the change and reason in the handoff.
- Resolve type-check diffs: run `pnpm typecheck` (`tsc --noEmit`) and `npx tsc
  --noEmit -p tsconfig.test.json` (the `test:type` invocation). Fix every new
  diagnostic the v7 compiler reports that v6 did not. Prefer fixing the source
  over loosening config; if a diagnostic is a genuine compiler divergence that
  cannot be fixed in source, document it precisely in the handoff (file, symbol,
  the v6-vs-v7 difference).
- Effect remediation (only if needed): Effect declares no `typescript` peer
  dependency, so no Effect version is *required* for TS7 — compatibility is
  proven by the type-check above, not by a version bump. But if TS7 surfaces a
  diagnostic that originates inside an Effect / `@effect/platform` `.d.ts` (not
  in repo source), first try bumping `effect` and `@effect/platform` to their
  latest patch — `effect` on the `3.x` line (do **not** move to the
  `4.0.0-beta` line) and `@effect/platform` on its `0.96.x` line — then re-run
  the type-check.
  Record any such bump and the diagnostic it resolved in the handoff.
- Validate emit: run `pnpm build` and confirm the `dist/` output is complete —
  `dist/cli/main.js` exists and runs (`node dist/cli/main.js --version` prints
  the version), and `.d.ts`, `.d.ts.map`, and `.js.map` files are emitted for
  the public modules (matching `declaration`/`declarationMap`/`sourceMap`). If
  the v7 `.d.ts` output differs materially from v6 for any public module,
  document it and confirm it does not break the `phax` bin (the only consumer of
  `dist/`).
- Do not change `outDir`/`rootDir` or any emit option — the emit contract stays
  identical; only the compiler version changes.
- The `full` gate does not run `test:type`; run `npx tsc --noEmit -p
  tsconfig.test.json` manually and record the result in the handoff.
- Do not touch documentation in this phase (phase-02).

### Planned files to create

- (none)

### Planned files to edit

- `package.json`
- `pnpm-lock.yaml`

### Optional files that may be edited

- `tsconfig.json` (only if TS7 rejects an existing compiler option)
- `tsconfig.test.json` (only if TS7 rejects an existing compiler option)
- `tsconfig.build.json` (only if TS7 requires an emit-option adjustment for
  equivalent output)
- `knip.json` (only if the major bump makes the `knip` gate fail)
- Source files under `src/**` (only to resolve genuine v7 type diagnostics —
  type-only edits, no behavior change)

### Boundary contracts

The emit contract between the `build` step and the published package: consumer
is the `phax` bin (`dist/cli/main.js`); producer is the `build` script. The
stable shape is the `dist/` file set (runnable ESM entry + declarations + maps).
TS7 must produce an equivalent `dist/`. No application-layer contract moves —
any source edit forced by the compiler must be type-only.

### Test strategy

No new tests. The type system is the contract under test: the `typecheck` and
`build` gates (now TS7) plus the manually-run `test:type` project must all pass
with zero errors, and any source edit made to satisfy TS7 stays covered by the
existing unit/integration suites in the `full` gate.

### Implementation order

1. `pnpm add -D typescript@^7`; confirm `tsc --version` is `7.x`.
2. Validate `tsconfig` option acceptance; fix `TS5023` rejections if any.
3. Resolve `src` type diagnostics, then the `tests/type` project.
4. Run `pnpm build`; validate the `dist/` file set and smoke-run the bin.
5. Fix `knip` config only if the bump breaks the `knip` gate; run the `full`
   gate.

### Excluded scope

- Documentation updates (phase-02).
- CI workflow edits (scripts are called by name; no edit needed).
- Removing or replacing any other dependency.

### Verification

- The project's configured `full` gate profile in `phax.json` (includes
  `typecheck`, `build`, `knip`, `deno:smoke`, `deno:smoke-binary`, tests).
- Additionally, run manually and record in the handoff: `npx tsc --noEmit -p
  tsconfig.test.json` and `node dist/cli/main.js --version`.

### Expected handoff content

- The installed `typescript` version and confirmation that `tsc --version` is
  `7.x`.
- Whether any `tsconfig` option was removed/changed to satisfy TS7, with the
  option name and reason.
- Any source edits made to resolve v7 type diagnostics, with the v6-vs-v7
  difference for each.
- Confirmation that `dist/` emits JS + `.d.ts` + `.d.ts.map` + `.js.map`, plus
  the `node dist/cli/main.js --version` output and any material `.d.ts` emit
  difference.
- Whether `knip.json` needed a change.
- The `test:type` (`tsc -p tsconfig.test.json`) result.
- Any deviation from the planned file lists, with the reason.

### Commit subject

build(deps): migrate to TypeScript 7

### Commit body

Bump the typescript dev dependency from ^6.0.3 to ^7 (native TS7 compiler, GA).
The tsc binary, tsconfig surface, and typecheck/build/test:type scripts are
unchanged. Resolve any compiler diagnostics and emit differences surfaced by the
native compiler. Verified by the full gate plus a manual tsc run of the
type-test project and a run of the emitted bin.

---

## phase-02 — Document the TypeScript 7 toolchain {#phase-02-docs}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low

Update the repo's prose so its guidance reflects TypeScript 7. Pure docs — no
source, config, or build behavior changes.

### Detailed instructions

- Update `CLAUDE.md`: the `Conventions` section says "TypeScript + Effect (v3)
  throughout" — extend it to note the repo is on TypeScript 7 (native compiler),
  consistent with the existing caution that installed versions may differ from
  training data.
- Scan `README.md`, `docs/state-machine.md`, and
  `docs/comparisons/spec-kit-vs-phax.md` for TypeScript/`tsc` references made
  stale by the bump; update only genuinely inaccurate statements. Do not invent
  new documentation.
- Do not change any `package.json` script, `tsconfig`, or source file — the
  toolchain is already migrated; this phase only aligns prose.

### Planned files to create

- (none)

### Planned files to edit

- `CLAUDE.md`

### Optional files that may be edited

- `README.md` (only if it carries a now-stale TypeScript reference)
- `docs/state-machine.md` (only if it carries a now-stale TypeScript reference)
- `docs/comparisons/spec-kit-vs-phax.md` (only if it carries a now-stale
  TypeScript reference)

### Boundary contracts

None crossed — documentation only.

### Test strategy

No new tests. Documentation edits are verified by review; the `full` gate
confirms no non-doc file changed behavior.

### Implementation order

1. Update `CLAUDE.md`.
2. Update the three doc files only where a reference is genuinely stale.
3. Run the `full` gate.

### Excluded scope

- Any `package.json`/`tsconfig`/source change (done in phase-01).
- CI workflow edits.

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The list of doc files actually edited and a one-line summary of each change.
- Confirmation that no `package.json`/`tsconfig`/source change was made in this
  phase.
- Any deviation from the planned file lists, with the reason.

### Commit subject

docs(ts): note the TypeScript 7 toolchain

### Commit body

Update CLAUDE.md and any stale doc references to reflect that the repo is on
TypeScript 7. Documentation only; no script, config, or build behavior change.
