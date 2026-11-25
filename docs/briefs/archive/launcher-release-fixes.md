Write the phax spec `launcher-release-fixes`: the npm launcher downloads, verifies and runs the binary so that an
interrupted, concurrent or redirected first run never leaves or runs an unverified file, and it hands a signal to the
binary it started. The docs redeploy checks out the release tag it was given and nothing else, and the release binary
is built from locked dependencies only.

## Why

The security audit of 2026-11-23 (`docs/security/reports/2026-11-23-opus-high-5.5-security-report.md`, cross-checked
in `2026-11-23-mistral-large-4-0-high-cross-validation.md`) found three Medium findings outside `src/`, all small, all
in the files of the release pipeline. NEXT_STEPS §"Security roadmap" phase 4 places them in wave 1's lane outside
`src/`, with a Small follow-up on the same launcher:

- **SEC-26, the npm launcher** (`npm/bin/phax`). It renames the download into place before verifying it, so an
  interrupted first run leaves an unverified binary that the next run finds and runs without checking. Two first runs
  at once share one `<name>.tmp`. Redirects are followed without limit, and a relative `Location` crashes it. No
  request has a timeout. An error from `spawnSync` (the binary missing or not executable) is swallowed into exit 1.
- **SEC-28, the docs redeploy** (`.github/workflows/docs-deploy.yml`). It checks out `inputs.tag` as an unqualified
  ref, so a branch named like the tag wins over the tag, and it validates the tag's shape only after `pnpm install`
  has run the checked-out code's install.
- **SEC-29, the Deno build** (`deno.json`, `scripts/build-binaries.ts`). `deno compile` runs without a frozen lock,
  so the release binary can embed dependency versions neither `pnpm-lock.yaml` nor `deno.lock` pins. `allowScripts`
  still lists an esbuild version the project no longer uses.
- **The launcher does not forward signals** (NEXT_STEPS "Small follow-ups", found 2026-10-25 with 0.27.0). A SIGINT
  sent to the node launcher alone left `~/.phax/bin/<version>/phax-darwin-arm64` running the phase (a session, the
  gate, a fix attempt) until the binary itself was signalled. `spawnSync` cannot forward a signal, and a binary killed
  by a signal makes the launcher exit 1 instead of dying of that signal.

Who meets them: every npm user on their first run of a release (SEC-26), every user who presses Ctrl-C through a
wrapper or a process manager that signals the launcher only (the signal), the maintainer when redeploying the docs
(SEC-28), and every user of the binary (SEC-29).

## What phax has today, to read first

- `npm/bin/phax`: the whole launcher, about 230 lines of CommonJS with no dependency (`download`, `fetchText`,
  `verifyChecksum`, the update check, `main`). `npm/lib/resolveBinary.mts` mirrors its names and URLs and is the only
  part under test (`tests/unit/npmWrapperResolve.test.ts`); nothing tests the download, the verification or the spawn.
- `scripts/security/release-audit.sh`, whose installer-integrity check reads `npm/bin`.
- `.github/workflows/docs-deploy.yml` (the `workflow_dispatch` redeploy) and the deploy steps of `release.yml` it
  copies verbatim.
- `deno.json` (`nodeModulesDir`, `allowScripts`), `deno.lock`, `scripts/build-binaries.ts` (esbuild bundles from
  `node_modules`, then `deno compile --no-check` on the bundle), and the `deno:*` scripts in `package.json`.
- `docs/release.md` for the cut and the redeploy, and the report's SEC-13, which stays out of this spec (below).

## What to decide

- **The launcher's download.** A private temporary directory per first run (`mkdtemp` next to the cache, so the final
  rename stays on one filesystem), the checksum verified there, `chmod`, then one atomic rename into the cache; two
  first runs at once both verify and the second rename is harmless. Whether a binary already in the cache is trusted
  as is (today) or its checksum is kept beside it and checked: re-verifying on every run belongs to SEC-13.
- **Redirects and timeouts.** A bound on redirects (the report says about 5), relative `Location` resolved against
  the request URL, and whether the hosts are allow-listed (`github.com`, GitHub's release asset host) or any `https:`
  is followed. A connect and an idle timeout for the binary, the checksum and the update check, with values stated.
- **Signals and exit.** `spawn` instead of `spawnSync`, SIGINT, SIGTERM and SIGHUP forwarded to the child, and the
  launcher exits with the child's code or re-raises the child's signal on itself. An error starting the binary is
  printed with its reason.
- **How the launcher is tested.** It stays one dependency-free file that npm runs. Whether its logic moves into
  `npm/lib/` (as `resolveBinary.mts` did) so tests import it, or tests run the file against a local HTTPS or HTTP
  fixture server and a fake binary. Tests never write to the real `~/.phax`: the launcher's home is set through the
  environment the test gives it.
- **The docs redeploy.** The tag validated before any checkout or install, then `refs/tags/<tag>` checked out
  explicitly. This file is a protected path of `phax.json` (`.github/workflows/**`), so a phax run cannot edit it:
  say whether that part is the maintainer's own commit, written from the spec, or whether the run only writes the
  change into the PR body for the maintainer to apply.
- **The frozen Deno build.** Whether `deno compile` of an esbuild bundle resolves any dependency through `deno.lock`
  at all (check before choosing the flag), then `"lock": {"frozen": true}` in `deno.json` or `--frozen` on the build
  commands only, and which stale entries leave `allowScripts`. `deno.json` also carries the wave 2 small fix "Deno
  relinks `node_modules` in phase worktrees past the lockfile" (`nodeModulesDir`): say whether it rides here.

## Constraints

- The maintainer reviews every change to the release pipeline and cuts the release; no step of the run or its tests
  runs `scripts/release.sh`, publishes, or reaches GitHub or npm. A rehearsal of the cut is the maintainer's.
- The launcher keeps zero dependencies and the Node floor of `npm/package.json` (`>=22`); the download stays the release
  asset of the package's own version.
- Out of scope, kept for phase 4's later split: SEC-13 (digests embedded in the npm package, the cache re-verified on
  every run), SEC-14, SEC-27 (who can trigger a release, the release job split), SEC-38 and SEC-39.
- A test never reads the real `~/.phax`, `HOME`'s caches or the network.
