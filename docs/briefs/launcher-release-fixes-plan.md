Write the phax plan "Launcher release fixes" for the approved spec `docs/specs/2611231919-launcher-release-fixes.md`.
It is the spec's only plan: it carries `completes-spec: true`.

Read the spec in full, sidecar included, and its brief `docs/briefs/launcher-release-fixes.md`. These are settled; do
not reopen them:
- the operator's verdicts of 2026-11-24 in §9b: q-cache-trust `trust-path`, q-redirect-hosts `github-suffix`,
  q-launcher-tests `bin-exports`, q-workflow-edit `maintainer-first`, q-frozen-where `config-frozen`,
  q-node-modules `rides-here`;
- everything §10 lists as settled, and its constraints; the non-goals of §7.

This plan takes every requirement of §5, every §6 surface and every §8 criterion, except the change to
`docs-deploy.yml` itself (below).

## Facts read on main at c6fb50b (2026-11-24)

- **The launcher.** `npm/bin/phax` (230 lines, CommonJS, no dependency): `download`, `fetchText`, `sha256File`,
  `verifyChecksum`, `readUpdateCache`, `refreshUpdateCache`, `checkForUpdate`, `main`, then `main().catch(...)` at the
  bottom, run unconditionally. `npm/package.json` ships `bin`, `lib` and `README.md`, with `engines.node >=22`.
  `npm/lib/resolveBinary.mts` mirrors the names and URLs and is tested by `tests/unit/npmWrapperResolve.test.ts`;
  nothing else in the repository imports it. `scripts/prepare-npm.ts` does not read `npm/lib`.
- **The release audit** (`scripts/security/release-audit.sh`, about line 40 to 65) greps the installer for a
  checksum check and, at about line 58, flags `headers.location` followed without `github.com`, `hostname` or `URL(`
  in the file. Criterion `audit-recognizes` holds it to passing.
- **The docs redeploy** is fixed by hand in PR #261 (`fix/docs-deploy-tag-ref`), written from the spec's normative
  §6 block, per q-workflow-edit. `.github/workflows/**` is a protected path: no phase edits it. The run starts after
  #261 merges, so the phase that adds the guard test reading the workflow's step order finds it green.
- **Deno.** `deno.json` sets `nodeModulesDir: "auto"`, no `lock` key, and an `allowScripts.allow` of five pinned
  versions. `package.json`'s scripts: `deno:smoke` (`deno run --sloppy-imports … src/cli/main.ts --version`),
  `deno:check`, `deno:compile` (`deno task compile`), `deno:build-binaries`, `deno:smoke-binary`. The `standard` gate
  profile runs `pnpm deno:smoke` and `pnpm deno:smoke-binary` as terminal product steps, and CI's `ci.yml` runs
  `pnpm deno:smoke` and `pnpm deno:compile`. `scripts/build-binaries.ts` bundles with `node_modules/.bin/esbuild`,
  then runs `deno compile --no-check` on the bundle.
- **The docs page** is `docs/release.md`, section "Redeploying the docs site by hand" (spec §11).

## Settle in Technical arbitrations, with the dominant loss of each

- **What §10 leaves open about Deno**, checked in a scratch copy, never on the repository's own `deno.lock` or
  `node_modules`: whether `deno compile` of the bundle resolves anything through `deno.lock`, which `nodeModulesDir`
  value keeps Deno from writing `node_modules` while `deno:smoke`, `deno:check` and the build still work, and whether
  `allowScripts` is needed at all after that. Record each finding in the plan.
- **The launcher's test seam** under `bin-exports`: how the file tells being required from being run
  (`require.main === module`), and which values its functions take as arguments (base URL, allowed hosts, timeouts,
  home) while `main` passes the production ones.
- **How the signal tests run** a fake binary under the launcher: through `tests/helpers/boundedSpawn.ts`, with no
  sleep-based waits.
- **Whether `npm/lib/resolveBinary.mts` and its test are retired**, and with them the `lib` entry of
  `npm/package.json`'s `files`.

## Shape

Indicatively: the launcher first (download into a private directory, redirects, timeouts, signals, exit status,
errors, its tests against a local fixture server and a fake binary, the audit still passing); then Deno (frozen lock,
`nodeModulesDir`, `allowScripts`) with the guard test that reads `docs-deploy.yml`'s step order and the
`docs/release.md` section. Models: `claude-opus-5-5` at medium for the launcher; a mechanical Deno and docs phase
may run on `claude-sonnet-5`.

No acceptance phase: the surface is a launcher that tests run as npm runs it, a workflow file and a configuration
file, all read in full by tests.

## Lessons from the runs on this repository

- **knip runs at every phase's gate**, default and `--production --strict`, against `knip-baseline.json`
  (protected). An export that only a later phase uses fails the gate: export it where it is first used.
- **`pnpm lint` is type-aware, against `lint-baseline.json` (protected).** Fix a lint error in the code; never add
  a disable directive.
- **Protected, untouched**: `knip.json`, both baselines, `.oxlintrc.json`, `.oxfmtrc.json`, the tsconfigs,
  `vitest.config.ts`, the workflows.
- **Tests never read `~/.phax`, a real provider home, the global git config or the network.** A test that spawns a
  child goes through `tests/helpers/boundedSpawn.ts`; the architectural guard refuses a new unbounded spawn.
- **No test measures wall-clock time** beyond the bounds the spec states; a timeout test uses short injected values.
- **The terminal gate runs `pnpm deno:smoke` and `pnpm deno:smoke-binary`**: the Deno phase must leave both green
  with the frozen lock, on a `deno.lock` that matches.

Every required command must equal an entry of `security.agentCommands` or a gate command exactly; an entry with a
space in it covers only itself. `deno`, `node`, `pnpm exec tsx`, `pnpm test:unit`, `pnpm test:integration`,
`git log`, `git grep` are `agentCommands`; `pnpm test` and `pnpm deno:smoke` are gate commands.
