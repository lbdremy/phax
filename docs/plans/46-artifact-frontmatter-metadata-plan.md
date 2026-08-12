# Artifact Frontmatter Metadata

Status: Draft

Source-Spec: docs/specs/26-artifact-frontmatter-metadata.md

## Overview

Replace the free-paragraph header micro-format on specs and plans with a single YAML
frontmatter block, decoded through an Effect Schema at the boundary with an exact
per-kind key set. Three phases:

1. **phase-01** adds the frontmatter primitives (split, decode, surgical rewrite,
   fingerprint source) and teaches the deterministic extractor to skip a frontmatter
   block. Nothing changes about what validation accepts — this phase is pure addition,
   so the repo's own artifacts keep validating on their header lines.
2. **phase-02** flips every consumer to frontmatter-only **and** migrates all 90
   repository artifacts plus `docs/plans/approvals.json` in the same commit. Fused
   deliberately: the moment validation requires frontmatter, this repo's own docs must
   have it, or `phax run` / `phax artifact` / `phax plans` reject the repo they live in.
3. **phase-03** updates the authoring surface — the `phax-spec` and `phax-planning`
   skills, the CLI help text and its generated docs, and the shipped example plan.

Sequencing note: spec 25 (artifact transition auto-commit) has landed, so phase-02
builds on the committed `transitionWriteSet` / `finalizeTransition` write path rather
than reworking it.

Execution-model caveat for phase-02: the phase's own plan file
(`docs/plans/46-artifact-frontmatter-metadata-plan.md`) is one of the artifacts being
migrated, and its approval record must be recomputed along with the rest. The run gate
is only evaluated at `phax run` start, so this is safe mid-run; but a *new* run started
from the branch between phase-01 and phase-02 would be evaluated against half-migrated
docs. Do not start a second run off this branch until phase-02 is committed.

## Technical arbitrations

- **YAML parsing: the `yaml` dependency, not a hand-rolled parser.** Accepted loss: the
  repo's near-zero-dependency posture gains a full YAML 1.2 implementation for a 5-key
  format, and that dependency must stay green under the `deno:smoke` / binary-build
  gates. Bought: real YAML conformance and `parseDocument`-based surgical edits that
  leave untouched keys and comments byte-stable, which §5.4 requires.
- **Extractor: pre-split frontmatter before mdast, no mdast frontmatter extensions.**
  Accepted loss: the metadata is no longer present in the mdast tree at all, so a future
  in-tree consumer must go back through the splitter. Bought: one parse concept shared
  with validation, and no second and third dependency. (Without this, the block parses
  as a `thematicBreak` plus a **setext h2** — verified against the installed
  `mdast-util-from-markdown` — which would corrupt preamble and phase collection.)
- **Migration: a throwaway script, deleted before the commit.** Accepted loss: the
  transform that produced the 90-file diff is not reviewable, only its result. Bought:
  reliability across 90 near-identical edits and a fingerprint recompute that must be
  exact, without a one-shot migrator persisting in `scripts/` forever (spec §7 non-goal).
- **Phase split: code flip and repo migration fused into phase-02.** Accepted loss: one
  large commit (consumer switch + 90 artifacts + `approvals.json`). Bought: every commit
  on the branch leaves the repo self-consistent with its own tooling.
- **Fingerprint source is a re-emitted frontmatter block with `status` and `approved`
  deleted, plus the raw body.** Accepted loss: a pure restyling of another key (re-quoting
  `source-spec`) becomes fingerprint-neutral where raw-line excision would have caught it.
  Bought: a precise, one-code-path definition of "exactly these two keys excluded" (§5.6)
  with no line-extent arithmetic over the `approved` mapping's indented children.
- **The 12 archived specs that never carried `Date`/`Audience`/`Scope` get synthesized
  values.** §5.2 makes those keys required for every spec including archived ones, so
  migration writes `date:` from the file's git add-date
  (`git log --diff-filter=A --format=%ad --date=short -- <file> | tail -1`) and the
  literal `(unrecorded)` for a missing `audience` or `scope`. Accepted loss: three keys
  on old specs carry a placeholder rather than history that was never written down.
- **The `approved` key is schema-optional, against the repo's "new fields are required"
  doctrine.** §6 makes its absence normative for a never-approved plan, so optionality
  here encodes a real state rather than tolerating old data.

## Required commands

- pnpm add
- pnpm exec tsx
- pnpm gen:usage-spec
- pnpm docs:cli

## Required PHAX security configuration changes

`pnpm add`, `pnpm gen:usage-spec`, and `pnpm docs:cli` are already present in
`security.agentCommands` in `phax.json`. One entry must be added before running:

- `pnpm exec tsx`

phase-02 runs its throwaway migration script through it. Without this entry the
preflight check fails before any agent spawns, and phase-02 has no way to execute the
migration over 90 files.

## phase-01 — Frontmatter primitives and frontmatter-aware extraction {#phase-01-frontmatter-primitives}

**Recommended model:** claude-sonnet-5
**Recommended effort:** high

Add the domain primitives that read, rewrite, and fingerprint a YAML frontmatter block,
and make the deterministic plan extractor treat such a block as metadata rather than
Markdown. No consumer changes behavior yet: after this phase the repo's artifacts still
validate on their header lines exactly as before.

### Detailed instructions

- Add the dependency: `pnpm add yaml`. It is pure ESM JavaScript, so it must keep the
  `deno:smoke` and `deno:smoke-binary` gate steps green — do not add Node-only imports
  around it.
- Create `src/domain/artifact/frontmatter.ts`. It is domain code: pure, no port access,
  no `node:` imports. Export:
  - `splitFrontmatter(md: string): { readonly yamlText: string; readonly body: string } | null`
    — returns non-null only when the file begins with the exact bytes `---\n` at offset 0
    and a later line is exactly `---`. `yamlText` is everything between the delimiters;
    `body` is everything after the closing delimiter's newline, verbatim. A leading blank
    line, leading whitespace, or a missing closing delimiter yields `null`.
  - `decodeArtifactFrontmatter(kind: ArtifactKind, md: string): Either.Either<SpecFrontmatter | PlanFrontmatter, FrontmatterProblem>`
    — split, YAML-parse, then decode through the schema below.
  - `FrontmatterProblem` as an explicit discriminated union, one variant per failure the
    callers must word differently — `{ kind: "missing-block" }`,
    `{ kind: "yaml-syntax"; detail: string }`, `{ kind: "schema"; detail: string }`. Do
    not collapse them into a single string-carrying error; phase-02 renders distinct
    messages per §6 from these variants.
  - `setFrontmatterKeys(md: string, edits: readonly FrontmatterEdit[]): Either.Either<string, FrontmatterProblem>`
    — `parseDocument(yamlText)`, apply the edits with `doc.set(key, value)` /
    `doc.delete(key)`, re-emit with `doc.toString()`, and reassemble
    `` `---\n${emitted}---\n${body}` ``. The `body` string must be concatenated
    untouched — §5.4 requires it byte-for-byte identical. Model the edits as explicit
    variants, not an open record:
    `type FrontmatterEdit = { key: "status"; value: string } | { key: "approved"; value: { date: string; baseline: string } }`.
  - `fingerprintSource(md: string): string` — split, `parseDocument`, `doc.delete("status")`,
    `doc.delete("approved")`, then return the re-emitted block plus the raw body. When
    there is no frontmatter block, return `md` verbatim and say so in a comment: the only
    callers fingerprint artifacts that validation has already accepted.
  - Reject a `parseDocument` result whose `errors` array is non-empty, and one whose
    contents is not a mapping, as `yaml-syntax` — a body that merely happens to open with
    a thematic break must not be mistaken for metadata.
- Create `src/schemas/artifactFrontmatter.ts` with the exact per-kind key sets from §5.2,
  reusing `SpecStatusSchema` / `PlanStatusSchema` from `src/schemas/artifactStatus.ts`:
  - spec: `status`, `date`, `audience`, `scope` — the last three `Schema.String`,
    free-form per §6.
  - plan: `status`, `source-spec` as `Schema.NullOr(Schema.NonEmptyString)`, and
    `approved` as an optional `Schema.Struct({ date: Schema.String, baseline: Schema.NonEmptyString })`.
  - Decode with `onExcessProperty: "error"` so an unknown key fails and the key name
    reaches the message. Format failures through `formatParseError` in
    `src/schemas/formatError.ts` so the offending key path is in `detail`.
- Make the extractor frontmatter-aware in `src/domain/plan/parsePlanMarkdown.ts`:
  `extractPlanDeterministic` splits first, feeds `body` to `fromMarkdown`, and passes
  `body` (not `planMd`) to both offset-slicing call sites — `readRecommendedFields` and
  `extractCommitBody`, whose `position.offset` values must index the same string that was
  parsed. With no frontmatter, `body` is `md` and today's behavior is unchanged.
- Watch two YAML value hazards and pin them with tests rather than assumptions:
  `date: 2026-08-11` must decode as the string `"2026-08-11"` (the default YAML 1.2 core
  schema has no timestamp type), and an all-digit short baseline such as `1234567` must
  round-trip as a string — rely on the emitter quoting it on write, and let the schema
  reject an unquoted numeric baseline rather than coercing it.

### Planned files to create

- `src/domain/artifact/frontmatter.ts`
- `src/schemas/artifactFrontmatter.ts`
- `tests/unit/artifact/frontmatter.test.ts`

### Planned files to edit

- `package.json`
- `pnpm-lock.yaml`
- `src/domain/plan/parsePlanMarkdown.ts`
- `tests/unit/parsePlanMarkdown.test.ts`

### Optional files that may be edited

- `knip.json`

### Boundary contracts

- **Producer `src/domain/artifact/frontmatter.ts` → consumers (phase-02).** phase-02's
  `document.ts`, `lineage.ts`, and `artifactStatus.ts` need exactly four capabilities:
  decode-with-typed-failure, surgical key rewrite, the approval-stamp write, and the
  fingerprint source. Keep those four exports stable; keep `splitFrontmatter` exported
  too, since the extractor consumes it directly.
- **Producer `src/schemas/artifactFrontmatter.ts` → domain.** External file content
  crosses into the domain only as a decoded, typed value — the schema is the boundary,
  per the validation-boundaries rule. The domain module must not hand raw `unknown`
  YAML output to any caller.

### Test strategy

Unit tests (domain, pure) written before the implementation, since these are the stable
contracts phase-02 builds on:

- `splitFrontmatter`: block at offset 0 accepted; leading blank line, leading spaces,
  and missing closing `---` each yield `null`; body preserved byte-for-byte including
  trailing newline; a document whose body contains `---` separators after a real block
  splits at the first closing delimiter.
- Decode: valid spec and plan key sets; unknown key fails with the key name in `detail`;
  missing `source-spec` fails naming it; `source-spec: null` decodes as `null`;
  `approved` absent is valid; `approved` present decodes as the mapping; a bad `status`
  value fails.
- `setFrontmatterKeys`: rewriting `status` leaves other keys, comments, and the entire
  body byte-identical; `approved` upsert replaces a previous value in place; a numeric-
  looking baseline is emitted quoted and re-decodes as a string.
- `fingerprintSource`: identical for two documents differing only in `status`, only in
  `approved`, or in both; different when `source-spec` value differs; different when the
  body differs.
- Extraction: add a frontmatter-carrying variant of an existing fixture to
  `tests/unit/parsePlanMarkdown.test.ts` and assert it extracts the identical
  `ExtractedPhaxPlan` as the header-line variant — including the commit body, which is
  the offset-sliced field most likely to break.

### Implementation order

Schema, then the domain frontmatter module, then the extractor split.

### Excluded scope

- Any change to `validateArtifact`, `readStatusLine`, `readSourceSpecLine`,
  `upsertApprovedLine`, or `fingerprintableContent` — the header-line path stays live and
  authoritative until phase-02.
- Migrating any artifact, fixture, or example file.
- Skill, README, and CLI-help updates (phase-03).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact export names and signatures of `src/domain/artifact/frontmatter.ts` and
  `src/schemas/artifactFrontmatter.ts`, including the `FrontmatterProblem` and
  `FrontmatterEdit` variant shapes phase-02 must switch on.
- The installed `yaml` version, and confirmation that `deno:smoke` and
  `deno:smoke-binary` passed with it.
- Whether `fingerprintSource`'s re-emission changed any YAML styling for the shapes
  tested (quoting or indentation), since phase-02's fingerprint recompute depends on it.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(artifact): add YAML frontmatter primitives and frontmatter-aware extraction

### Commit body

Add a domain frontmatter module (split, decode, surgical key rewrite, fingerprint
source) backed by an Effect Schema with exact per-kind key sets, and teach the
deterministic plan extractor to parse the Markdown body rather than the metadata block —
without a frontmatter block it would parse as a thematic break plus a setext h2.

No consumer switches yet: header-line metadata remains authoritative, so the repository's
own artifacts keep validating unchanged. Covered by unit tests for the splitter, decode
failures, byte-stable rewrites, fingerprint neutrality, and extraction parity between a
frontmatter plan and its header-line equivalent.

## phase-02 — Frontmatter-only lifecycle metadata and repository migration {#phase-02-frontmatter-only}

**Recommended model:** claude-opus-4-8
**Recommended effort:** high

Make YAML frontmatter the sole metadata carrier — header lines are rejected, not
tolerated — and convert every one of this repository's 90 live and archived artifacts
plus `docs/plans/approvals.json` in the same commit, so no commit on the branch leaves
the repo unreadable by its own tooling.

### Detailed instructions

Code switch:

- `src/domain/artifact/document.ts`: delete `readStatusLine` and `replaceStatusLine`
  along with the `headerLines` / `H2_PATTERN` scan. `validateArtifact` keeps its
  signature and its path-classification, terminal-status ⇔ `archive/`, and status-set
  rules (§5.3), but sources `status` from `decodeArtifactFrontmatter`. Render one message
  per `FrontmatterProblem` variant, per §6 (wording indicative, exit behavior normative):
  - `missing-block` → `<path> has no frontmatter block — lifecycle metadata must be YAML
    frontmatter (see docs/specs/26-artifact-frontmatter-metadata.md)`
  - `schema` → name the offending key and list the allowed set for that kind, e.g.
    `<path>: unknown frontmatter key "staus" (allowed for a spec: status, date, audience, scope)`
  - `yaml-syntax` → name the file and the parser's complaint.
  Keep failing through `ArtifactValidationError` with its existing `path` / `message`
  fields.
- The plan's `source-spec` check moves into the schema decode: a plan missing the key now
  fails as a schema problem, so drop the separate `readSourceSpecLine(md) === null` branch
  at the end of `validateArtifact`.
- `src/domain/artifact/lineage.ts`: replace `readSourceSpecLine` with a frontmatter read
  returning the same `SourceSpecDeclaration` union (`source-spec: null` → `{ kind: "none" }`,
  a string → `{ kind: "spec", path }`); replace `upsertApprovedLine` with a
  `setFrontmatterKeys` call writing the `approved` mapping (`date` = the `nowIso` date
  part, `baseline` = the 7-char short SHA) and replacing any previous value (§5.5);
  re-point `fingerprintableContent` at `fingerprintSource`, or delete it and have
  `src/app/approvalRecordStore.ts` import `fingerprintSource` directly. Remove the three
  header-line regexes and the insertion heuristic entirely.
- `src/app/artifactStatus.ts`: `transitionArtifact` rewrites the `status` key through
  `setFrontmatterKeys` instead of `replaceStatusLine`, and stamps `approved` through the
  new lineage helper. Nothing else in the transition changes — the write set, the
  dirty-path precondition, the archive move, and the path-scoped commit from spec 25 stay
  as they are. `checkPlanRunnable` reads the status from frontmatter; update its
  no-metadata message from `has no "Status:" line` to the frontmatter wording, keeping
  `PlanNotApprovedError`'s `status: "missing"` / `"invalid"` discriminants.
- Fail loudly on a rewrite that cannot find its block: `setFrontmatterKeys` returning a
  problem must surface as `ArtifactValidationError`, never as a silent no-op return of
  the original text (today's `replaceStatusLine` returns `md` unchanged when it finds no
  line — do not carry that behavior forward).

Repository migration, in this order:

- Write a throwaway migration script at the worktree root (for example
  `migrate-frontmatter.ts`) and run it with `pnpm exec tsx`. **Delete it before
  committing** — it must not appear in the diff.
- The script converts every path listed under *Planned files to edit* below that lives in
  `docs/specs/`, `docs/specs/archive/`, `docs/plans/`, `docs/plans/archive/`, plus
  `tests/e2e/fixtures/minimal-repo/plan.md`. For each file: read the header lines between
  the `# ` title and the first `## `, emit a frontmatter block at offset 0 in the §6 key
  order (specs: `status`, `date`, `audience`, `scope`; plans: `status`, `source-spec`,
  then `approved` only if an `Approved:` line existed), delete the consumed header lines,
  and leave the rest of the document — title, blank lines, body — untouched.
- `Source-Spec: (none)` becomes `source-spec: null`. The single existing
  `Approved: 2026-08-11 @ 4ae687b` line becomes the `approved` mapping with `date` and
  `baseline`. Quote `baseline` on write.
- For the 12 archived specs with no `Date`/`Audience`/`Scope` header lines, synthesize:
  `date` from `git log --diff-filter=A --format=%ad --date=short -- <file> | tail -1`
  (fall back to the earliest commit date touching the file if the add-commit is not
  found), and the literal `(unrecorded)` for each missing `audience` / `scope`.
- Then recompute `docs/plans/approvals.json`: for **every** record in the file — iterate
  the records, do not hardcode a list — recompute `planFingerprint` from the migrated
  plan with the new `artifactFingerprint`, and recompute `sourceSpec.fingerprint` from
  the migrated spec at its resolved path. Leave `approvedAt`, `baseline`, and
  `sourceSpec.path` untouched, and keep the file's existing key order and formatting
  shape (§7: the record schema does not change). This plan's own record is one of them.
- Verify §5.8 by hand before committing: run `pnpm dev plans` and confirm no plan is
  reported stale with reason `self-changed` or `spec-changed`. A `ground-changed` verdict
  from this phase's real source edits is legitimate signal, not migration-induced — do
  not chase it, and say which plans show it in the handoff.

Tests: update the fixtures and message assertions in the files listed below. The
header-line fixtures in them are the specification of the old format; replace each with
its frontmatter equivalent rather than adding a second variant, and add the §8 cases that
are new — an unknown key, a missing `source-spec`, and a header-line-only artifact
rejected with the missing-block message.

### Planned files to create

- (none)

### Planned files to edit

- `src/domain/artifact/document.ts`
- `src/domain/artifact/lineage.ts`
- `src/app/artifactStatus.ts`
- `src/app/approvalRecordStore.ts`
- `tests/unit/artifact/document.test.ts`
- `tests/unit/artifact/lineage.test.ts`
- `tests/unit/cli/artifact.test.ts`
- `tests/unit/cli/run.test.ts`
- `tests/integration/artifactStatus.test.ts`
- `tests/integration/planStaleness.test.ts`
- `tests/integration/cliErrors.test.ts`
- `tests/integration/loadOrExtractPlan.test.ts`
- `tests/e2e/fixtures/minimal-repo/plan.md`
- `docs/plans/approvals.json`
- `docs/specs/15-gate-profile-attributed-steps.md`
- `docs/specs/16-external-gate-steps.md`
- `docs/specs/18-gate-step-scheduling.md`
- `docs/specs/19-plan-completeness-advisory.md`
- `docs/specs/23-phase-decision-requests.md`
- `docs/specs/24-batch-execution-disjoint-plans.md`
- `docs/specs/26-artifact-frontmatter-metadata.md`
- `docs/specs/27-run-carries-archival.md`
- `docs/specs/28-rename-archived-to-completed.md`
- `docs/specs/archive/01-feedback_ingest_spec.md`
- `docs/specs/archive/02-phax-planning-skill-update.md`
- `docs/specs/archive/03-update-provider-effort.md`
- `docs/specs/archive/04-run-jail.md`
- `docs/specs/archive/05-review-handoff.md`
- `docs/specs/archive/06-deno-runtime.md`
- `docs/specs/archive/07-push-branch-pr.md`
- `docs/specs/archive/08-install-planning-skill.md`
- `docs/specs/archive/09-agent-commands.md`
- `docs/specs/archive/10-init-command.md`
- `docs/specs/archive/11-lock-agent-binding-phase.md`
- `docs/specs/archive/12-project-namespace.md`
- `docs/specs/archive/13-usage-cli.md`
- `docs/specs/archive/14-remove-network-controls.md`
- `docs/specs/archive/17-brief-profile-orient.md`
- `docs/specs/archive/20-model-catalog-equivalence-routing.md`
- `docs/specs/archive/21-artifact-lifecycle-status.md`
- `docs/specs/archive/22-plan-staleness-lineage.md`
- `docs/specs/archive/25-artifact-transition-autocommit.md`
- `docs/plans/39-smolvm-isolation-spike-plan.md`
- `docs/plans/41-claude-protected-path-approval-hook-plan.md`
- `docs/plans/44-gate-profile-attributed-steps-plan.md`
- `docs/plans/45-typescript-7-migration-plan.md`
- `docs/plans/46-artifact-frontmatter-metadata-plan.md`
- `docs/plans/archive/01-plan.md`
- `docs/plans/archive/02-phax-planning-skill-update-plan.md`
- `docs/plans/archive/03-update-provider-effort-plan.md`
- `docs/plans/archive/03b-provider-e2e-validation.md`
- `docs/plans/archive/04-run-jail-plan.md`
- `docs/plans/archive/04b-run-jail-provider-validation.md`
- `docs/plans/archive/05-model-routing-enabled-gating-plan.md`
- `docs/plans/archive/06-model-routing-plan.md`
- `docs/plans/archive/07-observability-plan.md`
- `docs/plans/archive/08-provider-priority-override-plan.md`
- `docs/plans/archive/09-agent-commands.md`
- `docs/plans/archive/09-rename-claude-backend-errors-plan.md`
- `docs/plans/archive/10-init-command-plan.md`
- `docs/plans/archive/10-opus-frontier-tiers-plan.md`
- `docs/plans/archive/11-lock-agent-binding-phase-plan.md`
- `docs/plans/archive/11-review-handoff-plan.md`
- `docs/plans/archive/12-gate-first-resume-plan.md`
- `docs/plans/archive/12-project-namespace-plan.md`
- `docs/plans/archive/13-reset-phase-command-plan.md`
- `docs/plans/archive/13-usage-cli-plan.md`
- `docs/plans/archive/14-push-branch-pr-plan.md`
- `docs/plans/archive/14-remove-last-commands-plan.md`
- `docs/plans/archive/15-agent-binding-hardening-plan.md`
- `docs/plans/archive/15-typescript-6-migration-plan.md`
- `docs/plans/archive/16-deno-runtime-plan.md`
- `docs/plans/archive/16-enforce-architecture-boundaries-plan.md`
- `docs/plans/archive/17-brief-profile-orient-plan.md`
- `docs/plans/archive/17-install-planning-skill-plan.md`
- `docs/plans/archive/17-sealed-completion-extraction-plan.md`
- `docs/plans/archive/18-local-telemetry-report-plan.md`
- `docs/plans/archive/19-whats-next-guidance-plan.md`
- `docs/plans/archive/20-compliance-review-plan.md`
- `docs/plans/archive/20-model-catalog-equivalence-routing-plan.md`
- `docs/plans/archive/21-artifact-lifecycle-status-plan.md`
- `docs/plans/archive/21-usage-spec-generation-hardening-plan.md`
- `docs/plans/archive/22-config-user-project-split-plan.md`
- `docs/plans/archive/22-plan-staleness-lineage-plan.md`
- `docs/plans/archive/23-handoff-deviation-justification-plan.md`
- `docs/plans/archive/24-interactive-init-plan.md`
- `docs/plans/archive/25-artifact-transition-autocommit-plan.md`
- `docs/plans/archive/25-namespace-compliance-followups-plan.md`
- `docs/plans/archive/26-run-recap-and-reset-date-plan.md`
- `docs/plans/archive/27-compliance-handoff-access-and-resume-recap-plan.md`
- `docs/plans/archive/28-completions-binary-stdin-fix-plan.md`
- `docs/plans/archive/29-compliance-review-before-phase-details-plan.md`
- `docs/plans/archive/30-validate-config-only-plan.md`
- `docs/plans/archive/31-error-logging-and-reset-fixes-plan.md`
- `docs/plans/archive/32-resumable-handoff-failure-plan.md`
- `docs/plans/archive/33-resumable-postgate-failures.md`
- `docs/plans/archive/34-decouple-manual-publish-from-config.md`
- `docs/plans/archive/35-remove-last-commands.md`
- `docs/plans/archive/36-review-code-command-plan.md`
- `docs/plans/archive/37-plans-overlap-command-plan.md`
- `docs/plans/archive/38-plan-extraction-cache-plan.md`
- `docs/plans/archive/40-deterministic-plan-extraction-plan.md`
- `docs/plans/archive/42-review-compliance-qualified-name-plan.md`
- `docs/plans/archive/43-security-hardening-plan.md`

### Optional files that may be edited

- `src/app/planStaleness.ts`
- `src/domain/errors.ts`
- `tests/unit/artifact/writeSet.test.ts`
- `tests/unit/loadOrExtractPlan.test.ts`
- `tests/unit/parsePlanMarkdown.test.ts`

### Boundary contracts

- **Consumer `src/app/artifactStatus.ts` → producer `src/domain/artifact/frontmatter.ts`.**
  The app layer needs "rewrite exactly these keys, hand me back the full document" and
  must receive a typed failure it can lift into `ArtifactValidationError`. It must not
  reach into YAML itself.
- **Producer `validateArtifact` → consumers (`phax artifact`, `phax plans`, the run
  gate).** The `{ kind, status }` result and `ArtifactValidationError` shape are
  unchanged; only the reason a file fails changes. `phax plans` renders per-file errors
  from `message`, so the message must name the file itself.
- **`docs/plans/approvals.json` schema is frozen.** The migration rewrites values inside
  the existing `ApprovalRecordFileSchema`; any decode failure after the recompute means
  the script, not the schema, is wrong.

### Test strategy

- Unit (domain): `document.test.ts` and `lineage.test.ts` carry the §8 acceptance cases —
  header-line artifact rejected; unknown key rejected naming the key and allowed set;
  plan missing `source-spec` rejected; `status: Stale` under `docs/plans/` accepted;
  `status: Archived` outside `archive/` rejected; a `status` flip changing only that key
  in the file; fingerprint neutrality of `status` + `approved` versus sensitivity to
  `source-spec`.
- Integration (app with fake ports): `artifactStatus.test.ts` for the approve path
  writing the `approved` mapping and the transition diff touching only `status`;
  `planStaleness.test.ts` for fresh-after-lifecycle-flip and stale-with-reason
  `self-changed` after a `source-spec` edit.
- Integration (CLI errors): `cliErrors.test.ts` for the exact exit codes and the new
  message wording.
- Write the domain unit tests first — they are the acceptance criteria. Fixture updates
  in the CLI and integration suites follow the implementation.
- The migration itself is verified by the gates plus the manual `pnpm dev plans` check;
  do not add a test that asserts on the repo's real `docs/` tree.

### Implementation order

Domain (`document.ts`, `lineage.ts`) → app (`artifactStatus.ts`,
`approvalRecordStore.ts`) → test fixtures and assertions → migration script over
`docs/**` and the e2e fixture → `approvals.json` recompute → delete the script → gates.

### Excluded scope

- Any back-compat reading of header lines, including a fallback or a deprecation warning.
- New metadata keys, status-set changes, transition-legality changes, archive-rule
  changes, and any change to the `approvals.json` schema.
- A shipped `phax artifact migrate` command.
- Skill, README, CLI-help, and example-plan updates (phase-03).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The final message wording for each `FrontmatterProblem` variant, since phase-03
  documents the format that produces them.
- Confirmation that all 90 artifacts plus the e2e fixture were converted, with the count
  actually written by the script, and that the script was deleted before the commit.
- The `pnpm dev plans` output after migration: which plans are fresh, and any
  `ground-changed` verdicts with the source files that caused them.
- The synthesized `date` values used for the 12 archived specs lacking them.
- Any deviation from the planned file lists, with the reason — in particular any artifact
  that needed a hand fix-up beyond what the script produced.

### Commit subject

feat(artifact)!: read lifecycle metadata from YAML frontmatter only

### Commit body

Make a YAML frontmatter block at offset 0 the sole carrier of spec and plan lifecycle
metadata, decoded through an exact per-kind schema at the boundary. Header lines are
rejected with an actionable message naming the file and the expected format; there is no
fallback reading. Transitions now rewrite the `status` key and upsert the `approved`
mapping surgically, leaving every other key and the whole document body byte-identical,
and the approval fingerprint excludes exactly `status` and `approved`.

Migrates all 90 live and archived artifacts, the e2e fixture plan, and recomputes every
fingerprint in docs/plans/approvals.json in the same commit, so no commit leaves the
repository unreadable by its own lifecycle tooling and no plan becomes stale because of
the format change. Archived specs that never carried Date/Audience/Scope get their git
add-date and an explicit (unrecorded) placeholder.

BREAKING CHANGE: specs and plans must carry YAML frontmatter; the previous
`Status:` / `Source-Spec:` / `Approved:` header lines are no longer recognized.

## phase-03 — Authoring surface: skills, CLI help, example plan {#phase-03-authoring-surface}

**Recommended model:** claude-sonnet-5
**Recommended effort:** medium

Bring the authoring and help surface in line with the format that phase-02 now enforces,
so a human or agent writing a new spec or plan produces a valid artifact from the
template rather than from a validation error.

### Detailed instructions

- `.claude/skills/phax-spec/SKILL.md`: replace the `Status:` header-block description and
  template (around the status section and the worked example header) with the frontmatter
  block from spec §6 — `status`, `date`, `audience`, `scope` — and state that the key set
  is exact: an unknown or missing key fails validation.
- `.claude/skills/phax-planning/SKILL.md`: rewrite the **Plan header block** section to
  show the frontmatter block with `status`, `source-spec`, and the optional `approved`
  mapping. Keep the semantics already documented there — the run gate accepting only
  `Approved`, `source-spec` as the lineage anchor — and update two details: `source-spec:
  null` replaces `Source-Spec: (none)`, and the block is frontmatter at offset 0, not
  preamble prose. Also update the sentence saying these lines "live in the preamble and
  are not extracted": they are frontmatter, and the extractor skips the block.
- `src/cli/cliDocs.ts`: update the `phax artifact` help text that says "Rewrites the
  Status: line in place" (approve, stale, reopen) and the `abandon` / `archive` side-effect
  text about a rewritten `Status:` line, plus the `phax plans --apply` line about writing
  "Status: lines". Say the frontmatter `status` key instead. Then regenerate with
  `pnpm gen:usage-spec` and `pnpm docs:cli` — `phax.usage.kdl`, `docs/cli/reference.md`,
  and the README CLI summary are generated, so do not hand-edit them.
- `examples/hello-world/plan.md`: add the frontmatter block (`status: Approved`,
  `source-spec: null`) so the shipped example is a valid, runnable plan in the new format.
  `tests/unit/examplePlanDeterministic.test.ts` extracts this file, so the gates prove
  the example still parses — check that the body's existing `---` separators still work
  with the splitter (they must, since the first closing delimiter is the block's own).
- Do not touch the copies installed under `~/.claude/skills/` — users refresh those with
  `phax skills install`.

### Planned files to create

- (none)

### Planned files to edit

- `.claude/skills/phax-spec/SKILL.md`
- `.claude/skills/phax-planning/SKILL.md`
- `src/cli/cliDocs.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`
- `README.md`
- `examples/hello-world/plan.md`

### Optional files that may be edited

- `.claude/skills/phax-cli/SKILL.md`
- `CLAUDE.md`
- `docs/ideas/desktop-app.md`
- `docs/state-machine.md`

### Boundary contracts

- **`src/cli/cliDocs.ts` is the single source for help text**; `phax.usage.kdl`,
  `docs/cli/reference.md`, and the README section are generated artifacts of it. Edit the
  source, run the generators, commit the result.

### Test strategy

No new tests. The gate's existing `tests/unit/examplePlanDeterministic.test.ts` proves the
migrated example plan still extracts deterministically, and the `full` profile's build
and lint steps cover the `cliDocs.ts` edit. Confirm the generators produce no further
diff on a second run.

### Implementation order

Skills → `cliDocs.ts` → regenerate → example plan → gates.

### Excluded scope

- Any code behavior change; this phase is documentation and generated output only.
- Rendering or static-site tooling built on the new frontmatter (spec §7).
- Adding new metadata keys to the templates.

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- Which generated files changed from `pnpm gen:usage-spec` / `pnpm docs:cli`, and
  confirmation that a second run produced no further diff.
- Confirmation that `examples/hello-world/plan.md` still extracts (the example test
  passed) with frontmatter added.
- Any remaining prose in the repo that still describes the header-line format, with its
  location, if left unedited.
- Any deviation from the planned file lists, with the reason.

### Commit subject

docs(artifact): document YAML frontmatter as the lifecycle metadata format

### Commit body

Update the phax-spec and phax-planning skill templates, the `phax artifact` / `phax
plans` help text and its generated CLI reference, and the shipped hello-world example
plan to the YAML frontmatter format enforced since the previous commit. Authors now get
a valid artifact from the template instead of a validation error.
