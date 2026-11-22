Write the phax spec `gate-step-times`: every gate attempt of a phase records when each of its steps started and how
long it ran, in the attempt's gate attribution, so a phase record says where its gate time went without running the
gate again.

## Why

On 2026-11-22 the queue item "Measure the gate, step by step" assumed the gate records held each step's duration. They
do not: `checks-attempt-NN.attribution.json` holds each step's command, surface and result, and `checks-attempt-NN.log`
holds each step's output and exit code, with no time anywhere. The measure had to run the `standard` profile's commands
again, three times, on the main checkout (NEXT_STEPS §7: `pnpm test` 189–192 s, every other step together about 9 s).

That measure answers one question once, on one machine, at one commit. The records already sit on `phax/records/v1`
for every phase of every run; with the times in them, the same question is a read of what already happened, across
runs, providers and machines:

- where a phase's gate time goes, and whether a step grew from one release to the next;
- how much a fix attempt costs against the first attempt, and what a partial command (`pnpm test <files>`) saved;
- the data `machine-slots` needs (a step's run time apart from its wait for a slot) and the default a later
  wall-clock limit on a gate step would pick (NEXT_STEPS §17), from what steps actually take.

## What phax has today, to read first

- `src/schemas/gateAttribution.ts`: the attribution document, each step `{ command, surface, result }`, the acceptance
  step, the protected-paths check; its `$schema` and the format's snapshots in `packages/schemas`.
- `src/app/gates.ts` (`runGates`, each step through the `Shell` port), `src/app/gateAttribution.ts`, `src/app/fixLoop.ts`
  (one attribution per attempt), `src/app/writeRecord.ts` (what goes to the records branch), `src/app/closeStop.ts`.
- `src/app/recordsExplain.ts`: how `phax records explain` shows an attempt's log and reports.
- The cost ledger (`src/schemas/costLedger.ts`), which already carries `endedAt` per invocation: the precedent for an
  instant in a persisted document, and for how `phax cost` reads it.
- `docs/upgrading.md` and the persisted-format rules: a new field is required, never optional; older documents are
  read through the format's `toLatest*` upgrade, where an unknown fact is `{ kind: "unknown" }`.

## What to decide

- **What a step records.** Its start instant and its duration in milliseconds (wall clock, as the shell port sees the
  child run), or both instants. CPU time of the child is not portable through the shell port; say whether it is left
  out. A step not run (skipped acceptance, a refused step, the steps after a failing one) records no time, and how
  that reads.
- **Where.** In each step of the attempt's attribution (one document, already per attempt and already in the
  record), or a separate timing file beside it. The attribution is the indicative answer.
- **The protected-paths check and phax's own gate work** (the gate request, the report steps' parsing): timed as
  steps, or as one figure for the attempt.
- **Who reads it.** Indicatively `phax records explain` (a duration beside each step) and nothing else in this spec;
  a summary across runs (`phax records` or `phax cost`) is a later question, named and left out.
- **The clock.** Through Effect's `Clock`, so tests fix the time; no test measures real time.

## Constraints

- A persisted format change: a new shape of the gate attribution with the field required, its snapshot, its
  `toLatest` upgrade reading an older attempt's steps as time unknown, and `@lbdremy/phax-schemas` reading both.
- No change to what a gate decides: the times are recorded, never compared with a limit (that is the separate,
  postponed item).
- No new port; timing stays around the existing shell call.
