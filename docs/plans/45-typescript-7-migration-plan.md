---
status: Draft
source-spec: null
---
# Migrate to TypeScript 7

> Feed this `plan.md` to `phax extract-plan` to produce `phax-plan.json`, then
> run it with `phax run`. No source spec — this is a tooling/infrastructure
> migration.
>
> Replanned 2026-08-14 from the 2026-08-11 original (`6539272`), which went
> `Stale` (`ground-changed`) on package/lockfile churn. The version facts, the
> migration seams, and the TS 6 → 7 option-removal checklist were all re-verified
> against `main` at `e9ff74c` (v0.8.2); two of the original's claims did not
> survive that check — see [Context](#context).

---

## Required commands

- (none)

TypeScript 7 ships as the mainline `typescript` package with the usual `tsc`
binary, invoked through the existing `pnpm` scripts (`pnpm typecheck`, `pnpm
build`, `pnpm test:type`). The bump uses `pnpm add`/`pnpm install`, already
covered. The plan introduces no new tool, runtime, or CLI. No `## Required PHAX
security configuration changes` section is needed.

---

## Required PHAX configuration changes

Add `pnpm test:type` to the `full` gate profile in `phax.json` **before** running
this plan:

```json
"full": [
  "pnpm format",
  "pnpm typecheck",
  "pnpm test:type",
  "pnpm lint",
  "pnpm format:check",
  "pnpm knip",
  "pnpm test",
  "pnpm audit:architecture",
  "pnpm build",
  "pnpm deno:smoke",
  "pnpm deno:smoke-binary",
  "pnpm gen:model-catalog --check"
]
```

`pnpm test:type` (`tsc --noEmit -p tsconfig.test.json`) is the only check that
compiles `tests/type/**`, and it is absent from `full` today. For a compiler
migration that is the single most load-bearing check in the repo, so it must be
gated rather than run by hand. `test:type` is an existing `package.json` script —
this adds no new command, and gate commands are part of the frozen effective set,
so the security preflight covers it automatically.

This is an operator step, not a phase: `loadConfig` runs once at run start
(`src/cli/commands/run.ts:162`) and `executePlan` reads `config.raw.gateProfiles`
from that snapshot, so a phase editing `phax.json` would not change its own run's
gate. Sequence it as:

1. Edit `phax.json` as above and commit it on `main`.
2. `phax artifact approve docs/plans/45-typescript-7-migration-plan.md` — approving
   *after* the commit binds the approval baseline to the tree that already carries
   the new gate, so the staleness gate cannot trip on it.
3. `phax run`.

---

## Context {#context}

The repo pins `typescript@^6.0.3` (`package.json` devDependencies; `npx tsc
--version` reports `6.0.3`). **TypeScript 7 is GA** — verified 2026-08-14, the
`typescript` package's `latest` dist-tag is `7.0.2`, unchanged since this plan was
first written on 2026-08-11 (`next` is `7.1.0-dev.*`). TS7 is the native (Go)
rewrite of the compiler graduated into the mainline `typescript` package; it keeps
the same `tsc` binary, the same `tsconfig` surface, and the same script
invocations. The migration is therefore a **major-version bump of a single dev
dependency**, not a package swap or a new CLI — but because the underlying
compiler is a rewrite, it can surface behavioral differences (type-inference edge
cases and `.d.ts` emit) that must be resolved in the same commit.

### What the replan changed

- **The `tsconfig` risk is now quantified, not assumed.** The original said every
  compiler option "must be confirmed". The TS 6.0 → 7.0 removal set is a closed,
  published list (the compiler's own `checkDeprecations("6.0", "7.0", …)` block):
  `alwaysStrict: false`, `target: ES5`, `moduleResolution: node10`,
  `moduleResolution: classic`, `baseUrl`, `esModuleInterop: false`,
  `allowSyntheticDefaultImports: false`, `outFile`, `module` of
  `None`/`AMD`/`UMD`/`System`, and `downlevelIteration` at any value. Checked
  against `tsconfig.json`: **none of the ten applies** — the repo is on `target:
  ES2022`, `module`/`moduleResolution: NodeNext`, `esModuleInterop: true`,
  `strict: true`, with no `baseUrl`, no `outFile`, and no `downlevelIteration`.
  **Confirmed empirically on 2026-08-14**, which is better evidence than reading
  the list: TS 6.0's purpose is to warn about what 7.0 removes, this repo does not
  set `ignoreDeprecations`, and both compiler entry points are silent on `6.0.3` —
  `pnpm typecheck` and `pnpm test:type` each exit 0 with zero diagnostics. The
  actual compiler on the actual repo says the config is 7.0-ready. A `TS5023
  Unknown compiler option` failure is therefore expected to be a non-event, and
  phase-01's real risk sits in inference and emit.
- **The strictness profile is a tailwind, and it is out of scope.** `strict: true`
  plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `noImplicitOverride`, `noFallthroughCasesInSwitch`, `noImplicitReturns`, and
  `useUnknownInCatchVariables` means a TS7 inference change is far more likely to
  surface as a compile error than to silently change behavior — the migration is
  noisier but safer for it, and the two most inference-sensitive flags
  (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) are exactly the ones
  set. `isolatedModules` and `verbatimModuleSyntax` were added on 2026-08-15
  (`322d4a5`), **before** this plan runs and as their own commit — the repo
  transpiles file-by-file through esbuild (vitest / vite / tsx) and Deno, and
  nothing verified the source was safe for that. They cost zero source changes:
  all 142 files with type-only imports already used `import type`. Doing it ahead
  of the bump means TS7 inference diagnostics cannot be confused with
  single-file-transpilation diagnostics in the same diff. The remaining six —
  `noUnusedLocals`, `noUnusedParameters`, `noPropertyAccessFromIndexSignature`,
  `noUncheckedSideEffectImports`, `allowUnreachableCode: false`,
  `allowUnusedLabels: false` — followed in `72f26c1`, also before the bump. They
  cost 43 diagnostics: 29 were the `interpret()` reducer's trailing
  `return assertNever(state)` guards, moved into `default:` clauses (same
  exhaustiveness proof, no longer flagged as unreachable), and 14 were real dead
  code. **The strictness contract is therefore settled before phase-01 starts**:
  the bump must not add, tighten, or relax anything further, so every diagnostic
  it produces is attributable to the compiler change alone.
- **knip no longer pulls in `typescript`.** The original listed knip as an
  indirect consumer of the compiler package. `knip@6.12.2`'s dependencies are
  `oxc-parser` / `oxc-resolver` / `get-tsconfig` / `zod` / … — no `typescript`,
  and no peer dependency on it. The `knip` gate is insulated from the bump; it
  reads `tsconfig.json` through `get-tsconfig`, so it can only be disturbed by a
  *config* edit, not by the compiler version. `knip.json` stays on the optional
  list for that narrowed reason only.
- **The Effect escape hatch was re-pinned to current reality.** `effect` is
  installed at `3.21.2` under `^3.14.0` (`latest` on the 3.x line is now
  `3.22.1`, in range). `@effect/platform` is installed at `0.96.1` under
  `^0.96.0`, and its `latest` is now `0.97.1` — **outside** the declared range, so
  reaching it is a range bump, not a patch. `effect` 4.x has moved from beta to
  `4.0.0-rc.109`; it is still out of scope for this plan.

### Migration seams (re-verified 2026-08-14)

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
- `tsconfig.json` is the base; `tsconfig.build.json` (adds `outDir`/`rootDir`,
  excludes `tests`) and `tsconfig.test.json` (adds `noEmit`, `rootDir: "."`,
  includes `tests/type/**`) both `extends` it.
- `skipLibCheck: true` is already set, limiting exposure to type-checking
  differences inside the `.d.ts` files of Effect, `@effect/platform`, `yaml`, and
  `@types/node`.
- `build` emits `dist/**` (JS + `.d.ts` + declaration maps + source maps) and
  backs the published `phax` bin at `dist/cli/main.js`. TS7's emit is a rewrite,
  so the emitted `dist/` must be validated as complete and runnable.
- The rest of the toolchain does not type-check and is insulated by construction:
  `oxlint`/`oxfmt` are Rust, `vitest`/`vite`/`tsx` transpile through esbuild
  without type-checking, and the `deno:*` scripts use Deno's own checker
  (`deno check`), not `tsc`.
- `tests/type/` holds six type-level suites (`brands`, `prompt`, `routing`,
  `stateTransitions`, `systemTelemetry`, `telemetryEvents`). Nothing but
  `test:type` compiles them — hence the gate change above.

### Strategy carried into the phases

- Do the migration as **one atomic version bump** (phase-01): bump `typescript`
  to `^7`, reinstall, then resolve every compiler diagnostic and emit difference
  the new compiler surfaces across type-check, build, and type-tests, until the
  `full` gate is green.
- Documentation touch-up (phase-02) is separated so the migration commit stays a
  focused, reviewable dependency bump.
- Every outcome is mechanically verified by the configured `full` gate profile —
  which, with the pre-run change above, now includes `test:type`.

---

## Technical arbitrations

- **`test:type` is gated, not manual.** The original ran `tsc -p
  tsconfig.test.json` by hand and recorded the result in the handoff. It is now a
  `full` gate step added out-of-band before the run. Loss accepted: the migration
  is no longer a pure dependency bump — it needs one operator commit first, and
  every future run pays one extra `tsc` invocation. Taken because a mid-run
  `phax.json` edit cannot affect its own run (profiles are frozen at
  `loadConfig`), and a handoff sentence is not enforcement.
- **The plan is replanned in place, not renumbered.** Plan 45 was reopened
  `Stale → Draft` (`13343f6`) and rewritten, rather than abandoned in favour of a
  new plan 50. Loss accepted: the artifact no longer reads as the 2026-08-11
  plan — that text survives only in git history at `6539272`.
- **Dependency drift is resolved reactively, never opportunistically.** `effect`
  (`3.21.2` → `3.22.1` available) and other dependencies are *not* bumped just
  because the lockfile is being touched. Loss accepted: the run leaves known
  in-range updates on the table. Taken because a compiler migration whose commit
  also moves the runtime library is unreviewable — if TS7 fails, you cannot tell
  which change caused it.

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
  `latest`, `7.0.2` as of 2026-08-14). Run `pnpm install` and confirm `npx tsc
  --version` reports `7.x`.
- Validate config acceptance first, because it is cheap and it partitions the
  work: run `pnpm typecheck` and confirm there is no `TS5023 Unknown compiler
  option` against `tsconfig.json`. The pre-bump baseline is that TS `6.0.3` runs
  `typecheck` and `test:type` clean with zero deprecation diagnostics, so a TS7
  rejection would mean the 6.0 deprecation pass missed something — if it happens,
  record the option, the diagnostic, and the fix (drop the option or use the
  supported equivalent) in the handoff rather than treating it as routine.
- Do not add, tighten, or relax any compiler option. The strictness contract was
  settled before this run in two commits of its own — `322d4a5`
  (`isolatedModules`, `verbatimModuleSyntax`) and `72f26c1` (`noUnusedLocals`,
  `noUnusedParameters`, `noPropertyAccessFromIndexSignature`,
  `noUncheckedSideEffectImports`, `allowUnreachableCode: false`,
  `allowUnusedLabels: false`) — precisely so none of it is part of this diff. This
  phase changes the compiler version and nothing else, which is what makes every
  diagnostic it produces attributable to TS7.
- One consequence worth knowing: `noUnusedLocals`/`noUnusedParameters` are now on,
  so if TS7's inference makes a previously-used symbol unused, it surfaces as an
  error rather than silently rotting. Treat that as signal, not noise — say in the
  handoff what stopped using it.
- Resolve type-check diffs: run `pnpm typecheck` (`tsc --noEmit`) and `pnpm
  test:type` (`tsc --noEmit -p tsconfig.test.json`). Fix every new diagnostic the
  v7 compiler reports that v6 did not. Prefer fixing the source over loosening
  config; never relax `strict`, `noUncheckedIndexedAccess`, or
  `exactOptionalPropertyTypes` to silence a diagnostic. If a diagnostic is a
  genuine compiler divergence that cannot be fixed in source, document it
  precisely in the handoff (file, symbol, the v6-vs-v7 difference).
- Pay particular attention to `tests/type/**`. Those suites assert type-level
  behavior directly (branded types, prompt shapes, routing resolution, state
  transitions, telemetry events); an inference change in TS7 shows up there
  before it shows up anywhere else, and a suite that starts *passing vacuously*
  is as much a regression as one that fails. If a type-level assertion has to
  change, say what the compiler now infers and why the new assertion is still the
  behavior the repo wants.
- Effect remediation (only if needed): Effect declares no `typescript` peer
  dependency, so no Effect version is *required* for TS7 — compatibility is
  proven by the type-check above, not by a version bump. But if TS7 surfaces a
  diagnostic that originates inside an Effect / `@effect/platform` `.d.ts` (not
  in repo source), first try the latest release **inside the declared caret
  ranges**: `effect` on the `3.x` line (`3.22.1` is current; do **not** move to
  the `4.0.0-rc` line) and `@effect/platform` on `0.96.x`. Moving
  `@effect/platform` to `0.97.x` means widening the range in `package.json` — do
  it only if `0.96.x` genuinely cannot resolve the diagnostic, and justify it in
  the handoff. Record any such bump and the diagnostic it resolved.
- Validate emit: run `pnpm build` and confirm the `dist/` output is complete —
  `dist/cli/main.js` exists and runs (`node dist/cli/main.js --version` prints
  the version), and `.d.ts`, `.d.ts.map`, and `.js.map` files are emitted for
  the public modules (matching `declaration`/`declarationMap`/`sourceMap`). If
  the v7 `.d.ts` output differs materially from v6 for any public module,
  document it and confirm it does not break the `phax` bin (the only consumer of
  `dist/`).
- Do not change `outDir`/`rootDir` or any emit option — the emit contract stays
  identical; only the compiler version changes.
- Do not bump any dependency other than `typescript`, except under the Effect
  remediation path above. The lockfile will move; that is expected. What is not
  expected is an opportunistic upgrade riding along.
- Do not touch documentation in this phase (phase-02).

### Planned files to create

- (none)

### Planned files to edit

- `package.json`
- `pnpm-lock.yaml`

### Optional files that may be edited

- `tsconfig.json`
- `tsconfig.test.json`
- `tsconfig.build.json`
- `knip.json`

Bare paths only, so reconciliation can actually match them. The conditions:
`tsconfig.json` and `tsconfig.test.json` only if TS7 rejects an existing compiler
option; `tsconfig.build.json` only if TS7 needs an emit-option adjustment to
produce equivalent output; `knip.json` only if one of those `tsconfig` edits
disturbs knip's `get-tsconfig` read — the compiler bump alone cannot, since knip
does not depend on `typescript`.

Source files under `src/**` and type-level suites under `tests/type/**` may also
need type-only edits to resolve genuine v7 diagnostics. They are deliberately not
listed: which ones is unknowable before the compiler runs, and a glob would not
match anything anyway. Reconciliation will therefore report each as unplanned —
expected here, and each one must be named with its v6-vs-v7 reason in the
handoff.

### Boundary contracts

The emit contract between the `build` step and the published package: consumer
is the `phax` bin (`dist/cli/main.js`); producer is the `build` script. The
stable shape is the `dist/` file set (runnable ESM entry + declarations + maps).
TS7 must produce an equivalent `dist/`. No application-layer contract moves —
any source edit forced by the compiler must be type-only.

### Test strategy

No new tests. The type system is the contract under test: `typecheck`,
`test:type`, and `build` (all now TS7, all in the `full` gate) must pass with
zero errors, and any source edit made to satisfy TS7 stays covered by the
existing unit/integration suites the gate already runs.

### Implementation order

1. `pnpm add -D typescript@^7`; confirm `tsc --version` is `7.x`.
2. Validate `tsconfig` option acceptance; fix `TS5023` rejections if any.
3. Resolve `src` diagnostics, then the `tests/type` project.
4. Run `pnpm build`; validate the `dist/` file set and smoke-run the bin.
5. Run the `full` gate; touch `knip.json` only if a `tsconfig` edit broke it.

### Excluded scope

- Documentation updates (phase-02).
- The `phax.json` gate-profile change — an operator step taken before the run,
  not a phase (see Required PHAX configuration changes).
- CI workflow edits (scripts are called by name; no edit needed).
- Removing, replacing, or opportunistically upgrading any other dependency.

### Verification

- The project's configured `full` gate profile in `phax.json` — which now
  includes `pnpm test:type` alongside `typecheck`, `build`, `knip`, `test`,
  `audit:architecture`, `deno:smoke`, `deno:smoke-binary`, and
  `gen:model-catalog --check`.
- Additionally, run manually and record in the handoff: `node dist/cli/main.js
  --version`.

### Expected handoff content

- The installed `typescript` version and confirmation that `tsc --version` is
  `7.x`.
- Whether any `tsconfig` option was removed or changed to satisfy TS7, with the
  option name and reason — and explicitly state "none" if the option-removal
  checklist held, since that is the expected outcome.
- Every source or `tests/type` edit made to resolve a v7 diagnostic, each with
  the v6-vs-v7 difference, and for type-level suites whether the assertion still
  asserts the same thing.
- Whether the Effect remediation path was taken, and if so which package moved,
  to what version, whether it required widening a caret range, and which
  diagnostic it resolved.
- Confirmation that `dist/` emits JS + `.d.ts` + `.d.ts.map` + `.js.map`, plus
  the `node dist/cli/main.js --version` output and any material `.d.ts` emit
  difference.
- Whether `knip.json` needed a change.
- Any deviation from the planned file lists, with the reason.

### Commit subject

build(deps): migrate to TypeScript 7

### Commit body

Bump the typescript dev dependency from ^6.0.3 to ^7 (native TS7 compiler, GA at
7.0.2). The tsc binary, tsconfig surface, and typecheck/build/test:type scripts
are unchanged. Resolve any compiler diagnostics and emit differences surfaced by
the native compiler. Verified by the full gate — which now runs test:type, so the
type-level suites are covered mechanically — plus a run of the emitted bin.

---

## phase-02 — Document the TypeScript 7 toolchain {#phase-02-docs}

**Recommended model:** claude-sonnet-5
**Recommended effort:** low

Record in `CLAUDE.md` that the repo compiles with TypeScript 7, so agents reading
the conventions know which compiler they are targeting. Pure docs — no source,
config, or build behavior changes.

### Detailed instructions

- Update `CLAUDE.md`: the `Conventions` section currently reads "TypeScript +
  Effect (v3) throughout; Effect handles dependency injection and effects."
  Extend it to name TypeScript 7 (the native compiler), consistent with the
  existing caution in that section that installed versions may differ from
  training data.
- Do **not** hunt for other stale references. A repo-wide grep on 2026-08-14
  found no document that states a TypeScript version: `docs/state-machine.md` and
  `docs/comparisons/spec-kit-vs-phax.md` mention TypeScript only in
  version-agnostic prose (`satisfies`, "Node / Effect / TypeScript"), `README.md`
  does not mention it at all, and the remaining hits are `typescript` code
  fences. If you nonetheless find a version claim that the bump made false, fix
  it and say so in the handoff — otherwise `CLAUDE.md` is the whole phase.
- Do not change any `package.json` script, `tsconfig`, or source file — the
  toolchain is already migrated; this phase only aligns prose.

### Planned files to create

- (none)

### Planned files to edit

- `CLAUDE.md`

### Optional files that may be edited

- (none)

### Boundary contracts

None crossed — documentation only.

### Test strategy

No new tests. The edit is verified by review; the `full` gate confirms no non-doc
file changed behavior.

### Implementation order

1. Update the `Conventions` bullet in `CLAUDE.md`.
2. Run the `full` gate.

### Excluded scope

- Any `package.json`/`tsconfig`/source change (done in phase-01).
- Rewriting or restructuring `CLAUDE.md` beyond the one conventions bullet.
- CI workflow edits.

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact wording added to `CLAUDE.md`.
- Confirmation that no `package.json`/`tsconfig`/source change was made in this
  phase.
- Whether any other document turned out to carry a now-false TypeScript version
  claim (expected: none).
- Any deviation from the planned file lists, with the reason.

### Commit subject

docs(ts): note the TypeScript 7 toolchain

### Commit body

Record in the CLAUDE.md conventions that the repo compiles with TypeScript 7
(native compiler). Documentation only; no script, config, or build behavior
change.
