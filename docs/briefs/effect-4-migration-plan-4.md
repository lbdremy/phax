Write the phax plan "Remove the Effect 4 migration tooling" for the approved spec
`docs/specs/2611071052-effect-4-migration.md`. It is the spec's last plan (`completes-spec: true`): its run completes
the spec. phax has run on Effect 4.1.2 since #198 (2026-11-10). What is left is the tooling the migration needed and no
longer does.

Read the spec in full, sidecar included. These are settled; do not reopen them:
- q-keep decided remove-at-end (operator, 2026-11-07): the last plan removes the codemod, its devDependency and the
  vendored reference. Git history and the commit bodies keep the record.
- The operator has already lifted the migration's protections in `phax.json` on main, in their own commit before this
  run: there is no `protectedPaths` key any more, the `effect-migration` gate profile is gone (`standard` is the only
  profile) and `tests/unit/effect4Codemod/gateProfile.test.ts` is deleted. The plan does not touch `phax.json`.
- The behaviour corpus stays, renamed (operator decision, 2026-11-10): `tests/effect4Corpus/` becomes
  `tests/behaviourCorpus/`, and `tests/unit/effect4Corpus/` becomes `tests/unit/behaviourCorpus/`. Its cases, baseline
  and replay keep holding phax's refusal lines, the frozen decoders and the schemas check's documents (§5.15, §5.16,
  §5.19). A rename changes no expectation: every case and baseline file moves byte for byte.
- The rendered JSON Schemas keep Effect 4's rendering, compared by documents (operator decision at #198's review).

Deliver:
1. **Prove §5.12 before the codemod goes.** `pnpm codemod:effect4 --check` still lists
   `src/cli/definitions/plansOverlap.ts:25` (`Schema.ReadonlySet`), a false positive: the call is already wrapped in
   `Schema.toCodecJson`. Correct the codemod's report so it lists no v3 symbol, run `--check`, `pnpm typecheck` and
   `pnpm test:type`, and record the three results in the commit body (the acceptance criterion "Nothing of v3 left").
   This is the codemod's last change; the next phase deletes it.
2. **Remove the codemod and the reference.** `scripts/effect4-codemod/` (its counts, passing-tests record and ratchets
   included), the `codemod:effect4` script, the `ts-morph` devDependency (`package.json`, `pnpm-lock.yaml`, `deno.lock`),
   their tests (`tests/unit/effect4Codemod/`, `tests/integration/effect4*.test.ts`), the fixtures' entries in
   `knip.json` and `.oxfmtrc.json`, the vendored reference `docs/vendor/effect-migration/`, and
   `docs/effect-4-mapping.md`, whose header says it goes with them.
3. **Remove the migration skills.** `.claude/skills/effect4-*` (the five skills) and `tests/unit/effect4Skills.test.ts`.
   No other skill or `CLAUDE.md` names them; check that this still holds.
4. **Rename the corpus.** Move the corpus and its unit tests as above, and update every reader of the old paths
   (`scripts/schemas-check.ts`, the schemas package tests, the refusal formatters test, `.oxfmtrc.json`, any other the
   search finds). Decide what happens to `scripts/effect4-corpus-capture.ts`, which refuses to run unless the installed
   `effect` major is 3, and `scripts/effect4-corpus-densify.ts` (see Technical arbitrations).
5. **Docs.** `CONTRIBUTING.md` loses its "The Effect 4 migration" section; what stays true (the behaviour corpus, how
   to replay it, how to add a case if the capture survives) moves to a short section under the new name. The archived
   briefs, plans and the spec keep their text: they are records.

The terminal phase passes the `standard` profile: `check:full`, the build, the site, the Deno smokes. `pnpm knip` must
report nothing left behind (no unused file, export or dependency).

Constraints the plan must hold:
- **No behaviour change.** No source under `src/` or `packages/schemas/src/` changes, except where a reader of a moved
  path needs the new path. No test expectation moves; no snapshot, fixture or corpus case is edited.
- **No persisted format bump**, no history-lock change.
- The dependency removal needs no network: name how the phase removes `ts-morph` from the lockfiles offline, and what
  it does if it cannot.

Settle in Technical arbitrations, with the dominant loss of each:
- the corpus capture and densify scripts: removed with the migration, or kept under the corpus's name with the
  Effect 3 guard dropped, so a new case can still be captured from phax's current answers. Weigh against "a captured
  expectation is never changed";
- the phase count and order: whether the false-positive fix and the removals share a phase, and where the rename goes so
  each commit leaves a green tree;
- model and effort per phase, following the planning skill. This is mostly mechanical deletion and renaming.

Out of scope: any change to `phax.json`; new corpus cases (refused `"NaN"` strings and `null` optional keys are a
follow-up); the `realFlow` Codex secure test; the refusal label of `decisionId`-style leaves; any dependency upgrade.
