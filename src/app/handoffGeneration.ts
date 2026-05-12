import { Effect, Either } from "effect";
import { join } from "node:path";
import type { ClaudeSessionId } from "../domain/branded.js";
import { type ClaudeInvocationError, type ClaudeSessionIdMissingError } from "../domain/errors.js";
import { Backend, type AgentRunOptions } from "../ports/backend.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { decodePhaseStatus, encodePhaseStatus } from "../schemas/status.js";

const REQUIRED_HANDOFF_SECTIONS = [
  "## What was done",
  "## Key decisions",
  "## Handoff to next phase",
];

function buildHandoffPrompt(): string {
  return [
    "# Generate phase handoff",
    "",
    "Gates have passed. Now write `phase-handoff.md` in the current directory.",
    "",
    "Consult `.skills/phax-phase-handoff.md` for the expected format.",
    "",
    "The file must include these sections:",
    ...REQUIRED_HANDOFF_SECTIONS.map((s) => `- \`${s}\``),
    "",
    "Be concise and precise. Focus on what the next phase needs to know.",
    "Do not repeat the phase instructions — only what was actually done and decided.",
  ].join("\n");
}

function validateHandoffSections(content: string): string[] {
  return REQUIRED_HANDOFF_SECTIONS.filter((section) => !content.includes(section));
}

function updatePhaseStateHandoffFailed(
  phaseFolderPath: string,
): Effect.Effect<void, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const statusPath = join(phaseFolderPath, "status.json");
    const raw = yield* fs.readText(statusPath);

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return;
    }

    const decoded = decodePhaseStatus(parsed);
    if (Either.isRight(decoded)) {
      const updated = {
        ...decoded.right,
        state: "handoff_failed" as const,
        updatedAt: new Date().toISOString(),
      };
      yield* fs.writeAtomic(statusPath, JSON.stringify(encodePhaseStatus(updated), null, 2));
    }
  });
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
}

export function generatePhaseHandoff(
  opts: GenerateHandoffOptions,
): Effect.Effect<
  void,
  FsError | ClaudeInvocationError | ClaudeSessionIdMissingError | HandoffValidationError,
  FileSystem | Backend
> {
  const { sessionId, agentOptions, phaseFolderPath, worktreePath } = opts;

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

    const handoffPath = join(worktreePath, "phase-handoff.md");
    const exists = yield* fs.exists(handoffPath);
    if (!exists) {
      yield* updatePhaseStateHandoffFailed(phaseFolderPath);
      return yield* Effect.fail(
        new HandoffValidationError(REQUIRED_HANDOFF_SECTIONS, worktreePath),
      );
    }

    const content = yield* fs.readText(handoffPath);
    const missingSections = validateHandoffSections(content);
    if (missingSections.length > 0) {
      yield* updatePhaseStateHandoffFailed(phaseFolderPath);
      return yield* Effect.fail(new HandoffValidationError(missingSections, worktreePath));
    }
  });
}
