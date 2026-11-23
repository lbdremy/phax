---
status: Approved
date: 2026-11-23
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
approved:
  date: 2026-11-23
  baseline: 46b038c
---
# Gate step times in the gate attribution

## 1. Context

Every gate attempt of a phase leaves a set of files in the phase folder, and they are copied into the phase's record on `phax/records/v1`. `checks-attempt-NN.log` holds each step's command line, output and exit code. `checks-attempt-NN.attribution.json` (the step record) holds the attempt's gate attribution. The phase's `gate-attribution.json` is the same document for the latest attempt. Today an attribution reads:

{ "$schema": ".../gate-attribution/0.33.0.json", "phase": "phase-02", "steps": [ { "command": "pnpm typecheck", "surface": "local", "result": "pass" }, { "command": "pnpm test", "surface": "local", "result": "fail" } ], "protectedPaths": { "result": "pass", "changes": [] } }

The steps listed are the ones that started: every configured step up to and including the first fail or refusal, then the acceptance step when the phase has one. When the operator skipped the acceptance step (`phax resume --skip-acceptance`), it is listed with `skipped` and nothing is spawned. The protected-paths check runs after the steps and is written into the same document. A stop's close runs the same gate with no protected-paths check (`null`).

None of these files records time. The only persisted time near a gate is in the cost ledger, which records each provider invocation's `durationMs` and `endedAt`. Those times come from the clock phax runs on, so tests fix them instead of measuring real time.

`phax records explain <commit>` shows a phase record: `gates    passed after 2 attempt(s)   surfaces  local, structural`, the acceptance step's result, and with `--gates` every attempt's log and reports. It shows no step list and no time.

Ground read:

- `src/schemas/gateAttribution.ts` — Today's attribution: `phase`, `steps` of `{ command, surface, result }` (configured surfaces pass|fail|refused, the acceptance step also `skipped`), and `protectedPaths` (null, or a pass/fail with changes). No time anywhere.
- `src/app/gates.ts` — `runGates` runs each step through the shell port, judges report steps, and records only the steps that started (up to and including the first fail or refusal), plus a skipped acceptance step that spawns nothing. It writes one document to `checks-attempt-NN.attribution.json` and to the phase's `gate-attribution.json`. The acceptance step can fail to spawn or outrun its time cap.
- `src/app/gateAttribution.ts` — `recordProtectedPaths` re-reads the attempt's step record and rewrites both files with the protected-paths result, leaving the steps unchanged.
- `src/app/fixLoop.ts` — One attempt is one `checks-attempt-NN` set of files with its own step record. The protected-paths check runs after the gate's steps.
- `src/app/closeStop.ts` — A stop's close also runs the gate through `runGates`, with `protectedPaths: null`.
- `src/app/writeRecord.ts` — The phase's gate files, attribution included, go to the record on `phax/records/v1`. Verified surfaces are derived from `gate-attribution.json`.
- `src/app/recordsExplain.ts` — `phax records explain` reads only the last acceptance step from `gate-attribution.json`. `--gates` prints each attempt's log, request and reports, but not the per-attempt step record.
- `src/cli/definitions/recordsExplain.ts` — The phase view prints `gates    <outcome> after N attempt(s)   surfaces  …`. The `--json` answer has `checksAttemptCount` and `acceptanceStep` but no step list.
- `src/schemas/persisted.ts` — `readGateAttributionFile` reads the pre-schema, 0.26.0 and 0.31.0 shapes into the current one. This is the precedent for lifting older attributions.
- `packages/schemas/src/generated/index.ts` — `gate-attribution` is currently stamped 0.33.0. The package exports `parseGateAttribution` and `toLatestGateAttribution` along with the historical shapes.
- `src/schemas/costLedger.ts` — Each invocation carries `durationMs` and an `endedAt` instant. This is the precedent for an instant and a millisecond duration in a persisted document.
- `src/app/costLedger.ts` — Times are taken with Effect's `Clock.currentTimeMillis` before and after the invocation, so tests can fix them.
- `src/ports/shell.ts` — `ShellRunResult` carries the exit code, stdout, stderr and stdout encoding. It carries no time and no CPU usage.
- `NEXT_STEPS.md` — §7: the 2026-11-22 measure had to rerun the `standard` profile (`pnpm test` took 189–192 s and every other step together about 9 s) because the records hold no step duration. §17 lists a postponed wall-clock limit on a gate step, and `machine-slots` needs to know how long steps run.
- `docs/upgrading.md` — Persisted-format changes are announced per release: a new required field, older stamps still read, and an `@lbdremy/phax-schemas` note.

## 2. Problem

A phase record cannot say where its gate time went. On 2026-11-22 the queue item "Measure the gate, step by step" assumed the records held each step's duration. They did not, so the measure had to run the `standard` profile's commands again, three times, on one machine at one commit (`pnpm test` 189–192 s, every other step together about 9 s). That answer is one sample, and it ages as soon as the suite changes.

The records for every phase of every run, across providers and machines, already sit on the records branch. They are missing one fact: when each step started and how long it ran. Without it, nobody can see from what already happened whether a step grew between releases, what a fix attempt cost against the first attempt, what a partial command saved, or how long steps really take. `machine-slots` needs that last fact to tell a step's run time apart from its wait for a slot, and a later wall-clock limit on a gate step needs it to choose a default.

## 3. Product goal

Every gate attempt records when each step that ran started and how long it ran, how long the protected-paths check took, and how long the attempt took as a whole. The times go in the attempt's own gate attribution, which travels with the phase record. `phax records explain` shows those times beside each step. Records written before this change still read, with their times marked unknown. Recording a time never changes what the gate decides.

> A gate time is a recorded fact read from the record, never a guess, a re-run, or a reason to change a verdict.

## 4. Terminology

- **gate attempt** — One run of a phase's gate: its configured steps in order, then the acceptance step when the phase has one, then the protected-paths check when one is declared. It is numbered NN in `checks-attempt-NN.*`. A stop's close runs one attempt too.
- **step** — One command of a gate attempt, as listed in the attribution's `steps`: a configured step (surface `local`, `structural` or `product`) or the acceptance step (surface `acceptance`).
- **step record** — `checks-attempt-NN.attribution.json`: the gate attribution of one attempt. The phase's `gate-attribution.json` is the same document for the latest attempt.
- **step time** — What a step records about time: `measured` with the instant its command started and its wall-clock duration in whole milliseconds, `not-run` for a step listed but never spawned, or `unknown` for a step read from an attribution written before this change.
- **attempt time** — The attempt's own `measured` start and duration. It runs from just before the first step starts to just after the last step is judged, so it includes phax's own gate work between and around steps (writing the gate request and the acceptance request, reading report steps' output). It does not include the protected-paths check.
- **phax's own gate work** — Whatever an attempt spends outside its steps' commands: the attempt time minus the sum of its measured step times.
- **wall-clock duration** — The elapsed time between two readings of the clock phax runs on, taken immediately before and after a command. It is not the child's CPU time.

## 5. Functional requirements

### 5.1 A step that ran records its start and duration

WHEN a gate attempt runs a step's command THE system SHALL record, in that step's entry of the attempt's gate attribution, a `measured` time with the instant the command started (an ISO-8601 UTC instant with milliseconds) and the command's wall-clock duration in whole, non-negative milliseconds.

### 5.2 A step that failed to spawn or outran its cap still records its time

IF a step's command fails to spawn or outruns its time cap THEN the system SHALL record the step's `measured` time from its start to the moment the failure was reported.

### 5.3 A skipped acceptance step records no time

WHEN the acceptance step is skipped by the operator THE system SHALL record its time as `not-run`, with no instant and no duration.

### 5.4 Steps that never started are not listed

The system shall list no step that did not start, so the steps after a failing or refusing step appear neither with a time nor as `not-run`.

### 5.5 The attempt records its own time

The system shall record on every gate attribution it writes the attempt's `measured` time, starting just before the first step and ending just after the last step is judged.

### 5.6 The protected-paths check records its time

WHEN the protected-paths check runs THE system SHALL record its `measured` time on the check's result in the attempt's gate attribution.

### 5.7 Adding the protected-paths result keeps the times

WHEN the protected-paths result is written into an attempt's step record and the phase's gate attribution THE system SHALL keep the steps' and the attempt's recorded times unchanged.

### 5.8 Step record and phase attribution agree

The system shall write the same times to an attempt's step record and to the phase's `gate-attribution.json` written for that attempt.

### 5.9 Times come from the clock phax runs on

The system shall take every recorded instant and duration from the clock phax runs on, so a run under a fixed clock records exactly the instants and durations that clock gives.

### 5.10 Time is required on the new shape

The system shall write a gate attribution under a new `gate-attribution` stamp that has the time required on every step, on the attempt, and on every non-null protected-paths result, and shall refuse a document under that stamp that is missing any of them.

### 5.11 Older attributions read with time unknown

WHEN phax reads a gate attribution stamped before the new stamp, or written before stamps existed THE system SHALL read every step's time, the attempt's time and any non-null protected-paths result's time as `unknown`, except that a skipped acceptance step reads as `not-run`.

### 5.12 The schemas package reads both shapes

The `@lbdremy/phax-schemas` package shall parse gate attributions under the new stamp and under every earlier one, and its `toLatestGateAttribution` shall lift an earlier one to the new shape with the times `phax` itself reads.

### 5.13 Times never change a verdict

The system shall decide every gate verdict, fix-loop attempt, refusal and exit code exactly as it would with no time recorded.

### 5.14 `phax records explain` shows the times

WHEN `phax records explain` shows a phase record THE system SHALL list, for each gate attempt in attempt order, the attempt's duration and each of its steps with command, surface, result and duration, followed by the protected-paths check when it ran.

### 5.15 Explain shows no figure it does not have

IF a step's or attempt's time is `unknown` or `not-run`, or an attempt's step record is absent or unreadable THEN `phax records explain` SHALL show `time unknown`, `not run` or `steps unknown` in place of a figure and still show the rest of the record.

## 6. Surface

### file: gate-attribution.json and checks-attempt-NN.attribution.json — normative

Summary: Each gate attempt's attribution now shows when each step started and how long it ran, how long the protected-paths check took, and how long the attempt took.

before:

    {
      "$schema": "https://docs.phax.run/schemas/gate-attribution/0.33.0.json",
      "phase": "phase-02",
      "steps": [
        { "command": "pnpm typecheck", "surface": "local", "result": "pass" },
        { "command": "pnpm test", "surface": "local", "result": "pass" },
        { "command": "phax-acceptance", "surface": "acceptance", "result": "skipped" }
      ],
      "protectedPaths": { "result": "pass", "changes": [] }
    }

after:

    {
      "$schema": "https://docs.phax.run/schemas/gate-attribution/0.43.0.json",
      "phase": "phase-02",
      "time": { "kind": "measured", "startedAt": "2026-11-23T10:04:11.020Z", "durationMs": 192113 },
      "steps": [
        { "command": "pnpm typecheck", "surface": "local", "result": "pass",
          "time": { "kind": "measured", "startedAt": "2026-11-23T10:04:11.031Z", "durationMs": 712 } },
        { "command": "pnpm test", "surface": "local", "result": "pass",
          "time": { "kind": "measured", "startedAt": "2026-11-23T10:04:11.760Z", "durationMs": 191344 } },
        { "command": "phax-acceptance", "surface": "acceptance", "result": "skipped",
          "time": { "kind": "not-run" } }
      ],
      "protectedPaths": { "result": "pass", "changes": [],
        "time": { "kind": "measured", "startedAt": "2026-11-23T10:07:23.140Z", "durationMs": 84 } }
    }

### package: @lbdremy/phax-schemas — normative

Summary: Scripts that read gate attributions get every step's time, with `unknown` for attributions written before times were recorded.

before:

    import { parseGateAttribution, toLatestGateAttribution } from "@lbdremy/phax-schemas";

    const latest = toLatestGateAttribution(parseGateAttribution(json));
    latest.steps[0]; // { command, surface, result }

after:

    import { parseGateAttribution, toLatestGateAttribution } from "@lbdremy/phax-schemas";

    const latest = toLatestGateAttribution(parseGateAttribution(json));
    latest.steps[0].time;   // { kind: "measured", startedAt, durationMs }
    latest.time;            // the attempt's time

    // an attribution stamped 0.33.0 or earlier:
    latest.steps[0].time;   // { kind: "unknown" }
    latest.time;            // { kind: "unknown" }

### cli: phax records explain — indicative

Summary: Running `phax records explain` on a phase commit shows each gate attempt's steps with how long each took, so you can see where the gate time went.

before:

    $ phax records explain 3f2a9c1
    phase-02 · claude-code (claude-opus-5-5, high)
    run      2026-11-23-gate-step-times
    record   …
    gates    passed after 2 attempt(s)   surfaces  local, structural
    source   3f2a9c1… (reachable)

after:

    $ phax records explain 3f2a9c1
    phase-02 · claude-code (claude-opus-5-5, high)
    run      2026-11-23-gate-step-times
    record   …
    gates    passed after 2 attempt(s)   surfaces  local, structural
      attempt 01   192.6 s
        pnpm typecheck     local        pass      0.7 s
        pnpm test          local        fail    191.3 s
        protected paths                 pass      0.1 s
      attempt 02   195.0 s
        pnpm typecheck     local        pass      0.7 s
        pnpm test          local        pass    190.4 s
        pnpm lint          structural   pass      2.4 s
        protected paths                 pass      0.1 s
    source   3f2a9c1… (reachable)

    # a record written before times were recorded:
      attempt 01   time unknown
        pnpm test          local        pass    time unknown

### cli: phax records explain --json — indicative

Summary: Scripts reading `phax records explain --json` get each gate attempt's steps with their times.

before:

    { "kind": "phase", …, "checksAttemptCount": 2, "acceptanceStep": null, … }

after:

    { "kind": "phase", …, "checksAttemptCount": 2, "acceptanceStep": null,
      "gateAttempts": [
        { "attempt": 1,
          "time": { "kind": "measured", "startedAt": "2026-11-23T10:04:11.020Z", "durationMs": 192613 },
          "steps": [
            { "command": "pnpm test", "surface": "local", "result": "fail",
              "time": { "kind": "measured", "startedAt": "2026-11-23T10:04:11.760Z", "durationMs": 191344 } }
          ],
          "protectedPaths": { "result": "pass", "time": { "kind": "measured", "startedAt": "2026-11-23T10:07:23.633Z", "durationMs": 84 } } }
      ], … }

## 7. Non-goals

- A summary of gate times across phases or runs (in `phax records`, `phax cost` or a new command). It is a later question and needs this data first.
- Any limit on a step's or an attempt's time, or any comparison of a time with a threshold. The wall-clock limit on a gate step is a separate, postponed item.
- The child's CPU time (user/system). The shell port does not report it portably, so it is left out and not marked unknown.
- Telling a step's run time apart from a wait for a machine slot. That is `machine-slots`' job, and today a step's measured time is its run time.
- Times for the steps that never started after a failing or refusing step, or for configured steps a stop's close did not select.
- Any change to the attempt log `checks-attempt-NN.log` or to the fix prompt the agent receives. The times are never shown to the agent.
- Timing the fix sessions, phase setup, record writing or publishing. The cost ledger already times provider invocations.
- Rewriting attributions already on the records branch. Older ones are read with their times unknown and are never backfilled.

## 8. Acceptance criteria

### Every step that ran carries its measured time

Given a phase whose gate has three configured steps that all pass, run under a fixed clock that advances 700 ms during the first step, 191000 ms during the second and 2400 ms during the third, when the gate attempt finishes, then `checks-attempt-01.attribution.json` lists three steps, each with `time.kind` `measured`, `startedAt` equal to the fixed clock's instant at the step's start, and `durationMs` 700, 191000 and 2400 in step order. (refs §5.1, §5.9)

### A failing step is timed and the steps after it are absent

Given a gate of three configured steps whose second step exits non-zero, when the attempt ends, then the step record lists exactly two steps, both `measured`, the second with result `fail`, and no entry for the third step. (refs §5.1, §5.4)

### A refusing report step is timed

Given a configured report step whose gate report refuses, when the attempt stops on the refusal, then the step's entry has result `refused` and a `measured` time. (refs §5.1)

### An acceptance step that outruns its cap is timed

Given an acceptance phase whose acceptance step outruns its time cap under a fixed clock that advances by the cap, when the attempt fails, then the acceptance step's entry has result `fail` and a `measured` time whose `durationMs` equals the clock's advance up to the failure. (refs §5.2)

### A skipped acceptance step reads not-run

Given a phase resumed with `phax resume --skip-acceptance` whose configured steps pass, when the attempt finishes, then the acceptance step's entry has result `skipped` and `time` `{ "kind": "not-run" }`. (refs §5.3)

### The attempt time covers its steps

Given an attempt run under a fixed clock that also advances while phax writes the gate request and reads a report step's output, when the attempt finishes, then the attribution's top-level `time` is `measured`, starts no later than the first step's `startedAt`, and its `durationMs` equals the sum of the steps' durations plus the clock's advance outside them. (refs §5.5, §5.9)

### The protected-paths check is timed and the step times survive

Given a phase that declares protected paths, whose gate passes, under a fixed clock that advances 84 ms during the check, when the protected-paths result is written into the attempt's records, then `protectedPaths.time` is `measured` with `durationMs` 84, and the step record and `gate-attribution.json` hold the same step and attempt times they held before the check. (refs §5.6, §5.7, §5.8)

### A stop's close gate is timed

Given a held phase whose stop is closed with a gate run, when the close's gate attempt finishes, then its step record and the phase's `gate-attribution.json` carry `measured` step and attempt times, and `protectedPaths` is `null`. (refs §5.1, §5.5, §5.8)

### The record on the records branch carries the times

Given a run with records enabled whose phase took two gate attempts, when the phase record is written to `phax/records/v1`, then its `checks-attempt-01.attribution.json`, `checks-attempt-02.attribution.json` and `gate-attribution.json` carry the same times the phase folder held. (refs §5.8)

### A new-stamp attribution without time is refused

Given a gate attribution under the new stamp whose one step entry has no `time`, when phax reads it, then the read fails and names the missing `time` field. (refs §5.10)

### An older attribution reads with time unknown

Given a gate attribution stamped 0.33.0 with a passing configured step, a skipped acceptance step and a passing protected-paths result, when phax reads it, then the configured step's time, the attempt's time and the protected-paths time are `{ "kind": "unknown" }` and the acceptance step's time is `{ "kind": "not-run" }`. (refs §5.11)

### The schemas package reads both stamps

Given one attribution under the new stamp and one stamped 0.31.0, when each is passed through `parseGateAttribution` then `toLatestGateAttribution` of `@lbdremy/phax-schemas`, then both give the new shape: the first keeps its measured times, and the second has `unknown` times as phax reads it. (refs §5.12)

### The verdict does not depend on time

Given the same gate steps and outputs run once under a clock that does not move and once under a clock that advances by hours per step, when both attempts finish, then both have the same step results, the same gate outcome, the same fix-loop decision and the same exit code. (refs §5.13)

### `phax records explain` lists each attempt's step times

Given a phase record with two gate attempts whose step records carry measured times, when `phax records explain <phase commit>` runs, then under the `gates` line it lists `attempt 01` and `attempt 02`, each with its duration and with every step's command, surface, result and duration in step order, followed by `protected paths` when the check ran. With `--json`, `gateAttempts` holds the same facts. (refs §5.14)

### `phax records explain` shows no invented figure

Given a phase record whose attribution is stamped 0.33.0, and another whose `checks-attempt-02.attribution.json` is missing, when `phax records explain` runs on each, then the first shows `time unknown` for its attempt and each step, the second shows `steps unknown` for attempt 02, a skipped acceptance step shows `not run`, and both commands exit 0 with the rest of the record shown. (refs §5.15)

## 9. Open questions

None.

## 9b. Arbitrated questions

### q-step-shape — What does a measured step time hold: its start and duration, both instants, or the duration only?

- start-duration — `startedAt` plus `durationMs` — abandons: a stored end instant: a reader adds the duration to the start to get it
- both-instants — `startedAt` plus `endedAt` — abandons: a duration a reader can sum directly, and the guarantee that a wall-clock step backwards cannot make it negative
- duration-only — `durationMs` only — abandons: where the step sat in time, which `machine-slots` needs to line steps from concurrent runs up against each other

Recommendation: start-duration — Duration is the question every reader asks, and it follows the cost ledger's `durationMs`. The start instant keeps steps from concurrent runs comparable on a shared timeline, and the end instant is one addition away, so losing it costs nothing.

Decision: start-duration — by operator (Rémy Loubradou), 2026-11-23
Why: Duration is the question every reader asks, and it follows the cost ledger's `durationMs`. The start instant keeps steps from concurrent runs comparable on a shared timeline, and the end instant is one addition away, so losing it costs nothing. Advocate: The strongest case for both-instants: two stored instants describe the step's place on the timeline completely and let a reader see overlap with another run's steps without arithmetic, where a stored duration has to be added to the start to get an end. Principles: S1, S5. Reversibility: costly. Revised: none.

### q-where — Where do the times live: in each step of the attempt's gate attribution, or in a separate timing file beside it?

- in-attribution — In the attribution's steps, under a new stamp — abandons: leaving the attribution format untouched: every attribution reader and `@lbdremy/phax-schemas` must move to the new shape
- separate-file — A new `checks-attempt-NN.times.json` beside the step record — abandons: one document per attempt: a reader must join two files by step position, and a time can drift from the step it describes

Recommendation: in-attribution — The attribution is already per attempt, already in the record and already lists exactly the steps that started, so the time sits on the step it describes. Moving to a new format stamp is the usual cost of a persisted change, and a second file would bring a join that can break.

Decision: in-attribution — by operator (Rémy Loubradou), 2026-11-23
Why: The attribution is already per attempt, already in the record and already lists exactly the steps that started, so the time sits on the step it describes. Moving to a new format stamp is the usual cost of a persisted change, and a second file would bring a join that can break. Advocate: The strongest case for separate-file: the attribution format stays untouched, so no reader and no `@lbdremy/phax-schemas` consumer has to move to a new stamp, and the timing data can evolve on its own. Principles: S1, S4. Reversibility: costly. Revised: none.

### q-phax-work — How are the protected-paths check and phax's own gate work accounted for?

- attempt-and-check — A top-level attempt time plus a time on the protected-paths result — abandons: a smaller format change: two more required time fields beside the steps'
- steps-only — Time the steps only — abandons: a complete account of the attempt: phax's own work and the protected-paths check's cost stay invisible
- pseudo-steps — List the protected-paths check and phax's work as extra entries in `steps` — abandons: `steps` meaning the gate's commands: verified surfaces, acceptance lookup and every step reader would have to skip phax's own entries

Recommendation: attempt-and-check — With a time on the attempt, phax's own work is the attempt time minus the sum of the steps, without inventing steps. The protected-paths check runs outside the steps and its cost grows with the repository, so it gets its own figure. Two extra fields cost less than an incomplete account or a polluted step list.

Decision: attempt-and-check — by operator (Rémy Loubradou), 2026-11-23
Why: With a time on the attempt, phax's own work is the attempt time minus the sum of the steps, without inventing steps. The protected-paths check runs outside the steps and its cost grows with the repository, so it gets its own figure. Two extra fields cost less than an incomplete account or a polluted step list. Advocate: The strongest case for steps-only: the format change stays smallest, with no new top-level field and no time on the protected-paths result, and the steps are what the 2026-11-22 measure was about. Principles: S1, S5. Reversibility: costly. Revised: none.

### q-explain-view — Where does `phax records explain` show the step times: in its default phase view, or only with `--gates`?

- default-view — In the default view, under the `gates` line — abandons: a short default view: it grows by one line per step per attempt
- gates-flag — Only with `--gates`, heading each attempt's log — abandons: seeing where the time went at a glance: the figures sit among full logs that run to thousands of lines

Recommendation: default-view — The point of the change is that a record shows where its gate time went without digging. A dozen lines per attempt is an acceptable cost, and burying the figures in `--gates` output would bring back the problem.

Decision: default-view — by operator (Rémy Loubradou), 2026-11-23
Why: The point of the change is that a record shows where its gate time went without digging. A dozen lines per attempt is an acceptable cost, and burying the figures in `--gates` output would bring back the problem. Advocate: The strongest case for gates-flag: the default phase view stays short and scannable, and an operator who wants gate detail already asks for `--gates`, so the times sit beside the logs they describe. Principles: S1, S10. Reversibility: cheap. Revised: none.

## 10. Implementation-planning note

Settled:

- Each step that started records a `measured` time (`startedAt` instant and `durationMs`). A skipped acceptance step records `not-run`, and older documents read as `unknown`. Steps that never started are not listed.
- The times live in the gate attribution, so the attempt's step record and the phase's `gate-attribution.json` carry them. The attempt and a non-null protected-paths result each carry a time too (pending q-step-shape, q-where and q-phax-work, whose recommendations the requirements follow).
- Wall-clock time only. CPU time is left out.
- `phax records explain` (text and `--json`) is the only reader added. No cross-run summary.
- Recording a time never changes a verdict, an attempt, a refusal or an exit code.

Left open:

- The final spelling of the explain lines and of `gateAttempts` in the `--json` answer (indicative).
- Whether the explain view caps or folds very long step lists. The default is to list every step.

Constraints:

- Take every instant and duration through Effect's `Clock`, around the existing shell call. Tests fix the clock (TestClock) and no test measures real time.
- Add no new port. Timing wraps the existing `Shell.run` call and the existing protected-paths check.
- This is a persisted format change: a new `gate-attribution` stamp with the time fields required (no optional fields, no back-compat shim), a frozen snapshot of the 0.33.0 shape, the JSON Schema and format snapshot in `packages/schemas`, the reader's upgrade of every older stamp to `unknown` times, `toLatestGateAttribution` doing the same in `@lbdremy/phax-schemas`, and a `docs/upgrading.md` entry.
- Per-variant time shapes: a configured step's time is `measured` or `unknown`. An acceptance step with result `skipped` has `not-run` only. Any other acceptance step has `measured` or `unknown`. The attempt and a non-null protected-paths result have `measured` or `unknown`.
- The record writer already copies the phase's gate files. Check that the per-attempt step records reach `phax/records/v1` and that explain can read them from the record's artifacts.

## 11. Docs page

Page: guide/records

Reader: An operator reading a phase record who wants to know where its gate time went: which step took the time, and what each fix attempt cost.

Example: $ phax records explain 3f2a9c1
…
gates    passed after 2 attempt(s)   surfaces  local, structural
  attempt 01   192.6 s
    pnpm typecheck     local        pass      0.7 s
    pnpm test          local        fail    191.3 s
    protected paths                 pass      0.1 s
  attempt 02   195.0 s
    …

## 12. Decision log

- 2026-11-23 q-step-shape decided start-duration — operator (Rémy Loubradou)
- 2026-11-23 q-where decided in-attribution — operator (Rémy Loubradou)
- 2026-11-23 q-phax-work decided attempt-and-check — operator (Rémy Loubradou)
- 2026-11-23 q-explain-view decided default-view — operator (Rémy Loubradou)
