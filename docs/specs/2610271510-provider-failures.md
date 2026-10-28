---
status: Approved
date: 2026-10-27
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
approved:
  date: 2026-10-28
  baseline: 74e36f9
---
# Provider failures

## 1. Context

phax drives three provider CLIs (Claude Code, Codex, Mistral Vibe) as headless sessions: phase turns, fix turns and the handoff turn of a run, authoring and decide writers, review and compliance turns, and sealed completions. Each adapter spawns the CLI, keeps its stdout transcript (output.jsonl in a decide folder, per-phase .jsonl files in a run folder) and stderr, and then decides what happened.

Today that decision is: if the process exited non-zero or a Claude result event is flagged as an error, scan stderr together with every transcript line for limit signatures ("usage limit", "rate limit", "429", …) and fail with exit 8 when one matches. Otherwise a non-zero exit becomes `<provider> exited with code N` plus stderr (exit 5), and agent-error.log in the phase or decide folder records the argv, the exit code and stderr. A zero exit reads the last result event; Claude Code's result event must carry a `result` string, so its error results (`is_error: true` with subtypes such as `error_during_execution`, `error_max_turns`, `error_max_structured_output_retries`) carry none and do not decode.

Writing a record (decision, authoring, review) checks the records destination first; when transcripts go to an in-repo destination, it asks `gh repo view` for the repository's visibility. Any `gh` failure becomes visibility `unknown`, and the destination refuses with "this repo's visibility could not be determined" and the remedy `acknowledgedUnknownVisibility`.

Exit codes run from 0 to 13; 8 is "Rate or usage limit hit (resumable)", 5 is "Agent invocation error".

Ground read:

- `docs/briefs/provider-failures.md` — The brief: the 2026-10-27 DNS outage case, the seven-item inventory and the settled decisions.
- `src/schemas/claudeOutput.ts` — The result event requires a `result` string, so error results carrying none are dropped; classifyRateLimit scans stderr plus every stdout line, tool output included.
- `src/infra/providers/claudeCode.ts` — runClaudeAgent/runClaudeCompletion: limit check on non-zero exit or errored result, then `claude exited with code N` with stderr; a missing result event becomes AgentSessionIdMissingError.
- `src/infra/providers/codexCli.ts` — runCodexCompletion returns `finalText: ""` when no answer event is found; the same `codex exited with code N` shape.
- `src/infra/providers/mistralVibe.ts` — Vibe runs with `--output streaming`; same exit-code-plus-stderr failure and the shared limit scan.
- `src/infra/providers/dispatcher.ts` — Maps AgentSessionIdMissingError to an AgentInvocationError carrying only the message, so the phase folder and its log hint are lost.
- `src/infra/providers/agentErrorLog.ts` — agent-error.log today: argv, `exit code: N`, a blank line, stderr.
- `src/cli/commands/runLayers.ts` — EXIT_CODE_MEANINGS (8 = rate or usage limit, resumable; 13 the highest code) and renderAgentInvocationError's `See …/agent-error.log` hint.
- `src/infra/github.ts` — visibility() runs `gh repo view` through ghRunAllowFail and maps any failure to `unknown`, dropping gh's stderr.
- `src/domain/records/destination.ts` — The `unacknowledged-unknown-visibility` refusal and its acknowledgedUnknownVisibility remedy.
- `src/app/handoffGeneration.ts` — The handoff turn's session result is not inspected; a missing handoff file dispatches HandoffMissing with every section missing.
- `src/app/fixLoop.ts` — The fix-turn telemetry operation is `phax.claude-code-cli.agent.resume` with adapter `claude-code-cli` whatever the provider.
- `src/app/decideVerdicts.ts` — The verdicts writer: output.jsonl, retry-output.jsonl; provider errors and limits are never retried.
- `src/app/writeDecisionRecord.ts` — The decision folder `<stateRoot>/decide/<stamp>-<slug>/<NN>/` and the `decision record refused: … (remedy: …)` warning.
- `src/schemas/decisionRecord.ts` — Decision record manifest: interactive and verdicts `failed` outcomes, born with $schema, currently 0.28.0 (src/schemas/release.ts).
- `src/domain/events.ts` — RateLimitDetected leaves a run interrupted and resumable, with kind rate_limit or usage_limit.

## 2. Problem

phax misreports why a session failed. On 2026-10-27 a DNS outage killed a `phax artifact decide --verdicts` writer after six minutes and $6.33. phax first printed the decision record refusal ("this repo's visibility could not be determined", remedy `acknowledgedUnknownVisibility`), because `gh repo view` had failed on the same outage. It then printed `✗ claude exited with code 1` and pointed at agent-error.log, which holds the argv, the exit code and an empty stderr. The cause (Claude Code's `API Error: Can't reach the API server — check your internet or DNS (ENOTFOUND)`, after ten `api_retry` events) sat unnamed in output.jsonl. The reader took the visibility refusal for the cause and was offered a remedy that would have weakened a privacy check.

The same flaw recurs in every agent call: Claude Code error results lose their session id and reason; a transcript whose tool output mentions "429" and then crashes is reported as a rate limit (exit 8, resumable) when it is not; a provider error during the handoff turn is reported as a handoff with every section missing; the dispatcher drops the log hint when no session id is found; a Codex completion with no answer returns empty text silently; fix-loop telemetry names Claude Code whatever the provider ran. A network failure, which only needs a retry, exits like a broken invocation (5) and leaves no retry hint.

## 3. Product goal

When an agent session fails, phax says why — the provider, the kind of failure and the provider's own message — first in the terminal and durably in the session's files, and never mistakes something the session merely read or printed for the failure. A transient failure (a network outage, a limit) is reported as transient, with its own exit code and the command that retries it, and no secondary refusal it caused is shown as the cause.

> The provider's own verdict on its session is the cause phax reports, first and in full; nothing the session read or wrote is ever taken for it.

## 4. Terminology

- **session outcome** — What phax reads from an ended agent session: either an answer (the session's final text and session id) or a failure.
- **failure kind** — The class of a failed session, exactly one of: `network` (the provider could not reach its API), `rate-limit`, `usage-limit`, `provider-error` (the provider reported an error of its own, including Claude Code error results such as `error_during_execution` or `error_max_structured_output_retries`), `max-turns` (the provider stopped at its turn limit), `killed` (the process ended on a signal or a timeout), `unknown` (no provider verdict was found).
- **provider message** — The provider's own words for the failure: the error text of its final result event, else of its transcript's last error event, else the first non-empty stderr lines. Never text produced by a tool or by the model.
- **transient failure** — A failure that a retry of the same command may clear without any change by the operator: `network`, `rate-limit`, `usage-limit`.
- **secondary refusal** — A refusal raised after a session failed, by a step that ran because of it or alongside it — typically the records destination refusing the failed session's record.
- **network failure exit code** — Exit 14, "Provider unreachable: network failure (resumable)" (q-network-exit): the exit code of a command whose session failed with kind `network`.

## 5. Functional requirements

### 5.1 One outcome per ended session

For each of Claude Code, Codex and Mistral Vibe, the system shall read every ended agent session into exactly one session outcome: an answer, or a failure carrying its failure kind, the provider message, and the session id when the provider reported one.

### 5.2 Where the failure is read from

The system shall take a session's failure from the provider's final result event first, then from the transcript's last error event, then from stderr, and shall never read tool output or model text to classify it.

### 5.3 Claude Code error results

WHEN Claude Code ends a session with an error result that carries no result text THE system SHALL report a failure whose provider message names the result's subtype and whose session id is the one that result carries.

### 5.4 No limit read from tool output

IF a session's tool output or model text mentions a limit (such as "429" or "rate limit") and the session then fails without the provider reporting a limit THEN the system SHALL NOT report a `rate-limit` or `usage-limit` failure.

### 5.5 Network failures are recognized

WHEN the provider reports that it could not reach its API THE system SHALL classify the failure as `network`.

### 5.6 Network failures exit as transient

WHEN a command's session fails with kind `network` THE system SHALL exit 14 and print a retry hint naming the command to run again.

### 5.7 A run survives a network failure

WHEN a session of a run fails with kind `network` THE system SHALL leave the run resumable, as it does for a usage limit, with a retry hint naming `phax resume <run>`.

### 5.8 The terminal names the cause

The system shall report a failed session in the terminal as the provider, the failure kind and the provider message, never as the provider's exit code alone.

### 5.9 The report names the files

WHERE a failed session keeps an agent-error.log THE system SHALL name that log and the session's transcript whenever it reports the failure, whether or not a session id was found.

### 5.10 A failed handoff turn is a session failure

IF the handoff turn's session fails THEN the system SHALL report that session failure, with its kind and provider message, and SHALL NOT report a missing handoff.

### 5.11 No silent empty Codex answer

IF a Codex completion ends with no answer message THEN the system SHALL report a `provider-error` failure saying that no answer was found, and SHALL NOT return an empty answer.

### 5.12 Cause before secondary refusals

WHEN a command reports a failed session and a secondary refusal THE system SHALL print the session failure before the secondary refusal.

### 5.13 A record refusal names the failure it follows

WHEN a record refusal follows a failed session THE system SHALL say in that refusal that it follows the failed session.

### 5.14 Unknown visibility says why

WHEN the repository visibility is unknown because `gh` failed THE system SHALL quote the first line of `gh`'s stderr in the visibility refusal.

### 5.15 A transient gh failure suggests a retry

IF `gh` failed on a network or authentication error THEN the visibility refusal SHALL suggest a retry (after `gh auth login` for authentication) and SHALL NOT suggest `acknowledgedUnknownVisibility`.

### 5.16 agent-error.log holds the cause

The system shall write in a failed session's agent-error.log the failure kind, the provider, the provider message, the session id or `none`, and the transcript path, ahead of the argv, exit code and stderr it records today.

### 5.17 A failed decision record carries the failure kind

The system shall write in every decision record whose outcome is `failed` a required `failure`: the failure kind when the session failed, `answer-refused` when the session answered and phax refused the answer, `artifact-changed` when the artifact changed while the session ran, or `commit-failed` when writing or committing the decided artifact failed, at `$schema` 0.30.0.

### 5.18 A stop's closing turn records a network failure

WHEN a stop's closing turn fails with kind `network` THE system SHALL record the refused close in review-stop.json with result `network` and exit code 14, at `$schema` 0.30.0.

### 5.19 Fix-loop telemetry names its provider

The system shall name, in the fix turn's telemetry operation and adapter, the provider that ran the fix turn, by the same provider id the phase turn's telemetry uses.

## 6. Surface

### cli: phax artifact decide (a failed writer session) — indicative

Summary: When the writer session fails, phax names the provider's error first, with a retry hint, and the record refusal that follows says so.

before:

    $ phax artifact decide docs/specs/2610271200-audio-export.md --verdicts verdicts.json
    ⚠ decision record refused: this repo's visibility could not be determined, and transcripts are enabled with an in-repo destination (remedy: set records.destination.acknowledgedUnknownVisibility to true once you have confirmed this repo is private, or disable transcripts)
    ✗ claude exited with code 1
      See ~/.phax/decide/2610271200-audio-export/02/agent-error.log for the full agent output.
    $? = 5

after:

    $ phax artifact decide docs/specs/2610271200-audio-export.md --verdicts verdicts.json
    ✗ claude-code session failed (network): API Error: Can't reach the API server — check your internet or DNS (ENOTFOUND)
      session: 8c1e4f2a-3b7d-4e1a-9f0c-2d6b5a7e9c31
      See ~/.phax/decide/2610271200-audio-export/02/agent-error.log and output.jsonl
      Retry once the network is back: phax artifact decide docs/specs/2610271200-audio-export.md --verdicts verdicts.json
    ⚠ decision record refused, following the failed session: this repo's visibility could not be determined — gh: error connecting to api.github.com (remedy: retry once the network is back)
    $? = 14

### cli: phax run (a network failure mid-phase) — indicative

Summary: A run whose agent loses the network pauses resumable and tells you to resume it, instead of failing.

before:

    $ phax run docs/plans/2610261000-audio-export-plan.md
    …
    ✗ claude exited with code 1
      See ~/.phax/runs/notebook.audio-export/phase-02/agent-error.log for the full agent output.
    $? = 5

after:

    $ phax run docs/plans/2610261000-audio-export-plan.md
    …
    ✗ claude-code session failed (network): API Error: Can't reach the API server — check your internet or DNS (ENOTFOUND)
      session: 3f9a0c1d-6e2b-4c7a-8d15-b0e4f7a29c68
      See ~/.phax/runs/notebook.audio-export/phase-02/agent-error.log and output.jsonl
      Run notebook.audio-export is paused at phase-02.
      Retry once the network is back: phax resume notebook.audio-export
    $? = 14

### cli: phax run (a crash after a tool printed "429") — indicative

Summary: A session that crashes after a tool merely printed "429" is reported as the crash it is, not as a rate limit.

before:

    $ phax run docs/plans/2610261000-audio-export-plan.md
    …
    ✗ Claude Code stopped: rate limit hit.
    $? = 8

after:

    $ phax run docs/plans/2610261000-audio-export-plan.md
    …
    ✗ claude-code session failed (provider-error): error_during_execution
      session: 3f9a0c1d-6e2b-4c7a-8d15-b0e4f7a29c68
      See ~/.phax/runs/notebook.audio-export/phase-02/agent-error.log and output.jsonl
    $? = 5

### file: agent-error.log — normative

Summary: The agent error log now opens with the failure kind, the provider's own message, the session id and the transcript to read.

before:

    claude --print --output-format stream-json --verbose --model claude-opus-5-5 --effort high …
    exit code: 1


after:

    failure: network
    provider: claude-code
    message: API Error: Can't reach the API server — check your internet or DNS (ENOTFOUND)
    session: 8c1e4f2a-3b7d-4e1a-9f0c-2d6b5a7e9c31
    transcript: ~/.phax/decide/2610271200-audio-export/02/output.jsonl

    claude --print --output-format stream-json --verbose --model claude-opus-5-5 --effort high …
    exit code: 1


### cli: records visibility refusal — indicative

Summary: When the repository's visibility cannot be checked, phax quotes why gh failed and, on a network or login problem, tells you to retry rather than to acknowledge an unknown visibility.

before:

    ⚠ decision record refused: this repo's visibility could not be determined, and transcripts are enabled with an in-repo destination (remedy: set records.destination.acknowledgedUnknownVisibility to true once you have confirmed this repo is private, or disable transcripts)

after:

    ⚠ decision record refused: this repo's visibility could not be determined — gh: error connecting to api.github.com (remedy: retry once the network is back)

    ⚠ decision record refused: this repo's visibility could not be determined — gh: To get started with GitHub CLI, please run:  gh auth login (remedy: run `gh auth login`, then retry)

    ⚠ decision record refused: this repo's visibility could not be determined — gh: none of the git remotes configured for this repository point to a known GitHub host (remedy: set records.destination.acknowledgedUnknownVisibility to true once you have confirmed this repo is private, or disable transcripts)

### file: decision record record.json — normative

Summary: A failed decision record says why the decide failed.

before:

    {
      "$schema": "https://docs.phax.run/schemas/decision-record-manifest/0.28.0.json",
      "kind": "decision",
      "decisionId": "2610271200-audio-export/02",
      "mode": "verdicts",
      "outcome": "failed",
      "commit": null,
      …
    }

after:

    {
      "$schema": "https://docs.phax.run/schemas/decision-record-manifest/0.30.0.json",
      "kind": "decision",
      "decisionId": "2610271200-audio-export/02",
      "mode": "verdicts",
      "outcome": "failed",
      "failure": "network",
      "commit": null,
      …
    }

### file: review-stop.json — normative

Summary: When a stop's closing turn loses the network, the stop's last close says so, and the run still waits for your review.

before:

    {
      "$schema": "https://docs.phax.run/schemas/review-stop/0.26.0.json",
      "run": "notebook.audio-export",
      "cause": "declared",
      "state": "awaiting_review",
      …
      "lastClose": {
        "result": "close-error",
        "at": "2026-10-27T14:02:11.408Z",
        "exitCode": 5,
        "step": "closing-turn",
        "detail": "claude exited with code 1"
      },
      …
    }

after:

    {
      "$schema": "https://docs.phax.run/schemas/review-stop/0.30.0.json",
      "run": "notebook.audio-export",
      "cause": "declared",
      "state": "awaiting_review",
      …
      "lastClose": {
        "result": "network",
        "at": "2026-10-27T14:02:11.408Z",
        "exitCode": 14,
        "detail": "API Error: Can't reach the API server — check your internet or DNS (ENOTFOUND)"
      },
      …
    }

### cli: exit codes — normative

Summary: A command whose agent could not reach its provider exits with its own code, so a script can retry it.

before:

    8   Rate or usage limit hit (resumable)
    …
    13  Awaiting review at an interactive or held phase (resumable)

after:

    8   Rate or usage limit hit (resumable)
    …
    13  Awaiting review at an interactive or held phase (resumable)
    14  Provider unreachable: network failure (resumable)

### internal: fix-loop telemetry operation — indicative

Summary: Traces of a fix turn name the provider that ran it.

before:

    operation: phax.claude-code-cli.agent.resume   adapter: claude-code-cli   (whatever the provider)

after:

    operation: phax.codex-cli.agent.resume   adapter: codex-cli   (a Codex fix turn)
    operation: phax.mistral-vibe.agent.resume   adapter: mistral-vibe   (a Vibe fix turn)
    operation: phax.claude-code.agent.resume   adapter: claude-code   (a Claude Code fix turn)

## 7. Non-goals

- Provider-native structured output, and making the compliance review or the handoff a structured answer: they belong to the next spec, "Structured output", which builds on this spec's session reader.
- Retrying a failed session automatically: phax reports a transient failure and names the retry; it never re-runs the session on its own.
- Changing the Mistral Vibe adapter beyond reading its session outcome: the rest of the Vibe V3 review is separate.
- Adding a failure kind to run-status.json or to any persisted shape other than the decision record and review-stop.json's refused close (`network`); run status keeps its `lastError` text.
- Changing what the records destination accepts: an unknown visibility is still refused; only its message and remedy change.
- Classifying failures of `gh` itself beyond the visibility check, or of git.

## 8. Acceptance criteria

### A Claude Code failure is read into one outcome

Given a Claude Code session whose transcript ends with an error result of subtype `error_during_execution` and a session id, when the session ends with exit 1, then phax reports one failure of kind `provider-error`, whose provider message names `error_during_execution` and whose session id is the result's. (refs §5.1, §5.3, §5.8)

### Max turns keeps its session id

Given a Claude Code session ending with an error result of subtype `error_max_turns` and no `result` text, when phax reads its outcome, then the failure kind is `max-turns` and agent-error.log carries `session:` with that session id. (refs §5.3, §5.1, §5.16)

### Codex and Vibe failures carry kind and message

Given a Codex session and a Mistral Vibe session that each end with a provider error, when phax reads each outcome, then each is a failure with a failure kind and the provider's own error text, not `<provider> exited with code N`. (refs §5.1, §5.8)

### The result event wins over stderr

Given a session whose final result event reports a usage limit and whose stderr reports a different error, when phax reads its outcome, then the failure kind is `usage-limit` and the provider message is the result event's text. (refs §5.2)

### A killed session and a silent one

Given a session whose process is ended by SIGTERM, and another that exits 1 with no result event, no error event and empty stderr, when phax reads each outcome, then the first is a failure of kind `killed` and the second a failure of kind `unknown`, neither reported as a limit. (refs §5.1, §5.2)

### A 429 in tool output is not a rate limit

Given a phase session whose tool output contains "HTTP 429 Too Many Requests" and which then ends with an error result `error_during_execution`, when `phax run` reports the phase failure, then it prints `claude-code session failed (provider-error)`, exits 5, and does not leave the run rate-limited. (refs §5.4, §5.2)

### The DNS outage case

Given a `phax artifact decide --verdicts` writer session whose transcript holds ten `api_retry` events then `API Error: Can't reach the API server — check your internet or DNS (ENOTFOUND)`, when the session exits 1, then phax prints `claude-code session failed (network)` with that message, the agent-error.log and output.jsonl paths, and a retry hint naming the same `phax artifact decide` command, and exits 14. (refs §5.5, §5.6, §5.8, §5.9)

### A run pauses on a network failure

Given a run whose phase session fails with kind `network`, when `phax run` ends, then the run is resumable, the terminal names `phax resume <run>`, the command exits 14, and a later `phax resume <run>` continues the phase. (refs §5.7, §5.6)

### The log hint survives a missing session id

Given a session that fails before the provider reports any session id, when phax reports the failure, then the terminal names the session's agent-error.log and its transcript, and agent-error.log carries `session: none`. (refs §5.9, §5.16)

### A failed handoff turn is not a missing handoff

Given a phase whose handoff turn session fails with kind `network`, when phax reports the phase, then it reports the `network` failure with its provider message, and dispatches no HandoffMissing. (refs §5.10)

### An empty Codex completion is a failure

Given a Codex completion whose transcript holds no answer message and which exits 0, when phax reads its outcome, then it reports a `provider-error` failure saying no answer was found, and no caller receives empty text. (refs §5.11)

### The cause comes first

Given a failed decide writer session whose decision record is refused by the records destination, when `phax artifact decide` reports, then the session failure line precedes the record refusal, and the refusal reads `decision record refused, following the failed session`. (refs §5.12, §5.13)

### A network gh failure suggests a retry

Given transcripts enabled with an in-repo destination and `gh repo view` failing with `error connecting to api.github.com`, when a record is written, then the refusal quotes `gh: error connecting to api.github.com`, suggests a retry, and does not mention `acknowledgedUnknownVisibility`. (refs §5.14, §5.15)

### An auth gh failure suggests gh auth login

Given `gh repo view` failing because `gh` is not logged in, when a record is written, then the refusal quotes gh's first stderr line and suggests `gh auth login`, then a retry. (refs §5.14, §5.15)

### A non-transient gh failure keeps the acknowledgement remedy

Given `gh repo view` failing because no remote points to a GitHub host, when a record is written, then the refusal quotes gh's first stderr line and keeps the `acknowledgedUnknownVisibility` remedy. (refs §5.14)

### agent-error.log opens with the cause

Given any failed session that keeps an agent-error.log, when phax writes its agent-error.log, then the file starts with the lines `failure:`, `provider:`, `message:`, `session:`, `transcript:`, followed by the argv, `exit code:` and stderr. (refs §5.16)

### A failed decision record names its failure

Given a verdicts decide session that fails with kind `network`, and another whose answer phax refused twice, when their decision records are written, then both record.json files are stamped `decision-record-manifest/0.30.0.json`, carry `failure: "network"` and `failure: "answer-refused"` respectively, and a failed record stamped 0.30.0 without `failure` is refused when read. (refs §5.17)

### A closing turn's network failure

Given a run awaiting review at a stop whose closing turn fails with kind `network`, when `phax resume <run>` closes the stop, then it exits 14, the run stays `awaiting_review`, and review-stop.json, stamped `review-stop/0.30.0.json`, records `lastClose` with result `network` and `exitCode` 14. (refs §5.18, §5.6)

### Fix-loop telemetry names Codex

Given a run whose fix turn runs on Codex with tracing on, when the fix turn runs, then the trace's operation is `phax.codex-cli.agent.resume` with adapter `codex-cli`. (refs §5.19)

## 9. Open questions

None.

## 9b. Arbitrated questions

### q-network-exit — Which exit code does a command exit with when its session fails with kind `network`?

- share-8 — Share exit 8 with rate and usage limits, widened to "transient provider failure (resumable)" — abandons: Telling a limit from an outage by exit code: a wrapper that waits for a limit's reset time gets a network failure that has no reset time and must read the terminal to know whether to retry now or wait hours.
- new-14 — A new exit 14, "Provider unreachable: network failure (resumable)" — abandons: Existing scripts keyed on 8 as "resumable, retry later": they treat a network failure as a hard failure until they learn 14.

Recommendation: new-14 — An outage and a limit call for different retries (now versus after a reset), and phax prefers explicit per-case values over a widened one; the loss falls on scripts written against a code that never covered network failures, which are failing as exit 5 today anyway.

Decision: new-14 — by operator (Rémy Loubradou), 2026-10-27
Why: An outage and a limit call for different retries (now versus after a reset), and phax prefers explicit per-case values over a widened one; the loss falls on scripts written against a code that never covered network failures, which are failing as exit 5 today anyway. Advocate: The strongest case for share-8: scripts already treat 8 as resumable and retry-later, so a network failure joins that behavior at once with no new code to learn, and the README table gains no row. Principles: S1, S5. Reversibility: costly. Revised: none.

### q-record-kind — Does a failed decision record carry the failure kind (r-record-kind), or does the kind live only in the local agent-error.log?

- record-kind — The failed decision record gains a required `failure` (a failure kind or `answer-refused`), at $schema 0.30.0 — abandons: A stable decision record format: every reader of decision records learns a 0.30.0 shape, and older failed records are read through the versioned reader without a kind.
- log-only — Only agent-error.log carries the kind; the record stays at 0.28.0 (drop r-record-kind and ac-record-kind) — abandons: Knowing from the shared records why a decide session failed: a reviewer on the records branch cannot tell an outage from a refused answer, and the local log is lost once the state folder is pruned.

Recommendation: record-kind — The records branch is where a failed session is reviewed after the fact, and a network failure that cost $6 should read differently there from an answer phax refused; a schema bump with no back-compat shim is the cost phax already accepts for every persisted change.

Decision: record-kind — by operator (Rémy Loubradou), 2026-10-27
Why: The records branch is where a failed session is reviewed after the fact, and a network failure that cost $6 should read differently there from an answer phax refused; a schema bump with no back-compat shim is the cost phax already accepts for every persisted change. Advocate: The strongest case for log-only: the decision record format stays at 0.28.0, no reader learns a new shape, and the failure kind is operational detail that belongs in a local log rather than in a durable shared record. Principles: S1, S5. Reversibility: costly. Revised: none.

## 10. Implementation-planning note

Settled:

- One session-outcome reader per provider (Claude Code, Codex, Mistral Vibe), returning an answer or a failure with kind, provider message and session id when there is one; every caller and both `runAgent`/`resumeAgentSession` and `complete` go through it.
- Reading order: the provider's final result event, then the transcript's last error event, then stderr; tool output and model text are never scanned. The limit classification moves onto this reader.
- The failure kinds are exactly `network`, `rate-limit`, `usage-limit`, `provider-error`, `max-turns`, `killed`, `unknown`; the failed decision record adds `answer-refused`, `artifact-changed` and `commit-failed` (q-record-kind); failed records stamped before 0.30.0 stay readable through the versioned reader.
- A network failure is transient like a usage limit: exit 14 (q-network-exit), provider message, retry hint, and a run left resumable.
- review-stop.json's refused close gains a `network` result with exit 14, at review-stop 0.30.0; older stamps are read as today.
- The cause prints before any secondary refusal; a record refusal after a failed session says it follows it.
- An `unknown` visibility quotes gh's first stderr line; network and auth failures suggest a retry, never `acknowledgedUnknownVisibility`.
- agent-error.log records kind, provider, message, session id or `none`, transcript path, then argv, exit code and stderr.
- No back-compat shims: a persisted shape that gains a failure kind gains it as a required field, with `$schema` at 0.30.0.

Left open:

- How a provider's network error is recognized per provider (Claude Code's synthetic API error and its `api_retry` events, Codex's and Vibe's equivalents), as long as only the provider's verdict is read.
- Whether Vibe's outcome comes from `--output-dir`'s export.json (stop reason, outcome, usage, cost) or from its transcript: use export.json only if it proves reliable on Vibe 3.0.3.
- How a run records a paused network failure (a new event beside RateLimitDetected, or a widened one), within the state-machine rules.

Constraints:

- Change nothing else in the Mistral Vibe adapter: the operator is reviewing Vibe V3 separately.
- Vibe 3.0.3 is the target version.
- Exit 14, "Provider unreachable: network failure (resumable)", joins EXIT_CODE_MEANINGS and the README § Exit codes table, which a unit test keeps in step.
- Callers to cover: handoff generation, fix loop, authoring, decide (interactive and verdicts), interactive stop, close stop, compliance review, and plan extraction.
- The reader is the base the next spec, "Structured output", builds on: keep the answer side of the outcome open to a structured answer without implementing one.

## 11. Docs page

Page: Troubleshooting a failed agent session

Reader: An operator whose phax command just failed on an agent session and who wants to know whether to retry, resume or fix something.

Example: The DNS outage case: the terminal's `claude-code session failed (network)` line, the agent-error.log it names, the record refusal that follows it, and the retry or `phax resume` it suggests; then the exit code table rows 5, 8 and 14.

## 12. Decision log

- 2026-10-27 q-network-exit decided new-14 — operator (Rémy Loubradou)
- 2026-10-27 q-record-kind decided record-kind — operator (Rémy Loubradou)
