---
status: Completed
date: 2026-11-25
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
approved:
  date: 2026-11-25
  baseline: ac1abb6
---
# The plan names its gate profile

## 1. Context

phax.json holds a map of gate profiles, `gateProfiles`. Each profile is a list of steps, and each step has a command, a surface and a firing (`every-phase` or `terminal`). A workspace may hold its own profile under the same id, and that profile replaces the top-level one for the workspace.

Nothing chooses among the profiles. `phax run` takes the first key of `gateProfiles` and records it in the run status as `gateProfileId`. The function's own comment says a project defines a single profile. `phax run --dry-run` and `phax plans lint` take the same first key: lint checks the plan's required commands against that profile's steps. `phax resume` reads the profile the run recorded, and falls back to the first key when the run recorded none. The review handoff and the pull request body print the recorded profile as "Gate Profile".

Plans already say which profile they mean, but only in prose. The phax-planning skill tells every phase's `### Verification` to name the profile, and plans do ("The `standard` gate profile in `phax.json`."). No part of phax reads that line. The plan's only run-level declaration that phax reads is `## Required commands`, a preamble section that is extracted into `run.requiredCommands` and kept in the plan document's `run` fields.

A plan is approved against its content. A plan edited after approval is reported as edited since its approval and must be re-approved before it runs.

Ground read:

- `src/cli/definitions/run.ts` — pickGateProfileId returns the first key of gateProfiles; its comment says a project defines a single profile and multi-profile disambiguation is out of scope. phax run refuses with exit 2 only when no profile is configured.
- `src/cli/definitions/resume.ts` — Resume uses runStatus.gateProfileId and falls back to the first key of gateProfiles when the run recorded none.
- `src/app/executePlan.ts` — recordGateProfileInRunStatus writes the chosen profile id into run-status.json at run start.
- `src/app/gates.ts` — resolveGateProfile: a workspace's gateProfiles entry under the same id wins when non-empty; otherwise the top-level entry; a missing or empty profile throws.
- `src/app/runPreflight.ts` — The preflight resolves the gate steps from the given profile id and turns a resolution failure into a refusal.
- `src/app/lintPlan.ts` — The commands check takes Object.keys(config.raw.gateProfiles)[0], the same blind pick, and checks run.requiredCommands against that profile's step commands.
- `src/app/dryRun.ts` — The dry run falls back to the first key too and prints '  Gate profile: <id>'.
- `src/schemas/planDocument.ts` — The plan document's run fields are { shortName, title, requiredCommands }; each phase has a required verification string; projectExtractedPlan copies the run fields into the extracted plan.
- `src/schemas/phaxConfig.ts` — gateProfiles is a required record at the top level of phax.json and optional per workspace.
- `src/domain/plan/lintRender.ts` — Lint report format: '<plan>: N errors, M warnings', then one line per finding: severity, check, phase or '-', message.
- `src/app/reviewHandoff.ts` — The review handoff prints '- **Gate Profile**: <id>' from the run's recorded profile; the PR body (src/domain/publish/prBody.ts) does the same.
- `src/app/planStaleness.ts` — Approval staleness compares the plan's fingerprint and the files changed since the approval baseline within the plan's footprint; phax.json is not part of it unless a phase plans it.
- `.claude/skills/phax-planning/SKILL.md` — Verification is documented as '(names the phax.json gate profile)'; the template says '<the phax.json gate profile that verifies this phase — do not invent commands>'. Required commands is a run-level '## Required commands' section before the first phase.
- `phax.json` — This repository defines one profile, 'standard', with every-phase and terminal steps.
- `docs/plans/2611241432-security-high-fixes-plan.md` — An Approved plan with no profile declaration; each phase's Verification reads 'The `standard` gate profile in `phax.json`.'
- `docs/briefs/phax-do.md` — phax do's caller names the profile with --gate <profile>, as a plan declares its own; the default for a nameless call depends on what this spec settles.
- `docs/briefs/gate-tolerances.md` — A per-phase plan declaration a gate step consumes; phax plans lint shows which phases carry one.

## 2. Problem

A project that defines two gate profiles can run only the first one unless it edits phax.json.

- The Effect 4 migration needed its `effect-migration` profile: a ratchet on every phase and the full gate at the end. The operator moved that profile to the top of phax.json for the run (42bba779) and moved `standard` back afterwards (4dd5f822). That took two commits on main to run one plan, and any other run started in between would have been gated by the migration's profile.
- The 2026-11-23 lane outside `src/` (release pipeline, launcher, docs) is meant to run under a light gate. A second profile could not be reached, so `launcher-release-fixes` (#262) ran the whole `pnpm test` on every phase.

The prose line in Verification makes this worse. A plan can name a profile phax.json does not define, lint clean, and then run under a different profile without any message. The profile is part of what a run must prove, but the operator never approves it: the approval covers a sentence that phax ignores.

## 3. Product goal

A plan declares, in one run-level field that phax reads, which of the project's gate profiles verifies its run. `phax plans lint` and the run preflight refuse a declaration phax.json cannot satisfy. The declaration is part of the approved plan, so changing it is a revision. `phax run` gates every phase with that profile, and `phax resume` keeps the profile the run started with. Planning agents choose the profile from the profiles that exist, because they can see them. Picking the first profile in phax.json goes away.

> The profile that gates a run is the one the operator approved in its plan, never the one phax.json happens to list first.

## 4. Terminology

- **gate profile** — A named list of gate steps under `gateProfiles` in phax.json. A workspace's entry under the same id replaces the top-level list for that workspace.
- **defined profile** — A profile id that phax.json's gate-profile resolution turns into at least one step: a non-empty top-level `gateProfiles` entry, or a non-empty entry in the run's workspace layer. `phax plans lint` and the run preflight use the same resolution.
- **declared profile** — The single gate profile id that a plan declares for its whole run. It is extracted from the plan's Markdown and held in the plan document's run fields.
- **recorded profile** — The profile id written into the run status when `phax run` starts a run. Every later step of that run reads this id.
- **first-key pick** — Today's behavior: taking the first key of `gateProfiles` as the run's profile. This spec removes it.

## 5. Functional requirements

### 5.1 One declared profile per plan

The system shall require every plan to declare exactly one gate profile, by its id, for its whole run.

### 5.2 Extraction carries the declaration

WHEN the system extracts a plan THE system SHALL carry the plan's declared gate profile into the extracted plan's run fields.

### 5.3 The plan document holds the declaration

The plan document and its JSON sidecar shall hold the declared gate profile as a required run field, and the plan's Markdown shall render it as the plan's gate-profile declaration.

### 5.4 A missing or doubled declaration is refused

IF a plan declares no gate profile, or declares more than one, THEN the system SHALL refuse to extract it, and the refusal SHALL say whether the declaration is missing or doubled.

### 5.5 Lint refuses an undefined profile

IF a plan declares a gate profile that phax.json does not define THEN `phax plans lint` SHALL report an error that names the declared profile and every profile phax.json defines.

### 5.6 Lint checks commands against the declared profile

WHEN `phax plans lint` checks a plan's required commands THE system SHALL check them against the steps of the plan's declared profile and against no other profile.

### 5.7 The run is gated by the declared profile

WHEN `phax run` starts a plan THE system SHALL gate every phase with the steps of the plan's declared profile and record that id as the run's gate profile, whatever position the profile has in phax.json.

### 5.8 The dry run names the declared profile

WHEN `phax run --dry-run` reports a plan THE system SHALL name the plan's declared profile as the run's gate profile.

### 5.9 The run refuses an undefined profile before any phase

IF a plan given to `phax run` declares a gate profile that phax.json does not define THEN the system SHALL refuse the run before it creates any worktree, naming the declared profile and every profile phax.json defines.

### 5.10 Resume keeps the recorded profile

WHEN `phax resume` continues a run THE system SHALL gate the remaining phases with the run's recorded profile, even if the plan now declares a different one or phax.json lists another profile first.

### 5.11 Resume refuses a recorded profile that is gone

IF a run's recorded profile is no longer defined in phax.json THEN `phax resume` SHALL refuse before it gates any phase, naming the recorded profile.

### 5.12 Changing the declaration is a revision

IF the declared gate profile of an approved plan is changed THEN the system SHALL report the plan as edited since its approval, and `phax run` SHALL refuse it until it is approved again.

### 5.13 Planning sessions see the profiles

WHEN the system spawns a session that authors or revises a plan THE system SHALL list in that session's prompt every gate profile phax.json defines, giving each step's command and firing.

### 5.14 The planning skill names the profile once

The phax-planning skill shall instruct a plan to name its gate profile only in the run-level declaration, and shall not direct a phase's Verification to name it.

## 6. Surface

### file: plan.md — the gate-profile declaration — indicative

Summary: A plan states which of the project's gate profiles verifies its run in one section that phax reads, and phase Verification no longer names the profile.

before:

    ## Required commands

    - `pnpm test:unit`
    - `git log`

    ...

    ### Verification

    The `standard` gate profile in `phax.json`.

after:

    ## Gate profile

    `light`

    ## Required commands

    - `pnpm test:unit`
    - `git log`

    ...

    ### Verification

    The real-git test proves the hook left no marker file.

### file: plan sidecar and phax-plan.json — run.gateProfile — normative

Summary: The plan's JSON sidecar and its extracted plan carry the declared gate profile as a required run field.

before:

    "run": {
      "shortName": "docs-lane",
      "title": "Docs lane",
      "requiredCommands": ["pnpm test:unit"]
    }

after:

    "run": {
      "shortName": "docs-lane",
      "title": "Docs lane",
      "requiredCommands": ["pnpm test:unit"],
      "gateProfile": "light"
    }

### cli: phax plans lint — indicative

Summary: Running `phax plans lint` reports an error when a plan declares no gate profile, or one that phax.json does not define, and checks required commands against the declared profile.

before:

    $ phax plans lint docs/plans/2611251200-docs-lane-plan.md
    docs/plans/2611251200-docs-lane-plan.md: no findings

after:

    $ phax plans lint docs/plans/2611251200-docs-lane-plan.md
    docs/plans/2611251200-docs-lane-plan.md: 1 error, 0 warnings
    error    gate-profile  -  gate profile "light" is not defined in phax.json (defined: standard)
    $? = 1

    $ phax plans lint docs/plans/2611251300-untagged-plan.md
    docs/plans/2611251300-untagged-plan.md: 1 error, 0 warnings
    error    structure     -  the plan declares no gate profile (## Gate profile)
    $? = 1

### cli: phax run — indicative

Summary: Running `phax run` gates the run with the profile its plan declares, and refuses before any worktree exists when phax.json does not define that profile.

before:

    $ phax run --plan docs/plans/2611251200-docs-lane-plan.md
    (every phase gated by "standard", the first profile phax.json lists)

    $ phax run --plan docs/plans/2611251200-docs-lane-plan.md --dry-run
      Gate profile: standard

after:

    $ phax run --plan docs/plans/2611251200-docs-lane-plan.md --dry-run
      Gate profile: light

    $ phax run --plan docs/plans/2611251200-docs-lane-plan.md
    ✗ gate profile "light" is not defined in phax.json (defined: standard)
      the plan declares it under ## Gate profile; no worktree was created
    $? = 2

### internal: plan authoring and revision prompt — indicative

Summary: A planning agent sees every gate profile the project defines, with its steps, and picks one of them for the plan.

    Gate profiles defined in phax.json. Declare exactly one under `## Gate profile`:

    standard
      every-phase  pnpm format
      every-phase  pnpm typecheck
      every-phase  pnpm test
      terminal     pnpm build
    light
      every-phase  pnpm format:check
      terminal     pnpm site:build

### internal: phax-planning skill — indicative

Summary: A planning agent learns to name the gate profile once, in the run-level declaration, and stops repeating it in each phase's Verification.

before:

    | Verification | `### Verification` (names the `phax.json` gate profile) | no |

    ### Verification

    <the phax.json gate profile that verifies this phase — do not invent commands>

after:

    ## Gate profile declaration

    Every plan declares, before its first phase, the one gate profile that verifies the whole run:

    ## Gate profile

    `standard`

    ### Verification

    <what proves this phase beyond the declared gate profile — never the profile's name>

## 7. Non-goals

- New gate profiles for this repository, such as the light profile for the lane outside `src/`. Adding them in phax.json is the operator's job, once a plan can choose one.
- Choosing the profile when `phax run` is launched, by a `--gate-profile` flag or any other launch-time input.
- Gate steps of a phase's own, and gate tolerances (`gate-tolerances`).
- A different gate profile per phase within one run, unless the operator decides otherwise in q-scope.
- `phax do`'s `--gate <profile>`. That belongs to the `phax-do` brief, which follows what this spec settles for plans.
- Changes to how a profile resolves (the workspace layer), or to what a gate step is (surface, firing, partial commands).
- Editing archived runs' records or past release notes.

## 8. Acceptance criteria

### A plan runs the second profile

Given phax.json defines `standard` first and `light` second, and `standard` holds a step that always fails. An approved plan declares `light`, when `phax run --plan <plan>` runs, then each phase's gate runs only `light`'s steps, the run status records `gateProfileId` as `light`, and the review handoff's Gate Profile line reads `light`. (refs §5.1, §5.7)

### Extraction carries the declared profile

Given a plan.md whose gate-profile declaration holds `light`, when phax extracts it, then the extracted plan's `run.gateProfile` is `light`. (refs §5.2)

### The sidecar requires run.gateProfile

Given a plan document whose `run.gateProfile` is `light`, and a copy of it without `run.gateProfile`, when phax renders the first and decodes the second, then the rendered plan.md declares `light` and extracts back to `run.gateProfile: "light"`, and decoding the second is refused with a message naming `run.gateProfile`. (refs §5.3)

### A plan without a declaration is refused

Given one plan.md with no gate-profile declaration and another that declares two, when `phax plans lint` and `phax run --plan` run on each, then lint reports an error saying the declaration is missing in the first and doubled in the second, both lints exit non-zero, and `phax run` refuses each plan without creating a worktree. (refs §5.4)

### Lint names an undefined profile

Given phax.json defines only `standard`, and a plan declares `light`, when `phax plans lint <plan>` runs, then it reports one error naming `light` and listing `standard` as defined, and exits non-zero. (refs §5.5)

### Lint checks commands against the declared profile

Given phax.json's `standard` profile has a `pnpm test` step and its `light` profile does not, `pnpm test` is not in `security.agentCommands`, and a plan lists `pnpm test` under its required commands, when `phax plans lint` runs once with the plan declaring `light` and once with it declaring `standard`, then the first lint reports `pnpm test` as not covered and the second reports no command finding. (refs §5.6)

### The dry run names the declared profile

Given phax.json lists `standard` first, and a plan declares `light`, when `phax run --plan <plan> --dry-run` runs, then its report reads `Gate profile: light`. (refs §5.8)

### The run refuses an undefined profile before any phase

Given phax.json defines only `standard`, and an approved plan declares `light`, when `phax run --plan <plan>` runs, then it exits non-zero with a message naming `light` and `standard`, and no worktree, run branch or phase folder is created. (refs §5.9)

### Resume keeps the recorded profile

Given a run that started under `light` and stopped at phase-02, after which phax.json was reordered so that `standard` comes first, when `phax resume` continues the run, then phase-02's gate runs `light`'s steps. (refs §5.10)

### Resume refuses a profile that is gone

Given a run that started under `light` and stopped at phase-02, after which `light` was removed from phax.json, when `phax resume` continues the run, then it exits non-zero with a message naming `light`, and phase-02's gate does not run. (refs §5.11)

### Changing the declaration needs re-approval

Given an approved plan that declares `standard`, when its declaration is edited to `light` and `phax artifact status <plan>` and then `phax run --plan <plan>` run, then status reports the plan as edited since its approval, `phax run` refuses it, and after `phax artifact approve <plan>` the run starts under `light`. (refs §5.12)

### The planning prompt lists the profiles

Given phax.json defines `standard` and `light`, each with its steps, when phax spawns a headless session to author or revise a plan, then the session's prompt lists both ids, and under each one every step's command and firing. (refs §5.13)

### The skill names the profile once

Given the phax-planning skill as shipped, when its plan format and phase template are read, then it documents the run-level gate-profile declaration, and its Verification guidance and template no longer tell a phase to name the gate profile. (refs §5.14)

## 9. Open questions

None.

## 9b. Arbitrated questions

### q-scope — Does a run have one gate profile, or may a phase declare its own?

- per-run — One profile for the whole run, declared once in the plan — abandons: A light phase inside a code run, such as a docs phase under a docs profile. That needs a separate plan, or a profile whose `firing` already makes it light on each phase and full at the end.
- per-phase — A run-level profile that a phase may override with its own — abandons: A single answer to 'what verified this run'. The handoff, the PR, the records and resume all need a profile per phase, and a terminal step no longer has one obvious profile to belong to.

Recommendation: per-run — Both cases that motivate this spec, the Effect migration and the lane outside `src/`, are whole plans under one profile. `firing` already covers 'light on each phase, full at the end' within one profile. A per-phase override can be added later as a field of its own without changing the run-level declaration.

Decision: per-run — by operator (Rémy Loubradou), 2026-11-25
Why: Both motivating cases are whole plans under one profile; firing covers light-then-full. Advocate: A per-phase override would let a docs phase run under a light profile inside a code run, without splitting the work into two plans. Principles: S1, S5. Reversibility: cheap. Revised: none.

### q-markdown — Where does the declaration sit in the plan's Markdown?

- section — A `## Gate profile` preamble section holding the id, like `## Required commands` — abandons: Compactness: a whole section holds a one-word value.
- bold-line — A preamble line in the style of the phase fields: `**Gate profile:** standard` — abandons: One style for run-level declarations. The plan's only other run-level declaration is a section, and the bold-line style today means a per-phase header field, so a reader would take a run-level value for a phase's.

Recommendation: section — It sits beside `## Required commands`, the run-level declaration that lint already checks against the profile. The extractor already reads preamble sections, and gate tolerances' per-phase entries stay distinct from it.

Decision: section — by operator (Rémy Loubradou), 2026-11-25
Why: Beside ## Required commands; the bold-line style stays the phase fields'. Advocate: A single bold line is far more compact than a whole section for a one-word value, and matches the style of the phase header fields. Principles: S1. Reversibility: cheap. Revised: none.

### q-legacy — How does phax read a plan document, extracted-plan cache or run written before the field existed? This includes the Approved `security-high-fixes` plan.

- refuse — Refuse: lint and run report the missing declaration, the plan is revised to declare one and approved again, an old cache is re-extracted, and resuming a run that recorded no profile is refused — abandons: Running `security-high-fixes` as approved. It must be revised and approved again before it runs, and any in-flight run that recorded no profile cannot be resumed.
- infer-first — Read a missing declaration as the first profile, and record it as inferred — abandons: The guarantee that every run's profile was approved. The first-key pick survives as a shim, which AGENTS.md forbids.
- upgrade — `phax schema upgrade` writes the first profile into old sidecars and plans — abandons: The approval: the upgrade edits approved plans, so they need re-approval anyway, and the profile the upgrade wrote was never chosen.

Recommendation: refuse — Only one Approved plan is waiting, and naming `standard` in it is a one-line revision. Runs have recorded their profile at start for many releases, so a run without one is pre-history. Archived records are read-only and never resumed.

Decision: refuse — by operator (Rémy Loubradou), 2026-11-25
Why: No shim. A run started before the release that adds the field is not resumed under it: if its kept phax-plan.json fails to decode for the missing field, the refusal says so and names the remedy (finish it with the release that started it, or reset). The run's recorded gateProfileId stays what resume uses. Advocate: Inferring the first profile would let the approved security-high-fixes plan and any in-flight run continue without a revision or a re-approval. Principles: S1, S3, S2. Reversibility: costly. Revised: none.

### q-staleness — Does editing the declared profile's steps in phax.json after approval make the plan stale?

- removal-only — No. Only removing or renaming the profile matters, and lint and the preflight already refuse that as undefined — abandons: A pinned gate: after approval, the project can loosen or tighten the steps the plan was approved against, and nothing flags it.
- steps-pinned — Yes. The approval records the profile's resolved steps, and any change makes the plan stale — abandons: Shared profiles: every edit to `standard`, such as a new lint step, makes every approved but unrun plan that names it stale and forces re-approvals that have nothing to do with those plans.

Recommendation: removal-only — A profile is the project's, and the plan approves a choice among profiles, not their contents. What a run actually ran stays visible in its gate logs. Pinning steps would turn routine gate maintenance into an approval cascade.

Decision: removal-only — by operator (Rémy Loubradou), 2026-11-25
Why: The plan approves a choice among profiles, not their contents. Advocate: Pinning the resolved steps would mean the gate an operator approved is the gate that runs; loosening it after approval would be flagged instead of silent. Principles: S1, S4. Reversibility: costly. Revised: none.

### q-default — May phax.json name a default profile that lets a plan omit the declaration?

- always-declare — Every plan declares a profile; phax.json has no default — abandons: Brevity in single-profile projects: every plan carries a line that can say only one thing.
- config-default — A `defaultGateProfile` key in phax.json lets a plan omit its declaration — abandons: The plan stating what verifies it. The approval would cover a reference to whatever the default is at run time, which is the first-key pick moved into a key.

Recommendation: always-declare — The guiding rule is that the approved plan names the profile. One line per plan is cheap, and planning agents write it from the profile list in their prompt. The `phax do` brief can choose its own default for calls that have no plan.

Decision: always-declare — by operator (Rémy Loubradou), 2026-11-25
Why: phax do may choose its own default. Advocate: A default key would spare single-profile projects a line in every plan that can only name the one profile they have. Principles: S1, S3, E0. Reversibility: cheap. Revised: none.

### q-verification — What does a phase's `### Verification` say once the profile is declared at run level?

- extra-checks — Prose about what proves the phase beyond the gate, never the profile's name — abandons: Seeing the profile from inside a phase: a reader of one phase must look at the preamble to find it.
- steps-listed — The declared profile's steps as the phase will see them, rendered by phax — abandons: A plan that does not duplicate phax.json: the rendered steps go stale whenever the profile changes, which q-staleness allows.
- drop — Remove the Verification section from the phase — abandons: A place to state what proves a phase beyond the shared gate, such as a marker-file test or a manual check.

Recommendation: extra-checks — The phase prompt already lists the gate steps the agent will face, so writing them in the plan adds nothing. A single source for the profile removes the drift this spec exists to fix, and the section keeps the one thing a plan alone can say.

Decision: extra-checks — by operator (Rémy Loubradou), 2026-11-25
Why: The phase prompt already lists the gate steps. Advocate: Rendering the profile's steps in each phase would let a reader of one phase see exactly what will gate it without looking at the preamble. Principles: S1, S4. Reversibility: cheap. Revised: none.

### q-records — Do the run's records and the release notes name the profile the run used?

- records-only — The run's record names its gate profile, and `phax records explain` shows it; release notes do not — abandons: A release-note reader learning which gate verified a change; for that they need the PR, which already names it.
- records-and-notes — Name it in the records and in each release-note entry — abandons: Release notes that speak only about consumer-visible surface: they gain a process detail a user does not act on.
- unchanged — No change: the handoff and the PR already name it — abandons: An answer from the records: someone who audits a past run from the records repository cannot see which gate verified it.

Recommendation: records-only — The records are the durable audit trail of a run, so the gate that judged it belongs there. Release notes are written for users of phax, for whom the profile is noise.

Decision: records-only — by operator (Rémy Loubradou), 2026-11-25
Why: The PR already names the profile. Advocate: Naming the profile in each release-note entry would tell a reader which gate verified a change without opening the PR or the records. Principles: S1, S10. Reversibility: cheap. Revised: none.

## 10. Implementation-planning note

Settled:

- The operator's 2026-11-25 direction: the plan names the profile, not a `phax run` flag. Lint and the preflight refuse an undefined profile. The approval covers the declaration. Resume keeps the recorded profile. Planning agents choose from the profiles that exist. There is no back-compat shim.
- The first-key pick is removed from `phax run`, `phax run --dry-run` and `phax plans lint`. No path chooses a profile by its position in phax.json.
- The field is `run.gateProfile` in the plan document, its sidecar and the extracted plan. It is required in the new shapes, and the plan-document and extracted-plan schema versions bump with it.
- The run status keeps recording the profile as `gateProfileId`. The review handoff and the PR body keep printing the recorded profile, which is now the declared one.

Left open:

- Every question in §9. The surface sketches assume the recommended defaults: a `## Gate profile` section, one profile per run, prose-only Verification.
- Whether `phax artifact approve` and the headless authoring decoder also refuse an undefined profile, or leave that to lint and the preflight.
- The lint check's name for the undefined-profile finding (`gate-profile` or the existing `commands`), and the exact refusal wording and exit code of `phax run`.

Constraints:

- Lint and the preflight decide whether a profile is defined with the same resolution the run uses: the top-level `gateProfiles` entry and the run's workspace layer, both non-empty.
- The undefined-profile refusal of `phax run` comes before any worktree, branch or phase folder is created.
- Keep this declaration consistent with gate tolerances' plan declaration in where it sits and in how `phax plans lint` reports it.
- Changing the plan's Markdown or document shape updates the phax-planning skill, the headless plan-authoring prompt and the deterministic extractor together.
- The Approved `security-high-fixes` plan is handled as q-legacy decides, and that handling is named in the handoff.

## 11. Docs page

Page: docs/gate-profiles.md

Reader: An operator whose project defines more than one gate profile and who wants a plan to run under a profile other than the first one in phax.json.

Example: phax.json defines `standard` and `light`. A docs plan declares `## Gate profile` with `light`. `phax plans lint` passes, `phax run --plan <plan> --dry-run` shows `Gate profile: light`, and the run gates every phase with `light`'s steps. Renaming `light` in phax.json then makes both lint and `phax run` refuse the plan, naming `light` and the profiles that remain.

## 12. Decision log

- 2026-11-25 q-scope decided per-run — operator (Rémy Loubradou)
- 2026-11-25 q-markdown decided section — operator (Rémy Loubradou)
- 2026-11-25 q-legacy decided refuse — operator (Rémy Loubradou)
- 2026-11-25 q-staleness decided removal-only — operator (Rémy Loubradou)
- 2026-11-25 q-default decided always-declare — operator (Rémy Loubradou)
- 2026-11-25 q-verification decided extra-checks — operator (Rémy Loubradou)
- 2026-11-25 q-records decided records-only — operator (Rémy Loubradou)
