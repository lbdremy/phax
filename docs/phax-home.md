# The phax home

The phax home is the one directory holding phax's own machine-wide files. It is `~/.phax` unless the `PHAX_HOME` environment variable names another. This page is for an operator who wants a second phax configuration beside the daily one (a release candidate, a branch under test), or a CI machine whose phax files live outside the CI user's home.

## A second configuration

```bash
export PHAX_HOME=$HOME/.phax-next
phax agent setup providers --write   # writes $HOME/.phax-next/providers.json
phax validate                        # home:    /Users/me/.phax-next (PHAX_HOME)
phax run --plan plan.md              # Claude Code, Codex and Vibe still use their own sign-ins
```

## What the home holds

```
$PHAX_HOME/            # ~/.phax when PHAX_HOME is unset
  config.json          # the global config layer
  providers.json       # provider enablement
  model-routing.json   # routing table (absent: the built-in table)
  telemetry.json       # telemetry switch
  <daily telemetry journals>
  runs/  worktrees/    # when no config layer names state.root
```

`phax report` reads the telemetry journals of the current home.

There is no fallback and no migration. With `PHAX_HOME` set, a file the directory does not hold takes its built-in default, and the copy in `~/.phax` is never read. phax does not copy anything from `~/.phax` into a new home, so an empty or missing one behaves like a fresh install.

## What never moves

`PHAX_HOME` moves nothing that belongs to a provider or to you. These stay under your user's home, whether the variable is set or not:

- the providers' own homes, stores and sign-ins: `~/.claude`, `~/.codex` and Vibe's home;
- the user-scope skills install under `~/.claude`;
- the `~` phax writes in a pull request body.

Do not change `HOME` to get a second phax configuration: the provider CLIs keep their sign-ins under it.

## The variable's rules

`PHAX_HOME` is an absolute path to a directory. A directory that does not exist yet is accepted and created on first write. phax refuses, with exit 2 (config validation):

- an empty value;
- a relative path, including a `~/…` your shell did not expand (quoting `'~/phax-ci'` does that);
- an existing path that is not a directory.

```
$ PHAX_HOME='~/phax-ci' phax run --plan plan.md
PHAX_HOME must be an absolute path to a directory, got "~/phax-ci"
```

The refusal comes before the command reads anything. Help, `--version`, `--usage`, `--json-schema` and `phax completions` do not check the variable, so a shell that sources completions starts cleanly while the next real command fails.

## Which home is in use

When `PHAX_HOME` chose the home, a command says so once on stderr:

```
phax home: /srv/ci/phax (PHAX_HOME)
```

With `--json` the same text is a `note` message line on stderr; stdout is unchanged (see [Machine answers](json-output.md)). Help, `--version`, `--usage`, `--json-schema` and `phax completions` print no notice, and nothing is printed on the default home. Inside a [run's phase worktree](#a-run-keeps-one-home) the run's recorded home decides, so the notice appears there for a run started under `PHAX_HOME`, even in a shell that does not set it.

`phax validate` names the home in both cases, with its source:

```
$ PHAX_HOME=/srv/ci/phax phax validate
✓ config is valid (project: acme)
  home:    /srv/ci/phax (PHAX_HOME)
  project: /work/acme/phax.json
  local:   (none)
  global:  /srv/ci/phax/config.json

$ phax validate
✓ config is valid (project: acme)
  home:    /Users/me/.phax (default)
  …
```

`phax validate --json` carries it as `"home": { "path": "/srv/ci/phax", "from": "PHAX_HOME" }`, where `from` is `PHAX_HOME` or `default`.

## Where runs go

The state root, which holds `runs/` and `worktrees/`, is chosen in this order, weakest first:

1. the built-in `~/.phax`;
2. `PHAX_HOME`, when set;
3. an explicit `state.root` in any config layer (`phax.json`, `phax.local.json` or the home's `config.json`).

An explicit `state.root` always wins and is read as written, with `~` as your user's home. A repository that writes `"state": { "root": "~/.phax" }` therefore keeps its runs in `~/.phax` under a moved home too; to separate them, override `state.root` in a more personal layer. `phax init` does not write `state.root`, so a new project follows `PHAX_HOME`.

## A run keeps one home

The home is fixed when `phax run` starts and serves the whole run.

- `phax run` records it in the run folder, `<state root>/runs/<run>/phax-home.json`.
- The agent sessions of the run get `PHAX_HOME` set to that path, and so do the commands phax prints for you to continue a stopped phase.
- A phax command run inside one of the run's phase worktrees uses the recorded home. If `PHAX_HOME` is set there to a different path, the command is refused with exit 2.
- `phax resume` refuses, with exit 2, when the current home differs from the recorded one, and names the recorded home. Set `PHAX_HOME` to it (or unset the variable, for a run started on the default home) and resume again. With the default state root, `phax resume` under another home does not find the run at all, so you see this refusal only when `state.root` is explicit.
- A run with no record, one started by an older phax and still in flight when you upgraded, is refused inside its phase worktrees and by `phax resume`. The message names the missing file. A record that does not decode is refused the same way. phax never falls back to the default home.
- A `security.filesystem.allowWrite` entry that covers the record is refused by `phax run` and `phax resume` with exit 11, so that no phase session can rewrite it.

The pin has two limits:

- A phax command run from a directory outside every phase worktree honours the `PHAX_HOME` it is given.
- A state root inside a directory the provider's sandbox always lets a session write, such as a temporary directory, leaves the record writable by the session.
