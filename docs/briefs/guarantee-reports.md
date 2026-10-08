Write the phax spec `guarantee-reports`: design from scratch what a gate step and a brief provider answer phax, and what phax does with it, so phax takes full advantage of what steme knows. Treat today's `gate-diagnostics` document and `brief-answer` as if they did not exist, as `drop-orient` and `drop-gate-scopes` treated orient and scopes. Nothing of their shape is kept, and there is no shim and no leftover name. The spec replaces both with whatever the design calls for. The gate request and the brief request stay as phax sends them unless the design needs more from them.

Why (the author, 2026-10-08): steme's guarantee model has been restructured, and the two formats were designed before it. The model now has:
- **packs** that define guarantees, a **standard** that places them, and a **unit manifest** that binds them;
- each guarantee made of **legs**: obligations and prohibitions, each with its own check;
- **instances** keyed in a **ledger** by (instance, guarantee, leg), with a state per leg;
- **repairs** rendered into the unit as **blueprints** (laid down by `steme lay`, then edits) and **skills** (Agent Skills), each with a one-line description;
- **accepted debt**, keyed exactly as the ledger keys a leg, with who accepted it, when and why;
- what is **left to judgement** and its owner;
- a **preflight** that can refuse to run, and repairs that can be **stale**.

The two formats flatten nearly all of it:
- one `rule` string;
- a `message` that joins the statement, the instance and the finding;
- `line` only, and a second file named only in text;
- a repair as a string;
- accepted debt decoded, then dropped;
- the other legs of the guarantee never shown;
- in the brief, two legs at one place told apart only by their text.

In steme, the gate and the brief are two views of one ledger: "the brief and the audit read the same facts and the same ledger, so they never disagree on a state".

The authoritative description is steme's surface document, `/Volumes/Work/steme/steme-corpus/docs/corpus/02-product/steme-surface.md`, with its companions. Read §2 (the unit: a guarantee), §3 (one ledger, every output a projection), §5 (the standard), §8 (the ledger), §10 (the gate and the agent) and §14.1 (the commands). Read the example outputs under `steme-surface/target/out/` (`diagnostics.phax.json`, `brief.phase.json`, `brief.files.json`, `check-run.json` and its `raw_details`, `preflight.json`), the rendered repairs and their index under `steme-surface/target/code/apps/sandbox/.steme/repairs/`, and the decisions `05-decisions/27`–`30`. Do not copy their content or file names into phax.

phax stays a harness any provider can serve. The model is designed from what steme provides, and the hello-world example serves it in miniature. The spec's examples are made up, in the hello-world example's vocabulary.

What the spec must design:
- **One model for both answers.** Decide what a guarantee, a leg, a place or instance, a state, a location (with range, and the other files a leg involves), a repair (its kinds and what each carries), accepted debt and a judgement are in phax's terms. Then decide whether the gate and the brief answer one format to two requests, or two formats over one vocabulary. Say what identity phax relies on, and for what.
- **The gate's verdict.** What fails the step: legs proved absent, due, not accepted. What travels beside it without failing: accepted debt, and possibly the guarantee's other legs. How a provider that refused to run, or whose repairs are stale, is told apart from a failing audit and from a broken step. Steps stay fail-fast as today unless the design says otherwise.
- **What phax does with each piece.** Consider at least the following, and keep what pays:
  - **The fix prompt.** Show each failing leg with its guarantee's statement and its other legs' states. Show the repair by kind: for a blueprint, the command that lays it and the edits; for a skill, the skill itself, loaded into the agent's session as a skill rather than pasted. Keep accepted debt as "leave it". A finding carried across attempts (fixed, still failing, new), using its identity.
  - **The pushed brief and `phax brief`.** The compact pushed form gains what helps first: the leg, and the repair's description. Say how `phax brief` prints the full form.
  - **Review.** What is left to judgement, with its owner, gathered into what the human reviews at `review_open` (the review handoff, the PR body). It is never sent to the agent to fix.
  - **Records.** The saved attempt documents and brief records keep the whole answer. `records explain --gates` / `--briefs` print it.
  - **Security.** If the agent should run `steme lay` (or a provider's equivalent), say how that command is granted: the way `phax brief` is granted now, or through `security.agentCommands`.
- **Records already written.** Past runs' saved `.diagnostics.json` and `brief-NN.json` exist on the `phax/records/v1` branch. Say whether `records explain` keeps reading them through frozen shapes, or prints them raw. Their `$schema` URLs stay served, from a frozen copy, as `gate-pending`'s did.
- **The hello-world example** (`examples/hello-world/audit.mjs` and `brief.mjs`) serves the new answers, and the README's "Diagnostics gate steps", "Gate request" and "Brief provider" sections describe them.

Out of scope:
- **A leg only the owner may decide**, stopping the phase instead of sending a fix attempt. A `decision` class is a separate spec, after this one, joining the parked `phase-decision-requests` spec (decided 2026-10-08). The model may name the owner; this spec never stops on it.
- **Escalating or stopping on a finding that keeps coming back.** The identity makes it possible later.
- **The architecture brief at plan authoring** (spec → places, chains, order).
- **Posting steme's check run to the pull request.**
- **steme's own conformity fixes.**

Ground to read first:
- **steme:** the surface document and companions above.
- **phax, the README:** "Diagnostics gate steps", "Gate request", "Brief provider", "Plan auditor", "Persisted formats".
- **phax, the schemas:** `src/schemas/gateDiagnostics.ts`, `src/schemas/brief.ts` and `src/schemas/persisted.ts` (`readGateDiagnosticsAnswer`, `readBriefAnswer`).
- **phax, the gate:** `src/app/gates.ts`, `src/app/fixLoop.ts` and `src/domain/gate/fixPrompt.ts`.
- **phax, the brief:** `src/app/briefProvider.ts`, `pushedBrief.ts`, `pullBrief.ts` and `src/domain/brief/`.
- **phax, review:** `src/app/reviewHandoff.ts`, `handoffGeneration.ts` and `publishRun.ts`.
- **phax, schema history:** `src/schemas/history/` and `packages/schemas/src/formats/recordTimeline.ts`.
- **phax, the example:** `examples/hello-world/`.
- **The archived specs:** `drop-orient`, `drop-gate-scopes`, `gate-request` and `brief-provider`.
- **The `open-next-release` brief:** stamps will name the format's shape.
- **NEXT_STEPS.md:** the steme section, and "A persisted-format stability promise".

Constraints:
- No back-compat shims in persisted schemas.
- Explicit per-variant enums.
- A brief informs and never blocks; the gate's verdict is the provider's.
- phax judges nothing in the content: it carries, shows, records and routes.
- Every `$schema` names its format.
- Decided, not to reopen:
  - one spec for both answers;
  - green field;
  - the `decision` class is out;
  - stamps name the shape (`open-next-release`);
  - an answer in an older shape is refused by name before 1.0.
- §9: genuine choices only. Each comes with its options, what each abandons, and a recommended default. At least:
  - one format or two;
  - the identity's form;
  - the repair kinds and what phax does with each (above all, loading a skill into the session);
  - how much of the guarantee's other legs the fix prompt shows;
  - where judgement goes at review;
  - how a refused or stale provider is reported;
  - reading past records.

Output: your final message is the spec document JSON and nothing else — no sentence before or after it, no code fence.
