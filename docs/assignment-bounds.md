# Assignment bounds

Assignment bounds let the repository's owner say which model, at which efforts, a phase must take when it touches certain files. phax holds every plan to them twice: `phax plans lint` reports a departure while the plan is drafted, and the start of `phax run` and `phax resume` refuses one before the run is named.

A bound is a floor and a ceiling for one area, not a ranking of models. phax never compares two models; it only checks that a phase takes the bound's model at an effort inside the bound's range.

## Declare the bounds

`assignments` is an ordered list in `phax.json`. Each bound names the files it covers, one model and an effort range:

```json
{
  "assignments": [
    {
      "kind": "part",
      "part": "core-decide",
      "model": "claude-opus-5-5",
      "effort": { "min": "medium", "max": "high" }
    },
    {
      "kind": "globs",
      "globs": ["src/*/schemas/**"],
      "model": "claude-sonnet-5-5",
      "effort": { "min": "medium", "max": "high" }
    }
  ]
}
```

- A `part` bound covers the files of an architecture-report part, by the part's `id`. phax reads the part's globs from your [architecture provider](architecture-provider.md), so the provider's part ids are the names bounds use.
- A `globs` bound covers the files its globs match. The globs use the same dialect as a part's: working-tree-root-relative POSIX globs, where only `**` (a whole segment), `*` and `?` are special.
- `model` is a catalog model id. `effort.min` and `effort.max` are efforts of that model, inclusive. The order of efforts is the order of the model's `efforts` list in the catalog. `min` equal to `max` admits one effort.
- The list is ordered from most to least demanding, and **the first bound that matches any file a phase plans to create, edit or optionally edit governs it**. A phase that matches no bound falls under the policy default (`claude-sonnet-5-5` at `medium`).
- A phase **conforms** when it takes the governing bound's model, or the default's, at an effort inside the range.

`assignments` is accepted in `phax.json` only. A `phax.local.json` or `~/.phax/config.json` that carries it is refused before it is read further, with exit 2:

```text
Config validation failed: "assignments" is accepted only in phax.json
  at: /home/ada/.phax/config.json
```

## See the bounds

`phax architecture` lists the bounds after the parts, in list order:

```text
# Architecture — acme-billing

## Parts

### core · decide (`core-decide`)
The pure decision logic.
- `src/core/decide/**`

## Bounds (phax.json `assignments`; the first match governs)
- assignments[0] part core-decide — core · decide (`src/core/decide/**`): claude-opus-5-5, medium–high
- assignments[1] globs `src/*/schemas/**`: claude-sonnet-5-5, medium–high
```

A path-scoped call, `phax architecture src/http/handler.ts`, shows a part bound whose part the report does not carry as ``(not in this report: run `phax architecture` with no path for its globs)``. A whole-repository report that lacks the part shows `(unresolved: the report has no part core-decide)`.

With no provider configured, the command prints its one no-provider line, then the bounds, and still exits 1. A part bound cannot be resolved without a provider:

```text
No architecture provider is configured ("architecture" in phax.json): read the architecture from the code and its documentation (README, CLAUDE.md or equivalent) instead and carry on — this is not a failure of the repository.

## Bounds (phax.json `assignments`; the first match governs)
- assignments[0] part core-decide — (unresolved: no architecture provider): claude-opus-5-5, medium–high
- assignments[1] globs `src/*/schemas/**`: claude-sonnet-5-5, medium–high
```

When the provider itself fails, the command prints its one stderr line and exits 1, without the bounds.

A headless `phax artifact new plan --headless` session is told to run `phax architecture` before it cuts phases and assigns models, and may run it, whenever a provider **or** bounds are configured. The prompt lists no bound: the planner reads them from the command.

## A departure fails the lint

Suppose phase-02 of a plan edits `src/core/decide/refunds.ts` and takes the default, `claude-sonnet-5-5` at `medium`. The first bound governs it, and its model is `claude-opus-5-5`:

```text
$ phax plans lint docs/plans/2610211000-refunds-plan.md
docs/plans/2610211000-refunds-plan.md: 1 error, 0 warnings
error    models     phase-02  claude-sonnet-5-5 / medium: outside assignments[0] (part core-decide: claude-opus-5-5, medium–high) with no **Assignment reason:** line
```

`phax run` and `phax resume` refuse the same error before the run is named, so nothing is left behind. They exit 11:

```text
Assignment preflight failed: 1 error(s) from the assignment bounds.

  phase-02 (claude-sonnet-5-5/medium):
    - outside assignments[0] (part core-decide: claude-opus-5-5, medium–high) with no **Assignment reason:** line
Check the plan with `phax plans lint docs/plans/2610211000-refunds-plan.md`.
```

Fix the departure by moving the phase inside the bound: `claude-opus-5-5` at `medium` or `high`.

## State the departure

A phase may leave its bound when it has a reason. Add an `**Assignment reason:**` line under the phase's model and effort (a headless plan carries it as `assignmentReason`):

```markdown
**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium
**Assignment reason:** The phase only renames a constant across the module; the compiler checks every use.
```

The error becomes a warning that quotes the reason, and the run starts:

```text
warning  models     phase-02  claude-sonnet-5-5 / medium: outside assignments[0] (part core-decide: claude-opus-5-5, medium–high): "The phase only renames a constant across the module; the compiler checks every use."
```

The reverse is a defect too: a phase that conforms to its bound, or takes the default where no bound governs, and still carries an `**Assignment reason:**` line is reported (`conforms to assignments[0] (…) but carries an **Assignment reason:** line`). A phase that matches no bound and departs from the default without a reason is a warning, not an error: `no bound governs; departs from the policy default (claude-sonnet-5-5 / medium) with no **Assignment reason:** line`.

## Make the default binding

To make the policy default binding for every file no earlier bound covers, end the list with a catch-all `globs` bound:

```json
{
  "kind": "globs",
  "globs": ["**"],
  "model": "claude-sonnet-5-5",
  "effort": { "min": "medium", "max": "medium" }
}
```

Every phase that plans a file then has a governing bound, and a departure from it without a reason is an error, not a warning.

## Check the bounds

Decoding checks the shape of every bound (a non-empty list, a valid glob, a known kind). Whether a bound's model and efforts exist in the routing catalog is a separate check, run by `phax validate`, `phax plans lint` and the run preflight:

```text
assignments[1].model: claude-sonnet-9 is not in the catalog
assignments[2].effort: min "xhigh" is not an effort claude-sonnet-4-6 offers
assignments[3].effort: min "high" comes after max "medium" for claude-opus-5-5
```

`phax validate` exits 2 on any of them, naming `assignments[N]` and the field, and prints `N assignment bounds (P part, G globs)` when they are sound. Lint and the run preflight report one `models` error per invalid bound and compare no phase with the bounds until they are fixed. A part that the provider does not report (or no provider at all) is reported the same way:

```text
assignments[0] (part core-decide): unresolved: the architecture report has no part core-decide; no phase was compared with the bounds
```

## What runs the provider

A part bound needs the architecture provider to resolve its globs. `phax plans lint` and the start of `phax run` and `phax resume` run it, with the working tree's root as the working directory and the main checkout's config, when at least one bound is a `part` bound. A fresh `phax run` runs it twice (the start preflight, then the re-check as the run is named); `phax resume` runs it once. No other command runs it for the bounds, and an agent session never does.
