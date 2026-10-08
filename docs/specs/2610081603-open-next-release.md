---
status: Approved
date: 2026-10-08
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
approved:
  date: 2026-10-08
  baseline: 3e73cf3
---
# Open the next release: `$schema` stamps name the format's shape

## 1. Context

Every document phax writes begins with `$schema: https://docs.phax.run/schemas/<format id>/<X.Y.Z>.json`. One function writes them all: `withSchemaUrl`, used for every persisted file and for the gate request and brief request phax hands a provider. It fills X.Y.Z with `PHAX_RELEASE`, the root package.json version, which is generated into `src/schemas/release.ts`. The gate's hint for a missing diagnostics document names the same version. This follows q-release-name (Q16 of the archived schemas-package spec, decided 2026-09-28): `$schema` names the root package.json version, and an unreleased shape is a `next` snapshot that `scripts/release.sh` renames to the release it cuts.

The snapshots already record each format's current shape. `CURRENT_SHAPES`, in the package's generated index, maps every format either to the release that last changed it or to `next`. At 0.20.0 it reads: registry, run-status and phax-plan 0.17.0; plan-approval-record 0.19.0; phase-status, gate-diagnostics, gate-request, brief-request and brief-answer 0.20.0. phax never imports `packages/`. The dependency runs the other way: the package imports phax's schemas.

How each reader handles a stamp today:
- The package's `defineFormat` refuses a stamp newer than its own version. It refuses a stamp below `FIRST_SUPPORTED_RELEASE` (0.17.0) as a development build's. A stamp equal to its own version is tried with `next` first, then falls back to the latest released shape at or below the stamp.
- phax's bridge (`src/schemas/persisted.ts`) refuses a stamp newer than `PHAX_RELEASE`. It reads any other `$schema` document with the current decoder only.
- The two answer readers (`readGateDiagnosticsAnswer`, `readBriefAnswer`) accept a stamp newer than 0.19.0 (`LAST_SAVED_FILE_ONLY_DIAGNOSTICS_RELEASE`, `LAST_RELEASE_WITHOUT_BRIEF_ANSWER`). They also accept one equal to the running release, which they read as the next shape.

How a release works today. Between releases, the three manifests (root, `npm/`, `packages/schemas/`) name the last release. `scripts/release.sh X` runs `scripts/release-cut.ts`. The cut requires X to be newer than package.json's version, and the ledger (`packages/schemas/releases.json`, 0.17.0 … 0.20.0) to end at package.json's version. It then:
- bumps the three manifests to X;
- renames each `next` snapshot to X;
- regenerates `PHAX_RELEASE`, `PACKAGE_VERSION`, `FIRST_SUPPORTED_RELEASE` and `CURRENT_SHAPES`;
- appends X to the ledger;
- rewrites the one stamp that `examples/hello-world/audit.mjs` and `brief.mjs` each print.

release.sh then regenerates `phax.usage.kdl` and `docs/cli/reference.md`, tests the cut, commits, tags and pushes. `release.yml` checks that both published manifests equal the tag. The docs site serves one URL per format for each ledger release, and its check expects the ledger to end at package.json's version. Since PR #127, CI rehearses a cut of package.json's next patch on every change. Every release since 0.17.0 has been a minor, and the release workflow refuses pre-release suffixes.

Ground read:

- `docs/briefs/open-next-release.md` — The brief: both decisions of 2026-10-08, their motive, what the spec must cover, the constraints. §9 Q1–Q6 were decided by the author on 2026-10-08, all as recommended.
- `NEXT_STEPS.md` — Where this sits: first of the three steps toward guarantee-reports. Also the provider-answer decision of 2026-10-08: older shapes are refused by name before 1.0, and read through their frozen shape and lifted after it.
- `docs/release.md` — The release process as documented today: the cut's steps, the rehearsal, the workflow's version check and the docs deploy.
- `scripts/release.sh` — Cut, regenerate the usage spec and CLI docs, test, commit, tag, push. --rehearse stops before committing.
- `scripts/release-cut.ts` — Requires a version newer than package.json's and a ledger ending at package.json's version. Bumps three manifests, renames next snapshots, regenerates, appends to the ledger, and rewrites the hello-world stamps.
- `tests/unit/releaseCut.test.ts` — Cut on a copy: manifests, snapshots, ledger, and the refusals that write nothing.
- `.github/workflows/release.yml` — The tag-triggered workflow. It checks that npm/package.json and packages/schemas/package.json equal the tag, then deploys the docs site, stage-publishes both packages and creates the GitHub release.
- `.github/workflows/ci.yml` — Its last step rehearses a cut of package.json's next patch (PR #127).
- `tests/unit/releaseWorkflow.test.ts` — Static invariants on release.yml, docs-deploy.yml, ci.yml and release.sh.
- `packages/schemas/src/shapes.ts` — defineFormat. It refuses a stamp newer than the package and one below FIRST_SUPPORTED_RELEASE. A stamp at its own version tries next first and then falls back to the latest released shape at or below the stamp.
- `packages/schemas/src/generated/index.ts` — PACKAGE_VERSION 0.20.0, FIRST_SUPPORTED_RELEASE 0.17.0, CURRENT_SHAPES (each format's last-changed release, or next).
- `packages/schemas/releases.json` — Release ledger 0.17.0 … 0.20.0; the docs site serves schemas for these releases.
- `src/schemas/persisted.ts` — The bridge. withSchemaUrl stamps PHAX_RELEASE. readCurrent refuses a stamp newer than PHAX_RELEASE. The answer readers accept a stamp newer than 0.19.0, or one equal to the running release.
- `src/schemas/release.ts` — Generated PHAX_RELEASE: what --version prints and every document is stamped with.
- `src/app/gates.ts` — DIAGNOSTICS_EXPECTED_SHAPE names gate-diagnostics at PHAX_RELEASE in the missing-document hint.
- `scripts/schemas-check.ts` — Generates and checks the package's generated index and src/schemas/release.ts from package.json and the snapshots.
- `tests/unit/site/schemas.test.ts` — Expects the ledger to end at package.json's version; checkLedger reports a mismatch.
- `examples/hello-world/audit.mjs` — Prints gate-diagnostics/0.20.0; the cut rewrites it today. brief.mjs prints brief-answer/0.20.0 the same way.
- `README.md` — Extend phax: the stamped examples, and the sentence saying `$schema` names the release the document is written for.
- `docs/specs/archive/2609241238-schemas-package.md` — Q16 q-release-name: `$schema` names the root package.json version, and an unreleased shape is the `next` snapshot release.sh renames. Q20 q-support-start: support starts at the first release that writes `$schema`.

## 2. Problem

Both flaws are in what a stamp names.

First, a stamp names the running release, not the shape. Every document carries the release that wrote it, and the package refuses a release newer than its own version. A consumer on @lbdremy/phax-schemas 0.20 therefore cannot read a `phase-status` that phax 0.21 writes, even when `phase-status` did not change. Providers hit the same wall: steme pins phax's request URLs as constants, so it breaks at every release. Every consumer must upgrade at every phax release, whether or not a format it reads changed.

Second, during a development cycle one stamp names two shapes. While the manifests name the last release, say 0.19.0, a development build stamps 0.19.0 on documents in the shape in progress, and the released 0.19.0 stamped the same number on the old shape. Everything that copes with this changes meaning at the cut:
- the package's fallback from `next` to the latest released shape exists only before a cut;
- the answer readers' exception for the running release reads that release as `next`;
- tests written mid-cycle stamped `PACKAGE_VERSION` and relied on the fallback. They broke the 0.20.0 release gate (fixed in e79dcdd7), and 0.19.0's gate had failed the same way.

Providers are exposed too. A provider answering in the cycle's new answer shape has to stamp 0.19.0, and the installed 0.19.0 then reads it with the old shape, silently, where it should refuse it as newer. PR #127 catches the tests at review time, but the ambiguity they rely on remains.

## 3. Product goal

A stamp names exactly one shape, at every commit and in every build. That shape is the release that last changed the format or, for a change not yet released, the version the repository has already opened for it. As a result:
- a consumer or provider upgrades only when a format it reads or writes changes;
- a cut renames snapshots but changes no stamp;
- every release refuses a document from a development build as newer, instead of misreading it.

What we give up: a stamp no longer tells which phax release wrote a file.

> A $schema stamp names a format's shape, never the build that wrote it, and no two shapes ever share a stamp.

## 4. Terminology

- **stamp** — The X.Y.Z in a document's `$schema` URL.
- **current stamp** — The stamp phax writes for a format. It is the release named by the format's latest release-named snapshot or, while the format has a `next` snapshot, the opened version.
- **opened version** — The unreleased X.Y.Z that the three manifests name between one release and the next cut. No released build writes it, and no released document carries it.
- **opening** — The commit that sets the three manifests, and the files generated from them, to an opened version. It happens right after each release, or by hand to change the opened version (a re-opening).
- **cut** — What `scripts/release-cut.ts` does for a release: it names the opened version's shapes (renames `next` snapshots) and records the opened version in the ledger.
- **last release** — The release ledger's last entry: the newest version ever cut.
- **development build** — phax or the schemas package built from a commit whose manifests name an opened version.
- **running version** — The version a reader compares stamps against: phax's `PHAX_RELEASE`, or the package's own version. It is a release in a release build and the opened version in a development build.
- **older shape** — A stamp below its format's current stamp. Example: gate-diagnostics 0.20.0 while an unreleased gate-diagnostics change is opened as 0.21.0.

## 5. Functional requirements

### 5.1 Writers stamp the shape

phax shall stamp every document it writes with that format's current stamp, not with its running version. This covers each persisted file, each request it hands a gate step or brief provider, and the expected-document hint.

### 5.2 phax's stamps agree with the snapshots

IF phax's current stamp for any format differs from the one the committed snapshots and the manifests' version record THEN the schemas check shall fail and name the format.

### 5.3 Newer refusal compares the running version

IF a document's stamp is newer than the reader's running version THEN the reader shall refuse it as newer and name both versions. phax applies this to persisted files and answers; the package applies it to every format.

### 5.4 An unchanged format stays readable

WHEN a reader meets a document of a format unchanged since release S, stamped with any version from S up to the reader's running version, THE reader SHALL read it as that format's current shape.

### 5.5 The package reads an opened stamp by next alone

WHILE a format's current shape is the unreleased `next`, THE schemas package SHALL read a document stamped with the package's own version by `next` alone. When `next` rejects it, the package SHALL report `next`'s violation and never fall back to a released shape.

### 5.6 Answers are read in the current shape only

phax shall read a gate step's diagnostics document or a brief provider's answer only when its stamp is at or above the format's current stamp and at or below phax's running version. The running version gets no exception of its own.

### 5.7 Older-shape answers are refused by name

IF an answer's stamp is below its format's current stamp THEN phax shall refuse it as an older shape, by name, and name the `$schema` URL it reads. A stamp at or below the last release that lacked the answer format (0.19.0) keeps its existing refusal.

### 5.8 phax names the stamp it reads

WHEN phax refuses a diagnostics document or brief answer, or reports one missing, THE system SHALL name the `$schema` URL of that format's current stamp.

### 5.9 A development build reads the installed release's files

WHILE phax is a development build, THE system SHALL read every file the installed release wrote exactly as that release reads it.

### 5.10 A release refuses a development build's opened stamp

IF a released phax or a released schemas package reads a document stamped with a version opened after it THEN it shall refuse the document as newer.

### 5.11 The development-build refusal is unchanged

The first supported release shall stay the lowest release-named snapshot. The development-build refusal shall apply only to stamps below it, so an opened version never meets it.

### 5.12 release.sh opens the next minor

WHEN release.sh has pushed the tag of release X.Y.Z THE script SHALL commit and push an opening of X.(Y+1).0. The three manifests, the generated version mirrors, the usage spec and the CLI reference name the new version; the ledger and the snapshots are untouched.

### 5.13 Opening by hand

WHEN the operator runs `scripts/release.sh --open <X.Y.Z>` on a clean tree THE script SHALL commit an opening of that version. It SHALL refuse a version that is not X.Y.Z, is not newer than the last release, or equals the version the manifests already name.

### 5.14 A failed opening says how to finish

IF the opening fails after the release tag is pushed THEN release.sh shall exit non-zero and print the `--open` command that completes it.

### 5.15 Only the opened version is cut

IF the version given to the cut is not the opened version the manifests name THEN the cut shall refuse before writing anything. The refusal SHALL name the opened version and the `--open` command that re-opens to the requested one.

### 5.16 The ledger gains a release at its cut

WHEN the cut runs THE cut SHALL require the opened version to be newer than the ledger's last entry, and SHALL append it to the ledger in the release commit.

### 5.17 The cut changes no stamp

The cut shall rename every `next` snapshot to the opened version. It shall change no manifest version, no stamp a development build writes and no stamp an example prints.

### 5.18 Example stamps follow the shape

IF the stamp a hello-world script prints (audit.mjs's gate-diagnostics, brief.mjs's brief-answer) differs from its format's current stamp THEN a test shall fail and name the script.

### 5.19 Only cut releases are listed and served

The ledger and the docs site shall list and serve only versions that were cut. The site build shall accept a ledger whose last entry is at or below package.json's version, and refuse one that lists a version above it.

### 5.20 A tag needs a cut

IF a pushed tag's commit holds a ledger whose last entry is not the tag's version THEN the release workflow shall fail before it deploys the site or stages a package.

### 5.21 What a development build reports

WHILE phax is a development build, `phax --version`, `phax.usage.kdl` and `docs/cli/reference.md` SHALL report the opened version as a bare X.Y.Z.

### 5.22 CI rehearses the opened version

CI shall rehearse a cut of the opened version the manifests name, not of a version computed from it.

### 5.23 The first opened cycle

WHEN this change lands on main THE repository SHALL be opened at 0.21.0, with the ledger still ending at 0.20.0.

## 6. Surface

### file: the `$schema` stamps phax writes — normative

before:

    phax 0.21.0. run-status has been unchanged since 0.17.0; phase-status and gate-request since 0.20.0:
      run-status.json    "$schema": "https://docs.phax.run/schemas/run-status/0.21.0.json"
      status.json        "$schema": "https://docs.phax.run/schemas/phase-status/0.21.0.json"
      gate request       "$schema": "https://docs.phax.run/schemas/gate-request/0.21.0.json"
      missing-document hint: expected {"$schema": "https://docs.phax.run/schemas/gate-diagnostics/0.21.0.json", …}

after:

    phax 0.21.0, same formats:
      run-status.json    "$schema": "https://docs.phax.run/schemas/run-status/0.17.0.json"
      status.json        "$schema": "https://docs.phax.run/schemas/phase-status/0.20.0.json"
      gate request       "$schema": "https://docs.phax.run/schemas/gate-request/0.20.0.json"
      missing-document hint: expected {"$schema": "https://docs.phax.run/schemas/gate-diagnostics/0.20.0.json", …}

    A development build opened at 0.22.0, with an unreleased phase-status change:
      status.json        "$schema": "https://docs.phax.run/schemas/phase-status/0.22.0.json"   (the 0.22.0 release writes the same stamp)

### file: the manifests and the release ledger between two releases — normative

before:

    After the 0.20.0 release, until the 0.21.0 cut:
      package.json, npm/package.json, packages/schemas/package.json   "version": "0.20.0"
      packages/schemas/releases.json   { "releases": ["0.17.0", "0.18.0", "0.19.0", "0.20.0"] }

after:

    After the 0.20.0 release, until the 0.21.0 cut:
      package.json, npm/package.json, packages/schemas/package.json   "version": "0.21.0"   (opened, never tagged)
      packages/schemas/releases.json   { "releases": ["0.17.0", "0.18.0", "0.19.0", "0.20.0"] }
    At the v0.21.0 tag:
      the three manifests       "version": "0.21.0"
      releases.json             { "releases": ["0.17.0", "0.18.0", "0.19.0", "0.20.0", "0.21.0"] }

### cli: scripts/release.sh <X.Y.Z> — normative

before:

    $ scripts/release.sh 0.21.0          # any version newer than package.json's
      commit  chore: release v0.21.0     (bumps manifests, renames next → 0.21.0, appends the ledger, rewrites the example stamps)
      tag     v0.21.0, push

after:

    $ scripts/release.sh 0.21.0          # must be the opened version package.json names
      commit  chore: release v0.21.0     (renames next → 0.21.0, appends 0.21.0 to the ledger; manifests and stamps unchanged)
      tag     v0.21.0, push
      commit  chore: open v0.22.0        (three manifests, PHAX_RELEASE, PACKAGE_VERSION, phax.usage.kdl, docs/cli/reference.md), push

### cli: scripts/release.sh --open <X.Y.Z> and the cut's refusals — indicative

    $ scripts/release.sh 0.22.0          # manifests name 0.21.0
    ✗ 0.22.0 is not the opened version 0.21.0 — re-open first: scripts/release.sh --open 0.22.0
    $? = 1

    $ scripts/release.sh --open 0.22.0
    committed chore: open v0.22.0 (was 0.21.0)

    $ scripts/release.sh --open 0.20.5   # ledger ends at 0.21.0
    ✗ 0.20.5 is not newer than the last release 0.21.0
    $? = 1

    (when the opening fails after v0.21.0 is pushed)
    ✗ v0.21.0 is released but 0.22.0 is not opened — finish with: scripts/release.sh --open 0.22.0
    $? = 1

### cli: phax --version in a development build — normative

before:

    $ phax --version      # built from main between 0.20.0 and 0.21.0
    0.20.0
    phax.usage.kdl:          version "0.20.0"
    docs/cli/reference.md:   - **version**: 0.20.0

after:

    $ phax --version      # built from main between 0.20.0 and 0.21.0
    0.21.0
    phax.usage.kdl:          version "0.21.0"
    docs/cli/reference.md:   - **version**: 0.21.0

### api: answer stamps a gate step or brief provider prints — indicative

before:

    phax built at 0.20.0 with an unreleased gate-diagnostics change:
      gate-diagnostics/0.20.0 → read as the next shape (running-release exception)
      gate-diagnostics/0.21.0 → ✗ gate-diagnostics 0.21.0 is newer than this phax (0.20.0) — upgrade phax to read it

after:

    Development build opened at 0.21.0, with gate-diagnostics changed:
      gate-diagnostics/0.21.0 → read
      gate-diagnostics/0.20.0 → ✗ gate-diagnostics 0.20.0 is an older shape — this phax reads https://docs.phax.run/schemas/gate-diagnostics/0.21.0.json
      gate-diagnostics/0.22.0 → ✗ gate-diagnostics 0.22.0 is newer than this phax (0.21.0) — upgrade phax to read it
    Release 0.21.0, with brief-answer unchanged since 0.20.0:
      brief-answer/0.20.0 → read;  brief-answer/0.21.0 → read
      brief-answer/0.19.0 → ✗ brief-answer 0.19.0 has no known shape

### package: @lbdremy/phax-schemas parse outcomes — indicative

before:

    @lbdremy/phax-schemas 0.20.0 reading a phase-status from phax 0.21.0, unchanged format:
      $schema …/phase-status/0.21.0.json → phase-status written by phax 0.21.0 is newer than @lbdremy/phax-schemas 0.20.0 — upgrade the package
    Development package at 0.20.0 with a next phase-status:
      …/phase-status/0.20.0.json → tries next, then falls back to the released 0.20.0 shape

after:

    @lbdremy/phax-schemas 0.20.0 reading a phase-status from phax 0.21.0, unchanged format:
      $schema …/phase-status/0.20.0.json → read as shape 0.20.0
    A stamp newer than the package:
      …/phase-status/0.22.0.json → phase-status 0.22.0 is newer than @lbdremy/phax-schemas 0.20.0 — upgrade the package
    Development package opened at 0.21.0 with a next phase-status:
      …/phase-status/0.21.0.json → read by next alone; next's violation on failure, no fallback

### internal: src/schemas/release.ts, phax's generated stamp table — indicative

before:

    // Generated by `pnpm exec tsx scripts/schemas-check.ts --write` — do not edit.
    export const PHAX_RELEASE = "0.20.0";

after:

    // Generated by `pnpm exec tsx scripts/schemas-check.ts --write` — do not edit.
    export const PHAX_RELEASE = "0.21.0";
    // Each format's current stamp: its latest release-named snapshot, or PHAX_RELEASE while next exists.
    export const CURRENT_STAMPS = {
      registry: "0.17.0",
      "run-status": "0.17.0",
      "phase-status": "0.20.0",
      …
      "gate-diagnostics": "0.21.0", // next
    } as const;

### file: examples/hello-world/audit.mjs and brief.mjs stamps — normative

before:

    $schema: "https://docs.phax.run/schemas/gate-diagnostics/0.20.0.json"   rewritten by every cut to the release it cuts

after:

    $schema: "https://docs.phax.run/schemas/gate-diagnostics/<current stamp>.json"   never rewritten by the cut; a test fails while it differs from the format's current stamp

### file: .github/workflows/ci.yml, release rehearsal step — indicative

before:

    current="$(node -p 'require("./package.json").version')"
    next="<current with patch + 1>"
    scripts/release.sh --rehearse "${next}"

after:

    scripts/release.sh --rehearse "$(node -p 'require("./package.json").version')"   # the opened version

### file: .github/workflows/release.yml, version check — indicative

before:

    Verify package versions match tag: npm/package.json and packages/schemas/package.json equal the tag

after:

    Verify package versions match tag: npm/package.json, packages/schemas/package.json and the last entry of packages/schemas/releases.json equal the tag. A tag on an opening commit (manifests equal the tag, ledger ends earlier) fails here.

### file: README.md, Extend phax, what `$schema` names — indicative

before:

    `$schema` names the `gate-diagnostics` release the document is written for. A document without it fails the step, and so does one stamped with a release newer than the running phax.

after:

    `$schema` names the `gate-diagnostics` shape the document is written in: the release that last changed the format. phax names the shape it reads whenever it refuses a document. A document without `$schema` fails the step, and so does one stamped newer than the running phax or in an older shape.

## 7. Non-goals

- Pre-release suffixes (`-dev` and the like). The release workflow refuses them, and every `$schema` stays X.Y.Z.
- Choosing the opened version automatically from commit messages.
- Any change to how a released phax reads older releases. phax keeps reading `$schema` documents with its current decoder only, so it gains no frozen per-release decoders.
- Reading documents that a development build stamped with an opened version later re-opened away (dev runs, scratch fixtures). They are unsupported, and nothing re-stamps them.
- Re-stamping files already written. Files carrying the running-release stamps of 0.17.0–0.20.0 stay as they are and stay readable.
- Changing which URLs the docs site serves for a ledger release. It keeps serving one URL per format per release.
- Adding a field to any request or answer to carry the answer's stamp. No published format changes shape.
- Reading older-shape answers through a frozen shape and lifting them. That is the 1.0 promise, not this change.
- Re-deciding that stamps name the shape (decided 2026-10-08).

## 8. Acceptance criteria

### An unchanged format keeps its stamp across releases

Given phax whose running version is 0.21.0 and whose run-status shape last changed in 0.17.0, when it writes a run's `run-status.json`, then the file's `$schema` is `https://docs.phax.run/schemas/run-status/0.17.0.json`. (refs §5.1)

### Requests carry their shape

Given phax at 0.21.0 with gate-request and brief-request unchanged since 0.20.0, when it hands a gate step its request and a brief provider its request, then they are stamped `gate-request/0.20.0` and `brief-request/0.20.0`, and the missing-document hint names `gate-diagnostics/0.20.0`. (refs §5.1, §5.8)

### An unreleased change is stamped with the opened version, and the cut keeps it

Given a development build opened at 0.21.0 in which phase-status has a `next` snapshot, when it writes a phase `status.json`, and the tree is then cut as 0.21.0, then the file is stamped `phase-status/0.21.0` before the cut, and the cut build writes the same stamp. (refs §5.1, §5.17)

### The schemas check holds phax's stamps to the snapshots

Given a tree where phax's current stamp for one format differs from its latest release-named snapshot (or from the opened version while `next` exists), when the schemas check runs, then it fails and names that format. (refs §5.2)

### phax refuses a newer stamp

Given phax at 0.21.0, when it reads a `phase-status/0.22.0` file, and then a gate step prints `gate-diagnostics/0.22.0`, then both are refused as newer, naming 0.22.0 and 0.21.0. (refs §5.3)

### The package refuses a newer stamp

Given the schemas package at 0.20.0, when it parses a phase-status stamped 0.22.0, then it fails at `$schema`, naming 0.22.0 and the package's 0.20.0. (refs §5.3)

### An old consumer reads a newer phax's unchanged format

Given the schemas package at 0.20.0 and a phase-status phax 0.21.0 wrote while phase-status was unchanged, when the package parses it, then it reads it as shape 0.20.0. (refs §5.4)

### Running-release stamps from 0.18–0.20 stay readable

Given a `run-status.json` stamped `run-status/0.19.0` by phax 0.19.0 (shape 0.17.0), when a development build opened at 0.21.0 reads it, and the package at 0.21.0 parses it, then phax reads it, and the package resolves it to shape 0.17.0. (refs §5.4, §5.9)

### No fallback from next

Given the package opened at 0.21.0 with a `next` phase-status shape, and a document stamped 0.21.0 that only the 0.20.0 shape accepts, when the package parses it, then it fails with `next`'s violation and is never decoded as shape 0.20.0. (refs §5.5)

### Answers inside the window are read

Given phax at 0.21.0 with gate-diagnostics and brief-answer unchanged since 0.20.0, when a gate step prints `gate-diagnostics/0.20.0`, and then `gate-diagnostics/0.21.0`, then both are read. A brief answer stamped `brief-answer/0.21.0` is read too, and is read in the release built from the same tree. (refs §5.6)

### Older-shape answers are refused by name

Given a development build opened at 0.21.0 with a `next` gate-diagnostics shape, when a gate step prints `gate-diagnostics/0.20.0`, and a brief provider answers `brief-answer/0.19.0`, then the first is refused as an older shape, naming `https://docs.phax.run/schemas/gate-diagnostics/0.21.0.json`; the second keeps its existing refusal. (refs §5.7, §5.6)

### Refusals name the stamp phax reads

Given phax at 0.21.0 with brief-answer's current stamp 0.20.0, when a gate step prints no document, and a brief provider answers without `$schema`, then the step's failure names `gate-diagnostics/<current stamp>` and the brief refusal names `https://docs.phax.run/schemas/brief-answer/0.20.0.json`. (refs §5.8)

### A development build reads the installed release's run

Given a run folder written by phax 0.20.0 (registry, run-status, phase-status, phax-plan, all stamped 0.20.0), when a development build opened at 0.21.0 reads the registry and the run's status, then it reads them with no refusal. (refs §5.9)

### A release refuses a development build's changed format

Given phax and the package at release 0.20.0, and a phase-status stamped 0.21.0 by a development build opened at 0.21.0, when each reads it, then each refuses it as newer and does not decode it. (refs §5.10)

### The opened version is not a development build's pre-support stamp

Given the package opened at 0.21.0 with FIRST_SUPPORTED_RELEASE 0.17.0, when it parses a document stamped 0.21.0, and one stamped 0.16.0, then the first never gets the development-build message; the second still does. (refs §5.11)

### Releasing opens the next minor

Given main opened at 0.21.0, when `scripts/release.sh 0.21.0` completes, then the commit after `chore: release v0.21.0` is `chore: open v0.22.0`, pushed. It sets the three manifests, `PHAX_RELEASE`, `PACKAGE_VERSION`, `phax.usage.kdl` and `docs/cli/reference.md` to 0.22.0, and leaves the ledger and snapshots unchanged. (refs §5.12)

### Re-opening by hand

Given a clean tree opened at 0.21.0 with a ledger ending at 0.20.0, when the operator runs `scripts/release.sh --open 0.22.0`, then `--open 0.20.0`, then `--open 0.22.0` again, then the first commits an opening of 0.22.0. The second is refused as not newer than the last release, and the third as already opened. The refused runs write nothing. (refs §5.13)

### A failed opening names its remedy

Given a release whose tag was pushed and whose opening commit then fails, when release.sh exits, then it exits non-zero and prints `scripts/release.sh --open <next minor>`. (refs §5.14)

### The cut refuses a version that was not opened

Given a copy of the tree opened at 0.21.0, when `release-cut.ts 0.22.0` runs, then it exits non-zero, writes nothing, and names 0.21.0 and `scripts/release.sh --open 0.22.0`. (refs §5.15)

### The cut appends the opened version

Given a copy opened at 0.21.0 whose ledger ends at 0.20.0, and a second copy whose ledger already ends at 0.21.0, when `release-cut.ts 0.21.0` runs on each, then the first ledger ends at 0.21.0; the second cut is refused and writes nothing. (refs §5.16)

### The cut is a rename and a ledger entry

Given a copy opened at 0.21.0 with a `next` phase-status snapshot, when `release-cut.ts 0.21.0` runs, then `next.schema.json` becomes `0.21.0.schema.json`. The three manifests, `src/schemas/release.ts` and both hello-world scripts are byte-identical to before. (refs §5.17)

### Example stamps follow the format

Given a tree where gate-diagnostics gains a `next` snapshot and `audit.mjs` still prints `gate-diagnostics/0.20.0`, when the unit tests run, then a test fails, naming `examples/hello-world/audit.mjs` and the current stamp. (refs §5.18)

### The site serves only cut releases

Given main opened at 0.21.0 with a ledger ending at 0.20.0, and a made-up ledger listing 0.22.0, when the site is built from each, then the first passes and serves no `/schemas/*/0.21.0.json`; the second fails, naming the entry above package.json's version. (refs §5.19)

### A tag without a cut fails the workflow

Given `release.yml`, when its version check runs on a commit whose manifests equal the tag but whose ledger ends at an earlier release, then the step fails, and it runs before the docs deploy and the first stage publish. (refs §5.20)

### A development build reports the opened version

Given main opened at 0.21.0, when `phax --version` runs from source and `phax.usage.kdl` and `docs/cli/reference.md` are read, then all three report `0.21.0`, with no suffix. (refs §5.21)

### CI rehearses what will ship

Given `ci.yml`, when its release rehearsal step runs on main opened at 0.21.0, then it runs `scripts/release.sh --rehearse 0.21.0`, the version package.json names. (refs §5.22)

### The first cycle is opened

Given the change merged on main, when the manifests, the generated files and the ledger are read, then the three manifests and `PHAX_RELEASE` name 0.21.0, and the ledger ends at 0.20.0. `docs/release.md` describes the opening, and the README describes stamps as shapes. (refs §5.23)

## 9. Open questions for implementation planning

### Q1 — Which version does release.sh open after a release? (Decided by the author on 2026-10-08; not reopened.)

- Always the next minor (X.(Y+1).0) — abandons: Patch releases without a re-opening: a hotfix cycle, and after 1.0 any patch-only cycle, pays one `--open` commit.
- Always the next patch (X.Y.(Z+1)) — abandons: Matching how phax actually releases: every release since 0.17.0 has been a minor, so nearly every cycle would re-open.
- Chosen by the operator at each release (a required argument) — abandons: A release that takes one decision: it asks the operator to predict the next cycle's size at the moment it starts.

Recommendation: Always the next minor (X.(Y+1).0) — Decided by the author on 2026-10-08, as recommended. It fits every release phax has cut since `$schema` existed. A wrong guess costs one `--open` commit, and the cut's refusal names that command.

### Q2 — What happens when the release to ship is not the opened version (0.21.0 opened, 0.21.1 or 0.22.0 wanted)? (Decided by the author on 2026-10-08; not reopened.)

- The cut refuses; the operator re-opens with `--open`, then cuts — abandons: A one-command release when the cycle turned out bigger or smaller than opened: one more commit, and a CI round on it.
- The cut accepts any version newer than the last release and re-stamps the manifests, the generated files and the examples — abandons: A rehearsed cut that renames no stamp: CI rehearsed the opened version, so the version actually cut was never rehearsed, and the cut takes back the manifest bump and the example rewrite this spec removes.

Recommendation: The cut refuses; the operator re-opens with `--open`, then cuts — Decided by the author on 2026-10-08, as recommended. It keeps the invariant that matters: the version that ships is the one every commit of the cycle stamped and CI rehearsed. Either way, documents a development build stamped with the abandoned opened version are unsupported (non-goals). Re-opening makes that moment visible as a commit.

### Q3 — When does the release ledger gain a release? (Decided by the author on 2026-10-08; not reopened.)

- At the cut, in the release commit (as today) — abandons: The invariant that the ledger ends at package.json's version on every commit. It holds only on release commits, so the site's check loosens to 'at or below', and the release workflow must check equality at the tag.
- At the opening, so the ledger always ends at package.json's version — abandons: The ledger as a list of shipped releases: main's ledger names a version that may never ship, a re-opening rewrites it, and every main build of the site serves URLs for an unreleased version.

Recommendation: At the cut, in the release commit (as today) — Decided by the author on 2026-10-08, as recommended. The ledger feeds the public schema URLs, and a served URL can never be withdrawn (the deploy guard refuses). It must name only what shipped. The looser site check is paid back by the tag-time ledger check, which also closes a hole: once manifests name the opened version, they alone would accept a tag on a commit that was never cut.

### Q4 — How does phax know each format's current stamp at run time, given that it never imports `packages/`? (Decided by the author on 2026-10-08; not reopened.)

- A per-format table generated into `src/schemas/release.ts` from the snapshots, with `next` resolved to the opened version, and held by the schemas check — abandons: A single copy of the shape names: CURRENT_SHAPES and phax's table are two generated outputs of the same snapshots, kept equal by the check.
- phax imports CURRENT_SHAPES from the package — abandons: The one-way dependency decided in q-historical-location (2026-10-01): phax would import `packages/`, which widens its TypeScript root and moves its build output.
- Each schema module declares its format's stamp by hand — abandons: Snapshots as the one source of a shape's name: a contributor who changes a format must also remember to bump a literal, and nothing generated catches a missed bump.

Recommendation: A per-format table generated into `src/schemas/release.ts` from the snapshots, with `next` resolved to the opened version, and held by the schemas check — Decided by the author on 2026-10-08, as recommended. The generator already writes `src/schemas/release.ts` from package.json and already reads the snapshots for CURRENT_SHAPES. One more generated fact keeps the dependency direction and the build unchanged, and the drift it adds is exactly what `schemas:check` exists to refuse.

### Q5 — How does a provider learn which stamp to answer in? (Decided by the author on 2026-10-08; not reopened.)

- The README and the docs site document each format's shape, and every refusal or missing-document hint names the URL phax reads — abandons: A machine-readable answer at run time: a provider pins its answer stamp as a constant and learns a format changed when the new phax refuses it.
- A new command (e.g. `phax schemas --json`) prints every format's current stamp — abandons: A smaller CLI surface before the 1.0 freeze: one more command and output format to hold, built for consumers whose constants now break only when a format changes.
- phax passes the expected answer URL in the provider's environment — abandons: A contract carried by the documents alone: a second, unversioned channel beside the request, outside every published schema.

Recommendation: The README and the docs site document each format's shape, and every refusal or missing-document hint names the URL phax reads — Decided by the author on 2026-10-08, as recommended. With shape stamps a pinned constant breaks only when the format it names changes, which is when the provider must change its code anyway. The refusal that names the expected URL is the signal it needs then, and it adds no surface.

### Q6 — Does a development build mark its version as unreleased? (Decided by the author on 2026-10-08; not reopened.)

- No: `phax --version`, the usage spec and the CLI reference print the bare opened version — abandons: Telling a development build from a release at a glance: a contributor's bug report says 0.21.0 before 0.21.0 exists.
- Yes: `--version` prints e.g. `0.21.0 (unreleased)` in a development build — abandons: One version string: it needs a third generated fact that the cut sets and the opening clears, and `--version` stops matching the usage spec generated from the same tree.

Recommendation: No: `phax --version`, the usage spec and the CLI reference print the bare opened version — Decided by the author on 2026-10-08, as recommended. npm and GitHub Releases carry only tagged builds, so an opened version reaches only contributors running from source, where `git describe` already says whether the build is a release. The marker would cost a moving part in the cut for a reader who already has the answer.

## 10. Implementation-planning note

Settled:

- Stamps name the format's shape (author, 2026-10-08). This amends the archived schemas-package spec's q-release-name (Q16). The archive stays as written, and `docs/release.md` records the new rule.
- Shape stamps resolve `next` to the opened version, so a cut never changes a stamp. It renames `next` snapshots and appends the ledger; the manifests were bumped by the opening.
- The newer refusal compares the stamp to the reader's running version, not to the format's shape, because files that 0.17.0–0.20.0 wrote carry running-release stamps above their format's shape (e.g. run-status/0.20.0 over shape 0.17.0).
- The package's `defineFormat` drops the fallback from `next` to a released shape for a stamp at its own version. The 'latest shape at or below the stamp' rule otherwise stays.
- The answer readers drop their exception for the running release. Their lower bound becomes the format's current stamp. Stamps at or below 0.19.0 keep their existing refusals.
- Before 1.0, older-shape answers are refused by name (author, 2026-10-08). The guard tests that hold each answer reader to one shape must, at 1.0, fail and name that rule rather than be deleted.
- FIRST_SUPPORTED_RELEASE and the development-build message are unchanged.
- Decided in §9 (author, 2026-10-08): open the next minor, refuse a cut of any version other than the opened one, the ledger gains a release at its cut, a generated stamp table in `src/schemas/release.ts`, providers learn their stamp from the docs and from refusals, and the version stays bare.

Left open:

- The spelling of `--open`, of the stamp table, and of the refusal and hint messages.
- Whether the opening commit runs any tests before it is pushed, and whether `--open` also pushes or only commits.
- Whether docs-deploy.yml gets the same ledger-equals-tag check as release.yml.
- Whether the README's stamped examples (gate-diagnostics, gate-request, brief-request, brief-answer) join the example-stamp test or stay hand-held.
- Whether `LAST_SAVED_FILE_ONLY_DIAGNOSTICS_RELEASE` and `LAST_RELEASE_WITHOUT_BRIEF_ANSWER` stay as named constants once the current stamp bounds the answers from below.

Constraints:

- No back-compat shims in persisted schemas, and no change to any published format's shape.
- Every `$schema` stays `https://docs.phax.run/schemas/<format id>/<X.Y.Z>.json`, with no suffix.
- phax never imports `packages/`.
- Files the installed release wrote stay readable by a development build.
- Neither the docs site nor the release workflow serves or publishes the opened version; served URLs are never withdrawn.
- Docs to update: `docs/release.md` (opening, `--open`, the cut, the rehearsal, the workflow's ledger check), the README's Extend phax section, and the `phax-cli` skill if it quotes stamps.
- Tests to update: `tests/unit/releaseCut.test.ts`, `tests/unit/releaseWorkflow.test.ts`, `tests/unit/site/schemas.test.ts`, `tests/unit/schemasPackage/` (the fallback, CURRENT_SHAPES parity), the answer-reader and bridge tests, and every fixture that stamps `PHAX_RELEASE` where it means a format's shape.

## 11. Docs page

Page: README §Extend phax (rendered on docs.phax.run), with what `$schema` names; `docs/release.md` for maintainers

Reader: The author of a gate step or brief provider (steme first), deciding which `$schema` to print and when to update it; and the maintainer cutting a release.

Example: phax 0.21.0 sends `gate-request/0.20.0.json` and reads `gate-diagnostics/0.20.0.json` for as long as neither format changes, so a step that prints `gate-diagnostics/0.20.0` keeps working across phax releases. When a release changes gate-diagnostics, phax refuses the old stamp and names the URL it now reads. Maintainers: `scripts/release.sh 0.21.0` cuts the version main already names, then opens 0.22.0.
