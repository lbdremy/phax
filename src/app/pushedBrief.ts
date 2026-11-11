import { Effect, Result } from "effect";
import { join } from "node:path";
import { renderBriefSection } from "../domain/brief/render.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import type { OutputPort } from "../ports/output.js";
import type { Shell } from "../ports/shell.js";
import type { BriefRequestFile } from "../schemas/brief.js";
import { readBriefRecordFile } from "../schemas/persisted.js";
import type { BriefPush } from "../schemas/phaxConfig.js";
import {
  queryBrief,
  readPrintedBriefReport,
  serializeBriefRecord,
  serializeBriefRequest,
} from "./briefProvider.js";
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

function unavailable(
  output: Pick<OutputPort, "warn">,
  phaseId: string,
  reason: string,
  push: BriefPush,
): string {
  output.warn(
    `[phax] Warning: phase "${phaseId}" — brief unavailable (${reason}). The phase runs without it.`,
  );
  return renderBriefSection({ kind: "failed", reason }, push);
}

/**
 * Re-renders the section from a recorded pushed brief, with no provider call:
 * the phase's brief is asked once per phase folder (spec §5.6).
 */
function replayRecordedBrief(
  output: Pick<OutputPort, "warn">,
  recordPath: string,
  phaseId: string,
  push: BriefPush,
): Effect.Effect<string, never, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const raw = yield* Effect.result(fs.readText(recordPath));
    if (Result.isFailure(raw)) {
      return unavailable(
        output,
        phaseId,
        `${PUSHED_BRIEF_RECORD} is unreadable: ${raw.failure.message}`,
        push,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.success) as unknown;
    } catch {
      return unavailable(
        output,
        phaseId,
        `${PUSHED_BRIEF_RECORD} is unreadable: not valid JSON`,
        push,
      );
    }
    const record = readBriefRecordFile(recordPath, parsed);
    if (Result.isFailure(record)) {
      return unavailable(
        output,
        phaseId,
        `${PUSHED_BRIEF_RECORD} is unreadable: ${record.failure.message}`,
        push,
      );
    }
    const { outcome } = record.success;
    if (outcome.kind === "failed") {
      return renderBriefSection({ kind: "failed", reason: outcome.reason }, push);
    }
    const report = readPrintedBriefReport(outcome.answer);
    if (Result.isFailure(report)) return unavailable(output, phaseId, report.failure, push);
    return renderBriefSection({ kind: "answered", report: report.success }, push);
  });
}

/**
 * The phase's pushed brief, as its `## Brief for this phase` section, listing
 * what `push` chooses. Asks the provider exactly when
 * `<phase folder>/brief-00.json` is absent and records the call there;
 * otherwise re-renders from the record. A failing provider, or a record phax
 * cannot write, is a warning: this never fails the phase.
 */
export function pushBrief(input: {
  readonly command: string;
  readonly push: BriefPush;
  readonly request: BriefRequestFile;
  readonly worktreePath: string;
  readonly phaseFolderPath: string;
  readonly phaseId: string;
  /** Where a warning goes: the run's own port, so it is a note line under `--json`. */
  readonly output: Pick<OutputPort, "warn">;
}): Effect.Effect<string, never, FileSystem | Shell> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const recordPath = join(input.phaseFolderPath, PUSHED_BRIEF_RECORD);
    const recorded = yield* fs.exists(recordPath).pipe(Effect.orElseSucceed(() => false));
    if (recorded)
      return yield* replayRecordedBrief(input.output, recordPath, input.phaseId, input.push);

    const outcome = yield* queryBrief({
      command: input.command,
      request: input.request,
      cwd: input.worktreePath,
    });
    yield* fs.writeAtomic(recordPath, serializeBriefRecord("pushed", input.request, outcome)).pipe(
      Effect.catch((e) =>
        Effect.sync(() => {
          input.output.warn(
            `[phax] Warning: phase "${input.phaseId}" — failed to write ${PUSHED_BRIEF_RECORD} (${e.message}).`,
          );
        }),
      ),
    );
    if (outcome.kind === "failed")
      return unavailable(input.output, input.phaseId, outcome.reason, input.push);
    return renderBriefSection({ kind: "answered", report: outcome.decoded }, input.push);
  });
}
