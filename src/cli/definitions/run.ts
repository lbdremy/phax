// `phax run [short-name] --plan <path>` as the runner reads it: extract the plan (or read its
// cached extraction), check it, then run every phase, or with --dry-run print what the run would
// do. Its progress is written as it happens: `using cached extraction` and `Run: <q>` said
// (stdout at once, note lines under --json), extract warnings, the unsafe-mode box and the
// renamed-run warning as progress (stderr at once, note lines under --json), and the telemetry's
// lines through the same OutputPort. It answers the outcome runOutcome.ts describes: a dry run, a
// run in review, a stop (13) or a pause, whose code a verdict reads from it. A refusal before the
// run starts, or a failure outside a pause, is a declared error with today's code and sentence.
// `--hold [selection]` keeps its optional value; `--verbose` and `--trace` are the program's
// options.
//
// The definition reads plan.md and the registry directly, as runRun did: its entry in the
// architectural guard's direct-I/O allowlist says so.
import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { Effect, Either, type Layer } from "effect";
import * as Schema from "effect/Schema";
import { checkPlanRunnable } from "../../app/artifactStatus.js";
import { buildDryRunReport } from "../../app/dryRun.js";
import { executePlan } from "../../app/executePlan.js";
import { loadConfig } from "../../app/loadConfig.js";
import { loadOrExtractPlan } from "../../app/loadOrExtractPlan.js";
import { loadTelemetryConfig } from "../../app/loadTelemetryConfig.js";
import { withRunLock } from "../../app/lock.js";
import { computeStalenessForPlan } from "../../app/planStaleness.js";
import { createRunFolder } from "../../app/runFolder.js";
import { freshRunPreflight } from "../../app/runPreflight.js";
import { classifyArtifactPath } from "../../domain/artifact/document.js";
import { decodeShortName, type RunId, type ShortName } from "../../domain/branded.js";
import {
  AwaitingReviewStopError,
  ConfigValidationError,
  PlanStaleError,
  RateLimitError,
  SkillEditConsentError,
  SkillEditProtectedError,
  UsageLimitError,
} from "../../domain/errors.js";
import { type HoldRequest, parseHoldValue } from "../../domain/hold.js";
import { buildFootprint } from "../../domain/planOverlap/compute.js";
import { planInputFromPhaxPlan } from "../../domain/planOverlap/fromPhaxPlan.js";
import { DEFAULT_PROVIDER_CONFIG } from "../../domain/routing/defaults.js";
import {
  type NonEmptyArray,
  parseProviderPriority,
} from "../../domain/routing/priorityOverride.js";
import type { ProviderId } from "../../domain/routing/types.js";
import { nextAvailableShortName, runKey } from "../../domain/runRef.js";
import type { SecurityMode } from "../../domain/security/types.js";
import { makeNodeGitLayer } from "../../infra/git.js";
import { NodeShellLayer } from "../../infra/shell.js";
import type { Backend } from "../../ports/backend.js";
import type { GitHub } from "../../ports/github.js";
import type { OutputPort } from "../../ports/output.js";
import type { Shell } from "../../ports/shell.js";
import { NoopSystemTelemetryLayer } from "../../ports/systemTelemetry.js";
import type { ResolvedConfig } from "../../schemas/phaxConfig.js";
import type { PhaxPlan } from "../../schemas/phaxPlan.js";
import { readRegistryFile } from "../../schemas/persisted.js";
import {
  defineCommand,
  OptionalValueAnnotationId,
  reject,
} from "../commandLibrary/contract/index.js";
import { readBundledReviewSkillForRun } from "../commands/bundledReviewSkill.js";
import { configErrorText } from "../commands/reportConfigError.js";
import {
  buildSystemTelemetryLayer,
  exitCodeForError,
  makeRepoRootedFileSystemLayer,
  provideRunLayers,
} from "../commands/runLayers.js";
import {
  isSessionFailureError,
  renderSessionFailure,
  retryCommandLine,
  splitFollowUps,
} from "../commands/sessionFailureOutput.js";
import { readPackageVersion } from "../commands/usage.js";
import { clearRunInterruptContext, setRunInterruptContext } from "../interruptHandler.js";
import {
  completionsValue,
  dryRunReportValue,
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
export interface RunDeps {
  readonly backendLayer?: Layer.Layer<Backend>;
  readonly githubLayer?: Layer.Layer<GitHub>;
  readonly shellLayer?: Layer.Layer<Shell>;
}

const optional = <S extends Schema.Schema.Any>(schema: S) =>
  Schema.optionalWith(schema, { exact: true });

const RunFlags = reject(
  Schema.Struct({
    plan: Schema.String.annotations({
      identifier: "path",
      description: "Path to the plan.md file to extract from",
    }),
    allowDirty: optional(
      Schema.Boolean.annotations({ description: "Allow starting when the working tree is dirty" }),
    ),
    providerPriority: optional(
      Schema.String.annotations({
        identifier: "list",
        description: "Comma-separated provider priority override (e.g. mistral-vibe,claude-code)",
      }),
    ),
    dryRun: optional(
      Schema.Boolean.annotations({
        description: "Preview only — extracts the plan but performs no run actions",
      }),
    ),
    security: optional(
      Schema.String.annotations({
        identifier: "mode",
        description: "Security mode override (secure|unsafe|isolated, overrides config default)",
      }),
    ),
    refresh: optional(
      Schema.Boolean.annotations({
        description: "Re-extract the plan even if a cached extraction exists",
      }),
    ),
    allowSkillEdits: optional(
      Schema.Boolean.annotations({
        description: "Allow phases to edit the .claude/skills files the plan declares",
      }),
    ),
    hold: Schema.optionalWith(Schema.Union(Schema.Literal(true), Schema.String), {
      exact: true,
    }).annotations({
      identifier: "selection",
      description:
        "Stop for review once these headless phases commit: no value for every phase but the final one, acceptance, or phase ids such as phase-02,phase-04",
      [OptionalValueAnnotationId]: true,
    }),
  }),
);

type RunFlagValues = typeof RunFlags.contract.Type;

/** The `phax run` command line these flags were parsed from, for a retry hint. */
function runRetryCommand(shortName: string | undefined, flags: RunFlagValues): string {
  return retryCommandLine([
    "run",
    ...(shortName === undefined ? [] : [shortName]),
    "--plan",
    flags.plan,
    ...(flags.allowDirty === true ? ["--allow-dirty"] : []),
    ...(flags.providerPriority === undefined
      ? []
      : ["--provider-priority", flags.providerPriority]),
    ...(flags.dryRun === true ? ["--dry-run"] : []),
    ...(flags.security === undefined ? [] : ["--security", flags.security]),
    ...(flags.refresh === true ? ["--refresh"] : []),
    ...(flags.allowSkillEdits === true ? ["--allow-skill-edits"] : []),
    ...(flags.hold === undefined ? [] : flags.hold === true ? ["--hold"] : ["--hold", flags.hold]),
  ]);
}

// A project defines a single gate profile; there is no depth-scalar
// (fast/full) preference. Select the sole profile by its first key, erroring
// when none is configured. Multi-profile disambiguation is out of scope.
export function pickGateProfileId(config: ResolvedConfig): string | null {
  const profiles = config.raw.gateProfiles;
  return Object.keys(profiles)[0] ?? null;
}

function readRegistrySync(stateRoot: string) {
  try {
    const path = join(stateRoot, "registry.json");
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const decoded = readRegistryFile(path, raw);
    return Either.isRight(decoded) ? decoded.right : { runs: [] };
  } catch {
    return { runs: [] };
  }
}

// Collision detection is scoped to the namespace via the registry (covering
// archived runs) and additionally guards against any existing bare folder.
function ensureUniqueShortName(stateRoot: string, namespace: string, base: ShortName): ShortName {
  const registry = readRegistrySync(stateRoot);
  const runsDir = join(stateRoot, "runs");
  const isUsed = (name: string): boolean =>
    registry.runs.some((r) => r.namespace === namespace && r.shortName === name) ||
    existsSync(join(runsDir, name));
  return nextAvailableShortName(base, isUsed);
}

const VALID_SECURITY_MODES: SecurityMode[] = ["secure", "unsafe", "isolated"];

function resolveSecurityMode(
  flagMode: string | undefined,
  configMode: SecurityMode,
): SecurityMode | null {
  if (flagMode !== undefined) {
    // Validate the flag value
    if (VALID_SECURITY_MODES.includes(flagMode as SecurityMode)) {
      return flagMode as SecurityMode;
    }
    return null;
  }
  return configMode;
}

const UNSAFE_WARNING = [
  "",
  "┌─────────────────────────────────────────────────────────────┐",
  "│  ⚠️  UNSAFE MODE — HOST UNRESTRICTED                               │",
  "│                                                                 │",
  "│  Running in unsafe mode grants the agent full host access:     │",
  "│    • Full filesystem read/write (including ~/.ssh, /etc)       │",
  "│    • Unrestricted network access                               │",
  "│    • MCP servers can connect to any endpoint                  │",
  "│    • Shell commands run with full user permissions             │",
  "│                                                                 │",
  "│  THIS IS NOT RECOMMENDED for untrusted prompts or code.        │",
  "│  Use --security secure (the default) for provider-native      │",
  "│  sandboxing, or wait for the future external-sandbox mode.     │",
  "│                                                                 │",
  "│  Set security.profile in phax.json to change the default.       │",
  "└─────────────────────────────────────────────────────────────┘",
  "",
].join("\n");

interface RunCall {
  readonly shortNameArg: string | undefined;
  readonly flags: RunFlagValues;
  readonly verbose: boolean;
  readonly trace: boolean;
  readonly say: (text: string) => Effect.Effect<void>;
  readonly progress: (text: string) => Effect.Effect<void>;
}

/** A refusal before the run starts: its code and its lines. */
const refuse = (code: number, lines: string | ReadonlyArray<string>) =>
  Effect.fail(runError(code, lines));

function runRunCommand(call: RunCall, deps: RunDeps): Effect.Effect<RunAnswer, RunCommandError> {
  return Effect.gen(function* () {
    const { flags } = call;
    const out: OutputPort = outputPortOf(call);
    const telemetryOptions = { verbose: call.verbose, trace: call.trace };
    // The hold's value is read before the config or the plan is, so a malformed
    // one is refused with nothing else done.
    let holdRequest: HoldRequest = { kind: "none" };
    if (flags.hold !== undefined) {
      const parsedHold = parseHoldValue(flags.hold);
      if (Either.isLeft(parsedHold)) return yield* refuse(1, parsedHold.left);
      holdRequest = parsedHold.right;
    }

    const cwd = process.cwd();
    const planMdPath = resolve(cwd, flags.plan);

    const configResult = loadConfig(cwd);
    if (Either.isLeft(configResult)) return yield* refuse(2, configErrorText(configResult.left));
    const config = configResult.right;

    const telemetryConfigResult = loadTelemetryConfig();
    if (Either.isLeft(telemetryConfigResult)) {
      return yield* refuse(2, configErrorText(telemetryConfigResult.left));
    }
    const telemetryEnabled = telemetryConfigResult.right.enabled;

    // Resolve effective security mode: CLI flag overrides config
    const effectiveSecurityMode = resolveSecurityMode(flags.security, config.security.profile);
    if (effectiveSecurityMode === null) {
      return yield* refuse(
        2,
        `Invalid security mode "${flags.security}". Must be one of: secure, unsafe, isolated`,
      );
    }
    // Handle isolated mode (stub - not yet available)
    if (effectiveSecurityMode === "isolated") {
      return yield* refuse(
        2,
        "External sandbox mode is planned but not available yet. Use 'secure' for provider-native restrictions or 'unsafe' for host-unrestricted execution.",
      );
    }
    if (effectiveSecurityMode === "unsafe") {
      yield* call.progress(UNSAFE_WARNING);
    }

    const gateProfileId = pickGateProfileId(config);
    if (gateProfileId === null) return yield* refuse(2, "No gate profiles configured in phax.json");

    let priorityOverride: NonEmptyArray<ProviderId> | undefined;
    if (flags.providerPriority !== undefined) {
      const parsed = parseProviderPriority(flags.providerPriority);
      if (!parsed.ok) return yield* refuse(2, parsed.error);
      priorityOverride = parsed.value;
    }

    // Gate on the plan's lifecycle status before wiring extraction. If the file
    // itself is unreadable, skip the gate and let loadOrExtractPlan's existing
    // error path report it — this gate must not invent a new missing-file error.
    let planMdForGate: string | undefined;
    try {
      planMdForGate = readFileSync(planMdPath, "utf8");
    } catch {
      // Unreadable plan file — defer to loadOrExtractPlan's error handling below.
    }
    if (planMdForGate !== undefined) {
      // checkPlanRunnable's location check matches repo-relative POSIX prefixes
      // (docs/plans/...), so normalize the absolute plan path against the repo
      // root before handing it over — otherwise the location guard never fires.
      const planRepoRel = relative(config.repoRoot, planMdPath).split(sep).join("/");
      const runnable = checkPlanRunnable(planMdForGate, planRepoRel);
      if (Either.isLeft(runnable)) {
        return yield* refuse(exitCodeForError(runnable.left), runnable.left.message);
      }
    }

    // Extract plan.md → PhaxPlan via Claude (or return from cache). The result
    // is never persisted in the user's repo — `createRunFolder` snapshots it
    // under ~/.phax/runs/.
    const extractEffect = loadOrExtractPlan({
      planMdPath,
      model: config.extractPlanModel,
      effort: config.extractPlanEffort,
      stateRoot: config.stateRoot,
      nowIso: new Date().toISOString(),
      refresh: flags.refresh,
    });
    // We don't yet know the shortName (it comes out of extraction), so use a
    // placeholder telemetry layer for the extract step, then rebuild under the
    // real run folder for execute.
    const extractTelemetryLayer = telemetryEnabled
      ? buildSystemTelemetryLayer(
          telemetryOptions,
          join(config.stateRoot, "extract-semantic.jsonl"),
          out,
          "extract-plan" as unknown as RunId,
        )
      : NoopSystemTelemetryLayer;
    const extracted = yield* Effect.either(
      provideRunLayers(extractEffect, config, extractTelemetryLayer, DEFAULT_PROVIDER_CONFIG, deps),
    );
    if (Either.isLeft(extracted)) {
      const err = extracted.left;
      if (err instanceof RateLimitError || err instanceof UsageLimitError) {
        return yield* refuse(exitCodeForError(err), [
          `Plan extraction paused: ${err.message}`,
          ...renderSessionFailure(err, null).slice(1),
        ]);
      }
      if (isSessionFailureError(err)) {
        return yield* refuse(
          exitCodeForError(err),
          renderSessionFailure(err, runRetryCommand(call.shortNameArg, flags)),
        );
      }
      return yield* refuse(
        exitCodeForError(err),
        `Plan extraction failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const { plan, warnings, fromCache } = extracted.right;
    if (fromCache) yield* call.say("using cached extraction");
    for (const w of warnings) yield* call.progress(`extract warning: ${w}`);
    const planMd = readFileSync(planMdPath, "utf8");

    // Gate on staleness for repo-tracked artifact plans, reusing the extraction
    // we already paid for. Loose plan.md files outside docs/plans/ cannot carry
    // an approval record, so they skip this gate entirely (same scope as the
    // lifecycle-status gate above).
    const planRepoRel = relative(config.repoRoot, planMdPath).split(sep).join("/");
    if (classifyArtifactPath(planRepoRel) !== null) {
      const footprint = buildFootprint(planInputFromPhaxPlan(plan, planRepoRel, planRepoRel));
      const stalenessResult = yield* Effect.either(
        computeStalenessForPlan(planRepoRel, planMd, Array.from(footprint.all), {
          repoRoot: config.repoRoot,
        }).pipe(
          Effect.provide(makeRepoRootedFileSystemLayer(config)),
          Effect.provide(makeNodeGitLayer()),
        ),
      );
      if (Either.isLeft(stalenessResult)) {
        const err = stalenessResult.left;
        return yield* refuse(
          exitCodeForError(err),
          `phax run refused: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      const verdict = stalenessResult.right;
      if (verdict.kind !== "fresh") {
        const staleError = new PlanStaleError({ path: planRepoRel, verdict });
        return yield* refuse(exitCodeForError(staleError), staleError.message);
      }
    }

    if (call.shortNameArg !== undefined && call.shortNameArg !== plan.run.shortName) {
      return yield* refuse(
        2,
        `Short name mismatch: argument "${call.shortNameArg}" does not match plan short name "${plan.run.shortName}"`,
      );
    }
    const shortNameResult = decodeShortName(plan.run.shortName);
    if (Either.isLeft(shortNameResult)) {
      return yield* refuse(
        2,
        `Invalid short name "${plan.run.shortName}" in plan: must match ^[a-z][a-z0-9-]*$ (1–64 chars)`,
      );
    }

    if (flags.dryRun === true) {
      const report = buildDryRunReport(
        plan,
        config,
        gateProfileId,
        priorityOverride !== undefined ? [...priorityOverride] : undefined,
        effectiveSecurityMode,
        flags.allowSkillEdits ?? false,
        holdRequest,
      );
      const answer: RunAnswer = {
        qualifiedName: report.qualifiedName,
        crossProject: false,
        outcome: { kind: "dry-run", report: dryRunReportValue(report) },
      };
      return answer;
    }

    const namespace = config.namespace;

    // Run every run-independent preflight before the run is named or any state is
    // written: a refused run must not leave a run folder, registry entry, branch
    // or telemetry file holding the slug.
    const preflightResult = yield* Effect.either(
      freshRunPreflight({
        plan,
        planMd,
        planPath: flags.plan,
        config,
        gateProfileId,
        namespace,
        allowSkillEdits: flags.allowSkillEdits ?? false,
        allowDirty: flags.allowDirty ?? false,
        hold: holdRequest,
        priorityOverride,
      }).pipe(
        Effect.provide(makeRepoRootedFileSystemLayer(config)),
        Effect.provide(makeNodeGitLayer()),
        Effect.provide(deps.shellLayer ?? NodeShellLayer),
      ),
    );
    if (Either.isLeft(preflightResult)) {
      const err = preflightResult.left;
      if (err instanceof SkillEditConsentError || err instanceof SkillEditProtectedError) {
        return yield* refuse(exitCodeForError(err), err.message);
      }
      if (err instanceof ConfigValidationError) {
        return yield* refuse(2, `Failed to load routing config: ${err.message}`);
      }
      return yield* refuse(exitCodeForError(err), `phax run failed: ${err.message}`);
    }
    const { routing, providerConfig, hold } = preflightResult.right;

    // The slug may already name an existing run (in this namespace); bump it so
    // we never clobber a prior run. Uniqueness is scoped to the namespace via the
    // registry (covering archived runs), plus a bare-folder check for the interim.
    const shortName = ensureUniqueShortName(config.stateRoot, namespace, shortNameResult.right);
    const runPlan: PhaxPlan =
      shortName === shortNameResult.right
        ? plan
        : { ...plan, run: { ...plan.run, shortName, branch: `phax/${shortName}` } };
    if (shortName !== shortNameResult.right) {
      yield* call.progress(
        `Run "${runKey(namespace, shortNameResult.right)}" already exists; using "${runKey(namespace, shortName)}" instead.`,
      );
    }
    const qualifiedName = runKey(namespace, shortName);
    yield* call.say(`Run: ${qualifiedName}`);

    const runFolder = join(config.stateRoot, "runs", qualifiedName);
    const telemetryLayer = telemetryEnabled
      ? buildSystemTelemetryLayer(
          telemetryOptions,
          join(runFolder, "semantic.jsonl"),
          out,
          shortName as unknown as RunId,
        )
      : NoopSystemTelemetryLayer;

    setRunInterruptContext(shortName, namespace, config.stateRoot);
    const program = withRunLock(
      qualifiedName,
      createRunFolder(
        shortName,
        planMd,
        runPlan,
        config,
        planRepoRel,
        flags.allowSkillEdits ?? false,
        hold,
      ).pipe(
        Effect.flatMap(({ runPath, runId }) =>
          Effect.flatMap(readBundledReviewSkillForRun(config, out), (bundledReviewSkill) =>
            executePlan({
              bundledReviewSkill,
              shortName,
              namespace,
              plan: runPlan,
              planMd,
              config,
              gateProfileId,
              allowDirty: flags.allowDirty ?? false,
              runPath,
              runId,
              startIndex: 0,
              phaxVersion: readPackageVersion(),
              routing,
              providerConfig,
              securityMode: effectiveSecurityMode,
              allowSkillEdits: flags.allowSkillEdits ?? false,
              verbose: call.verbose,
              planRepoRelPath: planRepoRel,
            }),
          ),
        ),
      ),
    );
    const result = yield* Effect.either(
      provideRunLayers(program, config, telemetryLayer, providerConfig, deps),
    ).pipe(Effect.ensuring(Effect.sync(clearRunInterruptContext)));

    if (Either.isLeft(result)) {
      const { cause: err, followUps } = splitFollowUps(result.left);
      if (err instanceof AwaitingReviewStopError) {
        const answer: RunAnswer = {
          qualifiedName,
          crossProject: false,
          outcome: stoppedOutcome(err),
        };
        return answer;
      }
      const pause = pauseOf(err, {
        qualifiedName,
        shortName,
        runFolder,
        providerPriority: flags.providerPriority ?? null,
        limitVerb: "paused",
      });
      if (pause !== null) {
        const answer: RunAnswer = { qualifiedName, crossProject: false, outcome: pause };
        return answer;
      }
      // A failure outside a pause (a stop's close, for one) keeps the
      // invoked command as its retry hint.
      return yield* Effect.fail(
        runErrorOf(
          err,
          failureLines(
            err,
            followUps,
            "phax run failed",
            runRetryCommand(call.shortNameArg, flags),
          ),
          shortName,
        ),
      );
    }

    const execResult = result.right;
    const answer: RunAnswer = {
      qualifiedName,
      crossProject: false,
      outcome: {
        kind: "review_open",
        phaseCount: execResult.completedPhaseCount,
        pullRequest: execResult.prUrl ?? null,
        completions: completionsValue(execResult.artifactCompletions),
        finalReport: join(runFolder, "final-report.md"),
      },
    };
    return answer;
  });
}

const RUN_HELP =
  'Extracts a plan from the plan.md given by --plan, creates a run entry in the registry, and executes each phase sequentially in its own Git worktree using the configured AI agent. Each phase runs its gate profile\'s every-phase steps after execution; the final phase also runs the profile\'s terminal steps. Each step\'s surface (local, structural, or product) is recorded per phase and the run\'s verified surfaces are reported at run end.\n\nA gate step with "output": "gate-report" is judged from the gate report it prints on stdout, saved as checks-attempt-NN.report-SS.json beside the attempt\'s log: a checked report with any finding fails the step whatever the exit code, and one with no finding passes it on exit 0; the fix prompt lists each finding with its rule, location, message, related locations and guide. A refused report stops the phase without a fix attempt and exits 4, naming the step, the reason and the remedy; the phase pauses as on gates_exhausted and phax resume runs the gate again with the full fix budget. Anything else is a broken step that gets the raw-log fix prompt. Review notes in a checked report fail nothing and go to the review handoff\'s Review notes section, never to the agent.\n\nAcceptance step: at the gate of an acceptance phase and of the phase that passes it, after every configured step passed, phax runs the acceptance provider (phax.json "acceptance": { "command" }). The command is split on whitespace and run without a shell, in the phase worktree before the commit, under a 120 s limit. It reads one acceptance-request on stdin, {$schema, verdict, phase, acceptancePhase, base, files}, where verdict is "authored" for the acceptance phase and "passed" for the passing phase, which also carries acceptanceCommit; phax saves it as checks-attempt-NN.acceptance-request.json beside the attempt\'s log. The provider prints a gate report on stdout, judged as a report step and saved as report-SS: findings go to the fix loop, a refused report stops the phase and exits 4, and a provider that cannot be spawned, times out or prints nothing usable fails the step. The step is recorded under the acceptance surface. A passing phase whose acceptance phase was skipped (it produced no changes, so it noted no commit) is refused before its agent runs, with exit 11, and the run fails. A committed acceptance phase is not reset. An acceptance step that exhausts the fix loop or refuses pauses the run with exit 4, and the next steps name both phax resume <run> and the --skip-acceptance correction for a wrong acceptance test.\n\nExtraction results are cached by content hash under ~/.phax/cache/plans/; a repeated run of the same plan.md reuses the cached extraction without calling the LLM again. Use --refresh to force a fresh extraction.\n\nThe start preflight also holds every phase to the owner\'s assignment bounds (phax.json "assignments"): a bound that names an unknown model or effort, or a phase that departs from its governing bound without an **Assignment reason:** line, refuses before the run is named, with exit 11 and "Assignment preflight failed". A part bound makes the preflight run the architecture provider.\n\nThe preflight also checks the plan\'s acceptance phases: a malformed declaration, a broken pair, or an acceptance phase with no "acceptance" provider configured refuses before the run is named, with exit 11 and "Acceptance preflight failed". The provider is never spawned by the preflight.\n\nA phase the plan declares interactive (`**Mode:** interactive`) stops the run. phax sets the phase up like any phase, writes the seed into .phax-context/ and runs one read-only first turn, then leaves the run in awaiting_review, writes review-stop.json in the run folder and exits 13 without waiting for input. The output names the worktree, the command that continues the agent session (or starts a fresh one) and phax resume. The person works in the worktree with any editor or agent; phax resume closes the stop.\n\n--hold [selection] stops the run for review at headless phases too: no value holds every headless phase but the final one, `--hold acceptance` the plan\'s acceptance phases, and `--hold phase-02,phase-04` the phases listed (exactly `phase-NN`, no repeats). A malformed value exits 1 before the run is named, and a selection the plan cannot honour (an unknown, interactive or final phase) exits 11 with "Hold preflight failed". A held phase does its work, passes its gate, commits and validates its handoff, then stops in awaiting_review before its record and its cleanup, with no agent turn, and exits 13. The hold is recorded with the run: phax resume takes no --hold and holds exactly those phases. A bare --hold takes the next word as its value, so put the run name before it or write --hold=<selection>. With --dry-run, the hold is resolved and printed as one line, `Hold: none` or `Hold: listed — phase-02, phase-04`, with any hold preflight errors under it; the dry run still exits 0 and names no run. A hold may stop inside an acceptance pair: see phax resume. Transcripts are not part of this release.\n\nA gate attempt fails when the phase changed a path listed in phax.json "protectedPaths", or the phax.json phax loaded: the fix loop is told which paths to put back, and a phase that does not pauses as on gates_exhausted. The same check runs before a commit-only resume commits, after the handoff turn, and when a held phase is re-entered; a stop\'s close is not checked. A skill edit grant (--allow-skill-edits) on a protected path is refused before the run is named, with exit 11.\n\nSide effects: creates worktrees, commits files, writes to ~/.phax/runs/.';

export function makeRunCommand(deps: RunDeps = {}) {
  return defineCommand({
    name: "run",
    summary: "Extract a plan from plan.md and run all phases, or preview with --dry-run",
    help: RUN_HELP,
    examples: [
      "phax run --plan plan.md",
      "phax run my-feature --plan plan.md",
      "phax run --plan plan.md --dry-run",
      "phax run --plan plan.md --refresh",
    ],
    input: {
      args: reject(Schema.Tuple(Schema.optionalElement(ShortNameArg))),
      flags: RunFlags,
    },
    output: reject(RunAnswer),
    run: ({ input, program, say, progress }) =>
      runRunCommand(
        {
          shortNameArg: input.args[0],
          flags: input.flags,
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
    render: renderOutcome(true),
    notes: outcomeNotes,
  });
}

export const runCommand = makeRunCommand();
