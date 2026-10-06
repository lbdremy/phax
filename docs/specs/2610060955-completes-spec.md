---
status: Approved
date: 2026-10-06
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
approved:
  date: 2026-10-06
  baseline: 58dc720
---
# A Plan Says Whether Its Run Completes Its Source Spec

## 1. Context

A plan names the spec it implements in its frontmatter:

    ---
    status: Approved
    source-spec: docs/specs/2609291000-widgets.md
    approved:
      date: 2026-10-01
      baseline: 1a2b3c4
    ---

Spec 27 put artifact completion on the run branch. When a run's final phase is green, phax completes the plan there. It then completes the plan's source spec too, unless the chain gate refuses: the gate keeps a spec live while another live plan under docs/plans/ names it, and reports the skip with the blocking plans. The merge then lands the work and the record in one gesture.

The approval fingerprint covers the plan's whole frontmatter except `status` and `approved`. A headless plan has a JSON sidecar, the plan document, which mirrors `sourceSpec`. phax forces that mirror to the `--spec` value of `phax artifact new plan`. `phax-plan.json`, the extracted plan, holds the run and its phases and no lineage.

Ground read:

- `src/app/completeRunArtifacts.ts` — Run completion: completes the plan, then rides the source spec along whenever the chain gate lets it, and reports a blocked spec as a skip.
- `src/app/artifactStatus.ts` — findDependentPlans and the chain gate: a spec cannot go terminal while a live plan under docs/plans/ (archive/ skipped) names it. checkPlanRunnable applies the same plan frontmatter decoder to loose plans.
- `src/domain/artifact/frontmatter.ts` — fingerprintSource drops only `status` and `approved` before hashing. Every other frontmatter key is fingerprinted.
- `src/domain/artifact/lineage.ts` — readSourceSpec reads `source-spec` from the plan's frontmatter. computeStaleness reports self-changed when the plan fingerprint moves.
- `src/domain/artifact/document.ts` — validateArtifact: name grammar, the frontmatter schema (unknown keys refused) and status/location agreement. The allowed-keys message lists `status, source-spec, approved`.
- `src/schemas/artifactFrontmatter.ts` — PlanFrontmatterSchema: status, source-spec (path or null), optional approved, decoded with excess properties refused.
- `src/schemas/planDocument.ts` — The plan document (headless sidecar) carries `sourceSpec` (path or null). Every field is required. It is a persisted format with a pre-schema history.
- `src/app/authorArtifact.ts` — Headless authoring overrides the session's `sourceSpec` with the `--spec` value and renders the frontmatter from planSkeleton.
- `src/app/createArtifact.ts` — planSkeleton writes `status: Draft` and `source-spec`.
- `src/domain/authoring/prompt.ts` — The authoring prompt tells the session the exact `sourceSpec` value to set.
- `src/app/lintPlan.ts` — plans lint validates a docs/plans/ plan as an artifact first. A failure is exit 12, not a finding.
- `src/cli/commands/run.ts` — renderArtifactCompletions: the run's completion lines and the `○ spec … kept` skip line.
- `src/domain/publish/body.ts` — The PR body is the run review handoff under a fixed header. Today the handoff says nothing about artifact completion.
- `docs/specs/archive/2608121241-run-carries-archival.md` — Spec 27: the run branch carries the plan's completion and the ride-along spec completion, so the merge lands work and record together.
- `.claude/skills/phax-planning/SKILL.md` — §Plan frontmatter block documents status, source-spec and approved.
- `README.md` — Artifact lifecycle: "A run completes its own plan, and its spec where it can, on the run's branch."
- `src/cli/cliDocs.ts` — `artifact new plan` long help describes the frontmatter-only skeleton (status, source-spec).
- `NEXT_STEPS.md` — §Small follow-ups records the defect and the decision of 2026-10-05. §Road to 1.0.0: the plan format and the CLI contract freeze before 1.0.
- `docs/plans/2606291247-smolvm-isolation-spike-plan.md` — The only live plan in this repository today. It has `source-spec: null`.

## 2. Problem

The chain gate is the only thing that stops a run from completing a spec, and it sees only plans that already exist. Some specs ship in several plans authored one at a time, each after the previous one lands; schemas-package's five plans were written this way. When such a run ends, no other live plan exists yet, so the first plan's run completes the spec. It moves the spec to archive/ and deletes its approval record while plans 2–5 are still to come.

This happened on schemas-package plan 1/5 (PR #104, 2026-09-29) and again on plans 2 and 3. Each time the completion commit had to be reverted by hand on the PR branch. Nothing persisted says how many plans a spec will have, so phax cannot tell the last plan from the first. Only the plan's author knows, and the plan has no way to say it.

## 3. Product goal

Every plan with a source spec states whether its run completes that spec. A run completes the spec only when its plan says so, and the chain gate still applies on top. A plan that does not complete its spec leaves it untouched, and the run's output and its review handoff (so its PR body) say so. The last plan of a multi-plan spec keeps spec 27's guarantee: the spec's completion lands in the same merge as that plan's work.

> A run completes a spec only when its plan says it is the last; phax never infers it.

## 4. Terminology

- **completes-spec** — The plan frontmatter key that says whether the plan's run completes its source spec. `true` or `false`. It is present exactly when `source-spec` names a spec.
- **completing plan** — A plan with `completes-spec: true`: the last plan of its spec, by its author's statement.
- **non-completing plan** — A plan with `completes-spec: false`: more plans of the same spec are to come.
- **chain gate** — Spec 22 §5.4, unchanged: a spec may go terminal only while no live plan declaring it as source is non-terminal.
- **live plan** — A plan file directly under docs/plans/, not under docs/plans/archive/.
- **spec outcome** — What run completion did to the source spec. One of three: completed; kept because live plans block it; kept because the plan does not complete it.

## 5. Functional requirements

### 5.1 The plan states whether it completes its spec

The system shall decide whether a plan's run completes its source spec only from the plan's `completes-spec` frontmatter key, a boolean carried beside `source-spec` by every plan whose `source-spec` names a spec.

### 5.2 A plan with a source spec must say it

IF a plan whose `source-spec` names a spec has no `completes-spec` key, or a value other than `true` or `false`, THEN artifact validation SHALL refuse the plan with exit code 12, naming `completes-spec`, in every command that validates a plan, including `phax plans lint`.

### 5.3 A spec-less plan carries no completes-spec

IF a plan whose `source-spec` is `null` carries a `completes-spec` key THEN artifact validation SHALL refuse the plan with exit code 12, naming `completes-spec` as inconsistent with `source-spec: null`.

### 5.4 A completing plan rides its spec along

WHEN a run completes a plan whose `completes-spec` is `true` THE system SHALL attempt the source spec's completion exactly as today: it completes the spec on the run branch when the chain gate is clear, and reports the skip naming the blocking plans when it is not.

### 5.5 A non-completing plan never touches its spec

WHEN a run completes a plan whose `completes-spec` is `false` THE system SHALL leave the source spec's status, location and approval record file unchanged and make no spec commit on the run branch.

### 5.6 Run output names the non-completing plan

WHEN a run completes a plan whose `completes-spec` is `false` THE system SHALL report in its run completion output that the source spec was kept because the plan does not complete it.

### 5.7 The review handoff states the spec outcome

WHERE the completed plan declares a source spec THE system SHALL state the spec outcome (completed, kept because live plans block it, or kept because the plan does not complete it) in the run's review handoff, and therefore in the PR body built from it.

### 5.8 The value is part of what was approved

WHEN the `completes-spec` value of an Approved plan changes after its approval THE system SHALL report the plan as `self-changed`.

### 5.9 Plan creation sets the value

WHEN `phax artifact new plan` is invoked with `--spec` and exactly one of `--last` or `--not-last` THE system SHALL write `completes-spec: true` or `completes-spec: false` respectively into the new plan's frontmatter, after `source-spec`.

### 5.10 Plan creation refuses an unstated or meaningless value

IF `phax artifact new plan` is given `--spec` with neither or both of `--last` and `--not-last`, or either flag without `--spec`, THEN the system SHALL refuse with exit code 12 before writing anything.

### 5.11 Headless authoring mirrors the CLI value

WHERE `phax artifact new plan` runs with `--headless` THE system SHALL set the plan document's `completesSpec` to the value the flags gave (`null` without `--spec`), whatever the session returned, and render the same value into the plan's frontmatter.

### 5.12 The plan document carries completesSpec per variant

IF a plan document lacks `completesSpec`, or carries a boolean `completesSpec` beside `sourceSpec: null`, or a `null` one beside a spec path, THEN the system SHALL refuse the document.

### 5.13 The planning skill teaches the key

The bundled phax-planning skill shall define `completes-spec` in its plan frontmatter section: its two values, its absence on a spec-less plan, and the rule that every plan of a spec except the last says `false`.

## 6. Surface

### file: plan frontmatter, plan with a source spec — normative

before:

    ---
    status: Approved
    source-spec: docs/specs/2609291000-widgets.md
    approved:
      date: 2026-10-01
      baseline: 1a2b3c4
    ---

after:

    ---
    status: Approved
    source-spec: docs/specs/2609291000-widgets.md
    completes-spec: false
    approved:
      date: 2026-10-01
      baseline: 1a2b3c4
    ---

    # key name `completes-spec`, values `true` | `false`, required: normative
    # placement right after `source-spec`: indicative (YAML key order carries no meaning)

### file: plan frontmatter, plan without a source spec — normative

before:

    ---
    status: Approved
    source-spec: null
    ---

after:

    ---
    status: Approved
    source-spec: null
    ---

    # unchanged; a `completes-spec` key here is refused

### cli: artifact validation refusal (plans lint, approve, run, …) — indicative

before:

    ✗ docs/plans/2610010900-widgets-plan.md has invalid frontmatter (allowed for a plan: status, source-spec, approved):
      …
    $? = 12

after:

    ✗ docs/plans/2610010900-widgets-plan.md has invalid frontmatter (allowed for a plan: status, source-spec, completes-spec (required with a source spec, absent without), approved):
      completes-spec is missing
    $? = 12

    # exit code 12 and naming `completes-spec`: normative; wording: indicative

### cli: phax artifact new plan — indicative

before:

    phax artifact new plan widgets --spec docs/specs/2609291000-widgets.md
    created docs/plans/2610010900-widgets-plan.md (Draft, source-spec docs/specs/2609291000-widgets.md)

after:

    phax artifact new plan widgets --spec docs/specs/2609291000-widgets.md --not-last
    created docs/plans/2610010900-widgets-plan.md (Draft, source-spec docs/specs/2609291000-widgets.md, completes-spec false)

    phax artifact new plan widgets --spec docs/specs/2609291000-widgets.md
    ✗ --spec needs --last (this plan is the spec's last) or --not-last (more plans follow)
    $? = 12

    phax artifact new plan catalog-refresh --last
    ✗ --last needs --spec: a plan without a source spec completes none
    $? = 12

    # a required pair of opposite flags and exit 12: normative; flag spelling and wording: indicative

### cli: run completion output (phax run, phax resume) — indicative

before:

    ✓ completed docs/plans/archive/2610010900-widgets-plan.md — 9c2d411 (on run branch)
    ✓ completed docs/specs/archive/2609291000-widgets.md — 1f04e22 (on run branch)

after:

    # completes-spec: false
    ✓ completed docs/plans/archive/2610010900-widgets-plan.md — 9c2d411 (on run branch)
    ○ spec docs/specs/2609291000-widgets.md kept: this plan does not complete it (completes-spec: false)

    # completes-spec: true, gate blocked (as today)
    ✓ completed docs/plans/archive/2610010900-widgets-plan.md — 9c2d411 (on run branch)
    ○ spec docs/specs/2609291000-widgets.md kept: non-terminal dependent plans remain
        docs/plans/2610020900-widgets-plan.md    Approved

    # completes-spec: true, gate clear: unchanged from today

### file: review-handoff.md and the PR body — indicative

    ## Source spec

    docs/specs/2609291000-widgets.md — kept: this plan does not complete it (completes-spec: false)

    # the other two outcomes:
    # docs/specs/archive/2609291000-widgets.md — completed on this branch (1f04e22)
    # docs/specs/2609291000-widgets.md — kept: live plans remain (docs/plans/2610020900-widgets-plan.md, Approved)

    # presence of the outcome for a plan with a source spec: normative; heading and wording: indicative

### file: plan document sidecar (docs/plans/<stamp>-<slug>-plan.json) and `phax artifact schema plan` — normative

before:

    {
      "$schema": "…/plan-document…",
      "kind": "plan",
      "sourceSpec": "docs/specs/2609291000-widgets.md",
      "run": { … },
      …
    }

after:

    {
      "$schema": "…/plan-document…",
      "kind": "plan",
      "sourceSpec": "docs/specs/2609291000-widgets.md",
      "completesSpec": false,
      "run": { … },
      …
    }

    # without a source spec: "sourceSpec": null, "completesSpec": null

## 7. Non-goals

- No change to the chain gate's rule. It still applies on top of `completes-spec: true`.
- No change to completing a spec by hand (`phax artifact complete`) or to plan completion.
- No cross-plan lint advisories: `plans lint` does not warn about two live plans that both say `true` for one spec, or about a spec whose live plans all say `false` (see §9).
- No inference of the last plan from anything phax can see: plan counts, slugs, order, or the spec's text.
- No migration of archived plans. Archived plans with a source spec predate the key and are not revalidated by any run or chain-gate flow. An artifact command pointed directly at one refuses it, as the no-shims rule accepts for any persisted-format change.
- No `completes-spec` in `phax-plan.json`: the extracted plan stays lineage-free.
- Out of scope: approval-ground, the per-file approval records (shipped in 0.19.0), and batching several plans per run (spec 24).

## 8. Acceptance criteria

### A plan that states its intent validates

Given a live made-up plan whose `source-spec` names an existing spec and whose frontmatter carries `completes-spec: true` (and, separately, `completes-spec: false`), when `phax plans lint <plan>` runs, then no artifact-validation refusal occurs and the value is read as given. (refs §5.1, §5.9)

### A plan with a source spec but no completes-spec is refused

Given a live plan whose `source-spec` names a spec and whose frontmatter has no `completes-spec`, when `phax plans lint <plan>` runs, and separately `phax artifact approve <plan>`, then each exits 12 naming `completes-spec`, and approve writes nothing. (refs §5.2)

### A non-boolean value is refused

Given a live plan with a source spec and `completes-spec: "yes"`, when `phax plans lint <plan>` runs, then it exits 12 naming `completes-spec`. (refs §5.2)

### A spec-less plan must not carry the key

Given a live plan with `source-spec: null` and `completes-spec: false`, when `phax plans lint <plan>` runs, then it exits 12 naming `completes-spec`; the same plan without the key validates. (refs §5.3)

### The completing plan completes its spec

Given an Approved spec whose only live plan is Approved with `completes-spec: true`, when the plan's run turns its final phase green, then the run branch carries the plan's and the spec's completion commits, the spec lives under docs/specs/archive/, and the output lists both completions as today. (refs §5.4)

### A completing plan still respects the chain gate

Given an Approved spec named by two Approved live plans, the running one with `completes-spec: true`, when the run completes, then the spec's status and location are unchanged on the run branch and the output reports the skip naming the other plan, as today. (refs §5.4)

### A non-completing plan leaves its spec live

Given an Approved spec whose only live plan is Approved with `completes-spec: false`, when the plan's run turns its final phase green, then the run branch carries the plan's completion commit only; the spec reads Approved under docs/specs/, its approval record file under docs/specs/approvals/ still exists, and the output contains a `kept` line saying the plan does not complete it. (refs §5.5, §5.6)

### The handoff and PR body name the spec outcome

Given three runs whose plans name a source spec, ending completed, kept because blocked, and kept because `completes-spec: false`, when each run opens review and `phax publish-pr` builds the PR body, then each review-handoff.md and PR body state that run's spec outcome with the spec path; a run of a spec-less plan states none. (refs §5.7)

### Flipping the value makes the plan stale

Given an Approved plan with `completes-spec: false` that `phax plans status` reports fresh, when the value is edited to `true` and `phax plans status` runs, then the plan is reported stale with reason `self-changed`. (refs §5.8)

### Plan creation writes the stated value

Given an existing spec docs/specs/2609291000-widgets.md, when `phax artifact new plan widgets --spec docs/specs/2609291000-widgets.md --not-last` runs (and separately with `--last`), then the created plan's frontmatter reads `completes-spec: false` (respectively `true`) after `source-spec`, and the confirmation line names the value. (refs §5.9)

### Plan creation refuses an unstated or meaningless value

Given an existing spec, when `phax artifact new plan widgets --spec <spec>` runs with neither flag, then with both, then `phax artifact new plan catalog-refresh --last` runs without `--spec`, then each exits 12 and no plan file is written. (refs §5.10)

### Headless authoring takes the value from the flags

Given `phax artifact new plan widgets --spec <spec> --not-last --headless --brief brief.md` against a stubbed session that returns `completesSpec: true`, when the session's document is accepted, then the committed sidecar carries `completesSpec: false` and the rendered plan's frontmatter reads `completes-spec: false`. (refs §5.11)

### The plan document enforces the variant

Given `phax artifact schema plan` and stubbed session documents, when a document omits `completesSpec`, or pairs `sourceSpec: null` with `completesSpec: true`, or a spec path with `completesSpec: null`, then the printed schema lists `completesSpec` as required, and each such document is refused with nothing written. (refs §5.12)

### The planning skill teaches the key

Given the bundled phax-planning SKILL.md, when its plan frontmatter section is read, then it defines `completes-spec` with values `true` and `false`, says it is absent when `source-spec` is `null`, and says every plan of a spec except the last carries `false`. (refs §5.13)

## 9. Open questions for implementation planning

### Q1 — How does a run know its plan is the last of its spec? Decided by the author on 2026-10-05; not reopened.

- A required plan field (`completes-spec: true|false`); the run completes the spec only when it is true, with the chain gate on top — abandons: zero-touch plan authoring: every plan with a spec must now state one more fact, and the format changes before the 1.0 freeze
- Never complete a spec at run end; leave it to `phax artifact complete` — abandons: the spec's completion landing in the same merge as the last plan's work, which spec 27 put there on purpose
- Infer the last plan from what phax can see — abandons: correctness: nothing persisted says how many plans a spec will have, so any inference repeats the defect

Recommendation: A required plan field (`completes-spec: true|false`); the run completes the spec only when it is true, with the chain gate on top — Decided 2026-10-05. Only the author knows whether more plans follow, so the plan must say it. A required field keeps spec 27's single merge for the last plan and costs one stated fact per plan.

### Q2 — Where does the value live, and how do the frontmatter, the plan document and phax-plan.json stay consistent? (Decided by the author on 2026-10-06; not reopened.)

- Frontmatter key `completes-spec` is the value phax reads; the plan document mirrors it as `completesSpec`, set from the CLI like `sourceSpec`; phax-plan.json does not carry it — abandons: a single copy: a hand edit of the frontmatter after authoring leaves the sidecar's mirror behind, exactly as `sourceSpec` can drift today
- Frontmatter only; the plan document is unchanged — abandons: the sidecar as the full authored lineage: its readers (schemas-package consumers, the cockpit) see `sourceSpec` but cannot tell whether the plan completes it
- A field of phax-plan.json — abandons: a deterministic read: the extracted plan is derived, cached and model-assisted, and holds phases rather than lineage, so the run's decision would rest on an extraction

Recommendation: Frontmatter key `completes-spec` is the value phax reads; the plan document mirrors it as `completesSpec`, set from the CLI like `sourceSpec`; phax-plan.json does not carry it — Decided by the author on 2026-10-06, as recommended. Lineage already lives in the frontmatter beside `source-spec`. The approval fingerprint covers it there, and run completion already reads that block. The mirror follows the established `sourceSpec` precedent, so the sidecar stays a complete description. Its drift risk is the same one `sourceSpec` has, and phax never reads the mirror to decide anything.

### Q3 — What does a plan with `source-spec: null` carry? (Decided by the author on 2026-10-06; not reopened.)

- No `completes-spec` key; its presence is refused (the plan document carries `completesSpec: null`, since every document key is required) — abandons: a uniform key set: the allowed frontmatter keys now depend on the `source-spec` variant, and the frontmatter and document spell "not applicable" differently (absent vs null)
- `completes-spec: false` required — abandons: meaning: `false` claims a decision about a spec that does not exist, and `true` beside `null` becomes a nonsense value that lint must police
- `completes-spec: null` required — abandons: economy: a key with no information that every spec-less plan, loose plan.md included, must still write

Recommendation: No `completes-spec` key; its presence is refused (the plan document carries `completesSpec: null`, since every document key is required) — Decided by the author on 2026-10-06, as recommended. Explicit per-variant shapes beat a permissive superset. The key exists exactly where it means something, and each variant has one legal form. The document uses null only because its own rule forbids missing keys.

### Q4 — How does `phax artifact new plan` set the value? (Decided by the author on 2026-10-06; not reopened.)

- With `--spec`, exactly one of `--last` / `--not-last` is required and authoritative in both interactive and headless modes; either flag without `--spec` is refused — abandons: a zero-decision `artifact new plan` for the common one-plan spec, plus every existing invocation and example gaining a flag
- Default `true` with `--spec`; `--not-last` opts out — abandons: protection where the defect arose: the author of plan 1/5 who forgets the flag gets today's behavior, caught only if someone reads the frontmatter at approval
- In headless mode the session decides from the brief — abandons: determinism: an agent guesses a lineage fact, and interactive creation still needs another rule

Recommendation: With `--spec`, exactly one of `--last` / `--not-last` is required and authoritative in both interactive and headless modes; either flag without `--spec` is refused — Decided by the author on 2026-10-06, as recommended, with shorter flag names: `--last` / `--not-last` (the frontmatter key stays `completes-spec`). The defect is a silent default. Forcing the statement at creation costs one flag, while a default reproduces the defect for anyone who does not think about it. Making the flags authoritative in headless mode mirrors how `--spec` governs `sourceSpec`.

### Q5 — Does `plans lint` warn about two live plans both saying `true` for one spec, or a spec whose live plans all say `false`? (Decided by the author on 2026-10-06; not reopened.)

- Neither; lint checks the plan it is given, as today — abandons: an early hint that a multi-plan spec's statements look odd
- Advisory warnings for both cases — abandons: signal honesty: all-`false` is the designed state while the last plan is unwritten (plans authored one at a time), and two `true` plans are handled harmlessly by the chain gate, so both warnings fire on legitimate paths and train warning-blindness
- Warn only on two live `true` plans — abandons: lint's single-plan scope: it must scan sibling plans for a case the chain gate already makes harmless

Recommendation: Neither; lint checks the plan it is given, as today — Decided by the author on 2026-10-06, as recommended. Neither situation is a defect. The chain gate already makes two `true` plans safe, and the run output and handoff show each non-completing plan's choice. Spec 27 rejected a warning on a designed path for the same reason.

### Q6 — How do live plans gain the field? (Decided by the author on 2026-10-06; not reopened.)

- By hand, in the implementing plan — abandons: a repeatable path for other repositories with live plans that name a spec
- A one-time migration command — abandons: scope: a new command, and the decision it cannot make (whether each plan is its spec's last) still falls to a human

Recommendation: By hand, in the implementing plan — Decided by the author on 2026-10-06, as recommended. Nobody else runs multi-plan specs, and the value is a judgement no command can supply. The only live plan here today has `source-spec: null` and needs nothing under q-specless. Any plan with a spec that goes live before the implementing run lands gains the key by hand. If it is Approved, it is re-approved, since the key is fingerprinted.

## 10. Implementation-planning note

Settled:

- The value lives in the plan frontmatter as `completes-spec` (`true` | `false`). It is present exactly when `source-spec` names a spec and refused beside `source-spec: null`. This applies to every plan the frontmatter decoder reads, loose plan.md included.
- Run completion reads `completes-spec` from the pre-transition plan Markdown, as it reads `source-spec` today. `true` keeps today's ride-along unchanged. `false` makes no spec transition and reports the spec as kept.
- The run completion report distinguishes the two kept reasons as named variants: blocked by live plans (with the blocking plans), and not completed by this plan.
- `completes-spec` is fingerprinted: `fingerprintSource` keeps dropping only `status` and `approved`. Changing it on an Approved plan makes it `self-changed`. This is intended, because the value changes what the run does to the repository and so is part of what was approved.
- The plan document gains a required `completesSpec` (boolean beside a spec path, null beside `sourceSpec: null`). phax sets it from the CLI flags whatever the session returned, and the authoring prompt states the value as it states `sourceSpec`.
- `plans lint` refuses through artifact validation (exit 12), not through a finding. No cross-plan advisories.
- Live plans are migrated by hand. Today no live plan here needs a change.

Left open:

- Exact flag spelling for `phax artifact new plan` (the required opposite pair is settled), and the wording of the refusal, kept and handoff lines.
- How the plan-document shape change is recorded in the schemas package's format history (release stamp, the step for sidecars written before the key). Follow the package's procedure; no live sidecar exists in this repository.
- Where in review-handoff.md the spec outcome sits.

Constraints:

- No change to the chain gate's rule, to `phax artifact complete`, or to plan completion.
- No back-compat: the key is required where it applies; no default is inferred for a plan that lacks it.
- Tests use made-up plans and specs, never this repository's own.
- This changes the plan format and the `artifact new plan` CLI contract, so it lands before the 1.0 freeze (NEXT_STEPS §Road to 1.0.0). Update phax.usage.kdl and the completion/spec-lint gates that read it.
- Docs: the phax-planning skill's §Plan frontmatter block; the README lifecycle sentence "A run completes its own plan, and its spec where it can"; the `artifact new plan` long help (skeleton keys and the flags); close the NEXT_STEPS follow-up and drop the artifact-decide note about reverting the run's spec completion by hand.

## 11. Docs page

Page: README.md — the artifact lifecycle section, at the sentence on run completion

Reader: an operator splitting one spec across several plans, who needs the spec to stay live until the last plan's run

Example: phax artifact new plan widgets --spec docs/specs/2609291000-widgets.md --not-last   # plan 1 of 3
phax artifact new plan widgets --spec docs/specs/2609291000-widgets.md --last      # plan 3 of 3

# plan 1's frontmatter:
---
status: Draft
source-spec: docs/specs/2609291000-widgets.md
completes-spec: false
---
