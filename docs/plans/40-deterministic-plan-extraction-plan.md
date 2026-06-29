# Deterministic plan extraction with LLM fallback

> Plan for making `phax extract-plan` parse a conforming `plan.md` into an
> `ExtractedPhaxPlan` **deterministically** (via an mdast syntax tree), falling
> back to the existing LLM extraction only when the deterministic parse fails.
> Feed this file to `phax extract-plan` to produce `phax-plan.json`.

---

## Context

Today `phax extract-plan` always routes `plan.md` through an LLM
(`extractPlanLlm` in `src/app/extractPlan.ts`) to produce an `ExtractedPhaxPlan`,
which `finalizeExtractedPlan` (`src/domain/plan/finalize.ts`) then post-processes
deterministically (titles, anchors, slug, branch, warnings).

Every field the LLM is asked to emit maps to an unambiguous markdown marker that
the `phax-planning` skill already mandates (`## phase-NN — … {#anchor}`,
`**Recommended model:** …`, `### Planned files to create`, `### Commit subject`,
`## Required commands`, …). The LLM is doing purely mechanical structural
extraction — work a deterministic markdown parser does faster, for free, and
reproducibly.

This plan adds a pure deterministic extractor built on an **mdast** syntax tree
(`mdast-util-from-markdown`) chosen for robustness over hand-rolled regex, wires
it as the first attempt in `loadOrExtractPlan`, and keeps the LLM as the
fallback for non-conforming or drifted plans (the LLM tolerates formatting
slop that a strict parser rejects). The deterministic extractor produces the
**same** `ExtractedPhaxPlan` shape and is validated through the **same**
`ExtractedPhaxPlanSchema`, so the entire downstream path (finalize, cache,
schema trip-wire) is unchanged. A parser bug therefore cannot inject malformed
data — the strict decode rejects it and the run falls back to the LLM.

The existing `examples/hello-world/plan.md` predates the current skill format
(no `## Required commands`, no planned-file sections, backtick-wrapped commit
subjects) and must be updated to the canonical, deterministically-parseable
form.

Key mdast facts the extractor relies on:

- `fromMarkdown(text)` returns a `root` node with `children`; block nodes carry
  `position.{start,end}.offset` into the source string.
- A phase heading parses as `{ type: 'heading', depth: 2, children: [...] }`;
  the `{#anchor}` is literal text inside the heading (CommonMark has no anchor
  syntax), so it appears in the heading's flattened text.
- `**Recommended model:** X` and `**Recommended effort:** Y` sit in **one**
  paragraph (soft line break, no blank line between), so flattening with
  `mdast-util-to-string` would concatenate the two values; read such fields by
  slicing the paragraph's source via `position` offsets and applying a line
  regex instead.
- A backtick-wrapped commit subject parses as an `inlineCode` node — read
  `.value` (or strip surrounding backticks) so the subject is stored unwrapped.

## Required commands

- (none)

Adding the mdast dependencies uses `pnpm add`, already covered by the existing
`pnpm` allowance; the parser introduces no new runtime command the agent must
invoke.

---

## phase-01 — mdast-based deterministic extractor {#phase-01-deterministic-extractor}

**Recommended model:** claude-opus-4-8
**Recommended effort:** medium

Add a pure domain function `extractPlanDeterministic(planMd)` that parses a
conforming `plan.md` into a validated `ExtractedPhaxPlan` using an mdast tree,
returning `Either<PlanValidationError, ExtractedPhaxPlan>`. This is the core of
the feature; no app wiring yet.

### Detailed instructions

- Add dependencies with `pnpm add mdast-util-from-markdown mdast-util-to-string`
  and `pnpm add -D @types/mdast`. These are pure (no I/O), so importing them in
  `src/domain/` is allowed by the architecture audit; do not add them to
  `knip.json` `ignoreDependencies` (they are used in this phase).
- Create `src/domain/plan/parsePlanMarkdown.ts` exporting
  `extractPlanDeterministic(planMd: string): Either.Either<ExtractedPhaxPlan, PlanValidationError>`.
- Parse once with `fromMarkdown(planMd)`. Walk `root.children` linearly:
  - **Run title**: the first `depth: 1` heading's flattened text
    (`mdast-util-to-string`). Use it for both `run.title` and `run.shortName`
    (finalize slugifies `shortName`, falling back to `slugify(title)`), matching
    today's LLM behavior. Fail with a precise `PlanValidationError` if absent.
  - **Required commands**: the `depth: 2` heading whose text is exactly
    `Required commands`, then the following `list` node's item texts. A single
    `- (none)` item (case-insensitive, parens optional) means `[]`. The section
    must appear before the first phase heading.
  - **Phase blocks**: each `depth: 2` heading whose flattened text matches
    `/^phase-\d{2}\b/`. Collect every node after it up to (not including) the
    next `depth: 2` heading as that phase's block.
- For each phase block, extract the `ExtractedPhaseSchema` fields:
  - `id`: from the heading via `/^(phase-\d{2})\b/` (lowercased).
  - `planMarkdownAnchor`: the `{#…}` content from the heading, stored **with a
    leading `#` and without braces** — e.g. `{#phase-01-greet-function}` →
    `"#phase-01-greet-function"`. This must match the format the existing
    tests assert (see `tests/unit/extractPlanFinalize.test.ts`,
    `tests/unit/extractPlan.test.ts`, where anchors are `"#phase-01-alpha"`
    etc.). Fail if the heading has no anchor.
  - `model` / `effort`: locate the paragraph in the block containing
    `Recommended model:`; slice its source with
    `planMd.slice(p.position.start.offset, p.position.end.offset)` and apply
    `/Recommended model:\s*\**\s*(\S+)/` and
    `/Recommended effort:\s*\**\s*(\S+)/`. Do **not** flatten the paragraph with
    `mdast-util-to-string` (it would join the two values). `effort` must decode
    against the `EffortSchema` literals; fail otherwise.
  - `plannedFilesToCreate` / `plannedFilesToEdit` / `optionalFilesToEdit`: the
    `list` following the `depth: 3` heading whose text is exactly
    `Planned files to create` / `Planned files to edit` /
    `Optional files that may be edited`. Map each list item to its trimmed text;
    a single `- (none)` item means `[]`. All three sections are required.
  - `commit.subject`: the first paragraph after the `depth: 3` `Commit subject`
    heading, flattened and stripped of a surrounding `inlineCode`/backtick wrap,
    as a single non-empty line.
  - `commit.body`: the block(s) after the `depth: 3` `Commit body` heading up to
    the next heading; preserve the source via `position` offsets, trimmed, as a
    non-empty string.
- Assemble `{ version: 1, run, phases }` and **decode it through
  `ExtractedPhaxPlanSchema`** (the existing strict decoder with
  `onExcessProperty: "error"`). Return `Either.right` on success;
  `Either.left(new PlanValidationError({ message }))` on any failure. Every
  failure message must name the phase id and the missing/ambiguous field so the
  fallback in phase-02 can log a useful reason.
- Keep the function pure: no `FileSystem`, no `Backend`, no I/O. The caller
  supplies `planMd` text.

### Planned files to create

- `src/domain/plan/parsePlanMarkdown.ts`
- `tests/unit/parsePlanMarkdown.test.ts`

### Planned files to edit

- `package.json`
- `pnpm-lock.yaml`

### Optional files that may be edited

- `knip.json`

### Boundary contracts

Producer: `src/domain/plan/parsePlanMarkdown.ts` provides
`extractPlanDeterministic(planMd) → Either<ExtractedPhaxPlan, PlanValidationError>`.
Consumer (phase-02): `src/app/loadOrExtractPlan.ts`. The stable contract is the
return type — the `Right` value is byte-for-byte what the LLM path + the strict
schema would yield, so the existing `finalizeExtractedPlan` consumes it
unchanged.

### Test strategy

Domain logic → unit tests, written before implementation. Cover:

- A conforming multi-phase plan → exact expected `ExtractedPhaxPlan` (assert the
  whole object, including `#`-prefixed anchors and `requiredCommands`).
- `- (none)` handling for required-commands and all three planned-file lists.
- Backtick-wrapped commit subject is stored unwrapped.
- Em-dash, en-dash, and hyphen heading separators all parse.
- Missing model line, missing anchor, missing a planned-file section, and an
  invalid `effort` each return `Either.left` with a phase/field-specific message.

### Implementation order

Schema/decoder reuse first (import `ExtractedPhaxPlanSchema`), then the mdast
walk, then field extractors, then the strict decode at the boundary.

### Excluded scope

- Any change to `loadOrExtractPlan` / app wiring (phase-02).
- Updating the example plan or skill docs (phase-03).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact export signature of `extractPlanDeterministic` and its module path.
- The decided `planMarkdownAnchor` output format (`#phase-NN-slug`) and a note
  that it matches the existing finalize/extract tests.
- The shape of `PlanValidationError` messages (which fields are named) so
  phase-02 can surface them as fallback warnings.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(plan): add mdast-based deterministic plan extractor

### Commit body

Add extractPlanDeterministic in src/domain/plan, a pure function that parses a
conforming plan.md into a validated ExtractedPhaxPlan via an mdast syntax tree
and returns Either<ExtractedPhaxPlan, PlanValidationError>. Output is decoded
through the existing strict ExtractedPhaxPlanSchema so it is identical to the
LLM path. Adds mdast-util-from-markdown, mdast-util-to-string, and @types/mdast.
Covered by unit tests for conforming plans, (none) lists, dash variants, and the
failure paths that trigger the fallback.

---

## phase-02 — Deterministic-first wiring with LLM fallback {#phase-02-fallback-wiring}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Make `loadOrExtractPlan` attempt the deterministic extractor first and only
invoke the LLM (and the cache) when the deterministic parse fails, surfacing the
fallback reason as a warning.

### Detailed instructions

- Edit `src/app/loadOrExtractPlan.ts`: after reading `planMd` and before the
  cache lookup, call `extractPlanDeterministic(planMd)`.
  - On `Either.right(extracted)`: run `finalizeExtractedPlan(extracted, planMd)`
    and return its result with `fromCache: false`. Do **not** read or write the
    cache on this path (the parse is instant and content-deterministic).
  - On `Either.left(parseError)`: fall through to the existing cache → LLM →
    cache-write → finalize path unchanged, but append a warning of the form
    `Deterministic extraction failed (<parseError.message>); fell back to LLM.`
    to the returned `warnings` so the user sees why the LLM ran.
- Respect existing flags: `--refresh` still bypasses the cache on the LLM path;
  `--no-extract` must still fail on a cache miss **after** a deterministic
  failure (i.e. deterministic success satisfies `--no-extract`; deterministic
  failure with no cache and `--no-extract` keeps today's error).
- Do not change `LoadOrExtractResult`'s shape beyond what already exists; reuse
  `warnings` to carry the fallback note. Keep `extractPlanCore` /
  `extractPlan` behavior intact (they call `loadOrExtractPlan`).

### Planned files to create

- `tests/unit/loadOrExtractPlan.test.ts`

### Planned files to edit

- `src/app/loadOrExtractPlan.ts`

### Optional files that may be edited

- `src/app/extractPlan.ts`

### Boundary contracts

Consumer: `src/app/loadOrExtractPlan.ts` needs
`extractPlanDeterministic(planMd) → Either<ExtractedPhaxPlan, PlanValidationError>`
from phase-01. Producer/consumer split with the `Backend` port is unchanged —
the LLM path still goes through `extractPlanLlm`; this phase only gates whether
that path runs.

### Test strategy

Application command with fake ports → unit/integration tests, written before
implementation, using a fake `Backend` that records `complete` calls:

- Conforming plan → `backend.complete` is **not** called; returned plan matches
  the deterministic extraction; `fromCache` is `false`.
- Non-conforming plan → `backend.complete` is called exactly once; the result
  carries the `fell back to LLM` warning.
- `--no-extract` with a conforming plan succeeds without the backend; with a
  non-conforming plan and no cache it fails as today.

### Implementation order

Wire the deterministic attempt at the top of `loadOrExtractPlan`, then the
fallback warning threading, then confirm flag interactions.

### Excluded scope

- The parser itself (phase-01).
- Example/skill documentation (phase-03).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- Confirmation that conforming plans no longer call the backend, and the exact
  warning string used on fallback.
- How `--refresh` and `--no-extract` interact with the deterministic path.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(app): try deterministic plan extraction before the LLM

### Commit body

Wire extractPlanDeterministic into loadOrExtractPlan as the first attempt: a
conforming plan.md is parsed without any LLM call or cache access, and only a
deterministic parse failure falls through to the existing cache/LLM path, with
the failure reason surfaced as a warning. Covered by unit tests asserting the
backend is not invoked for conforming plans and is invoked once on fallback.

---

## phase-03 — Canonicalize the example plan and document the parser {#phase-03-example-and-docs}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low

Update `examples/hello-world/plan.md` to the canonical, deterministically-parseable
format, document the deterministic-first/LLM-fallback behavior in the
`phax-planning` skill, and lock the example with a regression test asserting it
parses without the LLM.

### Detailed instructions

- Rewrite `examples/hello-world/plan.md` to conform exactly to the current
  skill format: add a top-level `## Required commands` section (`- (none)`), add
  `### Planned files to create`, `### Planned files to edit`, and
  `### Optional files that may be edited` to every phase, and write commit
  subjects as plain (unwrapped) conventional-commit lines. Keep the three-phase
  greet/test/document story.
- Edit `.claude/skills/phax-planning/SKILL.md`: in "What phax expects", state
  that `phax extract-plan` first parses a conforming `plan.md` deterministically
  via an mdast tree and only falls back to the LLM when the deterministic parse
  fails; document that `run.title` is the first `# ` H1 heading and `run.shortName`
  is slugified from it; note that conforming exactly to the format keeps
  extraction LLM-free, reproducible, and offline.
- Add `tests/unit/examplePlanDeterministic.test.ts`: read
  `examples/hello-world/plan.md` from disk and assert
  `extractPlanDeterministic` returns `Either.right` with the expected phase ids,
  anchors, and `requiredCommands` — a regression guard that the shipped example
  stays on the deterministic path.

### Planned files to create

- `tests/unit/examplePlanDeterministic.test.ts`

### Planned files to edit

- `examples/hello-world/plan.md`
- `.claude/skills/phax-planning/SKILL.md`

### Optional files that may be edited

- (none)

### Boundary contracts

Omit — this phase crosses no architectural boundary.

### Test strategy

The example is a fixture for a unit test that exercises the phase-01 domain
function end-to-end on the real shipped file. Written alongside the example
rewrite so the test and the canonical format land together.

### Implementation order

Rewrite the example first, then the regression test against it, then the skill
documentation.

### Excluded scope

- Any change to the parser or the wiring (phase-01, phase-02).
- The e2e fixture `tests/e2e/fixtures/minimal-repo/plan.md` (out of scope; it
  has its own lifecycle).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- Confirmation that the shipped example parses deterministically (test green).
- The exact skill wording added about deterministic-first extraction and the
  `run.title`/`shortName` convention.
- Any deviation from the planned file lists, with the reason.

### Commit subject

docs(plan): canonicalize hello-world example and document deterministic extraction

### Commit body

Update examples/hello-world/plan.md to the current skill format (required
commands, planned-file sections, unwrapped commit subjects) so it parses on the
deterministic path, document the deterministic-first/LLM-fallback behavior and
the run.title/shortName convention in the phax-planning skill, and add a unit
test that reads the shipped example and asserts it extracts without the LLM.
