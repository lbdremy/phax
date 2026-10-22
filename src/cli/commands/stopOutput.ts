// The view of a declared stop for `phax run` and `phax resume`: the stop a
// run reached, a close that committed, and a close that was refused. Pure
// formatting over the reports the use cases return; nothing here reads stdin.
import type { ClosedStop } from "../../app/executePlan.js";
import type { HandoffSource } from "../../app/closeStop.js";
import type { DeclaredStopReport, RefusedClose } from "../../domain/errors.js";
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

/** The lines `phax run` and `phax resume` print when a run stops at a declared phase. */
export function renderDeclaredStop(report: DeclaredStopReport): string[] {
  const { reviewStop } = report;
  const { commands } = reviewStop;
  const sessionCommand = commands.continue ?? commands.freshStart;
  const lines: string[] = [
    `◐ ${reviewStop.phase.id}  ${reviewStop.phase.title} — awaiting review (declared: interactive phase)`,
    "",
    ...firstReadingLines(report),
    "",
    `  Worktree:  ${reviewStop.worktree}`,
    `  Seed:      ${reviewStop.seed}`,
    commands.continue !== null ? "  Continue the session phax started:" : "  Start a session:",
    `    ${commandLine(sessionCommand)}`,
  ];
  if (isCodex(sessionCommand)) lines.push(`    ${TRUST_NOTE}`);
  if (commands.continue === null && report.unverifiedProvider) {
    lines.push(
      "    (this provider's interactive resume is unverified: this session's transcript will not be captured)",
    );
  }
  lines.push(
    `    or: ${phaxCommand(commands.enterPhase)}`,
    "  Or work by hand or with any agent. Then, from the main checkout:",
    `    ${phaxCommand(commands.close)}`,
    `  Stop: ${report.reviewStopPath}`,
  );
  return lines;
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

/** The lines printed once a declared stop's close has committed. */
export function renderStopClosed(closed: ClosedStop): string[] {
  const { report } = closed;
  const changed =
    report.changedPaths.length === 0
      ? "no file changed by review"
      : `${report.changedPaths.length} file(s) changed by review`;
  const lines: string[] = [`${closed.phaseId} (declared): ${changed}`];
  if (report.restoredClosingTurn !== null) {
    lines.push(
      `  restored an interrupted closing turn's edits (${report.restoredClosingTurn.paths.join(", ")}); its versions are in ${report.restoredClosingTurn.keptAt}`,
    );
  }
  for (const step of report.gateSteps) {
    lines.push(`  gate  ${step.command}   ${step.result}`);
  }
  lines.push(`  handoff     ${handoffLine(report.handoffSource)}`);
  lines.push(
    `✓ ${closed.phaseId}  ${closed.phaseTitle}   committed  ${report.commit.slice(0, 7)}  (${report.outcome})`,
  );
  return lines;
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
