---
name: cli-view-layer
description: Keep CLI command definitions thin — declare the input, call one app/ use case, answer data and render it as text — no business logic in src/cli/definitions/.
---

# CLI view layer

## The rule

**Each command is a definition under `src/cli/definitions/`, and it stays thin.**
A definition built with `defineCommand` (from `src/cli/commandLibrary/contract/`)
only:

1. Declares its input: `args` and `flags` as Effect Schemas, plus `stdin` when it
   reads a document. The runner decodes them; a call that does not decode is
   refused with exit 64 before `run`.
2. Calls one `app/` use case in `run`, providing its layers.
3. Answers data: `output` is the schema of the answer `--json` prints.
4. Renders that answer as today's text in `render`, and declares each failure as a
   tagged error with its exit code and sentence.

A definition must not contain business logic, nor chain unrelated use cases (that
belongs in `app/`). What `src/cli/commands/` still holds is shared plumbing the
definitions import (layers, usage, stop and session-failure text), not commands.

## Output

A definition never writes to the process. While it runs, it writes through its
context: `say` (stdout, a `note` line under `--json`) and `progress` (stderr, a
`note` line under `--json`). A use case that prints as it goes takes an
`OutputPort` (`src/ports/output.ts`); `outputPortOf(call)` in
`src/cli/definitions/runOutcome.ts` builds one from the context. The runner owns
stdout and stderr under `--json`: a line written around it breaks the answer.

## Why

- The use cases are testable without a CLI harness.
- Exit codes, refusals and `--json` live in the runner, the same for every command.
- `phax <command> --json-schema` and `phax.usage.kdl` are generated from the
  definitions, so they cannot drift from the code.

## Guards

`tests/unit/architecturalGuards.test.ts` enforces the boundaries: the cli imports
only layer composition from `infra/`, no direct Node I/O outside its allowlist,
only the runner's adapter imports commander, and no file under `src/app/` writes
to `process.stdout`, `process.stderr` or the console.
