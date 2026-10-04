# OpenSpec vs. phax

> A side-by-side comparison, last checked on 2026-10-04 against OpenSpec v1.14.0
> (2026-09-30) — its website ([openspec.dev](https://openspec.dev)), README,
> CHANGELOG and docs (`Fission-AI/OpenSpec`) — and phax 0.17.0.

## The one-line difference

**OpenSpec is a spec layer that stops where phax starts.** It structures the
upstream conversation — explore → propose → apply → verify → archive — and lets
the agent execute inside its own tool; phax is a standalone orchestration engine
that runs your AI agent _as a subprocess_ through isolated, mechanically gated
phases. Same spec-driven philosophy; very different altitude and enforcement.

## What OpenSpec is, concretely

You run `openspec init`, which scaffolds an `openspec/` directory and installs
slash commands or skills into whichever agent you use (50 tool targets in
v1.14.0: Claude Code, Cursor, Copilot, Codex, Amazon Q, …). Then, inside your
agent, you drive the default `core` profile:

```
/opsx:explore → /opsx:propose <idea> → human review → /opsx:apply → /opsx:verify → /opsx:archive
```

plus `/opsx:update` and `/opsx:sync`; an expanded profile (`openspec config
profile`) adds `/opsx:new`, `/opsx:continue`, `/opsx:ff`, `/opsx:bulk-archive`
and `/opsx:onboard`.

Each **change** gets a self-contained folder — `proposal.md`, `specs/`,
`design.md`, `tasks.md` — and archiving a completed change folds its deltas
back into the shared `openspec/specs/`. Everything is plain Markdown
(requirements with concrete scenarios; the SHALL/MUST keywords are enforced
only under `validate --strict`). Schemas (`openspec schema init/fork`) can
reshape which artifacts a change carries.

Its README still says _"fluid not rigid"_ — no rigid phase gates, every
artifact editable at any time — but the website now pitches **validation and
verification**: _"The spec framework for building the right thing and building
it right."_ The structural edges have hardened accordingly:

- `openspec validate` checks the spec artifacts, emits JSON with exit codes for
  CI and pre-commit hooks, and `--archived` fails on unchecked tasks.
- `apply` refuses a change with no delta specs; `archive` stops when the spec
  sync fails.
- `/opsx:verify` has the agent check the implementation against the spec and
  report CRITICAL / WARNING / SUGGESTION findings — advisory, it does not block
  archive.

The _runtime is still your agent_, working in your normal tree with its native
permissions; OpenSpec does not implement tasks or run your tests. It now
touches git and the agent at the edges (stores run `git init`, `workset open`
launches a Claude Code or Codex session), and a hosted **OpenSpec Cloud
Agent** (early access since 2026-08-28, new signups paused since 2026-09-11)
flags spec drift in PR checks and can open corrective PRs — without blocking
merges.

## What phax is, concretely

A compiled CLI (Node launcher + Deno-compiled binary, Effect / TypeScript)
that **drives** an AI coding agent (Claude Code by default; Codex and Mistral
Vibe once enabled) through isolated, gated phases. You write a spec and a
`plan.md` — by hand with the bundled skills, or headlessly with `phax artifact
new spec|plan --headless --brief` — and approve them. `phax run` refuses a plan
that is not Approved or has gone Stale, extracts it to a validated
`phax-plan.json` (cached; headless-authored plans are already structured), then
executes each phase in its **own git worktree**, runs a mechanical **gate
profile** after each phase with an automatic same-session fix loop, reconciles
the planned files against the actual diff, and stops at `review_open` with a
review handoff, an optional compliance review and an optional GitHub PR. With
records turned on, every phase leaves its manifest, gate results,
reconciliation, diff, handoff and transcript on a `phax/records/v1` branch.
phax _is_ the runtime; it spawns the agent headlessly.

## Side-by-side

| Axis                   | OpenSpec                                                                                                                      | phax                                                                                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **What it is**         | Spec framework + slash commands/skills, run inside an agent                                                                   | A compiled CLI that drives the agent                                                                                                      |
| **Runtime**            | Your AI agent is the runtime                                                                                                  | phax is the runtime; it spawns the agent headlessly                                                                                       |
| **Rigor**              | Structural: `validate` (CI/pre-commit exit codes), apply/archive preconditions. Implementation check is an advisory agent `/opsx:verify` | **Mechanical** gate profiles (real `pnpm test`/lint/build) after every phase + automatic same-session fix loop, explicit state machine     |
| **Git**                | Not managed for the work — the agent commits in your tree via your normal flow                                                | Worktree per phase, chained phase branches, planned commit messages, built-in `publish-pr`                                                |
| **Verification**       | `validate` checks the specs; `/opsx:verify` and the Cloud Agent compare code to spec by model judgment                        | Deterministic plan↔diff **file reconciliation**, per-gate verified surfaces, automated compliance review, per-phase records               |
| **Isolation/Safety**   | None inherent — whatever your agent provides                                                                                  | Secure-by-default: provider-native filesystem jail, command allowlists, no MCP, routing that skips providers unable to enforce the mode    |
| **Model choice**       | A recommendation ("use a high-reasoning model")                                                                               | A routing layer: versioned model catalog, model + effort per phase, provider priority and fallback                                        |
| **Multi-plan work**    | Stores (beta): a shared planning repo across repos; `status --all`, worksets                                                  | `plans overlap` / `plans status` / `plans lint` / `adjust-plan`: parallel-safety, staleness, drift after a landed run                     |
| **Artifact lifecycle** | Active `changes/` → `archive/`, specs updated on archive                                                                      | Draft → Approved → Stale → Completed/Abandoned (`phax artifact`), auto-committed, approvals recorded against a baseline                   |
| **Authoring**          | Inside your agent (`/opsx:propose`, `/opsx:explore`)                                                                          | Inside your agent with the `phax-spec`/`phax-planning` skills, or headlessly (`artifact new --headless`, experimental)                    |
| **Agents**             | Broad: 50 tool targets                                                                                                        | Claude Code (default), Codex, Mistral Vibe                                                                                                |
| **Hosted**             | OpenSpec Cloud Agent: PR drift checks + daily scans (early access, signups paused)                                            | None — local only; state under `~/.phax/`                                                                                                 |
| **Footprint**          | Light npm/Homebrew package, no API keys, anonymous telemetry on by default (opt-out)                                         | npm launcher that downloads a ~70 MB binary; published `@lbdremy/phax-schemas` for reading its files; single-maintainer, pre-1.0 project |

## The key distinction

The workflows _rhyme_ — both are "agree on what to build before code is
written," with Markdown artifacts in the repo and a human review point. And
OpenSpec has moved toward phax's ground: it now _verifies_ as well as
specifies. The difference is **what a verification is made of**:

- **OpenSpec** checks the _specs_ mechanically (`validate` is a real exit code)
  and checks the _code_ by judgment — `/opsx:verify` and the Cloud Agent ask a
  model whether the implementation matches the spec, and report; neither
  blocks. Predictability comes from a precise, validated spec layer and humans
  reading the findings.
- **phax** checks the _code_ mechanically: phases only advance when your real
  checks exit green, work happens in isolated worktrees, and the plan is
  reconciled file-by-file against the actual diff, with every deviation
  surfaced and recorded. Model judgment (the compliance review) sits on top of
  that evidence rather than in place of it.

So OpenSpec is closer to a **spec discipline with V&V tooling** you layer onto
any agent; phax is closer to a **build system / CI harness for agent work**.

## When each fits

- **OpenSpec** if you want a lightweight, configurable, agent-agnostic spec
  convention that meets you where you already work, across many assistants,
  with spec validation in CI and humans reading the verify findings — and,
  for teams, a hosted drift checker.
- **phax** if you want mechanical gates, worktree isolation, security
  sandboxing, provider routing, and a deterministic, auditable trajectory
  (reconciliation + records + compliance report + PR) — i.e., you trade
  agent-breadth and lightness for enforcement and safety.

## Two things worth noting

1. **They are composable, and phax already mirrors OpenSpec's front half.**
   phax's `phax-spec` and `phax-planning` skills (or `artifact new
   --headless`) play the role of `/opsx:propose`'s spec and task outputs —
   EARS requirements in `docs/specs/`, a phased `plan.md` in `docs/plans/`,
   with an explicit approval/staleness lifecycle on top. You could converge on
   intent OpenSpec-style and execute through phax's gated harness — spec
   discipline on the front, mechanical execution on the back.
2. **Relative to Spec Kit** (see
   [`spec-kit-vs-phax.md`](./spec-kit-vs-phax.md)): both started at the same
   altitude — prompt/artifact conventions run inside your agent — and both have
   since grown toward execution in different directions. OpenSpec added
   validation and an advisory verify step; Spec Kit added a workflow engine
   that can run the agent headlessly with human gates and shell steps. Neither
   isolates the work or gates each step on your test suite by default; that
   layer is what phax adds.

## Next steps

Ideas phax could borrow from OpenSpec — living specs with requirement-level
delta folding, requirement-level traceability for `plans overlap` and the
compliance review, and an explicit explore step — are captured for later
brainstorming in
[`../ideas/openspec-inspired-ideas.md`](../ideas/openspec-inspired-ideas.md).
