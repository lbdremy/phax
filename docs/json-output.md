# Machine answers: --json, message lines and --json-schema

This page is for an agent author or script writer who drives phax and needs to read its answers and act on its failures without parsing text. Every phax command takes `--json`. With it, stdout carries the command's answer as one JSON value and stderr carries only message lines, one JSON object each. Without it, a command prints the text a person reads, with the same arguments, options, codes and error sentences.

```bash
phax artifact status docs/specs/2611011200-garden-sync.md --json | jq '.questions.open'
phax resume garden-sync --yes --json 2> >(jq -c 'select(.kind == "error")')
phax plans lint --json-schema
```

## Answers on stdout

A successful command writes its answer on stdout: one JSON value, indented by two spaces, with one trailing newline. It carries the facts, not the text a person reads, with two exceptions where the text is the fact: a `paused` outcome's `lines` (the lines phax prints on stderr at that pause) and an `already-in-review` outcome's `message`.

- When the answer is a published document (`artifact-status`, `plan-overview`, `plan-lint`, `run-list`), `$schema` is its first key and names the format and the release that shapes it. `@lbdremy/phax-schemas` reads these. See [Read phax files from code](../README.md#read-phax-files-from-code).
- Any other answer is an object described by the command's contract (see [Contracts](#contracts)). It has no `$schema`, every key is required, and an absent value is `null`.

`phax run` and `phax resume` answer `{ qualifiedName, crossProject, outcome }`. The outcome is tagged by `kind`: `dry-run`, `preview`, `already-in-review`, `review_open`, `stopped`, or `paused` with its reason, phase, resume command, resume-instructions path and, when known, the time the limit resets. `phax reset-phase` answers `preview` or `reset` the same way. The other commands that run or review a run (`review-handoff`, `publish-pr`, `review-compliance`, `review-code --headless`) answer an object that starts with `qualifiedName` and `crossProject`.

## Message lines on stderr

Under `--json`, stderr carries only message lines. Each is one compact JSON object on one line, tagged by `kind`, and none has a `$schema`.

| Kind      | Fields                                      | Written when                                                       |
| --------- | ------------------------------------------- | ------------------------------------------------------------------ |
| `note`    | `text`                                      | The command has something to tell a person: progress, a warning.   |
| `written` | `path`, `format`, `digest`                  | The command wrote a file; one line per file of a document answer.  |
| `error`   | `error`, `exit`, `fields`, `written`        | A declared failure, named by its tag.                              |
| `refused` | `source`, `path`, `expected`, `text`, `exit` | The call was refused before any command ran.                       |
| `defect`  | `text`, `exit`                              | Something no command declared failed: a bug in phax.               |

For example, the first note of a resume, a held lock and an unknown option:

```
{"kind":"note","text":"Run \"example.garden-sync\" (state: interrupted) — would resume from phase 3: phase-03"}
{"kind":"error","error":"LockConflictError","exit":7,"fields":{"run":"garden-sync","pid":41207},"written":[]}
{"kind":"refused","source":"flags","path":["colour"],"expected":"no such option","text":"error: unknown option '--colour'","exit":64}
```

- `error` names a failure by its tag. `fields` holds the data the failure carries, and `written` lists the files the command left behind before failing. Most failures carry the sentence a person reads as `fields.message`; `LockConflictError` carries only the run and the holder's pid. The command's `--json-schema` entry lists each failure's fields.
- `refused` names the `source` of the field that failed (`args`, `flags`, `env`, `stdin` or `command`) and its `path`.
- A refused call is `refused`, never `error`: it ran nothing.

Without `--json`, the same failure is the sentence phax has always written, on stderr, with the same code.

## Exit codes

A command's documented codes stay, in both modes. See [Exit codes](../README.md#exit-codes) for the full table.

- A verdict code is written with its answer. `phax plans lint` exits 1 when a finding is an error and still prints its document. `phax run` and `phax resume` exit 13 at a stop, with the `stopped` outcome on stdout.
- A run that pauses answers with its `paused` outcome on stdout and exits with the pause's code: 8 for a rate or usage limit, 14 for a network failure, 5 for a failed handoff turn, 4 for gates exhausted or a gate step refused, 9 for a phase with no changes, and on `resume` a refused close with 1, 4, 5, 8 or 14. These codes are also the codes of declared failures of the same commands (an agent invocation failure is 5), so read stdout to tell a pause from a failure: a pause writes an answer, a failure writes an `error` line and nothing on stdout.
- **64** is `refused`: an unknown command, an undeclared argument or option, a source or document that does not decode, or a terminal read as stdin. It exits before any command runs.
- **70** is `defect`: a command died with something it did not declare, or its output did not encode.
- The phase guard is the exception: a call made inside a phase worktree is refused with exit 1, as one `refused` line under `--json`.
- **130**: `phax run` or `phax resume` was interrupted (SIGINT or SIGTERM). The run's state is saved, and under `--json` its `note` lines (a blank one, then the sentence) name the `phax resume` command that continues it; nothing is written on stdout.

## Contracts

`phax --json-schema` prints the contracts catalogue, and `phax <command> --json-schema` prints one command's entry. Nothing runs. Both are JSON Schema 2020-12.

The catalogue holds `program`, `version`, `exits` (the `refused` and `defect` codes), `commands` and `messages` (the shapes of the five lines above). A command's entry holds its name words, `input`, `stdin`, `output` and `errors`, and equals the entry in the catalogue:

```
$ phax plans lint --json-schema
{
  "name": ["plans", "lint"],
  "input": { "type": "object", "properties": { "plan": { "type": "string" } } },
  "stdin": null,
  "output": { "$ref": "https://docs.phax.run/schemas/plan-lint/0.34.0.json" },
  "errors": [ { "tag": "ConfigValidationError", "exit": 2, "fields": { "type": "object" } } ]
}

$ phax --json-schema
{
  "program": "phax",
  "version": "0.34.0",
  "exits": { "refused": 64, "defect": 70 },
  "commands": [ … ],
  "messages": { … }
}
```

An output that is a published document references its schema by URL. Every other output is described in place: those answers carry no `$schema`, so the catalogue is the only contract to validate them against.

## Documents read from a file or stdin

Two options hand a command a document: `--verdicts <file|->` on `phax artifact decide` (JSON) and `--brief <file|->` on `phax artifact new spec|plan` (Markdown text). The value is a path, or `-` for stdin. Stdin is not opened when the option is absent.

- A terminal on stdin is refused at once, naming the option, without waiting for input.
- A file that cannot be read, a document that does not decode, or one that does not fit the artifact (another artifact's path, an unknown question or option) is refused before anything runs. Under `--json` the `refused` line names the file or stdin and the field.

```
$ phax artifact decide docs/specs/2611011200-garden-sync.md --verdicts - --by operator
error: --verdicts - reads stdin, which is a terminal: pipe the verdicts in or name a file
$? = 64

$ phax artifact decide docs/specs/2611011200-garden-sync.md --verdicts verdicts.json --by operator --json
{"kind":"refused","source":"stdin","path":["verdicts",0,"chosen"],"expected":"an option id of q-cadence","text":"error: verdicts.json: verdicts[0].chosen is not an option of q-cadence","exit":64}
```

## Written files

A command reports each file it wrote on this call as a written-file record: `{ path, format, digest }`.

- `path` is from the repository root. A file under `~/.phax` is an absolute path.
- `format` is the document's `$schema`, or `null` when the file names none.
- `digest` is `sha256:` followed by 64 lowercase hex digits, taken from the file read back after the write.

The records are in the answer on success, and in the `written` field of the `error` line when the command fails part way. Under `--json`, a document answer also gets one `written` line per file. `run`, `resume`, `publish-pr` and `reset-phase` report none: their work is commits and phax's own state, and their answers name the paths that matter (`finalReport`, `pullRequest`, `archivedPath`).

## Commands that never answer --json

A command that hands the terminal to a session or prompts a person cannot answer `--json`. Each is refused with exit 64 before anything is read or started, and its `refused` line names what lifts the refusal.

| Command                                  | Instead                                         |
| ---------------------------------------- | ----------------------------------------------- |
| `phax enter`, `phax enter-phase`         | `phax session-info <run> --json`                |
| `phax shell`, `phax open`                | `phax path <run> --json`                        |
| `phax review-code` (without `--headless`) | `phax review-code --headless --json`            |
| `phax adjust-plan`                       | Run it from a terminal, without `--json`        |

A few commands refuse `--json` only in the mode that prompts, and name the flag that avoids it: `phax artifact decide` without `--verdicts` and `--by`, `phax artifact approve` and `reopen` without `--by`, `phax init` without `--yes`, `phax prune` without `--yes` or `--dry-run`, and `phax records init`. `phax resume` and `phax reset-phase` never wait on a person: without `--yes` they answer their `preview` and exit 0. `phax open --json` is refused even when the configured editor is a graphical one that would have returned at once.

These commands exit with the code of the process they handed the terminal to, whatever it is, 64 and 70 included. That is only seen without `--json`.

## Progress on long commands

`phax run` and `phax resume` take a long time, and write their lines as they go. Without `--json`, each stays on the stream it always used. Under `--json`, each becomes a `note` line at the moment it happens, so an agent follows the run on stderr while stdout stays empty until the answer.

- The lines `phax run` and `phax resume` print before their outcome (`Run: <name>`, `using cached extraction`, the `Skipping …` and `would resume …` lines) are notes. The `Run: <name>` note is not part of the answer, which carries `qualifiedName`.
- `--verbose` event lines, `phax·error` lines and warnings (the unsafe-mode box, `already exists; using …`) are notes.
- The what's-next lines after a run reaches review are notes. The answer holds the phase count, the pull request, the completions and the final report's path.
- Under `--json`, the order of stdout against stderr is not a contract. Within stderr, the order is the order they happened.

## Examples

Read the open questions of a spec:

```bash
phax artifact status docs/specs/2611011200-garden-sync.md --json | jq '.questions.open'
```

This prints the `open` list of the versioned `artifact-status` document, and nothing else.

Follow only the failure of a resume:

```bash
phax resume garden-sync --yes --json 2> >(jq -c 'select(.kind == "error")')
```

On a held lock this prints the `LockConflictError` line, with the run and the pid in `fields`, and the call exits 7.

Print one command's contracts:

```bash
phax plans lint --json-schema
```

This prints the entry for `plans lint` without reading a plan.
