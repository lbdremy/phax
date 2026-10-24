// Closing a stop, declared or held, with one sequence: the gate first, then
// the person's handoff file or a read-only closing turn given the
// corrections' content diff, then a commit of exactly the tree the gate
// passed, reconciled as review corrections. The close runs after
// `RunResumeRequested` made the run `running`, with the phase still
// `awaiting_review` and review-stop.json parked; the parked document's
// `cause` decides the variant. A declared stop's commit is the phase's own,
// with the phase's files. A held stop's is one review commit on top of the
// unchanged phase commit, or none when nothing changed, and every file it
// writes sits beside the phase's own (`review-gate/`, `correction-handoff.md`,
// `review-diff.patch`, `correction-reconciliation.*`), which stay as they
// are. It transitions only through `StopCloseRefused`, and `StopCommitted`
// or `HeldStopClosed`: every failure before that returns the run to the
// stop, and none restores or resets the person's corrections: only a closing
// turn's own edits are moved aside and put back. A stop inside an oracle
// pair whose corrections change one of the pair's oracle files ends its gate
// with the `authored` oracle step, naming the stopped phase; a held
// discharging phase is never judged again, and only flags such a change.
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
import type { HeldStopClosed, OracleStep, PhaxEventBase, StopCommitted } from "../domain/events.js";
import { attemptLogName, nextAttemptNumber } from "../domain/gate/attemptFiles.js";
import { makeReviewOracleRequest, oracleRequestPathFor } from "../domain/gate/oracleRequest.js";
import { selectGateSteps } from "../domain/gate/selectSteps.js";
import {
  REVIEWED_WITHOUT_CHANGE_HANDOFF,
  renderInteractiveHandoff,
  validateInteractiveHandoff,
} from "../domain/interactive/handoff.js";
import {
  recordedSessions,
  sha256Hex,
  TRANSCRIPTS_FOLDER,
  transcriptFile,
  type ClosedStopSession,
  type TranscriptOutcome,
} from "../domain/interactive/transcripts.js";
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
import {
  dischargedOracleFiles,
  pairsChangedByCorrections,
  stopOraclePairs,
  type OraclePair,
} from "../domain/plan/oraclePairs.js";
import type { ProviderId } from "../domain/routing/types.js";
import { stopPostureOf } from "../domain/security/stopPosture.js";
import type { SecurityPolicy } from "../domain/security/types.js";
import { getSessionAdapter } from "../domain/session/index.js";
import { Backend, type AgentRunOptions, type AgentRunResult } from "../ports/backend.js";
import { FileSystem, FsError } from "../ports/fs.js";
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
  readGateAttributionFile,
  readInteractiveHandoffAnswer,
  readOracleRequestFile,
} from "../schemas/persisted.js";
import type { GateStep } from "../schemas/phaxConfig.js";
import type { PhaxPlanPhase } from "../schemas/phaxPlan.js";
import type { ReviewStop } from "../schemas/reviewStop.js";
import { buildHeldReviewCommitBody, buildInteractiveCommitBody } from "./commit.js";
import { withInvocationCost } from "./costLedger.js";
import { dispatch, type DispatcherContext } from "./dispatcher.js";
import {
  ORACLE_PROVIDER_TIMEOUT_MS,
  runGates,
  serializeOracleRequest,
  type OracleStep as GateOracleStep,
} from "./gates.js";
import {
  dropPersonHandoffCopy,
  fingerprintPersonHandoff,
  keepPersonHandoffCopy,
  keepRefusedTurn,
  readInteractiveSession,
  readModelResolution,
  readPhasePosture,
  readReviewStop,
  readSecurityFile,
  restorePersonHandoff,
  restoreWorktreeSeed,
  rewriteReviewStopAt,
  seedPaths,
  SEED_WORKTREE_PATH,
  writeInteractiveSession,
  writeSecurityFile,
  type PhaseModel,
} from "./interactiveFiles.js";
import {
  closingTurnLabel,
  settleLeftoverTurn,
  type FirstTurnInput,
  type LeftoverSettlement,
} from "./interactiveStop.js";
import { readPhaseBase, readPhaseCommit } from "./phaseStatusUpdates.js";
import {
  reconcilePhaseFiles,
  writeUnchangedCorrectionReconciliation,
} from "./reconcilePhaseFiles.js";
import {
  tracedCloseGate,
  tracedReviewCommit,
  tracedStep,
  tracedTurnCall,
  traceTranscript,
  traceUnjudgedOracleEdits,
} from "./telemetry/stopTelemetry.js";

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
  /** The plan's phases, in plan order: the oracle pairs the stop sits in come from them. */
  readonly phases: readonly PhaxPlanPhase[];
  /** The configured oracles provider, or null when no layer declares one. */
  readonly oracles: { readonly command: string } | null;
  /** The checkout `phax resume` runs in: its git configuration names who closes the stop. */
  readonly mainCheckout: string;
}

/** The git identity of the checkout that closed a stop, as its configuration names it. */
export interface Closer {
  readonly name: string;
  readonly email: string;
}

/**
 * Where the close's handoff came from: the person's file, a closing turn
 * that resumed the current session or started a new one, the fixed handoff of
 * an unchanged stop, or (`earlier-close`) a close interrupted after its
 * commit, whose handoff was written before that commit.
 */
export type HandoffSource =
  | "person"
  | "closing-turn-resumed"
  | "closing-turn-new"
  | "unchanged"
  | "earlier-close";

interface CloseReportFacts {
  /** Who closed the stop: the main checkout's git identity, never read from a commit. */
  readonly closedBy: Closer;
  readonly handoffSource: HandoffSource;
  /** The closing gate attempt's log: the commit's `Gate-Log` trailer. */
  readonly gateLog: string | null;
  /** The closing gate's steps; empty for an `earlier-close`, whose gate ran before. */
  readonly gateSteps: readonly GateStepResult[];
  /** The paths the corrections changed, sorted. */
  readonly changedPaths: readonly string[];
  /** A writing closing turn's edits an earlier close left in progress, restored before the gate. */
  readonly restoredClosingTurn: LeftoverSettlement["restoredClosingTurn"];
  /** Whether the close's gate ended with the `authored` oracle step, which passed. */
  readonly oracleStep: OracleStep;
  /** The stop's recorded sessions with their transcripts' outcomes, oldest first. */
  readonly sessions: readonly ClosedStopSession[];
}

/**
 * What a close came to, by the stop's cause and its outcome. A declared close
 * always commits: `commit` is the phase's commit. A held close commits only
 * corrections: `reviewCommit` sits on top of `phaseCommit`, which is never
 * rewritten. At a held discharging phase, `unjudgedOracleFiles` names the
 * oracle files of the pair it discharges that the corrections changed: the
 * discharge was judged before the stop, so no oracle step sees them.
 */
export type CloseReport =
  | (CloseReportFacts & {
      readonly cause: "declared";
      readonly outcome: "corrected" | "unchanged";
      readonly commit: string;
    })
  | (CloseReportFacts & {
      readonly cause: "held";
      readonly outcome: "corrected";
      readonly phaseCommit: string;
      readonly reviewCommit: string;
      readonly unjudgedOracleFiles: readonly string[];
    })
  | (CloseReportFacts & {
      readonly cause: "held";
      readonly outcome: "unchanged";
      readonly phaseCommit: string;
    });

type Cause = ReviewStop["cause"];

/**
 * Where a close of each cause writes. A declared close writes the phase's own
 * files; a held one writes beside them, so the agent's gate attempts,
 * attribution, handoff, diff and reconciliation stay as they are.
 */
interface CloseLayout {
  readonly cause: Cause;
  /** The folder of the closing gate's attempt log, its siblings and attribution. */
  readonly gateFolder: string;
  readonly handoffFile: "phase-handoff.md" | "correction-handoff.md";
  readonly diffFile: "diff.patch" | "review-diff.patch";
  /** The trailer naming the stop on its commit. */
  readonly trailer: "Interactive-Phase" | "Held-Phase";
}

/** The folder a held close's gate files go to, inside the phase folder. */
const REVIEW_GATE_FOLDER = "review-gate";

function layoutOf(cause: Cause, phaseFolder: string): CloseLayout {
  switch (cause) {
    case "declared":
      return {
        cause,
        gateFolder: phaseFolder,
        handoffFile: "phase-handoff.md",
        diffFile: "diff.patch",
        trailer: "Interactive-Phase",
      };
    case "held":
      return {
        cause,
        gateFolder: join(phaseFolder, REVIEW_GATE_FOLDER),
        handoffFile: "correction-handoff.md",
        diffFile: "review-diff.patch",
        trailer: "Held-Phase",
      };
  }
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
 * and the cause's trailer naming the phase (`Interactive-Phase: <phase>` or
 * `Held-Phase: <phase>`): the close is then finished from it, unless the
 * worktree changed since that commit, which is refused as `worktree-changed`
 * so the person decides about those edits. Any other move is refused, naming
 * the remedy.
 */
function finishLandedCommit(
  input: CloseStopInput,
  layout: CloseLayout,
  closedBy: Closer,
  closeBase: string,
  head: string,
): Effect.Effect<CloseReport, CloseRefusal, Backend | FileSystem | Git | Shell | SystemTelemetry> {
  return Effect.gen(function* () {
    const git = yield* Git;
    const fs = yield* FileSystem;
    const parent = yield* at("commit", git.resolveRef(input.worktree, "HEAD^"));
    const message = yield* at("commit", readCommitMessage(input.worktree, head));
    const ours =
      parent === closeBase &&
      trailerValue(message, "Run-Id") === input.runId &&
      trailerValue(message, layout.trailer) === input.phase.id;
    if (!ours) {
      return yield* refuse(
        closeError(
          "commit",
          new Error(
            `HEAD moved from ${closeBase} to ${head}, and ${head} is not this stop's ${layout.trailer} commit: ${ownCommitRemedy(input, closeBase)}`,
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
    yield* at("files", fs.writeAtomic(join(input.phaseFolder, layout.diffFile), diff));
    yield* at("files", reconcileReview(input, layout));
    const gateLog = trailerValue(message, "Gate-Log");
    const changedPaths = changed.map((c) => c.path).toSorted();
    const facts = {
      closedBy,
      handoffSource: "earlier-close",
      gateLog,
      gateSteps: [],
      changedPaths,
      restoredClosingTurn: null,
      // Git cannot tell whether the landed commit's gate ran the authored
      // step: the attempt's own files do.
      oracleStep: yield* landedOracleStep(input, layout, gateLog),
      // The commit landed before the copy, or after it: the same step, which
      // keeps an earlier copy whose store file has gone.
      sessions: yield* captureTranscripts(input, layout.cause),
    } as const;
    switch (layout.cause) {
      case "declared":
        return {
          ...facts,
          cause: "declared",
          outcome: baseTree === headTree ? "unchanged" : "corrected",
          commit: head,
        } satisfies CloseReport;
      case "held":
        // A held close commits only corrections, so its landed commit is one;
        // the close base it sits on is the phase commit, checked at the first close.
        return {
          ...facts,
          cause: "held",
          outcome: "corrected",
          phaseCommit: closeBase,
          reviewCommit: head,
          unjudgedOracleFiles: unjudgedOracleFiles(input, changedPaths),
        } satisfies CloseReport;
    }
  });
}

/** A persisted document read and decoded, or null when it is absent or refused. */
function readDocument<T>(
  path: string,
  reader: (file: string, input: unknown) => Either.Either<T, unknown>,
): Effect.Effect<T | null, never, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    if (!(yield* fs.exists(path))) return null;
    const raw = yield* fs.readText(path);
    const parsed = yield* Effect.try(() => JSON.parse(raw) as unknown);
    return Either.getOrNull(reader(path, parsed));
  }).pipe(Effect.orElseSucceed(() => null));
}

/**
 * Whether the gate of a landed close ran the `authored` step, which passed:
 * its `Gate-Log` attempt has an oracle request beside it, an `authored`
 * request naming the stopped phase, and the close's gate attribution records
 * the oracle step as passed. Anything else was no oracle step.
 */
function landedOracleStep(
  input: CloseStopInput,
  layout: CloseLayout,
  gateLog: string | null,
): Effect.Effect<OracleStep, never, FileSystem> {
  return Effect.gen(function* () {
    if (gateLog === null) return "none";
    const request = yield* readDocument(oracleRequestPathFor(gateLog), readOracleRequestFile);
    if (request?.verdict !== "authored" || request.phase !== input.phase.id) return "none";
    const attribution = yield* readDocument(
      join(layout.gateFolder, "gate-attribution.json"),
      readGateAttributionFile,
    );
    const last = attribution?.steps.at(-1);
    return last?.surface === "oracle" && last.result === "pass" ? "authored" : "none";
  });
}

/**
 * The oracle files a held discharging phase's corrections changed, in the
 * pair's declaration order; none at any other phase.
 */
function unjudgedOracleFiles(
  input: CloseStopInput,
  changedPaths: readonly string[],
): readonly string[] {
  return dischargedOracleFiles(input.phases, input.phase.id).filter((file) =>
    changedPaths.includes(file),
  );
}

/** A pair as the close's messages name it. */
const pairName = (pair: OraclePair): string => `${pair.oraclePhase} → ${pair.dischargingPhase}`;

/**
 * The oracle step a close's gate ends with, decided before the gate from the
 * corrections (the worktree against HEAD's tree): the `authored` step when
 * they change the oracle files of exactly one pair the stop sits in, none
 * when they change none. Corrections touching two pairs' oracle files are
 * refused, since one gate attempt carries one oracle request, and so is one
 * pair's with no oracles provider to judge it.
 */
function decideOracleStep(
  input: CloseStopInput,
  correctedPaths: readonly string[],
): Effect.Effect<
  { readonly pair: OraclePair | null; readonly step: GateOracleStep | undefined },
  CloseRefusal,
  FileSystem
> {
  return Effect.gen(function* () {
    const pairs = pairsChangedByCorrections(
      stopOraclePairs(input.phases, input.phase.id),
      correctedPaths,
    );
    const [pair, ...others] = pairs;
    if (pair === undefined) return { pair: null, step: undefined };
    if (others.length > 0) {
      return yield* refuse(
        closeError(
          "gate",
          new Error(
            `the corrections change oracle files of ${pairs.length} oracle pairs (${pairs.map(pairName).join(", ")}), and one close judges one pair: undo the oracle-file corrections of all but one pair, or reset the stop`,
          ),
        ),
      );
    }
    const files = pair.files.filter((f) => correctedPaths.includes(f));
    if (input.oracles === null) {
      return yield* refuse(
        closeError(
          "gate",
          new Error(
            `the corrections change ${files.join(", ")}, an oracle file of pair ${pairName(pair)}, and no "oracles" provider is configured to judge them: configure one, or undo the oracle-file correction`,
          ),
        ),
      );
    }
    const base = yield* at("gate", readPhaseBase(join(input.runPath, pair.oraclePhase)));
    return {
      pair,
      step: {
        kind: "run",
        command: input.oracles.command,
        request: serializeOracleRequest(
          makeReviewOracleRequest({ pair, phaseId: input.phase.id, base }),
        ),
        timeoutMs: ORACLE_PROVIDER_TIMEOUT_MS,
      },
    };
  });
}

/**
 * A gate step that wrote an oracle file the corrections had not changed is
 * refused: the oracle step, if any, judged another pair's files, so no step
 * judges that write. `judged` is the pair the pre-gate decision chose.
 */
function refuseGateOracleWrites(
  input: CloseStopInput,
  judged: OraclePair | null,
  gatedPaths: readonly string[],
): Effect.Effect<void, CloseRefusal> {
  return Effect.gen(function* () {
    for (const pair of stopOraclePairs(input.phases, input.phase.id)) {
      if (pair.oraclePhase === judged?.oraclePhase) continue;
      const written = pair.files.find((f) => gatedPaths.includes(f));
      if (written !== undefined) {
        return yield* refuse(
          closeError(
            "gate",
            new Error(
              `a gate step wrote ${written}, an oracle file of pair ${pairName(pair)} that the corrections did not change: no oracle step judges it; make the gate leave oracle files alone, then resume`,
            ),
          ),
        );
      }
    }
  });
}

// The stop's commit, reconciled as review corrections against HEAD^: the
// phase's own reconciliation at a declared stop, the correction
// reconciliation beside it at a held one.
function reconcileReview(input: CloseStopInput, layout: CloseLayout) {
  return reconcilePhaseFiles({
    kind: "review",
    output: layout.cause === "held" ? "correction" : "phase",
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
  layout: CloseLayout,
  oracleStep: GateOracleStep | undefined,
): Effect.Effect<
  { readonly log: string; readonly steps: readonly GateStepResult[] },
  CloseRefusal,
  FileSystem | Shell | SystemTelemetry
> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const gateRequest = yield* at("gate", input.gateRequest);
    yield* at("gate", fs.mkdirp(layout.gateFolder));
    const names = yield* at("gate", fs.list(layout.gateFolder));
    const log = join(layout.gateFolder, attemptLogName(nextAttemptNumber(names)));
    const outcome = yield* Effect.either(
      tracedCloseGate(
        { runId: input.runId, phaseId: input.phase.id },
        runGates({
          steps: selectGateSteps(input.gateSteps, false),
          cwd: input.worktree,
          attemptLogPath: log,
          attributionPath: join(layout.gateFolder, "gate-attribution.json"),
          phaseId: input.phase.id,
          gateRequest,
          // Last, once every configured step passed; a failed or refused
          // verdict is a red gate like any other step's.
          ...(oracleStep === undefined ? {} : { oracleStep }),
        }),
      ),
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
      operation: "agent.run" | "agent.resume",
    ) =>
      Effect.either(
        tracedTurnCall(
          { runId: input.runId, phaseId: input.phase.id, provider: binding.provider, operation },
          withInvocationCost(run, {
            role: "closing-turn",
            phase: input.phase.id,
            runId: input.runId,
            runPath: input.runPath,
            provider: binding.provider,
            streamPath: join(input.phaseFolder, stream),
          }),
        ),
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
        "agent.resume",
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
        "agent.run",
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
      "agent.resume",
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
      transcripts: null,
      builderUsage: null,
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

    const attempt = yield* tracedStep(
      { runId: input.runId, phaseId: input.phase.id, step: "closing-turn" },
      attemptClosingTurn({
        input,
        turn,
        policy: args.policy,
        current,
        phaseBinding: args.phaseBinding,
        diff,
        advanceTurn,
      }),
      (a) => a.kind === "answered",
    );

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

// ── The transcripts ────────────────────────────────────────────────────────

/** The folder of copies is private, as is each copy: a continued session may hold secrets. */
const TRANSCRIPT_FOLDER_MODE = 0o700;
const TRANSCRIPT_FILE_MODE = 0o600;

/**
 * An earlier attempt's copy of a transcript the store no longer holds: its
 * digest, or null when there is none or it cannot be read.
 */
function earlierCopyDigest(destination: string): Effect.Effect<string | null, never, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    if (!(yield* fs.exists(destination))) return null;
    return sha256Hex(yield* fs.readBytes(destination));
  }).pipe(Effect.orElseSucceed(() => null));
}

/**
 * Copy the transcript of every session the stop recorded into
 * `interactive-transcripts/<session id>.jsonl`, overwriting an earlier copy,
 * and write each outcome into interactive-session.json. The adapter only
 * reads the provider's store; the close owns the policy: the bytes are written
 * as read and hashed as written, an earlier attempt's copy is kept when the
 * store file has gone, a `missing` transcript never refuses, and a failed
 * write refuses as `files`.
 */
function copyTranscripts(
  input: CloseStopInput,
): Effect.Effect<
  readonly ClosedStopSession[],
  CloseRefusal,
  Backend | FileSystem | SystemTelemetry
> {
  return Effect.gen(function* () {
    const backend = yield* Backend;
    const fs = yield* FileSystem;
    // Read now: the closing turn rewrote the document after the stop wrote it.
    const session = yield* at("files", readInteractiveSession(input.phaseFolder));
    if (session === null) return [];
    const ctx = { runId: input.runId, phaseId: input.phase.id };
    const closed: ClosedStopSession[] = [];
    for (const recorded of recordedSessions(session)) {
      const read = yield* backend.captureTranscript({
        provider: recorded.provider,
        sessionId: recorded.sessionId,
        startedAt: recorded.startedAt,
        cwd: input.worktree,
      });
      const destination = join(input.phaseFolder, transcriptFile(recorded.sessionId));
      let transcript: TranscriptOutcome;
      if (read.status === "found") {
        yield* at(
          "files",
          fs.mkdirp(join(input.phaseFolder, TRANSCRIPTS_FOLDER), { mode: TRANSCRIPT_FOLDER_MODE }),
        );
        yield* at(
          "files",
          fs.writeAtomicBytes(destination, read.bytes, { mode: TRANSCRIPT_FILE_MODE }),
        );
        transcript = { status: "captured", sha256: sha256Hex(read.bytes) };
      } else {
        const kept = yield* earlierCopyDigest(destination);
        transcript =
          kept === null
            ? { status: "missing", reason: read.reason, detail: read.detail }
            : { status: "captured", sha256: kept };
      }
      yield* traceTranscript(ctx, recorded, transcript);
      closed.push({
        provider: recorded.provider,
        model: recorded.model,
        effort: recorded.effort,
        sessionId: recorded.sessionId,
        origin: recorded.origin,
        transcript,
      });
    }
    yield* at(
      "files",
      writeInteractiveSession(input.phaseFolder, {
        ...session,
        transcripts: closed.map((s) => ({ sessionId: s.sessionId, ...s.transcript })),
      }),
    );
    return closed;
  });
}

/**
 * Say in the phase's `security.json` that the person's work ran outside
 * phax's enforcement, and name each turn phax ran. Only `stop` changes: the
 * file is decoded, `stop` set, and the file encoded as it was first written,
 * so the rest keeps its bytes. Computed from the folder as it stands, so
 * writing it again is idempotent.
 */
function writeStopPosture(
  input: CloseStopInput,
  cause: Cause,
): Effect.Effect<void, CloseRefusal, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const posture = yield* at("files", readSecurityFile(input.phaseFolder));
    const names = yield* at("files", fs.list(input.phaseFolder));
    yield* at(
      "files",
      writeSecurityFile(input.phaseFolder, {
        ...posture,
        stop: stopPostureOf({ cause, provider: posture.provider, names }),
      }),
    );
  });
}

/**
 * The traced `transcripts` step: the sessions' copies, then the security
 * record of the stop. A success whatever the transcripts' outcomes.
 */
const captureTranscripts = (input: CloseStopInput, cause: Cause) =>
  tracedStep(
    { runId: input.runId, phaseId: input.phase.id, step: "transcripts" },
    Effect.gen(function* () {
      const sessions = yield* copyTranscripts(input);
      yield* writeStopPosture(input, cause);
      return sessions;
    }),
    () => true,
  );

// ── The close ──────────────────────────────────────────────────────────────

function closeSteps(
  input: CloseStopInput,
): Effect.Effect<CloseReport, CloseRefusal, Backend | FileSystem | Git | Shell | SystemTelemetry> {
  return Effect.gen(function* () {
    const git = yield* Git;
    const fs = yield* FileSystem;

    // 0. The closer: the main checkout's git identity, read before anything
    // else so an unset one refuses the close with nothing written.
    const closedBy = yield* at("commit", git.authorIdentity(input.mainCheckout));
    if (closedBy === null) {
      return yield* refuse(
        closeError(
          "commit",
          new Error(
            `no git identity in ${input.mainCheckout}: set user.name and user.email, then run phax resume ${input.shortName} again`,
          ),
        ),
      );
    }

    // 1. Close base.
    const stop = yield* at("files", readReviewStop(input.runPath, input.phaseFolder));
    if (stop === null) {
      return yield* refuse(
        closeError("files", new Error(`no review-stop document for ${input.phase.id}`)),
      );
    }
    const layout = layoutOf(stop.reviewStop.cause, input.phaseFolder);
    const head = yield* at("commit", git.headCommit(input.worktree));
    const closeBase = stop.reviewStop.closeBase;
    if (closeBase === null) {
      // The first close: HEAD is still where the stop left it (the phase's
      // base at a declared stop, the phase commit at a held one) unless the
      // person committed in the worktree, which would pass their correction
      // as the base, or as the agent's work.
      const expected = yield* at("files", stopHead(input, layout.cause));
      if (head !== expected.sha) {
        return yield* refuse(
          closeError(
            "commit",
            new Error(
              `HEAD moved from ${expected.name} ${expected.sha} to ${head}, a commit made in the stopped worktree: ${ownCommitRemedy(input, expected.sha)}`,
            ),
          ),
        );
      }
      yield* at("files", rewriteReviewStopAt(stop.path, { ...stop.reviewStop, closeBase: head }));
    } else if (head !== closeBase) {
      return yield* finishLandedCommit(input, layout, closedBy, closeBase, head);
    }
    // HEAD is the close base: at a held stop, the phase commit.
    const phaseCommit = head;

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

    const pathsBetween = (from: string, to: string) =>
      from === to
        ? Effect.succeed([] as readonly string[])
        : at("commit", git.changedPathsBetween(input.worktree, from, to)).pipe(
            Effect.map((changes) => changes.map((c) => c.path).toSorted()),
          );

    // 2. Gate, ending with the `authored` step when the corrections change
    // the oracle files of a pair the stop sits in. A stop in no pair reads
    // nothing more of git.
    const inPairs = stopOraclePairs(input.phases, input.phase.id).length > 0;
    const oracle = inPairs
      ? yield* decideOracleStep(
          input,
          yield* pathsBetween(
            yield* at("commit", git.headTree(input.worktree)),
            yield* at("commit", git.snapshotWorktree(input.worktree)),
          ),
        )
      : { pair: null, step: undefined };
    const gate = yield* runCloseGate(input, layout, oracle.step);

    // 3. Gated tree.
    const gated = yield* at("commit", git.snapshotWorktree(input.worktree));
    const headTree = yield* at("commit", git.headTree(input.worktree));
    const changed = gated !== headTree;
    const changedPaths = yield* pathsBetween(headTree, gated);
    yield* refuseGateOracleWrites(input, oracle.pair, changedPaths);

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

    // 5b. Transcripts: copied before the commit, so an interruption before it
    // copies again at the next close.
    const sessions = yield* captureTranscripts(input, layout.cause);

    // 6. Commit exactly the gated tree.
    yield* at("files", fs.writeAtomic(join(input.phaseFolder, layout.handoffFile), handoff));
    const bodyOptions = {
      phase: input.phase,
      runId: input.runId,
      shortName: input.shortName,
      worktreePath: input.worktree,
      gateLogPath: gate.log,
    };
    const commitGated = (tree: string, body: string) =>
      at(
        "commit",
        tracedReviewCommit(
          { runId: input.runId, phaseId: input.phase.id },
          git.commitTree(input.worktree, tree, input.phase.commit.subject, body),
        ),
      );
    const writeDiff = Effect.gen(function* () {
      const diff = yield* at("files", git.diffTrees(input.worktree, headTree, gated));
      yield* at("files", fs.writeAtomic(join(input.phaseFolder, layout.diffFile), diff));
    });
    const facts = {
      closedBy,
      handoffSource: source,
      gateLog: gate.log,
      gateSteps: gate.steps,
      changedPaths,
      restoredClosingTurn: leftover.restoredClosingTurn,
      // The gate passed, so an oracle step it ran passed too.
      oracleStep: oracle.step === undefined ? "none" : "authored",
      sessions,
    } as const;

    switch (layout.cause) {
      case "declared": {
        // A declared stop always commits: an unchanged one lands an empty commit.
        const commit = yield* commitGated(
          changed ? gated : headTree,
          buildInteractiveCommitBody(bodyOptions),
        );
        yield* writeDiff;
        // 7. Reconcile.
        yield* at("files", reconcileReview(input, layout));
        return {
          ...facts,
          cause: "declared",
          outcome: changed ? "corrected" : "unchanged",
          commit,
        } satisfies CloseReport;
      }
      case "held": {
        if (!changed) {
          // No commit, no diff and no git read: the phase commit stays the tip.
          yield* at(
            "files",
            writeUnchangedCorrectionReconciliation({
              phase: input.phase,
              worktreePath: input.worktree as never,
              phaseFolderPath: input.phaseFolder,
              runId: input.runId,
              fileReconciliationMode: input.fileReconciliationMode,
              oracleFiles: [],
            }),
          );
          return {
            ...facts,
            cause: "held",
            outcome: "unchanged",
            phaseCommit,
          } satisfies CloseReport;
        }
        const reviewCommit = yield* commitGated(gated, buildHeldReviewCommitBody(bodyOptions));
        yield* writeDiff;
        // 7. Reconcile: the review commit against the phase commit.
        yield* at("files", reconcileReview(input, layout));
        return {
          ...facts,
          cause: "held",
          outcome: "corrected",
          phaseCommit,
          reviewCommit,
          unjudgedOracleFiles: unjudgedOracleFiles(input, changedPaths),
        } satisfies CloseReport;
      }
    }
  });
}

/**
 * Where the first close expects HEAD: the phase's base at a declared stop
 * (no commit yet), the phase commit (its status's `commitHash`) at a held one.
 */
function stopHead(
  input: CloseStopInput,
  cause: Cause,
): Effect.Effect<{ readonly sha: string; readonly name: string }, FsError, FileSystem> {
  return Effect.gen(function* () {
    switch (cause) {
      case "declared":
        return { sha: yield* readPhaseBase(input.phaseFolder), name: "the phase's base" };
      case "held": {
        const { commit } = yield* readPhaseCommit(input.phaseFolder);
        if (commit === null) {
          return yield* Effect.fail(
            new FsError({ message: `${input.phase.id} is held but noted no commit in its status` }),
          );
        }
        return { sha: commit, name: `${input.phase.id}'s commit` };
      }
    }
  });
}

/** The state event a close that finished dispatches: one per cause. */
function closedEvent(
  stamp: PhaxEventBase & { readonly phaseId: PhaseId },
  report: CloseReport,
): StopCommitted | HeldStopClosed {
  switch (report.cause) {
    case "declared":
      return {
        ...stamp,
        type: "StopCommitted",
        hash: report.commit,
        closure:
          report.outcome === "corrected"
            ? { outcome: "corrected", oracleStep: report.oracleStep, closedBy: report.closedBy }
            : { outcome: "unchanged", closedBy: report.closedBy },
      };
    case "held":
      return {
        ...stamp,
        type: "HeldStopClosed",
        phaseCommit: report.phaseCommit,
        closure:
          report.outcome === "corrected"
            ? {
                outcome: "corrected",
                reviewCommit: report.reviewCommit,
                oracleStep: report.oracleStep,
                closedBy: report.closedBy,
              }
            : { outcome: "unchanged", closedBy: report.closedBy },
      };
  }
}

/**
 * Close the run's stop, declared or held, as the parked review-stop names
 * it. Called once `RunResumeRequested` has made the run `running`, the phase
 * still `awaiting_review` and review-stop.json parked. In order: the close
 * base (HEAD at the phase's base, or at a held stop at the phase commit;
 * finishing a close whose commit already landed); a turn left in progress
 * settled; the gate's non-terminal steps once (a held stop's under
 * `review-gate/`), then the `authored` oracle step when the corrections
 * change an oracle file of the one pair the stop sits in; the gated tree
 * snapshotted, refused if a gate step wrote an oracle file no step judged; the handoff (the person's
 * file, the fixed handoff of an unchanged stop, or a read-only closing turn);
 * a check that the tree is still the gated one; the handoff file, the commit
 * of exactly that tree and its diff; the review reconciliation; then
 * `StopCommitted`, or `HeldStopClosed` at a held stop. A declared stop writes
 * phase-handoff.md, diff.patch and file-reconciliation.*; a held stop writes
 * correction-handoff.md, review-diff.patch and correction-reconciliation.*,
 * commits only when the worktree changed, and never writes the phase's own.
 * Any failure before the state event dispatches `StopCloseRefused` and fails
 * with `StopCloseRefusedError`. It writes neither phax-plan.json nor plan.md,
 * and never raises `PhaseHadNoChangesError`.
 */
export function closeStop(
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
    if (report.cause === "held" && report.outcome === "corrected") {
      // q-discharge-oracle-edit: flagged, never refused.
      yield* traceUnjudgedOracleEdits(
        { runId: input.runId, phaseId: input.phase.id },
        report.unjudgedOracleFiles,
      );
    }
    const stamp = { ...base, eventId: randomUUID(), occurredAt: now() };
    const result = yield* dispatch(closedEvent(stamp, report), ctx);
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
