// What `phax run` and `phax resume` answer on the runner, and what they share. The answer is
// `{ qualifiedName, crossProject, outcome }`, the outcome tagged by `kind`: a dry run (run only),
// a preview (resume without --yes), a run already in review (resume), a run that reached review,
// a stop (13) and a pause, whose code a verdict reads from it (q-run-pauses: pause-verdicts). The
// render writes today's stdout lines of each outcome and the notes today's stderr lines, so that
// without --json every line stays on today's stream. A failure before the run starts or outside a
// pause is a declared error, one tag per exit code, its text today's lines; a held run lock is a
// `LockConflictError` whose fields are exactly the run's short name and the holder's pid.
import { join } from "node:path";
import { Data, Effect } from "effect";
import * as Schema from "effect/Schema";
import { formatDryRunReport, type DryRunReport } from "../../app/dryRun.js";
import type { RunCompletionReport } from "../../app/completeRunArtifacts.js";
import {
  AgentInvocationError,
  type AwaitingReviewStopError,
  GateAttemptsExhaustedError,
  GateStepRefusedError,
  LockConflictError as DomainLockConflictError,
  PhaseHadNoChangesError,
  RateLimitError,
  type StopCloseRefusedError,
  type StopReport,
  UsageLimitError,
} from "../../domain/errors.js";
import { buildWhatsNext, renderWhatsNext, toKeepAwakePlatform } from "../../domain/whatsNext.js";
import type { OutputPort } from "../../ports/output.js";
import { InteractiveSessionFileSchema } from "../../schemas/interactiveSession.js";
import {
  DeclaredReviewStopFileSchema,
  HeldReviewStopFileSchema,
} from "../../schemas/reviewStop.js";
import { exitCodeForError, renderAgentInvocationError } from "../commands/runLayers.js";
import {
  isSessionFailureError,
  pausedHandoffFailure,
  pausedNetworkFailure,
  renderHandoffTurnPause,
  renderNetworkPause,
  renderSessionFailure,
  resumeRetryCommand,
} from "../commands/sessionFailureOutput.js";
import { renderStop, renderStopCloseRefusal } from "../commands/stopOutput.js";
import type { RunContext } from "../commandLibrary/contract/index.js";
import { exposeMessage } from "./shared.js";

// ── Progress ────────────────────────────────────────────────────────────────────

/** The OutputPort a run's use cases write through as the run goes: a log is said (stdout at once,
 *  a note line under --json), a warning and an error are progress (stderr at once, a note line
 *  under --json). Handed to the telemetry layer, the bundled review skill's read and the
 *  stop-closed callback. */
export function outputPortOf(context: Pick<RunContext<never>, "say" | "progress">): OutputPort {
  return {
    log: (text) => Effect.runSync(context.say(text)),
    warn: (text) => Effect.runSync(context.progress(text)),
    error: (text) => Effect.runSync(context.progress(text)),
  };
}

// ── The outcome ─────────────────────────────────────────────────────────────────

const DryRunReportSchema = Schema.Struct({
  shortName: Schema.String,
  qualifiedName: Schema.String,
  branch: Schema.String,
  projectName: Schema.String,
  stateRoot: Schema.String,
  gateProfileId: Schema.String,
  securityMode: Schema.Literal("secure", "unsafe", "isolated"),
  setupCommands: Schema.Array(Schema.String),
  cleanupCommands: Schema.Array(Schema.String),
  gateCommands: Schema.Array(Schema.String),
  agentCommands: Schema.Array(Schema.String),
  partialPrefixes: Schema.Array(Schema.String),
  requiredCommands: Schema.Array(Schema.String),
  uncoveredRequiredCommands: Schema.Array(Schema.String),
  phases: Schema.Array(
    Schema.Struct({
      index: Schema.Number,
      id: Schema.String,
      title: Schema.String,
      model: Schema.String,
      effort: Schema.String,
      worktreePath: Schema.String,
      skillEditGrants: Schema.Array(Schema.String),
    }),
  ),
  skillEditConsentMissing: Schema.Boolean,
  runPath: Schema.String,
  providerPriorityOverride: Schema.NullOr(Schema.Array(Schema.String)),
  holdLine: Schema.String,
  holdFindings: Schema.Array(
    Schema.Struct({ phase: Schema.NullOr(Schema.String), message: Schema.String }),
  ),
});

type DryRunReportValue = typeof DryRunReportSchema.Type;

/** The dry-run report as the answer carries it: every key present, null for no override. */
export function dryRunReportValue(report: DryRunReport): DryRunReportValue {
  return {
    shortName: report.shortName,
    qualifiedName: report.qualifiedName,
    branch: report.branch,
    projectName: report.projectName,
    stateRoot: report.stateRoot,
    gateProfileId: report.gateProfileId,
    securityMode: report.securityMode,
    setupCommands: report.setupCommands,
    cleanupCommands: report.cleanupCommands,
    gateCommands: report.gateCommands,
    agentCommands: report.agentCommands,
    partialPrefixes: report.partialPrefixes,
    requiredCommands: report.requiredCommands,
    uncoveredRequiredCommands: report.uncoveredRequiredCommands,
    phases: report.phases.map((phase) => ({
      index: phase.index,
      id: phase.id,
      title: phase.title,
      model: phase.model,
      effort: phase.effort,
      worktreePath: phase.worktreePath,
      skillEditGrants: phase.skillEditGrants,
    })),
    skillEditConsentMissing: report.skillEditConsentMissing,
    runPath: report.runPath,
    providerPriorityOverride: report.providerPriorityOverride ?? null,
    holdLine: report.holdLine,
    holdFindings: report.holdFindings.map((finding) => ({
      phase: finding.phase,
      message: finding.message,
    })),
  };
}

function dryRunReportOf(value: DryRunReportValue): DryRunReport {
  const { providerPriorityOverride, ...rest } = value;
  return providerPriorityOverride === null ? rest : { ...rest, providerPriorityOverride };
}

const CompletionsSchema = Schema.Struct({
  transitions: Schema.Array(
    Schema.Struct({
      kind: Schema.Literal("plan", "spec"),
      path: Schema.String,
      commit: Schema.NullOr(Schema.Struct({ hash: Schema.String, subject: Schema.String })),
      alreadyComplete: Schema.Boolean,
    }),
  ),
  keptSpec: Schema.NullOr(
    Schema.Union(
      Schema.Struct({
        reason: Schema.Literal("blocked"),
        path: Schema.String,
        blockedBy: Schema.Array(Schema.Struct({ path: Schema.String, status: Schema.String })),
      }),
      Schema.Struct({ reason: Schema.Literal("not-completing"), path: Schema.String }),
    ),
  ),
});

type Completions = typeof CompletionsSchema.Type;

/** The run-completion report as the answer carries it: null for an absent commit or kept spec. */
export function completionsValue(report: RunCompletionReport | undefined): Completions | null {
  if (report === undefined) return null;
  const kept = report.keptSpec;
  return {
    transitions: report.transitions.map((t) => ({
      kind: t.kind,
      path: t.path,
      commit: t.commit === undefined ? null : { hash: t.commit.hash, subject: t.commit.subject },
      alreadyComplete: t.alreadyComplete,
    })),
    keptSpec:
      kept === undefined
        ? null
        : kept.reason === "blocked"
          ? {
              reason: "blocked",
              path: kept.path,
              blockedBy: kept.blockedBy.map((b) => ({ path: b.path, status: b.status })),
            }
          : { reason: "not-completing", path: kept.path },
  };
}

// Render the run-completion report (spec 27 §6) as output lines: one line per
// completed artifact carrying its short commit hash, and — when the source spec
// stayed live — a kept line: naming the blocking plans when the chain gate kept
// it, or saying the plan does not complete it (completes-spec: false). Pure
// formatting; presence of the per-artifact commit-hash lines is normative, the
// wording is not.
function renderArtifactCompletions(report: Completions): string[] {
  const lines: string[] = [];
  for (const t of report.transitions) {
    if (t.commit !== null) {
      lines.push(`✓ completed ${t.path} — ${t.commit.hash.slice(0, 7)} (on run branch)`);
    } else if (t.alreadyComplete) {
      lines.push(`✓ completed ${t.path} — already complete`);
    }
  }
  const kept = report.keptSpec;
  if (kept?.reason === "blocked") {
    lines.push(`○ spec ${kept.path} kept: non-terminal dependent plans remain`);
    for (const blocker of kept.blockedBy) {
      lines.push(`    ${blocker.path}    ${blocker.status}`);
    }
  } else if (kept?.reason === "not-completing") {
    lines.push(`○ spec ${kept.path} kept: this plan does not complete it (completes-spec: false)`);
  }
  return lines;
}

/** A review stop as the stop report carries it: the review-stop document without `$schema`. */
const { $schema: _declaredStamp, ...declaredReviewStopFields } =
  DeclaredReviewStopFileSchema.fields;
const { $schema: _heldStamp, ...heldReviewStopFields } = HeldReviewStopFileSchema.fields;

const StopReportSchema = Schema.Union(
  Schema.Struct({
    cause: Schema.Literal("declared"),
    reviewStop: Schema.Struct(declaredReviewStopFields),
    reviewStopPath: Schema.String,
    firstReading: Schema.NullOr(Schema.String),
    firstTurnProblem: Schema.NullOr(InteractiveSessionFileSchema.fields.firstTurns.value),
    unverifiedProvider: Schema.Boolean,
  }),
  Schema.Struct({
    cause: Schema.Literal("held"),
    reviewStop: Schema.Struct(heldReviewStopFields),
    reviewStopPath: Schema.String,
    phaseCommit: Schema.String,
    phaseCommitSubject: Schema.String,
    handoffPath: Schema.String,
    unverifiedProvider: Schema.Boolean,
  }),
);

/** Why a run paused: each a resumable state with its next command. */
const PauseReason = Schema.Literal(
  "limit",
  "network",
  "handoff-turn",
  "gates-exhausted",
  "gate-refused",
  "no-changes",
  "close-refused",
);

const Outcome = Schema.Union(
  Schema.Struct({ kind: Schema.Literal("dry-run"), report: DryRunReportSchema }),
  Schema.Struct({
    kind: Schema.Literal("preview"),
    fromState: Schema.String,
    nextPhaseId: Schema.String,
    nextPhaseIndex: Schema.Number,
    skippedPhaseIds: Schema.Array(Schema.String),
    owedStep: Schema.Literal("none", "handoff", "post-handoff"),
    skipAcceptance: Schema.Boolean,
  }),
  Schema.Struct({
    kind: Schema.Literal("already-in-review"),
    /** The resume's refusal, as a person reads it. */
    message: Schema.String,
    phaseCount: Schema.Number,
    pullRequest: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("review_open"),
    phaseCount: Schema.Number,
    pullRequest: Schema.NullOr(Schema.String),
    completions: Schema.NullOr(CompletionsSchema),
    finalReport: Schema.String,
  }),
  Schema.Struct({ kind: Schema.Literal("stopped"), report: StopReportSchema }),
  Schema.Struct({
    kind: Schema.Literal("paused"),
    reason: PauseReason,
    phase: Schema.NullOr(Schema.String),
    resumeCommand: Schema.String,
    resumeInstructions: Schema.NullOr(Schema.String),
    resetAt: Schema.NullOr(Schema.String),
    /** The code the call exits with: a verdict read from the pause. */
    exit: Schema.Number,
    /** The lines a person reads on stderr, today's text of the pause. */
    lines: Schema.Array(Schema.String),
  }),
);

/** What run and resume answer. */
export const RunAnswer = Schema.Struct({
  qualifiedName: Schema.String,
  crossProject: Schema.Boolean,
  outcome: Outcome,
});

export type RunAnswer = typeof RunAnswer.Type;
type Outcome = RunAnswer["outcome"];
export type PausedOutcome = Extract<Outcome, { readonly kind: "paused" }>;

/** The stop as the answer carries it. */
export function stoppedOutcome(err: AwaitingReviewStopError): Outcome {
  return { kind: "stopped", report: err.report as typeof StopReportSchema.Type };
}

// ── Render, notes, verdicts ─────────────────────────────────────────────────────

/** The run's short name: a qualified name is `<namespace>.<short-name>`, and a short name holds
 *  no dot. */
const shortNameOf = (qualifiedName: string): string =>
  qualifiedName.slice(qualifiedName.lastIndexOf(".") + 1);

/** Today's stdout lines of an outcome, each as the command logged it: the dry-run report whole,
 *  every other line one by one. `headline` writes run's `reached review` line. */
function outcomeSections(value: RunAnswer, headline: boolean): ReadonlyArray<string> {
  const { outcome } = value;
  switch (outcome.kind) {
    case "dry-run":
      return [formatDryRunReport(dryRunReportOf(outcome.report))];
    case "review_open":
      return [
        ...(headline
          ? [
              `Run "${value.qualifiedName}" reached review — ${outcome.phaseCount} phase(s) complete.`,
            ]
          : []),
        ...(outcome.completions === null ? [] : renderArtifactCompletions(outcome.completions)),
        `See ${outcome.finalReport} for details.`,
      ];
    case "stopped":
      return renderStop(outcome.report as StopReport);
    case "preview":
    case "already-in-review":
    case "paused":
      return [];
  }
}

/** The render of run (`headline`) or resume: today's stdout lines, empty when there are none. */
export function renderOutcome(headline: boolean): (value: RunAnswer) => string {
  return (value) => outcomeSections(value, headline).join("\n");
}

const reviewOpenNext = (value: RunAnswer, phaseCount: number, prUrl: string | null): string =>
  renderWhatsNext(
    buildWhatsNext(
      {
        kind: "review_open",
        shortName: shortNameOf(value.qualifiedName),
        prUrl: prUrl ?? undefined,
        phaseCount,
      },
      new Date(),
    ),
  );

/** Today's stderr lines of an outcome: the what's-next of a run in review, the refusal of one
 *  already there, a pause's lines. */
export function outcomeNotes(value: RunAnswer): string {
  const { outcome } = value;
  switch (outcome.kind) {
    case "review_open":
      return reviewOpenNext(value, outcome.phaseCount, outcome.pullRequest);
    case "already-in-review":
      return [outcome.message, reviewOpenNext(value, outcome.phaseCount, outcome.pullRequest)].join(
        "\n",
      );
    case "paused":
      return outcome.lines.join("\n");
    case "dry-run":
    case "preview":
    case "stopped":
      return "";
  }
}

const pausedWith =
  (code: number) =>
  (value: RunAnswer): boolean =>
    value.outcome.kind === "paused" && value.outcome.exit === code;

/** The codes run and resume answer with: a stop's 13, and each pause's own. */
export const runVerdicts = {
  1: pausedWith(1),
  4: pausedWith(4),
  5: pausedWith(5),
  8: pausedWith(8),
  9: pausedWith(9),
  13: (value: RunAnswer): boolean => value.outcome.kind === "stopped",
  14: pausedWith(14),
} as const;

// ── Pauses ──────────────────────────────────────────────────────────────────────

interface PauseContext {
  readonly qualifiedName: string;
  readonly shortName: string;
  /** The run folder: resume-instructions.md is written there. */
  readonly runFolder: string;
  readonly providerPriority: string | null;
  /** `paused again` on resume, `paused` on run. */
  readonly limitVerb: string;
}

function paused(
  err: unknown,
  ctx: PauseContext,
  fields: {
    readonly reason: PausedOutcome["reason"];
    readonly phase: string | undefined;
    readonly resetAt: string | null;
    readonly resumeInstructions: string | null;
    readonly resumeCommand?: string;
    readonly lines: ReadonlyArray<string>;
  },
): PausedOutcome {
  return {
    kind: "paused",
    reason: fields.reason,
    phase: fields.phase ?? null,
    resumeCommand: fields.resumeCommand ?? resumeRetryCommand(ctx.shortName, ctx.providerPriority),
    resumeInstructions: fields.resumeInstructions,
    resetAt: fields.resetAt,
    exit: exitCodeForError(err),
    lines: [...fields.lines],
  };
}

/** The pause a run's failure is, with today's stderr lines, or null for a failure that is not one. */
export function pauseOf(err: unknown, ctx: PauseContext): PausedOutcome | null {
  const instructions = join(ctx.runFolder, "resume-instructions.md");
  const see = `See ${instructions} for details.`;
  if (err instanceof RateLimitError || err instanceof UsageLimitError) {
    return paused(err, ctx, {
      reason: "limit",
      phase: err.phaseId,
      resetAt: err.resetAt ?? null,
      resumeInstructions: instructions,
      lines: [
        `Run "${ctx.qualifiedName}" ${ctx.limitVerb}: ${err.message}`,
        renderWhatsNext(
          buildWhatsNext(
            {
              kind: "limit",
              shortName: ctx.shortName,
              resetAt: err.resetAt,
              phaseId: err.phaseId,
              platform: toKeepAwakePlatform(process.platform),
            },
            new Date(),
          ),
        ),
        see,
        ...renderSessionFailure(err, null).slice(1),
      ],
    });
  }
  const networkPause = pausedNetworkFailure(err);
  if (networkPause !== null) {
    return paused(err, ctx, {
      reason: "network",
      phase: networkPause.phaseId,
      resetAt: null,
      resumeInstructions: instructions,
      lines: renderNetworkPause(networkPause, ctx.shortName, instructions, ctx.providerPriority),
    });
  }
  const handoffTurn = pausedHandoffFailure(err);
  if (handoffTurn !== null) {
    return paused(err, ctx, {
      reason: "handoff-turn",
      phase: handoffTurn.phaseId,
      resetAt: null,
      resumeInstructions: null,
      lines: renderHandoffTurnPause(handoffTurn, ctx.shortName, ctx.providerPriority),
    });
  }
  if (err instanceof GateAttemptsExhaustedError) {
    return paused(err, ctx, {
      reason: "gates-exhausted",
      phase: err.phaseId,
      resetAt: null,
      resumeInstructions: instructions,
      lines: [
        `Run "${ctx.qualifiedName}" gates exhausted: ${err.message}`,
        renderWhatsNext(
          buildWhatsNext(
            {
              kind: "gates_exhausted",
              shortName: ctx.shortName,
              phaseId: err.phaseId,
              failedStep: err.failure.failedStep,
              protectedChanges: err.failure.protectedChanges,
              lastFixTranscript: err.lastFixTranscript,
            },
            new Date(),
          ),
        ),
        see,
      ],
    });
  }
  if (err instanceof GateStepRefusedError) {
    return paused(err, ctx, {
      reason: "gate-refused",
      phase: err.phaseId,
      resetAt: null,
      resumeInstructions: instructions,
      lines: [
        `Run "${ctx.qualifiedName}" paused: a gate step refused to run.`,
        renderWhatsNext(
          buildWhatsNext(
            {
              kind: "gate_refused",
              shortName: ctx.shortName,
              phaseId: err.phaseId,
              failedStep: err.failedStep,
              protectedChanges: err.protectedChanges,
              command: err.command,
              reason: err.reason,
              remedy: err.remedy,
            },
            new Date(),
          ),
        ),
        see,
      ],
    });
  }
  if (err instanceof PhaseHadNoChangesError) {
    return paused(err, ctx, {
      reason: "no-changes",
      phase: err.phaseId,
      resetAt: null,
      resumeInstructions: instructions,
      lines: [
        `Run "${ctx.qualifiedName}" paused: phase ${err.phaseId} produced no changes.`,
        renderWhatsNext(
          buildWhatsNext(
            { kind: "phase_no_changes", shortName: ctx.shortName, phaseId: err.phaseId },
            new Date(),
          ),
        ),
        see,
      ],
    });
  }
  return null;
}

/** A refused close of a stop, on resume: the stop stays awaiting review, with the retry. */
export function closeRefusedPause(
  err: StopCloseRefusedError,
  ctx: PauseContext,
  retry: string,
): PausedOutcome {
  const instructions = join(ctx.runFolder, "resume-instructions.md");
  const lastClose = err.lastClose;
  return paused(err, ctx, {
    reason: "close-refused",
    phase: err.phase,
    resetAt: lastClose.result === "limit" ? lastClose.resetAt : null,
    resumeInstructions: instructions,
    resumeCommand: retry,
    lines: [...renderStopCloseRefusal(err, retry), `See ${instructions} for details.`],
  });
}

// ── Errors ──────────────────────────────────────────────────────────────────────

/** The fields of a run error: its text, the lines a person reads on stderr. */
interface RunErrorFields {
  readonly message: string;
}

/** Exit 1: a refusal, or a failure no other code names. */
class RunFailedError extends Data.TaggedError("RunFailedError")<RunErrorFields> {}
/** Exit 2: the configuration, the plan or a flag's value is invalid. */
class RunInvalidError extends Data.TaggedError("RunInvalidError")<RunErrorFields> {}
/** Exit 3: the git state is unsafe. */
class UnsafeGitStateError extends Data.TaggedError("UnsafeGitStateError")<RunErrorFields> {}
/** Exit 4: a gate failed outside a pause. */
class GateFailedError extends Data.TaggedError("GateFailedError")<RunErrorFields> {}
/** Exit 5: an agent invocation or session failed. */
class AgentFailedError extends Data.TaggedError("AgentFailedError")<RunErrorFields> {}
/** Exit 6: a dirty worktree blocked an archive. */
class ArchiveBlockedError extends Data.TaggedError("ArchiveBlockedError")<RunErrorFields> {}
/** Exit 7: another process holds the run's lock. Its fields are the run's short name and the
 *  holder's pid; its text is the message. */
class LockConflictError extends Data.TaggedError("LockConflictError")<{
  readonly message: string;
  readonly run: string;
  readonly pid: number;
}> {}
/** Exit 8: a provider rate or usage limit outside a pause (plan extraction). */
class ProviderLimitError extends Data.TaggedError("ProviderLimitError")<RunErrorFields> {}
/** Exit 9: a phase produced no changes outside a pause. */
class PhaseNoChangesError extends Data.TaggedError("PhaseNoChangesError")<RunErrorFields> {}
/** Exit 10: the registry is corrupt. */
class RegistryCorruptionError extends Data.TaggedError("RegistryCorruptionError")<RunErrorFields> {}
/** Exit 11: a security or preflight refusal. */
class PreflightRefusedError extends Data.TaggedError("PreflightRefusedError")<RunErrorFields> {}
/** Exit 12: the plan's lifecycle status or staleness refuses the run. */
class ArtifactRefusedError extends Data.TaggedError("ArtifactRefusedError")<RunErrorFields> {}
/** Exit 14: the provider was unreachable outside a pause. */
class ProviderUnreachableError extends Data.TaggedError(
  "ProviderUnreachableError",
)<RunErrorFields> {}

export type RunCommandError =
  | RunFailedError
  | RunInvalidError
  | UnsafeGitStateError
  | GateFailedError
  | AgentFailedError
  | ArchiveBlockedError
  | LockConflictError
  | ProviderLimitError
  | PhaseNoChangesError
  | RegistryCorruptionError
  | PreflightRefusedError
  | ArtifactRefusedError
  | ProviderUnreachableError;

/** The error for an exit code, its text `lines` joined: one tag per code, the message among its
 *  fields. A code no tag names (none today) is the generic failure. */
export function runError(code: number, lines: string | ReadonlyArray<string>): RunCommandError {
  const message = typeof lines === "string" ? lines : lines.join("\n");
  const fields = { message };
  switch (code) {
    case 2:
      return exposeMessage(new RunInvalidError(fields));
    case 3:
      return exposeMessage(new UnsafeGitStateError(fields));
    case 4:
      return exposeMessage(new GateFailedError(fields));
    case 5:
      return exposeMessage(new AgentFailedError(fields));
    case 6:
      return exposeMessage(new ArchiveBlockedError(fields));
    case 8:
      return exposeMessage(new ProviderLimitError(fields));
    case 9:
      return exposeMessage(new PhaseNoChangesError(fields));
    case 10:
      return exposeMessage(new RegistryCorruptionError(fields));
    case 11:
      return exposeMessage(new PreflightRefusedError(fields));
    case 12:
      return exposeMessage(new ArtifactRefusedError(fields));
    case 14:
      return exposeMessage(new ProviderUnreachableError(fields));
    default:
      return exposeMessage(new RunFailedError(fields));
  }
}

/** The error of a failure whose code `exitCodeForError` gives: a held lock is the lock's error,
 *  with the run's short name and the holder's pid, any other the error for its code. */
export function runErrorOf(
  err: unknown,
  lines: string | ReadonlyArray<string>,
  shortName: string,
): RunCommandError {
  const code = exitCodeForError(err);
  if (code === 7 && err instanceof DomainLockConflictError) {
    return lockConflict(err, typeof lines === "string" ? lines : lines.join("\n"), shortName);
  }
  return runError(code, lines);
}

/** A held run lock, its text `message`: the run's short name and the holder's pid. */
function lockConflict(
  err: DomainLockConflictError,
  message: string,
  shortName: string,
): LockConflictError {
  return new LockConflictError({ message, run: shortName, pid: err.lockingPid });
}

/** The lines of a failure outside a pause, after run's or resume's `prefix` (`phax run failed`):
 *  a failed session with its retry and the warnings that ride on it, an agent invocation with its
 *  log hint, else the cause's sentence. */
export function failureLines(
  err: unknown,
  followUps: ReadonlyArray<string>,
  prefix: string,
  retry: string,
): ReadonlyArray<string> {
  if (isSessionFailureError(err)) return [...renderSessionFailure(err, retry), ...followUps];
  if (err instanceof AgentInvocationError) {
    const { message, logHint } = renderAgentInvocationError(err);
    return logHint === undefined ? [`${prefix}: ${message}`] : [`${prefix}: ${message}`, logHint];
  }
  return [`${prefix}: ${err instanceof Error ? err.message : String(err)}`];
}

const MessageFields = Schema.Struct({ message: Schema.String });

export const runExits = {
  RunFailedError: 1,
  RunInvalidError: 2,
  UnsafeGitStateError: 3,
  GateFailedError: 4,
  AgentFailedError: 5,
  ArchiveBlockedError: 6,
  LockConflictError: 7,
  ProviderLimitError: 8,
  PhaseNoChangesError: 9,
  RegistryCorruptionError: 10,
  PreflightRefusedError: 11,
  ArtifactRefusedError: 12,
  ProviderUnreachableError: 14,
} as const;

export const runErrors = {
  RunFailedError: MessageFields,
  RunInvalidError: MessageFields,
  UnsafeGitStateError: MessageFields,
  GateFailedError: MessageFields,
  AgentFailedError: MessageFields,
  ArchiveBlockedError: MessageFields,
  LockConflictError: Schema.Struct({ run: Schema.String, pid: Schema.Number }),
  ProviderLimitError: MessageFields,
  PhaseNoChangesError: MessageFields,
  RegistryCorruptionError: MessageFields,
  PreflightRefusedError: MessageFields,
  ArtifactRefusedError: MessageFields,
  ProviderUnreachableError: MessageFields,
} as const;

const messageText = (error: { readonly message: string }): string => error.message;

export const runTexts = {
  RunFailedError: messageText,
  RunInvalidError: messageText,
  UnsafeGitStateError: messageText,
  GateFailedError: messageText,
  AgentFailedError: messageText,
  ArchiveBlockedError: messageText,
  LockConflictError: messageText,
  ProviderLimitError: messageText,
  PhaseNoChangesError: messageText,
  RegistryCorruptionError: messageText,
  PreflightRefusedError: messageText,
  ArtifactRefusedError: messageText,
  ProviderUnreachableError: messageText,
} as const;
