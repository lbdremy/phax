# Manual E2E validation runbook — Claude Code, Codex CLI, Mistral Vibe

> **Run this by hand, not via the phax CLI.** This is a validation runbook, not
> a phax phase plan, so it is intentionally not in `.skills/phax-planning.md`
> format. It validates the adapter changes from
> `docs/plans/03-update-provider-effort-plan.md` (phases 03 and 04) against the
> real provider CLIs.
>
> The spec (`docs/specs/03-update-provider-effort.md`) is explicit: the goal is
> to **prove provider execution works end to end**, not only that unit tests
> pass. The implementation is not complete until each provider's E2E flow is
> diagnosed and fixed, or the broken capability is explicitly documented as
> unsupported.

---

## Prerequisites

- `claude --version`, `codex --version`, and `vibe --version` all succeed and
  each CLI is authenticated.
- Network access (real API calls; modest token cost).
- The phax E2E harness exists: `pnpm test:e2e:real` drives the CLI against a
  fresh temp repo and temp `PHAX_HOME`. See `docs/e2e-testing.md` for the
  isolation model and the failure-artifact block.

## How the harness selects a backend

`tests/e2e/realFlow.test.ts` reads `PHAX_E2E_BACKEND` and resolves it through
`tests/e2e/helpers/backends.ts` (`claude-code-cli`, `mistral-vibe`,
`codex-cli`). The suite only runs when both the backend executable probes OK
**and** `PHAX_E2E_RUN=1` is set.

```bash
# Claude Code (baseline)
PHAX_E2E_RUN=1 PHAX_E2E_BACKEND=claude-code-cli pnpm test:e2e:real

# Codex CLI
PHAX_E2E_RUN=1 PHAX_E2E_BACKEND=codex-cli pnpm test:e2e:real

# Mistral Vibe
PHAX_E2E_RUN=1 PHAX_E2E_BACKEND=mistral-vibe pnpm test:e2e:real
```

---

## What each provider must demonstrate (spec E2E expectations)

For every provider, the run must:

- start a phase and receive the generated phase prompt,
- run in the correct worktree,
- produce usable output,
- return a captured session id (if the provider supports it),
- allow resume (if supported),
- complete a minimal phase,
- produce logs,
- surface a clear error when invocation fails.

`realFlow.test.ts` already asserts the structural facts: two phases reach
terminal state, `run-status.json` is `review_open` with `phasesCount: 2`,
phase folders and `status.json` exist, `phase-01/phase-handoff.md` is non-empty,
`session-info`/`ls` work, and `archive` transitions to `archived`.

---

## Provider checklists

### 1. Claude Code (baseline — should already pass)

- [ ] `PHAX_E2E_BACKEND=claude-code-cli` run reaches `review_open`.
- [ ] Confirms the harness and fixture are healthy before debugging the others.

### 2. Codex CLI — root cause: exit code 2

Pre-fix diagnosis (recorded in plan 03, phase-03): the old adapter built a
**top-level** `codex` invocation with nonexistent flags (`--approval-mode`,
`--print`, `--output-format`, `--verbose`, `--reasoning-effort`); clap rejects
them → **exit 2**. The fix moves to the `codex exec` subcommand with `--model`,
`--sandbox`, `--cd`, `--json`, and `-c model_reasoning_effort`.

- [ ] Run the standalone CLI once to confirm the corrected flags are accepted
      and to capture the real `--json` event stream:
      `codex exec --json -c model_reasoning_effort="low" "print ok"` → exit 0.
- [ ] Confirm session id and final text are present in the event stream and
      parsed by the updated `src/schemas/codexOutput.ts`.
- [ ] Full flow: `PHAX_E2E_BACKEND=codex-cli` run reaches `review_open`,
      phase-01 produces a handoff, `session-info` reports a session id.
- [ ] Resume works: `codex exec resume <session_id> …` returns usable output.
- [ ] Confirm the previous **exit code 2** no longer occurs.

If any capability remains broken, record it as **explicitly unsupported** below
with the observed CLI behavior.

### 3. Mistral Vibe — root cause: wrong args + trust

Pre-fix diagnosis (plan 03, phase-04): the old adapter used nonexistent flags
(`--print`, `--output-format stream-json`, `--verbose`) and never handled
directory trust, so non-interactive runs fail or block on the trust prompt. The
fix uses `-p --agent auto-approve --output streaming --trust [--resume]` with
the alias injected via `VIBE_ACTIVE_MODEL`.

Walk the spec's failure-cause list and confirm which applied, then verify the
fix:

- [ ] wrong arguments — corrected to real `vibe -p` flags.
- [ ] wrong programmatic-mode usage — `-p` + `--output streaming`.
- [ ] workdir/trust handling — `--trust`/`--workdir` no longer prompts.
- [ ] agent choice — `--agent auto-approve` runs tools without approval.
- [ ] model alias — `VIBE_ACTIVE_MODEL=phax-mistral-medium-3.5-<level>` resolves.
- [ ] resume incompatibility — `--resume <session_id>` returns usable output.
- [ ] output parsing — `src/schemas/vibeOutput.ts` parses the streaming events.
- [ ] Full flow: `PHAX_E2E_BACKEND=mistral-vibe` run reaches `review_open`.

---

## Recording results

When a run fails, the harness keeps both temp dirs and prints the
failure-artifact block (repo path, `PHAX_HOME`, run path, run state, last log).
Capture, per provider:

- the exact command run and exit code,
- the failing arg vector and CLI stderr (if any),
- the relevant slice of the phase log / JSONL output,
- the diagnosis and the fix (or the "explicitly unsupported" note).

## Exit criteria

- Claude Code, Codex CLI, and Mistral Vibe each complete the minimal two-phase
  fixture and reach `review_open` — **or** the failing capability is documented
  here as explicitly unsupported with the observed CLI behavior.
- The Codex exit-code-2 and the Mistral Vibe execution failures are confirmed
  resolved (or documented as unsupported).
