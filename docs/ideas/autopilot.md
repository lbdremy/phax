# Idea: `phax autopilot` — the lifecycle driven in a loop from a corpus

> Status: **brainstorm**. Captured 2026-09-15 from a conversation after v0.14.0 — not a
> spec, not a plan. Nothing below is committed. Explicitly **after 1.0**: it builds on
> every artifact format the 1.0 checklist in `NEXT_STEPS.md` is about to freeze.
>
> Related: [`decision-queue-and-proof-chain.md`](./decision-queue-and-proof-chain.md)
> (attention filter: "reduce the human attention required without reducing confidence"),
> [`openspec-inspired-ideas.md`](./openspec-inspired-ideas.md) (living specs — the corpus
> below is close to that), and spec 23 (`docs/specs/2608091526-phase-decision-requests.md`,
> parked) whose decision requests already carry a `recommendation` field.

## The idea as raised

A mode where phax is given a **goal** and a **corpus** and runs the whole lifecycle in a
loop, unattended:

1. Read a corpus of high-level documents (not specs yet — "what we want, why") and derive a
   **roadmap** toward one precise goal ("build the `steme` command line described in
   `docs/`").
2. For the next roadmap item: write the **spec** (`phax-spec` skill), take every decision
   by adopting the **recommended option**, write the **plan** (`phax-planning`), lint it,
   approve, run, land.
3. Tick the item, re-read the ground, loop. Build a tool along the way when one is missing.

The framing lives in an `autopilot.md` at the repo root: a master prompt the loop must not
edit, giving the scope, the sequencing, the lifecycle to follow and which documents to lean
on. `phax autopilot` points at it.

First real target: the steme project, which already has the corpus and lacks the CLI.

## What it is not — and the one reframing that matters

The natural sketch is *"an agent that launches other agents"*. That is the wrong shape for
phax, and the one thing worth deciding before anything else:

> **Autopilot is a deterministic supervisor over probabilistic steps — not a master agent.**

The loop itself (which item next, which command to run, when to stop, what to record) is
phax code: a state machine like the run's, with typed events and one writer. The model is
invoked at exactly the points where it is invoked today — *write a spec*, *answer a
decision*, *write a plan*, *execute a phase* — each as a jailed, bounded session. Nothing new
is probabilistic; only the sequencing that a human does by hand today becomes code. That
keeps every property the 1.0 announcement claims (determinism where it can go; the model as a
guest) and it is the only version whose failures are legible: a stuck autopilot is a state
you can point at, not a transcript to read.

Every step already exists as a command: `artifact new`, `plans lint`, `artifact approve`,
`run`, `publish-pr`, `plans status`, `adjust-plan`, `artifact complete` (carried by the
run). The gap is the driver, the decision policy, and the two ends of the loop (corpus →
roadmap, landed → next).

## Where the human gate moves

phax's premise is *approve is not ceremony*. An autopilot that approves its own spec and its
own plan hollows out the `Approved` status unless the gate is deliberately relocated. Three
placements, by what each abandons:

| Placement                                  | Human touches                         | Abandons                                                     |
| ------------------------------------------ | ------------------------------------- | ------------------------------------------------------------ |
| **Roadmap once, merge per item** (default) | the roadmap; each PR                  | per-spec intent review — the corpus is the reviewed intent   |
| Per spec                                   | the roadmap; every spec; each PR      | most of the autonomy; loop stalls at each spec               |
| Nothing until done                         | the final state                       | the evidence chain's whole point; one bad decision compounds |

Recommendation: the first row. The human approves the **roadmap** (a new artifact, below),
and the PR that `publish` already opens — with the compliance verdict up front — stays the
per-item gate. Autopilot approvals must be **distinguishable** in the record
(`approved: { by: autopilot, … }` or a separate record sidecar), so `phax artifact status`
and the plans report never present a machine approval as a human one. Whether the loop may
**merge** its own PR to continue is a policy flag, default off: with it off, the loop
stops at `review_open` and resumes when the PR lands (the `--landed` machinery and `plans
status` already tell it what went stale); with it on, merge requires gates green *and*
compliance `conformant`, anything else stops the loop.

## Pieces that would be new

- **Roadmap artifact.** `docs/roadmap/<stamp>-<slug>.md` or one `roadmap.md`: ordered
  items, each with the corpus documents it derives from and its lifecycle (`Draft →
  Approved → Completed`, per item). Derived from the corpus by one model call, approved by a
  human, then consumed one item at a time. Each item's spec declares its roadmap item the
  way a plan declares its `source-spec`, so lineage reaches the corpus and staleness can
  propagate one hop further (corpus changed → roadmap item stale).
- **Decision policy.** Spec 23 gives the mechanism: a blocking request with `options` and
  a `recommendation`. Autopilot is a *decision answerer* with a policy: `recommended`
  (adopt the recommendation), `stop` (halt and wait for a human — the default for a request
  with no recommendation), later `ask` (route to a human, see the decision queue idea).
  Spec 23 therefore becomes a dependency rather than a parked nice-to-have.
- **Budget and stop conditions.** Max items, max wall clock, max phases, max consecutive
  failures, token or cost ceiling — all declared in `autopilot.md` frontmatter or the
  command line, all recorded. A loop with no stop condition is not shippable.
- **The master prompt as a frozen artifact.** `autopilot.md` is fingerprinted at start and
  recorded with every artifact the loop creates, exactly as a plan approval records its
  ground. If it changes mid-loop, the loop stops (`framing-changed`) rather than silently
  following the new text.
- **Tool creation.** "Build a tool if one is missing" collides with the frozen
  `agentCommands` allowlist and with `plans lint`'s commands check: a tool the loop writes
  is a command no plan may run until `phax.json` changes — and editing `phax.json` is
  precisely the boundary the jail exists for. Options: the loop may only *propose* an
  allowlist change (stop, human edits), or tools are limited to package scripts already
  covered by an allowed prefix (`pnpm exec tsx …`). Decide before, not during.

## Open questions

- Does the loop run in the repo's working tree or in a dedicated worktree? Every artifact
  transition commits; a human working on `main` at the same time is a conflict source.
  Probably a dedicated branch per autopilot session, PRs opened against it or against
  `main` — this is the spec 24 (batch, stacked PRs) territory.
- One spec per roadmap item, or the item *is* the spec? Keep the spec: it is what the
  planning skill consumes, and the compliance review judges plan vs. spec.
- What does "re-read the ground" mean after an item lands: `plans status` for the plans
  already written, plus re-deriving the *remaining* roadmap against the new tree — is that a
  model call per iteration, and is it recorded?
- The records substrate (0.9) gets its first cross-run consumer here for free: the loop's
  next spec should read the previous items' handoffs and final reports. This is the
  "durable context layer" from the longer horizon, entered from the side.

## Why after 1.0

The loop writes specs, plans, approvals and records at machine speed; every format it
writes must be the one 1.0 promises to keep loading. It also depends on spec 23 and,
for the branch question, brushes spec 24. Ship 1.0 with the checklist in `NEXT_STEPS.md`,
then spec this with 23 as its first dependency.
