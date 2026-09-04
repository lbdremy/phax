# Next steps

The open queue only. Landed work is not recorded here — the git history is the
codebase history, and retired artifacts live in `docs/plans/archive/` and
`docs/specs/archive/`. Tick items off as they land, prune them once they are in the
history, and delete this file when it is empty.

Last pruned 2026-09-04. Since the previous prune (2026-09-03): spec 30 shipped as the
readable provider contract through plan 55 (`eb673ba` orient contract in the usage spec,
`dce28c8` schema descriptions for `orient.command` and the gate-step diagnostics shape,
`04d8ddd` README section plus the two `examples/hello-world` provider scripts, `dba3570`
stdin fix; spec and plan completed `ddd70e2` / `53ddf33`). Spec 31 was planned, approved,
run and shipped in the same stretch as plan 56 (`627349a` spec approval stamp and record
shape, `d9f85ed` recorded approvals plus the chain gate on plan approval, `d73a696`
`artifact status` reporting and re-approval docs; completed `7c67ff4` / `4033952`,
skills documented `1ceb7ae`). Its migration is **done for the parked specs**: 18, 19, 23
and 24 were re-approved with the tool on 2026-09-04 (`19b1958`, `6b2b3ae`, `a74a352`,
`36b267f`) with plain `date` keys restored (`9132ccf`) and the sidecar tracked (`dedb550`).
Spec 32 (archive unfinished runs) was approved a day before the tooling landed, so it was
re-approved on 2026-09-04 (`6330a33`) to record it; its plan is written and approved. No
small follow-ups are open.

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

Five approved specs are open: 32 is approved with plan 57 and ready to run, four are parked
(18, 19, 23, 24). Gate-line specs 18 and 19 were revised and re-approved against main `7b64e98`
on 2026-08-21 (`cd04e3a`, `7b64e98`, `5f67f0a`): 18 gets closure from a registered `scopes`
provider fed with a thin plan projection, 19 shares that projection. All four now carry a
recorded approval, so the chain gate will let a plan be approved against them. Each is
plannable at any time. Pick one up by writing a plan (`phax-planning` skill). Note that plan
staleness is a **plan** property, so a spec parked here does not rot; the plans written
against them do.

### Next to run

- [ ] **Spec 32 / plan 57 — `archive-unfinished-runs`, approved and ready to run.**
      Spec Approved 2026-09-03 (`1ad91c2`) and re-approved with the tool on 2026-09-04
      (`6330a33`) — it had been approved a day before spec 31's tooling landed, so it
      carried no record and the chain gate refused the plan. The plan was renamed from
      `32-` to `57-` (the `32-` slot is taken by the archived
      `32-resumable-handoff-failure-plan.md`; the sequence after 55 and 56 is 57),
      drafted `13b8e4c` and approved `bda1e9d` with lineage recorded against spec 32.
      Two phases: consent-aware archive rule and refusal in the reducer + use case; CLI
      contract and regenerated docs. Launch with
      `phax run archive-unfinished-runs --plan docs/plans/57-archive-unfinished-runs-plan.md`.
      When it reaches review: publish, `phax artifact complete` plan 57 then spec 32,
      prune here.

### Housekeeping

- [ ] The registry carries ~15 runs stuck in `created` from earlier experiments. They are
      exactly what spec 32 unblocks; sweep them with `phax archive --force` once it ships.
- Note: the released `phax` on PATH is v0.10.1 and predates spec 31 — it refuses the
  `Approved → Approved` re-stamp. Run artifact transitions from source (`pnpm dev
  artifact ...`) until the next release.

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
