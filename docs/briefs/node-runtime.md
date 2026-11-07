Write the phax spec `node-runtime`: phax's release binary and its permission posture move from Deno to Node.js 26
LTS, so phax stops depending on a runtime whose development ends in 2027.

## Why

Deno does two jobs for phax today, and only those two (spec `docs/specs/archive/2606120941-deno-runtime.md`, option B
"dual runtime": the Node toolchain stays authoritative, Deno only builds and runs the distributed binary):

- **Packaging.** `deno compile` turns the esbuild bundle into one executable per release target, so a user needs no JS
  runtime installed.
- **Permissions.** The binary is compiled with `--allow-read --allow-write --allow-env --allow-sys --allow-run` and no
  `--allow-net`: phax's own process cannot open a network connection (`CONTRIBUTING.md`, "The binary").

Cloudflare acquired Deno in October 2026, and press coverage reports that core runtime development ends around October
2027 after one year of maintenance and security updates (secondary sources; the primary Deno and Cloudflare posts were
not read). A compiled binary keeps working after that date, but its embedded runtime stops getting security fixes.

Node now covers both jobs:

- **Permission model.** `--permission` is stable since Node 22.13 / 23.5. It restricts the file system
  (`--allow-fs-read`, `--allow-fs-write`), child processes (`--allow-child-process`), environment variables
  (`--allow-env`), workers, addons, WASI and FFI. Network (`--allow-net`) was added in **Node 25.0.0**, is marked
  "Stability 1.1 – Active development", and is a plain on/off switch with no host list. Measured on Node 24.21:
  `node --help` lists `--permission` and `--allow-child-process` but no `--allow-net`, so on Node 24 the permission
  model does not restrict network at all.
- **Single executable applications.** `node --build-sea <config.json>` builds an executable from a config with `main`,
  `mainFormat` (`module` for ESM), `output`, `executable` (the Node binary to inject into, the current one when not
  given), `assets` (read back through `sea.getAsset()`), `useVfs` / `vfsArchive`, and `execArgv`. Measured on Node 24.21:
  `--build-sea` is absent.

Node 26 became LTS on 2026-10-28 and is supported until April 2029. It is the first LTS line that has both
`--allow-net` and `--build-sea`. The repository still targets Node 24 (`engines: ">=24"`, `node-version: "24"` in
`ci.yml`, `release.yml` and `docs-deploy.yml`).

## What already exists (read it; do not restate it as new)

- **The build**: `scripts/build-binaries.ts`. It bundles with esbuild first (deno compile does not tree-shake: 274 MB of
  `node_modules` without it, about 74 MB with it), then compiles with `--include package.json`, `phax.usage.kdl` and
  `.claude/skills`. The bundle sits three directories deep (`dist/release/bundle/phax.mjs`) so that
  `import.meta.url` + `../../../` resolves to the VFS root where `--include` drops those files. `RELEASE_TARGETS` names
  the four targets; each binary gets a `sha256sum`-compatible `.sha256` sidecar.
- **The runtime file lookups**: `src/cli/commands/usageSpec.ts:11` and the skills and `package.json` readers rely on
  that three-deep path trick.
- **Deno entry points and config**: `deno.json` (`nodeModulesDir: "auto"`, tasks, `allowScripts`),
  `scripts/prepare-npm.ts` (written against `Deno.*` APIs; `scripts/releaseVersion.ts` and `scripts/npmReadme.ts` are
  already runtime-free), `scripts/smoke-binary.sh`, and the `deno:*` scripts in `package.json`.
- **CI and release**: `setup-deno`, `pnpm deno:smoke` and `pnpm deno:compile` in `.github/workflows/ci.yml`;
  `setup-deno`, `deno:smoke`, `deno:build-binaries` and `deno run … scripts/prepare-npm.ts` in
  `.github/workflows/release.yml`; the release flow in `docs/release.md`.
- **The npm launcher**: `npm/bin/phax` and `npm/lib/resolveBinary.mts` download the matching release binary on first
  run, verify it against its `.sha256` sidecar and cache it under `~/.phax/bin/<version>/` (`docs/security.md`,
  "Verified binary installs").
- **The documented posture**: the permission table in `CONTRIBUTING.md` and the release audit in `docs/security.md` and
  `scripts/security/` (`release-audit.sh` names `pnpm deno:build-binaries`).
- **An open defect Deno causes**: `NEXT_STEPS.md`, "Deno relinks `node_modules` in phase worktrees past the lockfile".
  It disappears with Deno.

## What is settled (do not reopen)

1. **phax leaves Deno before its development ends.** No other runtime with a compile step (Bun, for instance) is
   evaluated: the toolchain is already Node.
2. **Node 26 LTS is the floor**: the runtime the binary embeds, `engines`, and the Node used by CI and release. The
   schemas package keeps its own Node 20 smoke (`ci.yml`, `release.yml`): its consumers are not phax's runtime.
3. **The posture stays at least as strict as today's**: file system read and write, environment, child processes
   unrestricted, network denied to phax's own process. The spec says plainly, as `CONTRIBUTING.md` does, that the
   subprocesses phax starts (`git`, `gh`, the agent CLIs) are not bound by it.
4. **Release targets and verification are unchanged**: the four targets of `RELEASE_TARGETS`, a `.sha256` per binary,
   the npm launcher's verification before anything runs.
5. **The Node toolchain stays authoritative** (`tsc`, vitest, tsx, oxlint, oxfmt, pnpm), as in the Deno spec.

## Settle in §9, framing each option by what it abandons

- **Keep a binary, or ship on the user's Node.** A Node SEA per target keeps the runtime-free install and the
  launcher's verified download, at the cost of a larger binary and a cross-build. Publishing the npm package to run on
  the user's Node 26 (`bin` pointing at the bundle) drops the binary, the launcher's download and the GitHub Release
  assets, and abandons users who have no Node 26 (Claude Code and Codex ship native binaries, so a phax user may have
  no Node at all).
- **Where the permission flags live.** In the SEA config's `execArgv`; in the npm entry's shebang
  (`#!/usr/bin/env -S node --permission …`, which needs an `env` that supports `-S`); or a launcher that re-executes
  Node with them. Say what each loses when the flags are missing, and how a test proves they apply.
- **How the binary reads its three files.** `sea.getAsset()` behind the existing readers, or the SEA VFS keeping the
  `import.meta.url` lookups. Either way, the three-deep path trick goes.
- **How the four targets are built.** One runner injecting into downloaded Node binaries for each target
  (`executable`), or a matrix of native runners. macOS binaries need a `codesign` after injection; say who signs and
  with what identity (today they are not notarized, `README.md`).
- **Spike first, or specify straight away.** Nothing above was measured inside a built SEA: that `--permission` and
  `--allow-net` given through `execArgv` hold in the executable, that an ESM bundle runs as `main`, that a cross-target
  build works from one host, and how large the binary is. Either a first spike phase measures them (the deliverable is
  the answers and the script that gets them; see plan 39's spike pattern), or the spec states them as assumptions,
  each with the acceptance criterion that proves it.

## Constraints

- **No back-compat shims**: Deno, `deno.json`, the `deno:*` scripts and `setup-deno` go in the same change that lands
  the replacement. No dual build.
- **The binary's behaviour is unchanged**: `--version`, `--usage`, completions and the skills it embeds answer as today,
  proved by the binary smoke (`scripts/smoke-binary.sh` or its successor), plus one check that a network call from
  phax's own process is refused.
- **The documentation moves with it**: the "The binary" table in `CONTRIBUTING.md`, `docs/release.md`,
  `docs/security.md` and `scripts/security/` name the new build, and `docs/upgrading.md` names the Node 26 floor.
- **§9 holds genuine choices only**, each with its options, what each abandons and a recommended default.

## Out of scope

- Windows targets (out of scope in the Deno spec too).
- The agent CLIs' own sandboxes and phax's `network.profile`: they bound the agents, not phax.
- A per-command subprocess allowlist. The Deno plan baked one in (`--allow-run=<list>`); it has since been opened to
  unrestricted. Node's `--allow-child-process` is all-or-nothing, so bringing it back would be a separate spec.
- Notarization of the macOS binaries.
