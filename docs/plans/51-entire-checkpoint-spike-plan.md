---
status: Draft
source-spec: null
---
# Entire Checkpoint Spike

## Overview

[entire.io](https://entire.io/) is an open-source (MIT) CLI that hooks into agent
configs (Claude Code, Codex, Gemini, opencode, Cursor, …), captures full session
transcripts, and writes a **Checkpoint per commit** onto a shadow branch
`entire/checkpoints/v1` inside the repo itself. The commit on the working branch
carries an `Entire-Checkpoint: <id>` trailer; the shadow branch carries the transcript
tree (`metadata.json`, `full.jsonl`, `transcript.jsonl`, `prompt.txt`) under a prefix
derived from that id.

phax already records the **deliberate skeleton** — spec → approved plan → phases →
reconciled diffs → gates → handoffs, with decision provenance from specs 21/22. It does
not record the **path taken**: session ids are captured via the agent binding, but the
transcripts stay in the provider's local storage, unversioned and unshared. This spike
decides whether entire (or its shadow-branch pattern) is worth adopting to close that
gap.

This plan is a **spike**, not a feature. It answers three unknowns:

1. **Do entire's agent-side hooks survive phax's run-jail?** phax spawns
   `claude --print --output-format stream-json --verbose` with
   `--permission-mode acceptEdits`, a frozen `--allowedTools Bash(...)` allowlist and
   `--strict-mcp-config` (`src/infra/providers/claudeCode.ts:153`), with **cwd set to
   the phase worktree** (`~/.phax/worktrees/<repo>.<shortName>/<phase-id>`), not the
   repo root. Two consequences to probe: `entire enable --local` writes
   `.claude/settings.local.json`, which is normally gitignored and therefore **absent
   from a fresh worktree checkout**; and if the hooks shell out to the `entire` binary,
   the frozen agentCommands allowlist may deny it.
2. **Do checkpoints survive worktree → merge → publish?** phax commits with plain
   `git commit -m <subject> -m <body>` and **no `--no-verify`**
   (`src/infra/git.ts:115`, and the path-scoped variant at `:130`), so entire's
   `prepare-commit-msg` and `post-commit` hooks should fire on every phase commit — but
   they fire from inside a **linked worktree**, and the condense step writes a branch in
   the shared repo. Then the phase branch is merged and published as a PR.
3. **Is `entire/checkpoints/v1` readable enough for phax desktop's "inspect a run"
   screen?** — including whether the join is deterministic: phax's own commit trailers
   (`Run-Id`, `Short-Name`, `Phase-Id`, `Phase-Title`, `Model`, `Effort`, `Session-Id`,
   `Gate-Log`) sit in the same commit message as entire's `Entire-Checkpoint`, so a
   phase ↔ transcript join may be free.

### Execution-model caveat (read before running this plan)

Enabling entire mutates the developer's real repository (agent settings + git hooks) and
its effects only appear when a real phax run commits through those hooks. A phase agent
running inside a worktree cannot enable entire, cannot observe the hook firing on its
own commit before that commit exists, and must not reconfigure the repo it is running
in. Therefore, for the probe phases (02–04) **the agent's mechanical deliverable is the
harness script plus a findings document with empty `## Results` / `## Verdict`
sections**; the real observation is performed out-of-band and pasted in.

This is not merely convention: the frozen agentCommands set for this run is the config
list ∪ the `fast` gate commands, and **`git` is in neither**. A phase agent literally
cannot run `git show entire/checkpoints/v1:…`, inspect a trailer, or read the shadow
branch — every probe in phases 02–04 is authored by the agent and executed by a human.
The `fast` gate
(`pnpm format` + `pnpm typecheck` + `pnpm test:unit`) confirms the repo stays green — it
does **not** prove any claim about entire. Treat the synthesis (phase-05) as provisional
until a real run fills the Results sections.

### Recommended out-of-band procedure (the spike observes itself)

The cheapest source of real data is **this plan's own run**: enable entire *before*
`phax run`, and the run's own five phase commits, its merge and its PR become the
observed dataset — no second run needed. Recommended order:

0. **Snapshot before enabling.** Copy `.claude/settings.json` and
   `.claude/settings.local.json` (whichever exist) and a listing of `.git/hooks/` to a
   path **outside the repo**. Phase-02's harness diffs against this copy, and the
   teardown checklist reverts to it. Enabling first and reconstructing the "before"
   afterwards is guesswork; this step is what makes both exact.
1. Enable entire out-of-band, before `phax run`:
   `entire enable --agent claude-code --project --skip-push-sessions`. `--project`
   is required here, not cosmetic: without it the hooks land in
   `.claude/settings.local.json`, which this repo ignores globally.
2. **Commit the enablement, or the worktree is not enabled.** A phase worktree is a
   checkout containing tracked files only, and both entire's agent hooks and its git
   hooks resolve their configuration relative to the working directory the phase runs
   in. `.claude/settings.json` (the hooks) and `.entire/settings.json` +
   `.entire/.gitignore` (the enablement flag) must therefore be **tracked** before the
   run. `.entire/`'s own `.gitignore` already excludes `metadata/`, `logs/`, `tmp/` and
   `redactors/local/`, so committing the directory commits configuration only, never
   transcripts. Verified 2026-08-15 on entire 0.10.0.
3. **Smoke the hook before trusting it with a run.** Make one throwaway commit by hand
   and confirm it succeeds. Observed 2026-08-15: the installed `prepare-commit-msg` and
   `post-commit` hooks are failure-safe — both wrap the call as
   `entire hooks git … 2>/dev/null || true`, so they cannot abort a phax commit. Re-read
   the installed hooks rather than assuming this holds for another version. Note the
   smoke commit will carry **no** `Entire-Checkpoint` trailer and create no shadow
   branch: with no completed agent session behind it there is nothing to checkpoint.
   That is the expected result, and it answers phase-03's non-agent-commit case early.
4. **`pre-push` is the exception.** It is the one installed hook *not* wrapped in
   `|| true`, and its job is to push session logs alongside the user's push. phax
   auto-publishes (`publish.auto`, `pushBranch`, `createPullRequest`), so it will fire
   during the run. Confirm `.entire/settings.json` carries
   `strategy_options.push_sessions: false` before running — that flag, set by
   `--skip-push-sessions`, is the whole mitigation for running this on a public repo.
5. Run this plan. Its five phase commits, their merge, and the run PR become the
   observed dataset.
6. Fill each findings doc's `## Results` / `## Verdict` from that dataset, then write
   the verdict in the synthesis doc.

### Safety protocol — accepted risk, decided with the developer

`lbdremy/phax` is **public** and entire commits full session transcripts (prompts, tool
calls, files touched). Redaction is best-effort. The developer accepted this knowingly
and will delete the branches afterwards. The plan therefore requires:

- `--skip-push-sessions` on enable, so a `git push` does not carry session logs.
- `entire/checkpoints/v1` is **never pushed**. Check `git config --get push.default`
  and any `remote.origin.push` refspec before pushing anything during the observation
  window; avoid `git push --all` / `--mirror` entirely.
- Phase-02's findings doc must record the **exact** settings-file and git-hook mutations
  entire made, so teardown is deterministic rather than archaeological: delete the local
  shadow branch (`git branch -D entire/checkpoints/v1`) and revert precisely those
  recorded mutations.

### What this spike deliberately does not do

- It does **not** adopt entire, add a dependency, or write any code under `src/`.
- It does **not** implement the `phax/records/v1` shadow-branch alternative — phase-05
  sketches it, nothing more.
- The agent must **never** run `entire enable`, `entire disable`, or any command that
  mutates repo configuration or git hooks. Enablement is strictly out-of-band.
- It does not build the transcript-as-compliance-evidence feature; phase-05 sketches the
  consumption shape only.

### Artifacts

Harness scripts and raw findings live under `spikes/entire/`; a single synthesis doc
lands in `docs/spikes/`. Nothing under `src/` is touched. Note `spikes/` and
`docs/spikes/` do not exist yet — phase-01 creates them (plan 39 reserved the same
convention but has not run).

## Technical arbitrations

- **Observed run happens on this public repo, shadow branch kept local** — rather than a
  throwaway phax-initialized repo. Knowingly accepted loss: the safety margin. Full
  session transcripts of real work land in a branch of a public repository, protected
  only by "don't push it" and best-effort redaction; a single `git push --all` publishes
  them. Chosen for workload realism — the observed run is real multi-phase phax work,
  not a synthetic two-phase plan — and because the developer will delete the branches
  afterwards.
- **Every phase on `claude-fable-5`, including synthesis** — rather than escalating the
  closing decision doc to `claude-opus-4-8`. Knowingly accepted loss: a model-authored
  recommendation. Phase-05 assembles evidence and lays out the adopt-vs-pattern options
  with what each abandons, but leaves `## Verdict` for the human, exactly as the probe
  Results sections are left. Coherent with the spike doctrine: the judgment this spike
  exists to inform is made out-of-band.
- **Three probes split agent-side from git-side** — rather than one "does entire work
  with phax" probe. The two failure modes are independent (hook loading under the
  run-jail vs checkpoint condensation from a linked worktree) and have different
  remedies; folding them together would produce one ambiguous verdict.

## Required commands

- entire --version
- entire --help

## Required PHAX security configuration changes

This plan requires the following commands to be added to `security.agentCommands` in
`phax.json` before running:

- `entire --version`
- `entire --help`

Without this configuration the preflight check will fail before any agent spawns.

These are deliberately **narrow** allowances: the agent needs to read entire's version
and command surface to author accurate harnesses, and must not be able to invoke
`entire enable` or any other repo-mutating subcommand. Do not widen them to a bare
`entire` token. The harness scripts themselves are executed out-of-band by a human, not
by the agent.

## phase-01 — Spike scaffold and entire preflight {#phase-01-scaffold}

**Recommended model:** claude-fable-5
**Recommended effort:** low

Stand up the spike harness directory, state the three unknowns and the execution-model
caveat, and write a preflight script that reports whether `entire` is installed and
whether this repo is already enabled — without enabling anything.

### Detailed instructions

- Create `spikes/entire/README.md` describing: the three unknowns (hooks-in-jail /
  checkpoint lifecycle / format-and-join), the phax context (what phax already records
  and what it does not), the execution-model caveat, the recommended
  observe-the-spike's-own-run procedure, the safety protocol including the teardown
  contract, and how to run each harness in order.
- Create `spikes/entire/00-preflight.sh` (POSIX `sh`, `set -eu`) that:
  - checks `entire` is on `PATH` and prints `entire --version`; exits non-zero with a
    clear message if absent.
  - reports whether the repo is already enabled, by observing state only: presence of a
    `.entire/` directory, presence of the `entire/checkpoints/v1` ref
    (`git rev-parse --verify --quiet`), and which of `.claude/settings.json` /
    `.claude/settings.local.json` exist and whether either mentions entire.
  - prints the push-safety context: `git config --get push.default`,
    `git config --get remote.origin.push`, and every local ref matching `entire/*`.
  - prints the phax ground facts the later probes depend on: the worktree root
    (`git rev-parse --git-common-dir`) and whether `.claude/settings.local.json` is
    gitignored (`git check-ignore -v`).
  - **must not** run `entire enable`, install hooks, write any config, or create a
    commit. It is strictly read-only.
- Create `spikes/entire/findings/TEMPLATE.md`: a findings skeleton with `## Environment`,
  `## Procedure`, `## Results` (raw output), `## Verdict` (pass/fail + one-line
  conclusion), `## Open questions`. The probe phases copy this shape.
- Scripts are documentation/harness only; do not wire them into any phax gate or
  `package.json` script.

### Planned files to create

- `spikes/entire/README.md`
- `spikes/entire/00-preflight.sh`
- `spikes/entire/findings/TEMPLATE.md`

### Planned files to edit

- (none)

### Optional files that may be edited

- (none)

### Boundary contracts

None — this phase adds no code under `src/` and crosses no architectural boundary.

### Test strategy

No automated tests. The harness is a shell script exercised by a human; correctness is
"runs read-only and reports accurate state". Do not add unit or integration tests for
shell glue.

### Implementation order

README first (states intent and the safety protocol), then the preflight script, then
the findings template.

### Excluded scope

- Enabling entire, installing hooks, or writing any agent settings — out-of-band, human
  only.
- The three probes (phases 02–04) and the synthesis (phase-05).
- Any change under `src/`, `phax.json`, or `package.json`.

### Verification

- The project's configured `fast` gate profile in `phax.json` (`pnpm format` +
  `pnpm typecheck` + `pnpm test:unit`). This phase adds only `spikes/` files, so the
  gate confirms the repo still type-checks and its unit suite stays green — it does not
  exercise the harness. `fast` rather than `full` is deliberate: spike scaffolding has
  no architecture, knip, or build surface to protect, and a passing `full` would be
  false green.

### Expected handoff content

- The exact paths created and one line on each.
- The findings-template section names, verbatim, so phases 02–04 copy the same shape.
- Confirmation that `entire --version` and `entire --help` were added to
  `security.agentCommands` (or a note that the developer must add them before
  `phax run`, since preflight would otherwise fail).
- Any deviation from the planned file lists, with the reason.

### Commit subject

chore(spike): scaffold the entire.io checkpoint spike and preflight

### Commit body

Add the spikes/entire harness directory: a README stating the three unknowns
(hooks under the run-jail, checkpoint lifecycle through worktree/merge/publish, format
and phase-to-transcript join), the execution-model caveat and the safety protocol for
running this on a public repo, plus a read-only preflight script reporting entire's
install state and the repo's enablement and push-safety context, and a findings
template. No src/ changes; groundwork for the probes.

## phase-02 — Agent-side hook survival probe {#phase-02-hooks-in-jail}

**Recommended model:** claude-fable-5
**Recommended effort:** medium

Author the harness and findings doc that determine whether entire's Claude Code hooks
are loaded and permitted to run inside a phax phase agent — a headless `--print` session
spawned in a linked worktree under a frozen tool allowlist.

### Detailed instructions

- Create `spikes/entire/01-hooks-in-jail.sh` (`set -eu`) that captures, without
  enabling anything itself:
  1. **Where the settings landed.** Record which file `entire enable --agent claude-code`
     wrote (`.claude/settings.json` vs `.claude/settings.local.json`), and diff it
     against the pre-enable copy the operator saved. The script takes the pre-enable copy
     as an argument or reads it from a recorded path — it must not guess.
  2. **Whether the phase agent can see it.** For a live phax worktree path passed as an
     argument, check whether `.claude/settings.json` and `.entire/settings.json` exist
     *inside that worktree* and whether either is gitignored at the repo root. A
     worktree is a fresh checkout, so an untracked or ignored config file is invisible
     to the phase agent and to the git hooks running with that worktree as cwd. This is
     the decisive case for hook loading. Ground observed 2026-08-15: this repo has no
     tracked `.claude/settings.json` at all, and `.claude/settings.local.json` is
     ignored globally via `~/.config/git/ignore`, so `entire enable` without `--project`
     would have produced a phase agent that loads no hooks — for a reason unrelated to
     the run-jail.
  3. **Which hook events entire registered**, extracted from the settings JSON, and for
     each whether it fires in a non-interactive `--print` session at all.
  4. **Whether the hook command is reachable under the jail.** Extract the command each
     hook runs; compare it against the frozen agentCommands recorded in the run's
     `security.json`, and record whether Claude Code executes hook commands through the
     `--allowedTools` gate or outside it. State plainly which of the two the observation
     showed — this is the second decisive case.
  5. **Whether a session was captured at all.** After a phase completes, check for
     `.entire/metadata/<session-id>/` material corresponding to that phase's
     `Session-Id` trailer.
- Create `spikes/entire/findings/01-hooks-in-jail.md` from the template, with the
  procedure filled in, a five-row results table (one per case above), and
  `## Results`/`## Verdict` left for the real run. `## Verdict` must answer one
  question explicitly: *does a phax phase agent get captured by entire, unmodified?*
- The findings doc must also carry a **`## Teardown`** section recording the exact files
  entire mutated and the exact revert steps, as required by the safety protocol.
- Document inline every entire flag the procedure assumes (`--agent claude-code`,
  `--skip-push-sessions`, `--local`, `--project`, `--force`) so phase-05 can cite exact
  syntax.

### Planned files to create

- `spikes/entire/01-hooks-in-jail.sh`
- `spikes/entire/findings/01-hooks-in-jail.md`

### Planned files to edit

- (none)

### Optional files that may be edited

- `spikes/entire/README.md`

### Boundary contracts

None. The harness observes `src/infra/providers/claudeCode.ts` behavior from the
outside; it does not import from or modify the provider adapter.

### Test strategy

No automated tests (shell harness, human-run). The five-row results table is the signal;
the `## Verdict` answers the capture question.

### Implementation order

Harness with the five cases, then the findings doc framing the capture question, then
the teardown section.

### Excluded scope

- Running `entire enable` or any repo-mutating entire subcommand — out-of-band, human
  only. The harness reads state and diffs against an operator-supplied pre-enable copy.
- Checkpoint condensation and the merge/publish path (phase-03).
- Any attempt to patch or work around a denial if the hooks turn out to be blocked —
  observe and record only; remedies belong in phase-05.

### Verification

- The project's configured `fast` gate profile in `phax.json` (repo health only; it does
  not exercise the harness).

### Expected handoff content

- The five cases and which two are decisive (worktree visibility of the settings file;
  hook command reachability under the frozen allowlist).
- Which settings file the procedure assumes and why that choice matters.
- That `## Results`/`## Verdict` are intentionally unfilled pending a real run.
- The teardown section's location and that phase-03 must not duplicate it.
- Any deviation from the planned file lists, with the reason.

### Commit subject

test(spike): probe entire hook survival inside the phax run-jail

### Commit body

Add the agent-side probe: a harness that records where entire enable wrote its settings,
whether that file is visible inside a phase worktree (a fresh checkout, so a gitignored
settings.local.json is not), which hook events fire in a headless --print session,
whether the hook command is reachable under the frozen agentCommands allowlist, and
whether a phase session was captured at all. Findings doc frames the capture question
and carries the teardown record; Results/Verdict filled from a real run out-of-band per
the spike's execution-model caveat.

## phase-03 — Checkpoint lifecycle through worktree, merge and publish {#phase-03-lifecycle}

**Recommended model:** claude-fable-5
**Recommended effort:** medium

Author the harness and findings doc that follow a checkpoint from a phase commit made
inside a linked worktree, through the merge onto the run branch, to the published PR.

### Detailed instructions

- Create `spikes/entire/02-checkpoint-lifecycle.sh` (`set -eu`) that, given a run's
  short name, walks the lifecycle and records for each step:
  1. **Trailer injection on a phase commit.** For every commit on the run branch, report
     whether it carries an `Entire-Checkpoint:` trailer alongside phax's `Run-Id` /
     `Phase-Id` / `Session-Id` trailers. phax commits via
     `git commit -m <subject> -m <body>` with no `--no-verify`, so
     `prepare-commit-msg` should fire — confirm it does **from a linked worktree**,
     where hooks resolve from the common git dir.
  2. **Condensation from a worktree.** Confirm `post-commit` condensed the shadow
     material into `entire/checkpoints/v1`, and that the branch advanced once per phase
     commit. Report the tree path per checkpoint
     (`<xx>/<rest>/metadata.json`, `0/full.jsonl`, `0/transcript.jsonl`, `0/prompt.txt`).
  3. **One checkpoint per phase commit?** Count phase commits versus checkpoints and
     report the mapping, flagging any many-to-one or missing case.
  4. **Non-phase commits.** phax also makes path-scoped artifact-transition commits
     through the same commit port (`src/infra/git.ts:130`). Report whether those get
     checkpoints too, and whether a checkpoint with no agent session behind it is empty
     or absent.
  5. **Merge and publish.** After the run branch merges, report which trailers survive
     on the merge commit, and — for a squash merge — that multiple `Entire-Checkpoint`
     trailers land on one commit. Record whether the shadow branch is unaffected by the
     merge, and confirm the run PR carries no checkpoint content (the branch must stay
     local per the safety protocol).
- Create `spikes/entire/findings/02-checkpoint-lifecycle.md` from the template, with a
  step-by-step results table and `## Results`/`## Verdict` left for the real run.
  `## Verdict` must answer two questions explicitly: *is the checkpoint record complete
  across a full phax run?* and *does it survive merge and publish intact?*
- Record the observed **repo weight** of the shadow branch after the run (branch size,
  largest transcript) — it feeds phase-05's residual risks.

### Planned files to create

- `spikes/entire/02-checkpoint-lifecycle.sh`
- `spikes/entire/findings/02-checkpoint-lifecycle.md`

### Planned files to edit

- (none)

### Optional files that may be edited

- `spikes/entire/README.md`

### Boundary contracts

None — the harness reads git state produced by `src/infra/git.ts`; it does not modify
the git adapter or the commit path.

### Test strategy

No automated tests (shell harness, human-run). The per-step results table is the signal;
the `## Verdict` answers the completeness and survival questions.

### Implementation order

Harness following the lifecycle in order (commit → condense → count → non-phase commits
→ merge/publish), then the findings doc framing the two questions.

### Excluded scope

- Agent-side hook loading (phase-02) — this phase assumes the hooks ran and looks only
  at git-visible effects.
- Reading or evaluating transcript *content* (phase-04).
- Pushing the shadow branch, or any `git push --all` / `--mirror`, per the safety
  protocol.

### Verification

- The project's configured `fast` gate profile in `phax.json` (repo health only).

### Expected handoff content

- The exact trailer names observed on a phase commit, both phax's and entire's.
- The checkpoint tree path shape, so phase-04 can read it without re-deriving it.
- The phase-commit-to-checkpoint mapping and any gap found.
- That `## Results`/`## Verdict` await a real run.
- Any deviation from the planned file lists, with the reason.

### Commit subject

test(spike): probe entire checkpoint lifecycle through worktree, merge and publish

### Commit body

Add the git-side probe: a harness that walks a phax run's commits and reports whether
prepare-commit-msg injected an Entire-Checkpoint trailer from inside a linked worktree,
whether post-commit condensed one checkpoint per phase commit onto
entire/checkpoints/v1, how path-scoped artifact-transition commits are treated, and what
survives merge and publish — plus the shadow branch's repo weight. Findings doc frames
the completeness and survival questions; Results/Verdict filled from a real run
out-of-band.

## phase-04 — Checkpoint format readability and the phax join {#phase-04-format-and-join}

**Recommended model:** claude-fable-5
**Recommended effort:** medium

Author the harness and findings doc that judge whether the checkpoint format can back
phax desktop's "inspect a run" screen, and whether a phase can be joined to its
transcript deterministically.

### Detailed instructions

- Create `spikes/entire/03-format-and-join.sh` (`set -eu`) that, given a checkpoint id
  or a commit ref, reports:
  1. **Readability without the entire binary.** Read the checkpoint tree straight out of
     git (`git show entire/checkpoints/v1:<path>`) and report whether
     `metadata.json`, `transcript.jsonl` and `prompt.txt` are self-describing enough to
     render without invoking `entire`. This is the decisive case for desktop: a screen
     that must shell out to a third-party binary per run is a dependency, one that reads
     git is not.
  2. **Field inventory.** For `metadata.json` and one `transcript.jsonl` record, list
     the fields present and mark which the desktop screen would need (prompt text, tool
     name, file paths touched, timestamps, token counts, model id) and which are absent.
  3. **Format stability signals.** Record the `v1` in the branch name, any schema or
     version field inside `metadata.json`, and whether records are append-only JSONL —
     evidence for how safe it is to read the format directly.
  4. **The join, both directions.** Build a table joining phax's `Run-Id` / `Phase-Id` /
     `Session-Id` trailers to entire's `Entire-Checkpoint` / `Entire-Session` trailers
     for every commit in the run. Report whether phase → transcript and transcript →
     phase are both deterministic, and what breaks the join (squash merge collapsing
     several checkpoints onto one commit; a phase whose `Session-Id` has no matching
     `Entire-Session`; a resumed session spanning two phases via the fix loop).
  5. **Size per run**, so the desktop screen's cost is known.
- Create `spikes/entire/findings/03-format-and-join.md` from the template with a field
  inventory table, the join table, and `## Results`/`## Verdict` left for the real run.
  `## Verdict` must answer two questions explicitly: *can desktop read this from git
  alone?* and *is the phase ↔ transcript join deterministic in both directions?*
- Do not paste raw transcript content into the findings doc — it is a public repo.
  Report field names, shapes and sizes; redact values.

### Planned files to create

- `spikes/entire/03-format-and-join.sh`
- `spikes/entire/findings/03-format-and-join.md`

### Planned files to edit

- (none)

### Optional files that may be edited

- `spikes/entire/README.md`

### Boundary contracts

Informational only: the findings describe what a future desktop "inspect a run" view
would need from the checkpoint format. No code crosses a boundary in this phase.

### Test strategy

No automated tests (shell harness, human-run). The field inventory and join tables are
the signal.

### Implementation order

Raw-git read first (it determines whether the rest is even relevant), then the field
inventory, then the join table.

### Excluded scope

- Building any desktop view, view-model, or reader for the format.
- Proposing a phax-side schema for run records (phase-05 sketches it).
- Copying transcript content into committed files.

### Verification

- The project's configured `fast` gate profile in `phax.json` (repo health only).

### Expected handoff content

- Whether the format is readable from git alone, and the exact paths read.
- The field inventory: what desktop needs, what exists, what is missing.
- The join result in both directions and every case that breaks it.
- That `## Results`/`## Verdict` await a real run.
- Any deviation from the planned file lists, with the reason.

### Commit subject

test(spike): probe entire checkpoint format readability and the phax join

### Commit body

Add the format probe: a harness that reads a checkpoint tree straight out of git without
the entire binary, inventories metadata.json and transcript.jsonl fields against what a
desktop run-inspection screen needs, records format-stability signals, and joins phax's
Run-Id/Phase-Id/Session-Id trailers to entire's Entire-Checkpoint/Entire-Session in both
directions, noting what breaks the join. Transcript values are redacted — this is a
public repo. Results/Verdict filled from a real run out-of-band.

## phase-05 — Synthesis and adopt-vs-pattern options {#phase-05-synthesis}

**Recommended model:** claude-fable-5
**Recommended effort:** high

Turn the three probe findings into a single decision document that assembles the
evidence and lays out the adopt-vs-pattern options — leaving the verdict to the human.

### Detailed instructions

- Create `docs/spikes/entire-checkpoint-findings.md` that:
  - summarizes each probe's verdict (hooks-in-jail / lifecycle / format-and-join),
    pulling from the three findings docs. Where a `## Results` section is still
    unfilled, say so and mark the conclusion provisional rather than inferring it.
  - states the **decision this evidence serves**: adopt entire directly, or adopt only
    the shadow-branch pattern for phax's own run records (`phax/records/v1`).
    Frame each by its **dominant loss**, one line each — the pattern-only route abandons
    transcript capture, which is the one capability phax cannot produce itself; adopting
    entire abandons format ownership and adds a third-party dependency in the commit
    path. Do **not** write a recommendation, and leave a `## Verdict` section empty for
    the human, exactly as the probe docs do.
  - sketches, without implementing, the two consumption paths this unlocks:
    (a) **compliance review as diff-vs-intent evidence** — the review already compares
    diff against the extracted plan; the transcript adds *how* the phase got there
    (files read vs claimed, approaches abandoned, the point of drift). Name where that
    would attach in the existing review flow without designing it.
    (b) **the cross-run durable context layer** — run records travelling with the repo
    rather than living in a local `stateRoot`, feeding the orient provider from real
    history. Note the raw material that already exists and is unconsumed: the per-phase
    orientation brief (`orient-brief.json`, plan 49).
  - records the **provenance chain** the join would close, if phase-04 showed it
    deterministic: line → prompt → phase → plan → spec → decision.
  - lists residual risks: transcript exposure on a public repo with best-effort
    redaction, repo weight per run (cite phase-03's measurement), a second source of
    truth for "what happened" that can disagree with phax's own records, third-party
    format dependency, and hook fragility in the commit path (a failing
    `prepare-commit-msg` aborts commits).
  - closes with the **teardown checklist**, consolidated from the probe findings docs, so
    the developer can remove entire's mutations and the local shadow branch in one pass.
- Link the synthesis from `spikes/entire/README.md`.

### Planned files to create

- `docs/spikes/entire-checkpoint-findings.md`

### Planned files to edit

- `spikes/entire/README.md`

### Optional files that may be edited

- (none)

### Boundary contracts

Informational only: the synthesis describes where a future transcript consumer would
attach to the existing review flow and to the orient provider, but introduces no code
crossing any boundary.

### Test strategy

No tests — this is a decision document. It must be self-contained enough that a
follow-up plan can be written from it without re-reading the three probe docs.

### Implementation order

Read the three findings docs, then write per-probe summary → the adopt-vs-pattern
options → consumption sketches → provenance chain → residual risks → teardown checklist.
Leave `## Verdict` empty and last.

### Excluded scope

- Writing a recommendation or filling `## Verdict` — the human decides.
- Any change under `src/`, `phax.json`, `package.json`, or `NEXT_STEPS.md`.
- Writing the follow-up implementation plan (a separate `plan.md`).

### Verification

- The project's configured `fast` gate profile in `phax.json` (confirms the doc-only
  change leaves the repo green).

### Expected handoff content

- The three probe verdicts as carried into the synthesis, and which were provisional.
- The two options as framed, with the dominant loss named for each.
- Confirmation that `## Verdict` was deliberately left empty for the human.
- The teardown checklist location.
- Any deviation from the planned file lists, with the reason.

### Commit subject

docs(spike): synthesize the entire.io checkpoint findings

### Commit body

Add the synthesis doc: per-probe verdicts (hooks under the run-jail, checkpoint
lifecycle through worktree/merge/publish, format readability and the phase-to-transcript
join), the adopt-entire versus adopt-the-pattern options each framed by its dominant
loss, sketches of the two consumption paths (compliance review as diff-vs-intent
evidence, and the cross-run durable context layer feeding the orient provider), the
provenance chain the join would close, residual risks including public-repo transcript
exposure and repo weight, and a consolidated teardown checklist. The verdict is left
open for the human, per the spike's execution-model caveat.
