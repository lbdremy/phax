# Findings: In-guest agent execution probe

## Environment

- smolvm version:
- Host OS / arch:
- Guest OS / arch: Linux arm64 (Alpine, via libkrun on Apple Silicon)
- Date of run:
- Operator:

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

<!-- Paste the raw output of `sh spikes/smolvm/03-agents.sh` here. Leave empty until run. -->

## Verdict

<!-- Fill in after results are captured. Format: PASS / FAIL / PARTIAL + one-line conclusion. -->

**Status:** (not yet run)

**Per-provider results table**

| Provider | CLI installs in guest? | Completes task (hello.txt)? | Write-back to host? | Network allowlist respected (Step A)? | Denial UX (Step B): error / timeout / hang? |
| -------- | ---------------------- | --------------------------- | ------------------- | ------------------------------------- | ------------------------------------------- |
| claude   |                        |                             |                     |                                       |                                             |
| codex    |                        |                             |                     |                                       |                                             |
| vibe     |                        |                             |                     |                                       |                                             |

**Installation method confirmed** (npm package names, or alternative):

**Guest arch** (from `uname -m` inside guest):

**Conclusion:**

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
