# Next steps

Follow-up work identified on 2026-08-09 (mapping phax against data-engineering lessons —
graphs / ETL / change detection / democratization — and the desktop-app idea in
`docs/ideas/desktop-app.md`); updated 2026-08-10 (entire.io positioning analysis and a
second pass on the Josh Rosen data-engineering article); updated 2026-08-11 (spec 26
frontmatter planning added as priority); updated 2026-08-12 (plans 22 + 25 landed;
draft specs 27 + 28 approval sequence added); updated 2026-08-13 (spec 26 / plan 46
landed and retired; specs 27 + 28 swept for it); updated 2026-08-14 (spec 28 / plan 47
landed as v0.8.0 and retired; plan 48 written for spec 27); updated again 2026-08-14
(plan 48 approved, run and landed as v0.8.1 — the lifecycle chain is closed; plan 48
retired, spec 27 pending; specs 23 and 24 postponed to the bottom, making the small
follow-ups and the entire.io spike the active queue); updated a third time 2026-08-14
(plan 49 approved, run and landed on `main` — the **first run to carry its own
completion**, so no hand transition was needed; the small-follow-ups section is now
closed, leaving the gate trilogy 15 / 16 / 18 + advisory 19 and the entire.io spike as
the active queue). Tick items off as they land, and delete this file when it is empty.

## Approve the draft specs 27 and 28 (in this order)

Two Drafts written 2026-08-12. Order matters: 28 renames the vocabulary 27 is written
in, so 28 goes first and 27 gets swept before its approval. Both were swept on
2026-08-13 for the fact that spec 26 landed — no stale cross-references remain.
**28 has now landed and been retired; only 27 remains, and its plan is written.**

- [x] `docs/specs/28-rename-archived-to-completed.md` — terminal status `Archived` →
      `Completed` (outcome pair `Completed | Abandoned`; the `archive/` folder keeps its
      name); CLI verb `phax artifact archive` → `phax artifact complete`, no alias;
      one-time migration. **Approved 2026-08-13** after a review sweep that: killed the
      §9 "ride spec 26's rollout" recommendation (26 landed first, so the rename is
      standalone); corrected §5.5 — 26's `fingerprintSource` already deletes the
      `status` and `approved` keys before hashing, so the rewrite is fingerprint-neutral
      by construction and `approvals.json` needs no recomputation, making §5.5 a
      regression check rather than work; and fenced off run-level archival
      (`phax archive <run>`, the `archived` run status, `phax runs --archived`) as a
      non-goal, since §5.4 renames only the artifact verb.
- [x] `docs/specs/27-run-carries-archival.md` — run completion (final phase gates green,
      before `review_open`) applies the plan's terminal transition on the run branch;
      ride-along spec completion behind the chain gate; `phax publish-pr` untouched;
      merge lands work + record atomically. **Swept into 28's vocabulary and approved
      2026-08-13** (`Archived` → `Completed`, `archive` verb → `complete`, archival
      commit → completion commit; the `archive/` folder and the archive move keep their
      names per 28 §7). The filename keeps its `-archival` slug — an archived plan and
      the commit history cite it, and slug/title divergence is already normal here. Two
      notes added: dependent plans' `source-spec` keys are *not* rewritten when the
      ride-along completion moves a spec (resolution accepts the declared path or its
      archive counterpart, and rewriting would pull non-transitioning files into the
      write-set 25 scopes); and §10 records that 27 is now written in a vocabulary no
      code implements.
- [x] Plan for spec 28 written 2026-08-13 —
      `docs/plans/47-rename-archived-to-completed-plan.md` (Draft). Three phases: the
      status flip fused with the 78-artifact repository migration (opus-4-8/high), the
      CLI verb rename with a hidden refusing `archive` subcommand and regenerated CLI
      documents (sonnet-5/high), the shipped skill bundles (sonnet-5/medium).
      Deterministic extraction verified — 3 phases, no LLM fallback.
- [x] Plan 47 approved and run — **landed on `main` 2026-08-14**, released as **v0.8.0**
      (`ae554dc` status flip + 78-artifact migration, `98199d7` CLI verb rename,
      `0b4a4a3` shipped skill bundles, `289626b` refusal-without-path fix). Plan 47 and
      spec 28 retired to `archive/` on 2026-08-14 — the first two transitions applied
      with the new `phax artifact complete` verb, which dogfooded itself.
- [x] Ripple from 28 applied: the `phax-spec`/`phax-planning`/`phax-cli` skill bundles,
      `phax.usage.kdl`, `docs/cli/reference.md` and the README now read
      `Completed`/`complete`. The run-level `phax archive <run>`, the `archived` run
      status and `phax runs --archived` stay as they are (28 §7).
  - [x] Operator step: the **installed** skill copies under `~/.claude/skills/` still
        read `Archived` — only the repo bundle (`.claude/skills/`, which *is* the install
        source) had been rewritten. **Done 2026-08-14** —
        `phax skills install --target claude --scope user` refreshed all three.
- [x] Plan for spec 27 written 2026-08-14 —
      `docs/plans/48-run-carries-completion-plan.md` (Draft). Four phases:
      `FileSystemOps.rootedAt` on the port and its adapters (sonnet-5/high), the
      `completeRunArtifacts` use case (opus-4-8/high), the `ArtifactCompletionFailed`
      pause path (sonnet-5/high), and wiring it into `executePlan` with a
      `resumeFromCompletion` re-entry and the run-output report (opus-4-8/high).
      Deterministic extraction verified — 4 phases, no LLM fallback. Two arbitrations
      were settled with the user and recorded in the plan: the worktree root reaches
      `transitionArtifact` through a **port method**, not an infra import or a threaded
      path prefix; and a failed completion **pauses** the run resumably rather than
      failing it.
- [x] Plan 48 approved 2026-08-14 (`58054de`, baseline `01ba79a`) and run — **landed on
      `main` 2026-08-14**, released as **v0.8.1** (`db89c52` `FileSystemOps.rootedAt`,
      `0f6f52f` the `completeRunArtifacts` use case, `ad27544` the
      `ArtifactCompletionFailed` pause path, `b6e4aa6` the `executePlan` wiring +
      run-output report). One post-run fix: `e80db0d` — a completion pause leaves the
      final phase `committed`, which `findNextResumablePhase` treated as terminal, so
      `phax resume` refused and the resume-from-completion path was unreachable from the
      CLI; a `committed` **final** phase is now resumable while non-final phases keep the
      old behavior. **That closes the 21 → 22 → 25 → 26 → 28 → 27 lifecycle chain.**
- [x] Plan 48 retired by hand 2026-08-14 (`89a3305`, `Approved → Completed`, moved to
      `docs/plans/archive/`). The run could not complete itself: the phax binary driving
      it predates the feature it was adding, and the resume fix landed afterwards — so
      this last pair is retired by hand, and every run from here on carries its own
      completion. `phax plans status` had reported 48 as `ground-changed` stale against
      its own implementation diff; completion, not re-approval, was the right transition,
      and the report is now down to plan 39 alone.
- [x] Spec 27 retired 2026-08-14 (`2cbceed`, moved to `docs/specs/archive/`), right
      after its plan. **This section is now closed** — no lifecycle artifact anywhere is
      waiting on a hand transition.

## The lifecycle chain (landed)

The chain 21 → 22 → 25 → 26 → 28 → 27 has now landed in full (27 as v0.8.1 on
2026-08-14; spec 27 retired the same day, so nothing here is outstanding). The two
remaining approved specs, 23 and 24, were **deliberately postponed on 2026-08-14** — see
"Postponed" near the bottom. What is left in front of them: the gate trilogy 15 / 16 /
18 plus the advisory 19 (approved 2026-07-03, audited 2026-08-14, none implemented) and
the entire.io spike — the small follow-ups closed with plan 49.

- [x] `docs/specs/21-artifact-lifecycle-status.md` — spec/plan state machines; only an
      `Approved` plan runs; archive-location agreement; `phax artifact` commands.
      **Landed on `main` 2026-08-10** (plan 21, five phases incl. the whole-tree
      migration).
- [x] `docs/specs/22-plan-staleness-lineage.md` — approval binds plan + spec + repo
      baseline; staleness reasons `spec-changed | ground-changed | self-changed`; hard
      gate at run start; `phax plans status [--apply]`. **Landed on `main` 2026-08-11**
      (plan 22, 6 phases; the phase-06 review surfaced the path-rooting follow-up
      below).
  - [x] Post-merge operator step: re-approve plans 39, 41, 44, 45 so they gain
        approval records — **done 2026-08-11** (approval baselines recorded; 39 and 41
        compute fresh).
  - [x] Plans 41, 44 and 45 computed stale (`ground-changed`: 41 from the
        `phax-planning` skill rewrite — its footprint still names the `.agents/` mirror
        that `62670ea` deleted; 44 from README / `docs/cli/reference.md` / `phax.json` /
        `tests/unit/cli/run.test.ts` churn; 45 from `package.json` / lockfile churn).
        **Flipped `Approved → Stale` 2026-08-14** via `phax plans status --apply` (three
        auto-committed transitions, `7bc46ed`/`8b63c4f`/`278d4bb`), so the records now
        agree with the ground. Only plan 39 computes fresh.
  - [ ] Re-approve 41 and 44 when you next intend to run them. `Stale → Approved` is
        a legal direct transition — no Draft round-trip — but each needs a real review
        first, since the ground moved under it. The sequencing constraint is now
        discharged: plans 48 and 49 both edited `tests/unit/cli/run.test.ts` (in plan
        44's footprint) and have landed, so 44 can be re-approved against the current
        ground whenever you pick it up — re-read it against `main` first, since 49 also
        reshaped how CLI commands acquire their layer.
  - [x] Plan 45 took the other route on 2026-08-14: **reopened `Stale → Draft`
        (`13343f6`) and replanned in place** rather than re-approved as written — see
        "TypeScript 7 migration" below.
- [x] `docs/specs/25-artifact-transition-autocommit.md` — every artifact transition
      auto-commits exactly its write-set (clean-target precondition, path-scoped
      staging). **Landed on `main` 2026-08-12** (plan 25; the post-landing review
      dropped `--no-commit` — transitions always commit).
- [x] `docs/specs/26-artifact-frontmatter-metadata.md` — YAML frontmatter replaces the
      `Status:`/`Source-Spec:`/`Approved:` header lines on all lifecycle artifacts;
      key-level fingerprint neutrality; migration coupled with `approvals.json`
      fingerprint recomputation. **Landed on `main` 2026-08-12** (plan 46, three
      phases: primitives → frontmatter-only + 90-artifact migration → authoring
      surface). Shipped with `Archived` intact, since spec 28 was not approved first —
      see the 28 item above. Plan 46 and spec 26 retired to `archive/` 2026-08-13.

## The gate trilogy 15 / 16 / 18 and the advisory 19

Approved on 2026-07-03 and never planned. Audited 2026-08-14 against `main`: **none of
the four is implemented**, so none flips to `Completed` — they are live backlog, and
with 23 and 24 postponed they are the nearest planning targets.

- [ ] `docs/specs/15-gate-profile-attributed-steps.md` — gate profiles today are plain
      arrays of command strings (`phax.json` → `gateProfiles`, `GateProfilesSchema`), not
      attributed steps. Plan 44 exists but is `Stale`; re-approve it after a real review
      rather than re-planning from scratch.
- [ ] `docs/specs/16-external-gate-steps.md` — no plan. Builds on 15's attributed step,
      so it follows 15.
- [ ] `docs/specs/18-gate-step-scheduling.md` — no plan. Also downstream of 15: a step
      needs attributes before a phase can schedule it.
- [ ] `docs/specs/19-plan-completeness-advisory.md` — no plan, and nothing registers a
      plan auditor in `phax.json`. Independent of the gate trilogy and the smallest of
      the four: a projection (ordered phases + touched files), an advisory pass, no
      blocking.

## Small follow-ups (no spec needed) — closed 2026-08-14

Both open items were covered by one plan —
`docs/plans/49-repo-rooting-and-orient-brief-plan.md` (three phases, `source-spec: null`,
written and approved 2026-08-14, baseline `eb2e0fc`). **Approved `f377cf9`, run, and
landed on `main` 2026-08-14** — `2d9ffeb` CLI path arguments, `2c9f638` the repo-rooted
FileSystem layer, `c0d643e` the orient-brief artifact. **Released as v0.8.2**
(`e9ff74c`).

Plan 49 is the **first run to carry its own completion**: `7ed7541`
(`Approved → Completed`, plan moved to `docs/plans/archive/`) rode in on the run branch
instead of being applied by hand, which is exactly what spec 27 / plan 48 built. No
ride-along spec completion fired, correctly — `source-spec: null`. `phax plans status`
now reports plan 39 alone, fresh.

- [x] Persist the orientation brief as a discrete artifact (`orient-brief.json` next to
      `prompt.md`) — amends the behavior of archived spec 17; the brief used to exist only
      woven into `prompt.md` plus a telemetry count, so the rows the prompt truncated were
      unrecoverable and a failed provider was indistinguishable afterwards from no
      provider. **Landed as plan 49 phase-03** (`c0d643e`) — a tagged record
      (`ok` | `failed` | `not-configured`) written for every phase before dispatch, with
      `src/schemas/orientBrief.ts` decoding it. Nothing consumes it yet; the desktop
      "inspect a run" screen and the compliance review are the natural first readers.
- [x] Audit the remaining active specs (15, 16, 18, 19) for anything already implemented
      on `main` and therefore due a `Completed` flip — **done 2026-08-14: none of them
      is implemented**, nothing to retire. They moved up into their own section above.
- [x] Retire the landed lifecycle artifacts still sitting live: plans 21, 22, 25 and
      specs 21, 22, 25 all shipped but still read `Approved` outside `archive/` —
      exactly the gap draft spec 27 automates. **Done 2026-08-12** — archived plan
      then spec per pair (chain gate order), six auto-committed transitions.
- [x] Align path-rooting on the git convention (run from any subdirectory). The
      CLI used to assume `cwd == repoRoot`: git operations were correctly rooted at
      `config.repoRoot`, but the `FileSystem` port resolved relative paths
      (`docs/plans/approvals.json`, spec files, routing config) against `process.cwd()`.
      The two disagreed the moment you invoked phax from a subdirectory — e.g. the
      staleness gate's git side read the real baseline while the approval-store read
      missed, reporting a spurious `missing-record` and refusing an approved run. git
      itself works from anywhere in the tree by resolving against the repo root; since
      phax is an extension of git and leans on it heavily, it should match that
      contract. Surfaced during the phase-06 staleness-gate review; half of the mechanism
      landed with plan 48 (`db89c52`, `FileSystemOps.rootedAt(root)` on the port and both
      adapters). **Closed by plan 49 phases 01–02, landed 2026-08-14**: `2d9ffeb`
      absolutizes CLI path arguments against the invocation directory at the edge first
      (so rooting can never silently reinterpret a typed path as repo-relative), then
      `2c9f638` builds the base layer rooted at `repoRoot` through one helper in
      `runLayers.ts` that every config-bearing command routes through — with an
      architectural guard (`tests/unit/architecturalGuards.test.ts`) allowlisting the
      commands that legitimately stay on the identity layer, and
      `tests/integration/repoRootedCli.test.ts` exercising invocation from a
      subdirectory.

## TypeScript 7 migration (plan 45, replanned 2026-08-14)

`docs/plans/45-typescript-7-migration-plan.md` went `Stale` (`ground-changed`, package /
lockfile churn) on 2026-08-14 and was **reopened `Stale → Draft` (`13343f6`) and
rewritten in place** rather than re-approved as written — replanning from the existing
plan, keeping the number and the lineage. Two phases, `source-spec: null`; deterministic
extraction verified (2 phases, schema validation passed, no LLM fallback); run branch
short name shortened to `migrate-to-typescript-7`.

Re-verifying the original against `main` at `e9ff74c` killed two of its claims: knip
`6.12.2` **no longer depends on `typescript`** (it runs on `oxc-parser` / `get-tsconfig`),
so the knip gate is insulated from the bump; and the `tsconfig` risk is now a closed
checklist rather than an assumption — the TS 6.0 → 7.0 option-removal set is ten named
options and **none of them is set here**, so a `TS5023` failure would be news, and the
real risk is inference and emit. `typescript@latest` is still `7.0.2`, unchanged since
2026-08-11.

- [x] Pre-run prep, done 2026-08-15 (`322d4a5`): `isolatedModules` and
      `verbatimModuleSyntax` enabled on the base `tsconfig.json`. vitest / vite / tsx and
      Deno all transpile file-by-file through esbuild, and nothing verified the source
      was safe for that — the type-checker and the tools that actually build the code
      disagreed about what they were compiling. Zero source changes needed (all 142
      files with type-only imports already used `import type`), and probed for teeth
      (`TS1484` on a stripped `type` keyword). Landed as its own commit before the bump
      so TS7 inference diagnostics can't be confused with single-file-transpilation
      ones.
- [x] The remaining six followed in `72f26c1`: `noUnusedLocals`, `noUnusedParameters`,
      `noPropertyAccessFromIndexSignature`, `noUncheckedSideEffectImports`,
      `allowUnreachableCode: false`, `allowUnusedLabels: false`. 43 diagnostics, of
      which 29 were a single pattern — `interpret()` in `src/domain/reducer.ts` ended
      each inner switch with a trailing `return assertNever(state)`, unreachable
      *because* the switch is exhaustive. Moved into `default:` clauses, which keeps
      the exhaustiveness proof (verified: dropping a case still fails with `TS2345`).
      The other 14 were real dead code — unused imports/params/type alias and three
      index-signature accesses; removing the dead `PlanFileSets` import then let knip
      see its export was dead too. **The strictness contract is now settled before the
      TS7 bump**, so every diagnostic phase-01 produces is attributable to the compiler.
- [x] Operator step done 2026-08-15 (`92a1827`): `pnpm test:type` added to the `full`
      gate profile in `phax.json`. It is the only check that compiles `tests/type/**`
      and it was absent from `full` — for a compiler migration that is the load-bearing
      check, and a phase cannot add it for itself since gate profiles are frozen at
      `loadConfig` (`src/cli/commands/run.ts:162`). No new command: `test:type` is an
      existing script, and gate commands are already in the frozen effective set.
- [ ] **All pre-run prep now rides on PR #79.** Merge it first, then approve, then run:
      the plan's footprint is create ∪ edit ∪ optional and its optional list names
      `tsconfig.json`, which the strictness commits touch — approving before the merge
      binds the baseline to a tree the merge then changes, flipping plan 45 to
      `ground-changed` and refusing the run.
      1. Merge PR #79.
      2. `phax artifact approve docs/plans/45-typescript-7-migration-plan.md`
      3. `phax run --plan docs/plans/45-typescript-7-migration-plan.md`

## Nice to have improvements

- [ ] Reconciliation classifies optional files as `unplanned`. The reconciliation tool
      builds its "planned" set from the required planned lists only, not the optional
      lists, so an optional file that the phase legitimately delivers shows up as
      `unplanned` in the reconciliation table (its "Planned in" column stays blank).
      Surfaced by plan 49's compliance review, where
      `tests/integration/adjustPlanCommand.test.ts` and `tests/unit/cli/run.test.ts` were
      both flagged this way despite being listed as optional files in the plan. It is a
      tooling classification artifact, not a real delivery deviation — fold the optional
      lists into the reconciler's planned set (or give optional files their own status) so
      future reviewers aren't misled. Further evidence that the reconciler is the odd one
      out, found 2026-08-15: the *footprint* path already counts optional files —
      `buildFootprint` unions create ∪ edit ∪ optional into `.all`
      (`src/domain/planOverlap/compute.ts:25`), which is what `planStaleness.ts:156` and
      `plans-overlap` consume. So staleness and overlap treat an optional file as part of
      the plan while reconciliation does not; two subsystems read the same three lists
      with different semantics.
- [ ] `phax artifact reopen` leaves a dangling approval record. Reopening a plan
      `Stale → Draft` clears neither the `approvals.json` entry nor its fingerprint and
      baseline, so a `Draft` plan keeps an approval record describing a version of itself
      that no longer exists. Found 2026-08-15 on plan 45, which still carries
      `planFingerprint: 3170b1e…` / `baseline: 2843aa2` from its 2026-08-11 approval even
      though it was reopened (`13343f6`) and fully rewritten. It is inert in practice —
      staleness only consults records for `Approved` plans, and `putApprovalRecord`
      overwrites by key (`src/app/approvalRecordStore.ts:62`), so the next approval
      replaces it cleanly. But `removeApprovalRecord` already exists
      (`approvalRecordStore.ts:66`) and is simply not called on the reopen path, so the
      record outlives the approval it records. Either call it on reopen, or state
      deliberately that records are tombstones kept for history — the current behavior
      reads as neither.

## Spike candidate: entire.io × phax (analyzed 2026-08-10)

[entire.io](https://entire.io/) — open-source (MIT) CLI hooking into agent configs
(Claude Code, Codex, Cursor, Gemini, …) that captures full session transcripts (prompts,
tool calls, files touched, tokens) and writes a **Checkpoint per commit** on a shadow
branch `entire/checkpoints/v1` — the session that produced each commit, versioned in the
repo itself. On top: cross-agent query skills (`search` / `explain` / `what-happened` =
blame-to-prompt / `review` diff-vs-intent / `session-handoff`), session resume across
agents, and a hosted tier (distributed git mirrors, org management, secret redaction).

Positioning vs phax — complementary, narrow overlap: phax records the **deliberate,
structured skeleton** (spec → approved plan → phases → reconciled diffs → gates →
curated handoffs, plus decision provenance via specs 21/22); entire records the **raw
conversational evidence** (transcripts per commit). phax does not capture transcripts
(only session IDs via the agent binding; transcripts stay in the provider's local
storage — unversioned, unshared). Entire plans/gates/orchestrates nothing. Overlap is
limited to handoffs (phax's contractual `phase-handoff.md` is stronger for phases) and
"what happened during the run".

- [ ] Write the spike/discovery plan (`fast` gate, findings-doc pattern): enable entire
      on a real phax run and answer three questions — (1) do entire's hooks work inside
      the phax run-jail and agent-config control, (2) do checkpoints survive the
      worktree → merge → publish flow (one checkpoint per phase commit?), (3) is the
      `entire/checkpoints/v1` format readable enough for phax desktop's
      "inspect a run" screen. Caveat to record: transcripts on a git branch are visible
      to anyone who can read the repo; redaction is best-effort.
- [ ] If the spike is a go: decide adopt-vs-pattern — consume entire directly (commit ↔
      session from entire, session ↔ phase ↔ plan ↔ spec from phax = full provenance
      chain) vs adopt only the shadow-branch pattern for phax's own run records
      (`phax/records/v1`), losing transcript capture.
- [ ] Cheaper variant either way: compliance review consumes the phase transcript as
      evidence (diff-vs-intent audit against the extracted plan — entire's `review`
      skill with a far stronger intent referential).

## Spec candidates, deliberately not written yet

- [ ] Preview manifest — `phax.json` declares how to preview a finished run
      (per-project-type discriminated union: web / cli / lib). Write it when desktop
      work starts; nothing consumes it before then.
- [ ] Desktop app (review-by-trajectory cockpit) — stays in `docs/ideas/desktop-app.md`
      until specs 21–24 land: by its own rule the desktop only wraps existing CLI
      surface, so its spec would otherwise invent commands. With 23 and 24 postponed,
      this is parked for as long as they are.

## Postponed — approved specs 23 and 24 (2026-08-14)

Both are approved and plannable at any time; nothing blocks them technically and nothing
above depends on them. Deliberately parked to work the follow-ups and the spike first.
Pick them back up by writing a plan (`phax-planning` skill) — no re-approval needed
unless their ground moves.

- [ ] `docs/specs/23-phase-decision-requests.md` — blocking agent-raised decision
      requests; answer-and-resume; decisions in the review handoff. The smaller of the
      two, and it reuses the pause/resume machinery hardened by plan 48.
- [ ] `docs/specs/24-batch-execution-disjoint-plans.md` — parallel disjoint plans,
      incremental ordered merge, terminal gate on the integration result, published as
      GitHub stacked PRs (`gh stack`, public preview 2026-07-30) with a
      single-integration-PR fallback. The largest piece of work left; consumes 21 + 22.

## Longer horizon (unspecced, revisit deliberately)

Reading of the data-engineering article, second pass (2026-08-10): phax already sits on
the right side of lesson 1 (deterministic orchestration, probabilistic nodes) and
lesson 2 (extract/transform/load separated; the handoff "loaded" by one phase is the
context "extracted" by the next); spec 22 *is* lesson 3 applied (fingerprints = CDC,
approval record = snapshot binding, footprint ∩ baseline = dependency tracking,
"dependents go stale → re-plan only those" = selective recomputation). The gaps it
names, in priority order: the durable context layer is local-only (stateRoot = a
warehouse on a laptop — the entire.io spike addresses exactly this), the plan DAG is
analyzed but not executed (spec 24), and staleness propagation stops at one hop.

- [ ] Cross-run durable context layer — feed the orient provider from phax's own run
      history (handoffs, deviations, final reports) instead of leaving the archive a
      filing cabinet. 2026-08-10 addition: the layer should be **shared, not local** —
      entire's shadow-branch pattern (run records traveling with the repo) is the
      leading candidate; see the entire.io spike above.
- [ ] Staleness propagation depth — spec 22 stops deliberately at one hop
      (spec → plan). Same record/fingerprint/footprint mechanism could later cover any
      derived artifact (reviews, reports, generated docs): "which summaries are now
      stale, which decisions should be reviewed".
- [ ] Desktop as role-shaped interfaces, not an augmented chat — one interface per
      participant over the intention↔evidence graph: approval screen showing what the
      approval commits to (ground, footprint, dependents), staleness dashboard
      (spec 22), run inspection (entire checkpoints as raw material). phax as the
      context engineer's tooling — what dbt was to the analytics engineer.
- [ ] Derived spec views — regenerate a readable spec from the E2E tests on demand (a
      computed report, never a maintained file).
- [ ] Raise-and-continue "assumption" variant for decision requests — excluded from
      spec 23 v1 on purpose; revisit only if real runs show over-blocking.
