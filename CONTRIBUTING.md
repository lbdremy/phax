# Contributing to phax

This page is for working on phax itself. To use phax, start with the [README](README.md).

## Checks

```bash
pnpm install
pnpm check:full          # typecheck, unit, integration and type tests, lint, format, architecture, knip
pnpm build               # the CLI, the schemas package and its JSON Schemas
pnpm site:build          # the docs site
```

When a check fails, fix the cause: run `pnpm format` rather than adding a lint exception, and remove dead code or wire it into an entry point rather than silencing knip.

## Tests

```bash
pnpm test                # unit + integration: fast, no network, no provider CLIs
pnpm test:e2e:real       # opt-in end-to-end runs with the installed provider CLIs; costs tokens
```

The end-to-end suite runs only when `PHAX_E2E_RUN=1` is set. It has one real flow per provider (Claude Code, Mistral Vibe, Codex), each forced with `--provider-priority` and skipped when that provider's CLI is not installed. [`docs/e2e-testing.md`](docs/e2e-testing.md) covers its prerequisites, its isolation and how to read a failure.

## The Effect 4 migration

phax now runs on Effect 4. These tools exist for the Effect 3 to 4 migration and stay, described here, until its last plan removes them.

`pnpm codemod:effect4` rewrites the TypeScript under `src`, `tests`, `scripts`, `site` and `packages/schemas`. It prints the rewrites per rule, one line per v3 symbol it left, by file and line and prefixed with the `effect4-*` skill that owns it, and the type-error counts of `src` and of the test suite before and after. `pnpm codemod:effect4 --check` writes nothing and exits 1 when any file would change. `pnpm codemod:effect4 --ratchet` compares the measured counts with `scripts/effect4-codemod/type-error-counts.json` as committed at `HEAD`, fails when either count went up or when `package.json`'s scripts differ from `HEAD`'s, and otherwise writes the new counts for the next phase. It is the only writer of that file. The codemod needs no network and never reformats, so run `pnpm format` after it.

The same `--ratchet` also holds the passing tests. Once the type-error check has passed, it runs the unit and integration suites (the vitest CLI, with `vitest.config.ts`) and compares them with `scripts/effect4-codemod/passing-tests.json`, the passing tests as committed at `HEAD`. A recorded test that fails, is skipped or no longer exists fails the gate, so renaming a test or moving it to another file fails it until `HEAD`'s record carries the new name. Failed recorded tests are rerun once, by file; one that passes the second time counts as passing and is printed as `flaky`. A new passing test is added. A recorded test file that marks more tests `.fails` than its copy at `HEAD` fails the gate before the suites run, since vitest reports a `.fails` test as passed when its body throws. One case stays for review: a recorded test deleted and replaced by another under the same full name. Both records are written only when both checks pass. The phase that installs Effect 4 records the first set; until then no record is committed.

`tests/effect4Corpus/` holds the behaviour corpus: the answers phax gave on Effect 3 for every format, frozen decoder, config layer and provider answer. `pnpm exec tsx scripts/effect4-corpus-capture.ts` fills only the cases whose `expected` is null and refuses to run on any Effect major but 3. The baseline is never re-captured, and a case file only on Effect 3: the second migration plan re-captured exactly the lines phax's refusal model moved (listed in [`docs/upgrading.md`](docs/upgrading.md)) and added constraint and encode cases. Once Effect 4 is installed, a case file that disagrees after a change means the change is wrong. Only `tests/effect4Corpus/subjects.ts` is migrated.

The `effect-migration` gate profile in `phax.json` runs the ratchet on every phase, and `pnpm check:full` plus the product steps on the last. `phax.json` also declares `protectedPaths` for what the migration's proof rests on: the corpus cases, its baseline, `corpus.ts` and the corpus tests, the codemod's `main.ts`, `ratchet.ts`, `counts.ts` and `passingTests.ts`, both tsconfigs and `vitest.config.ts`. It also protects the test contract the migration must not move: every `__snapshots__` directory, each named (a glob starting with `**/` would reach below every symlink `pnpm install` rewrites under `node_modules`), the released JSON Schema snapshots under `packages/schemas/snapshots/`, the CLI's help, usage and contract fixtures, and the happy-path tests with no Effect code in them (`realFlow`, `headlessAuthoring`, `claudeProtectedPaths` and `claudeSkillEditGrant` among the e2e tests, `generateModelCatalog` and `reconciliation/global` among the unit tests). The ratchet's two records stay unprotected, since every migration phase rewrites them. No phase of any phax run in this repository may change them, and declaring them also protects `phax.json` itself, so until the migration's last plan removes the key, any change to these files or to `phax.json` is the operator's own edit, outside a phase.

The vendored reference, `docs/vendor/effect-migration/effect@4.1.2/`, is the source for what each v3 symbol becomes. The `effect4-lookup` skill says how to search it, and `effect4-services`, `effect4-errors`, `effect4-schema` and `effect4-core` each cover one area. A migration phase follows one of them.

## The state machine

phax is an explicit hierarchical state machine. Every signal (a gate result, a rate limit, an agent's completion, an archive request) is a typed `PhaxEvent`. A pure reducer returns a `Disposition` — `Handled`, `Ignored`, `Stale`, `Rejected` or `Unexpected` — with the commands to run, and `dispatch()` is the only writer of `status.json` and `run-status.json`. [`docs/state-machine.md`](docs/state-machine.md) has the diagrams, the event-disposition matrix, the event and command vocabularies, and a worked example of adding a signal.

## Telemetry

phax emits its events — state transitions, adapter calls, gate results, artifacts — through the `SystemTelemetry` port. [`docs/observability.md`](docs/observability.md) describes the architecture, the snapshot rule and the adapter-boundary failure contract; [`docs/plan-extraction-model.md`](docs/plan-extraction-model.md) the model behind the fallback plan extraction.

## The CLI contract

`phax.usage.kdl` is the CLI's machine-readable contract, generated from the command definitions in `src/cli/definitions/`, which are the source of truth. Regenerate it, and the CLI reference, after changing any command, flag or argument:

```bash
pnpm gen:usage-spec
pnpm docs:cli            # docs/cli/reference.md and the README's generated block
```

`tests/integration/usageSpecDrift.test.ts` fails when the committed file differs from the generator's output. `phax --usage`, the shell completions and the CLI reference all derive from it; the binary embeds it.

## The binary

The release binary is about 74 MB. The build bundles the CLI with esbuild first (about 1.5 MB of code actually used), then runs `deno compile --include` to embed the three files read at runtime: `package.json`, `phax.usage.kdl` and `.claude/skills`. Compiling without the bundle would embed about 274 MB of `node_modules`. The compiled binary runs with an explicit Deno permission set:

| Permission            | Status       | Why                                                                                              |
| --------------------- | ------------ | ------------------------------------------------------------------------------------------------ |
| Filesystem read/write | allowed      | run state, worktrees, locks, artifacts                                                           |
| Network               | denied       | phax makes no network calls itself                                                               |
| Environment           | allowed      | subprocesses resolve executables through `PATH`                                                  |
| Subprocesses          | unrestricted | security comes from the provider's sandbox and argv-only invocation, not an executable allowlist |

These permissions bound phax, not the agent CLIs it starts: `claude`, `codex` and `vibe` run under their own sandboxes. `phax open` uses the OS opener (`open`, `xdg-open`).

## Releasing

[`docs/release.md`](docs/release.md) describes cutting a release, the release workflow, the two npm packages and the docs site.
