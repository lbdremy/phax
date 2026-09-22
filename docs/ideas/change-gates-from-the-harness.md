# Idea: two gates on the *change*, from "the harness is the product"

> Status: **brainstorm**. Captured 2026-09-22 from the steme-doc notes
> `09-blog-articles/encode-the-system/next/the-harness-is-the-product.md` and
> `recovery-over-prevention.md` — not a spec, not a plan. Nothing below is committed.
> Related: [`autopilot.md`](./autopilot.md) (the loop these gates would protect), spec 23
> (decision requests), `plans lint`.

Both notes argue the same thing from two sides: the durable artifact is what constrains
regeneration, and a guarantee can be about the *change* rather than about the code. phax
already owns that family (worktree per phase, gates, PR, rollback). Two gates fall out that
are about the change and belong in phax, not in steme's rules:

1. **A reviewable-unit gate.** "If the agent produced 2,000 lines, the harness should refuse
   the unit, not the content." A per-phase diff budget (lines, files, or both) declared in
   `phax.json`; exceeding it is a gate failure whose fix prompt asks the agent to split, not
   to shrink by deleting tests. The constraint is human attention, which did not get cheaper.
2. **An oracle-separation lint.** "An agent never edits what judges its work." A `plans lint`
   rule refusing a phase that plans both a file and its oracle (its test, the disposition
   matrix it must satisfy, a fixture it is judged against). The pairing needs a convention —
   `x.ts` / `x.test.ts` is the cheap first one; a declared `oracles` concept in the target's
   manifest is the honest one and is what steme's item-10 candidate rule would provide.
   The complement at run time: oracle files are read-only to the phase session unless the
   plan declares the phase as *oracle-authoring*, in which case a different session (or a
   human) reviews them as a spec before the implementing phase runs.

Neither changes the CLI contract; both are new gate steps or lint rules behind config.
Open: whether (1) should count generated files, and whether (2) can be derived from
`scopes` closure instead of a naming convention.
