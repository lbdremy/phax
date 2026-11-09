import { Effect, Result } from "effect";
import { join } from "node:path";
import {
  BRIEFS_CLOSED_MARKER,
  PULLED_BRIEFS_DIR,
  nextPulledBriefName,
} from "../domain/brief/pull.js";
import { outsideBriefRequest, phaseBriefRequest } from "../domain/brief/request.js";
import { resolveTreePaths } from "../domain/treePaths.js";
import { FileSystem } from "../ports/fs.js";
import type { OutputPort } from "../ports/output.js";
import type { Shell } from "../ports/shell.js";
import type { BriefRequestFile, PhaseBriefRequest } from "../schemas/brief.js";
import type { BriefReport } from "../schemas/briefReport.js";
import { readBriefRequestFile } from "../schemas/persisted.js";
import {
  queryBrief,
  serializeBriefRecord,
  stampBriefRequest,
  type BriefOutcome,
} from "./briefProvider.js";
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
    const fs = yield* FileSystem;
    const path = join(root, PHASE_BRIEF_REQUEST_FILE);
    const present = yield* Effect.result(fs.exists(path));
    if (Result.isFailure(present)) return notARequest(present.failure.message);
    if (!present.success) return undefined;
    const text = yield* Effect.result(fs.readText(path));
    if (Result.isFailure(text)) return notARequest(text.failure.message);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text.success) as unknown;
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
    const dir = join(root, PULLED_BRIEFS_DIR);
    if (yield* fs.exists(join(dir, BRIEFS_CLOSED_MARKER))) return undefined;
    yield* fs.mkdirp(dir);
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

/**
 * At a phase's terminal outcome (committed or failed), copies the pulled
 * records waiting in `<worktree>/.phax-context/briefs/` into the phase folder,
 * in number order, then writes the `closed` marker so later pulls are answered
 * and not recorded (spec Q7). Runs once per phase: an existing marker makes it
 * a no-op. `brief-00.json` is the pushed brief's and is never copied from
 * here. Never fails: a FsError becomes a warning.
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
    const dir = join(input.worktreePath, PULLED_BRIEFS_DIR);
    const marker = join(dir, BRIEFS_CLOSED_MARKER);
    if (yield* fs.exists(marker)) return;
    const names = (yield* fs.exists(dir)) ? yield* fs.list(dir) : [];
    const pulled = names
      .map((name) => ({ name, n: PULLED_BRIEF_RECORD.exec(name)?.[1] }))
      .filter((e): e is { name: string; n: string } => e.n !== undefined && Number(e.n) > 0)
      .toSorted((a, b) => Number(a.n) - Number(b.n));
    for (const { name } of pulled) {
      const text = yield* fs.readText(join(dir, name));
      yield* fs.writeAtomic(join(input.phaseFolderPath, name), text);
    }
    yield* fs.mkdirp(dir);
    yield* fs.writeAtomic(marker, "");
  }).pipe(
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
