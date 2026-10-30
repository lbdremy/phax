---
status: Approved
date: 2026-10-27
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
approved:
  date: 2026-10-30
  baseline: b6c5601
---
# Structured output

## 1. Context

Prerequisite: this spec builds on the spec "Provider failures", which reads every ended agent session into one session outcome (an answer, or a failure with its kind, the provider message and the session id). This spec extends the answer side of that outcome to a structured answer.

Eight agent calls must return a structured answer that phax decodes: headless authoring of specs and plans, the plan-extraction fallback, decide's headless handback after an interactive session, the `decide --verdicts` writer, the interactive first turn, the interactive closing turn, the headless code review (`phax review-code --headless`, shipped in 0.29.0) and the compliance review. Today six of them state the answer's JSON Schema in the prompt text; the headless code review states only a sketch of its answer's keys with the lists of its closed ids, and the compliance review only a `version: 1` sketch of the JSON file it writes. Every call that answers reads the session's final text, parses it as JSON and decodes it with phax's own schema. Except for extraction, the code review and the compliance review, a refused answer resumes the session once with the refusal; a second refusal fails the command.

Three calls depart from that. The plan-extraction fallback is a sealed completion with no session; its prompt allows a `{"error": "<what is missing>"}` answer that its schema does not describe, and it has no retry. The headless code review has no retry either. The compliance review does not answer at all: its session writes compliance-review.md (free prose: verdict, per-phase findings, an unplanned-change ledger, an unmet-promise ledger, attention points) and compliance-review.json (a version-1 verdict holding neither ledger) into `.phax-context/` of the worktree. phax copies the Markdown verbatim into the run folder; a missing, unparsable or undecodable JSON silently becomes `Verdict: unknown`.

The providers, checked on 2026-10-27: Claude Code 2.1.311 takes `--json-schema <schema>` inline with `--print`, delivers the answer as `structured_output` on the result event, and fails with subtype `error_max_structured_output_retries` when it cannot meet the schema; whether it combines with `--resume`, `--tools` and stream-json is not documented. Codex 0.153.4 takes `--output-schema <FILE>` on `exec` and `exec resume` and sends it with `strict: true`, so OpenAI's strict subset applies (closed objects with every key required, no root `anyOf`/`oneOf`, a limited keyword set). Mistral Vibe 3.0.3 has no schema option. Rechecked on 2026-10-30 against the installed Claude Code 2.1.314, codex-cli 0.165.0 and Mistral Vibe 3.0.3: `claude --help` lists `--json-schema <schema>`, and `codex exec --help` and `codex exec resume --help` both list `--output-schema <FILE>`.

Ground read:

- `docs/briefs/structured-output.md` — The brief: provider facts checked on 2026-10-27, the operator's settled decisions, the calls in scope and the out-of-scope list.
- `docs/specs/archive/2610271510-provider-failures.md` — The prerequisite spec: one session outcome per ended session (an answer or a failure with kind, provider message and session id); `error_max_structured_output_retries` is a `provider-error`; its reader keeps the answer side open to a structured answer.
- `src/ports/backend.ts` — runAgent, resumeAgentSession and complete return `finalText` and fail through the session-outcome readers; AgentRunOptions.readOnly narrows every provider: Claude Code to its reading tools, Codex to its read-only sandbox, Mistral Vibe to `--enabled-tools read_file grep`, plus `bash` when the session has agent commands.
- `src/infra/providers/claudeCode.ts` — Every Claude Code call runs `--print --output-format stream-json --verbose`; resumes add `--resume <id>`; read-only sessions add `--permission-mode default --tools <reading tools[,Bash]> --strict-mcp-config`; sealed completions add `--permission-mode default --allowedTools "" --disallowed-tools Bash,WebFetch,WebSearch --strict-mcp-config`; only the windows probe adds `--no-session-persistence --tools ""`.
- `src/infra/providers/codexCli.ts` — Codex runs `codex exec -C <cwd> …` and resumes with `codex exec resume <id> …` with the same flags; readOnly runs Codex's read-only sandbox with `approval_policy="never"`.
- `src/infra/providers/mistralVibe.ts` — Vibe 3.0.3 or later (an older one is refused) runs `-p … --agent … --output streaming --output-dir <export dir>` and resumes with `--resume <id>`; the answer is the stream's last assistant text, and the outcome, session id, usage and config come from its `export.json`; a turn whose exported config differs from what phax set is refused; a new turn deletes the export beside its transcript; no schema option.
- `src/domain/session/vibeFlags.ts` — A read-only Vibe session runs `--agent accept-edits --enabled-tools read_file --enabled-tools grep`, plus `bash` allowlisted to exactly its agent commands, in the worktree alone; a sealed completion disables every tool.
- `src/domain/session/outcome.ts` — The session-outcome contract: an ended session is an answer (`text` and session id) or a failure (kind, provider message, session id); the answer holds only the text.
- `src/domain/session/claudeOutcome.ts` — A Claude Code success result with no `result` text is a `provider-error`; an error result whose subtype is not `error_max_turns` and whose text matches no limit or network signature is a `provider-error`, worded by its text, else `<subtype>: <first error>`, else the subtype.
- `src/schemas/claudeOutput.ts` — The result event is decoded for subtype, is_error, result, session id, errors and the API error fields; `structured_output` is dropped with every other unknown key.
- `src/domain/session/codexOutcome.ts` — A Codex `turn.completed` with no agent message, or a blank one, is a `provider-error`: no answer was found.
- `src/domain/authoring/retry.ts` — The corrective resume: a refused final message is resumed once in the same session with the refusal; a second refusal is `<kind> document rejected twice — first answer: …; retry: …`.
- `src/app/authorArtifact.ts` — Headless spec and plan authoring: runAgent, decode spec-document or plan-document, one corrective resume.
- `src/app/extractPlan.ts` — The plan-extraction fallback: a sealed `complete` call pinned to Claude Code, no session; the prompt allows a `{"error": …}` answer that its JSON Schema does not describe; no retry.
- `src/app/decideArtifact.ts` — decide's headless handback resumes the interactive session and decodes a revised document or a hand-decision-answer, with one corrective resume.
- `src/app/decideVerdicts.ts` — The `decide --verdicts` writer: runAgent or resume, decode, one corrective resume, output.jsonl and retry-output.jsonl.
- `src/app/interactiveStop.ts` — The interactive first turn: runAgent, decode the first-reading answer, one corrective resume.
- `src/app/closeStop.ts` — The interactive closing turn: resume, decode the interactive-handoff answer, one corrective resume; a resume that fails with anything but a limit or a network failure is read as a lost session, and a new closing session starts.
- `src/schemas/reviewStop.ts` — `lastClose` records a refused close: `closing-answer-invalid` (exit 5) for a twice-refused answer, `close-error` step `closing-turn` (exit 5) for a provider error in the closing session, `network` (exit 14), `limit` (exit 8).
- `src/schemas/decisionRecord.ts` — A failed decision record names its failure: a session-outcome kind (`provider-error` among them), `answer-refused`, `artifact-changed` or `commit-failed`.
- `src/schemas/handDecisionAnswer.ts` — hand-decision-answer is a root union of a spec variant and a plan variant, exported with JSONSchema.make: the shape Codex strict refuses at the root.
- `src/schemas/phaxPlan.ts` — ExtractionAnswerSchema: `version: 1`, run, phases; no variant for the incomplete-plan report; unstamped and unpublished. This spec stamps it with `$schema` as a new published format.
- `src/schemas/planDocument.ts` — plan-document requires `sourceSpec` and `completesSpec`, each nullable, and couples them through a root `allOf`/`oneOf` over two open objects; its test-strategy `guarantee`, `oracle` and `criterion` carry lookahead patterns stacked under `allOf`.
- `packages/schemas/json/plan-document.schema.json` — The published plan-document schema: `minLength` throughout, `$schema` as a release pattern, the root `allOf`/`oneOf` pairing and six lookahead patterns; the extraction answer's test lines carry the same patterns.
- `packages/schemas/json/hand-decision-answer.schema.json` — A root `anyOf` of a spec and a plan variant, each closed with every key required; `minLength` on its strings.
- `docs/specs/archive/2610271007-headless-code-review.md` — `phax review-code --headless` decodes a version-1 code-review answer with no retry; a refused answer exits 1 with `Code review failed: answer refused: … To retry, run: …`.
- `src/app/reviewCode.ts` — `reviewCodeHeadless`: one read-only session granted `CODE_REVIEW_AGENT_COMMANDS`; a session that changed the worktree has those paths put back and is refused; an empty answer or a refused one fails with no retry.
- `src/domain/review/codeReviewPrompt.ts` — The headless prompt states the answer as a sketch of its keys (`{ "version": 1, "findings": [ … ] }`) with the lists of its severity, lens and escape ids, not as a JSON Schema.
- `src/schemas/codeReview.ts` — The answer is `version: 1` and findings; code-review.json carries `$schema` (born at 0.29.0) in place of `version`; no JSON Schema of the answer is exported. This spec makes the answer carry `$schema` too, so the answer and the file are one shape.
- `src/domain/security/agentCommands.ts` — `CODE_REVIEW_AGENT_COMMANDS`: the read-only git commands the headless code review is granted (`git log`, `git diff`, `git show`, `git status`, `git ls-files`, `git blame`).
- `src/app/reviewCompliance.ts` — The compliance session writes compliance-review.md and .json into `.phax-context/`; phax copies the Markdown as is; a missing, unparsable or undecodable JSON becomes verdict `unknown`; no retry; the session is not read-only.
- `src/domain/review/compliancePrompt.ts` — The prompt asks for free Markdown (verdict, per-phase findings, unplanned-change ledger, unmet-promise ledger, attention points) and a version-1 JSON verdict holding neither ledger.
- `src/schemas/complianceReview.ts` — The answer carries `version: 1`; compliance-review.json carries `$schema` (stamp 0.17.0) then verdict, summary, perPhase, attentionPoints, pointers; unknown keys refused.
- `src/cli/commands/reviewCompliance.ts` — `phax review-compliance <run>` prints `Verdict: unknown` when the JSON was missing or refused, and `Compliance review failed: … To retry, run: …` with exit 1 on a failure.
- `src/schemas/schemaUrl.ts` — A `$schema` stamp names a format of `FORMAT_IDS`; each format has its snapshots in packages/schemas, and `CURRENT_STAMPS` (src/schemas/release.ts) is generated from them, so a stamped answer is a published format.
- `src/schemas/release.ts` — PHAX_RELEASE is 0.32.0; compliance-review is stamped 0.17.0, hand-decision-answer 0.25.0, code-review 0.29.0 (born there); no format this spec changes has a `next` snapshot.

## 2. Problem

A wrong key, a wrong enum value, a wrong id or a missing `$schema` costs phax a whole session or a corrective turn, because the provider never sees the answer's schema as a constraint: the model reads it as prompt text and phax finds the mistake only once the session has ended. Both providers phax runs most can enforce a schema while generating, and phax does not use it. Nor could it hand them its answer schemas as they are: none fits Codex strict. Every one constrains strings with `minLength`; those that carry `$schema` state it as a release pattern, and the code-review and extraction answers carry `version` instead; hand-decision-answer is a root union; plan-document and the extraction answer carry lookahead patterns and stacked patterns (`allOf`) on their test lines, and plan-document pairs `sourceSpec` with `completesSpec` through a root `allOf`/`oneOf` over two open objects.

The compliance review is worse off. Its JSON verdict has no retry, and a bad or missing file is reported as `Verdict: unknown` with no reason, after a full review session has been paid for. Its Markdown is free prose the agent writes to disk, so it can disagree with the verdict, and the session needs write access for a review that should only read. The headless code review refuses its answer with no second chance, and the extraction fallback's incomplete-plan report sits outside its own schema, so no schema-enforcing provider could ever return it.

## 3. Product goal

Every agent call that returns a structured answer hands the provider the answer's own schema, enforced while the model generates, wherever the provider can, so shape mistakes are corrected by the provider inside the session instead of costing a corrective turn or a refused session. Each answer has one schema, made to fit Codex strict at the source: phax publishes it, hands it as is to Claude Code and Codex, and enforces it in its decoder together with the coherence checks no schema can express; that decoder stays the final judge on every provider. The compliance review becomes a structured answer like the others: read-only, with its corrective resume, and with both its files written by phax from the answer.

> The provider may shape the answer; only phax's decoder accepts it.

## 4. Terminology

- **structured answer** — The JSON document an agent call must return for phax to decode: spec-document, plan-document, the extraction answer, a revised document or hand-decision-answer (decide's handback and the `decide --verdicts` writer), first-reading, interactive-handoff, code-review and compliance-review.
- **answer schema** — The structured answer's one JSON Schema, exported with `JSONSchema.make` from the Effect schema phax's decoder enforces, and shaped to fit both Codex strict and what Claude Code's `--json-schema` accepts. Every answer is a published format, so it is the schema packages/schemas publishes for that format (and `phax artifact schema` prints for a spec or plan). phax hands it as is to Claude Code and Codex and states it in every prompt.
- **Codex strict** — OpenAI's strict structured-output subset, under which Codex sends `--output-schema`: closed objects with every key required, no root `anyOf`, no `oneOf`, `allOf`, `not` or conditionals, and strings constrained only by `pattern` and `format`.
- **coherence check** — A check phax's decoder runs beyond the answer schema, against the call's context or for a rule Codex strict cannot express: a criterion id exists in the source spec's sidecar, a verdict moves only presented questions, a revision names the sections it touches, a phase id is a phase of the run, a plan's `sourceSpec` and `completesSpec` are both set or both null.
- **phax's decoder** — The answer schema plus the call's coherence checks, and nothing else; the only judge of whether an answer is accepted.
- **native structured output** — A provider enforcing the answer schema while the model generates: Claude Code's `--json-schema`, Codex's `--output-schema`.
- **corrective resume** — The one resume of the same session that names phax's decoder refusal and asks for the whole answer again; a second refusal fails the call.
- **strict check** — The test over every answer schema that keeps it inside both Codex strict and what Claude Code's `--json-schema` accepts.
- **unplanned-change ledger** — The compliance answer's list of files touched beyond the plan, each with its phase and the reviewer's note.
- **unmet-promise ledger** — The compliance answer's list of promised tests or artifacts the reviewer did not find, each with its phase and note.

## 5. Functional requirements

### 5.1 Native structured output on Claude Code and Codex

WHERE a structured answer is asked of Claude Code or Codex THE system SHALL hand that provider the answer schema itself, as phax publishes it and unchanged except that Claude Code receives it without its root `$schema` property, which phax then sets on Claude Code's structured value from the call's own format stamp before decoding, on the first session and on its corrective resume, for each of the eight calls: headless spec and plan authoring, the plan-extraction fallback, decide's headless handback, the `decide --verdicts` writer, the interactive first turn, the interactive closing turn, the headless code review and the compliance review, except on Claude Code for a call that r-claude-fallback covers.

### 5.2 Mistral Vibe keeps the schema in the prompt

WHERE a structured answer is asked of Mistral Vibe THE system SHALL state the answer schema in the prompt, as every structured call does on every provider, the headless code review and the compliance review included, and judge the answer with phax's decoder and the corrective resume, an empty final answer counting as a decoder refusal (not JSON).

### 5.3 A Claude Code combination that does not work falls back to the prompt schema

WHERE Claude Code's `--json-schema` does not work with what a structured call needs (its resume, its read-only tools or stream-json) THE system SHALL run that call, on Claude Code alone, with the answer schema in the prompt only, no `--json-schema`, phax's decoder and the corrective resume, as on Mistral Vibe, while the same call on Codex keeps `--output-schema`.

### 5.4 Every answer schema fits Codex strict

The system shall shape every answer schema to fit Codex strict at the source, in the Effect schemas: closed objects with every key required, no root `anyOf`, no `oneOf` or `allOf`, no lookaround pattern, strings constrained only by `pattern` or `format`, and a required `$schema` as a `const` naming the format's current stamp.

### 5.5 The strict rewrite keeps every rule

The system shall move no rule out of phax's decoder when it rewrites an answer schema to fit Codex strict: a rule the strict subset cannot express becomes a coherence check, never dropped, and `minLength` becomes a `pattern` that accepts exactly the same strings.

### 5.6 The strict check

IF an answer schema uses a construct outside Codex's strict subset or outside what Claude Code's `--json-schema` accepts THEN the strict check SHALL fail, naming the answer and the construct.

### 5.7 The structured answer is what is decoded

WHEN a provider returns the answer as native structured output THE system SHALL decode that structured output, not the session's final text, and SHALL read a Claude Code success result that carries `structured_output` as an answer even when its `result` text is empty or absent, the session outcome carrying the structured value beside the text.

### 5.8 phax's decoder is the final judge

The system shall accept a structured answer only once phax's decoder, answer schema and coherence checks included, has accepted it, whatever the provider and whether or not the provider enforced a schema.

### 5.9 One corrective resume on a decoder refusal

WHEN phax's decoder refuses the answer of a call that has a session THE system SHALL resume that session once with the refusal, handing the same answer schema where r-native applies, and fail the call on a second refusal.

### 5.10 A provider that cannot meet the schema

IF the provider ends a session because the answer could not meet the answer schema (Claude Code's `error_max_structured_output_retries`) THEN the system SHALL report that session failure as the Provider failures spec reports a `provider-error`, SHALL NOT run the corrective resume, and SHALL NOT start a new session: on a resumed interactive closing turn this failure, recognised by the result subtype `error_max_structured_output_retries` alone, is not a lost session, so the closing turn's lost-session fallback does not apply and the stop records `lastClose` `close-error`, step `closing-turn`, exit 5.

### 5.11 The headless code review gains its corrective resume

WHEN phax's decoder refuses the first answer of the headless code review, at run end or by `phax review-code <run> --headless`, THE system SHALL print the refusal and resume the session once, instead of failing at the first refusal, while a session that changed the worktree still fails with its paths put back and no resume.

### 5.12 The extraction's incomplete-plan report is in its schema

WHEN the plan-extraction answer reports the plan incomplete, in the shape its answer schema describes, THE system SHALL fail the extraction naming what the answer says is missing.

### 5.13 The compliance review answers

The system shall take the compliance review's result from the session's structured answer, and shall not read any file the session writes.

### 5.14 The compliance session is read-only

The system shall run the compliance review session read-only on every provider, as it runs headless authoring, decide's handback and the headless code review, granting it the code review's read-only git commands (`CODE_REVIEW_AGENT_COMMANDS`) so that it can read the run's diff on every provider, Mistral Vibe included.

### 5.15 phax writes both compliance files

WHEN phax accepts a compliance answer THE system SHALL write compliance-review.json and compliance-review.md in the run folder, rendering the Markdown from the answer alone.

### 5.16 The ledgers are answer fields

The system shall require in every compliance answer an unplanned-change ledger and an unmet-promise ledger, each a possibly empty list.

### 5.17 The compliance answer covers the run's phases

IF a compliance answer's per-phase verdicts name a phase that is not a phase of the run, or omit or repeat one of the run's phases, THEN phax's decoder SHALL refuse the answer, naming the phase.

### 5.18 A refused compliance review is a failure

IF the compliance answer is refused after its corrective resume THEN the system SHALL report the compliance review failed, naming both refusals, write neither compliance file nor a records entry, and SHALL NOT report a verdict `unknown`.

### 5.19 compliance-review.json at 0.32.0

The system shall stamp compliance-review.json and the compliance answer with `$schema` at 0.32.0, carrying the two ledgers as required fields, and shall refuse a 0.32.0 compliance review that lacks either ledger.

## 6. Surface

### cli: phax review-compliance — indicative

Summary: A compliance review whose answer is wrong gets one more chance in the same session, and when it still fails phax says why instead of showing an unknown verdict.

before:

    $ phax review-compliance audio-export
    Verdict: unknown
    Compliance review: ~/.phax/runs/notebook.audio-export/compliance-review.md

after:

    $ phax review-compliance audio-export
    ⚠ compliance-review answer refused — perPhase: phase "phase-04" is not a phase of this run
      resuming the session once to ask for the whole answer again
    Verdict: conformant-with-deviations
    Compliance review: ~/.phax/runs/notebook.audio-export/compliance-review.md
    Recorded: notebook.audio-export/compliance-review (3fa91c0d)

    $ phax review-compliance audio-export
    ✗ Compliance review failed: compliance-review answer rejected twice — first answer: perPhase: phase "phase-02" is missing; retry: perPhase: phase "phase-02" is missing. To retry, run: phax review-compliance audio-export
    $? = 1

### file: compliance-review.json — normative

Summary: The compliance review now lists the files changed beyond the plan and the promised tests that are missing, alongside its verdict.

before:

    {
      "$schema": "https://docs.phax.run/schemas/compliance-review/0.17.0.json",
      "verdict": "conformant-with-deviations",
      "summary": "All four phases delivered; phase-02 skipped one promised test.",
      "perPhase": [ … ],
      "attentionPoints": [ "Confirm the retry backoff with the audio team." ],
      "pointers": []
    }

after:

    {
      "$schema": "https://docs.phax.run/schemas/compliance-review/0.32.0.json",
      "verdict": "conformant-with-deviations",
      "summary": "All four phases delivered; phase-02 skipped one promised test.",
      "perPhase": [ … ],
      "unplannedChanges": [
        { "phaseId": "phase-02", "path": "src/export/backoff.ts", "note": "Shared helper, justified in the handoff." }
      ],
      "unmetPromises": [
        { "phaseId": "phase-02", "promise": "integration test: export retries on 503", "note": "Not found in tests/integration." }
      ],
      "attentionPoints": [ "Confirm the retry backoff with the audio team." ],
      "pointers": []
    }

### file: compliance-review.md — indicative

Summary: The compliance review's Markdown is written by phax from the review itself, so it always matches the verdict and keeps the same sections from run to run.

before:

    (free prose written by the review agent, in its own layout)

after:

    # Compliance review — notebook.audio-export

    Verdict: conformant-with-deviations

    All four phases delivered; phase-02 skipped one promised test.

    ## phase-02 — conformant-with-deviations

    - tests · deviation — The promised integration test for export retries is missing.

    ## Unplanned changes

    - phase-02 · src/export/backoff.ts — Shared helper, justified in the handoff.

    ## Unmet promises

    - phase-02 · integration test: export retries on 503 — Not found in tests/integration.

    ## Attention points

    - Confirm the retry backoff with the audio team.

    ## Pointers

    None.

### cli: phax review-code --headless — indicative

Summary: A headless code review whose answer is refused is asked once more in the same session instead of failing straight away.

before:

    $ phax review-code greet-cli --headless
    Code review failed: answer refused: findings[0].lens: "security" is not a lens (expected one of surface, acceptance, boundary, core, edge, tests, architecture, docs). To retry, run: phax review-code greet-cli --headless
    $? = 1

after:

    $ phax review-code greet-cli --headless
    ⚠ code-review answer refused — findings[0].lens: "security" is not a lens (expected one of surface, acceptance, boundary, core, edge, tests, architecture, docs)
      resuming the session once to ask for the whole answer again
    Code review: 2 findings (1 bug, 1 concern)
    Findings: ~/.phax/runs/notebook.greet-cli/code-review.json
    Fix them in the session: phax review-code greet-cli

### cli: phax artifact new spec --headless (on Claude Code or Codex) — indicative

Summary: Headless authoring, decide and review sessions on Claude Code and Codex no longer stop on a wrongly shaped answer: the provider fixes the shape while it writes.

before:

    $ phax artifact new spec audio-export --headless --brief brief.md
    ⚠ spec document refused — requirements[2].pattern: "conditional" is not one of ubiquitous, event, state, unwanted, optional
      resuming the session once to ask for the whole document again
    Wrote docs/specs/2610271600-audio-export.md

after:

    $ phax artifact new spec audio-export --headless --brief brief.md
    Wrote docs/specs/2610271600-audio-export.md

### internal: answer schema handed to Claude Code and Codex — indicative

Summary: Claude Code and Codex receive, with every structured call, the answer's published schema, which they enforce while generating.

before:

    claude --print --output-format stream-json --verbose --model claude-opus-5-5 …
    codex exec -C <worktree> …

after:

    claude --print --output-format stream-json --verbose --json-schema '{"type":"object","additionalProperties":false,"required":["$schema","kind","decisions","markdown"],"properties":{"$schema":{"const":"https://docs.phax.run/schemas/hand-decision-answer/0.32.0.json"},"kind":{"const":"spec"},…}}' --model claude-opus-5-5 …
      (the spec answer of a decide handback: its own closed object, not one branch of a root union)
    codex exec -C <worktree> --output-schema ~/.phax/decide/2610271200-audio-export/02/answer.schema.json …
      (the file holds the same published answer schema)
    vibe … (no schema option: the schema stays in the prompt)

### cli: phax artifact schema plan — indicative

Summary: The published plan schema now follows the strict rules Claude Code and Codex enforce: `sourceSpec` and `completesSpec` stay required and nullable, and phax checks that they go together instead of the schema.

before:

    $ phax artifact schema plan
    {
      "$defs": { "NonEmptyString": { "type": "string", "minLength": 1 } },
      "required": [ "$schema", "kind", "sourceSpec", "completesSpec", "run", "preamble", "phases" ],
      "properties": {
        "$schema": { "type": "string", "pattern": "^https:\\/\\/docs\\.phax\\.run\\/schemas\\/plan-document\\/…\\.json$" },
        "sourceSpec": { "anyOf": [ { "$ref": "#/$defs/NonEmptyString" }, { "type": "null" } ] },
        "completesSpec": { "anyOf": [ { "type": "boolean" }, { "type": "null" } ] },
        …
      },
      "allOf": [ { "oneOf": [
        { "properties": { "sourceSpec": { "type": "string", "minLength": 1 }, "completesSpec": { "type": "boolean" } } },
        { "properties": { "sourceSpec": { "type": "null" }, "completesSpec": { "type": "null" } } }
      ] } ]
    }

after:

    $ phax artifact schema plan
    {
      "$defs": { "NonEmptyString": { "type": "string", "pattern": "^[\\s\\S]+$" } },
      "required": [ "$schema", "kind", "sourceSpec", "completesSpec", "run", "preamble", "phases" ],
      "properties": {
        "$schema": { "const": "https://docs.phax.run/schemas/plan-document/0.32.0.json" },
        "sourceSpec": { "anyOf": [ { "$ref": "#/$defs/NonEmptyString" }, { "type": "null" } ] },
        "completesSpec": { "anyOf": [ { "type": "boolean" }, { "type": "null" } ] },
        …
      }
    }

### internal: plan-extraction answer — indicative

Summary: The extraction model reports an incomplete plan inside the answer's own schema, so a schema-enforcing provider can return it.

before:

    { "version": 1, "run": { … }, "phases": [ … ] }
    { "error": "phase-03: the Test strategy item 'covers retries' is not in the line format" }   (outside the schema)

after:

    { "$schema": "https://docs.phax.run/schemas/phax-plan-extraction/0.32.0.json", "plan": { "run": { … }, "phases": [ … ] }, "incomplete": null }
    { "$schema": "https://docs.phax.run/schemas/phax-plan-extraction/0.32.0.json", "plan": null, "incomplete": "phase-03: the Test strategy item 'covers retries' is not in the line format" }

## 7. Non-goals

- Interactive sessions, phase turns, fix attempts and the windows probe: they return no structured answer.
- The external providers (oracles, brief, architecture, plan auditor): their requests and answers keep their own contracts.
- The phase handoff: it stays Markdown written by the phase; making it a structured answer is a later spec, because every later phase reads it.
- Any change to how Mistral Vibe confines a session: Vibe honours `readOnly` since the spec "Mistral Vibe 3" (a read-only session enables only `read_file` and `grep`, plus `bash` for its granted commands), and this spec relies on it as it is.
- A corrective turn for the plan-extraction fallback: it stays a sealed completion with no session and one attempt.
- More than one corrective resume, or a corrective resume after a session failure: a provider failure, whether it ends the first session or the corrective resume, is reported as the Provider failures spec reports it (exit 14 for `network` on every command; otherwise exit 1 for `phax review-compliance` and `phax review-code --headless`, and 8 for a limit or 5 for any other kind on authoring and decide).
- A second schema per answer for the providers, derived or hand-written: each answer has one schema. Any change to an answer schema beyond the strictness rewrite, hand-decision-answer losing its root union, `$schema` in place of `version` in the code-review and extraction answers, the compliance review's ledgers and the extraction answer's incomplete report.
- Reading compliance-review files the session writes, or keeping the agent's own Markdown prose: phax writes both files.
- Back-compat for compliance-review.json: a 0.32.0 file without the ledgers is refused, never defaulted.

## 8. Acceptance criteria

### Claude Code gets the answer schema, on the resume too

Given a headless spec authoring session on Claude Code whose first answer phax's decoder refuses, when `phax artifact new spec <slug> --headless --brief <file>` runs, then both the first session's and the corrective resume's argv carry `--json-schema` with the spec-document answer schema as published minus its root `$schema` property, the resume carries `--resume` with the first session's id, and the accepted structured value is decoded with the spec-document `$schema` stamp phax set on it. (refs §5.1, §5.9)

### Codex gets the answer schema on exec and exec resume

Given a `decide --verdicts` writer on a headless spec, routed to Codex, whose first answer is refused, when the writer runs, then `codex exec` and `codex exec resume` each carry `--output-schema` naming a file whose content is the published answer schema of the revised spec-document it expects. (refs §5.1, §5.9)

### Every structured call hands its answer schema

Given each of the eight structured calls run against a recording fake of each provider it can be routed to (Claude Code alone for the plan-extraction fallback and decide's handback), when each call runs, then each spawn on Claude Code or Codex carries that answer's schema, except a Claude Code spawn of a call that falls back to the prompt schema there, and no call that returns no structured answer (phase turn, fix turn, windows probe) carries one, and every prompt, on every provider, holds the answer schema, the headless code review's and the compliance review's included. (refs §5.1, §5.3, §5.2)

### Vibe keeps the prompt schema and the corrective resume

Given a compliance review routed to Mistral Vibe whose first answer omits `unmetPromises`, when the review runs, then the prompt holds the compliance-review answer schema, the argv holds no schema option, the refusal resumes the session once, and the retry's accepted answer is written. (refs §5.2, §5.9)

### An empty Vibe answer is resumed once

Given a headless code review routed to Mistral Vibe whose first final answer is empty and whose retry is accepted, when `phax review-code <run> --headless` runs, then phax refuses the empty answer as not JSON, prints the refusal, resumes the session once and writes code-review.json from the retry. (refs §5.2, §5.9, §5.11)

### A Claude Code fallback is named and keeps the corrective resume

Given a structured call that falls back to the prompt schema on Claude Code, whose first answer phax's decoder refuses, when the call runs against a recording fake of Claude Code and, where it can be routed there, of Codex, then the Claude Code argv holds no `--json-schema`, its prompt holds the answer schema, the refusal resumes the session once, and the Codex spawn carries `--output-schema`. (refs §5.3, §5.9)

### Every answer schema fits Codex strict

Given the answer schema of every structured answer, as phax publishes it and hands it to the providers, when the strict check inspects each, then each is a closed object with every key required, holds no root `anyOf`, no `oneOf` or `allOf`, no lookaround pattern and no string constraint but `pattern` or `format`, carries a required `$schema` `const`, and passes both Claude Code's and Codex strict's rules. (refs §5.4, §5.6)

### The strict rewrite keeps every rule

Given every answer fixture each answer's decoder refused or accepted before the strictness rewrite, when each fixture is decoded again by phax's decoder after it, then every fixture refused before is still refused, by the answer schema or a coherence check, naming the field, and every fixture accepted before is still accepted, except the documented shape changes: hand-decision-answer without its root union, plan-document's nullable `sourceSpec`/`completesSpec` pair checked as a coherence check, `$schema` as a `const`, and `$schema` in place of `version` in the code-review and extraction answers. (refs §5.5)

### The strict check names the bad construct

Given an answer schema whose string field carries a lookahead pattern, when the strict check runs, then it fails naming the answer and the lookahead pattern. (refs §5.6)

### An answer without `$schema` is refused

Given a headless code review whose first answer is `{"version": 1, "findings": []}`, and an extraction answer that carries `version` and no `$schema`, when phax decodes each, then it refuses each naming the missing `$schema` and the unknown `version` key; the code review resumes its session once, and the extraction fails with no retry. (refs §5.4, §5.8)

### structured_output is what phax decodes

Given a Claude Code result event whose `structured_output` holds a valid first-reading answer and whose `result` text is prose, when the interactive first turn's outcome is read, then phax accepts the `structured_output` answer and never parses the prose; a success result whose `structured_output` is valid and whose `result` text is empty is read as an answer too. (refs §5.7)

### A schema-valid answer can still be refused

Given a headless spec authoring session on Claude Code whose answer matches the spec-document answer schema but one of whose acceptance criteria refs a requirement id the document does not hold, when `phax artifact new spec <slug> --headless --brief <file>` runs, then phax refuses the answer naming that ref, prints the refusal and resumes the session once, and writes the spec only from an accepted retry. (refs §5.8, §5.9)

### A refused code review is asked once more

Given a headless code review whose first answer carries the code-review `$schema` but holds `"lens": "security"`, outside its closed set, and whose retry is accepted, when `phax review-code <run> --headless` runs, and when the same review runs at run end, then phax prints the refusal and resumes the session once, writes code-review.json from the retry, and the by-hand review exits 0. (refs §5.11, §5.9)

### A code review refused twice fails

Given a headless code review whose first answer and retry are both refused, when `phax review-code <run> --headless` runs, then it exits 1 naming both refusals and the retry command, and leaves code-review.json and code-review-session.json as they were. (refs §5.11, §5.9)

### Provider retries exhausted is a session failure

Given a Claude Code session that ends with an error result of subtype `error_max_structured_output_retries`: a headless spec authoring session, a `decide --verdicts` writer and a resumed interactive closing turn, when phax reads each outcome, then authoring prints a line starting `✗ claude-code session failed (provider-error):` naming `error_max_structured_output_retries`, exits 5 and runs no corrective resume; decide's record names its failure `provider-error`, not `answer-refused`; and the closing turn starts no new closing session and records `lastClose` `close-error`, step `closing-turn`, exit 5. (refs §5.10)

### An incomplete plan is reported inside the schema

Given a plan.md whose Test strategy item is not in the line format, and an extraction answer stamped with the extraction format's `$schema`, with `plan: null` and an `incomplete` reason, when the extraction fallback runs on Claude Code, then the call carries the extraction answer schema and phax fails with `The extraction model found the plan incomplete:` followed by that reason. (refs §5.12, §5.1)

### The compliance session writes nothing

Given a compliance review on each provider it can be routed to (Claude Code, Codex and Mistral Vibe), when the review runs, then the session is spawned read-only with the code review's read-only git commands and no other shell, nothing is written under the worktree's `.phax-context/`, and phax writes compliance-review.json and compliance-review.md in the run folder from the answer. (refs §5.13, §5.14, §5.15)

### The Markdown is the answer's rendering

Given one accepted compliance answer, when phax writes compliance-review.md twice from it, then both files are byte-identical and hold the verdict, the summary, one section per phase, `## Unplanned changes`, `## Unmet promises`, `## Attention points` and `## Pointers`, with `None.` for an empty list. (refs §5.15, §5.16)

### A compliance answer must cover the run's phases

Given a run of phases phase-01 to phase-03 and a compliance answer whose perPhase names phase-01, phase-02 and phase-04, when phax decodes it, then it refuses the answer naming phase-04 and the missing phase-03, and resumes the session once. (refs §5.17, §5.9)

### No more unknown verdicts

Given a compliance review whose answer and retry are both refused, when `phax review-compliance <run>` runs, then it prints `Compliance review failed: compliance-review answer rejected twice — first answer: …; retry: …` and the retry command, exits 1, writes neither compliance file nor a records entry, and never prints `Verdict: unknown`. (refs §5.18)

### compliance-review.json at 0.32.0

Given an accepted compliance answer, when phax writes compliance-review.json, then the file starts with `"$schema": "https://docs.phax.run/schemas/compliance-review/0.32.0.json"` and carries `unplannedChanges` and `unmetPromises`; a 0.32.0 file without `unmetPromises` is refused when read. (refs §5.19, §5.16)

## 9. Open questions

None.

## 9b. Arbitrated questions

### q-unsupported-combination — If the smoke test shows that Claude Code's `--json-schema` does not work with `--resume`, `--tools` or stream-json for a given call, what does that call do on Claude Code?

- prompt-fallback — That call, on Claude Code only, stays on the schema in the prompt plus phax's decoder and the corrective resume, like Vibe, and the per-provider table names it — abandons: One path for every structured call on Claude Code: the affected calls (likely decide's handback and every corrective resume) keep paying a corrective turn for shape mistakes.
- hold-the-call — The spec does not ship native structured output for that call on either provider until Claude Code supports the combination — abandons: Codex's native structured output for that call, which works today, held back for a Claude Code gap.

Recommendation: prompt-fallback — phax's decoder and the corrective resume already judge every answer, so a call left on the prompt schema loses only the saving, not correctness; holding Codex back for a Claude Code gap gives up a gain that is already there. The fallback is per call and per provider, named and tested, never silent.

Decision: prompt-fallback — by operator (Rémy Loubradou), 2026-10-27
Why: phax's decoder and the corrective resume already judge every answer, so a call left on the prompt schema loses only the saving, not correctness; holding Codex back for a Claude Code gap gives up a gain that is already there. The fallback is per call and per provider, named and tested, never silent. Advocate: The strongest case for hold-the-call: one behavior per call across providers is easier to reason about, and a call that silently differs on Claude Code splits the test matrix and hides a gap that should be fixed upstream. Principles: S1. Reversibility: cheap. Revised: none.

### q-compliance-prose — The compliance Markdown is now rendered by phax from the answer. What happens to the reviewer's free prose?

- fields-only — The Markdown is rendered from the answer's fields alone; the two ledgers become required fields; the only prose is the summary, the finding messages and the ledger notes — abandons: The reviewer's free narrative: any reasoning that fits no field, beyond the one-paragraph summary, is no longer kept.
- narrative-field — The answer also carries a required `narrative` Markdown string that phax places verbatim after the verdict — abandons: A Markdown that is only a view of the checked answer: the narrative can contradict the verdict again, and the records keep a block of text no decoder can check.

Recommendation: fields-only — The compliance review is advisory and read beside the verdict; what made it unreliable is prose that could disagree with the JSON. The ledgers were the structured part of that prose and become fields; the summary and per-finding messages keep room for the reviewer's words.

Decision: fields-only — by operator (Rémy Loubradou), 2026-10-27
Why: The compliance review is advisory and read beside the verdict; what made it unreliable is prose that could disagree with the JSON. The ledgers were the structured part of that prose and become fields; the summary and per-finding messages keep room for the reviewer's words. Advocate: The strongest case for narrative-field: a reviewer's reasoning often fits no field, and a required narrative keeps that judgment for the human reader instead of discarding it. Principles: S1, S5. Reversibility: cheap. Revised: none.

## 10. Implementation-planning note

Settled:

- Prerequisite: the spec "Provider failures" ships first; the structured answer is the answer side of its session outcome, and `error_max_structured_output_retries` stays its `provider-error`.
- Two validations of one schema: the answer schema, enforced by Claude Code and Codex while generating, and phax's decoder (the same answer schema plus the coherence checks, and nothing else), the only judge on every provider.
- One schema per structured answer, the answer schema, made to fit Codex strict at the source in the Effect schemas: phax publishes it (`phax artifact schema`, packages/schemas), hands it as is to Claude Code (`--json-schema`) and Codex (`--output-schema`), and its decoder enforces it. Codex strict stays the bar: it keeps the schemas honest.
- hand-decision-answer loses its root union: the call always knows the kind it expects, and no answer schema is a root union.
- The strictness rewrite moves no rule out of phax's decoder: `minLength` becomes a `pattern` accepting exactly the same strings (for example `^[\s\S]+$`); plan-document's `sourceSpec`/`completesSpec` pairing becomes a coherence check, both fields staying required and nullable; each lookahead pattern on a test line's `guarantee`, `oracle` and `criterion`, in plan-document and the extraction answer, is rewritten without lookaround or moves to a coherence check, and a field's stacked patterns (`allOf`) become one.
- `$schema` in every answer schema becomes a required `const` naming the format's current stamp, in place of today's release pattern (confirmed by the operator on 2026-10-30); a document stamped earlier is read through the versioned history, as today.
- The headless code review's answer and the plan-extraction answer carry a required `$schema` const in place of `version`, like every other answer. The code-review answer schema is the published `code-review` format's, answer and file one shape, with a `next` snapshot at 0.32.0. The extraction answer becomes a published format, `phax-plan-extraction` (the plan may name it otherwise), born at 0.32.0: a `$schema` stamp names a format of `FORMAT_IDS`, whose snapshots packages/schemas publishes. No shims: an answer without `$schema`, or with `version`, is refused.
- The answer schema fits both Codex strict and what Claude Code's `--json-schema` accepts: a rule either provider refuses, as the smoke test shows, becomes a coherence check for both providers, never a provider-only schema. The one exception is the root `$schema` property: Claude Code's `--json-schema` refuses every property key outside `^[a-zA-Z0-9_.-]{1,64}$` with an API 400 (probed on Claude Code 2.1.314 on 2026-10-30), so Claude Code receives the answer schema without it, and phax sets the call's own `$schema` stamp on the structured value before decoding; Codex and Mistral Vibe receive the schema whole.
- Formats whose published schema changes get a `next` snapshot stamped 0.32.0; `spec-document` and `plan-document` sidecars, if their stamps change, go through `phax artifact migrate-documents`; no shims.
- The prompt keeps stating the answer schema on every provider, and the coherence checks in words: Vibe has no schema option, and on Claude Code and Codex the model must still know the rules no schema expresses. The headless code review and the compliance review, whose prompts carry only a sketch today, export their answers' JSON Schema with `JSONSchema.make` and state it in their prompts like the other calls.
- Mistral Vibe stays on the prompt schema, phax's decoder and the corrective resume; an empty final answer on Vibe is a decoder refusal (not JSON), as in authoring, and gets the one corrective resume. On Claude Code and Codex an empty answer never reaches the decoder: a Claude Code success result with neither `structured_output` nor text, and a blank Codex answer, are `provider-error`s.
- q-unsupported-combination (prompt-fallback): a structured call whose Claude Code combination fails the smoke test stays, on Claude Code only, on the prompt schema, phax's decoder and the corrective resume; the plan names each such call, the docs page's per-provider table lists it, and a test pins it; never a silent fallback.
- The corrective resume stays one, for every call that has a session; the headless code review and the compliance review gain it; the extraction fallback keeps one attempt; the spec "headless code review" fails a refused answer (at run end and by hand) only after that resume. A code review session that changed the worktree is not a resume case: it still fails with its paths put back.
- The compliance session is read-only on every provider, granted the code review's read-only git commands, and returns its answer; phax writes compliance-review.json and compliance-review.md in the run folder; nothing is read from `.phax-context/`; `structuredVerdictMissing` and verdict `unknown` disappear.
- The compliance session gets no worktree snapshot or put-back guard: that guard was for a provider that ignored `readOnly`, and every provider now honours it. The headless code review keeps its existing guard; this spec does not touch it.
- No new session after a provider-side failure: a resumed closing turn that fails with `error_max_structured_output_retries` is not a lost session (that subtype alone marks it: any other `provider-error` keeps today's lost-session fallback); no new closing session starts, and the stop records `lastClose` `close-error`, step `closing-turn`, exit 5.
- A session failure in the first session or in the corrective resume is reported as the Provider failures spec reports it, never as a refusal: exit 14 for `network` on every command; otherwise exit 1 for the two review commands, and 8 for a limit or 5 for any other kind on authoring and decide.
- q-compliance-prose (fields-only): compliance-review.md is rendered from the answer's fields alone; the reviewer's words live in the summary, the finding messages and the ledger notes, and the answer has no free narrative field.
- compliance-review.md keeps its name and place in the run folder, so the review handoff still embeds it under `## Plan compliance review`; the pull request's verdict and `### Compliance attention points`, the headless code review's prompt and the compliance-review records entry read the 0.32.0 compliance-review.json; a 0.17.0 or pre-schema file in an older run folder still reads through the versioned history.
- compliance-review is stamped 0.32.0, with `unplannedChanges` and `unmetPromises` required, and the answer carries `$schema` in place of `version: 1`; no shims.
- The phase handoff stays Markdown.
- Plans: one spec, two plans. Plan 1 ships the strict answer schemas (the `$schema` const on the code-review and extraction answers included), native structured output, the corrective resumes, the extraction answer, the Vibe empty answer and the code review's resume; it covers every criterion but the plan-2 ones below, and ac-every-call for the seven calls other than the compliance review. Plan 2 ships the structured compliance review (§5.13–§5.19, the `phax review-compliance`, compliance-review.json and compliance-review.md surfaces) and completes the spec; its criteria are ac-vibe, ac-cr-readonly, ac-cr-render, ac-cr-phases, ac-cr-refused and ac-cr-file, plus ac-every-call for the compliance review. The compliance-review answer is designed strict from the start.
- Probed on 2026-10-30 (Claude Code 2.1.314 on Haiku, codex-cli 0.165.0 on gpt-6-luna): Claude Code's `--json-schema` accepts `minItems` above 1, `exclusiveMinimum`, `minLength`, patterns, `$defs`/`$ref`, a nullable field and Effect's `{type, enum, const}` render, enforces them client-side through its StructuredOutput tool, and works with stream-json, read-only tools and `--resume`; when the model cannot meet the schema the session ends `success` with no `structured_output` and a prose `result`, which phax's decoder refuses as not JSON and resumes once. Codex strict accepts the same constructs (it also enforced `minLength`, against OpenAI's documentation) and refuses lookaround patterns, a root `anyOf` and an optional key; `codex exec resume` takes `--output-schema`.

Left open:

- Where Codex's schema file is written (the session or decide folder is suggested) and how a large schema is passed inline to Claude Code.
- The extraction answer's exact shape for its incomplete report (the `$schema`, `plan` and `incomplete` sketch is indicative).
- Whether the strict check tests against the providers' own validators or a local encoding of their rules.
- The corrective resume's transcript for the compliance review and the headless code review: each keeps one stream file today, and a Vibe turn deletes the export beside its transcript, so the resume needs its own file (decide uses `retry-output.jsonl`, the closing turn `<label>-retry.jsonl`).
- hand-decision-answer's exact shape without a root union: two named shapes (a spec answer and a plan answer) or one closed object.
- For each lookahead pattern on a test line (`guarantee`, `oracle`, `criterion`, six in plan-document and the same in the extraction answer): a rewrite without lookaround, or a coherence check.
- Which rules Claude Code's `--json-schema` refuses beyond Codex strict: the Claude API's structured outputs refuse `minItems` above 1 (spec and plan `options` require 2) and numeric bounds (code-review `line` is `exclusiveMinimum` 0). The smoke test shows whether Claude Code refuses them too; each rule it refuses moves to a coherence check for both providers.

Constraints:

- Target versions: Claude Code 2.1.314, codex-cli 0.165.0, Mistral Vibe 3.0.3; on 2026-10-30 `claude --help` lists `--json-schema <schema>`, and `codex exec --help` and `codex exec resume --help` list `--output-schema <FILE>`.
- Smoke-test Claude Code's `--json-schema` once per schema with `--resume`, with tools and with stream-json, in the real e2e tier; a failed combination falls back as r-claude-fallback states.
- Every structured call goes through the Provider failures session-outcome reader; no call reads `finalText` once a structured answer is present.
- The compliance-review format bump goes through packages/schemas snapshots and CURRENT_STAMPS like every persisted format (a `next` snapshot, stamped with PHAX_RELEASE 0.32.0); older compliance reviews are read only through the versioned history.
- A `compliance-review.json` stamped before 0.32.0 is read through the versioned history into its own shape, never lifted with empty ledgers; a reader that needs the ledgers treats such a file as having none and says so, and today's readers (the pull request body, the code-review prompt, the records entry) keep reading only the fields both shapes carry.
- The answer schemas `phax artifact schema` prints and packages/schemas publishes are the contract and what the providers receive; there is no provider-only schema beyond Claude Code's copy without its root `$schema` property; every other property key of an answer schema matches `^[a-zA-Z0-9_.-]{1,64}$`, which the strict check enforces.
- Keep the change to the Mistral Vibe adapter to what r-vibe needs.

## 11. Docs page

Page: Structured answers and providers

Reader: An operator choosing which provider runs authoring, decide and review roles, who wants to know what each provider checks and what phax checks after it.

Example: A per-provider table for the eight structured calls (Claude Code `--json-schema`, Codex `--output-schema`, Vibe schema in the prompt, and any call that falls back to the prompt schema on Claude Code), then one refused compliance answer: the answer schema let it through, phax's coherence check refused it for naming a phase that is not in the run, and the corrective resume fixed it.

## 12. Decision log

- 2026-10-27 q-unsupported-combination decided prompt-fallback — operator (Rémy Loubradou)
- 2026-10-27 q-compliance-prose decided fields-only — operator (Rémy Loubradou)
