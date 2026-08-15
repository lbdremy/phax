# Next steps

The open queue only. Landed work is not recorded here — the git history is the
codebase history, and retired artifacts live in `docs/plans/archive/` and
`docs/specs/archive/`. Tick items off as they land, prune them once they are in the
history, and delete this file when it is empty.

Last pruned 2026-08-15, after the TypeScript 7 migration landed and closed the
21 → 22 → 25 → 26 → 28 → 27 lifecycle chain's last follow-ups.

## Release pending

- [ ] Cut **v0.8.3**. The last tag is v0.8.2; the tsconfig strictness tightening and
      the TypeScript 7 bump are on `main` unreleased. Fold it into the next feature
      release if one is close.

## Nice to have improvements — planned as plan 50, ahead of the release

Both are covered by `docs/plans/50-reconciliation-and-reopen-cleanups-plan.md`
(**Draft**, written 2026-08-15, `source-spec: null`, two phases, deterministic extraction
verified — 2 phases, no LLM fallback). They share no files and no concepts, so the phases
are independently committable. Three arbitrations were settled with the user and recorded
in the plan preamble: optional files get their **own** `optional-touched` status rather
than being folded into `plannedInPhases`; only reopen clears the approval record
(`Approved → Stale` deliberately keeps it); and reopen clears the `approved:` frontmatter
stamp as well as the store record.

- [ ] **phase-01** — the global reconciliation table classifies touched optional files as
      `unplanned`. Regrounded 2026-08-15, and the earlier description here was wrong about
      where: the **per-phase** reconciler is already correct — `reconcile()` unions
      create ∪ edit ∪ optional into its plan set
      (`src/domain/reconciliation/reconcile.ts:24`) and routes touched optional files to
      `optionalTouched`. The defect is one layer up in `aggregateGlobalReconciliation`
      (`src/domain/reconciliation/global.ts:164`), which adds the phase to
      `touchedInPhases` but never to `plannedInPhases`, so `deriveStatus` returns
      `unplanned` and the "Planned in" column renders `—`. A unit test currently pins the
      wrong behavior (`tests/unit/reconciliation/global.test.ts:353`). Surfaced by plan
      49's compliance review, where `tests/integration/adjustPlanCommand.test.ts` and
      `tests/unit/cli/run.test.ts` were both flagged despite being listed as optional.
      The *footprint* path already counts optional files — `buildFootprint` unions them
      into `.all` (`src/domain/planOverlap/compute.ts:25`), which is what
      `planStaleness.ts:156` and `plans-overlap` consume — so staleness and overlap treat
      an optional file as part of the plan while the global reconciler does not.
- [ ] **phase-02** — `phax artifact reopen` leaves a dangling approval. `Stale → Draft`
      clears neither the `approvals.json` entry nor the `approved:` frontmatter stamp, so
      a `Draft` plan keeps an approval describing a version of itself that is about to be
      rewritten. Found 2026-08-15 on plan 45. Inert today — staleness only consults
      records for `Approved` plans, and `putApprovalRecord` overwrites by key
      (`src/app/approvalRecordStore.ts:62`) — but the **completion** path already calls
      `removeApprovalRecord` (`approvalRecordStore.ts:66`), so the two exits from
      `Approved` disagree: complete cleans up, reopen does not. Note `Approved → Draft`
      is not a legal plan transition, so `Stale → Draft` is the only reopen. The fix has
      one non-obvious edge the plan calls out: `transitionWriteSet` must also carry
      `approvals.json` on a plan reopen, since the write-set is both the dirty
      precondition and the exact set the transition commits.
- [ ] Approve and run plan 50, then cut the release above. Nothing sequences it after the
      release — running it first just means v0.8.3 carries both fixes.

## Spike candidate: entire.io × phax (analyzed 2026-08-10) — active queue head

With the gate trilogy parked alongside 23 and 24, this is the only substantive work left
active; the two items above are cheap fixes to slot in around it.

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

## Postponed — every approved-but-unplanned spec

All six approved specs are parked. Each is plannable at any time; nothing blocks them
technically and nothing in the active queue depends on them. Pick one back up by writing
a plan (`phax-planning` skill) — no re-approval needed unless the spec's own ground
moves. Note that plan staleness is a **plan** property, so a spec parked here does not
rot; the plans written against them do.

### Gate trilogy 15 / 16 / 18 and advisory 19 — parked 2026-08-15

Approved 2026-07-03, never planned, audited against `main` 2026-08-14: **none of the
four is implemented**. Spec 15 is the entry point whenever this is picked back up — 16
and 18 both wait on 15's attributed step; 19 is independent and the smallest of the four.

- [ ] `docs/specs/15-gate-profile-attributed-steps.md` — gate profiles today are plain
      arrays of command strings (`phax.json` → `gateProfiles`, `GateProfilesSchema`), not
      attributed steps. Plan 44 exists but is `Stale`. **Take plan 45's route, not a
      re-approval as written**: reopen `Stale → Draft` and replan in place, keeping the
      number and lineage. Checked 2026-08-15 — the plan's "architecture seams" section
      cites line numbers that have all moved under plans 46–49 (`isFinal` 415 → 485,
      `GateProfilesSchema` 38-43 → 46, `executePlan.ts` now 1448 lines), it predates the
      repo-rooted layer helper 49 introduced, and its five phases still recommend
      `claude-sonnet-4-6`. The prose contract is sound; the ground under it is not — and
      it drifts further the longer this stays parked, so re-check rather than trusting
      that note.
- [ ] `docs/specs/16-external-gate-steps.md` — no plan. Builds on 15's attributed step,
      so it follows 15.
- [ ] `docs/specs/18-gate-step-scheduling.md` — no plan. Also downstream of 15: a step
      needs attributes before a phase can schedule it.
- [ ] `docs/specs/19-plan-completeness-advisory.md` — no plan, and nothing registers a
      plan auditor in `phax.json`. Independent of the gate trilogy: a projection
      (ordered phases + touched files), an advisory pass, no blocking.

### Specs 23 and 24 — parked 2026-08-14

- [ ] `docs/specs/23-phase-decision-requests.md` — blocking agent-raised decision
      requests; answer-and-resume; decisions in the review handoff. The smaller of the
      two, and it reuses the pause/resume machinery hardened by plan 48.
- [ ] `docs/specs/24-batch-execution-disjoint-plans.md` — parallel disjoint plans,
      incremental ordered merge, terminal gate on the integration result, published as
      GitHub stacked PRs (`gh stack`, public preview 2026-07-30) with a
      single-integration-PR fallback. The largest piece of work left; consumes 21 + 22.

### Stale plan with no active spec

- [ ] Re-approve plan 41 (`41-claude-protected-path-approval-hook-plan.md`) when you
      next intend to run it. It is `Stale` (`ground-changed`: its footprint still names
      the `.agents/` mirror the `phax-planning` skill rewrite deleted). `Stale →
      Approved` is a legal direct transition — no Draft round-trip — but it needs a real
      read against `main` first.

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
      leading candidate; see the entire.io spike above. First raw material now exists:
      the per-phase orientation brief (`orient-brief.json`, plan 49) is written for
      every phase and nothing consumes it yet.
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
