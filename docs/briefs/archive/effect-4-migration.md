Write the phax spec `effect-4-migration`: phax and `@lbdremy/phax-schemas` move from Effect 3 to Effect 4, with
every command, every persisted format and every refusal behaving as before. The mechanical part is done by a
deterministic codemod that the repository keeps; the rest is done by plan phases that each follow one named
project skill, so a reviewer can read from the plan what each phase was allowed to change and how.

## Why now

NEXT_STEPS §8 puts the migration before the CLI contract freeze and the persisted-format promise: every command
added on Effect 3 grows it, and `@lbdremy/phax-schemas` exports Effect 3 `Schema` values and depends on
`effect ^3.14`, so moving after 1.0 would be a breaking major of the package and of its consumers. Effect 3.x gets
fixes until at least September 2029; the current release is `effect@4.1.2` (4.0 shipped 2026-10-06).

The spike of 2026-10-07 (nothing committed) measured 1,502 type errors in 224 `src` files and 2,910 in 443 test
files, mostly from about ten mechanical root causes: `Either` gone (`Effect.either`, `decodeUnknownEither` →
`decodeUnknownExit`), `Context.Tag` → `Context.Service` on the ports, the Schema filters → `.check(…)`,
`Schema.optionalWith`, `Effect.catchAll`/`orElse` → `Effect.catch`, `ParseResult` → `SchemaIssue`.
`@effect/platform` and `@effect/platform-node` are dependencies that nothing in `src` imports.

## What Effect provides (read it at the tag the spec pins; do not restate it as phax's)

- **`MIGRATION.md` and 13 topic guides** under `migration/` in `Effect-TS/effect` (cause, equality,
  error-handling, fiber-keep-alive, fiberref, forking, generators, layer-memoization, runtime, schema, scope,
  services, yieldable): https://github.com/Effect-TS/effect/tree/effect@4.1.0/migration
- **`migration/v3-to-v4.md`**, generated from the API diff (1.4 MB, ~17,000 lines): an Import Map
  (`effect/Either -> effect/Result`), the No Counterpart Imports and Removed Modules sections, and an API Reference
  with one line per v3 symbol, `` - `Old.symbol` -> `New.symbol`: <rationale> ``, removals as `-> none` with the
  alternative. It is data a script can read, not only prose.
- **The official agent skill `effect-v3-to-v4`** (https://github.com/Effect-TS/skills): migrate `package.json`
  first, type-check, resolve each error by searching the reference (never reading it whole), escalate to a topic
  guide, then the v4 source. Hard prohibitions: no v3-shaped compatibility layer, no `any` or `as` to silence an
  error, no invented API. It is `disable-model-invocation: true`, clones `.repos/effect` and `.repos/effect-v3`
  over the network, and delegates per-file work to sub-agents.
- **No official codemod for v4.** `@effect/codemod` (https://github.com/effect-ts/codemod) stops at 3.0.4 and its
  repository has not moved since 2024. The codemod.com registry lists an `effect-v3-to-v4` codemod
  (https://app.codemod.com/registry/effect-v3-to-v4) with no named publisher, run through
  `npx codemod@latest workflow run`; it rewrites to `ServiceMap.Service`, a beta-era name that the 4.1.0 reference
  never mentions (it is `Context.Service`). Its rule list is a useful inventory of the mechanical rewrites; its
  output would be wrong as it stands.

## What is settled (the operator's direction of 2026-11-07; do not reopen)

1. **Hybrid.** A deterministic codemod does the mechanical rewrites; plan phases do the rest. No phase hand-applies
   a rename the codemod could have done.
2. **The codemod is phax's own**, committed under `scripts/`, written against an AST library, and limited to the
   root causes measured in this repository. It is judged by numbers: the `tsc` error count of `src` and of the test
   suite before it runs and after.
3. **Phases follow skills, not sub-agents.** The migration skills are installed as project skills; each phase of
   the plan names the one skill it follows for what it migrates, so the plan says what each phase may change and
   how. The official skill's discipline holds in every phase: look each symbol up in the reference, no
   compatibility layer, no `any` or `as` to silence an error, no invented API.
4. **Behaviour does not move.** Every command's text and `--json` answers, every exit code, every persisted format
   and every record reader behave as on Effect 3. A change that cannot keep this (a parse-error wording, a JSON
   Schema snapshot's text) is named in the spec with what replaces it, never discovered in review.
5. **The platform packages go**, and every remaining Effect dependency sits on one 4.x version, in phax and in
   `@lbdremy/phax-schemas`.

## What the spec must cover

- **The codemod's scope**: the rewrites it performs (from the spike's root causes, cross-checked against the
  reference and the registry codemod's rule list), what it leaves to phases, how it reports what it did not touch,
  and how its effect is measured and recorded.
- **Where the reference lives for phase sessions.** Phase sessions reach only their provider's network, so they
  cannot clone `Effect-TS/effect`. The reference, `MIGRATION.md` and the topic guides are read at a pinned tag, from
  the repository or from outside it.
- **The skills.** Which project skills exist (one lookup skill derived from the official one, and per-topic skills
  such as services, schema, error handling), what each one is allowed to change, and how a phase names its skill.
- **The non-mechanical parts**, each with how it keeps behaviour: the JSON Schema generator (every snapshot's text
  changes; whether every format gets a `next` snapshot), the parse-error wording behind refusals
  (`formatFirstViolation`), the frozen decoders under `src/schemas/history/`, which must keep their exact
  behaviour, and the `Context.Tag` ports moving to `Context.Service`.
- **`@lbdremy/phax-schemas`**: its exports become Effect 4 `Schema` values; how its version and its consumers are
  told (`docs/upgrading.md`, the package's own notes).
- **Order and shape of the work**, as the spec sees it (the plans decide the phases): dependencies first, then the
  codemod, then the topics, tests alongside, docs last; and how a run stays green when a type error in `src` breaks
  every test at once.

## Constraints

- **No persisted format bump** caused by the migration itself: a format changes version only if its JSON changes.
- **phax knows no project**: the words are phax's.
- **No back-compat shims**, and no `v3-compat` module, in `src` or in tests.
- **The codemod runs no code fetched at run time**: its dependencies are pinned in `devDependencies`.
- **§9 holds genuine choices only**, each with its options, what each abandons and a recommended default. At least:
  - the codemod's AST library: ts-morph (type-aware: it knows an `Either` comes from `effect` before renaming it),
    jscodeshift (what `@effect/codemod` used, syntax only), or a fork of the registry codemod fixed to the 4.1 names;
  - where the reference lives for phases: vendored in the repository at a pinned tag, or fetched outside the run
    into the state root;
  - the skills: the official skill vendored and adapted, or phax's own skills that cite it;
  - whether the codemod stays in the repository after the migration or is removed by the last plan;
  - one migration or several releases (for instance `phax` first, `@lbdremy/phax-schemas` after).

## Out of scope

- New Effect 4 features (the CLI module, the HTTP client, the new runtime options) beyond what the migration needs.
- The CLI contract freeze and the persisted-format promise themselves (NEXT_STEPS §8), which come after.
- Upgrading other dependencies than Effect's, except where Effect 4 requires it.
