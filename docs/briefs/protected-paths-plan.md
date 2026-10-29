Write the only phax plan of the spec `protected-paths` (`docs/specs/2610291023-protected-paths.md`, approved 2026-10-29). Its run completes the spec (`completes-spec: true`). Title it "Protected paths".

**Scope.** The whole spec: §5.1 to §5.23, every §6 surface and every acceptance criterion. In short:
- a top-level `protectedPaths` list in `phax.json` only, validated with the existing glob dialect (`ArchitectureGlobSchema`). It is refused in overlays, refused when it reaches into a submodule, and makes `phax.json` itself protected.
- Native rules for literal and `**/`+literal globs:
  - Claude Code: `Edit(//…)` deny rules, merged into the inline settings that skill edit grants already use;
  - Vibe: `denylist` entries beside the `.vibe`/`.agents` guards, with the post-turn export read-back extended.
  - Codex gets none.
  - Unsafe mode gets none.
- One deterministic check of the phase against its recorded `base`, at each gate attempt in the fix loop and at a commit-only resume. It compares the real content of protected tracked files, so skip-worktree cannot hide a change. It also lists untracked files, ignored ones included. It counts type changes. It reads NUL-separated paths and folds case.
- What the check produces:
  - a failed gate attempt, with `failedStep: "protected-paths"`;
  - a fix prompt that carries both failures when a step failed too;
  - `gates_exhausted` with resume-instructions.md naming the paths and the last `fix-attempt-NN.jsonl`;
  - a check after the handoff turn and on every resume out of `handoff_failed`;
  - no check at a stop's close.
- Records:
  - `security.json` version 3, with a required `protectedPaths`, and version 1/2 files lifted;
  - `gate-attribution.json` with a required `protectedPaths`, through a `next` snapshot at the opened version 0.31.0 and a frozen history module.
- The preflight refusal (exit 11) of a skill edit grant on a protected path.
- The phase prompt's Protected paths section.

**Settle in Technical arbitrations, each with its dominant loss:**
- where the check lives:
  - a pure domain function from the protected list and the phase's observed changes to the violations;
  - the git reads behind a port, in infra;
  - which existing reconciliation code it reuses, and why it does not reuse `parseNameStatus` as is.
- how the native rule sets are derived from the list: one shared domain function for both providers, so Claude and Vibe never disagree on which globs are "exact".
- where in `fixLoop.ts` the check runs, so that `closeStop`'s `runGates` never runs it.
- how the gate-attribution record carries the new variant without an optional field.

**Constraints:**
- No back-compat shims, and no optional field in a persisted shape. Older stamps are read through the frozen modules or the existing lift.
- Tests never read `~/.phax`, a real `~/.claude`, `~/.codex` or `~/.vibe`, the global git config, or the real `gh`. Use `tests/helpers/isolateGit.ts`, temporary directories, the fake provider backends and `makeFakeGitHub()`.
- The real-CLI acceptance criteria (Claude Code and Vibe refusing an edit natively) live in `tests/e2e/`, gated on `PHAX_E2E_RUN=1`, as one new named file per provider or new cases in `tests/e2e/vibeSecure.test.ts`. The phase gate does not run them; say so in the test strategy, as the review will run them by name.
- Respect the layer rules of `pnpm audit:architecture` and every exhaustive format registry the schemas package tests hold.
- Gates: the `standard` profile verifies every phase, and `phax.json` allows every command a phase runs. Regenerate `phax.usage.kdl` and `docs/cli/reference.md` (`pnpm gen:usage-spec`, `pnpm docs:cli`) when help text or exit codes change.
- Models: follow the phax-planning skill's model policy.
- `### Test strategy`: use the line format, with the spec's criterion ids. Cover every criterion.
- Oracle pair: the check is a stable contract before its code exists, so it is a strong candidate. Its input is the protected list and a set of observed changes (kind, path, case variants, type changes, ignored creations, submodule refusal at validate), and its output is the violations. If you do not use one, say why.
- The plan must pass `phax plans lint`.
- No skill changes, so the run needs no `--allow-skill-edits`.

**Docs:** a "Protected paths" section in `docs/security.md`, the README's configuration section where phax.json keys are listed, and `docs/upgrading.md` 0.31.0 for records readers: `security.json` version 3 and the gate-attribution field.

**Phase shape:** as few phases as the gates allow, with every commit green.

**Output:** your final message is the plan document JSON and nothing else: no sentence before or after it, and no code fence.
