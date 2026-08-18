# Next steps

The open queue only. Landed work is not recorded here — the git history is the
codebase history, and retired artifacts live in `docs/plans/archive/` and
`docs/specs/archive/`. Tick items off as they land, prune them once they are in the
history, and delete this file when it is empty.

Last pruned 2026-08-17, after v0.8.3 shipped and the entire.io spike ran. The spike's
own two open items are its verdict and its teardown; everything it answered is in
`docs/spikes/entire-checkpoint-findings.md`, not here.

## Small follow-ups — found while running the entire.io spike, 2026-08-15

Neither has anything to do with entire; both surfaced because the spike exercised
paths nothing else had. Independent of each other and of everything below.

- [ ] **The gate profile a plan names is not the gate profile it runs.** Plan 51's
      `### Verification` sections all name the `fast` profile, per the `phax-planning`
      skill's spike doctrine ("use the `fast` gate profile, not `full` — a passing
      `full` on spike artifacts is misleading false green"). The run used **`full`**
      (`phax ls` PROFILE column, same as every prior run). The profile is not an
      extracted `phax-plan.json` field, `### Verification` is informational by design,
      and `phax run` has no flag to select one — so the doctrine prescribes something no
      mechanism honors. Harmless here (a doc-and-shell run passed `full` anyway, just
      slowly), but it means every spike plan silently gets the wrong gate. Decide
      between: make the profile a per-phase extracted field, add a `phax run
      --gate-profile` flag, or drop the claim from the skill. Adjacent to parked
      spec 15 (attributed steps) but strictly smaller — profile *selection*, not step
      attribution.
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

## phax-native run records (`phax/records/v1`) — decided 2026-08-17 — active queue head

With the gate trilogy parked alongside 23 and 24, this is the only substantive work left
active. **Decision: build, not adopt.** The entire.io spike ran, answered its three
questions, and the answer that mattered most was not one of them.

**Correction to the premise this whole line of work rested on.** Every earlier note here
claimed phax does not capture transcripts — that only session IDs are recorded and the
transcripts stay in the provider's local storage. That is **false**, and it was false
before the spike started. phax spawns
`claude --print --output-format stream-json --verbose`, so the entire event stream flows
through phax's own process, and phax already writes it: `output.jsonl` per phase (90 KB
for spike phase-01: 22 assistant, 11 user, 19 system records, a `result`, tool_use names
and inputs). `prompt.md` is 45,263 bytes — **byte-identical** to entire's
`0/prompt.txt` for the same phase. entire never provided capture. It provided three
things: condensing a session into a git object, binding it to the commit by trailer, and
a query surface.

Why phax is better placed to do that than entire is: entire needs a `prepare-commit-msg`
hook precisely because the committer does not know the session. phax **knows the session
and makes the commit in the same process** — no hooks, no injection race, no ambiguity
about which commits get records. The entire class of defects the spike found (staging vs
durable record, hooks-outside-the-jail, dangling trailers) does not arise.

And the record would be strictly richer than the one on offer. Already written per phase,
today, in `~/.phax/runs/<run>/<phase>/`: `output.jsonl`, `prompt.md`, `diff.patch`,
`checks-attempt-NN.log`, `file-reconciliation.{json,md}`, `phase-handoff.md`,
`security.json` (the frozen policy the phase actually ran under), `model-resolution.json`,
`orient-brief.json`, `agent-binding.json`, `status.json`. entire's checkpoint holds a
transcript and nothing else. **Nothing needs to be captured. It needs to be versioned.**

- [x] Spike/discovery plan written 2026-08-15:
      `docs/plans/51-entire-checkpoint-spike-plan.md` (**Draft**, `source-spec: null`,
      five phases, all `claude-fable-5`, `fast` gate, deterministic extraction verified —
      5 phases, no LLM fallback). Three probes plus a synthesis that deliberately leaves
      `## Verdict` for the human. Ground established while planning: phax commits with
      plain `git commit -m … -m …` and no `--no-verify` (`src/infra/git.ts:115`), so
      entire's `prepare-commit-msg` / `post-commit` hooks fire on phase commits and the
      `Entire-Checkpoint` trailer lands beside phax's own; but the phase agent's cwd is
      the worktree, so a gitignored `settings.local.json` is invisible to it, and `git`
      is in neither the config nor the `fast` gate command set, so probes are authored by
      the agent and run by a human.
- [x] Ran 2026-08-15 (`entire-checkpoint-spike-1786807559589`, 5 phases, entire 0.10.0,
      phax 0.8.3), reviewed, findings filled and harnesses corrected in `7e1566d`.
      **Q1 hooks survive the run-jail: pass** (5/5 captured; hook commands run *outside*
      the `--allowedTools` gate; conditional on committing the enablement, since a
      worktree checks out tracked files only). **Q2 checkpoints survive: pass on commit
      and publish, merge unproven** — the branch is still unmerged. **Q3 readable +
      joinable: pass on both**, from plain git with no `entire` binary, join deterministic
      5/5 both directions via `Session-Id` ↔ `Entire-Session`. Storage is
      `refs/entire/checkpoints/<last-2-of-ULID>/<ULID>`, **not** the documented
      `entire/checkpoints/v1` branch — that mismatch at 0.10.0 is itself the
      format-stability evidence. Full write-up: `docs/spikes/entire-checkpoint-findings.md`.
- [x] Synthesis `## Verdict` written 2026-08-17 (`e540d6f`, PR #82): **build, not adopt**.
      The premise correction is recorded in the doc rather than quietly fixed, since it is
      what flipped a clean 3-for-3 pass into "do not adopt".
- [ ] Execute the teardown checklist in `spikes/entire/findings/01-hooks-in-jail.md`.
      Teardown deletes **refs**, not a branch: `git branch -D` cannot reach
      `refs/entire/*`, and `git gc --prune=now` is what actually removes the transcripts
      from `.git/objects`. The safety window stays open until then (public repo; `origin`
      verified clean so far — `refs/entire/*` is not carried by an ordinary push).
- [ ] Re-run `spikes/entire/02-checkpoint-lifecycle.sh` **after merging** the run branch:
      merge survival and squash-trailer collapse are the only probe questions still open.
- [ ] **Write the spec: `docs/specs/29-phax-run-records.md`** (next free number; 23 and 24
      are the parked ones). phax writes a `phax/records/v1` shadow record per phase
      commit, holding what it already produces, and binds it to the commit it describes.
      The build itself is narrow; the decisions below are the spec's real content, and
      both design decisions are now settled — the spec writes them up rather than
      re-litigating them.

      Scope of the new machinery, all of it small: git object plumbing behind the existing
      `GitPort` (`hash-object -w`, a temp-index `write-tree` via `GIT_INDEX_FILE`,
      `commit-tree`, `update-ref`) so a record is written **without touching the working
      tree** — the one genuinely new capability; a record schema decoded at the boundary
      like every other persisted shape; and a trailer on the phase commit pointing at the
      record. Lifecycle questions the spec must settle: what happens on a failed or
      abandoned phase, on a fix-loop retry (one record or two), and on the archival
      commit (phax's own bookkeeping — no agent session, so presumably no record).

      **Put the version in the ref name.** `phax/records/v1`, and mean it. This is the one
      thing entire demonstrably got wrong: its documented layout is a versioned
      `entire/checkpoints/v1` branch, 0.10.0 ships an unversioned `refs/entire/checkpoints/`
      namespace, and the version marker did not survive the layout change — so a reader
      cannot detect a layout change without opening a record. Do not repeat that.

- [x] **Design decision 1 — where do records live? Settled 2026-08-18: the destination
      follows the source repo's visibility.** Revised from the 2026-08-17 answer, which
      made a separate records repo unconditional.

      - **Private source repo → records in-repo.** The record's audience is already
        exactly the code's audience, so a second repo buys nothing and costs everything
        listed below. Self-contained provenance, travels with a normal clone, no drift,
        no degraded `explain`.
      - **Public source repo → separate private records repo**, keyed by the source
        commit (entire's `--checkpoint-remote` idea, the one piece of its design worth
        lifting wholesale). The source repo carries only the commit and its trailer.
        Here the two-repo cost is worth paying, and only here: provenance spans two
        repos, so `records explain` degrades when the records repo is missing, stale or
        unreachable, and the spec must define that degraded output rather than failing
        opaquely, plus what "drifted" means.

      **Visibility detection guards the choice; it never makes it.** The destination is
      explicit in `phax.json` whenever transcripts are on. phax can detect visibility for
      GitHub remotes — `GithubPort` already shells `gh` and would need one small
      `visibility()` addition beside `repoRecognized` — but not for arbitrary hosts, so
      detection is used to **refuse**, not to choose: in-repo + transcripts on + detected
      public is an error, and an undetectable host requires the explicit acknowledgement.
      A wrong auto-guess in the unsafe direction leaks transcripts, so phax must never
      make one silently.

      **Residual risk the spec must state plainly: private today is not private forever.**
      Flipping a repo public retroactively publishes every transcript in its history, and
      deleting the refs afterwards does not help once the objects have been pushed and
      cloned. That is the standing cost of in-repo transcripts, and it is not mitigable —
      only disclosed.

      Note phax's own repo is **public**, so phax itself exercises the separate-records-repo
      path. The more awkward branch of this decision is the one its maintainer dogfoods.

- [x] **Design decision 2 — transcripts and redaction? Settled 2026-08-17: everything by
      default, no redaction engine.** The record carries `output.jsonl` alongside the
      skeleton, and the docs state plainly that it holds whatever the agent read and
      printed. This is only defensible *because* of decision 1 — the destination handles
      exposure, not a filter — so the two decisions are a pair and must not be adopted
      separately. Under the revised decision 1 the private destination is either the
      source repo itself (when private) or a separate private records repo (when the
      source is public); what matters is that the record never lands somewhere more
      readable than the code it describes. A regex redactor was rejected on the grounds that it invites trust it
      cannot earn.

      **The footgun is now closed by decision 1's guard**, not left to the spec: the
      dangerous combination — transcripts on, records in-repo, source repo public — is a
      refusal, detected where the host allows it and requiring an explicit acknowledgement
      where it does not. The default must never drift into "transcripts in a public repo"
      for someone who never read this file.

- [x] **Feature scope, decided 2026-08-17 against entire's actual surface**
      (`entire --help`, `checkpoint --help`, `session --help`). Most of entire's session
      management is already phax's: `session info/list/resume/current` ≈ `phax
      session-info` / `ls` / `resume` / `enter-phase`, `clean` ≈ `archive`, `status` ≈
      `ls`, `plugin` ≈ `skills`; `enable` / `agent add` / `disable` / `doctor` are
      integration scaffolding phax does not need because phax **is** the integration.

      **Carry in v1:** record per phase commit with its trailer; versioned ref storage;
      `phax records list`; **`phax records explain <sha>`** — the payoff, commit → prompt,
      diff, gate log, handoff, transcript, i.e. blame-to-prompt, and the reason the record
      is worth writing at all; token usage folded into `explain` (already present in
      `output.jsonl`'s `result` record, so it is free).

      **Defer:** `activity` / `recap` / `dispatch` — cross-run summaries over the record,
      which only pay off once records exist and travel; they are the durable-context-layer
      consumers. Squash-merge trailer collapse (rebase is fine — trailers ride the
      message, so records resolve by id).

      **Never carry:** semantic search (`search`, `checkpoint search`) — needs an embedding
      index, so a model or a service, and phax is a deterministic local CLI; this is the
      clearest line. The whole control plane (`auth`, `login`, `org`, `project`, `repo`,
      `grant`, `api`, hosted mirrors). `session adopt`/`attach`/`stop` — phax owns
      worktrees and bindings, so cross-worktree session adoption solves a problem it does
      not have. Task-level granularity (`tasks/<tool-use-id>/`) — the phase is phax's unit
      of record. Token "optimization recommendations" — that is LLM advice, not a record.

      **Provider degradation, not uniformity.** phax captures via the provider's stdout,
      not agent hooks, so transcript richness follows the adapter: Claude Code yields a
      full `stream-json` stream; whether `codex` and `mistral-vibe` yield an equivalent is
      **unverified**. The record must degrade gracefully — skeleton always, transcript when
      the adapter produces one — and say which it got, rather than implying uniformity.

- [x] **Knowingly accepted loss of building over adopting: phax records only phax runs.**
      entire captures every session in the repo, including ad-hoc ones — which is why the
      review commits on this branch carry checkpoints while phax was not running. A
      phax-native record is blind to everything a human does in an ordinary session. For
      compliance review that is irrelevant (it is about phases). For blame-to-prompt on an
      arbitrary line it is the whole question — and if that becomes wanted, entire is a
      complement to add later, not a foundation to have started from.

- [ ] First consumer, once records exist: **compliance review as diff-vs-intent evidence.**
      Today it compares the diff against the extracted plan; the transcript adds *how* the
      phase got there — files read versus files claimed, approaches abandoned, the point of
      drift. Needs no distribution answer (the review runs on the machine that ran the
      phases), so it is the cheapest thing to build on top and does not wait on
      decision 1.

## Spec candidates, deliberately not written yet

- [ ] Preview manifest — `phax.json` declares how to preview a finished run
      (per-project-type discriminated union: web / cli / lib). Write it when desktop
      work starts; nothing consumes it before then.
- [ ] Desktop app (review-by-trajectory cockpit) — stays in `docs/ideas/desktop-app.md`
      until specs 21–24 land: by its own rule the desktop only wraps existing CLI
      surface, so its spec would otherwise invent commands. With 23 and 24 postponed,
      this is parked for as long as they are.

## Postponed — every approved-but-unplanned spec

All six approved specs are parked. Each is plannable at any time; nothing blocks them
technically and nothing in the active queue depends on them. Pick one back up by writing
a plan (`phax-planning` skill) — no re-approval needed unless the spec's own ground
moves. Note that plan staleness is a **plan** property, so a spec parked here does not
rot; the plans written against them do.

### Gate trilogy 15 / 16 / 18 and advisory 19 — parked 2026-08-15

Approved 2026-07-03, never planned, audited against `main` 2026-08-14: **none of the
four is implemented**. Spec 15 is the entry point whenever this is picked back up — 16
and 18 both wait on 15's attributed step; 19 is independent and the smallest of the four.

- [ ] `docs/specs/15-gate-profile-attributed-steps.md` — gate profiles today are plain
      arrays of command strings (`phax.json` → `gateProfiles`, `GateProfilesSchema`), not
      attributed steps. Plan 44 exists but is `Stale`. **Take plan 45's route, not a
      re-approval as written**: reopen `Stale → Draft` and replan in place, keeping the
      number and lineage. Checked 2026-08-15 — the plan's "architecture seams" section
      cites line numbers that have all moved under plans 46–49 (`isFinal` 415 → 485,
      `GateProfilesSchema` 38-43 → 46, `executePlan.ts` now 1448 lines), it predates the
      repo-rooted layer helper 49 introduced, and its five phases still recommend
      `claude-sonnet-4-6`. The prose contract is sound; the ground under it is not — and
      it drifts further the longer this stays parked, so re-check rather than trusting
      that note.
- [ ] `docs/specs/16-external-gate-steps.md` — no plan. Builds on 15's attributed step,
      so it follows 15.
- [ ] `docs/specs/18-gate-step-scheduling.md` — no plan. Also downstream of 15: a step
      needs attributes before a phase can schedule it.
- [ ] `docs/specs/19-plan-completeness-advisory.md` — no plan, and nothing registers a
      plan auditor in `phax.json`. Independent of the gate trilogy: a projection
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
names, in priority order: the durable context layer is local-only (stateRoot = a
warehouse on a laptop — the run-records work above is the response, though only if
design decision 1 makes the record travel), the plan DAG is analyzed but not executed
(spec 24), and staleness propagation stops at one hop.

- [ ] Cross-run durable context layer — feed the orient provider from phax's own run
      history (handoffs, deviations, final reports) instead of leaving the archive a
      filing cabinet. The layer must be **shared, not local**, which is why this now
      hangs directly off `phax/records/v1` **design decision 1** above: a record that
      does not travel leaves this exactly where it is today. Revised 2026-08-17 — the
      earlier note named entire's shadow-branch pattern as the leading candidate, but
      the spike showed the pattern does not deliver sharing on its own; the distribution
      choice is the substance, not the storage shape. First raw material already exists
      and is still unread: the per-phase orientation brief (`orient-brief.json`,
      plan 49).
- [ ] Staleness propagation depth — spec 22 stops deliberately at one hop
      (spec → plan). Same record/fingerprint/footprint mechanism could later cover any
      derived artifact (reviews, reports, generated docs): "which summaries are now
      stale, which decisions should be reviewed".
- [ ] Desktop as role-shaped interfaces, not an augmented chat — one interface per
      participant over the intention↔evidence graph: approval screen showing what the
      approval commits to (ground, footprint, dependents), staleness dashboard
      (spec 22), run inspection (entire checkpoints as raw material). phax as the
      context engineer's tooling — what dbt was to the analytics engineer.
- [ ] Derived spec views — regenerate a readable spec from the E2E tests on demand (a
      computed report, never a maintained file).
- [ ] Raise-and-continue "assumption" variant for decision requests — excluded from
      spec 23 v1 on purpose; revisit only if real runs show over-blocking.
