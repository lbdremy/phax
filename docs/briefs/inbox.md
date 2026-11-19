Write the phax spec `inbox`: one command answers, for the current project, everything that waits and on whom, each
item with its next command. Specs and plans with open questions or waiting for approval, runs stopped and why, runs
in review, review findings with no fate, records not pushed.

## Why

The operator, 2026-11-19, from a conversation about what an agent would want from phax's command line. To know
where a project stands, an agent today calls `phax artifact status` file by file, `phax ls`, `phax finding list`,
`phax records status`, `phax plans status`, and joins the answers itself. Every session that picks up the work
pays that again, and a missed call is a missed item. One call answers "what is next here", and with
`docs/briefs/next-steps-as-data.md` each item carries the command that moves it.

It is the same inbox the brief `docs/briefs/claude-code-mod.md` describes for a person, beside the conversation.
One document can serve both: the mod reads it instead of joining five commands, and stays a pure reader of phax's
JSON as that brief requires.

## What phax has today, to read first

- `phax artifact status --json` (`artifact-status`): kind, status, legal transitions, approval, edited since
  approval, open questions.
- `phax ls --json` (`run-list`): state, current phase, `stop` (the review-stop document), `pullRequest`.
- `phax finding list --json` (`finding-list`): review findings and their fates (`F<n>`/`C<n>`, fix, dismiss,
  defer).
- `phax plans status` (staleness of Approved plans), `phax records status` (pending, unpushed records).
- `docs/briefs/claude-code-mod.md`: the inbox, the "a plan and its runs are one view" rule, a pure reader.
- `docs/briefs/agent-cli-ergonomics.md`: `phax ls` scoped to the current project.
- The two-repository setup (`docs/code-repository.md`): a process repository holding specs and plans, a code
  repository where runs happen.

## The direction (the operator's, 2026-11-19)

1. **One call, the current project.** A versioned document with a `$schema`, published like the others.
2. **Items, not views.** Each item says what waits, on whom (the operator, an agent, nobody: a run in progress),
   since when, and its next steps as data.
3. **Derived, never stored.** The inbox is computed from what the other commands read, each time. It holds
   nothing they do not.
4. **Local and without network.** It reads files, Git refs and the registry, like the commands it gathers.

## Questions for the spec's §9

- The command's name (`phax inbox`, `phax next`, `phax status`) and its place among the existing `status`
  subcommands.
- The item kinds and their order (what is most urgent first), and "on whom" as an explicit enum per kind.
- What a run in progress shows (it waits on nobody), and whether finished, archived or abandoned work appears.
- The cost: `artifact status` on every spec and plan, staleness on every Approved plan; what must stay cheap
  enough to call at the start of every session.
- The two-repository case: an inbox in the process repository naming runs that happen in the code repository.
- Whether the mod's brief is rewritten to read this document instead of the five commands.

## Out of scope

- The mod itself (`docs/briefs/claude-code-mod.md`).
- Notifications, and anything that writes.
- The knowledge index's history queries (`docs/briefs/knowledge-index.md`): the inbox is what waits now.
