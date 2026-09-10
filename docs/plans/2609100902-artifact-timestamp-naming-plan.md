---
status: Approved
source-spec: docs/specs/2609091040-artifact-timestamp-naming.md
approved:
  date: 2026-09-10
  baseline: b378d90
---

# Artifact timestamp naming

> Check this file with `phax plans lint`, then run it with
> `phax run --plan <this file>`. Source spec:
> [`docs/specs/2609091040-artifact-timestamp-naming.md`](../specs/2609091040-artifact-timestamp-naming.md)
> (approved 2026-09-10 against `main` @ `c48a8c1`). Planned 2026-09-10 against
> `main` @ `0a28a30`.

Implements the artifact-timestamp-naming spec. A repo-tracked spec or plan is
named `<YYMMDDHHMM>-<slug>.md` / `<YYMMDDHHMM>-<slug>-plan.md` (UTC minute,
slug `[a-z0-9]+(-[a-z0-9]+)*`). Every artifact-reading command refuses an
off-grammar name with exit code 12 (spec §5.1); `phax artifact new spec|plan
<slug> [--spec <path>]` creates a frontmatter-only `Draft` skeleton stamped from
the clock (§5.2); `phax plans lint` reports an error when a plan's slug differs
from its source spec's (§5.3); a one-off migration renames the 110 existing
artifacts, live and archived, from their first-commit author minute and rewrites
every tracked reference, carrying approvals over (§5.4, §5.5); the two shipped
skills and the README teach the grammar, the command, and reference-by-slug
(§5.6). Loose `plan.md` files outside `docs/plans/` are exempt from everything.

Order is inside-out: the name grammar in the domain first (phase-01), then the
migration while nothing enforces yet (phase-02), then enforcement across readers
and the lint (phase-03), then the creation command (phase-04), then the docs and
skills (phase-05). The migration precedes enforcement on purpose: once phase-03
lands, an old-grammar tree would refuse every artifact command.

---

## Required commands

- (none)

Every gate step uses `pnpm` scripts already in `package.json`. The migration
runs as a throwaway `tsx` script through `pnpm exec tsx` (already granted in
`security.agentCommands`) plus `git log` / `git mv`; the CLI-contract
regeneration uses `pnpm gen:usage-spec` and `pnpm docs:cli`, both already
granted. No `## Required PHAX security configuration changes` section is needed.

---

## Technical arbitrations

Resolved with the human on 2026-09-10; recorded so phases execute without
re-litigating them.

- **The migration runs as a phase of this run, with a throwaway script.**
  Abandons: a clean file reconciliation — 110 renames sit outside any list a
  reviewer can eyeball, and the deletions of the old paths are one explained
  deviation in the phase-02 handoff. Accepted: the migration is recorded in the
  run, it is guaranteed to land before the enforcement phase on the same
  branch, and the full old → new mapping travels in the phase-02 commit body.
  The script is never committed; a script that must not run twice has no place
  in `scripts/`.
- **The stamp comes from `nowIso` captured in the CLI, not from a new `Clock`
  port.** Abandons: the literal reading of spec §10 "time through a port".
  Accepted: phax has no clock port today; `artifact approve`, `plans status`
  and `review-code` all capture `new Date().toISOString()` at the CLI boundary
  and pass it to the use case as data, which keeps the use case pure and the
  stamp testable with a fixed instant. A `Clock` port would drag a new port,
  adapter, fake, and twenty untouched `new Date()` call sites in `app/` into a
  plan about file names. (`.claude/skills/effect-services/SKILL.md` names a
  `Clock` port that does not exist; leave that inconsistency for its own
  follow-up.)
- **The slug-mismatch finding lives under the existing `structure` check.**
  Abandons: a dedicated check name in `--json`. Accepted: `LintCheck` is a
  closed set whose widest member sizes the renderer's column; a fifth-plus name
  would ragged every report for one finding, and a name/lineage mismatch is a
  structural property of the plan file.
- **Grammar violations raise `ArtifactValidationError`.** Abandons: nothing
  observable. Accepted: it is the error `validateArtifact` already raises for
  a status/location disagreement, it already maps to exit code 12 in
  `exitCodeForError`, and it reaches every reader (`artifact *`, `plans
  status`, `phax run`, run-end completion) through the one choke point.
  Creation refusals get their own tagged error so the CLI message can name
  the slug, the existing path, or the bad spec.

---

## phase-01 — Artifact name grammar in the domain {#phase-01-name-grammar}

**Recommended model:** claude-sonnet-5
**Recommended effort:** medium

Give the domain one module that knows what a valid artifact file name is, how
to parse one into a stamp and a slug, and how to build one from an ISO instant
and a slug. Nothing calls it yet; phases 02–04 all consume it.

### Detailed instructions

- Create `src/domain/artifact/name.ts` exporting, at minimum:
  - `SLUG_PATTERN` — the slug grammar `^[a-z0-9]+(-[a-z0-9]+)*$` and
    `isSlug(s: string): boolean`.
  - `formatStamp(nowIso: string): string` — the ten-digit `YYMMDDHHMM` of the
    instant **in UTC** (use the `getUTC*` accessors, never local time), each
    field zero-padded to two digits.
  - `buildArtifactName(kind: ArtifactKind, nowIso: string, slug: string): string`
    — `<stamp>-<slug>.md` for `"spec"`, `<stamp>-<slug>-plan.md` for `"plan"`.
  - `parseArtifactName(kind: ArtifactKind, fileName: string): ArtifactName | null`
    with `ArtifactName = { stamp: string; slug: string }`; returns `null` when
    the basename does not match the grammar for that kind (wrong digit count,
    missing `-plan` suffix on a plan, `-plan` suffix on a spec, uppercase,
    underscores, double hyphens, leading/trailing hyphen, non-`.md`).
  - `artifactNameGrammar(kind: ArtifactKind): string` — the human-readable
    grammar string used in refusal messages: `<YYMMDDHHMM>-<slug>.md` or
    `<YYMMDDHHMM>-<slug>-plan.md`.
- Keep the module pure (no I/O, no `Date.now()` — the instant comes in as a
  string). Reuse `ArtifactKind` from `src/domain/artifact/status.ts`.
- Do not wire the grammar into `validateArtifact` yet (phase-03); do not touch
  `writeSet.ts` yet (phase-03).

### Planned files to create

- `src/domain/artifact/name.ts`
- `tests/unit/artifact/name.test.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- (none)

### Test strategy

Unit tests, written first: `formatStamp` on a fixed ISO instant with a non-UTC
offset (`2026-09-09T14:12:40+02:00` → `2609091212`), on a midnight rollover
across the UTC day boundary, and on single-digit month/day/hour/minute
(padding); `buildArtifactName` for both kinds; `parseArtifactName` round-trips
every built name and rejects each malformed shape listed above, including a
plan name given as a spec and vice versa; `isSlug` on the spec's refusal
example `Plan_Prune`.

### Implementation order

Tests → `name.ts`.

### Excluded scope

- Any enforcement (phase-03), any file writing (phase-04), any rename (phase-02).

### Verification

- The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- The exact exports of `src/domain/artifact/name.ts` with their signatures, so
  phases 02–04 import them without reading the file.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(artifact): add the timestamp-and-slug artifact name grammar

### Commit body

Add a pure domain module that formats a UTC `YYMMDDHHMM` stamp from an ISO
instant, builds `<stamp>-<slug>.md` / `<stamp>-<slug>-plan.md` names per
artifact kind, and parses a file name back into stamp and slug or rejects it.
Nothing consumes it yet; the migration, the readers' validation and the
creation command build on it in the next phases. Covered by unit tests on
padding, UTC conversion and every malformed shape.

---

## phase-02 — Migrate every existing artifact to the new grammar {#phase-02-migrate-artifacts}

**Recommended model:** claude-sonnet-5
**Recommended effort:** high

Rename the 110 existing specs and plans, live and archived, to their artifact
name — stamp from the UTC **author** time of the first commit that added the
file (following renames), slug from the current name with its counter removed —
and rewrite every tracked reference to an old path, so that no tracked file
names a pre-migration path and `phax artifact status` / `phax plans status`
behave exactly as before. Lock the invariant with a repository-scan test.

### Detailed instructions

- Write a **throwaway** `tsx` script in the run's scratch space (not under the
  repo; never commit it). It must:
  1. Enumerate `docs/specs/*.md`, `docs/specs/archive/*.md`,
     `docs/plans/*.md`, `docs/plans/archive/*.md`, skipping the one file already
     under the new grammar (`docs/specs/2609091040-artifact-timestamp-naming.md`)
     and every `approvals.json`.
  2. For each file, take the first commit that added it:
     `git log --follow --diff-filter=A --format=%aI -- <path>` and keep the
     **last** line (oldest). Convert that ISO author time with `formatStamp`
     from `src/domain/artifact/name.ts` (import it from `src/`, as
     `scripts/generate-usage-spec.ts` imports `src/`).
  3. Derive the slug: strip the leading counter `^[0-9]+[a-z]?-` (this covers
     `03b-` / `04b-`), drop `.md`, replace `_` with `-`, strip a trailing
     `-spec` on specs and a trailing `-plan` on plans; the one file whose slug
     comes out empty (`docs/plans/archive/01-plan.md`) gets `phax-cli`. Build
     the new name with `buildArtifactName` and assert the result parses back
     with `parseArtifactName`.
  4. Assert no two files map to the same new path (the mapping below was
     verified collision-free on 2026-09-10; re-assert at run time).
  5. `git mv` each file to its new path.
  6. Rewrite every reference to an old path (`docs/specs/…`, `docs/plans/…`,
     with or without `archive/`) in every tracked file, using the mapping in
     both its live and its archived form: a plan's `source-spec` still names the
     spec's live path after the spec was archived, so a reference to
     `docs/specs/19-plan-completeness-advisory.md` becomes
     `docs/specs/2608…-plan-completeness-advisory.md` (live form), never the
     archive path. Do this with exact-string replacement over the whole
     mapping, longest old path first. Files known to carry such references:
     `docs/specs/approvals.json` and `docs/plans/approvals.json` (record
     **keys**, plus the `sourceSpec.path` binding on plan records),
     `NEXT_STEPS.md`, `README.md`, `docs/model-catalog.md`, `docs/security.md`,
     `docs/blog/announcing-phax-1.0.md`, `docs/spikes/entire-checkpoint-findings.md`,
     `src/cli/cliDocs.ts` (example lines citing real archived paths),
     `src/domain/artifact/document.ts` (the no-frontmatter error text cites
     `docs/specs/26-artifact-frontmatter-metadata.md`), and the bodies of the
     renamed artifacts themselves. Grep the whole tree after rewriting; the
     list above is a floor, not a ceiling. Do **not** rewrite fictitious fixture
     paths in `tests/**` (e.g. `docs/plans/45-foo-plan.md`) — phase-03 restamps
     those with the enforcement.
  7. Approval carry-over (spec §5.5): for each live plan whose record key was
     rewritten, if the rewrite changed the plan's **content** (a `source-spec`
     substitution), recompute `planFingerprint` with `artifactFingerprint` from
     `src/app/approvalRecordStore.ts` and store it; keep `approvedAt` and
     `baseline`. Today both live plans (`39-smolvm…`, `41-claude-protected…`)
     have `source-spec: null`, so only their keys move — implement the general
     case anyway and assert afterwards that `phax artifact status` reports
     `Edited since: no` on both. Spec records need only the key rewrite.
  8. Print the old → new mapping as a Markdown table; paste it into the commit
     body.
- Regenerate the CLI contract after editing `src/cli/cliDocs.ts`:
  `pnpm gen:usage-spec` then `pnpm docs:cli` (rewrites `phax.usage.kdl`,
  `docs/cli/reference.md` and the generated README block).
- Add `tests/unit/artifactNamesGuard.test.ts`: walk `git ls-files` (read the
  index through `node:child_process` in the test, as the architectural guard
  reads the tree) and assert that no tracked file outside `tests/**` contains a
  pre-migration artifact path, i.e. matches
  `docs/(specs|plans)/(archive/)?[0-9]{2}[a-z]?-`. Also assert that the file
  names under each of the four artifact directories, sorted lexically, carry
  non-decreasing stamps (spec §5.4 / AC "Listing order is creation order").
  Phase-03 widens the first assertion to `tests/**`.
- Verify by hand before committing: `phax artifact status` on the four live
  artifacts and `phax plans status` (must list the same two Approved plans as
  before, both fresh); `git status` shows renames (`R`), not delete+add pairs.

### Planned files to create

- `tests/unit/artifactNamesGuard.test.ts`
- `docs/specs/2608091526-phase-decision-requests.md`
- `docs/specs/2608091526-batch-execution-disjoint-plans.md`
- `docs/specs/archive/2605210819-feedback-ingest.md`
- `docs/specs/archive/2606030721-phax-planning-skill-update.md`
- `docs/specs/archive/2606031656-update-provider-effort.md`
- `docs/specs/archive/2606041211-run-jail.md`
- `docs/specs/archive/2606051414-review-handoff.md`
- `docs/specs/archive/2606120941-deno-runtime.md`
- `docs/specs/archive/2606120941-push-branch-pr.md`
- `docs/specs/archive/2606150842-install-planning-skill.md`
- `docs/specs/archive/2606150841-agent-commands.md`
- `docs/specs/archive/2606181052-init-command.md`
- `docs/specs/archive/2606181006-lock-agent-binding-phase.md`
- `docs/specs/archive/2606181037-project-namespace.md`
- `docs/specs/archive/2606181003-usage-cli.md`
- `docs/specs/archive/2606171452-remove-network-controls.md`
- `docs/specs/archive/2607031249-gate-profile-attributed-steps.md`
- `docs/specs/archive/2607031249-external-gate-steps.md`
- `docs/specs/archive/2607031249-brief-profile-orient.md`
- `docs/specs/archive/2607031249-gate-step-scheduling.md`
- `docs/specs/archive/2607031249-plan-completeness-advisory.md`
- `docs/specs/archive/2607101341-model-catalog-equivalence-routing.md`
- `docs/specs/archive/2608091526-artifact-lifecycle-status.md`
- `docs/specs/archive/2608091526-plan-staleness-lineage.md`
- `docs/specs/archive/2608110911-artifact-transition-autocommit.md`
- `docs/specs/archive/2608110950-artifact-frontmatter-metadata.md`
- `docs/specs/archive/2608121241-run-carries-archival.md`
- `docs/specs/archive/2608121241-rename-archived-to-completed.md`
- `docs/specs/archive/2608201245-phax-run-records.md`
- `docs/specs/archive/2609030725-provider-contract-discoverability.md`
- `docs/specs/archive/2609030749-spec-approval-ground.md`
- `docs/specs/archive/2609030829-archive-unfinished-runs.md`
- `docs/specs/archive/2609080848-plan-lint.md`
- `docs/plans/2606291247-smolvm-isolation-spike-plan.md`
- `docs/plans/2606301114-claude-protected-path-approval-hook-plan.md`
- `docs/plans/archive/2605111617-phax-cli-plan.md`
- `docs/plans/archive/2606030721-phax-planning-skill-update-plan.md`
- `docs/plans/archive/2606031656-update-provider-effort-plan.md`
- `docs/plans/archive/2606031656-provider-e2e-validation-plan.md`
- `docs/plans/archive/2606041211-run-jail-plan.md`
- `docs/plans/archive/2606041211-run-jail-provider-validation-plan.md`
- `docs/plans/archive/2606021303-model-routing-enabled-gating-plan.md`
- `docs/plans/archive/2606010707-model-routing-plan.md`
- `docs/plans/archive/2605251225-observability-plan.md`
- `docs/plans/archive/2606021307-provider-priority-override-plan.md`
- `docs/plans/archive/2606150841-agent-commands-plan.md`
- `docs/plans/archive/2606020811-rename-claude-backend-errors-plan.md`
- `docs/plans/archive/2606181052-init-command-plan.md`
- `docs/plans/archive/2606080819-opus-frontier-tiers-plan.md`
- `docs/plans/archive/2606181006-lock-agent-binding-phase-plan.md`
- `docs/plans/archive/2606090853-review-handoff-plan.md`
- `docs/plans/archive/2606100823-gate-first-resume-plan.md`
- `docs/plans/archive/2606181037-project-namespace-plan.md`
- `docs/plans/archive/2606100823-reset-phase-command-plan.md`
- `docs/plans/archive/2606181003-usage-cli-plan.md`
- `docs/plans/archive/2606120941-push-branch-pr-plan.md`
- `docs/plans/archive/2606181006-remove-last-commands-plan.md`
- `docs/plans/archive/2606181309-agent-binding-hardening-plan.md`
- `docs/plans/archive/2606120941-typescript-6-migration-plan.md`
- `docs/plans/archive/2606120941-deno-runtime-plan.md`
- `docs/plans/archive/2606181309-enforce-architecture-boundaries-plan.md`
- `docs/plans/archive/2607221702-brief-profile-orient-plan.md`
- `docs/plans/archive/2606150842-install-planning-skill-plan.md`
- `docs/plans/archive/2606181519-sealed-completion-extraction-plan.md`
- `docs/plans/archive/2606190939-local-telemetry-report-plan.md`
- `docs/plans/archive/2606191404-whats-next-guidance-plan.md`
- `docs/plans/archive/2606191439-compliance-review-plan.md`
- `docs/plans/archive/2607101348-model-catalog-equivalence-routing-plan.md`
- `docs/plans/archive/2608101018-artifact-lifecycle-status-plan.md`
- `docs/plans/archive/2606191401-usage-spec-generation-hardening-plan.md`
- `docs/plans/archive/2606191452-config-user-project-split-plan.md`
- `docs/plans/archive/2608101529-plan-staleness-lineage-plan.md`
- `docs/plans/archive/2606191529-handoff-deviation-justification-plan.md`
- `docs/plans/archive/2606230730-interactive-init-plan.md`
- `docs/plans/archive/2608110919-artifact-transition-autocommit-plan.md`
- `docs/plans/archive/2606230858-namespace-compliance-followups-plan.md`
- `docs/plans/archive/2606231323-run-recap-and-reset-date-plan.md`
- `docs/plans/archive/2606231427-compliance-handoff-access-and-resume-recap-plan.md`
- `docs/plans/archive/2606231521-completions-binary-stdin-fix-plan.md`
- `docs/plans/archive/2606241213-compliance-review-before-phase-details-plan.md`
- `docs/plans/archive/2606241246-validate-config-only-plan.md`
- `docs/plans/archive/2606251332-error-logging-and-reset-fixes-plan.md`
- `docs/plans/archive/2606251446-resumable-handoff-failure-plan.md`
- `docs/plans/archive/2609080902-plan-lint-plan.md`
- `docs/plans/archive/2606260810-resumable-postgate-failures-plan.md`
- `docs/plans/archive/2606260810-decouple-manual-publish-from-config-plan.md`
- `docs/plans/archive/2606260941-remove-last-commands-plan.md`
- `docs/plans/archive/2606260951-review-code-command-plan.md`
- `docs/plans/archive/2606261007-plans-overlap-command-plan.md`
- `docs/plans/archive/2606261047-plan-extraction-cache-plan.md`
- `docs/plans/archive/2606291222-deterministic-plan-extraction-plan.md`
- `docs/plans/archive/2606301550-review-compliance-qualified-name-plan.md`
- `docs/plans/archive/2607020808-security-hardening-plan.md`
- `docs/plans/archive/2607101034-gate-profile-attributed-steps-plan.md`
- `docs/plans/archive/2607101056-typescript-7-migration-plan.md`
- `docs/plans/archive/2608121433-artifact-frontmatter-metadata-plan.md`
- `docs/plans/archive/2608131111-rename-archived-to-completed-plan.md`
- `docs/plans/archive/2608140954-run-carries-completion-plan.md`
- `docs/plans/archive/2608141345-repo-rooting-and-orient-brief-plan.md`
- `docs/plans/archive/2608151146-reconciliation-and-reopen-cleanups-plan.md`
- `docs/plans/archive/2608151524-entire-checkpoint-spike-plan.md`
- `docs/plans/archive/2608201318-phax-run-records-plan.md`
- `docs/plans/archive/2608211104-vibe-target-flag-and-review-code-worklist-plan.md`
- `docs/plans/archive/2608211502-external-gate-steps-plan.md`
- `docs/plans/archive/2609030733-provider-contract-discoverability-plan.md`
- `docs/plans/archive/2609030753-spec-approval-ground-plan.md`
- `docs/plans/archive/2609040953-archive-unfinished-runs-plan.md`
- `docs/plans/archive/2609070758-gate-step-scheduling-plan.md`
- `docs/plans/archive/2609070832-catalog-fable-5-1-opus-5-gpt-6-astra-plan.md`
- `docs/plans/archive/2609090908-plan-completeness-advisory-plan.md`

### Planned files to edit

- `docs/specs/approvals.json`
- `docs/plans/approvals.json`
- `NEXT_STEPS.md`
- `README.md`
- `docs/model-catalog.md`
- `docs/security.md`
- `docs/blog/announcing-phax-1.0.md`
- `docs/spikes/entire-checkpoint-findings.md`
- `src/cli/cliDocs.ts`
- `src/domain/artifact/document.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`

### Optional files that may be edited

- `tests/unit/artifact/document.test.ts`
- `tests/unit/cli/artifact.test.ts`
- `docs/acceptance-coverage.md`
- `docs/cli/inventory.md`
- `CLAUDE.md`

### Test strategy

The guard test is the durable check and is written before the rename so it
fails red on the old tree. The rest is verified by the existing suites
(`tests/integration/artifactStatus.test.ts`, `planStaleness.test.ts`) staying
green and by the manual `phax artifact status` / `phax plans status` checks
recorded in the handoff.

### Implementation order

Guard test (red) → script → run it → reference sweep → approval carry-over →
CLI-contract regeneration → guard test (green) → manual checks → commit with the
mapping table in the body.

### Excluded scope

- Enforcing the grammar anywhere (phase-03). After this phase an old-grammar
  file would still be accepted.
- Restamping fictitious fixture paths in `tests/**` (phase-03).
- Renaming `examples/hello-world/plan.md`, run folders, worktrees, or anything
  under `~/.phax` (spec §7).
- Editing the naming prose in the skills or README (phase-05).

### Verification

- The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- The full old → new mapping (the same table as the commit body).
- The list of every file the reference sweep touched beyond the planned list,
  and the deletions of the 110 old paths, explained as the rename halves of the
  planned creates — this is the one expected reconciliation deviation.
- The `phax artifact status` output for the four live artifacts and the
  `phax plans status` report after migration.

### Commit subject

chore(docs): migrate every spec and plan to timestamp names

### Commit body

Rename the 110 repo-tracked specs and plans, live and archived, from their
`NN-` counter to `<YYMMDDHHMM>-<slug>` using the UTC author minute of the
commit that first added each file, and rewrite every tracked reference to an
old path: approval-record keys and source-spec bindings, plans' `source-spec`,
README, NEXT_STEPS, docs, the CLI example lines and the no-frontmatter error
text. Approvals carry over unchanged. A repository-scan test now guards that no
tracked file outside tests names a pre-migration path and that each artifact
directory lists in creation order. Nothing enforces the grammar yet; that lands
next.

<old → new mapping table>

---

## phase-03 — Enforce the grammar in every reader and the lint {#phase-03-enforce-grammar}

**Recommended model:** claude-opus-5
**Recommended effort:** high

Make every command that reads a repo-tracked artifact refuse an off-grammar
name with exit code 12, make transition commits name the bare slug, and teach
`phax plans lint` the two spec §5.3 rules: a repo-tracked plan is validated like
any artifact, and a plan whose slug differs from its source spec's slug gets an
error finding. Loose `plan.md` files outside `docs/plans/` stay exempt.

### Detailed instructions

- `src/domain/artifact/document.ts` — in `validateArtifact`, after
  `classifyArtifactPath` and before the frontmatter decode, parse the basename
  with `parseArtifactName(kind, basename)`; on `null`, fail with
  `ArtifactValidationError` whose message is
  `<path>: name does not match <artifactNameGrammar(kind)>` (wording
  indicative, exit code and the two named elements normative). Because
  `checkPlanRunnable`, `inspectArtifact`, `transitionArtifact`,
  `plansStalenessReport` and `completeRunArtifacts` all go through
  `validateArtifact`, this one edit reaches `artifact status|approve|stale|
  abandon|complete|reopen`, `plans status`, `phax run` and run-end completion.
  Keep the `classifyArtifactPath(...) === null` short-circuits untouched so a
  loose `plan.md` is never checked.
- `src/domain/artifact/writeSet.ts` — `slugFor()` (used by
  `transitionCommitMessage`) returns the parsed slug, not the whole basename,
  so a transition commit reads `chore(specs): approve artifact-timestamp-naming`
  (spec §5.6: never refer by stamp).
- `src/domain/plan/lint.ts` — add `lineageFindings(planSlug: string,
  sourceSpecSlug: string | null): LintFinding[]`: one `{severity: "error",
  check: "structure", phase: null}` finding when both slugs exist and differ,
  message naming both slugs (`slug "prune" differs from source spec slug
  "plan-prune"`, wording indicative).
- `src/app/lintPlan.ts` — when the plan's repo-relative path classifies as a
  repo-tracked artifact (`classifyArtifactPath !== null`): run
  `validateArtifact` first and surface its `ArtifactValidationError` on the
  error channel (the CLI maps it to exit 12 through `exitCodeForError`); then
  read `source-spec` with `readSourceSpec`, parse both names with
  `parseArtifactName`, and append `lineageFindings`. `LintPlanOptions` gains
  the repo-relative plan path (or `repoRoot`) it needs; `reportPath` keeps its
  meaning. A loose plan skips both steps.
- `src/cli/commands/plans.ts` — pass the new option; no other change if the
  error already maps to 12 (verify in `src/cli/commands/runLayers.ts`
  `exitCodeForError`; add `ArtifactValidationError` to the lint command's
  error union if the types require it).
- `src/cli/cliDocs.ts` — the `plans lint` long help names the lineage rule in
  one sentence; regenerate `pnpm gen:usage-spec` and `pnpm docs:cli`.
- Restamp every fictitious artifact path in the test fixtures listed below to
  the new grammar (e.g. `docs/plans/45-foo-plan.md` →
  `docs/plans/2609101200-foo-plan.md`; pick any well-formed stamp), and add
  cases: `validateArtifact` refuses `docs/specs/34-foo.md` with exit-12 error
  and the grammar in the message; `inspectArtifact` on an off-grammar path;
  `lintPlan` exits 12 on an off-grammar repo-tracked plan, reports the slug
  mismatch as an error, reports nothing for a matching pair, and skips both
  checks for a loose `plan.md`; `transitionCommitMessage` names the bare slug.
- Widen `tests/unit/artifactNamesGuard.test.ts` so the pre-migration-path scan
  covers `tests/**` too (drop the exclusion).

### Planned files to create

- (none)

### Planned files to edit

- `src/domain/artifact/document.ts`
- `src/domain/artifact/writeSet.ts`
- `src/domain/plan/lint.ts`
- `src/app/lintPlan.ts`
- `src/cli/commands/plans.ts`
- `src/cli/cliDocs.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`
- `README.md`
- `tests/unit/artifactNamesGuard.test.ts`
- `tests/unit/planLint.test.ts`
- `tests/unit/planLintRender.test.ts`
- `tests/unit/adjustPlanSession.test.ts`
- `tests/unit/artifact/document.test.ts`
- `tests/unit/artifact/frontmatter.test.ts`
- `tests/unit/artifact/lineage.test.ts`
- `tests/unit/artifact/writeSet.test.ts`
- `tests/unit/cli/artifact.test.ts`
- `tests/unit/cli/artifactStatusRender.test.ts`
- `tests/unit/cli/plans.test.ts`
- `tests/unit/cli/run.test.ts`
- `tests/unit/planOverlap/adjustPrompt.test.ts`
- `tests/unit/schemas/specApprovalRecord.test.ts`
- `tests/integration/adjustPlan.test.ts`
- `tests/integration/artifactStatus.test.ts`
- `tests/integration/completeRunArtifacts.test.ts`
- `tests/integration/lintPlan.test.ts`
- `tests/integration/planStaleness.test.ts`
- `tests/integration/repoRootedCli.test.ts`
- `tests/integration/resumeFromCompletion.test.ts`
- `tests/integration/runCarriesCompletion.test.ts`

### Optional files that may be edited

- `src/cli/commands/runLayers.ts`
- `src/cli/commands/artifact.ts`
- `src/app/artifactStatus.ts`
- `src/app/planStaleness.ts`
- `src/domain/errors.ts`
- `tests/e2e/helpers/artifacts.ts`

### Boundary contracts

- `lintPlan` (app) consumes from the CLI the plan's repo-relative path in
  addition to the absolute read path; it produces the same `LintReport`, plus an
  `ArtifactValidationError` on the error channel for a repo-tracked plan that
  fails artifact validation. The CLI maps that error to exit 12 as it already
  does for the artifact commands.
- `validateArtifact` (domain) now rejects on name before frontmatter; every
  app consumer inherits the refusal without change.

### Test strategy

Domain unit tests first (`document`, `writeSet`, `lint`), then the app-level
`lintPlan` integration tests with the fake filesystem, then the CLI unit tests
asserting exit 12. The fixture restamp is mechanical; run the whole suite after
it and fix names, not behavior.

### Implementation order

`document.ts` + tests → `writeSet.ts` + tests → `lint.ts` + tests →
`lintPlan.ts` + tests → `plans.ts` / `cliDocs.ts` + regeneration → fixture
restamp → guard widening.

### Excluded scope

- The creation command (phase-04).
- Any change to `LintCheck`'s member set or the renderer's column widths.
- Any change to the exit code table beyond what `ArtifactValidationError`
  already gives.

### Verification

- The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- The final `LintPlanOptions` shape and the exact refusal message format, so
  phase-04's CLI tests and phase-05's docs quote them correctly.
- Confirmation that `phax plans lint examples/hello-world/plan.md` still
  behaves as before (loose plan exempt).
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(artifact): enforce timestamp names in every reader and the plan lint

### Commit body

`validateArtifact` now rejects a repo-tracked spec or plan whose file name does
not match `<YYMMDDHHMM>-<slug>.md` / `<YYMMDDHHMM>-<slug>-plan.md`, so
`artifact status|approve|stale|abandon|complete|reopen`, `plans status`,
`phax run` and run-end completion all refuse it with exit code 12, naming the
file and the grammar. Transition commits name the bare slug. `phax plans lint`
validates a repo-tracked plan the same way before linting and reports an error
when the plan's slug differs from its source spec's; a loose `plan.md` outside
`docs/plans/` is exempt from both. Test fixtures move to the new grammar and
the repository-scan guard now covers tests as well.

---

## phase-04 — `phax artifact new spec|plan` {#phase-04-artifact-new}

**Recommended model:** claude-sonnet-5
**Recommended effort:** medium

Let the author create a spec or plan through phax: the file is named from the
current UTC minute and the given slug, carries a frontmatter-only `Draft`
skeleton, and every bad input is refused with exit code 12 before anything is
written.

### Detailed instructions

- `src/domain/errors.ts` — add `ArtifactCreationError extends
  Data.TaggedError("ArtifactCreationError")<{ message: string }>`; map it to
  exit code 12 in `src/cli/commands/runLayers.ts` `exitCodeForError`.
- `src/app/createArtifact.ts` — `createArtifact(input): Effect<{ path: string;
  sourceSpec: string | null }, ArtifactCreationError | FsError, FileSystem>`
  with `input = { kind: ArtifactKind; slug: string; sourceSpec: string | null;
  nowIso: string; repoRoot: string }`:
  1. `isSlug(slug)` or refuse: `slug "<slug>" does not match
     [a-z0-9]+(-[a-z0-9]+)*`.
  2. Target path `docs/specs/<name>` or `docs/plans/<name>` from
     `buildArtifactName(kind, nowIso, slug)`; refuse if it exists.
  3. For a plan with `sourceSpec`: the path must classify as a spec
     (`classifyArtifactPath(...)?.kind === "spec"`, live or archived), exist,
     and `validateArtifact` on it must succeed; otherwise refuse naming the
     reason. `sourceSpec` is stored as given (repo-relative).
  4. Write the frontmatter block only. Spec: `status: Draft`, `date:
     <YYYY-MM-DD of nowIso in UTC>`, `audience: implementation planning with
     Claude Code`, `scope: functional behavior and consumption surface`. Plan:
     `status: Draft`, `source-spec: <path or null>`. Emit exactly the YAML
     shape `decodeSpecFrontmatter` / `decodePlanFrontmatter` accept (both use
     `onExcessProperty: "error"`); assert in a test that `validateArtifact`
     accepts the written file.
  5. Refusals write nothing (check everything before the single write).
- `src/cli/commands/artifact.ts` — register a nested `new` subcommand under
  `artifactCmd` with two nested subcommands `spec <slug>` and `plan <slug>`,
  the latter with `--spec <path>`; capture `nowIso = new Date().toISOString()`
  at the boundary as `runArtifactTransition` does; resolve `--spec` to a
  repo-relative path with `toRepoRelativePath`; print
  `created <path> (Draft)` for a spec and `created <path> (Draft, source-spec
  <path|null>)` for a plan (wording indicative); errors go through the
  existing exit-code mapping. Nested Commander subcommands only — never a
  space-separated command name (see the note at `artifact.ts` on the
  `security.ts` collision).
- `src/cli/cliDocs.ts` — entries `"artifact new"`, `"artifact new spec"`,
  `"artifact new plan"` with long help and the three example lines from spec
  §6; restamp the remaining fictitious example paths in the `plans` entries
  (`docs/plans/33-a.md`, `35-b.md`, `40-other.md`) to the new grammar.
  Regenerate with `pnpm gen:usage-spec` and `pnpm docs:cli`.
- Tests: `tests/integration/createArtifact.test.ts` with `makeFakeFileSystem`
  covering the three happy paths of spec §8 with fixed instants
  (`2026-09-09T14:12:40Z` → `2609091412-plan-prune.md`;
  `2026-09-10T10:30:00Z` → `2609101030-plan-prune-plan.md` with the bound
  source-spec; a plan with `sourceSpec: null`) and each refusal (bad slug,
  existing target, missing spec, a plan path passed as `--spec`), asserting the
  filesystem is untouched on refusal; `tests/unit/cli/artifact.test.ts` for
  the new subcommands' output and exit 12.

### Planned files to create

- `src/app/createArtifact.ts`
- `tests/integration/createArtifact.test.ts`

### Planned files to edit

- `src/domain/errors.ts`
- `src/cli/commands/runLayers.ts`
- `src/cli/commands/artifact.ts`
- `src/cli/cliDocs.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`
- `README.md`
- `tests/unit/cli/artifact.test.ts`

### Optional files that may be edited

- `src/domain/artifact/frontmatter.ts`
- `src/cli/cliCompleters.ts`
- `tests/integration/usageSpecLint.test.ts`
- `docs/cli/inventory.md`

### Boundary contracts

- CLI → app: the CLI supplies `nowIso`, `repoRoot`, the kind, the slug and the
  optional repo-relative spec path; the use case returns the created path and
  the bound source spec, or a tagged error the CLI renders and maps to 12.
- app → port: the only side effects are `FileSystem` exists/read/write.

### Test strategy

Integration tests on the use case with the fake filesystem, written first
(fixed instants make the stamp deterministic); CLI unit tests mocking the use
case for output and exit codes; the usage-spec lint test guards the regenerated
contract.

### Implementation order

Error + exit map → `createArtifact.ts` + tests → CLI subcommands + tests →
`cliDocs.ts` + regeneration.

### Excluded scope

- Any body content beyond the frontmatter block (decided: frontmatter only).
- A `--stamp` or backdating option (spec §7).
- Auto-commit of the created file (transitions commit; creation does not).

### Verification

- The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- The exact `phax artifact new` invocations and their output lines, for
  phase-05 to quote in the skills and README.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(artifact): add `phax artifact new spec|plan` stamped from the clock

### Commit body

`phax artifact new spec <slug>` and `phax artifact new plan <slug> [--spec
<path>]` create a `Draft` artifact named `<YYMMDDHHMM>-<slug>(-plan).md` from
the current UTC minute, with a frontmatter-only skeleton. An invalid slug, an
existing target, or a source spec that is missing or not a spec is refused with
exit code 12 before anything is written. The instant is captured at the CLI
boundary and passed as data, as the other artifact commands do. Covered by
integration tests on the use case with fixed instants and CLI unit tests.

---

## phase-05 — Skills and README teach the grammar and reference-by-slug {#phase-05-skills-and-readme}

**Recommended model:** claude-sonnet-5
**Recommended effort:** low

Update the two shipped skills and the README so an author learns the artifact
name grammar, creates artifacts with `phax artifact new`, and refers to them by
slug in prose, commits and pull requests — and so no `NN-<slug>` file-naming
text remains.

### Detailed instructions

- `.claude/skills/phax-spec/SKILL.md` — rewrite the "File and naming
  convention" section: the grammar for both kinds, "create with `phax artifact
  new spec <slug>`; never compute the stamp yourself", the plan mirrors the
  **slug** (not the name), and the refer-by-slug rule ("spec `plan-prune`",
  never "spec 2609091412"). Update the `NN-<slug>` mention in the lifecycle
  prose if any remains.
- `.claude/skills/phax-planning/SKILL.md` — the frontmatter block example,
  the `phax artifact approve` invocation and the `source-spec` description
  (the three `docs/…/NN-<slug>…` lines) move to the new grammar; add one
  sentence: create the plan file with `phax artifact new plan <slug> --spec
  <spec path>`, then fill it in. **Leave every `{#phase-NN-<slug>}` anchor and
  `## phase-NN` heading untouched** — that `NN` is the phase number, not a file
  name.
- `README.md` — the `phax plans lint docs/plans/NN-<slug>-plan.md` line and
  the surrounding write → lint → run prose use the grammar and mention
  `phax artifact new`; the generated CLI block is already current from
  phase-04, do not hand-edit inside the markers.
- `.claude/skills/phax-cli/SKILL.md` — if it walks the init → plan → run flow
  with an artifact path or the `artifact` group, add the `new` step in one
  line; otherwise leave it.
- Grep the tree for `NN-<slug>` excluding phase anchors and for `docs/specs/NN`
  / `docs/plans/NN`; none may remain.

### Planned files to create

- (none)

### Planned files to edit

- `.claude/skills/phax-spec/SKILL.md`
- `.claude/skills/phax-planning/SKILL.md`
- `README.md`

### Optional files that may be edited

- `.claude/skills/phax-cli/SKILL.md`
- `docs/cli/inventory.md`
- `CLAUDE.md`

### Test strategy

No new tests; the gates cover formatting. The spec's AC "Skills reference by
slug" is verified by the grep in the last instruction, recorded in the handoff.

### Implementation order

`phax-spec` → `phax-planning` → README → sweep grep.

### Excluded scope

- Regenerating the CLI reference (done in phase-04).
- Any change to the phase-heading contract of the planning skill.

### Verification

- The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- The grep results showing no remaining `NN-<slug>` file-naming text outside
  phase anchors.
- Any deviation from the planned file lists, with the reason.

### Commit subject

docs(skills): teach the timestamp artifact names and reference-by-slug

### Commit body

The `phax-spec` and `phax-planning` skills and the README now state the
`<YYMMDDHHMM>-<slug>` grammar, tell authors to create artifacts with
`phax artifact new` instead of picking a counter, and to refer to a spec or plan
by its slug in prose, commits and pull requests. Phase anchors keep their `NN`.

---

## Appendix — migration mapping (informational)

Computed 2026-09-10 against `main` @ `0a28a30` from first-commit author times;
phase-02 recomputes it at run time and must obtain the same result.

| Old path | New path |
| --- | --- |
| `docs/specs/23-phase-decision-requests.md` | `docs/specs/2608091526-phase-decision-requests.md` |
| `docs/specs/24-batch-execution-disjoint-plans.md` | `docs/specs/2608091526-batch-execution-disjoint-plans.md` |
| `docs/specs/archive/01-feedback_ingest_spec.md` | `docs/specs/archive/2605210819-feedback-ingest.md` |
| `docs/specs/archive/02-phax-planning-skill-update.md` | `docs/specs/archive/2606030721-phax-planning-skill-update.md` |
| `docs/specs/archive/03-update-provider-effort.md` | `docs/specs/archive/2606031656-update-provider-effort.md` |
| `docs/specs/archive/04-run-jail.md` | `docs/specs/archive/2606041211-run-jail.md` |
| `docs/specs/archive/05-review-handoff.md` | `docs/specs/archive/2606051414-review-handoff.md` |
| `docs/specs/archive/06-deno-runtime.md` | `docs/specs/archive/2606120941-deno-runtime.md` |
| `docs/specs/archive/07-push-branch-pr.md` | `docs/specs/archive/2606120941-push-branch-pr.md` |
| `docs/specs/archive/08-install-planning-skill.md` | `docs/specs/archive/2606150842-install-planning-skill.md` |
| `docs/specs/archive/09-agent-commands.md` | `docs/specs/archive/2606150841-agent-commands.md` |
| `docs/specs/archive/10-init-command.md` | `docs/specs/archive/2606181052-init-command.md` |
| `docs/specs/archive/11-lock-agent-binding-phase.md` | `docs/specs/archive/2606181006-lock-agent-binding-phase.md` |
| `docs/specs/archive/12-project-namespace.md` | `docs/specs/archive/2606181037-project-namespace.md` |
| `docs/specs/archive/13-usage-cli.md` | `docs/specs/archive/2606181003-usage-cli.md` |
| `docs/specs/archive/14-remove-network-controls.md` | `docs/specs/archive/2606171452-remove-network-controls.md` |
| `docs/specs/archive/15-gate-profile-attributed-steps.md` | `docs/specs/archive/2607031249-gate-profile-attributed-steps.md` |
| `docs/specs/archive/16-external-gate-steps.md` | `docs/specs/archive/2607031249-external-gate-steps.md` |
| `docs/specs/archive/17-brief-profile-orient.md` | `docs/specs/archive/2607031249-brief-profile-orient.md` |
| `docs/specs/archive/18-gate-step-scheduling.md` | `docs/specs/archive/2607031249-gate-step-scheduling.md` |
| `docs/specs/archive/19-plan-completeness-advisory.md` | `docs/specs/archive/2607031249-plan-completeness-advisory.md` |
| `docs/specs/archive/20-model-catalog-equivalence-routing.md` | `docs/specs/archive/2607101341-model-catalog-equivalence-routing.md` |
| `docs/specs/archive/21-artifact-lifecycle-status.md` | `docs/specs/archive/2608091526-artifact-lifecycle-status.md` |
| `docs/specs/archive/22-plan-staleness-lineage.md` | `docs/specs/archive/2608091526-plan-staleness-lineage.md` |
| `docs/specs/archive/25-artifact-transition-autocommit.md` | `docs/specs/archive/2608110911-artifact-transition-autocommit.md` |
| `docs/specs/archive/26-artifact-frontmatter-metadata.md` | `docs/specs/archive/2608110950-artifact-frontmatter-metadata.md` |
| `docs/specs/archive/27-run-carries-archival.md` | `docs/specs/archive/2608121241-run-carries-archival.md` |
| `docs/specs/archive/28-rename-archived-to-completed.md` | `docs/specs/archive/2608121241-rename-archived-to-completed.md` |
| `docs/specs/archive/29-phax-run-records.md` | `docs/specs/archive/2608201245-phax-run-records.md` |
| `docs/specs/archive/30-provider-contract-discoverability.md` | `docs/specs/archive/2609030725-provider-contract-discoverability.md` |
| `docs/specs/archive/31-spec-approval-ground.md` | `docs/specs/archive/2609030749-spec-approval-ground.md` |
| `docs/specs/archive/32-archive-unfinished-runs.md` | `docs/specs/archive/2609030829-archive-unfinished-runs.md` |
| `docs/specs/archive/33-plan-lint.md` | `docs/specs/archive/2609080848-plan-lint.md` |
| `docs/plans/39-smolvm-isolation-spike-plan.md` | `docs/plans/2606291247-smolvm-isolation-spike-plan.md` |
| `docs/plans/41-claude-protected-path-approval-hook-plan.md` | `docs/plans/2606301114-claude-protected-path-approval-hook-plan.md` |
| `docs/plans/archive/01-plan.md` | `docs/plans/archive/2605111617-phax-cli-plan.md` |
| `docs/plans/archive/02-phax-planning-skill-update-plan.md` | `docs/plans/archive/2606030721-phax-planning-skill-update-plan.md` |
| `docs/plans/archive/03-update-provider-effort-plan.md` | `docs/plans/archive/2606031656-update-provider-effort-plan.md` |
| `docs/plans/archive/03b-provider-e2e-validation.md` | `docs/plans/archive/2606031656-provider-e2e-validation-plan.md` |
| `docs/plans/archive/04-run-jail-plan.md` | `docs/plans/archive/2606041211-run-jail-plan.md` |
| `docs/plans/archive/04b-run-jail-provider-validation.md` | `docs/plans/archive/2606041211-run-jail-provider-validation-plan.md` |
| `docs/plans/archive/05-model-routing-enabled-gating-plan.md` | `docs/plans/archive/2606021303-model-routing-enabled-gating-plan.md` |
| `docs/plans/archive/06-model-routing-plan.md` | `docs/plans/archive/2606010707-model-routing-plan.md` |
| `docs/plans/archive/07-observability-plan.md` | `docs/plans/archive/2605251225-observability-plan.md` |
| `docs/plans/archive/08-provider-priority-override-plan.md` | `docs/plans/archive/2606021307-provider-priority-override-plan.md` |
| `docs/plans/archive/09-agent-commands.md` | `docs/plans/archive/2606150841-agent-commands-plan.md` |
| `docs/plans/archive/09-rename-claude-backend-errors-plan.md` | `docs/plans/archive/2606020811-rename-claude-backend-errors-plan.md` |
| `docs/plans/archive/10-init-command-plan.md` | `docs/plans/archive/2606181052-init-command-plan.md` |
| `docs/plans/archive/10-opus-frontier-tiers-plan.md` | `docs/plans/archive/2606080819-opus-frontier-tiers-plan.md` |
| `docs/plans/archive/11-lock-agent-binding-phase-plan.md` | `docs/plans/archive/2606181006-lock-agent-binding-phase-plan.md` |
| `docs/plans/archive/11-review-handoff-plan.md` | `docs/plans/archive/2606090853-review-handoff-plan.md` |
| `docs/plans/archive/12-gate-first-resume-plan.md` | `docs/plans/archive/2606100823-gate-first-resume-plan.md` |
| `docs/plans/archive/12-project-namespace-plan.md` | `docs/plans/archive/2606181037-project-namespace-plan.md` |
| `docs/plans/archive/13-reset-phase-command-plan.md` | `docs/plans/archive/2606100823-reset-phase-command-plan.md` |
| `docs/plans/archive/13-usage-cli-plan.md` | `docs/plans/archive/2606181003-usage-cli-plan.md` |
| `docs/plans/archive/14-push-branch-pr-plan.md` | `docs/plans/archive/2606120941-push-branch-pr-plan.md` |
| `docs/plans/archive/14-remove-last-commands-plan.md` | `docs/plans/archive/2606181006-remove-last-commands-plan.md` |
| `docs/plans/archive/15-agent-binding-hardening-plan.md` | `docs/plans/archive/2606181309-agent-binding-hardening-plan.md` |
| `docs/plans/archive/15-typescript-6-migration-plan.md` | `docs/plans/archive/2606120941-typescript-6-migration-plan.md` |
| `docs/plans/archive/16-deno-runtime-plan.md` | `docs/plans/archive/2606120941-deno-runtime-plan.md` |
| `docs/plans/archive/16-enforce-architecture-boundaries-plan.md` | `docs/plans/archive/2606181309-enforce-architecture-boundaries-plan.md` |
| `docs/plans/archive/17-brief-profile-orient-plan.md` | `docs/plans/archive/2607221702-brief-profile-orient-plan.md` |
| `docs/plans/archive/17-install-planning-skill-plan.md` | `docs/plans/archive/2606150842-install-planning-skill-plan.md` |
| `docs/plans/archive/17-sealed-completion-extraction-plan.md` | `docs/plans/archive/2606181519-sealed-completion-extraction-plan.md` |
| `docs/plans/archive/18-local-telemetry-report-plan.md` | `docs/plans/archive/2606190939-local-telemetry-report-plan.md` |
| `docs/plans/archive/19-whats-next-guidance-plan.md` | `docs/plans/archive/2606191404-whats-next-guidance-plan.md` |
| `docs/plans/archive/20-compliance-review-plan.md` | `docs/plans/archive/2606191439-compliance-review-plan.md` |
| `docs/plans/archive/20-model-catalog-equivalence-routing-plan.md` | `docs/plans/archive/2607101348-model-catalog-equivalence-routing-plan.md` |
| `docs/plans/archive/21-artifact-lifecycle-status-plan.md` | `docs/plans/archive/2608101018-artifact-lifecycle-status-plan.md` |
| `docs/plans/archive/21-usage-spec-generation-hardening-plan.md` | `docs/plans/archive/2606191401-usage-spec-generation-hardening-plan.md` |
| `docs/plans/archive/22-config-user-project-split-plan.md` | `docs/plans/archive/2606191452-config-user-project-split-plan.md` |
| `docs/plans/archive/22-plan-staleness-lineage-plan.md` | `docs/plans/archive/2608101529-plan-staleness-lineage-plan.md` |
| `docs/plans/archive/23-handoff-deviation-justification-plan.md` | `docs/plans/archive/2606191529-handoff-deviation-justification-plan.md` |
| `docs/plans/archive/24-interactive-init-plan.md` | `docs/plans/archive/2606230730-interactive-init-plan.md` |
| `docs/plans/archive/25-artifact-transition-autocommit-plan.md` | `docs/plans/archive/2608110919-artifact-transition-autocommit-plan.md` |
| `docs/plans/archive/25-namespace-compliance-followups-plan.md` | `docs/plans/archive/2606230858-namespace-compliance-followups-plan.md` |
| `docs/plans/archive/26-run-recap-and-reset-date-plan.md` | `docs/plans/archive/2606231323-run-recap-and-reset-date-plan.md` |
| `docs/plans/archive/27-compliance-handoff-access-and-resume-recap-plan.md` | `docs/plans/archive/2606231427-compliance-handoff-access-and-resume-recap-plan.md` |
| `docs/plans/archive/28-completions-binary-stdin-fix-plan.md` | `docs/plans/archive/2606231521-completions-binary-stdin-fix-plan.md` |
| `docs/plans/archive/29-compliance-review-before-phase-details-plan.md` | `docs/plans/archive/2606241213-compliance-review-before-phase-details-plan.md` |
| `docs/plans/archive/30-validate-config-only-plan.md` | `docs/plans/archive/2606241246-validate-config-only-plan.md` |
| `docs/plans/archive/31-error-logging-and-reset-fixes-plan.md` | `docs/plans/archive/2606251332-error-logging-and-reset-fixes-plan.md` |
| `docs/plans/archive/32-resumable-handoff-failure-plan.md` | `docs/plans/archive/2606251446-resumable-handoff-failure-plan.md` |
| `docs/plans/archive/33-plan-lint-plan.md` | `docs/plans/archive/2609080902-plan-lint-plan.md` |
| `docs/plans/archive/33-resumable-postgate-failures.md` | `docs/plans/archive/2606260810-resumable-postgate-failures-plan.md` |
| `docs/plans/archive/34-decouple-manual-publish-from-config.md` | `docs/plans/archive/2606260810-decouple-manual-publish-from-config-plan.md` |
| `docs/plans/archive/35-remove-last-commands.md` | `docs/plans/archive/2606260941-remove-last-commands-plan.md` |
| `docs/plans/archive/36-review-code-command-plan.md` | `docs/plans/archive/2606260951-review-code-command-plan.md` |
| `docs/plans/archive/37-plans-overlap-command-plan.md` | `docs/plans/archive/2606261007-plans-overlap-command-plan.md` |
| `docs/plans/archive/38-plan-extraction-cache-plan.md` | `docs/plans/archive/2606261047-plan-extraction-cache-plan.md` |
| `docs/plans/archive/40-deterministic-plan-extraction-plan.md` | `docs/plans/archive/2606291222-deterministic-plan-extraction-plan.md` |
| `docs/plans/archive/42-review-compliance-qualified-name-plan.md` | `docs/plans/archive/2606301550-review-compliance-qualified-name-plan.md` |
| `docs/plans/archive/43-security-hardening-plan.md` | `docs/plans/archive/2607020808-security-hardening-plan.md` |
| `docs/plans/archive/44-gate-profile-attributed-steps-plan.md` | `docs/plans/archive/2607101034-gate-profile-attributed-steps-plan.md` |
| `docs/plans/archive/45-typescript-7-migration-plan.md` | `docs/plans/archive/2607101056-typescript-7-migration-plan.md` |
| `docs/plans/archive/46-artifact-frontmatter-metadata-plan.md` | `docs/plans/archive/2608121433-artifact-frontmatter-metadata-plan.md` |
| `docs/plans/archive/47-rename-archived-to-completed-plan.md` | `docs/plans/archive/2608131111-rename-archived-to-completed-plan.md` |
| `docs/plans/archive/48-run-carries-completion-plan.md` | `docs/plans/archive/2608140954-run-carries-completion-plan.md` |
| `docs/plans/archive/49-repo-rooting-and-orient-brief-plan.md` | `docs/plans/archive/2608141345-repo-rooting-and-orient-brief-plan.md` |
| `docs/plans/archive/50-reconciliation-and-reopen-cleanups-plan.md` | `docs/plans/archive/2608151146-reconciliation-and-reopen-cleanups-plan.md` |
| `docs/plans/archive/51-entire-checkpoint-spike-plan.md` | `docs/plans/archive/2608151524-entire-checkpoint-spike-plan.md` |
| `docs/plans/archive/52-phax-run-records-plan.md` | `docs/plans/archive/2608201318-phax-run-records-plan.md` |
| `docs/plans/archive/53-vibe-target-flag-and-review-code-worklist-plan.md` | `docs/plans/archive/2608211104-vibe-target-flag-and-review-code-worklist-plan.md` |
| `docs/plans/archive/54-external-gate-steps-plan.md` | `docs/plans/archive/2608211502-external-gate-steps-plan.md` |
| `docs/plans/archive/55-provider-contract-discoverability-plan.md` | `docs/plans/archive/2609030733-provider-contract-discoverability-plan.md` |
| `docs/plans/archive/56-spec-approval-ground-plan.md` | `docs/plans/archive/2609030753-spec-approval-ground-plan.md` |
| `docs/plans/archive/57-archive-unfinished-runs-plan.md` | `docs/plans/archive/2609040953-archive-unfinished-runs-plan.md` |
| `docs/plans/archive/58-gate-step-scheduling-plan.md` | `docs/plans/archive/2609070758-gate-step-scheduling-plan.md` |
| `docs/plans/archive/59-catalog-fable-5-1-opus-5-gpt-6-astra-plan.md` | `docs/plans/archive/2609070832-catalog-fable-5-1-opus-5-gpt-6-astra-plan.md` |
| `docs/plans/archive/60-plan-completeness-advisory-plan.md` | `docs/plans/archive/2609090908-plan-completeness-advisory-plan.md` |
