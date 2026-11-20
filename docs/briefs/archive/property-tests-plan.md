Write the phax plan "Property tests over the persisted formats" for the approved spec
`docs/specs/2611131320-property-tests.md`. It is the spec's first plan, not its last: it carries
`completes-spec: false`. The plan parser, the state machine and the CLI arguments follow in later plans against the same
spec.

Read the spec in full, sidecar included. These are settled; do not reopen them:
- the six operator decisions of 2026-11-13 in §9: q-engine `fast-check`, q-generators `derive-effect`, q-budget
  `fixed-100-daily-2000`, q-first-slice `formats-only`, q-machine `reducer`, q-phase-terminal `next-or-terminal`;
- everything §10 lists as settled, and its constraints: tests only under `tests/`, importing from `src/domain`,
  `src/schemas` and `packages/schemas`; fast-check a devDependency; a counter-example becomes a hand-written case next
  to its fix; a fix goes into the reader, never into a format's shape or stamp; 30 seconds per property at the default
  run count.

This plan takes the first slice (§5.1 to §5.6), plus the harness that every later slice reuses: §5.17 to §5.22 (tier,
budget, fixed default seed, the daily deep pass, reproduction). Leave §5.7 to §5.16 to later plans.

Release context. 0.37.0 is released (tag v0.37.0) and installed; 0.38.0 is the opened version. Runs on this repository
use the installed phax.

What already exists (read it before planning):
- `src/schemas/schemaUrl.ts`: `FORMAT_IDS`, the ledger of the 41 formats the properties iterate.
- `src/schemas/persisted.ts`: the per-format readers, the newer-stamp refusal against `PHAX_RELEASE`, and the lifts
  from older shapes. `src/schemas/history/`: the frozen decoders, one folder per format.
- `packages/schemas/src/` (`index.ts`, `parsed.ts`, `formats/`): the schemas package's own parse functions, which the
  agreement property (§5.5) compares with phax's readers.
- `node_modules/effect/dist/Arbitrary.d.ts` (effect ^4.1.4): `Arbitrary.schema(schema)`. §10 leaves open whether it
  yields something fast-check can consume or only its own runner. Read the installed module, not training data, before
  choosing the bridge's shape.
- `vitest.config.ts`: the `unit` project (`tests/unit/**/*.test.ts`, 30-second test timeout). `pnpm test:unit` and
  `pnpm check:full` must pick the properties up with no new script.
- `.github/workflows/security.yml`: the Security workflow (pull requests, main, a daily cron, workflow_dispatch). The
  deep pass (§5.20: 2,000 runs, a fresh seed) is a job there that runs only on the schedule and on demand, never on a
  pull request. `tests/unit/ciWorkflow.test.ts` holds the workflow's invariants: extend it rather than adding a new test
  file.
- `CONTRIBUTING.md`, Tests section: the §11 docs page `docs/property-tests.md` is linked from there.

Settle in Technical arbitrations, with the dominant loss of each:
- the bridge from `effect/Arbitrary` into fast-check, and where it lives;
- how the seed, path and run count reach every property (`PHAX_PROPERTY_SEED`, `PHAX_PROPERTY_PATH`,
  `PHAX_PROPERTY_RUNS`): a shared parameter helper, or fast-check's global configuration;
- how per-format overrides are named and registered, for values the schema admits but a reader refuses (the spec's
  example: a phase status awaiting review needs a waiting stop);
- how the coverage property (§5.6) fails on a format without a generator, and how the agreement property (§5.5) names
  a deliberate disagreement, if there is any.

Shape. Every §8 criterion in scope has its own named test. The harness comes first: fast-check, the parameters and
replay, then the bridge. Then the generator registry and the coverage property, then the round trip, totality, newer
stamp, frozen shapes and agreement properties. Then the deep-pass job in `security.yml` and its invariants. Docs come
last: `docs/property-tests.md`, the CONTRIBUTING link, and `docs/security.md` for the deep pass.

Adding fast-check needs the network, and pnpm's `minimumReleaseAge` refuses a version less than a day old. Pin a
fast-check release past that delay, and name the install command in the plan's required commands.
