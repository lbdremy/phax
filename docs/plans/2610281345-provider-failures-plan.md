---
status: Draft
source-spec: docs/specs/2610271510-provider-failures.md
completes-spec: true
---
# Provider failures

Implements the whole of the provider-failures spec (§5.1 to §5.19, every §6 surface, every acceptance criterion). Each provider (Claude Code, Codex, Mistral Vibe) gets one pure session-outcome reader that turns an ended session into an answer or a failure. A failure carries a failure kind, the provider's own message and the session id when the provider reported one. The reader reads the provider's final result event first, then the transcript's last error event, then stderr, and never reads tool output or model text. Every adapter goes through these readers. The work runs in this order: an oracle pair freezes the reader's table of transcripts and kinds (phase-01, phase-02); the adapters raise typed session failures, write agent-error.log with the cause first, and map a network failure to exit 14 (phase-03); every command prints the cause, the files and a retry hint (phase-04); a run pauses on a network failure, a failed handoff turn is reported as itself, and fix-loop telemetry names its provider (phase-05); a stop's closing turn records a `network` close at review-stop 0.30.0 (phase-06); a failed decision record carries a required `failure` at 0.30.0 (phase-07); and an unknown visibility quotes gh, the cause prints before any secondary refusal, and the troubleshooting page lands (phase-08). Build on vibe-3 (#170): Vibe 3.0.3 writes an export.json on every exit, decoded by src/schemas/vibeExport.ts, whose outcome is reliable on 3.0.3. Only the outcome reading of the Vibe adapter changes. The decision-record-manifest `next` snapshot at 0.30.0 and its frozen 0.28.0 module already exist; review-stop moves from 0.26.0 to 0.30.0 here. Tests never read ~/.phax, a real ~/.claude, ~/.codex or ~/.vibe, the global git config or the real gh: they use tests/helpers/isolateGit.ts, temporary directories, makeFakeGitHub(), the fake backend, tests/helpers/fakeProviderCli.ts, and the fake `vibe` of tests/helpers/vibe3Fixtures.ts.

## Required commands

- (none)

No new command. The configured `standard` gate verifies every phase. `pnpm exec tsx scripts/schemas-check.ts --write` (phases 06 and 07) is covered by the existing `pnpm exec tsx` allowance. No phase changes a command's help text, so `pnpm gen:usage-spec` and `pnpm docs:cli` are not needed (exit codes appear in no help text). Run them only if a phase ends up changing help.

## Technical arbitrations

- Where the reader lives and what it returns: pure readers in src/domain/session/ (entry src/domain/session/outcome.ts, one module per provider), decoders in src/schemas/ (claudeOutput.ts, codexOutput.ts, vibeExport.ts), and the adapters in src/infra/providers/ spawn, read export.json and hand the lines, stderr, the end (exit code, signal or timeout) and the export read to the reader. It returns `SessionOutcome` = `{ kind: answer, provider, text, sessionId }` | `{ kind: failure, failure: { provider, kind, message, sessionId, resetAt } }`; the answer holds only `text`, so the Structured output spec can add a structured answer beside it. Loss accepted: no single place both reads and judges a session. The Vibe adapter still opens export.json itself, so an absent or unreadable export reaches the reader as a tagged input, not as the I/O error it was.
- The error a failed session raises: a new tagged `AgentSessionFailedError` (carrying the `SessionFailure`, the agent-error.log path or null, the transcript path or null, and the paused phase id when a run sets one) for kinds network, provider-error, max-turns, killed and unknown. Limits keep `RateLimitError` / `UsageLimitError`, so RateLimitDetected, `rate_limited` and exit 8 stay as they are. They are built from the same failure, with `message` the failure line and `rawMessage` the provider message. Loss accepted: two error families describe one outcome, so a caller that handles any failed session matches three tags, not one.
- How a network failure is recognized: by the provider's verdict alone, matched against one shared table of connection signatures (ENOTFOUND, EAI_AGAIN, ECONNREFUSED, ECONNRESET, ETIMEDOUT, `Can't reach the API server`, `Connection error`, `error sending request`, `stream disconnected`, `dns error`, `failed to lookup address`, `nodename nor servname`, `Network is unreachable`, `getaddrinfo`). Claude Code: the `is_error` result event's `result` text (the synthetic `API Error: …`), else the last `system`/`api_retry` event's error, else stderr; the number of retries is not needed. Codex: the `turn.failed` error message, else the last `error` event, else stderr. Vibe: an export outcome other than `finished`, classified from the export's error code and message, else stderr. Loss accepted: an outage worded outside the table reads as provider-error (exit 5, not resumable) until the table learns that wording.
- How a run records a paused network failure: a new event `NetworkFailureDetected` beside `RateLimitDetected`, with the same dispositions and the same target states (run and phase `rate_limited`, the resume path a limit already proves). It persists `stoppedReason: network_failure` and `lastError` (the failure line), and writes resume instructions naming `phax resume <run>`. Loss accepted: run-status.json and `phax status` show the state `rate_limited` for an outage; only `stoppedReason` and `lastError` tell it from a limit. That is the price of the spec's non-goal: no failure kind and no new run state in run-status.json.
- A failed handoff turn: a new event `HandoffTurnFailed` takes the transitions `HandoffMissing` takes, with `missing: []`, and also persists `lastError` (the failure line) and `stoppedReason: handoff_turn_failed`, so resume re-runs only the handoff. No HandoffMissing is dispatched for it. The pause re-raises an error carrying the session failure, so the CLI prints it and exits with its code. A limit in the handoff turn keeps its own path, and so does a spawn failure (`AgentInvocationError`). Loss accepted: the phase still reads `handoff_failed`, with no missing section, after a turn that failed rather than a handoff that was incomplete.
- How the CLI orders the cause and a secondary refusal. `run`, `resume` and the review commands write no record after a failed session, so they print only the cause lines. The use cases that do write one (decide in both modes, headless authoring) no longer print the record's warnings themselves. When there is one, they raise a `FailureWithFollowUpsError { cause, followUps }`; the CLI prints the cause's lines first and each follow-up after it. A follow-up reads `<kind> record refused, following the failed session: …`. `exitCodeForError` and `exitCodeForAuthoringError` unwrap the cause. Loss accepted: the same failure reaches the CLI in two shapes, depending on whether the records step had anything to say.
- Vibe refusals added by #170. Refusals before a session spawns are phax refusals, not session outcomes: the version floor, a user `accept-edits` profile, Vibe config under an extra root, and a missing transcript path. They keep their errors (`AgentInvocationError`, `SecurityEnforcementError`), their messages and today's agent-error.log (argv, then the message). A missing answer, a missing or invalid export, and an invalid export session id are `provider-error` failures carrying today's messages: the provider broke its own output contract. A config mismatch after the turn stays a phax refusal of a turn that ran (`AgentInvocationError`, exit 5, message kept). Loss accepted: agent-error.log has two shapes; a refusal's log has no `failure:` header, so a reader tells a refusal from a failure by its first line.
- A failed decision record's `failure`. A session failure gives its kind; a refused answer (`DecideDocumentError`) gives `answer-refused`; the artifact changing during the session gives `artifact-changed`; a failed write or commit of the decided artifact gives `commit-failed`. Any other error after the writer started (a spawn failure, a Vibe refusal) gives `unknown`. The literals live in src/schemas/decisionRecord.ts, so the schemas package closure gains no domain module, and a type test keeps them equal to the reader's kinds plus the three. In memory, a failed record read from a stamp below 0.30.0 carries `failure: null`; the 0.30.0 file schema requires a value, so the writer cannot write null. Loss accepted: `unknown` also covers phax's own refusals, so the records branch cannot tell a refused spawn from a silent provider.
- An interactive stop's first turn (interactive-session.json) lost to a network failure keeps its existing `provider-error` reason, with the failure line as its detail. No new reason is added: the spec adds failure kinds to no persisted shape other than the decision record and review-stop. Loss accepted: an outage at a first turn reads as a provider error in interactive-session.json.
- run-list embeds the review-stop document as `stop`, so it moves to 0.30.0 with review-stop (a `next` snapshot and a frozen 0.26.0 module that embeds the frozen review-stop 0.26.0). Loss accepted: readers of `phax ls --json` learn a new stamp for a change that is only review-stop's.
- The visibility port: `GitHub.visibility()` returns a reading `{ visibility, ghError }`, where `ghError` is gh's first non-empty stderr line (or the spawn error) when the query failed, else null. The network, auth or other class is a pure domain function, and the refusal's message and remedy are built in src/domain/records/destination.ts. Loss accepted: the init wizard and `configureRecords` adapt to the reading although they ignore its reason.
- Codex: an agent turn with no answer message also fails (`provider-error`, no answer was found), not only a completion. Loss accepted: a Codex phase turn that did its work but ended without a final message, accepted today with empty text, now fails with exit 5.
- Vibe outcomes beyond the three observed on 2026-10-28 (finished; config_error with invalid_api_key; infrastructure_failure on an API 400) are classified by rule: any outcome other than `finished` is a failure, its kind read from its error text. Vibe's installed source could not be read from the authoring session, so phase-02 reads it when its sandbox allows and adds the outcome and error-code names it finds (a turn limit, network codes). Loss accepted: until a name is known, a Vibe turn-limit stop reads as provider-error rather than max-turns.
- Reading a session's end needs its signal. spawnClaude, spawnCodex and spawnVibe report the signal or timeout that ended the process, alongside the exit code. In the Vibe adapter this counts as reading its session outcome. Loss accepted: none beyond a touch of the Vibe spawn's close handler.

---

## phase-01 — Session outcome contract and its oracles {#phase-01-outcome-oracles}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium
**Assignment reason:** The phase designs the session outcome contract and its fixture table across three providers, a shape no code in the repository holds yet.
**Oracle phase:** discharged by phase-02
**Oracle files:** `tests/unit/session/outcome.test.ts`

Fix the contract every provider's session is read through: the session outcome, the failure kinds and the three reader entries. Freeze the table of transcripts and the outcome each must read as, as oracles the next phase discharges.

### Detailed instructions

- Create `src/domain/session/outcome.ts`, pure: no I/O and no `node:` import. Its only import is the `ProviderId` type from `src/domain/routing/types.ts`. Export exactly: `FailureKind` = `network` | `rate-limit` | `usage-limit` | `provider-error` | `max-turns` | `killed` | `unknown`; `FAILURE_KINDS`, those literals in that order; `SessionFailure` { provider: ProviderId; kind: FailureKind; message: string; sessionId: string | null; resetAt: string | null }; `SessionOutcome` = { kind: `answer`; provider; text: string; sessionId: string | null } | { kind: `failure`; failure: SessionFailure }; `SessionEnd` = { kind: `exited`; code: number } | { kind: `signalled`; signal: string } | { kind: `timed-out` }; `EndedSession` { lines: readonly string[] (stdout, one JSON line each); stderr: string; end: SessionEnd }; `VibeExportRead` = { kind: `not-requested` } | { kind: `absent`; path } | { kind: `unreadable`; path; detail } | { kind: `text`; path; text }.
- In the same file, export the functions `isTransientFailure(kind: FailureKind): boolean`, `readClaudeOutcome(ended: EndedSession): SessionOutcome`, `readCodexOutcome(ended: EndedSession): SessionOutcome` and `readVibeOutcome(ended: EndedSession, exported: VibeExportRead): SessionOutcome`. Each body throws `new Error("not implemented: <function name>")`, with its parameters prefixed `_` for the linter. These stubs are what the oracles compile and load against.
- Document the contract in a module comment, which the next phase implements. Reading order: (1) the provider's final result event decides: a Claude `result` event, a Codex `turn.failed` or `turn.completed`, or a Vibe export with an outcome; (2) with none, a process that ended on a signal or a timeout is `killed`; (3) otherwise the transcript's last error event (a Claude `system`/`api_retry` error, a Codex `error` event); (4) otherwise stderr's first non-empty lines, at most three, joined by a space; (5) otherwise `unknown`, with no session id unless an init or thread event gave one. Tool output (Claude `user` tool_result content, Codex `command_execution` output) and model text (assistant messages) are never read to classify or to word a failure. The provider message is the deciding source's own text. The kind is read from that text: usage-limit signatures before rate-limit, then network signatures; otherwise `provider-error`, or `max-turns` for a turn-limit verdict. The session id comes from the result event, else from the Claude `system`/`init` event, the Codex `thread.started` event or the Vibe export.
- Create `tests/unit/session/outcome.test.ts`. Every test carries the `it.fails` marker, has a distinct title and imports only from `src/domain/session/outcome.ts`. Its fixtures are written by hand in the file, as objects passed to `JSON.stringify`, with no generator and no helper module outside the file. Session ids are valid UUIDs. Assert with `toEqual` on the kind, provider, session id and resetAt, and with `toBe` or `toContain` on messages, exactly as each case below states.
- Claude Code cases: (a) init, assistant text, a result with subtype `success`, `is_error: false`, `result: PONG`, exit 0 → answer `PONG` with the result's session id; (b) init, then a result with subtype `error_during_execution`, `is_error: true`, no `result` key and a session id, exit 1 → `provider-error`, message contains `error_during_execution`, session id the result's; (c) a result with subtype `error_max_turns`, `is_error: true`, no `result`, exit 1 → `max-turns` with that session id; (d) the DNS outage: init, ten `{type: system, subtype: api_retry, attempt, max_retries: 10, retry_delay_ms, error_status: null, error: Connection error., session_id}` events, a synthetic assistant message (model `<synthetic>`) holding the API Error text, then a result with `is_error: true` and `result: API Error: Can't reach the API server — check your internet or DNS (ENOTFOUND)`, exit 1 → `network`, message exactly that text, session id the result's; (e) a `user` tool_result whose content is `HTTP/1.1 429 Too Many Requests`, an assistant text saying `I hit a rate limit`, then the `error_during_execution` result, exit 1 → `provider-error`, not a limit; (f) a result with `is_error: true` and `result: Claude AI usage limit reached|1793120400`, stderr `Error: something else broke`, exit 1 → `usage-limit`, message the result's text, resetAt `new Date(1793120400 * 1000).toISOString()`; (g) a result with `is_error: true` and `result: API Error: 429 {"type":"error","error":{"type":"rate_limit_error"}}` → `rate-limit`; (h) no line, empty stderr, end signalled `SIGTERM` → `killed`, message contains `SIGTERM`, session id null; (i) no line, empty stderr, exit 1 → `unknown`, session id null; (j) init only, stderr `Error: connect ECONNREFUSED 127.0.0.1:443`, exit 1 → `network` from stderr, session id the init's; (k) a result with `is_error: true` and `result: API Error: 500 Internal server error`, exit 0 → `provider-error` (an error result is a failure whatever the exit code).
- Codex cases: (l) `thread.started`, an `item.completed` agent_message `DONE`, `turn.completed`, exit 0 → answer `DONE` with the thread id; (m) `thread.started`, then `turn.failed` with `error.message: stream disconnected before completion: error sending request for url (https://api.openai.com/v1/responses)`, exit 1 → `network`, message exactly that; (n) an `error` event with `message: You've hit your usage limit. Try again later.`, exit 1 → `usage-limit`; (o) `thread.started`, `turn.completed`, no agent_message, exit 0 → `provider-error`, message contains `no answer`; (p) `turn.failed` with `error.message: unexpected status 400 Bad Request: model not supported` → `provider-error`, message exactly that; (q) an `item.completed` command_execution whose `aggregated_output` is `HTTP/1.1 429 Too Many Requests`, then `turn.failed` with `error.message: tool crashed` → `provider-error`, not a limit.
- Vibe cases (stream entries as tests/helpers/vibe3Fixtures.ts shows them, written by hand here): (r) export `{schema_version: 1, session_id, usage, cost_usd, outcome: finished, exit_code: 0, vibe_version: 3.0.3}` and a stream whose last assistant message has text `PONG`, exit 0 → answer `PONG` with the export's session id; (s) export outcome `config_error` with `error: {code: invalid_api_key}`, exit 1 → `provider-error`, message contains `invalid_api_key`, session id the export's; (t) export outcome `infrastructure_failure`, exit 2, stderr `Error: API error 400: reasoning_effort low is not supported` → `provider-error`, message contains `reasoning_effort low is not supported`; (u) export outcome `infrastructure_failure`, stderr `httpx.ConnectError: [Errno 8] nodename nor servname provided, or not known` → `network`; (v) `not-requested` (a completion), stderr `Error: 429 rate limited`, exit 1 → `rate-limit`; (w) `absent` export at a path, exit 0 → `provider-error`, message contains that path.
- Add one table test that `isTransientFailure` is true exactly for `network`, `rate-limit` and `usage-limit` over `FAILURE_KINDS`.
- Run the configured gate: every oracle passes while it is marked, because its stub throws.

### Planned files to create

- `src/domain/session/outcome.ts`
- `tests/unit/session/outcome.test.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- (none)

### Boundary contracts

Producer: src/domain/session/outcome.ts (domain). Consumers: the provider adapters in src/infra/providers/ (phase-03), which need one total function per provider that takes an ended session (stdout lines, stderr, how the process ended, and for Vibe what reading export.json gave) and returns an answer or a failure. The stable shape is `SessionOutcome` and `SessionFailure`. The reader does no I/O; the adapter owns spawning and reading files.

### Test strategy

- a Claude Code error result of subtype error_during_execution reads as one provider-error failure naming the subtype, with the result's session id — small · table · the expected outcome in the case table · oracle · ac-reader-claude
- a Claude Code error_max_turns result with no result text reads as max-turns and keeps its session id — small · table · the expected outcome in the case table · oracle · ac-max-turns
- Codex and Vibe sessions ending in a provider error read as failures carrying the provider's own error text — small · table · the expected kind and message in the case table · oracle · ac-reader-codex-vibe
- a final result event's usage limit wins over a different error on stderr, kind and message alike — small · example · usage-limit with the result event's text · oracle · ac-precedence
- a session ended by SIGTERM reads as killed and a silent exit 1 as unknown with no session id, neither as a limit — small · table · the expected outcome in the case table · oracle · ac-killed-unknown
- a 429 in tool output or model text never reads as a limit, for Claude Code and Codex — small · table · provider-error for both cases · oracle · ac-no-false-429
- the DNS outage transcript, ten api_retry events then the synthetic API Error result, reads as network with that exact message — small · example · network with the result's text and session id · oracle · ac-network-decide
- a Codex session with no answer message reads as provider-error saying no answer was found — small · example · provider-error whose message contains no answer · oracle · ac-codex-empty
- the transient kinds are exactly network, rate-limit and usage-limit — small · table · the spec's list of transient failures · oracle
- a successful session of each provider reads as an answer with its text and session id — small · table · the expected answer in the case table · oracle

### Implementation order

1. Write the types and stub functions in src/domain/session/outcome.ts with the contract comment.
2. Write the case table in tests/unit/session/outcome.test.ts, every test marked it.fails.
3. Run the gate and confirm every oracle fails on its stub and passes as marked.

### Excluded scope

- Any reader implementation, schema decoder or signature table (phase-02).
- Any change to an adapter, an error class or a caller (phase-03 onward).

### Verification

The `standard` gate profile in phax.json, whose oracle step the configured oracles provider judges (`authored` verdict on tests/unit/session/outcome.test.ts).

### Expected handoff content

The exact exports of `src/domain/session/outcome.ts` and their signatures. The case list of `tests/unit/session/outcome.test.ts` with each expected kind, plus any case added beyond the plan and why. Any fixture shape that departs from the instructions (for example the api_retry event's fields). Any deviation from the planned file lists, with the reason.

### Commit subject

`test(session): oracles for the session outcome readers`

### Commit body

Fix the session outcome contract (failure kinds, SessionFailure, SessionOutcome, the ended-session input and the three reader entries) in src/domain/session/outcome.ts, with stub readers that throw. Freeze the table of provider transcripts and the outcome each must read as, as expected-failure oracles: Claude Code error results, the DNS outage, limits read only from the provider's verdict, killed and silent sessions, Codex and Vibe failures, and the empty Codex answer.

---

## phase-02 — Session outcome readers {#phase-02-outcome-readers}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** high
**Assignment reason:** Three providers' event shapes and a reading precedence must be implemented against frozen oracles that the phase cannot adjust.

Implement the three readers behind the contract, so every provider session reads into exactly one outcome by the provider's own verdict, and discharge the oracles.

### Detailed instructions

- Remove every `it.fails` marker from `tests/unit/session/outcome.test.ts`, turning each into `it`. Change nothing else in that file: removing the markers is this phase's only change to it.
- Decoders in src/schemas. In `src/schemas/claudeOutput.ts`, add decoders for a Claude stream result event whose `result` is optional, with `subtype`, `is_error`, `session_id` and an optional `errors` string array; for the `system`/`init` event (its `session_id`); and for the `system`/`api_retry` event (an `error` that is a string or an object with a string `message`). Unknown keys are dropped. Reuse what `src/schemas/claudeStream.ts` already decodes where it fits. Keep the existing exports (`findResultEvent`, `hasErroredResultEvent`, `classifyRateLimit`, `normalizeResetAt`): the adapters still use them until phase-03 removes them. In `src/schemas/codexOutput.ts`, add decoders for `turn.completed`, `turn.failed` (`error.message`) and `error` (`message`) events. In `src/schemas/vibeExport.ts`, decode an optional `error` (`null`, or an object with an optional string `code` and an optional string `message`, other keys accepted). Every export that decodes today must still decode.
- Create `src/domain/session/signatures.ts`: the shared, case-insensitive network signature table listed in the plan's Technical arbitrations; the usage-limit signatures (usage limit, monthly limit, quota exceeded or reached), checked before the rate-limit ones (rate limit, rate-limited, too many requests, a standalone 429, rate_limit_error); and the reset-time extraction. Copy the reset patterns and the epoch and ISO normalization from `src/schemas/claudeOutput.ts`, so resetAt is an ISO instant or null. One `classifyVerdictText(text)` returns `network`, `rate-limit`, `usage-limit` or null. It is only ever applied to a provider verdict.
- Create `src/domain/session/claudeOutcome.ts`. The last decodable result event decides. `is_error: false` with a `result` string is an answer. `is_error: true` with result text is classified by that text; with no match it is `provider-error` with that text, or `max-turns` when its subtype is `error_max_turns`. `is_error: true` without result text is `max-turns` for `error_max_turns`, else `provider-error` whose message is the subtype, followed by `: ` and the first `errors` entry when there is one. An error result fails whatever the exit code. With no result event, apply the reading order of the module comment in outcome.ts (killed, last api_retry error, stderr, unknown), and take the session id from the init event.
- Create `src/domain/session/codexOutcome.ts`. The session id comes from `thread.started`. A `turn.failed` decides (its message classified, else `provider-error`). Then `turn.completed` with the last agent_message text is an answer; `turn.completed` with no agent_message is `provider-error` with the message `codex ended its turn with no answer message: no answer was found`. With neither, apply killed, then the last `error` event's message, then stderr, then unknown. `command_execution` items and every item other than agent_message are never read.
- Create `src/domain/session/vibeOutcome.ts`. With a decodable export: outcome `finished` is an answer whose text is the last assistant text of the stream (reuse `findVibeResultEvent` from `src/schemas/vibeOutput.ts`) and whose session id is the export's; a finished export with no assistant text is `provider-error` with the adapter's wording today (the stream holds no assistant message with a text block, so there is no answer to read). Any other outcome is a failure. Its message is the export's `error.message` when it has one, else stderr's first non-empty lines, else the outcome name, with ` (<error.code>)` appended when a code is present. Its kind is classified from that message and the code, else `max-turns` for an outcome Vibe's source shows to be a turn limit, else `provider-error`. With `absent`, `unreadable` or an export that does not decode: at exit 0, `provider-error` with the adapter's three messages today (`vibe wrote no export.json (missing Vibe export at <path>)`, `could not read the Vibe export at <path>: <detail>`, `invalid Vibe export at <path> (<reason>): <detail>`); at a non-zero exit, killed, then stderr, then unknown. With `not-requested` (a completion), the stream's last assistant text answers at exit 0; otherwise killed, then stderr, then unknown.
- Make `src/domain/session/outcome.ts` delegate its three readers and `isTransientFailure` to these modules, keeping every exported name and signature exactly as phase-01 fixed them. The stubs go.
- If the phase can read it, read Vibe's installed source under `~/.local/share/uv/tools/mistral-vibe/lib/python3.14/site-packages/vibe` (never `~/.vibe`) for the export's outcome values and `error.code` values, network ones above all. Add the names it shows to the Vibe classification: network codes to the network check, and a turn-limit outcome to `max-turns`. Tests never read it. If it cannot be read, keep the rule-based classification and say so in the handoff.
- Extend `tests/unit/claudeOutput.test.ts` and `tests/unit/vibeExport.test.ts` for the new decoders, and create `tests/unit/session/signatures.test.ts` for the signature tables and the reset-time extraction.

### Planned files to create

- `src/domain/session/claudeOutcome.ts`
- `src/domain/session/codexOutcome.ts`
- `src/domain/session/vibeOutcome.ts`
- `src/domain/session/signatures.ts`
- `tests/unit/session/signatures.test.ts`

### Planned files to edit

- `src/domain/session/outcome.ts`
- `tests/unit/session/outcome.test.ts`
- `src/schemas/claudeOutput.ts`
- `src/schemas/codexOutput.ts`
- `src/schemas/vibeExport.ts`
- `tests/unit/claudeOutput.test.ts`
- `tests/unit/vibeExport.test.ts`

### Optional files that may be edited

- `src/schemas/claudeStream.ts`
- `src/schemas/vibeOutput.ts`
- `src/domain/session/index.ts`

### Boundary contracts

Schemas → domain: the readers decode stream lines and export text only through the decoders in src/schemas (claudeOutput, codexOutput, vibeExport, vibeOutput), never with ad hoc JSON property reads. Domain → infra (consumed in phase-03): the reader entries in src/domain/session/outcome.ts, unchanged from phase-01.

### Test strategy

- the stream decoders read result, init, api_retry, turn.completed, turn.failed and error events, and skip every other line — small · example · the decoded event, or a skip · in-phase
- the Vibe export decoder reads an error code and message and still accepts every export it accepted before — small · example · the decoded export · in-phase
- no line a provider prints, malformed or not, makes a reader throw — small · example · an outcome returned for each malformed input · in-phase
- a usage-limit verdict's reset time becomes an ISO instant, and a verdict with none gives null — small · example · the expected ISO instant or null · in-phase
- the network and limit signatures match the wordings the plan lists and nothing in ordinary prose — small · table · the expected class per sample text · in-phase

### Implementation order

1. Remove the oracle markers.
2. Add the decoders in src/schemas and their tests.
3. Write signatures.ts and its tests.
4. Write the Claude, Codex and Vibe readers, and delegate from outcome.ts.
5. Run the gate until every discharged oracle passes.

### Excluded scope

- Any adapter change: the adapters keep their behaviour until phase-03.
- Removing classifyRateLimit, findResultEvent, hasErroredResultEvent or the Codex result helpers (phase-03).
- Any change to an oracle beyond removing its markers.

### Verification

The `standard` gate profile in phax.json, whose oracle step the configured oracles provider judges (`discharged` verdict on tests/unit/session/outcome.test.ts).

### Expected handoff content

The modules and functions behind each reader, and the exact signature tables. The Vibe outcome and error-code names read from Vibe's source, or a note that it could not be read. Any decoder that departs from the instructions (for example how the api_retry error is decoded). Which old helpers in src/schemas/claudeOutput.ts and codexOutput.ts phase-03 can now delete. Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(session): read each provider's session outcome`

### Commit body

Implement the Claude Code, Codex and Mistral Vibe session readers behind src/domain/session/outcome.ts. Each turns an ended session into an answer, or a failure with its kind, the provider's own message and the session id it reported. The reading order is the final result event, then the signal or timeout, then the last error event, then stderr; tool output and model text are never read. Network and limit verdicts share one signature table. New decoders cover Claude error results with no result text, api_retry and init events, Codex turn and error events, and the Vibe export's error. Discharges the outcome oracles.

---

## phase-03 — Adapters fail sessions through the readers {#phase-03-adapters-read-outcomes}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium
**Assignment reason:** A new error family is threaded through the backend port, three provider adapters, the fake backend and every caller's declared error union, a change that crosses several parts of the architecture.

Every provider adapter reads its ended session through the outcome readers and raises a typed session failure. agent-error.log opens with the cause, the dispatcher no longer drops the log hint, and a network failure exits 14.

### Detailed instructions

- In `src/domain/errors.ts`, add `AgentSessionFailedError` (tag `AgentSessionFailedError`) with `message` (the failure line `<provider> session failed (<kind>): <provider message>`), `failure: SessionFailure`, `agentErrorLog: string | null`, `transcript: string | null` and `phaseId?: string | undefined` (set by a run, as the limit errors carry it).
- Create `src/domain/session/failureError.ts` with `sessionFailureError(failure, files: { agentErrorLog: string | null; transcript: string | null })`. It returns a `UsageLimitError` or `RateLimitError` for the limit kinds (message the failure line, `rawMessage` the provider message, `resetAt` the failure's, or undefined when null), else an `AgentSessionFailedError`. The adapters and the fake backend both use it.
- Adapters. In `src/infra/providers/claudeCode.ts`, `codexCli.ts` and `mistralVibe.ts`, make each spawn report how the process ended (exit code, signal, or the probe's timeout) as a `SessionEnd`. Replace the exit-code check, the limit scan and the result lookup of runAgent/resume and complete with one reader call. An answer returns as today, `finalText` being the answer's `text`: an agent turn needs a session id (a missing one is a `provider-error` failure saying no session id was reported), a completion does not. A failure raises `sessionFailureError`, with `agentErrorLog` = `<phaseFolderPath>/agent-error.log` when a folder is given, else null, and `transcript` = `outputJsonlPath`, else null. `persistSessionId` stays on the answer path only. The Claude probe is unchanged.
- Vibe adapter: change only its outcome reading. Read export.json into a `VibeExportRead` (`absent` on ENOENT, `unreadable` on another read error, `text` otherwise) and pass it to the reader; completions pass `not-requested` and gain no `--output-dir`. Keep the version floor, the confinement refusals, the missing-transcript-path refusal and the config-mismatch refusal exactly as they are, with their messages, their errors and their agent-error.log, as the Technical arbitrations say. Run the config-mismatch check after an answer, as today.
- `src/infra/providers/agentErrorLog.ts`: `writeAgentErrorLog(folder, ctx)` takes `failure: SessionFailure | null` and `transcript: string | null` beside argv, exit code and stderr. With a failure, the file opens with `failure: <kind>`, `provider: <provider>`, `message: <provider message on one line>`, `session: <id or none>`, `transcript: <path or none>`, then a blank line, then today's argv, `exit code:` line, blank line and stderr. Without one (a phax refusal), it keeps today's shape. Every adapter writes it for every failed session that has a folder.
- `src/ports/backend.ts`: add `AgentSessionFailedError` to the error unions of runAgent, resumeAgentSession and complete, and drop `AgentSessionIdMissingError` from resumeAgentSession (the adapters no longer raise it; executePlan keeps the class for a resume with no recorded session). `src/infra/providers/dispatcher.ts`: remove the `AgentSessionIdMissingError` → `AgentInvocationError` mapping, so a failure keeps its log and transcript.
- `src/infra/fakes/backend.ts`: add `failRunWith(runIndex, failure, files?)`, `failNextResumeWith(failure, files?)`, `failResumeWith(resumeIndex, failure, files?)` and `failCompleteWith(completeIndex, failure, files?)`, which raise `sessionFailureError` for the failure. Keep the existing limit knobs, and make their errors' messages follow the failure-line format.
- Delete `classifyRateLimit`, `findResultEvent`, `hasErroredResultEvent` and the reset helpers from `src/schemas/claudeOutput.ts`, and `findCodexResultEvent` and `hasCodexErroredResultEvent` from `src/schemas/codexOutput.ts`, once nothing uses them. Move or drop their tests in `tests/unit/claudeOutput.test.ts` and `tests/unit/providers/codexCli.test.ts`.
- Add `AgentSessionFailedError` to every explicit error union that lists the limit errors, so each caller type-checks: `src/app/eventAdapter.ts`, `executePlan.ts`, `handoffGeneration.ts`, `fixLoop.ts`, `authorArtifact.ts`, `decideArtifact.ts`, `decideVerdicts.ts` and `extractPlan.ts`. Do not change their behaviour in this phase. A session failure propagates like any other error until phases 04 to 08 handle it.
- `src/cli/commands/runLayers.ts`: `exitCodeForError` returns 14 for an `AgentSessionFailedError` of kind `network` and 5 for every other kind. Add `{ code: 14, meaning: "Provider unreachable: network failure (resumable)" }` to `EXIT_CODE_MEANINGS`, add the same row to the README `## Exit codes` table (`tests/unit/readmeExitCodes.test.ts` keeps them in step), and update the comment that names the highest code.
- `docs/upgrading.md` § 0.30.0: one bullet for scripts. A command whose agent cannot reach its provider now exits 14 (resumable), not 5: treat 14 like 8 but retry as soon as the network is back.
- Tests. Extend `tests/helpers/fakeProviderCli.ts` so a script can replay a raw stream (`stream` lines), `stderr` and `exitCode`, or end on a signal. Extend `tests/helpers/vibe3Fixtures.ts` so the fake vibe can print `stderr`. Create `tests/integration/providerSessionFailures.test.ts`, which drives the real node backend with these fakes, with PATH and HOME pointed at temporary directories as fakeProviderCli's `env` gives them, and holds the contract suite over the fake backend and the real adapters. Create `tests/unit/session/failureError.test.ts` for the error mapping and the exit codes. Keep `tests/integration/rateLimit.test.ts` green.

### Planned files to create

- `src/domain/session/failureError.ts`
- `tests/integration/providerSessionFailures.test.ts`
- `tests/unit/session/failureError.test.ts`

### Planned files to edit

- `src/domain/errors.ts`
- `src/ports/backend.ts`
- `src/infra/providers/claudeCode.ts`
- `src/infra/providers/codexCli.ts`
- `src/infra/providers/mistralVibe.ts`
- `src/infra/providers/dispatcher.ts`
- `src/infra/providers/agentErrorLog.ts`
- `src/infra/fakes/backend.ts`
- `src/schemas/claudeOutput.ts`
- `src/schemas/codexOutput.ts`
- `src/app/eventAdapter.ts`
- `src/app/executePlan.ts`
- `src/app/handoffGeneration.ts`
- `src/app/fixLoop.ts`
- `src/app/authorArtifact.ts`
- `src/app/decideArtifact.ts`
- `src/app/decideVerdicts.ts`
- `src/app/extractPlan.ts`
- `src/cli/commands/runLayers.ts`
- `tests/unit/claudeOutput.test.ts`
- `tests/unit/providers/codexCli.test.ts`
- `tests/helpers/fakeProviderCli.ts`
- `tests/helpers/vibe3Fixtures.ts`
- `README.md`
- `docs/upgrading.md`

### Optional files that may be edited

- `src/domain/session/outcome.ts`
- `src/domain/session/index.ts`
- `src/app/closeStop.ts`
- `src/app/interactiveStop.ts`
- `src/app/reviewCompliance.ts`
- `src/app/reviewCode.ts`
- `src/app/telemetry/reportBuilders.ts`
- `src/schemas/vibeOutput.ts`
- `src/cli/commands/run.ts`
- `src/cli/commands/resume.ts`
- `tests/unit/providers/claudeCode.test.ts`
- `tests/unit/providers/mistralVibe.test.ts`
- `tests/integration/rateLimit.test.ts`
- `tests/integration/executePlan.test.ts`
- `tests/unit/readmeExitCodes.test.ts`

### Boundary contracts

Infra → port: the Backend port (src/ports/backend.ts) promises that a session which ended without an answer fails with `AgentSessionFailedError`, or with a limit error for the limit kinds, carrying the reader's `SessionFailure` and the paths of its agent-error.log and transcript when they exist. App → port: callers need the failure kind and the provider message, not the exit code. Domain → infra: `sessionFailureError` is the one mapping from a failure to an error, shared by the real adapters and the fake.

### Test strategy

- a fake claude replaying an error_during_execution transcript fails the session with AgentSessionFailedError of kind provider-error, the result's session id and both file paths — medium · example · the raised error's fields · in-phase · ac-reader-claude
- a failed session's agent-error.log opens with the failure, provider, message, session and transcript lines, then argv, exit code and stderr — medium · example · the expected file text · in-phase · ac-log
- an error_max_turns session's agent-error.log carries its session id on the session line — medium · example · the session line of the log · in-phase · ac-max-turns
- a session that fails before reporting a session id writes session: none and still names its log and transcript on the error — medium · example · the log line and the error's paths · in-phase · ac-pointers-no-session
- fake codex and fake vibe sessions ending in a provider error fail with the provider's own text, never with the exited-with-code message — medium · example · the raised error's message · in-phase · ac-reader-codex-vibe
- a Codex completion that exits 0 with no answer message fails, and complete never returns empty text — medium · example · a provider-error failure, no result · in-phase · ac-codex-empty
- a session ended by SIGTERM is reported as killed, not as a limit — medium · example · the raised error's kind · in-phase · ac-killed-unknown
- the fake backend and the real adapters raise the same error shape for the same failure — medium · contract · one assertion set run against both · in-phase
- a network failure exits 14, the other session failures 5 and the limits 8 — small · table · the exit code per failure kind · in-phase
- EXIT_CODE_MEANINGS and the README exit code table list the same rows, 14 included — small · example · the existing README exit code test · in-phase

### Implementation order

1. Add AgentSessionFailedError and sessionFailureError, with their unit tests.
2. Teach agent-error.log the failure header.
3. Move each adapter onto its reader, Claude first, then Codex, then Vibe; capture signals.
4. Update the port, the dispatcher and the fake backend.
5. Add the new tag to the callers' declared unions.
6. Map exit 14, add the meanings row, the README row and the upgrading bullet.
7. Extend the fake CLIs and write the integration and contract tests; delete the dead helpers.

### Excluded scope

- The terminal rendering of the cause, files and retry hint (phase-04).
- Pausing a run on a network failure, the handoff turn and fix-loop telemetry (phase-05).
- A stop's closing turn, review-stop.json and run-list (phase-06).
- The decision record's failure field (phase-07).
- Visibility, record refusal wording and ordering (phase-08).
- Any other change to the Mistral Vibe adapter, which the operator reviews separately.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

The exact fields of `AgentSessionFailedError` and the signature of `sessionFailureError` (src/domain/session/failureError.ts). The new fake backend knobs and their signatures. The agent-error.log format as written. Which Vibe refusals stayed AgentInvocationError or SecurityEnforcementError and which became provider-error failures. The callers whose unions were widened, and any caller whose behaviour changed anyway. The new fakeProviderCli and fake vibe options. Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(providers): fail sessions through the outcome readers`

### Commit body

The Claude Code, Codex and Mistral Vibe adapters now read every ended session through its outcome reader. A failure raises AgentSessionFailedError (or a limit error for the limit kinds) carrying the failure kind, the provider's message, the session id and the paths of agent-error.log and the transcript. agent-error.log opens with the failure, provider, message, session and transcript lines. The dispatcher no longer drops the log hint. A Codex completion with no answer fails instead of returning empty text, and rate limits are no longer read from tool output. A network failure exits 14, a new code listed in EXIT_CODE_MEANINGS and the README. The Vibe adapter's own refusals keep their messages.

---

## phase-04 — The terminal names the cause, its files and the retry {#phase-04-terminal-report}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

Every command whose agent session failed prints the provider, the failure kind and the provider's message, then the session, the agent-error.log and transcript, and for a network failure the command to run again.

### Detailed instructions

- Create `src/cli/commands/sessionFailureOutput.ts` with `renderSessionFailure(err, retry: string | null): readonly string[]`, for an `AgentSessionFailedError` or a limit error carrying the failure line. The lines are: `✗ <provider> session failed (<kind>): <provider message>`; `  session: <id>` when there is one; `  See <agent-error.log> and <transcript>`, naming the transcript by its file name when it sits in the log's folder and by its full path otherwise, or whichever of the two exists; and, for a network failure with a retry, `  Retry once the network is back: <retry>`. Also add `retryCommandLine(words)`, which quotes the words only where a shell needs it and prefixes `phax`.
- Each command builds its retry command from its own parsed arguments, never from process.argv: `phax artifact decide <path as given> --verdicts <file as given>` (plus the flags given), `phax artifact new …` for headless authoring, `phax run <plan>` for a failed plan extraction, `phax review-compliance <run>` and the headless code review's own command.
- `src/cli/commands/artifactDecide.ts`: `reportDecideError` renders a session failure with `renderSessionFailure`, keeps `renderAgentInvocationError` for an `AgentInvocationError`, and the command exits through `exitCodeForAuthoringError` (14 for network). `src/cli/commands/artifact.ts` does the same for headless authoring.
- `src/cli/commands/run.ts`: plan extraction and a run that fails on a non-network session failure print the failure lines (no retry hint for a non-transient kind) instead of `phax run failed: <message>`. Make the same change in `src/cli/commands/resume.ts`. A mid-run network failure is rendered by phase-05; until then it prints the same lines with the invoked command as its retry hint.
- Review commands. `src/app/reviewCompliance.ts` and `src/app/reviewCode.ts` keep their failed results' reason text and add, in memory only, `sessionFailure: SessionFailure | null`, set when the session failed. Never persist it. `src/cli/commands/reviewCompliance.ts` and `src/cli/commands/reviewCode.ts` print `renderSessionFailure` for such a failure (with their existing retry commands) and exit 14 for a network failure, keeping their current exit code for the others.
- Create `tests/unit/cli/sessionFailureOutput.test.ts` and `tests/integration/sessionFailureReport.test.ts`. The integration test drives `runArtifactDecide` in verdicts mode with `deps.backendLayer` a fake backend failing the writer with the failure the Claude reader gives for the DNS outage transcript (build it with `readClaudeOutcome` on the same hand-written lines), records off, in a temporary repository from tests/helpers/isolateGit.ts. It asserts the printed lines and exit 14. It also covers a failure with no session id.

### Planned files to create

- `src/cli/commands/sessionFailureOutput.ts`
- `tests/unit/cli/sessionFailureOutput.test.ts`
- `tests/integration/sessionFailureReport.test.ts`

### Planned files to edit

- `src/cli/commands/artifactDecide.ts`
- `src/cli/commands/artifact.ts`
- `src/cli/commands/run.ts`
- `src/cli/commands/resume.ts`
- `src/cli/commands/reviewCompliance.ts`
- `src/cli/commands/reviewCode.ts`
- `src/app/reviewCompliance.ts`
- `src/app/reviewCode.ts`

### Optional files that may be edited

- `src/cli/commands/runLayers.ts`
- `src/cli/commands/stopOutput.ts`
- `tests/unit/cli/artifact.test.ts`
- `tests/integration/reviewCodeHeadless.test.ts`
- `tests/integration/complianceReviewRecord.test.ts`
- `tests/helpers/decideVerdictsHarness.ts`

### Boundary contracts

CLI → app: a command needs, from the use case's failure, the `SessionFailure` and the paths to name. It gets them from `AgentSessionFailedError` (or a limit error), or for the review commands from the failed result's in-memory `sessionFailure`. The CLI owns the wording and the retry command; use cases never print a failure.

### Test strategy

- the DNS outage decide prints the failure line, the session, the log and transcript, and a retry naming the same decide command, then exits 14 — medium · example · the expected terminal lines and exit code · in-phase · ac-network-decide
- a failed session with no session id still names its agent-error.log and transcript in the terminal — medium · example · the expected terminal lines · in-phase · ac-pointers-no-session
- the renderer names the provider, the kind and the provider message for every failure kind, never the exit code alone — small · table · the expected first line per kind · in-phase · ac-reader-claude
- the retry command quotes only the words a shell needs quoted — small · example · the expected command line · in-phase
- review-compliance and the headless code review print the session failure and exit 14 on a network failure — medium · example · the terminal lines and exit code · in-phase

### Implementation order

1. Write sessionFailureOutput.ts and its unit tests.
2. Wire artifact decide and headless authoring.
3. Wire run and resume.
4. Carry the session failure through the review results and wire both review commands.
5. Write the decide integration test.

### Excluded scope

- The run's network pause and its `phax resume` hint (phase-05).
- Record refusal wording and the order of the cause and a refusal (phase-08).
- Any persisted shape.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

The exact line format `renderSessionFailure` prints, its signature, and `retryCommandLine`. The retry command each command builds. The in-memory `sessionFailure` field on the review results. Any command left rendering a session failure some other way, and why. Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(cli): name the failed session's cause, files and retry`

### Commit body

When an agent session fails, phax artifact decide, artifact new, run, resume, review-compliance and the headless code review now print the provider, the failure kind and the provider's own message, then the session id, the agent-error.log and the transcript to read. A network failure adds the command to run again and exits 14. The review commands carry the session failure in memory only.

---

## phase-05 — A run pauses on a network failure {#phase-05-run-network-pause}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** high
**Assignment reason:** The phase adds two events to the run state machine (reducer, disposition matrix and resume path) and wires them through executePlan and both run commands.

A run whose phase or fix turn loses the network pauses resumable and names `phax resume <run>`. A failed handoff turn is reported as that failure, not as a missing handoff. Fix-loop telemetry names the provider that ran the fix.

### Detailed instructions

- `src/domain/events.ts`: add `NetworkFailureDetected` (base fields, `cause: AgentSessionFailedError`, `worktreePath`, `sessionId`) and `HandoffTurnFailed` (base fields, `cause: AgentSessionFailedError`) to the event union.
- `src/domain/reducer.ts`: `NetworkFailureDetected` takes `RateLimitDetected`'s dispositions in every run state. On a running phase in `running` or `fixing`, it goes to run and phase `rate_limited` with PersistState `{ stoppedReason: network_failure, lastError: <failure line> }`, WriteResumeInstructions `{ reason: Network failure, kind: network_failure, phaseId, worktreePath, sessionId, rawMessage }`, and EmitTrace `network_failure.detected` and `resume.available`. `HandoffTurnFailed` takes `HandoffMissing`'s dispositions and target states with `missing: []`, and adds PersistState `{ stoppedReason: handoff_turn_failed, lastError: <failure line> }`. Add both columns to `src/domain/matrix.ts`, and widen `ResumeContext` in `src/domain/effects.ts` with `Network failure` / `network_failure`. Follow the state-machines skill: transitions only through the reducer.
- `src/app/resumeInstructions.ts`: a network-failure section that names the provider message and `phax resume <run>`, saying it can run as soon as the network is back. `src/domain/whatsNext.ts`: a `network` scenario whose rendering reads `Run <run> is paused at <phase>.` then `Retry once the network is back: phax resume <run>`.
- `src/app/executePlan.ts`: catch an `AgentSessionFailedError` of kind `network` from a phase or fix turn as limits are caught. Dispatch `NetworkFailureDetected`, then re-raise the error with `phaseId` set. Add it to `isResumablePauseError`, so no RunFailed and no duplicate record follow. At the handoff catch site, catch `AgentSessionFailedError` of any kind: dispatch `HandoffTurnFailed`, not `HandoffMissing`, record the step failure, and re-raise a pause error carrying the session failure, so the CLI prints it and exits with its code (14 for network, 5 otherwise). Keep the existing `AgentInvocationError` path.
- `src/cli/commands/run.ts` and `src/cli/commands/resume.ts`: for a paused network failure, print `renderSessionFailure(err, null)`, then the `network` whatsNext lines, then the resume-instructions pointer, and exit 14. For a paused handoff turn, print the failure lines and the resume hint. Extend `src/cli/commands/sessionFailureOutput.ts` with what these need.
- `src/app/fixLoop.ts`: name the fix turn's telemetry operation `phax.<agentOptions.provider>.agent.resume` and its error report's adapter `agentOptions.provider`, the same provider id the phase turn's telemetry uses. Report an `AgentSessionFailedError` too, widening `src/app/telemetry/reportBuilders.ts` if needed.
- Tests. Create `tests/integration/networkPause.test.ts`. (1) A run whose phase-02 runAgent fails with a network failure (fake backend knob from phase-03) exits 14, leaves the run `rate_limited` with `stoppedReason: network_failure`, prints `phax resume`, and a later `phax resume` continues the phase to review. (2) A handoff turn failing with kind network reports that failure and dispatches no HandoffMissing, read from the dispatched events. (3) Through the real node backend and the fake claude of tests/helpers/fakeProviderCli.ts, a phase session whose tool output printed `HTTP 429 Too Many Requests` and which then ends `error_during_execution` prints `claude-code session failed (provider-error)`, exits 5, and leaves the run not `rate_limited`. Extend `tests/unit/reducer.test.ts` for both events in every run state, and `tests/integration/fixLoop.test.ts` for a Codex fix turn's operation and adapter. Update `docs/state-machine.md` with the two events.

### Planned files to create

- `tests/integration/networkPause.test.ts`

### Planned files to edit

- `src/domain/events.ts`
- `src/domain/reducer.ts`
- `src/domain/matrix.ts`
- `src/domain/effects.ts`
- `src/domain/whatsNext.ts`
- `src/app/executePlan.ts`
- `src/app/resumeInstructions.ts`
- `src/app/fixLoop.ts`
- `src/cli/commands/run.ts`
- `src/cli/commands/resume.ts`
- `src/cli/commands/sessionFailureOutput.ts`
- `tests/unit/reducer.test.ts`
- `tests/integration/fixLoop.test.ts`
- `docs/state-machine.md`

### Optional files that may be edited

- `src/app/eventAdapter.ts`
- `src/app/effectRunner.ts`
- `src/app/handoffGeneration.ts`
- `src/app/telemetry/reportBuilders.ts`
- `src/app/resume.ts`
- `src/app/phaxState.ts`
- `src/domain/errors.ts`
- `src/domain/disposition.ts`
- `tests/unit/events.test.ts`
- `tests/unit/reducerAwaitingReview.test.ts`
- `tests/unit/reducerHandoffPause.test.ts`
- `tests/integration/resumeHandoff.test.ts`
- `tests/integration/rateLimit.test.ts`
- `tests/helpers/fakeProviderCli.ts`

### Boundary contracts

App → domain: executePlan reports a network-failed turn and a failed handoff turn only as events (`NetworkFailureDetected`, `HandoffTurnFailed`). The reducer alone decides the run and phase states, the persisted patch and the resume instructions. CLI → app: the run and resume commands get back the session failure with its paused phase id, and render it.

### Test strategy

- every run state gives NetworkFailureDetected and HandoffTurnFailed the disposition its matrix row states — small · table · the disposition matrix · in-phase
- a run whose phase session fails with kind network is left resumable, names phax resume and exits 14, and a later resume continues the phase — medium · example · the run state, terminal lines and exit code · in-phase · ac-network-run
- a phase whose handoff turn fails with kind network reports that failure with its message and dispatches no HandoffMissing — medium · example · the dispatched events and terminal lines · in-phase · ac-handoff
- a phase session whose tool output printed HTTP 429 and which then ends error_during_execution prints a provider-error failure, exits 5 and leaves the run not rate_limited — medium · example · the terminal line, exit code and run state · in-phase · ac-no-false-429
- a Codex fix turn with tracing on records the operation phax.codex-cli.agent.resume with adapter codex-cli — medium · example · the recorded telemetry operation and adapter · in-phase · ac-telemetry

### Implementation order

1. Add the two events, their reducer cases and matrix columns, with reducer tests.
2. Add the resume-instructions section and the network whatsNext scenario.
3. Catch the failures in executePlan: phase and fix turns, then the handoff turn.
4. Render the paused failures in run and resume.
5. Fix the fix-loop telemetry operation and adapter.
6. Write the integration tests and update docs/state-machine.md.

### Excluded scope

- A stop's closing turn (phase-06).
- Any new run or phase state, and any failure kind in run-status.json or phase status.
- Limits in the handoff turn and spawn failures, which keep their current paths.
- Automatic retry: phax names the retry, it never re-runs a session itself.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

The two new event types and their dispositions per run state. The persisted `stoppedReason` values. How executePlan re-raises a paused network failure and a failed handoff turn, and the error type the CLI receives for each. The new whatsNext scenario and resume-instructions section. The telemetry operation name format. Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(run): pause a run on a network failure`

### Commit body

A phase or fix turn that fails with kind network now pauses the run resumable (NetworkFailureDetected, rate_limited, stoppedReason network_failure). The command exits 14 and tells you to run phax resume <run> once the network is back. A handoff turn whose session fails is reported as that failure (HandoffTurnFailed), never as a missing handoff, and resume re-runs only the handoff. Fix-loop telemetry names the provider that ran the fix turn.

---

## phase-06 — A closing turn's network failure in review-stop {#phase-06-review-stop-network}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

A stop's closing turn that loses the network records a refused close with result `network` and exit 14 in review-stop.json at 0.30.0. The run stays awaiting review, and older stop documents still read.

### Detailed instructions

- `src/schemas/reviewStop.ts`: add the `LastClose` variant `{ result: network, at, exitCode: 14, detail }`, where `detail` is the provider message and there is no `step`. Every key is required.
- Freeze the current shape first: create `src/schemas/history/review-stop/0.26.0.ts`, a self-contained copy of today's review-stop schema (both variants and its LastClose union) with its own `$schema` URL pattern, as `src/schemas/history/interactive-session/0.26.0.ts` does, and never edit it afterwards. Wire it in `src/schemas/persisted.ts`: `readReviewStopFile` reads a stamp below the current one through the frozen decoder, and its value is valid in the current shape as it is. In `packages/schemas/src/formats/interactive.ts`, list 0.26.0 as a release of `review-stop`, export the frozen types from `packages/schemas/src/index.ts`, and add the module to the closure allowlist in `tests/unit/architecturalGuards.test.ts`.
- run-list embeds review-stop: give `run-list` the same treatment. Create `src/schemas/history/run-list/0.26.0.ts`, embedding the frozen review-stop 0.26.0, list it as a release in the package, and register it wherever review-stop's frozen module is registered.
- Run `pnpm exec tsx scripts/schemas-check.ts --write`. It writes `packages/schemas/snapshots/review-stop/next.schema.json` and `packages/schemas/snapshots/run-list/next.schema.json`, the history lock entries, `src/schemas/release.ts` (both stamps at 0.30.0) and `packages/schemas/src/generated/index.ts`. Then make every exhaustive format registry in the schemas package tests and `tests/type/schemasPackage.ts` name the new releases.
- `src/app/closeStop.ts`: a closing turn that fails with an `AgentSessionFailedError` of kind `network` is refused with `{ result: network, exitCode: 14, detail: <provider message> }`, beside the existing limit refusal. `describeRefusal` reads `the closing turn could not reach the provider: <detail>; retry once the network is back`. The run stays `awaiting_review` through the existing StopCloseRefused path. Update `src/cli/commands/stopOutput.ts` for the new result, and the comment of `exitCodeForError` in `src/cli/commands/runLayers.ts`, which lists a refused close's codes.
- `docs/upgrading.md` § 0.30.0: one bullet for review UIs. review-stop.json and `phax ls --json` are stamped 0.30.0; `lastClose` gains the result `network` (exit 14, no `step`); 0.26.0 documents still read.
- Create `tests/integration/closeStopNetwork.test.ts`, built like tests/integration/declaredStopClose.test.ts. A run awaiting review at a declared stop whose closing turn fails with kind network, through the fake backend, exits 14 on `phax resume <run>`, stays `awaiting_review`, and its review-stop.json, stamped `review-stop/0.30.0.json`, records that `lastClose`. Add decoder tests for a 0.26.0 document and a 0.30.0 network close.

### Planned files to create

- `src/schemas/history/review-stop/0.26.0.ts`
- `src/schemas/history/run-list/0.26.0.ts`
- `packages/schemas/snapshots/review-stop/next.schema.json`
- `packages/schemas/snapshots/run-list/next.schema.json`
- `tests/integration/closeStopNetwork.test.ts`

### Planned files to edit

- `src/schemas/reviewStop.ts`
- `src/schemas/persisted.ts`
- `src/schemas/release.ts`
- `packages/schemas/src/formats/interactive.ts`
- `packages/schemas/src/index.ts`
- `packages/schemas/src/generated/index.ts`
- `packages/schemas/history.lock.json`
- `src/app/closeStop.ts`
- `src/cli/commands/stopOutput.ts`
- `src/cli/commands/runLayers.ts`
- `tests/unit/architecturalGuards.test.ts`
- `tests/type/schemasPackage.ts`
- `docs/upgrading.md`

### Optional files that may be edited

- `src/schemas/runList.ts`
- `src/domain/reducer.ts`
- `tests/unit/schemasPackage/documents.ts`
- `tests/unit/schemasPackage/exports.test.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/unit/schemasPackage/jsonSchemas.test.ts`
- `tests/unit/schemas/interactiveFormats.test.ts`
- `tests/unit/persisted.test.ts`
- `tests/integration/declaredStopClose.test.ts`
- `tests/integration/heldStopClose.test.ts`
- `README.md`

### Boundary contracts

Schemas → readers: review-stop.json and the run-list's `stop` are read by review UIs without phax. The schemas package must parse 0.26.0 and 0.30.0 documents and say which shape each is. App → schemas: closeStop writes the new `network` close only through the current schema's encoder.

### Test strategy

- a closing turn that fails with kind network exits 14, keeps the run awaiting_review, and review-stop.json at review-stop 0.30.0 records lastClose network with exitCode 14 — medium · example · the review-stop.json content, run state and exit code · in-phase · ac-close-network
- a review-stop.json stamped 0.26.0 still reads, and a 0.30.0 network close round-trips through the decoder — small · example · the decoded document · in-phase
- the schemas package parses review-stop and run-list documents at 0.26.0 and at 0.30.0 — small · example · the parsed shape name and value · in-phase

### Implementation order

1. Freeze review-stop 0.26.0 and run-list 0.26.0.
2. Add the network variant to the current schema.
3. Wire the readers and the schemas package, then run schemas-check --write.
4. Refuse a network close in closeStop and render it.
5. Write the tests and the upgrading bullet.

### Excluded scope

- Interactive first turns (interactive-session.json keeps its provider-error reason).
- The decision record (phase-07).
- Any change to a run's own pause (phase-05).

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

The new LastClose variant's exact keys. The frozen modules created and where each is registered. What schemas-check --write changed. The exact refusal wording in closeStop and stopOutput. Whether run-list needed more than its frozen module and snapshot. Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(stop): record a closing turn's network failure`

### Commit body

A stop's closing turn that fails with kind network is now refused with result network and exit 14. The run keeps waiting for review, and review-stop.json, stamped 0.30.0, records the provider's message. review-stop 0.26.0 is frozen and still read, and run-list, which embeds the stop, moves to 0.30.0 with it.

---

## phase-07 — A failed decision record names its failure {#phase-07-decision-record-failure}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

Every decision record whose outcome is `failed` carries a required `failure` at decision-record-manifest 0.30.0: the failure kind, `answer-refused`, `artifact-changed` or `commit-failed`. Failed records stamped earlier still read.

### Detailed instructions

- `src/schemas/decisionRecord.ts`: add `DecisionFailureSchema`, the literals `network`, `rate-limit`, `usage-limit`, `provider-error`, `max-turns`, `killed`, `unknown`, `answer-refused`, `artifact-changed` and `commit-failed`, defined in this file (importing nothing from src/domain). Split the interactive uncommitted variant into declined/undecided (no `failure`) and failed (a required `failure`); the verdicts failed variant gains a required `failure`. Keep `$schema` first and unknown keys refused. In memory, the failed variants of `DecisionRecordManifest` carry `failure: DecisionFailure | null`, where null means only a record read from a stamp below 0.30.0. The writer's input type requires a `DecisionFailure`.
- Create `tests/type/decisionFailure.ts`: a type equality proving that `DecisionFailure` is exactly `FailureKind` (src/domain/session/outcome.ts) plus the three decide values.
- `src/schemas/persisted.ts`: a failed manifest lifted from 0.28.0 or 0.25.0 gets `failure: null`, alongside the usage lift it already applies. A failed record stamped 0.30.0 without `failure` is refused by the current decoder. Mirror the lift in `packages/schemas/src/formats/recordManifests.ts`.
- `src/app/writeDecisionRecord.ts`: the failed ends of `DecisionRecordEnd` and `VerdictsRecordEnd` carry `failure: DecisionFailure`, written into the manifest. `src/app/decideVerdicts.ts` and `src/app/decideArtifact.ts` map their Left to it with one shared pure function. A session failure (`AgentSessionFailedError`, or a limit error, through its failure) gives its kind; `DecideDocumentError` (a refused answer, retried or not) gives `answer-refused`; the artifact changing during the session gives `artifact-changed`; a failed write or commit of the decided artifact gives `commit-failed`; anything else gives `unknown`. Put the function where both use cases import it (for example beside writeDecisionRecord), and name its file in the handoff.
- Run `pnpm exec tsx scripts/schemas-check.ts --write`. It rewrites `packages/schemas/snapshots/decision-record-manifest/next.schema.json`. The 0.28.0 frozen module is not edited.
- `docs/upgrading.md` § 0.30.0: one bullet for records readers. A failed decision record now names its failure (`failure`), at decision-record-manifest 0.30.0; records written earlier still read, without it.
- Tests: extend `tests/unit/decisionRecord.test.ts`, `tests/integration/writeDecisionRecord.test.ts` and `tests/integration/decideVerdicts.test.ts`. A verdicts session failing with kind network, and one whose answer phax refused twice, write record.json stamped `decision-record-manifest/0.30.0.json` with `failure: network` and `failure: answer-refused`. A failed 0.30.0 manifest without `failure` is refused when read, and a failed 0.28.0 one reads with `failure: null`. Add a table test of the mapping function.

### Planned files to create

- `tests/type/decisionFailure.ts`

### Planned files to edit

- `src/schemas/decisionRecord.ts`
- `src/schemas/persisted.ts`
- `packages/schemas/src/formats/recordManifests.ts`
- `packages/schemas/snapshots/decision-record-manifest/next.schema.json`
- `src/app/writeDecisionRecord.ts`
- `src/app/decideVerdicts.ts`
- `src/app/decideArtifact.ts`
- `tests/unit/decisionRecord.test.ts`
- `tests/integration/writeDecisionRecord.test.ts`
- `tests/integration/decideVerdicts.test.ts`
- `docs/upgrading.md`

### Optional files that may be edited

- `packages/schemas/src/index.ts`
- `tests/type/schemasPackage.ts`
- `tests/unit/schemasPackage/documents.ts`
- `tests/unit/persisted.test.ts`
- `tests/integration/decideArtifact.test.ts`
- `tests/integration/decideVerdictsPlanHand.test.ts`
- `tests/helpers/decideVerdictsHarness.ts`
- `src/app/decideFailure.ts`
- `tests/unit/decideFailure.test.ts`

### Boundary contracts

App → schemas: the decide use cases tell writeDecisionRecord why a session failed through a `DecisionFailure` value; the schema owns the literals. Schemas package → records readers: a 0.30.0 failed record always names its failure, and an older one is lifted with none.

### Test strategy

- a verdicts session failing with kind network and one whose answer was refused twice write record.json at 0.30.0 with failure network and answer-refused — medium · example · the record.json content · in-phase · ac-record-kind
- a failed record stamped 0.30.0 without failure is refused when read, and a failed 0.28.0 record still reads with no failure — small · example · the typed refusal and the lifted manifest · in-phase · ac-record-kind
- each way a decide can fail maps to exactly one record failure — small · table · the expected failure per error · in-phase
- the record failure literals are exactly the reader's failure kinds plus answer-refused, artifact-changed and commit-failed — small · example · a type equality checked by the type tests · in-phase

### Implementation order

1. Change the current schema and add the type test.
2. Lift older failed records with failure null, in phax and in the package.
3. Write the mapping function and thread failure through writeDecisionRecord and both decide use cases.
4. Run schemas-check --write, then write the tests and the upgrading bullet.

### Excluded scope

- Record refusal wording and the order of the cause and a refusal (phase-08).
- Authoring, phase and review record manifests, which gain no failure field.
- Editing the frozen 0.25.0 or 0.28.0 modules.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

The exact `DecisionFailure` literals and the manifest variants. The file and signature of the mapping function, and which error maps to which value. How a pre-0.30.0 failed record is lifted. What schemas-check --write changed. Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(records): a failed decision record names its failure`

### Commit body

A decision record whose outcome is failed now carries a required failure: the session's failure kind, answer-refused, artifact-changed or commit-failed, at decision-record-manifest 0.30.0. Failed records written earlier still read, with no failure, through the frozen readers.

---

## phase-08 — Unknown visibility says why, and the cause comes first {#phase-08-visibility-and-order}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

An unknown repository visibility quotes gh's first stderr line and suggests a retry for a network or auth failure. A record refusal after a failed session prints after the failure and says it follows it. The troubleshooting page explains a failed agent session.

### Detailed instructions

- Create `src/domain/records/ghFailure.ts`: `classifyGhFailure(firstLine: string | null)` returns `network` (error connecting to, dial tcp, no such host, could not resolve, connection refused, timeout, i/o timeout), `auth` (gh auth login, authentication, not logged in, HTTP 401, Bad credentials) or `other`. Pure and case-insensitive.
- `src/domain/records/destination.ts`: the destination check takes a visibility reading `{ visibility, ghError }`. An unknown visibility's refusal reads `this repo's visibility could not be determined — gh: <first line>` (the plain message when `ghError` is null). Its remedy is `retry once the network is back` for network, `run \`gh auth login\`, then retry` for auth, and today's `acknowledgedUnknownVisibility` remedy for other or no line. A refusal for network or auth never mentions acknowledgedUnknownVisibility. What the destination accepts is unchanged: an unknown visibility is still refused.
- `src/ports/github.ts`: `visibility(repo)` returns that reading. `src/infra/github.ts`: a failed `gh repo view` keeps gh's first non-empty stderr line (or the spawn error's message when gh could not run) as `ghError`. `src/infra/fakes/github.ts`: keep `setVisibility`, and add `failVisibility(firstLine)`. Adapt `src/app/recordPlumbing.ts`, `src/app/initWizard.ts` and `src/app/configureRecords.ts` to the reading.
- Cause before secondary refusals. In `src/domain/errors.ts`, add `FailureWithFollowUpsError { message, cause, followUps: readonly string[] }`. In `src/app/decideVerdicts.ts`, `src/app/decideArtifact.ts` and `src/app/authorArtifact.ts`, the failure path stops writing the record and push warnings to `input.output`. When there is at least one, it fails with `FailureWithFollowUpsError` around the original error, otherwise with the original error. Record warnings after a failed session read `decision record refused, following the failed session: …` (and `authoring record …`): give `decisionRecordWarning` in `src/app/writeDecisionRecord.ts` and `recordWarning` in authorArtifact a flag for it. `exitCodeForError` and `exitCodeForAuthoringError` in `src/cli/commands/runLayers.ts` return the cause's code. `src/cli/commands/artifactDecide.ts` and `src/cli/commands/artifact.ts` print the cause's lines first (renderSessionFailure, or the existing rendering for other errors), then each follow-up as a warning.
- Docs. Create `docs/agent-session-failures.md`, `Troubleshooting a failed agent session`, for an operator whose command just failed on an agent session and who wants to know whether to retry, resume or fix something. Walk through the DNS outage case: the `claude-code session failed (network)` line, the agent-error.log it names, the record refusal that follows it, and the retry or `phax resume` it suggests. Then list the exit codes 5, 8 and 14 and what to do for each. Register it in `site/pages.ts` beside the upgrading guide. In `README.md` § Troubleshooting, add a bullet for a failed agent session and for exit 14 linking the page, and make the unknown-visibility advice match the new remedies.
- Tests. Create `tests/integration/githubVisibility.test.ts`, a contract suite run against NodeGitHubLayer, with a fake `gh` on PATH as tests/integration/githubRepoWebUrl.test.ts does, and against makeFakeGitHub(): success, a network failure, an auth failure and a no-GitHub-remote failure. Extend `tests/unit/recordsDestination.test.ts` for the three remedies, with the three gh lines of the spec's surface. Create `tests/integration/decideFailureOrder.test.ts`: `runArtifactDecide` in verdicts mode with a fake backend failing the writer, transcripts on and an in-repo destination, and a fake GitHub whose visibility fails with `error connecting to api.github.com`. The session failure line comes before `decision record refused, following the failed session`, the refusal quotes `gh: error connecting to api.github.com`, and the exit code is 14.

### Planned files to create

- `src/domain/records/ghFailure.ts`
- `tests/integration/githubVisibility.test.ts`
- `tests/integration/decideFailureOrder.test.ts`
- `docs/agent-session-failures.md`

### Planned files to edit

- `src/domain/records/destination.ts`
- `src/ports/github.ts`
- `src/infra/github.ts`
- `src/infra/fakes/github.ts`
- `src/app/recordPlumbing.ts`
- `src/app/initWizard.ts`
- `src/app/configureRecords.ts`
- `src/domain/errors.ts`
- `src/app/decideVerdicts.ts`
- `src/app/decideArtifact.ts`
- `src/app/authorArtifact.ts`
- `src/app/writeDecisionRecord.ts`
- `src/cli/commands/runLayers.ts`
- `src/cli/commands/artifactDecide.ts`
- `src/cli/commands/artifact.ts`
- `tests/unit/recordsDestination.test.ts`
- `site/pages.ts`
- `README.md`

### Optional files that may be edited

- `src/cli/commands/sessionFailureOutput.ts`
- `src/app/writeAuthoringRecord.ts`
- `src/app/writeReviewRecord.ts`
- `tests/unit/publish/githubFake.test.ts`
- `tests/integration/decideVerdicts.test.ts`
- `tests/integration/decideArtifact.test.ts`
- `tests/integration/authorArtifactRetry.test.ts`
- `tests/integration/writeAuthoringRecord.test.ts`
- `tests/unit/cli/artifact.test.ts`
- `tests/integration/sessionFailureReport.test.ts`
- `docs/security.md`

### Boundary contracts

Infra → port: the GitHub port's `visibility` promises a reading whose `ghError` is gh's own first stderr line when the query failed, never a guess. Domain: the records destination alone turns a reading into a refusal and its remedy. App → CLI: a use case that wrote a record after a failed session hands its follow-up warnings to the CLI on the error (`FailureWithFollowUpsError`) instead of printing them, and the CLI decides their order.

### Test strategy

- the gh adapter and the fake agree that a failing gh repo view gives an unknown visibility carrying gh's first stderr line — medium · contract · one suite run against both GitHub implementations · in-phase
- a gh network failure's refusal quotes gh's line and suggests a retry, never acknowledgedUnknownVisibility — small · example · the expected refusal message and remedy · in-phase · ac-visibility-network
- a gh auth failure's refusal quotes gh's first line and suggests gh auth login, then a retry — small · example · the expected refusal message and remedy · in-phase · ac-visibility-auth
- a gh failure with no GitHub remote quotes gh's first line and keeps the acknowledgement remedy — small · example · the expected refusal message and remedy · in-phase · ac-visibility-other
- a failed decide writer whose record is refused prints the failure line before the refusal, which says it follows the failed session — medium · example · the ordered terminal lines and exit code · in-phase · ac-order

### Implementation order

1. Write classifyGhFailure and the destination's new refusal, with unit tests.
2. Change the GitHub port, adapter and fake to the reading, adapt their callers, and write the contract suite.
3. Add FailureWithFollowUpsError, move the follow-up warnings onto it in the three use cases, and unwrap the exit codes.
4. Print the cause first in artifact decide and artifact new, and write the ordering test.
5. Write the troubleshooting page, register it, and update the README.

### Excluded scope

- Changing what the records destination accepts: an unknown visibility is still refused.
- Classifying failures of gh beyond the visibility check, or of git.
- Ordering for run, resume and the review commands, which write no record after a failed session.

### Verification

The `standard` gate profile in phax.json, including its terminal steps (build, site build and the Deno smokes) as the final phase.

### Expected handoff content

The visibility reading type and where it is defined. The exact refusal messages and remedies per gh class. The fields of FailureWithFollowUpsError and which use cases raise it. The page's route in site/pages.ts. The README lines changed. Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(records): say why visibility is unknown, and print the cause first`

### Commit body

When gh repo view fails, the records visibility refusal now quotes gh's first stderr line. A network or authentication failure suggests a retry (after gh auth login) instead of acknowledgedUnknownVisibility. A decide or authoring session that failed prints its cause before any record refusal, and the refusal says it follows the failed session. Adds the Troubleshooting a failed agent session page and points the README at it.
