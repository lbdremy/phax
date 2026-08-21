# Next steps

The open queue only. Landed work is not recorded here — the git history is the
codebase history, and retired artifacts live in `docs/plans/archive/` and
`docs/specs/archive/`. Tick items off as they land, prune them once they are in the
history, and delete this file when it is empty.

Last pruned 2026-08-21, after v0.9.0 shipped phax run records (spec 29 / plan 52 —
all design decisions live in the archived spec), the gate-profile work was revived
(spec 15 revised and plan 44 re-approved the same day), and the entire spike was
declared done (teardown included; findings live in
`docs/spikes/entire-checkpoint-findings.md`).

## Gate profile as attributed steps — plan 44 — re-approved 2026-08-21 — active queue head

Spec 15 was revised in place 2026-08-21 (`2a5110a`, status stays Approved): `surface`
is now a **closed enum** `local | structural | product` (the free-label default of
2026-07-10 was reversed — the doctrine's three-loop axis is complete, and a free label
lets typos and cargo-cult values degrade the attribution the spec exists to protect);
the phase's attribution record **rides the run record** with the verified surfaces
named in a v2 manifest (`verifiedSurfaces`, required, no shim); and "verified" is
tightened to *every step of the surface that ran passed*. Rationale traces to
steme-doc doctrine (`01-vision/verification-system-view.md`,
`01-vision/phax-execution-harness-and-brief-profiles.md` §3) — surface is the axis
attribution lives on, and spec 29 shipping first gave it a live consumer.

Plan 44 was revised to match (SurfaceSchema as the single source of the enum, a pure
domain `verifiedSurfaces` helper shared by final report and record manifest, a new
phase-05 wiring the record manifest, docs renumbered to phase-06) and re-approved
`Stale → Approved` (`0f1eecc`, baseline `2a5110a`, spec fingerprint re-captured).

- [ ] **Run plan 44** (`phax run`) — six phases: attributed-step schema → firing
      scheduling → per-phase attribution → run-end surfaces → record manifest v2 →
      docs.
- [ ] **Audit debt the revision only partially retired.** The 2026-08-15 parked-note
      audit found the plan's "architecture seams" line numbers had all moved under
      plans 46–52 (`isFinal` 415 → 485, `GateProfilesSchema` 38-43 → 46,
      `executePlan.ts` now ~1448 lines) and prescribed a Draft round-trip; the
      2026-08-21 revision re-approved directly instead. Only the new phase-05 seams
      (`writeRecordForPhase` at `:288-310`, the records modules) were verified against
      current `main`; the July line numbers in phases 01–04 remain stale, and every
      phase still recommends `claude-sonnet-4-6`. Either refresh seams + model
      recommendations in place before running (edits re-stale the plan — one more
      approve), or accept the agent re-locating the seams from the prose contract,
      which *is* current.

After it lands: specs 16 and 18 unpark (both build on 15's attributed step), and the
`phax-planning` skill's spike gate doctrine needs rewording (see small follow-ups).

## Small follow-ups

- [ ] **Rework the `phax-planning` skill's spike gate-profile doctrine once plan 44
      lands.** The original defect — "the gate profile a plan names is not the gate
      profile it runs" (plan 51 named `fast` per the skill's spike doctrine, the run
      used `full`; `### Verification` is informational and no mechanism selects a
      profile) — is dissolved mechanically by plan 44 phase-01: the `full`/`fast`
      preference is removed, a project defines one profile, and firing carries the
      cadence. What survives is the skill itself still prescribing "use the `fast`
      gate profile, not `full`" — after 44 that names a convention that no longer
      exists. Restate the spike guidance in firing terms (a spike profile is
      every-phase local steps; no terminal build/smoke).
- [ ] **`buildVibeArgs` passes a `--target` flag that `vibe` no longer accepts.** Found
      2026-08-20 while probing provider transcript shapes for spec 29.
      `src/infra/providers/mistralVibe.ts:105-109` always appends `--target <model>`;
      vibe 2.13.0 answers `vibe: error: unrecognized arguments: --target` and exits 2,
      so **every** `mistral-vibe` phase would fail at spawn. Model selection already works
      through the `VIBE_ACTIVE_MODEL` env var that the same adapter sets
      (`modelEnvVar`), and the local `~/.vibe/config.toml` does carry the
      `phax-mistral-medium-3.5-*` aliases — so the fix is to drop the flag, not to
      replace it. Unnoticed because `mistral-vibe` ships `enabled: false`
      (`src/domain/routing/defaults.ts:123`) and no e2e run exercises it. Check whether
      `--target` ever existed or was always wrong before deciding how far back the
      breakage goes. Still present on `main` as of 2026-08-21 (`mistralVibe.ts:109`).
- [ ] **`phax review-code`'s prompt never carries its worklist.**
      `prepareCodeReviewSession` reads `global-file-reconciliation.md` and passes it as
      `reconciliationMd` (`src/app/reviewCode.ts:206-210,247-253`), but
      `buildCodeReviewPrompt` never destructures it
      (`src/domain/review/codeReviewPrompt.ts:25`) — and the same call site hardcodes
      `attentionPoints: []`. So the prompt's `## Primary worklist — attention points
      from reconciliation` section renders `_No attention points recorded._` on **every**
      review, and the reconciliation file is read from disk and discarded. The compliance
      block is the only real content the prompt has ever carried. Fix is either to wire
      the reconciliation attention points through, or to delete the dead input and the
      section that promises it — the current state advertises a worklist it cannot
      populate. Note the unused field is a used *interface* member, which is why neither
      `knip` nor `oxlint` flags it.

## Records consumers (the substrate shipped in 0.9)

- [ ] First consumer: **compliance review as diff-vs-intent evidence.** Today it
      compares the diff against the extracted plan; the transcript adds *how* the
      phase got there — files read versus files claimed, approaches abandoned, the
      point of drift. Needs no distribution answer (the review runs on the machine
      that ran the phases), so it is the cheapest thing to build on top.
- Second consumer is already queued above: `verifiedSurfaces` in the record manifest
  (plan 44 phase-05) — surface coverage queryable across runs.
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

Five approved specs are parked (15 left this section 2026-08-21 — plan 44 is the
active queue head above). Each is plannable at any time; nothing blocks them
technically. Pick one back up by writing a plan (`phax-planning` skill) — no
re-approval needed unless the spec's own ground moves. Note that plan staleness is a
**plan** property, so a spec parked here does not rot; the plans written against them
do.

### Gate specs 16 / 18 and advisory 19

- [ ] `docs/specs/16-external-gate-steps.md` — no plan. Builds on 15's attributed
      step; plannable the moment plan 44 lands (planning it against the revised
      spec 15 before then is possible but accepts rebase risk against 44's run).
- [ ] `docs/specs/18-gate-step-scheduling.md` — no plan. Also downstream of 15: a step
      needs attributes before a phase can schedule it.
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
      the per-phase orientation brief (`orient-brief.json`, plan 49) — and, once
      plan 44 phase-05 lands, the per-phase `verifiedSurfaces` manifest field.
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
