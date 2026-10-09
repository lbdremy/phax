Write the phax spec `guarantee-reports`: design from scratch what a gate step and a brief provider answer phax, and what phax does with it, so phax takes full advantage of what steme knows. Treat today's `gate-diagnostics` document and `brief-answer` as if they did not exist, as `drop-orient` and `drop-gate-scopes` treated orient and scopes: nothing of their shape is kept, and there is no shim and no leftover name. The gate request and the brief request keep their shape.

A first draft (`2610081624-guarantee-reports`, abandoned) was written before the author's arbitration of 2026-10-08/09. Every decision below is settled. Write the spec from them, and leave §9 only for what they leave open.

Why: steme's guarantee model was restructured. A guarantee is made of legs (obligations and prohibitions), applied at places (steme's instances), and keyed in a ledger by (place, guarantee, leg). Repairs are rendered into the unit as blueprints and skills, and what is left to a person's judgement has an owner. phax's two formats flatten all of it.

The governing rule (the author, 2026-10-09): **the agent gets only what it can act on; anything else is too much information.** The rule shapes the formats themselves, not only what phax shows: a provider sends only what someone acts on.

Decided (the author, 2026-10-08/09), not to reopen:
- **Two formats over shared definitions.**
  - A gate report answers the gate request. A brief report answers the brief request.
  - They share the definitions of guarantee, leg, place, location, finding and repair, so a provider states each fact the same way in both.
  - Names are the spec's to choose; `gate-report` and `brief-report` are suggested.
  - Each is read only under its own `$schema`. An answer in `gate-diagnostics` or `brief-answer` is refused by name.
- **Shared definitions.**
  - **Guarantee:** `id` and `statement`.
  - **Leg:** `id`, a `kind` (`obligation` or `prohibition`) and a `statement`.
  - **Place:** a provider-chosen `id` and a `location`.
  - **Identity:** the triple (place, guarantee, leg), compared by equality. It is steme's ledger key.
  - **Location:** a working-tree-relative file and a line range, or no range for the whole file.
  - **Finding:** what was found, its location, and the related locations the leg also involves, each with why.
- **Only open legs travel.** A place lists only its open legs: an obligation `missing`, or a prohibition `forbidden`. Legs that are met, clear or not looked at are never sent, so there is no rule that a place states every leg.
- **Accepted debt is never sent.** It is the provider's input (steme's baseline). A leg the unit accepted simply does not appear, and the PR diff shows any baseline change to the reviewer.
- **Repairs are files to read: two kinds, each with a one-line `description`.**
  - A `blueprint` carries the path of its document (BLUEPRINT.md). The fix prompt tells the agent to read it and follow it.
  - A `skill` carries its name and the path of its directory (SKILL.md). It is loaded into the fix attempt's session through the agent provider's own skill mechanism. Where the provider cannot load skills, the prompt names the SKILL.md path to read.
  - There is no inline-steps kind: a gate without repair files prints a log and does not use these formats.
  - A leg with no repair carries none.
  - A blueprint's tool command (`steme lay`) is never carried. The agent runs it only when the operator lists it in `security.agentCommands`. phax grants nothing a report names.
  - The planner must avoid skill name collisions: steme renders one skill per place, with the same name.
- **The gate report lists what fails now.**
  - It lists the open legs that are due now and not accepted, so it carries no `due`.
  - Any listed leg fails the step. An empty list with exit 0 passes. An empty list with a non-zero exit is a broken step.
  - Report steps stay fail-fast.
- **A refusal.** A provider that declines to run (steme's preflight) answers a refused report with a reason and a remedy for the operator. phax stops the phase with a gate failure and makes no fix attempt. The budget stays unspent; it exits 4 naming the step, the reason and the remedy, and `phax resume` runs the gate again. Gate attribution records the step as refused.
- **Stale repairs are the provider's business.** phax knows nothing of them, and no format carries a freshness field.
- **Judgement goes to the human, never to the agent.**
  - A judgement belongs to a guarantee, `{what, owner}`, and the gate report carries it with the places it concerns.
  - The review handoff (so the PR body) gathers every judgement from each phase's last gate attempt into one `Left to judgement` section. It is grouped by owner, lists each guarantee once naming the phases that reported it, and is placed before Phase details so truncation keeps it.
  - No brief, pushed or pulled, carries judgement.
- **The fix prompt** shows each failing leg under its guarantee's statement and its place: the leg's kind and statement, every finding with its location and related locations, and its repair. It shows none of the guarantee's other legs. A leg that also failed in the previous attempt of the same step is marked `still failing`, by identity. Nothing else about earlier attempts is shown.
- **The pushed brief** (the phase's first prompt) lists only the open legs due this phase, compact, one line each: the leg, its location, and its repair's description.
- **The pulled brief** (`phax brief <path>…`), for each guarantee over the paths:
  - its statement and its legs, which is what a file there must and must not do, and is actionable for a file not yet written;
  - the open legs at those paths, due this phase or later, each with its `due` and repair.

  The brief report therefore carries the legs of each guarantee and a `due` on each open leg. It never lists what is met.
- **Records.** Each readable report is saved as printed, beside the attempt's log or in the brief record. `records explain --gates` and `--briefs` print them as stored. Past runs' `.diagnostics.json` and `brief-NN.json` get no special handling: nobody reads them. Served `$schema` URLs are never withdrawn: the deploy guard refuses it, so keep the frozen-copy precedent of `gate-pending`.
- **Out of scope:**
  - a `decision` class that stops the phase for the owner (its own spec, joining `phase-decision-requests`);
  - escalation on a finding that keeps coming back;
  - the architecture brief at plan authoring;
  - posting steme's check run;
  - steme's own conformity fixes;
  - the plan auditor's answer.

Still for the spec to settle (§9 only if a real choice remains): the formats' names and exact keys; how each agent provider (Claude Code, Codex, Mistral Vibe) loads a skill into a resumed fix-attempt session, and which can; what the fix prompt says when a skill's path holds no SKILL.md; the hello-world example. Its `audit.mjs` and `brief.mjs` answer the two formats over one guarantee with an obligation and a prohibition, one blueprint file and one skill file. Also the README's "Diagnostics gate steps", "Gate request" and "Brief provider" sections, and the schemas package.

Ground to read first:
- **phax, the README:** "Diagnostics gate steps", "Gate request", "Brief provider", "Persisted formats".
- **phax, the schemas:** `src/schemas/gateDiagnostics.ts`, `src/schemas/brief.ts` and `src/schemas/persisted.ts`.
- **phax, the gate:** `src/app/gates.ts`, `src/app/fixLoop.ts` and `src/domain/gate/fixPrompt.ts`.
- **phax, the brief:** `src/app/briefProvider.ts`, `pushedBrief.ts`, `pullBrief.ts` and `src/domain/brief/`.
- **phax, review:** `src/app/reviewHandoff.ts`, `handoffGeneration.ts` and `publishRun.ts`.
- **phax, provider adapters:** under `src/infra/`, for how a session is started and resumed.
- **phax, the example:** `examples/hello-world/`.
- **The archived specs:** `drop-orient`, `drop-gate-scopes`, `gate-request` and `brief-provider`.
- **The abandoned draft** (`docs/specs/archive/2610081624-guarantee-reports.md`), whose fix prompt, refusal and review surfaces may be reused where they agree with the decisions above.
- **The approved `open-next-release` spec:** stamps name the shape.
- **NEXT_STEPS.md:** the steme section.

Constraints:
- No back-compat shims.
- Explicit per-variant enums.
- A brief informs and never blocks; the gate's verdict is the provider's list.
- phax judges nothing in the content. Its decode checks are structural only.
- Every `$schema` names its format.

Output: your final message is the spec document JSON and nothing else — no sentence before or after it, no code fence.
