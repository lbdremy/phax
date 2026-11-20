Write the phax plan "Effect 4 migration" for the approved spec `docs/specs/2611071052-effect-4-migration.md`: the plan
that installs Effect 4, applies the codemod and migrates every topic until the whole tree is green again. It is not the
spec's last plan (`completes-spec: false`): the last one removes the codemod, the vendored reference, the migration
skills and the protected paths, after the operator lifts them.

Read the spec in full, sidecar included, as amended on 2026-11-09. These are settled; do not reopen them:
- every decision in §9b and everything §10 lists as settled, among them: phases follow skills; no compatibility layer;
  no `any` or silencing `as`; the codemod targets `Result` (`decodeUnknownResult`, `Result.getOrThrow`); the schema
  topic comes first; phax owns its refusal model; the test contract is protected;
- the work of the two groundwork plans, merged in #195 and #196 and described in `CONTRIBUTING.md` under "The Effect 4
  migration": the behaviour corpus and its replay, the codemod, its rules and its type-error ratchet, the test
  ratchet, the skills `.claude/skills/effect4-*`, the refusal model (`src/schemas/refusal/`), and the mapping
  `docs/effect-4-mapping.md`.

Why one plan from the install to green. CI runs `pnpm check:full` on every pull request, and nothing in the tree
passes it between the install and the last topic. The run therefore goes from Effect 3 to a green Effect 4 tree in one
pull request. Its phases are held by the `effect-migration` gate profile (the type-error and test ratchets on every
phase, and `check:full`, the build, the site and the Deno smokes at the terminal phase). `phax run` takes the first
profile `phax.json` lists, so the operator moves `effect-migration` first before the run and puts `standard` back first
at the merge (operator decision, 2026-11-09). The plan states this in its preamble, with the protected paths, and
assumes it.

Deliver, in the spec's order, each phase naming the one skill it follows (§5.10):
1. **Install and codemod.** `effect` at 4.1.2 in phax and in `@lbdremy/phax-schemas`, both platform packages and any
   `packageExtensions` for them removed (§5.1). Then `pnpm codemod:effect4`, `pnpm format`, and
   `pnpm codemod:effect4 --ratchet`, which records the first type-error counts and the first set of passing tests. Its
   commit body carries the four counts and each rule's rewrite count (§5.7). This phase also measures the Effect 4
   JSON Schema generator against the released snapshots (parsed, annotations aside) and records what differs, as
   q-snapshots' note asks. It changes no source by hand.
2. **The schema topic** (`effect4-schema`): `src/schemas/**` including the frozen decoders, with
   `packages/schemas/history.lock.json` refreshed once in the same commit and named (§5.17); the refusal model's adapter
   ported to Effect 4's issues (only `src/schemas/refusal/adapter.ts` reads them); `tests/effect4Corpus/subjects.ts`;
   and the call sites of these symbols. Every corpus line replays unchanged (§5.15, §5.16).
3. **The errors topic** (`effect4-errors`), **the services topic** (`effect4-services`) and **the core topic**
   (`effect4-core`), in an order the plan argues. Each re-runs `pnpm codemod:effect4` after it migrates the blockers it
   owns (`Either.flatMap`, `Either.flip`, `Either.getOrNull`, …), so the covered uses those blockers held back are
   rewritten mechanically and not by hand.
4. **The package and the JSON Schemas** (§5.19, §5.20): `@lbdremy/phax-schemas` exports Effect 4 `Schema` values under
   the same names, and the schemas check compares each format's generated JSON Schema with its latest released snapshot
   by the corpus documents each accepts and refuses (ajv), not by text. The released snapshots stay byte-identical.
5. **Guidance and docs** (§5.21, §5.23): `docs/upgrading.md` and the package's notes tell consumers, and `CLAUDE.md`,
   the project skills and `CONTRIBUTING.md` speak Effect 4 (the codemod and the skills are still described: the last
   plan removes them).

The terminal phase passes the full gate: `check:full`, the build, the site and the Deno smokes, the codemod's `--check`
reporting no v3 symbol, and both type checks at zero (§5.12).

Constraints the plan must hold:
- **Test expectations do not move** (§5.14). Tests that use Effect are edited for their plumbing only; the protected test
  contract (snapshots, released schemas, CLI fixtures, the Effect-free happy-path tests) cannot be edited at all.
- **No persisted format bump and no `next` snapshot** (§5.18, §5.19).
- **phax knows no project**: no `v3-compat` module, in `src` or in tests, even for one phase.
- The install needs the registry: the plan names how the phase gets `effect@4.1.2` (the allowed `pnpm add`, as the
  first groundwork plan installed `ts-morph`), and what happens if the phase's network cannot reach it.

Settle in Technical arbitrations, with the dominant loss of each:
- how the topics split into phases: the schema topic alone touches about 690 reported uses across `src/schemas`, the
  package and the history decoders, and the errors topic about 480 after the `Either.getOrThrow` rule. Decide the phase
  count per topic and the order of errors, services and core;
- what each phase can prove while most tests cannot load. The test ratchet's first record holds the tests that pass
  right after the install, likely few, and each phase may only add to it;
- where the generator diff and the ajv equivalence check live, and which phase builds the check;
- whether any review stop is worth its cost here, given that the words must not move and the corpus replays them;
- model and effort per phase, following the planning skill. The schema and errors phases carry the risk.

Out of scope: removing the codemod, the vendored reference, the migration skills, the `effect-migration` profile or the
protected paths (the last plan, after the operator lifts them); any new Effect 4 feature; any dependency upgrade other
than Effect's.
