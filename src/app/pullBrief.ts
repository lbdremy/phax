import { Effect, Either } from "effect";
import { join } from "node:path";
import {
  BRIEFS_CLOSED_MARKER,
  PULLED_BRIEFS_DIR,
  nextPulledBriefName,
  resolveBriefPaths,
} from "../domain/brief/pull.js";
import { outsideBriefRequest, phaseBriefRequest } from "../domain/brief/request.js";
import { FileSystem } from "../ports/fs.js";
import type { Shell } from "../ports/shell.js";
import type { BriefAnswer, BriefRequestFile, PhaseBriefRequest } from "../schemas/brief.js";
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
      readonly answer: BriefAnswer;
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
    const present = yield* Effect.either(fs.exists(path));
    if (Either.isLeft(present)) return notARequest(present.left.message);
    if (!present.right) return undefined;
    const text = yield* Effect.either(fs.readText(path));
    if (Either.isLeft(text)) return notARequest(text.left.message);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text.right) as unknown;
    } catch {
      return notARequest("not valid JSON");
    }
    const read = readBriefRequestFile(PHASE_BRIEF_REQUEST_FILE, parsed);
    if (Either.isLeft(read)) {
      const prefix = `${read.left.file}: `;
      const { message } = read.left;
      return notARequest(message.startsWith(prefix) ? message.slice(prefix.length) : message);
    }
    const request = read.right;
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
    Effect.catchAll((e) =>
      Effect.succeed(`failed to record the brief in ${PULLED_BRIEFS_DIR} (${e.message})`),
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
      const files = resolveBriefPaths({
        cwd: input.cwd,
        root: input.root,
        paths: [first, ...rest],
      });
      if (Either.isLeft(files)) return refused(files.left.refused);
      request = stampBriefRequest(
        phase === undefined
          ? outsideBriefRequest(files.right)
          : phaseBriefRequest(phase, files.right),
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
    return { kind: "answered", answer: outcome.decoded, files: request.files, ...warning };
  });
}
