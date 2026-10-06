Write the phax plan for the Approved spec `completes-spec` (`docs/specs/2610060955-completes-spec.md`, with its sidecar `.json`). The spec is the source of truth. All six §9 questions were decided by the author (2026-10-05 and 2026-10-06); implement those decisions and do not reopen them. In particular, the creation flags are `--last` / `--not-last`, and the frontmatter key is `completes-spec`. One plan carries the whole spec, so it completes the spec.

The run that executes this plan is driven by the installed phax 0.19.0. That version knows nothing of `completes-spec`, and it completes this plan and its spec at run end as it does today. That is correct here, because this is the spec's only plan.

**Migrate live plans by hand (spec §9 Q6).** The last phase adds `completes-spec` to every live plan that has a source spec. At planning time there are none: the only live plan with a spec is this one, and `phax run` archives it at run end. Re-check the tree in that phase anyway; this plan file itself must not gain the key.

Phase shape: inside-out, each phase green on its own, with tests in the same phase (no oracle phases).
1. The frontmatter key and its validation, with each variant's single legal form: present only when `source-spec` is set, refused otherwise. Also the plan document mirror (`completesSpec`) and the headless renderer.
2. Run completion honours the key, and the run report and PR body say when the spec was not completed.
3. `phax artifact new plan`: the required `--last` / `--not-last` with `--spec`, in interactive and headless modes. Regenerate the usage spec and reference with `pnpm gen:usage-spec` and `pnpm docs:cli`.
4. Docs: the README plan-lifecycle text, the `phax-planning` skill's "Plan frontmatter block" (the key, when a plan is its spec's last, the flags), the `phax-cli` skill if it describes `artifact new plan`, and `NEXT_STEPS.md` (tick the item "A run completes its source spec even when more plans are to come", and drop the artifact-decide note about reverting the run's spec completion on every plan but the last).

Constraints:
- Test plans and specs are made up.
- Respect the layers.
- No change to the chain gate's own rule, to spec completion by hand (`phax artifact complete`), or to plan completion.
- Phase 4 edits `.claude/skills/`, so the run uses `phax run --allow-skill-edits`. Say so in the preamble.
- Gate: the plan must pass `phax plans lint`; every phase is verified by the `standard` gate profile.

Output: your final message is the plan document JSON and nothing else — no sentence before or after it, no code fence.
