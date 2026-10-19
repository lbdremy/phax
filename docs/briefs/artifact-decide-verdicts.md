Write the phax spec `artifact-decide-verdicts`: a headless mode of `phax artifact decide` where the verdicts are already decided and given as input, and an agent only transcribes them into the document.

Why: `phax artifact decide` is interactive only. A person who already knows their verdicts (often "the recommendations, except one") must still open a terminal session to say them. A caller without a terminal cannot apply them at all: an agent working for the person, or a loop such as the steme conductor relaying a person's instruction. The interactive session decides nothing the person had not already decided; it exists to transcribe. The step after the session is already headless: phax resumes the session, asks for the whole revised sidecar document, checks it, renders it and shows the body diff for the person to accept.

Decided by the author on 2026-10-19:
- The mode lives in phax, as a mode of `phax artifact decide`, not a separate tool.
- The person decides; the agent only transcribes. This is not the doctrine's `headless` mode, where the agent decides within the menu and escalates the rest: that mode stays unspecified, as the `artifact-decide` spec left it.
- A verdict that departs from the recommendation still revises the body (requirements, surface, acceptance criteria), so an agent is needed; phax cannot do it deterministically.
- **phax runs no checker session.** Deciding never approves: the artifact stays Draft, and approval stays a separate act. Whoever called the headless mode (the person, or the agent session that ran the command for them) reads the result and makes sure it says what was decided before approving; a mistake is fixed by deciding again (`--question` re-arbitrates) or by reopening the question. phax's part is to make that reading easy, not to do it.

The changes:

1. **The input.** A new versioned format phax owns (with its JSON Schema and `$schema` stamp, like every phax format) holding the verdicts: for each question decided, the question id, the chosen option id, and the person's note (their reason, or a precision on how to apply the option; settle whether it is required). Given as `--verdicts <file|->`.
   - Settle: whether questions the file does not name stay open (as `--question` presents one alone today); whether an off-menu choice is allowed (a person's own option, written in the note) or refused; re-arbitrating an already arbitrated question (its previous verdict kept in its history, as today).
   - Refuse before any session, writing nothing: an unknown question id, an option the question does not list, a file refused by its schema, and every refusal today's decide makes (not Draft, diverged or invalid sidecar, uncommitted changes, no committing git identity, inside a phase worktree). Headless mode needs no terminal.

2. **The writer.** A headless session resumes the artifact's authoring session when phax kept its id, else starts a new one, as interactive decide does, with the doctrine skill loaded. It returns the whole revised sidecar document. It writes each verdict's `why` from the person's note (or, for a chosen recommendation with no note, from the recommendation's rationale), its principles, reversibility and advocate, and the body revisions a departing verdict needs, naming them in `revised`. It changes nothing else.
   - phax runs today's checks on the answer (only the given questions move, chosen and abandoned name the question's options, cited principles are loaded ids, a departing verdict names what it revised), plus: each verdict's `chosen` is exactly the one given. A refused answer gets one corrective resume, as today.

3. **Writing it, for the caller to read.** On a valid answer phax writes, renders and commits as today, with no diff confirm, and the artifact stays Draft. It prints what the caller needs to review: the verdicts as transcribed (chosen, why, revised) and the body diff, or the commit to diff. Settle the output (human and `--json`), and what the commit carries to say the verdicts came from a file (a trailer).

4. **Attribution.** A verdict today is stamped `by: { kind: operator, name }` from the committing git identity. Settle how a verdict given through a file is attributed: always the operator (the person decided, the file only carries it), or `--by operator | machine:<grant>` as `approve` and `reopen` take, for a loop relaying a person's instruction. Never a guessed name.

5. **Providers and models.** Interactive decide runs on Claude Code only. Settle whether the headless writer goes through model routing like other headless sessions (any provider), and its default model and effort (`authoring.*` in phax.json, the catalog defaults). Follow the planning-skill guidance on defaults by cost.

6. **Records and exit codes.** When records are configured, the session writes its record like an authoring session. Exit codes follow today's decide: 0 decided and committed, 5 refused answer after the corrective resume, 8 rate or usage limit, 12 artifact refusal, 1 inside a phase worktree; nothing is written on any failure.

Out of scope:
- The doctrine's `headless` and `headless total` modes, where an agent decides.
- A checker session run by phax.
- Changing interactive decide.

Ground to read first:
- `docs/specs/archive/2610140742-artifact-decide.md` (Completed): the shipped decide, its checks, its exit codes, its verdict and history shapes.
- `docs/ideas/artifact-decide.md`: the original idea, its headless and interactive modes.
- `src/app/decideArtifact.ts`, `src/schemas/questions.ts`, `src/schemas/decisionRecord.ts`, `src/schemas/handDecisionAnswer.ts`.
- `.claude/skills/phax-decide-spec/SKILL.md` and `phax-decide-plan`: the modes, propose-and-escalate, principle ids.
- `src/app/authorArtifact.ts` and the authoring record: how a headless session is spawned, checked and recorded.
- `docs/specs/2609250823-headless-review.md` (Draft): the approver form `machine:<grant>` and review decisions in the decide shape.

Constraints:
- No back-compat shims in persisted schemas; new fields are required.
- Explicit per-variant enums.
- Respect the layers.
- Deciding never approves; the artifact stays Draft.
- Fixtures and examples are made up.
- Tests hold across a release cut.

Output: your final message is the spec document JSON and nothing else — no sentence before or after it, no code fence.
