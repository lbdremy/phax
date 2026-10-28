Write the only phax plan of the spec `provider-failures` (`docs/specs/2610271510-provider-failures.md`, approved 2026-10-28 at 0.30.0). Its run completes the spec (`completes-spec: true`). Title it "Provider failures".

**Scope.** The whole spec: §5.1 to §5.19, every §6 surface and every acceptance criterion. In short:
- one session-outcome reader per provider (Claude Code, Codex, Mistral Vibe), returning an answer or a failure with its kind, the provider's message and the session id when there is one;
- the reading order: result event, then the transcript's last error event, then stderr; never tool output or model text. The limit classification moves onto this reader;
- network failures exit 14, resumable, with the provider's message and a retry hint;
- the cause printed before any secondary refusal; `agent-error.log` holding the cause;
- an `unknown` visibility quoting `gh`'s first stderr line, with a retry suggested for network and auth failures;
- the failed decision record's required `failure` field, and `review-stop.json`'s `network` result, both at 0.30.0;
- the handoff turn, the silent empty Codex answer, the dispatcher's lost log hint, and the fix-loop telemetry naming its provider.

**What landed since the spec was written (build on it, do not redo it):**
- `vibe-3` (#170, merged 2026-10-28) rewrote the Vibe adapter for Vibe 3.0.3. Each headless Vibe turn passes `--output-dir <transcript>.vibe-export`, and Vibe writes `export.json` there on every exit. The file holds `outcome`, `exit_code`, `error` (with a `code`), `session_id`, `usage` and `cost_usd`. `src/schemas/vibeExport.ts` decodes it, and `src/domain/records/usage.ts` names its path (`vibeExportDirOf`, `vibeExportFileOf`).
- The spec left it open whether Vibe's outcome comes from that export. It does: the export is proven reliable on 3.0.3. Facts observed on 2026-10-28:
  - a rejected API key gives `outcome: "config_error"`, `error.code: "invalid_api_key"`, exit 1;
  - an API 400 (an unsupported reasoning level) gives `outcome: "infrastructure_failure"`, exit 2, with the API's message on stderr;
  - a normal turn gives `outcome: "finished"`, exit 0.

  Classify Vibe failures from the export's `outcome` and `error`, with stderr as the message when the export has none. Read Vibe's source for the other outcomes and error codes, network ones above all. It is at `~/.local/share/uv/tools/mistral-vibe/lib/python3.14/site-packages/vibe`; do not read `~/.vibe`.
- #170 also added refusals of its own in the Vibe adapter:
  - the version floor;
  - a missing answer;
  - a missing or invalid export;
  - before spawning, a user `accept-edits` profile, and Vibe config under an extra root;
  - after the turn, a config mismatch.

  Each writes `agent-error.log`. Fit them into the outcome reader's kinds (most are `provider-error` or a phax refusal that is not a provider failure at all). Say which in Technical arbitrations, and keep their messages.
- `decision-record-manifest` already has a `next` snapshot at 0.30.0 and a frozen 0.28.0 history module, both from `vibe-3`'s usage change. This plan edits the current shape only. `review-stop` is still at 0.26.0 and moves to 0.30.0 here, with its frozen module.

**Settle in Technical arbitrations, each with its dominant loss:**
- where the reader lives (domain parsing per provider, infra reading files) and the type it returns;
- how each provider's network failure is recognized: Claude Code's synthetic `API Error` and `api_retry` events, and Codex's and Vibe's equivalents;
- how a run records a paused network failure: a new event beside `RateLimitDetected`, or a widened one, within the state-machine rules;
- how the CLI orders the cause and a secondary refusal, for `run`, `resume`, `decide` and the review commands.

**Constraints:**
- No back-compat shims, and no optional field in a persisted shape. The new `failure` field and the `network` result are required. Older stamps are read through the frozen modules.
- Tests never read `~/.phax`, a real `~/.claude`, `~/.codex` or `~/.vibe`, the global git config, or the real `gh`. Use `tests/helpers/isolateGit.ts`, temporary directories, `makeFakeGitHub()`, the fake provider backends, and the fake `vibe` from #170, which writes an export.
- The layer rules of `pnpm audit:architecture`, and every exhaustive format registry the schemas package tests hold.
- Gates: the `standard` profile verifies every phase, and `phax.json` allows every command a phase runs. Regenerate `phax.usage.kdl` and `docs/cli/reference.md` (`pnpm gen:usage-spec`, `pnpm docs:cli`) when help text or exit codes change.
- Models: follow the phax-planning skill's model policy.
- `### Test strategy`: use the line format, with the spec's criterion ids. Cover every criterion.
- Oracle pair: use one only where the contract is stable before the code exists. The outcome reader's table of transcripts and kinds is a candidate. Say why if you do not use one.
- The plan must pass `phax plans lint`.
- No skill changes, so the run needs no `--allow-skill-edits`.

**Docs:**
- the README's exit-code table and its troubleshooting;
- `docs/upgrading.md` 0.30.0, only for what a user must do: exit 14 in scripts, and the decision record and `review-stop` shapes for records readers.

**Phase shape:** as few phases as the gates allow, with every commit green.

**Output:** your final message is the plan document JSON and nothing else: no sentence before or after it, and no code fence.
