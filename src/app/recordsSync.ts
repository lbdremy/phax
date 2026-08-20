import { Effect, Either } from "effect";
import { dirname, join } from "node:path";
import { decodeBranchName, type BranchName } from "../domain/branded.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { Git, type GitError } from "../ports/git.js";
import type { ResolvedRecordsConfig } from "../schemas/recordsConfig.js";
import { RECORDS_BRANCH_NAME } from "./writeRecord.js";

/** The local records clone's remote is always named `origin` — it is cloned,
 * never added by hand — so this is also the push target for a `repo` destination. */
export const ORIGIN = "origin";

const RECORDS_BRANCH: BranchName = Either.getOrThrow(decodeBranchName(RECORDS_BRANCH_NAME));

/**
 * The local records clone's path for a dedicated `repo` destination, keyed by
 * the project's `name` (spec §5.7) — matching the existing
 * `<stateRoot>/runs/<namespace>.<shortName>` convention's use of the project
 * name to scope per-project state under the shared state root.
 */
export function recordsClonePath(stateRoot: string, namespace: string): string {
  return join(stateRoot, "records", namespace);
}

export type RecordsSyncResult =
  | { readonly kind: "nothing-to-bootstrap" }
  | { readonly kind: "cloned"; readonly path: string; readonly remote: string }
  | { readonly kind: "fetched"; readonly path: string; readonly remote: string }
  | {
      readonly kind: "refused";
      readonly reason: "origin-mismatch" | "local-only-history";
      readonly path: string;
      readonly remote: string;
      readonly message: string;
      readonly remedy: string;
    };

export interface RecordsSyncInput {
  readonly records: ResolvedRecordsConfig;
  readonly stateRoot: string;
  readonly namespace: string;
}

/**
 * Bring the local records clone in line with the configured destination
 * (spec §5.7): one function over every pairing of desired config and actual
 * local state. Refuses rather than guesses whenever the local path might not
 * be this project's records history — an origin that points elsewhere, or a
 * local path with no origin at all — leaving it untouched either way rather
 * than re-pointing or grafting it onto the configured remote.
 */
export function reconcileRecordsSync(
  input: RecordsSyncInput,
): Effect.Effect<RecordsSyncResult, GitError | FsError, Git | FileSystem> {
  return Effect.gen(function* () {
    const { records, stateRoot, namespace } = input;
    if (records.destination.kind === "in-repo") {
      return { kind: "nothing-to-bootstrap" } as const;
    }

    const remote = records.destination.remote;
    const path = recordsClonePath(stateRoot, namespace);
    const fs = yield* FileSystem;
    const git = yield* Git;

    const exists = yield* fs.exists(path);
    if (!exists) {
      yield* fs.mkdirp(dirname(path));
      yield* git.cloneRepo(remote, path);
      return { kind: "cloned", path, remote } as const;
    }

    const originUrl = yield* git.remoteUrl(ORIGIN, path);
    if (originUrl === null) {
      return {
        kind: "refused",
        reason: "local-only-history",
        path,
        remote,
        message: `"${path}" already exists but is not a clone of any "origin" remote, and records.destination.remote is configured to "${remote}"`,
        remedy: `remove or relocate "${path}", then run \`phax records sync\` to clone "${remote}" fresh`,
      } as const;
    }

    if (originUrl !== remote) {
      return {
        kind: "refused",
        reason: "origin-mismatch",
        path,
        remote,
        message: `"${path}" is a clone of "${originUrl}", but records.destination.remote is configured to "${remote}"`,
        remedy: `remove or relocate "${path}" if you intend to point records at a different remote, then run \`phax records sync\``,
      } as const;
    }

    yield* git.fetchRemote(ORIGIN, path);
    return { kind: "fetched", path, remote } as const;
  });
}

export type RecordsRunPreflightResult =
  | { readonly kind: "ok" }
  | {
      readonly kind: "refused";
      readonly message: string;
      readonly path: string;
      readonly remote: string;
    };

/**
 * Refuse a run before any phase spawns when it is configured for a dedicated
 * records destination with no local clone yet (spec §5.7). phax never clones
 * on its own at run start — the remote URL comes from a config someone else
 * authored — so this only checks and names the remedy, `phax records sync`.
 */
export function checkRecordsRunPreflight(
  input: RecordsSyncInput,
): Effect.Effect<RecordsRunPreflightResult, FsError, FileSystem> {
  return Effect.gen(function* () {
    const { records, stateRoot, namespace } = input;
    if (!records.enabled || records.destination.kind !== "repo") {
      return { kind: "ok" } as const;
    }
    const remote = records.destination.remote;
    const path = recordsClonePath(stateRoot, namespace);
    const fs = yield* FileSystem;
    const exists = yield* fs.exists(path);
    if (exists) return { kind: "ok" } as const;
    return {
      kind: "refused",
      path,
      remote,
      message: `Records destination "${remote}" has no local clone at "${path}". Run \`phax records sync\` before starting this run.`,
    } as const;
  });
}

export type RecordsPushResult =
  | { readonly kind: "not-configured" }
  | { readonly kind: "pushed"; readonly remote: string; readonly path: string }
  | {
      readonly kind: "failed";
      readonly remote: string;
      readonly path: string;
      readonly message: string;
    };

export interface RecordsPushInput {
  readonly records: ResolvedRecordsConfig;
  /** The source repository — also the in-repo push target. */
  readonly repoRoot: string;
  /** The remote the source repo's branch is published to (`publish.remote`);
   * used as the in-repo push target since records travel with the code. */
  readonly publishRemote: string;
  /** The local records clone's path, required (and used) only when the
   * destination is a dedicated `repo`. */
  readonly recordsClonePath?: string | undefined;
}

/**
 * Push `phax/records/v1` when auto-push is on, at publish time (spec §5.8):
 * to the source repo's publish remote for an in-repo destination, or to the
 * local records clone's `origin` for a dedicated repo. Records mirror the
 * work rather than lead it — the record is already committed locally when
 * its phase commits, so this call only shares what already exists. Never
 * fails: a rejected or unreachable push is reported so the caller can leave
 * the records pending rather than fail the publish.
 */
export function pushRecordsAtPublish(
  input: RecordsPushInput,
): Effect.Effect<RecordsPushResult, never, Git> {
  return Effect.gen(function* () {
    if (!input.records.enabled || !input.records.autoPush) {
      return { kind: "not-configured" } as const;
    }

    const isInRepo = input.records.destination.kind === "in-repo";
    const path = isInRepo ? input.repoRoot : input.recordsClonePath;
    const remote = isInRepo ? input.publishRemote : ORIGIN;
    if (path === undefined) {
      return {
        kind: "failed",
        remote,
        path: input.repoRoot,
        message: "Records destination is a dedicated repo but no local clone path was supplied.",
      } as const;
    }

    const git = yield* Git;
    const pushResult = yield* Effect.either(git.pushBranch(RECORDS_BRANCH, remote, path));
    if (Either.isLeft(pushResult)) {
      return {
        kind: "failed",
        remote,
        path,
        message: pushResult.left.stderr ?? pushResult.left.message,
      } as const;
    }
    return { kind: "pushed", remote, path } as const;
  });
}
