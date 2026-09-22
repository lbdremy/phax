# Idea: local and cloud modes — a second adapter set under one domain

> Status: **brainstorm**. Captured 2026-09-22 from the steme roadmap-1.0 conversation —
> not a spec, not a plan. Nothing below is committed. Explicitly **after 1.0**, beside
> [`autopilot.md`](./autopilot.md) and as the enabling piece for
> [`desktop-app.md`](./desktop-app.md) and
> [`decision-queue-and-proof-chain.md`](./decision-queue-and-proof-chain.md).

## The reframing

`desktop-app.md` assumes a desktop app because phax is local: the runs registry is a
directory, worktrees are on disk, the agent is a local CLI session, interactive questions
go to the terminal. The steme cockpit (the first real consumer of the phax UI ideas) is a
web app on the fullstack kit, and the mismatch looked like "web vs desktop".

It is not. The domain already sits behind eleven ports (`backend`, `fs`, `git`, `github`,
`shell`, `session`, `lock`, `prompt`, `editor`, `output`, `systemTelemetry`). "Desktop"
was only *local mode with an interface*, and a web app served on `localhost` against a
local phax gives that without a shell. What actually varies is the adapter set:

| Port | Local (today) | Cloud (this idea) |
| --- | --- | --- |
| `fs` (registry, `.phax-context`, records clone) | `~/.phax/runs`, disk | a database, or the sandbox's filesystem |
| `git` / `github` | local worktrees, `gh` | a clone inside a per-run sandbox; GitHub API |
| `shell` (gates, setup, commands) | local process | remote execution inside the sandbox |
| `backend` / `session` | `claude` / `codex` / `gemini` CLI sessions | Agent SDK or cloud agent sessions |
| `lock` | file lock | database lock |
| `prompt` / `editor` | terminal, `$EDITOR` | a **persisted decision request** (spec 23) answered from a UI or by a policy |
| `output` / telemetry | stdout, local OTel | the same, shipped |

One domain, two adapter sets, selected by configuration. The writes stay what they are —
spec, plan, approve, run, publish are repo writes plus phax commands — so a web backend
can drive all of them. The UI never gains a capability the CLI lacks; that rule from
`desktop-app.md` becomes literal once both are entry adapters over the same use cases
(next section).

## Consumption: a library, not a daemon, not the binary

Decided 2026-09-22 with the steme cockpit as first consumer. Three ways a UI backend can
drive phax, and why the middle one wins:

| Form | What the consumer gets | Why not |
| --- | --- | --- |
| Invoke the `phax` binary | JSON on stdout to parse, one process per command, types lost at the boundary | The lazy default; every persisted format becomes a wire format *and* every command output does too |
| **Import phax as a library** — `app` (use cases) + `ports` as the public API, adapter sets shipped by phax | Typed calls, in-process runs (a long run is a job in the consumer's `jobs/` scope), decision requests as values, one composition root | — |
| A phax daemon with its own RPC | A network surface | A third contract to freeze and secure, for nothing the library does not give; the consumer already has its own web-rpc between its web and its backend |

Consequences of the library form:

- **The CLI becomes one entry adapter among others.** `src/cli` and a web backend both call
  the same `app` use cases; "never a capability the CLI lacks" holds by construction.
- **Adapters stay in phax.** The consumer picks a set (local or cloud) and composes; it
  never writes an `fs` or `shell` adapter of its own, or the domain ends up with two hosts
  that drift.
- **Publication is the real work.** phax is Deno; the first consumer is Node/pnpm. JSR with
  npm compatibility or a dnt build, tested against a Node consumer.
- **After 1.0, or marked experimental.** A library API is one more contract; 1.0 is already
  freezing the CLI and the persisted formats and should not grow a third blocker.
- **Schemas first, at no risk.** `src/schemas` (registry, run status, records, approvals)
  can ship alone as a small typed package now: it freezes nothing beyond what the 1.0
  stability promise already covers, and a read-only consumer of records (the steme cockpit's
  first slice) gets typed parsing instead of a hand-written one.

## What it unlocks

- **The exception inbox works fully.** `prompt` as a persisted decision request is the
  mechanism the inbox needed: a paused run survives the UI being closed, and the answer
  can come from a human, a team (decision queue) or an autopilot policy.
- **The desktop question dissolves.** No Tauri/Electron/Deno-webview decision; the cockpit
  is one web app, run locally or hosted.
- **Multi-human is possible.** The decision queue needs a server; cloud mode is that server.

## Costs to state up front

- **It bills on the API, not on a subscription.** A cloud run through the Agent SDK is
  metered; local mode stays the cheap path for individuals. The steme experiment runs local
  for this reason alone.
- **A sandbox per run is new infrastructure** with a per-run cost and a lifecycle to own.
- **Every persisted format becomes a wire format.** Registry, status files, records,
  `approvals.json`: cloud mode is the first consumer that reads them from somewhere other
  than the disk that wrote them, which is why this waits for the 1.0 stability promise.

## Open questions

- Which adapters can be swapped independently (local agent + remote gates?) and which
  come as a set. Probably a set: the sandbox owns `fs`, `git` and `shell` together.
- Where the sandbox lives (Cloudflare Sandbox, a container service, a cloud agent
  session's own environment) and whether phax itself runs inside it or beside it.
- Whether `records` becomes the sync channel between a local phax and a hosted UI in the
  interim (read-only cockpit fed by the records remote), which is what the steme
  experiment does first.
