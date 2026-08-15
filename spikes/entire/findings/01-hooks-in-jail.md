# Findings: agent-side hook survival in the phax run-jail

<!--
Environment and Procedure are filled at authoring time; Results and Verdict are
filled out-of-band from a real run, per the spike's execution-model caveat.
Never paste raw transcript content — this is a public repo. Report field
names, shapes and sizes; redact values.
-->

## Environment

<!-- Fill from the observed run: -->

- entire version: _(from `entire --version`; harness authored against 0.10.0)_
- phax version / commit: _(fill)_
- OS: _(fill)_
- repo state: `lbdremy/phax`, branch _(fill)_, enablement committed at _(sha)_
- date: _(fill)_

Ground facts already established (2026-08-15, before this probe ran):

- phax spawns `claude --print --output-format stream-json --verbose` with
  `--permission-mode acceptEdits`, a frozen `--allowedTools Bash(...)` allowlist and
  `--strict-mcp-config` (`src/infra/providers/claudeCode.ts`), with **cwd set to the
  phase worktree**, not the repo root.
- This repo has no tracked `.claude/settings.json` at baseline, and
  `.claude/settings.local.json` is ignored globally via `~/.config/git/ignore`. So
  `entire enable` **without** `--project` would produce a phase agent that loads no
  hooks — for a reason unrelated to the run-jail (the file is simply absent from a
  fresh worktree checkout). The procedure therefore mandates `--project`.

### entire flags this procedure assumes (exact syntax, entire 0.10.0)

| Flag                   | Meaning here                                                                                                               |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `--agent claude-code`  | install hooks for Claude Code (the provider phax spawns)                                                                   |
| `--project`            | write hooks into `.claude/settings.json` (shareable, trackable) — **required**, see ground facts                           |
| `--local`              | the default alternative: writes `.claude/settings.local.json`, which this repo gitignores globally — must NOT be used here |
| `--skip-push-sessions` | sets `strategy_options.push_sessions: false` in `.entire/settings.json` so `pre-push` does not push session logs           |
| `--force`              | overwrite pre-existing hook entries on re-enable; only needed if enable is re-run after a partial teardown                 |

Enable command used (out-of-band, human only):
`entire enable --agent claude-code --project --skip-push-sessions`

## Procedure

0. Before enabling, snapshot to a directory **outside the repo** (README step 0):
   `.claude/settings.json` → `SNAPSHOT_DIR/settings.json`,
   `.claude/settings.local.json` → `SNAPSHOT_DIR/settings.local.json`
   (whichever exist), and `ls .git/hooks/` → `SNAPSHOT_DIR/hooks-listing.txt`.
1. Enable out-of-band (command above), commit the enablement, smoke one manual
   commit, then `phax run` this plan (README steps 1–5).
2. While a phase worktree exists (or with `keepWorktree` on the final phase), from the
   repo root run:

   ```
   sh spikes/entire/01-hooks-in-jail.sh \
     SNAPSHOT_DIR \
     ~/.phax/worktrees/<repo>.<shortName>/<phase-id> \
     <stateRoot>/runs/<run-id>/security.json \
     phax/entire-checkpoint-spike
   ```

3. Paste the raw output into `## Results`, complete the five-row table, then write
   `## Verdict`.

The five cases, of which **2 and 4 are decisive**:

| #   | Case                                                                           | Decisive | Question it answers                                                                  |
| --- | ------------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------ |
| 1   | Where `entire enable` wrote its settings (diff vs pre-enable snapshot)         | no       | which file to track, and the exact mutations for `## Teardown`                       |
| 2   | Whether that file is visible inside a phase worktree (fresh checkout)          | **yes**  | do the hooks exist at all in the agent's cwd?                                        |
| 3   | Which hook events entire registered, and whether each fires under `--print`    | no       | does headless mode drop any registered event?                                        |
| 4   | Whether the hook command is reachable under the frozen agentCommands allowlist | **yes**  | does Claude Code run hook commands through the `--allowedTools` gate, or outside it? |
| 5   | Whether a durable checkpoint exists for a phase's `Session-Id` trailer         | no       | end-to-end: was the session captured at all?                                         |

Why 2 and 4 are decisive: a settings file the worktree checkout does not contain means
no hooks load, regardless of permissions (case 2); and a hook whose command the jail
denies never runs, regardless of loading (case 4). Cases 3 and 5 only refine _how much_
is captured once both decisive cases pass.

## Results

Filled 2026-08-15 from the observed run `entire-checkpoint-spike-1786807559589`
(5 phases, `claude-fable-5`, entire 0.10.0, phax 0.8.3).

| #   | Case                                | Observed                                                                                                                                                                                                                                                                                       |
| --- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Settings location + exact diff      | `entire enable --agent claude-code --project --skip-push-sessions` **created** `.claude/settings.json` (none existed). Installed 5 git hooks: `commit-msg`, `post-commit`, `post-rewrite`, `pre-push`, `prepare-commit-msg`.                                                                   |
| 2   | Worktree visibility (decisive)      | **Pass, but only because the config was committed first.** `.claude/settings.json` and `.entire/settings.json` were both present inside the phase worktree. `.claude/settings.local.json` is ignored globally (`~/.config/git/ignore`), so `--local` would have left the phase agent hookless. |
| 3   | Registered events / fire in --print | Registered: `SessionStart`, `UserPromptSubmit`, `Stop`, `SessionEnd`, `PreToolUse`(Agent), `PostToolUse`(Agent, TaskCreate\|TaskUpdate). Enough of them fire in a headless `--print` session to produce a complete checkpoint — evidenced by case 5, not asserted statically.                  |
| 4   | Allowlist reachability (decisive)   | **Hooks run outside the `--allowedTools` gate.** The frozen set for this run was config ∪ `full` gate commands and contained no bare `entire`; the hook command is `sh -c '… exec entire hooks claude-code …'`. It ran anyway, in all 5 phases.                                                |
| 5   | Session material captured           | **5 of 5 phases captured.** Each phase commit carries `Entire-Checkpoint`, resolving to a ref whose `Entire-Session` equals that commit's phax `Session-Id`.                                                                                                                                   |

Per-phase evidence (`sh spikes/entire/01-hooks-in-jail.sh …` case 5):

```
a726aff  phase-01  b5218d40…  -> CAPTURED (refs/entire/checkpoints/GF/01M030KTF52JZ2WT2KDVE30AGF)
39080d3  phase-02  9154050c…  -> CAPTURED (refs/entire/checkpoints/2T/01M030V4YH9NRFMKYHRVH54A2T)
0d23c1d  phase-03  0fb3446b…  -> CAPTURED (refs/entire/checkpoints/5P/01M031RBED5CE2330EQGRXJE5P)
4bef12c  phase-04  6d081cc4…  -> CAPTURED (refs/entire/checkpoints/MB/01M032WN4BDQ675PP31E2YR6MB)
ffa1ed4  phase-05  41e5fd50…  -> CAPTURED (refs/entire/checkpoints/N9/01M034VBDEYPYF50ZRM3E4E2N9)
```

> **Correction to this probe's original harness.** Case 5 first tested capture by
> looking for `.entire/metadata/<session-id>/`. That is live staging, cleared once
> a session condenses into its checkpoint ref, so it reports "session NOT
> captured" for every _completed_ phase. During this run `.entire/metadata/` held
> only the one still-open session while all five phases were captured — the check
> would have recorded a false **no** on this probe's entire question. The harness
> now resolves `Entire-Checkpoint` → ref → `Entire-Session` instead.

## Verdict

**Pass — a phax phase agent is captured by entire, unmodified.** All five headless
`--print` sessions, each spawned in a linked worktree under `acceptEdits` and a
frozen `--allowedTools` allowlist, produced a complete checkpoint; phax needed no
change, and entire needed no phax-specific configuration.

The pass is conditional on one setup step, and it is not optional: the enablement
must be **committed**. A phase worktree is a checkout of tracked files only, so an
untracked or ignored `.claude/settings.json` / `.entire/settings.json` is invisible
to the phase agent and to the git hooks that run with the worktree as cwd. Enabled
but uncommitted, this probe fails for a reason that has nothing to do with the
run-jail.

## Open questions

- Does a resumed fix-loop session (same phase, second attempt) produce one
  checkpoint or two? This run had no gate failure, so the fix loop never engaged.
- Do the hook events differ between interactive and `--print` beyond what case 3
  covers? Only `--print` was exercised.
- `Ephemeral-branch: entire/7116421-cadb10` appears on every checkpoint commit and
  is undocumented here — harmless, but unexplained.
- Only `claude-code` was tested. phax also routes to `codex` and `mistral-vibe`;
  entire ships hooks for Codex but the pairing is unverified.

## Teardown

<!-- Required by the safety protocol. This section is the single teardown
     record for the whole spike — phase-03 must NOT duplicate it. -->

Exact mutations entire made (fill from case 1's diff, verbatim):

Recorded 2026-08-15 from the observed run:

- `.claude/settings.json`: **created** (did not exist before). Registers six hook
  events, all invoking `sh -c '… exec entire hooks claude-code <event>'`, plus a
  `permissions.deny` entry for `Read(./.entire/metadata/**)`.
- `.git/hooks/`: **five added** — `commit-msg`, `post-commit`, `post-rewrite`,
  `pre-push`, `prepare-commit-msg`. All but `pre-push` swallow failures with
  `2>/dev/null || true`.
- `.entire/`: created — `settings.json` (`enabled: true`,
  `strategy_options.push_sessions: false`, `checkpoints.primary.type: "git-refs"`),
  `.gitignore` (excludes `tmp/`, `settings.local.json`, `metadata/`, `logs/`,
  `redactors/local/`), plus untracked `logs/`, `metadata/`, `tmp/`.
- Checkpoint refs written: **8** under `refs/entire/checkpoints/**` (5 from this
  run's phases, 3 from adjacent sessions).

Revert steps, in order:

1. Revert the enablement commit(s) (they tracked `.claude/settings.json` and
   `.entire/`), or restore `.claude/settings*.json` from `SNAPSHOT_DIR` and
   `git rm -r .entire` if history must stay linear.
2. Restore `.git/hooks/` to the `SNAPSHOT_DIR/hooks-listing.txt` state (delete the
   hooks entire installed; hooks live in the common git dir, not the worktree).
3. Delete the checkpoint refs. They are **not** a branch, so `git branch -D` does
   not reach them and nothing in the normal workflow ever will — skip this and
   every transcript stays in the repo indefinitely:

   ```sh
   git for-each-ref --format='%(refname)' 'refs/entire/checkpoints/**' \
     | while read -r ref; do git update-ref -d "$ref"; done
   git for-each-ref 'refs/entire/**'   # must print nothing
   ```

   Then `git gc --prune=now` to drop the now-unreachable objects; until it runs
   the transcripts are still in `.git/objects`.

4. Confirm nothing was pushed, querying the full namespace (not `--heads`, which
   cannot see it): `git ls-remote origin 'refs/entire/*' 'refs/heads/entire/*'`.
5. Re-run `sh spikes/entire/00-preflight.sh` and confirm: no `.entire/`, zero
   checkpoint refs, no settings file or git hook mentioning entire.
