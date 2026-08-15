# entire.io checkpoint spike

Harness for the spike deciding whether [entire.io](https://entire.io/) — or only its
shadow-branch pattern — is worth adopting to version and share the transcripts of phax
runs. entire (MIT, CLI 0.10.0 at time of writing) hooks into agent configs, captures
full session transcripts, and writes one **Checkpoint per commit** onto a local shadow
branch `entire/checkpoints/v1`. The commit on the working branch carries an
`Entire-Checkpoint: <id>` trailer; the shadow branch carries the transcript tree
(`metadata.json`, `full.jsonl`, `transcript.jsonl`, `prompt.txt`) under a prefix derived
from that id.

## Context: what phax records, and what it does not

phax already records the **deliberate skeleton** of a run: spec → approved plan →
phases → reconciled diffs → gates → handoffs, with decision provenance from specs 21/22,
and per-commit trailers (`Run-Id`, `Short-Name`, `Phase-Id`, `Phase-Title`, `Model`,
`Effort`, `Session-Id`, `Gate-Log`). It does **not** record the **path taken**: session
ids are captured via the agent binding, but the transcripts stay in the provider's local
storage, unversioned and unshared. This spike probes whether entire closes that gap.

## The three unknowns

1. **Hooks in the run-jail** (`01-hooks-in-jail.sh`) — phax spawns
   `claude --print --output-format stream-json --verbose` with
   `--permission-mode acceptEdits`, a frozen `--allowedTools Bash(...)` allowlist and
   `--strict-mcp-config`, with **cwd set to the phase worktree**
   (`~/.phax/worktrees/<repo>.<shortName>/<phase-id>`), not the repo root. Do entire's
   Claude Code hooks load and run there? Two hazards: a worktree is a fresh checkout of
   tracked files only, so an untracked/gitignored settings file is invisible; and the
   frozen agentCommands allowlist may deny the hook command.
2. **Checkpoint lifecycle** (`02-checkpoint-lifecycle.sh`) — phax commits with plain
   `git commit -m <subject> -m <body>` and no `--no-verify`, so entire's
   `prepare-commit-msg` and `post-commit` hooks should fire — but from inside a
   **linked worktree**, with condensation writing a branch in the shared repo. Do
   checkpoints survive worktree → merge → publish, one per phase commit?
3. **Format and join** (`03-format-and-join.sh`) — is `entire/checkpoints/v1` readable
   straight out of git (no entire binary), and is the phase ↔ transcript join
   deterministic in both directions via the co-located phax and entire trailers?

## Execution-model caveat

Enabling entire mutates the developer's real repository (agent settings + git hooks) and
its effects only appear when a real phax run commits through those hooks. A phase agent
running inside a worktree **cannot** enable entire, cannot observe the hook firing on
its own commit before that commit exists, and must not reconfigure the repo it runs in.
Moreover the frozen agentCommands set for this run does not include `git`, so the agent
cannot inspect the shadow branch at all.

Therefore: the probe phases deliver **the harness script plus a findings doc with empty
`## Results` / `## Verdict` sections**. Every probe is authored by the agent and
**executed out-of-band by a human**. The `fast` gate only confirms the repo stays green;
it proves nothing about entire. Treat the synthesis as provisional until a real run
fills the Results sections.

## Recommended procedure: the spike observes its own run

The cheapest real data is this plan's own run — enable entire _before_ `phax run`, and
the run's five phase commits, its merge and its PR become the observed dataset.

0. **Snapshot before enabling.** Copy `.claude/settings.json` and
   `.claude/settings.local.json` (whichever exist) and a listing of `.git/hooks/` to a
   path **outside the repo**. `01-hooks-in-jail.sh` diffs against this copy and the
   teardown reverts to it.
1. **Enable out-of-band:**
   `entire enable --agent claude-code --project --skip-push-sessions`. `--project` is
   required: without it the hooks land in `.claude/settings.local.json`, which this
   repo ignores globally.
2. **Commit the enablement, or the worktree is not enabled.** A phase worktree checks
   out tracked files only. `.claude/settings.json` (the hooks) and
   `.entire/settings.json` + `.entire/.gitignore` (the enablement flag) must be
   tracked before the run. `.entire/`'s own `.gitignore` excludes `metadata/`, `logs/`,
   `tmp/` and `redactors/local/`, so committing it commits configuration only, never
   transcripts (verified 2026-08-15 on entire 0.10.0).
3. **Smoke the hook.** Make one throwaway commit by hand and confirm it succeeds. The
   installed `prepare-commit-msg` and `post-commit` hooks wrap their calls as
   `entire hooks git … 2>/dev/null || true` (observed 0.10.0) so they cannot abort a
   phax commit — re-read the installed hooks rather than assuming this for another
   version. The smoke commit gets no trailer and no shadow branch (no agent session
   behind it); that is expected, and answers the non-agent-commit case early.
4. **`pre-push` is the exception** — the one hook _not_ wrapped in `|| true`; its job is
   pushing session logs alongside your push. phax auto-publishes, so it will fire.
   Confirm `.entire/settings.json` carries `strategy_options.push_sessions: false`
   (set by `--skip-push-sessions`) before running.
5. **Run the plan.** Its phase commits, merge and PR are the dataset.
6. **Fill the findings.** Run `00-preflight.sh`, then `01-…`, `02-…`, `03-…` in order,
   paste raw output into each findings doc's `## Results`, write each `## Verdict`,
   then the synthesis verdict.

## Safety protocol

`lbdremy/phax` is **public** and entire commits full session transcripts (prompts, tool
calls, files touched). Redaction is best-effort. The developer accepted this risk
knowingly and will delete the branches afterwards. Non-negotiables:

- `--skip-push-sessions` on enable, so a `git push` does not carry session logs.
- `entire/checkpoints/v1` is **never pushed**. Check `git config --get push.default`
  and any `remote.origin.push` refspec before pushing anything during the observation
  window; never run `git push --all` / `--mirror`.
- Never paste raw transcript content into committed files; report field names, shapes
  and sizes only.

### Teardown contract

The findings doc for probe 01 records the **exact** settings-file and git-hook mutations
entire made, so teardown is deterministic, not archaeological:

1. Revert precisely the recorded mutations (settings files, git hooks) to the step-0
   snapshot.
2. Delete the local shadow branch: `git branch -D entire/checkpoints/v1`.
3. Re-run `00-preflight.sh` to confirm a clean state.

## Running the harnesses

All scripts are POSIX `sh`, read-only, human-run, and not wired into any gate or
`package.json` script:

| Script                       | What it reports                                                          |
| ---------------------------- | ------------------------------------------------------------------------ |
| `00-preflight.sh`            | entire install state, enablement state, push safety, phax ground facts   |
| `01-hooks-in-jail.sh`        | (phase-02) agent-side hook survival in a phase worktree                  |
| `02-checkpoint-lifecycle.sh` | (phase-03) trailer + checkpoint lifecycle through worktree/merge/publish |
| `03-format-and-join.sh`      | (phase-04) format readability from git alone, and the phax join          |

Findings live in `findings/`, one doc per probe, copied from `findings/TEMPLATE.md`.
The synthesis — per-probe verdicts, the adopt-vs-pattern options, consumption sketches,
residual risks and the consolidated teardown checklist — is
[`docs/spikes/entire-checkpoint-findings.md`](../../docs/spikes/entire-checkpoint-findings.md)
(phase-05). Its `## Verdict` is left empty for the human, like the probe docs'.
