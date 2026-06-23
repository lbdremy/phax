# Plan 28 — Fix shell completions and `--usage-format json` in the compiled binary

## Problem

`phax completions zsh` fails when run from the released (deno-compiled) binary:

```
Error: usage generate completion failed (exit 181):
xx::file … No such file or directory
File: /var/folders/…/T/deno-compile-phax-darwin-arm64/phax.usage.kdl
```

Root cause: `phax.usage.kdl` is embedded into the binary via
`deno compile --include`. At runtime it lives in deno's **virtual filesystem**
(VFS) at a `deno-compile-…` temp path. `node:fs` reads (`existsSync`,
`readFileSync`) work because deno shims them over the VFS — which is why
`phax --usage` (KDL, read by phax itself) works. But `completions.ts` and the
`json` branch of `usage.ts` shell out to the **external `usage` CLI** with
`-f <vfsPath>`. That separate process cannot see deno's VFS, so it gets
"No such file or directory".

The same defect affects `phax --usage-format json` (it runs
`usage generate json -f <vfsPath>`).

The existing `tests/integration/completions.test.ts` never caught this because it
runs via `tsx` in dev mode, where the spec is a real on-disk file.
`scripts/smoke-binary.sh` exercises the compiled binary but only checks
`--version` and `--usage` (KDL) — not the two paths that invoke the external
`usage` CLI.

## Fix

`usage` v3 accepts the spec on **stdin** via `-f -` (verified:
`cat phax.usage.kdl | usage generate completion zsh phax -f -` succeeds, and
`usage generate json -f -` likewise). phax already reads the spec content over
the VFS with `readFileSync`. So: read the content, pipe it to `usage … -f -`
through `spawnSync`'s `input`, and never hand the external process a VFS path.

Extend `smoke-binary.sh` to assert both paths work in the compiled binary so the
bug cannot silently regress.

## Required commands

- (none)

(`deno` and `usage` are already in `phax.json` `security.agentCommands`; the
gate runs `pnpm` scripts that already exist.)

## phase-01 — Pipe the usage spec over stdin to the `usage` CLI {#phase-01-stdin-spec}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Make `phax completions <shell>` and `phax --usage-format json` work in the
compiled binary by piping the embedded KDL spec to the external `usage` CLI over
stdin (`-f -`) instead of passing a path that only exists in deno's virtual
filesystem. Add a binary-level regression guard so the gap that let this ship is
closed.

### Detailed instructions

- Add a shared helper module `src/cli/commands/usageSpec.ts`:
  - `resolveSpecPath()` (module-private): `join(dirname(fileURLToPath(import.meta.url)), "../../../phax.usage.kdl")` — identical to the existing duplicates so it resolves to the repo root in dev/installed layouts and to the VFS root in the compiled binary.
  - Exported `readUsageSpec(): { found: true; content: string } | { found: false; path: string }` — reads the spec with `readFileSync` (works over the VFS) or reports the resolved path when missing, so call sites can keep their actionable "not found" message.
  - Document in a comment that the content must be piped to `usage … -f -`, never handed over as a path, because external processes cannot see deno's VFS.
- Update `src/cli/commands/completions.ts`:
  - Replace its local `resolveSpecPath` + existence check with `readUsageSpec()`.
  - On `{ found: false }`, keep the existing stderr message (`phax.usage.kdl not found at <path>` …) using the returned `path`.
  - Change the `spawnSync` call to `usage generate completion <shell> phax -f -` and pass the spec content via the `input` option (keep `encoding: "utf8"` and `env`). Preserve the existing ENOENT-"install usage" handling and the non-zero-exit error reporting unchanged.
- Update `src/cli/commands/usage.ts`:
  - Replace its local `resolveSpecPath` + existence checks with `readUsageSpec()`.
  - `json` branch: change to `usage generate json -f -` with the content passed via `input`. Keep the ENOENT and non-zero-exit handling unchanged.
  - `kdl` branch: write `spec.content` directly (no second `readFileSync`).
  - Leave `readPackageVersion()` (reads `package.json`) in this file, unchanged.
- Extend `scripts/smoke-binary.sh` to run against `./dist/bin/phax` after the existing `--usage` check:
  - Assert `./dist/bin/phax completions zsh` exits 0 and its output contains `#compdef phax` (or `_phax`); fail loudly with the captured output otherwise. **Guard on `usage` being on PATH** — mirror the dev test's skip when `usage --version` is unavailable, so CI without `usage` is not broken; print an explicit "SKIP" line when skipped.
  - Assert `./dist/bin/phax --usage-format json` exits 0 and its output contains `"name": "phax"`, under the same `usage`-available guard.
- Optionally add a dev-mode assertion in `tests/integration/completions.test.ts` that stdout still begins with a `#compdef`/`_phax` marker, to document the contract (dev mode cannot reproduce the VFS bug, so this is documentation, not the regression guard).

### Planned files to create

- `src/cli/commands/usageSpec.ts`

### Planned files to edit

- `src/cli/commands/completions.ts`
- `src/cli/commands/usage.ts`
- `scripts/smoke-binary.sh`

### Optional files that may be edited

- `tests/integration/completions.test.ts`
- `tests/integration/usageOutput.test.ts`

### Boundary contracts

The completion/usage commands live in the CLI view layer and shell out to an
external tool (`usage`). The stable contract this phase changes is the
phax → `usage` invocation: spec content is delivered on stdin (`-f -`) rather
than as a filesystem path. No phax architectural layer boundary is crossed; the
helper stays within `src/cli/commands/`.

### Test strategy

- CLI/binary layer (the only layer that reproduces the defect): extend
  `scripts/smoke-binary.sh` (run by the `full` gate via `pnpm deno:smoke-binary`)
  to compile the host binary and assert `completions zsh` and
  `--usage-format json` succeed. Write these assertions as part of this phase —
  they are the mechanical proof the fix works end to end.
- Integration (dev mode, `tsx`): existing `completions.test.ts` and
  `usageOutput.test.ts` must continue to pass; optionally tighten an assertion as
  documentation. Dev mode reads a real file and cannot reproduce the VFS path, so
  it is not the regression guard.

### Implementation order

1. `src/cli/commands/usageSpec.ts` (shared reader).
2. `src/cli/commands/completions.ts` (stdin invocation).
3. `src/cli/commands/usage.ts` (stdin invocation + kdl reuse).
4. `scripts/smoke-binary.sh` (binary regression guard).
5. Optional dev-mode test assertions.

### Excluded scope

- No change to how the spec is generated (`scripts/generate-usage-spec.ts`),
  embedded (`deno compile --include`), or to `phax.usage.kdl` itself.
- No change to `phax --usage` (KDL) — it already works (phax reads the file).
- No new runtime dependency and no change to `phax.json` security config.

### Verification

- The project's configured `full` gate profile in `phax.json` (which runs
  `pnpm deno:smoke-binary`, now covering `completions` and `--usage-format json`
  against the compiled binary).

### Expected handoff content

- The exact path `src/cli/commands/usageSpec.ts` and the `readUsageSpec()`
  return shape.
- Confirmation that `completions.ts` and the `usage.ts` `json` branch now invoke
  `usage … -f -` with the spec piped via `spawnSync`'s `input`.
- The new `smoke-binary.sh` assertions and whether the `usage`-available guard
  was exercised or skipped in this environment.
- Any deviation from the planned file lists, with the reason (e.g. whether the
  optional test files were touched).

### Commit subject

fix(cli): pipe usage spec over stdin so completions work in the binary

### Commit body

The phax.usage.kdl spec is embedded in the deno-compiled binary's virtual
filesystem. phax reads it fine via node:fs shims, but the external `usage` CLI
is a separate process that cannot see the VFS, so `usage -f <vfsPath>` failed
with "No such file or directory" for `phax completions` and
`phax --usage-format json`.

Read the spec content (works over the VFS) and pipe it to `usage … -f -` over
stdin via a shared readUsageSpec() helper, instead of passing a VFS path. Extend
smoke-binary.sh to run `completions zsh` and `--usage-format json` against the
compiled binary so the gap that let this ship is closed.
