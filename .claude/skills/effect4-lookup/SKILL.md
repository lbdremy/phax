---
name: effect4-lookup
description: Resolve one Effect 3 → 4 migration error from local files only — the vendored reference at effect@4.1.2, its topic guides, then the installed effect source. Use for every v3 symbol a migration phase touches.
---

# Effect 4 lookup

Resolve one error at a time. Everything is read from files in this repository; nothing is
reached over the network.

Source of the discipline: the official `effect-v3-to-v4` skill, repository
`https://github.com/Effect-TS/skills`, path `skills/effect-v3-to-v4/SKILL.md`, commit
`155c50c911f9c99c294ef8a4461981c5bbe6453e`, vendored at
`docs/vendor/effect-skills/effect-v3-to-v4/SKILL.md` (its `SOURCE` file records the same).
phax drops the official skill's clones, delegated agents and `disable-model-invocation`.

## Order

1. Search `docs/vendor/effect-migration/effect@4.1.2/migration/v3-to-v4.md` for the symbol
   (grep with `-n`, then read the matched lines and their neighbours). Never read it whole.
2. If the mapping implies a rewrite rather than a rename, read the topic guide under
   `docs/vendor/effect-migration/effect@4.1.2/migration/` (`services.md`, `error-handling.md`,
   `schema.md`, `cause.md`, …), reached from
   `docs/vendor/effect-migration/effect@4.1.2/MIGRATION.md`.
3. Confirm the replacement's real signature in the installed source under `node_modules/effect/`.

A miss in the Import Map is not a dead end: check the Removed Modules and No Counterpart
Imports sections before concluding anything.

Before trusting the reference, check that `docs/vendor/effect-migration/effect@4.1.2/SOURCE`
names the tag `effect@4.1.2`.

## Never read the reference whole

> **This is the single most important rule in this skill.** `migration/v3-to-v4.md` is ~17,000 lines / ~350k tokens. Reading it in one pass blows the context window and takes the migration with it.
>
> Always search it and read only matched lines plus surrounding context.

(Quoted from the official skill, "Never Read the Reference Doc Whole".)

## Hard prohibitions

Quoted from the official skill's "Hard Prohibitions":

> - **Never reintroduce a v3-shaped compatibility layer.** Writing a `v3-compat.ts` that re-exports old names makes type errors vanish and permanently freezes the codebase between versions. Migrate call sites to the v4 API.
> - **No `any`, no `as` casts** to silence a post-migration type error. Such an error is usually evidence the replacement has a different shape; casting deletes that information. Go back to the reference or the v4 source.
> - **No invented APIs.** Every replacement must trace to the reference doc, a topic guide, or the v4 source.

phax's reading of them:

- No compatibility module, in any file name.
- No `any` and no `as` assertion to silence an error. `as const` and the brand casts a test
  fixture needs are not silencing.
- No API that is absent from both the reference and the installed source.
- No network access, no package runner, no delegated agent. Work in this session, from the
  files above.
- Never hand-apply a rename that a codemod rule covers: run `pnpm codemod:effect4`.

## Done condition

Quoted from the official skill's "Done Condition": "**The project type-checks against v4.**"
In phax, a phase is done when its topic skill's done condition holds (the ratchet passes and
the phase's leftovers in `pnpm codemod:effect4 --check` are gone). Report a gap rather than
bridging it.
