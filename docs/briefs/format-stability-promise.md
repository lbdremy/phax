Write the phax spec `format-stability-promise`: what phax promises, from 1.0, about the files and records it
writes. Not that their shapes stop changing, but the rules by which they change: every persisted document is
stamped, phax and `@lbdremy/phax-schemas` read every shape since a declared floor, a shape change always ships
with its snapshot and its upgrade note, and what cannot be read is refused by name with its remedy.

## Why

The 1.0 item in `NEXT_STEPS.md` was written at 0.14.0, before stamps existed. It asked to freeze `phax.json`'s
`version: 1` and the run, approval and record formats, with a migration for anything that moved. Since then every
persisted document carries a `$schema` stamp naming the release that last changed its format, each shape is kept as
a snapshot, and readers lift older shapes in memory. The operator's question on 2026-11-19: with that, do frozen
formats still matter at all, since phax can always read what it wrote?

Mostly no: shapes can keep changing, because a reader always knows which shape it holds. But the stamps leave
gaps a 1.0 user will meet, and a promise has to say what they are:

- **Newer documents, older readers.** An `@lbdremy/phax-schemas` or a phax older than the document refuses it
  (0.40.0's notes: "An `@lbdremy/phax-schemas` before 0.40.0 refuses them, so upgrade the package"). Two machines
  or two people on different releases share `phax/records/v1`, and the older one stops reading the newer one's
  records. A consumer of the package must upgrade in step with phax.
- **Not every older shape is read forever.** There is a floor (`FIRST_SUPPORTED_RELEASE`). 0.38.0 required a
  one-time `phax artifact migrate-documents` before approve, reopen, decide and revise would run again, and refused to
  resume a run started by 0.37.0. Run-scoped reports (`gate-report`, `brief-report`, `architecture-report`) and
  provider answers in an older shape are refused, by design, inside a run.
- **No rule says when the floor moves**, or that a step like `migrate-documents` can come back.

What 1.0 would be lying about, without this spec, is not a format that changed but a change the user could not
foresee.

## What phax has today, to read first

- `docs/release.md`: the opened version, the cut (snapshots renamed from `next`, `CURRENT_SHAPES`,
  `FIRST_SUPPORTED_RELEASE`, `src/schemas/release.ts`), the stamp rule ("a `$schema` stamp names a format's shape,
  not the build that wrote it").
- `packages/schemas/src/shapes.ts` and the package's `toLatest*` lifts; the README's "A file stays readable as phax
  evolves" paragraph; `docs/property-tests.md` ("reads every frozen shape").
- `docs/upgrading.md`: the release-by-release steps, which show every time a reader refused an older or newer shape
  and what the remedy was.
- The `NEXT_STEPS.md` "Road to 1.0.0" entries: the stability promise, and the provider answers rule decided
  2026-10-08 (from 1.0, an older answer shape is read through its frozen shape and lifted, and the guard tests that
  hold each answer reader to one shape must fail and name the rule).
- The archived briefs `auto-migrate` and `upgrade-hints` (abandoned 2026-10-19 as too complex), for what not to
  build again.

## What to decide

- **Which documents the promise covers.** `phax.json` and `phax.local.json`, the records on `phax/records/v1`, the
  approval records and spec and plan sidecars in the repository, the run folder's files, the published `--json`
  formats (`finding-list`, `run-list`, `artifact-status`, …). Whether run-scoped reports and provider answers are in
  it (indicatively: provider answers are, per the 2026-10-08 rule; a run's in-flight files are not, because a run
  is finished with the release that started it).
- **The floor.** From 1.0, phax and the package read every shape since 1.0.0, and the floor moves only at a major
  release; or a stated window (every shape of the last N minors). Each abandons something: a fixed floor keeps
  every lift forever; a window brings migration steps back.
- **The newer-than-me direction.** What phax and the package do with a document stamped newer than they are:
  refuse by name (today), or read the fields they know. And what the promise says about mixed releases on one
  records branch (indicatively: the remedy is to upgrade, said once in the docs and in the refusal).
- **Whether a one-time step may come back** after 1.0 (`migrate-documents`-like), and if so only at a major.
- **Where the promise is written**: a docs page users read, linked from the README and `docs/upgrading.md`, and
  which tests hold phax to it (the corpus's frozen shapes, a test that every persisted format has a stamp and a
  snapshot).

## Constraints

- No back-compat shims inside a shape: new fields stay required and enums explicit per variant. The promise is about
  reading older shapes through their own frozen schema and lifting them, not about optional fields.
- The CLI contract (command names, flags, exit codes, the text it prints, and the `--json` answers that are not
  published formats) is out of scope: it carries no stamp, so its freeze is the separate 1.0 item.
- Nothing here may need a network call or a migration machinery like the abandoned `auto-migrate`.
