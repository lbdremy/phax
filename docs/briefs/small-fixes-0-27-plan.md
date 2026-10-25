Write the phax plan "Small fixes for 0.27". It has no source spec (`source-spec: null`), like `backlog-fixes`. It carries six entries from `NEXT_STEPS.md` "Small follow-ups". Read each entry in full before planning. 0.26.0 is the last release, and 0.27.0 is the open one (package.json is at 0.27.0).

Settled by the operator on 2026-10-25. Do not reopen these:
- **Scope.** The six fixes below. The refused `phax resume` that leaves the run `failed`, and the person's handoff set aside after a crashed turn, stay out: they touch the state machine and need their own thinking.
- **The footer has no `phax.json` key.** Every run's pull request carries it. Loss: someone who does not want phax named in their pull requests edits each description by hand. A key can be added later without breaking anything.
- **The footer links the plan and the spec by permalink at the published head commit:** `https://github.com/<owner>/<repo>/blob/<sha>/<path>`. Loss: a link does not follow corrections pushed to the pull request later. It shows the files as the run left them.

## The six fixes

### 1. A phax footer on every run's pull request

The emoji 🛤️ was decided on 2026-10-24. `buildShortPrBody` (`src/domain/publish/prBody.ts`) ends the body with a footer in the spirit of Claude Code's:
- the line `🛤️ Generated with [phax](https://docs.phax.run) <version> — the golden path, just facts`;
- then the plan and the spec, as permalinks;
- the agents that ran the phases: provider, model, effort and the number of phases at each;
- the run's qualified name.

There is no session URL: phax's sessions are local and headless.

What exists:
- `publishRun` (`src/app/publishRun.ts`) builds the input. It is called by `executePlan.ts` (around line 2424) and by `src/cli/commands/publishPr.ts`.
- The version is read only in the CLI layer (`readPackageVersion`, `src/cli/commands/usage.ts`). Pass it down as a required option. The app layer never reads `package.json`.
- Each phase's `agent-binding.json` records the provider, model and effort that actually ran.
- The GitHub port has no call for the repository's web URL. Add one, for example `gh repo view --json url`. It must not try to rebuild the URL from an ssh remote. The Git port's `resolveRef` gives the head commit of the final phase branch after the push.

Things to get right:
- **Paths at the head commit.** The run completes its plan, and possibly its spec, on the branch before publishing. The PR body's `**Plan**` summary line today names the plan's pre-archive path (`docs/plans/<stamp>-<slug>-plan.md`), even though at the head commit the plan lives under `docs/plans/archive/`. Fix the summary line as well. The footer and the summary must name each file where it lives at the published head commit, and the plan must say how that path is determined.
- **When there is no link.** A run with a loose plan, a plan with no spec, or a failed web URL lookup gets the path in a code span, or nothing for a missing spec. A footer problem never fails a publish.
- **Shortening.** The footer is never cut when the body is shortened. Count it with the sections that are never cut.
- **Reused pull request.** A pull request that already exists (`prStatus: "exists"`) keeps its body, as today.
- **Docs.** The README section on publishing shows the footer.

### 2. A usage limit during the handoff leaves the next phase without it

Found on 2026-10-24 on interactive-phases plan 3. The facts, read from the code; confirm them before planning:
- A rate-limit error raised inside `generatePhaseHandoff` (`src/app/handoffGeneration.ts`, called from `executePlan.ts` around 2159–2283) escapes to the top-level `catchIf(isRateLimitError)` (around 2524). The phase is `committed`, and the worktree is not cleaned up.
- `findNextResumablePhase` (`src/app/resume.ts:65-108`) treats a non-final `committed` phase as done, so resume starts the next phase.
- `readPreviousHandoff` (`src/app/handoffInjection.ts`) returns `undefined` for a missing file, the same value as "no previous phase". `buildPhasePrompt` (`src/app/promptGeneration.ts:60`) then prints "(no previous phase)".
- On a `committed` final phase, resume takes `resumeFromCompletion` and skips the handoff. `review-handoff` then fails with "Missing phase artifacts".

Wanted:
- **Resume regenerates the missing handoff first.** It regenerates a committed phase's missing `phase-handoff.md`, through the existing resume-from-handoff path (the session id, the worktree and the persisted `file-reconciliation.json`), before the next phase or the final review starts. This holds for a final phase as well as an earlier one. Decide in Technical arbitrations what happens when the worktree or the session is gone.
- **The prompt tells a missing handoff from a first phase.** When an earlier phase exists but its handoff file is missing, the next phase's prompt says so in its own words, never "(no previous phase)".
- **Test.** A test hits a rate limit inside the handoff turn and resumes. The fake backend has `failResumeWithRateLimit`, and `tests/integration/rateLimit.test.ts` and `resumeHandoff.test.ts` are the natural homes.
- **NEXT_STEPS.** The cost row of interactive-phases plan 3 mentions this follow-up; leave the row as it is.

### 3. The run's final message counts only the last invocation's phases

The count comes from `execResult.committedPhases`, which `executePlan` rebuilds on every invocation. It is read at `src/cli/commands/run.ts:557-560` and `src/cli/commands/resume.ts:373-383`, and the headline is in `src/domain/whatsNext.ts:211`.

Count the committed phases from the run's phase statuses on disk, as the refusal branch at `resume.ts:122-150` already does. Use one shared rule for both commands, and keep `final-report.md` as it is. A test resumes after a pause and gets the full count.

### 4. Tests that read the real `~/.phax`

`loadConfig` reads `join(homedir(), ".phax", "config.json")` on every call (`src/app/loadConfig.ts:315`). `PHAX_HOME_DIR` and `TELEMETRY_CONFIG_PATH` in `src/app/loadTelemetryConfig.ts` are module-level constants, so a `HOME` stub set after import does not move them.

Confirmed suites:
- `tests/integration/runPreflightBeforeNaming.test.ts`;
- `tests/integration/resumePreflightRechecks.test.ts`.

Likely suites, which the plan must check:
- `tests/integration/resume.test.ts`;
- `tests/integration/reviewHandoffCommand.test.ts`;
- `tests/integration/pruneCommand.test.ts`;
- `tests/unit/loadConfig.test.ts`.

Isolate every suite that reads `~/.phax`, whether the plan finds it on this list or elsewhere. Do it with a shared helper in `tests/helpers/`, on the model of `tests/helpers/isolateGit.ts`. The patterns to start from are `tests/integration/holdConfigRefused.test.ts`, whose hoisted `node:os` `homedir` mock also covers the module-level constants, and `tests/integration/holdCli.test.ts`.

Add a guard that fails a suite that reads the real `~/.phax`, so this does not come back. For example, an fs-access check in the test setup, as was used while fixing #157. Settle its shape in Technical arbitrations; its loss must be named.

### 5. `phax plans lint` accepts an oracle file listed twice

`splitEntries` (`src/domain/plan/phaseHeader.ts:105-120`) does not remove duplicates, so a repeated path reaches the `oracle-request` twice.

`oracleFindings` (`src/domain/plan/oracleCheck.ts:190-260`) reports a path listed twice as an error on the `oracles` check, naming the phase and the path, next to the `noFiles` row. Keep the finding order that the test at line 314 checks. The run preflight shares this check (`runPreflight.ts`, `executePlan.ts`), so a run refuses the plan too; say so in the docs where the oracle-file rules are listed.

Tests go in `tests/unit/oracleCheck.test.ts`.

### 6. `phax reset-phase` without `--yes` previews a reset it would refuse

`previewResetPhase` (`src/app/resetPhase.ts:359-438`) runs only `checkTargetAtStop`, although its doc comment says "the same refusals as the reset apply". `resetPhaseLocked` also refuses:
- an oracle phase whose discharge has started;
- a closed `authored` stop whose discharge has started;
- a later committed phase;
- the reducer's `not_resettable`.

Move these refusals into one shared check that both the preview and the reset run, so the preview refuses with the same message and exit code as `--yes`. Follow `phax resume`'s preview (`src/cli/commands/resume.ts:169-192`).

Tests go in `tests/integration/resetPhase.test.ts`, next to the existing refusal cases: one preview test per refusal.

## Lessons from recent reviews (#157, #158, #161, #162)

1. Every fix has its own test, named in the plan, and every refusal has its own case.
2. All I/O goes through ports. Tests never read `~/.phax`, a real `~/.claude`, `~/.codex`, `~/.vibe` or the global git config (use `tests/helpers/isolateGit.ts`).
3. A refusal names its remedy.
4. The docs say exactly what the code does. Check every README sentence the plan adds against the code.
5. The drift tests pass: the generated usage spec, the CLI reference and the published schemas. If a persisted format changes, which none of these fixes should need, say why and use the snapshot tooling.

## Constraints

- **Layers** as in CLAUDE.md. The footer text, the phase count rule and the shared reset refusals are pure domain logic.
- **No back-compat shims, and explicit per-variant enums.**
- **Autonomy.** phax stays autonomous: nothing waits on a person.
- **Fixtures** are made up.
- **Gates.** Every phase is verified by the `standard` gate profile, and every command it runs must be allowed by `phax.json`.
- **Models.** Follow the phax-planning skill's model policy, with an `assignmentReason` for any phase off the default. This repository declares no assignment bounds.
- **Lint.** The plan must pass `phax plans lint`.
- **Test strategy.** Write every `### Test strategy` in the phax-planning skill's line format (size · technique · oracle · loop).

## Docs

- README, wherever it describes the PR body, `reset-phase`'s preview, resume after a pause and the oracle-file rules.
- `docs/upgrading.md` needs nothing for 0.27.0 from this plan, unless a fix changes what a user must do.
- `NEXT_STEPS.md`: tick or remove the six "Small follow-ups" entries in the closing phase.

## Phase shape

As few phases as the gates allow, each green on its own with its tests, and no oracle phases. A likely order, from the cheapest; adjust it where it is wrong:
1. test isolation (fix 4), first, so that the later phases' tests are isolated from the start;
2. the lint and reset-phase refusals (fixes 5 and 6);
3. the resume handoff and the final count (fixes 2 and 3);
4. the PR footer (fix 1) and the NEXT_STEPS close.

## Output

Your final message is the plan document JSON and nothing else: no sentence before or after it, and no code fence.
