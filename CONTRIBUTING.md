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

## The state machine

phax is an explicit hierarchical state machine. Every signal (a gate result, a rate limit, an agent's completion, an archive request) is a typed `PhaxEvent`. A pure reducer returns a `Disposition` — `Handled`, `Ignored`, `Stale`, `Rejected` or `Unexpected` — with the commands to run, and `dispatch()` is the only writer of `status.json` and `run-status.json`. [`docs/state-machine.md`](docs/state-machine.md) has the diagrams, the event-disposition matrix, the event and command vocabularies, and a worked example of adding a signal.

## Telemetry

phax emits its events — state transitions, adapter calls, gate results, artifacts — through the `SystemTelemetry` port. [`docs/observability.md`](docs/observability.md) describes the architecture, the snapshot rule and the adapter-boundary failure contract; [`docs/plan-extraction-model.md`](docs/plan-extraction-model.md) the model behind the fallback plan extraction.

## The CLI contract

`phax.usage.kdl` is the CLI's machine-readable contract, generated from the Commander program in `src/cli/`, which is the source of truth. Regenerate it, and the CLI reference, after changing any command, flag or argument:

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
