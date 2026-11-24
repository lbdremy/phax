---
status: Draft
source-spec: docs/specs/2611231919-launcher-release-fixes.md
completes-spec: true
---
# Launcher release fixes

This plan delivers the whole of spec launcher-release-fixes (SEC-26, SEC-28's guard test, SEC-29 and the signal follow-up). The only part left out is the edit to `.github/workflows/docs-deploy.yml` itself. Under q-workflow-edit (maintainer-first), the maintainer lands that edit by hand in PR #261 (`fix/docs-deploy-tag-ref`), and the run starts after #261 merges.

The plan has four phases, built inside-out:

- phase-01 rebuilds the npm launcher's download path: private download directory, verify-then-rename, bounded and host-checked redirects, timeouts, a bounded update check, and test exports. It tests that path in-process against a local fixture server and retires the `npm/lib` mirror.
- phase-02 replaces `spawnSync` with an asynchronous spawn that forwards SIGINT, SIGTERM and SIGHUP and passes the binary's exit code or signal through. It cleans up a first run that is interrupted by a signal and explains a binary that cannot start. It proves all of this end to end with spawned launchers.
- phase-03 freezes `deno.lock`, stops Deno from writing `node_modules` and drops the stale `allowScripts` grants.
- phase-04 pins the redeploy's validate → checkout tag → verify → install order in a test and rewrites the `docs/release.md` section.

There is no acceptance phase. The launcher, the workflow and the Deno config are all read in full by tests that run them as npm, GitHub Actions and Deno do, so each phase writes its own in-phase tests.

Precondition: the run's base must hold PR #261's `docs-deploy.yml`. phase-04 stops and reports if it does not; it never edits the protected file.

## Required commands

- `node`
- `deno`
- `pnpm test:unit`
- `pnpm test:integration`
- `pnpm deno:smoke`

Every command is already covered, so `phax.json` needs no change:

- `node`, `deno`, `pnpm test:unit` and `pnpm test:integration` are entries of `security.agentCommands`.
- `pnpm deno:smoke` is a command of the `standard` gate profile.

The tests themselves start `node`, `bash`, `npm` (through the release audit) and `deno` through `tests/helpers/boundedSpawn.ts`. That is test code run by the gate, not commands an agent session runs.

## Technical arbitrations

- Launcher test seam (bin-exports).

  - `npm/bin/phax` always assigns `module.exports` and calls `main()` only when `require.main === module`. Loading the file does no I/O and reads no environment.
  - Every network or cache function takes a `config` object as its first argument. `productionConfig()` returns the shipped values and is the only config `main` ever passes:
    - `version` from `../package.json`;
    - `home` from `os.homedir()`;
    - `releaseBase` `https://github.com/lbdremy/phax/releases/download`;
    - `updateUrl` `https://api.github.com/repos/lbdremy/phax/releases/latest`;
    - `transport` `require("https")` and `scheme` `"https:"`;
    - `allowedHosts` `{ exact: ["github.com", "api.github.com"], suffixes: ["githubusercontent.com"] }`;
    - `maxRedirects` 5;
    - `connectTimeoutMs` 10000, `idleTimeoutMs` 30000, `updateTimeoutMs` 5000.

  Loss accepted: the shipped file carries a parameter surface that production never varies. Only code that has already `require`d the file can reach it, never the environment.
- Fixture transport. The fixture server speaks plain HTTP on 127.0.0.1. Tests pass `transport: node:http`, `scheme: "http:"` and `allowedHosts: { exact: ["127.0.0.1"], suffixes: [] }`. The production pair (`https`, `"https:"`) and the shipped host lists are pinned by a small test that reads `productionConfig()`, and the https-only and GitHub-host rules are judged by `checkRedirect` against the shipped config.

  Loss accepted: no test crosses TLS, so the `secureConnect` branch of the connect timer runs only in production.

  Rejected: a local HTTPS server. Its certificate would come either from `openssl` at test time (tests then depend on a system tool and on LibreSSL/OpenSSL flag differences) or from a committed private key (gitleaks would need an allowlist entry).
- Where the fixture servers run. `boundedSpawn` blocks its calling thread (`Atomics.wait`), so a server in the test's own thread cannot answer a launcher the test spawned. The tests split by what they need:

  - Network logic (redirects, timeouts, sidecar, placement, concurrency, the update check) is tested in-process. The tests call the exported async functions against a fixture server in the vitest process.
  - Signals, exit status and start errors are tested in spawned processes:
    - The real file runs as `node npm/bin/phax` with a temporary `HOME`, a fake binary already at the cache path, and a fresh update cache, so no request leaves the machine.
    - When a first run needs a fixture server, a plain CommonJS driver, `tests/fixtures/npm-launcher/drive.cjs`, hosts the server in its own process and calls the launcher's exported `launch` with a test config. It is started through `boundedSpawn`, so every process it starts stays in the bounded process group.

  No test sleeps or polls. Each signal is sent at a deterministic point:

  - The fake binary installs its handlers, then signals its parent, the launcher.
  - For an interrupted download, the driver signals itself from the fixture server's write callback, after the first chunk of the binary.

  The driver is `.cjs`, outside knip's `tests/**/*.ts` project, so knip never reports it as an unused file.
- Retire the mirror. phase-01 deletes `npm/lib/resolveBinary.mts` and `tests/unit/npmWrapperResolve.test.ts`, moves their name and URL cases into a test of the shipped file, and drops `lib` from `npm/package.json`'s `files`. Nothing else imports the mirror, and `scripts/prepare-npm.ts` does not read `npm/lib`.

  Loss accepted: none of substance. The published package loses an unused folder.
- Does `deno compile` of the esbuild bundle resolve anything through `deno.lock`? This is not checked at authoring time, because the authoring session has no shell. phase-03 checks it first, in a scratch copy, and records the finding in its handoff.

  The expectation: no package is resolved, because `esbuild --bundle --platform=node` inlines every package and leaves only `node:` imports. Deno still discovers `deno.json` and `package.json`, though, and validates the lock's workspace section.

  The mechanism does not hinge on the finding. `"lock": { "frozen": true }` in `deno.json` (config-frozen) still guards `deno run` of the build script and `pnpm deno:smoke`, the step that relinked `node_modules` once.

  Loss accepted (from the operator's verdict): `pnpm add` or an upgrade turns the Deno commands red until `deno.lock` is updated on purpose.
- `nodeModulesDir` becomes `"manual"`. Deno then uses the `node_modules` that pnpm installed and never writes it.

  `"none"` is ruled out: Deno would resolve npm packages from its global cache, which means the network and versions outside `pnpm-lock.yaml`.

  Loss accepted (rides-here): `pnpm deno:smoke`, `deno:check`, the build and `deno task dev` all need a prior `pnpm install`. Every path that runs them already does one.
- `allowScripts` is removed from `deno.json` entirely. In manual mode Deno never installs packages, so it never runs a lifecycle script, and an empty grant also satisfies ac-allow-scripts.

  Fallback, only if phase-03 finds that a Deno command fails without it: keep exactly `npm:esbuild@0.28.2` and `npm:fsevents@2.3.3`, and record which command needed them.

  Loss accepted: if `nodeModulesDir` ever goes back to `"auto"`, esbuild's install script will not run until the grant is restored. That failure is loud, not silent.
- How the launcher exits by a signal.

  - It removes every listener for that signal, then re-raises the signal on itself.
  - If it is still alive on the next timer turn, it falls back to `process.exit(128 + n)`. This happens only for a signal Node ignores by default, such as SIGPIPE.
  - The forwarding listeners are installed before `spawn` is called, so a signal sent by a fast child is never missed.
  - A terminal Ctrl-C reaches the binary twice (once through the process group, once forwarded). The spec's §10 accepts this.

  Loss accepted: the fallback exit status 128 + n stands in for a death by signal, and only for a signal Node cannot die of by default.
- Phase split. The launcher's network side (phase-01) is separate from its process side (phase-02), because they test differently: in-process against a fixture server versus spawned processes. Each commit stays reviewable.

  Loss accepted: `npm/bin/phax` is edited by two consecutive phases, and phase-01 leaves the old `spawnSync` start in place for one commit.
- Launcher error wording follows the indicative §6 forms, always naming the elements §5 binds:

  - `download failed: more than 5 redirects from <original url>`
  - `download failed: refused redirect to <url>: not https`
  - `download failed: refused redirect to <url>: host is not github.com or *.githubusercontent.com`. The host list in this message is built from the config.
  - `download failed: no connection to <host> within <n> s`
  - `download failed: no data from <host> for <n> s`
  - the sidecar errors name the sidecar URL
  - `could not start <path>: <CODE> (<reason>)`, followed by a line telling the user to remove `~/.phax/bin/<version>` and run phax again

---

## phase-01 — Launcher download path: private directory, verified rename, bounded redirects and timeouts {#phase-01-launcher-download}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium
**Assignment reason:** No code in the repository yet does this kind of network handling: redirect bounds, host checks, per-hop connect and idle timeouts, and an atomic verified placement that is safe under concurrency, all in a dependency-free script tested through a new seam and a first local fixture server. The policy's stronger model fits.

After this phase, a first run of the npm launcher downloads into a private directory of its own and verifies the binary there. Only a verified, executable binary reaches the cache path, by one rename. Redirects are bounded, resolved relative to the redirecting URL and kept on https and GitHub hosts. Every download request has a connect and an idle timeout, and the update check gives up silently after 5 s. The shipped file exposes its functions to tests without running when required. The `npm/lib` mirror is retired in favour of tests of the real file.

### Detailed instructions

- Keep `npm/bin/phax` as one CommonJS file: its shebang, `"use strict"`, and only `node:` built-ins with no dependency. Use only APIs available in Node 22.0 (`engines.node >=22`), so no `util.getSystemErrorMessage` and nothing newer. The source must not contain `process.env` at all (§5.12). At the bottom, always assign `module.exports = { productionConfig, getBinaryName, releaseUrls, cachePath, checkRedirect, ensureBinary, refreshUpdateCache, checkForUpdate }`, and run `main().catch(...)` only `if (require.main === module)`. Loading the file must do no I/O and start nothing.
- Add `productionConfig()`, which returns a fresh object every time it is called. Its fields:

  - `version`: the existing `VERSION` from `../package.json`
  - `home`: `os.homedir()`
  - `releaseBase`: `https://github.com/lbdremy/phax/releases/download`
  - `updateUrl`: `https://api.github.com/repos/lbdremy/phax/releases/latest`
  - `transport`: the `https` module
  - `scheme`: `"https:"`
  - `allowedHosts`: `{ exact: ["github.com", "api.github.com"], suffixes: ["githubusercontent.com"] }`
  - `maxRedirects`: 5
  - `connectTimeoutMs`: 10000
  - `idleTimeoutMs`: 30000
  - `updateTimeoutMs`: 5000

  Every function below takes this config as its first argument; `main` is the only production caller of `productionConfig()`.
- Add `releaseUrls(config, name)`, returning `{ binary: `${releaseBase}/v${version}/${name}`, checksum: binary + ".sha256" }`. Add `cachePath(config, name)`, returning `join(home, ".phax", "bin", version, name)`. `getBinaryName(platform, arch)` is unchanged.
- Add `checkRedirect(config, fromUrl, location)`, which returns the next URL as a string or throws:

  - Resolve with `new URL(location, fromUrl)`, so a relative Location works.
  - If the resolved protocol is not `config.scheme`, throw `refused redirect to <href>: not https`, building the word from the scheme.
  - If the hostname, lowercased, neither equals an `exact` entry nor ends with `.` + a `suffixes` entry, throw `refused redirect to <href>: host is not <exact list joined with ' or '> or *.<suffix>`. In production that reads `github.com or api.github.com or *.githubusercontent.com`; the §6 wording is indicative.

  A refused URL is never requested.
- Write one internal request helper used by the binary download, the sidecar fetch and the update check:

  - Every request sends the `User-Agent: phax/<version>` header.
  - Follow statuses 301, 302, 303, 307 and 308 through `checkRedirect`, draining each redirect response with `res.resume()`. A redirect without a Location header is an error.
  - Count redirects from the original URL. Past `config.maxRedirects`, fail with `more than <n> redirects from <original url>`.
  - A final status other than 200 fails with `HTTP <status> for <url>`.
  - Give every hop its own timers:
    - A connect timer of `connectTimeoutMs` starts with the request. Clear it when the socket is connected: on `secureConnect` when `socket.encrypted`, otherwise on `connect`, and at once if the socket is already connected (a reused keep-alive socket). On expiry, fail with `no connection to <host> within <n> s`.
    - Once connected, `socket.setTimeout(idleTimeoutMs)` aborts with `no data from <host> for <n> s` when no byte arrives for that long. This covers the wait for headers and the body alike.
  - Format `<n>` as milliseconds / 1000, without trailing zeros (10, 30, 0.2).
  - On any failure, destroy both the request and the response.
- Add `ensureBinary(config, name)`, returning a Promise of the cache path.

  If a file already exists at `cachePath`, return it without any request (trust-path, §5.6). Otherwise, run the first run in this order:

  1. Create the version directory with `mkdirSync({ recursive: true })`.
  2. Create the private download directory: `privateDir = mkdtempSync(join(versionDir, ".download-"))`.
  3. Download the binary into `join(privateDir, name)`. Keep a function named `download(` that writes through `fs.createWriteStream`: the release audit greps for `createWriteStream|download\(`.
  4. Fetch the sidecar as text and take its first whitespace-separated token.
     - If the fetch fails, throw `could not fetch checksum for <name> from <sidecar url>: <reason>. Refusing to run an unverified binary.`
     - If the token does not match `^[0-9a-f]{64}$`, throw `malformed checksum for <name> at <sidecar url>`.
  5. Hash the private file with `crypto.createHash("sha256")` and compare. Keep today's mismatch message.
  6. `chmodSync(privateFile, 0o755)`.
  7. `renameSync(privateFile, cachePath)`. This is the only write that ever touches the cache path.

  In a `finally`, run `rmSync(privateDir, { recursive: true, force: true })`, on success and on failure alike.

  Prefix download and redirect failures with `download failed: `, so that `main` prints `phax: download failed: …`. Two concurrent calls each get their own `mkdtemp` directory, and the later rename replaces a verified file with a verified file.

  Do not install signal handlers here; phase-02 does.
- Add `refreshUpdateCache(config)`, returning a Promise that always resolves and never rejects.

  - It requests `config.updateUrl` through the same helper, so the redirect rules apply.
  - An overall timer of `updateTimeoutMs` destroys the request silently. Unref that timer and the socket, so the check can never hold the process.
  - It writes `<home>/.phax/bin/.update-check.json` only when it succeeds, and it never prints.

  `checkForUpdate(config)` reads that cache path, built from `config.home`, and keeps today's once-a-day refresh and update notice.
- Rewrite `main()`:

  1. `config = productionConfig()` and `name = getBinaryName(process.platform, process.arch)`.
  2. If the cache path is absent, print `phax: downloading binary from <binary url>` as today.
  3. `binPath = await ensureBinary(config, name)`.
  4. `checkForUpdate(config)`.
  5. Then keep today's `spawnSync(binPath, …)` and `process.exit(result.status ?? 1)` unchanged. phase-02 replaces the start of the binary.

  On any error, print `phax: <message>` and exit 1. Remove the comment that points at `resolveBinary.mts`, and keep the note that the names mirror `RELEASE_TARGETS` in `scripts/build-binaries.ts`.
- Retire the mirror:

  - Delete `npm/lib/resolveBinary.mts`, which leaves `npm/lib/` empty and gone.
  - Delete `tests/unit/npmWrapperResolve.test.ts`.
  - Drop `"lib"` from `npm/package.json`'s `files`.

  The name and URL cases move to `tests/unit/npmLauncherConfig.test.ts`, against the shipped file.
- Create `tests/helpers/launcherFixture.ts`.

  `loadLauncher()` loads `npm/bin/phax` with `createRequire(import.meta.url)` and casts the result once to a local `Launcher` interface. Declare in that interface only the exports the tests call.

  A fixture HTTP server (`node:http`, 127.0.0.1, port 0) has per-path routes:

  - serve bytes;
  - redirect, with a status and a Location;
  - answer a status such as 404;
  - hold: accept the request and never answer, tracking it so that `close()` destroys it;
  - barrier: hold every request on a path until N requests have arrived, then serve them all.

  The server keeps a request log (method and path) and has `close()`.

  A `testConfig(home, server, overrides)` builder spreads `productionConfig()` and overrides:

  - `home`;
  - `releaseBase` and `updateUrl` on the server;
  - `transport` (`node:http`) and `scheme` (`"http:"`);
  - `allowedHosts`: `{ exact: ["127.0.0.1"], suffixes: [] }`.

  A test shortens a timeout only where it needs to. Each test gets a home from `mkdtemp` under `os.tmpdir()`, removed afterwards; never use `os.homedir()`.

  Export only what this phase's tests import (knip runs at the gate).
- Create `tests/unit/npmLauncherConfig.test.ts`, with small, pure tests:

  - **Binary names:** every supported `getBinaryName` pair, with win32 and freebsd refused.
  - **Production values:** `productionConfig()`'s transport is `node:https`, its scheme `"https:"`, and its `maxRedirects`, timeouts and host lists equal the shipped values.
  - **`checkRedirect` with the shipped config:**
    - refuses `http://release-assets.githubusercontent.com/x`, with a message naming the URL;
    - refuses `https://downloads.example.net/x`, with a message naming the URL;
    - accepts `https://release-assets.githubusercontent.com/x`;
    - resolves a relative Location.
  - **Fixed download source:**
    - Use `vi.stubEnv` to set HOME to a temporary directory and a few stray variables, such as `PHAX_DOWNLOAD_URL` and `HTTPS_PROXY`.
    - `releaseUrls({ ...productionConfig(), version: "0.44.0" }, "phax-darwin-arm64")` equals `https://github.com/lbdremy/phax/releases/download/v0.44.0/phax-darwin-arm64` and the same URL with `.sha256`.
    - The launcher's source text does not contain `process.env`.
- Create `tests/integration/npmLauncherDownload.test.ts`, with medium in-process tests against the fixture server:

  - **verified placement:** the cache file exists, is executable (mode & 0o111), its SHA-256 equals the sidecar's, and the version directory lists only `<name>`.
  - **mismatch:** the call rejects with the mismatch reason, and the version directory has no cache file and no `.download-` entry.
  - **sidecar failures:** for a 404 and for a non-hex line, the call rejects naming the sidecar URL, and nothing is left.
  - **concurrency:** a barrier holds both binary requests until two have arrived. `Promise.all` of two `ensureBinary` calls then gives both the cache path, the log shows 2 binary and 2 sidecar requests, the cache file is verified, and no `.download-` entry remains.
  - **cache hit:** with a file already at the cache path, the call returns with zero logged requests.
  - **redirect bound:** a chain of exactly 5 redirects succeeds, and a chain of 6 fails naming the original URL and the bound 5, with the shipped `maxRedirects`.
  - **relative Location:** for each of 301, 302, 303, 307 and 308, the log shows the resolved path requested, and the run succeeds.
  - **refused redirect:** a redirect to `http://localhost:<port>/elsewhere` (host not in the test's exact list) fails, and the log has no request for `/elsewhere`.
  - **idle timeout:** a held binary request with `idleTimeoutMs` 200 fails with `no data from 127.0.0.1 for 0.2 s`, and nothing is left.
  - **update check:** a held update endpoint with `updateTimeoutMs` 100 makes `refreshUpdateCache` resolve, writes no update cache file and writes nothing to stderr (spy on `process.stderr.write`).

  Close the server and remove the homes in `afterEach`. Measure no wall-clock time beyond the injected timeouts.
- Create `tests/integration/releaseAudit.test.ts`. It runs `boundedSpawn("bash", ["scripts/security/release-audit.sh"], …)` with:

  - `boundMs: SCRIPT_BOUND_MS`;
  - the repository root as `cwd`;
  - an env of `process.env` plus `AUDIT_OUT_DIR`, `HOME` and `npm_config_cache` set to temporary directories, and `NO_COLOR=1`.

  Assert that the combined output contains `npm installer verifies a checksum before executing the binary` and does not contain `Installer follows HTTP redirects without host validation`. Do not assert the exit status: other sections of the audit decide it.
- No test in the repository binds a port yet. If your own sandboxed test run cannot bind 127.0.0.1, rely on the gate's `pnpm test` and say so in the handoff; do not work around it with mocks of `node:http`.

### Planned files to create

- `tests/helpers/launcherFixture.ts`
- `tests/unit/npmLauncherConfig.test.ts`
- `tests/integration/npmLauncherDownload.test.ts`
- `tests/integration/releaseAudit.test.ts`

### Planned files to edit

- `npm/bin/phax`
- `npm/package.json`
- `npm/lib/resolveBinary.mts`
- `tests/unit/npmWrapperResolve.test.ts`

### Optional files that may be edited

- `docs/security.md`
- `tests/unit/npmReadme.test.ts`

### Boundary contracts

Producer: `npm/bin/phax` when it is required rather than run. Consumers: this phase's tests and, from phase-02, the driver `tests/fixtures/npm-launcher/drive.cjs`.

- The contract is `module.exports`, holding at least `productionConfig`, `getBinaryName`, `releaseUrls`, `cachePath`, `checkRedirect`, `ensureBinary`, `refreshUpdateCache` and `checkForUpdate`, with the config shape listed in Technical arbitrations.
- Requiring the file starts nothing.
- `ensureBinary` resolves to the cache path or rejects with an `Error` whose message is printable after `phax: `.

Producer: `npm/bin/phax`'s source text. Consumer: `scripts/security/release-audit.sh`, which greps it. It must still match `https\.get|createWriteStream|download\(`, a checksum word (`createHash`/`sha256`), and, next to `headers.location`, one of `github\.com|hostname|URL\(`.

### Test strategy

- a completed first run leaves exactly one executable file at the cache path whose SHA-256 equals the sidecar's digest, and nothing else in the version directory — medium · example · digest of the served bytes, file mode and the version directory listing · in-phase · ac-verified-placement
- a sidecar that does not match the binary rejects with the checksum-mismatch reason and leaves neither the cache path nor a private download directory — medium · example · rejection message and the empty version directory · in-phase · ac-mismatch-leaves-nothing
- a sidecar answering 404, and one answering a line that is not 64 hex digits, each reject naming the sidecar URL and leave nothing behind — medium · table · rejection message holding the sidecar URL and the empty version directory · in-phase · ac-sidecar-failure
- two first runs started together each download and verify their own copy and both resolve to a verified cache path with no private directory left — medium · example · request log of two binary and two sidecar requests, cache file digest and directory listing · in-phase · ac-concurrent
- a file already at the cache path is returned without any request — medium · example · a request log of zero entries · in-phase · ac-cache-hit
- a chain of five redirects succeeds and a chain of six fails naming the original URL and the bound of 5 — medium · boundary · the shipped maxRedirects and the rejection message · in-phase · ac-redirect-bound
- a relative Location on 301, 302, 303, 307 and 308 is requested resolved against the redirecting URL and the run succeeds — medium · table · the requested path in the fixture log for each status · in-phase · ac-relative-location
- the shipped redirect check refuses an http URL and a host off the allowed list, naming the URL, and accepts https on release-assets.githubusercontent.com — small · table · checkRedirect's returned URL or thrown message per input · in-phase · ac-redirect-host
- a refused redirect sends no request to its target — medium · example · the fixture log holds no request for the refused path · in-phase · ac-redirect-host
- a connection that is accepted and then sent nothing fails on the idle timeout naming the host, leaves no private directory, and the shipped defaults are 10 s connect and 30 s idle — medium · example · rejection message, version directory listing and productionConfig values · in-phase · ac-timeouts
- an update endpoint that never answers is abandoned silently after the update timeout, writing no cache and nothing to stderr, and the shipped update timeout is 5 s — medium · example · resolved promise, stderr spy, absent update cache file and productionConfig value · in-phase · ac-update-check
- the shipped binary and sidecar URLs for darwin/arm64 at 0.44.0 are the fixed GitHub release asset and its .sha256 whatever the environment, and the source reads no process.env — small · example · literal expected URLs and a scan of the launcher source · in-phase · ac-own-release
- the four supported platform and arch pairs map to their binary names and win32 and freebsd are refused — small · table · the RELEASE_TARGETS names · in-phase
- the release audit reports the launcher as verifying a checksum before running the binary, with no redirect-host finding — medium · smoke · the audit's output lines · in-phase · ac-audit

### Implementation order

1. Write `productionConfig`, `releaseUrls`, `cachePath` and `checkRedirect`, with `tests/unit/npmLauncherConfig.test.ts`.
2. Write the request helper (redirects, then timeouts) and `download`, then `ensureBinary` with the private directory, verification and rename.
3. Write `refreshUpdateCache` and `checkForUpdate` on the helper, then rewire `main` and add the `require.main` guard and exports.
4. Write `tests/helpers/launcherFixture.ts` and `tests/integration/npmLauncherDownload.test.ts`.
5. Write `tests/integration/releaseAudit.test.ts`, then retire the mirror and the `lib` entry.

### Excluded scope

- The asynchronous spawn, signal forwarding, exit-code and exit-signal pass-through, start errors and first-run cleanup on a signal (phase-02).
- Any spawned-launcher test and the driver `tests/fixtures/npm-launcher/drive.cjs` (phase-02).
- SEC-13: digests embedded in the npm package, or re-verifying the cached binary on each run.
- Proxies, mirrors, any environment override, a total-time cap on the download, and Windows.
- `scripts/security/release-audit.sh` itself, `deno.json` and every workflow file.

### Verification

The `standard` gate profile in `phax.json`. Every phase runs format, typecheck, test:type, lint, format:check, pnpm test, knip, audit:architecture and gen:model-catalog --check. Build, site:build, deno:smoke and deno:smoke-binary run as terminal steps.

### Expected handoff content

The handoff records:

- The exact `module.exports` names of `npm/bin/phax` and the signatures of `ensureBinary(config, name)`, `checkRedirect(config, fromUrl, location)` and `refreshUpdateCache(config)`.
- The config fields and their production values.
- The exact error message formats.
- The exports of `tests/helpers/launcherFixture.ts` and how a test builds a config on the fixture server.
- Confirmation that `main` still starts the binary with `spawnSync` (phase-02 replaces it).
- Whether the local sandbox could bind 127.0.0.1.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`fix(npm): verify the launcher's download in a private directory before it reaches the cache`

### Commit body

The npm launcher renamed its download into the cache before verifying it. A first run interrupted between the two left an unverified binary that later runs executed. Concurrent first runs shared one .tmp file, redirects were unbounded and crashed on a relative Location, and no request had a timeout (SEC-26).

Each first run now downloads into a mkdtemp directory under ~/.phax/bin/<version>/ and verifies the binary against its .sha256 sidecar there. The binary is made executable and reaches the cache path by a single rename; the directory is removed on success and on failure.

Redirects (301, 302, 303, 307, 308) are bounded to 5, resolved against the redirecting URL, and kept on https and on github.com, api.github.com or *.githubusercontent.com. Requests time out after 10 s to connect or 30 s without data. The update check is abandoned silently after 5 s.

The file stays a single dependency-free script. When required instead of run, it exports its functions, with production values gathered in productionConfig(). Tests drive those functions against a local fixture server. The resolveBinary.mts mirror and its test are retired, and the npm package no longer ships lib/. A test now runs the release audit to check it still recognises the launcher's checksum and host checks.

---

## phase-02 — Launcher process: forwarded signals, faithful exit, start errors, interrupted first run {#phase-02-launcher-process}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium
**Assignment reason:** No code in the repository forwards signals from a parent to a child and re-raises the child's ending. The exit semantics (a death by signal versus a code, the fallback for ignored signals) and deterministic, sleep-free signal tests under a synchronous bounded spawn have to be designed from scratch. The policy's stronger model fits.

After this phase, the launcher starts the binary with an asynchronous spawn and forwards SIGINT, SIGTERM and SIGHUP to it. It exits with the binary's own code or dies of the binary's own signal. A first run interrupted by one of those signals removes its private download directory and dies of that signal. A binary that cannot start is reported with its path, error code and reason, and how to download it afresh. Spawned-launcher tests prove these behaviours end to end, with the full first run among them.

### Detailed instructions

- Starting point from phase-01: `npm/bin/phax` exports `productionConfig`, `getBinaryName`, `releaseUrls`, `cachePath`, `checkRedirect`, `ensureBinary(config, name)`, `refreshUpdateCache` and `checkForUpdate`, and runs `main()` only when `require.main === module`. `main` still starts the binary with `spawnSync`. Read phase-01's handoff for the exact config fields and messages.
- Add `startBinary(binPath, args)`, returning a Promise:

  1. Before calling `spawn`, install listeners for SIGINT, SIGTERM and SIGHUP. Each one forwards the same signal to the child (`child.kill(signal)`) while the child runs, and keeps the launcher waiting.
  2. Call `spawn(binPath, args, { stdio: "inherit" })` from `child_process`.
  3. Resolve on the child's `exit` with `{ code, signal }`.
  4. On a child `error` that arrives before any exit (the spawn failed), resolve with `{ error }`, carrying the error's `code` and message.

  Remove the forwarding listeners once the child has exited.
- Add `exitLike(outcome, binPath, config)`:

  - **Code:** call `process.exit(code)`.
  - **Signal:** call `process.removeAllListeners(signal)`, then `process.kill(process.pid, signal)`. Schedule a fallback `setTimeout` that calls `process.exit(128 + os.constants.signals[signal])`, for a signal Node ignores by default.
  - **Start error:** print `phax: could not start <binPath>: <CODE> (<reason>)` on one line, and `  remove <home>/.phax/bin/<version> and run phax again to download it afresh` on the next. Then exit 1.

  For the reason, use a small table (EACCES permission denied, ENOENT no such file or directory, ENOEXEC exec format error), falling back to the error's message.
- Add `launch(config, args)`:

  1. `name = getBinaryName(process.platform, process.arch)`.
  2. Print the downloading line when the cache path is absent, as today.
  3. `binPath = await ensureBinary(config, name)`. On rejection, print `phax: <message>` and `process.exit(1)` without starting anything.
  4. `checkForUpdate(config)`.
  5. `exitLike(await startBinary(binPath, args), binPath, config)`.

  `main()` becomes `launch(productionConfig(), process.argv.slice(2))`. Export `launch`, `startBinary` and `exitLike`. The update check must never delay the exit: the launcher exits as soon as the child does, and phase-01 already unrefs the update timer and socket.
- Add a first-run signal guard inside `ensureBinary`. From the moment the private directory exists until the rename succeeds or the cleanup runs, listeners for SIGINT, SIGTERM and SIGHUP do three things:

  1. `rmSync(privateDir, { recursive: true, force: true })`;
  2. `process.removeAllListeners(signal)`;
  3. `process.kill(process.pid, signal)`.

  Remove the guard's own listeners in the existing `finally`. After a signal, the binary is never started. The guard installs and removes its listeners even when called in-process, which is harmless in vitest.
- Create `tests/fixtures/npm-launcher/drive.cjs`, plain CommonJS with `node:` built-ins only. It must not import `child_process`: the launcher it requires does the spawning, inside the bounded process group.

  Its arguments are `<scenario> <home> <fake binary file> <log file> -- <binary args>`.

  What it does:

  - It starts a `node:http` server on 127.0.0.1:0 and logs every request as one JSON line (method, path) to the log file.
  - It builds a config: `{ ...launcher.productionConfig(), home, releaseBase: http://127.0.0.1:<port>/releases, updateUrl: http://127.0.0.1:<port>/update, transport: require("node:http"), scheme: "http:", allowedHosts: { exact: ["127.0.0.1"], suffixes: [] } }`.
  - It serves the fake binary's bytes at `/releases/v<version>/<name>` and, unless the scenario says otherwise, the bytes' correct sha256 line at `….sha256`.

  Scenarios:

  - `ok`: `launch(config, args)`.
  - `mismatch`: the sidecar holds the digest of other bytes; `launch`.
  - `stall-SIGINT`, `stall-SIGTERM`, `stall-SIGHUP`: on the binary request, write headers with a Content-Length larger than what is sent, plus a first chunk. In that write's callback, call `process.kill(process.pid, <signal>)`; no timer.
  - `concurrent`: hold binary requests until two have arrived, then serve both. Run `Promise.all` of two `ensureBinary(config, name)` calls followed by `startBinary` each. Print both outcomes as JSON on stdout, then exit 0.
  - `cached`: the test has already placed the fake binary; `launch`.
  - `update-stall`: the fake binary is cached and the update cache is absent. Hold `/update` forever, set `updateTimeoutMs` to 600000, and `launch`.
  - `vanish`: `exitLike(await startBinary(<cache path that does not exist>, []), …)`.
- Create `tests/integration/npmLauncherProcess.test.ts`.

  Every spawn goes through `boundedSpawn` from `tests/helpers/boundedSpawn.ts`, with a stated bound (`SCRIPT_BOUND_MS`). When a signal ending is expected, pass `expectSignal`.

  The test writes the fake binaries into its temporary directory:

  - `#!/bin/sh` scripts that exit with `$1`, write a marker file named in an argument, or `kill -TERM $$`.
  - A signal recorder with the shebang `#!${process.execPath}`. It installs handlers for SIGINT, SIGTERM and SIGHUP; each handler appends the signal's name to a record file. On SIGINT it then exits 130. On SIGTERM or SIGHUP it removes its listeners and re-raises the signal on itself. After installing the handlers, it sends the signal under test to `process.ppid` (the launcher) and stays alive with a `setInterval`. No sleeps and no polling.
- Run the real file for the cached-binary cases: `boundedSpawn(process.execPath, [<repo>/npm/bin/phax, ...args], { env: { ...process.env, HOME: <temp home> }, boundMs })`.

  - Place the fake binary at `<home>/.phax/bin/<npm/package.json version>/<getBinaryName(process.platform, process.arch)>`.
  - Write a fresh `<home>/.phax/bin/.update-check.json` holding `{ latest: <that version>, checkedAt: Date.now() }`, so the launcher makes no request.

  Cases:

  - **Exit codes:** 0, 1, 3 and 130 each pass through as the launcher's status.
  - **Signals:** with the recorder, SIGINT gives status 130, and SIGTERM and SIGHUP end the launcher by that signal (`expectSignal`). The record file holds exactly the signal sent.
  - **Self-kill:** a fake that kills itself with SIGTERM ends the launcher by SIGTERM.
  - **Start error:** a cache file with mode 0o644 prints the cache path, `EACCES` with its reason, and the remove-and-rerun line, with status 1.
- Run the driver for the fixture cases: `boundedSpawn(process.execPath, [<repo>/tests/fixtures/npm-launcher/drive.cjs, scenario, home, fake, log, "--", ...])`.

  - **`ok`:** the marker is written, the cache file's digest equals the sidecar's, and the version directory lists only `<name>`.
  - **`mismatch`:** stderr has the mismatch reason, status is 1, and there is no marker, no cache file and no `.download-` entry.
  - **Each `stall-*`:** the launcher ends by that signal, and there is no `.download-` entry and no cache file. A following `ok` run on the same home then logs the binary and sidecar requests and writes the marker.
  - **`concurrent`:** both outcomes have the fake's code, the log shows 2 binary and 2 sidecar requests, the cache file is verified, and no `.download-` entry remains.
  - **`cached`:** the log is empty and the marker is written.
  - **`update-stall`:** status is 0 well inside the spawn bound, though the injected update timeout is 10 minutes, and stderr has no update text.
  - **`vanish`:** the path, `ENOENT` with its reason, and the remove-and-rerun line are printed, with status 1.
- The tests never read or write the real `~/.phax`. Every home is a temporary directory removed after the test, and a spawned launcher always gets `HOME` set to it. Do not import `node:child_process` in any test file; the architectural guard refuses it.

### Planned files to create

- `tests/fixtures/npm-launcher/drive.cjs`
- `tests/integration/npmLauncherProcess.test.ts`

### Planned files to edit

- `npm/bin/phax`

### Optional files that may be edited

- `tests/helpers/launcherFixture.ts`
- `tests/integration/npmLauncherDownload.test.ts`
- `docs/security.md`

### Boundary contracts

Producer: `npm/bin/phax` as a process. Consumers: users' shells and process managers, and the tests.

- A signal sent to the launcher reaches the binary.
- The launcher's exit status equals the binary's code, or it dies of the binary's signal.
- A first run stopped by a signal leaves no private directory and dies of that signal.
- A start error prints the path, the code, the reason and the remedy, then exits 1.

Producer: `npm/bin/phax` when required. Consumer: `tests/fixtures/npm-launcher/drive.cjs`, through the exports `launch(config, args)`, `startBinary(binPath, args)` and `exitLike(outcome, binPath, config)`, on top of phase-01's exports.

### Test strategy

- SIGINT, SIGTERM and SIGHUP sent to the launcher's pid alone reach the binary, and the launcher exits 130 for SIGINT and dies of SIGTERM or SIGHUP as the binary does — medium · table · the fake binary's signal record and boundedSpawn's status or signal · in-phase · ac-forward-signals
- a binary exiting 0, 1, 3 or 130 makes the launcher exit with the same code — medium · table · launcher status equal to the fake binary's code · in-phase · ac-exit-code
- a binary that kills itself with SIGTERM makes the launcher terminate by SIGTERM, not exit 1 — medium · example · boundedSpawn reports the SIGTERM ending · in-phase · ac-exit-signal
- a non-executable cache file and a vanished cache path each print the path, EACCES or ENOENT with its reason and the remove-and-rerun line, and exit 1 — medium · table · stderr lines and status 1 · in-phase · ac-spawn-error
- SIGINT, SIGTERM or SIGHUP during the download kills the launcher by that signal with no private directory or cache file left, and the next first run downloads, verifies and runs — medium · table · signal ending, version directory listing, request log and fake binary marker · in-phase · ac-interrupted-download
- a full first run against the fixture runs the fake binary from a verified cache path with nothing else in the version directory — medium · smoke · marker file, cache digest equal to the sidecar's and directory listing · in-phase · ac-verified-placement
- a mismatching sidecar makes the first run print the mismatch, exit 1 and never run the fake binary — medium · example · stderr, status 1, absent marker and empty version directory · in-phase · ac-mismatch-leaves-nothing
- two first runs at once both run a verified binary and report its exit code — medium · example · the driver's JSON outcomes, request log and cache digest · in-phase · ac-concurrent
- a cached binary runs through the launcher with no request to the fixture server — medium · example · empty request log and the fake binary's marker · in-phase · ac-cache-hit
- an update endpoint that never answers does not delay the launcher's exit and prints nothing about the update — medium · example · status 0 inside a spawn bound far below the injected 10-minute update timeout, and stderr without update text · in-phase · ac-update-check

### Implementation order

1. Write `startBinary` and `exitLike` in `npm/bin/phax`.
2. Write `launch`, rewire `main`, and add the first-run signal guard in `ensureBinary`.
3. Write the real-file tests: exit codes, signals, self-kill and EACCES.
4. Write `tests/fixtures/npm-launcher/drive.cjs` and its scenarios, then the driver tests.

### Excluded scope

- Changes to the download, redirect, timeout or verification rules settled in phase-01, beyond the signal guard.
- Reclaiming private directories left by SIGKILL or a power loss.
- Changes to the binary's own interrupt handler (`src/cli/interruptHandler.ts`) or to its SIGHUP handling.
- Windows, proxies and environment overrides.
- `deno.json`, the workflows and `docs/release.md`.

### Verification

The `standard` gate profile in `phax.json`. Every phase runs format, typecheck, test:type, lint, format:check, pnpm test, knip, audit:architecture and gen:model-catalog --check. Build, site:build, deno:smoke and deno:smoke-binary run as terminal steps.

### Expected handoff content

The handoff records:

- The new exports (`launch`, `startBinary`, `exitLike`) with their signatures.
- The exact start-error message lines.
- How the signal guard and the forwarding listeners are installed and removed.
- The driver's argument order and its scenario names.
- Any signal whose ending needed the 128 + n fallback on this platform.
- Confirmation that `tests/integration/releaseAudit.test.ts` still passes after the spawn rewrite.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`fix(npm): forward signals to the binary and pass its exit through`

### Commit body

The launcher ran the binary with spawnSync, which cannot forward a signal. A SIGINT or SIGTERM sent only to the launcher left the binary running the phase. A binary killed by a signal made the launcher exit 1, and an error starting the binary was swallowed into a bare exit 1.

The binary is now started with spawn. SIGINT, SIGTERM and SIGHUP are forwarded to it while it runs, and the launcher exits with the binary's code or dies of its signal. A first run interrupted by one of those signals removes its private download directory and dies of that signal. A binary that cannot start is reported with its path, error code and reason, and how to download it afresh.

Spawned-launcher tests prove these behaviours against fake binaries: the exit codes, forwarded signals and start errors through the real file, and the full first run (verified placement, mismatch, interruption, concurrency, cache hit, a stalled update check) through a driver that hosts a local fixture server.

---

## phase-03 — Frozen Deno lock, pnpm-owned node_modules, pinned allowScripts {#phase-03-deno-frozen-lock}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

After this phase, every Deno command of the build and the smoke checks fails with Deno's lockfile error instead of resolving past `deno.lock` or rewriting it. Deno leaves `node_modules` exactly as pnpm installed it, so the release bundle embeds only pnpm-pinned versions. `deno.json` grants lifecycle scripts to no version that a lockfile does not pin.

### Detailed instructions

- Facts on main: `deno.json` has `nodeModulesDir: "auto"`, no `lock` key, and `allowScripts.allow` lists `npm:@parcel/watcher@2.5.6`, `npm:msgpackr-extract@3.0.4`, `npm:esbuild@0.21.5`, `npm:esbuild@0.28.1` and `npm:fsevents@2.3.3`. `deno.lock` and `pnpm-lock.yaml` both pin esbuild 0.28.2.

  `package.json` scripts:

  - `deno:smoke`: `deno run --sloppy-imports --allow-read --allow-env --allow-sys --allow-run src/cli/main.ts --version`
  - `deno:check`: `deno check src/cli/main.ts`
  - `deno:compile`: `deno task compile`
  - `deno:build-binaries`: `deno run --allow-read --allow-write --allow-run --allow-env scripts/build-binaries.ts`
  - `deno:smoke-binary`: `sh scripts/smoke-binary.sh`

  The `standard` gate runs `pnpm deno:smoke` and `pnpm deno:smoke-binary` as terminal steps.
- First, record the three findings the spec's §10 leaves open. Run the checks in a scratch copy under a temporary directory, never against the worktree's own `deno.lock` or `node_modules`. Every Deno command you run gets `DENO_DIR` set to a temporary directory and `NPM_CONFIG_REGISTRY=http://127.0.0.1:9/`, so a mistake fails instead of reaching npm or reading HOME's caches.

  (a) Whether `deno compile --no-check` of an esbuild bundle consults `deno.lock`. A tiny ESM file importing only `node:` built-ins, compiled next to a copy of `deno.json`, `package.json` and a deliberately stale `deno.lock`, stands for the bundle. Does compile fail on the stale lock?

  (b) The exact error a frozen lock gives for `deno run` of `scripts/build-binaries.ts`, when the scratch `deno.lock`'s `workspace.packageJson.dependencies` lacks an entry that `package.json` declares.

  (c) That `nodeModulesDir: "manual"` lets the worktree's `pnpm deno:smoke` resolve every npm import from pnpm's `node_modules`. Manual mode never writes `node_modules`, so this check may run in the worktree.

  Write the three findings in the handoff.
- Edit `deno.json`:

  - Set `"nodeModulesDir": "manual"`.
  - Add `"lock": { "frozen": true }`.
  - Remove the `allowScripts` key entirely.
  - Keep `compilerOptions`, `fmt`, `lint` and `tasks` unchanged.

  Then run `pnpm deno:smoke`, `deno check src/cli/main.ts` (only if it passes on main), `deno task compile` and `deno task dev --version`. If one of them fails only because `allowScripts` is gone, restore `allowScripts.allow` with exactly `["npm:esbuild@0.28.2", "npm:fsevents@2.3.3"]` and record which command needed it.
- If `pnpm deno:smoke` fails in the worktree with Deno's lockfile-out-of-date error, the worktree's `deno.lock` does not match `package.json`. Fix it this way:

  1. Regenerate `deno.lock` in a scratch copy with Deno's own command, run with `--frozen=false`.
  2. Copy the file back.
  3. Check that its esbuild is still 0.28.2, pnpm's version.
  4. Record the diff in the handoff.

  Never run a Deno command with `--frozen=false` in the worktree. If the lock cannot be regenerated without reaching the npm registry, stop and report in the handoff: no step of this run reaches npm.
- Create `tests/unit/denoConfig.test.ts`. It reads `deno.json` (JSON), `deno.lock` (JSON) and `pnpm-lock.yaml` (with `parse` from the `yaml` package already used by `tests/unit/releaseWorkflow.test.ts`), and asserts:

  - `nodeModulesDir` is `"manual"`.
  - `lock.frozen` is `true`.
  - Every entry of `allowScripts.allow` (none when the key is absent) has the form `npm:<name>@<version>`, and `<name>@<version>` is a key of `pnpm-lock.yaml`'s `packages` or of `deno.lock`'s `npm` map.
  - `npm:esbuild@0.21.5`, `npm:esbuild@0.28.1`, `npm:@parcel/watcher@2.5.6` and `npm:msgpackr-extract@3.0.4` are absent.
- Create `tests/integration/denoLock.test.ts`. Every spawn goes through `boundedSpawn`, with `boundMs: CLI_BOUND_MS` and a comment saying why: a cold Deno transpile of the CLI under a loaded gate. Each test's env is `process.env` plus `DENO_DIR` set to a temporary directory and `NPM_CONFIG_REGISTRY=http://127.0.0.1:9/`.

  **Frozen test.** In a temporary scratch directory, copy `package.json`, `deno.json` and `scripts/build-binaries.ts`, and write a `deno.lock` copied from the repository with one `package.json` dependency removed from `workspace.packageJson.dependencies`. Run `deno` with the build's arguments (`run`, `--allow-read`, `--allow-write`, `--allow-run`, `--allow-env`, `scripts/build-binaries.ts`) and the scratch directory as `cwd`. Assert:

  - a non-zero status;
  - output matching Deno's lockfile-out-of-date error (use the wording finding (b) recorded);
  - the scratch `deno.lock` byte-equal to what was written.

  Also assert that `package.json`'s `deno:build-binaries` script equals `deno` followed by those arguments joined with spaces, so the test follows the build. Write the arguments as an array literal: the architectural guard refuses a command line split on spaces.

  **node_modules test.** Fingerprint the repository's `node_modules`:

  - the name and version of each top-level and scoped package, read from its `package.json`;
  - the sorted entries of `node_modules/.pnpm`;
  - whether `node_modules/.deno` exists.

  Run `deno` with the `deno:smoke` arguments in the repository root, and assert that it exits 0, prints `package.json`'s version, and leaves the fingerprint unchanged. Also assert that the script string equals those arguments, as above.
- Do not touch `release.yml`, `ci.yml`, `scripts/release.sh`, `scripts/build-binaries.ts` or `scripts/smoke-binary.sh`. Leave `pnpm deno:smoke` and `deno task compile` green: the terminal gate runs `pnpm deno:smoke` and `pnpm deno:smoke-binary`. If `CONTRIBUTING.md` documents the Deno commands, add one sentence there saying that `deno.lock` is frozen and how a dependency change updates it (the command that finding (b) and the regeneration step showed works).

### Planned files to create

- `tests/unit/denoConfig.test.ts`
- `tests/integration/denoLock.test.ts`

### Planned files to edit

- `deno.json`

### Optional files that may be edited

- `deno.lock`
- `CONTRIBUTING.md`

### Boundary contracts

Producer: `deno.json` and `deno.lock`. Consumer: the Deno CLI, as `package.json`'s `deno:*` scripts run it.

- A Deno command fails with the lockfile error rather than rewriting the lock or resolving an unpinned version.
- Deno reads `node_modules` as pnpm installed it and never writes it.
- The `deno:*` scripts and tasks keep their names and arguments, so `release.yml`, `ci.yml` and the gate are unchanged.

### Test strategy

- a deno.lock lacking a dependency package.json declares makes the build's Deno command fail with Deno's lockfile-out-of-date error and leaves deno.lock unchanged — medium · example · Deno's lockfile error text and the byte-equal scratch deno.lock · in-phase · ac-frozen
- deno.json freezes the lock and sets nodeModulesDir to manual — small · example · the parsed deno.json values · in-phase
- pnpm deno:smoke leaves every package version under node_modules unchanged and writes no node_modules/.deno — medium · example · node_modules fingerprint before and after the run · in-phase · ac-node-modules
- every allowScripts entry names a version pinned by pnpm-lock.yaml or deno.lock, and the four stale entries are gone — small · table · package keys of pnpm-lock.yaml and deno.lock · in-phase · ac-allow-scripts

### Implementation order

1. Record findings (a), (b) and (c) in scratch copies.
2. Edit `deno.json`, then run the Deno commands and settle `allowScripts`.
3. Regenerate `deno.lock` in a scratch copy only if the worktree's lock is stale.
4. Write `tests/unit/denoConfig.test.ts`, then `tests/integration/denoLock.test.ts`.

### Excluded scope

- Any change to `release.yml`, `ci.yml`, `scripts/release.sh`, `scripts/build-binaries.ts` or `scripts/smoke-binary.sh`.
- Telling phase agents not to run the gate's commands concurrently (the other half of the node_modules follow-up).
- Moving the binary off Deno.
- Any Deno command run with `--frozen=false` in the worktree, or anything that reaches the npm registry.

### Verification

The `standard` gate profile in `phax.json`. Every phase runs format, typecheck, test:type, lint, format:check, pnpm test, knip, audit:architecture and gen:model-catalog --check. Build, site:build, deno:smoke and deno:smoke-binary run as terminal steps; this phase must leave the last two green.

### Expected handoff content

The handoff records:

- Findings (a), (b) and (c), with the exact Deno error text.
- The final `deno.json`.
- Whether `allowScripts` was removed or kept with the two pinned entries, and why.
- Whether `deno.lock` changed, and its diff.
- The commands run and their results: `pnpm deno:smoke`, `deno task compile`, `deno task dev --version`, `deno check`.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`fix(deno): freeze deno.lock and leave node_modules to pnpm`

### Commit body

deno.json set nodeModulesDir to auto with no lock setting. A Deno command could therefore resolve past deno.lock and relink node_modules (deno:smoke once relinked oxlint past pnpm's version) right before esbuild bundles the release binary from it. allowScripts also granted install scripts to package versions no lockfile pins (SEC-29).

deno.json now freezes the lock, so a stale deno.lock stops every Deno command with Deno's lockfile error. nodeModulesDir is manual, so Deno reads node_modules exactly as pnpm installed it and never writes it. allowScripts no longer grants any unpinned version.

Tests check the stale-lock refusal in a scratch copy, check that deno:smoke leaves every node_modules version unchanged, and compare every allowScripts entry with both lockfiles.

---

## phase-04 — Docs redeploy order pinned by test, and its docs section {#phase-04-redeploy-guard-docs}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

After this phase, a test pins the order of the docs redeploy written by hand in PR #261. The workflow refuses a malformed tag before any checkout, checks out `refs/tags/<tag>`, verifies `package.json` and the ledger against the tag, and only then installs. The "Redeploying the docs site by hand" section of `docs/release.md` tells the maintainer what the workflow does, in that order.

### Detailed instructions

- Precondition. PR #261 (`fix/docs-deploy-tag-ref`) wrote the spec's normative §6 block into `.github/workflows/docs-deploy.yml` by hand, under q-workflow-edit (maintainer-first). The file is a protected path, so never edit it.

  If the file still starts its deploy job with `actions/checkout` and `ref: ${{ inputs.tag }}`, the run began before #261 merged. In that case, stop and say so in the handoff: do not write a test that is red, and do not touch the workflow.
- In `tests/unit/releaseWorkflow.test.ts`, inside the existing `describe("docs-deploy workflow: redeploying a released tag by hand")`, add a test named like `validates the tag, then checks out refs/tags/<tag>, then verifies the release, then installs`. Use the file's own helpers (`parseWorkflow`, `indexOf`, `runs`) and the `steps` of job `deploy`. It asserts:

  - The first step's `run` contains `^v[0-9]+\.[0-9]+\.[0-9]+$`, and no `uses:` step comes before it.
  - The shape step's index is lower than the checkout step's index.
  - The checkout's `with` equals `{ ref: "refs/tags/${{ inputs.tag }}", lfs: true }`.
  - The step whose `run` holds `package.json` and `releases.json` comes after the checkout and before the first step whose `run` is `pnpm install`.
  - The shape step reads the tag only through `$RELEASE_TAG`.
- Update the existing tests of that `describe` that still pin the old layout, unless #261 already did:

  - `checks out the tag with its LFS objects`, which expected `ref: ${{ inputs.tag }}` at index 0;
  - `refuses a tag that is not vX.Y.Z or not package.json's version, before building`, which looked for the regex in `Verify the tag is this release`.

  Keep every other assertion of the file (action pins, the ledger check, the deploy steps copied verbatim, nothing published).
- Rewrite the paragraph of `docs/release.md`'s section "Redeploying the docs site by hand" for its reader, the maintainer redeploying docs.phax.run from a released tag. Keep the `gh workflow run docs-deploy.yml -f tag=vX.Y.Z` example, then say in order what the workflow does:

  1. It refuses a tag that is not `vX.Y.Z` before anything is checked out.
  2. It checks out `refs/tags/vX.Y.Z`, never a branch of that name.
  3. It checks that `package.json` and the ledger's last entry name the tag's version, so a tag on an opening commit is refused.
  4. Only then does it install and build the site.

  Keep the paragraph's other facts unchanged: it runs release.yml's guard, preview upload, preview check and promotion; it stages nothing on npm and creates no GitHub Release; the guard refuses a redeploy that would drop a served schema URL; a site fix reaches docs.phax.run only with the next release; `pnpm site:preview` serves the built site locally.

### Planned files to create

- (none)

### Planned files to edit

- `tests/unit/releaseWorkflow.test.ts`
- `docs/release.md`

### Optional files that may be edited

- (none)

### Boundary contracts

Producer: `.github/workflows/docs-deploy.yml`, written by the maintainer in PR #261. Consumer: `tests/unit/releaseWorkflow.test.ts`.

The contract is the deploy job's step order: tag shape, then `actions/checkout` of `refs/tags/${{ inputs.tag }}`, then the package.json and ledger check, then `pnpm install`, then the site build and release.yml's deploy steps verbatim.

### Test strategy

- the deploy job validates the tag's shape before checkout, checks out refs/tags/<tag>, and verifies package.json and the ledger after the checkout and before pnpm install — small · example · step order and checkout ref of the parsed docs-deploy.yml · in-phase · ac-redeploy-order

### Implementation order

1. Check the precondition: `docs-deploy.yml` carries PR #261's layout.
2. Add the order test and update the existing tests that pinned the old layout.
3. Rewrite the `docs/release.md` section.

### Excluded scope

- Any edit to `.github/workflows/docs-deploy.yml` or any other workflow (protected).
- `release.yml`, `scripts/release.sh` and the release cut.
- Launcher and Deno changes (phase-01 to phase-03).

### Verification

The `standard` gate profile in `phax.json`. Every phase runs format, typecheck, test:type, lint, format:check, pnpm test, knip, audit:architecture and gen:model-catalog --check. Build, site:build, deno:smoke and deno:smoke-binary run as terminal steps.

### Expected handoff content

The handoff records:

- Whether the precondition held: `docs-deploy.yml` with PR #261's layout.
- The name of the new test, and which existing tests were updated (or found already updated by #261).
- The rewritten `docs/release.md` paragraph.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`test(release): pin the docs redeploy's validate, checkout-tag, verify, install order`

### Commit body

PR #261 made the docs redeploy refuse a malformed tag before any checkout, check out refs/tags/<tag> so a branch named like the tag is never built, and verify package.json and the ledger before pnpm install runs (SEC-28).

A test of the workflow's steps now pins that order and the checkout ref, and the tests that pinned the old layout follow it. The "Redeploying the docs site by hand" section of docs/release.md tells the maintainer what the workflow checks, in that order.
