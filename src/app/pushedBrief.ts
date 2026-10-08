import { Effect, Either } from "effect";
import { join } from "node:path";
import { renderBriefSection } from "../domain/brief/render.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import type { Shell } from "../ports/shell.js";
import type { BriefRequestFile } from "../schemas/brief.js";
import {
  describeBriefAnswerError,
  readBriefAnswer,
  readBriefRecordFile,
} from "../schemas/persisted.js";
import { queryBrief, serializeBriefRecord, serializeBriefRequest } from "./briefProvider.js";
import { PHAX_CONTEXT_DIR } from "./worktree.js";

/** The phase request file, relative to the phase worktree's root. */
export const PHASE_BRIEF_REQUEST_FILE = join(PHAX_CONTEXT_DIR, "brief-request.json");

/** The pushed brief's record, in the phase folder. */
export const PUSHED_BRIEF_RECORD = "brief-00.json";

/** Writes the stamped phase request to `<worktree>/.phax-context/brief-request.json`. */
export function writePhaseBriefRequest(
  worktreePath: string,
  request: BriefRequestFile,
): Effect.Effect<void, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    yield* fs.mkdirp(join(worktreePath, PHAX_CONTEXT_DIR));
    yield* fs.writeAtomic(
      join(worktreePath, PHASE_BRIEF_REQUEST_FILE),
      serializeBriefRequest(request),
    );
  });
}

function warnUnavailable(phaseId: string, reason: string): void {
  process.stderr.write(
    `[phax] Warning: phase "${phaseId}" — brief unavailable (${reason}). The phase runs without it.\n`,
  );
}

function unavailable(phaseId: string, reason: string): string {
  warnUnavailable(phaseId, reason);
  return renderBriefSection({ kind: "failed", reason });
}

/**
 * Re-renders the section from a recorded pushed brief, with no provider call:
 * the phase's brief is asked once per phase folder (spec §5.6).
 */
function replayRecordedBrief(
  recordPath: string,
  phaseId: string,
): Effect.Effect<string, never, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const raw = yield* Effect.either(fs.readText(recordPath));
    if (Either.isLeft(raw)) {
      return unavailable(phaseId, `${PUSHED_BRIEF_RECORD} is unreadable: ${raw.left.message}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.right) as unknown;
    } catch {
      return unavailable(phaseId, `${PUSHED_BRIEF_RECORD} is unreadable: not valid JSON`);
    }
    const record = readBriefRecordFile(recordPath, parsed);
    if (Either.isLeft(record)) {
      return unavailable(phaseId, `${PUSHED_BRIEF_RECORD} is unreadable: ${record.left.message}`);
    }
    const { outcome } = record.right;
    if (outcome.kind === "failed") {
      return renderBriefSection({ kind: "failed", reason: outcome.reason });
    }
    const answer = readBriefAnswer(outcome.answer);
    if (Either.isLeft(answer)) {
      return unavailable(phaseId, describeBriefAnswerError(answer.left));
    }
    return renderBriefSection({ kind: "answered", answer: answer.right });
  });
}

/**
 * The phase's pushed brief, as its `## Brief for this phase` section. Asks the
 * provider exactly when `<phase folder>/brief-00.json` is absent and records
 * the call there; otherwise re-renders from the record. A failing provider, or
 * a record phax cannot write, is a warning: this never fails the phase.
 */
export function pushBrief(input: {
  readonly command: string;
  readonly request: BriefRequestFile;
  readonly worktreePath: string;
  readonly phaseFolderPath: string;
  readonly phaseId: string;
}): Effect.Effect<string, never, FileSystem | Shell> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const recordPath = join(input.phaseFolderPath, PUSHED_BRIEF_RECORD);
    const recorded = yield* fs.exists(recordPath).pipe(Effect.orElseSucceed(() => false));
    if (recorded) return yield* replayRecordedBrief(recordPath, input.phaseId);

    const outcome = yield* queryBrief({
      command: input.command,
      request: input.request,
      cwd: input.worktreePath,
    });
    yield* fs.writeAtomic(recordPath, serializeBriefRecord("pushed", input.request, outcome)).pipe(
      Effect.catchAll((e) =>
        Effect.sync(() => {
          process.stderr.write(
            `[phax] Warning: phase "${input.phaseId}" — failed to write ${PUSHED_BRIEF_RECORD} (${e.message}).\n`,
          );
        }),
      ),
    );
    if (outcome.kind === "failed") return unavailable(input.phaseId, outcome.reason);
    return renderBriefSection({ kind: "answered", answer: outcome.decoded });
  });
}
