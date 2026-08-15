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

| #   | Case                                                                               | Decisive | Question it answers                                                                  |
| --- | ---------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------ |
| 1   | Where `entire enable` wrote its settings (diff vs pre-enable snapshot)             | no       | which file to track, and the exact mutations for `## Teardown`                       |
| 2   | Whether that file is visible inside a phase worktree (fresh checkout)              | **yes**  | do the hooks exist at all in the agent's cwd?                                        |
| 3   | Which hook events entire registered, and whether each fires under `--print`        | no       | does headless mode drop any registered event?                                        |
| 4   | Whether the hook command is reachable under the frozen agentCommands allowlist     | **yes**  | does Claude Code run hook commands through the `--allowedTools` gate, or outside it? |
| 5   | Whether `.entire/metadata/<session-id>/` exists for a phase's `Session-Id` trailer | no       | end-to-end: was the session captured at all?                                         |

Why 2 and 4 are decisive: a settings file the worktree checkout does not contain means
no hooks load, regardless of permissions (case 2); and a hook whose command the jail
denies never runs, regardless of loading (case 4). Cases 3 and 5 only refine _how much_
is captured once both decisive cases pass.

## Results

| #   | Case                                | Observed |
| --- | ----------------------------------- | -------- |
| 1   | Settings location + exact diff      |          |
| 2   | Worktree visibility (decisive)      |          |
| 3   | Registered events / fire in --print |          |
| 4   | Allowlist reachability (decisive)   |          |
| 5   | Session material captured           |          |

<!-- Raw harness output below. Left empty until a real run fills it. -->

## Verdict

<!-- Must answer one question explicitly:
     does a phax phase agent get captured by entire, UNMODIFIED?
     pass/fail + one line. Left empty until Results is filled. -->

## Open questions

<!-- Anything the observation could not settle, for phase-05 to carry.
     Known candidates: does a resumed fix-loop session produce a second
     metadata dir; do hook events differ between interactive and --print
     beyond what case 3 shows. -->

## Teardown

<!-- Required by the safety protocol. This section is the single teardown
     record for the whole spike — phase-03 must NOT duplicate it. -->

Exact mutations entire made (fill from case 1's diff, verbatim):

- `.claude/settings.json`: _(created/modified — paste the diff hunks)_
- `.git/hooks/`: _(files added/changed — from the hooks-listing diff)_
- `.entire/`: _(files created — `settings.json`, `.gitignore`, …)_

Revert steps, in order:

1. Revert the enablement commit(s) (they tracked `.claude/settings.json` and
   `.entire/`), or restore `.claude/settings*.json` from `SNAPSHOT_DIR` and
   `git rm -r .entire` if history must stay linear.
2. Restore `.git/hooks/` to the `SNAPSHOT_DIR/hooks-listing.txt` state (delete the
   hooks entire installed; hooks live in the common git dir, not the worktree).
3. Delete the local shadow branch: `git branch -D entire/checkpoints/v1`.
4. Re-run `sh spikes/entire/00-preflight.sh` and confirm it reports: no `.entire/`,
   no `entire/checkpoints/v1` ref, no settings file or git hook mentioning entire.
