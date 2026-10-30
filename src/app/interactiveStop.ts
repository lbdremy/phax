// Reaching a stop. A declared stop: the seed, phax's one read-only first turn
// and the awaiting_review transition. A held stop: the seed, the builder
// session recorded as current and the transition, with no turn. A first turn is guarded by a before/after
// comparison of the worktree and of the person's handoff file: a turn that
// changed either is refused, its versions kept aside and the worktree
// restored, so no one's edit is lost. The session id always comes from the
// turn's stream. Nothing here reads stdin.
import { Cause, Effect, Either, Exit } from "effect";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { PhaseId, RunId, WorktreePath } from "../domain/branded.js";
import { answerJson } from "../domain/session/structuredAnswer.js";
import {
  InvalidTransitionError,
  RateLimitError,
  UsageLimitError,
  type DeclaredStopReport,
  type FirstTurnProblem,
  type HeldStopReport,
  type RegistryCorruptionError,
  type SetupCommandFailedError,
} from "../domain/errors.js";
import { renderFirstReading } from "../domain/interactive/firstReading.js";
import {
  buildDeclaredReviewStop,
  buildHeldReviewStop,
  declaredSessionOrigin,
} from "../domain/interactive/reviewStop.js";
import { buildDeclaredSeed, buildHeldSeed } from "../domain/interactive/seed.js";
import {
  correctivePrompt,
  firstTurnPrompt,
  freshStartPrompt,
} from "../domain/interactive/turnPrompts.js";
import {
  PERSON_HANDOFF_PATH,
  worktreeChangeVerdict,
} from "../domain/interactive/worktreeChange.js";
import type { ProviderId } from "../domain/routing/types.js";
import type { SecurityPolicy } from "../domain/security/types.js";
import type { PhaxState } from "../domain/state.js";
import { getSessionAdapter } from "../domain/session/index.js";
import { codexModelId } from "../domain/session/codexFlags.js";
import type {
  InteractiveResumeSupport,
  StopCommand,
  StopCommandResult,
} from "../domain/session/types.js";
import { Backend, type AgentRunOptions, type AgentRunResult } from "../ports/backend.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { Git, type GitError } from "../ports/git.js";
import type { Shell, ShellError } from "../ports/shell.js";
import type { SystemTelemetry } from "../ports/systemTelemetry.js";
import { answerJsonSchema } from "../schemas/answerSchemas.js";
import type { FirstReading } from "../schemas/firstReading.js";
import type { InteractiveSession } from "../schemas/interactiveSession.js";
import {
  currentSchemaUrl,
  describeReportError,
  readFirstReadingAnswer,
} from "../schemas/persisted.js";
import type { PhaxPlanPhase } from "../schemas/phaxPlan.js";
import type { ProviderConfig } from "../schemas/providerConfig.js";
import type { ReviewStop, ReviewStopCommand } from "../schemas/reviewStop.js";
import { withInvocationCost } from "./costLedger.js";
import { dispatch } from "./dispatcher.js";
import {
  dropPersonHandoffCopy,
  fingerprintPersonHandoff,
  keepPersonHandoffCopy,
  keepRefusedTurn,
  readExecutedHandoffs,
  readInteractiveSession,
  restorePersonHandoff,
  restoreWorktreeSeed,
  reviewStopPaths,
  seedPaths,
  SEED_WORKTREE_PATH,
  writeFirstReading,
  writeInteractiveSession,
  writeSeed,
  type SeedPaths,
} from "./interactiveFiles.js";
import { computeRecordUsage } from "./recordPlumbing.js";
import { tracedStep, tracedTurnCall } from "./telemetry/stopTelemetry.js";

type Origin = "first-turn" | "new-session";
type FirstTurnRecord = InteractiveSession["firstTurns"][number];
type TurnInProgress = NonNullable<InteractiveSession["turnInProgress"]>;
type FirstTurnInProgress = Extract<TurnInProgress, { readonly kind: "first-turn" }>;
type FailureReason = Extract<FirstTurnRecord, { outcome: "failed" }>["reason"];

export interface FirstTurnInput {
  readonly runId: RunId;
  readonly runPath: string;
  readonly phaseFolder: string;
  readonly worktree: string;
  readonly phase: Pick<PhaxPlanPhase, "id">;
  readonly provider: ProviderId;
  readonly model: string;
  readonly effort: string;
  /** The phase's policy. Every provider's turns run read-only, so none applies it. */
  readonly policy: SecurityPolicy;
  readonly origin: Origin;
}

export interface FirstTurnResult {
  /** The interactive-session document as written, `turnInProgress` null. */
  readonly session: InteractiveSession;
  /** This turn's record. */
  readonly turn: FirstTurnRecord;
  /** first-reading.md when this turn answered, else null. */
  readonly firstReading: { readonly markdown: string; readonly path: string } | null;
}

// What the provider part of a turn came to, before the worktree is compared.
type TurnAttempt =
  | { readonly kind: "answered"; readonly sessionId: string; readonly reading: FirstReading }
  | {
      readonly kind: "failed";
      readonly reason: FailureReason;
      readonly detail: string;
      readonly resetAt: string | null;
    };

const FIRST_TURN_STREAM = /^first-turn-(\d{2})\.jsonl$/;

const now = (): string => new Date().toISOString();

const turnLabel = (turn: number): string => `first-turn-${String(turn).padStart(2, "0")}`;

const firstReadingSchemaJson = (): string =>
  JSON.stringify(answerJsonSchema("first-reading"), null, 2);

function emptySession(input: FirstTurnInput): InteractiveSession {
  return {
    phaseId: input.phase.id,
    provider: input.provider,
    interactiveResume: getSessionAdapter(input.provider).interactiveResume,
    current: null,
    history: [],
    firstTurns: [],
    turnInProgress: null,
    transcripts: null,
    builderUsage: null,
  };
}

// A provider error, a limit or a stream with no session: the turn failed.
function failedAttempt(error: unknown): TurnAttempt {
  if (error instanceof RateLimitError || error instanceof UsageLimitError) {
    return {
      kind: "failed",
      reason: error instanceof UsageLimitError ? "usage-limit" : "rate-limit",
      detail: error.message,
      resetAt: error.resetAt ?? null,
    };
  }
  const message = error instanceof Error && error.message.length > 0 ? error.message : "";
  return {
    kind: "failed",
    reason: "provider-error",
    detail: message.length > 0 ? message : String(error) || "the provider failed",
    resetAt: null,
  };
}

function decodeAnswer(result: AgentRunResult): Either.Either<FirstReading, string> {
  return Either.flatMap(answerJson(result), (parsed) =>
    Either.match(readFirstReadingAnswer(parsed), {
      onLeft: (error) => Either.left(describeReportError(error)),
      onRight: ({ $schema: _schema, ...reading }) => Either.right(reading),
    }),
  );
}

// The provider part: one run, and one corrective resume of an invalid answer.
// Every provider failure becomes a failed attempt, so only a defect or an
// interruption leaves this effect unsucceeded.
function attemptTurn(
  input: FirstTurnInput,
  turn: number,
): Effect.Effect<TurnAttempt, never, Backend | FileSystem | SystemTelemetry> {
  return Effect.gen(function* () {
    const backend = yield* Backend;
    const label = turnLabel(turn);
    // No `phaseFolderPath`: an interactive phase keeps no claudeSessionId in
    // its status, so the provider must not patch it. No agent commands
    // (q-turn-shell, no-shell): a Claude turn keeps its reading tools only.
    const options = (stream: string): AgentRunOptions => ({
      provider: input.provider,
      model: input.model,
      effort: input.effort,
      cwd: input.worktree,
      security: input.policy,
      agentCommands: [],
      readOnly: true,
      answerSchema: { call: "first-turn", schema: answerJsonSchema("first-reading") },
      outputJsonlPath: join(input.phaseFolder, stream),
    });
    const costed = (
      run: Effect.Effect<AgentRunResult, unknown, Backend>,
      stream: string,
      operation: "agent.run" | "agent.resume",
    ) =>
      tracedTurnCall(
        { runId: input.runId, phaseId: input.phase.id, provider: input.provider, operation },
        withInvocationCost(run, {
          role: "first-turn",
          phase: input.phase.id,
          runId: input.runId,
          runPath: input.runPath,
          provider: input.provider,
          streamPath: join(input.phaseFolder, stream),
        }),
      );

    const firstStream = `${label}.jsonl`;
    const first = yield* Effect.either(
      costed(
        backend.runAgent(
          firstTurnPrompt({
            seedPath: SEED_WORKTREE_PATH,
            schemaJson: firstReadingSchemaJson(),
            schemaUrl: currentSchemaUrl("first-reading"),
          }),
          options(firstStream),
        ),
        firstStream,
        "agent.run",
      ),
    );
    if (Either.isLeft(first)) return failedAttempt(first.left);
    const answer = decodeAnswer(first.right);
    if (Either.isRight(answer)) {
      return { kind: "answered", sessionId: first.right.sessionId, reading: answer.right };
    }

    const retryStream = `${label}-retry.jsonl`;
    const retry = yield* Effect.either(
      costed(
        backend.resumeAgentSession(
          first.right.sessionId,
          correctivePrompt(answer.left, currentSchemaUrl("first-reading")),
          options(retryStream),
        ),
        retryStream,
        "agent.resume",
      ),
    );
    if (Either.isLeft(retry)) return failedAttempt(retry.left);
    const retried = decodeAnswer(retry.right);
    if (Either.isRight(retried)) {
      return { kind: "answered", sessionId: retry.right.sessionId, reading: retried.right };
    }
    return {
      kind: "failed",
      reason: "invalid-answer",
      detail: `the first answer was refused (${answer.left}); the corrective answer was refused too (${retried.left})`,
      resetAt: null,
    };
  });
}

interface Settled {
  readonly session: InteractiveSession;
  readonly turn: FirstTurnRecord;
  readonly firstReading: { readonly markdown: string; readonly path: string } | null;
}

// Compare the worktree and the person's handoff file with how they stood
// before the turn, refuse and restore any change, record the outcome, rewrite
// the worktree's seed and clear `turnInProgress`. Runs for every turn,
// whatever its attempt came to, and for a turn a crash left in progress.
function settleTurn(
  input: FirstTurnInput,
  seeds: SeedPaths,
  base: InteractiveSession,
  inProgress: FirstTurnInProgress,
  attempt: TurnAttempt,
): Effect.Effect<Settled, FsError | GitError, FileSystem | Git> {
  return Effect.gen(function* () {
    const git = yield* Git;
    const label = turnLabel(inProgress.turn);
    const afterTree = yield* git.snapshotWorktree(input.worktree);
    const afterHandoff = yield* fingerprintPersonHandoff(input.worktree);
    const changed =
      afterTree === inProgress.beforeTree
        ? []
        : yield* git.changedPathsBetween(input.worktree, inProgress.beforeTree, afterTree);
    const verdict = worktreeChangeVerdict({
      before: inProgress.beforeTree,
      after: afterTree,
      changed,
      personHandoffBefore: inProgress.personHandoffBefore,
      personHandoffAfter: afterHandoff?.sha256 ?? null,
    });
    const endedAt = now();
    const stamp = { origin: inProgress.origin, startedAt: inProgress.startedAt, endedAt };

    let turn: FirstTurnRecord;
    let session: InteractiveSession = base;
    let firstReading: Settled["firstReading"] = null;
    if (verdict.kind === "changed") {
      const keptAt = yield* keepRefusedTurn(input.worktree, input.phaseFolder, verdict.paths);
      // The person's handoff file is never given to restorePaths: snapshots
      // leave `.phax-context/` out, so its kept copy restores it.
      yield* git.restorePaths(
        input.worktree,
        inProgress.beforeTree,
        verdict.paths.filter((p) => p !== PERSON_HANDOFF_PATH),
      );
      if (verdict.personHandoff !== "unchanged") {
        yield* restorePersonHandoff(input.worktree, input.phaseFolder, label);
      }
      const [first, ...rest] = verdict.paths;
      turn = { outcome: "refused-change", ...stamp, changedPaths: [first!, ...rest], keptAt };
    } else if (attempt.kind === "failed") {
      turn = {
        outcome: "failed",
        ...stamp,
        reason: attempt.reason,
        detail: attempt.detail,
        resetAt: attempt.resetAt,
      };
    } else {
      turn = { outcome: "answered", ...stamp, sessionId: attempt.sessionId };
      session = {
        ...session,
        current: {
          provider: input.provider,
          model: input.model,
          effort: input.effort,
          sessionId: attempt.sessionId,
          startedAt: inProgress.startedAt,
          origin: inProgress.origin,
        },
        history: session.current === null ? session.history : [...session.history, session.current],
      };
      const markdown = renderFirstReading(attempt.reading);
      firstReading = { markdown, path: yield* writeFirstReading(input.phaseFolder, markdown) };
    }

    yield* dropPersonHandoffCopy(input.phaseFolder, label);
    yield* restoreWorktreeSeed(seeds);
    session = { ...session, firstTurns: [...session.firstTurns, turn], turnInProgress: null };
    yield* writeInteractiveSession(input.phaseFolder, session);
    return { session, turn, firstReading };
  });
}

/** A closing turn's label (`closing-turn-01`): its streams' and its kept files' prefix. */
export const closingTurnLabel = (turn: number): string =>
  `closing-turn-${String(turn).padStart(2, "0")}`;

/** What settling a turn a crash or an interruption left in progress came to. */
export interface LeftoverSettlement {
  /** The interactive-session document as it now stands, null when none exists. */
  readonly session: InteractiveSession | null;
  /** The first turn settled, 0 when none was (no turn, or a closing turn). */
  readonly settledFirstTurn: number;
}

// A closing turn left in progress. Every provider's closing turn is read-only,
// so it wrote nothing and any change since is the person's and stays. Only the
// handoff copy is dropped and the seed rewritten.
function settleLeftoverClosingTurn(
  input: FirstTurnInput,
  session: InteractiveSession,
  leftOver: TurnInProgress,
): Effect.Effect<LeftoverSettlement, FsError, FileSystem> {
  return Effect.gen(function* () {
    yield* dropPersonHandoffCopy(input.phaseFolder, closingTurnLabel(leftOver.turn));
    yield* restoreWorktreeSeed(seedPaths(input.worktree, input.phaseFolder));
    const settled: InteractiveSession = { ...session, turnInProgress: null };
    yield* writeInteractiveSession(input.phaseFolder, settled);
    return { session: settled, settledFirstTurn: 0 };
  });
}

/**
 * Settle the turn interactive-session.json records in progress, if any: a
 * first turn as `refused-change` when it changed anything, else as `failed`
 * with reason `interrupted`; a closing turn with no record, its edits kept.
 * Either way the seed is rewritten and `turnInProgress` cleared.
 */
export function settleLeftoverTurn(
  input: FirstTurnInput,
): Effect.Effect<LeftoverSettlement, FsError | GitError, FileSystem | Git> {
  return Effect.gen(function* () {
    const stored = yield* readInteractiveSession(input.phaseFolder);
    const leftOver = stored?.turnInProgress ?? null;
    if (stored === null || leftOver === null) {
      return { session: stored, settledFirstTurn: 0 };
    }
    if (leftOver.kind === "closing-turn") {
      return yield* settleLeftoverClosingTurn(input, stored, leftOver);
    }
    const settled = yield* settleTurn(
      input,
      seedPaths(input.worktree, input.phaseFolder),
      stored,
      leftOver,
      {
        kind: "failed",
        reason: "interrupted",
        detail: "the turn was interrupted before it ended",
        resetAt: null,
      },
    );
    return { session: settled.session, settledFirstTurn: leftOver.turn };
  });
}

function nextTurnNumber(
  phaseFolder: string,
  settledTurn: number,
): Effect.Effect<number, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const streams = (yield* fs.list(phaseFolder)).flatMap((entry) => {
      const match = FIRST_TURN_STREAM.exec(entry);
      return match === null ? [] : [Number(match[1])];
    });
    return Math.max(settledTurn, ...streams) + 1;
  });
}

/**
 * One read-only first turn at a stop. A turn a crash left in progress is
 * settled first, as `refused-change` when it changed anything, else as
 * `failed` with reason `interrupted`. Then, in order: the person's handoff
 * file is fingerprinted and the worktree snapshotted, and the turn recorded
 * in progress; the provider runs `firstTurnPrompt` read-only to
 * `first-turn-NN.jsonl`, with one corrective resume to `-retry.jsonl` on an
 * invalid answer; the worktree is compared again. That comparison and the
 * outcome run whatever the turn did, an interruption included. An answered
 * turn becomes the current session and writes first-reading.md; a refused or
 * failed one keeps no session and leaves the previous current one.
 */
export function runFirstTurn(
  input: FirstTurnInput,
): Effect.Effect<
  FirstTurnResult,
  FsError | GitError,
  Backend | FileSystem | Git | SystemTelemetry
> {
  return Effect.gen(function* () {
    const git = yield* Git;
    const seeds = seedPaths(input.worktree, input.phaseFolder);
    const leftOver = yield* settleLeftoverTurn(input);
    const session: InteractiveSession = {
      ...(leftOver.session ?? emptySession(input)),
      provider: input.provider,
      interactiveResume: getSessionAdapter(input.provider).interactiveResume,
    };

    const turn = yield* nextTurnNumber(input.phaseFolder, leftOver.settledFirstTurn);
    const personHandoff = yield* fingerprintPersonHandoff(input.worktree);
    yield* keepPersonHandoffCopy(input.phaseFolder, turnLabel(turn), personHandoff);
    const inProgress: FirstTurnInProgress = {
      kind: "first-turn",
      turn,
      origin: input.origin,
      beforeTree: yield* git.snapshotWorktree(input.worktree),
      personHandoffBefore: personHandoff?.sha256 ?? null,
      startedAt: now(),
    };
    const before: InteractiveSession = { ...session, turnInProgress: inProgress };
    yield* writeInteractiveSession(input.phaseFolder, before);

    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const exit = yield* Effect.exit(
          restore(
            tracedStep(
              { runId: input.runId, phaseId: input.phase.id, step: "first-turn" },
              attemptTurn(input, turn),
              (attempt) => attempt.kind === "answered",
            ),
          ),
        );
        const attempt: TurnAttempt = Exit.isSuccess(exit)
          ? exit.value
          : {
              kind: "failed",
              reason: Exit.isInterrupted(exit) ? "interrupted" : "provider-error",
              detail: Exit.isInterrupted(exit)
                ? "the turn was interrupted before it ended"
                : Cause.pretty(exit.cause) || "the turn failed",
              resetAt: null,
            };
        const settled = yield* settleTurn(input, seeds, before, inProgress, attempt);
        if (Exit.isFailure(exit)) return yield* Effect.failCause(exit.cause);
        return settled;
      }),
    );
  });
}

export interface DeclaredStopInput {
  readonly runId: RunId;
  /** The run's name as phax commands take it. */
  readonly shortName: string;
  readonly runPath: string;
  /** The main checkout, where the printed phax commands run. */
  readonly mainCheckout: string;
  readonly phases: readonly PhaxPlanPhase[];
  readonly phase: PhaxPlanPhase;
  readonly phaseIndex: number;
  readonly phaseFolder: string;
  readonly worktree: string;
  readonly provider: ProviderId;
  readonly model: string;
  readonly effort: string;
  /** The provider's providers.json entry: codex's model id and vibe's model variable. */
  readonly providerEntry: ProviderConfig["providers"][string] | undefined;
  readonly policy: SecurityPolicy;
  /** The phase's frozen agent commands, which the printed commands carry. */
  readonly agentCommands: readonly string[];
  readonly gateCommands: readonly string[];
  /** Each phase's located plan.md section, keyed by phase id. */
  readonly planSections: ReadonlyMap<string, string>;
  /** The executed phases' handoffs, in plan order. */
  readonly executedHandoffs: readonly {
    readonly id: string;
    readonly title: string;
    readonly text: string;
  }[];
}

/**
 * The phase's own Detailed instructions, from its located plan section: the
 * text under `### Detailed instructions` up to the next heading of level 3
 * or above. The whole section when it has no such heading.
 */
export function detailedInstructionsOf(section: string): string {
  const lines = section.split("\n");
  const start = lines.findIndex((line) => /^###\s+Detailed instructions\s*$/i.test(line.trim()));
  if (start === -1) return section;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{1,3}\s/.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();
}

export function asReviewStopCommand(command: StopCommand): ReviewStopCommand {
  return { cwd: command.cwd, argv: [command.executable, ...command.args], env: { ...command.env } };
}

const builtCommand = (result: StopCommandResult): StopCommand | null =>
  "unsupported" in result ? null : result;

/** What the session adapters build for a stop: its continue and fresh-start commands. */
interface StopCommands {
  readonly interactiveResume: InteractiveResumeSupport;
  /** Null with no current session or on an unverified provider. */
  readonly continueCommand: ReviewStopCommand | null;
  readonly freshStart: ReviewStopCommand;
}

/**
 * The continue command (for `sessionId` on a verified provider) and the
 * fresh-start command of a stop, built by the provider's session adapter
 * under the phase's posture, its model and its effort. Shared by both causes.
 */
function buildStopCommands(input: {
  readonly phaseId: string;
  readonly worktree: string;
  readonly provider: ProviderId;
  readonly model: string;
  readonly effort: string;
  readonly providerEntry: ProviderConfig["providers"][string] | undefined;
  readonly policy: SecurityPolicy;
  readonly agentCommands: readonly string[];
  readonly sessionId: string | null;
}): Effect.Effect<StopCommands> {
  return Effect.gen(function* () {
    const adapter = getSessionAdapter(input.provider);
    const commandModel =
      input.provider === "codex-cli" && input.providerEntry !== undefined
        ? codexModelId(input.providerEntry, input.model)
        : input.model;
    const commandOpts = {
      cwd: input.worktree,
      model: commandModel,
      effort: input.effort,
      posture: { policy: input.policy, agentCommands: input.agentCommands },
    } as const;
    const continueCommand =
      input.sessionId !== null && adapter.interactiveResume === "verified"
        ? builtCommand(adapter.buildContinueCommand({ ...commandOpts, sessionId: input.sessionId }))
        : null;
    const modelEnvVar = input.providerEntry?.modelEnvVar;
    const freshStart = builtCommand(
      adapter.buildFreshStartCommand({
        ...commandOpts,
        prompt: freshStartPrompt(input.phaseId),
        ...(modelEnvVar !== undefined ? { modelEnvVar } : {}),
      }),
    );
    // A phase worktree is always a writable root, so no adapter refuses it.
    if (freshStart === null) {
      return yield* Effect.dieMessage(
        `No fresh-start command for ${input.provider} at ${input.phaseId}: its posture names no writable root`,
      );
    }
    return {
      interactiveResume: adapter.interactiveResume,
      continueCommand: continueCommand === null ? null : asReviewStopCommand(continueCommand),
      freshStart: asReviewStopCommand(freshStart),
    };
  });
}

// Reach awaiting_review through the reducer: its effects write
// review-stop.json and resume-instructions.md. Anything but Handled is an
// invalid transition, and nothing was written.
function dispatchStopReached(
  input: {
    readonly runPath: string;
    readonly shortName: string;
    readonly phaseFolder: string;
    readonly worktree: string;
    readonly phaseId: string;
  },
  reviewStop: ReviewStop,
): Effect.Effect<
  void,
  | FsError
  | GitError
  | ShellError
  | SetupCommandFailedError
  | RegistryCorruptionError
  | InvalidTransitionError,
  FileSystem | Git | Shell | SystemTelemetry
> {
  return Effect.gen(function* () {
    const result = yield* dispatch(
      {
        eventId: randomUUID(),
        occurredAt: now(),
        run: input.shortName as unknown as RunId,
        phase: input.phaseId as PhaseId,
        type: "ReviewStopReached",
        phaseId: input.phaseId as PhaseId,
        cause: reviewStop.cause,
        worktreePath: input.worktree as WorktreePath,
        reviewStop,
      },
      {
        runPath: input.runPath,
        shortName: input.shortName,
        phaseFolderPath: input.phaseFolder,
        phaseId: input.phaseId,
      },
    );
    if (result.disposition !== "Handled") {
      return yield* Effect.fail(
        new InvalidTransitionError({
          from: describeState(result.stateBefore),
          to: "awaiting_review",
          entity: "run",
        }),
      );
    }
  });
}

/**
 * Stop the run at a declared interactive phase whose worktree, setup
 * commands, `.phax-context/plan.md`, model-resolution.json and security.json
 * are in place. It writes the seed's two copies, runs one read-only first
 * turn, builds the continue command (a current session on a verified
 * provider) and the fresh-start command under the phase's posture, then
 * dispatches `ReviewStopReached`, whose effects write review-stop.json and
 * resume-instructions.md. It never reads stdin. The caller fails the run with
 * `AwaitingReviewStopError` carrying the returned report.
 */
export function stopAtDeclaredPhase(
  input: DeclaredStopInput,
): Effect.Effect<
  DeclaredStopReport,
  | FsError
  | GitError
  | ShellError
  | SetupCommandFailedError
  | RegistryCorruptionError
  | InvalidTransitionError,
  Backend | FileSystem | Git | Shell | SystemTelemetry
> {
  return Effect.gen(function* () {
    const { phase, phases, phaseIndex } = input;
    const closeCommand = `phax resume ${input.shortName}`;
    const sectionOf = (id: string): string => input.planSections.get(id) ?? "";

    const seeds = seedPaths(input.worktree, input.phaseFolder);
    yield* writeSeed(
      seeds,
      buildDeclaredSeed({
        shortName: input.shortName,
        phaseId: phase.id,
        phaseTitle: phase.title,
        detailedInstructions: detailedInstructionsOf(sectionOf(phase.id)),
        executed: input.executedHandoffs,
        upcoming: phases
          .slice(phaseIndex + 1)
          .map((p) => ({ id: p.id, title: p.title, text: sectionOf(p.id) })),
        gateCommands: input.gateCommands,
        closeCommand,
      }),
    );

    const turn = yield* runFirstTurn({
      runId: input.runId,
      runPath: input.runPath,
      phaseFolder: input.phaseFolder,
      worktree: input.worktree,
      phase,
      provider: input.provider,
      model: input.model,
      effort: input.effort,
      policy: input.policy,
      origin: "first-turn",
    });

    const current = turn.session.current;
    const commands = yield* buildStopCommands({
      phaseId: phase.id,
      worktree: input.worktree,
      provider: input.provider,
      model: input.model,
      effort: input.effort,
      providerEntry: input.providerEntry,
      policy: input.policy,
      agentCommands: input.agentCommands,
      sessionId: current?.sessionId ?? null,
    });

    const reviewStop = buildDeclaredReviewStop({
      run: input.shortName,
      phase: { id: phase.id, title: phase.title, position: phaseIndex + 1, of: phases.length },
      worktree: input.worktree,
      mainCheckout: input.mainCheckout,
      seed: seeds.worktree,
      firstReading: turn.firstReading?.path ?? null,
      session:
        current === null
          ? null
          : {
              provider: current.provider,
              sessionId: current.sessionId,
              origin: declaredSessionOrigin(current.origin),
            },
      ...commands,
      lastClose: null,
    });
    yield* dispatchStopReached({ ...input, phaseId: phase.id }, reviewStop);

    const firstTurnProblem: FirstTurnProblem | null =
      turn.turn.outcome === "answered" ? null : turn.turn;
    return {
      cause: "declared",
      reviewStop,
      reviewStopPath: reviewStopPaths(input.runPath, input.phaseFolder).live,
      firstReading: turn.firstReading?.markdown ?? null,
      firstTurnProblem,
      unverifiedProvider: commands.interactiveResume === "unverified",
    };
  });
}

export interface HeldStopInput {
  readonly runId: RunId;
  /** The run's name as phax commands take it. */
  readonly shortName: string;
  readonly runPath: string;
  /** The main checkout, where the printed phax commands run. */
  readonly mainCheckout: string;
  readonly phases: readonly PhaxPlanPhase[];
  readonly phase: PhaxPlanPhase;
  readonly phaseIndex: number;
  readonly phaseFolder: string;
  readonly worktree: string;
  /** The provider, model and effort the phase ran with (its agent binding). */
  readonly provider: ProviderId;
  readonly model: string;
  readonly effort: string;
  /** The provider's providers.json entry: codex's model id and vibe's model variable. */
  readonly providerEntry: ProviderConfig["providers"][string] | undefined;
  readonly policy: SecurityPolicy;
  /** The phase's frozen agent commands, which the printed commands carry. */
  readonly agentCommands: readonly string[];
  readonly gateCommands: readonly string[];
  /** Each phase's located plan.md section, keyed by phase id. */
  readonly planSections: ReadonlyMap<string, string>;
  /** The phase's base and its commit, full shas from its status. */
  readonly base: string;
  readonly phaseCommit: string;
  /** The session that built the phase, or null when it recorded no session id. */
  readonly builder: { readonly sessionId: string; readonly startedAt: string } | null;
}

/**
 * Stop the run at a held phase that has committed and whose handoff is
 * validated and copied. It reads the phase's handoff, its file
 * reconciliation and the earlier handoffs; writes the held seed's two
 * copies; records the builder session as current (origin `builder`), or no
 * session; builds the continue and fresh-start commands under the phase's
 * posture; then dispatches `ReviewStopReached` with cause `held`, whose
 * effects write review-stop.json and resume-instructions.md. It runs no
 * agent turn and never reads stdin. The caller fails the run with
 * `AwaitingReviewStopError` carrying the returned report.
 */
export function stopAtHeldPhase(
  input: HeldStopInput,
): Effect.Effect<
  HeldStopReport,
  | FsError
  | GitError
  | ShellError
  | SetupCommandFailedError
  | RegistryCorruptionError
  | InvalidTransitionError,
  FileSystem | Git | Shell | SystemTelemetry
> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const { phase, phases, phaseIndex } = input;
    const sectionOf = (id: string): string => input.planSections.get(id) ?? "";

    const handoffPath = join(input.phaseFolder, "phase-handoff.md");
    const handoff = yield* fs.readText(handoffPath);
    const reconciliation = yield* fs.readText(join(input.phaseFolder, "file-reconciliation.md"));
    const earlier = yield* readExecutedHandoffs(input.runPath, phases, phaseIndex);

    const seeds = seedPaths(input.worktree, input.phaseFolder);
    yield* writeSeed(
      seeds,
      buildHeldSeed({
        shortName: input.shortName,
        phaseId: phase.id,
        phaseTitle: phase.title,
        planSection: sectionOf(phase.id),
        handoff,
        reconciliation,
        base: input.base,
        phaseCommit: input.phaseCommit,
        earlier,
        upcoming: phases
          .slice(phaseIndex + 1)
          .map((p) => ({ id: p.id, title: p.title, text: sectionOf(p.id) })),
        gateCommands: input.gateCommands,
        closeCommand: `phax resume ${input.shortName}`,
      }),
    );

    // The builder's usage now, from the builder's own turns (for vibe, the
    // exports of its turn, fix attempts and handoff; never a stop turn's): the
    // record written at closing uses it.
    const builderUsage = yield* computeRecordUsage({
      provider: input.provider,
      folder: input.phaseFolder,
      sessionId: input.builder?.sessionId,
    });
    const interactiveResume = getSessionAdapter(input.provider).interactiveResume;
    yield* writeInteractiveSession(input.phaseFolder, {
      phaseId: phase.id,
      provider: input.provider,
      interactiveResume,
      current:
        input.builder === null
          ? null
          : {
              provider: input.provider,
              model: input.model,
              effort: input.effort,
              sessionId: input.builder.sessionId,
              startedAt: input.builder.startedAt,
              origin: "builder",
            },
      history: [],
      firstTurns: [],
      turnInProgress: null,
      transcripts: null,
      builderUsage,
    });

    const commands = yield* buildStopCommands({
      phaseId: phase.id,
      worktree: input.worktree,
      provider: input.provider,
      model: input.model,
      effort: input.effort,
      providerEntry: input.providerEntry,
      policy: input.policy,
      agentCommands: input.agentCommands,
      sessionId: input.builder?.sessionId ?? null,
    });

    const reviewStop = buildHeldReviewStop({
      run: input.shortName,
      phase: { id: phase.id, title: phase.title, position: phaseIndex + 1, of: phases.length },
      phaseCommit: input.phaseCommit,
      worktree: input.worktree,
      mainCheckout: input.mainCheckout,
      seed: seeds.worktree,
      session:
        input.builder === null
          ? null
          : { provider: input.provider, sessionId: input.builder.sessionId, origin: "builder" },
      ...commands,
    });
    yield* dispatchStopReached({ ...input, phaseId: phase.id }, reviewStop);

    return {
      cause: "held",
      reviewStop,
      reviewStopPath: reviewStopPaths(input.runPath, input.phaseFolder).live,
      phaseCommit: input.phaseCommit,
      phaseCommitSubject: phase.commit.subject,
      handoffPath,
      unverifiedProvider: interactiveResume === "unverified",
    };
  });
}

function describeState(state: PhaxState): string {
  return "phase" in state ? `${state.run}:${state.phase.state}` : state.run;
}
