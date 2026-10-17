Write the phax spec `planning-skill-defaults`: three changes to how a plan is written, carried by one spec because all three live in the planning skill and the headless plan authoring. A later spec (`phase-model-assignment`, an optional planning file the repository owns) will bound these defaults; this spec must stand without it.

Why: the planning skill (`.claude/skills/phax-planning/SKILL.md`) picks each phase's model before the phase is written and defaults to the strongest tier ("The default phase model is `claude-opus-5-5`"), and it states one architecture as doctrine. An experiment run outside phax (one ticket, a two-phase plan written once by the headless planner, executed 24 times by `phax run`, every phase's model set by the experiment) found:
- on the plan as the planner wrote it, every run delivered the ticket and kept the codebase's engineering rules at Sonnet 5.5 (half the cost of Opus 5.5) and at Haiku 5.5 (a sixth); the one run that broke a rule was at Opus;
- on the same plan cut of its detailed instructions, Haiku broke a rule in two runs out of three without a guarantee gate, and in none with one;
- the plan, written by a strong planner, carried most of the work. A strong planner and lighter executors is also what published practice recommends (planner/executor splits, architect/editor modes).
Decided by the author on 2026-10-17.

The changes:

1. **Write the phases first, then assign each its model and effort.**
   - The skill's "Choosing a model and effort" and the headless plan authoring (`src/app/authorArtifact.ts`, `src/domain/authoring/prompt.ts`, `src/schemas/planDocument.ts`) are reordered: the phases are cut and written, then each phase's model and effort are chosen from what the written phase asks for.
   - The default is `claude-sonnet-5-5` at `medium`. The policy the skill states:
     - higher effort, or `claude-opus-5-5`, when the phase must design something no code in the repository shows yet — a new state machine, an adapter to a system the code does not reach yet, a choice that crosses several parts of the architecture;
     - `claude-haiku-5-5` when the phase reproduces a pattern the code already holds and a gate checks it;
     - every phase that leaves the default says why, on the phase or in Technical arbitrations.
   - The planner's own model stays where it is configured (`authoring.plan`); this spec changes what the planner assigns, not the planner.
   - "Comprehensive instructions" stays: a phase given a lighter model needs the detail.
   - The catalog stays the source of truth; no model id is hard-coded beyond what the catalog lists. Settle how the skill's text names the default so a catalog change does not leave it stale (the model catalog section is already generated).

2. **The architecture is an example; the repository's comes from the repository.**
   - Today the skill states one architecture as doctrine: "Planning doctrine" (page → view-model → command → domain → port → adapter → storage), the layer table of "Test strategy", the boundaries of "Boundary contracts". A repository built otherwise is handed an architecture that is not its own.
   - Keep the principle as doctrine — plan outside-in, implement inside-out, verify outside-in — and mark the layer chain, the test table and the boundary list as one example architecture. The skill tells the planner where the repository's own comes from: `phax architecture` when a provider is configured, otherwise the code and its documentation (README, CLAUDE.md or equivalent).

3. **`phax architecture [path]...`: the architecture, from a provider.**
   - A new command, built like `phax brief`: it asks the provider configured as `architecture` in `phax.json` (and the layers `brief` is read from), with no path for the whole repository or with paths for the parts that hold them, and prints its answer. Allowed inside a phase worktree, as `phax brief` is.
   - The provider's answer is a new format phax owns, with its `$schema` stamp. Keep it minimal so the seam exists before any provider says much: settle its shape (for instance a Markdown body for the agent to read, and nothing a provider must compute). A provider such as steme will later fill it with what its standard knows — the parts of the code, what each guarantees, the order the dependencies between them impose.
   - With no provider configured, the command prints one line saying none is configured and where to read the architecture instead, and exits so that an agent reads it as information, not as a failure. `phax brief` exits 1 with no provider today: settle whether both commands align (§9), and frame what each option abandons.
   - Headless plan authoring tells the agent, in its prompt, whether an architecture provider is configured, so it calls the command only when one is. When the skill is used directly, the command's message tells the agent.

Out of scope:
- The optional planning file (`phax.planning.json`) and its lint: the `phase-model-assignment` spec.
- Escalating a phase's model after a failed gate (a cascade).
- What a provider puts in its architecture answer beyond the minimal format.

Ground to read first:
- `.claude/skills/phax-planning/SKILL.md`: "Planning doctrine", "Test strategy (informational)", "Boundary contracts (informational)", "Model catalog" and "Choosing a model and effort", "Planning constraints", "Headless authoring".
- How the skill is installed and its generated sections kept fresh (`src/domain/skills/catalog.ts`, `phax skills install`).
- `src/app/authorArtifact.ts`, `src/domain/authoring/prompt.ts`, `src/schemas/planDocument.ts`.
- `phax brief` end to end: its command, its config (`brief` in `src/schemas/phaxConfig.ts`), its request and report formats, its behaviour with no provider and inside a phase worktree (`phax --usage`, cmd brief).
- How a format is stamped and snapshotted (`src/schemas/schemaUrl.ts`, `packages/schemas/`), and `docs/release.md`.
- `NEXT_STEPS.md`.

Constraints:
- No back-compat shims in persisted schemas; new fields are required.
- Explicit per-variant enums.
- Respect the layers.
- phax stays autonomous: nothing waits on a person.
- phax never chooses or rewrites a model silently.
- Fixtures and examples are made up.
- Tests hold across a release cut.

Output: your final message is the spec document JSON and nothing else — no sentence before or after it, no code fence.
