Write the phax spec `gate-request`: a gate step can declare that it reads a **gate request** on stdin, a JSON document saying which phase is gated, the commit it started from, whether it is the terminal phase, and the plan's projection — so a diagnostics provider audits what the phase changed and decides by itself what is due, and the gate takes its inputs the way every other extension point does.

This replaces the spec approved on 2026-10-05 (`docs/specs/archive/2610051439-gate-request.md`, abandoned 2026-10-06). That spec was written as additive to the `scopes` machinery. The author has since decided that the removals come first (2026-10-06): `drop-orient` and `drop-gate-scopes` land before this spec, so it is written for a gate that has no `scopes` provider, no closure, no pending state, no `gate-pending` and no `orient`. Nothing in it mentions them, keeps scope scheduling or depends on them. Its §9 Q1–Q6 (declaration name and shape, any step kind, no touched files, `id` and `files` only, `checks-attempt-NN.request.json`, appended phases) were decided by the author on 2026-10-05. Carry each over verbatim as a decided question, and do not reopen any of them.

Decided with the author on 2026-10-04/05/06 — the spec must reflect these, not reopen them:
- **The problem.** A diagnostics gate step today receives nothing: it is run as a command and phax reads its document. A provider that wants to audit only what the phase changed, or to know what later phases still plan, has no way to learn it. After `drop-gate-scopes`, phax schedules nothing: every reported finding fails the step, and the provider alone decides what is due, from git only until this request exists. steme's audit (steme-corpus `02-product/phax-steme-coordination.md`, changes 8 and 9) needs the phase's base and the plan to judge the change incrementally and decide what is due; phax should send them, not compute closure.
- **The contract is the one every other extension point already has**: a command, a JSON document on stdin, a JSON document on stdout. The gate is not the one that takes its inputs another way. Flags and environment variables are not the channel.
- **Only the steps that declare it receive it** (working name: `"input": "gate-request"` on a gate step). A gate also runs linters and tests, and a command that reads its stdin when it is not a terminal may wait on it or change its behaviour; a step that does not declare it is run exactly as today.
- **The request** (indicative, the spec pins the final shape):
  `{ "$schema": "https://docs.phax.run/schemas/gate-request/<release>.json", "phase": "phase-2", "base": "<sha the phase started from>", "terminal": false, "phases": [{ "id": "phase-1", "files": [...] }, …] }`
  — every phase of the plan with its planned files (create ∪ edit, deduplicated, optional files excluded), the gated one included; nothing else of the plan leaves phax (same rule and projection as the plan auditor). The phase's work is in the working tree when the step runs, as today; the provider reads what changed from git, from `base` to the working tree, so phax does not send the touched files ("the past from git, the future from the plan"). The same request is sent on every fix-loop attempt of the phase.
- **phax saves the request beside the attempt** (`checks-attempt-NN.request.json`, next to `checks-attempt-NN.diagnostics.json`), as a persisted format with its `$schema` in `@lbdremy/phax-schemas`, so `<command> < request.json` gives the verdict again, exactly. It travels in the phase record and `phax records explain` shows it.
- **Additive to the gate as `drop-gate-scopes` leaves it.** A step that does not declare the input runs exactly as before. Nothing about scopes, pending or orient appears in this spec: they are gone before it lands.
- **The hello-world example's diagnostics step declares the input** (`audit.mjs` reads the request from stdin). That requirement moved here from the abandoned `drop-gate-scopes`.
- **The first consumer is steme's audit** (`steme audit`, roadmap-1.0 item 0.13, not built yet). It is built against this request, so the spec lands before that item builds its gate projection. A person running the provider by hand keeps the provider's own flags; that is the provider's business, not phax's.

Ground to read first, in this order:
- /Volumes/Work/steme/steme-corpus/docs/corpus/02-product/phax-steme-coordination.md — §"The changes" (rows 8 and 9), §"The gate request", §"The past from git, the future from the plan", §"Incremental in the phases, full at the end".
- the specs `drop-orient` and `drop-gate-scopes` (Drafts or Approved under `docs/specs/`): the gate and the extension points as they stand when this spec lands.
- README §"Extend phax" (diagnostics gate steps, plan auditor) and §"Persisted formats" — read them as they will be after the two drops.
- `src/app/gates.ts` (how steps run, where `checks-attempt-NN.*` files are written, and the `stdin:` log line that the scope query used — it goes with `drop-gate-scopes`, and a declaring step gets its own), `src/infra/shell.ts` (stdin to a child), `src/domain/gate/selectSteps.ts` (`firing`), `src/domain/gate/diagnosticsPath.ts`, `src/schemas/phaxConfig.ts` (gate step schema), `src/domain/plan/projection.ts` (`projectPhases`).
- `packages/schemas` and the `schemas-package` spec in `docs/specs/archive/` (how a persisted format gets its `$schema` URL and snapshot).
- `src/app/executePlan.ts` / `src/app/commit.ts`: where the phase's starting commit is known, and how resume, `reset-phase` and `--append` change it.
- docs/specs/2609281159-oracle-phases.md (Approved, not built): its provider request also carries a base commit and files. Say how the two relate; do not change that spec.
- NEXT_STEPS.md §"Road to 1.0.0": the CLI and config contract is about to freeze; this adds a key, it breaks nothing.

What the spec must cover:
- The config: the step-level declaration, its schema in `phax.json`, `phax schema upgrade` output, and which step kinds may declare it (`output: "log"` too, or diagnostics only).
- The request in full: every field, how `base` is defined for a fresh phase, a resumed one, a reset one and an appended one, how `terminal` is decided, the order of `phases`, and what is sent when the plan has a single phase.
- When it is written to the step's stdin, what happens when the step does not read it (no hang, no error), and how a step that declared it is told apart in the attempt log.
- The persisted copy: name, format id, schema, the record, `phax records explain`.
- §9: the six decided questions carried over, plus any genuine new choice the ground forces, with options, losses and a recommended default.

Constraints: additive; nothing changes for a step that does not declare the input; phax computes no closure and no impact; keep to what the first consumer needs and name what is out of scope (the brief — spec `brief-provider`; a diagnostic `id`, accepted debt, ranges, structured repair, a decision class — later specs from the same coordination note).

Output: your final message is the spec document JSON and nothing else — no sentence before or after it, no code fence.
