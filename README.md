# phax

`phax` drives Claude Code through isolated, gated phases. Each phase gets its own Git worktree, a same-session fix loop, and a kept-open final phase for human review.

## Install

```bash
pnpm add -g phax        # or install locally in your repo
```

Requirements: Node ≥ 20, `claude` CLI on `$PATH` (Claude Code).

## Configure

Add a `phax.json` at your repo root:

```json
{
  "version": 1,
  "project": { "name": "my-project", "type": "single-package" },
  "state": { "root": "~/.phax" },
  "editor": { "command": "zed" },
  "agent": { "backend": "claude-code-cli", "maxFixAttempts": 1 },
  "commands": {
    "setup": ["pnpm install"],
    "cleanup": ["rm -rf node_modules"]
  },
  "gateProfiles": {
    "fast": ["pnpm typecheck", "pnpm test:unit"],
    "full": ["pnpm typecheck", "pnpm lint", "pnpm test", "pnpm build"]
  }
}
```

Validate it before running:

```bash
phax validate --config phax.json --plan phax-plan.json
```

## Write a plan

Write `plan.md` — a Markdown document with one `## phase-NN — <title>  {#phase-NN-<slug>}` section per phase. Each section must include an objective, instructions, and a commit subject. See `examples/plan.md` for a worked example and `.skills/phax-planning.md` for the full template contract.

## Extract the plan

```bash
phax extract-plan --plan-md plan.md --out phax-plan.json
```

This calls Claude Code headlessly with the `phax-plan.json` JSON Schema, validates the structured output, and writes the plan atomically. Add `--force` to overwrite an existing file.

## Run

```bash
phax run                                        # full execution (reads plan.md + phax-plan.json)
phax run --plan-md plan.md --plan plan.json     # explicit paths
phax run --dry-run                              # preview only — zero side effects
phax run --profile fast                         # override gate profile
phax run --allow-dirty                          # skip clean-tree guard
phax run --workspace packages/api              # workspace-scoped gate commands (monorepo)
```

Each phase:

1. Creates a Git worktree at `~/.phax/worktrees/<short-name>/phase-NN/`.
2. Runs `commands.setup` inside the worktree.
3. Builds a prompt from the plan and the previous phase's handoff, sends it to Claude Code.
4. Runs the gate profile; on failure, resumes the same Claude session once and retries.
5. After passing gates, resumes Claude to produce `phase-handoff.md`.
6. Commits with the planned message. If the worktree is clean (no changes), the run stops with a non-zero exit and writes `resume-instructions.md` — use `phax resume` to continue from the next phase.

Worktrees from every phase persist on disk for the lifetime of the run and are available for inspection until `phax archive` is run.

The final phase stays open for review. A `review-handoff.md` is written to the run folder.

## Review loop

```bash
phax enter <short-name>   # resume the final Claude session
phax shell <short-name>   # open $SHELL in the final worktree
phax path  <short-name>   # print the worktree path (script-friendly)
phax open  <short-name>   # open the worktree in the configured editor
```

Append `-last` to any command to target the most recent `review_open` run:

```bash
phax enter-last
phax shell-last
phax path-last
phax open-last
```

## List runs

```bash
phax ls                   # all runs
phax ls --active          # created or running
phax ls --failed
phax ls --review-open
phax ls --archived
phax ls --json            # machine-readable
```

## Archive

Archive is the **only** operation that touches `worktrees/`. It moves:

- `~/.phax/runs/<short-name>` → `~/.phax/archive/<short-name>/runs/`
- `~/.phax/worktrees/<short-name>/` → `~/.phax/archive/<short-name>/worktrees/`

Then runs `git worktree prune` to drop stale admin records. Nothing is destructively deleted — every phase's working state is preserved for later inspection.

```bash
phax archive <short-name>       # requires review_open or completed
phax archive-last               # most recent review_open run
phax archive <short-name> --force  # allow uncommitted changes in final worktree
```

## Testing

```bash
pnpm test               # unit + integration — fast, no network, no Claude Code
pnpm test:e2e:real      # opt-in real E2E — requires claude CLI + auth, costs tokens
```

The E2E suite skips automatically unless `PHAX_E2E_RUN=1` is set, so it never runs by accident. See [`docs/e2e-testing.md`](docs/e2e-testing.md) for prerequisites, isolation model, and how to read failure artifacts.

## Debugging

Add `--verbose` to any `run` or `resume` command to print config discovery, state transitions, agent invocations, gate results, and commit events to the terminal:

```bash
phax run --verbose
phax resume <short-name> --verbose
```

Add `--trace` to also write a structured JSONL log to `~/.phax/runs/<short-name>/trace.jsonl`:

```bash
phax run --trace
```

Both flags can be combined (`--verbose --trace`). See [`docs/extract-plan-model.md`](docs/extract-plan-model.md) for how to configure the model used by `extract-plan`.

## Resume

```bash
phax resume <short-name>        # restart from the next pending phase
phax resume <short-name> --yes  # skip confirmation
```

Resume validates the run state, lock, and worktree before proceeding. It never re-runs committed phases. If the run is `review_open`, it refuses and points you at `phax enter`.

## Locks

`phax` writes a lock file at `~/.phax/locks/<short-name>.lock` for every active run. If a process dies, the lock can become stale:

```bash
phax unlock <short-name>        # remove stale lock
phax unlock <short-name> --force  # remove any lock
```

## Exit codes

| Code | Meaning                                       |
| ---- | --------------------------------------------- |
| 0    | Success                                       |
| 1    | Validation error, config error, or plan error |
| 2    | Gate failure (after fix loop exhausted)       |
| 3    | Lock conflict                                 |
| 4    | Unsafe git state (dirty worktree)             |
| 5    | Claude invocation error                       |
| 6    | Handoff generation failed                     |
| 8    | Rate limit or usage limit hit (resumable)     |
| 9    | Phase produced no changes (resumable)         |

## Environment variables

| Variable          | Purpose                                                        |
| ----------------- | -------------------------------------------------------------- |
| `PHAX_STATE_ROOT` | Override `state.root` from `phax.json`                         |
| `PHAX_CLAUDE_BIN` | Path to the `claude` executable (default: `claude` on `$PATH`) |
| `PHAX_NO_COLOR`   | Disable ANSI color output                                      |

## Troubleshooting

**`claude` not found** — install Claude Code and ensure the binary is on `$PATH`.

**Lock conflict** — another `phax` process is running, or a previous process died. Run `phax unlock <short-name>` to clear a stale lock.

**Gate failure loop** — increase `maxFixAttempts` in `phax.json`, or reduce gate scope. Check `~/.phax/runs/<short-name>/phase-NN/checks-attempt-01.log` for details.

**Missing `phase-handoff.md` sections** — the phase transitioned to `handoff_failed`. Check the phase status file and resume the Claude session with `phax enter`.

**Format conflicts** — run `pnpm format`, do not add lint exceptions. **Knip failures** — remove the dead code or wire it into an entry point, do not add `ignoreDependencies` entries casually.

## State Machine

phax is implemented as an explicit hierarchical state machine. Every signal (gate result, rate limit, agent completion, archive request) is a typed `PhaxEvent`. The pure reducer returns a `Disposition` — `Handled`, `Ignored`, `Stale`, `Rejected`, or `Unexpected` — plus optional side-effect commands. The single `dispatch()` entry point is the only writer to `status.json` and `run-status.json`.

See [`docs/state-machine.md`](docs/state-machine.md) for:

- Mermaid diagrams of the run and phase hierarchies
- The full event-disposition matrix
- The event and command vocabularies
- A worked example of adding a new signal

## Security notes

`phax` never interpolates user-controlled data (branch names, workspace paths, plan fields) into shell command strings. All git and shell invocations pass arguments as separate `argv` tokens. Gate commands from `phax.json` are treated as opaque pre-validated arrays, not shell strings.
