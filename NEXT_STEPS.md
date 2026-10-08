# Next steps

The open queue only. Landed work is not recorded here — the git history is the
codebase history, and retired artifacts live in `docs/plans/archive/` and
`docs/specs/archive/`. Tick items off as they land, prune them once they are in the
history, and delete this file when it is empty.

Last pruned 2026-10-05. Since the previous prune (2026-09-15, v0.14.0), all of these landed and
were completed: headless authoring (0.15/0.16), the `schemas-package` spec in five plans
(PRs #104–#110; `@lbdremy/phax-schemas` first published in 0.17.0 on 2026-10-03),
`preflight-before-naming` (PR #112), `phax prune` (`run-prune`, PR #113), and the docs site
(`docs-site`, live at docs.phax.run since v0.18.0 on 2026-10-04; both npm packages approved
and the global install bumped on 2026-10-05). Five approved specs are open:
artifact-decide is next; headless-review and oracle-phases follow it; 23 and 24 stay parked.
The steme gate specs (drop-gate-scopes, gate-request, brief-provider) are Approved, and all
three have landed. No plan is in flight.

## Road to 1.0.0 — assessed 2026-09-15 at v0.14.0, rechecked 2026-10-05 at v0.18.0

Everything the 1.0 announcement (`docs/blog/announcing-phax-1.0.md`) describes is shipped,
except `isolated` mode, which the post itself disclaims. The feature surface is not what
holds 1.0 back; the things below are. Ordered by what 1.0 would be lying about if skipped.
Decided 2026-09-15: the first four were the blockers (`phax prune`, the fourth, landed
2026-10-04 in PR #113, so two remain once the happy-path defect is closed); the last three are wanted but do not hold the tag.

- [x] **Both known happy-path defects are fixed.** The run-before-preflight slug burn
      (2026-10-03, PR #112) and the approval-commit staleness (`approval-record-files` +
      `own-approval-ground`; see *Small follow-ups*). A 1.0 whose `approve` → `run` sequence can refuse itself is not 1.0.
- [ ] **A persisted-format stability promise.** `phax.json` (`version: 1`), the run status
      files, the approval record formats (`plan-approval-record`, `spec-approval-record`; the old
      `approvals.json` ledgers are read only to migrate), `phax/records/v1`. The no-shims rule is right for 0.x, but 1.0
      means a config written under 1.0 still loads under 1.x — the louloupapers repo already
      shows what the alternative looks like (a `phax.json` the CLI refuses). Decide the
      contract (frozen `version: 1` + a migration command, or a documented "re-run `phax
      init`" policy) and write it down in the README.
      **Provider answers, decided 2026-10-08 by the author:** before 1.0, an answer in an older
      shape of a format that changed is refused by name. From 1.0 it is read through its frozen
      shape and lifted, as phax reads its own older files. At 1.0 the guard tests that hold each
      answer reader to one shape must fail and name this rule, not be deleted. Stamps name the
      format's shape, not the running release (`open-next-release`), so a provider upgrades only
      when a format it speaks changes.
- [ ] **CLI contract freeze.** `phax.usage.kdl` had a breaking change in 0.13 (`extract-plan`
      removed), and 0.18 added `prune`. Land the last renames from
      `docs/vocabulary-review.md` §"Top fixes" (at least 1, 2 and 4 — they change output and
      flag values) *before* 1.0, then hold the contract for one or two 0.x releases.
- [ ] **Migrate to Effect 4, before the freeze and after the gate chain.** Effect 4.0 was released on
      2026-10-06 (`effect@4.0.1`): a ground-up rewrite, one lockstep `effect` package, and
      `@effect/platform` merged into it. Effect 3.x keeps getting bug fixes until at least
      September 2029, so nothing forces the move. **It must land before 1.0** anyway:
      `@lbdremy/phax-schemas` exports Effect 3 `Schema` values (`RunStatusSchema`, …) and depends
      on `effect ^3.14`, so Effect's major version is part of the package's public API. Moving
      after 1.0 would be a breaking major of the package and of the cockpit, which parses with
      Effect. Decided 2026-10-06 by the author: after `drop-gate-scopes`, `gate-request` and
      `brief-provider`, not in the middle of that chain. It is its own spec.

      **Sized 2026-10-07** by a spike: `effect@4.0.1` swapped in, both platform packages removed,
      nothing committed. The result was 1,502 type errors in 224 `src` files and 2,910 in 443 test
      files. Most of them cascade from about ten mechanical root causes:
      - the `Either` module is gone (104 imports); `Effect.either` (96 uses) and
        `Schema.decodeUnknownEither` → `decodeUnknownExit` (77);
      - `Context.Tag` → `Context.Service` on the ten ports, which cascades into 164
        `yield* FileSystem/Git/…` errors;
      - the Schema filters `minLength`/`pattern`/`maxLength`/`between`/`filter`/`positive`/
        `minItems` → `.check(isMinLength(…))` and the like (~60); `Schema.optionalWith` (27);
      - `Effect.catchAll`/`orElse` → `Effect.catch` (25); `ParseResult` → `SchemaIssue` (5);
        `.annotations`, `timeoutTo` and `async` (~10).

      The two platform packages are declared but unused in `src`, so they can just be removed.
      The native TypeScript 7 compiler type-checks Effect 4 fine.

      **What will not be mechanical:**
      - The rewritten JSON Schema generator will change every format's snapshot text even where
        the data is unchanged, so every format gets a `next` snapshot.
      - The parse-error wording behind refusal messages (`formatFirstViolation`) changes, and many
        tests assert it.
      - `Exit` replaces `Either` in decode results.
      - Check that the frozen pre-schema decoders under `src/schemas/history/` keep their exact
        behaviour.

      Migration guide: `https://github.com/Effect-TS/effect/blob/main/MIGRATION.md`, with its
      `migration/*.md` sub-guides.
- [ ] **Check whether user-installed Claude Code mods run in phase sessions.** Raised
      2026-10-08. Claude Code mods are plugin code that runs inside Claude Code, unsandboxed;
      plugins load in `claude -p` too, so a mod the operator installed may run inside phax's
      headless phase sessions. A mod that approves tool calls can approve one a permission rule
      or hook would deny, so it can step around secure mode's command allowlist. Find out what a
      phase session loads, then decide how secure mode keeps the operator's mods out: for example
      `--safe-mode` or `--bare`, checked against what those also turn off (the project skills
      phases rely on). Docs: `https://code.claude.com/docs/en/plugins/mods/overview`
      (§Decide whether to trust a mod, §Turn mods on or off). A secure-mode boundary, so before
      the freeze.
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

## Next up — the steme experiment specs, in order

Three approved specs that the steme roadmap-1.0 experiment needs before it starts (raised
2026-09-22/23; the steme conductor is their first consumer — see
`/Volumes/Work/steme/steme-corpus/docs/corpus/01-vision/roadmap-1.0-experiment-protocol.md`
§3.2 and its item-0 schedule). None of them holds up the 1.0 tag, since all three only add to
the CLI and to `phax.json`. But the experiment pins the release that carries them, so they come
before that release. All three were drafted by headless authoring, re-drafted 2026-09-25 after
that morning's decisions, and arbitrated and approved 2026-09-28/29. Their §9 answers are in
each sidecar. They run one after another, not in parallel, because each builds on the formats
the previous one changes. The first in the chain, `schemas-package`, is Completed.

- [ ] **`artifact-decide`** — `docs/specs/2609250815-artifact-decide.md`. **Next.** No plan
      yet: `phax artifact new plan artifact-decide --spec docs/specs/2609250815-artifact-decide.md`.
      Decide runs on Drafts only, `artifact reopen` moves an artifact from Approved back to Draft,
      every artifact gets the approval lock, §9 is hand-authored, and `--by` names who decided.
- [ ] **`headless-review`** — `docs/specs/2609250823-headless-review.md`. It reuses decide's
      approver form, skill and escalation block (`docs/ideas/headless-code-review.md`).
- [ ] **`oracle-phases`** — `docs/specs/2609281159-oracle-phases.md`. Oracle-first phases
      behind a pluggable `oracles` provider. Nothing needs it before steme item 1.1.

## Before steme's audit — drop orient and scopes, then the gate request, then the brief

Specs that steme's audit (`steme audit`, steme roadmap-1.0 item 0.13, not built yet) and
`steme brief` are written against, so they land before steme builds its gate projection; otherwise
steme builds a scopes provider that is then thrown away. Raised 2026-10-05 from the phax–steme
coordination note (`/Volumes/Work/steme/steme-corpus/docs/corpus/02-product/phax-steme-coordination.md`,
changes 8 and 9).

**Reordered 2026-10-06 by the author: the removals come first**, so the new features are built on
a green field. Nobody configures `orient` or `scopes` and nobody consumes the diagnostics output
(phax, steme-lab, phax-cockpit, louloupapers, checked 2026-10-05), so both go with no shim and no
compatibility. Decided with it: orient's retirement leaves `brief-replaces-orient` for a new
spec of its own. In this order:

- [x] **`drop-orient`** — `docs/specs/2610060950-drop-orient.md`, Draft, §9 decided 2026-10-06
      (kept history: `docs/specs`, `docs/plans`, `docs/briefs`, `docs/spikes`). Takes over
      the retirement half of `brief-replaces-orient`:
      - `orient` in every config layer, and `phax orient` with its usage, long help and
        reference entry;
      - the index and expand requests, the row format (`src/schemas/orient.ts`), the phase-start
        query and the prompt section (`MAX_ORIENTATION_ROWS`);
      - `orient-brief.json` (`src/schemas/orientBrief.ts`) and the `orient` agent-command grant
        (`security.json` source `orient`);
      - `examples/hello-world/orient.mjs`, and the README's "Orient provider" section and hook
        count.

      A leftover `orient` key meets the ordinary unknown-key refusal. Also update the
      cross-run-context item below, which names the orient provider and `orient-brief.json`.
- [x] **`drop-gate-scopes`** — `docs/specs/2610061345-drop-gate-scopes.md`, Approved, §9 decided
      2026-10-06. Re-authored as a hard drop (the 2026-10-05 version is abandoned): no leftover
      `scopes` named or tested, no removal note, no dependency on `gate-request`. A `completion`
      fails like an `invariant`; the `scopes` provider, closure, pending, `missing-provider` and
      `gate-pending` removed; the already-served `gate-pending` `$schema` URLs stay up from a
      frozen copy (the docs-site guard is unchanged).
- [x] **`gate-request`** — `docs/specs/2610060951-gate-request.md`, Approved, §9 decided 2026-10-06.
      Re-authored for the green field (the 2026-10-05 version is abandoned). A gate step that
      declares it reads `{$schema, phase, base, terminal, phases: [{id, files}]}` on stdin, saved
      beside the attempt so the verdict replays; `base` is noted in the phase status when the
      phase branch is created, and a pre-release run folder is refused. The hello-world
      diagnostics step declares the input.
- [x] **`brief-provider`** — `docs/specs/2610061346-brief-provider.md`, Approved, §9 decided
      2026-10-06 (re-authored for versioned answers). Replaces `brief-replaces-orient` (abandoned): purely additive, orient is already
      gone. A **brief** is feed-forward and never blocks (the audit is the gate's and blocks):
      - woven into the phase's first prompt from the plan, and pulled with `phax brief [path…]`
        on any path, existing or not;
      - it answers with each guarantee's state, as structured data, from the same provider as
        the audit (`steme brief` / `steme audit`, a `brief-request` with the gate request's facts
        plus `files`);
      - the phase is found from `.phax-context/brief-request.json`; 50 guarantees pushed; no
        severity; a fixed 60 s limit; review-time pulls answered but not recorded.
- [ ] **The plan auditor's answer carries `$schema`.** Decided 2026-10-06 by the author: every
      JSON document crossing a provider boundary is versioned, requests and answers alike. The
      gate request and brief request already carry `$schema`, and `drop-gate-scopes` (diagnostics
      document) and `brief-provider` (brief answer) require it on their answers. The plan auditor
      (`planAuditor`, `phax plans lint`'s advisory check) still receives `{phases}` and answers
      without one. Version its request and its answer the same way, with an answer that has no
      `$schema` refused and no fallback. A small spec of its own, before the 1.0 freeze.
- [ ] **`oracle-phases` wording.** It quotes the diagnostics shape with `scopes?`, says its
      `oracles` key "mirrors `scopes`", and lists "deriving oracles from `scopes`" as a non-goal.
      Sweep that text when `drop-gate-scopes` lands. No change to its design.
- [x] **Teach the skills what the gate chain added.** `brief-provider` left the skills out of
      scope; its handoffs (PR #126) ask for them. `phax-cli` and `phax-planning`
      (`.claude/skills/`) should cover:
      - the phase guard, first: inside a phase worktree phax refuses every command except
        `phax brief` and the read-only ones, and an agent following the skills today would hit
        that refusal without warning;
      - the brief provider, with `phax brief [path…]` and `records explain --briefs`;
      - the gate step keys `output` and `input` (the gate request on stdin).
- [ ] **What steme now knows reaches phax, in this order (decided 2026-10-08 by the author).**
      steme's guarantee model was restructured (steme-surface §10, §14.1; decisions 27–30): packs,
      a standard, a unit manifest, repairs rendered as blueprints and skills, accepted debt keyed
      by the ledger. phax's formats flatten or drop most of it.
      1. `open-next-release`, with stamps that name the format's shape (brief
         `docs/briefs/open-next-release.md`): consumers upgrade only when a format changes.
      2. `guarantee-reports` (brief `docs/briefs/guarantee-reports.md`): one green-field spec
         for what a gate step and a brief provider answer, designed from steme's model as if
         today's `gate-diagnostics` and `brief-answer` did not exist (the author, 2026-10-08):
         guarantee, legs and their states, ranges, repairs by kind, accepted debt, judgement for
         the human review; the fix prompt, the pushed brief, review and records use them.
      3. A `decision` class that stops the phase for the owner, joining the parked
         `phase-decision-requests` spec.

      steme's side, not phax's: its target stamps `gate-diagnostics/0.19.0`, which phax 0.20
      refuses; its brief answers carry steme's own `$schema` and an object `repair`; its copy of
      the brief-request schema pins 0.19.0.

The coordination note's other asks (changes 1–3, 6, 7): a stable identity on a finding, accepted
debt in the document, a structured repair and an end line are `guarantee-reports`' to design; the
`decision` class is step 3. Still unspecced: the brief at plan authoring (the same verb, an earlier
moment). phax drops every key its answer readers do not name, so steme gains nothing by writing
them before `guarantee-reports` lands.

Deferred from `schemas-package` with the author (2026-09-29): **a Standard Schema export** per
format (only if a consumer needs to hand the schemas to a non-Effect validator; the cockpit
parses with Effect, losslessly); **deterministic JSON Schema annotations** for hand-written
filters — one source per rule (a regex that is both the filter and the `pattern`), and
cross-field checks registered by id so the build writes the same list into the schema
(`x-phax-checks`) — for non-TypeScript readers only.

## Small follow-ups

- [ ] **`open-next-release`: open the next version as soon as a release is tagged.** Raised
      2026-10-08 after the 0.20.0 release gate failed (as 0.19.0's had): mid-cycle, the
      manifests name the last release, so a `$schema` stamp means two shapes until the cut, and
      tests, the schemas package's fallback and the answer readers depend on which side of the
      cut they run. Brief: `docs/briefs/open-next-release.md`. PR #127 (CI rehearses a cut in
      seconds; `release.sh` tests the cut before committing) catches the symptom meanwhile.

- [x] **A run completes its source spec even when more plans are to come.** (Shipped: the `completes-spec` spec.) Found
      2026-09-29 on `schemas-package` plan 1/5 (PR #104): at run end phax completed the
      plan (correct) and the spec (`f8d2366`, spec moved to `archive/`, its approval
      record removed), although plans 2–5 remain. Reverted by hand on the PR branch
      (`a77ce12b`). Fix: complete a spec only when no other live plan names it and the
      caller says it is the last (e.g. a plan-level `completes-spec: true`, or
      `phax artifact complete` left to the operator), and never silently.
      **Decided 2026-10-05:** a required plan field — the run completes the spec only when it
      is true; lint and the planning skill carry it. Spec `completes-spec`
      (`docs/specs/2610060955-completes-spec.md`, Draft, §9 decided 2026-10-06): frontmatter
      `completes-spec`, mirrored in the plan document; refused on a plan without a spec;
      `phax artifact new plan --spec … --last | --not-last` required; no lint advisories; live
      plans by hand.
- [x] **Add `completes-spec` to live plans once 0.20 is installed.** Nothing to add: on
      2026-10-08 0.20.0 was installed, no run was open, and the only live plan
      (`smolvm-isolation-spike`) has no source spec, so it takes no key. Shipped 2026-10-07 (PR #123)
      after 0.19.0, which refuses the key as unknown frontmatter: until 0.20 is installed, plans
      authored and run here carry no key. After installing it, every live plan with a source spec
      (not under `archive/`) gains `completes-spec: true|false` in its frontmatter **and**
      `"completesSpec"` in its JSON sidecar if it has one: 0.20 refuses a sidecar stamped
      0.17.0–0.19.x without it. Then re-approve each plan (the field is part of the fingerprint).
- [x] **A run's completion conflicts with approvals made on main during the run.** Found
      2026-10-03 on PR #112: the run branch's completion commit removes the plan's entry from
      `docs/plans/approvals.json`, and approving another plan on main meanwhile edits the same
      JSON object, so the PR conflicts and CI never runs until the branch is rebased by hand
      (main's ledger minus the completed entry). **Decided 2026-10-05:** one file per approval
      record (a merge driver would not help: GitHub's mergeability check never runs one). A
      persisted-format change, so before the 1.0 freeze; its own spec, landing before
      `approval-ground`, whose §9 (Q2, Q4) it simplifies — redraft that §9 on top of it.
      Shipped as spec `approval-record-files` (`docs/specs/2610051433-approval-record-files.md`).

- [x] **A plan whose footprint names `docs/plans/approvals.json` is stale at its own
      approval.** Spec `approval-ground` drafted 2026-10-04
      (`docs/specs/2610040727-approval-ground.md`, Draft): its four §9 questions (scope, recognition,
      baseline meaning, ledger comparison) wait for the author. Found 2026-09-10 launching the artifact-timestamp-naming plan: `phax
      artifact approve` takes the baseline at HEAD, then commits a rewrite of
      `docs/plans/approvals.json` (and the plan's own frontmatter), so `phax run`
      reports `ground-changed` before anything starts. Optional files count in the
      footprint too, so there is no list to hide the file in. Worked around by leaving
      both `approvals.json` out of that plan's lists. Fix: exclude the transition commit
      from the ground-change window (baseline = the approval commit, or ignore the
      transition's own write-set), and cover it with a staleness test.
      With per-artifact record files (`approval-record-files`), the approval-ground §9 Q2 and Q4
      reduce to the plan's own record file and its own path: another artifact's record never
      counts as ground change, so redraft those two questions on that basis.
      **2026-10-06:** the draft spec is abandoned; what is left (a footprint naming the plan's own
      path or own record file) is the spec-less plan `own-approval-ground`
      (`docs/plans/archive/2610060955-own-approval-ground-plan.md`, Completed by this run).
      **Fixed:** spec `approval-record-files` (0.19.0: an approval writes only its own frontmatter
      and record file) and plan `own-approval-ground` (a plan's own path and its own record file
      are never ground change). Spec `approval-ground` was abandoned in favour of the plan.
- [x] **Migrate this repository's own approval ledgers after the release that ships
      `approval-record-files`.** **Done 2026-10-06** with 0.19.0: here `6f74d287` (both ledgers →
      1 plan and 8 spec record files), steme-lab `d2fe0f7` (empty ledger deleted). Run `phax artifact migrate-approvals` by hand on a clean tree,
      once `docs/plans/approvals.json` and `docs/specs/approvals.json` are the only ledgers left.
      The spec ledger is still pre-schema, so check the migration commit (it commits by itself).
      Do the same in steme-lab, whose plan ledger is pre-schema and empty: the migration only
      deletes it. Until both are migrated, approve, `plans status`, `artifact status` and
      `phax run` refuse there with exit 12. louloupapers is unaffected: its `phax.json` is already
      refused (see *Housekeeping*).
- [ ] **Headless authoring loses a whole session to one malformed JSON character.** Found
      2026-10-06: the first `drop-gate-scopes` authoring session (~7 min) ended with a
      22.9 KB document holding a stray code expression (`".replace("check s","checks")`) at char
      22 700, and phax refused it as "not JSON" with nothing written; the rerun succeeded. Fix:
      retry the session once on an unparsable or schema-invalid document (feeding the parse error
      back), or have the provider enforce the output schema (Claude Code's structured output).
      The failed session's output stays in `~/.phax/authoring/<stamp>-<slug>/output.jsonl`.
- [ ] **The real e2e's Codex and Vibe flows run on Claude.** Found 2026-10-06 running
      `PHAX_E2E_RUN=1 PHAX_E2E_BACKEND=claude pnpm test:e2e:real` before the 0.19.0 release:
      `tests/e2e/realFlow.test.ts` fails "each phase recorded the expected security posture and
      provider" for `[codex-cli] (secure)` and `[mistral-vibe] (unsafe)`: both phases ran on
      `claude-code`. The fixture plan (`tests/e2e/fixtures/minimal-repo/plan.md`) asks for
      `claude-haiku-4-5-20251001` at `none`. That has no Codex anchor. Vibe's `off` alias does anchor
      to it, but Vibe was not chosen either, and why is not checked yet (enablement in the default
      provider config, or the alias). Routing falls back to the terminal Claude Code. It is
      not a regression: `resolveModel` gives the same answer on v0.18.0 and on main. The test's
      premise ("the forced provider supplies its concrete model", `tests/e2e/helpers/tempEnv.ts`)
      no longer holds. Fix the fixture: give its phases a model and effort that both providers
      anchor (e.g. `claude-sonnet-5` `medium` ↔ GPT-6 Luna, and a Vibe-anchored one), or assert the
      routing reason instead. Until then the real e2e exercises neither Codex nor Vibe, which
      weakens *Provider coverage on record* above.

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
- [ ] **Prune follow-ups, from the first real `--all --dry-run` (2026-10-04).** The author keeps
      every archived run until phax-cockpit is up. Of `~/.phax/archive` (phax namespace), ~70 GB are
      archived worktrees and 0.3 GB the run folders the cockpit reads; `phax/records/v1` starts on
      2026-08-21 (23 runs) and holds per-phase files only, not the run-level ones (`run-status.json`,
      `phax-plan.json`, compliance review, final report, global reconciliation, PR body). Ideas: a
      lighter step that frees an archived run's worktrees but keeps its run folder and entry (an
      `archive`/`prune` flag); the run-level files in the records; prune recognising a commit
      already on main under another hash (`git cherry` patch equivalence — 7 of the 8 commits that
      kept 4 runs were rebase-merged); a compact branch list (`phax/x, --phase-01..13 (14)`) and
      a dry-run total line. One kept commit never landed: `48df09a8` (the diagnostics step must
      print `{ "diagnostics": [] }` on success) — restore that README sentence before any
      `--force`.
- [ ] **A terser PR description.** Raised 2026-10-06 by the author: the body `publish-pr` writes
      (`pr-body.md`, assembled in `src/app/publishRun.ts`) is too verbose to review from. The
      approval-record-files run (PR #119, 7 phases) produced 731 lines / 52 KB:
      - two H1s ("PHAX Run Review Handoff", "Run Review Handoff");
      - the global file-reconciliation table;
      - the whole compliance review, including its per-phase findings and ledgers;
      - then, for every phase, its full file reconciliation and its full handoff.

      Headings also nest wrongly (a `## PHAX File Reconciliation` under a `####`). Goal: a body a
      reviewer reads top to bottom, keeping what decides a review: the verdict and attention
      points, deviations and unplanned or missing changes, decisions taken, follow-ups. Move the
      rest behind links or collapsed `<details>`: per-phase reconciliation tables, handoff
      narratives, and anything already in the commits. The full material stays in the run folder
      and the records. Start by listing what each section is for and who reads it, then brief a
      spec. Mind GitHub's body limit (65,536 characters): a longer run would already be cut off.
- [ ] **`phax autopilot` — the lifecycle driven in a loop from a corpus.** Raised
      2026-09-15, captured in `docs/ideas/autopilot.md`. Explicitly after 1.0: a
      deterministic supervisor (not a master agent) over roadmap → spec → decide → plan →
      lint → approve → run → land → loop, framed by a frozen `autopilot.md`. Depends on
      spec 23 (decision requests carry the `recommendation` it adopts) and needs a roadmap
      artifact, a decision policy, budget/stop conditions and a machine-distinguishable
      approval. First target: the steme CLI from its corpus.
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

Specs 23 and 24 have been parked since 2026-08-14. Either can be planned at any time: start one
with `phax artifact new plan <slug> --spec <path>`, write it with the `phax-planning` skill and
run `phax plans lint` on it (the advisory auditor fires there too). Plan staleness is a property
of the **plan**, so a spec parked here does not rot; the plans written against it do.

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

### Approved plan with no active spec

- [ ] The smolvm isolation spike (`docs/plans/2606291247-smolvm-isolation-spike-plan.md`) was
      re-approved 2026-09-08, and its PR #60 is still open at phase 05. Resume it or abandon it.
      (Plan 41, `claude-protected-path-approval-hook`, was abandoned on 2026-09-23.)

## Longer horizon (unspecced, revisit deliberately)

- [ ] **A Claude Code plugin for phax, after the 1.0 freeze.** Raised 2026-10-08. Ship phax's
      skills (`phax-planning`, `phax-spec`, the `phax-decide-*` skills) as one plugin instead of
      copies under `~/.claude/skills/`, with a small mod for the operator's interactive session:
      a pane with the live run (phases, gate attempts, a pause, the PR link, read from
      `~/.phax/runs`) and `/phax` commands that run without a model turn. Mods draw nothing in
      `claude -p`, so this is for the operator's session, not the phases. Distribution, in order:
      a `.claude-plugin/marketplace.json` in this repository (`claude plugin marketplace add
      lbdremy/phax`); then Anthropic's directory through the developer portal
      (`claude.ai/directory/manage`, paid plan, reviewed; skills reach claude.ai and Cowork, a
      mod only Claude Code); and a hint from the CLI (`phax init`) to install it. The official
      marketplace takes no submissions. Docs: `https://code.claude.com/docs/en/plugins/publish`.

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

- [ ] Cross-run durable context layer — feed phax's registered providers from phax's own
      run history (handoffs, deviations, final reports) instead of leaving the archive a
      filing cabinet. Unblocked 2026-08-21: the record travels, so the layer can be
      **shared, not local**. The raw material that already exists and is still unread is
      the per-phase `verifiedSurfaces` manifest field (since 0.10). The plan auditor
      (since 0.13) could read the same history.
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
