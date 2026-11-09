// `phax resume <short-name>` as the runner reads it. Without --yes it writes what it would resume
// (said: stdout at once, note lines under --json) and answers its preview, taking no lock: it never
// waits on a person, so it declares no `prompts`. With --yes (or -y) it runs the run from its next
// pending phase as `phax run` does, the stop-closed lines said as they happen, and answers the
// outcome runOutcome.ts describes: a run in review, a stop (13) or a pause, whose code a verdict
// reads from it. A run already in review answers with an empty render and today's stderr lines as
// notes. The retired --skip-oracle is refused by the runner with its sentence, before anything is
// read. `--verbose` and `--trace` are the program's options (q-local-trace-flags: drop-local).
//
// The definition reads run-status.json, publication.json and plan.md directly, as runResume did:
// its entry in the architectural guard's direct-I/O allowlist says so.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, Result, type Layer } from "effect";
import * as Schema from "effect/Schema";
import { executePlan } from "../../app/executePlan.js";
import { loadConfig } from "../../app/loadConfig.js";
import { loadModelRouting, loadProviderConfig } from "../../app/loadRouting.js";
import { loadPlan } from "../../app/loadPlan.js";
import { loadTelemetryConfig } from "../../app/loadTelemetryConfig.js";
import { withRunLock } from "../../app/lock.js";
import { resolveRunRef } from "../../app/resolveRunRef.js";
import { inspectResumeOfRun } from "../../app/resume.js";
import { decodeRunId, decodeShortName, type RunId } from "../../domain/branded.js";
import { AwaitingReviewStopError, StopCloseRefusedError } from "../../domain/errors.js";
import {
  acceptanceSkipRefusal,
  stopSkipAcceptanceRefusal,
} from "../../domain/plan/acceptancePairs.js";
import { DEFAULT_MODEL_ROUTING, DEFAULT_PROVIDER_CONFIG } from "../../domain/routing/defaults.js";
import {
  applyProviderPriorityOverride,
  type NonEmptyArray,
  parseProviderPriority,
} from "../../domain/routing/priorityOverride.js";
import type { ProviderId } from "../../domain/routing/types.js";
import { runKey } from "../../domain/runRef.js";
import type { Backend } from "../../ports/backend.js";
import type { GitHub } from "../../ports/github.js";
import type { Shell } from "../../ports/shell.js";
import { NoopSystemTelemetryLayer } from "../../ports/systemTelemetry.js";
import { readRunStatusFile } from "../../schemas/persisted.js";
import { decodePublication } from "../../schemas/publication.js";
import { AliasAnnotationId, defineCommand, reject } from "../commandLibrary/contract/index.js";
import { readBundledReviewSkillForRun } from "../commands/bundledReviewSkill.js";
import { configErrorText } from "../commands/reportConfigError.js";
import {
  buildSystemTelemetryLayer,
  makeRepoRootedFileSystemLayer,
  provideRunLayers,
} from "../commands/runLayers.js";
import {
  resumeRetryCommand,
  retryCommandLine,
  splitFollowUps,
} from "../commands/sessionFailureOutput.js";
import { renderStopClosed } from "../commands/stopOutput.js";
import { readPackageVersion } from "../commands/usage.js";
import { clearRunInterruptContext, setRunInterruptContext } from "../interruptHandler.js";
import {
  closeRefusedPause,
  completionsValue,
  failureLines,
  outcomeNotes,
  outputPortOf,
  pauseOf,
  renderOutcome,
  RunAnswer,
  type RunCommandError,
  runError,
  runErrorOf,
  runErrors,
  runExits,
  runTexts,
  runVerdicts,
  stoppedOutcome,
} from "./runOutcome.js";
import { ShortNameArg } from "./shared.js";

/** Layers a test swaps for fakes; each defaults to the real adapter. */
export interface ResumeDeps {
  readonly backendLayer?: Layer.Layer<Backend>;
  readonly githubLayer?: Layer.Layer<GitHub>;
  readonly shellLayer?: Layer.Layer<Shell>;
}

const SKIP_ORACLE_RETIRED = "--skip-oracle is no longer read: write --skip-acceptance";

const ResumeFlags = reject(
  Schema.Struct({
    yes: Schema.optionalKey(Schema.Boolean).annotations({
      description: "Proceed without confirmation",
      [AliasAnnotationId]: "y",
    }),
    providerPriority: Schema.optionalKey(
      Schema.String.annotations({
        identifier: "list",
        description: "Comma-separated provider priority override (e.g. mistral-vibe,claude-code)",
      }),
    ),
    skipAcceptance: Schema.optionalKey(
      Schema.Boolean.annotations({
        description:
          "Skip the acceptance step of the phase this resume restarts at; its configured gate still runs",
      }),
    ),
  }),
);

interface ResumeCall {
  readonly runRefArg: string;
  readonly yes: boolean;
  readonly providerPriority: string | undefined;
  readonly skipAcceptance: boolean;
  readonly verbose: boolean;
  readonly trace: boolean;
  readonly say: (text: string) => Effect.Effect<void>;
  readonly progress: (text: string) => Effect.Effect<void>;
}

/** A refusal before the run starts: its code and its lines. */
const refuse = (code: number, lines: string | ReadonlyArray<string>) =>
  Effect.fail(runError(code, lines));

function runResumeCommand(
  call: ResumeCall,
  deps: ResumeDeps,
): Effect.Effect<RunAnswer, RunCommandError> {
  return Effect.gen(function* () {
    const out = outputPortOf(call);
    const configResult = loadConfig(process.cwd());
    if (Result.isFailure(configResult)) return yield* refuse(1, configErrorText(configResult.left));
    const config = configResult.right;
    const { stateRoot } = config;

    const telemetryConfigResult = loadTelemetryConfig();
    if (Result.isFailure(telemetryConfigResult)) {
      return yield* refuse(1, configErrorText(telemetryConfigResult.left));
    }
    const telemetryEnabled = telemetryConfigResult.right.enabled;

    const resolvedResult = resolveRunRef(call.runRefArg, config, stateRoot);
    if (Result.isFailure(resolvedResult)) return yield* refuse(1, resolvedResult.left.message);
    const { namespace, info, crossProject } = resolvedResult.right;
    const shortNameStr = resolvedResult.right.shortName;
    const qualifiedName = runKey(namespace, shortNameStr);
    // Safe: resolveRunRef already validated the shortName via decodeShortName.
    const shortNameResult = decodeShortName(shortNameStr);
    if (Result.isFailure(shortNameResult)) {
      return yield* refuse(1, `Internal error: resolved shortName "${shortNameStr}" is invalid.`);
    }
    const shortName = shortNameResult.right;

    let priorityOverride: NonEmptyArray<ProviderId> | undefined;
    if (call.providerPriority !== undefined) {
      const parsed = parseProviderPriority(call.providerPriority);
      if (!parsed.ok) return yield* refuse(1, parsed.error);
      priorityOverride = parsed.value;
    }

    const runPath = join(stateRoot, "runs", runKey(namespace, shortName));
    // Read before the decision: the run's recorded hold names a held phase
    // whose stop is still owed.
    const runStatusPath = join(runPath, "run-status.json");
    let runStatusRaw: unknown;
    try {
      runStatusRaw = JSON.parse(readFileSync(runStatusPath, "utf8"));
    } catch (e) {
      return yield* refuse(
        2,
        `Cannot read run-status.json: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    const runStatusResult = readRunStatusFile(runStatusPath, runStatusRaw);
    if (Result.isFailure(runStatusResult)) return yield* refuse(2, runStatusResult.left.message);
    const runStatus = runStatusResult.right;

    const inspectionResult = yield* Effect.result(inspectResumeOfRun(info, runStatus.hold)).pipe(
      Effect.provide(makeRepoRootedFileSystemLayer(config)),
    );
    if (Result.isFailure(inspectionResult)) {
      return yield* refuse(2, `Cannot read the run's phases: ${inspectionResult.left.message}`);
    }
    const { decision: decisionResult, completedPhaseCount } = inspectionResult.right;
    if (Result.isFailure(decisionResult)) {
      const refusal = decisionResult.left;
      if (refusal.reason === "review_open") {
        let prUrl: string | null = null;
        try {
          const pubRaw = JSON.parse(
            readFileSync(join(info.runPath, "publication.json"), "utf8"),
          ) as unknown;
          const pubResult = decodePublication(pubRaw);
          if (Result.isSuccess(pubResult) && pubResult.right.pullRequestUrl !== undefined) {
            prUrl = pubResult.right.pullRequestUrl;
          }
        } catch {
          // no publication.json or unreadable — no pull request to name
        }
        const answer: RunAnswer = {
          qualifiedName,
          crossProject,
          outcome: {
            kind: "already-in-review",
            message: refusal.message,
            phaseCount: completedPhaseCount,
            pullRequest: prUrl,
          },
        };
        return answer;
      }
      return yield* refuse(1, refusal.message);
    }

    const decision = decisionResult.right;
    for (const skippedId of decision.skippedPhaseIds) {
      yield* call.say(`  Skipping ${skippedId} (produced no changes).`);
    }
    // Read the plan before promising a resume: a phax-plan.json this phax
    // refuses (an older shape) is refused on the preview too.
    const planPath = join(runPath, "phax-plan.json");
    const planMdPath = join(runPath, "plan.md");
    const planResult = loadPlan(planPath, { run: qualifiedName });
    if (Result.isFailure(planResult))
      return yield* refuse(2, `Plan error: ${planResult.left.message}`);
    const plan = planResult.right;

    if (call.skipAcceptance) {
      const skipRefusal =
        runStatus.state === "awaiting_review"
          ? stopSkipAcceptanceRefusal(plan.phases, shortName, decision.nextPhaseId)
          : acceptanceSkipRefusal(plan.phases, decision.nextPhaseId);
      if (skipRefusal !== null) return yield* refuse(1, skipRefusal);
    }

    yield* call.say(
      `Run "${qualifiedName}" (state: ${decision.fromState}) — would resume from phase ${decision.nextPhaseIndex + 1}: ${decision.nextPhaseId}`,
    );
    if (decision.owedStep === "handoff") {
      yield* call.say(
        `  Writing the missing handoff of ${decision.nextPhaseId} first (its handoff turn did not finish).`,
      );
    } else if (decision.owedStep === "post-handoff") {
      yield* call.say(
        `  Finishing ${decision.nextPhaseId} first: its handoff is in place, its record and cleanup did not run.`,
      );
    }
    if (call.skipAcceptance) {
      yield* call.say(
        `  Skipping the acceptance step of ${decision.nextPhaseId} (--skip-acceptance); its configured gate still runs.`,
      );
    }

    if (!call.yes) {
      yield* call.say("Pass --yes to proceed.");
      const answer: RunAnswer = {
        qualifiedName,
        crossProject,
        outcome: {
          kind: "preview",
          fromState: decision.fromState,
          nextPhaseId: decision.nextPhaseId,
          nextPhaseIndex: decision.nextPhaseIndex,
          skippedPhaseIds: [...decision.skippedPhaseIds],
          owedStep: decision.owedStep,
          skipAcceptance: call.skipAcceptance,
        },
      };
      return answer;
    }

    let planMd: string;
    try {
      planMd = readFileSync(planMdPath, "utf8");
    } catch (e) {
      return yield* refuse(
        2,
        `Cannot read plan.md at "${planMdPath}": ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    const runIdResult = decodeRunId(runStatus.runId);
    if (Result.isFailure(runIdResult)) return yield* refuse(2, `Invalid runId in run-status.json`);
    const runId = runIdResult.right;

    const profiles = config.raw.gateProfiles;
    const gateProfileId = runStatus.gateProfileId ?? Object.keys(profiles)[0] ?? null;
    if (gateProfileId === null) return yield* refuse(2, "No gate profiles configured in phax.json");

    const routingResult = yield* Effect.result(
      Effect.all({ routing: loadModelRouting(), providerConfig: loadProviderConfig() }),
    ).pipe(Effect.provide(makeRepoRootedFileSystemLayer(config)));
    const { routing: loadedRouting, providerConfig } = Result.isSuccess(routingResult)
      ? routingResult.right
      : { routing: undefined, providerConfig: DEFAULT_PROVIDER_CONFIG };

    const routing =
      priorityOverride !== undefined
        ? applyProviderPriorityOverride(loadedRouting ?? DEFAULT_MODEL_ROUTING, priorityOverride)
        : loadedRouting;

    const telemetryLayer = telemetryEnabled
      ? buildSystemTelemetryLayer(
          { verbose: call.verbose, trace: call.trace },
          join(runPath, "semantic.jsonl"),
          out,
          shortName as unknown as RunId,
        )
      : NoopSystemTelemetryLayer;

    const program = withRunLock(
      runKey(namespace, shortName),
      Effect.flatMap(readBundledReviewSkillForRun(config, out), (bundledReviewSkill) =>
        executePlan({
          bundledReviewSkill,
          shortName,
          namespace,
          plan,
          planMd,
          config,
          gateProfileId,
          workspaceId: undefined,
          allowDirty: true,
          runPath,
          runId,
          startIndex: decision.nextPhaseIndex,
          skipAcceptance: call.skipAcceptance,
          phaxVersion: readPackageVersion(),
          output: out,
          routing,
          providerConfig,
          // Skill edit consent is given only at `phax run`; resume inherits it.
          allowSkillEdits: runStatus.allowSkillEdits === true,
          verbose: call.verbose,
          // Re-supply the plan's repo-relative path recorded at run creation so the
          // final phase carries artifact completion on resume too (spec 27). Runs
          // created before this field, and loose plans, resume with completion
          // skipped (the field is absent).
          ...(runStatus.planRepoRelPath !== undefined
            ? { planRepoRelPath: runStatus.planRepoRelPath }
            : {}),
          onStopClosed: (closed) => {
            for (const line of renderStopClosed(closed)) out.log(line);
          },
        }),
      ),
    );

    setRunInterruptContext(shortName, namespace, stateRoot, (text) => out.warn(text));
    const result = yield* Effect.result(
      provideRunLayers(program, config, telemetryLayer, providerConfig, deps),
    ).pipe(Effect.ensuring(Effect.sync(clearRunInterruptContext)));

    if (Result.isFailure(result)) {
      const { cause: err, followUps } = splitFollowUps(result.left);
      if (err instanceof AwaitingReviewStopError) {
        const answer: RunAnswer = { qualifiedName, crossProject, outcome: stoppedOutcome(err) };
        return answer;
      }
      const pauseContext = {
        qualifiedName,
        shortName,
        runFolder: runPath,
        providerPriority: call.providerPriority ?? null,
        limitVerb: "paused again",
      };
      if (err instanceof StopCloseRefusedError) {
        const retry = resumeRetryCommand(call.runRefArg, call.providerPriority ?? null);
        const answer: RunAnswer = {
          qualifiedName,
          crossProject,
          outcome: closeRefusedPause(err, pauseContext, retry),
        };
        return answer;
      }
      const pause = pauseOf(err, pauseContext);
      if (pause !== null) {
        const answer: RunAnswer = { qualifiedName, crossProject, outcome: pause };
        return answer;
      }
      // A failure outside a pause (a stop's close, for one) keeps the
      // invoked command as its retry hint.
      const retry = retryCommandLine([
        "resume",
        call.runRefArg,
        ...(call.yes ? ["--yes"] : []),
        ...(call.providerPriority === undefined
          ? []
          : ["--provider-priority", call.providerPriority]),
        ...(call.skipAcceptance ? ["--skip-acceptance"] : []),
      ]);
      return yield* Effect.fail(
        runErrorOf(err, failureLines(err, followUps, "phax resume failed", retry), shortName),
      );
    }

    const execResult = result.right;
    const answer: RunAnswer = {
      qualifiedName,
      crossProject,
      outcome: {
        kind: "review_open",
        phaseCount: execResult.completedPhaseCount,
        pullRequest: execResult.prUrl ?? null,
        completions: completionsValue(execResult.artifactCompletions),
        finalReport: join(runPath, "final-report.md"),
      },
    };
    return answer;
  });
}

const RESUME_HELP =
  "Picks up a run from its next pending phase, re-entering the same execution loop as phax run. Without --yes it prints where it would resume and exits 0, asking nothing; --yes proceeds.\n\nA committed phase whose handoff turn was cut short (a rate or usage limit) gets its handoff written first: resume runs that phase's handoff turn again, in its session and its worktree, then goes on. When that worktree is gone, or its session id, resume refuses with exit 1 and nothing changes; the message names the remedy: restore the worktree with git worktree prune then git worktree add <recorded worktree path> <phase branch> (git keeps a deleted worktree registered until it is pruned), or write <run folder>/<phase>/phase-handoff.md with its four sections by hand, then resume again. After a handoff written by hand, resume finishes that phase with no agent turn: it collects its pulled briefs, writes its record and runs its cleanup, then goes on; when its worktree is gone too, the cleanup commands do not run (a warning names them: run them yourself if they free resources outside the worktree) and the phase is still cleaned up. The final message counts every phase of the run that committed, across resumes.\n\nA run whose phax-plan.json was written by an older phax, in an older shape, is refused with exit 2: finish it with the phax release that started it, or archive it with phax archive <run> --force and run its plan again.\n\nThe same preflight as phax run applies: a phase that departs from the owner's assignment bounds without an **Assignment reason:** line, or an invalid bound, refuses with exit 11 (\"Assignment preflight failed\"), and so does every error of the plan's acceptance phases: a malformed declaration, a broken pair, or an acceptance phase with no \"acceptance\" provider configured (\"Acceptance preflight failed\"). The preflight re-checks the current configuration, so a run whose \"acceptance\" block was removed since it started is refused too.\n\nA passing phase whose acceptance phase was skipped (it produced no changes, so it noted no commit) is refused before its agent runs, with exit 11: there are no acceptance tests to pass, and the run fails.\n\n--skip-acceptance applies only to the phase this resume restarts at, and only in this invocation. That phase's configured gate steps run and must pass, with the usual fix loop; its acceptance step does not run, and is recorded as skipped in its gate-attribution, so acceptance is then not among that phase's verified surfaces, nor the run's. At a phase that is neither an acceptance phase nor a passing phase, it is refused with exit 1 and nothing changes. On a run in awaiting_review it is refused with exit 1 too: at a stop in an acceptance pair because a close's authored step is never skipped (undo the acceptance-test-file correction or phax reset-phase the stop), and at a stop in no pair because that phase has no acceptance step. A committed acceptance phase is never reset, so a wrong acceptance test is corrected in the stopped phase (phax enter-phase <run> <phase>) and closed this way.\n\nA run in awaiting_review (stopped at a declared interactive phase or a held one, exit 13) is closed by resume, which re-checks the preflight and then runs the gate first: a red gate returns the phase to the person (exit 4) and the run stays in awaiting_review. The handoff is the person's .phax-context/correction-handoff.md when it exists (four sections, checked before anything runs), otherwise the handoff a read-only closing turn writes from the diff of the corrections; a closing turn that edits the worktree exits 5, its edits set aside in the phase's refused-turn-NN/ folder and the worktree put back to the gated tree, and so does an answer still invalid after one corrective resume; a closing turn that could not reach the provider (a network failure) exits 14, its message recorded in review-stop.json, and the run stays in awaiting_review. At a declared stop phax then commits exactly the gated tree with an Interactive-Phase: trailer (an empty commit when nothing changed). At a held stop it leaves one review commit with a Held-Phase: trailer on top of the unchanged phase commit, or no commit when nothing changed, then writes the phase's record once, naming the phase commit. Either way it runs the cleanup and continues with the next phase in the same invocation, whose prompt carries the correction under ## Review corrections. A hold or a close interrupted before its cleanup is finished by the next resume: a held phase that committed but did not stop stops then, with no agent turn, and a close that landed its state but not its cleanup runs the cleanup (and writes the held phase's record, once). A close that changes an acceptance test file of the pair it sits in runs the acceptance provider's authored verdict as the last step of its gate, naming the stopped phase and judging the acceptance test files in the worktree's gated tree, before the close commits (the passing phase later judges the pair's latest commit that passed authored); a held passing phase is closed on its configured steps only and warns about each acceptance test file its corrections changed. A close reads the closer's identity from the main checkout's git configuration first (user.name and user.email); an unset identity refuses the close with exit 1 and the run stays in awaiting_review. It then copies the transcript of each recorded session (the builder, the first turns that answered and every --new-session session) into <run>/<phase>/interactive-transcripts/<session id>.jsonl, mode 0600, or records it as missing with a reason; a transcript never enters a commit or a record. It records the closer in the stop and writes the phase's record once, for a declared phase as well as a held one, naming the mode, cause, outcome, closer and sessions with their transcript digests; a record destination that refuses it pauses the run for a resume. A close also sets the stop section of the phase's security.json.\n\nA refused close puts the run back in awaiting_review with the reason in review-stop.json; an interrupt during a close does the same.\n\nSide effects: creates worktrees, commits files, writes to ~/.phax/runs/.";

export function makeResumeCommand(deps: ResumeDeps = {}) {
  return defineCommand({
    name: "resume",
    summary: "Resume a run from its next pending phase",
    help: RESUME_HELP,
    examples: [
      "phax resume usage-cli",
      "phax resume usage-cli --yes",
      "phax resume refunds --yes --skip-acceptance",
    ],
    input: { args: reject(Schema.Tuple(ShortNameArg)), flags: ResumeFlags },
    output: reject(RunAnswer),
    retiredOptions: { "skip-oracle": SKIP_ORACLE_RETIRED },
    run: ({ input, program, say, progress }) =>
      runResumeCommand(
        {
          runRefArg: input.args[0],
          yes: input.flags.yes === true,
          providerPriority: input.flags.providerPriority,
          skipAcceptance: input.flags.skipAcceptance === true,
          verbose: program["verbose"] === true,
          trace: program["trace"] === true,
          say,
          progress,
        },
        deps,
      ),
    exits: runExits,
    errors: runErrors,
    texts: runTexts,
    verdicts: runVerdicts,
    render: renderOutcome(false),
    notes: outcomeNotes,
  });
}

export const resumeCommand = makeResumeCommand();
