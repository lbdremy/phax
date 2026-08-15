# Entire checkpoint spike — synthesis and options

Decision document for the [entire.io](https://entire.io/) checkpoint spike
(plan 51, run `entire-checkpoint-spike`). It assembles the evidence from the three
probes under `spikes/entire/` and lays out the adopt-vs-pattern options. It does
**not** recommend: `## Verdict` is left empty for the human, exactly as the probe
docs leave theirs, per the spike's execution-model caveat.

**Status: provisional.** At the time this synthesis was written, all three probe
findings docs (`spikes/entire/findings/01-hooks-in-jail.md`,
`02-checkpoint-lifecycle.md`, `03-format-and-join.md`) had empty
`## Results` / `## Verdict` sections — the probes are authored by the phase agents
and executed out-of-band by a human, and the observed run had not yet been
processed. Every per-probe summary below therefore reports the probe's *question
and decisive cases*, not an answer. Once the human fills the probe Results, the
summaries below should be updated and the provisional markers removed.

## Per-probe summary

### Probe 01 — hooks in the run-jail (provisional: Results unfilled)

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

### Probe 02 — checkpoint lifecycle through worktree, merge and publish (provisional: Results unfilled)

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

### Probe 03 — format readability and the phax join (provisional: Results unfilled)

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

## The decision this evidence serves

Two options, each named by its **dominant loss** — the strongest thing it
abandons:

- **Adopt entire directly** — abandons format ownership: phax's run record
  becomes a third-party format written by third-party hooks sitting in the commit
  path, and phax desktop reads a schema it does not control and cannot evolve.
- **Adopt only the shadow-branch pattern** (`phax/records/v1`, phax-owned) —
  abandons transcript capture: the one capability phax cannot produce itself,
  since transcripts live in the provider's local storage and only agent-side
  hooks see the session as it happens.

### Sketch: `phax/records/v1` (pattern-only route, not implemented)

What the pattern-only route would look like, sketched here only so the options
are comparable: phax already holds everything except the transcript at commit
time (run state, phase state, handoffs, gate logs, reconciliation, the
orient brief). A `phax/records/v1` shadow branch written by phax's own git
adapter — one tree per phase commit, keyed by the `Run-Id`/`Phase-Id` trailers
phax already injects — would version the deliberate skeleton with the repo,
no hooks, no third party, no new trailer. It would carry `handoff.md`,
`gate-log`, `reconciliation.json`, `orient-brief.json`; it would **not** carry
`transcript.jsonl`, because phax never sees it.

## Verdict

<!-- Left empty for the human, per the spike's execution-model caveat.
     Choose: adopt entire directly / adopt only the pattern / neither.
     Fill only after the three probe Results/Verdict sections are filled. -->

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
  transcripts (prompts, tool calls, files touched) to a branch of
  `lbdremy/phax`, which is public; redaction is best-effort. The only
  protections are `--skip-push-sessions` and "never push the shadow branch" —
  one `git push --all` publishes everything. Accepted knowingly for this spike;
  unacceptable as a steady state without a redaction story.
- **Repo weight per run.** Unmeasured until probe 02's Results are filled
  (shadow-branch total bytes and largest transcript blob). Transcripts are
  append-only JSONL per commit; weight grows with every phase of every run and
  git never forgets it.
- **A second source of truth.** entire's record of "what happened" (transcripts,
  checkpoints) can disagree with phax's own (handoffs, gate logs,
  reconciliation). Two records with no arbitration rule invite exactly the
  ambiguity phax's deliberate skeleton exists to remove.
- **Third-party format dependency.** The `v1` in the branch name is the only
  confirmed version signal until probe 03 reports whether `metadata.json`
  versions itself. Desktop reading the format directly is betting on an
  MIT-licensed 0.x tool's format discipline.
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
   in the common git dir, not the worktree; delete exactly the hooks entire
   installed, per the recorded diff).
3. Delete the local shadow branch: `git branch -D entire/checkpoints/v1`.
4. Confirm nothing entire-related was ever pushed:
   `git ls-remote origin 'entire/*'` must return nothing.
5. Re-run `sh spikes/entire/00-preflight.sh` and confirm it reports a clean
   state: no `.entire/`, no `entire/checkpoints/v1` ref, no settings file or git
   hook mentioning entire.
