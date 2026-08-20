import { Effect } from "effect";
import { dirname, join } from "node:path";
import { FileSystem, type FsError } from "../ports/fs.js";
import { Git, type GitError } from "../ports/git.js";
import type { ResolvedRecordsConfig } from "../schemas/recordsConfig.js";

const ORIGIN = "origin";

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
