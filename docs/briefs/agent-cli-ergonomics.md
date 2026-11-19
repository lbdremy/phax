Write the phax spec `agent-cli-ergonomics`: three small changes to the command line for its most frequent caller, an
agent. A preview never exits 0 as if the work were done; `--help` is short by default, with the long text by topic;
`phax ls` lists the current project's runs unless asked for all.

## Why

The operator, 2026-11-19, from a conversation about what an agent would want from phax's command line beyond
detaching a run (`docs/briefs/run-detach.md`). phax already does the large things right for an agent: every command
takes `--json`, `--json-schema` prints the contracts, exit codes are documented (`docs/json-output.md`). Three small
things still cost an agent mistakes or context.

1. **A preview exits 0.** `phax resume <run>` without `--yes` prints where it would resume and exits 0, asking
   nothing; `phax reset-phase` previews the same way. In text mode an agent reads exit 0 as "done". It already
   happened inside phax: the `provider-failures` spec's retry hint was `phax resume <run>`, which only previews
   (`NEXT_STEPS.md`, model policy row of 2026-10-28). Under `--json` the outcome's `kind` says `preview`, so a
   careful caller can tell; a hint copied into a prompt or a script is not that careful. Another command already
   refuses to proceed without `--yes` when there is no terminal ("required without a TTY").
2. **The help is long.** `phax run --help` is about 1,300 words and `phax resume --help` about 1,100. An agent
   reads help to call a command right, and every read costs context. `--json-schema` gives the shapes, not the
   meaning.
3. **`phax ls` lists every project.** It reads the global registry: an agent working in one repository sees the
   runs of demos and other projects, and has to filter on `namespace` itself.

## What phax has today, to read first

- `docs/json-output.md`: answers, message lines, the `preview` outcome of `run`, `resume` and `reset-phase`.
- The `--yes` flags in `phax.usage.kdl` and their commands, and the one that is required without a TTY.
- How help is produced: the command definitions under `src/cli/definitions/`, the contract and usage generation
  under `src/cli/commandLibrary/contract/`, `pnpm gen:usage-spec`, `docs/cli/reference.md`.
- `phax ls` and the `run-list` format; the registry under `~/.phax/runs/`; how a command knows the current project
  (`phax.json`, `name`).
- The format-stability promise (`docs/briefs/format-stability-promise.md`): changing an exit code or a default is
  a change of contract, and 1.0 promises the rules of change.

## The direction (the operator's, 2026-11-19)

1. **One convention for every command that can preview.** Previewing is asked for, with `--dry-run`. Without a
   terminal and without `--yes`, a command that would act refuses with an exit code of its own that names `--yes`;
   it does not preview and exit 0.
2. **Short help by default, long help by topic.** `--help` gives a synopsis, the options and the exit codes. The
   long text stays, reachable by topic (for `run`: gates, acceptance, hold, protected paths, linked plans).
3. **The current project by default.** `phax ls` lists the runs of the project it runs in; `--all` lists the whole
   registry. Outside a project it lists everything, as today.

## Questions for the spec's §9

- Which commands preview today without `--yes`, and whether each keeps a preview at all or only `--dry-run`.
- The exit code for "would act, needs `--yes`", and what the text mode does with a terminal (ask, as today?).
- How the long help is reached: `phax help <command> <topic>`, `--help=<topic>`, or the documentation site only;
  and how the generated reference (`docs/cli/reference.md`) and the shell completions follow.
- `phax ls` from inside a phase worktree, or from a code repository linked to a process repository.
- The upgrade note in `docs/upgrading.md` for scripts that relied on a previewing exit 0 or on `ls` listing all.

## Out of scope

- The next command as data on refusals and outcomes: `docs/briefs/next-steps-as-data.md`.
- One call for what waits: `docs/briefs/inbox.md`.
- Detaching a run: `docs/briefs/run-detach.md`.
