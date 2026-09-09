# Next steps

The open queue only. Landed work is not recorded here — the git history is the
codebase history, and retired artifacts live in `docs/plans/archive/` and
`docs/specs/archive/`. Tick items off as they land, prune them once they are in the
history, and delete this file when it is empty.

Last pruned 2026-09-09. Two plans shipped back to back on `main`: spec 33 through plan 33
on 2026-09-08 (`4531cb51`..`c9ec7ad4` — `phax plans lint` with the accumulating parser, the
sequence-aware file-plan rule and the run-readiness checks; `extract-plan` removed, the
write → lint → run flow documented), merged as PR #94 and completed (`e7126f09` /
`a3f12af5`); then spec 19 through plan 60 on 2026-09-09 (`1069c2bc`..`5bbf84d5` — the
registered plan auditor next to `orient` and `scopes`, the plan-audit request over the
projection, advisory findings inside `plans lint` that never set the exit code, a
hello-world auditor), merged as PR #96 and completed (`ab3772e2` / `7200a2f1`), followed by
two same-day fixes (`c1b8f685` auditor failure cause kept, `77b7a117` the auditor capped by
an optional shell timeout). v0.13.0 shipped 2026-09-09 (`9dd47f0e`): the release workflow
passed and `@lbdremy/phax@latest` is 0.13.0. Two approved specs remain, both parked (23, 24).

## Small follow-ups

- [ ] **`phax run` allocates the run before its preflight.** Found 2026-09-08: `run`
      creates the run folder and the registry entry, then `executePlan` runs the
      required-commands, mcp, records and clean-tree preflights. A preflight refusal leaves
      a `created` run holding the slug, and the retry gets `-2`. Seven of the ten `-2`
      pairs in the local registry are exactly that (first attempt holds only the
      snapshotted plan and status; second attempt 28 s to 3 min later). Fix: run every
      preflight that needs only the plan and the config before `createRunFolder`, so a
      refused run never exists. Still open after plan 33 (checked 2026-09-09):
      `phax plans lint` now catches the `commands` and `models` causes before a run is
      started, but `src/cli/commands/run.ts` still calls `createRunFolder` before
      `executePlan`, so a refusal from any other preflight still burns the slug.

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
- [ ] **`phax prune` — delete archived runs.** Raised 2026-09-08 alongside the `-2`
      diagnosis. Slugs must never collide (kept), so the registry keeps archived runs as
      name-holders; the way to free a name is to delete the archived run for real, not to
      weaken uniqueness. A `prune` command that removes archived runs (folder, worktrees,
      registry entry) makes the slug free itself. Distinct from `archive`, which moves and
      keeps.
- [ ] Preview manifest — `phax.json` declares how to preview a finished run
      (per-project-type discriminated union: web / cli / lib). Write it when desktop
      work starts; nothing consumes it before then.
- [ ] Desktop app (review-by-trajectory cockpit) — stays in `docs/ideas/desktop-app.md`
      until specs 21–24 land: by its own rule the desktop only wraps existing CLI
      surface, so its spec would otherwise invent commands. With 23 and 24 postponed,
      this is parked for as long as they are.

## Approved specs — parked

Two approved specs are open, 23 and 24, both parked since 2026-08-14. Specs 33 and 19
shipped 2026-09-08 / 2026-09-09 (PRs #94 / #96) and are archived; nothing is in flight.
Both remaining specs are plannable at any time. Pick one up by writing a plan
(`phax-planning` skill) and running `phax plans lint` on it — the advisory auditor now
fires there too. Note that plan staleness is a **plan** property, so a spec parked here
does not rot; the plans written against them do.

### Housekeeping

- [x] **Archive the two `review_open` runs.** Done 2026-09-09: `phax.plan-lint` (plan 33,
      PR #94) and `phax.plan-completeness-advisory` (plan 60, PR #96) archived normally.
      Registry holds only `archived` entries again and `~/.phax/worktrees/` is empty.
      Prune this entry next pass.
- [x] **Bump the global install to 0.13.0.** Done 2026-09-09 (`npm install -g
      @lbdremy/phax@0.13.0`); `phax --version` reports 0.13.0. Prune this entry next pass.
- Standing note from the 2026-09-04 registry sweep: the louloupapers `phax.json` is
  pre-spec-15 and the CLI refuses to load there. Migrate it before running phax in
  louloupapers again (its two runs were archived from the phax repo by qualified name,
  followed by a manual `git worktree prune` in that repo — cross-project archive only
  prunes the current repo).

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
      read against `main` first. Plan 39 (`39-smolvm-isolation-spike-plan.md`) was
      re-approved 2026-09-08 and `phax plans status` still reports it fresh.

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
      the per-phase `verifiedSurfaces` manifest field. Since 0.13 there is a third
      registered provider (the plan auditor) that could read the same history.
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
