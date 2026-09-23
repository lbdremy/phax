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
- **Publication is a plain TypeScript build.** `src/` uses no `Deno.*` API: the infra imports
  `node:fs`, `node:path`, `node:child_process`, `node:crypto`, `node:os`, plus `effect`, `yaml`
  and mdast. Deno is the toolchain (`deno compile`, the binary's permission sandbox, the test
  runner), not the runtime surface, so a Node consumer needs an ordinary package build, not a
  migration. One thing is lost in-process: the binary's explicit Deno permission set. Imported
  into a host, phax runs with the host process's permissions.
- **Where the host runs.** Local adapters need `child_process`, a filesystem and minutes-long
  runs, so the host is a long-lived Node process or a container, never a V8-isolate runtime
  such as Cloudflare Workers (workerd, no Node, no Deno). A consumer built on Nitro can keep
  its web tier on an edge runtime and its jobs beside it.
- **After 1.0, or marked experimental.** A library API is one more contract; 1.0 is already
  freezing the CLI and the persisted formats and should not grow a third blocker.
- **Schemas first, at no risk.** `src/schemas` (registry, run status, records, approvals)
  can ship alone as a small typed package now: it freezes nothing beyond what the 1.0
  stability promise already covers, and a read-only consumer of records (the steme cockpit's
  first slice) gets typed parsing instead of a hand-written one.

## Library readiness — what to clean up first

Surveyed 2026-09-23 against `src/app` and `src/infra`. The app layer is already close to
a library: Node project (`tsc` → `dist/`, `tsx`, vitest; Deno only builds binaries), 73
Effect use cases taking their ports through `Context`, no `OutputPort` and no `console` in
`app`, every `infra` adapter exposed as a `Layer`, an event adapter that turns a run into
a stream. What remains, cheapest first:

1. **An exported surface.** `package.json` has `bin` only — no `main`, no `exports`. Add
   entry points `./app`, `./ports`, `./schemas`, `./infra/local` with one barrel per
   layer, and configure `knip` so anything not exported is private. This is what a
   consumer may import; nothing else.
2. **A reusable composition root.** Each CLI command assembles its own `Layer`s. Provide a
   single `LocalLive` composing every local adapter, consumed identically by the CLI and
   by a host; `CloudLive` later. Without it a host re-copies each command's wiring.
3. **Two ports that do not exist: the clock and randomness.** `new Date()` / `Date.now()`
   appear in about twenty `app` modules (`executePlan`, `resetPhase`, `resume`, `commit`,
   `gates`, `fixLoop`, `runFolder`, `registry`, `archive`, …) and `randomUUID` 27 times
   (session and run identities, `randomBytes` twice). A host cannot make a run
   deterministic, replay it, or test it against a fixed instant while time and ids are
   ambient. Add a `Clock` port (`now`, and the sleep the rate-limit wait uses) and an
   `Ids` port (`uuid`, `bytes`), with a `Live` layer and a fake; `createHash` (4 sites) is
   pure and stays. Effect already ships `Clock` and `Random` services — reuse them rather
   than inventing.
4. **Direct `node:fs` imports in ten `app` modules** bypass the `FileSystem` port
   (`loadConfig`, `loadPlan`, `resolveRunInfo`, `resolveRunRef`, `initProject`,
   `agentBinding`, `finalReport`, `resume`, `executePlan`, `loadTelemetryConfig` — mostly
   `readFileSync`/`existsSync`). In cloud mode these read the host's disk instead of the
   sandbox's. Route them through the port; the architectural-guard test should forbid
   `node:fs` and `node:child_process` in `app` afterwards.
5. **Environment reads** in `app` and one in `domain` (`loadConfig`: `cwd`/`env`;
   `providerProbe`; `effectRunner`; `report`; `domain/whatsNext.ts` takes
   `process.platform` as an argument, which is fine — its callers are not). Behind a
   `Host`/`Env` port, or the use case depends on the host process.
6. **The lock** is a file behind its port; check what a long-lived host holding it across
   runs means.
7. **Errors and exit codes**: confirm no use case maps an error to an exit code itself —
   that is the CLI's job.
8. **Persisted formats become wire formats** (see costs above), which is why all of this
   waits for the 1.0 stability promise.

Not on the steme item-0 critical path: during the experiment the cockpit reads records
through the schemas package and never imports `app`. This list is the prerequisite of the
after-1.0 cloud mode.

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
