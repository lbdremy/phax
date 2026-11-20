Write the phax spec `machine-slots`: the runs of one machine take turns for the steps that load it. phax grants a
bounded number of slots, shared by every run of a state root whatever its project, to the steps it runs itself (a
phase's setup commands, its gate). A step that finds no slot free waits, says that it waits, and its wait is
recorded apart from its duration.

## Why

A run does not load the machine evenly. Measured by the operator on one project over two weeks of runs (14 runs,
129 phases): the agent's turn is mostly spent waiting for the model, which costs the machine nothing, while the
setup, the gate and the agent's own test commands, about half of a run's time, each take every core they find. Two
runs side by side are fine until their heavy steps coincide, and then both pay: a gate that passed in 4.4 min alone
took 6.5 to 9.4 min on the days another run was working nearly all the time, a later phase's setup went from 1 min
to 2.6–3 min.

It is happening more often. The operator runs several runs at once, across projects that share one machine. And
what the queue holds next multiplies the heavy steps in flight: `phase-graph` gives one run several phases at the
same time, each with its gate; `do-attempts` runs N attempts in parallel; the parked `batch-execution-disjoint-plans`
runs several plans.

Because a run waits for the model most of the time, a turn taken at the gate costs it little: while it waits for a
slot, the others are mostly not asking for one. Each heavy step then runs at the speed it has alone, and the
machine's capacity is spent on work, not on contention.

## What phax has today, to read first

- `src/infra/lock.ts` and `src/ports/lock.ts`: a run's lock, a file under the state root's `locks/` holding the
  owner's process id, stale past a threshold or when the process is gone; `phax unlock`. It keeps a run from being
  driven twice. Nothing is shared between two runs.
- `state.root` (`phax.user.schema.json`, `~/.phax/config.json`): one state root may hold the runs of several
  projects, each under its namespace. It is the only place every run of a machine can meet.
- `src/app/setup.ts` (`setupPhase`, the project's `commands.setup`), `src/app/gates.ts` (`runGates`: the gate
  profile's steps, one after the other, each with its `timeoutMs`), `src/app/fixLoop.ts` (the gate run again after
  each fix turn), `src/app/cleanup.ts`.
- What a run records of time: the phase's status, the gate attempts' logs, the telemetry
  (`src/app/telemetry/`), the events `src/app/eventAdapter.ts` adapts.
- The briefs `phase-graph`, `do-attempts` and `run-detach`, and the spec
  `docs/specs/2608091526-batch-execution-disjoint-plans.md`: each puts more than one heavy step in flight, inside a
  run or across runs.

## The direction

Agreed with the operator on 2026-11-20, in a sentence: the heavy steps run one at a time on the machine, every run
together, or two at a time, the number a setting. The rest is this brief's proposal, for the spec to confirm or
replace.

1. **Slots belong to the state root.** Every run that shares it shares them, whatever its namespace. Two state
   roots do not see each other, and the spec says so.
2. **Their number is the operator's**, in the user configuration, not the project's: it says something of the
   machine, not of the repository.
3. **What takes a slot is what phax runs itself**: a phase's setup commands and its gate. The provider's turn takes
   none.
4. **A wait is said and recorded.** The run shows that it waits, for what, behind which run; the record keeps the
   wait apart from the step's duration, so that a gate's time still says what the gate costs.
5. **A wait is not a failure.** It does not count toward a step's timeout, and no run fails because another one
   holds the slot.
6. **A slot never outlives its holder.** A run that crashes, is killed or is stopped frees its slot, by the same
   reasoning as a stale lock.
7. **First come, first served.**

## What the spec must cover

- **The surface**: the configuration key and its default; what `phax run` prints when a step waits and when it
  starts; what `phax ls` and a run's status show of a waiting run; the event a follower reads (`run-detach`); the
  fields a phase's record gains.
- **The default.** No limit, which is today's behaviour and changes nothing for anyone who does not set it, or one
  slot, which is the behaviour the operator asked for. With what a first run on an upgraded machine shows.
- **The grain.** A slot held for a whole gate, or step by step (a gate's quick steps, a format check, do not load
  a machine; its test step does). Whether a project can say which of its steps are heavy, and what that costs in
  configuration against the simple rule.
- **The fix loop**: the slot is released while the agent fixes, and taken again for the next attempt.
- **Several phases of one run** (`phase-graph`, `do-attempts`): they take slots as phases of different runs do.
- **Crash, stop, resume, unlock**: how a slot is known to be free again, what `phax unlock` does with it, and that
  two runs can never both believe they hold the last slot.
- **Fairness**: a run with many short gates against a run with one long one; whether anything but arrival order is
  needed.
- **How the operator judges the number**: the waits and the steps' durations, read from the records, are enough to
  say whether one slot is too few or two too many.
- **Refusals**: a slot count that is not a positive integer; a state root that cannot be written.

## Out of scope

- Running a run, or one of its steps, on another machine.
- Measuring the machine (cores, memory, load) to set or change the number of slots by itself.
- Priorities between runs, and preempting a step that holds a slot.
- What the gate's commands do with the cores they get: the project's matter.

## Open, for the spec's questions

- The agent's own heavy commands. In the measure above they weigh half as much as the gate, and phax does not run
  them: the agent does, through its provider. Whether phax offers the phase a way to ask for a slot around a command
  (a wrapper the phase prompt names), or leaves them out.
- Whether setup and gate draw from one pool or two: a setup that copies a build cache loads the disk, a gate the
  cores.
- Whether a review's commands (`phax review-code`, a compliance review) take a slot.
