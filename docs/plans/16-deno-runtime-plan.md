# Deno Runtime and Distribution — Plan

Implements `docs/specs/06-deno-runtime.md`.

**Prerequisite:** `docs/plans/15-typescript-6-migration-plan.md` must be merged
first. It moves the project to TypeScript 6.0.3 — the exact compiler Deno 2.8.3
bundles — so `pnpm typecheck` and `deno check`/`deno compile` agree, removing the
TS-version drift that would otherwise make phase-01 risky.

## Decisions baked into this plan

These were settled with the spec owner before planning and constrain every phase:

1. **Dual-runtime, not a migration (spec option B).** The Node toolchain stays
   authoritative: `tsc` build, `vitest`, `tsx`, `oxlint`/`oxfmt`, `pnpm` gates,
   `commander`, Effect, and the existing `node:*` / npm imports are all kept
   unchanged. Deno is added **only** to produce the distributed binary and to run
   the source as a compiled CLI. Deno 2 executes the existing `node:*` + npm code
   natively via `nodeModulesDir` + the existing `package.json`.
2. **The subprocess jail is Deno's compile-time permission set, not runtime
   TypeScript.** A verified spike (Deno 2.8.3) confirmed that
   `deno compile --allow-run=<list>` gates `node:child_process` spawns, survives
   compilation, and surfaces a clean `'error'` event (`Requires run access to
"<bin>"…`) on the async `spawn` path phax already uses — so the existing
   `ShellError` path reports denials. **No runtime allowlist-checking code is
   written.** The executable allowlist is the baked `--allow-run` list; command
   _arguments_ stay dynamic from `phax.json`. Spec acceptance criterion 10
   ("validate configured commands before execution") is satisfied by Deno's
   permission denial, not a bespoke validator.
3. **npm = prepare only.** The release workflow version-matches the wrapper to the
   tag and runs `npm publish --dry-run`. No live registry publish, no `NPM_TOKEN`.
4. **Deno is now installed locally**, so Deno-specific phases are mechanically
   gate-verifiable (a `deno:smoke` gate runs the CLI under Deno).
5. **Out of scope (spec owner):** Windows targets, `phax run/resume
--start-after` (acceptance criteria 18–19), and any runtime command-allowlist
   validator. Acceptance criterion 11 (record launched commands) is treated as
   already covered by existing run telemetry and is not re-implemented here.

## Permission posture compiled into the binary

```
--allow-read --allow-write          # broad FS access (spec §4)
--allow-env                         # REQUIRED: node:child_process resolves
                                    #   executables via PATH (spec §6 subprocess
                                    #   exception). phax still uses files, not
                                    #   env, for its own config.
(no --allow-net)                    # network denied for phax itself (spec §5)
--allow-run=git,claude,codex,vibe,node,npm,pnpm,bun,deno,mise,rm,sh,bash,zsh,zed,code,vim,nano
```

The `--allow-run` list is a baked default. Editors/shells/package managers outside
it require a custom build — documented as an accepted limitation (spec §9 "the
exact list should be configurable").

## Primary risk

Largely retired by the `15` prerequisite: with the project already on TypeScript
6.0.3 (the version Deno bundles), `deno check`/`deno compile` see the same types
`pnpm typecheck` already enforces. The residual unknown is Deno's module
**resolution** of npm + `node:*` specifiers (not type-checking), handled in
phase-01 via `nodeModulesDir` + the existing `package.json`. phase-01 still gates
on **running** the CLI under Deno (`deno run … --version`) as the definitive proof
that resolution and execution work end to end.

## Phase overview

| Phase    | Outcome                                                                                  |
| -------- | ---------------------------------------------------------------------------------------- |
| phase-01 | `deno.json` + the CLI runs under Deno; `deno:smoke` added to the `full` gate             |
| phase-02 | `deno compile` produces a permission-posture binary + a host-build script with checksums |
| phase-03 | npm wrapper package that resolves the correct platform binary (unit-tested)              |
| phase-04 | CI workflow (`.github/workflows/ci.yml`)                                                 |
| phase-05 | Release workflow on `v*` tags (binaries, checksums, GH Release, npm prepare)             |
| phase-06 | README + spec docs for install, posture, and the provider-CLI caveat                     |

---

## phase-01 — Deno runtime config and run-under-Deno parity {#phase-01-deno-config}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Make the existing Node/TypeScript CLI executable under Deno without changing any
application code, and prove it by running `phax` through Deno in the gate. This is
the foundation every later phase builds on.

### Detailed instructions

- Add `deno.json` at the repo root:
  - `"nodeModulesDir": "auto"` so Deno resolves the existing `package.json`
    dependencies and `node:*` specifiers from `node_modules`.
  - `compilerOptions` mirroring `tsconfig.json` where Deno honors them
    (`strict`, `lib: ["deno.window", "ES2023"]` or equivalent). Do not fight
    Deno over options it ignores; the authoritative type-check remains
    `pnpm typecheck` (tsc).
  - Exclude `dist/`, `node_modules/`, `coverage/`, `tests/e2e` from Deno's own
    fmt/lint so they never run (oxlint/oxfmt stay authoritative). Add
    `"fmt": { "exclude": ["**/*"] }` and `"lint": { "exclude": ["**/*"] }` or an
    equivalent that keeps Deno's fmt/lint out of the gates entirely.
  - `tasks`:
    - `dev`: `deno run --allow-read --allow-write --allow-env --allow-run=git,claude,codex,vibe,node,npm,pnpm,bun,deno,mise,rm,sh,bash,zsh,zed,code,vim,nano src/cli/main.ts`
    - `check`: `deno check src/cli/main.ts` (optional, local only)
- Add to `package.json` scripts:
  - `"deno:smoke": "deno run --allow-read --allow-env --allow-run=git src/cli/main.ts --version"`
    — a minimal startup smoke that proves Deno executes the CLI and that
    `--version` prints `0.1.0` and exits 0. Keep the flag set minimal here;
    full-posture flags are exercised by the phase-02 binary smoke.
  - `"deno:check": "deno check src/cli/main.ts"` (optional local script; **not**
    added to any gate profile).
- Edit `phax.json`: append `"pnpm deno:smoke"` to the `gateProfiles.full` array
  so every subsequent phase mechanically verifies the source still runs under
  Deno. Do **not** add it to `fast`.
- Do not modify any file under `src/`. If `deno run` surfaces a resolution issue,
  fix it in `deno.json` (e.g. `nodeModulesDir`, an import map), never by editing
  application code. If a third-party package genuinely cannot resolve under Deno,
  stop and record the blocker in the handoff rather than rewriting source.

### Planned files to create

- `deno.json`

### Planned files to edit

- `package.json`
- `phax.json`

### Optional files that may be edited

- (none)

### Boundary contracts

This phase crosses no application boundary — it adds a parallel runtime/build
surface around the unchanged CLI entrypoint `src/cli/main.ts`.

### Test strategy

CLI/runtime layer, verified by execution rather than unit tests: the
`pnpm deno:smoke` gate is the test — `deno run … --version` must exit 0 and print
`0.1.0`. No new vitest tests; the existing `full` suite continues to assert the
Node build is unaffected.

### Implementation order

`deno.json` first → confirm `deno task dev --help` runs → add the `deno:smoke`
script → wire it into `phax.json` `full` → run the full gate.

### Excluded scope

- `deno compile` / binary production (phase-02).
- Any change to `src/` application code.
- Adding `deno check` to a blocking gate (kept optional due to TS-version drift).

### Verification

- The project's `full` gate profile in `phax.json`, which now includes
  `pnpm deno:smoke`.

### Expected handoff content

- The exact `deno.json` task names and the full `--allow-*` flag string used for
  `dev` (later phases copy it verbatim).
- The exact `deno:smoke` script line and confirmation it exits 0 printing
  `0.1.0`.
- Whether `deno check` passes cleanly today; if not, the specific errors, so
  phase-02 knows whether `deno compile` will need workarounds.
- Any `deno.json` resolution setting required to make npm/`node:*` imports load
  (e.g. `nodeModulesDir`), since phase-02 reuses the same config.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(build): add deno.json and run the phax CLI under Deno

### Commit body

Add a deno.json that lets Deno execute the existing Node/TypeScript CLI via
nodeModulesDir and the current package.json, with Deno's own fmt/lint kept out of
the gates. Add a `deno:smoke` script that runs `phax --version` under Deno and
wire it into the `full` gate profile so every phase verifies the source still
runs under Deno. No application code changes; the Node toolchain stays
authoritative.

---

## phase-02 — Compiled binary with permission posture {#phase-02-compile-binary}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Produce a single-file `phax` binary via `deno compile` carrying the intended
permission posture, plus a script that builds all release targets with SHA-256
checksums.

### Detailed instructions

- Add `deno.json` tasks (reuse phase-01's flag string):
  - `compile`: host build →
    `deno compile --allow-read --allow-write --allow-env --allow-run=git,claude,codex,vibe,node,npm,pnpm,bun,deno,mise,rm,sh,bash,zsh,zed,code,vim,nano --output dist/bin/phax src/cli/main.ts`
    (no `--allow-net`, so phax's own network is denied).
- Add `scripts/build-binaries.ts` (a Deno script) that compiles all four release
  targets and writes each binary plus a `.sha256` checksum into `dist/release/`:
  - `aarch64-apple-darwin` → `phax-darwin-arm64`
  - `x86_64-apple-darwin` → `phax-darwin-x64`
  - `x86_64-unknown-linux-gnu` → `phax-linux-x64`
  - `aarch64-unknown-linux-gnu` → `phax-linux-arm64`
  - Each via `deno compile --target <triple> --output dist/release/<name>` with
    the same `--allow-*` flags. Compute SHA-256 with Deno's
    `crypto.subtle.digest` (no external tool) and write `<name>.sha256` next to
    each binary in `sha256sum`-compatible `<hex>  <name>` format.
  - Keep the platform→target→output mapping in one exported constant so the npm
    wrapper (phase-03) and release workflow (phase-05) can import the same
    source of truth.
- Add `package.json` scripts: `"deno:compile": "deno task compile"` and
  `"deno:build-binaries": "deno run --allow-read --allow-write --allow-run=deno --allow-env scripts/build-binaries.ts"`.
- Add a host-binary smoke to the gate: a script
  `"deno:smoke-binary"` that runs `deno task compile` then executes
  `dist/bin/phax --version` (exit 0, prints `0.1.0`) and a denial probe — invoke
  a path the binary should refuse and assert it fails. Keep the denial probe
  cheap and deterministic (e.g. assert a non-allowlisted executable yields a
  non-zero exit / `ShellError`-style failure through an existing phax command, or
  a tiny inline check). Add `"pnpm deno:smoke-binary"` to `gateProfiles.full`.
- Ensure `dist/release/` and `dist/bin/` are git-ignored (the existing
  `.gitignore` already ignores `dist/`).

### Planned files to create

- `scripts/build-binaries.ts`

### Planned files to edit

- `deno.json`
- `package.json`
- `phax.json`

### Optional files that may be edited

- `.gitignore`

### Boundary contracts

Producer of the **release artifact contract** consumed by phase-03 (npm wrapper)
and phase-05 (release workflow): the binary file names
(`phax-<platform>-<arch>`), their `dist/release/` location, and the
`<hex>  <name>` checksum format. Keep the platform→name mapping exported from
`scripts/build-binaries.ts` as the single source of truth.

### Test strategy

CLI/build layer, verified by execution: `pnpm deno:smoke-binary` compiles the
host binary and asserts `--version` works and a denied executable fails. The pure
platform→target→output mapping is exercised indirectly here and unit-tested for
the wrapper in phase-03 (shared constant).

### Implementation order

Host `compile` task → confirm `dist/bin/phax --version` → factor the
target/name mapping into a shared constant → `build-binaries.ts` for all targets

- checksums → smoke gate.

### Excluded scope

- npm wrapper (phase-03).
- CI/release workflows (phase-04/05).
- Cross-compiling in the gate (the gate builds only the host target; all four
  targets are built on demand / in CI).

### Verification

- The `full` gate profile, now including `pnpm deno:smoke-binary`.

### Expected handoff content

- The exact `deno compile` flag string used (copied by the release workflow).
- The exported name of the platform→target→output mapping constant and its module
  path in `scripts/build-binaries.ts` (phase-03 and phase-05 import it).
- The exact binary file names and checksum file format produced in
  `dist/release/`.
- Confirmation `dist/bin/phax --version` runs and the denial probe fails as
  expected, with the observed denial message.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(build): compile phax to a permissioned binary with release targets

### Commit body

Add deno compile tasks that produce a single-file phax binary carrying the
intended permission posture (filesystem yes, network denied, env for PATH, run
restricted to an explicit executable allowlist), plus a build-binaries script
that cross-compiles the four release targets and writes SHA-256 checksums. A new
deno:smoke-binary gate compiles the host binary and asserts startup and
executable-denial behavior.

---

## phase-03 — npm wrapper package {#phase-03-npm-wrapper}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Provide an npm package that installs/invokes the correct platform binary, with the
pure resolution logic unit-tested. Prepare-only — no publish in this phase.

### Detailed instructions

- Create an `npm/` wrapper package directory:
  - `npm/package.json`: name `phax`, `bin` → `npm/bin/phax.cjs`, `version`
    matching the root `package.json` (`0.1.0`), `os`/`cpu` left broad,
    `files` whitelisting the launcher + resolver. This package is distinct from
    the root dev `package.json`; it is the published wrapper.
  - `npm/lib/resolveBinary.ts`: **pure** functions —
    - `binaryName(platform, arch)` mapping Node's `process.platform` +
      `process.arch` → the phase-02 file names (`phax-darwin-arm64`,
      `phax-darwin-x64`, `phax-linux-x64`, `phax-linux-arm64`); throw a clear
      "unsupported platform" error otherwise (Windows included → unsupported).
    - `releaseAssetUrl(version, platform, arch)` → the GitHub Releases download
      URL for tag `v<version>` and that asset name.
    - Keep this consistent with phase-02's exported mapping (mirror the names;
      reference the phase-02 constant in a comment so future edits stay in sync).
  - `npm/bin/phax.cjs`: a thin launcher that resolves the local binary path
    (downloading the matching asset from `releaseAssetUrl` into a cache dir on
    first run if absent), then `execFileSync`/`spawn`s it forwarding argv and the
    exit code. Network/download lives only in the launcher, never in the unit
    tests.
- Add `tests/unit/npmWrapperResolve.test.ts` (vitest) covering `binaryName` and
  `releaseAssetUrl`: each supported platform/arch pair maps to the exact expected
  asset name, the URL embeds `v<version>` and the asset, and unsupported
  platforms (e.g. `win32`) throw. Import directly from `../../npm/lib/resolveBinary.ts`.
- If vitest does not pick up `npm/lib/**` imports, adjust `vitest.config.ts`
  include/allow only as needed. If `knip` flags the wrapper files as unused,
  add the `npm/` entry points to `knip.json`.

### Planned files to create

- `npm/package.json`
- `npm/lib/resolveBinary.ts`
- `npm/bin/phax.cjs`
- `tests/unit/npmWrapperResolve.test.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- `vitest.config.ts`
- `knip.json`

### Boundary contracts

Consumer of phase-02's **release artifact contract** (binary file names) and
producer of the **wrapper resolution contract** the release workflow (phase-05)
relies on for version-matching: `version` in `npm/package.json` must equal the
release tag, and `releaseAssetUrl` must point at that tag's assets.

### Test strategy

Pure resolver = unit tests (write them before the implementation: the
platform→asset mapping and URL shape are a stable contract and directly back
acceptance criterion 14). The launcher's network/exec path is integration-y and
is left to manual/CI verification, not unit tests.

### Implementation order

Write `npmWrapperResolve.test.ts` against the intended `binaryName`/
`releaseAssetUrl` signatures → implement `resolveBinary.ts` to green → write the
`phax.cjs` launcher around it → `npm/package.json`.

### Excluded scope

- Publishing to npm (phase-05 runs `npm publish --dry-run` only).
- The release workflow that version-matches the wrapper (phase-05).
- Windows binaries (unsupported by design).

### Verification

- The `full` gate profile (now also running the new unit tests).

### Expected handoff content

- The exported signatures of `binaryName` and `releaseAssetUrl` and the exact
  asset-name strings per platform.
- The cache directory / download behavior of `npm/bin/phax.cjs`.
- That `npm/package.json` `version` is `0.1.0` and must be bumped to match the
  release tag by the phase-05 workflow.
- Whether `vitest.config.ts` or `knip.json` had to change, and why.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(dist): add npm wrapper that resolves the platform phax binary

### Commit body

Add an npm wrapper package whose launcher resolves and invokes the correct
platform binary, downloading the matching GitHub Releases asset on first run. The
pure platform→asset and asset-URL logic is unit-tested for every supported
platform and rejects unsupported ones (including Windows). Prepare-only: no
registry publish here.

---

## phase-04 — Continuous integration workflow {#phase-04-ci-workflow}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low

Add a GitHub Actions CI workflow that typechecks, tests, lints, and validates the
package on normal development events.

### Detailed instructions

- Create `.github/workflows/ci.yml`, triggered on `push` and `pull_request` to
  the default branch:
  - Set up Node (matching `engines.node` >= 20), pnpm, and Deno
    (`denoland/setup-deno`).
  - `pnpm install`.
  - Run the `full` gate equivalents: `pnpm typecheck`, `pnpm test`, `pnpm lint`,
    `pnpm format:check`, `pnpm knip`, `pnpm build`, `pnpm audit:architecture`,
    plus `pnpm deno:smoke` and `pnpm deno:compile` (host binary builds). Mirror
    the `phax.json` `full` profile so CI and local gates agree.
- Add `tests/unit/ciWorkflow.test.ts` (vitest): read `.github/workflows/ci.yml`
  as text and assert the invariants mechanically — triggers include
  `pull_request`, a Deno setup step is present, and the gate commands
  (`pnpm typecheck`, `pnpm test`, `pnpm deno:compile`) appear. Text assertions
  only; do not add a YAML parser dependency.

### Planned files to create

- `.github/workflows/ci.yml`
- `tests/unit/ciWorkflow.test.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- (none)

### Boundary contracts

This phase crosses no application boundary; it mirrors the `phax.json` `full`
gate into CI. Keep the two in sync — the workflow test asserts the key gate
commands are present.

### Test strategy

Config layer verified by a text-invariant unit test (the planning skill's
recommended way to gate a config file mechanically without new deps). Write the
assertions to match the intended workflow before finalizing the YAML.

### Implementation order

Draft `ci.yml` → write `ciWorkflow.test.ts` asserting its invariants → run the
gate.

### Excluded scope

- The release workflow and tag triggers (phase-05).
- Any live publishing.

### Verification

- The `full` gate profile (now including the workflow invariant test).

### Expected handoff content

- The job/step names in `ci.yml` and the exact list of gate commands it runs, so
  phase-05 can reuse the same setup steps.
- The setup-deno action version pinned.
- Any deviation from the planned file lists, with the reason.

### Commit subject

ci: add continuous integration workflow

### Commit body

Add a GitHub Actions CI workflow that installs Node, pnpm, and Deno and runs the
full gate (typecheck, tests, lint, format check, knip, build, architecture audit)
plus the Deno smoke and host-binary compile, mirroring the phax.json full
profile. A text-invariant unit test asserts the workflow keeps its required
triggers and steps.

---

## phase-05 — Release workflow on Git tags {#phase-05-release-workflow}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Add a tag-triggered release workflow that builds the four binaries with
checksums, creates the GitHub Release, uploads artifacts, and prepares (dry-runs)
the npm wrapper at the tag version.

### Detailed instructions

- Create `.github/workflows/release.yml`, triggered on `v*` tags only:
  - Set up Node, pnpm, Deno; `pnpm install`.
  - Run the gate (or depend on CI) so a failing build/test/package fails the
    release.
  - Build all four targets via `pnpm deno:build-binaries` (phase-02), producing
    `dist/release/phax-*` binaries and `*.sha256` checksums.
  - Create or update the GitHub Release for the tag and upload every binary and
    checksum (use the `gh` CLI or an official release action; `GITHUB_TOKEN`
    only — no `NPM_TOKEN`).
  - Prepare the npm wrapper: set `npm/package.json` `version` to the tag's
    version (strip the leading `v`), then run `npm publish --dry-run` from
    `npm/`. **Do not publish** to the registry.
  - Fail the workflow if the wrapper version does not equal the tag version.
- Add `scripts/prepare-npm.ts` (Deno or Node): given a tag/version, rewrite
  `npm/package.json` `version` and assert it matches; export a pure
  `versionFromTag(tag)` (`v1.2.3` → `1.2.3`, reject malformed tags).
- Add `tests/unit/releaseWorkflow.test.ts` (vitest): text-assert `release.yml`
  triggers on `v*` tags, builds binaries, generates checksums, uploads to the
  release, and runs `npm publish --dry-run`; and unit-test `versionFromTag`
  including rejection of malformed tags.

### Planned files to create

- `.github/workflows/release.yml`
- `scripts/prepare-npm.ts`
- `tests/unit/releaseWorkflow.test.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- `npm/package.json`

### Boundary contracts

Consumer of phase-02's release-artifact contract (binary names + checksum format)
and phase-03's wrapper-version contract (`npm/package.json` `version` must equal
the tag). `versionFromTag` is the producer of the matched version both the
release and the wrapper rely on.

### Test strategy

`versionFromTag` is a pure contract → unit-test first (it backs acceptance
criterion 17, version match). The workflow file is gated by a text-invariant
test as in phase-04. Network publish is intentionally a dry-run, so no live
integration test.

### Implementation order

`versionFromTag` + its test → `prepare-npm.ts` → `release.yml` → workflow
invariant test → gate.

### Excluded scope

- Live npm registry publish (dry-run only).
- Windows artifacts.
- Signing/notarization of binaries.

### Verification

- The `full` gate profile (now including the release invariant + `versionFromTag`
  tests).

### Expected handoff content

- The release trigger pattern (`v*`), the artifact names uploaded, and that
  publishing is `--dry-run` only (no `NPM_TOKEN`).
- The `versionFromTag` signature and its module path.
- Confirmation the workflow fails when wrapper version ≠ tag version.
- Any deviation from the planned file lists, with the reason.

### Commit subject

ci: add tag-triggered release workflow with checksums and npm prepare

### Commit body

Add a release workflow that runs on v\* tags: it builds the four platform binaries
with SHA-256 checksums, creates the GitHub Release and uploads the artifacts, and
prepares the npm wrapper by version-matching it to the tag and running npm publish
--dry-run (no live publish, no NPM_TOKEN). A pure versionFromTag helper and
text-invariant workflow tests back the version-match and required steps.

---

## phase-06 — Distribution and runtime posture docs {#phase-06-docs}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low

Document installation, the Deno permission posture, the provider-CLI sandboxing
caveat, and the macOS long-running recommendation.

### Detailed instructions

- Update `README.md`:
  - In `## Install`, document the two distribution paths: `npm install -g phax` /
    `npx phax` (the wrapper resolves the platform binary) and direct download of
    a binary + checksum from GitHub Releases.
  - Add a runtime-posture note: filesystem access yes; phax network access no;
    env access only for subprocess PATH resolution; subprocess execution
    restricted to the baked `--allow-run` allowlist, with the documented
    limitation that editors/shells/tools outside the list need a custom build.
  - State explicitly that **Deno's permissions sandbox phax, not the provider
    CLIs** it launches (`claude`, `codex`, `vibe`) — those run with their own
    permissions (spec §8, acceptance criterion 12). Cross-link the existing
    `## Security notes`.
  - In `## Environment variables` and/or `## Run`, add the macOS sleep note:
    long-running `phax run` sessions can be wrapped with
    `caffeinate -ims phax run my-run` to prevent sleep (acceptance criterion 20;
    `--start-after` itself is out of scope).
- Update `docs/specs/06-deno-runtime.md` status line (or add a short note) marking
  the spec as implemented, listing the descoped criteria (10 satisfied via Deno
  denial; 11 via existing telemetry; 18–19 not implemented).

### Planned files to create

- (none)

### Planned files to edit

- `README.md`
- `docs/specs/06-deno-runtime.md`

### Optional files that may be edited

- (none)

### Boundary contracts

This phase crosses no boundary; documentation only.

### Test strategy

Docs-only commit. No new tests; the existing `full` gate confirms nothing else
regressed.

### Implementation order

README install + posture + caveat + caffeinate note → spec status update → gate.

### Excluded scope

- Any code or workflow change.
- Documenting `--start-after` (out of scope).

### Verification

- The `full` gate profile (docs change must not break gates).

### Expected handoff content

- The README sections touched and that the provider-CLI sandboxing caveat is
  stated.
- Which acceptance criteria are documented as descoped/satisfied-differently.
- Any deviation from the planned file lists, with the reason.

### Commit subject

docs: document phax distribution, deno posture, and macOS sleep note

### Commit body

Document the npm-wrapper and GitHub Releases install paths, the Deno permission
posture (filesystem yes, network no, env for PATH, run allowlisted), and the
explicit caveat that Deno sandboxes phax but not the provider CLIs it launches.
Add the caffeinate recommendation for long-running runs and mark the Deno runtime
spec implemented with its descoped criteria noted.
