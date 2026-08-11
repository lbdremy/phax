# YAML Frontmatter Metadata for Lifecycle Artifacts

Status: Approved

Date: 2026-08-11

Audience: implementation planning with Claude Code

Scope: functional behavior and consumption surface

## 1. Context

Specs (`docs/specs/`) and plans (`docs/plans/`) carry lifecycle metadata as free
paragraphs between the `# Title` heading and the first `## ` heading:

- specs: `Status:`, `Date:`, `Audience:`, `Scope:`;
- plans: `Status:`, `Source-Spec:`, `Approved: <date> @ <baseline>` (the last one
  stamped by `phax artifact approve`).

phax reads and rewrites these lines by pattern-matching raw text: any line matching
`Status:` before the first `## ` counts as the status, wherever it sits and whatever
surrounds it. The consumers are the `phax artifact` transition commands (which rewrite
the `Status:` line in place and upsert the `Approved:` stamp), the run gate (which
refuses to run a non-Approved plan), `phax plans` staleness (which fingerprints artifact
content *excluding* the `Status:` and `Approved:` lines, so that approving a plan does
not make it stale against its own approval record in `docs/plans/approvals.json`), and
the deterministic plan extractor (which ignores these lines as preamble prose).

## 2. Problem

The header is a private micro-format. Nothing distinguishes metadata from prose except
regexes and a "before the first `## `" convention; a sentence that happens to start with
`Status:` is metadata. Each new field needs its own pattern plus insertion heuristics
(the `Approved:` stamp is inserted "after `Source-Spec:`, else after `Status:`, else
first line"). Standard tooling — editors, static site generators, generic frontmatter
parsers, GitHub's renderer — sees the metadata as body text and offers nothing. As the
lifecycle system grows (staleness, lineage, decisions), every addition deepens an
ad-hoc format instead of extending a standard one.

## 3. Product goal

Every lifecycle artifact carries its metadata in a single YAML frontmatter block —
the de-facto Markdown standard — with an explicit, per-kind key set decoded at the
boundary. Transitions rewrite structured keys instead of pattern-matched prose lines,
and the body of the document is unambiguously body.

> Lifecycle metadata is structured data decoded once at the boundary — never prose
> scraped by pattern-matching.

## 4. Terminology

- **Artifact** — a spec or plan file governed by the lifecycle (live or archived).
- **Frontmatter** — the YAML block delimited by `---` lines at byte offset 0 of the file.
- **Header lines** — the current free-paragraph metadata format being replaced.
- **Fingerprintable content** — the portion of an artifact hashed into approval
  records; today, everything except the `Status:` and `Approved:` header lines.
- **Approval record** — the entry in `docs/plans/approvals.json` (fingerprints,
  baseline, source-spec lineage) written when a plan is approved.

## 5. Functional requirements

### 5.1 Frontmatter is the sole metadata carrier

The system SHALL read every artifact's lifecycle metadata exclusively from a YAML
frontmatter block at the start of the file. IF an artifact has no frontmatter block
THEN validation SHALL fail with an actionable message naming the file and the expected
format; header lines SHALL NOT be recognized as metadata (no back-compat reading).

### 5.2 Per-kind key sets

The system SHALL enforce an explicit key set per artifact kind: specs carry exactly
`status`, `date`, `audience`, `scope`; plans carry exactly `status`, `source-spec`,
and — once approved at least once — `approved`. IF a required key is missing or an
unknown key is present THEN validation SHALL fail naming the offending key.

### 5.3 Status semantics unchanged

The system SHALL accept the existing status sets unchanged (specs: `Draft`,
`Approved`, `Abandoned`, `Archived`; plans: those plus `Stale`), and SHALL keep every
existing rule that binds status to location (terminal status ⇔ `archive/` directory)
and to transition legality.

### 5.4 Transitions rewrite keys, preserve everything else

WHEN a lifecycle transition writes an artifact THE system SHALL rewrite only the
frontmatter keys that transition owns, leaving the other keys and the entire document
body byte-for-byte identical.

### 5.5 Approval stamp

WHEN a plan is approved THE system SHALL record the approval date and short baseline
commit in the plan's frontmatter `approved` key, replacing any previous value.

### 5.6 Fingerprint neutrality of lifecycle stamps

The system SHALL exclude exactly the `status` and `approved` keys from fingerprintable
content, so that a lifecycle transition alone never changes an artifact's fingerprint,
while a change to `source-spec` (or any other key) remains fingerprint-relevant.

### 5.7 Deterministic extraction reads through frontmatter

WHEN the deterministic plan extractor parses a plan with frontmatter THE system SHALL
treat the frontmatter as metadata (not Markdown body) and SHALL extract the same run
and phases it extracts today from an equivalent header-line plan.

### 5.8 One-time migration without induced staleness

The system's migration of the repository SHALL convert every live and archived
artifact to frontmatter and recompute the fingerprints in `docs/plans/approvals.json`
in the same change, such that `phax plans` reports no plan stale *because of* the
migration itself.

## 6. Surface

The surface is the artifact file format itself, plus validation messages. Key names
and value shapes are **normative**; YAML styling (quoting, spacing) is indicative.

Plan header, before → after:

    # Artifact Transition Auto-Commit          ---
                                               status: Approved
    Status: Approved                           source-spec: docs/specs/25-artifact-transition-autocommit.md
                                               approved:
    Source-Spec: docs/specs/25-….md              date: 2026-08-11
    Approved: 2026-08-11 @ 4ae687b               baseline: 4ae687b
                                               ---

                                               # Artifact Transition Auto-Commit

A plan not yet approved omits the `approved` key entirely (normative). A plan with no
source spec declares `source-spec: null` (normative — replaces `Source-Spec: (none)`;
absence of the key is invalid).

Spec header, before → after:

    # <Title>                                  ---
                                               status: Draft
    Status: Draft                              date: 2026-08-11
    Date: 2026-08-11                           audience: implementation planning with Claude Code
    Audience: implementation planning …        scope: functional behavior and consumption surface
    Scope: functional behavior …               ---

                                               # <Title>

`date`, `audience`, `scope` are free-form strings (normative as keys; values
unconstrained — today's dates carry prose like `2026-08-10 (revised: …)`).

Validation failure, missing frontmatter (exit behavior normative, wording indicative):

    ✗ docs/plans/45-typescript-7-migration-plan.md has no frontmatter block —
      lifecycle metadata must be YAML frontmatter (see docs/specs/26-…)

Validation failure, unknown key (wording indicative):

    ✗ docs/specs/26-artifact-frontmatter-metadata.md: unknown frontmatter key "staus"
      (allowed for a spec: status, date, audience, scope)

CLI command surface (`phax artifact …`, `phax plans`) is unchanged; only the file
format the commands read and write changes.

## 7. Non-goals

- No back-compat: header lines are rejected, not tolerated as a fallback format.
- No new metadata keys beyond the current set — frontmatter *enables* extension;
  this spec does not exercise it.
- No change to the status state machines, transition legality, or archive rules.
- No change to the shape of `docs/plans/approvals.json`.
- No shipped migration command (see §9) — external adopters migrate by hand, guided
  by the validation error.
- No rendering or site tooling built on the frontmatter.

## 8. Acceptance criteria

### Frontmatter is required

Given an artifact whose metadata is header lines (no frontmatter), when any lifecycle
operation validates it, then validation fails naming the file and the expected
frontmatter format. (refs §5.1)

### Key sets are exact

Given a spec whose frontmatter carries an unknown key, when it is validated, then
validation fails naming that key and listing the allowed set. Given a plan missing
`source-spec`, when it is validated, then validation fails naming the missing key.
(refs §5.2)

### Statuses and placement rules survive the format change

Given a plan with `status: Stale` under `docs/plans/`, when validated, it passes;
given `status: Archived` outside `archive/`, validation fails, exactly as today.
(refs §5.3)

### Transitions touch only their keys

Given an Approved plan, when `phax artifact stale <path>` runs, then the file differs
from before only in the frontmatter `status` value. (refs §5.4)

### Approval stamps into frontmatter

Given a Draft plan, when `phax artifact approve <path>` runs, then its frontmatter
`approved` key carries the approval date and short baseline commit. (refs §5.5)

### Lifecycle stamps are fingerprint-neutral

Given an Approved plan with an approval record, when its `status` flips and its
`approved` stamp is rewritten with no other change, then `phax plans` still reports
it fresh; when its `source-spec` value changes, `phax plans` reports it stale with
reason self-changed. (refs §5.6)

### Extraction is format-agnostic in outcome

Given a conforming plan with frontmatter, when deterministic extraction runs, then it
succeeds and yields the same phases, models, planned files, and commit metadata as the
equivalent header-line plan did. (refs §5.7)

### Migration induces no staleness

Given the migrated repository, when `phax plans` runs, then no plan is reported stale
whose only change since approval is the format migration. (refs §5.8)

## 9. Open questions for implementation planning

Question: strict or tolerant unknown frontmatter keys?

- Strict (reject) — abandons author freedom to annotate artifacts with private keys.
- Tolerant (ignore) — abandons the guarantee that every key is meaningful: a typo
  (`staus:`) silently drops the metadata it meant to set.

Recommendation: strict — consistent with repo doctrine (explicit over permissive);
annotation needs can add keys via a future spec.

Question: ship a migration command or migrate in-repo only?

- In-repo migration only — abandons convenience for external phax adopters, who must
  hand-edit their artifacts when they upgrade.
- `phax artifact migrate` command — abandons surface minimalism: a one-shot tool
  persists forever in the CLI contract.

Recommendation: in-repo only — the validation error names the expected format, the
edit is mechanical, and adopters of the lifecycle system are few and early.

Question: `approved` as a structured mapping or the compact scalar `2026-08-11 @ 4ae687b`?

- Mapping (`date` + `baseline`) — abandons the compact one-line human stamp.
- Scalar — abandons machine-readability of the two components, which is the point of
  the migration.

Recommendation: mapping, as shown in §6.

## 10. Implementation-planning note

Settled: frontmatter as sole carrier (§5.1), exact per-kind key sets (§5.2), fingerprint
neutrality restricted to `status` and `approved` (§5.6), migration coupled with
fingerprint recomputation (§5.8). Open-with-default: the three §9 questions.

Constraints for the plan:

- Sequence after plan 25 (artifact transition auto-commit) lands — it modifies the same
  transition write path; this spec's plan builds on the committed result.
- Frontmatter must be decoded through a schema at the boundary before entering the
  domain, per the validation-boundaries rule; the migration must not weaken the
  deterministic extractor's existing guarantees.
- The `phax-spec` and `phax-planning` skills document the header format and must be
  updated in the same run, including their templates and examples.
- Archived artifacts migrate too: validation applies to `archive/` files, and a format
  split between live and archived artifacts would be a permanent trap.
