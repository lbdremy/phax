import { Effect } from "effect";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { ClaudeSessionId, PhaseId, RunId } from "../domain/branded.js";
import {
  type ClaudeInvocationError,
  type ClaudeSessionIdMissingError,
  type RateLimitError,
  type RegistryCorruptionError,
  type SetupCommandFailedError,
  type UsageLimitError,
} from "../domain/errors.js";
import type { PhaxEvent } from "../domain/events.js";
import { Backend, type AgentRunOptions } from "../ports/backend.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { Git, type GitError } from "../ports/git.js";
import { Shell, type ShellError } from "../ports/shell.js";
import { Tracer } from "../ports/tracer.js";
import { SystemTelemetry } from "../ports/systemTelemetry.js";
import { dispatch } from "./dispatcher.js";

const REQUIRED_HANDOFF_SECTIONS = [
  "## What was delivered",
  "## Key decisions and why",
  "## Exact locations (file paths and exported names)",
  "## What the next phase needs to know",
];

function buildHandoffPrompt(): string {
  return [
    "# Generate phase handoff",
    "",
    "Gates have passed. Now write `.phax-context/phase-handoff.md` (the `.phax-context/` folder is gitignored phax metadata — do not write at the worktree root).",
    "",
    "Consult `.skills/phax-phase-handoff.md` for the expected format.",
    "",
    "The file must include these four sections in order:",
    ...REQUIRED_HANDOFF_SECTIONS.map((s) => `- \`${s}\``),
    "",
    "Be concise and precise. Focus on what the next phase needs to know.",
    "Do not repeat the phase instructions — only what was actually done and decided.",
    "Do not summarise the session transcript — write facts and decisions only.",
  ].join("\n");
}

function validateHandoffSections(content: string): string[] {
  return REQUIRED_HANDOFF_SECTIONS.filter((section) => !content.includes(section));
}

export class HandoffValidationError extends Error {
  readonly _tag = "HandoffValidationError";
  constructor(
    readonly missingSections: string[],
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
}

export function generatePhaseHandoff(
  opts: GenerateHandoffOptions,
): Effect.Effect<
  void,
  | FsError
  | GitError
  | ShellError
  | SetupCommandFailedError
  | ClaudeInvocationError
  | ClaudeSessionIdMissingError
  | RateLimitError
  | UsageLimitError
  | HandoffValidationError
  | RegistryCorruptionError,
  FileSystem | Backend | Git | Shell | Tracer | SystemTelemetry
> {
  const { sessionId, agentOptions, phaseFolderPath, worktreePath, runPath, shortName, phaseId } =
    opts;

  return Effect.gen(function* () {
    const backend = yield* Backend;
    const fs = yield* FileSystem;

    const handoffPrompt = buildHandoffPrompt();

    yield* backend.resumeAgentSession(sessionId, handoffPrompt, {
      model: agentOptions.model,
      effort: agentOptions.effort,
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

    // Persist a copy in the phax run folder so later phases (via handoffInjection)
    // and post-run consumers (review, archive) can read it without depending on
    // the gitignored `.phax-context/` folder in the worktree.
    yield* fs.writeAtomic(join(phaseFolderPath, "phase-handoff.md"), content);
  });
}
