// The view of a stop for `phax run` and `phax resume`: the stop a run
// reached (declared or held), a close that committed, and a close that was
// refused. Pure formatting over the reports the use cases return; nothing
// here reads stdin.
import type { ClosedStop } from "../../app/executePlan.js";
import type { HandoffSource } from "../../app/closeStop.js";
import type {
  DeclaredStopReport,
  HeldStopReport,
  RefusedClose,
  StopReport,
} from "../../domain/errors.js";
import { renderCommandLine } from "../../domain/interactive/commandLine.js";
import type { ReviewStopCommand } from "../../schemas/reviewStop.js";

const TRUST_NOTE =
  "(the first time codex opens the worktree, it asks you to trust the directory, then to review its hooks)";

const indent = (text: string, by: string): string[] =>
  text
    .trimEnd()
    .split("\n")
    .map((line) => (line.length === 0 ? "" : `${by}${line}`));

const commandLine = (command: ReviewStopCommand): string => renderCommandLine(command);

const phaxCommand = (command: ReviewStopCommand): string => command.argv.join(" ");

const isCodex = (command: ReviewStopCommand): boolean => command.argv[0] === "codex";

function firstReadingLines(report: DeclaredStopReport): string[] {
  const { reviewStop, firstTurnProblem } = report;
  if (report.firstReading !== null) {
    const session = reviewStop.session;
    const header =
      session === null
        ? "First reading:"
        : `First reading (${session.provider}, session ${session.sessionId}):`;
    return [`  ${header}`, ...indent(report.firstReading, "    ")];
  }
  if (firstTurnProblem === null) return ["  First reading: none"];
  if (firstTurnProblem.outcome === "refused-change") {
    return [
      `  First reading: none — the first turn changed ${firstTurnProblem.changedPaths.join(", ")};`,
      `    phax restored the worktree and kept the turn's versions in ${firstTurnProblem.keptAt}`,
    ];
  }
  const resets = firstTurnProblem.resetAt !== null ? ` (resets ${firstTurnProblem.resetAt})` : "";
  return [
    `  First reading: none — the first turn failed (${firstTurnProblem.reason}): ${firstTurnProblem.detail}${resets}`,
  ];
}

// The session command a stop offers, the way in through phax, the close and
// the stop document: the tail both causes print.
function sessionAndCloseLines(
  report: StopReport,
  continueHeading: string,
  enterPhaseNote: string,
): string[] {
  const { commands } = report.reviewStop;
  const sessionCommand = commands.continue ?? commands.freshStart;
  const lines: string[] = [
    commands.continue !== null ? `  ${continueHeading}` : "  Start a session:",
    `    ${commandLine(sessionCommand)}`,
  ];
  if (isCodex(sessionCommand)) lines.push(`    ${TRUST_NOTE}`);
  if (commands.continue === null && report.unverifiedProvider) {
    lines.push(
      "    (this provider's interactive resume is unverified: this session's transcript will not be captured)",
    );
  }
  lines.push(
    `    or: ${phaxCommand(commands.enterPhase)}${enterPhaseNote}`,
    "  Or work by hand or with any agent. Then, from the main checkout:",
    `    ${phaxCommand(commands.close)}`,
    `  Stop: ${report.reviewStopPath}`,
  );
  return lines;
}

/** The lines `phax run` and `phax resume` print when a run stops at a declared phase. */
function renderDeclaredStop(report: DeclaredStopReport): string[] {
  const { reviewStop } = report;
  return [
    `◐ ${reviewStop.phase.id}  ${reviewStop.phase.title} — awaiting review (declared: interactive phase)`,
    "",
    ...firstReadingLines(report),
    "",
    `  Worktree:  ${reviewStop.worktree}`,
    `  Seed:      ${reviewStop.seed}`,
    ...sessionAndCloseLines(report, "Continue the session phax started:", ""),
  ];
}

/** The lines `phax run` and `phax resume` print when a run stops at a held phase. */
function renderHeldStop(report: HeldStopReport): string[] {
  const { reviewStop } = report;
  return [
    `◐ ${reviewStop.phase.id}  ${reviewStop.phase.title} — awaiting review (held: --hold)`,
    "",
    `  Phase commit: ${report.phaseCommit.slice(0, 7)} ${report.phaseCommitSubject}`,
    `  Handoff:   ${report.handoffPath}`,
    `  Worktree:  ${reviewStop.worktree}`,
    `  Seed:      ${reviewStop.seed}`,
    ...sessionAndCloseLines(
      report,
      `Continue the session that built ${reviewStop.phase.id}:`,
      "   (add --new-session for a fresh read-only look)",
    ),
  ];
}

/** The lines `phax run` and `phax resume` print when a run stops, by its cause. */
export function renderStop(report: StopReport): string[] {
  switch (report.cause) {
    case "declared":
      return renderDeclaredStop(report);
    case "held":
      return renderHeldStop(report);
  }
}

function handoffLine(source: HandoffSource): string {
  switch (source) {
    case "person":
      return "your .phax-context/correction-handoff.md";
    case "closing-turn-resumed":
      return "closing turn: resumed the current session";
    case "closing-turn-new":
      return "closing turn: a new read-only session";
    case "unchanged":
      return "reviewed without change";
    case "earlier-close":
      return "written by an earlier close";
  }
}

const short = (sha: string): string => sha.slice(0, 7);

const changedByReview = (count: number): string =>
  count === 0 ? "no file changed by review" : `${count} file(s) changed by review`;

// The heading, the gate and handoff lines and the closing line, by cause and outcome.
function closedLines(closed: ClosedStop): {
  readonly heading: string;
  readonly handoffFile: string;
  readonly done: string;
} {
  const { report } = closed;
  const done = `✓ ${closed.phaseId}  ${closed.phaseTitle}`;
  switch (report.cause) {
    case "declared":
      return {
        heading: `${closed.phaseId} (declared): ${changedByReview(report.changedPaths.length)}`,
        handoffFile: "",
        done: `${done}   committed  ${short(report.commit)}  (${report.outcome})`,
      };
    case "held":
      switch (report.outcome) {
        case "corrected":
          return {
            heading: `${closed.phaseId} (held): ${changedByReview(report.changedPaths.length)}, on ${short(report.phaseCommit)}`,
            handoffFile: " → correction-handoff.md",
            done: `${done}   review commit  ${short(report.reviewCommit)}  on ${short(report.phaseCommit)}  (corrected)`,
          };
        case "unchanged":
          return {
            heading: `${closed.phaseId} (held): no change`,
            handoffFile: " → correction-handoff.md",
            done: `${done}   ${short(report.phaseCommit)}  (unchanged, no commit)`,
          };
      }
  }
}

/** The lines printed once a stop's close has finished, declared or held. */
export function renderStopClosed(closed: ClosedStop): string[] {
  const { report } = closed;
  const { heading, handoffFile, done } = closedLines(closed);
  const lines: string[] = [heading];
  for (const step of report.gateSteps) {
    lines.push(`  gate  ${step.command}   ${step.result}`);
  }
  lines.push(`  handoff     ${handoffLine(report.handoffSource)}${handoffFile}`);
  if (report.cause === "held" && report.outcome === "corrected") {
    for (const file of report.unjudgedOracleFiles) lines.push(unjudgedOracleWarning(file));
  }
  lines.push(done);
  return lines;
}

/** The warning for an oracle file a held discharge's corrections changed. */
function unjudgedOracleWarning(file: string): string {
  return `  warning: ${file}: an oracle file changed at the discharge; the discharge was judged before the stop, so the oracles provider does not see this change`;
}

function refusalReason(lastClose: RefusedClose): string {
  switch (lastClose.result) {
    case "gate-failed":
      return `the gate failed (${lastClose.log}); fix the worktree, then resume again`;
    case "worktree-changed":
      return `the worktree changed after the gate (${lastClose.paths.join(", ")}); resume again`;
    case "closing-turn-edited":
      return `the closing turn changed ${lastClose.paths.join(", ")}; review the change, then resume again`;
    case "handoff-invalid":
      return `.phax-context/correction-handoff.md is invalid (${lastClose.defects.join("; ")}); fix it, then resume again`;
    case "closing-answer-invalid":
      return `the closing turn gave no valid handoff (${lastClose.reason}); write .phax-context/correction-handoff.md, then resume again`;
    case "limit":
      return `the closing turn hit a limit${lastClose.resetAt !== null ? ` (resets ${lastClose.resetAt})` : ""}; resume again later`;
    case "close-error":
      return `the ${lastClose.step} step failed: ${lastClose.detail}`;
  }
}

/** The line printed when a close of the stop at `phaseId` was refused. */
export function renderStopCloseRefused(phaseId: string, lastClose: RefusedClose): string {
  return `✗ ${phaseId} stays awaiting review: ${refusalReason(lastClose)}`;
}
