---
status: Approved
date: 2026-09-03
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---

# Spec Approval with a Recorded Ground

## 1. Context

Specs and plans both carry an enforced lifecycle status (spec 21) in a YAML frontmatter
block with an exact per-kind key set (spec 26): specs carry `status`, `date`, `audience`,
`scope`; plans carry `status`, `source-spec`, and, once approved, `approved`.

Plan approval records its ground (spec 22). `phax artifact approve` on a plan stamps
`approved: { date, baseline }` in the frontmatter and writes a record to
`docs/plans/approvals.json` holding the plan's content fingerprint, the declared source
spec's path and content fingerprint, the full baseline commit and the timestamp.
`Approved → Approved` is legal for plans and re-records the approval. Content fingerprints
exclude the `status` and `approved` keys, so stamping never disturbs the fingerprint it
records. `phax plans status` reads the record back and reports `spec-changed`,
`ground-changed` or `self-changed`.

Spec approval records nothing. `phax artifact approve` on a spec rewrites `status` and
commits; the spec transition table allows `Approved → Abandoned | Completed` only, so a
second approve exits 12 as an illegal transition. A spec has no `approved` key.

The gap has been worked around twice by putting prose in the `date` key. On 2026-08-21
specs 16, 18 and 19 were revised in place against the shipped spec 15 and re-approved as
`date: "2026-08-21 (re-approved against main 7b64e98: …)"` in a hand commit. On 2026-09-03
spec 30 was widened after approval and re-approved the same way, against `a4ec669`.

## 2. Problem

A spec's approval has no readable ground. Nothing records when a spec was approved, against
which repository state, or which content the approval covered. The information exists only
as free text in `date`, which no command can parse, compare or report.

Three consequences follow. A spec can be edited after approval and stay `Approved` with
nothing able to say so: spec 30 was exactly that for one commit today. A plan can be
approved against such a spec and bind, through its own record, to text no human approved.
And re-approving a spec, the honest gesture after an in-place revision, is refused by the
tool, so the record ends up in prose and in a hand commit outside the transition machinery.

## 3. Product goal

Give spec approval the same recorded ground plan approval already has: a stamped date and
baseline on the artifact, a record with the approved content's fingerprint, a legal
re-approval that refreshes both, and a status report that can say whether the spec still
matches its approval. Plan approval then chains on that record, so a plan only ever binds
to spec text that was itself approved.

> An approval that cannot be read back is not recorded; a spec's approval is read back the
> same way a plan's is.

## 4. Terminology

- **Approval stamp** — the `approved: { date, baseline }` frontmatter mapping written by
  `phax artifact approve`; `baseline` is the short commit the approval was given against.
- **Spec approval record** — the sidecar entry written at spec approval: the spec's content
  fingerprint, the full baseline commit and the timestamp.
- **Content fingerprint** — the digest defined by spec 26: the artifact minus its `status`
  and `approved` keys.
- **Edited since approval** — the spec's current content fingerprint differs from the one
  in its approval record.
- **Unrecorded** — a spec whose status is `Approved` but which has no approval record.
- **Re-approval** — the `Approved → Approved` transition: a re-stamp that replaces the
  approval record.

## 5. Functional requirements

### 5.1 Spec approval is stamped

WHEN a spec transitions to `Approved` THE system SHALL write the approval stamp to the spec's
frontmatter, replacing any previous value and leaving every other key and the body
byte-identical.

### 5.2 Spec key set admits the stamp

The system SHALL enforce the spec key set as exactly `status`, `date`, `audience`, `scope`,
and, once approved at least once, `approved` with exactly `date` and `baseline`.

### 5.3 Spec approval is recorded

WHEN a spec transitions to `Approved` THE system SHALL write a spec approval record binding
the spec's content fingerprint, the full baseline commit and the approval timestamp,
replacing any previous record for that spec.

### 5.4 Re-approval is legal

The system SHALL accept `Approved → Approved` for a spec as a re-approval that performs
§5.1 and §5.3 and commits the write-set like any other transition.

### 5.5 Stamping is fingerprint-neutral

WHEN a spec is stamped or re-stamped THE system SHALL leave the spec's content fingerprint
unchanged, so dependent plans do not report `spec-changed` from the stamp alone.

### 5.6 Record retired with the spec

WHEN a spec transitions to a terminal status THE system SHALL remove its approval record;
the stamp stays in the archived file.

### 5.7 Status reports the approval

WHEN `phax artifact status` runs on a spec THE system SHALL report the approval stamp and
whether the spec is edited since approval, or that the approval is unrecorded.

### 5.8 Plan approval chains on the spec record

IF a plan's declared source spec is `Approved` but edited since approval or unrecorded THEN
plan approval SHALL refuse, naming the spec and re-approval as the remedy.

### 5.9 No backfill

The system SHALL NOT synthesise a stamp or record for a spec approved before this change;
such a spec reports unrecorded until it is re-approved explicitly.

## 6. Surface

### Spec frontmatter — before → after

Before (as committed today for spec 30; the prose in `date` is the workaround):

    ---
    status: Approved
    date: "2026-09-03 (re-approved against main a4ec669 after widening to the gate diagnostics
      contract; original approval the same day covered orient only)"
    audience: implementation planning with Claude Code
    scope: functional behavior and consumption surface
    ---

After (`approved` key name, its two sub-keys and the short-baseline form are **normative**;
they mirror plans exactly):

    ---
    status: Approved
    date: 2026-09-03
    audience: implementation planning with Claude Code
    scope: functional behavior and consumption surface
    approved:
      date: 2026-09-03
      baseline: a4ec669
    ---

A spec never approved omits `approved` entirely (**normative**). A key outside the set of
§5.2 fails validation naming the file and the allowed keys, as today.

### `docs/specs/approvals.json` (location **normative** per §9; field names **indicative**;
that a record exists per Approved spec with exactly fingerprint, baseline and timestamp is
**normative**)

    {
      "version": 1,
      "records": {
        "docs/specs/30-provider-contract-discoverability.md": {
          "specFingerprint": "59c9aa90…",
          "approvedAt": "2026-09-03T14:02:11.000Z",
          "baseline": "a4ec6690f3…"
        }
      }
    }

### `phax artifact approve` on an Approved spec (that it succeeds and prints the baseline is
**normative**; layout indicative)

    $ phax artifact approve docs/specs/30-provider-contract-discoverability.md
    Status: Approved
    Baseline: c924ed8
    Commit: 1f0e2a3 — chore(specs): approve 30-provider-contract-discoverability

### `phax artifact status` on a spec — before → after (the three new lines are
**normative** in presence; wording indicative)

    Path:              docs/specs/30-provider-contract-discoverability.md
    Kind:              spec
    Status:            Approved
    Legal transitions: Abandoned, Completed
    →
    Path:              docs/specs/30-provider-contract-discoverability.md
    Kind:              spec
    Status:            Approved
    Approved:          2026-09-03 @ c924ed8
    Edited since:      no
    Legal transitions: Approved, Abandoned, Completed

For an unrecorded spec the two approval lines read `Approved:          (unrecorded — run
phax artifact approve to record)` and omit `Edited since`.

### Plan approval refusal (that it refuses with exit 12 and names the spec and the remedy is
**normative**; wording indicative)

    $ phax artifact approve docs/plans/56-gate-step-scheduling-plan.md
    ✗ approve refused: docs/specs/18-gate-step-scheduling.md is Approved but edited since its
      approval (7b64e98) — re-approve the spec first
    $? = 12

    ✗ approve refused: docs/specs/18-gate-step-scheduling.md is Approved but its approval is
      unrecorded — re-approve the spec first
    $? = 12

No new command. No visual UI — no design annex.

## 7. Non-goals

- Spec staleness against repository ground (a `ground-changed` for specs). A spec has no
  footprint; the baseline is recorded so a later spec can define what it means.
- Any change to plan staleness reasons, evidence or the `plans status` report.
- A `Stale` status or a `Draft` round-trip for specs; re-approval is the only new transition.
- Merging the plan and spec record stores into one file or one schema.
- Automatic re-approval or automatic sweeping of the existing prose-in-`date` values. The
  five live Approved specs are re-approved by hand as the migration; their `date` values
  are restored to plain dates in the same gesture.

## 8. Acceptance criteria

### Approving a spec stamps it

Given a Draft spec, when `phax artifact approve <spec>` runs at HEAD `h`, then the spec's
frontmatter carries `approved: { date, baseline }` with `baseline` the short form of `h`,
and every other key and the body are byte-identical. (refs §5.1)

### Key set enforced

Given a spec whose frontmatter carries `approved` with a key other than `date` or
`baseline`, when any artifact operation validates it, then validation fails naming the file
and the allowed keys. (refs §5.2)

### Approving a spec records it

Given a Draft spec, when it is approved, then the spec approval record holds the spec's
content fingerprint, the full HEAD commit and the timestamp. (refs §5.3)

### Re-approval is legal and replaces the record

Given an Approved spec with a record, when `phax artifact approve <spec>` runs again at a
later HEAD, then it exits 0, the stamp and the record carry the new baseline, and one commit
is made. (refs §5.4)

### Stamp is fingerprint-neutral

Given an Approved plan whose approval record binds spec S, when S is re-approved with no
other edit, then `phax plans status` reports the plan fresh. (refs §5.5)

### Terminal transition removes the record

Given an Approved spec with a record and no live dependent plans, when it is completed or
abandoned, then no record remains for it and the archived file keeps its stamp. (refs §5.6)

### Status reports edited-since-approval

Given an Approved spec with a record, when its body is edited, then
`phax artifact status <spec>` reports it edited since approval; and when it is re-approved,
then the report says it is not. (refs §5.7)

### Status reports unrecorded

Given a spec that is `Approved` with no record, when `phax artifact status <spec>` runs,
then it reports the approval as unrecorded and lists `Approved` among the legal
transitions. (refs §5.7, §5.9)

### Plan approval refuses an edited spec

Given a plan declaring spec S, S Approved and edited since approval, when
`phax artifact approve <plan>` runs, then it exits 12, names S and says to re-approve it,
and no plan stamp or record is written. (refs §5.8)

### Plan approval refuses an unrecorded spec

Given a plan declaring spec S, S Approved and unrecorded, when `phax artifact approve <plan>`
runs, then it exits 12, names S and says to re-approve it. (refs §5.8, §5.9)

### Plan approval passes a recorded, unedited spec

Given a plan declaring spec S, S Approved, recorded and unedited, when
`phax artifact approve <plan>` runs, then it succeeds as today. (refs §5.8)

## 9. Open questions for implementation planning

Question: stamp only, or stamp plus a record with the content fingerprint?

- Stamp only — abandons: detecting a spec edited after approval, which is the failure that
  happened to spec 30 today and the only thing that makes §5.8 possible.
- Stamp plus record — abandons: the "smallest candidate" framing; a second sidecar store to
  keep consistent with the frontmatter.

Recommendation: stamp plus record. The stamp alone repeats the plan design of spec 26
before spec 22 filled it in; the fingerprint is what makes the approval readable.

Resolved 2026-09-03: stamp plus record.

Question: when a plan's spec is edited since approval or unrecorded, refuse or warn?

- Refuse — abandons: approving a plan in one step after a trivial spec edit; the spec must
  be re-approved first (one command).
- Warn — abandons: chain integrity; a plan's record would bind to spec text no one approved.

Recommendation: refuse; consistent with the existing chain gate that refuses a Draft spec.

Resolved 2026-09-03: refuse, exit 12.

Question: a separate `docs/specs/approvals.json`, or entries in the plan store?

- Separate file, per-kind shape — abandons: one place to look for all approvals.
- Shared file — abandons: the explicit per-variant shape; the plan record's
  `planFingerprint` and `sourceSpec` fields have no meaning for a spec.

Recommendation: separate file with its own shape, per the explicit-over-permissive rule.

Resolved 2026-09-03: `docs/specs/approvals.json` with its own shape.

## 10. Implementation-planning note

Settled: the stamp mirrors the plan stamp exactly (same key, same sub-keys, same short
baseline), the spec transition table gains `Approved → Approved`, and the content
fingerprint definition is unchanged. The existing stamp and clear helpers, the transition
write-set and autocommit (spec 25), and the plan approval chain gate are the natural seams;
the plan should extend them rather than add parallel paths.

Migration is a manual, documented gesture, not code: after the change lands, re-approve the
live Approved specs (18, 19, 23, 24, 30) with the tool, restoring their `date` values to
plain dates in the same commit series, and update the `phax-spec` skill and README where
they describe the spec key set and the `date` workaround.

Constraint: no back-compat shim. A spec whose frontmatter predates this change validates
(the key is optional until first approval) but reports unrecorded; nothing reads the prose
in `date`.
