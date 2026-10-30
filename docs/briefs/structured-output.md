Write the phax spec "Structured output". Every agent call that must return a structured answer uses the provider's native structured output where the provider has it. phax's own decoder stays the only judge. It comes after the spec "Provider failures", whose session-outcome reader it extends; name that spec as a prerequisite.

**Why.** Today phax puts the answer's JSON Schema in the prompt text, decodes the answer afterwards, and on a refusal resumes the session once at most. A wrong key, a wrong id or a missing `$schema` therefore costs a whole session or a corrective turn. With native structured output, the provider makes the model correct its shape until it passes. The operator decided on 2026-10-27 that phax uses it everywhere it can.

**Provider facts, checked on 2026-10-27:**
- **Claude Code 2.1.311** has `--json-schema <schema>`: the schema is inline, and it only works with `--print`. The Agent SDK delivers the answer as `structured_output` on the result event. A provider-side failure has subtype `error_max_structured_output_retries`. Whether it combines with `--resume`, `--tools` and stream-json is not stated: the plan smoke-tests it once per schema.
- **Codex 0.153.4** has `--output-schema <FILE>`, on `exec` and `exec resume`. The schema is sent with `strict: true`, so OpenAI's strict subset applies.
- **Mistral Vibe 3.0.3** has no schema option. Its `--output json|streaming` only formats the transcript.

**Settled by the operator (do not reopen):**
1. **Two validations.**
   - **The provider schema:** one simplified version per answer, shared by Claude Code and Codex. It fits the stricter of the two, Codex strict: no lookahead patterns, no root `anyOf`/`oneOf`, `$schema` as a `const`. The provider enforces it while generating.
   - **phax's full decoder:** the published schema, plus the internal-coherence checks no schema can express, stays the final judge on every provider. Examples of those checks: a criterion id must exist in the source spec's sidecar; a verdict moves only presented questions; a revision names the sections it touches; phase ids must exist.
   - **A refusal by phax's decoder** keeps its one corrective resume.
   - **The provider schema is derived from the full schema,** never written by hand. A test keeps each provider schema accepted by both providers' rules.
2. **The calls that move to native structured output:**
   - headless authoring of specs and plans (`src/app/authorArtifact.ts`);
   - the plan-extraction LLM fallback (`src/app/extractPlan.ts`), whose `{"error"}` escape is not in its schema today;
   - `decide`'s headless handback after the interactive session (`src/app/decideArtifact.ts`);
   - the `decide --verdicts` writer (`src/app/decideVerdicts.ts`);
   - the interactive first turn (`src/app/interactiveStop.ts`);
   - the interactive closing turn (`src/app/closeStop.ts`);
   - the headless code review, shipped in 0.29.0 (`phax review-code --headless`, `code-review` answer): it gains the same path and its one corrective resume, replacing the spec `headless-code-review`'s "no retry".
3. **The compliance review becomes a structured answer.** Today the agent writes `compliance-review.md` and `.json` into `.phax-context/`. It has no retry, and a bad file silently becomes `verdict: unknown`. Now:
   - the session returns the compliance answer;
   - phax writes both files, rendering the Markdown from the answer;
   - the session becomes read-only like the others, and gains the corrective resume.
   - Say what happens to the Markdown's prose, and what persisted shapes change: required fields, `$schema` at 0.32.0, no shims.
4. **Mistral Vibe** stays on the schema in the prompt plus phax's decoder and the corrective resume, stated per provider. Vibe honours `readOnly` since Vibe 3 (`--enabled-tools`, shipped in #170).
5. **The phase handoff** stays Markdown in this spec. Making it a structured answer is a later spec, because every later phase reads it.

**What exists (read it first):**
- the Backend port (`src/ports/`) and the provider adapters (`src/infra/providers/`);
- each use case listed above, its prompt builder, and its decoder in `src/schemas/`;
- `src/domain/authoring/retry.ts`;
- how phax exports JSON Schemas (Effect `JSONSchema.make`) and `packages/schemas/`;
- the compliance review (`src/app/reviewCompliance.ts`, `src/domain/review/compliancePrompt.ts`, `src/schemas/complianceReview.ts`).

**Out of scope:**
- interactive sessions, phase turns, fix attempts and the windows probe, which return no structured answer;
- the external providers (oracles, brief, architecture, plan auditor);
- the phase handoff;
- the rest of Vibe V3.

**Leave §9 to at most two questions,** each framed by what it abandons.

**Surfaces.** A surface's `summary`, `before` and `after` are read by users in the release notes: a capitalized sentence and short real examples, with no implementation notes. Name `$schema` URLs at 0.32.0.

**Output:** your final message is the spec document JSON and nothing else: no sentence before or after it, and no code fence.
