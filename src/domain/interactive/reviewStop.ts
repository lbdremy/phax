import type { ProviderId } from "../../schemas/providerId.js";
import type { DeclaredReviewStop, LastClose, ReviewStopCommand } from "../../schemas/reviewStop.js";
import type { InteractiveResumeSupport } from "../session/types.js";

// The in-memory `review-stop` document of a declared stop, before the app
// stamps `$schema` and writes it. Pure: the app supplies the commands the
// session adapters built and the paths it wrote.

export interface DeclaredReviewStopInput {
  /** The run's qualified name, as the printed commands name it. */
  readonly run: string;
  readonly phase: {
    readonly id: string;
    readonly title: string;
    readonly position: number;
    readonly of: number;
  };
  readonly worktree: string;
  /** The main checkout: where `phax` commands run from. */
  readonly mainCheckout: string;
  readonly seed: string;
  readonly firstReading: string | null;
  readonly session: {
    readonly provider: ProviderId;
    readonly sessionId: string;
    readonly origin: "first-turn" | "new-session";
  } | null;
  readonly interactiveResume: InteractiveResumeSupport;
  /** The adapter's continue command; ignored with no session or an unverified provider. */
  readonly continueCommand: ReviewStopCommand | null;
  readonly freshStart: ReviewStopCommand;
  readonly lastClose: LastClose | null;
}

function phaxCommand(cwd: string, ...argv: [string, ...string[]]): ReviewStopCommand {
  return { cwd, argv, env: {} };
}

/**
 * The origin of a declared phase's session. A declared phase never has a
 * builder session: that origin belongs to a held headless phase.
 */
export function declaredSessionOrigin(origin: string): "first-turn" | "new-session" {
  if (origin === "first-turn" || origin === "new-session") return origin;
  throw new Error(`A declared phase has no ${origin} session`);
}

/**
 * The review-stop value of a declared stop. `continue` is null when no
 * session is current or the session's provider has unverified interactive
 * resume; `closeBase` is null until a close records HEAD.
 */
export function buildDeclaredReviewStop(input: DeclaredReviewStopInput): DeclaredReviewStop {
  const { run, phase, mainCheckout } = input;
  return {
    run,
    state: "awaiting_review",
    cause: "declared",
    phase: {
      id: phase.id,
      title: phase.title,
      mode: "interactive",
      position: phase.position,
      of: phase.of,
    },
    firstReading: input.firstReading,
    worktree: input.worktree,
    seed: input.seed,
    session:
      input.session === null
        ? null
        : {
            provider: input.session.provider,
            sessionId: input.session.sessionId,
            origin: input.session.origin,
            interactiveResume: input.interactiveResume,
          },
    commands: {
      continue:
        input.session !== null && input.interactiveResume === "verified"
          ? input.continueCommand
          : null,
      freshStart: input.freshStart,
      enterPhase: phaxCommand(mainCheckout, "phax", "enter-phase", run, phase.id),
      close: phaxCommand(mainCheckout, "phax", "resume", run),
      reset: phaxCommand(mainCheckout, "phax", "reset-phase", run, phase.id),
    },
    lastClose: input.lastClose,
    closeBase: null,
  };
}
