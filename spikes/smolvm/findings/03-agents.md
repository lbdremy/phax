# Findings: In-guest agent execution probe

## Environment

- smolvm version: 1.3.2
- Host OS / arch: Darwin 25.5.0 / arm64 (Apple Silicon)
- Guest OS / arch: Linux arm64 (Alpine, via libkrun on Apple Silicon)
- Date of run: 2026-06-30 (partial — see status)
- Operator: Claude Code (interactive review session, automated run)

## Procedure

Run `sh spikes/smolvm/03-agents.sh` from the repo root on a host with `smolvm` installed
and the `alpine` image available. Set the relevant API key env vars before running:

```sh
export ANTHROPIC_API_KEY=...   # for claude
export OPENAI_API_KEY=...      # for codex
export MISTRAL_API_KEY=...     # for vibe
sh spikes/smolvm/03-agents.sh
```

Single-provider runs: `PROBE_PROVIDER=claude sh spikes/smolvm/03-agents.sh`

The script tests each provider in two steps:

**STEP A — task execution with allowed egress**

Flags: `--net --allow-host <provider-api-domain> -e <KEY>=<value>`

The guest boots, installs the provider CLI via `npm install -g <package>` (Node.js
from Alpine's apk), then runs the CLI non-interactively on a trivial prompt:

> "Create a file called hello.txt in /workspace containing exactly one line: hello from smolvm"

The probe then confirms the file appears on the host side of the `-v` mount (write-back).

Non-interactive invocation per provider:

| Provider | CLI    | Invocation style                                                                  |
| -------- | ------ | --------------------------------------------------------------------------------- |
| claude   | claude | `claude --print --dangerously-skip-permissions -p "<prompt>"`                     |
| codex    | codex  | `printf '<prompt>' \| codex exec -C /workspace --skip-git-repo-check --json`      |
| vibe     | vibe   | `vibe -p "<prompt>" --agent auto-approve --workdir /workspace --output streaming` |

**STEP B — denied egress (zero network)**

Flags: `-e <KEY>=<value>` only — **no `--net` flag**

The guest boots with no network access at all. The same CLI runs the same task.
The probe captures exactly how the CLI surfaces the failure: clear error and exit,
multi-second timeout then exit, or indefinite hang (caught by the harness's 60s
`timeout` wrapper).

> This observation directly motivates the capability-preamble prompt in phase-05:
> if the CLI hangs silently, the agent needs to be told up-front that it has no
> network so it can fail fast rather than retry indefinitely.

**Installation method**

Each guest is a fresh Alpine minimal container. The probe installs Node.js via
`apk add nodejs npm` and the CLI via `npm install -g <package>`. Recorded package
names (verify before running):

| Provider | npm package                  | Executable |
| -------- | ---------------------------- | ---------- |
| claude   | `@anthropic-ai/claude-code`  | `claude`   |
| codex    | `@openai/codex`              | `codex`    |
| vibe     | `@mistralai/vibe` _(verify)_ | `vibe`     |

The guest arch is reported by `uname -m` inside the guest. On Apple Silicon (arm64
host) the libkrun guest runs arm64 Linux natively; an x86-64 guest would require
emulation and may affect CLI compatibility.

**Key handling**

API keys are read from the host environment and passed via `smolvm -e KEY=VALUE`.
Keys are never echoed or logged; the harness only prints the key name and length.
Do not commit outputs that contain key values.

## Results

> **Status: NOT RUN as a provider task probe — no API keys available in this environment.**
> `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and `MISTRAL_API_KEY` are all unset, so every
> provider would `SKIP` at the key check and no real agent task can execute. The
> per-provider table below is therefore left empty rather than fabricated. What *was*
> established are the infrastructure facts that gate this probe — and they are decisive
> enough to change the integration design (see synthesis). They were proven while running
> probes 01 and 02 on the same smolvm 1.3.2 / Alpine setup.

**Infrastructure findings (verified, key-independent):**

1. **`apk add` / `npm install` in-guest cannot work under a provider-only allowlist.**
   Step A allowlists only the provider API domain (e.g. `api.anthropic.com`). Installing
   the CLI needs Alpine's package CDN and `registry.npmjs.org`, which are not on that
   allowlist, so the install fails. (Directly observed for the Docker registry case in
   probe 02: `--allow-host` restricts the guest DNS resolver, so any non-allowed host —
   including package mirrors — returns `no such host`.) **A live-install harness is not
   viable; the provider CLI must be present in a pre-baked image.** This confirms the
   spike's residual-risk-7 hypothesis as fact.

2. **A pre-baked image and `--allow-host` do not compose in smolvm 1.3.2.** `smolvm
   machine run --from <artifact>` (the pre-baked path) **rejects** `--allow-host`:
   `error: the argument '--from <PATH>' cannot be used with '--allow-host <HOSTNAME>'`.
   The only way to apply a per-domain allowlist is an ephemeral `--image` boot, which
   re-pulls the image under that same allowlist and therefore forces the Docker
   registry + CDN hosts onto the allowlist too. **This is a new, material constraint the
   synthesis's integration sketch did not anticipate** — see the synthesis update.

3. **`@mistralai/vibe` does not exist on npm.** Verified: `npm info @mistralai/vibe`,
   `mistral-vibe`, and `@mistralai/vibe-cli` all 404. The vibe install line in
   `03-agents.sh` would fail at install. The real Vibe CLI distribution must be
   identified before this provider can be probed.

4. **Step B's `timeout` wrapper is broken on macOS.** `03-agents.sh:146` calls the
   external `timeout` binary, which is absent on stock macOS (`gtimeout` not present
   either, confirmed). It would return 127 and the `||` branch would *always* print
   "CLI may be hanging/retrying", corrupting the denied-egress observation. **Fix:** use
   smolvm's own `--timeout 60s` flag (it exists in 1.3.2) instead of the host `timeout`.

5. **Credential exposure via argv (security).** `-e "${KEY_VAR}=${KEY_FOR_INJECT}"` places
   the literal key on smolvm's command line, readable by any local process via `ps`.
   Prefer an env-passthrough that does not materialise the value in argv. (The script is
   otherwise careful: `set -eu` not `-eux`, value never echoed, `unset` after use.)

## Verdict

**Status:** BLOCKED / inconclusive — requires API keys *and* a reworked harness
(pre-baked image with CLIs installed; provider-API + registry hosts allowlisted; busybox
or pre-installed tooling instead of live `apk`/`npm`). The provider-task questions
(install, task completion, write-back, denial UX) remain **unanswered** in this run.

**Per-provider results table** — not run (no keys):

| Provider | CLI installs in guest? | Completes task (hello.txt)? | Write-back to host? | Network allowlist respected (Step A)? | Denial UX (Step B): error / timeout / hang? |
| -------- | ---------------------- | --------------------------- | ------------------- | ------------------------------------- | ------------------------------------------- |
| claude   | not run                | not run                     | not run             | not run                               | not run                                     |
| codex    | not run                | not run                     | not run             | not run                               | not run                                     |
| vibe     | not run (`@mistralai/vibe` 404) | not run            | not run             | not run                               | not run                                     |

**Installation method confirmed:** live `apk add nodejs npm && npm install -g …` is
**not viable** under an egress allowlist — a pre-baked image is mandatory (finding 1).

**Guest arch:** arm64 Linux (confirmed via probes 01/02 on the same setup).

**Conclusion:** The agent-execution questions are not answerable without keys, but the
surrounding infrastructure work changed the design picture: a pre-baked image is mandatory,
and smolvm 1.3.2 will not apply `--allow-host` to a pre-baked (`--from`) run — so the
follow-up plan must either (a) accept ephemeral `--image` boots that allowlist the registry
alongside provider/MCP domains, or (b) check whether a newer smolvm lifts the
`--from` + `--allow-host` restriction. Write-back and the `:ro` boundary are already proven
in probe 01, so only the provider CLIs' own behaviour inside the sandbox remains open.

## Open questions

- Does the Alpine guest have a compatible Node.js version for each CLI? Node version
  from `apk` may lag behind the CLI's `engines.node` requirement — in that case, a
  pre-built binary or a different base image may be needed.
- What is the correct npm package name for the `vibe` CLI? The harness tries
  `@mistralai/vibe`; if that fails, check Mistral AI docs for the public CLI package.
- Does any provider CLI require an interactive browser login in addition to the API
  key? If so, record it as a blocker finding — env-key injection alone is insufficient.
- For Codex (Step A), does the prompt-via-stdin approach work or does `codex exec`
  require the prompt as a positional argument? Adjust invocation if needed and record.
- Does the denied-egress UX (Step B) depend on whether the CLI has already been
  installed (Step A boot already installed it via network)? The harness installs fresh
  per step — if `apk`/`npm` itself needs internet, Step B's install will fail cleanly
  before the CLI even runs, which is itself a useful finding (agent won't run without
  a pre-baked image).
- Is a pre-baked guest image with the CLI pre-installed needed for production use?
  If npm install requires network and we only want the provider API domain in the
  allowlist, the agent CLI must ship in the image. Record the image-bake requirement.
- What is the exact error/timeout observed in Step B? Timing matters: a 30-second
  timeout before exit means the CLI will delay phax runs if the VM loses connectivity
  mid-run; an immediate ECONNREFUSED means fast-fail with a clear error message.
