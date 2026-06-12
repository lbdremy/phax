# 15 — Upgrade to TypeScript 6 — Plan

**Prerequisite for `docs/plans/16-deno-runtime-plan.md`.** Run and merge this plan
before starting the Deno runtime plan.

## Why this comes first

The Deno runtime plan compiles and runs the project with Deno 2.8.3, which
**bundles TypeScript 6.0.3** as its type-checker. Today the project's authoritative
gate (`pnpm typecheck`) runs TypeScript 5.9.3. Moving the project itself to
TypeScript 6.0.3 means `pnpm typecheck` and Deno's `deno check`/`deno compile`
use the **same compiler version**, so any TS-6 breakage surfaces under the Node
gate first and the Deno plan's phase-01 stops carrying TS-version drift risk.

## What this migration actually is (measured, not estimated)

This was empirically verified by temporarily installing TypeScript 6.0.3 +
`@types/node@25.9.3` and running the gates, then restoring:

- The bump produces **170 type errors**, all of one class: TS 6.0 no longer
  auto-includes `@types/*` packages the way 5.x did, so Node globals (`process`,
  `Buffer`, `console`, the `NodeJS` namespace) and `node:*` module types stop
  resolving.
- Adding `"types": ["node"]` to the base `tsconfig.json` `compilerOptions`
  collapses all 170 errors to **0**. `tsconfig.build.json` and
  `tsconfig.test.json` both `extends` the base, so the single edit covers
  `pnpm typecheck`, `pnpm build`, and `pnpm test:type`; `pnpm knip` is also clean.
- **No source-code changes are required.**

So this is a single, low-risk, dependency + config phase.

---

## phase-01 — Upgrade the project to TypeScript 6 {#phase-01-typescript-6}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low

Move the project's TypeScript toolchain from 5.9 to 6.0 so the authoritative Node
type-check matches the compiler Deno bundles, unblocking the Deno runtime plan.

### Detailed instructions

- Bump devDependencies in `package.json`:
  - `typescript` → `^6.0.3`.
  - `@types/node` → `^25.9.3` (this is the version published under the
    `@types/node` `ts6.0` dist-tag; the project currently pins `^22`).
- Edit `tsconfig.json`: add `"types": ["node"]` to `compilerOptions`. This is the
  required fix — TS 6.0 no longer auto-includes `@types/*`, so without it every
  `node:*` import and Node global (`process`, `Buffer`, `console`, `NodeJS`)
  fails to resolve. Do **not** add `"types"` to `tsconfig.build.json` or
  `tsconfig.test.json`; they `extends` the base and must keep inheriting it.
- Run `pnpm install` so `pnpm-lock.yaml` records the new versions.
- Run the full gate. It is expected to pass with zero changes to any file under
  `src/`. If — contrary to the measured result — a residual type error appears,
  fix it minimally and in-place; do not refactor surrounding code or expand
  scope. If a residual error cannot be fixed without a non-trivial change, stop
  and record it in the handoff rather than guessing.
- Do not introduce `deno.json` or any Deno tooling here — that is the next plan.

### Planned files to create

- (none)

### Planned files to edit

- `package.json`
- `tsconfig.json`
- `pnpm-lock.yaml`

### Optional files that may be edited

- `package-lock.json`

### Boundary contracts

This phase crosses no application boundary; it is a toolchain version bump plus a
compiler-config change. No module shapes change.

### Test strategy

No new tests. The migration is verified entirely by the existing gates: the
`full` profile already runs `pnpm typecheck`, `pnpm build`, `pnpm test`,
`pnpm test:type` (via `pnpm test` chain or directly), and `pnpm knip`. The
measured outcome is 0 type errors with the `types: ["node"]` fix in place. Vitest
runs through esbuild and is unaffected by the compiler version.

### Implementation order

Bump `typescript` and `@types/node` in `package.json` → add `types: ["node"]` to
`tsconfig.json` → `pnpm install` → run the `full` gate → confirm green.

### Excluded scope

- Any `deno.json` / Deno tooling (belongs to `06-deno-runtime-plan.md`).
- Any source-code refactor or behavioral change.
- Removing or reconciling the secondary `package-lock.json` (left as-is unless the
  install tool touches it).
- Tightening other compiler options or `lib` settings.

### Verification

- The project's `full` gate profile in `phax.json`.

### Expected handoff content

- The exact installed versions of `typescript` and `@types/node` after the bump.
- The precise `tsconfig.json` change (`compilerOptions.types: ["node"]`) and the
  note that `tsconfig.build.json` / `tsconfig.test.json` inherit it via `extends`.
- Confirmation the `full` gate passed with no `src/` changes (or, if any residual
  fix was needed, exactly what and why).
- An explicit note that this unblocks `16-deno-runtime-plan.md` phase-01: the
  project now type-checks under the same TS 6.0.x major that Deno bundles.
- Any deviation from the planned file lists, with the reason (e.g. whether
  `package-lock.json` changed).

### Commit subject

chore(deps): upgrade to TypeScript 6

### Commit body

Bump typescript to ^6.0.3 and @types/node to ^25.9.3, and set
compilerOptions.types to ["node"] in the base tsconfig. TypeScript 6.0 no longer
auto-includes @types packages, so the explicit types entry is required for Node
globals and node:\* module resolution; the build and test tsconfigs inherit it via
extends. No source changes. This aligns the project's authoritative type-check
with the TypeScript version Deno bundles, unblocking the Deno runtime work.
