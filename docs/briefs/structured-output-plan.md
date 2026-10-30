Write the first of the two phax plans of the spec `structured-output` (`docs/specs/2610271515-structured-output.md`, approved 2026-10-30). Plan 2 ships the structured compliance review and completes the spec, so this run does not complete it (`completes-spec: false`). Title it "Strict answers and native structured output".

**Scope.** Everything in the spec except what §10's "Plans" line gives to plan 2. That covers:
- §5.1 to §5.12 and their acceptance criteria;
- every acceptance criterion except plan 2's: `ac-vibe`, `ac-cr-readonly`, `ac-cr-render`, `ac-cr-phases`, `ac-cr-refused`, `ac-cr-file`, and `ac-every-call` for the compliance review;
- the §6 surfaces other than `phax review-compliance`, `compliance-review.json` and `compliance-review.md`.

In short:
- **One strict answer schema per structured answer.** It is published, handed as-is to Claude Code (`--json-schema`) and Codex (`--output-schema`), and enforced by phax's decoder together with the call's coherence checks.
  - The answers: `spec-document`, `plan-document`, `hand-decision-answer`, `first-reading`, `interactive-handoff`, `code-review` and the new `phax-plan-extraction`.
  - The strict rules (§5.4): closed objects, every key required, no root `anyOf`, no `oneOf` or `allOf`, no lookaround, strings constrained only by `pattern` or `format`, and a required `$schema` const.
  - Known gaps:
    - `minLength` (from `NonEmptyString`) becomes an equivalent pattern;
    - `hand-decision-answer` loses its root union;
    - `plan-document`'s root `allOf`/`oneOf` pairing of `sourceSpec` and `completesSpec` becomes a coherence check;
    - the six lookahead patterns and the stacked `allOf` patterns of the test lines (`plan-document` and the extraction answer) are rewritten or become coherence checks;
    - the code-review and extraction answers carry `$schema` in place of `version`.
  - No rule leaves the decoder (§5.5).
- **The strict check (§5.6).** A test over every answer schema that names the answer and the construct. Tests stay offline, so encode the providers' rules locally.
- **Native structured output on the seven calls of this plan** (§5.1, §5.7):
  - the calls: headless authoring, the extraction fallback, decide's handback, the `decide --verdicts` writer, the interactive first turn, the interactive closing turn and the headless code review;
  - the provider gets the schema on the first session and on the corrective resume;
  - a Claude Code result's `structured_output` is decoded, and answers even when the text is empty;
  - the structured value travels in the session outcome beside the text.
- **The Claude Code prompt fallback per call (§5.3, q-unsupported-combination):** named, tested and never silent.
- **Mistral Vibe (§5.2):** the full schema in the prompt on every call, the code review included. An empty final answer is a decoder refusal and gets the corrective resume.
- **The corrective resume (§5.9).** The headless code review gains one (§5.11); a session that changed the worktree still fails, with its paths put back.
- **`error_max_structured_output_retries` (§5.10):** a `provider-error`, with no corrective resume. A resumed closing turn that fails with this subtype starts no new session; any other `provider-error` keeps today's lost-session fallback.
- **The extraction's incomplete-plan report inside its schema (§5.12).**

**What exists (read it first):** the spec's §1 ground list is current as of 2026-10-30. Read it, then:
- `src/schemas/release.ts` and `src/schemas/schemaUrl.ts` (`FORMAT_IDS`);
- `packages/schemas/` (snapshots, `json/`, the history modules);
- `scripts/schemas-check.ts`.

**Settle in Technical arbitrations, each with its dominant loss:**
- `hand-decision-answer` without a root union: two formats, or one closed object with `kind`. Say how decide's callers and the published schema change.
- For each lookahead or stacked pattern: the rewrite without lookaround, or the coherence check that replaces it. Say which errors the decoder then names.
- Where the strict `NonEmptyString` lives, and which formats' published schemas change and get a `next` snapshot at 0.32.0. Some formats that are not answers may share the module; say whether the change stays scoped to the answers.
- How the structured value crosses the Backend port and the session outcome, and where `finalText` is no longer read.
- Where Codex's schema file is written, and how a large schema reaches Claude Code inline without hitting argv limits.
- How the Claude Code prompt fallback is declared per call, and where its table lives, for the code, the tests and the docs page.
- The corrective resume's transcript file for the headless code review. A Vibe turn deletes the export beside its transcript.

**Real-CLI smoke tests.**
- Claude Code's `--json-schema` with `--resume`, with read-only tools and with stream-json, once per answer schema.
- Codex's `--output-schema` on `exec` and `exec resume`.
- Each in `tests/e2e/`, gated on `PHAX_E2E_RUN=1`, in named files. The phase gate does not run them. The phase agents cannot run them either, so say so in the test strategy: the PR review runs them by name.
- Build the fallback so that flipping one call to the prompt schema after the e2e is a one-line change, its test included.
- Target versions: Claude Code 2.1.314, codex-cli 0.165.0, Mistral Vibe 3.0.3.

**Constraints:**
- **Persisted shapes.** No back-compat shims, and no optional field in a persisted shape. Each format whose published schema changes gets a `next` snapshot stamped 0.32.0, the opened version, and older stamps read through the frozen history modules.
- **Live sidecars.** Do not migrate this repository's live spec and plan sidecars in the run: the operator runs `phax artifact migrate-documents` with the released 0.32.0. The run itself is driven by the installed 0.31.0, and must keep reading its own plan.
- **Isolation.** Tests never read `~/.phax`, a real `~/.claude`, `~/.codex` or `~/.vibe`, the global git config, or the real `gh`. Use `tests/helpers/isolateGit.ts`, temporary directories, the fake provider backends and `makeFakeGitHub()`. The fakes must record the schema flags and the prompt.
- **Registries.** Respect the layer rules of `pnpm audit:architecture` and every exhaustive format registry the schemas package tests hold, and list those registries as planned edits.
- **Gates.** The `standard` profile verifies every phase, and `phax.json` allows every command a phase runs. Regenerate `phax.usage.kdl` and `docs/cli/reference.md` (`pnpm gen:usage-spec`, `pnpm docs:cli`) when help text or exit codes change.
- **Models.** Follow the phax-planning skill's model policy.
- **`### Test strategy`.** Use the line format, with the spec's criterion ids. Cover every plan-1 criterion.
- **Oracle pair.** The strict check is a pure function from a JSON Schema to its violations, and a stable contract before its code exists, so it is a strong candidate. If you do not use one, say why.
- **Lint.** The plan must pass `phax plans lint`.
- **Skills.** No skill changes, so the run needs no `--allow-skill-edits`. If the phax-planning skill's text about `sourceSpec`/`completesSpec` or test-line shapes must change, say so instead, and leave it for the operator.

**Docs:**
- the spec's §11 page "Structured answers and providers", with its per-provider table. Plan 2 adds the compliance review to it.
- `docs/upgrading.md` 0.32.0, for records and schema readers:
  - `hand-decision-answer` loses its root union;
  - `plan-document` loses its pairing;
  - `$schema` becomes a const;
  - the code-review answer and the new `phax-plan-extraction` format;
  - the `migrate-documents` step for live sidecars.

**Phase shape:** as few phases as the gates allow, with every commit green. The strict schemas come before the provider flags.

**Output:** your final message is the plan document JSON and nothing else: no sentence before or after it, and no code fence.
