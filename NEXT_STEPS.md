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

- [x] **`surface-summary`** — `docs/specs/2610211432-surface-summary.md`, approved 2026-10-21.
      Every surface element of a spec gains a required one-line `summary` in the consumer's words.
      - One plan (`surface-summary`) landed with #162
        (`docs/plans/archive/2610241631-surface-summary-plan.md`): the format, its freeze and lift,
        the placeholder refusals at `approve` and `complete`, the migration report's count, the
        skill and the docs.
      - Decided 2026-10-24: once the 0.27.0 release is cut, the operator runs
        `phax artifact migrate-documents` on main with that binary, writes the live specs'
        summaries and re-approves what the report names. The installed 0.26.0 migrates nothing.
      - The release-notes script that reads the summaries is the next, separate change.

- [x] **`assignment-bounds`** — `docs/specs/2610201350-assignment-bounds.md`, approved 2026-10-20.
      It replaces `phase-model-assignment`.
      - The owner writes ordered bounds in `phax.json` (`part` or `globs`, a model and an effort
        range). The first matching bound governs a phase.
      - Lint and the run preflight share one bounds check (exit 11), and `modelReason` becomes
        `assignmentReason`.
      - Plan 1, the architecture report gaining `parts`, landed (PR #150).
      - Plan 2, the joint plan-document change (`assignmentReason`, `mode`, `oracle`, one lift),
        landed.
      - Plan 3, the bounds (`assignments` in `phax.json`, the shared check in lint and the run
        preflight, `phax architecture` listing them, the skills and docs), landed. The spec is
        complete.
- [x] **`planning-skill-defaults`** — `docs/specs/2610171254-planning-skill-defaults.md`. Plan 1 of
      2 (the phax-planning skill and the per-phase `modelReason`) landed in PR #145. Plan 2
      (`phax architecture`) landed and the spec is complete.

- [x] **`oracle-phases`** — `docs/specs/2610201518-oracle-phases.md`. Re-authored and approved
      2026-10-20; the 2026-09-28 spec is abandoned. All three plans landed and the spec is
      complete.
      - Any `oracles` provider will do. The provider gets a new `oracle-request` and answers a
        `gate-report`, both with `$schema`.
      - Plan 1 of 3 landed (PR #154): the provider block, the shared `oracles` check in lint and
        the run preflight, the oracle step in the gate loop, the formats, and the surfaces around
        the run (handoff, records, prompts, skills, docs).
      - Plan 2 of 3 landed: `phax resume <run> --skip-oracle` (§5.49, §5.50), added 2026-10-21
        after PR #154's review found that `reset-phase` never resets a committed oracle phase. A
        wrong oracle is corrected in the stopped phase and closed with the configured gate green
        and the oracle step recorded `skipped` (never a verified surface). The reset refusal, the
        next steps, resume-instructions.md, the help and the docs name this recovery.
      - Plan 3 landed: the example Vitest provider in `examples/vitest-oracles/`, repository only
        and shipped in no package. It is built on oxc-parser (q-parser chose it over tree-sitter,
        which the spec suggested) and compares syntax trees so reformatting never changes a
        verdict. phax's own `oracles` declaration in phax.json runs it. The spec is complete.
- [x] **`interactive-phases`** — `docs/specs/2610211403-interactive-phases.md`. Re-authored and
      approved 2026-10-21, after a friend's fork showed the need for a stop chosen at run time; the
      2026-10-20 spec is abandoned. All three plans landed and the spec is complete.
      - Two ways into one `awaiting_review` state (exit 13): a phase the plan declares interactive,
        and `phax run --hold [phase-NN,…|oracle]`, which holds the selected headless phases after
        they commit. The final phase never holds.
      - At a held phase the builder's session continues by default. Closing is `phax resume`: the
        gate first, with a red gate returned to the person; then one review commit on top of the
        phase commit, and an interactive handoff beside the phase's own.
      - A review may sit inside an oracle pair. It re-runs the `authored` verdict when it changes an
        oracle file; a held discharge closes on its configured steps only.
      - `review-stop.json` and a versioned `phax ls --json` (`run-list`) are the surface a review UI
        reads.
      - Plan 1 of 3, the declared stop, landed with #157
        (`docs/plans/archive/2610220954-interactive-phases-plan.md`): `**Mode:** interactive`, the read-only first turn, `awaiting_review`
        with exit 13, `phax resume` closing the stop with the gate and a commit of the gated tree,
        `## Review corrections` in later prompts, and `review-stop.json`. Lint and the run
        preflight no longer refuse a declared phase. The review fixes on #157 also trace the stop's
        effects (turns, closing gate, review commit) and pin them in
        `tests/e2e/semanticTrace.declaredStop.test.ts`.
      - Plan 2 of 3, the hold, landed with #158
        (`docs/plans/archive/2610231043-interactive-phases-plan.md`): `phax run --hold`, the held
        stop and its close (one review commit with a `Held-Phase:` trailer on the phase commit),
        the phase's record written at closing, and the oracle-pair reviews (the `authored` re-run,
        the latest authored commit, the held discharge). A refused record write at closing pauses
        the run, and the next resume writes it once.
      - Plan 3 of 3, stop records, transcripts and the run list, landed with #161
        (`docs/plans/archive/2610240901-interactive-phases-plan.md`): every
        close records who closed it and copies each recorded session's transcript into the run
        folder (never into a record); a declared phase writes its record at closing; every stop's
        record names its mode, cause, outcome, closer and sessions; `phax records explain` finds a
        held record from its review commit; `security.json` (version 2) records the stop;
        `phax ls --json` prints the versioned `run-list`; the compliance review, review handoff
        and PR body show each stop; and `phax plans estimate` sizes an interactive phase from its
        turns. The spec is complete.

### Approved, not yet planned

- [ ] **`test-strategy`** — `docs/specs/2610231041-test-strategy.md`. Approved 2026-10-23, from
      `docs/briefs/test-strategy.md`. A plan's test strategy becomes data: test lines on four closed
      coordinates (size, technique, oracle, loop) plus an optional criterion id, parsed from any
      plan.md and carried in `phax-plan.json`; graded lint against the oracle pairs and the source
      spec's criteria; a new read-only `phax plans overview <plan> [--json]` that runs the
      architecture provider. The `review-map` spec below depends on it.
- [ ] **`artifact-decide-verdicts`** — `docs/specs/2610191226-artifact-decide-verdicts.md`.
      Approved 2026-10-19. A headless verdicts mode for decide: a verdicts file is transcribed by a
      headless writer under the doctrine, checked deterministically and committed, the artifact
      staying Draft. It replaces the hand-edited sidecar used today to record decisions. Its format
      changes (the `other` option, the decision record's mode, a new `decide-verdicts` input) land
      in the open release.

### Briefs written, spec not yet authored

- [ ] **`headless-review` revision** — `docs/briefs/review-escape.md` (2026-10-23). Reopen the
      approved `headless-review` spec before it is planned: a review finding gains `lens`, `escape`
      (why the tests missed it) and `criterion`, the vocabulary of the `phax-review` skill; the
      headless session follows that skill. Open: whether `criterion` is checked, what the review
      plan does with a `wrong-oracle` or `omission` finding, where the escape shows. Do it before
      `headless-review` gets a plan.
- [ ] **`review-map`** — `docs/briefs/review-map.md` (2026-10-23). phax computes, without a model,
      where review attention belongs (criteria no test proves, skipped oracles, phases that needed
      fixes, the run's review notes) and gives it to the review session. After `test-strategy`.

### Drafts

- [ ] **`headless-review`** — `docs/specs/2609250823-headless-review.md`. Re-approved 2026-10-19,
      reopened to Draft 2026-10-23 so that it is not planned before the `review-escape` revision
      above. Its body is unchanged: the review passes go under `## Needs your review` in the short
      PR body, the PR opens as a draft while a review plan or a finding is pending, run completion
      happens when the PR becomes ready, and `--run` lets approve, status, lint and `run --append`
      reach the run's branch from the checkout.

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
| 2026-10-20 | `architecture-report-parts` (#150) | 1 × sonnet-5-5 / medium | $0.96 | 1 / 2 | The plan's glob rules missed backticks and control characters, which break the rendered code span. Execution wrote a duplicate-id test that could not fail and left one stale docs line. |
| 2026-10-21 | `phase-shape` (#151) | 3 × sonnet-5-5 / medium, 1 × opus-5-5 / medium (with a reason) | $16.95 ($4.35 of it lost to a rate-limit pause) | 2 / 3 | The plan promised a refused resume leaves the run unchanged, which it does not, and its header grammar let `*Mode:*`, `__Mode:__` and blockquoted lines read as headless. Execution previewed a resume it would refuse, ignored a `**Model reason:**` line set off by a blank line, and split oracle files on commas inside code spans. |
| 2026-10-21 | `assignment-bounds` (#152) | 1 × opus-5-5 / high (with a reason), 1 × sonnet-5-5 / medium | $11.27 | 1 / 3 | The plan had `phax validate` print its success line before checking the bounds. Execution on the Opus phase left `phax plans lint` exiting 1 on an invalid config and wrote a glob matcher that backtracks exponentially; on the Sonnet phase it left the headless skill tying a null reason to the default. |
| 2026-10-21 | `oracle-phases` plan 1 (#154) | 3 × sonnet-5-5 / medium, 1 × opus-5-5 / medium (with a reason) | $14.85 | 2 / 5 | The plan promised a reset-the-pair recovery that `reset-phase` cannot do (now `phax resume --skip-oracle`, its own plan), and missed an oracle phase skipped for no changes. Execution told the agent to run the ungranted oracles provider, gave two frozen modules a wrong release range, documented lint as exiting 11, left phax-decide-plan's P3 unconditioned on a provider, and missed four §8 tests. |
| 2026-10-21 | `oracle-phases` plan 2, skip-oracle (#155) | 2 × sonnet-5-5 / medium | $2.88 ($0.97 of it before a usage-limit pause) | 0 / 1 | Execution named the `--skip-oracle` recovery in the reset refusal even when the discharge was already past its gate, where a resume would skip another phase's oracle step. |
| 2026-10-22 | `oracle-phases` plan 3, Vitest oracles example (#156) | 1 × sonnet-5-5 / high | $1.69 ($1.43 for the phase) | 2 / 3 | The plan let a marked test that never runs (`test.fails.skip`, `describe.skip`, no test function) pass both verdicts, against the spec's "no skip or todo takes a marker's place", and dropped a tagged template's raw text. Execution read `1e999` as `null`, gave a file named twice duplicate finding ids, and left the README's request stamp stale. |
| 2026-10-22 | `interactive-phases` plan 1, declared stop (#157) | 2 × sonnet-5-5 / medium, 2 × sonnet-5-5 / high, 4 × opus-5-5 / high (with a reason) | $58.92 ($12.38 of it before the first of two usage-limit pauses) | 9 / 6 | The plan kept a refused closing turn's edits in the worktree, so the next close committed them as the person's; let a resume failure after the stop was parked fail the run with the stop stranded; took HEAD at the first close as the base, so a person's commit passed as unchanged; dropped edits made after a half-finished close; gave the turn prompts no `$schema` URL (a real first turn invented one and needed a corrective resume); left `reset-phase` without the run lock and its preview blind to the person's handoff file; tracked a closing turn with an unversioned marker file; and asked for no effect telemetry. Execution let a test read the real `~/.phax`, copied a refused turn's binary files through text, saved an interrupted close as `awaiting_review` with no stop, defaulted a missing `stop` to `declared`, numbered a fallback closing session apart from its record, and documented `enter-phase` as printing the fresh-start command it runs. |
| 2026-10-23 | `interactive-phases` plan 2, the hold (#158) | 3 × sonnet-5-5 / medium, 2 × sonnet-5-5 / high, 3 × opus-5-5 / high (with a reason) | $43.89 ($26.91 of it before a usage-limit pause) | 3 / 8 | The plan left a held phase interrupted in its handoff turn re-running the phase in a loop, said nothing of a record write refused at closing, and gave `--skip-oracle` at a stop outside any pair the wrong refusal. Execution let a failed read on re-entry fail the run, let `holdCli.test.ts` read the real `~/.phax`, skipped two planned tests, left pulled briefs open at the hold point, published the `stop` schema without `additionalProperties: false`, named no recovery in the `reset-phase` refusal on the oracle commit, read the hold with `readFileSync` around the port, and told the person to commit held corrections. The review also found that the Claude Code, Codex and Vibe adapters resolved a turn before its stream was flushed, so the cost ledger could miss a turn's usage under load; fixed on #158. |
| 2026-10-24 | `interactive-phases` plan 3, stop records, transcripts and the run list (#161) | 4 × sonnet-5-5 / medium, 3 × sonnet-5-5 / high, 2 × opus-5-5 / high (with a reason) | $34.35 ($23.41 of it before a usage-limit pause) | 2 / 4 | The plan contradicted itself twice: on a shared test setup file for the provider store variables, and on whether the Vibe finder falls back to every `session_*` folder (the code followed the phase, the docs the arbitration). Execution built a transcript path from a session id it had not checked, left a held stop whose session recorded no builder usage stuck on resume even with records off, let most close suites read the machine's git config, and read the closer from `user.*` ahead of git's `author.*`. The usage limit hit inside phase-04's handoff generation, and resume went on without it (now in Small follow-ups); the operator rebuilt that handoff before the review handoff would run. |
| 2026-10-24 | `surface-summary` (#162) | 3 × sonnet-5-5 / medium | $6.24 ($1.15 of it before a usage-limit pause) | 1 / 2 | The plan dictated a one-line pattern that refused only `\n` and `\r`, so U+0085, U+2028 and U+2029 passed and would break a release-notes bullet. Execution's README left `decide` out of the commands refused before migration, limited the lift to 0.25.0 and 0.17.0 sidecars and said nothing of run completion refusing a placeholder; two code comments went stale. All three phases passed their gate first try. |

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

- [ ] **A person's handoff written after a crashed turn is set aside.** When a closing or first
      turn is left in progress by a crash and the person then writes
      `.phax-context/correction-handoff.md` before resuming, the settle step reads the changed file
      as the turn's and moves it to `refused-turn-NN/`. Nothing is lost, but the person must copy
      it back. Compare against the fingerprint only for a turn that could write, or name the file
      in the resume output.
- [ ] **A refused `phax resume` should leave the run as it was.** Today `RunResumeRequested` moves the
      run to `running` before the start preflight re-checks it. A refusal (exit 11) then reaches the
      `RunFailed` guard in `executePlan`, and the run becomes `failed`, which `resume` refuses for
      good until `phax reset-phase`. This holds for every re-check: MCP file, records clone,
      provider, plan sections, and since PR #151 the interactive, oracle and Model-reason
      refusals. Run the preflight before the transition, or treat its refusals as a pause, and
      assert the state and last error are unchanged.
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

- [ ] **Oracles provider: the oracle's own quality** (raised 2026-10-23, out of `test-strategy`'s
      scope). The provider checks that an oracle phase's tests fail on their assertion, not on a
      crash or an import error; that table and generator files are oracle files, frozen like the
      tests; and that property tests run on a fixed seed. No brief yet.
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
