# Idea: an article on the Effect 4 migration

> Status: **material for an article**, gathered 2026-11-11 while the migration is fresh. Not a
> draft. Each point names where it comes from: a commit, a pull request, a `NEXT_STEPS.md` row,
> or a section of the archived spec
> ([`docs/specs/archive/2611071052-effect-4-migration.md`](../specs/archive/2611071052-effect-4-migration.md)).
> Related: [`effect4-schema-idioms.md`](./effect4-schema-idioms.md).

## The story in one paragraph

phax moved from Effect 3 to Effect 4.1.2 in four days (spec drafted 2026-11-07, last plan merged
2026-11-10), in four phax runs that phax drove itself, for about $147 of API-list cost. Before
switching anything, two groundwork plans built what would judge the switch: a codemod, a corpus
of phax's answers captured on Effect 3, ratchets that refuse a phase ending worse than it
started, and phax's own refusal model so its error lines would not depend on Effect's wording.
The switch itself was one plan, and a last one removed the tooling. The migration ended with a
documentation PR to Effect, merged with the maintainers' corrections.

## The numbers

| Plan | PR | Merged | Cost | Diff |
| --- | --- | --- | --- | --- |
| 1, groundwork on Effect 3 | #195 | 2026-11-09 | $24.66 | +81,032 −29, 134 files |
| 2, groundwork 2: refusal model, denser corpus, test ratchet | #196 | 2026-11-09 | $20.83 | +391,240 −11,597, 126 files |
| 3, the migration to Effect 4.1.2 | #198 | 2026-11-10 | $98.04 | +36,616 −12,190, 754 files |
| 4, remove the tooling | #199 | 2026-11-10 | $2.94 (+ $0.59 for a pruned first attempt) | +81 −47,478, 198 files |

Total ≈ $147.06. Plan 3's $98.04 is mostly two phases: $30.39 for phase-02 (the frozen decoders)
and $45.53 for phase-08 (the package and its JSON Schemas), while the codemod left phase-06 and
phase-07 under $1 each. Source: the cost rows in `NEXT_STEPS.md` (2026-11-09 and 2026-11-10).
The groundwork diffs are large because the corpus case files are data.

The codemod's rewrites on the first run (the mapping table removed in #199, readable at
`git show 876d5d0d:docs/effect-4-mapping.md`): `Either` → `Result` 4,437 rewrites in 494 files,
`Effect.either` → `Effect.result` 394, `decode*Either` → `decodeUnknownResult` 210,
`optionalWith(…, { exact: true })` → `optionalKey` 122, `catchAll` → `catch` 43, `Context.Tag`
→ `Context.Service` 11, `Schema.filter` → `check(makeFilter)` 2: 5,219 in all. Adding the
`Either.getOrThrow` rule after plan 1's review moved 738 covered uses and brought the leftovers
from 2,097 to 1,206 (`NEXT_STEPS.md`, plan 1's row).

## The method (what other teams could reuse)

- **Judge by behaviour, not by text.** The behaviour corpus (`tests/behaviourCorpus/`, 6,820
  replayed cases today) holds phax's answers on Effect 3 for every persisted format, frozen
  decoder, config layer and provider answer, one refused case per constraint and encode cases
  per written format (73e03baa, 111603d8). A case that disagrees after a change means the change
  is wrong. JSON Schemas were judged by the documents they accept and refuse, not by their bytes
  (3f0642c3).
- **Own your error words before the switch.** Effect 4 rewords every parse message, so plan 2
  gave phax its own refusal model, an adapter from Effect's issues and a renderer
  (c79bfd2a acceptance tests first, 5d7aa8a1, bc6b83cc), while still on Effect 3. The refusal
  lines that moved (108) moved by phax's own rules, decided in review and listed in
  `docs/upgrading.md` 0.36.0 (b62198ba).
- **A deterministic codemod, measured.** Pinned, idempotent, only its rule table, only Effect's
  symbols, reporting what it left with the reason (spec §5.2–§5.7). Its counts travel as data,
  not in commit bodies (spec §5.7, 9bcc3bae). It departed from the official reference twice, each
  an operator decision recorded in the mapping (`decode*Either` → `decodeUnknownResult`, not the
  `Exit` decoders; `getOrThrow` kept as a rename).
- **Ratchets: every phase ends no worse.** Type-error counts and the set of passing tests are
  recorded and may only improve phase to phase (0d420b1b; spec §5.22), under a dedicated gate
  profile `effect-migration` (ratchets every phase, the full gate at the end).
- **Protect the test contract.** Test files and the ratchet's code were protected paths for the
  migration runs, so an agent could not make a test pass by editing it (117b069c, lifted in
  aca6ae39).
- **One topic skill per phase.** The official v3→v4 reference and skill were vendored at a pinned
  commit (b7936382, 7a585a86), and each phase named the one topic skill it worked under (spec
  §5.9–§5.10): errors, services, schemas.
- **No compatibility layer, no silencing** (spec §5.11), and no v3 symbol left (§5.12), checked
  by re-running the codemod's `--check` at the end.

## What went wrong, and what it taught

- **The first goal was wrong.** The spec first kept Effect 3's refusal wording as the target;
  Effect 4 rewords everything, so the operator changed course to phax's own refusal model after
  plan 1 (spec reopened, e35a8764). Lesson: own anything users read before migrating under it.
- **"Same JSON Schema bytes" was the wrong bar.** Effect 4's generator drops the generated
  descriptions and renders unions differently. The bar became "same documents accepted and
  refused" (plan 3's row; 088a2c72).
- **The generator described the JSON codec, not the decoder.** A `Schema.Number` field took
  `"NaN"`, an optional key took `null`; the corpus had no such refused document, so the judge
  called the looser schemas equivalent. Fixed in review (16855c52); a corpus gap still open in
  `NEXT_STEPS.md`.
- **A strictness rule vanished silently.** v3's `parseOptions` annotation closed a phase
  status's `stop`; v4 ignores the annotation without an error. Found in review, fixed with
  `closed()` (561a22cd). This is what we documented upstream.
- **An agent claimed check:full passed while 20 tests failed** (plan 3 phase-08). The gate, not
  the agent's word, is the evidence.
- **A blocked agent's phase was skipped.** In plan 4 the agent could not run `git rm` and stopped;
  phax read "no changes" and `resume` skipped the phase. Two phax defects recorded in
  `NEXT_STEPS.md`.
- **A test pinned to a version broke main at the next release.** 41 corpus refusals named
  `@lbdremy/phax-schemas 0.36.0`; opening 0.37.0 turned main red. The fix tokenises the version
  and the release rehearsal now also rehearses the opening (#200: d499294a, 78ea04dc, c624c794).

## Upstream

- PR [Effect-TS/effect#10525](https://github.com/Effect-TS/effect/pull/10525): the `parseOptions`
  annotation v4 removed (a silent loss) and the JSON Schema output changes. Merged 2026-11-10 by
  the maintainer with corrections
  ([88477dc](https://github.com/Effect-TS/effect/commit/88477dc7060ae410e68b4f6045c9bcce186e7d15)):
  only `onExcessProperty` and `errors` remain as parse options; our `StructWithRest` recipe was
  wrong (it refuses the declared keys too); identified schemas still get `$defs`. Details in
  [`effect4-schema-idioms.md`](./effect4-schema-idioms.md). A good beat for the article: we
  wrote from one codebase's experience, the maintainers generalised it.
- The codemod itself stayed phax-specific (its rule table follows phax's usage) and was removed
  in #199 rather than published; the article and the upstream doc carry what is reusable.

## Open for the article

- Angle: "a migration judged by behaviour, driven by the tool being migrated", or the method
  alone for teams migrating any Effect codebase.
- Type-error counts before and after the codemod: `git show 876d5d0d:docs/effect-4-mapping.md`
  (§1) and `scripts/effect4-codemod/type-error-counts.json` at that commit.
- Wall-clock per plan, from the run records under `~/.phax/archive/`.
