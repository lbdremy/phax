import { Effect } from "effect";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { ClaudeSessionId, PhaseId, RunId } from "../domain/branded.js";
import { deviationPaths, findUnexplainedDeviations } from "../domain/reconciliation/explained.js";
import type { ReconciliationResult } from "../domain/reconciliation/types.js";
import {
  type AgentInvocationError,
  type AgentSessionIdMissingError,
  type RateLimitError,
  type RegistryCorruptionError,
  type SecurityEnforcementError,
  type SetupCommandFailedError,
  type UsageLimitError,
} from "../domain/errors.js";
import type { PhaxEvent } from "../domain/events.js";
import { Backend, type AgentRunOptions } from "../ports/backend.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { Git, type GitError } from "../ports/git.js";
import { Shell, type ShellError } from "../ports/shell.js";
import { SystemTelemetry } from "../ports/systemTelemetry.js";
import { dispatch } from "./dispatcher.js";
import { HANDOFF_GUIDANCE_LINES, REQUIRED_HANDOFF_SECTIONS } from "./handoffGuidance.js";

function buildDeviationBlock(result: ReconciliationResult): string {
  if (!result.hasDeviations) {
    return "phax found no file-plan deviations for this phase.";
  }

  const lines: string[] = [
    "phax compared the files you changed against this phase's plan and found these deviations.",
    "Justify each one under `## What the next phase needs to know`:",
    "",
  ];
  if (result.unplannedCreated.length > 0) {
    lines.push(`Unplanned files created: ${result.unplannedCreated.join(", ")}`);
  }
  if (result.unplannedEdited.length > 0) {
    lines.push(`Unplanned files edited: ${result.unplannedEdited.join(", ")}`);
  }
  if (result.missingPlannedCreate.length > 0) {
    lines.push(`Planned to create but not created: ${result.missingPlannedCreate.join(", ")}`);
  }
  if (result.missingPlannedEdit.length > 0) {
    lines.push(`Planned to edit but not edited: ${result.missingPlannedEdit.join(", ")}`);
  }
  return lines.join("\n");
}

function buildHandoffPrompt(reconciliation: ReconciliationResult): string {
  return [
    "# Generate phase handoff",
    "",
    "Gates have passed. Now write `.phax-context/phase-handoff.md` (the `.phax-context/` folder is gitignored phax metadata — do not write at the worktree root).",
    "",
    "The file must include these four sections in order:",
    ...REQUIRED_HANDOFF_SECTIONS.map((s) => `- \`${s}\``),
    "",
    "Guidance for each section:",
    ...HANDOFF_GUIDANCE_LINES,
    "",
    "Be concise and precise. Focus on what the next phase needs to know.",
    "Do not repeat the phase instructions — only what was actually done and decided.",
    "Do not summarise the session transcript — write facts and decisions only.",
    "",
    "File-plan deviation report:",
    buildDeviationBlock(reconciliation),
  ].join("\n");
}

function validateHandoffSections(content: string): string[] {
  return REQUIRED_HANDOFF_SECTIONS.filter((section) => !content.includes(section));
}

export class HandoffValidationError extends Error {
  readonly _tag = "HandoffValidationError";
  constructor(
    readonly missingSections: readonly string[],
    readonly worktreePath: string,
  ) {
    super(`phase-handoff.md is missing required sections: ${missingSections.join(", ")}`);
  }
}

export interface GenerateHandoffOptions {
  readonly sessionId: ClaudeSessionId;
  readonly agentOptions: AgentRunOptions;
  readonly phaseFolderPath: string;
  readonly worktreePath: string;
  /** Run folder; the dispatcher reads run-status.json from here. */
  readonly runPath: string;
  /** Run short name, for dispatch context and event base. */
  readonly shortName: string;
  /** Current phase id, for dispatch context and event base. */
  readonly phaseId: string;
  /** Reconciliation result computed after commit, injected into the handoff prompt. */
  readonly reconciliation: ReconciliationResult;
}

export function generatePhaseHandoff(
  opts: GenerateHandoffOptions,
): Effect.Effect<
  void,
  | FsError
  | GitError
  | ShellError
  | SetupCommandFailedError
  | AgentInvocationError
  | AgentSessionIdMissingError
  | RateLimitError
  | UsageLimitError
  | SecurityEnforcementError
  | HandoffValidationError
  | RegistryCorruptionError,
  FileSystem | Backend | Git | Shell | SystemTelemetry
> {
  const {
    sessionId,
    agentOptions,
    phaseFolderPath,
    worktreePath,
    runPath,
    shortName,
    phaseId,
    reconciliation,
  } = opts;

  return Effect.gen(function* () {
    const backend = yield* Backend;
    const fs = yield* FileSystem;

    const handoffPrompt = buildHandoffPrompt(reconciliation);

    yield* backend.resumeAgentSession(sessionId, handoffPrompt, {
      ...agentOptions,
      cwd: worktreePath,
      outputJsonlPath: join(phaseFolderPath, "handoff-generation.jsonl"),
      phaseFolderPath,
    });

    const handoffPath = join(worktreePath, ".phax-context", "phase-handoff.md");
    const exists = yield* fs.exists(handoffPath);

    const dispatchHandoffMissing = (missing: readonly string[]) =>
      Effect.gen(function* () {
        const event: PhaxEvent = {
          eventId: randomUUID(),
          occurredAt: new Date().toISOString(),
          run: shortName as RunId,
          phase: phaseId as PhaseId,
          type: "HandoffMissing",
          missingSections: missing,
        };
        yield* dispatch(event, {
          runPath,
          shortName,
          phaseFolderPath,
          phaseId,
        });
      });

    if (!exists) {
      yield* dispatchHandoffMissing(REQUIRED_HANDOFF_SECTIONS);
      return yield* Effect.fail(
        new HandoffValidationError(REQUIRED_HANDOFF_SECTIONS, worktreePath),
      );
    }

    const content = yield* fs.readText(handoffPath);
    const missingSections = validateHandoffSections(content);
    if (missingSections.length > 0) {
      yield* dispatchHandoffMissing(missingSections);
      return yield* Effect.fail(new HandoffValidationError(missingSections, worktreePath));
    }

    const unexplained = findUnexplainedDeviations(deviationPaths(reconciliation), content);
    if (unexplained.length > 0) {
      yield* Effect.logWarning(
        `[phax] Handoff for ${phaseId} did not explain file-plan deviations: ${unexplained.join(", ")}`,
      );
    }

    // Persist a copy in the phax run folder so later phases (via handoffInjection)
    // and post-run consumers (review, archive) can read it without depending on
    // the gitignored `.phax-context/` folder in the worktree.
    yield* fs.writeAtomic(join(phaseFolderPath, "phase-handoff.md"), content);
  });
}
