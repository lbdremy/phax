# Entire checkpoint spike — synthesis and options

Decision document for the [entire.io](https://entire.io/) checkpoint spike
(plan 51, run `entire-checkpoint-spike`). It assembles the evidence from the three
probes under `spikes/entire/` and lays out the adopt-vs-pattern options. The phase
agent left `## Verdict` empty for the human, per the spike's execution-model
caveat; **the developer filled it 2026-08-17 — the decision is build, not adopt.**
Follow-on work is specced as `docs/specs/29-phax-run-records.md`.

**Status: evidence complete except the merge.** Updated 2026-08-15, after the
observed run (`entire-checkpoint-spike-1786807559589`, 5 phases, `claude-fable-5`,
entire 0.10.0, phax 0.8.3) was processed and all three probe findings docs had
their `## Results` and `## Verdict` sections filled. Every probe question is
answered except one: the run is `review_open` and unmerged, so whether checkpoints
survive a **merge** (and how a squash collapses trailers) is still unobserved.
Re-run `02-checkpoint-lifecycle.sh` after merging.

**Correction carried into every summary below.** This synthesis and all three
probes were written against the storage model in entire's published
documentation — a `entire/checkpoints/v1` branch holding `<prefix>/<rest>/`
subtrees. Installed entire 0.10.0 does not use it. It writes one ref **per
checkpoint** at `refs/entire/checkpoints/<last-two-chars-of-ULID>/<ULID>`, tree at
the ref root. The harnesses have been corrected; the discrepancy itself is
evidence, and it is weighed under Residual risks.

## Per-probe summary

### Probe 01 — hooks in the run-jail — **PASS**

**Answer: a phax phase agent is captured by entire, unmodified — 5/5 phases.**
Both decisive cases resolved in favour of adoption. Worktree visibility passed
*because* the enablement was committed first, which is a hard precondition, not a
detail: enabled-but-uncommitted, the phase agent loads no hooks. Allowlist
reachability passed because **Claude Code executes hook commands outside the
`--allowedTools` gate** — the frozen set contained no bare `entire` and the hooks
ran anyway, in every phase. phax needed no change; entire needed no phax-specific
configuration.

One correction from filling this probe, worth carrying: case 5 originally tested
capture by looking for `.entire/metadata/<session-id>/`, which is live staging
cleared once a session condenses. During the run that directory held only the one
still-open session while all five phases were captured — the check would have
recorded a false "not captured" on this probe's whole question.

<details><summary>Original pre-run framing (kept for provenance)</summary>



Question: *does a phax phase agent get captured by entire, unmodified?* The probe
frames five cases, two decisive:

- **Worktree visibility (decisive).** A phase worktree checks out tracked files
  only, so entire's hooks exist for the agent only if `.claude/settings.json` and
  `.entire/` are tracked and committed before the run. Ground fact already
  established (2026-08-15, entire 0.10.0): this repo has no tracked
  `.claude/settings.json` at baseline and ignores `.claude/settings.local.json`
  globally, so `entire enable` without `--project` yields a phase agent that loads
  no hooks — for a reason unrelated to the jail. The procedure mandates
  `entire enable --agent claude-code --project --skip-push-sessions` plus a
  commit of the enablement.
- **Allowlist reachability (decisive).** Whether Claude Code executes hook
  commands through the frozen `--allowedTools Bash(...)` gate or outside it. If
  through it, the hook command is denied (the `entire` binary is not in the
  agentCommands set beyond `--version`/`--help`) and nothing is captured
  regardless of loading.

The remaining cases (settings diff vs snapshot, which events fire under
`--print`, whether `.entire/metadata/<session-id>/` material exists per phase)
refine *how much* is captured once both decisive cases pass. **Verdict: unfilled.**

</details>

### Probe 02 — checkpoint lifecycle — **PASS on commit and publish; merge unproven**

**Complete across the run:** 5/5 phase commits carry `Entire-Checkpoint` injected
by `prepare-commit-msg` from inside a linked worktree, each condensing to its own
single-commit ref; 5 phase commits → 5 distinct checkpoints, no gap, no
many-to-one. phax's own archival commit (`2685b57`, no agent session) has **no**
checkpoint — absent, not empty. That boundary is worth stating positively: a
records layer built on entire covers what the agent did and is structurally blind
to what phax did on its own.

**Publish is safe:** the run auto-published and `git ls-remote origin
'refs/entire/*'` stayed empty. `refs/entire/*` is outside `refs/heads/*`, so an
ordinary push does not carry it — a smaller exposure surface than a shadow branch.
The flip side belongs in the decision: nothing fetches or clones that namespace by
default either, so the record does **not** travel with the repo without extra
refspec work. That cuts directly against the "run records travel with the repo"
premise the pattern route is built on.

**Weight:** ~2.2 MB for this 5-phase run (343–534 KB per checkpoint, uncompressed
JSONL) on cheap doc/shell phases; an implementation run with a fix loop is larger.

**Merge: still unobserved.** See Open questions.

<details><summary>Original pre-run framing (kept for provenance)</summary>



Questions: *is the checkpoint record complete across a full phax run?* and *does
it survive merge and publish intact?* The probe walks trailer injection from a
linked worktree (phax commits with no `--no-verify`, so `prepare-commit-msg`
should fire), condensation onto `entire/checkpoints/v1`, the phase-commit ↔
checkpoint mapping, non-phase commits, and the merge/publish step.

One case is already answered by the out-of-band smoke commit (README step 3,
observed 2026-08-15): a manual commit with no completed agent session gets **no**
`Entire-Checkpoint` trailer and creates no shadow branch — absent, not empty.
That settles the simplest session-less-commit case early; phax's path-scoped
artifact-transition commits are expected to behave the same but remain to be
observed. The probe also measures the shadow branch's repo weight, which the
residual-risks section below cites. **Verdict: unfilled; repo-weight measurement
unfilled.**

</details>

### Probe 03 — format readability and the join — **PASS on both**

**Readable from git alone.** The entire field inventory was produced with
`git for-each-ref` / `git show` / `git ls-tree` and no invocation of the `entire`
binary. A desktop run-inspection screen would be a git reader, not a shell-out.

**All seven desktop needs are present** — prompt text (`0/prompt.txt`,
`content[].text`), tool name per call (`content[].name`, with inputs and result
status), files touched (`files_touched[]`), timestamps (`created_at`, per-record
`ts`), token counts (`token_usage`: input / cache_creation / cache_read / output /
api_call_count), model id (`0/metadata.json:model`), session id
(`0/metadata.json:session_id` and the `Entire-Session` trailer).

**The join is deterministic both ways, 5/5**, and doubly anchored — by checkpoint
id and by session id, so either alone suffices. Forward: `Session-Id` →
`Entire-Checkpoint` → ref → `Entire-Session`. Reverse: every run checkpoint maps
back to exactly one commit. Caveat: the namespace is repo-wide, not run-scoped, so
a reverse walk must filter by run.

**Stability is the mixed result.** The storage path is unversioned while the docs
describe a versioned `v1` branch — the layout moved and its version marker did not
move with it. Versioning survives in the payload (`cli_version: "0.10.0"` in both
metadata files, `"v":1` per transcript record), so a reader must open a checkpoint
to learn how to read it. Each ref is exactly one commit; 13/13 transcript lines
parse standalone.

<details><summary>Original pre-run framing (kept for provenance)</summary>

Questions: *can desktop read this from git alone (no entire binary)?* and *is the
phase ↔ transcript join deterministic in both directions?* The probe reads one
checkpoint tree straight out of git
(`git show entire/checkpoints/v1:<xx>/<rest>/…` — `metadata.json`, `0/full.jsonl`,
`0/transcript.jsonl`, `0/prompt.txt`), inventories fields against the seven
desktop needs (prompt text, tool name, file paths touched, timestamps, token
counts, model id, session id), records stability signals (branch-name `v1`, any
schema version inside `metadata.json`, append-only JSONL), and builds the join
table both ways. Ground fact: phax's trailers (`Run-Id`, `Short-Name`,
`Phase-Id`, `Phase-Title`, `Model`, `Effort`, `Session-Id`, `Gate-Log`) sit in
the same commit message as `Entire-Checkpoint`, so the forward join is a
same-commit read. **Verdict: unfilled.**

</details>

## The decision this evidence serves

> **Premise correction, 2026-08-17 — read this before the options below.** The
> framing as originally written rests on a claim that is false, and was false
> before this spike started: that phax cannot capture transcripts. phax spawns
> `claude --print --output-format stream-json --verbose`, so the entire event
> stream passes through phax's own process, and phax already persists it —
> `output.jsonl` per phase (90 KB for this spike's phase-01: 22 assistant, 11
> user, 19 system records, a `result`, plus tool_use names and inputs), and
> `prompt.md` at 45,263 bytes, **byte-identical** to entire's `0/prompt.txt` for
> the same phase. entire never supplied capture. It supplied three things:
> condensing a session into a git object, binding it to the commit by trailer, and
> a query surface.
>
> This removes the second option's dominant loss entirely, which is why the
> Verdict below goes the way it does. The original option text is kept as written,
> because the correction is the finding.

Two options, each named by its **dominant loss** — the strongest thing it
abandons:

- **Adopt entire directly** — abandons format ownership: phax's run record
  becomes a third-party format written by third-party hooks sitting in the commit
  path, and phax desktop reads a schema it does not control and cannot evolve.
- **Adopt only the shadow-branch pattern** (`phax/records/v1`, phax-owned) —
  ~~abandons transcript capture: the one capability phax cannot produce itself,
  since transcripts live in the provider's local storage and only agent-side
  hooks see the session as it happens.~~ **Superseded — see the correction
  above.** phax already has the transcript; this option abandons only the capture
  of sessions *outside* phax runs.

### Sketch: `phax/records/v1` (the chosen route, not yet implemented)

phax already holds **everything** it would need to version, at commit time and on
disk under `~/.phax/runs/<run>/<phase>/`: `output.jsonl` (the transcript),
`prompt.md`, `diff.patch`, `checks-attempt-NN.log`,
`file-reconciliation.{json,md}`, `phase-handoff.md`, `security.json` (the frozen
policy the phase actually ran under), `model-resolution.json`, `orient-brief.json`,
`agent-binding.json`, `status.json`. entire's checkpoint holds a transcript and
nothing else, so the phax-owned record is **strictly richer** than the one on
offer — not a lossy substitute for it.

A `phax/records/v1` record written by phax's own git adapter — one tree per phase
commit, keyed by the `Run-Id`/`Phase-Id` trailers phax already injects — versions
that with the repo. No hooks and no injection race, because phax knows the session
*and* makes the commit in the same process; entire needs a `prepare-commit-msg`
hook only because its committer does not know the session. The whole defect class
this spike walked into (live staging mistaken for the durable record, hook commands
crossing the jail, trailers that could dangle) does not arise.

The genuinely new machinery is narrow: git object plumbing behind the existing
`GitPort` — `hash-object -w`, a temp-index `write-tree` via `GIT_INDEX_FILE`,
`commit-tree`, `update-ref` — so a record is written **without touching the working
tree**. Everything else is a schema and a trailer.

## Verdict

**Build, not adopt.** Decided 2026-08-17 by the developer, after the three probe
Results were filled and the premise correction above came to light. phax builds
`phax/records/v1` itself; entire is not adopted.

The spike passed on every question it asked — hooks survive the run-jail 5/5,
checkpoints land 5/5 with the join deterministic in both directions, and the format
is readable from git alone with every field a desktop screen needs. **A clean pass,
and it does not matter**, because the question worth asking turned out to be a
different one: *what does entire actually supply that phax lacks?* Once the premise
correction lands, the answer is condensation into a git object and a commit trailer
— roughly a day of plumbing behind an existing port — and a query surface phax does
not need in order to start.

What decided it, in order of weight:

1. **phax is better placed to do it.** Knowing the session *and* making the commit
   in one process removes the hook, the injection race, and every defect this spike
   found. entire's architecture pays a permanent complexity tax to work around a
   problem phax does not have.
2. **The record is strictly richer.** Transcript plus prompt, diff, gate log,
   reconciliation, handoff, frozen security policy, model resolution, orient brief.
   Adopting entire would have meant versioning the transcript and leaving the rest
   in `~/.phax`, then joining across two systems to get back what phax already holds
   in one place.
3. **Format ownership, now evidenced rather than feared.** entire's documented
   layout is a versioned `entire/checkpoints/v1` branch; 0.10.0 ships an
   unversioned `refs/entire/checkpoints/` namespace, and the version marker did not
   survive the change. Both harnesses in this spike were written from the docs and
   were wrong on first contact. Betting phax desktop's read path on that is the
   dominant loss of adopting, and it is no longer hypothetical.

**Knowingly accepted loss:** phax records only phax runs. entire captures every
session in the repo — including the ad-hoc review session that produced the
corrections in this document, which carries its own checkpoints while phax was not
running. A phax-native record is blind to anything a human does outside a run. That
is acceptable because the first consumer (compliance review as diff-vs-intent
evidence) is about phases by definition. If blame-to-prompt on an arbitrary line
ever becomes wanted, entire is a complement to add then — not a foundation to have
started from.

**Settled alongside the verdict, 2026-08-17** — both carried into
`docs/specs/29-phax-run-records.md` as written up, not as open questions:

- **Where do records live? The destination follows the source repo's visibility**
  (revised 2026-08-18; the first answer made a separate records repo unconditional).
  A **private** source repo keeps records **in-repo** — the record's audience is
  already exactly the code's audience, so a second repo buys nothing while costing
  self-contained provenance, clone-by-default distribution, and a non-degrading
  `explain`. A **public** source repo pushes records to a **separate private records
  repo** keyed by the source commit — entire's `--checkpoint-remote` idea, the one
  piece of its design worth lifting wholesale, with the source repo carrying only the
  commit and its trailer. The two-repo cost is real and paid only in the public case:
  provenance spans two repos, so `records explain` must degrade legibly when the
  records repo is missing, stale or unreachable.

  **Visibility detection guards this choice; it never makes it.** The destination is
  explicit in `phax.json` whenever transcripts are on. phax can detect visibility for
  GitHub remotes — `GithubPort` already shells `gh` and needs one small `visibility()`
  addition — but not for arbitrary hosts, so detection is used to **refuse** rather
  than to choose: in-repo plus transcripts plus a detected-public source is an error,
  and an undetectable host requires an explicit acknowledgement. A wrong auto-guess in
  the unsafe direction leaks transcripts.

  **Residual risk, disclosed rather than mitigated: private today is not private
  forever.** Making a repo public retroactively publishes every transcript in its
  history, and deleting refs afterwards does not help once objects have been pushed
  and cloned. Note phax's own repo is public, so phax dogfoods the awkward branch.
- **Do transcripts belong in the record? Yes, by default, with no redaction
  engine.** `output.jsonl` ships alongside the skeleton, documented plainly as
  holding whatever the agent read and printed. A regex redactor was rejected for
  inviting trust it cannot earn. **These two decisions are a pair**: "no redaction"
  is defensible only because the destination is private — whether that is the source
  repo itself or a separate records repo. What matters is that a record never lands
  somewhere more readable than the code it describes. Adopting this without decision 1
  would make phax the thing that puts secrets in a public repo.
- **Version the layout in the ref name** — `phax/records/v1`, and hold to it. The
  single most transferable lesson from the spike.

**Feature scope**, decided against entire's actual surface. Carried: record +
trailer, versioned ref storage, `records list`, **`records explain <sha>`** (the
payoff — blame-to-prompt), token usage folded into `explain`. Deferred:
`activity` / `recap` / `dispatch` cross-run summaries, which only pay off once
records travel. Never: semantic search (needs an embedding index — a model or a
service, and phax is a deterministic local CLI), the whole control plane
(`auth`/`org`/`project`/`repo`/`grant`/hosted mirrors), `session
adopt`/`attach`/`stop` (phax owns worktrees and bindings), task-level granularity
(the phase is phax's unit of record), and token "optimization recommendations".
Most of the rest of entire's surface — `session info`/`list`/`resume`/`current`,
`status`, `clean`, `plugin`, `enable`/`agent add`/`doctor` — phax either already
has or does not need, because phax **is** the integration.

Provider degradation is explicit, not glossed: phax captures via the provider's
stdout rather than agent hooks, so transcript richness follows the adapter. Claude
Code yields a full `stream-json` stream; whether `codex` and `mistral-vibe` do is
**unverified**. A record states which it got.

## Consumption paths this unlocks (sketches, not designs)

### (a) Compliance review as diff-vs-intent evidence

The compliance review already compares the phase diff against the extracted
plan: `buildCompliancePrompt` (`src/domain/review/compliancePrompt.ts`)
assembles the prompt and the `reviewCompliance` use case
(`src/app/reviewCompliance.ts`) runs it during publish
(`src/app/publishRun.ts`). The transcript adds *how* the phase got there —
files read versus files claimed in the handoff, approaches tried and
abandoned, the point where the session drifted from the plan. Attachment
point, without designing it: a transcript excerpt (or a derived summary)
becomes one more input to `BuildCompliancePromptInput`, resolved from the
phase commit's `Entire-Checkpoint` trailer via the join probe 03 tests. Nothing
else in the review flow moves.

### (b) The cross-run durable context layer

phax's run records currently live in a local `stateRoot` — they do not travel
with the repo, so a fresh clone orients from nothing. A shadow branch (entire's
or phax's own) makes run history a repo artifact: the orient provider
(`src/app/orient.ts` — `queryOrientIndex`, `expandOrientRow`) could feed from
real prior-run history instead of only local state. Raw material that already
exists and is unconsumed: the per-phase orientation brief `orient-brief.json`,
written by `executePlan` into each phase folder since plan 49 — today it is
written and never read. Versioning it on a shadow branch is the smallest
version of this path and needs no transcript at all.

## The provenance chain the join would close

If probe 03 shows the join deterministic in both directions, this chain becomes
walkable end to end, each link a mechanical lookup:

    transcript line → prompt (0/prompt.txt) → checkpoint (Entire-Checkpoint)
      → phase commit (Phase-Id / Session-Id) → plan (Run-Id → phax-plan.json)
      → spec (source-spec frontmatter) → decision (specs 21/22 provenance)

phax owns every link right of the phase commit today; entire (or a phax-owned
capture) would supply the three links left of it. Known join hazards carried
from the probes' open questions: a squash merge collapsing several
`Entire-Checkpoint` trailers onto one commit; a fix-loop resume giving one
session two phases (breaking transcript → phase uniqueness); a phase whose
`Session-Id` has no matching `Entire-Session`; whether `0/` is a session
sequence (a second session producing `1/`).

## Residual risks

- **Transcript exposure on a public repo.** entire commits full session
  transcripts (prompts, tool calls, files touched) into `lbdremy/phax`, which is
  public; redaction is best-effort. Measured better than feared: checkpoints live
  under `refs/entire/*`, outside `refs/heads/*`, so an ordinary `git push` does
  not carry them and `ls-remote` confirmed origin stayed clean across an
  auto-published run. `--all` / `--mirror` still would. Accepted knowingly for
  this spike; unacceptable as a steady state without a redaction story.
- **Repo weight per run.** Measured: ~2.2 MB for a 5-phase run (343–534 KB per
  checkpoint, uncompressed JSONL), on cheap doc/shell phases — an implementation
  run with a fix loop is larger. Weight grows with every phase of every run and
  git never forgets it.
- **The record does not travel by default.** The same property that limits
  exposure limits distribution: nothing fetches or clones `refs/entire/*` without
  an explicit refspec. "Run records versioned with the repo" is therefore only
  half true out of the box — a real consideration for the durable-context-layer
  ambition, which wants the record *shared*, not merely *local and versioned*.
- **A second source of truth.** entire's record of "what happened" (transcripts,
  checkpoints) can disagree with phax's own (handoffs, gate logs,
  reconciliation). Two records with no arbitration rule invite exactly the
  ambiguity phax's deliberate skeleton exists to remove.
- **Third-party format dependency — the sharpest risk, and now evidenced.** The
  documented storage model (a `entire/checkpoints/v1` branch with
  `<prefix>/<rest>/` subtrees) and the shipped one (`refs/entire/checkpoints/…`,
  one ref per checkpoint, tree at the ref root) **already disagree at 0.10.0**.
  The layout changed and the one explicit version marker in the documented
  model — the `v1` — did not survive the change. Versioning now lives only in the
  payload (`cli_version`, per-record `"v":1`), so a reader must open a checkpoint
  to learn how to read it, and cannot detect a layout change by looking at the
  ref. This is not a hypothetical about an 0.x tool's format discipline; it is a
  breakage this spike walked into. Both harnesses were written against the docs
  and were wrong on first contact.
- **Hooks in the commit path.** A failing `prepare-commit-msg` aborts commits.
  Observed on 0.10.0: the installed `prepare-commit-msg` and `post-commit` wrap
  their calls in `2>/dev/null || true` and cannot abort a phax commit — but
  `pre-push` is not wrapped, and the guarantee must be re-verified per entire
  version, not assumed.

## Teardown checklist

Consolidated from the probe findings docs (the authoritative mutation record is
`spikes/entire/findings/01-hooks-in-jail.md` `## Teardown`, filled from the
observed run's case-1 diff). One pass:

1. Revert the enablement commit(s) that tracked `.claude/settings.json` and
   `.entire/` — or, if history must stay linear, restore `.claude/settings*.json`
   from the pre-enable snapshot directory and `git rm -r .entire`.
2. Restore `.git/hooks/` to the pre-enable `hooks-listing.txt` state (hooks live
   in the common git dir, not the worktree). Entire installed exactly five:
   `commit-msg`, `post-commit`, `post-rewrite`, `pre-push`, `prepare-commit-msg`.
3. Delete the checkpoint refs. These are **not** a branch — `git branch -D` does
   not reach them, and neither does anything else in the normal workflow, so
   skipping this step leaves every transcript in the repo indefinitely:

   ```sh
   git for-each-ref --format='%(refname)' 'refs/entire/checkpoints/**' \
     | while read -r ref; do git update-ref -d "$ref"; done
   git for-each-ref 'refs/entire/**'   # must print nothing
   ```

   Their objects then become unreachable; `git gc --prune=now` removes them for
   good. Until it runs, the transcripts are still in `.git/objects`.
4. Confirm nothing entire-related was ever pushed — query the full namespace, not
   just heads: `git ls-remote origin 'refs/entire/*' 'refs/heads/entire/*'` must
   return nothing. (`ls-remote --heads` cannot see `refs/entire/*` and would pass
   regardless.)
5. Re-run `sh spikes/entire/00-preflight.sh` and confirm it reports a clean state:
   no `.entire/`, zero checkpoint refs, no settings file or git hook mentioning
   entire.
