# Idea: `artifact decide` — arbitration of a spec's or plan's open questions

> Status: **brainstorm**. Captured 2026-09-24 from the steme roadmap-1.0 conversation —
> not a spec, not a plan. Nothing below is committed. Builds on headless authoring
> (shipped 2026-09-23: the open questions of a headless-authored spec are already data in
> its JSON sidecar, in the decision-request shape of spec 23) and on
> [`autopilot.md`](./autopilot.md) §"Decision policy". Sibling of the two-step review in
> [`headless-code-review.md`](./headless-code-review.md).

## The pattern, stated once

An artifact whose questions are data · a **doctrine** that says how to decide · a
decision that comes out as JSON · the Markdown regenerated from it. Three places have
this shape: a spec's §9, a plan's decisions, and a code review's findings. This note is
the first two; the review note is the third.

## Shape

```
phax artifact decide <artifact>                       # interactive
phax artifact decide <artifact> --headless --doctrine <file> [--model … --effort …]
phax artifact decide <artifact> --question <id> --reopen   # what STEERING `rouvre` maps to
```

- **Input**: the artifact's open questions, extracted — from the sidecar when the
  artifact was authored headless; from the Markdown §9 through the same extractor
  otherwise. Each question carries `id`, `question`, `options[]`, `recommendation`,
  `rationale`.
- **Doctrine**: a file the caller owns — one for specs, one for plans — saying how to
  decide: which principles bind (in steme's case: deterministic over probabilistic,
  surface-driven, no scalar, anti-cathedral as exposure…), when to adopt the
  recommendation, when to refuse to decide. It is how the human stays in the loop
  **asynchronously**: written once, applied at every arbitration, cited by every
  decision.
- **Output**: JSON only, validated —
  `{ decisions: [{ id, chosen, abandoned: [...], why, doctrine: [<principle ids>],
  context: "...", reversibility, escalate?: "<what the arbiter would not decide>" }] }`.
  phax re-implants it into the sidecar (`decision` per question), re-renders the
  Markdown (§9 answered, decision log appended), commits, writes the session into
  records. `artifact status` reports questions open / decided / escalated.
- **Sessions**:
  - *headless*: a **new** session by default. An oracle is independent of what it
    judges; a session that arbitrates the draft it just wrote confirms its draft.
    `--resume-authoring` exists for the caller who wants the context anyway.
  - *interactive*: resumes the authoring session when it exists (the agent has the
    memory; the human is the judge and the agent facilitates, in the manner of
    `adjust-plan`); a fresh session otherwise.
- **`--reopen`**: marks a decided question open again with a note; the next `decide`
  sees it first. This is what a steering instruction like `rouvre Q3` becomes.

## The doctrines ship as skills

Like `phax-spec` and `phax-planning`, the arbitration doctrines are **skills phax ships
by default** — proposals nobody is obliged to adopt, that spare each project writing its
own: `phax-decide-spec`, `phax-decide-plan`, `phax-decide-review` (drafts in
[`skills/`](./skills/)). The `decide` session loads the matching skill; `--doctrine
<file>` appends the project's own principles; every decision cites ids from either
(`S*`, `P*`, `R*`, or the project's). A project that wants to replace a doctrine installs
its own skill under the same name (`phax skills install --scope project`). The review
doctrine is what `review-plan` loads, not only `decide`.

Nearly everything in the drafts is generic phax engineering doctrine (adopt the default,
deviate toward completeness, refuse don't warn, one source, total on inputs, no scalar,
nothing destructive without a gesture); the steme-specific parts are stated generically
("changes the public surface", "erases attribution").

## What it gives

- A loop's decision policy becomes a phax command with a caller-owned doctrine, not an
  agent's private brief. The steme conductor's "argued" policy is a doctrine file.
- The decision ledger ("what we gave up and why") is a rendering of `decisions[]`, one
  file per artifact, never hand-written.
- Machine arbitration is distinguishable from human arbitration in the record (the
  doctrine and model are named; an interactive decision names the human).

## Open

- Whether `decide` may run before `approve` only, or also re-run after (an approved
  spec with a reopened question goes back to Draft, or carries an amendment).
- Whether plans have "open questions" in the same shape today, or whether the planning
  schema needs them (a plan's decisions are today prose in its handoff guidance).
- The doctrine format: prose the agent reads, or a small structured list of principles
  with ids so decisions can cite them mechanically. Probably both: prose with `[[id]]`
  anchors.
