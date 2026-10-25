# Reading a plan's overview

Before you approve or run a plan, you want its shape in one view: what each phase builds and where, which phases form an oracle pair, which tests each phase writes, and whether every acceptance criterion of the source spec has a test. `phax plans overview` lays that out. No model reads the plan.

```bash
phax plans overview docs/plans/2610240900-invoice-export-plan.md
phax plans overview docs/plans/2610240900-invoice-export-plan.md --json | jq .coverage.kind
```

The overview of a made-up three-phase plan, with an architecture provider configured (every name here is made up):

```
invoice-export — Export invoices as CSV  (Approved · source spec invoice-export)
architecture: parts from the configured provider

phase-01 — Oracles for the export  claude-opus-5-5 · high · headless
  oracle role  oracle phase, discharged by phase-02
  (no part)    tests/integration/invoiceExport.test.ts
  - the export totals every invoice as the spec's table says — small · table · the spec's totals table · oracle · ac-1
  - an export of an empty ledger is a header-only file — small · example · the file's content · oracle · ac-2

phase-02 — Invoice export  claude-sonnet-5-5 · medium · headless
  oracle role   discharges phase-01
  core-billing  src/core/billing/export.ts
  cli           src/cli/commands/exportInvoices.ts
  - a ledger decodes or is refused with a typed error, never a crash — small · fuzz · the decoder's refusal · in-phase · ac-1

phase-03 — Document the export  claude-sonnet-5-5 · low · headless
  oracle role  none
  (no part)    docs/invoice-export.md
  (no test lines)

acceptance criteria of invoice-export
  ac-1       phase-01 oracle, phase-02 in-phase
  ac-2       phase-01 oracle
  ac-3       (no test line)
  uncovered  ac-3
```

## Reading it

- **The header** names the plan (its artifact slug, or the run's short name for a loose plan.md), its title, its frontmatter status (`no frontmatter` without one) and its source spec (`no source spec` without one).
- **Each phase block** starts with the phase's model, effort and mode. The `oracle role` row says whether the phase writes oracles (`oracle phase, discharged by phase-02`), discharges an earlier oracle phase (`discharges phase-01`), or neither (`none`). See [Oracle phases](oracle-phases.md).
- **The parts.** Each row is a part of the repository's architecture and the planned files, to create or to edit, that part holds, in the order the provider reports its parts. A file is shown under every part whose globs match it. Files no part holds sit under `(no part)`. Phase-02 touches two parts, so it is the phase to read for boundary crossings.
- **The test lines** are the phase's `### Test strategy` lines in the line format of the phax-planning skill (`<guarantee> — <size> · <technique> · <oracle> · <loop>[ · <criterion>]`), or `(no test lines)`. A phase that tests nothing is not flagged.
- **The coverage block** ends the overview: each acceptance criterion of the source spec, with the phases and loops whose lines name it, then the criteria no line names. Here `ac-3` has no test, and `phax plans lint` says so as a warning:

```
docs/plans/2610240900-invoice-export-plan.md: 0 errors, 1 warning
warning  tests      -         criterion "ac-3" of invoice-export is named by no test line
```

The overview shows what lint judges; it does not judge. Use it to see the plan, and lint to gate it. Cost is not here: `phax plans estimate` keeps that (see [Estimating a plan](plan-estimate.md)).

## Without a provider

With no `architecture` key in `phax.json`, `phax.local.json` or `~/.phax/config.json`, there are no parts. The header line reads `architecture: no provider configured — planned files shown`, and each phase shows its planned files in one `files` row. See [Architecture provider](architecture-provider.md) for declaring one.

## A failing provider

The provider runs once, on the plan's planned files to create and edit, or on the whole repository when the plan lists none. If it fails or is refused, the overview is not an error: it degrades to the planned files as above, with `architecture: provider failed — planned files shown`, prints one line on stderr, `Warning: architecture provider failed: <message>`, and exits 0.

## Coverage without criteria

A plan with no source spec prints `no source spec: no criterion coverage`. A source spec with no JSON sidecar, one that cannot be found (here or under `docs/specs/archive/`), or a sidecar that cannot be read prints the one line `phax plans lint` reports for it instead of the coverage, for example `source spec invoice-export has no JSON sidecar: no criterion id is checked`.

## `--json`

`--json` prints one JSON document on stdout and nothing else; warnings stay on stderr. It carries the same content as the text, with a `kind` on every variant:

- `architecture.kind`: `parts`, `none` or `failed`.
- `phases[].oracleRole.kind`: `oracle` (with `dischargedBy`), `discharging` (with `oraclePhase`) or `none`.
- `phases[].placement`: a list of `{ part, files }`, ending with the `{ part: null }` entry of the files no part holds.
- `phases[].testLines`: the phase's lines as `{ guarantee, size, technique, oracle, loop, criterion }`.
- `coverage.kind`: `criteria` (each criterion with the lines naming it, and `uncovered`), `no-source-spec`, or `no-criterion-ids` with a `reason` of `no-sidecar`, `not-found` or `unreadable`.

The document is unversioned, like `plans lint`'s: a script reads it without a `$schema` guarantee.

## Exit codes

- **0**: an overview, a degraded architecture included.
- **1**: the plan cannot be read, does not parse, or fails artifact validation. A plan with a structure error, or with a test line off the format, prints one line on stderr naming `phax plans lint <plan>`; lint says what is wrong, so fix it there first. A plan that cannot be read, or that fails validation, prints that error on one line.
- **2**: an invalid `phax.json`.

## What it never does

- It starts no model session. The plan is read by the same deterministic parser lint uses. The only process it spawns is the architecture provider, once, when one is configured.
- It writes nothing: no file, no commit, no cache.
- It runs in any plan status, `Draft` included, and, like `plans lint`, inside a phase worktree.
