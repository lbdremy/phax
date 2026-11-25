Write the phax spec `phax-do`: one task, run with phax's guarantees and without a plan. `phax do "<intent>" --files
<planned files>` runs a single phase in its own worktree with the project's gate, reconciles the files it touched
against the files given, records the run, and keeps it open for review like any run.

## Why

The operator, 2026-11-19, from a conversation about why an agent would pick phax over its own subagents. For any
task under an hour, an agent today picks a subagent: it starts at once, with no spec, no plan, no lint and no
approval. A subagent's "done" is a claim, though: nothing checked the gate, nothing compared what it touched with
what it meant to touch, nothing is kept. `phax do` keeps what makes phax worth it (the worktree, the gate that
must exit green, the reconciliation, the records) and drops the ceremony that only pays for larger changes. This
is the item that would move the most of an agent's delegated tasks to phax.

The interface (operator, 2026-11-19): `phax do`, a command of its own, rather than `phax run --task`. Their inputs
share nothing (an intent and files on one side, a plan path on the other), so two helps read better. Both run
through the same use case.

## What phax has today, to read first

- `phax run` and `src/app/executePlan.ts`: everything after extraction is what `phax do` reuses.
- The extracted plan (`src/schemas/phaxPlan.ts`, `phax-plan`): a run executes an extracted plan, not the
  Markdown. `phax do` builds one directly.
- The reconciliation (`src/app/reconcilePhaseFiles.ts`): planned against touched files, the handoff justifying
  each deviation (and `docs/briefs/phase-handoff-answered.md`, which makes that justification structured).
- Gate profiles in `phax.json`, the partial commands on gate steps, protected paths, security modes.
- How a run is gated as an artifact today: an Approved plan, fresh against its ground, recorded
  (`src/app/planStaleness.ts`, `src/app/approvalRecordStore.ts`). `phax do` has no artifact to gate.
- The records, the release notes built from specs and run trailers (`scripts/release-notes.ts`): a run without a
  spec or plan must still say what it was.
- `run-detach`: a delegating agent will want `phax do` detached and its outcome as a document.

## The direction (the operator's, 2026-11-19)

1. **The guarantees stay, the ceremony goes.** Worktree, gate, reconciliation against the given files, handoff,
   records, review, `publish-pr`: as for any run. No spec, no plan file, no lint step, no approval step.
2. **The caller states the footprint.** The planned files are the reconciliation's contract; the caller gives
   them. (Whether phax may derive them is a question below.)
3. **Ceremony in proportion to risk.** Beyond a bound, `phax do` refuses and says to write a plan. The bound is
   the operator's to set; the spec proposes one.
4. **Same use case as `run`.** The intent becomes a one-phase extracted plan, kept with the run, so everything
   downstream (status, resume, review, records, publish) works unchanged.
5. **Runs stay autonomous.** `phax do` never stops to ask.
6. **The caller names the gate profile** (operator, 2026-11-25). A task can say which of the project's gate
   profiles verifies it (`--gate <profile>`), as a plan declares its own (`docs/briefs/plan-gate-profile.md`):
   a docs task under a light profile, a code task under the full one. An unknown profile is refused before the
   worktree is made, and the profile is recorded with the run and its one-phase plan.

## Questions for the spec's §9

- The bound beyond which a plan is required: a number of planned files, lines changed, protected paths, an
  architecture part, the gate profile. And what the refusal says.
- Who approved the run, in the records: the operator implicitly, `machine:<grant>` when an agent calls it, or a
  recorded "no approval: phax do" mark.
- Whether phax may derive the planned files from the intent with a cheap planning turn, or the caller must give
  them (the first slice likely requires them).
- Model and effort: the caller's flags, `phax.json` defaults, or the catalog's.
- The gate profile when the caller names none: the default `plan-gate-profile` settles for plans, the first one
  `phax.json` lists, or a refusal. And whether the bound above depends on the profile (a light profile allowing
  fewer files).
- Where the intent and the generated one-phase plan are kept (the run folder, the records branch), and how the
  release notes and `phax records explain` name such a run.
- Whether one `phax do` may run while a plan's run is in progress in the same project (the run lock, `phax plans
  overlap`).

## Out of scope

- Several phases without a plan (that is a plan).
- Several attempts and a choice among them: `do-attempts`.
- Detaching: `run-detach`.
