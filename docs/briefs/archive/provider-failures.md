Write the phax spec "Provider failures". When an agent session fails, phax says why, in the terminal and in its files, and never misreads the failure. This spec comes before "Structured output", which builds on the same result reader.

**Why.** On 2026-10-27 in steme-lab, a DNS outage killed `phax artifact decide --verdicts`'s writer session after about 6 minutes and $6.33. What phax printed:
- **`✗ claude exited with code 1`,** pointing at `agent-error.log`, which holds only the argv, the exit code and stderr.
- **The real cause sat in `output.jsonl`:** Claude Code's synthetic `API Error: Can't reach the API server — check your internet or DNS (ENOTFOUND)`, after 10 `api_retry` events.
- **Before that line, a refusal that looked like the cause.** Writing the failed session's decision record ran `gh repo view`, which failed on the same outage. phax then printed "this repo's visibility could not be determined", with the remedy `acknowledgedUnknownVisibility`. The reader took that refusal for the cause.

An inventory of every agent call (2026-10-27) found more of the same kind:
1. **Error results are missed.** `src/schemas/claudeOutput.ts` requires a `result` string, but Claude Code's error results (`is_error: true`, subtypes like `error_during_execution`, `error_max_turns`, `error_max_structured_output_retries`) have none. Their session id and their reason are lost.
2. **Rate limits are detected falsely.** The check scans the whole transcript, tool output included. A phase whose transcript mentions "429" and then crashes is read as a rate limit, exit 8.
3. **A provider error during the handoff turn becomes `HandoffMissing`,** with no sections and no reason.
4. **The dispatcher drops the log hint** when no session id is found.
5. **Codex `complete()` returns empty text without a word** when no message is found.
6. **Fix-loop telemetry names `claude`** whatever the provider.
7. **The adapters report only "exited with code N" plus stderr.** The hint names `agent-error.log`, not the transcript that holds the cause.

**Settled (do not reopen):**
1. **One reader of a session's outcome per provider** (Claude Code, Codex, Mistral Vibe). It returns a typed outcome:
   - the answer;
   - or a failure with its kind: network, rate or usage limit, provider error, max turns, killed or timed out, unknown;
   - the provider's own message, and the session id when there is one.

   It reads the provider's final result event first, then the transcript's last error event, then stderr, and never scans tool output.
2. **A network failure is transient,** like a usage limit: its own exit code, a message that names the provider's error, and a retry hint. Choose the code in the spec: exit 8 shared with limits, or a new one.
3. **The terminal shows the cause before any secondary refusal.** A record refusal that follows a failed session says it follows that failure.
4. **An `unknown` repository visibility says why `gh` failed** (its first stderr line). When the failure is transient (network, auth), it suggests a retry, not `acknowledgedUnknownVisibility`.
5. **`agent-error.log` holds the cause.** It records the provider's message and the failure kind, and it names the transcript.
6. **Vibe 3.0.3** (the operator upgraded on 2026-10-27). Use `--output-dir` (`export.json`: stop reason, outcome, usage, cost) as Vibe's outcome source if it is reliable; otherwise its transcript. Do not change anything else in the Vibe adapter: the operator is reviewing Vibe V3 separately.
7. **No back-compat shims, no optional fields in persisted shapes.** If a record or status format gains a failure kind, it is required, with `$schema` at 0.29.0.

**What exists (read it first):**
- `src/infra/providers/`: the Claude Code, Codex and Mistral Vibe adapters, and the dispatcher.
- `src/schemas/claudeOutput.ts`, and the rate-limit detection.
- `src/app/handoffGeneration.ts`, `src/app/fixLoop.ts`, `src/app/authorArtifact.ts`, `src/app/decideArtifact.ts`, `src/app/decideVerdicts.ts`, `src/app/interactiveStop.ts`, `src/app/closeStop.ts` and `src/app/reviewCompliance.ts`: every caller that reports a session failure.
- `src/infra/github.ts`: `visibility`, which swallows `gh`'s error.
- `src/app/recordPlumbing.ts`: the records destination check.
- The `decide` folder layout (`agent-error.log`, `output.jsonl`), and the run folder's per-phase logs.

**Out of scope:**
- provider-native structured output (the next spec, "Structured output");
- making the compliance review or the handoff a structured answer;
- the rest of the Vibe V3 review.

**Leave §9 to at most two questions,** each framed by what it abandons. The exit code of a network failure is the obvious candidate.

**Surfaces.** A surface's `summary`, `before` and `after` are read by users in the release notes: a capitalized sentence and short real examples, using the steme-lab case made up as a project of your own, with no implementation notes.

**Output:** your final message is the spec document JSON and nothing else: no sentence before or after it, and no code fence.
