# Next steps

Follow-up work identified on 2026-08-09 (mapping phax against data-engineering lessons —
graphs / ETL / change detection / democratization — and the desktop-app idea in
`docs/ideas/desktop-app.md`); updated 2026-08-10 (entire.io positioning analysis and a
second pass on the Josh Rosen data-engineering article); updated 2026-08-11 (spec 26
frontmatter planning added as priority); updated 2026-08-12 (plans 22 + 25 landed;
draft specs 27 + 28 approval sequence added); updated 2026-08-13 (spec 26 / plan 46
landed and retired; specs 27 + 28 swept for it). Tick items off as they land, and
delete this file when it is empty.

## Approve the draft specs 27 and 28 (in this order)

Two Drafts written 2026-08-12. Order matters: 28 renames the vocabulary 27 is written
in, so 28 goes first and 27 gets swept before its approval. Both were swept on
2026-08-13 for the fact that spec 26 landed — no stale cross-references remain.

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
- [ ] **Next — sweep then approve `docs/specs/27-run-carries-archival.md`**: terminology
      (`Archived` → `Completed`, `archive` verb → `complete`) now that 28 is approved,
      then review + approve — run completion (final phase gates green, before
      `review_open`) applies the plan's terminal transition on the run branch;
      ride-along spec completion behind the chain gate; `phax publish-pr` untouched;
      merge lands work + record atomically. Its spec-26 sequencing constraint is
      already lifted, and it now states as a non-goal (2026-08-13) that dependent plans'
      `source-spec` keys are *not* rewritten when the ride-along archival moves a spec:
      resolution accepts the declared path or its archive counterpart, so the two
      spellings the repository carries both resolve, and rewriting them would pull
      non-transitioning files into the write-set spec 25 scopes.
- [ ] Ripple from 28: the `phax-spec`/`phax-planning` skills, the CLI help
      (`phax.usage.kdl`) and `docs/cli/reference.md` all state `Archived`/`archive` —
      spec 26's phase-03 just rewrote them, and 28's rollout rewrites them again.
- [ ] Plan 28 (and 27) once both specs are approved — no plan exists for either yet.

## Plan and run the approved specs

The lifecycle chain 21 → 22 → 25 → 26 has all landed. What remains here is 23 and 24:
independent of each other, both plannable now — 24 is the largest and consumes 21 + 22.

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
  - [ ] Plans 41, 44 and 45 are stale as of 2026-08-13 (`ground-changed`: 41 from the
        `phax-planning` skill rewrite, 44 from README/`docs/cli/reference.md`/`phax.json`
        churn, 45 from `package.json`/lockfile churn — landing plans 22, 25 and 46).
        Only plan 39 computes fresh. Review and `phax artifact approve` them before
        running — `phax plans status` is the source of truth.
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
- [ ] `docs/specs/23-phase-decision-requests.md` — blocking agent-raised decision
      requests; answer-and-resume; decisions in the review handoff.
- [ ] `docs/specs/24-batch-execution-disjoint-plans.md` — parallel disjoint plans,
      incremental ordered merge, terminal gate on the integration result, published as
      GitHub stacked PRs (`gh stack`, public preview 2026-07-30) with a
      single-integration-PR fallback.

## Small follow-ups (no spec needed)

- [ ] Persist the orientation brief as a discrete artifact (`orient-brief.json` next to
      `prompt.md`) — one-phase plan amending the behavior of archived spec 17; today the
      brief exists only woven into `prompt.md` plus a telemetry count.
- [ ] Audit the remaining active specs (15, 16, 18, 19) — any that are implemented on
      `main` should be flipped `Archived` and moved to `docs/specs/archive/` (done for
      17 on 2026-08-09).
- [x] Retire the landed lifecycle artifacts still sitting live: plans 21, 22, 25 and
      specs 21, 22, 25 all shipped but still read `Approved` outside `archive/` —
      exactly the gap draft spec 27 automates. **Done 2026-08-12** — archived plan
      then spec per pair (chain gate order), six auto-committed transitions.
- [ ] Align path-rooting on the git convention (run from any subdirectory). Today the
      CLI implicitly assumes `cwd == repoRoot`: git operations are correctly rooted at
      `config.repoRoot`, but the `FileSystem` port resolves relative paths
      (`docs/plans/approvals.json`, spec files, routing config) against `process.cwd()`.
      The two disagree the moment you invoke phax from a subdirectory — e.g. the
      staleness gate's git side reads the real baseline while the approval-store read
      misses, reporting a spurious `missing-record` and refusing an approved run. git
      itself works from anywhere in the tree by resolving against the repo root; since
      phax is an extension of git and leans on it heavily, it should match that
      contract. Direction: root the `FileSystem` adapter at `repoRoot` (or resolve
      repo-relative paths through a single helper) so `run`, `artifact`, and `plans`
      behave identically regardless of the working directory. Surfaced during the
      phase-06 staleness-gate review.

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
      surface, so its spec would otherwise invent commands.

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
