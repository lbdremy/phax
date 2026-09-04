# Next steps

The open queue only. Landed work is not recorded here — the git history is the
codebase history, and retired artifacts live in `docs/plans/archive/` and
`docs/specs/archive/`. Tick items off as they land, prune them once they are in the
history, and delete this file when it is empty.

Last pruned 2026-09-04 (second prune that day). Since the previous prune (earlier on
2026-09-04): spec 32 shipped through plan 57 in one sitting — run `archive-unfinished-runs`
(`ab26aaf` consent-aware archive rule, refusal in the reducer and use case, `--force` on the
CLI; `3e0d11a` README and usage docs), merged as PR #90, plan 57 and spec 32 completed
(`f010f9d` / `c34660d`). `phax archive --force` now exists, so the stuck-runs sweep below is
unblocked. Spec 31's migration was already done for the parked specs (18, 19, 23, 24
re-approved with the tool on 2026-09-04). No approved spec is in flight any more; everything
left is either parked, housekeeping, or a candidate not yet written.

## Records consumers (the substrate shipped in 0.9)

- [ ] First consumer: **compliance review as diff-vs-intent evidence.** Today it
      compares the diff against the extracted plan; the transcript adds *how* the
      phase got there — files read versus files claimed, approaches abandoned, the
      point of drift. Needs no distribution answer (the review runs on the machine
      that ran the phases), so it is the cheapest thing to build on top.
- Second consumer shipped in 0.10: `verifiedSurfaces` in the record manifest
  (plan 44 phase-05) — surface coverage is now queryable across runs, but nothing
  queries it yet.
- Still deferred from the build-not-adopt scope decision: `records activity` /
  `recap` / `dispatch` cross-run summaries — the durable-context-layer consumers
  (see longer horizon).

## Spec candidates, deliberately not written yet

- [ ] **OpenSpec-inspired ideas — brainstorm before speccing.** Captured 2026-09-01 in
      `docs/ideas/openspec-inspired-ideas.md` from the OpenSpec comparison
      (`docs/comparisons/openspec-vs-phax.md`). Three pistes: living specs describing
      current system behavior with requirement deltas folded back at `phax artifact
      complete` (would give spec 22's `spec-changed` check a meaningful baseline);
      requirement-level traceability on top of the file-level reconciliation (refines
      `plans overlap` and the compliance review); an explicit explore step before
      `phax-spec`. Brainstorm the first piste before writing anything — spec 31 shipped
      2026-09-03, so a spec approval now has its own fingerprinted record and the
      living-spec piste has a baseline to fold deltas into; build on it rather than
      beside it.
- [ ] Preview manifest — `phax.json` declares how to preview a finished run
      (per-project-type discriminated union: web / cli / lib). Write it when desktop
      work starts; nothing consumes it before then.
- [ ] Desktop app (review-by-trajectory cockpit) — stays in `docs/ideas/desktop-app.md`
      until specs 21–24 land: by its own rule the desktop only wraps existing CLI
      surface, so its spec would otherwise invent commands. With 23 and 24 postponed,
      this is parked for as long as they are.

## Approved specs — in flight, next, parked

Four approved specs are open, all parked (18, 19, 23, 24). Gate-line specs 18 and 19 were
revised and re-approved against main `7b64e98` on 2026-08-21 (`cd04e3a`, `7b64e98`, `5f67f0a`):
18 gets closure from a registered `scopes` provider fed with a thin plan projection, 19 shares
that projection. All four carry a recorded approval, so the chain gate will let a plan be
approved against them. Each is plannable at any time. Pick one up by writing a plan
(`phax-planning` skill). Note that plan staleness is a **plan** property, so a spec parked here
does not rot; the plans written against them do.

### Housekeeping

- Done 2026-09-04: registry fully swept. The plan 57 run was archived after PR #90 merged,
  then every unfinished run from the June experiments (ten in `created`, five in
  `failed` / `interrupted` / `rate_limited`, two of them louloupapers runs) was archived with
  `phax archive --force` from source. `~/.phax/runs/` and `~/.phax/worktrees/` are empty;
  the registry holds only `archived` entries. Six runs predated spec 12 and their
  `run-status.json` had no `namespace` (one plan also lacked `run.requiredCommands`); they
  were hand-patched first, since there is no back-compat shim and the unqualified resolver
  reports such a folder as "not found" rather than as unreadable. The louloupapers pair had
  to be archived from the phax repo by qualified name (its `phax.json` is pre-spec-15 and
  the CLI refuses to load there), followed by a manual `git worktree prune` in that repo —
  cross-project archive only prunes the current repo. Migrate that `phax.json` before
  running phax in louloupapers again.
- [ ] Cut a release. `main` is 57 commits past `v0.10.1` (2026-08-21) with eight `feat`/`fix`
      commits: the diagnostic gate steps (spec 16), the provider contract docs (spec 30), spec
      approval records and the chain gate (spec 31), and `archive --force` (spec 32). Until it
      ships, the `phax` on PATH (0.10.1) refuses the `Approved → Approved` re-stamp and has no
      `--force`, so artifact transitions and the sweep above must run from source (`pnpm dev`).

### Gate spec 18 and advisory 19

- [ ] `docs/specs/18-gate-step-scheduling.md` — no plan. Its dependency, spec 16, shipped
      in plan 54 (2026-09-02), so nothing blocks it. Adds `class` + `scopes` per diagnostic,
      a `scopes` provider queried per gated phase, and `pending` as a third attribution
      result. phax defines the provider contract; steme (or any provider) implements it.
- [ ] `docs/specs/19-plan-completeness-advisory.md` — no plan. Shares 18's plan
      projection; plan it after (or with) 18 so the projection is built once.

### Specs 23 and 24 — parked 2026-08-14

- [ ] `docs/specs/23-phase-decision-requests.md` — blocking agent-raised decision
      requests; answer-and-resume; decisions in the review handoff. The smaller of the
      two, and it reuses the pause/resume machinery hardened by plan 48.
- [ ] `docs/specs/24-batch-execution-disjoint-plans.md` — parallel disjoint plans,
      incremental ordered merge, terminal gate on the integration result, published as
      GitHub stacked PRs (`gh stack`, public preview 2026-07-30) with a
      single-integration-PR fallback. The largest piece of work left; consumes 21 + 22.

### Stale plans with no active spec

- [ ] Re-approve plan 41 (`41-claude-protected-path-approval-hook-plan.md`) when you
      next intend to run it. It is `Stale` (`ground-changed`: its footprint still names
      the `.agents/` mirror the `phax-planning` skill rewrite deleted). `Stale →
      Approved` is a legal direct transition — no Draft round-trip — but it needs a real
      read against `main` first.
- [ ] Plan 39 (`39-smolvm-isolation-spike-plan.md`) reads `Approved` in its frontmatter but
      `phax plans status` reports it `STALE` with `missing-record`: its recorded approval
      baseline `2843aa2` no longer exists on `main` (rewritten history). Either re-approve it
      with a fresh read (`pnpm dev artifact approve docs/plans/39-…`) or abandon it if the
      smolvm spike is no longer worth running; do not leave the frontmatter and the record
      disagreeing.

## Longer horizon (unspecced, revisit deliberately)

Reading of the data-engineering article, second pass (2026-08-10): phax already sits on
the right side of lesson 1 (deterministic orchestration, probabilistic nodes) and
lesson 2 (extract/transform/load separated; the handoff "loaded" by one phase is the
context "extracted" by the next); spec 22 *is* lesson 3 applied (fingerprints = CDC,
approval record = snapshot binding, footprint ∩ baseline = dependency tracking,
"dependents go stale → re-plan only those" = selective recomputation). The gaps it
named, updated 2026-08-21: the durable context layer's substrate now exists —
run records shipped in 0.9 and travel (`phax/records/v1`, dedicated records repo for
public sources, `phax records sync`) — so the remaining gap is the *consumer*, not
the storage; the plan DAG is analyzed but not executed (spec 24); and staleness
propagation stops at one hop.

- [ ] Cross-run durable context layer — feed the orient provider from phax's own run
      history (handoffs, deviations, final reports) instead of leaving the archive a
      filing cabinet. Unblocked 2026-08-21: the record travels, so the layer can be
      **shared, not local**. First raw material already exists and is still unread:
      the per-phase orientation brief (`orient-brief.json`, plan 49) and, since 0.10,
      the per-phase `verifiedSurfaces` manifest field.
- [ ] Staleness propagation depth — spec 22 stops deliberately at one hop
      (spec → plan). Same record/fingerprint/footprint mechanism could later cover any
      derived artifact (reviews, reports, generated docs): "which summaries are now
      stale, which decisions should be reviewed".
- [ ] Desktop as role-shaped interfaces, not an augmented chat — one interface per
      participant over the intention↔evidence graph: approval screen showing what the
      approval commits to (ground, footprint, dependents), staleness dashboard
      (spec 22), run inspection (run records as raw material). phax as the
      context engineer's tooling — what dbt was to the analytics engineer.
- [ ] Derived spec views — regenerate a readable spec from the E2E tests on demand (a
      computed report, never a maintained file).
- [ ] Raise-and-continue "assumption" variant for decision requests — excluded from
      spec 23 v1 on purpose; revisit only if real runs show over-blocking.
