Write the phax spec `guarantee-reports`: design from scratch what a gate step and a brief provider answer phax, and what phax does with it. Treat today's `gate-diagnostics` document and `brief-answer` as if they did not exist, as `drop-orient` and `drop-gate-scopes` treated orient and scopes: nothing of their shape is kept, and there is no shim and no leftover name. The gate request and the brief request keep their shape.

This spec replaces the Approved `2610090907-guarantee-reports`. Its formats mirrored steme's internal model: guarantee, leg, place, open legs, blueprint and skill repairs, judgements. Shown typical answers on 2026-10-09, the author found the API "way too tied to steme, and steme vocabulary" and asked for something much simpler. Every decision below is settled. Write the spec from them, and leave §9 only for what they leave open. The first draft `2610081624` is also abandoned.

The governing rule (the author, 2026-10-09): **the agent gets only what it can act on; anything else is too much information.** The rule shapes the formats themselves, not only what phax shows: a provider sends only what someone acts on.

The vocabulary rule (the author, 2026-10-09): **the formats speak a provider-neutral vocabulary.** No key, value or doc text names steme's model: no guarantee, leg, obligation, prohibition, place, instance, blueprint, skill, judgement, debt or baseline. A provider such as steme maps its model into the formats; phax does not know it. steme is named only as the first provider, as an example.

Decided (the author, 2026-10-09), not to reopen:
- **Two formats over shared definitions.**
  - A gate report answers the gate request. A brief report answers the brief request.
  - Each is read only under its own `$schema`. An answer in `gate-diagnostics` or `brief-answer`, or in the other new format, is refused by name.
  - Names: `gate-report` and `brief-report`.
- **Shared definitions.** A provider writes each of these the same way in both formats, so one serializer serves both:
  - **Location:** `{file, lines}`. `file` is working-tree-relative, and `lines` is `[start, end]` (1-based, inclusive) or null for the whole file.
  - **Guide:** `{summary, read}`, where `summary` is one line and `read` is a working-tree-relative path of a file the agent reads. phax never reads, checks or pastes that file, and loads nothing. A file's kind (a skill's SKILL.md, a blueprint, a doc page) is the provider's business; for phax it is a file to read.
  - **Finding:** `{id, rule, location, message, related, guide}`.
    - `id` is a provider-chosen string, stable across runs of the same check (steme can put its ledger key in it). phax only compares it by equality, and refuses a report in which two findings share one id.
    - `rule` is the expectation broken, as a plain statement: its "must" or "must not" lives in the wording, and there is no kind.
    - `message` is what was found.
    - `related` lists the other locations involved, each `{file, lines, why}`, and may be empty.
    - `guide` says how to fix this case, or is null.
- **Only actionable items travel.** A provider sends only findings that something must close, and nothing that is met, accepted as debt or not examined. Accepted debt is the provider's own input, and the PR diff shows its changes.
- **The gate report** has two outcomes:
  - `checked`, carrying `findings` and `review`. It lists only what fails now, so it carries no `due`.
  - `refused`, carrying `reason` and `remedy`, when the provider declined to run (steme's preflight).
- **The gate's verdict.**
  - Any finding fails the step, whatever the exit code.
  - An empty list with exit 0 passes, whatever review notes it carries.
  - An empty list with a non-zero exit is a broken step, and so is an unreadable report. A broken step's fix attempt gets the raw log, as a log step's does.
  - Report steps stay fail-fast.
- **A refusal.**
  - phax stops the phase with a gate failure, makes no fix attempt and spends no fix attempt.
  - It exits 4, naming the step, the reason and the remedy, and `phax resume` runs the gate again.
  - Gate attribution records the step as `refused`.
  - The stop reuses the existing gate-failure pause: no new phase state or stop reason, only the message, `lastError` and resume instructions say it refused and give the remedy. Loss accepted: in state a refusal looks like exhaustion, and resume grants a full budget.
- **Review notes go to the human, never to the agent.**
  - The gate report's `review` lists `{owner, note}`.
  - The review handoff (so the PR body) gathers the notes of each phase's last gate attempt into one section, grouped by owner. A note reported by several phases is listed once, naming those phases. The section is placed before Phase details, so truncation keeps it.
  - No brief and no prompt carries a review note.
- **The fix prompt** shows each finding of the failing step: its rule, location, message, related locations with why, and guide (its summary and an instruction to read the file at `read` and follow it). It shows nothing else from the report. A finding whose `id` the phase's previous attempt of the same step also reported is marked `still failing`. Nothing else about earlier attempts is shown.
- **The brief report** has no outcome key. It carries:
  - `rules`, each `{rule, files, guide}`. These are the expectations that apply to the requested paths: what a file there must and must not do, which is actionable even for a file not yet written. `files` names the requested paths the rule applies to, and `guide` (or null) says how to comply.
  - `findings`, each a finding plus `due`: `this-phase`, `later`, or null when the request carried no phase facts.

  It carries no review note. A brief provider that declines to run exits non-zero with its reason on stderr, and phax treats that as any failed brief.
- **The pulled brief** (`phax brief <path>…`) prints the whole brief report: each rule with its files and guide, then each finding with its due and guide.
- **The pushed brief** (the phase's first prompt) is set by phax.json, beside the brief command: `brief.push`, an explicit enum. The spec names the values. Suggested: `"findings"` lists only the findings due this phase, and `"findings-and-rules"` also lists the rules over the phase's planned files with their guides. Lines are compact, one per item, and capped at 50 overall. When nothing is listed, one line says so.
  - The spec settles whether the key is required or defaults to `"findings"`. The author's preference for explicit enums stands.
- **A report grants nothing.** phax grants no command because a report or a guide names it. A tool a guide calls for runs only if `security.agentCommands` or the gate commands allow it.
- **Strict keys.** A key a format does not name, at any level, makes the report malformed: a broken step at the gate, a failed brief.
- **Records.**
  - Each readable report is saved as printed, beside the attempt's log or in the brief record.
  - `records explain --gates` and `--briefs` print them as stored.
  - Past runs' `.diagnostics.json` and `brief-NN.json` get no special handling: nobody reads them.
  - Served `$schema` URLs are never withdrawn: follow the `gate-pending` precedent, frozen copies under `site/retired-schemas/`.
- **Out of scope:**
  - a `decision` class that stops the phase for an owner (its own spec, joining `phase-decision-requests`);
  - escalation on a finding that keeps coming back;
  - the architecture brief at plan authoring;
  - posting steme's check run;
  - steme's own conformity fixes and its mapping into these formats;
  - the plan auditor's answer;
  - severity or rank beyond the provider's order;
  - columns in a location.

Still for the spec to settle (§9 only if a real choice remains):
- the exact keys where the above only suggests them;
- `brief.push`'s values and default;
- the hello-world example. Its `audit.mjs` and `brief.mjs` answer the two formats over two rules ("a module under src/ exports its function", "a module under src/ imports no node: module"), with at least one guide file that ships in the example;
- the README's "Diagnostics gate steps" (to be renamed), "Gate request", "Brief provider" and "Persisted formats" sections;
- the schemas package.

Ground to read first:
- **phax, the README:** "Diagnostics gate steps", "Gate request", "Brief provider", "Persisted formats".
- **phax, the schemas:** `src/schemas/gateDiagnostics.ts`, `src/schemas/brief.ts`, `src/schemas/persisted.ts` and `src/schemas/gateAttribution.ts`.
- **phax, the gate:** `src/app/gates.ts`, `src/app/fixLoop.ts`, `src/domain/gate/fixPrompt.ts`, and the `gates_exhausted` pause in `src/domain/reducer.ts` and `src/app/resumeInstructions.ts`.
- **phax, the brief:** `src/app/briefProvider.ts`, `pushedBrief.ts`, `pullBrief.ts`, `src/domain/brief/`, and the brief config in the phax.json schema.
- **phax, review:** `src/app/reviewHandoff.ts`, `handoffGeneration.ts`, `src/domain/publish/body.ts` and `src/app/recordsExplain.ts`.
- **phax, the example:** `examples/hello-world/`.
- **The retired-schema precedent:** `site/retired-schemas/gate-pending/`.
- **The archived specs:** `drop-orient`, `drop-gate-scopes`, `gate-request` and `brief-provider`.
- **The replaced spec** (`docs/specs/archive/2610090907-guarantee-reports.md`, abandoned), whose refusal, records, served-URL, review-placement and fix-loop surfaces may be reused where they agree with the decisions above. Its vocabulary and nesting may not.
- **The landed `open-next-release`:** stamps name the shape; new formats are born at the opened version (0.21.0).
- **NEXT_STEPS.md:** the steme section, and the entry on the served schemas' description, which this spec does not change.

Constraints:
- No back-compat shims.
- Explicit per-variant enums: the gate report's outcome, `due`, `brief.push` and gate attribution's result.
- A brief informs and never blocks; the gate's verdict is the provider's list.
- phax judges nothing in the content. Its decode checks are structural only: keys, unique finding ids, line order.
- Every `$schema` names its format.

Output: your final message is the spec document JSON and nothing else — no sentence before or after it, no code fence.
