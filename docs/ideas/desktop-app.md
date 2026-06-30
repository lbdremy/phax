# Idea: a phax desktop app (review-by-trajectory)

> Status: **brainstorm**. Captured fresh from a design conversation — not a spec, not a
> plan. The job here is to record the thesis and the decisions reached so they don't
> evaporate. Nothing below is committed.

## The thesis

When code production is sufficiently *framed*, the code becomes a by-product. The thing a
human actually reviews is no longer the diff — it's the **trajectory**:

```
intention (spec) → décomposition (plan) → exécution (run, phases, gates, fix-loops) → résultat (PR)
```

The diff stays available, but as **secondary evidence**, not as the primary surface. phax
already produces all the pieces of this trajectory; the desktop app's job is to make them
first-class instead of leaving them implicit behind a terminal.

So the app is **not a terminal in disguise**. A terminal shows the *execution stream*. We
want to show the *artifacts and the decisions*. Two different products.

## Central metaphor: a review-by-trajectory cockpit

Not an IDE, not a terminal, not a generic Kanban. The hero object is the **run**,
presented as a timeline of phases. Each phase is a card carrying:

- its **intention** (what the plan said to do),
- its **gate** (green/red + the profile that ran: typecheck, tests, lint…),
- its **fix-loops** made visible ("2 attempts, here's what got corrected"),
- the **plan ↔ actual reconciliation** — "the plan expected X, the agent deviated to Y
  because…". This is the real treasure nobody else surfaces.

The diff is one click away, collapsed by default. You expand it when a gate is red or a
deviation looks suspicious. The rest of the time you review **claims + evidence**, not
lines.

### North star

The diff is so secondary that review becomes **"approve the trajectory"** rather than
"approve the code": you validate that the intent was sound, the gates are green, the
deviations are justified — and the PR goes out. The code is opened *only* when one of those
three signals is off.

## Lifecycle: spec, plan, run all share the same shape

The user's clarifying insight — the three artifacts share one lifecycle, so there's only
**one concept to learn**:

```
spec:  draft → approved → (eligible for plan)
plan:  draft → approved → (eligible for run)
run:   queued → done | needs-me
```

Same gesture three times: a draft, a human approval gate, promotion to the next stage.
This maps directly onto phax's existing discipline — `RunState`/`PhaseState` already
transition only through explicit functions in `src/domain/state.ts`. We extend that
discipline to specs and plans. The status is a **required** field on the persisted schema
(no back-compat optional), the status set is an **explicit enum**, transitions go through
dedicated functions — never direct mutation. Spec and plan join the state-machine family.

## Entry: voice → approvable spec

The user arrives with a **natural-language intention** — press a mic, ramble — and it
progressively composes a spec. Crucial nuance: the mic must not *transcribe*, it must
**converge**. An agent that asks follow-up questions, structures, spots gaps, and only lets
you approve when it's crisp. Transcription is easy; convergence is the product. The
`draft → approved` gate on the spec is where all the quality lives.

## Two specs hiding under one word

A refinement that came out of the conversation: "spec" names two different objects.

1. **Input spec** — ephemeral. Exists to be consumed once (produce the plan + the
   wording of the tests), then it's spent fuel. `draft → approved → archived`. Not
   maintained.
2. **Derived spec (view)** — the markdown you *decompile from the tests on demand*. This
   is **not the deterministic inverse** of compilation; it's a generative, **lossy**
   regeneration.

Why lossy, and the one real caveat: E2E tests capture **behavior**, not **intent / the
why**. Decompiling gives a faithful catalogue of *what the system does* — including every
exception added over time — but loses *why it matters*, the prioritization, and all the
**non-testable intent** (perf budget, security posture, UX "feel").

So the model splits cleanly:

- **Behavior** → source of truth = tests = code. Input spec archived. Derived spec
  regenerated on demand. ✅
- **Rationale / non-testable intent** → doesn't fit a test. Its home is the PR / commit /
  a light ADR — not a spec to maintain. Be honest that the derived spec won't contain it.

Conceptual payoff: **the derived spec is a *computed report*, not a stored artifact** —
like everything else the desktop shows. A derived view, never a source to keep in sync.
This kills the spec-rot / double-maintenance problem: tests evolve with the code anyway, so
maintaining a separate spec file is double work for nothing.

## Plans as a graph of incremental recompilation

Once specs and plans are things phax *consumes*, phax manages their lifecycle. And once
plans have **status + dependencies**, you don't have files anymore — you have a **DAG**,
and it behaves like a build system (Make/Bazel) applied to plans: what's up to date,
what's impacted, what can run in parallel.

The two newer commands fall straight out of this:

- `plans-overlap` = find the **independent** nodes → the ones that can run in parallel.
- `adjust-plan` = a plan ran and changed things → its **dependents go stale** → re-plan
  only those.

### Where the ordering comes from — the key decision

**Not** a hand-declared dependency graph. The user declares **priority / intent order**
(default = creation order: you start with what you want first). The machine never reorders
against the user — it only **offers to batch**:

> "You wanted A then B then C; B and C touch nothing in common → I can run them together,
> want to?"

Opt-in, opportunistic, human-approved parallelism. The user stays the only scheduler; the
machine is just an opportunity detector.

- **Intent order** = human, cheap, default = creation order. The user declares a
  *priority*, never a dependency.
- **Parallelization safety** = machine, inferred from the paths the plans touch.

### Opportunistic parallelism = optimistic concurrency

The path-overlap check is a **prediction, not a guarantee**. A plan declares the files it
*intends* to touch, but the agent can overflow at execution time. phax already runs each
phase in its **own worktree**, so two parallel plans = two worktrees = a **merge at the
end**. The real arbiter of conflict is the merge, not the pre-check.

So the flow is honest optimistic concurrency:

1. path-overlap **proposes** a safe batch (cheap, predictive),
2. worktrees execute in parallel,
3. the merge **verifies** for real,
4. **reconciliation** handles the case where the bet was wrong (overflow → merge conflict).

phax already has reconciliation in the domain, so we *branch path-overlap as an upstream
predictor* onto a merge/reconciliation mechanism that exists. Product honesty: don't sell
path-overlap as "guaranteed conflict-free" — sell it as "probably safe, and if the merge
breaks, here's the reconciliation". A failed merge is just another entry in the run's
exception inbox.

**Granularity decision:** measure conflict at the **file** level to start — coarse but
safe (only proposes truly disjoint work; two plans touching the same file on different
functions reads as a false conflict and we skip the opportunity). Let the real merge
recover the cases where two things cohabited in one file without clashing. Optimistic about
detecting opportunity, conservative about what we dare to propose.

One-liner for the whole scheduling model: **the human orders specs by priority; phax infers
disjoint batches from the plans and proposes them; the worktrees + reconciliation decide
for real.** Nothing here requires a hand-declared dependency layer — that's the elegant
part.

## The run screen = an exception inbox, not a monitor

Watching a run live is an anti-pattern — it's exactly what phax exists to stop doing. The
screen shows **only what needs a human**. The taxonomy of reasons is short:

- **Rate-limit** → the app often knows the reset time → "auto-resume at 14:32", no action.
  Self-healing.
- **Fix-loop exhausted** (gate red and staying red) → this — and only this — is "open the
  session". The single case where you go into the code.
- **Decision / ambiguity** → the agent needs an arbitration. A first-class exception, or it
  flounders silently.

Health metric for this screen: **how many runs completed without ever appearing here.** The
emptier the inbox, the better phax is working.

## Final review: a "prep bundle" + surfaced attention points

When a run is done, the worktrees/gates were kept open. Final review needs a way to
**actually test whatever was produced**, regardless of project type. phax shouldn't know
how to preview every project type — **the project declares it**, the same way it declares
gate profiles.

A small **preview manifest** in `phax.json`, scaffolded from **templates** (an opinionated
scaffolder like STEM as one pluggable approach, never required — anything else just
declares its own):

- `web` → a command that builds+serves → app captures the URL → "open in browser"
- `cli` → a command that sources the project (latest version available) → "open a ready
  console"
- `lib` → often nothing to "see" → fall back to gates + tests as the only evidence

Properties to keep: **deterministic** (the app runs a declared command, never improvises),
**extensible** (new type = new entry), and the desktop stays a **view** that runs a
CLI-reproducible command. Where there's nothing to preview, say so honestly rather than
faking an empty screen.

The manifest must follow phax's existing schema discipline: a **discriminated union per
preview type**, required field (not optional-for-old-projects), explicit per-variant enum —
decoded through a schema before entering the domain.

### The PR is consultable evidence, not a destination

The PR exists but you don't *go* to it. The app surfaces the **attention points** (from the
auto-review / gates), and the only gesture is **"run a code review"** → button → invokes the
command. The PR is the fallback when a signal is off. Same north star: approve a trajectory,
open the code only on alert.

## Desktop opinionated vs CLI flexible

- The **desktop is the paved road** — one good path, strongly guided.
- The **CLI is the full instruction set** — more flexible, everything is possible.

Hard rule: **the desktop never creates a capability the CLI lacks; it *restricts* toward
the recommended flow.** Every button = a displayable command. That makes parity structural,
not a permanent sync effort.

## Open threads / next steps

- The exact on-disk format of spec/plan status in the repo (and where `docs/specs` /
  `docs/plans` lifecycle metadata lives).
- The shape of the exception inbox (the run screen).
- The convergence loop (voice → approvable spec) — survey prior art on spec formalisms that
  double as E2E test wording.
- Runtime choice (Deno desktop / Tauri / Electron) — deliberately deferred; secondary to
  the product question. Verify what Deno actually offers for desktop before committing.
