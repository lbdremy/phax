Write the phax spec `project-doctrine`: phax's arbitration doctrine is split in two layers, a bundled base of software-engineering practice that ships with phax and is the same for every project, and a project's own doctrine of taste, a versioned document in the repository that grows decision by decision, changes over time, and reaches every session that writes or decides a question.

**Why.** The operator, 2026-11-05. phax bundles two doctrine skills, `phax-decide-spec` and `phax-decide-plan` (`.claude/skills/phax-decide-*/SKILL.md`, shipped through the skill catalog). They mix two kinds of rules:

- practice any project would follow: frame an option by the loss it abandons, argue for the abandoned option first, nothing destructive without a separate gesture, inside-out to implement and outside-in to verify, a fix stays inside the run's footprint, escalate what changes the public surface or reverses a decision;
- taste, which belongs to one project at one time: the ranking of "the author's five pairs" C1–C5, "before 1.0 there is no stability contract: break freely", docs last.

The taste ships to every phax user as if it were practice, and no project can say "this is ours, and it changes". Meanwhile the operator's actual rules live where no phax session reads them: the project's `CLAUDE.md` ("no back-compat shims in persisted schemas: new fields are required", "prefer explicit per-variant enums over a permissive superset") and an assistant's private memory (arbitrate on the dominant loss; runs stay autonomous; ship the minimal slice when questions pile up; human input goes to review notes).

Taste also has a lifetime. "No back-compat shims" holds while phax is before 1.0; the day 1.0 signs its stability contract it is retired, and decisions taken under it must still read as taken under it.

**Where the doctrine acts today (read it first):**
- `src/app/resolveDoctrine.ts`: a decide session's doctrine is the project copy `.claude/skills/<name>/SKILL.md` when it exists, else the bundled skill, then the `--doctrine <file>` text appended. `src/domain/decide/doctrine.ts` extracts the citable principle ids (backticked ids opening list items).
- The doctrine text reaches two prompts only: the interactive decide session (`src/domain/decide/prompt.ts`) and the verdicts writer (`src/domain/decide/verdictsPrompt.ts`), which transcribes choices a person already made and writes each verdict's advocate, principles and reversibility after the choice.
- Headless authoring (`src/app/authorArtifact.ts`), where questions, options and recommendations are written, loads `phax-spec` or `phax-planning` only: recommendations are made without any doctrine, and nothing says which principle a recommendation rests on.
- The decision record (`src/schemas/decisionRecord.ts`, `doctrine: DoctrineSource[]`) records where a session's doctrine came from and its fingerprint.
- A project can replace a whole bundled skill with a copy of the same name, or append a free-form file with `--doctrine`: no structure, no history, decide only.

**What the spec must cover:**
- **The two layers.** What stays in phax's bundled doctrine (practice, not configurable, the same in every project) and what moves out of it (taste). The brief's triage below is a proposal: the spec's §9 asks the operator to confirm or move each item.
- **The project doctrine document.** A versioned JSON document in the repository (`$schema`, like phax's other formats), its path, and its entries: a stable citable id, the statement, the reason, when it was adopted and from which decision or person, and, once retired, when, why and which entry replaces it. A retired entry is kept, never deleted. A human-readable rendering if the operator wants one (as specs and plans have a Markdown body beside their sidecar).
- **The command line.** Verbs to add, retire, supersede and list entries (in force, or as of a date or commit), each a commit of exactly that file, with `--json` answers under command-contracts' rules.
- **Where it applies.** Headless authoring of specs and plans and every decide mode load phax's base doctrine and the project's entries in force. A recommendation names the ids it rests on, from either layer; one that rests on none says so, which marks it as a question of taste for the operator. The verdicts writer and the interactive session cite the same ids.
- **Attribution over time.** A decision records which entries were in force when it was taken (the decision record's doctrine sources gain the project document's id and version or fingerprint), so retiring an entry never rewrites what past decisions rested on.
- **Growing it.** How an entry is born: by hand through the CLI, and proposed from a departing verdict's note or from a question the operator answers "this is a rule". A proposal is never an entry until the operator accepts it.
- **What happens to `--doctrine <file>` and to a project copy of a bundled skill** once the project document exists (kept, folded in, or retired; no back-compat shims).

**Proposed triage of today's content (material for §9, not settled):**
- Base, bundled: dominant-loss framing (from `phax-planning`); S0 advocate first; S7 nothing destructive without a separate gesture; S8 dissolve contradictions; S9/P1 classify then escalate surface and reversals; P4 a fix stays in the footprint; P8 inside-out to implement, outside-in to verify; P9 amend, don't drift; the three decide modes and the verdict output shape.
- Taste, project: the C1–C5 pairs and their precedence; S1 adopt the default; S2 deviate toward the stricter; S3 refuse, don't warn; S4 one source, one gesture; S5 total on inputs, minimal on outputs; S6 no scalar that erases attribution; S10 words for the reader; P2 split by surface; P3 acceptance first; P5 three optional files per phase; P6 model and effort are the planner's; P7 docs last; "before 1.0, break freely"; plus the rules now outside any doctrine: no back-compat shims in persisted schemas (until 1.0), explicit per-variant enums, runs stay autonomous, ship the minimal slice, arbitrate on the dominant loss.

**Questions for the spec to settle or open in §9:**
- Each item of the triage: base or taste.
- Whether the project document seeds itself from today's bundled taste on `phax init`, starts empty, or is migrated once for existing projects.
- Whether authoring applies the project's entries (a recommendation follows them) or only shows them (it cites them and the operator applies).
- Whether a question whose recommendation rests only on base practice and is cheap to reverse is marked routine, and what phax does with routine questions (nothing yet; a headless decide later).
- How the project document travels to records (it is in the repository, so a record's `sourceSha` already recovers it).

**Constraints:** no back-compat shims; new fields are required; the decision record and sidecars of past decisions stay byte for byte; tests never read a real `~/.claude` or `~/.phax`. Fixtures and names in examples are made up.

**Surfaces.** A surface's `summary`, `before` and `after` are read by users in the release notes: a capitalized sentence and short real examples, with no implementation notes. Name `$schema` URLs at the release this ships in.

**Output:** your final message is the spec document JSON and nothing else: no sentence before or after it, and no code fence.
