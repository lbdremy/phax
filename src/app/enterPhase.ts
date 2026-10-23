// `phax enter-phase`: the command that continues a phase's session, or starts a
// fresh one, in the phase's worktree. This use case decides which command and
// which notices; it never spawns. Five cases:
//   - the stopped phase of a run in `awaiting_review`: the current session's
//     continue command, or the fresh start (with `newSession`, after a new
//     read-only first turn under the run lock);
//   - a phase awaiting review whose run is not: a close is running, refused;
//   - a closed interactive phase: its current recorded session;
//   - a headless phase: its agent binding's session, under its posture;
//   - `newSession` on a phase that is not stopped: refused.
// Every continue command carries the phase's posture, rebuilt from its
// `security.json` (q-enter-phase-posture, carry-posture); a phase whose
// `security.json` cannot be read is refused rather than opened unconfined.
import { Effect, Either } from "effect";
import { join } from "node:path";
import { decodeShortName, type RunId } from "../domain/branded.js";
import type { LockConflictError } from "../domain/errors.js";
import {
  buildDeclaredReviewStop,
  declaredSessionOrigin,
} from "../domain/interactive/reviewStop.js";
import { freshStartPrompt } from "../domain/interactive/turnPrompts.js";
import { runKey } from "../domain/runRef.js";
import type { RunReviewInfo } from "../domain/runReviewInfo.js";
import { codexModelId } from "../domain/session/codexFlags.js";
import { getSessionAdapter } from "../domain/session/index.js";
import type { StopCommand, StopCommandResult, StopPosture } from "../domain/session/types.js";
import type { Backend } from "../ports/backend.js";
import type { FileSystem, FsError } from "../ports/fs.js";
import type { Git, GitError } from "../ports/git.js";
import type { Lock } from "../ports/lock.js";
import type { SystemTelemetry } from "../ports/systemTelemetry.js";
import type { InteractiveSession } from "../schemas/interactiveSession.js";
import type { ProviderId } from "../schemas/providerId.js";
import type { ProviderConfig } from "../schemas/providerConfig.js";
import type { PhaseStatus } from "../schemas/status.js";
import { readAgentBinding } from "./agentBinding.js";
import {
  readInteractiveSession,
  readModelResolution,
  readPhasePosture,
  readReviewStop,
  refreshReviewStop,
  type PhaseModel,
} from "./interactiveFiles.js";
import { asReviewStopCommand, runFirstTurn } from "./interactiveStop.js";
import { withRunLock } from "./lock.js";
import { resolveRun } from "./resolveRunInfo.js";

export interface EnterPhaseInput {
  readonly namespace: string;
  readonly shortName: string;
  /** The run as the command resolved it. Only a stopped run is read again, under the lock. */
  readonly info: RunReviewInfo;
  readonly phaseId: string;
  /** Run a new read-only first turn at the stop first. */
  readonly newSession: boolean;
  readonly stateRoot: string;
  readonly providerConfig: ProviderConfig;
}

/** A line for the person: `warning` ones go through the output's warn. */
export interface Notice {
  readonly kind: "info" | "warning";
  readonly text: string;
}

export type EnterPhaseResult =
  /** Spawn `command` in its cwd after printing `announce` and the notices. */
  | {
      readonly kind: "command";
      readonly command: StopCommand;
      readonly announce: string;
      readonly notices: readonly Notice[];
    }
  /** Print `message` as an error and exit 1. */
  | { readonly kind: "refused"; readonly message: string };

const refused = (message: string): EnterPhaseResult => ({ kind: "refused", message });

const info = (text: string): Notice => ({ kind: "info", text });
const warning = (text: string): Notice => ({ kind: "warning", text });

const TRUST_NOTE =
  "The first time codex opens this worktree, it asks you to trust the directory, then to review its hooks.";

const qualifiedName = (input: EnterPhaseInput): string => runKey(input.namespace, input.shortName);

const closeInProgress = (input: EnterPhaseInput): EnterPhaseResult =>
  refused(
    `Phase "${input.phaseId}" of run "${qualifiedName(input)}" is being closed: the close of its stop is in progress. ` +
      `Wait for it to end, or run \`phax resume ${input.shortName}\` to take it up again.`,
  );

const notStopped = (input: EnterPhaseInput, phase: PhaseStatus): EnterPhaseResult =>
  refused(
    `--new-session needs a phase that is stopped for review; phase "${input.phaseId}" of run "${qualifiedName(input)}" is ${phase.state}.`,
  );

// ---------------------------------------------------------------------------
// Commands

type PhasePosture = Exclude<StopPosture, "none">;

interface CommandContext {
  readonly phaseId: string;
  readonly provider: ProviderId;
  readonly model: string;
  readonly effort: string;
  readonly cwd: string;
  readonly posture: PhasePosture;
  readonly providerConfig: ProviderConfig;
}

interface SessionCommands {
  /** Null when no session is current. */
  readonly continue: StopCommandResult | null;
  readonly freshStart: StopCommandResult;
}

function sessionCommands(ctx: CommandContext, sessionId: string | null): SessionCommands {
  const adapter = getSessionAdapter(ctx.provider);
  const entry = ctx.providerConfig.providers[ctx.provider];
  const model =
    ctx.provider === "codex-cli" && entry !== undefined
      ? codexModelId(entry, ctx.model)
      : ctx.model;
  const opts = { cwd: ctx.cwd, model, effort: ctx.effort, posture: ctx.posture } as const;
  const modelEnvVar = entry?.modelEnvVar;
  return {
    continue: sessionId === null ? null : adapter.buildContinueCommand({ ...opts, sessionId }),
    freshStart: adapter.buildFreshStartCommand({
      ...opts,
      prompt: freshStartPrompt(ctx.phaseId),
      ...(modelEnvVar !== undefined ? { modelEnvVar } : {}),
    }),
  };
}

const commandOf = (result: StopCommandResult): StopCommand | null =>
  "unsupported" in result ? null : result;

function withTrustNote(command: StopCommand, notices: Notice[]): Notice[] {
  return command.executable === "codex" ? [...notices, info(TRUST_NOTE)] : notices;
}

function continueResult(
  command: StopCommand,
  provider: ProviderId,
  sessionId: string,
  notices: readonly Notice[],
  how?: string,
): EnterPhaseResult {
  return {
    kind: "command",
    command,
    announce: `Continuing ${provider} session ${sessionId}${how ?? ""} in ${command.cwd}`,
    notices: withTrustNote(command, [...notices]),
  };
}

// ---------------------------------------------------------------------------
// The phase's recorded model, posture and session

interface PhaseFacts {
  readonly model: PhaseModel;
  readonly effort: string;
  readonly posture: PhasePosture;
}

// A phase with no model-resolution.json or security.json cannot be re-entered
// under its own posture, so it is refused rather than opened unconfined.
function readPhaseFacts(
  phaseFolder: string,
  phase: PhaseStatus,
): Effect.Effect<PhaseFacts | { readonly refusal: string }, never, FileSystem> {
  return Effect.gen(function* () {
    const model = yield* Effect.either(readModelResolution(phaseFolder));
    if (Either.isLeft(model)) return { refusal: unreadable(phase, model.left.message) };
    const posture = yield* Effect.either(readPhasePosture(phaseFolder));
    if (Either.isLeft(posture)) return { refusal: unreadable(phase, posture.left.message) };
    return {
      model: model.right,
      effort: model.right.effort ?? phase.effort,
      posture: posture.right,
    };
  });
}

const unreadable = (phase: PhaseStatus, why: string): string =>
  `Cannot rebuild the posture of phase "${phase.phaseId}": ${why}. phax will not open its session unconfined.`;

function currentSessionOf(session: InteractiveSession | null) {
  return session?.current ?? null;
}

// ---------------------------------------------------------------------------
// Planning

function planInteractive(
  input: EnterPhaseInput,
  phase: PhaseStatus,
  stopped: boolean,
): Effect.Effect<EnterPhaseResult, FsError, FileSystem> {
  return Effect.gen(function* () {
    const phaseFolder = join(input.info.runPath, input.phaseId);
    const facts = yield* readPhaseFacts(phaseFolder, phase);
    if ("refusal" in facts) return refused(facts.refusal);
    const cwd = phase.worktreePath;
    if (cwd === undefined) {
      return refused(`Phase "${input.phaseId}" has no worktree recorded.`);
    }
    const session = yield* readInteractiveSession(phaseFolder);
    const current = currentSessionOf(session);
    const { provider } = facts.model;
    const adapter = getSessionAdapter(provider);
    const commands = sessionCommands(
      {
        phaseId: input.phaseId,
        provider,
        model: facts.model.model,
        effort: facts.effort,
        cwd,
        posture: facts.posture,
        providerConfig: input.providerConfig,
      },
      current?.sessionId ?? null,
    );

    if (current !== null && adapter.interactiveResume === "verified") {
      if (commands.continue === null || "unsupported" in commands.continue) {
        return refused(commands.continue?.unsupported ?? "No continue command.");
      }
      return continueResult(commands.continue, provider, current.sessionId, []);
    }

    if (!stopped) {
      // A closed phase has no fresh start to offer: nothing is waiting for it.
      return refused(
        commands.continue !== null && "unsupported" in commands.continue
          ? commands.continue.unsupported
          : `Phase "${input.phaseId}" recorded no session to continue.`,
      );
    }
    const fresh = commandOf(commands.freshStart);
    if (fresh === null) {
      return refused(
        "unsupported" in commands.freshStart ? commands.freshStart.unsupported : "No command.",
      );
    }
    const notices: Notice[] =
      current === null
        ? [info("No session is current: the first turn did not answer.")]
        : [
            warning(
              `${provider}'s interactive resume is unverified: the session started with this command ` +
                `will not be captured, and the current session ${current.sessionId} is kept for the closing turn.`,
            ),
          ];
    return {
      kind: "command",
      command: fresh,
      announce: `Starting a new ${provider} session in ${fresh.cwd}`,
      notices: withTrustNote(fresh, notices),
    };
  });
}

function planHeadless(
  input: EnterPhaseInput,
  phase: PhaseStatus,
): Effect.Effect<EnterPhaseResult, FsError, FileSystem> {
  return Effect.gen(function* () {
    const phaseFolder = join(input.info.runPath, input.phaseId);
    const bindingResult = yield* Effect.promise(() => readAgentBinding(phaseFolder));
    if (Either.isLeft(bindingResult)) {
      return refused(
        `No agent binding found for phase "${input.phaseId}" of run "${qualifiedName(input)}": ${bindingResult.left}`,
      );
    }
    const binding = bindingResult.right;
    if (!binding.sessionId) {
      return refused(
        `No session ID captured for this ${binding.provider} phase "${input.phaseId}"; cannot resume interactively.`,
      );
    }
    const posture = yield* Effect.either(readPhasePosture(phaseFolder));
    if (Either.isLeft(posture)) return refused(unreadable(phase, posture.left.message));
    const commands = sessionCommands(
      {
        phaseId: input.phaseId,
        provider: binding.provider,
        model: binding.model,
        effort: binding.effort,
        cwd: binding.worktreePath,
        posture: posture.right,
        providerConfig: input.providerConfig,
      },
      binding.sessionId,
    );
    if (commands.continue === null || "unsupported" in commands.continue) {
      return refused(commands.continue?.unsupported ?? "No continue command.");
    }
    return continueResult(commands.continue, binding.provider, binding.sessionId, []);
  });
}

/**
 * The command `phax enter-phase` would run, and its notices, or why it
 * refuses. It reads files only: it never takes the lock, runs a turn or
 * spawns. `newSession` here only decides the refusal for a phase that is not
 * stopped; the turn itself belongs to `enterPhase`.
 */
export function planEnterPhase(
  input: EnterPhaseInput,
): Effect.Effect<EnterPhaseResult, FsError, FileSystem> {
  const phase = input.info.phaseStatuses.find((p) => p.phaseId === input.phaseId);
  if (phase === undefined) {
    return Effect.succeed(
      refused(`Phase "${input.phaseId}" not found in run "${qualifiedName(input)}"`),
    );
  }
  if (phase.state === "awaiting_review") {
    return input.info.runState === "awaiting_review"
      ? planInteractive(input, phase, true)
      : Effect.succeed(closeInProgress(input));
  }
  if (input.newSession) return Effect.succeed(notStopped(input, phase));
  return phase.mode === "interactive"
    ? planInteractive(input, phase, false)
    : planHeadless(input, phase);
}

// ---------------------------------------------------------------------------
// --new-session

const describeFirstTurn = (
  turn: InteractiveSession["firstTurns"][number],
  model: PhaseModel,
  effort: string,
): Notice => {
  switch (turn.outcome) {
    case "answered":
      return info(
        `First turn: new ${model.provider} session ${turn.sessionId} (${model.model}, ${effort}) — first reading written`,
      );
    case "refused-change":
      return warning(
        `First turn refused: it changed ${turn.changedPaths.join(", ")}. The worktree is restored; ` +
          `the turn's versions are kept in ${turn.keptAt}. The previous session stays current.`,
      );
    case "failed":
      return warning(
        `First turn failed (${turn.reason}${turn.resetAt !== null ? `, resets ${turn.resetAt}` : ""}): ${turn.detail} ` +
          `The previous session stays current.`,
      );
  }
};

// The new turn, under the run lock the caller holds. Returns the turn's notice,
// or a refusal when the run is no longer waiting at this phase.
function runNewSessionTurn(
  input: EnterPhaseInput,
): Effect.Effect<
  { readonly notice: Notice } | { readonly refusal: EnterPhaseResult },
  FsError | GitError,
  Backend | FileSystem | Git | SystemTelemetry
> {
  return Effect.gen(function* () {
    // The run as it stands now: a close may have started since the command read it.
    const shortName = decodeShortName(input.shortName);
    if (Either.isLeft(shortName)) {
      return { refusal: refused(`"${input.shortName}" is not a valid run short name.`) };
    }
    const again = resolveRun(input.namespace, shortName.right, input.stateRoot);
    if (Either.isLeft(again)) return { refusal: refused(again.left) };
    const fresh = again.right;
    const phase = fresh.phaseStatuses.find((p) => p.phaseId === input.phaseId);
    if (phase === undefined) {
      return {
        refusal: refused(`Phase "${input.phaseId}" not found in run "${qualifiedName(input)}"`),
      };
    }
    if (fresh.runState !== "awaiting_review" || phase.state !== "awaiting_review") {
      return {
        refusal:
          phase.state === "awaiting_review" ? closeInProgress(input) : notStopped(input, phase),
      };
    }

    const phaseFolder = join(fresh.runPath, input.phaseId);
    const stop = yield* readReviewStop(fresh.runPath, phaseFolder);
    if (stop === null || stop.path.endsWith("review-stop.closing.json")) {
      return { refusal: closeInProgress(input) };
    }
    const facts = yield* readPhaseFacts(phaseFolder, phase);
    if ("refusal" in facts) return { refusal: refused(facts.refusal) };
    const worktree = phase.worktreePath;
    if (worktree === undefined) {
      return { refusal: refused(`Phase "${input.phaseId}" has no worktree recorded.`) };
    }
    const { provider, model } = facts.model;
    const result = yield* runFirstTurn({
      runId: fresh.runId as RunId,
      runPath: fresh.runPath,
      phaseFolder,
      worktree,
      phase: { id: input.phaseId },
      provider,
      model,
      effort: facts.effort,
      policy: facts.posture.policy,
      origin: "new-session",
    });

    if (result.turn.outcome === "answered" && result.session.current !== null) {
      const { current } = result.session;
      const adapter = getSessionAdapter(provider);
      const commands = sessionCommands(
        {
          phaseId: input.phaseId,
          provider,
          model,
          effort: facts.effort,
          cwd: worktree,
          posture: facts.posture,
          providerConfig: input.providerConfig,
        },
        current.sessionId,
      );
      const freshStart = commandOf(commands.freshStart);
      const existing = stop.reviewStop;
      // A held stop's document is refreshed with the held commands; no held
      // stop exists until a later phase reaches one.
      if (freshStart !== null && existing.cause === "declared") {
        const continueCommand = commands.continue === null ? null : commandOf(commands.continue);
        const rebuilt = buildDeclaredReviewStop({
          run: existing.run,
          phase: existing.phase,
          worktree: existing.worktree,
          mainCheckout: existing.commands.enterPhase.cwd,
          seed: existing.seed,
          firstReading: result.firstReading?.path ?? existing.firstReading,
          session: {
            provider: current.provider,
            sessionId: current.sessionId,
            origin: declaredSessionOrigin(current.origin),
          },
          interactiveResume: adapter.interactiveResume,
          continueCommand: continueCommand === null ? null : asReviewStopCommand(continueCommand),
          freshStart: asReviewStopCommand(freshStart),
          lastClose: existing.lastClose,
        });
        yield* refreshReviewStop(fresh.runPath, { ...rebuilt, closeBase: existing.closeBase });
      }
    }
    return { notice: describeFirstTurn(result.turn, facts.model, facts.effort) };
  });
}

/**
 * `phax enter-phase`: the result `planEnterPhase` gives, after a new
 * read-only first turn when `newSession` targets the stopped phase of a run
 * in `awaiting_review`. The turn holds the run lock and ends before the
 * command is returned; a held lock fails with the lock conflict (exit 7). A
 * turn that fails or is refused leaves the previous current session,
 * first-reading.md and review-stop.json as they were, and the previous
 * session's command is returned.
 */
export function enterPhase(
  input: EnterPhaseInput,
): Effect.Effect<
  EnterPhaseResult,
  FsError | GitError | LockConflictError,
  Backend | FileSystem | Git | Lock | SystemTelemetry
> {
  return Effect.gen(function* () {
    const phase = input.info.phaseStatuses.find((p) => p.phaseId === input.phaseId);
    const isStop = phase?.state === "awaiting_review" && input.info.runState === "awaiting_review";
    if (!input.newSession || !isStop) return yield* planEnterPhase(input);

    const turned = yield* withRunLock(qualifiedName(input), runNewSessionTurn(input));
    if ("refusal" in turned) return turned.refusal;

    const planned = yield* planEnterPhase(input);
    return planned.kind === "command"
      ? { ...planned, notices: [turned.notice, ...planned.notices] }
      : planned;
  });
}
