Write the phax spec "Mistral Vibe 3". phax runs Mistral Vibe 3 sessions end to end, reading everything from what the session hands it, and confines Vibe in secure mode as tightly as Claude Code. Nobody uses Vibe through phax today, so the change needs no migration.

**Why.** The operator upgraded to Mistral Vibe 3.0.3 on 2026-10-27, a rewrite: a Rust client (`vibe-rs`) driving a Python app-server. phax cannot run a single Vibe 3 session:
- **The answer is never found.** phax reads the last stream line whose `content` is a string; `content` is now an array of blocks.
- **The session id is never found.** phax scans `~/.vibe/logs/session/session_*/meta.json` by mtime and working directory; the store moved.
- **Usage and transcript are lost.** `meta.json` has no `stats` any more, and `messages.jsonl` is gone.
- All of this fails as an invocation error that names none of it.

The recorded security posture is wrong both ways. phax runs Vibe under `auto-approve`, which turns off every control Vibe 3 has, and records it as filesystem jail `partial`, command enforcement `none`, stop-turn narrowing `none`. A read-only session gets Vibe's full tool set, and sealed completions are refused ("not yet supported for mistral-vibe"). Yet Vibe 3 can now confine file and shell calls to the writable roots, allow exactly the phase's commands, and narrow a session to reading tools. Because of the recorded posture, secure-mode routing skips Vibe and its stop turns write.

**Vibe 3.0.3 facts, from three live probes on 2026-10-27 (model `phax-mistral-medium-3.5-off`):**
- **Stream.** Each stdout line is a typed entry (`type`: `message`, `effect`, `callback`) carrying `sessionId` and `createdAt`. A message's `content` is an array of blocks: `{"type":"message","role":"assistant","content":[{"type":"text","text":"PONG"}],…}`.
- **Store.** Sessions live under `logs/session/unified/<session id>/` (`meta.json` without `stats`, `journal/*.jsonl`, `chunks/`, format `mistral.vibe.unified-session-store/v1`). No `session_*` directory, no `messages.jsonl`. The journal is an internal recovery log, not a readable transcript.
- **Export.** `--output-dir DIR` writes `DIR/export.json` on every exit (`schema_version: 1`): `session_id`, `usage` {`input_tokens`, `output_tokens`, `cached_input_tokens`, `total_tokens`}, `cost_usd`, `steps`, `outcome`, `exit_code`, `vibe_version`, `config`, `limits`. Its usage and cost count that run only, not the earlier turns of a resumed session. One probe export: usage 10987/3200/3 (input/cached/output), cost 0.016503; another: 34588/9600/288, cost 0.054042.
- **Exit codes.** 0 finished; 1 usage or config error; 2 infrastructure failure; 3 limits, refusal or length; 4 aborted by the agent-socket server.
- **Enforcement.** Under `--agent accept-edits` with `VIBE_OUTSIDE_WORKDIR=deny` and `VIBE_TOOLS='{"bash":{"permission":"ask","allowlist":["git status"]}}'`:
  - `git status` ran;
  - `ls /etc`, `cat <outside file>` and `read_file <outside file>` were refused ("outside_workdir = \"deny\" forbids access");
  - `git status && touch x`, `git status; touch x`, `git status | tee x`, `git status $(touch x)`, `echo hi > x`, `pwd` and a background `process.start` were each refused (`tool_denied`);
  - `write_file` and `edit` inside the workdir ran;
  - `run_typescript` has no IO of its own (`Deno`, `require` and `Bun` are undefined);
  - every refusal reached the model as a tool error, and the run finished with exit 0.
- **Narrowing.** `--enabled-tools read_file --enabled-tools grep` refused `write_file` and `bash` ("denied by approval policy"). `--disabled-tools '*'` refused every tool while the model still answered.
- **Auto-approve.** Vibe documents that `--auto-approve` and the `auto-approve` agent skip the outside-workdir check and the denylists.
- **Config layering.** Defaults < model catalog < remote flags < user TOML < project TOML < `VIBE_*` environment (nested with `__`) < overrides < agent profile < admin. `tools` merges deeply: a list replaces a list, an unset key keeps the lower layer's value. So a user's `bypass_tool_permissions = true`, or a file tool's path `allowlist`, would widen a secure session unless phax sets those keys itself.
- **Models.** `VIBE_ACTIVE_MODEL` is honoured, and Vibe 3 still reads phax's `[[models]]` alias blocks. The base model's thinking levels are `off`…`max`, with no `xhigh`.

**Settled (do not reopen):**
1. **What phax reads.** Each headless Vibe turn gets its own output directory under the phase or session folder. The answer is the text blocks of the turn stream's last assistant message entry, joined in order. The session id comes from the turn's Vibe export. A session's usage is the sum, over its turns' exports, of input tokens, cached input tokens, output tokens and cost. Its transcript is its kept turn streams, in turn order. A recorded session phax never ran headless (one the person ran in Vibe's TUI) has its transcript recorded as missing, `not-found`, and that never refuses a close.
2. **No store reads.** phax never reads Vibe's home directory to find a session, its usage or its transcript: the mtime/working-directory discovery, the `meta.json` usage and the `messages.jsonl` transcript all go.
3. **Version floor 3.0.3.** An installed Vibe older than 3.0.3 is refused before any session spawns, with a message naming the installed version and 3.0.3, and the upgrade command `uv tool upgrade mistral-vibe`.
4. **Secure mode confines Vibe**, per invocation, through `VIBE_*` environment variables and `--agent accept-edits`, never through the user's config files:
   - edits inside the writable roots run without approval; every tool call no rule allows is refused;
   - file and shell calls reaching outside the writable roots are refused;
   - a shell command, foreground or background, runs only when it matches one of the agent commands;
   - never the `auto-approve` agent nor `--auto-approve`;
   - a user config that allows more (a tool's path or command allowlist, `bypass_tool_permissions`) cannot widen it.
5. **Recorded capability: filesystem jail `strong`, command enforcement `prefix`** (operator decision, 2026-10-27). The dominant loss accepted: the record no longer tells tool-level enforcement from an OS sandbox for Vibe, since code an allowed agent command runs can still read outside, exactly as under Claude Code's allowlist. `strong` already means tool-level confinement for Claude Code. A secure Vibe phase's `security.json` therefore has `downgraded: false` and no `partial-filesystem` mark, and Vibe satisfies strict secure routing.
6. **Read-only sessions** run Vibe with only its reading tools, plus the shell for exactly the agent commands they are granted. Vibe's first and closing stop turns run read-only and record `"narrowing": "read-only-tools"`.
7. **Sealed completions** run on Vibe with no tool enabled.
8. **Unsafe mode is unchanged:** the `auto-approve` agent and `--trust`.
9. **Vibe usage drops the four tool-call counts** (operator decision, 2026-10-27). `VibeTokenUsage` becomes `{ provider, inputTokens, cachedInputTokens, outputTokens, costUsd }`, all required, at `$schema` 0.30.0 (0.29.0 was cut without it). The dominant loss accepted: the only per-session tool approval counts phax recorded for any provider; nothing displays them, and the export, which is versioned, has no such field. No back-compat shim: older stamps go through the existing versioned readers.

**What exists (read it first):**
- `src/infra/providers/mistralVibe.ts`: argv, spawn (`VIBE_ACTIVE_MODEL`), session-id discovery, transcript capture.
- `src/schemas/vibeOutput.ts`: the stream line schema (`content` a string), `findVibeSessionId`.
- `src/domain/records/usage.ts`, `src/schemas/runRecord.ts`, `src/app/recordPlumbing.ts`: `extractVibeUsage` from `meta.json` `stats`, `VibeTokenUsage` with four tool-call counts.
- `src/domain/security/capabilities.ts`, `src/domain/security/stopPosture.ts`, `src/app/interactiveStop.ts`: the `partial`/`none` capability, narrowing `none`, `turnsCanWrite` true only for Vibe.
- `src/infra/providers/dispatcher.ts`: Vibe sealed completion refused, Vibe transcript read from the store root.
- `docs/security.md`: the provider capability table, the shell model, what phax reads from a provider's store.
- `docs/specs/2610271510-provider-failures.md` (approved): owns the per-provider session-outcome reader and the failure kinds, and leaves the rest of Vibe 3 to this spec. Its Vibe reader must read the Vibe export and the V3 stream this spec establishes, so this spec's reading work comes first. Name it as related, not as a prerequisite.

**Out of scope:**
- classifying a Vibe session's failure (exit codes 1–4, `outcome`, failure kinds): `provider-failures` owns it; this spec only establishes that the Vibe export is reliable on 3.0.3, the condition `provider-failures` set for reading it;
- `--agent-socket` / `vibe run-server`: experimental and hidden in 3.0.3, an input to the `isolated`-mode spike, not to secure mode;
- interactive resume of a Vibe session (`vibe --resume <id>`): stays unsupported, since it cannot be verified headless;
- network control: Vibe has none, so the network column stays `None`;
- MCP scoping, beyond what read-only narrowing and sealed completions already drop;
- Vibe's limits (`--max-turns`, `--max-price`, `--time-limit`) and `--prompt-file`;
- an `xhigh` alias;
- reading Vibe 2.x sessions;
- writing `~/.vibe/config.toml` anywhere except `phax agent setup mistral-vibe`, which is unchanged.

**Acceptance criteria worth having,** each against observable behaviour: the `PONG` answer from a block array; session id and summed usage from two exports (45575/12800/291, cost 0.070545); the transcript as two streams in turn order; a person's TUI session recorded `missing`/`not-found` without refusing the close; everything found with `VIBE_HOME` unreadable; Vibe 2.13.0 refused naming 2.13.0 and 3.0.3; a secure phase with agent commands `git status` that writes a worktree file and runs `git status`, while `git status && touch x`, `ls /etc` and a background `touch y` are refused and the turn finishes; no auto-approve in a secure argv and the user's `config.toml` byte-identical; a loose user config (`bypass_tool_permissions = true`, `[tools.bash] allowlist = ["touch"]`, a `read_file` allowlist outside the worktree) that still cannot `touch x` or read outside; secure routing with `providerPriority` `["mistral-vibe", "claude-code"]` landing on Vibe with `downgraded: false`; a read-only session refused `write_file` and `bash touch x`; stop turns recorded `read-only-tools` with the worktree unchanged; a sealed completion answering with no tool enabled; an unsafe argv with `--agent auto-approve` and `--trust`.

**Leave §9 empty.** Every arbitration is settled above. The planning note leaves to the plan: how the installed version is read (once per process or per session) and where the refusal surfaces; the exact reading-tool set and how a sealed completion disables every tool; whether secure mode also denies `web_fetch`/`web_search` (recommend no, matching Claude Code's secure flags).

**Surfaces.** A surface's `summary`, `before` and `after` are read by users in the release notes: a capitalized sentence and short real examples, with no implementation notes. Show at least: the secure-mode Vibe invocation before → after (environment and argv); the Vibe usage in a record before → after at `$schema` 0.30.0; a secure Vibe phase's `security.json` before → after, and a closed stop's turn narrowing `none` → `read-only-tools`; the version-floor refusal; the `docs/security.md` capability row `| mistral-vibe | Partial | None | Supported |` → `| mistral-vibe | Strong | None | Supported |`.

**Docs page:** `docs/security.md`, provider capabilities and shell command execution, for an operator choosing whether to put `mistral-vibe` first in `providerPriority` under secure mode. `docs/model-catalog.md` and `docs/model-routing.md` drop the "partial" caveat.

**Output:** your final message is the spec document JSON and nothing else: no sentence before or after it, and no code fence.
