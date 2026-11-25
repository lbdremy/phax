Write the phax spec `plan-gate-profile`: a plan declares the gate profile that verifies its run, `phax plans lint`
checks it against `phax.json`, the approval covers it, and `phax run` runs that profile instead of the first one
`phax.json` lists.

## Why

The operator, 2026-11-25: "ça fait longtemps que c'est là". `phax run` takes the first key of `gateProfiles`
(`pickGateProfileId`, `src/cli/definitions/run.ts`). Nothing else chooses. So a project with two profiles can run
only one of them without editing `phax.json`:

- **The Effect 4 migration** needed its `effect-migration` profile (a ratchet on every phase, the full gate at the
  end). The operator listed it first in `phax.json` for the run (42bba779) and put `standard` back first afterwards
  (4dd5f822): two commits on main to run one plan, and every other run started in between would have taken the
  migration's gate.
- **The lane outside `src/`** of the 2026-11-23 waves (`NEXT_STEPS.md`: release pipeline, launcher, docs) is meant to
  run "with a light gate". `phax.json` has only `standard`, and a second profile would be unreachable anyway, so
  `launcher-release-fixes` (#262) ran the whole `pnpm test` on every phase.

Plans already say which profile they mean: every phase's `### Verification` names one ("The `standard` gate profile
in `phax.json`."). It is prose that nothing reads; a plan naming a profile `phax.json` does not have lints clean and
runs under another.

The direction is the operator's choice of 2026-11-25, over a `phax run --gate-profile` flag: what the gate verifies is
part of the contract the operator approves, so it belongs in the plan. A flag would leave it outside the approval,
chosen at launch, where it can be forgotten or mistyped and nothing refuses it.

## What phax has today, to read first

- The pick: `pickGateProfileId` in `src/cli/definitions/run.ts`; `src/cli/definitions/resume.ts` reads the profile
  the run recorded (`runStatus.gateProfileId`) and falls back to the first key; `recordGateProfileInRunStatus` in
  `src/app/executePlan.ts`.
- The profile's resolution and its workspace layer: `resolveGateProfile` in `src/app/gates.ts` (a workspace's
  `gateProfiles` entry under the same id), `src/app/loadConfig.ts`, the preflight in `src/app/runPreflight.ts`.
- `phax plans lint`: `src/app/lintPlan.ts` checks the plan's required commands against the first profile's steps,
  the same blind pick.
- The plan's shape: the Markdown read by the deterministic extractor, the extracted plan (`src/schemas/phaxPlan.ts`,
  `run.requiredCommands` is the closest run-level field), the plan document and its JSON sidecar
  (`src/schemas/planDocument.ts`, its `history/`), the planning skill (`phax-planning`, "Required commands
  declaration"; each phase's `Verification`).
- The approval's ground and staleness: `src/app/planStaleness.ts`, `src/app/approvalRecordStore.ts`. Whether a change
  to the declared profile's steps in `phax.json` makes the plan stale is a question below.
- Where the profile shows today: the review handoff (`src/app/reviewHandoff.ts`, "Gate Profile"), the publication
  (`src/app/publishRun.ts`), the records.
- `docs/briefs/phax-do.md`: `phax do` has no plan, so its caller names the profile the same way this plan field does
  (added to that brief on 2026-11-25).
- `docs/briefs/gate-tolerances.md`: another plan declaration a gate step consumes; keep the two declarations
  consistent in where they sit and how lint shows them.

## The direction (the operator's, 2026-11-25)

1. **The plan names its gate profile.** One run-level declaration in the plan, extracted like `requiredCommands`,
   kept in the plan document and its sidecar. `phax run` runs that profile; the first-key pick goes.
2. **Lint and preflight refuse what does not exist.** `phax plans lint` reports a profile `phax.json` (with its
   workspace layer) does not define as an error, and checks the required commands against the declared profile's
   steps. The run preflight refuses the same, before any phase starts.
3. **The approval covers it.** The declaration is part of the approved plan; changing it is a revision.
4. **Resume keeps the run's profile.** A run resumes under the profile it recorded at start, as today.
5. **Planning agents choose from what exists.** The planning prompt and the `phax-planning` skill list the project's
   profiles with their steps, and the plan names one of them; the per-phase `Verification` stops being the place
   where the profile is named.
6. **No back-compat shim.** The field is required in the new shapes (`AGENTS.md`); what an older plan document reads
   as is a question below, not an optional field.

## Questions for the spec's §9

- **Per run or per phase.** One profile for the whole run, or a phase may name its own (a docs phase under a light
  profile inside a code run). Per run is the smaller slice; `firing` (`every-phase`, `terminal`) already covers "light
  on each phase, full at the end" within one profile.
- **Where it sits in the Markdown.** A preamble line in the style of the phase fields (`**Gate profile:** standard`),
  or a `## Gate profile` section like `## Required commands`.
- **Older plan documents.** What an Approved plan written before the field (today `security-high-fixes`) reads as:
  the first profile, recorded as inferred, or a refusal that asks for a revision. Same for the extracted-plan cache
  and archived runs' records.
- **Staleness on the profile's steps.** Whether editing the declared profile in `phax.json` after approval makes the
  plan stale, or only removing or renaming it does.
- **A default.** Whether `phax.json` may name a default profile that a plan may omit, or every plan names one.
- **What the per-phase `Verification` says afterwards**: the profile's steps as the phase will see them (the phase
  prompt already lists them), free prose about extra checks, or nothing.
- **The records and the release notes**: whether the profile the run used is named there, and how `phax records
  explain` shows it.

## Out of scope

- New gate profiles for this repository (the light profile of the lane outside `src/`): the operator's, in
  `phax.json`, once a plan can choose it.
- Choosing the profile at `phax run` by a flag.
- Gate steps of their own per phase, and tolerances (`gate-tolerances`).
