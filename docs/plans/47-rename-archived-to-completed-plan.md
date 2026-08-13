---
status: Draft
source-spec: docs/specs/28-rename-archived-to-completed.md
---
# Rename Archived to Completed

## Overview

Spec 28 relabels one lifecycle state: the terminal status that means "this artifact
completed its purpose" stops being called `Archived` and becomes `Completed`, and the CLI
verb that applies it stops being `archive` and becomes `complete`. No state is added or
removed, no transition changes, the `archive/` directory keeps its name, and there is no
alias — `Archived` becomes an unknown status and `phax artifact archive` becomes an
error. Three phases:

1. **phase-01** flips the status value everywhere it is typed — the two status tuples,
   the terminal set, both transition tables, the Effect Schema, the commit-verb map, the
   retirement refusal message, the run gate's retired case, the CLI transition target —
   and migrates the 78 repository artifacts whose `status` key reads `Archived` in the
   same commit. Fused deliberately: the moment the schema rejects `Archived`, this
   repository's own archived specs and plans must already read `Completed` or
   `phax artifact status` refuses the files phax itself ships.
2. **phase-02** renames the CLI verb, registers `archive` as a hidden subcommand that
   refuses while naming `complete`, teaches the usage-spec generator to skip hidden
   commands, and regenerates the three derived documents (`phax.usage.kdl`,
   `docs/cli/reference.md`, the README CLI section).
3. **phase-03** updates the authoring surface — the `phax-spec`, `phax-planning` and
   `phax-cli` skill bundles that phax ships and installs.

Sequencing note for the reader: spec 27 (run branch carries artifact completion) is
written in this vocabulary and cannot be planned until this run lands.

Fingerprint note: `fingerprintSource` deletes the `status` and `approved` keys before
hashing (shipped by plan 46), so rewriting 78 status values moves no fingerprint.
`docs/plans/approvals.json` is therefore *not* part of this plan's write-set, and
spec 28 §5.5 is verified as a property that already holds rather than engineered here.

## Technical arbitrations

- **The 78-artifact migration is fused into phase-01 with the code flip.** Accepted
  loss: one large commit (≈12 source and test files plus 78 one-line documentation
  edits). Bought: every commit on the branch leaves the repository self-consistent with
  its own tooling — there is no commit at which phax rejects the artifacts in its own
  `docs/` tree. Same reasoning, same shape as plan 46's phase-02.
- **The retired `archive` verb is a hidden Commander subcommand, not a documented one.**
  Accepted loss: one filter added to `scripts/generate-usage-spec.ts`, which had no
  notion of hidden commands. Bought: the published CLI contract — `phax.usage.kdl` and
  everything derived from it (`docs/cli/reference.md`, the README table, shell
  completions) — never advertises a verb that can only fail, while §5.4's requirement
  that the invocation fail *naming* `complete` is still met.
- **Migration by throwaway script, deleted before the commit.** Accepted loss: the
  transform that produced the 78-file diff is not reviewable, only its result. Bought:
  reliability across 78 near-identical single-key edits, with no one-shot migrator
  persisting in `scripts/` forever.
- **Only the `status` key is rewritten in archived artifacts; their prose is left
  alone.** Accepted loss: archived documents keep saying "Archived" in their bodies, so
  the tree is not uniformly in the new vocabulary. Bought: no rewriting of the historical
  record — an archived spec describes what was decided when it was written. Verified:
  no *live* spec or plan mentions `Archived` in prose (27 was swept on 2026-08-13), so
  nothing an author reads today is left stale by this choice.
- **The refusal exits 1, not 12.** Accepted loss: consistency with the artifact
  command's validation exit code. Bought: §6's `$? = 1` is normative, and 12 means "a
  real artifact was inspected and refused" — an unknown verb never got that far.

## Required commands

- pnpm gen:usage-spec
- pnpm docs:cli
- usage

## Required PHAX security configuration changes

None. All three commands are already present in `security.agentCommands` in `phax.json`
(`pnpm gen:usage-spec`, `pnpm docs:cli`, `usage`); they are declared above so the
preflight confirms coverage before any agent spawns.

## phase-01 — Completed replaces Archived in the status sets and the repository {#phase-01-status-rename}

**Recommended model:** claude-opus-4-8
**Recommended effort:** high

Rename the terminal status `Archived` to `Completed` everywhere it is typed, and rewrite
the `status` key of all 78 repository artifacts that carry the old spelling, in one
commit that leaves the repository self-consistent.

### Detailed instructions

- In `src/domain/artifact/status.ts`: replace `"Archived"` with `"Completed"` in
  `SPEC_STATUSES` and `PLAN_STATUSES`, in the `TERMINAL_STATUSES` set, and as both the
  key and the target value in `SPEC_TRANSITIONS` and `PLAN_TRANSITIONS`. Keep the tuple
  order (`Draft, Approved, Abandoned, Completed` for specs; `Draft, Approved, Stale,
  Abandoned, Completed` for plans) so the "allowed set" text in refusals reads in the
  order spec 28 §6 shows. No other structural change — the transition graph is
  identical with one node relabelled.
- In `src/schemas/artifactStatus.ts`: replace the `Schema.Literal("Archived")` member of
  both unions with `Schema.Literal("Completed")`. The two compile-time assertions that
  bind the schema types to the domain types stay as they are and will catch any
  half-done rename.
- In `src/domain/artifact/writeSet.ts`: in `VERB_BY_TARGET`, replace the
  `Archived: "archive"` entry with `Completed: "complete"`. This is what makes
  transition commits read `chore(specs): complete <slug>` per §6.
- In `src/app/artifactStatus.ts`: rename the `case "Archived":` arm of `refusalFor` to
  `case "Completed":`. The message is built from the status value, so a plan refuses
  with "… is Completed, a retired plan that cannot be run." — keep it that way; §8's
  retired-refusal criterion depends on it staying distinct from the Draft and Stale
  refusals.
- In `src/domain/errors.ts`: the spec-retirement refusal message ends "— abandon or
  archive them first". It names CLI verbs, so it becomes "— abandon or complete them
  first".
- In `src/cli/commands/artifact.ts`: change the `TRANSITIONS` entry's `target` to
  `"Completed"` and the `target === "Abandoned" || target === "Archived"` guard to test
  `"Completed"`. Leave the subcommand `name` as `"archive"` and its description text
  alone — the verb rename is phase-02's commit, and this phase must leave a working CLI.
- Migrate the repository artifacts: rewrite `status: Archived` to `status: Completed` in
  the frontmatter block of each of the 78 files listed below. Only that key — do not
  touch the body prose of archived documents, and do not touch any other frontmatter
  key. Write a throwaway script to do it, run it, verify the diff is exactly 78
  single-line changes, then delete the script before committing (it must not appear in
  the phase diff).
- Do not touch `docs/plans/approvals.json`. Every record in it belongs to a live
  `Approved` plan, and `fingerprintSource` excludes the `status` key from hashing, so no
  fingerprint moves. Confirm this with `pnpm dev plans status` after the migration —
  every plan must report exactly the staleness it reported before the phase, and none of
  them may newly report `self-changed`.
- Update the tests listed below to the new spelling. These are assertions on status
  literals and on transition tables, not new coverage: `status.test.ts` covers the state
  sets and legality, `writeSet.test.ts` the commit verb, `document.test.ts` the
  status/location invariant, `artifactStatus.test.ts` the transitions and the run gate,
  `cli/artifact.test.ts` the command output, `planStaleness.test.ts` one fixture status.
- Add one unit assertion to `tests/unit/artifact/status.test.ts` that `parseSpecStatus`
  and `parsePlanStatus` both return `null` for the literal `"Archived"` — §5.1's
  no-back-compat requirement, stated as a test rather than left implicit.

### Planned files to create

- (none)

### Planned files to edit

- `src/domain/artifact/status.ts`
- `src/schemas/artifactStatus.ts`
- `src/domain/artifact/writeSet.ts`
- `src/domain/errors.ts`
- `src/app/artifactStatus.ts`
- `src/cli/commands/artifact.ts`
- `tests/unit/artifact/status.test.ts`
- `tests/unit/artifact/writeSet.test.ts`
- `tests/unit/artifact/document.test.ts`
- `tests/unit/cli/artifact.test.ts`
- `tests/integration/artifactStatus.test.ts`
- `tests/integration/planStaleness.test.ts`
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
- `docs/plans/archive/46-artifact-frontmatter-metadata-plan.md`
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
- `docs/specs/archive/26-artifact-frontmatter-metadata.md`

### Optional files that may be edited

- `tests/unit/cli/run.test.ts`
- `tests/integration/cliErrors.test.ts`

### Boundary contracts

Producer: `src/domain/artifact/status.ts` owns the two status tuples and the transition
tables; every other layer reads them as types. Consumers that must move in the same
commit because they name the literal: the schema union
(`src/schemas/artifactStatus.ts`, bound by its own compile-time assertions), the
commit-verb map (`src/domain/artifact/writeSet.ts`, a `Record<ArtifactStatus, string>`
that fails exhaustiveness if a key is missed), the run gate's `refusalFor` switch
(`src/app/artifactStatus.ts`, exhaustive over `PlanStatus`), and the CLI transition
target (`src/cli/commands/artifact.ts`). The stable shape between them is unchanged —
only the inhabitant's spelling moves — so TypeScript exhaustiveness is the contract
check here; a partial rename cannot typecheck.

### Test strategy

All test-first, since every one of these is an assertion on an existing contract rather
than new behavior — write the expected `Completed` spelling, watch it fail, then move
the source:

- Domain (unit): `status.test.ts` — the two state sets, `isTerminalStatus`,
  `legalTargetsFrom` and `requestTransition` for both kinds; plus the new assertion that
  `"Archived"` parses to `null`. `writeSet.test.ts` — the write-set for a terminal
  target and the `chore(<scope>): complete <slug>` commit subject.
  `document.test.ts` — the terminal-status ⇔ archive-location invariant.
- Application (integration): `artifactStatus.test.ts` — legal transitions, the terminal
  move into `archive/`, the chain gate, and the run gate's retired refusal.
- CLI (unit): `cli/artifact.test.ts` — the `Status:`/`Path:`/`Commit:` output lines for a
  completion transition.
- Repository-level check, not a test file: `pnpm dev plans status` before and after the
  migration must report identical verdicts for all four live plans.

### Implementation order

Core to surface: `status.ts` → `artifactStatus.ts` (schema) → `writeSet.ts` →
`errors.ts` → `app/artifactStatus.ts` → `cli/commands/artifact.ts`, letting `tsc` point
at each next site. Then the 78-file migration, then the staleness check.

### Excluded scope

- The CLI verb `archive` → `complete` and the refusal on the old verb (phase-02).
- `src/cli/cliDocs.ts` help text and the generated `phax.usage.kdl`,
  `docs/cli/reference.md` and README section (phase-02).
- The skill bundles under `.claude/skills/` (phase-03).
- `docs/plans/approvals.json` — no fingerprint moves; touching it is a deviation.
- The body prose of archived documents, and the `Source-Spec` casing in
  `src/domain/errors.ts` (a leftover from plan 46's frontmatter rename, tracked
  separately).
- Run-level archival: `phax archive <run>`, the `archived` run state in
  `src/domain/state.ts`, `src/app/archive.ts`, `--archived` in `src/cli/program.ts`, and
  the `archive.completed` telemetry step in `src/app/effectRunner.ts` all keep their
  names (spec 28 §7).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- Confirmation that no `Archived` status literal remains in `src/` or `tests/`, and the
  command used to check.
- The `pnpm dev plans status` output before and after the migration, showing identical
  verdicts for plans 39, 41, 44 and 45.
- Confirmation that the throwaway migration script was deleted and is absent from the
  commit, and the exact count of migrated artifacts (expected: 78).
- The note that `src/cli/commands/artifact.ts` still registers the subcommand under the
  name `archive` while applying `Completed`, and that phase-02 owns that rename.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(artifact)!: rename the Archived terminal status to Completed

### Commit body

Replace `Archived` with `Completed` in the spec and plan status sets, the terminal set,
both transition tables, the Effect Schema, the transition commit-verb map, the spec
retirement refusal and the run gate's retired case, and migrate the 78 repository
artifacts carrying the old spelling in the same commit so phax never rejects the
artifacts it ships. No alias: `Archived` is now an unknown status. `approvals.json` is
untouched — the fingerprint source excludes the status key, so no fingerprint moves.

## phase-02 — The CLI verb becomes complete {#phase-02-cli-verb}

**Recommended model:** claude-sonnet-5
**Recommended effort:** high

Rename the CLI transition verb from `archive` to `complete`, make the old verb fail while
naming the new one, and regenerate the three derived CLI documents so the published
contract carries the new vocabulary and nothing else.

### Detailed instructions

- In `src/cli/commands/artifact.ts`: rename the `TRANSITIONS` entry from `archive` to
  `complete` and reword its description to "Complete an artifact — terminal; moves the
  file to its archive/ directory" (the directory keeps its name; only the status and the
  verb change).
- Register `archive` as a **hidden** subcommand of `artifact` whose action writes the
  refusal to the output port and exits 1. Message per §6, wording indicative but it must
  name the replacement:
  `unknown transition "archive" — the completion transition is: phax artifact complete <path>`.
  Use Commander's hidden-command support so the verb is absent from `--help`. Keep it
  going through the `OutputPort` like every other CLI write — no direct `console`.
- In `scripts/generate-usage-spec.ts`: skip hidden commands when walking the tree. Both
  walk sites need it — the top-level loop over `program.commands` and the recursive loop
  over `cmd.commands`. This is what keeps `archive` out of `phax.usage.kdl`, and
  therefore out of `docs/cli/reference.md`, the README table and shell completions, all
  of which derive from that file.
- In `src/cli/cliDocs.ts`: rename the `"artifact archive"` key to `"artifact complete"`
  and rewrite its long help — "Completes an artifact — a terminal status for work that
  ran to completion. Legal from Approved (specs) or Approved or Stale (plans)." — and
  its side-effects paragraph, which currently says the status key is rewritten to
  `Archived`. Update the example to `phax artifact complete docs/specs/…`. Also fix the
  two neighbouring entries that name the old vocabulary: the `artifact` parent long help
  ("Specs carry Draft, Approved, Abandoned, or Archived … terminal status (Abandoned,
  Archived)") and the `artifact abandon` long help ("a terminal status distinct from
  Archived"). Leave every `phax archive` (run) entry alone.
- Regenerate the derived documents in this order: `pnpm gen:usage-spec` (rewrites
  `phax.usage.kdl` from the live Commander tree), then `pnpm docs:cli` (regenerates
  `docs/cli/reference.md` from the KDL via the `usage` binary and re-injects the README
  section between its marker comments). Do not hand-edit any of the three.
- Verify the generated output: `phax.usage.kdl` must contain a `cmd "complete"` under
  `artifact` and no `cmd "archive"` under it, while keeping the top-level run
  `cmd "archive"` and the `--archived` flag on `runs` untouched.

### Planned files to create

- (none)

### Planned files to edit

- `src/cli/commands/artifact.ts`
- `src/cli/cliDocs.ts`
- `scripts/generate-usage-spec.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`
- `README.md`
- `tests/unit/cli/artifact.test.ts`
- `tests/integration/cliProgram.test.ts`

### Optional files that may be edited

- `tests/integration/cliErrors.test.ts`

### Boundary contracts

Producer: the Commander tree in `src/cli/` is the single source of truth for the CLI
contract. Consumers: `scripts/generate-usage-spec.ts` reads the tree and emits
`phax.usage.kdl`; `scripts/docs-cli.ts` reads that KDL and emits
`docs/cli/reference.md` plus the README section between `<!-- BEGIN GENERATED CLI
REFERENCE -->` and its END marker. The contract this phase adds to that chain: a command
marked hidden in Commander is absent from the emitted KDL, and therefore from everything
downstream. The CLI command file stays a view — parse, call one use case, render through
`OutputPort` — and the refusal action is no exception.

### Test strategy

- CLI (unit, test-first): `tests/unit/cli/artifact.test.ts` — invoking the `complete`
  verb applies the transition and prints the expected lines; invoking `archive` writes
  the refusal naming `complete` and returns exit code 1 without touching the file.
- CLI program (integration): `tests/integration/cliProgram.test.ts` — the `artifact`
  parent's visible subcommands are exactly `status, approve, stale, abandon, complete,
  reopen`, and `archive` is registered but hidden. This is the regression that keeps a
  future contributor from unhiding it.
- Generator: assert against the regenerated `phax.usage.kdl` in the same integration
  test if the file is already read there; otherwise the check above plus the committed
  KDL diff is sufficient — do not invent a new generator test harness.

### Implementation order

`cli/commands/artifact.ts` (verb + hidden refusal) → `cliDocs.ts` (help text) →
`scripts/generate-usage-spec.ts` (hidden filter) → regenerate KDL → regenerate reference
and README → tests green.

### Excluded scope

- Any status-value change (landed in phase-01).
- Run-level `phax archive <run>`, `phax runs --archived`, and their help entries.
- The skill bundles under `.claude/skills/` (phase-03).
- Hand-editing `phax.usage.kdl`, `docs/cli/reference.md` or the README's generated
  section — all three are outputs.

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact refusal message and exit code the hidden `archive` subcommand produces.
- The shape of the hidden-command filter added to `scripts/generate-usage-spec.ts` and
  which of the two walk sites it applies to.
- Confirmation that all three derived documents were regenerated by their scripts rather
  than hand-edited, with the commands used.
- Confirmation that the run-level `archive` command and `--archived` flag are unchanged
  in the regenerated KDL.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(cli)!: rename the artifact archive verb to complete

### Commit body

`phax artifact complete` replaces `phax artifact archive`. The old verb is registered as
a hidden subcommand that refuses while naming the replacement, so the invocation fails
with a useful message (exit 1) without the dead verb appearing in help, the generated
usage spec, the CLI reference, the README table or shell completions — which required
teaching the usage-spec generator to skip hidden commands. Help text and the three
derived documents are regenerated from the Commander tree.

## phase-03 — Authoring surface: the shipped skill bundles {#phase-03-skills}

**Recommended model:** claude-sonnet-5
**Recommended effort:** medium

Update the three skill bundles phax ships and installs so an author writing a spec or a
plan is told the current vocabulary rather than one the CLI now rejects.

### Detailed instructions

- `.claude/skills/phax-spec/SKILL.md`: the spec status set (`Draft`, `Approved`,
  `Abandoned`, `Archived` → `Completed`), the ASCII state diagram
  (`Draft ──▶ Approved ──▶ Archived`), the `**Archived**` glossary entry — reword it to
  say the spec was consumed into a plan and tests and moves to `docs/specs/archive/`,
  keeping the directory name — and the `status:` line in the frontmatter template.
- `.claude/skills/phax-planning/SKILL.md`: the plan status list in the frontmatter-block
  section, and any run-gate wording that names `Archived`.
- `.claude/skills/phax-cli/SKILL.md`: the status vocabulary and the retired-plan refusal
  description (`Abandoned`/`Archived` → `Abandoned`/`Completed`), plus any
  `phax artifact archive` invocation shown.
- Sweep all three for the verb: any `phax artifact archive` example becomes
  `phax artifact complete`. References to the `archive/` *directory* stay as they are —
  read each occurrence and decide which of the two it is rather than substituting
  blindly.
- Leave `.claude/skills/cli-view-layer/SKILL.md` alone: its `Archived ${shortName}`
  snippet is the run-archival command used as a view-layer example, not artifact
  vocabulary.
- These files are the bundle `phax skills install` copies (`bundleRoot` in
  `src/cli/commands/skills.ts` points at `.claude/skills`), so editing them here is the
  whole change — there is no second source to keep in sync since the `.agents/` mirror
  was removed.

### Planned files to create

- (none)

### Planned files to edit

- `.claude/skills/phax-spec/SKILL.md`
- `.claude/skills/phax-planning/SKILL.md`
- `.claude/skills/phax-cli/SKILL.md`

### Optional files that may be edited

- `examples/hello-world/plan.md`
- `tests/e2e/fixtures/minimal-repo/plan.md`

### Boundary contracts

None crossed — this phase edits shipped documentation only. The one coupling to respect:
`src/domain/skills/catalog.ts` lists the three bundles by directory name; this phase
changes their content, never their names or file set, so the catalog and
`tests/unit/skillsArgv.test.ts` stay untouched.

### Test strategy

No new tests. The existing skills tests assert bundle structure (names, required file
present), not prose, so they must stay green untouched; if one fails, the phase changed
something structural it should not have. Confirm by reading each edited file that the
frontmatter template it shows would validate — an author copying the template must get a
valid artifact, which is the failure mode plan 46 phase-03 existed to fix.

### Implementation order

`phax-spec` (the richest vocabulary surface: state set, diagram, glossary, template) →
`phax-planning` (status list) → `phax-cli` (refusal wording and examples).

### Excluded scope

- Any source, schema or test change.
- `.claude/skills/cli-view-layer/SKILL.md` and every other skill bundle.
- The `archive/` directory name in any of the three files.
- `NEXT_STEPS.md` and `CLAUDE.md` — repository notes, not shipped authoring surface.

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- Per skill file, which occurrences were treated as status/verb (rewritten) and which as
  the `archive/` directory (kept).
- Confirmation that the frontmatter templates in `phax-spec` and `phax-planning` now show
  a status value the schema accepts.
- Any deviation from the planned file lists, with the reason.

### Commit subject

docs(skills): teach the shipped skills the Completed vocabulary

### Commit body

Update the phax-spec, phax-planning and phax-cli skill bundles to the renamed terminal
status and CLI verb: status sets, the spec state diagram and glossary, the frontmatter
templates, the retired-plan refusal wording, and every `phax artifact archive` example.
References to the archive/ directory are unchanged — the folder keeps its name; only the
status and the verb moved. Authors copying a template now get an artifact the schema
accepts.
