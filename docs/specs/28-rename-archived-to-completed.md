---
status: Draft
date: 2026-08-12
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---
# Rename the `Archived` Terminal Status to `Completed`

## 1. Context

The artifact lifecycle (21, implemented) gives specs and plans two terminal statuses:
`Archived` — the artifact completed its purpose (a spec was consumed, a plan ran) — and
`Abandoned` — dropped without that completion. Both terminal transitions move the file
into the artifact's `archive/` directory, and validation enforces the invariant both ways
(terminal status ⇔ archive location). The CLI verbs are `phax artifact approve | stale |
reopen | abandon | archive`, each transition auto-committed (25).

Two approved-but-unimplemented documents restate this vocabulary: the frontmatter
migration (26) names the status sets, and the run-carries-archival spec (27, Draft) makes
run completion apply the plan's and spec's terminal transition on the run branch.

## 2. Problem

The terminal pair is asymmetric: `Abandoned` names an outcome; `Archived` names a filing
action. But the filing is not what the status distinguishes — *both* terminal statuses
file into `archive/`. The collision is visible today: an `Abandoned` spec sits in the
archives without being `Archived`. The location invariant already carries the "filed
away" fact, so the status name duplicates the folder and wastes the one word that should
carry the orthogonal fact — how the artifact's story ended. Every message built on it
("plan is Archived") states where the file went, not what happened.

## 3. Product goal

Terminal statuses name outcomes: `Completed` and `Abandoned`. Both continue to file into
`archive/` under the unchanged location invariant. The rename is a relabel of an existing
state — no state added or removed, no transition changed — applied with no back-compat:
`Archived` becomes an unknown status everywhere, and a one-time migration rewrites the
repository.

> A terminal status names how the artifact ended; where the file goes is the archive
> rule's job, not the status's name.

## 4. Terminology

- **`Completed`** — the new name of the ran-to-completion terminal status previously
  spelled `Archived`. For a spec: consumed into a plan and tests. For a plan: its run's
  work landed. Semantics identical to 21's `Archived`.
- **Archive location** — unchanged: the `archive/` subdirectory of the artifact's home
  directory. A place name, not a status; it holds both terminal outcomes.

## 5. Functional requirements

### 5.1 `Completed` replaces `Archived` in both state sets

The system SHALL accept exactly `Draft, Approved, Abandoned, Completed` for specs and
`Draft, Approved, Stale, Abandoned, Completed` for plans. IF an artifact carries the
status `Archived` THEN validation SHALL reject it naming the allowed set, exactly as for
any unknown status (no back-compat reading, no alias).

### 5.2 The state machine is unchanged

The system SHALL keep every legal transition of spec 21 with `Completed` substituted for
`Archived` (spec: `Approved → Completed`; plan: `Approved → Completed`,
`Stale → Completed`), `Completed` remaining terminal, and all refusal distinctions
(Draft / Stale / retired) intact.

### 5.3 The location invariant is unchanged

The system SHALL keep the terminal-status ⇔ archive-location invariant and the move into
`archive/` on terminal transitions, with `Completed` as a terminal status.

### 5.4 The CLI verb follows the outcome

WHEN the completion transition is requested through the CLI THE system SHALL expose it as
`complete`, replacing `archive`. IF `phax artifact archive` is invoked THEN the system
SHALL fail naming `complete` as the replacement (an error, not an accepted alias).

### 5.5 Migration induces no staleness

The system's one-time migration SHALL rewrite every artifact whose status reads
`Archived` — live and under `archive/` — to `Completed`, such that `phax plans` reports
no plan stale because of the rename itself.

## 6. Surface

Artifact status, before → after (value **normative**):

    Status: Archived        →        Status: Completed

CLI, before → after (verb spelling **normative** per §5.4):

    phax artifact archive docs/specs/21-artifact-lifecycle-status.md
    →
    phax artifact complete docs/specs/21-artifact-lifecycle-status.md

Old verb refusal (that it fails naming `complete` **normative**; wording **indicative**):

    ✗ unknown transition "archive" — the completion transition is: phax artifact complete <path>
    $? = 1

Unknown-status rejection now covers the old spelling (**indicative** wording):

    ✗ docs/specs/09-old.md: unknown status "Archived"
      (allowed for a spec: Draft, Approved, Abandoned, Completed)

Status inspection and transition commits pick up the name (**indicative**):

    Kind:              plan
    Status:            Approved
    Legal transitions: Approved, Stale, Abandoned, Completed

    chore(specs): complete 21-artifact-lifecycle-status

## 7. Non-goals

- **No state-machine change** — no state added or removed, no transition added or
  removed; this is a relabel.
- **No change to `Abandoned`** — its name already states an outcome.
- **No rename of the `archive/` directory** — it names a place, and accurately: it holds
  both terminal outcomes. (See §9.)
- **No alias or dual acceptance** — `Archived` is rejected, not tolerated; consistent
  with the repo's no-back-compat doctrine.
- **No semantic change to what completion means** — the definitions of 21 (spec consumed,
  plan ran) carry over verbatim under the new name.

## 8. Acceptance criteria

### The old spelling is an unknown status

Given a spec whose status reads `Archived`, when it is validated, then validation fails
naming the allowed set `Draft, Approved, Abandoned, Completed`. (refs §5.1)

### Transitions carry the new name

Given an Approved plan, when its status is inspected, then the legal transitions name
`Completed` (not `Archived`); and when the completion transition is applied, then the
plan's status reads `Completed` and the file lives under `docs/plans/archive/`.
(refs §5.2, §5.3)

### The retired refusal survives the rename

Given a plan with status `Completed`, when a run is started from it, then the run is
refused as retired, distinct from the Draft and Stale refusals. (refs §5.2)

### `complete` replaces `archive`

Given an Approved spec, when `phax artifact complete` runs on it, then the transition
applies with the usual transition commit; and when `phax artifact archive` is invoked,
then the command fails naming `complete`. (refs §5.4)

### The migration is staleness-neutral

Given the migrated repository, when `phax plans` runs, then no plan is reported stale
whose only change since approval is the `Archived → Completed` rewrite. (refs §5.5)

## 9. Open questions for implementation planning

Question: does the `archive/` directory rename too (e.g. `completed/` + `abandoned/`)?

- Keep `archive/` (recommended) — abandons: perfect vocabulary purity; a `Completed` file
  lives in a folder called `archive`.
- Rename/split directories — abandons: the single filing location and the simplicity of
  the location invariant; and splits history for 70+ already-archived files.

Recommendation: keep `archive/` — "archive" is an accurate place name for both outcomes;
the collision this spec removes was in the *status* name, not the folder.

Question: is the rename implemented standalone or riding the frontmatter migration (26)?

- Ride 26's rollout (recommended) — abandons: independence; this spec's implementation
  waits on 26's plan.
- Standalone first — abandons: the single metadata rewrite pass; every artifact gets
  touched twice, and 26's migration must then be re-checked against the new vocabulary.

Recommendation: ride — 26's migration already rewrites every artifact's metadata block
and recomputes fingerprints once; the rename is one more substitution in the same pass.

## 10. Implementation-planning note

Settled: the rename mapping (`Archived → Completed` in both state sets, §5.1), an
unchanged state machine and location invariant (§5.2–§5.3), the CLI verb `complete`
replacing `archive` with a refusal on the old verb (§5.4), and a staleness-neutral
one-time migration (§5.5). No alias anywhere: schemas, domain transition functions, and
messages accept exactly one spelling.

Interactions this spec amends or constrains:

- Spec 26 (approved): its §5.3/§6 name the old status sets; its implementation plan must
  use `Completed` — this spec supersedes the naming, and per the §9 default the two
  migrations ride together.
- Spec 27 (draft): references `Archived` and `phax artifact archive` throughout; sweep
  its terminology when this spec is approved, before 27 is planned.
- The `phax-spec` and `phax-planning` skills and CLI docs state the old vocabulary and
  must be updated in the same rollout.

Constraint: the rename is wholesale at the boundary — decode through the schema with the
new vocabulary only; no transitional dual-accept, per the no-back-compat rule.
