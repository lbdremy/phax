Write the phax spec `run-detach`: a caller starts a run, gets its id back at once, follows it as a stream of
versioned events, and reads its outcome as one versioned document when it ends. The caller is a person in a
terminal, a script or, first of all, an agent delegating work to phax.

## Why

The operator, 2026-11-19, from a conversation about why an agent would pick phax over its own subagents or a cloud
agent. An agent delegating work wants three things from the tool it delegates to: it starts at once, it gives the
hand back, and it says what happened as data. phax gives the third only partly and the first two not at all:
`phax run` holds the caller's shell for the whole run (an hour is common), prints its progress as text, and ends
on an exit code and human lines. A subagent or a `Workflow` script returns the hand to its caller; a cloud agent
runs elsewhere and reports a pull request.

This is the transport the rest of the line builds on: `phax-do` (one task, no plan) and `do-attempts` (a contract,
several attempts, a measured choice) are both runs an agent starts and waits on.

Be honest about what already works: Claude Code can run `phax run` as a background command and is woken when it
exits, so a Claude Code agent already gets "give the hand back" for free. What it does not get is the progress as
data and the outcome as a document. The spec decides whether the first slice is the stream and the outcome only,
with detaching second (the first question for §9 below).

## What phax has today, to read first

- `src/domain/events.ts`: the run's domain events (`RunStarted`, `PhaseStartRequested`, `GatePassed`,
  `GateFailed`, `FixStarted`, `CommitCreated`, `ReviewStopReached`, `RunCompleted`, `RunFailed`, …), and
  `src/app/eventAdapter.ts`, which turns them into output and telemetry. They are not persisted as a log today.
- `phax runs list --json` (the `run-list` format), the per-phase `status.json` (`phase-status`), the run folder
  under `~/.phax/runs/`, the review stop document.
- The exit codes of `phax run` and `src/cli/definitions/runOutcome.ts`, which maps an outcome to them.
- The run lock (`src/app/lock.ts`) and how an interrupt is handled (`RunInterruptRequested`).
- The spec `command-contracts`: how a command declares its output and answers `--json` in a versioned format.
- `docs/structured-answers.md` and the rule that every provider request and answer carries a required `$schema`.
- The "Model policy tracking" notes in `NEXT_STEPS.md` on runs cut by the usage limit or the laptop sleeping
  (a scheduled `caffeinate` resumed one): a detached run meets them with nobody watching.

## The direction (the operator's, 2026-11-19)

1. **Three surfaces, all versioned JSON.** Start: the run's id and where to follow it, at once. Follow: a stream
   of events, one JSON object per line, each with its `$schema`. End: one outcome document (state, phases with
   their gates and commits, the handoff, the review findings, the pull request when there is one, the cost, the
   next step when the run stopped).
2. **The events are persisted.** The stream is read from a log in the run folder, not from the process, so a
   caller that connects late, or after the run ended, reads the same events. The log is a record of the run
   like the others.
3. **phax stays local and without network.** A detached run is a local process; no daemon, no server.
4. **Runs stay autonomous.** Detaching changes who waits, not what the run does: it still stops only where it
   stops today (an interactive phase, a hold, a usage limit, a failure), and the outcome says which.

## Questions for the spec's §9

- Is the first slice `--json` on `phax run` (events on stdout, outcome at the end) plus a `runs watch`/`runs
  outcome` reader, with the detached process second? Or is detaching the first slice?
- How a run detaches: a child process that outlives the caller, how its stdout and stderr are kept, and what
  happens when the machine sleeps or the user logs out.
- The event format: which domain events are published, which fields, how stable (a published format freezes
  them under the format-stability promise). The domain events today carry internal causes (`RunFailed.cause:
  unknown`).
- How a caller stops a detached run, and how it learns that the process died without writing its outcome.
- Where an agent is told about it: the `phax-cli` skill, and whether `phax run` names the follow command.

## Out of scope

- A cloud or remote mode (`docs/ideas/local-and-cloud-modes.md`).
- Notifications outside the machine (mail, chat, push).
- Running several phases of one run at once: `phase-graph`.
