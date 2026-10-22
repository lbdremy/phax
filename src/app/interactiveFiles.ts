// The files of a declared interactive phase, through the FileSystem port: the
// seed's two copies, interactive-session.json, first-reading.md, the person's
// handoff file and its fingerprint, the folders that keep a refused turn's
// versions, and review-stop.json (live or parked). Every document read here is
// decoded at the schema boundary; a document phax cannot read is an FsError
// naming it.
import { Effect, Either, Schema } from "effect";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { PERSON_HANDOFF_PATH } from "../domain/interactive/worktreeChange.js";
import { policyFromPosture } from "../domain/security/postureToPolicy.js";
import type { SecurityPolicy } from "../domain/security/types.js";
import { FileSystem, FsError } from "../ports/fs.js";
import { formatParseError } from "../schemas/formatError.js";
import { ProviderIdSchema, type ProviderId } from "../schemas/providerId.js";
import { decodeSecurityPosture } from "../schemas/securityPosture.js";
import {
  encodeInteractiveSessionFile,
  type InteractiveSession,
} from "../schemas/interactiveSession.js";
import {
  readInteractiveSessionFile,
  readReviewStopFile,
  withSchemaUrl,
} from "../schemas/persisted.js";
import { encodeReviewStopFile, type ReviewStop } from "../schemas/reviewStop.js";

/** The seed inside the phase worktree, relative to it. */
export const SEED_WORKTREE_PATH = ".phax-context/interactive-review.md";
/** The seed's copy in the phase's run folder. */
export const SEED_RUN_FILE = "review-seed.md";
export const INTERACTIVE_SESSION_FILE = "interactive-session.json";
export const FIRST_READING_FILE = "first-reading.md";
// The same names the effect runner writes, parks and discards.
const REVIEW_STOP_FILE = "review-stop.json";
const PARKED_REVIEW_STOP_FILE = "review-stop.closing.json";

/** The two copies of a stop's seed: the worktree's and the run folder's. */
export interface SeedPaths {
  readonly worktree: string;
  readonly runFolder: string;
}

export function seedPaths(worktree: string, phaseFolder: string): SeedPaths {
  return {
    worktree: join(worktree, SEED_WORKTREE_PATH),
    runFolder: join(phaseFolder, SEED_RUN_FILE),
  };
}

/** Write the seed to both copies, the run folder's first. */
export function writeSeed(
  paths: SeedPaths,
  markdown: string,
): Effect.Effect<void, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    yield* fs.writeAtomic(paths.runFolder, markdown);
    yield* fs.mkdirp(dirname(paths.worktree));
    yield* fs.writeAtomic(paths.worktree, markdown);
  });
}

/**
 * Rewrite the worktree's seed from its run-folder copy, after every phax turn:
 * a turn can reach `.phax-context/`, which no snapshot compares.
 */
export function restoreWorktreeSeed(paths: SeedPaths): Effect.Effect<void, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const markdown = yield* fs.readText(paths.runFolder);
    yield* fs.mkdirp(dirname(paths.worktree));
    yield* fs.writeAtomic(paths.worktree, markdown);
  });
}

function parseJson(path: string, text: string): Effect.Effect<unknown, FsError> {
  return Effect.try({
    try: () => JSON.parse(text) as unknown,
    catch: () => new FsError({ message: `${path}: not valid JSON` }),
  });
}

/** The phase's interactive-session.json, or null when it does not exist yet. */
export function readInteractiveSession(
  phaseFolder: string,
): Effect.Effect<InteractiveSession | null, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const path = join(phaseFolder, INTERACTIVE_SESSION_FILE);
    if (!(yield* fs.exists(path))) return null;
    const parsed = yield* parseJson(path, yield* fs.readText(path));
    const decoded = readInteractiveSessionFile(path, parsed);
    if (Either.isLeft(decoded)) {
      return yield* Effect.fail(new FsError({ message: decoded.left.message }));
    }
    return decoded.right;
  });
}

export function writeInteractiveSession(
  phaseFolder: string,
  session: InteractiveSession,
): Effect.Effect<void, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    yield* fs.writeAtomic(
      join(phaseFolder, INTERACTIVE_SESSION_FILE),
      JSON.stringify(
        encodeInteractiveSessionFile(withSchemaUrl("interactive-session", session)),
        null,
        2,
      ),
    );
  });
}

/** Write first-reading.md in the phase folder; returns its path. */
export function writeFirstReading(
  phaseFolder: string,
  markdown: string,
): Effect.Effect<string, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const path = join(phaseFolder, FIRST_READING_FILE);
    yield* fs.writeAtomic(path, markdown);
    return path;
  });
}

/** The person's handoff file as it stood: its sha256 and its text. */
export interface PersonHandoffFingerprint {
  readonly sha256: string;
  readonly text: string;
}

/** The person's handoff file's fingerprint and text, or null when it is absent. */
export function fingerprintPersonHandoff(
  worktree: string,
): Effect.Effect<PersonHandoffFingerprint | null, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const path = join(worktree, PERSON_HANDOFF_PATH);
    if (!(yield* fs.exists(path))) return null;
    const text = yield* fs.readText(path);
    return { sha256: createHash("sha256").update(text).digest("hex"), text };
  });
}

// The copy of the person's handoff file taken before a turn, kept on disk so a
// turn interrupted by a crash can still be restored by the next process.
function personHandoffCopyPath(phaseFolder: string, turnLabel: string): string {
  return join(phaseFolder, `${turnLabel}-correction-handoff.md`);
}

/**
 * Keep the person's handoff file as it stood before the turn named
 * `turnLabel` (e.g. `first-turn-01`), or remove a stale copy when it is absent.
 */
export function keepPersonHandoffCopy(
  phaseFolder: string,
  turnLabel: string,
  fingerprint: PersonHandoffFingerprint | null,
): Effect.Effect<void, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const path = personHandoffCopyPath(phaseFolder, turnLabel);
    if (fingerprint === null) {
      if (yield* fs.exists(path)) yield* fs.remove(path);
      return;
    }
    yield* fs.writeAtomic(path, fingerprint.text);
  });
}

/**
 * Put the person's handoff file back as it stood before the turn: its kept
 * copy's text, or no file when there was none. The copy is then removed.
 */
export function restorePersonHandoff(
  worktree: string,
  phaseFolder: string,
  turnLabel: string,
): Effect.Effect<void, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const copy = personHandoffCopyPath(phaseFolder, turnLabel);
    const target = join(worktree, PERSON_HANDOFF_PATH);
    if (yield* fs.exists(copy)) {
      yield* fs.mkdirp(dirname(target));
      yield* fs.writeAtomic(target, yield* fs.readText(copy));
      yield* fs.remove(copy);
    } else if (yield* fs.exists(target)) {
      yield* fs.remove(target);
    }
  });
}

/** Remove the kept copy of the person's handoff file once its turn is settled. */
export function dropPersonHandoffCopy(
  phaseFolder: string,
  turnLabel: string,
): Effect.Effect<void, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const copy = personHandoffCopyPath(phaseFolder, turnLabel);
    if (yield* fs.exists(copy)) yield* fs.remove(copy);
  });
}

const REFUSED_TURN = /^refused-turn-(\d{2})$/;

/**
 * Move a refused turn's versions of `paths` out of the worktree into the next
 * free `<phase folder>/refused-turn-NN/`, keeping each path's place under it;
 * a path the turn deleted has no version and is not moved. Returns the
 * folder. Each file is renamed, so its bytes are kept exactly (the worktree
 * and the run folder share the state root). Every caller then puts the
 * worktree's paths back as they stood before the turn.
 */
export function keepRefusedTurn(
  worktree: string,
  phaseFolder: string,
  paths: readonly string[],
): Effect.Effect<string, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const taken = (yield* fs.list(phaseFolder)).flatMap((entry) => {
      const match = REFUSED_TURN.exec(entry);
      return match === null ? [] : [Number(match[1])];
    });
    const next = Math.max(0, ...taken) + 1;
    const folder = join(phaseFolder, `refused-turn-${String(next).padStart(2, "0")}`);
    yield* fs.mkdirp(folder);
    for (const path of paths) {
      const source = join(worktree, path);
      if (!(yield* fs.exists(source))) continue;
      const target = join(folder, path);
      yield* fs.mkdirp(dirname(target));
      yield* fs.rename(source, target);
    }
    return folder;
  });
}

/**
 * The handoffs of the phases before `phaseIndex`, in plan order, each read
 * from `<run>/<phase>/phase-handoff.md`; a phase with none reads as a line
 * saying so.
 */
export function readExecutedHandoffs(
  runPath: string,
  phases: readonly { readonly id: string; readonly title: string }[],
  phaseIndex: number,
): Effect.Effect<
  readonly { readonly id: string; readonly title: string; readonly text: string }[],
  FsError,
  FileSystem
> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const handoffs: { id: string; title: string; text: string }[] = [];
    for (const phase of phases.slice(0, phaseIndex)) {
      const path = join(runPath, phase.id, "phase-handoff.md");
      const text = (yield* fs.exists(path)) ? yield* fs.readText(path) : "(no handoff recorded)";
      handoffs.push({ id: phase.id, title: phase.title, text });
    }
    return handoffs;
  });
}

/** Where review-stop.json lives while the run waits, and where a close parks it. */
export function reviewStopPaths(
  runPath: string,
  phaseFolder: string,
): { readonly live: string; readonly parked: string } {
  return {
    live: join(runPath, REVIEW_STOP_FILE),
    parked: join(phaseFolder, PARKED_REVIEW_STOP_FILE),
  };
}

/**
 * The run's review stop with the path it was read from: the live document,
 * else its parked copy while a close runs, else null.
 */
export function readReviewStop(
  runPath: string,
  phaseFolder: string,
): Effect.Effect<
  { readonly reviewStop: ReviewStop; readonly path: string } | null,
  FsError,
  FileSystem
> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const { live, parked } = reviewStopPaths(runPath, phaseFolder);
    for (const path of [live, parked]) {
      if (!(yield* fs.exists(path))) continue;
      const parsed = yield* parseJson(path, yield* fs.readText(path));
      const decoded = readReviewStopFile(path, parsed);
      if (Either.isLeft(decoded)) {
        return yield* Effect.fail(new FsError({ message: decoded.left.message }));
      }
      return { reviewStop: decoded.right, path };
    }
    return null;
  });
}

/**
 * Rewrite the live review-stop.json with `reviewStop`, only while it exists:
 * `phax enter-phase --new-session` under the run lock is its one caller. The
 * reducer's effects own every other write. Returns whether it wrote.
 */
export function refreshReviewStop(
  runPath: string,
  reviewStop: ReviewStop,
): Effect.Effect<boolean, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const live = join(runPath, REVIEW_STOP_FILE);
    if (!(yield* fs.exists(live))) return false;
    yield* fs.writeAtomic(
      live,
      JSON.stringify(encodeReviewStopFile(withSchemaUrl("review-stop", reviewStop)), null, 2),
    );
    return true;
  });
}

/**
 * Rewrite the review stop at `path`, where `readReviewStop` found it: the
 * close records its `closeBase` in the parked copy this way.
 */
export function rewriteReviewStopAt(
  path: string,
  reviewStop: ReviewStop,
): Effect.Effect<void, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    yield* fs.writeAtomic(
      path,
      JSON.stringify(encodeReviewStopFile(withSchemaUrl("review-stop", reviewStop)), null, 2),
    );
  });
}

// Only the part of model-resolution.json the later turns read.
const ModelResolutionSelectionSchema = Schema.Struct({
  selected: Schema.Struct({
    provider: ProviderIdSchema,
    concreteModel: Schema.NonEmptyString,
    thinking: Schema.optional(Schema.NonEmptyString),
  }),
});

/** The provider, model and effort a phase resolved to, from its `model-resolution.json`. */
export interface PhaseModel {
  readonly provider: ProviderId;
  readonly model: string;
  /** The resolved thinking level; undefined when the resolution named none. */
  readonly effort: string | undefined;
}

export function readModelResolution(
  phaseFolder: string,
): Effect.Effect<PhaseModel, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const path = join(phaseFolder, "model-resolution.json");
    if (!(yield* fs.exists(path))) {
      return yield* Effect.fail(new FsError({ message: `${path}: not found` }));
    }
    const parsed = yield* parseJson(path, yield* fs.readText(path));
    const decoded = Schema.decodeUnknownEither(ModelResolutionSelectionSchema)(parsed);
    if (Either.isLeft(decoded)) {
      return yield* Effect.fail(
        new FsError({ message: `${path}: ${formatParseError(decoded.left)}` }),
      );
    }
    const { provider, concreteModel, thinking } = decoded.right.selected;
    return { provider, model: concreteModel, effort: thinking };
  });
}

/**
 * The phase's policy and frozen agent commands, rebuilt from its
 * `security.json`: what a continue or fresh-start command carries. A missing
 * or unreadable file is an FsError naming it.
 */
export function readPhasePosture(
  phaseFolder: string,
): Effect.Effect<
  { readonly policy: SecurityPolicy; readonly agentCommands: readonly string[] },
  FsError,
  FileSystem
> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const path = join(phaseFolder, "security.json");
    if (!(yield* fs.exists(path))) {
      return yield* Effect.fail(new FsError({ message: `${path}: not found` }));
    }
    const parsed = yield* parseJson(path, yield* fs.readText(path));
    const decoded = decodeSecurityPosture(parsed);
    if (Either.isLeft(decoded)) {
      return yield* Effect.fail(
        new FsError({ message: `${path}: ${formatParseError(decoded.left)}` }),
      );
    }
    return {
      policy: policyFromPosture(decoded.right),
      agentCommands: decoded.right.agentCommands.map((c) => c.command),
    };
  });
}
