Write the phax spec `phase-model-assignment`: an optional planning file the repository owns, which bounds the model and effort the planner gives each phase, and the seam a provider uses to help within those bounds.

Why: which phase deserves which model is a judgment no metric settles. Every rule a codebase checks holds a form a program verifies and leaves a part to judgment, so neither phax nor a guarantee provider can rank phases by difficulty. An experiment run outside phax (one ticket, a two-phase plan written once by the headless planner, executed 24 times by `phax run`, every phase's model set by the experiment) showed lighter executors holding up on a detailed plan, and a light executor breaking engineering rules on a thin plan unless a guarantee gate ran in its loop. Decided by the author on 2026-10-17: the judgment belongs to the person responsible for the repository, written once in a file; phax applies it and never decides it; a provider can produce the file's skeleton in its own vocabulary.

The file is optional. A separate spec, `planning-skill-defaults` (being written at the same time, independent of this one), gives the planning skill its own default policy: write the phases first, then assign; `claude-sonnet-5-5` at `medium` by default; higher, or `claude-opus-5-5`, when a phase designs what no code shows yet; `claude-haiku-5-5` when it reproduces a pattern the code holds and a gate checks it; a reason for every phase that leaves the default. With no planning file, that policy applies unchanged; nothing in this spec may require the file.

The changes:

1. **A planning file the repository owns: `phax.planning.json`.**
   - A new format phax owns, with its JSON Schema and its `$schema` stamp like every phax format. It sits beside `phax.json` and is separate from it, so that any provider can produce its entries without knowing `phax.json`.
   - It is a list of entries. Each entry carries:
     - `id`: stable, the key every merge uses;
     - `source`: who produced it — a provider's name, or absent for an entry written by hand;
     - `name`: free text, never interpreted by phax, shown wherever phax justifies a choice. A provider puts its own vocabulary there (for a guarantee provider such as steme: the scope or concept the files belong to, e.g. `core · decider`, `http · request contract`);
     - `description`: one sentence;
     - `globs`: the files the entry covers;
     - `model` and an effort range (`min`, `max`): filled by the person, never by a provider.
   - Producing and keeping it:
     - a provider emits entries (id, name, description, globs). phax merges them into the file — settle the command (for example `phax planning sync`) and where the provider's entries come from (a file, stdin, or a provider command declared in `phax.json` like `brief` and `planAuditor`);
     - the merge adds new entries without a model (to be filled), reports entries the provider no longer emits without deleting them, touches only entries whose `source` is that provider, and never changes `model` or the effort range;
     - entries written by hand live beside the provider's and no merge touches them.
   - Applying it, only when the file exists:
     - a phase's planned files are matched against every entry's globs. When a phase matches several entries, the most demanding one wins (highest model, highest range) — settle the order of models from the catalog;
     - a file no entry matches takes the file's default entry (or, with no such entry, the skill's default policy);
     - the planner chooses the effort within the range and says why, in the phase;
     - an entry with no model yet is reported, not guessed.
   - Checking it:
     - `phax plans lint`'s models check gains the planning file: a phase whose model or effort falls outside what its files' entries allow is an error, unless the phase declares a derogation with its reason; the finding names the entry by its `name`;
     - `phax validate` refuses a model the catalog does not list and an inverted range;
     - phax never rewrites a model or effort the plan states.
   - In the plan: each phase shows which entries its files matched, by name, next to its model and effort, so a reader sees why.

2. **The provider during planning (settle the seam, §9).** Within an entry's range, the planner may ask the provider for facts about a phase's files — for a guarantee provider, whether the code already holds instances of what the phase will write, or whether it is the first of its kind. Facts, never a score or a model name: the provider knows no model. Frame the options: the existing `phax brief` and its report; the `planAuditor` seam (today advisory findings on `{phases:[{id, files}]}`); or a new provider seat. Say what each abandons.

Out of scope:
- The skill's default policy, its architecture guidance and `phax architecture`: the `planning-skill-defaults` spec.
- Escalating a phase's model after a failed gate (a cascade): a later spec.
- Calibrating ranges from the cost ledger.

Ground to read first:
- `.claude/skills/phax-planning/SKILL.md`: "Choosing a model and effort", the generated model catalog, "Comprehensive instructions", the lint section.
- `src/app/lintPlan.ts` and its models check (`modelFindings`), `src/app/loadRouting.ts`.
- `src/app/authorArtifact.ts`, `src/domain/authoring/prompt.ts`, `src/domain/authoring/renderPlan.ts`, `src/schemas/planDocument.ts`, `src/domain/plan/parsePlanMarkdown.ts`.
- `src/schemas/phaxConfig.ts`: `brief`, `planAuditor`, `authoring` — the provider seams and how they are declared.
- How a format is stamped and snapshotted (`src/schemas/schemaUrl.ts`, `packages/schemas/`).
- `NEXT_STEPS.md`, and the approved specs `cost-ledger` and `plan-estimate` (what a run records of models and cost).

Constraints:
- No back-compat shims in persisted schemas; new fields are required.
- Explicit per-variant enums.
- Respect the layers.
- phax stays autonomous: nothing waits on a person. A missing model in an entry is reported; the run does not stop to ask.
- phax never chooses or rewrites a model silently.
- Fixtures and examples are made up.
- Tests hold across a release cut.

Output: your final message is the spec document JSON and nothing else — no sentence before or after it, no code fence.
