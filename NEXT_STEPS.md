# Next steps

The open queue only. Landed work is not recorded here — the git history is the
codebase history, and retired artifacts live in `docs/plans/archive/` and
`docs/specs/archive/`. Tick items off as they land, prune them once they are in the
history, and delete this file when it is empty.

Last pruned 2026-10-19. Since the previous prune (2026-10-05, v0.18.0), releases 0.19.0–0.25.0
shipped, and these specs landed and were completed: `approval-record-files` (with the
`own-approval-ground` plan), `completes-spec`, `drop-orient`, `drop-gate-scopes`, `gate-request`,
`brief-provider`, `open-next-release`, `guarantee-reports`, `gate-attempt-records`,
`pr-description`, `small-fixes-0-23` and `artifact-decide` (three plans); then the cost specs
`phase-prompt-scope`, `cost-ledger` and `plan-estimate`, shipped in 0.25.0.

## The queue, as of 2026-10-19

### In flight

- [x] **`planning-skill-defaults`** — `docs/specs/2610171254-planning-skill-defaults.md`. Plan 1 of
      2 (the phax-planning skill and the per-phase `modelReason`) landed in PR #145. Plan 2
      (`phax architecture`) landed and the spec is complete.

### Approved, not yet planned

- [ ] **`headless-review`** — `docs/specs/2609250823-headless-review.md`. Reworked and re-approved
      2026-10-19: the review passes go under `## Needs your review` in the short PR body, the PR
      opens as a draft while a review plan or a finding is pending, run completion happens when
      the PR becomes ready, and `--run` lets approve, status, lint and `run --append` reach the
      run's branch from the checkout.

### Drafts

- [ ] **`interactive-phases`** — `docs/specs/2610190947-interactive-phases.md`. A plan-declared
      phase where the run stops for a person to correct the pattern it sets, before later phases
      copy it. 7 open questions: `q-mode-line` and `q-planned-work` were decided as recommended in
      the joint phase-shape session (2026-10-20). It ships with `assignment-bounds`, in one
      plan-document lift.
- [ ] **`assignment-bounds`** — replaces `phase-model-assignment`, abandoned 2026-10-20 (brief:
      `docs/briefs/assignment-bounds.md`).
      - The architecture report gains `parts` (id, name, description, globs).
      - The owner writes ordered bounds in `phax.json`, each one a `part` or `globs` bound with a
        model and an effort range. The first matching bound governs a phase.
      - `modelReason` becomes `assignmentReason`, and lint errors on a departure without one.
      - Joint phase-shape session done (2026-10-20): J1 separate keys (`mode`, later `oracle`),
        not one `role`; J2 `mode` sits right after `optionalFilesToEdit`; J3 interactive phases are
        governed by bounds through their optional files; J4 lint and the run preflight share one
        interactive check, refusing with exit 11; J5 `oracle-phases` comes later, with its own lift.
      - It ships in one release with `interactive-phases`, so the plan document is lifted once.
      - The 0.26.0 cut waits for the report change, or that change costs a lift.
- [ ] **`oracle-phases`** — `docs/specs/2609281159-oracle-phases.md`. Oracle-first phases behind a
      pluggable `oracles` provider; nothing needs it before steme item 1.1. Reopened 2026-10-20. To
      be re-authored on `gate-report` (provider request and answer with `$schema`,
      `gate-attribution`'s current enums) once `steme oracles` exists, with its own plan-document
      lift. It carries the rule against an interactive phase between an oracle phase and its
      discharging phase, moved out of `interactive-phases`.
- [ ] **`artifact-decide-verdicts`** — `docs/specs/2610191226-artifact-decide-verdicts.md`, worked
      on in another session; its questions are arbitrated. A verdicts mode for decide, for callers
      without a terminal. Its format changes (the `other` option, the decision record's mode, a new
      `decide-verdicts` input) now land after 0.25.0, so each changed format needs a frozen copy and
      a lift.

## Model policy tracking

Since `planning-skill-defaults`, phases default to `claude-sonnet-5-5` at `medium`, where they used
to default to `claude-opus-5-5`. One row per run, to judge whether the policy holds. Classify each
review defect by origin:
- **plan** — the plan prescribed it, or a planning arbitration accepted it;
- **execution** — the phase agent got it wrong against a correct plan.

A rise in execution defects on default phases is the signal to tighten the policy.

| Date | Run (PR) | Phases (model / effort) | Phase cost | Review defects (plan / execution) | Notes |
| --- | --- | --- | --- | --- | --- |
| 2026-10-20 | `architecture-provider` (#148) | 2 × sonnet-5-5 / medium | $2.66 | 2 / 3 | The plan accepted an unsandboxed grant to a session that could edit `phax.local.json`, and it dictated two wrong lines of the docs page. Execution missed three tests and a/an, and wrote a test that held only until the release cut. For scale, recent all-Opus runs of 2–3 phases cost $11–13. |

## Road to 1.0.0 — assessed 2026-09-15 at v0.14.0, rechecked 2026-10-05 at v0.18.0

Everything the 1.0 announcement (`docs/blog/announcing-phax-1.0.md`) describes is shipped,
except `isolated` mode, which the post itself disclaims. The feature surface is not what holds
1.0 back; the things below are. Ordered by what 1.0 would be lying about if skipped.

- [ ] **A persisted-format stability promise.** `phax.json` (`version: 1`), the run status
      files, the approval record formats, `phax/records/v1`. The no-shims rule is right for 0.x,
      but 1.0 means a config written under 1.0 still loads under 1.x. Decide the contract (frozen
      `version: 1` + a migration, or a documented "re-run `phax init`" policy) and write it down
      in the README; `auto-migrate` is where such a migration would live.
      **Provider answers, decided 2026-10-08 by the author:** before 1.0, an answer in an older
      shape of a format that changed is refused by name. From 1.0 it is read through its frozen
      shape and lifted, as phax reads its own older files. At 1.0 the guard tests that hold each
      answer reader to one shape must fail and name this rule, not be deleted.
- [ ] **CLI contract freeze.** Land the last renames from `docs/vocabulary-review.md` §"Top
      fixes" (at least 1, 2 and 4 — they change output and flag values) *before* 1.0, then hold
      the contract for one or two 0.x releases.
- [ ] **Migrate to Effect 4, before the freeze.** Effect 4.0 shipped 2026-10-06 (`effect@4.0.1`):
      a rewrite, one lockstep `effect` package, `@effect/platform` merged into it. Effect 3.x gets
      fixes until at least September 2029, but `@lbdremy/phax-schemas` exports Effect 3 `Schema`
      values and depends on `effect ^3.14`, so moving after 1.0 would be a breaking major of the
      package and of the cockpit. Its own spec (decided 2026-10-06).
      **Sized 2026-10-07** by a spike (nothing committed): 1,502 type errors in 224 `src` files
      and 2,910 in 443 test files, mostly from about ten mechanical root causes — `Either` gone
      (`Effect.either`, `decodeUnknownEither` → `decodeUnknownExit`), `Context.Tag` →
      `Context.Service` on the ports, the Schema filters → `.check(…)`, `Schema.optionalWith`,
      `Effect.catchAll`/`orElse` → `Effect.catch`, `ParseResult` → `SchemaIssue`. The two
      platform packages are unused in `src` and can go. Not mechanical: the JSON Schema
      generator changes every snapshot's text (every format gets a `next` snapshot), the
      parse-error wording behind refusals (`formatFirstViolation`) changes, and the frozen
      decoders under `src/schemas/history/` must keep their exact behaviour. Guide:
      `https://github.com/Effect-TS/effect/blob/main/MIGRATION.md`.
- [ ] **Check whether user-installed Claude Code mods run in phase sessions.** Raised
      2026-10-08. Mods are plugin code running inside Claude Code, unsandboxed, and plugins load
      in `claude -p` too; a mod that approves tool calls can step around secure mode's command
      allowlist. Find out what a phase session loads, then decide how secure mode keeps the
      operator's mods out (e.g. `--safe-mode` or `--bare`, checked against what those also turn
      off). Docs: `https://code.claude.com/docs/en/plugins/mods/overview`. A secure-mode
      boundary, so before the freeze.
- [ ] **Distribution polish.** macOS binaries are neither signed nor notarized
      (`docs/release.md`); npm install works, the raw binary is Gatekeeper-blocked. Either
      sign, or make npm the only documented install path for 1.0.
- [ ] **Provider coverage on record.** Claude is the tested path;
      `tests/e2e/semanticTrace.providers.test.ts` is the only real exercise of Codex and Vibe
      (and the real e2e does not reach them, see *Small follow-ups*). One full `phax run` per
      provider on a real plan, with the result noted here, is the minimum to keep the
      provider-independence claim.
- [ ] **A second user.** The registry shows one operator across three repos (phax, steme-lab,
      louloupapers). One outside `phax init` → `run` → `publish-pr` on a repo not authored here,
      before the number changes.

Not blockers, on purpose: specs 23/24, records consumers, the durable context layer, the
desktop — none is promised by the announcement.

## Small follow-ups

- [ ] **The real e2e's Codex and Vibe flows run on Claude.** Found 2026-10-06:
      `tests/e2e/realFlow.test.ts` fails "each phase recorded the expected security posture and
      provider" for `[codex-cli] (secure)` and `[mistral-vibe] (unsafe)`: both phases ran on
      `claude-code`. The fixture plan (`tests/e2e/fixtures/minimal-repo/plan.md`) asks for
      `claude-haiku-4-5-20251001` at `none`, which has no Codex anchor; Vibe's `off` alias does
      anchor to it, but Vibe was not chosen either, and why is not checked yet. Routing falls
      back to the terminal Claude Code (not a regression). Fix the fixture: give its phases a
      model and effort both providers anchor, or assert the routing reason instead. Until then
      the real e2e exercises neither Codex nor Vibe. Left out of 0.25.0 on 2026-10-19.

## steme coordination — still open

From the phax–steme coordination note
(`/Volumes/Work/steme/steme-corpus/docs/corpus/02-product/phax-steme-coordination.md`); the gate
chain it asked for (drop orient and scopes, the gate request, the brief, `gate-report` and
`brief-report`) has landed.

- [ ] **The plan auditor's answer carries `$schema`.** Decided 2026-10-06 by the author: every
      JSON document crossing a provider boundary is versioned, requests and answers alike. The
      plan auditor (`planAuditor`, `phax plans lint`'s advisory check) still receives `{phases}`
      and answers without one. Version its request and its answer the same way, with an answer
      that has no `$schema` refused and no fallback. A small spec of its own, before the 1.0
      freeze.
- [ ] **The brief at plan authoring** — still unspecced: the same verb as the phase brief, at an
      earlier moment.

Deferred from `schemas-package` with the author (2026-09-29): **a Standard Schema export** per
format (only if a consumer needs to hand the schemas to a non-Effect validator; the cockpit
parses with Effect, losslessly); **deterministic JSON Schema annotations** for hand-written
filters — one source per rule, and cross-field checks registered by id so the build writes the
same list into the schema (`x-phax-checks`) — for non-TypeScript readers only.

## Records consumers (the substrate shipped in 0.9)

- [ ] First consumer: **compliance review as diff-vs-intent evidence.** Today it compares the
      diff against the extracted plan; the transcript adds *how* the phase got there — files read
      versus files claimed, approaches abandoned, the point of drift. Needs no distribution
      answer (the review runs on the machine that ran the phases), so it is the cheapest thing to
      build on top. The per-phase `verifiedSurfaces` manifest field (since 0.10) is queryable
      across runs, but nothing queries it yet; `records activity` / `recap` / `dispatch`
      cross-run summaries stay deferred (see *Longer horizon*).

## Spec candidates, deliberately not written yet

- [ ] **OpenSpec-inspired ideas — brainstorm before speccing.** Captured 2026-09-01 in
      `docs/ideas/openspec-inspired-ideas.md` from the OpenSpec comparison
      (`docs/comparisons/openspec-vs-phax.md`). Three pistes: living specs describing current
      system behavior with requirement deltas folded back at `phax artifact complete`;
      requirement-level traceability on top of the file-level reconciliation; an explicit
      explore step before `phax-spec`. Brainstorm the first piste before writing anything, and
      build on the spec approval record rather than beside it.
- [ ] **Prune follow-ups, from the first real `--all --dry-run` (2026-10-04).** The author keeps
      every archived run until phax-cockpit is up. Of `~/.phax/archive` (phax namespace), ~70 GB are
      archived worktrees and 0.3 GB the run folders the cockpit reads; `phax/records/v1` holds
      per-phase files only, not the run-level ones. Ideas: a lighter step that frees an archived
      run's worktrees but keeps its run folder and entry; the run-level files in the records;
      prune recognising a commit already on main under another hash (`git cherry`); a compact
      branch list and a dry-run total line. One kept commit never landed: `48df09a8` (the
      diagnostics step must print `{ "diagnostics": [] }` on success) — restore that README
      sentence before any `--force`.
- [ ] **`phax autopilot` — the lifecycle driven in a loop from a corpus.** Raised 2026-09-15,
      captured in `docs/ideas/autopilot.md`. Explicitly after 1.0: a deterministic supervisor
      (not a master agent) over roadmap → spec → decide → plan → lint → approve → run → land →
      loop, framed by a frozen `autopilot.md`. Needs a roadmap artifact, a decision policy,
      budget/stop conditions and a machine-distinguishable approval. First target: the steme CLI
      from its corpus.
- [ ] **Library readiness, then local and cloud modes** — `docs/ideas/local-and-cloud-modes.md`
      (2026-09-22/23). After 1.0, beside autopilot. The consumption form is decided: a
      **library** (`app` + `ports` exported, adapter sets shipped by phax, the CLI one entry
      adapter among others), never a daemon, never the binary. Readiness checklist surveyed
      2026-09-23: `exports` and one barrel per layer with `knip` enforcing privacy; a single
      `LocalLive` composition root; **two missing ports — `Clock` and `Ids`, reusing Effect's
      `Clock`/`Random`**; **`app` modules importing `node:fs` directly, bypassing `FileSystem`**
      (fix first, then let the architectural guard forbid it); environment reads behind a host
      port; the file lock under a long-lived host; no exit-code mapping in `app`. Then the cloud
      adapter set.
- [ ] **Two gates on the change** — `docs/ideas/change-gates-from-the-harness.md` (2026-09-22): a
      per-phase reviewable-unit diff budget, and a `plans lint` rule refusing a phase that plans
      both a file and its oracle (with oracle files read-only to the phase session unless
      declared oracle-authoring). The second is what makes `review-as-plan` safe against an agent
      editing the test that judges it.
- [ ] Preview manifest — `phax.json` declares how to preview a finished run (per-project-type
      discriminated union: web / cli / lib). Write it when desktop work starts; nothing consumes
      it before then.
- [ ] Desktop app (review-by-trajectory cockpit) — stays in `docs/ideas/desktop-app.md` until
      specs 21–24 land: by its own rule the desktop only wraps existing CLI surface. With 23 and
      24 parked, this is parked for as long as they are.

## Approved specs — parked

Specs 23 and 24 have been parked since 2026-08-14. Either can be planned at any time: start one
with `phax artifact new plan <slug> --spec <path>`, write it with the `phax-planning` skill and
run `phax plans lint` on it. Plan staleness is a property of the **plan**, so a spec parked here
does not rot; the plans written against it do.

- [ ] `docs/specs/2608091526-phase-decision-requests.md` — blocking agent-raised decision
      requests; answer-and-resume; decisions in the review handoff. Superseded in practice by
      the 2026-10-10 decision that a run stays autonomous (no phase stops to wait for a person;
      review notes are how a provider reaches one), so it stays parked rather than planned.
- [ ] `docs/specs/2608091526-batch-execution-disjoint-plans.md` — parallel disjoint plans,
      incremental ordered merge, terminal gate on the integration result, published as GitHub
      stacked PRs (`gh stack`) with a single-integration-PR fallback. The largest piece of work
      left; consumes 21 + 22.

### Approved plan with no active spec

- [ ] The smolvm isolation spike (`docs/plans/2606291247-smolvm-isolation-spike-plan.md`) was
      re-approved 2026-09-08, and its PR #60 is still open at phase 05. Resume it or abandon it.

### Housekeeping

- [ ] The louloupapers `phax.json` is pre-spec-15 and the CLI refuses to load there (registry
      sweep, 2026-09-04). Migrate it before running phax in louloupapers again (its two runs were
      archived from the phax repo by qualified name, followed by a manual `git worktree prune` in
      that repo — cross-project archive only prunes the current repo).

## Longer horizon (unspecced, revisit deliberately)

- [ ] **A Claude Code plugin for phax, after the 1.0 freeze.** Raised 2026-10-08. Ship phax's
      skills (`phax-planning`, `phax-spec`, the `phax-decide-*` skills) as one plugin instead of
      copies under `~/.claude/skills/`, with a small mod for the operator's interactive session:
      a pane with the live run (phases, gate attempts, a pause, the PR link, read from
      `~/.phax/runs`) and `/phax` commands that run without a model turn. Mods draw nothing in
      `claude -p`, so this is for the operator's session, not the phases. Distribution, in order:
      a `.claude-plugin/marketplace.json` in this repository (`claude plugin marketplace add
      lbdremy/phax`); then Anthropic's directory through the developer portal
      (`claude.ai/directory/manage`, paid plan, reviewed); and a hint from `phax init` to install
      it. Docs: `https://code.claude.com/docs/en/plugins/publish`.

Reading of the data-engineering article, second pass (2026-08-10): phax already sits on the
right side of lesson 1 (deterministic orchestration, probabilistic nodes) and lesson 2
(extract/transform/load separated; the handoff "loaded" by one phase is the context "extracted"
by the next); spec 22 *is* lesson 3 applied. The gaps it named, updated 2026-08-21: the durable
context layer's substrate exists (run records travel on `phax/records/v1`), so the remaining gap
is the *consumer*, not the storage; the plan DAG is analyzed but not executed (spec 24); and
staleness propagation stops at one hop.

- [ ] Cross-run durable context layer — feed phax's registered providers from phax's own run
      history (handoffs, deviations, final reports) instead of leaving the archive a filing
      cabinet. The record travels, so the layer can be **shared, not local**. The raw material
      that already exists and is still unread is the per-phase `verifiedSurfaces` manifest field.
      The plan auditor could read the same history.
- [ ] Staleness propagation depth — spec 22 stops deliberately at one hop (spec → plan). The
      same record/fingerprint/footprint mechanism could later cover any derived artifact
      (reviews, reports, generated docs).
- [ ] Desktop as role-shaped interfaces, not an augmented chat — one interface per participant
      over the intention↔evidence graph: approval screen showing what the approval commits to
      (ground, footprint, dependents), staleness dashboard (spec 22), run inspection (run records
      as raw material).
- [ ] Derived spec views — regenerate a readable spec from the E2E tests on demand (a computed
      report, never a maintained file).
- [ ] Raise-and-continue "assumption" variant for decision requests — excluded from spec 23 v1 on
      purpose; revisit only if real runs show over-blocking.
