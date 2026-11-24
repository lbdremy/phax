---
status: Completed
date: 2026-11-23
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
approved:
  date: 2026-11-24
  baseline: 38627b6
---
# Launcher and release-pipeline fixes: verified first run, forwarded signals, tag-only redeploy, locked Deno build

## 1. Context

phax ships to npm as @lbdremy/phax, whose only executable is npm/bin/phax: a dependency-free CommonJS launcher of about 230 lines. On a run with no binary cached at ~/.phax/bin/<version>/<name>, it downloads the release asset of its own version from github.com/lbdremy/phax/releases into <name>.tmp, renames it to <name>, then fetches <name>.sha256 and compares; on a mismatch it deletes the file. It then makes the file executable, starts a fire-and-forget update check against api.github.com, and runs the binary with spawnSync, exiting with result.status ?? 1. Redirects (301 and 302 only) are followed to whatever res.headers.location says, with no limit and no timeout on any request. Only npm/lib/resolveBinary.mts, a mirror of the launcher's names and URLs, is under test.

The binary handles SIGINT and SIGTERM itself: it saves the run and exits 130 ("Run ... interrupted — state saved. Resume with: phax resume ... --yes"). It does not handle SIGHUP. A Ctrl-C at a terminal reaches both the launcher and the binary (same process group); a signal sent to the launcher's pid alone (a wrapper, a process manager, kill) reaches only the launcher.

The docs redeploy (.github/workflows/docs-deploy.yml, workflow_dispatch with input tag) checks out ref: ${{ inputs.tag }}, runs pnpm install, and only then checks that the tag looks like vX.Y.Z and matches package.json and the ledger's last entry. The file is under .github/workflows/**, a protected path of phax.json.

The release binary is built by pnpm deno:build-binaries: esbuild bundles src/cli/main.ts from node_modules, then deno compile --no-check embeds the bundle. In release.yml it runs in the same job right after the gate's pnpm deno:smoke. deno.json sets nodeModulesDir to auto and no lock setting, so Deno may resolve and relink node_modules past both lockfiles (observed 2026-10-26: deno:smoke relinked oxlint to 1.69.0 against pnpm's 1.64.0). Its allowScripts lists five package versions; of them, only fsevents@2.3.3 is pinned by a lockfile, and esbuild@0.28.2, the version both lockfiles pin, is not listed.

The binary cache is per version, so an unverified file an older launcher left behind lives only under that older version's directory; the first release carrying this fix starts from an empty directory.

Ground read:

- `npm/bin/phax` — The whole npm launcher: download() renames <name>.tmp into the cache before verifyChecksum() runs, follows 301/302 without limit or host check, sets no timeout, and runs the binary with spawnSync, exiting result.status ?? 1.
- `npm/lib/resolveBinary.mts` — A test-only mirror of the launcher's binary names and URLs; the only launcher code under test.
- `tests/unit/npmWrapperResolve.test.ts` — Tests the mirror's names and URLs; nothing tests the download, the verification or the spawn.
- `npm/package.json` — Ships bin and lib, engines node >=22, no dependencies.
- `scripts/security/release-audit.sh` — Its installer-integrity check greps npm/bin/phax for a download and a checksum, and for redirect host validation.
- `src/cli/interruptHandler.ts` — The binary saves the run and exits 130 on SIGINT or SIGTERM; it installs no SIGHUP handler.
- `.github/workflows/docs-deploy.yml` — Checks out ref: inputs.tag unqualified, runs pnpm install, and only then checks the tag's shape, package.json version and ledger.
- `.github/workflows/release.yml` — pnpm install, then the gate (including pnpm deno:smoke), then pnpm deno:build-binaries, in the same job.
- `deno.json` — nodeModulesDir auto, no lock setting, allowScripts lists @parcel/watcher@2.5.6, msgpackr-extract@3.0.4, esbuild@0.21.5, esbuild@0.28.1 and fsevents@2.3.3.
- `deno.lock` — Pins esbuild 0.28.2; carries none of @parcel/watcher, msgpackr-extract or the other two esbuild versions.
- `pnpm-lock.yaml` — Pins esbuild 0.28.2 and fsevents 2.3.3 only, among the allowScripts packages.
- `scripts/build-binaries.ts` — Bundles src with node_modules/.bin/esbuild, then deno compile --no-check on the bundle, for four targets or the host.
- `phax.json` — .github/workflows/** is a protected path: a phax run cannot edit docs-deploy.yml.
- `NEXT_STEPS.md` — Lane outside src/ of wave 1; Small follow-ups 'the npm phax shim does not forward SIGINT' and 'Deno relinks node_modules in phase worktrees past the lockfile' (oxlint relinked to 1.69.0 against pnpm's 1.64.0 by deno:smoke).
- `docs/security/reports/2026-11-23-opus-high-5.5-security-report.md` — SEC-26, SEC-28, SEC-29 (Medium) with their fixes; SEC-13 kept out.
- `docs/release.md` — 'Redeploying the docs site by hand' describes what docs-deploy.yml checks and in which order.

## 2. Problem

Four Medium-or-follow-up defects sit in the release pipeline, each met by real users.

SEC-26 (every npm user, on the first run of a release): the launcher renames the download into the cache before verifying it, so a first run interrupted between the rename and the checksum leaves an unverified file at the cache path, and every later run finds it and executes it without any check. Two first runs at once write the same <name>.tmp and can interleave. A redirect loop never ends, a relative Location crashes the launcher, a stalled connection hangs it forever, and an error starting the binary (missing, not executable) is swallowed into a bare exit 1.

The signal follow-up (every user whose Ctrl-C or kill reaches the launcher only): spawnSync cannot forward a signal, so the launcher dies and the binary goes on running the phase — a provider session, the gate, a fix attempt — until it is signalled itself. A binary killed by a signal makes the launcher exit 1 instead of dying of that signal, so shells and process managers misread the outcome.

SEC-28 (the maintainer, redeploying the docs): an unqualified ref lets a branch named like the tag win over the tag, and the branch's code runs pnpm install, with its lifecycle scripts, before the tag's shape is checked.

SEC-29 (every user of the binary): neither the Deno config nor the build commands freeze a lock, and Deno may relink node_modules before esbuild bundles from it, so the release binary can embed dependency versions that neither pnpm-lock.yaml nor deno.lock pins. allowScripts grants lifecycle scripts to versions the project no longer uses.

## 3. Product goal

A first run of the npm launcher, interrupted, concurrent or redirected, never leaves a file at the cache path that was not verified, and never runs one. A signal sent to the launcher reaches the binary it started, and the launcher's exit reports the binary's outcome faithfully. The docs redeploy builds the release tag it was given and nothing else, refusing a malformed tag before any code is checked out or installed. The release binary embeds only dependency versions the lockfiles pin.

> Only verified, pinned code reaches a user's machine or the release, and the launcher is a transparent doorway to the binary it verified.

## 4. Terminology

- **launcher** — The executable the npm package installs as phax (npm/bin/phax today): it downloads, verifies and starts the binary. Not the binary itself.
- **binary** — The deno-compiled phax executable for one platform, published as a GitHub release asset with a <name>.sha256 sidecar.
- **cache path** — ~/.phax/bin/<version>/<name>, where <version> is the launcher's own package version and <name> the platform's binary name. The launcher runs whatever is at this path.
- **first run** — A launcher invocation that finds nothing at the cache path and so downloads the binary.
- **private download directory** — A directory created fresh for one first run, inside ~/.phax/bin/<version>/, holding that run's download until it is verified; no other run writes to it.
- **verified** — A file whose SHA-256 equals the hex digest in the release's <name>.sha256 sidecar for the launcher's version.
- **allowed host** — A host the launcher will send a request to: github.com, api.github.com and any host under githubusercontent.com (per q-redirect-hosts).
- **connect timeout / idle timeout** — Connect: the longest wait for a request's TCP and TLS connection to be established. Idle: the longest time an open response may go without receiving a byte.
- **forwarded signal** — SIGINT, SIGTERM or SIGHUP received by the launcher while the binary runs, sent by the launcher to the binary's process.
- **pinned** — A dependency version recorded in pnpm-lock.yaml (what esbuild bundles from node_modules) or deno.lock (what Deno resolves).

## 5. Functional requirements

### 5.1 Only a verified binary reaches the cache path

The launcher SHALL place a downloaded binary at the cache path only after it is verified and made executable, in a single rename from the private download directory.

### 5.2 Each first run downloads into its own directory

The launcher SHALL write each first run's download into a private download directory inside ~/.phax/bin/<version>/, so that concurrent first runs never write the same file.

### 5.3 Concurrent first runs both succeed

WHEN two first runs of the same version run at once THE launcher SHALL let each verify its own download and run a verified binary, whichever rename lands last.

### 5.4 A failed first run leaves nothing behind

IF a download, the checksum fetch or the verification fails THEN the launcher SHALL remove its private download directory, leave the cache path as it found it, print the reason, and exit 1 without running anything.

### 5.5 An interrupted download cleans up and dies of its signal

WHEN the launcher receives SIGINT, SIGTERM or SIGHUP during a first run, before the binary starts, THE launcher SHALL remove its private download directory and terminate by that same signal.

### 5.6 A cached binary is run as is

WHILE a file exists at the cache path THE launcher SHALL run it without downloading or re-verifying it (per q-cache-trust).

### 5.7 Redirects are bounded

IF a request is redirected more than 5 times THEN the launcher SHALL fail that request with a message naming the original URL and the bound.

### 5.8 Relative redirects resolve

WHEN a 301, 302, 303, 307 or 308 response carries a relative Location THE launcher SHALL resolve it against the URL of the request that returned it.

### 5.9 Redirects stay on https and allowed hosts

IF a redirect points to a URL that is not https or whose host is not an allowed host THEN the launcher SHALL fail without requesting it, naming the refused URL.

### 5.10 Downloads time out

IF the binary or checksum request takes more than 10 seconds to connect, or an open response receives no byte for 30 seconds, THEN the launcher SHALL abort it and fail with a message naming the timeout and the host.

### 5.11 The update check never holds the launcher

The launcher SHALL abandon the update check silently after 5 seconds or on any error, and SHALL never delay its own exit to wait for it.

### 5.12 The download source is fixed

The launcher SHALL download only the release asset and sidecar of its own package version from github.com/lbdremy/phax, and SHALL read no environment variable that changes the URL, the allowed hosts, the timeouts or the verification.

### 5.13 Signals reach the binary

WHEN the launcher receives SIGINT, SIGTERM or SIGHUP while the binary runs THE launcher SHALL send the same signal to the binary and keep waiting for it to exit.

### 5.14 The binary's exit code is the launcher's

WHEN the binary exits with a code THE launcher SHALL exit with that same code.

### 5.15 The binary's death by signal is the launcher's

WHEN the binary is terminated by a signal THE launcher SHALL terminate itself by that same signal.

### 5.16 A binary that cannot start is reported

IF the binary at the cache path cannot be started THEN the launcher SHALL print its path, the error code and reason, and how to force a fresh download, and exit 1.

### 5.17 The release audit still sees the launcher's checks

The release audit's installer-integrity check SHALL report the launcher as verifying a checksum before running the binary, with no redirect-host finding.

### 5.18 The redeploy refuses a malformed tag first

IF the redeploy's tag input does not match ^v[0-9]+\.[0-9]+\.[0-9]+$ THEN the docs redeploy SHALL fail before any checkout, dependency install or build step runs.

### 5.19 The redeploy builds the tag

The docs redeploy SHALL check out refs/tags/<tag>, so that a branch named like the tag is never built or installed.

### 5.20 The release match is checked before install

IF the checked-out tag's package.json version or the ledger's last release differs from the tag THEN the docs redeploy SHALL fail before pnpm install runs.

### 5.21 The Deno build never resolves past the lock

IF a Deno command of the binary build or the Deno smoke check would resolve a dependency version deno.lock does not pin, or would rewrite deno.lock, THEN it SHALL fail with Deno's lockfile error instead of proceeding.

### 5.22 Deno leaves node_modules as pnpm installed it

The project's Deno commands SHALL leave node_modules exactly as pnpm installed it from pnpm-lock.yaml, so that the bundle the release binary embeds contains only pnpm-pinned versions (per q-node-modules).

### 5.23 allowScripts grants only pinned versions

The Deno configuration SHALL grant lifecycle scripts to no package version that neither pnpm-lock.yaml nor deno.lock pins.

## 6. Surface

### cli: phax (npm launcher), first run — normative

Summary: A first run that is interrupted, raced or fails leaves no binary behind, so the next run downloads and verifies again instead of running an unchecked file.

before:

    $ phax --version                 # first run of 0.43.0, killed after the download
    ^C
    $ ls ~/.phax/bin/0.43.0/
    phax-darwin-arm64                # renamed in place, never verified
    $ phax --version                 # runs it, unchecked
    0.43.0

after:

    $ phax --version                 # first run of 0.44.0, killed during the download
    phax: downloading binary from https://github.com/lbdremy/phax/releases/download/v0.44.0/phax-darwin-arm64
    ^C
    $ ls -A ~/.phax/bin/0.44.0/
                                     # empty: the private download directory is gone
    $ phax --version                 # downloads and verifies again
    phax: downloading binary from https://github.com/lbdremy/phax/releases/download/v0.44.0/phax-darwin-arm64
    0.44.0

### cli: phax (npm launcher), download errors — indicative

Summary: A first run that is redirected too far or off GitHub, or stalls, stops with a message naming the URL, host or timeout instead of looping, crashing or hanging.

before:

    $ phax --version     # a redirect loop: never returns
    $ phax --version     # relative Location
    TypeError [ERR_INVALID_URL]: Invalid URL
    $ phax --version     # stalled connection: never returns

after:

    $ phax --version
    phax: download failed: more than 5 redirects from https://github.com/lbdremy/phax/releases/download/v0.44.0/phax-darwin-arm64
    $ echo $?
    1

    phax: download failed: refused redirect to http://release-assets.githubusercontent.com/…: not https
    phax: download failed: refused redirect to https://downloads.example.net/phax: host is not github.com or *.githubusercontent.com
    phax: download failed: no connection to github.com within 10 s
    phax: download failed: no data from release-assets.githubusercontent.com for 30 s

### cli: phax (npm launcher), signals and exit status — normative

Summary: Signalling the launcher stops the phax run it started, and the launcher's exit status is the binary's own code or signal.

before:

    $ phax run my-plan &             # through a manager that signals the launcher's pid only
    $ kill -INT %1
    $ echo $?
    130                              # the launcher died; phax-darwin-arm64 goes on with the phase

    $ kill -TERM <binary pid>
    $ echo $?                        # launcher's status
    1

after:

    $ phax run my-plan &
    $ kill -INT %1
    Run "my-plan" interrupted — state saved. Resume with: phax resume my-plan --yes
    $ wait %1; echo $?
    130                              # the binary's own exit code

    $ kill -TERM <binary pid>        # the binary dies of SIGTERM
    $ echo $?                        # the launcher died of SIGTERM too
    143

### cli: phax (npm launcher), binary cannot start — indicative

Summary: When the cached binary cannot be started, the launcher says why and how to get a fresh download instead of exiting 1 in silence.

before:

    $ phax --version
    $ echo $?
    1

after:

    $ phax --version
    phax: could not start /Users/me/.phax/bin/0.44.0/phax-darwin-arm64: EACCES (permission denied)
      remove /Users/me/.phax/bin/0.44.0 and run phax again to download it afresh
    $ echo $?
    1

### file: ~/.phax/bin/<version>/ — indicative

Summary: During a first run the download sits in a directory of its own, and only a verified, executable binary ever appears at the cache path.

before:

    ~/.phax/bin/0.43.0/
      phax-darwin-arm64.tmp          # shared by every concurrent first run
      phax-darwin-arm64              # renamed in before verification

after:

    ~/.phax/bin/0.44.0/
      .download-a1B2c3/              # one per first run, removed on success, failure or signal
        phax-darwin-arm64
      phax-darwin-arm64              # appears only verified and executable, by one rename

### file: .github/workflows/docs-deploy.yml — normative

Summary: A redeploy refuses a malformed tag before checking anything out, and always builds the tag itself, never a branch of the same name.

before:

    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
        with:
          ref: ${{ inputs.tag }}
          lfs: true
      - uses: pnpm/action-setup@…
      - uses: actions/setup-node@…
      - name: Install dependencies
        run: pnpm install
      - name: Verify the tag is this release
        run: |                       # shape, package.json, ledger

after:

    steps:
      - name: Verify the tag's shape
        run: |
          if ! [[ "$RELEASE_TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
            echo "Not a release tag: ${RELEASE_TAG}"
            exit 1
          fi
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
        with:
          ref: refs/tags/${{ inputs.tag }}
          lfs: true
      - uses: pnpm/action-setup@…
      - uses: actions/setup-node@…
      - name: Verify the tag is this release
        run: |                       # package.json and ledger, unchanged
      - name: Install dependencies
        run: pnpm install

### config: deno.json — indicative

Summary: Deno builds and checks fail on a dependency the lockfile does not pin, leave pnpm's node_modules alone, and grant install scripts to no unused version.

before:

    {
      "nodeModulesDir": "auto",
      …
      "allowScripts": {
        "allow": [
          "npm:@parcel/watcher@2.5.6",
          "npm:msgpackr-extract@3.0.4",
          "npm:esbuild@0.21.5",
          "npm:esbuild@0.28.1",
          "npm:fsevents@2.3.3"
        ]
      }
    }

after:

    {
      "nodeModulesDir": "manual",
      "lock": { "frozen": true },
      …
      "allowScripts": {
        "allow": ["npm:esbuild@0.28.2", "npm:fsevents@2.3.3"]
      }
    }

### cli: pnpm deno:build-binaries — indicative

Summary: Building the binaries stops with Deno's lockfile error when deno.lock does not match, instead of embedding a version no lockfile pins.

before:

    $ pnpm deno:build-binaries       # deno.lock out of date: resolves, relinks, builds
    Bundling with esbuild...
    Building phax-darwin-arm64 (aarch64-apple-darwin)...

after:

    $ pnpm deno:build-binaries       # deno.lock out of date
    error: The lockfile is out of date. Run `deno install --frozen=false`, or rerun with `--frozen=false` to update it.
    $ echo $?
    1

## 7. Non-goals

- SEC-13: digests embedded in the npm package, and re-verifying the cached binary on every run.
- SEC-14, SEC-27 (who can trigger a release, the release job split), SEC-38 and SEC-39.
- Any change to release.yml, scripts/release.sh or the cut itself; no step of the run or its tests publishes, runs scripts/release.sh, or reaches GitHub or npm. A rehearsal of the cut is the maintainer's.
- Reclaiming private download directories left by a launcher killed with SIGKILL or a power loss: they are never run, and their removal is not in scope.
- Proxies, mirrors or an environment override of the download URL, hosts or timeouts.
- Windows support, a launcher dependency, or a Node floor above >=22.
- A total-time cap on the binary download: a slow link that keeps receiving bytes may take as long as it needs.
- Telling phase agents not to run the gate's commands concurrently (the other half of the node_modules follow-up).
- Moving the binary off Deno (the node-runtime brief).

## 8. Acceptance criteria

### Only a verified binary appears at the cache path

Given an empty launcher home and a fixture server serving a binary and its matching sidecar, when the launcher's first run completes, then the cache path holds an executable file whose SHA-256 equals the sidecar's digest, ~/.phax/bin/<version>/ holds nothing else, and the fake binary ran. (refs §5.1, §5.2)

### A checksum mismatch leaves nothing

Given a fixture server whose sidecar does not match the binary, when the launcher's first run runs, then it prints the checksum-mismatch reason, exits 1, the cache path does not exist, no private download directory remains, and the fake binary never ran. (refs §5.4, §5.1)

### An unreachable or malformed sidecar leaves nothing

Given a fixture server whose sidecar answers 404, or answers a line that is not 64 hex digits, when the launcher's first run runs, then it exits 1 naming the sidecar URL, and neither the cache path nor a private download directory exists. (refs §5.4)

### An interrupted download is cleaned up

Given a fixture server that sends part of the binary and then stalls, when the launcher receives SIGINT (and, in separate cases, SIGTERM and SIGHUP) during the download, then the launcher terminates by that signal, no private download directory remains, the cache path does not exist, and the next first run downloads and verifies again before running. (refs §5.5, §5.1)

### Two first runs at once both run a verified binary

Given an empty launcher home and a fixture server that delays both responses so the two downloads overlap, when two first runs start at once, then both exit with the fake binary's code, each request was served to each run, the cache path holds a verified binary, and no private download directory remains. (refs §5.3, §5.2)

### A cached binary is run without a request

Given a launcher home with a fake binary already at the cache path and a fixture server that counts requests, when the launcher runs, then the fake binary runs and the fixture server receives no binary or sidecar request. (refs §5.6)

### Six redirects fail, five succeed

Given a fixture server whose binary URL redirects 5 times before serving it, and another that redirects 6 times, when a first run runs against each, then the 5-redirect run succeeds, and the 6-redirect run exits 1 with a message naming the original URL and the bound of 5. (refs §5.7)

### A relative Location is followed

Given a fixture server answering the binary URL with a 302 whose Location is a relative path, and each of 301, 303, 307 and 308 likewise, when a first run runs, then the launcher requests the path resolved against the redirecting URL and the run succeeds. (refs §5.8)

### A redirect off the allowed hosts or off https is refused

Given the launcher's shipped allowed hosts, and a redirect to http://release-assets.githubusercontent.com/x, and another to https://downloads.example.net/x, when the launcher's redirect check judges each, then both are refused with a message naming the URL, no request is sent to either, and a redirect to https://release-assets.githubusercontent.com/x is accepted. (refs §5.9)

### A stalled download times out

Given a fixture server that accepts a connection and then sends nothing, with the test's timeouts shortened, when a first run runs, then it exits 1 with a message naming the idle timeout and the host, and leaves no private download directory; and the launcher's shipped defaults are a 10-second connect timeout and a 30-second idle timeout. (refs §5.10)

### A stalled update check never delays exit

Given a cached fake binary that exits 0 at once and an update endpoint that never answers, when the launcher runs, then it exits 0 as soon as the fake binary exits, prints nothing about the update check, and the update check's shipped timeout is 5 seconds. (refs §5.11)

### The download source is fixed in the shipped launcher

Given the shipped launcher with HOME set to a temporary directory and any other environment variable set, when its binary and sidecar URLs are read for darwin/arm64 at version 0.44.0, then they are https://github.com/lbdremy/phax/releases/download/v0.44.0/phax-darwin-arm64 and the same with .sha256, and the launcher source reads no process.env key other than what os.homedir() uses. (refs §5.12)

### A signal to the launcher reaches the binary

Given a fake binary that records every signal it receives and exits 130 on SIGINT, run through the launcher, when the test sends SIGINT, then in separate cases SIGTERM and SIGHUP, to the launcher's pid only, then the fake binary records that signal and the launcher's exit matches the fake binary's (code 130 for SIGINT; death by SIGTERM or SIGHUP when the fake binary dies of it). (refs §5.13)

### The binary's exit code passes through

Given a fake binary that exits with code 0, 1, 3 or 130, when it runs through the launcher, then the launcher exits with the same code. (refs §5.14)

### The binary's death by signal passes through

Given a fake binary that kills itself with SIGTERM, when it runs through the launcher, then the launcher's process terminates by SIGTERM (a shell reports 143), not with code 1. (refs §5.15)

### A binary that cannot start is explained

Given a file at the cache path that is not executable, and in a second case a cache path that vanishes before the start, when the launcher runs, then it prints the cache path, the error code (EACCES, ENOENT) and its reason, and a line saying to remove ~/.phax/bin/<version> to download again, and exits 1. (refs §5.16)

### The release audit recognises the launcher

Given the new launcher, when scripts/security/release-audit.sh runs its installer-integrity check, then it reports "npm installer verifies a checksum before executing the binary" and no "Installer follows HTTP redirects without host validation" finding. (refs §5.17)

### The redeploy validates, then checks out the tag, then installs

Given .github/workflows/docs-deploy.yml, when a test reads the deploy job's steps in order, then the step matching ^v[0-9]+\.[0-9]+\.[0-9]+$ comes before actions/checkout, the checkout's ref is refs/tags/${{ inputs.tag }}, and the package.json and ledger check comes after the checkout and before the step that runs pnpm install. (refs §5.18, §5.19, §5.20)

### A stale deno.lock stops the Deno commands

Given a scratch copy of the Deno configuration whose deno.lock lacks a dependency package.json declares, when the Deno command the binary build uses to resolve dependencies runs in it, then it fails with Deno's lockfile-out-of-date error and deno.lock is unchanged. (refs §5.21)

### Deno does not relink node_modules

Given a pnpm-installed node_modules and a record of each installed package's version, when pnpm deno:smoke runs, then every package version under node_modules is unchanged. (refs §5.22)

### allowScripts lists only pinned versions

Given deno.json, pnpm-lock.yaml and deno.lock, when a test compares each allowScripts entry with the lockfiles, then every entry names a package version pinned by at least one of them, and npm:esbuild@0.21.5, npm:esbuild@0.28.1, npm:@parcel/watcher@2.5.6 and npm:msgpackr-extract@3.0.4 are gone. (refs §5.23)

## 9. Open questions

None.

## 9b. Arbitrated questions

### q-cache-trust — Is a binary already at the cache path run as is, or is its digest kept beside it and checked on every run?

- trust-path — Run it as is: only a verified, executable file can reach the cache path, by one rename — abandons: Detection of a cached binary altered after placement (a local tamper, a disk fault), which stays SEC-13's to solve
- digest-beside — Keep the expected digest in a file beside the binary and re-hash the binary before each run — abandons: Start-up time on every invocation (hashing about 74 MB each run), for a digest that sits in the same writable directory as the file it guards

Recommendation: trust-path — The interrupted-run hole closes structurally once nothing unverified can reach the cache path, and the per-version cache means the first fixed release starts empty. A digest stored beside the binary is writable by whoever can write the binary, so it buys little; real re-verification needs a digest from outside the cache, which is SEC-13.

Decision: trust-path — by operator (Rémy Loubradou), 2026-11-24
Why: The interrupted-run hole closes structurally once nothing unverified can reach the cache path, and the per-version cache means the first fixed release starts empty. A digest stored beside the binary is writable by whoever can write the binary, so it buys little; real re-verification needs a digest from outside the cache, which is SEC-13. Advocate: Re-hashing before every run catches a binary altered after placement, whether by a local tamper or a disk fault, and does not depend on how the file got there. Principles: S1, C4. Reversibility: cheap. Revised: none.

### q-redirect-hosts — Which hosts may the launcher follow a redirect to?

- exact-hosts — github.com, api.github.com and the release asset hosts GitHub uses today, by exact name — abandons: Every already-published version's first run the day GitHub moves its asset host again, as it did from objects.githubusercontent.com to release-assets.githubusercontent.com
- github-suffix — github.com, api.github.com and any host under githubusercontent.com — abandons: Published versions keep working only while GitHub serves release assets under githubusercontent.com
- any-https — Any https host, bounded to 5 redirects — abandons: Any host check at all: a redirect to a foreign host is followed, with the sidecar as the only defence

Recommendation: github-suffix — A published launcher can never be fixed, so an exact list breaks old versions on GitHub's next rename. The suffix survives renames inside GitHub's asset domain while still refusing a redirect to anywhere else. Any https also lets the release audit's host-validation finding stand.

Decision: github-suffix — by operator (Rémy Loubradou), 2026-11-24
Why: A published launcher can never be fixed, so an exact list breaks old versions on GitHub's next rename. The suffix survives renames inside GitHub's asset domain while still refusing a redirect to anywhere else. Any https also lets the release audit's host-validation finding stand. Advocate: An exact list is the strictest allow-list: it admits only hosts known today, so a takeover or a new subdomain under githubusercontent.com is never followed. Principles: S1, S2. Reversibility: costly. Revised: none.

### q-launcher-tests — How do the tests exercise the launcher?

- bin-exports — npm/bin/phax stays one file; when it is required rather than run it exports its functions and runs nothing, and tests call them with the fixture server's URL, hosts, timeouts and home as arguments, and spawn it with a fake binary for the signal cases — abandons: A launcher free of test seams: its functions take what is fixed in production as arguments
- lib-module — The logic moves to a shipped npm/lib CommonJS module that npm/bin/phax requires, and tests import it — abandons: The single-file launcher: two shipped files must stay in step, and the release audit, which reads npm/bin, would need to read lib too
- subprocess-env — Tests only run the file as a subprocess, pointed at the fixture server through an environment variable — abandons: own-release-only: the shipped launcher gains an environment override of its download source, which is new attack surface
- mirror — Keep mirroring the logic in npm/lib, as resolveBinary.mts does, and test the mirror — abandons: Any test of the code users run: the mirror can pass while the launcher is wrong

Recommendation: bin-exports — It tests the exact file npm ships, keeps it one dependency-free file the release audit already reads, and adds no environment override. The resolveBinary.mts mirror and its test can then be retired in favour of tests of the real file.

Decision: bin-exports — by operator (Rémy Loubradou), 2026-11-24
Why: It tests the exact file npm ships, keeps it one dependency-free file the release audit already reads, and adds no environment override. The resolveBinary.mts mirror and its test can then be retired in favour of tests of the real file. Advocate: Moving the logic into a lib module gives tests a clean import with no export-when-required seam in the shipped entry file, the same pattern resolveBinary.mts already follows. Principles: S1, S4. Reversibility: cheap. Revised: none.

### q-workflow-edit — docs-deploy.yml is a protected path a phax run cannot edit: who writes its change?

- maintainer-first — The maintainer commits the normative §6 block to docs-deploy.yml before the run starts; the run adds the guard test that pins it — abandons: Having the whole spec delivered by one run: one manual commit precedes it
- pr-body — The run writes the change into its PR body and the maintainer applies it on the branch before merge — abandons: A green gate inside the run for the redeploy criteria: the guard test cannot pass until the maintainer's later commit, so either it lands red or it is deferred out of the run

Recommendation: maintainer-first — The change is fully written in §6, so the maintainer's commit is a copy, not a design, and landing it first lets the run's guard test go green in its own gate.

Decision: maintainer-first — by operator (Rémy Loubradou), 2026-11-24
Why: The change is fully written in §6, so the maintainer's commit is a copy, not a design, and landing it first lets the run's guard test go green in its own gate. Advocate: Keeping the whole change inside the run and its PR means one reviewable unit, with no manual commit that must land in the right order before the run starts. Principles: S1, C4. Reversibility: cheap. Revised: none.

### q-frozen-where — Where is the Deno lock frozen?

- config-frozen — "lock": {"frozen": true} in deno.json, covering every Deno command — abandons: Frictionless dependency changes: any pnpm add or upgrade turns deno:smoke and the build red until deno.lock is updated explicitly
- flag-on-build — --frozen on the build's Deno commands only — abandons: Protection from the Deno commands that run before the build in the same release job (pnpm deno:smoke in the gate), which can still rewrite the lock and node_modules

Recommendation: config-frozen — release.yml runs deno:smoke right before the build, so freezing only the build leaves the step that already relinked node_modules once unguarded. The friction surfaces drift in the gate, which is where it should surface. Before choosing, the plan checks whether deno compile of the esbuild bundle resolves anything through deno.lock at all; if it does not, frozen still guards deno run of the build script and deno:smoke.

Decision: config-frozen — by operator (Rémy Loubradou), 2026-11-24
Why: release.yml runs deno:smoke right before the build, so freezing only the build leaves the step that already relinked node_modules once unguarded. The friction surfaces drift in the gate, which is where it should surface. Before choosing, the plan checks whether deno compile of the esbuild bundle resolves anything through deno.lock at all; if it does not, frozen still guards deno run of the build script and deno:smoke. Advocate: A flag on the build commands only leaves day-to-day dependency changes frictionless: pnpm add and upgrade do not turn deno:smoke red, and the release build, the one place that matters, is still frozen. Principles: S1, C2, C4. Reversibility: cheap. Revised: none.

### q-node-modules — Does the wave 2 fix 'Deno relinks node_modules past the lockfile' (nodeModulesDir) ride in this spec?

- rides-here — Yes: Deno stops writing node_modules (nodeModulesDir manual, or the value the plan's check shows does it) in this spec — abandons: A small, single-purpose SEC-29 change: deno:smoke and deno task dev now depend on pnpm having installed node_modules
- wave-2 — No: it stays in wave 2's small-fix batch — abandons: SEC-29's real fix: esbuild bundles from node_modules, and a frozen deno.lock alone does not stop Deno relinking it to versions pnpm-lock.yaml does not pin before the build

Recommendation: rides-here — The release job's deno:smoke runs right before the bundle step, so a Deno relink of node_modules is the very path by which an unpinned version reaches the binary; it is the same line of the same file, and every path that runs Deno already runs pnpm install first.

Decision: rides-here — by operator (Rémy Loubradou), 2026-11-24
Why: The release job's deno:smoke runs right before the bundle step, so a Deno relink of node_modules is the very path by which an unpinned version reaches the binary; it is the same line of the same file, and every path that runs Deno already runs pnpm install first. Advocate: Leaving it in wave 2 keeps this spec a single-purpose, security-only change that the maintainer can review as such, and does not make deno:smoke and deno task dev depend on a prior pnpm install. Principles: S1, S8. Reversibility: cheap. Revised: none.

## 10. Implementation-planning note

Settled:

- The download goes into a private download directory created inside ~/.phax/bin/<version>/ (same filesystem as the cache), is verified there, made executable, then renamed onto the cache path in one step; a second concurrent rename replaces a verified file with a verified file and is harmless.
- Redirect bound 5; followed statuses 301, 302, 303, 307, 308; relative Location resolved against the redirecting URL; https only.
- Timeouts: 10 s connect and 30 s idle for the binary and the sidecar; 5 s for the update check, whose failure stays silent.
- The binary is started with an asynchronous spawn; SIGINT, SIGTERM and SIGHUP are forwarded; the launcher exits with the child's code or terminates itself by the child's signal. A terminal Ctrl-C reaches the binary twice (process group and forward); its handler exits on the first, which is accepted.
- The docs redeploy validates the tag's shape before checkout, checks out refs/tags/<tag>, and checks package.json and the ledger after checkout and before pnpm install, as the normative §6 block shows.
- Each recommendation in §9 is the default if the operator decides nothing else.

Left open:

- Whether deno compile of the esbuild bundle resolves any dependency through deno.lock at all: check before settling q-frozen-where's mechanism, and record the finding in the plan.
- Which nodeModulesDir value keeps Deno from writing node_modules while deno:smoke, deno:check and the build still work (manual is the expected one).
- Whether allowScripts is needed at all once Deno no longer installs into node_modules; if not, it goes entirely, which also satisfies allow-scripts-pinned.
- The exact wording of the launcher's error messages (indicative in §6); the elements they name are binding.
- Whether npm/lib/resolveBinary.mts and its test are retired once the shipped file is tested directly (q-launcher-tests).

Constraints:

- The launcher stays one dependency-free CommonJS file that npm runs, on Node >=22, downloading the release asset of its own package version.
- Tests never read the real ~/.phax, HOME's caches or the network: they use a local fixture server, a fake binary, and a temporary directory as the launcher's home.
- .github/workflows/** is protected: a phax run cannot edit docs-deploy.yml (see q-workflow-edit). release.yml is not changed.
- No step of the run or its tests runs scripts/release.sh, publishes, or reaches GitHub or npm; a rehearsal of the cut is the maintainer's.
- A test that runs Deno against a stale lock does so in a scratch copy, never against the repository's own deno.lock or node_modules.
- The release audit's installer-integrity check keeps reading npm/bin and must keep passing (audit-recognizes).

## 11. Docs page

Page: docs/release.md, section 'Redeploying the docs site by hand'

Reader: The maintainer redeploying docs.phax.run from a released tag

Example: gh workflow run docs-deploy.yml -f tag=vX.Y.Z — the workflow first refuses a tag that is not vX.Y.Z, then checks out refs/tags/vX.Y.Z (never a branch of that name), checks package.json and the ledger against it, and only then installs and builds.

## 12. Decision log

- 2026-11-24 q-cache-trust decided trust-path — operator (Rémy Loubradou)
- 2026-11-24 q-redirect-hosts decided github-suffix — operator (Rémy Loubradou)
- 2026-11-24 q-launcher-tests decided bin-exports — operator (Rémy Loubradou)
- 2026-11-24 q-workflow-edit decided maintainer-first — operator (Rémy Loubradou)
- 2026-11-24 q-frozen-where decided config-frozen — operator (Rémy Loubradou)
- 2026-11-24 q-node-modules decided rides-here — operator (Rémy Loubradou)
