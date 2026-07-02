# GitHub Spec Kit vs. phax

> A side-by-side comparison. Spec Kit details were fetched from the current
> upstream docs (`/github/spec-kit`, Context7) rather than from memory.

## The one-line difference

**Spec Kit is a methodology + prompt/template layer that runs _inside_ your AI
agent. phax is a standalone orchestration engine that runs your AI agent _as a
subprocess_.** Same spec → plan → implement philosophy; very different altitude
and enforcement.

## What Spec Kit is, concretely

You run `specify init`, which scaffolds your repo with slash-command templates
for whichever agent you use. Then, inside Copilot / Claude / Gemini / Cursor /
etc., you drive a sequence of slash commands:

```
/speckit.constitution → /speckit.specify → /speckit.clarify → /speckit.checklist
→ /speckit.plan → /speckit.tasks → /speckit.analyze → /speckit.implement
```

Each produces a markdown artifact in your repo (constitution, spec, plan,
tasks). It is **agent-agnostic** by design — essentially a shared vocabulary of
prompts + templates plus a workflow definition with human approve/reject gates
between stages. The _runtime is your agent_, working in your normal tree with
its native permissions.

## What phax is, concretely

A compiled CLI (Node / Effect / TypeScript) that **drives** an AI coding agent
(Claude Code by default, Codex, or Mistral Vibe) through isolated, gated phases.
You author a `plan.md`, phax deterministically extracts it to `phax-plan.json`,
then `phax run` executes each phase in its **own git worktree**, runs a
mechanical **gate profile** after each phase with an automatic same-session fix
loop, reconciles the planned files against the actual diff, and (per `phax.json`)
produces a compliance review and a GitHub PR. phax _is_ the runtime; it spawns
the agent headlessly.

## Side-by-side

| Axis            | GitHub Spec Kit                                                     | phax                                                                                          |
| --------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| **What it is**  | Prompt/template scaffolding + SDD methodology, run inside an agent  | A compiled CLI that drives the agent                                                           |
| **Runtime**     | Your AI agent is the runtime                                        | phax is the runtime; it spawns the agent headlessly                                            |
| **The "gate"**  | **Human** approve/reject checkpoints + `/analyze`/`/checklist` prompts | **Mechanical** gate profiles (real `pnpm test`/lint/build) + automatic same-session fix loop |
| **Isolation**   | None inherent — agent edits your working tree                      | Each phase runs in its **own git worktree**                                                    |
| **Safety**      | Whatever your agent provides                                        | Secure-by-default sandbox: filesystem jail, command allowlists, MCP control, provider routing that skips unsafe providers |
| **Determinism** | Structured, but execution is the agent acting freely on prompts    | Deterministic plan extraction (content-hash cached), gates, and plan↔diff reconciliation      |
| **Agents**      | Broad: Copilot, Claude, Gemini, Cursor, …                          | Claude Code (default), Codex, Mistral Vibe — with model-tier routing/fallback                 |
| **Output**      | Markdown artifacts + code in your tree; PR via your normal flow     | Per-phase commits + `security.json` + compliance review + auto PR, built in                    |
| **Backing**     | GitHub-official, large community, 2025                             | Focused single-project tool, deep safety engineering                                          |

## The key distinction

The workflows _rhyme_ — both are spec → plan → tasks/phases → implement with
review gates. The difference is **what a gate means**:

- **Spec Kit gate** = "a human reads the artifact and clicks approve."
  Enforcement is social/manual; `/analyze` and `/checklist` are AI consistency
  _prompts_, not executable checks.
- **phax gate** = "the phase's code typechecks and tests pass, or the phase fails
  and the agent loops to fix it." Enforcement is a real process exit code, in an
  isolated worktree, with deterministic reconciliation of plan-vs-actual.

So Spec Kit is closer to a **shared SDD discipline + prompt library** you layer
onto any agent; phax is closer to a **build system / CI harness for agent work**.
Spec Kit standardizes the _conversation and artifacts_; phax standardizes the
_execution and verification_.

## When each fits

- **Spec Kit** if you want a lightweight, agent-agnostic methodology that meets
  you where you already work, across many assistants, with humans in the review
  loop. Low ceremony, broad reach.
- **phax** if you want mechanical gates, worktree isolation, security sandboxing,
  provider routing, and a deterministic, auditable trajectory (compliance report
  + PR) — i.e., you trade agent-breadth and lightness for enforcement and safety.

## Two things worth noting

1. **They are composable, and phax already mirrors Spec Kit's front half.** phax's
   `/phax-spec` and `/phax-planning` skills are direct analogs of
   `/speckit.specify` and `/speckit.plan`. You could author Spec-Kit-style specs
   and execute them through phax's gated harness — spec discipline on the front,
   mechanical execution on the back.
2. **Relative to the "review-by-trajectory" desktop idea** (see
   [`docs/ideas/desktop-app.md`](../ideas/desktop-app.md)): Spec Kit lives at
   "structure the prompts and artifacts"; phax lives at "make execution isolated
   and gates mechanical." The idea's _"approve the trajectory, not the diff"_ is a
   step beyond **both** — it presumes exactly the mechanical gates + reconciliation
   phax has (and Spec Kit does not), then makes them the primary review surface.
   You cannot review-by-trajectory credibly when your gates are human
   approve/reject prompts; you need real green-or-red evidence, which is precisely
   what phax produces.
