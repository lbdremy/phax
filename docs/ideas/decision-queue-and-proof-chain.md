# Idea: the decision queue and the proof chain

> Status: **brainstorm**. Captured from a positioning conversation — not a spec, not a
> plan. Nothing below is committed.
>
> This extends [`desktop-app.md`](./desktop-app.md) rather than repeating it. That doc
> establishes review-by-trajectory, the shared `draft → approved` lifecycle across
> spec/plan/run, the plans DAG, and the **run screen as a single-user exception inbox**.
> The extension here is the step *outward*: from one person's exception inbox to a
> **multi-human decision queue**, and the persistence model that makes the whole
> trajectory hold up as evidence.

## Positioning: phax is the control plane

Presenting phax as an agent orchestrator, a code review tool, a transcript tracker, or a
GUI for agents undersells it. Each is true and none names the value. Closer:

> **phax is the control plane of agentic software production.**

Or, put as usage:

> **phax lets a team pilot the trajectory of a software change, from intent to
> production — directing human attention to the decisions that matter and retaining a
> complete chain of evidence.**

The compass this hands the product, and it doubles as a feature filter — a feature earns
its place if it removes a pointless human intervention, moves attention to something more
valuable, or raises the level of guarantee without raising human effort in proportion:

> **reduce the human attention required without reducing confidence in what was
> produced.**

## The proof chain

phax already separates the agent's non-deterministic reasoning from the deterministic
process in which that reasoning is allowed to produce changes. A plan is cut into phases;
each phase is executed, gated, reconciled, and committed once it satisfies its conditions.
That turns a potentially opaque agent execution into a succession of inspectable units.

Adding the **full per-phase agent transcript** completes something. For any given change,
you can then recover:

```
spec → plan → phase → files changed → agent transcript → gate results
     → phase handoff / reconciliation → commit → run reconciliation → compliance report
```

End to end, that reconstructs:

> intent → decision → plan → the agent's operational reasoning → changes → controls → result

The transcript is one brick in that chain, not the point of it. A chain that stops at
"the gates were green" is evidence of **process**. A chain that also names *what was
guaranteed* — which is what an enforcement layer like steme contributes at the gate — is
evidence of a **property**. Only the second survives someone asking "how do you know?"

## Why keep transcripts at all

Not for surveillance. During implementation phases the transcript is produced almost
entirely by the agent, so there is no individual being watched.

The value is diagnostic: it explains **why an implementation took the trajectory it took**.
After an incident or an unsatisfying phase, the transcript is what lets you tell which
part of the production system failed:

- a technical rule was ambiguous;
- the documentation handed to the agent was insufficient;
- the plan left a behaviour unspecified;
- the spec had a blind spot;
- the enforcement layer permitted an interpretation that should now be forbidden.

So the transcript is an instrument for **debugging the production system**, not the code.
It tells you whether to improve the spec, the planning process, the docs, the agent
instructions, a rule pack, a gate, or the project structure. Traceability becomes the
engine of continuous improvement rather than an archive.

## Transcript vs decision record — what actually gets persisted

A distinction worth building in from the start, because it is the difference between a
useful evidence store and a permanent conversation dump.

- **Autonomous phases executed by agents** → keep the full transcript. It is machine
  output, it is cheap, and it is the diagnostic surface above.
- **Human ↔ agent interaction while producing a spec or a plan** → do **not** keep the
  conversation. What must become durable is the **decision record**: the question that
  arose, the options considered, the decision taken, who took it, and above all its
  **justification**.

> For machine execution, keep the trace. For human decision, keep the decision record.

This also protects the product from becoming a system of record for conversations nobody
will ever re-read.

## The decision queue: the inbox, one step out

[`desktop-app.md`](./desktop-app.md) defines the run screen as an **exception inbox** —
single user, run-scoped, showing only what needs a human, with "how many runs completed
without ever appearing here" as its health metric. That stands.

The extension: **the same primitive applies during spec construction, across people.**

While building a spec, an agent surfaces open questions. Those questions do not have to
stay blocked in the session of whoever happens to be writing the spec. Each can be routed
to whoever can actually answer it:

- a domain question → the domain expert
- a product question → the product manager
- a technical question → the tech lead
- a legal question → whoever owns that
- a design question → the designer

The recipient gets the question **with the context needed to answer it**, and has two
gestures: answer directly when a few lines suffice, or **open a session** — an agentic
interaction preloaded with the full context accumulated so far — when the subject is
larger. The answer returns to the trajectory, the document evolves, new questions may
appear, and it continues until the spec is complete enough to approve.

### What the inbox actually is

Not a task list. A **contextualised decision queue**. Each item answers:

- Which decision is needed?
- Why is it needed?
- What is its context?
- Who holds the knowledge to take it?
- What does this decision unblock?

Most teams today coordinate around tickets, Slack messages, PRs, documents and meetings.
This organises collaboration around **the points where a human decision is genuinely
required** — which is a different object, and a much smaller one.

**The binding constraint, and the main risk.** The whole idea fails if phax reads as "one
more workflow". The queue is only interesting if it carries *few* items, *important*
ones, to the *right* person, at the *right* time, with enough context to decide quickly.
Success is measured less by the number of actions taken inside phax than by the number of
pointless interactions removed everywhere else. Any feature here that adds an approval
step without removing a coordination step is a regression.

## Review driven by value, not by file order

A code review is presented today as a sequence of files and diffs. But the reviewer is not
really trying to understand files. They are trying to answer one question:

> Was the intent of this change correctly encoded?

phax holds something GitHub does not: **the plan that produced these changes**. That makes
several review modes possible over the same diff — classic file-by-file, outside-in,
inside-out, guided by the plan's phases, or focused on what the enforcement layer does not
cover.

The reviewer stays free to choose. The goal is not to constrain the method; it is to
**orient attention**.

The last mode is the strongest and it depends on an external input: a map of what the
enforcement layer actually guaranteed for this change, and — more usefully — its
complement, the surface where nothing mechanical stands and judgment is the only verifier
present. That map is **steme's** to produce; phax's job is to render it in the review
surface and to record, per phase, *which* verification loops actually ran. phax already
has the raw material for the second half: gate steps are per-phase, files touched are
reconciled, and phases run in cumulative worktrees.

Two constraints inherited from that side, worth honouring in any renderer built here:

1. **Never collapse coverage to a single number.** Report per verification loop. A scalar
   cannot attribute — the same reason the `fast`/`full` gate depth dial is the wrong shape
   and gate profiles should be a selection over named, attributed loops.
2. **Never present a guarantee stronger than the rule behind it**, and always link back to
   that rule. A green marker that withdraws a reviewer's attention on the strength of a
   weak rule does not merely fail to catch a defect — it launders one.

## Where this points

The through-line across all of the above: **do not ask a human to spend attention where a
machine can supply a sufficient guarantee.** Not removing the human — reserving judgment
for where judgment is worth something.

Code reviews today mix mechanical errors, architectural preferences, conventions, domain
questions, and design debates. Progressively removing the first three from the daily
cognitive load is the point; the last two are what review should be.

## Open threads

- The on-disk shape of a decision record, and whether it lives beside the spec or in its
  own store.
- Routing: how a question acquires an owner (agent-proposed, human-assigned, or by a
  declared ownership map).
- What "open a session with full context" means concretely for a non-developer recipient.
- Whether the decision queue is a phax concern at all, or a surface that belongs to the
  desktop app of [`desktop-app.md`](./desktop-app.md) with phax only emitting the events.
