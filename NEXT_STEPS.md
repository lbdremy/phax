# Next steps

The open queue only. Landed work is not recorded here — the git history is the
codebase history, and retired artifacts live in `docs/plans/archive/` and
`docs/specs/archive/`. Tick items off as they land, prune them once they are in the
history, and delete this file when it is empty.

Last pruned 2026-09-08. On 2026-09-07 two plans shipped back to back on `main`: spec 18 through
plan 58 (`03fadad`..`5eeed8f` — diagnostic classes, the registered `scopes` provider, the plan
projection in `src/domain/plan/projection.ts`, scheduling against closed scopes, `pending` as
optional work), merged as PR #92 with plan 58 and spec 18 completed (`7842f6c` / `a14119e`);
then the September catalog refresh through plan 59 (`0a7ccc2` Fable 5.1 + Opus 5 with
ultracode on xhigh-capable entries, `a42153d` GPT-6 Astra anchored to Fable 5.1 as a
downgrade, `8f5073d` review/adjust defaults re-pointed to Opus 5 and Sonnet 5), merged as
PR #93 and completed (`0204d53`). The run-lookup follow-up below went in first as PR #91
(`911457a`). v0.12.0 shipped the same day (`a1cfdff`): the staged npm publish was approved, and `latest`
and the global install are both 0.12.0. Three approved specs remain, all
parked (19, 23, 24); 19 is now the cheapest to pick up since plan 58 built the projection it
shares.

## Small follow-ups

- [ ] **`phax run` allocates the run before its preflight.** Found 2026-09-08: `run`
      creates the run folder and the registry entry, then `executePlan` runs the
      required-commands, mcp, records and clean-tree preflights. A preflight refusal leaves
      a `created` run holding the slug, and the retry gets `-2`. Seven of the ten `-2`
      pairs in the local registry are exactly that (first attempt holds only the
      snapshotted plan and status; second attempt 28 s to 3 min later). Fix: run every
      preflight that needs only the plan and the config before `createRunFolder`, so a
      refused run never exists. Spec 33 (plan lint) mitigates by catching two of the
      causes earlier but does not fix the ordering.
- [x] **Unqualified run lookup says "not found" for a folder that exists but fails to
      decode.** Fixed 2026-09-07 (PR #91, `911457a`): `resolveRunRef` now checks the registry on the unqualified
      in-project path too and refuses with `unresolvable-qualified` when the entry exists but
      the files fail to load; the refusal message carries the load reason, including the
      schema issues (which field is missing) that `loadRunReviewInfo` used to discard.

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

## Approved specs — in flight, next, parked

Four approved specs are open: 33 is next (plan approved), 19 follows it, 23 and 24 are parked. Spec 18 shipped 2026-09-07 through
plan 58 (PR #92) and is archived. Spec 19 was revised and re-approved alongside 18 on
2026-08-21 (`cd04e3a`, `7b64e98`, `5f67f0a`) and re-approved with the tool on 2026-09-04
(baseline `44bd9b3`), so it carries a recorded approval and the chain gate will let a plan be
approved against it. All three are plannable at any time. Pick one up by writing a plan
(`phax-planning` skill). Note that plan staleness is a **plan** property, so a spec parked here
does not rot; the plans written against them do.

### Housekeeping

- [x] **Archive today's three runs.** Done 2026-09-07: `gate-step-scheduling-2` and
      `catalog-fable-5-1-opus-5-gpt-6-astra` (both `review_open`, PRs #92 / #93 merged)
      archived normally; `gate-step-scheduling` (the first attempt at plan 58, never ran)
      with `--force`. Registry holds only `archived` entries again and
      `~/.phax/worktrees/` is empty. The leftover non-phax worktree for PR #91
      (`../phax-run-lookup-unreadable`) and its branch were removed 2026-09-08.
- Done 2026-09-04: registry fully swept of the June experiments (ten in `created`, five in
  `failed` / `interrupted` / `rate_limited`, two of them louloupapers runs) with
  `phax archive --force` from source. Six runs predated spec 12 and were hand-patched first
  (no `namespace` in `run-status.json`, one plan lacking `run.requiredCommands`). The
  louloupapers pair had to be archived from the phax repo by qualified name (its `phax.json`
  is pre-spec-15 and the CLI refuses to load there), followed by a manual `git worktree
  prune` in that repo — cross-project archive only prunes the current repo. Migrate that
  `phax.json` before running phax in louloupapers again.

### Spec 33 — plan lint (next)

- [ ] `docs/specs/33-plan-lint.md` approved 2026-09-08 (`7dd2b9d`, baseline `02cea17`); plan
      `docs/plans/33-plan-lint-plan.md` approved the same day (`1fb5549`, baseline `4146814`),
      six phases, no required commands. `phax plans lint <plan>`: structural findings from the
      accumulating parser, sequence-aware file-plan rule, `commands` / `models` readiness
      checks reusing the run preflight, `--json`, exit 1 on errors; removes `extract-plan`
      (code, generated docs, README, three skills, hello-world example). Run it, then archive.

### Advisory spec 19 (after 33)

- [ ] `docs/specs/19-plan-completeness-advisory.md` — no plan. Revised and re-approved
      2026-09-08 (`e07e35d` / `583dc4b`): the auditor handoff now fires inside `phax plans lint`
      as an `advisory` check that never sets the exit code. Depends on plan 33 landing (the
      `lintPlan` use case is its hook); the projection it consumes already exists
      (`src/domain/plan/projection.ts`). Then a thin one- or two-phase plan.

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
- [x] Plan 39 (`39-smolvm-isolation-spike-plan.md`) re-approved 2026-09-08 (`0ffe7a5`,
      baseline `322ba3a`) after a read against `main`: its premises hold (`isolated` mode
      still reserved and gated, `smolvm` still declared in `agentCommands`, its model ids
      still active in the catalog); the one drift was the `fast` gate profile it named,
      removed 2026-08-21 when a project went to a single profile — reworded to `standard`
      (`322ba3a`). `phax plans status` reports it fresh. Prune this entry next pass.

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
