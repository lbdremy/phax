# GitHub Spec Kit vs. phax

> A side-by-side comparison, last checked on 2026-10-04 against Spec Kit v1.1.0
> (2026-10-02) — its docs site
> ([github.github.io/spec-kit](https://github.github.io/spec-kit)), README and
> CHANGELOG (`github/spec-kit`) — and phax 0.17.0.

## The one-line difference

**Spec Kit is a methodology + prompt/template layer, with a workflow engine on
top, that runs your AI agent _as the worker for each step_. phax is an
orchestration engine that runs your AI agent _inside isolated, mechanically
gated phases_.** Same spec → plan → implement philosophy; very different
enforcement.

## What Spec Kit is, concretely

You run `specify init`, which installs commands or skills for whichever agent
you use (41 named integrations plus a generic one: Copilot, Claude Code,
Codex, Gemini, Cursor, Mistral Vibe, …). Then, inside your agent, you drive:

```
/speckit.constitution → /speckit.specify → /speckit.clarify → /speckit.plan
→ /speckit.checklist → /speckit.tasks → /speckit.analyze → /speckit.implement
→ /speckit.converge
```

(spelled `/speckit-specify` or `$speckit-specify` on agents that take
skills). Only `specify` → `plan` is required; `clarify`, `checklist` and
`analyze` are optional AI "quality gates", and `converge` is an append-only
self-check — the agent assesses the code against spec, plan and tasks and
either reports "Converged" or appends missing tasks, so you loop implement →
converge. Each step produces a Markdown artifact in your repo (constitution,
spec, plan, tasks, checklists).

Since 1.0 (2026-08-21) Spec Kit is also a platform. The site now pitches it as
_"Build with a spec, fix a bug, or assess an idea — with your coding agent"_:

- **Extensions** add commands and before/after hooks on each core command
  (bundled opt-in `bug` and `assess` flows; a community catalog of ~180
  extensions the maintainers do not review). **Presets** override templates;
  **bundles** version a stack of both.
- **Workflows** (`specify workflow run`) are YAML pipelines of `command`,
  `prompt`, `shell`, `gate`, `if`/`switch`, loop and fan-out/fan-in steps,
  pausable and resumable. The built-in `speckit` workflow runs specify →
  **review-spec gate** → plan → **review-plan gate** → tasks → implement, where
  a gate is a human approve/reject.
- **Git is opt-in.** Core no longer creates a feature branch; the `git`
  extension (`specify extension add git`) does, and can auto-commit around
  commands. Worktree isolation exists only as community extensions.

The _runtime is still your agent_, working in your normal tree with its native
permissions. The docs are explicit that there is "no capability sandbox": a
workflow `shell` step "runs a local command with **your** privileges".

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

| Axis                   | GitHub Spec Kit                                                                                                         | phax                                                                                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **What it is**         | Commands/skills + templates + SDD methodology, an extension platform and a workflow engine                              | A compiled CLI that drives the agent                                                                                                      |
| **Runtime**            | Your AI agent, step by step — by hand, or dispatched by `specify workflow run`                                          | phax is the runtime; it spawns the agent headlessly                                                                                       |
| **The "gate"**         | **Human** approve/reject steps in workflows; `clarify`/`checklist`/`analyze`/`converge` are AI prompts; `shell` steps can run checks you add | **Mechanical** gate profiles (real `pnpm test`/lint/build) after every phase + automatic same-session fix loop                           |
| **Isolation**          | None inherent — agent edits your working tree; feature branches via the opt-in `git` extension                          | Each phase runs in its **own git worktree**, on chained phase branches                                                                    |
| **Safety**             | Whatever your agent provides; "no capability sandbox" for workflow steps                                                | Secure-by-default: provider-native filesystem jail, command allowlists, no MCP, routing that skips providers unable to enforce the mode    |
| **Verification**       | `converge`: the agent judges code against spec/plan/tasks and appends tasks                                             | Deterministic plan↔diff **file reconciliation**, per-gate verified surfaces, automated compliance review, per-phase records               |
| **Artifact lifecycle** | Artifacts per feature; no approval status beyond the workflow's gate steps                                              | Draft → Approved → Stale → Completed/Abandoned (`phax artifact`), auto-committed, approvals recorded against a baseline                   |
| **Agents**             | Broad: 41 named integrations + generic, several installable side by side                                                | Claude Code (default), Codex, Mistral Vibe — routed per phase by a versioned model catalog with provider priority and fallback           |
| **Output**             | Markdown artifacts + code in your tree; PR via your normal flow (or a community extension)                              | Per-phase commits + `security.json` + records + compliance review + PR, built in                                                          |
| **Extensibility**      | Extensions, presets, bundles, community catalog, experimental MCP server                                                | Gate profiles, bundled skills, versioned JSON Schemas for every file (`@lbdremy/phax-schemas` on npm)                                     |
| **Backing**            | GitHub-official, 1.x since 2026-08, ~140k stars, large contributor and extension community                              | Single-maintainer, pre-1.0 project (0.17.0), deep safety engineering                                                                      |

## The key distinction

The workflows _rhyme_ — both are spec → plan → tasks/phases → implement with
review gates, and Spec Kit's workflow engine now makes it an orchestrator too.
The difference is still **what a gate means**:

- **Spec Kit gate** = "a human reads the artifact and approves," plus AI
  self-checks (`analyze`, `checklist`, `converge`). A workflow _can_ add a
  `shell` step that runs your linter or tests, but nothing in the default
  workflow does, and it runs in your tree with your privileges.
- **phax gate** = "the phase's code typechecks and tests pass, or the phase
  fails and the agent loops to fix it." Enforcement is a real process exit
  code after every phase, in an isolated, sandboxed worktree, with
  deterministic reconciliation of plan-vs-actual.

So Spec Kit is closer to a **shared SDD discipline + prompt library + process
platform** you layer onto any agent; phax is closer to a **build system / CI
harness for agent work**. Spec Kit standardizes the _conversation, artifacts
and process_; phax standardizes the _execution and verification_.

## When each fits

- **Spec Kit** if you want an agent-agnostic methodology that meets you where
  you already work, across many assistants, with humans in the review loop, a
  large extension ecosystem, and the option to script the process as a
  workflow.
- **phax** if you want mechanical gates, worktree isolation, security
  sandboxing, provider routing, and a deterministic, auditable trajectory
  (reconciliation + records + compliance report + PR) — i.e., you trade
  agent-breadth and ecosystem for enforcement and safety.

## Two things worth noting

1. **They are composable, and phax already mirrors Spec Kit's front half.**
   phax's `phax-spec` and `phax-planning` skills (or `artifact new
   --headless`) are direct analogs of `/speckit.specify` and `/speckit.plan`.
   You could author Spec-Kit-style specs and execute them through phax's gated
   harness — spec discipline on the front, mechanical execution on the back.
2. **Relative to the "review-by-trajectory" desktop idea** (see
   [`docs/ideas/desktop-app.md`](../ideas/desktop-app.md), not on the roadmap):
   Spec Kit lives at "structure the prompts, artifacts and process"; phax lives
   at "make execution isolated and gates mechanical." The idea's _"approve the
   trajectory, not the diff"_ is a step beyond **both** — it presumes exactly
   the mechanical gates, reconciliation and records phax has (and Spec Kit does
   not by default), then makes them the primary review surface. You cannot
   review-by-trajectory credibly when your gates are human approve/reject
   steps and AI self-assessments; you need real green-or-red evidence, which
   is precisely what phax produces.
