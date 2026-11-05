Write the phax plan for the Approved spec `drop-orient` (`docs/specs/2610060950-drop-orient.md`, with its sidecar `.json`). The spec is the source of truth. All four §9 questions were decided by the author (2026-10-06); implement those decisions and do not reopen them. One plan carries the whole spec, so it completes the spec.

This is the first of four specs that land in order: `drop-orient`, then `drop-gate-scopes`, then `gate-request`, then `brief-provider`. Implement only this one.
- Do not touch the scope machinery, the gate, or anything those three specs change.
- Do not edit those specs' text.
- Spec §10 names the wording each live spec's later revision must change. Record it in `NEXT_STEPS.md` only if the spec asks for that; the specs themselves are edited through their own revision.

The hard-drop rules, from spec §9 Q2:
- No phase adds a shim, alias, deprecation, migration, dedicated refusal, upgrade note or "removed" section.
- No test names a leftover `orient` key, command or file.
- The existing unknown-key (exit 2) and unknown-command behaviour applies unchanged and is not re-tested for orient.

Kept history is defined by spec §9 Q4: all of `docs/specs/` and `docs/plans/` (archived and live), `docs/briefs/`, `docs/spikes/`, and `NEXT_STEPS.md` except its cross-run item. The sweep covers every other tracked file, including `docs/ideas/`, and must be mechanically checkable, as the spec's sweep criterion asks.

Phase shape: inside-out, each phase green on its own, with tests in the same phase (no oracle phases).
1. Remove the phase-start query, the prompt section and `orient-brief.json`. The core goes first.
2. Remove `phax orient`, the config key, the agent-command grant and the telemetry. Regenerate the usage spec and reference with `pnpm gen:usage-spec` and `pnpm docs:cli`, never by hand.
3. Remove the example, the README section and its hook count, the generated site sources if they are tracked, and the rest of the sweep.

Adjust the phase boundaries if the gates need a different cut.

Constraints:
- Nothing from `~/.phax` or another repository enters this public repository.
- Respect the layers.
- No `@lbdremy/phax-schemas` format changes: spec §10 says all changed shapes are phax-internal.
- No `.claude/skills/` file mentions orient, so the run needs no `--allow-skill-edits`. If a phase finds one, it reports it in its handoff instead of editing it.
- Gate: the plan must pass `phax plans lint`; every phase is verified by the `standard` gate profile.

Output: your final message is the plan document JSON and nothing else — no sentence before or after it, no code fence.
