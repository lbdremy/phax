import { Effect, Result } from "effect";
import { join } from "node:path";
import {
  BRIEFS_CLOSED_MARKER,
  PULLED_BRIEFS_DIR,
  nextPulledBriefName,
} from "../domain/brief/pull.js";
import { outsideBriefRequest, phaseBriefRequest } from "../domain/brief/request.js";
import { resolveTreePaths } from "../domain/treePaths.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import type { OutputPort } from "../ports/output.js";
import type { Shell } from "../ports/shell.js";
import type { BriefRequestFile, PhaseBriefRequest } from "../schemas/brief.js";
import type { BriefReport } from "../schemas/briefReport.js";
import { readBriefRecordFile, readBriefRequestFile } from "../schemas/persisted.js";
import {
  queryBrief,
  serializeBriefRecord,
  serializeDecodedBriefRecord,
  stampBriefRequest,
  type BriefOutcome,
} from "./briefProvider.js";
import {
  ensurePhaxContextDir,
  PHAX_CONTEXT_DIR,
  phaxContextDirState,
  readPhaxContextFile,
} from "./phaxContext.js";
import { PHASE_BRIEF_REQUEST_FILE } from "./pushedBrief.js";

/** What one `phax brief` call comes to. `files` is null for the phase's brief. */
export type PullBriefResult =
  | { readonly kind: "refused"; readonly message: string }
  | {
      readonly kind: "answered";
      readonly report: BriefReport;
      readonly files: readonly string[] | null;
      readonly recordWarning?: string;
    }
  | { readonly kind: "failed"; readonly reason: string; readonly recordWarning?: string };

const refused = (message: string): PullBriefResult => ({ kind: "refused", message });

const notARequest = (reason: string): string =>
  `${PHASE_BRIEF_REQUEST_FILE} is not a brief request: ${reason}`;

/**
 * The phase's request from `<root>/.phax-context/brief-request.json`: the
 * pull's only source of phase identity. `undefined` when the file is absent
 * (the call is outside a phase); a string when it does not hold the phase's
 * own request (spec Q8).
 */
function readPhaseRequest(
  root: string,
): Effect.Effect<PhaseBriefRequest | string | undefined, never, FileSystem> {
  return Effect.gen(function* () {
    const found = yield* Effect.result(readPhaxContextFile(root, PHASE_BRIEF_REQUEST_FILE));
    if (Result.isFailure(found)) return notARequest(found.failure.message);
    const file = found.success;
    if (file.kind === "absent") return undefined;
    if (file.kind === "linked") {
      return notARequest(`it is a symbolic link (→ ${file.target}); phax does not read it`);
    }
    if (file.kind === "not-a-file") return notARequest("it is not a regular file");
    let parsed: unknown;
    try {
      parsed = JSON.parse(file.text) as unknown;
    } catch {
      return notARequest("not valid JSON");
    }
    const read = readBriefRequestFile(PHASE_BRIEF_REQUEST_FILE, parsed);
    if (Result.isFailure(read)) {
      const prefix = `${read.failure.file}: `;
      const { message } = read.failure;
      return notARequest(message.startsWith(prefix) ? message.slice(prefix.length) : message);
    }
    const request = read.success;
    if (!("phase" in request)) return notARequest("it carries no phase facts");
    if (request.files !== null) return notARequest("its files is not null");
    return request;
  });
}

/**
 * Records one pulled brief as the next free `.phax-context/briefs/brief-NN.json`,
 * claiming each number exclusively so concurrent pulls never overwrite each
 * other. Nothing is recorded once the phase's briefs are collected (the
 * `closed` marker, spec Q7). Returns a warning instead of failing.
 */
function recordPull(
  root: string,
  request: BriefRequestFile,
  outcome: BriefOutcome,
): Effect.Effect<string | undefined, never, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const dir = yield* ensurePhaxContextDir(root, BRIEFS_SUBDIR);
    if ((yield* fs.entryKind(join(dir, BRIEFS_CLOSED_MARKER))).kind !== "absent") return undefined;
    const content = serializeBriefRecord("pulled", request, outcome);
    const taken = [...(yield* fs.list(dir))];
    while (true) {
      const name = nextPulledBriefName(taken);
      if (yield* fs.createExclusive(join(dir, name), content)) return undefined;
      taken.push(name);
    }
  }).pipe(
    Effect.catch((e) =>
      Effect.succeed(`failed to record the brief in ${PULLED_BRIEFS_DIR} (${e.message})`),
    ),
  );
}

const PULLED_BRIEF_RECORD = /^brief-(\d{2,})\.json$/;

/** `PULLED_BRIEFS_DIR`, relative to `.phax-context`. */
const BRIEFS_SUBDIR = PULLED_BRIEFS_DIR.slice(PHAX_CONTEXT_DIR.length + 1);

// The pulled record `name` waiting at `path`, as the bytes to copy into the
// phase folder, or the warning that it is not copied: a link is never read,
// and a file that does not decode as a pulled brief record is not copied.
function readPulledRecord(
  path: string,
  name: string,
  phaseId: string,
): Effect.Effect<{ readonly bytes: string } | { readonly warning: string }, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const shown = `${PULLED_BRIEFS_DIR}/${name}`;
    const notRecorded = (why: string) => ({
      warning: `[phax] Warning: phase "${phaseId}" — ${shown} ${why}; not recorded.`,
    });
    const entry = yield* fs.entryKind(path);
    if (entry.kind === "symlink") return notRecorded("is a symbolic link");
    if (entry.kind !== "file") return notRecorded("is not a regular file");
    let parsed: unknown;
    try {
      parsed = JSON.parse(yield* fs.readText(path)) as unknown;
    } catch {
      return notRecorded("is not valid JSON");
    }
    const record = readBriefRecordFile(shown, parsed);
    if (Result.isFailure(record)) {
      return notRecorded(`is not a brief record (${record.failure.message})`);
    }
    if (record.success.moment !== "pulled") return notRecorded("is not a pulled brief record");
    return { bytes: serializeDecodedBriefRecord(record.success) };
  });
}

/**
 * At a phase's terminal outcome (committed or failed), copies the pulled
 * records waiting in `<worktree>/.phax-context/briefs/` into the phase folder,
 * in number order, then writes the `closed` marker so later pulls are answered
 * and not recorded (spec Q7). Runs once per phase: an existing marker makes it
 * a no-op. `brief-00.json` is the pushed brief's and is never copied from
 * here. A record is copied only once it decodes as a pulled brief record, as
 * the bytes phax writes for it; a link is never read. When `.phax-context` or
 * its `briefs` folder is not a real directory nothing is copied and no marker
 * written. Never fails: every problem is a warning.
 */
export function closePulledBriefs(input: {
  readonly worktreePath: string;
  readonly phaseFolderPath: string;
  readonly phaseId: string;
  /** Where a warning goes: the run's own port, so it is a note line under `--json`. */
  readonly output: Pick<OutputPort, "warn">;
}): Effect.Effect<void, never, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const state = yield* phaxContextDirState(input.worktreePath, BRIEFS_SUBDIR);
    const dir = join(input.worktreePath, PULLED_BRIEFS_DIR);
    const marker = join(dir, BRIEFS_CLOSED_MARKER);
    if (state === "directory" && (yield* fs.entryKind(marker)).kind !== "absent") return;
    const names = state === "directory" ? yield* fs.list(dir) : [];
    const pulled = names
      .map((name) => ({ name, n: PULLED_BRIEF_RECORD.exec(name)?.[1] }))
      .filter((e): e is { name: string; n: string } => e.n !== undefined && Number(e.n) > 0)
      .toSorted((a, b) => Number(a.n) - Number(b.n));
    for (const { name } of pulled) {
      const read = yield* readPulledRecord(join(dir, name), name, input.phaseId);
      if ("warning" in read) input.output.warn(read.warning);
      else yield* fs.writeAtomic(join(input.phaseFolderPath, name), read.bytes);
    }
    yield* ensurePhaxContextDir(input.worktreePath, BRIEFS_SUBDIR);
    yield* fs.writeAtomic(marker, "");
  }).pipe(
    Effect.catchTag("PhaxContextRefusedError", (e) =>
      Effect.sync(() => {
        input.output.warn(
          `[phax] Warning: phase "${input.phaseId}" — ${e.message.split("\n")[0] ?? e.path}; pulled briefs not collected.`,
        );
      }),
    ),
    Effect.catch((e) =>
      Effect.sync(() => {
        input.output.warn(
          `[phax] Warning: phase "${input.phaseId}" — failed to collect pulled briefs (${e.message}).`,
        );
      }),
    ),
  );
}

/**
 * One `phax brief` call. Inside a phase worktree (its root holds
 * `.phax-context/brief-request.json`) the request carries the phase's facts,
 * copied from that file, and the call is recorded; with no path it is the
 * phase's brief. Outside a phase it carries the paths alone and nothing is
 * recorded. The provider runs from `root`. Never fails: every problem is a
 * refusal or a failed outcome.
 */
export function pullBrief(input: {
  readonly command: string;
  /** The root of the working tree the call is made in. */
  readonly root: string;
  /** The directory the paths are relative to. */
  readonly cwd: string;
  readonly paths: readonly string[];
  /** Tests only: no config key or flag reaches it. */
  readonly timeoutMs?: number;
}): Effect.Effect<PullBriefResult, never, FileSystem | Shell> {
  return Effect.gen(function* () {
    const phase = yield* readPhaseRequest(input.root);
    if (typeof phase === "string") return refused(phase);

    const [first, ...rest] = input.paths;
    let request: BriefRequestFile;
    if (first === undefined) {
      if (phase === undefined) return refused("outside a phase, name at least one path");
      request = stampBriefRequest(phase);
    } else {
      const files = resolveTreePaths({
        cwd: input.cwd,
        root: input.root,
        paths: [first, ...rest],
      });
      if (Result.isFailure(files)) return refused(files.failure.refused);
      request = stampBriefRequest(
        phase === undefined
          ? outsideBriefRequest(files.success)
          : phaseBriefRequest(phase, files.success),
      );
    }

    const outcome = yield* queryBrief({
      command: input.command,
      request,
      cwd: input.root,
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
    });
    const recordWarning =
      phase === undefined ? undefined : yield* recordPull(input.root, request, outcome);
    const warning = recordWarning === undefined ? {} : { recordWarning };

    if (outcome.kind === "failed") return { kind: "failed", reason: outcome.reason, ...warning };
    return { kind: "answered", report: outcome.decoded, files: request.files, ...warning };
  });
}
