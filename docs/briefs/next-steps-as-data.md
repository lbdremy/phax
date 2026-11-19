Write the phax spec `next-steps-as-data`: wherever phax tells its caller what to do next (a refusal, a pause, a stop,
the end of a run), it says it as data as well as text: the commands to run, each as an argument vector, with why.
An agent then runs the next step without reading English.

## Why

The operator, 2026-11-19, from a conversation about what an agent would want from phax's command line. phax is good
at saying what to do next: a refusal names its remedy, a paused run names its resume command, a stop names the
worktree and the continue command. But it says it in sentences. Under `--json`, a failure is
`{"kind":"error","error":"RunFailedError","exit":1,"fields":{"message":"Run \"phax.nonexistent-run\" not
found."},"written":[]}`: the remedy, when there is one, sits inside `fields.message` or in the follow-ups' prose.
An agent has to parse a sentence to find a command, and a sentence that changes breaks it silently. Commands as data
also let `docs/briefs/inbox.md` attach a next command to everything that waits.

## What phax has today, to read first

- `docs/json-output.md`: answers on stdout, message lines on stderr (`note`, `written`, `error`, `refused`,
  `defect`), the outcomes of `run`, `resume` and `reset-phase` (a `paused` outcome already carries its resume
  command and resume-instructions path).
- `src/domain/errors.ts`: `FailureWithFollowUpsError` and `failWithFollowUps`, whose `followUps` are strings.
- The command contracts (spec `docs/specs/archive/2611031738-command-contracts.md`, `src/cli/commandLibrary/contract/`):
  each command declares its failures and their fields; `--json-schema` publishes them.
- The text renderers of refusals and pauses, and the resume instructions file (`src/app/resumeInstructions.ts`).
- The review-stop document (`reviewStop` schema) and what it says the person can run.
- The rule for provider answers: every request and answer carries a required `$schema`. Message lines carry none
  today.

## The direction (the operator's, 2026-11-19)

1. **Commands as argument vectors.** A next step is `{ argv, why }`: `argv` is the exact command, one array
   element per argument, runnable as is; `why` is one sentence for a person. No shell string to parse.
2. **Everywhere phax suggests a command.** Refusals that have a remedy, pauses, stops, run outcomes, and the
   answers of commands that end on a step to take (`approve` after `decide`, `publish-pr` after review).
3. **The text says the same.** The text a person reads is rendered from the same data, so the two cannot drift.
4. **No guessing.** A step phax cannot fill in exactly (a value only the caller knows) is said as such, not
   written with a placeholder an agent might run.

## Questions for the spec's §9

- Where the steps live: a field on each failure, a common `next` key on every answer and error line, or both.
- How a step that needs a value from the caller is shaped (a named hole, or text only).
- Whether message lines and the error line gain a `$schema` like the published documents, under the
  format-stability promise.
- Several possible next steps (resume, or `--skip-acceptance` for a wrong acceptance test): an ordered list with
  the recommended one first, or a flag on it.
- Which follow-ups today are prose that must become steps, found by reading every `failWithFollowUps` call and
  every remedy sentence.

## Out of scope

- A command that gathers everything waiting: `docs/briefs/inbox.md`.
- Running the next step for the caller.
