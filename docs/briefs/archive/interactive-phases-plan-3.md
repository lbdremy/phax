Write the phax plan "Stop records, transcripts and the run list" for the approved spec `docs/specs/2610211403-interactive-phases.md`. It is the last of that spec's three plans, so it carries `completes-spec: true`.

Read the spec in full. These are settled; do not reopen them:
- every verdict in §9b;
- the carried-over verdicts in §10, q-transcript-records `full` and q-count-interactive `never` included;
- the operator's decisions of 2026-10-21 in §10, and the joint phase-shape decisions J1–J4;
- plan 1's operator verdicts, in `docs/plans/archive/2610220954-interactive-phases-plan.md`;
- plan 2's operator verdicts, in `docs/plans/archive/2610231043-interactive-phases-plan.md`: q-held-closing-posture (a read-only resume of the builder), resumable interrupts, q-discharge-oracle-edit `flagged`, and the 2026-10-23 decision that a refused record write at closing pauses the run and the next resume writes the record once.

Already landed, do not redo. Read each plan, then the code it landed, before planning:
- **Plan 1, the declared stop (PR #157).** The `awaiting_review` state and exit 13; `src/app/interactiveStop.ts`, `src/app/closeStop.ts`, `src/app/interactiveFiles.ts` and `src/app/telemetry/stopTelemetry.ts`; the first-reading, interactive-handoff, interactive-session and review-stop formats; the `stop` block on phase-status; the `first-turn` and `closing-turn` cost roles, with a closing turn costed by its own increment (`src/domain/cost/ledger.ts`); `ls --awaiting-review` (text only); `tests/e2e/semanticTrace.declaredStop.test.ts`.
- **Plan 2, the hold (PR #158).** `phax run --hold`, the held stop and its close, the review commit with its `Held-Phase:` trailer, and the oracle-pair rules. In `src/app/executePlan.ts`, the held phase's record is written once at closing (`writeHeldRecord`, `sourceSha` the phase commit) and `isStopArtifact` (`src/domain/records/stopArtifacts.ts`) keeps every stop file out of it. A refused write pauses the run (`HeldRecordRefused`, `held_record_refused`). Also landed: `tests/e2e/semanticTrace.heldStop.test.ts` and the provider adapters' flushed-stream fix.

Extend that code. Do not build a second close, record writer or stop reader beside it.

What plan 2 left honest but unfinished (NEXT_STEPS.md, "Gaps until then"), all in scope here:
- stops have no review fields in their records;
- `phax records explain` on a review commit finds no record;
- on mistral-vibe, a held phase's record counts the closing turn in its usage;
- a declared phase writes no phase record;
- `ls --json` is the unversioned array.

In scope, by section:
- **The run list (§5.35, §6 `cli: phax ls --json`).** A `run-list` format, born with `$schema`, joining FORMAT_IDS and SCHEMA_BORN_FORMAT_IDS and published through `@lbdremy/phax-schemas`:
  - one document with `runs`, both forms (`phax ls --json` and `phax ls --awaiting-review --json`);
  - every row key required, null when unknown (`recordsPending` and `archivePath` included);
  - `stop` is the run's review-stop document, equal in content to `review-stop.json`, or null.
  Read the review-stop through the existing reader, so a defective one is reported the way `phax ls` reports it today, never as a crash. Update `phax.usage.kdl`, and the docs/upgrading.md 0.26.0 entry for scripts reading the bare array.
- **Transcripts (§5.55, §5.56, §6 `file: interactive-transcripts/`).**
  - At closing, after the closing turn, copy every recorded session of the stop into `<run>/<phase>/interactive-transcripts/<session id>.jsonl`, whether or not the person continued it. This includes a held phase's builder session and every `--new-session` session.
  - A missing or unreadable transcript is recorded as missing, with its reason, and never blocks closing.
  - Locating each provider's session store goes through a port with one adapter per provider: Claude Code's project folder, codex's dated rollout files, mistral-vibe's session directory. Read the adapters (`src/infra/providers/*.ts`, and how vibe already reads `meta.json` by session id) for the paths.
  - The adapter reads only the transcript file of a recorded session id. It never reads a provider's credentials or configuration, and lists directory names only to find the file.
  - Every test keeps the fake stores under a test HOME and never reads a real `~/.claude`, `~/.codex` or `~/.vibe`.
  - The copy and its outcome are traced through `stopTelemetry.ts`.
- **Records (§5.68–§5.70).**
  - A closed stop's record names the phase's mode, the stop's cause and outcome, and the git identity that closed it. It names the recorded sessions (provider, model, id) or that there were none, and each transcript's sha256 or that it is missing, with the reason.
  - A held phase's record names its phase commit and its review commit when there is one.
  - A declared phase writes its record at closing, once, under the same refused-write rule plan 2 gave the held record.
  - An interactive transcript's content never reaches the records branch, whatever `records.transcript` says (the operator's decision of 2026-10-24, below).
  - `phax records explain` on the phase commit and on the review commit names the record and shows the stop line of §6 (`cli: phax records explain`).
  - The phase's `security.json` states that the person's work, a continued session included, ran outside phax's enforcement, and records the applied posture of each first turn and closing turn phax ran.
  - On vibe, a held phase's agent usage leaves out the closing turn.
- **Who closed the stop.** The review handoff, the PR body and the record all name the git identity that closed a stop, but a held phase reviewed without change leaves no commit to read it from. Record the identity at closing, at both stops and for both outcomes, as a required field of the `stop`'s closed variants: read from the checkout's git config through the Git port. Never infer it from HEAD's author.
- **Compliance review, review handoff, PR body (§5.66, §5.67, §6 `review-handoff.md` and `pr-body.md`).**
  - The compliance reviewer is given each stopped phase with its cause and its interactive handoff, so that its corrections are judged against that handoff and not as deviations from the plan.
  - `review-handoff.md` gains `## Reviewed phases`, omitted when the run had no stop.
  - The PR body's phase line shows the cause, outcome, identity and guard count.
  - A phase that never stopped keeps today's line and section, byte for byte.
- **Cost and estimate (§5.71, §5.72).**
  - The cost roles exist. Verify, and test where missing: a held phase's closing turn gets one `closing-turn` entry with its own increment, its builder entries are unchanged, and no entry covers a session phax did not start or the person's turns.
  - `phax plans estimate` names an interactive phase as interactive and sizes only its first turn and closing turn (`src/app/estimatePlan.ts`, `src/domain/cost/estimate.ts`, `estimateRender.ts`), in the text and `--json` output.
  - A hold is a run-time choice, so the estimate never sizes one: say so in its output only if the spec asks; it does not.
  - The ledger stays Claude Code only, as it is for every phase today (`src/app/costLedger.ts`). Record that in Technical arbitrations; it is not a stop gap.

Persisted shapes. Check `packages/schemas/history.lock.json` and `docs/release.md` first: 0.26.0 is uncut (the last tag is v0.25.0). Then:
- A format whose 0.26.0 `next` shape already differs from 0.25.0 changes in place: the phase-status `stop`, review-stop and interactive-session.
- A format still at its 0.25.0 shape, such as `phase-record-manifest` (frozen 0.17.0 and pre-schema decoders only), needs the 0.25.0 shape frozen, or the existing freeze verified, before it gains fields. Records already on a records branch must still read. Say which formats are which in Technical arbitrations.
- New fields are required, with explicit variants: a record of a phase that never stopped carries `stop: null`; never decode a new key as optional.
- The run list is new, so it has no frozen decoder.

Points the spec leaves to planning (§10 "Left open"). Settle each in Technical arbitrations:
- where the recorded sessions and the transcript digests live: the phase status, the interactive-session document, the record manifest, or one of them read by the others;
- the record manifest's stop shape: one variant per cause and outcome, naming the review commit only on a held corrected close;
- how `records explain` finds the record from a review commit: the `Held-Phase:` and `Run-Id:` trailers, or the manifest's review commit;
- the provider, model and effort a declared phase's record names when no agent built the phase: the first turn's, or the phase's routed assignment when no first turn answered;
- the run-list row keys' spelling (indicative), with `qualifiedName`, `state` and `stop` normative;
- the wording of `## Reviewed phases`, the PR body line and the compliance prompt section.

Raise an open question, instead of settling it, for any choice that loses security, privacy or autonomy.

Lessons from plan 2's review (#158). Its run left three plan defects and eight execution defects; plan for these from the start:
1. **Every write at closing has a defined interrupt and refusal path.** That covers the transcript copies, the identity, and the declared record. Say what a resume does after an interrupt between each write and the cleanup, and test that each is done exactly once.
2. **No read after the stop is parked fails the run.** Read what the close and the record need inside the close or before `RunResumeRequested`.
3. **Tests never read `~/.phax` or a real provider store**, through HOME or a loader. Every CLI-level suite stubs HOME.
4. **Published JSON Schemas match the decoders.** A strict decoder (`onExcessProperty: "error"`) publishes `additionalProperties: false`.
5. **All I/O through ports.** No `readFileSync` or direct `fs` in `app/`, `domain/` or `cli/`.
6. **Every in-scope §8 criterion has its own test, named in the plan**: the run list (§8 "phax ls --json is a versioned run list"); transcripts captured, even of a session never continued; a missing transcript; the review handoff and the PR; records and the security record; a held phase's record written once at closing (the `records explain` calls on C2 and R2); only phax's turns costed (the estimate included); plans and runs without a stop unchanged.
7. **Effects are traced**, and the held and declared e2e semantic trace snapshots are updated for the transcript copy and the record. Run them with `PHAX_E2E_RUN=1 npx vitest run --config vitest.e2e.config.ts tests/e2e/semanticTrace*.test.ts`, never the whole e2e folder.

Constraints:
- **Layers** as in CLAUDE.md. The run-list builder, the record's stop fields, the reviewed-phases section, the PR line and the estimate's interactive sizing are pure domain or app logic. Every file read, copy, git operation and provider-store lookup goes through its port.
- **State transitions** only through `src/domain/state.ts` and the reducer. Plan 3 adds no state; if it adds an event (a refused declared record, for example), it goes through the matrix and the dispatcher, which traces it.
- **No back-compat shims, explicit per-variant enums.**
- **Provider-agnostic.** Each provider's session store sits behind the same port. A provider whose store cannot be read gives `missing` with a reason, never an error.
- **No network.**
- **Fixtures** are made up (invoice-export, credit-notes, payments-fix, Ada Example, the session ids X0, X1, X2 and C1). Tests assert `$schema` URLs by format id and release pattern.
- **Gates:** every phase is verified by the `standard` gate profile, and every command it runs must be allowed by `phax.json`.
- **Skill edits:** if the phax-planning skill changes (the estimate of an interactive phase, for example), the plan says `phax run --allow-skill-edits`.
- **Models:** follow the phax-planning skill's model policy, with `assignmentReason`. This repository declares no assignment bounds.
- **Lint:** the plan must pass `phax plans lint`.

Docs:
- `phax --usage` for `ls --json`, `records explain`, `plans estimate` and every command whose output changes, regenerated with the usage spec and the CLI reference;
- README §Interactive phases: the transcripts, the records of a stop, the review handoff and PR lines, and `phax ls --json` for a review UI;
- docs/upgrading.md 0.26.0: the run list replaces the bare array, and the record manifest's new fields;
- docs/plan-estimate.md: the interactive phase's sizing;
- `NEXT_STEPS.md`: interactive-phases done, plan 3 of 3, with the "Gaps until then" list removed.

Phase shape: as few phases as the gates allow, from the core outwards, with every commit green. A likely order:
1. the persisted shapes (the stop's closing identity, the record manifest's stop fields, the transcript outcomes) with their decoders and published schemas;
2. transcript capture: the session-store port, its three adapters and the copy at closing;
3. records at closing: the declared record, the held record's review commit, the transcript digests, the security record, vibe usage, and `records explain` on both commits;
4. the run list;
5. the compliance review, the review handoff and the PR body;
6. cost verification and the estimate;
7. docs, the skill and the e2e trace snapshots.
Merge or split by size. The records phase is the largest; split `records explain` and the security record into their own phase if the gates need it.

A first draft of this plan (`docs/plans/archive/2610240822-interactive-phases-plan.md`, abandoned) was reviewed against the code. Read it. Keep what holds:
- its phase split;
- the in-place shape changes: phase-record-manifest is already at its 0.26.0 shape, with the 0.17.0 and pre-schema lifts gaining `mode: headless` and `stop: null`;
- where each fact of a stop lives (`closedBy` in the status `stop`, `transcripts` and `builderUsage` in interactive-session.json, copied into the manifest);
- the manifest's per-variant `stop`;
- `records explain` addressing a review commit through `Run-Id` and `Held-Phase`;
- the declared record's routed assignment and `usage: { available: false }`;
- the held record's `builderUsage`;
- `captureTranscript` on the Backend port;
- the one interrupt and refusal path per write;
- `StopRecordRefused`;
- the run-list row keys;
- the wording settled for `## Reviewed phases`, the PR line and the compliance section;
- the telemetry.

Decided by the operator on 2026-10-24. Record each in Technical arbitrations with the loss it accepts; do not raise them again:
- **q-dev-records: in place.** `mode` and `stop` are added to the 0.26.0 manifest as required keys. Records that development builds wrote since oracle-phases plan 1 no longer read. State the real effect:
  - `phax records explain` fails the whole command on such a record (`src/app/recordsExplain.ts`);
  - `phax records list` skips it;
  - `phaseRecordExists` counts it as absent.
  Every release from 0.17.0 to 0.25.0 stamped the manifest 0.17.0.
- **An interactive transcript's content never reaches the records branch, whatever `records.transcript` says.** The spec's r-records and ac-records were amended on 2026-10-24 to say so, narrowing q-transcript-records. A session the person continued ran outside phax's enforcement and may hold secrets they typed, and a dedicated records repository faces no visibility check (`src/domain/records/destination.ts`).
  - The record names each recorded session and its transcript's sha256, or `missing` with its reason.
  - The copy stays in the run folder under `interactive-transcripts/`.
  - `interactive-transcripts/` is a stop artifact (`isStopArtifact`), so no record carries it.
  - A test with `records.transcript` true proves the records branch holds no interactive transcript content.

Fix what the review found:
1. **security.json keeps every field it had.** A close adds only `stop`, and every other field is kept byte for byte: `readPhasePosture` reads `agentCommands` from this file (`src/app/interactiveFiles.ts`), and a held record carries it. Make version 2 strict. It has two readers: move `src/app/finalReport.ts`'s raw `readFileSync`, which swallows decode errors, onto the FileSystem port, and lift a version-1 file with `stop: null` in both readers.
2. **The estimate places an interactive phase's turns at the phase.**
   - Keep `runLevel` as the compliance median only: it renders as the "compliance review" row and the scenarios add it to the last phase (`src/domain/cost/estimateRender.ts`, `src/domain/cost/estimate.ts`).
   - Give the interactive turns their own figure and row, at the phase's plan position in the scenarios.
   - Count a past interactive phase as a sample only when it has at least one turn entry and a sum of at least `MIN_SAMPLE_USD` (`src/domain/cost/history.ts`). That keeps out codex or vibe phases, which cost $0 in a Claude-only ledger, and a first turn that started no session.
   - Reprice the turn samples by model and weight them by recency, as `fit.ts` does for phases.
   - Below `MIN_HISTORY_PHASES` the report lists no phases (`src/domain/cost/fit.ts`). Name the history fixture in `tests/helpers/costHistory.ts` that gives the §8 test at least that many headless samples plus at least 3 interactive phases.
   - Say in `docs/plan-estimate.md` that with 3 samples, P10 and P90 are the minimum and the maximum.
3. **Provider store roots never escape the test HOME.** No code reads `CLAUDE_CONFIG_DIR`, `CODEX_HOME` or `VIBE_HOME` today. If capture honours them:
   - resolve the roots once at the edge and pass them into the backend layer (`src/app/dispatcher.ts` / `makeNodeBackendLayer`);
   - have every suite set them empty, beside the HOME stub.
   Usage and capture must read the same vibe root.
4. **One vibe session finder.** Today the id match is `readVibeSessionMeta`, private to the app layer (`src/app/recordPlumbing.ts`). It reads the `meta.json` of every `session_*` directory, under `~/.vibe` alone.
   - Move it into one shared finder that usage and capture both use.
   - Narrow on the directory-name suffix before decoding a `meta.json`, and decode only `session_id`.
   - State that read honestly in the privacy statement.
5. **The digest matches the bytes.** Hash the bytes the copy writes: the adapter returns the bytes, and closeStop writes them through the FileSystem port. Test that the copied file hashes to the recorded `sha256`, including for a file with an invalid UTF-8 sequence.
6. **The close owns the copy policy.** The adapter only finds and reads the store file and returns its bytes, or `missing` with a reason. Keeping an earlier copy when the store file is gone, and refusing the close on a failed write (`files`), belong to `src/app/closeStop.ts`.
7. **The declared close is in flight too.** `closeInFlight` is set only for the held close (`src/app/executePlan.ts`). Set it for both causes, so that a failure after the declared commit pauses the run rather than failing it, and test it.
8. **A declared record's effort** is `model.effort ?? phase.effort`, as the close computes it (`src/app/closeStop.ts`), because `thinking` is optional in `model-resolution.json`.
9. **`ls --json` reads the stop through `readStopInfo`.** Extend `src/app/stopInfo.ts` to return the `ReviewStop`, and say how a stop document parked during a close is treated, rather than re-deriving the phase in `ls.ts`.
10. **Claude's project slug.** No code computes it. On macOS a worktree path under `/var` resolves to `/private/var`, so try the raw path's slug and the realpath's slug. A session id must match `^[A-Za-z0-9][A-Za-z0-9._-]*$`, which keeps out `.` and `..`.
11. **Align the session shape.** The closed stop's session and the manifest's session carry the same keys, `effort` included or excluded in both.
12. **Planned files.** Put `tests/helpers/phaseStatusFixture.ts` in the optional files, and add `tests/unit/telemetry/events.test.ts` to the optional files of the phase that adds `stop.transcript`. The e2e command is `PHAX_E2E_RUN=1 pnpm exec vitest run --config vitest.e2e.config.ts tests/e2e/semanticTrace*.test.ts`, never `npx`.
13. **Missing cost tests.** The ledger already costs each closing turn by its own increment (`src/domain/cost/ledger.ts`). Add tests for the $1.40 cumulative against $0.30 own-cost case, for the held phase's closing turn, and for the person's turns getting no entry.

Output: your final message is the plan document JSON and nothing else — no sentence before or after it, no code fence.
