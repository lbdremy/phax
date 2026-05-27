# PHAX Feature Spec — Feedback Ingest

## Document status

This document specifies a dedicated PHAX feature: `phax feedback ingest`.

It is intentionally focused on one capability: capturing command output from agent-driven feedback loops without changing the command execution model.

This feature is separate from deterministic PHAX gates.

---

# 1. Goal

Add a streaming feedback ingestion command to PHAX.

The goal is to let commands executed by an AI agent during a phase be visible to the agent while also being recorded by PHAX for later analysis.

The command should behave like a context-aware `tee`:

```txt
command stdout/stderr
  → visible to the agent
  → optionally captured by PHAX when running inside a PHAX phase
```

This allows PHAX to preserve evidence of intermediate failures that the agent fixes during its own feedback loop.

These failures are often invisible in final review because the deterministic gates pass after the agent has corrected them.

---

# 2. Problem

During a PHAX phase, the agent may run commands such as:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm audit:architecture
pnpm build
```

The agent reads the output, fixes the code, and runs the command again.

If the final deterministic PHAX gates pass, the user may never see the intermediate failures.

This hides valuable learning signals:

```txt
recurring TypeScript errors
recurring architecture boundary violations
recurring missing schema validation
recurring test failures
recurring lint failures
recurring handoff format issues
```

Those signals are useful for improving:

- STEME guidance;
- PHAX skills;
- architecture audit rules;
- planning prompts;
- repository conventions;
- diagnostics shown to agents.

---

# 3. Non-goals

This feature must not:

- replace deterministic PHAX gates;
- execute commands itself in the MVP;
- wrap all shell commands automatically;
- intercept the whole shell session;
- require a terminal UI;
- call an LLM during ingestion;
- classify logs with an LLM on the hot path;
- hide or alter command output;
- change command exit semantics intentionally.

A future command such as `phax feedback run -- <command>` may execute commands directly, but this spec focuses on `feedback ingest` only.

---

# 4. Command

Primary command:

```bash
phax feedback ingest --command "pnpm test" --kind test
```

Usage with a command pipeline:

```bash
set -o pipefail
pnpm test 2>&1 | phax feedback ingest --command "pnpm test" --kind test
```

The command must:

1. read from `stdin` as a stream;
2. immediately write the same bytes to `stdout`;
3. when PHAX context is active, also write the stream to PHAX feedback logs;
4. when PHAX context is inactive, behave as a pure pass-through;
5. avoid buffering the full output in memory.

---

# 5. Context-aware behavior

`phax feedback ingest` must behave differently depending on environment context.

## Outside a PHAX phase

If no active PHAX phase context is detected, the command must be a no-op pass-through:

```txt
stdin
  → stdout
```

It must not:

- create files;
- write into `~/.phax`;
- create feedback events;
- fail because PHAX metadata is missing.

This allows users to keep the command in scripts without polluting PHAX state during normal manual usage.

## Inside a PHAX phase

When PHAX launches Claude Code for a phase, it should inject environment variables such as:

```bash
PHAX_ACTIVE=1
PHAX_RUN=auth-refactor
PHAX_PHASE=phase-02
PHAX_HOME=/Users/remy/.phax
PHAX_FEEDBACK_CAPTURE=1
PHAX_FEEDBACK_DIR=/Users/remy/.phax/runs/auth-refactor/phase-02/feedback
```

If `PHAX_ACTIVE=1` and `PHAX_FEEDBACK_CAPTURE=1`, `phax feedback ingest` must:

```txt
stdin
  → stdout
  → feedback log file
  → feedback event metadata
```

---

# 6. Environment variables

Required variables for capture mode:

```txt
PHAX_ACTIVE=1
PHAX_RUN=<short-name>
PHAX_PHASE=<phase-id>
PHAX_FEEDBACK_CAPTURE=1
PHAX_FEEDBACK_DIR=<absolute feedback directory>
```

Optional variables:

```txt
PHAX_HOME=<absolute phax home directory>
PHAX_WORKTREE=<absolute phase worktree path>
PHAX_SESSION_ID=<claude session id if available>
PHAX_TRACE=1
PHAX_VERBOSE=1
```

Behavior rules:

- if `PHAX_ACTIVE` is missing or not `1`, pass-through only;
- if `PHAX_FEEDBACK_CAPTURE` is missing or not `1`, pass-through only;
- if required capture variables are invalid, pass-through and emit a warning only when verbose mode is active;
- invalid PHAX context must not break the user’s command pipeline;
- capture mode must validate all environment variables before writing files.

---

# 7. Streaming implementation requirements

The implementation must use streaming.

It must not read the full stdin into memory.

Required behavior:

```txt
for each chunk from stdin:
  write chunk to stdout
  if capture enabled:
    write chunk to log file
```

The implementation must respect backpressure as much as practical in Node.js.

The hot path should do only minimal work:

- stream copying;
- log file writing;
- byte counting;
- line counting if cheap;
- metadata collection.

The hot path must not:

- parse large logs fully;
- run regex classification over the entire stream continuously;
- call external commands;
- call an LLM;
- write many small JSON events per line unless explicitly configured.

Post-processing and classification can happen later.

---

# 8. Output streams

The MVP may use a merged stream model:

```bash
pnpm test 2>&1 | phax feedback ingest --command "pnpm test" --kind test
```

In this mode, stdout and stderr from the original command are already merged before PHAX receives them.

Therefore, `phax feedback ingest` records the stream as a combined output log.

Recommended MVP log name:

```txt
combined.log
```

A future `phax feedback run -- <command>` command may capture stdout and stderr separately because it will execute the command itself.

---

# 9. Exit code semantics

`phax feedback ingest` cannot reliably know the exit code of the command that produced the upstream pipe.

Therefore:

- `feedback ingest` should return success if ingestion itself succeeds;
- the caller must use shell `pipefail` when they need the pipeline to fail if the original command failed;
- the phase prompt should instruct agents to use `set -o pipefail` or an equivalent shell pattern.

Recommended agent instruction:

```bash
set -o pipefail
pnpm test 2>&1 | phax feedback ingest --command "pnpm test" --kind test
```

Important limitation:

```txt
feedback ingest captures logs, but it is not authoritative for the original command exit code.
```

For authoritative exit code capture, a later command should be introduced:

```bash
phax feedback run -- pnpm test
```

---

# 10. Feedback artifacts

When capture mode is active, PHAX should write artifacts under:

```txt
~/.phax/runs/<short-name>/phase-<id>/feedback/
```

Suggested structure:

```txt
feedback/
  feedback-events.jsonl
  commands/
    001-pnpm-test/
      combined.log
      meta.json
    002-pnpm-typecheck/
      combined.log
      meta.json
```

The command index should be monotonic within the phase.

The command directory name should be filesystem-safe and derived from:

```txt
<sequence>-<sanitized-command-or-kind>
```

Example:

```txt
001-pnpm-test
002-pnpm-typecheck
003-pnpm-audit-architecture
```

---

# 11. Metadata

Each captured command should write a `meta.json` file.

Example:

```json
{
  "version": 1,
  "run": "auth-refactor",
  "phase": "phase-02",
  "source": "agent-command",
  "command": "pnpm test",
  "kind": "test",
  "startedAt": "2026-05-11T10:12:00Z",
  "endedAt": "2026-05-11T10:12:31Z",
  "durationMs": 31000,
  "combinedLogPath": "commands/001-pnpm-test/combined.log",
  "bytes": 48192,
  "lines": 930,
  "exitCode": null,
  "exitCodeKnown": false,
  "cwd": "/path/to/worktree",
  "claudeSessionId": "..."
}
```

`exitCode` should be `null` for `feedback ingest` unless a future shell protocol provides it.

`exitCodeKnown` should be `false` for the MVP ingest mode.

---

# 12. Feedback events

Each captured command should append one structured event to:

```txt
feedback-events.jsonl
```

Example:

```json
{
  "timestamp": "2026-05-11T10:12:31Z",
  "run": "auth-refactor",
  "phase": "phase-02",
  "source": "agent-command",
  "command": "pnpm test",
  "kind": "test",
  "status": "captured",
  "exitCodeKnown": false,
  "combinedLogPath": "commands/001-pnpm-test/combined.log",
  "metaPath": "commands/001-pnpm-test/meta.json"
}
```

For the MVP, classification can be deferred.

Later versions may add:

```txt
fingerprint
errorKind
firstErrorBlock
fixedLaterInPhase
linkedSkill
```

---

# 13. Command kind

`--kind` should be optional but recommended.

Suggested values:

```txt
test
typecheck
lint
build
architecture-audit
format
custom
```

If omitted, `kind` should default to `custom`.

The command string is descriptive metadata only.

`feedback ingest` must not execute it.

---

# 14. Integration with phase prompts

When PHAX starts a Claude Code phase, the phase prompt should include instructions such as:

````md
## Feedback command capture

When you run feedback commands during this phase, pipe their output through PHAX so the run keeps a record of intermediate failures.

Use this pattern:

```bash
set -o pipefail
<command> 2>&1 | phax feedback ingest --command "<command>" --kind <kind>
```
````

Examples:

```bash
set -o pipefail
pnpm typecheck 2>&1 | phax feedback ingest --command "pnpm typecheck" --kind typecheck

set -o pipefail
pnpm test 2>&1 | phax feedback ingest --command "pnpm test" --kind test

set -o pipefail
pnpm audit:architecture 2>&1 | phax feedback ingest --command "pnpm audit:architecture" --kind architecture-audit
```

Outside a PHAX phase, this command is pass-through and does not record anything.

````

The prompt must emphasize that deterministic PHAX gates still run after the phase, regardless of what the agent ran manually.

---

# 15. Interaction with deterministic gates

`feedback ingest` does not replace gates.

The relationship is:

```txt
agent-driven feedback commands
  → optional but encouraged during implementation
  → captured when piped through feedback ingest
  → used for learning and debugging

PHAX deterministic gates
  → mandatory after phase execution
  → configured in phax.json
  → decide whether the phase can commit and advance
````

Gate logs should continue to be captured by PHAX even if the agent did not use `feedback ingest` during the phase.

---

# 16. Pass-through safety

Pass-through mode is important because users may copy the recommended pattern into scripts or run it manually.

Rules:

- no PHAX context means no PHAX writes;
- pass-through should not print noisy warnings by default;
- pass-through should preserve the input stream exactly as much as possible;
- pass-through should not fail if PHAX state directories do not exist;
- pass-through should not require a git repository;
- pass-through should not require `phax.json`.

This allows:

```bash
pnpm test 2>&1 | phax feedback ingest --command "pnpm test" --kind test
```

to remain safe outside a PHAX run.

---

# 17. Verbose and trace integration

If `PHAX_VERBOSE=1`, `feedback ingest` may print lightweight diagnostic messages to stderr, such as:

```txt
[phax] feedback capture active: run=auth-refactor phase=phase-02 command="pnpm test"
[phax] feedback log: ~/.phax/runs/auth-refactor/phase-02/feedback/commands/001-pnpm-test/combined.log
```

It must not pollute stdout because stdout is part of the piped command output.

If `PHAX_TRACE=1`, `feedback ingest` should emit structured trace events to the run trace file.

Suggested events:

```txt
feedback.ingest.started
feedback.ingest.completed
feedback.ingest.pass_through
feedback.ingest.context_invalid
```

---

# 18. Error handling

If capture mode is active but writing feedback logs fails:

- the command should keep forwarding stdin to stdout if possible;
- the error should be written to stderr;
- the command should return a non-zero exit code only if ingestion itself cannot safely continue;
- the original command output must not be swallowed.

If context is invalid:

- default to pass-through;
- warn only in verbose mode;
- do not crash the pipeline.

---

# 19. Security and privacy

Feedback logs may contain sensitive data because they capture raw command output.

Rules:

- store feedback logs locally only;
- do not upload logs;
- do not send logs to an LLM during ingestion;
- preserve logs as run artifacts;
- include feedback logs in archive unless explicitly excluded;
- document that users should avoid piping commands that may print secrets.

Future work may add redaction rules, but redaction is not required for the MVP.

---

# 20. Acceptance criteria

This feature is complete when:

1. `phax feedback ingest` exists.
2. It reads stdin as a stream.
3. It writes the same stream to stdout.
4. Outside a PHAX phase, it performs pass-through only.
5. Inside a PHAX phase, it writes a combined log file.
6. Inside a PHAX phase, it writes command metadata.
7. Inside a PHAX phase, it appends a feedback event to `feedback-events.jsonl`.
8. It validates PHAX context environment variables before writing files.
9. Invalid context falls back to pass-through or fails safely without swallowing output.
10. It does not buffer full command output in memory.
11. The phase prompt includes instructions for using `feedback ingest`.
12. The documentation explains the `pipefail` requirement.
13. The feature does not replace deterministic gates.
14. Feedback artifacts are archived with the run.

---

# 21. Suggested implementation phases

```txt
phase-01: Add feedback ingest command skeleton and pass-through streaming behavior
phase-02: Add PHAX context detection and environment validation
phase-03: Add feedback log writing and command metadata
phase-04: Add feedback-events.jsonl and trace integration
phase-05: Add phase prompt instructions for feedback ingest
phase-06: Add tests for pass-through, capture mode, invalid context, and large streaming input
phase-07: Add documentation and examples
```

---

# 22. Testing requirements

Tests should cover:

```txt
pass-through outside PHAX context
capture inside PHAX context
invalid PHAX context fallback
large input streaming
metadata file creation
feedback event creation
stdout preservation
no full-buffer memory behavior where practical
```

The tests should avoid real LLM calls.

This feature can be tested with local streams and temporary directories.

Real E2E tests can later verify that Claude Code follows the phase prompt and uses `feedback ingest` during a phase.
