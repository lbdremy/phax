Write the phax spec `structured-diagnostics`: a new shape for the `gate-diagnostics` document a gate step prints, so a provider that knows more than "a rule, a line and a sentence" can hand it to phax, and phax can put it in front of the agent and keep it in the records.

Why (raised 2026-10-08 by the author): steme's guarantee model has been restructured (packs that define guarantees, a standard that places them, a unit manifest that binds them; repairs rendered as blueprints and skills; accepted debt keyed by the ledger). It now knows far more about each finding than the 0.20.0 shape can carry. The authoritative description is steme's surface document: `/Volumes/Work/steme/steme-corpus/docs/corpus/02-product/steme-surface.md`, above all §10 "The gate and the agent" and §14.1 "The commands", with its example outputs under `steme-surface/target/out/` (`diagnostics.phax.json`, `check-run.json`) and the decisions `05-decisions/27`–`30`. Read them; do not copy their content or file names into phax. phax stays a generic harness: every field must make sense for any provider, and steme is the first one to fill it. The examples in the spec are made up, in the hello-world example's vocabulary.

What steme has and the 0.20.0 shape loses (§10, and its target's diagnostics document):
- **Identity.** A finding is keyed by its ledger key (instance, guarantee, leg). phax gets `rule` (`<guarantee>/<leg>`), and the instance survives only as a label inside `message`. Two findings can be identical in `class`, `rule` and `location` and differ only in their message text.
- **Statement versus finding.** `message` concatenates the guarantee's statement, the instance's label, and what is wrong at the place.
- **Ranges and other files.** The ledger and the check run carry ranges (`start_line`/`end_line`). phax carries `line` only. A finding about an edge between two files, or about names captured in another file, names its second file only in text.
- **Repairs as data.** steme renders each repair into the unit as a blueprint (laid down by a tool, then edits) or a skill (an Agent Skill). Each carries a one-line description in its frontmatter. phax's `repair` is a string, so steme writes `"Blueprint: <path>"` / `"Skill: <path>"`.
- **Accepted debt.** steme lists the legs the unit accepted apart from the failing ones, each with who accepted it, when and why, and phax should fail on the first list only (§10). steme already writes an `accepted` list. phax decodes the document, drops every key but `diagnostics`, and saves only the findings.
- **What is left to judgement, and by whom.** steme states it per guarantee, and shows it in its check run.

What the spec must cover:
- **The new diagnostic shape**, with each field required or optional, per-variant where the variants differ:
  - a stable identity for the finding, unique in the document;
  - what the finding is about (a rule, or the guarantee and its leg), the statement apart from what is wrong at the place;
  - the location with an optional end line, and other locations the finding involves;
  - the repair as data, with its kind and a description. Say which kinds exist (a document to read, a template to lay down, free text) and what phax does with each.
- **Accepted debt in the document:** its shape (the same identity and location, who, when, why), that it never fails the step, and what phax does with it.
- **What phax does with the new data:**
  - The fix prompt (`src/domain/gate/fixPrompt.ts`): statement, what, range, related locations, the repair's kind, path and description, and the accepted debt to leave alone.
  - A finding whose identity persists from one attempt to the next: whether the prompt says so.
  - The saved `checks-attempt-NN.diagnostics.json` (`src/app/gates.ts`): it keeps the whole document, accepted debt included, not only the findings.
  - `phax records explain --gates`.
- **Versioning.**
  - The new shape is refused in its old form: an answer stamped with the 0.20.0 shape is refused by name, naming the shape to answer in (decided 2026-10-08; before 1.0 an older answer shape is refused, from 1.0 it will be read through its frozen shape).
  - Saved `.diagnostics.json` files in existing run folders stay readable through a frozen 0.20.0 shape, as phax's own files always are.
  - The schemas package gains the new shape and keeps the old one. The guard test that holds the answer reader to one shape is updated, not removed.
  - How the shape is named follows `open-next-release` (stamps name the shape) if it has landed; say what the spec assumes if it has not.
- **The hello-world example** (`examples/hello-world/audit.mjs`) answers in the new shape, and the README's "Diagnostics gate steps" section describes it.

Out of scope:
- **A finding that only the owner may decide.** A `decision` class that stops the phase instead of sending a fix attempt is a separate spec, after this one, joining the parked `phase-decision-requests` spec (decided 2026-10-08).
- **Escalating or stopping on a finding that oscillates across attempts.** The identity makes it possible; this spec at most reports it.
- **The brief answer.** It gets its own spec next, reusing this one's vocabulary.
- **steme's own fixes:**
  - its target documents are stamped `gate-diagnostics/0.19.0`, which phax 0.20 refuses;
  - its brief answers carry its own `$schema` and an object `repair`;
  - its copy of the brief-request schema pins 0.19.0.

Ground to read first:
- steme: the surface document and companions above.
- phax:
  - the README sections "Diagnostics gate steps", "Gate request" and "Brief provider";
  - `src/schemas/gateDiagnostics.ts` and `src/schemas/persisted.ts` (`readGateDiagnosticsAnswer`);
  - `src/app/gates.ts` and `src/domain/gate/fixPrompt.ts`;
  - `src/schemas/history/gate-diagnostics/`, and `packages/schemas/src/formats/recordTimeline.ts`;
  - `examples/hello-world/audit.mjs`;
  - the archived specs `drop-gate-scopes` and `gate-request`;
  - the `open-next-release` brief (`docs/briefs/open-next-release.md`);
  - NEXT_STEPS.md (the steme section, and "A persisted-format stability promise").

Constraints:
- No back-compat shims in persisted schemas: new fields are required unless absence means something.
- Explicit per-variant enums.
- The gate's verdict stays the document's: every finding fails the step, accepted debt never does.
- phax judges nothing in the content.
- §9: genuine choices only. Each comes with its options, what each abandons, and a recommended default. At least:
  - the identity's form (opaque string, or structured);
  - generic `rule` versus guarantee and leg;
  - the repair kinds;
  - whether phax reads a repair's file into the prompt or only names it;
  - what the prompt says about a finding that persists.

Output: your final message is the spec document JSON and nothing else — no sentence before or after it, no code fence.
