// Closing a declared interactive stop: the gate first, then the person's
// handoff file or a read-only closing turn given the corrections' content
// diff, then a commit of exactly the tree the gate passed, reconciled as
// review corrections. The close runs after `RunResumeRequested` made the run
// `running`, with the phase still `awaiting_review` and review-stop.json
// parked. It transitions only through `StopCloseRefused` and `StopCommitted`:
// every failure before the commit's state returns the run to the stop, and
// none restores or resets the person's corrections: only a closing turn's own
// edits are moved aside and put back.
import { Effect, Either, JSONSchema } from "effect";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { ClaudeSessionId, PhaseId, RunId } from "../domain/branded.js";
import { parseFinalMessageJson } from "../domain/authoring/retry.js";
import {
  GateFailedError,
  GateStepRefusedError,
  InvalidTransitionError,
  RateLimitError,
  StopCloseRefusedError,
  UsageLimitError,
  type RefusedClose,
  type RegistryCorruptionError,
  type SetupCommandFailedError,
} from "../domain/errors.js";
import { attemptLogName, nextAttemptNumber } from "../domain/gate/attemptFiles.js";
import { selectGateSteps } from "../domain/gate/selectSteps.js";
import {
  REVIEWED_WITHOUT_CHANGE_HANDOFF,
  renderInteractiveHandoff,
  validateInteractiveHandoff,
} from "../domain/interactive/handoff.js";
import {
  closingTurnPrompt,
  correctivePrompt,
  cutDiff,
  type ClosingDiff,
} from "../domain/interactive/turnPrompts.js";
import { shellQuote } from "../domain/interactive/commandLine.js";
import {
  PERSON_HANDOFF_PATH,
  worktreeChangeVerdict,
} from "../domain/interactive/worktreeChange.js";
import type { ProviderId } from "../domain/routing/types.js";
import type { SecurityPolicy } from "../domain/security/types.js";
import { getSessionAdapter } from "../domain/session/index.js";
import { Backend, type AgentRunOptions, type AgentRunResult } from "../ports/backend.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { Git, type GitError } from "../ports/git.js";
import { Shell, type ShellError } from "../ports/shell.js";
import type { SystemTelemetry } from "../ports/systemTelemetry.js";
import type { GateStepResult } from "../schemas/gateAttribution.js";
import {
  InteractiveHandoffFileSchema,
  type InteractiveHandoff,
} from "../schemas/interactiveHandoff.js";
import type { InteractiveSession } from "../schemas/interactiveSession.js";
import {
  currentSchemaUrl,
  describeReportError,
  readInteractiveHandoffAnswer,
} from "../schemas/persisted.js";
import type { GateStep } from "../schemas/phaxConfig.js";
import type { PhaxPlanPhase } from "../schemas/phaxPlan.js";
import { buildInteractiveCommitBody } from "./commit.js";
import { withInvocationCost } from "./costLedger.js";
import { dispatch, type DispatcherContext } from "./dispatcher.js";
import { runGates } from "./gates.js";
import {
  dropPersonHandoffCopy,
  fingerprintPersonHandoff,
  keepPersonHandoffCopy,
  keepRefusedTurn,
  readModelResolution,
  readPhasePosture,
  readReviewStop,
  restorePersonHandoff,
  restoreWorktreeSeed,
  rewriteReviewStopAt,
  seedPaths,
  SEED_WORKTREE_PATH,
  writeInteractiveSession,
  type PhaseModel,
} from "./interactiveFiles.js";
import {
  closingTurnLabel,
  settleLeftoverTurn,
  type FirstTurnInput,
  type LeftoverSettlement,
} from "./interactiveStop.js";
import { readPhaseBase } from "./phaseStatusUpdates.js";
import { reconcilePhaseFiles } from "./reconcilePhaseFiles.js";

export interface CloseStopInput {
  readonly runId: RunId;
  /** The run's name as phax commands take it. */
  readonly shortName: string;
  readonly runPath: string;
  readonly phase: PhaxPlanPhase;
  readonly phaseFolder: string;
  readonly worktree: string;
  /** The phase's gate profile: the close runs its non-terminal steps once, with no fix loop. */
  readonly gateSteps: readonly GateStep[];
  /**
   * The phase's serialized gate request (`serializeGateRequest`), computed as
   * part of the close's gate step: a failure there returns the run to the stop.
   */
  readonly gateRequest: Effect.Effect<string, FsError, FileSystem>;
  readonly fileReconciliationMode: "report_only" | "warn";
}

/**
 * Where the commit's handoff came from: the person's file, a closing turn
 * that resumed the current session or started a new one, the fixed handoff of
 * an unchanged stop, or (`earlier-close`) a close interrupted after its commit,
 * whose phase-handoff.md was written before that commit.
 */
export type HandoffSource =
  | "person"
  | "closing-turn-resumed"
  | "closing-turn-new"
  | "unchanged"
  | "earlier-close";

export interface CloseReport {
  readonly outcome: "corrected" | "unchanged";
  readonly commit: string;
  readonly handoffSource: HandoffSource;
  /** The closing gate attempt's log: the commit's `Gate-Log` trailer. */
  readonly gateLog: string | null;
  /** The closing gate's steps; empty for an `earlier-close`, whose gate ran before. */
  readonly gateSteps: readonly GateStepResult[];
  /** The paths the commit changed, sorted. */
  readonly changedPaths: readonly string[];
  /** A writing closing turn's edits an earlier close left in progress, restored before the gate. */
  readonly restoredClosingTurn: LeftoverSettlement["restoredClosingTurn"];
}

type CloseStep = "gate" | "commit" | "files" | "closing-turn";

type Origin = NonNullable<InteractiveSession["current"]>["origin"];

// A refusal before its instant is stamped.
type Refusal = RefusedClose extends infer T ? (T extends unknown ? Omit<T, "at"> : never) : never;

class CloseRefusal {
  readonly _tag = "CloseRefusal";
  constructor(readonly refusal: Refusal) {}
}

const now = (): string => new Date().toISOString();

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = String((error as { message: unknown }).message);
    if (message.length > 0) return message;
  }
  return String(error) || "unknown error";
}

function closeError(step: CloseStep, error: unknown): Refusal {
  const detail = messageOf(error);
  return step === "closing-turn"
    ? { result: "close-error", exitCode: 5, step, detail }
    : { result: "close-error", exitCode: 1, step, detail };
}

const refuse = (refusal: Refusal): Effect.Effect<never, CloseRefusal> =>
  Effect.fail(new CloseRefusal(refusal));

/** Run `effect` as part of the close's `step`: any failure is that step's close-error. */
function at<A, E, R>(
  step: CloseStep,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, CloseRefusal, R> {
  return Effect.mapError(effect, (error) =>
    error instanceof CloseRefusal ? error : new CloseRefusal(closeError(step, error)),
  );
}

function nonEmpty(paths: readonly string[]): readonly [string, ...string[]] {
  const [first, ...rest] = paths;
  return first === undefined ? ["(no path listed)"] : [first, ...rest];
}

const isLimit = (error: unknown): error is RateLimitError | UsageLimitError =>
  error instanceof RateLimitError || error instanceof UsageLimitError;

const limitRefusal = (error: RateLimitError | UsageLimitError): Refusal => ({
  result: "limit",
  exitCode: 8,
  resetAt: error.resetAt ?? null,
});

function describeRefusal(lastClose: RefusedClose): string {
  switch (lastClose.result) {
    case "gate-failed":
      return `the gate failed; see ${lastClose.log}`;
    case "worktree-changed":
      return `the worktree changed after the gate: ${lastClose.paths.join(", ")}`;
    case "closing-turn-edited":
      return `the closing turn changed the worktree: ${lastClose.paths.join(", ")}`;
    case "handoff-invalid":
      return `${PERSON_HANDOFF_PATH} is not a valid interactive handoff: ${lastClose.defects.join("; ")}`;
    case "closing-answer-invalid":
      return `the closing turn's answer was refused: ${lastClose.reason}`;
    case "limit":
      return lastClose.resetAt === null
        ? "a rate or usage limit stopped the closing turn"
        : `a rate or usage limit stopped the closing turn; it resets at ${lastClose.resetAt}`;
    case "close-error":
      return `the close failed at its ${lastClose.step} step: ${lastClose.detail}`;
  }
}

// ── Step 1: a commit that landed before an interruption ────────────────────

function trailerValue(message: string, key: string): string | null {
  for (const line of message.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith(`${key}: `)) return trimmed.slice(key.length + 2).trim();
  }
  return null;
}

function readCommitMessage(worktree: string, sha: string): Effect.Effect<string, Error, Shell> {
  return Effect.gen(function* () {
    const shell = yield* Shell;
    const result = yield* shell.run({
      command: ["git", "log", "-1", "--format=%B", sha],
      cwd: worktree,
    });
    if (result.exitCode !== 0) {
      return yield* Effect.fail(
        new Error(
          `git log -1 --format=%B ${sha} exited ${result.exitCode}: ${result.stderr.trim()}`,
        ),
      );
    }
    return result.stdout;
  });
}

/**
 * What a person does about a commit of their own in the stopped worktree:
 * phax never rewrites history, so they put HEAD back to `base`, keeping the
 * commit's changes in the worktree, and resume.
 */
function ownCommitRemedy(input: CloseStopInput, base: string): string {
  return `run git -C ${shellQuote(input.worktree)} reset --soft ${base} to keep its changes uncommitted, then phax resume ${input.shortName}`;
}

/**
 * HEAD moved since the close recorded `closeBase`. It is this stop's commit
 * when its parent is `closeBase` and its message carries this run's `Run-Id`
 * and `Interactive-Phase: <phase>`: the close is then finished from it,
 * unless the worktree changed since that commit, which is refused as
 * `worktree-changed` so the person decides about those edits. Any other move
 * is refused, naming the remedy.
 */
function finishLandedCommit(
  input: CloseStopInput,
  closeBase: string,
  head: string,
): Effect.Effect<CloseReport, CloseRefusal, FileSystem | Git | Shell | SystemTelemetry> {
  return Effect.gen(function* () {
    const git = yield* Git;
    const fs = yield* FileSystem;
    const parent = yield* at("commit", git.resolveRef(input.worktree, "HEAD^"));
    const message = yield* at("commit", readCommitMessage(input.worktree, head));
    const ours =
      parent === closeBase &&
      trailerValue(message, "Run-Id") === input.runId &&
      trailerValue(message, "Interactive-Phase") === input.phase.id;
    if (!ours) {
      return yield* refuse(
        closeError(
          "commit",
          new Error(
            `HEAD moved from ${closeBase} to ${head}, and ${head} is not this stop's Interactive-Phase commit: ${ownCommitRemedy(input, closeBase)}`,
          ),
        ),
      );
    }
    const headTree = yield* at("commit", git.headTree(input.worktree));
    const worktreeTree = yield* at("commit", git.snapshotWorktree(input.worktree));
    if (worktreeTree !== headTree) {
      const moved = yield* at(
        "commit",
        git.changedPathsBetween(input.worktree, headTree, worktreeTree),
      );
      return yield* refuse({
        result: "worktree-changed",
        exitCode: 1,
        paths: nonEmpty(moved.map((c) => c.path).toSorted()),
      });
    }
    const baseTree = yield* at("commit", git.resolveRef(input.worktree, `${closeBase}^{tree}`));
    if (baseTree === null) {
      return yield* refuse(closeError("commit", new Error(`${closeBase} names no tree`)));
    }
    const changed =
      baseTree === headTree
        ? []
        : yield* at("commit", git.changedPathsBetween(input.worktree, baseTree, headTree));
    const diff = yield* at("files", git.diffTrees(input.worktree, baseTree, headTree));
    yield* at("files", fs.writeAtomic(join(input.phaseFolder, "diff.patch"), diff));
    yield* at("files", reconcileReview(input));
    return {
      outcome: baseTree === headTree ? "unchanged" : "corrected",
      commit: head,
      handoffSource: "earlier-close",
      gateLog: trailerValue(message, "Gate-Log"),
      gateSteps: [],
      changedPaths: changed.map((c) => c.path).toSorted(),
      restoredClosingTurn: null,
    } satisfies CloseReport;
  });
}

function reconcileReview(input: CloseStopInput) {
  return reconcilePhaseFiles({
    kind: "review",
    phase: input.phase,
    worktreePath: input.worktree as never,
    phaseFolderPath: input.phaseFolder,
    runId: input.runId,
    fileReconciliationMode: input.fileReconciliationMode,
    oracleFiles: [],
  });
}

// ── Step 2: the gate ───────────────────────────────────────────────────────

function runCloseGate(
  input: CloseStopInput,
): Effect.Effect<
  { readonly log: string; readonly steps: readonly GateStepResult[] },
  CloseRefusal,
  FileSystem | Shell
> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const gateRequest = yield* at("gate", input.gateRequest);
    const names = yield* at("gate", fs.list(input.phaseFolder));
    const log = join(input.phaseFolder, attemptLogName(nextAttemptNumber(names)));
    const outcome = yield* Effect.either(
      runGates({
        steps: selectGateSteps(input.gateSteps, false),
        cwd: input.worktree,
        attemptLogPath: log,
        attributionPath: join(input.phaseFolder, "gate-attribution.json"),
        phaseId: input.phase.id,
        gateRequest,
      }),
    );
    if (Either.isRight(outcome)) return { log, steps: outcome.right.steps };
    const error = outcome.left;
    if (error instanceof GateFailedError || error instanceof GateStepRefusedError) {
      return yield* refuse({ result: "gate-failed", exitCode: 4, log: error.logPath });
    }
    return yield* refuse(closeError("gate", error));
  });
}

// ── Step 4: the closing turn ───────────────────────────────────────────────

interface Binding {
  readonly provider: ProviderId;
  readonly model: string;
  readonly effort: string;
}

type ClosingAttempt =
  | {
      readonly kind: "answered";
      readonly handoff: string;
      readonly source: "closing-turn-resumed" | "closing-turn-new";
    }
  | { readonly kind: "refused"; readonly refusal: Refusal };

const CLOSING_TURN_STREAM = /^closing-turn-(\d{2})\.jsonl$/;

const handoffSchemaJson = (): string =>
  JSON.stringify(JSONSchema.make(InteractiveHandoffFileSchema), null, 2);

function decodeHandoffAnswer(finalText: string): Either.Either<InteractiveHandoff, string> {
  return Either.flatMap(parseFinalMessageJson(finalText), (parsed) =>
    Either.match(readInteractiveHandoffAnswer(parsed), {
      onLeft: (error) => Either.left(describeReportError(error)),
      onRight: ({ $schema: _schema, ...answer }) => Either.right(answer),
    }),
  );
}

interface ClosingTurnContext {
  readonly input: CloseStopInput;
  readonly turn: number;
  readonly policy: SecurityPolicy;
  readonly current: InteractiveSession["current"];
  readonly phaseBinding: Binding;
  readonly diff: ClosingDiff;
  /** Record `turn` as the closing turn in progress, before a new session takes it. */
  readonly advanceTurn: (turn: number) => Effect.Effect<void, FsError, FileSystem>;
}

// The provider part: the current session resumed read-only, or a new
// read-only session when there is none or the resume failed for any reason
// but a limit, then one corrective resume of an invalid answer. Every
// provider failure becomes a refusal, so only a defect or an interruption
// leaves this effect unsucceeded.
function attemptClosingTurn(
  ctx: ClosingTurnContext,
): Effect.Effect<ClosingAttempt, never, Backend | FileSystem | SystemTelemetry> {
  return Effect.gen(function* () {
    const backend = yield* Backend;
    const { input } = ctx;
    const label = closingTurnLabel(ctx.turn);
    const schemaJson = handoffSchemaJson();
    const schemaUrl = currentSchemaUrl("interactive-handoff");
    // No agent commands (q-turn-shell, no-shell); no `phaseFolderPath`, so
    // the provider never patches a claudeSessionId into the phase's status.
    const options = (stream: string, binding: Binding): AgentRunOptions => ({
      provider: binding.provider,
      model: binding.model,
      effort: binding.effort,
      cwd: input.worktree,
      security: ctx.policy,
      agentCommands: [],
      readOnly: true,
      outputJsonlPath: join(input.phaseFolder, stream),
    });
    const costed = (
      run: Effect.Effect<AgentRunResult, unknown, Backend>,
      stream: string,
      binding: Binding,
    ) =>
      Effect.either(
        withInvocationCost(run, {
          role: "closing-turn",
          phase: input.phase.id,
          runId: input.runId,
          runPath: input.runPath,
          provider: binding.provider,
          streamPath: join(input.phaseFolder, stream),
        }),
      );

    let first: {
      readonly result: AgentRunResult;
      readonly binding: Binding;
      readonly source: "closing-turn-resumed" | "closing-turn-new";
      readonly label: string;
    } | null = null;

    const current = ctx.current;
    if (current !== null) {
      const binding: Binding = current;
      const stream = `${label}.jsonl`;
      const resumed = yield* costed(
        backend.resumeAgentSession(
          current.sessionId as ClaudeSessionId,
          closingTurnPrompt({ diff: ctx.diff, seedPath: null, schemaJson, schemaUrl }),
          options(stream, binding),
        ),
        stream,
        binding,
      );
      if (Either.isRight(resumed)) {
        first = { result: resumed.right, binding, source: "closing-turn-resumed", label };
      } else if (isLimit(resumed.left)) {
        return { kind: "refused", refusal: limitRefusal(resumed.left) };
      }
    }

    if (first === null) {
      // The failed resume keeps its own stream; the new session is the next
      // closing turn, so the ledger reads both under `closing-turn-NN.jsonl`,
      // and interactive-session.json records that turn in progress.
      const newTurn = current === null ? ctx.turn : ctx.turn + 1;
      if (newTurn !== ctx.turn) {
        const advanced = yield* Effect.either(ctx.advanceTurn(newTurn));
        if (Either.isLeft(advanced)) {
          return { kind: "refused", refusal: closeError("files", advanced.left) };
        }
      }
      const newLabel = closingTurnLabel(newTurn);
      const stream = `${newLabel}.jsonl`;
      const started = yield* costed(
        backend.runAgent(
          closingTurnPrompt({
            diff: ctx.diff,
            seedPath: SEED_WORKTREE_PATH,
            schemaJson,
            schemaUrl,
          }),
          options(stream, ctx.phaseBinding),
        ),
        stream,
        ctx.phaseBinding,
      );
      if (Either.isLeft(started)) {
        return {
          kind: "refused",
          refusal: isLimit(started.left)
            ? limitRefusal(started.left)
            : closeError("closing-turn", started.left),
        };
      }
      first = {
        result: started.right,
        binding: ctx.phaseBinding,
        source: "closing-turn-new",
        label: newLabel,
      };
    }

    const answer = decodeHandoffAnswer(first.result.finalText);
    if (Either.isRight(answer)) {
      return {
        kind: "answered",
        handoff: renderInteractiveHandoff(answer.right),
        source: first.source,
      };
    }

    const retryStream = `${first.label}-retry.jsonl`;
    const retry = yield* costed(
      backend.resumeAgentSession(
        first.result.sessionId,
        correctivePrompt(answer.left, schemaUrl),
        options(retryStream, first.binding),
      ),
      retryStream,
      first.binding,
    );
    if (Either.isLeft(retry)) {
      return {
        kind: "refused",
        refusal: isLimit(retry.left)
          ? limitRefusal(retry.left)
          : closeError("closing-turn", retry.left),
      };
    }
    const retried = decodeHandoffAnswer(retry.right.finalText);
    if (Either.isRight(retried)) {
      return {
        kind: "answered",
        handoff: renderInteractiveHandoff(retried.right),
        source: first.source,
      };
    }
    return {
      kind: "refused",
      refusal: {
        result: "closing-answer-invalid",
        exitCode: 5,
        reason: `the first answer was refused (${answer.left}); the corrective answer was refused too (${retried.left})`,
      },
    };
  });
}

function nextClosingTurnNumber(phaseFolder: string): Effect.Effect<number, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const taken = (yield* fs.list(phaseFolder)).flatMap((entry) => {
      const match = CLOSING_TURN_STREAM.exec(entry);
      return match === null ? [] : [Number(match[1])];
    });
    return Math.max(0, ...taken) + 1;
  });
}

/**
 * The read-only closing turn, given the corrections between HEAD's tree and
 * the gated tree. It is recorded in progress, as a closing turn, before it
 * starts; an interruption leaves it so, and the next close restores a
 * writing turn's edits. Once it ends, the worktree and the person's handoff
 * file are compared with how they stood before it: a turn that changed
 * either has its versions moved to `refused-turn-NN/`, the worktree put back
 * to the gated tree and the handoff file to its kept copy, and is refused as
 * `closing-turn-edited`. The worktree's seed is rewritten from its
 * run-folder copy.
 */
function runClosingTurn(
  input: CloseStopInput,
  args: {
    readonly session: InteractiveSession | null;
    readonly phaseBinding: Binding;
    readonly policy: SecurityPolicy;
    readonly headTree: string;
    readonly gated: string;
    readonly changedPaths: readonly string[];
  },
): Effect.Effect<
  Extract<ClosingAttempt, { kind: "answered" }>,
  CloseRefusal,
  Backend | FileSystem | Git | SystemTelemetry
> {
  return Effect.gen(function* () {
    const git = yield* Git;
    const diffText = yield* at("files", git.diffTrees(input.worktree, args.headTree, args.gated));
    const diff = cutDiff(diffText, args.changedPaths);
    const turn = yield* at("files", nextClosingTurnNumber(input.phaseFolder));
    // The turn in progress: a new session after a failed resume takes the next number.
    let label = closingTurnLabel(turn);
    const personBefore = yield* at("files", fingerprintPersonHandoff(input.worktree));
    yield* at("files", keepPersonHandoffCopy(input.phaseFolder, label, personBefore));

    const startedAt = now();
    const current = args.session?.current ?? null;
    const base: InteractiveSession = args.session ?? {
      phaseId: input.phase.id,
      provider: args.phaseBinding.provider,
      interactiveResume: getSessionAdapter(args.phaseBinding.provider).interactiveResume,
      current: null,
      history: [],
      firstTurns: [],
      turnInProgress: null,
    };
    const recordInProgress = (n: number, origin: Origin) =>
      writeInteractiveSession(input.phaseFolder, {
        ...base,
        turnInProgress: {
          kind: "closing-turn",
          turn: n,
          origin,
          beforeTree: args.gated,
          personHandoffBefore: personBefore?.sha256 ?? null,
          startedAt,
        },
      });
    yield* at("files", recordInProgress(turn, current?.origin ?? "new-session"));
    // The handoff copy moves to the new turn's label once that turn is
    // recorded, so a crash at any point finds the copy its record names.
    const advanceTurn = (next: number) =>
      Effect.gen(function* () {
        const nextLabel = closingTurnLabel(next);
        yield* keepPersonHandoffCopy(input.phaseFolder, nextLabel, personBefore);
        yield* recordInProgress(next, "new-session");
        yield* dropPersonHandoffCopy(input.phaseFolder, label);
        label = nextLabel;
      });

    const attempt = yield* attemptClosingTurn({
      input,
      turn,
      policy: args.policy,
      current,
      phaseBinding: args.phaseBinding,
      diff,
      advanceTurn,
    });

    const afterTree = yield* at("commit", git.snapshotWorktree(input.worktree));
    const personAfter = yield* at("files", fingerprintPersonHandoff(input.worktree));
    const verdict = worktreeChangeVerdict({
      before: args.gated,
      after: afterTree,
      changed:
        afterTree === args.gated
          ? []
          : yield* at("commit", git.changedPathsBetween(input.worktree, args.gated, afterTree)),
      personHandoffBefore: personBefore?.sha256 ?? null,
      personHandoffAfter: personAfter?.sha256 ?? null,
    });
    if (verdict.kind === "changed") {
      // Left in place, the turn's edits would pass as the person's at the
      // next close: its versions are moved aside and the gated tree put back.
      // The person's handoff file is never given to restorePaths: snapshots
      // leave `.phax-context/` out, so its kept copy restores it.
      yield* at("files", keepRefusedTurn(input.worktree, input.phaseFolder, verdict.paths));
      yield* at(
        "commit",
        git.restorePaths(
          input.worktree,
          args.gated,
          verdict.paths.filter((p) => p !== PERSON_HANDOFF_PATH),
        ),
      );
      if (verdict.personHandoff !== "unchanged") {
        yield* at("files", restorePersonHandoff(input.worktree, input.phaseFolder, label));
      }
    }
    yield* at("files", dropPersonHandoffCopy(input.phaseFolder, label));
    yield* at("files", restoreWorktreeSeed(seedPaths(input.worktree, input.phaseFolder)));
    yield* at(
      "files",
      writeInteractiveSession(input.phaseFolder, { ...base, turnInProgress: null }),
    );

    if (verdict.kind === "changed") {
      return yield* refuse({
        result: "closing-turn-edited",
        exitCode: 5,
        paths: nonEmpty(verdict.paths),
      });
    }
    if (attempt.kind === "refused") return yield* refuse(attempt.refusal);
    return attempt;
  });
}

// ── The close ──────────────────────────────────────────────────────────────

function closeSteps(
  input: CloseStopInput,
): Effect.Effect<CloseReport, CloseRefusal, Backend | FileSystem | Git | Shell | SystemTelemetry> {
  return Effect.gen(function* () {
    const git = yield* Git;
    const fs = yield* FileSystem;

    // 1. Close base.
    const stop = yield* at("files", readReviewStop(input.runPath, input.phaseFolder));
    if (stop === null) {
      return yield* refuse(
        closeError("files", new Error(`no review-stop document for ${input.phase.id}`)),
      );
    }
    const head = yield* at("commit", git.headCommit(input.worktree));
    const closeBase = stop.reviewStop.closeBase;
    if (closeBase === null) {
      // The first close: HEAD is still the phase's base unless the person
      // committed in the worktree, which would pass their correction as the base.
      const base = yield* at("files", readPhaseBase(input.phaseFolder));
      if (head !== base) {
        return yield* refuse(
          closeError(
            "commit",
            new Error(
              `HEAD moved from the phase's base ${base} to ${head}, a commit made in the stopped worktree: ${ownCommitRemedy(input, base)}`,
            ),
          ),
        );
      }
      yield* at("files", rewriteReviewStopAt(stop.path, { ...stop.reviewStop, closeBase: head }));
    } else if (head !== closeBase) {
      return yield* finishLandedCommit(input, closeBase, head);
    }

    const model: PhaseModel = yield* at("files", readModelResolution(input.phaseFolder));
    const { policy } = yield* at("files", readPhasePosture(input.phaseFolder));
    const phaseBinding: Binding = {
      provider: model.provider,
      model: model.model,
      effort: model.effort ?? input.phase.effort,
    };
    const turnInput: FirstTurnInput = {
      runId: input.runId,
      runPath: input.runPath,
      phaseFolder: input.phaseFolder,
      worktree: input.worktree,
      phase: input.phase,
      ...phaseBinding,
      policy,
      origin: "new-session",
    };
    // A turn an earlier close or session left in progress is settled before
    // the gate, so a writing closing turn's edits never pass as the person's.
    const leftover = yield* at("files", settleLeftoverTurn(turnInput));

    // 2. Gate.
    const gate = yield* runCloseGate(input);

    // 3. Gated tree.
    const gated = yield* at("commit", git.snapshotWorktree(input.worktree));
    const headTree = yield* at("commit", git.headTree(input.worktree));
    const changed = gated !== headTree;
    const changedPaths = changed
      ? (yield* at("commit", git.changedPathsBetween(input.worktree, headTree, gated)))
          .map((c) => c.path)
          .toSorted()
      : [];

    // 4. Handoff.
    const person = yield* at("files", fingerprintPersonHandoff(input.worktree));
    let handoff: string;
    let source: HandoffSource;
    if (person !== null) {
      const valid = validateInteractiveHandoff(person.text);
      if (Either.isLeft(valid)) {
        return yield* refuse({
          result: "handoff-invalid",
          exitCode: 1,
          defects: nonEmpty(valid.left),
        });
      }
      handoff = person.text;
      source = "person";
    } else if (!changed) {
      handoff = REVIEWED_WITHOUT_CHANGE_HANDOFF;
      source = "unchanged";
    } else {
      const turn = yield* runClosingTurn(input, {
        session: leftover.session,
        phaseBinding,
        policy,
        headTree,
        gated,
        changedPaths,
      });
      handoff = turn.handoff;
      source = turn.source;
    }

    // 5. Check: the tree to commit is still the gated one.
    const after = yield* at("commit", git.snapshotWorktree(input.worktree));
    if (after !== gated) {
      const moved = yield* at("commit", git.changedPathsBetween(input.worktree, gated, after));
      const paths = nonEmpty(moved.map((c) => c.path).toSorted());
      return yield* refuse(
        source === "closing-turn-resumed" || source === "closing-turn-new"
          ? { result: "closing-turn-edited", exitCode: 5, paths }
          : { result: "worktree-changed", exitCode: 1, paths },
      );
    }

    // 6. Commit exactly the gated tree.
    yield* at("files", fs.writeAtomic(join(input.phaseFolder, "phase-handoff.md"), handoff));
    const body = buildInteractiveCommitBody({
      phase: input.phase,
      runId: input.runId,
      shortName: input.shortName,
      worktreePath: input.worktree,
      gateLogPath: gate.log,
    });
    const commit = yield* at(
      "commit",
      git.commitTree(input.worktree, changed ? gated : headTree, input.phase.commit.subject, body),
    );
    const diff = yield* at("files", git.diffTrees(input.worktree, headTree, gated));
    yield* at("files", fs.writeAtomic(join(input.phaseFolder, "diff.patch"), diff));

    // 7. Reconcile.
    yield* at("files", reconcileReview(input));

    return {
      outcome: changed ? "corrected" : "unchanged",
      commit,
      handoffSource: source,
      gateLog: gate.log,
      gateSteps: gate.steps,
      changedPaths,
      restoredClosingTurn: leftover.restoredClosingTurn,
    } satisfies CloseReport;
  });
}

/**
 * Close a declared stop. Called once `RunResumeRequested` has made the run
 * `running`, the phase still `awaiting_review` and review-stop.json parked.
 * In order: the close base (finishing a close whose commit already landed);
 * a turn left in progress settled; the gate's non-terminal steps once; the
 * gated tree snapshotted; the handoff (the person's file, the fixed handoff
 * of an unchanged stop, or a read-only closing turn); a check that the tree
 * is still the gated one; phase-handoff.md, the commit of exactly that tree
 * and diff.patch; the review reconciliation; `StopCommitted`. Any failure
 * before that dispatches `StopCloseRefused` and fails with
 * `StopCloseRefusedError`. It writes neither phax-plan.json nor plan.md, and
 * never raises `PhaseHadNoChangesError`.
 */
export function closeDeclaredStop(
  input: CloseStopInput,
): Effect.Effect<
  CloseReport,
  | StopCloseRefusedError
  | InvalidTransitionError
  | FsError
  | GitError
  | ShellError
  | SetupCommandFailedError
  | RegistryCorruptionError,
  Backend | FileSystem | Git | Shell | SystemTelemetry
> {
  return Effect.gen(function* () {
    const ctx: DispatcherContext = {
      runPath: input.runPath,
      shortName: input.shortName,
      phaseFolderPath: input.phaseFolder,
      phaseId: input.phase.id,
    };
    const base = {
      eventId: randomUUID(),
      occurredAt: now(),
      run: input.shortName as unknown as RunId,
      phase: input.phase.id as PhaseId,
      phaseId: input.phase.id as PhaseId,
    } as const;

    const closed = yield* Effect.either(closeSteps(input));
    if (Either.isLeft(closed)) {
      const lastClose = { ...closed.left.refusal, at: now() } as RefusedClose;
      yield* dispatch({ ...base, type: "StopCloseRefused", lastClose }, ctx);
      return yield* Effect.fail(
        new StopCloseRefusedError({
          message: `Close of the stop at ${input.phase.id} refused: ${describeRefusal(lastClose)}`,
          run: input.shortName,
          phase: input.phase.id,
          lastClose,
        }),
      );
    }

    const report = closed.right;
    const result = yield* dispatch(
      {
        ...base,
        eventId: randomUUID(),
        occurredAt: now(),
        type: "StopCommitted",
        hash: report.commit,
        outcome: report.outcome,
      },
      ctx,
    );
    if (result.disposition !== "Handled") {
      return yield* Effect.fail(
        new InvalidTransitionError({
          from:
            "phase" in result.stateBefore ? result.stateBefore.phase.state : result.stateBefore.run,
          to: "committed",
          entity: "phase",
        }),
      );
    }
    return report;
  });
}
