# Next steps

The open queue only. Landed work is not recorded here — the git history is the
codebase history, and retired artifacts live in `docs/plans/archive/` and
`docs/specs/archive/`. Tick items off as they land, prune them once they are in the
history, and delete this file when it is empty.

Last pruned 2026-08-21, after v0.10.1 shipped plan 53 (`da90570` drops the `--target`
flag `vibe` never accepted — the adapter was broken since it was written, model selection
goes through `VIBE_ACTIVE_MODEL`; `a9231f6` builds the `phax review-code` worklist from
`global-file-reconciliation.json` and deletes the dead `reconciliationMd` input — missing or
malformed JSON degrades to an empty worklist). Earlier the same day v0.10.0 shipped the
gate profile as attributed steps (spec 15 / plan 44 — all design decisions live in the
archived spec; `surface` is the closed enum `local | structural | product`, steps fire
every-phase or terminal, the phase record manifest names `verifiedSurfaces`) and v0.9.0
shipped run records (spec 29 / plan 52). No small follow-ups are open.

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

- [ ] Preview manifest — `phax.json` declares how to preview a finished run
      (per-project-type discriminated union: web / cli / lib). Write it when desktop
      work starts; nothing consumes it before then.
- [ ] Desktop app (review-by-trajectory cockpit) — stays in `docs/ideas/desktop-app.md`
      until specs 21–24 land: by its own rule the desktop only wraps existing CLI
      surface, so its spec would otherwise invent commands. With 23 and 24 postponed,
      this is parked for as long as they are.

## Postponed — every approved-but-unplanned spec

Five approved specs are parked. With plan 44 landed, 16 and 18 are now the natural
next pick — they build directly on the attributed step that shipped in 0.10. Each is
plannable at any time; nothing blocks them technically. Pick one back up by writing a plan (`phax-planning` skill) — no
re-approval needed unless the spec's own ground moves. Note that plan staleness is a
**plan** property, so a spec parked here does not rot; the plans written against them
do.

### Gate specs 16 / 18 and advisory 19

- [ ] `docs/specs/16-external-gate-steps.md` — no plan. Builds on 15's attributed
      step, which is on `main` since 0.10 — unblocked. Re-read the spec against the
      shipped `GateProfilesSchema` / `SurfaceSchema` before planning; it was written
      against the July draft of 15.
- [ ] `docs/specs/18-gate-step-scheduling.md` — no plan. Also unblocked by 0.10.
      Check how much of it plan 44 phase-02 (every-phase vs terminal firing) already
      covers — the spec may shrink to what firing does not express.
- [ ] `docs/specs/19-plan-completeness-advisory.md` — no plan, and nothing registers a
      plan auditor in `phax.json`. Independent of the gate line: a projection
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
