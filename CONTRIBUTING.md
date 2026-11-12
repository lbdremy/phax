# Contributing to phax

This page is for working on phax itself. To use phax, start with the [README](README.md).

## Toolchain

[mise](https://mise.jdx.dev/) installs the tools phax is built and released with: Node 26, Node 22 for the schemas package's smoke, Deno, the `usage` CLI, gitleaks and osv-scanner. `mise.toml` pins their versions and `mise.lock` holds each one's checksum for Linux and macOS, x64 and arm64. CI and the release workflow install from the same two files.

```bash
mise install             # once, and again after mise.toml changes
```

With mise activated in your shell (`mise activate`), the repository's versions are on `PATH` inside it, so `pnpm …` runs on Node 26. Without it, nothing fails: you run on whatever Node is on your `PATH`. Two tools stay outside mise: pnpm, which `packageManager` in `package.json` pins, and semgrep, the security audit's optional deep code scan.

To change a version, edit `mise.toml`, then refresh the checksums for the four platforms:

```bash
mise lock --platform linux-x64,linux-arm64,macos-arm64,macos-x64
```

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

## The behaviour corpus

`tests/behaviourCorpus/` holds the answers phax gave on Effect 3 for every format, frozen decoder, config layer and provider answer, with the schemas package's baseline. `pnpm test` replays it through `tests/unit/behaviourCorpus/`, and the schemas check judges each generated JSON Schema against the latest released snapshot by its documents. A captured expectation is never changed, and a case that disagrees after a change means the change is wrong. A refusal that names the running schemas package's version writes `{package-version}` in its place, and the replay fills in the version the tree runs, so a release opening changes no case. When an Effect API moves, only `tests/behaviourCorpus/subjects.ts` adapts. No capture script remains, so a new case has to bring its own way of writing its expectation.

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
