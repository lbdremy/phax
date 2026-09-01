# OpenSpec vs. phax

> A side-by-side comparison. OpenSpec details were taken from the current
> upstream README (`Fission-AI/OpenSpec`, v1.2.0) rather than from memory.

## The one-line difference

**OpenSpec is a lightweight spec layer that stops where phax starts.** It
structures the upstream conversation — spec → proposal → tasks — and lets the
agent execute inside its own tool; phax is a standalone orchestration engine
that runs your AI agent _as a subprocess_ through isolated, mechanically gated
phases. Same spec-driven philosophy; very different altitude and enforcement.

## What OpenSpec is, concretely

You run `openspec init`, which scaffolds an `openspec/` directory and installs
slash commands into whichever agent you use (30+ supported: Claude Code,
Cursor, Copilot, Amazon Q, …). Then, inside your agent, you drive:

```
/opsx:explore → /opsx:propose <idea> → human review → /opsx:apply → /opsx:archive
```

Each **change** gets a self-contained folder — `proposal.md`, `specs/`,
`design.md`, `tasks.md` — and archiving a completed change folds its deltas
back into the shared `openspec/specs/`. Everything is plain Markdown
(requirements as "The app SHALL…" with concrete scenarios). Its stated
philosophy is *"fluid not rigid"*: no phase gates, every artifact editable at
any time, iterate freely. The _runtime is your agent_, working in your normal
tree with its native permissions; OpenSpec never executes code, the agent, or
git operations.

## What phax is, concretely

A compiled CLI (Node / Effect / TypeScript) that **drives** an AI coding agent
(Claude Code by default, Codex, or Mistral Vibe) through isolated, gated
phases. You author a `plan.md`, phax deterministically extracts it to
`phax-plan.json`, then `phax run` executes each phase in its **own git
worktree**, runs a mechanical **gate profile** after each phase with an
automatic same-session fix loop, reconciles the planned files against the
actual diff, and (per `phax.json`) produces a compliance review and a GitHub
PR. phax _is_ the runtime; it spawns the agent headlessly.

## Side-by-side

| Axis                | OpenSpec                                                                | phax                                                                                                                      |
| ------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **What it is**      | Spec framework + slash-command scaffolding, run inside an agent         | A compiled CLI that drives the agent                                                                                       |
| **Runtime**         | Your AI agent is the runtime                                            | phax is the runtime; it spawns the agent headlessly                                                                        |
| **Rigor**           | "Fluid not rigid" — no gates by design, edit anything anytime           | **Mechanical** gate profiles (real `pnpm test`/lint/build) + automatic same-session fix loop, explicit state machine       |
| **Git**             | Not managed — agent commits in your tree via your normal flow           | Worktree per phase, chained phase branches, planned commit messages, built-in `publish-pr`                                 |
| **Verification**    | Human review of proposal/tasks; no plan-vs-actual check                 | Deterministic plan↔diff **file reconciliation**, per-gate verified surfaces, automated compliance review                   |
| **Isolation/Safety**| None inherent — whatever your agent provides                            | Secure-by-default posture: provider-native filesystem jail, command allowlists, MCP control, routing that skips unsafe providers |
| **Model choice**    | A recommendation ("use a high-reasoning model")                         | A routing layer: model families, tiers, provider priority, fallback                                                        |
| **Multi-plan work** | Stores (beta): shared specs across repos                                | `plans overlap` / `plans status` / `adjust-plan`: parallel-safety, staleness, drift after a landed run                     |
| **Artifact lifecycle** | Active `changes/` → timestamped `archive/`, specs updated on archive | Draft → Approved → Stale → Completed/Abandoned (`phax artifact`), approvals recorded against a baseline                    |
| **Agents**          | Broad: 30+ assistants                                                   | Claude Code (default), Codex, Mistral Vibe — with model-tier routing/fallback                                              |
| **Footprint**       | Very light, npm package, no API keys                                    | Focused single-project tool, ~74 MB binary, deep safety engineering                                                        |

## The key distinction

The workflows _rhyme_ — both are "agree on what to build before code is
written," with Markdown artifacts in the repo and a human review point. The
difference is **where predictability comes from**:

- **OpenSpec** bets on the _spec layer_: if humans and the agent agree on a
  precise proposal and task list, the agent's output becomes predictable.
  Enforcement is social — a human reads and approves; nothing checks that the
  implementation matched the tasks beyond review.
- **phax** bets on the _execution harness_: phases only advance when real
  checks exit green, work happens in isolated worktrees, and the plan is
  mechanically reconciled against the actual diff, with every deviation
  surfaced and justified.

Notably, OpenSpec markets the absence of gates as a feature ("no rigid phase
gates — iterate freely"); phax makes gates its core guarantee. So OpenSpec is
closer to a **shared SDD discipline + artifact convention** you layer onto any
agent; phax is closer to a **build system / CI harness for agent work**.

## When each fits

- **OpenSpec** if you want a very lightweight, agent-agnostic spec convention
  that meets you where you already work, across many assistants, with humans
  in the review loop and zero ceremony around execution.
- **phax** if you want mechanical gates, worktree isolation, security
  sandboxing, provider routing, and a deterministic, auditable trajectory
  (reconciliation + compliance report + PR) — i.e., you trade agent-breadth
  and lightness for enforcement and safety.

## Two things worth noting

1. **They are composable, and phax already mirrors OpenSpec's front half.**
   phax's `/phax-spec` and `/phax-planning` skills play the role of
   `/opsx:propose`'s spec and task outputs — EARS requirements in
   `docs/specs/`, a phased `plan.md` in `docs/plans/`, with an explicit
   approval/staleness lifecycle on top. You could converge on intent
   OpenSpec-style and execute through phax's gated harness — spec discipline
   on the front, mechanical execution on the back.
2. **Relative to Spec Kit** (see
   [`spec-kit-vs-phax.md`](./spec-kit-vs-phax.md)): OpenSpec and Spec Kit sit
   at the same altitude — prompt/artifact conventions run inside your agent —
   and differ mostly in ceremony (OpenSpec is deliberately lighter and
   gateless, Spec Kit prescribes a longer command pipeline with human
   approve/reject checkpoints). Both leave execution, isolation, and
   verification to the agent; that entire layer is what phax adds.
