# Next steps

The open queue only. Landed work is not recorded here — the git history is the
codebase history, and retired artifacts live in `docs/plans/archive/` and
`docs/specs/archive/`. Tick items off as they land, prune them once they are in the
history, and delete this file when it is empty.

Last pruned 2026-09-15. Since the previous prune: the artifact-timestamp-naming spec
(`2609091040`) shipped through its plan on 2026-09-10 (`4114e063`..`e029960e` — the
`<YYMMDDHHMM>-<slug>` name grammar, enforced in every reader and in `plans lint`, every spec
and plan migrated, `phax artifact new spec|plan` stamped from the clock, the skills taught to
reference by slug), merged as PR #97 and completed (`30631178` / `b3d834d5`), followed by one
same-day fix (`debb3c14` refuse a spec slug that would name an off-grammar spec). v0.14.0
shipped 2026-09-15 (`8da9d82e`): the release workflow passed, the GitHub release carries the
four binaries, and `@lbdremy/phax@latest` is 0.14.0. The run was archived and the global
install bumped the same day. Two approved specs remain, both parked (23, 24); nothing is in
flight and the registry holds only `archived` entries.

## Road to 1.0.0 — assessed 2026-09-15 at v0.14.0

Everything the 1.0 announcement (`docs/blog/announcing-phax-1.0.md`) describes is shipped,
except `isolated` mode, which the post itself disclaims. The feature surface is not what
holds 1.0 back; the things below are. Ordered by what 1.0 would be lying about if skipped.
Decided 2026-09-15: the first four are the blockers; the last three are wanted but do not
hold the tag.

- [ ] **Two known happy-path defects.** The run-before-preflight slug burn and the
      approval-commit staleness (both under *Small follow-ups*). A 1.0 whose `approve` →
      `run` sequence can refuse itself is not 1.0.
- [ ] **A persisted-format stability promise.** `phax.json` (`version: 1`), the run status
      files, `approvals.json`, `phax/records/v1`. The no-shims rule is right for 0.x, but 1.0
      means a config written under 1.0 still loads under 1.x — the louloupapers repo already
      shows what the alternative looks like (a `phax.json` the CLI refuses). Decide the
      contract (frozen `version: 1` + a migration command, or a documented "re-run `phax
      init`" policy) and write it down in the README.
- [ ] **CLI contract freeze.** `phax.usage.kdl` had a breaking change in 0.13 (`extract-plan`
      removed) and another candidate is queued (`prune`). Land the last renames from
      `docs/vocabulary-review.md` §"Top fixes" (at least 1, 2 and 4 — they change output and
      flag values) *before* 1.0, then hold the contract for one or two 0.x releases.
- [ ] **`phax prune`.** Without it a slug is held forever by its archived run; the `-2` habit
      is the visible symptom. Small, and it closes the run lifecycle (created → … → archived →
      gone).
- [ ] **Distribution polish.** macOS binaries are neither signed nor notarized
      (`docs/release.md`); npm install works, the raw binary is Gatekeeper-blocked. Either
      sign, or make npm the only documented install path for 1.0.
- [ ] **Provider coverage on record.** The post is honest that Claude is the tested path.
      `tests/e2e/semanticTrace.providers.test.ts` is the only real exercise of Codex and
      Vibe; one full `phax run` per provider on a real plan, with the result noted here, is
      the minimum to keep the provider-independence claim.
- [ ] **A second user.** The registry shows one operator across three repos (phax,
      steme-lab, louloupapers). One outside `phax init` → `run` → `publish-pr` on a repo not
      authored here, before the number changes.

Not blockers, on purpose: specs 23/24, records consumers, the durable context layer, the
desktop — none is promised by the announcement.

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

- [ ] **A plan whose footprint names `docs/plans/approvals.json` is stale at its own
      approval.** Found 2026-09-10 launching the artifact-timestamp-naming plan: `phax
      artifact approve` takes the baseline at HEAD, then commits a rewrite of
      `docs/plans/approvals.json` (and the plan's own frontmatter), so `phax run`
      reports `ground-changed` before anything starts. Optional files count in the
      footprint too, so there is no list to hide the file in. Worked around by leaving
      both `approvals.json` out of that plan's lists. Fix: exclude the transition commit
      from the ground-change window (baseline = the approval commit, or ignore the
      transition's own write-set), and cover it with a staleness test.

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
- [ ] **`phax autopilot` — the lifecycle driven in a loop from a corpus.** Raised
      2026-09-15, captured in `docs/ideas/autopilot.md`. Explicitly after 1.0: a
      deterministic supervisor (not a master agent) over roadmap → spec → decide → plan →
      lint → approve → run → land → loop, framed by a frozen `autopilot.md`. Depends on
      spec 23 (decision requests carry the `recommendation` it adopts) and needs a roadmap
      artifact, a decision policy, budget/stop conditions and a machine-distinguishable
      approval. First target: the steme CLI from its corpus.
- [ ] **Three additive specs the steme roadmap-1.0 experiment needs before it starts**
      (raised 2026-09-22/23, the steme conductor is the first consumer; see
      `/Volumes/Work/steme/steme-doc/docs/doctrine/01-vision/roadmap-1.0-experiment-protocol.md`
      §3.2 and its item-0 schedule). None holds the 1.0 tag — all are additive to the CLI
      and to `phax.json` — but the experiment pins the release that carries them, so
      they come before that release and after nothing:
      1. **`headless-authoring`** — `docs/ideas/headless-authoring.md`: `artifact new
         spec|plan --headless --brief <file>`; phax spawns the authoring session with the
         skill and an output schema, receives JSON only (plan in the `phax-plan.json`
         shape, extraction cache seeded; spec in a new spec schema whose open questions
         take spec 23's decision-request shape), renders the Markdown, stamps, commits,
         records. Moves two of the four model-invocation points inside phax; the spec
         schema is a new format, shipped experimental.
         **Shipped 2026-09-23** (spec + plan `headless-authoring`, now Completed):
         `artifact new spec|plan --headless --brief <file|->` with `--model`/`--effort`
         and `authoring.{spec,plan}` config defaults; spec and plan document schemas
         (`phax artifact schema spec|plan`), deterministic renderers, a JSON sidecar that
         travels with transitions and blocks `approve` when diverged, an extraction-cache
         seed keyed on the plan body, and one authoring record per session resolved by
         `records explain`. The skills teach the document shape; all three formats are
         experimental (README "Experimental formats").
      2. **`review-as-plan`** — `docs/ideas/headless-code-review.md`: `review-code
         --headless` (JSON only: `code-review.json` + `review-plan.json`/`.md`), `run
         --append <run> <plan>` (a new run transition: appended phases, same records
         lineage, one PR), `review.code.enabled` / `append` / `maxPasses` symmetric with
         `review.compliance`; per pass, compliance then code review, no plan on a
         `divergent` verdict. Ideally the first spec written through (1).
      3. **`schemas-package`** — the persisted-format schemas (`src/schemas`: registry,
         run status, records, approvals, compliance and code-review documents, phax-plan)
         published alone as a typed npm package, freezing nothing beyond the 1.0 promise;
         a read-only records consumer gets typed parsing.
- [ ] **Library readiness, then local and cloud modes** — `docs/ideas/local-and-cloud-modes.md`
      (2026-09-22/23). After 1.0, beside autopilot. The consumption form is decided: a
      **library** (`app` + `ports` exported, adapter sets shipped by phax, the CLI one
      entry adapter among others), never a daemon, never the binary. Readiness checklist
      surveyed 2026-09-23: `exports` and one barrel per layer with `knip` enforcing
      privacy; a single `LocalLive` composition root instead of per-command layers; **two
      missing ports — `Clock` (~20 `app` modules call `new Date()`/`Date.now()`) and
      `Ids` (`randomUUID` ×27, `randomBytes` ×2), reuse Effect's `Clock`/`Random`**;
      **ten `app` modules import `node:fs` directly, bypassing `FileSystem`** (in cloud
      mode they would read the host's disk — fix first, then let the architectural guard
      forbid `node:fs`/`node:child_process` in `app`); environment reads in `loadConfig`,
      `providerProbe`, `effectRunner`, `report` behind a host port; the file lock under a
      long-lived host; no exit-code mapping in `app`. Then the cloud adapter set (sandbox
      `fs`/`git`/`shell`, Agent SDK `backend`, DB `lock`, persisted decision requests for
      `prompt`/`editor`).
- [ ] **Two gates on the change** — `docs/ideas/change-gates-from-the-harness.md`
      (2026-09-22): a per-phase reviewable-unit diff budget, and a `plans lint` rule
      refusing a phase that plans both a file and its oracle (with oracle files read-only
      to the phase session unless declared oracle-authoring). Both config-gated gate
      steps or lint rules; the second is what makes `review-as-plan` safe against an
      agent editing the test that judges it.
- [ ] Preview manifest — `phax.json` declares how to preview a finished run
      (per-project-type discriminated union: web / cli / lib). Write it when desktop
      work starts; nothing consumes it before then.
- [ ] Desktop app (review-by-trajectory cockpit) — stays in `docs/ideas/desktop-app.md`
      until specs 21–24 land: by its own rule the desktop only wraps existing CLI
      surface, so its spec would otherwise invent commands. With 23 and 24 postponed,
      this is parked for as long as they are.

## Approved specs — parked

Two approved specs are open, 23 and 24, both parked since 2026-08-14. Nothing is in flight.
Both remaining specs are plannable at any time. Pick one up with `phax artifact new plan
<slug> --spec <path>`, write it with the `phax-planning` skill and run `phax plans lint` on
it — the advisory auditor fires there too. Note that plan staleness is a **plan** property,
so a spec parked here does not rot; the plans written against them do.

### Housekeeping

- Standing note from the 2026-09-04 registry sweep: the louloupapers `phax.json` is
  pre-spec-15 and the CLI refuses to load there. Migrate it before running phax in
  louloupapers again (its two runs were archived from the phax repo by qualified name,
  followed by a manual `git worktree prune` in that repo — cross-project archive only
  prunes the current repo).

### Specs 23 and 24 — parked 2026-08-14

- [ ] `docs/specs/2608091526-phase-decision-requests.md` — blocking agent-raised decision
      requests; answer-and-resume; decisions in the review handoff. The smaller of the
      two, and it reuses the pause/resume machinery hardened by plan 48.
- [ ] `docs/specs/2608091526-batch-execution-disjoint-plans.md` — parallel disjoint plans,
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
