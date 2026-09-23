import { Effect, Either } from "effect";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  extractClaudeUsage,
  extractCodexUsage,
  extractVibeUsage,
} from "../domain/records/usage.js";
import {
  decideRecordsDestination,
  type RecordsDestinationRefusalReason,
  type RepoVisibility,
} from "../domain/records/destination.js";
import { decodeBranchName, type BranchName } from "../domain/branded.js";
import { FileSystem, type FileSystemOps, type FsError } from "../ports/fs.js";
import { Git, type GitError } from "../ports/git.js";
import { GitHub } from "../ports/github.js";
import type { ProviderId } from "../schemas/providerId.js";
import type { RecordsDestination, ResolvedRecordsConfig } from "../schemas/recordsConfig.js";
import {
  UNAVAILABLE_TOKEN_USAGE,
  type RecordShape,
  type TokenUsage,
} from "../schemas/runRecord.js";

// Shared by the two record writers (`writeRecord.ts` for phases,
// `writeAuthoringRecord.ts` for headless authoring sessions): destination
// policy, usage extraction, and the tree-only commit on the records branch.

/**
 * The records branch is an ordinary branch, not a custom ref namespace, so it
 * travels with a clone and a fetch (spec §5.3).
 */
export const RECORDS_BRANCH_NAME = "phax/records/v1";

const RECORDS_BRANCH: BranchName = Either.getOrThrow(decodeBranchName(RECORDS_BRANCH_NAME));

export const RECORD_TRANSCRIPT_FILE = "output.jsonl";
const MANIFEST_FILE = "record.json";

/** Every record writer's outcome: written, or one of the three ways it writes nothing. */
export type RecordWriteResult =
  | {
      readonly kind: "written";
      readonly commitSha: string;
      readonly branch: string;
      readonly key: string;
      readonly shape: RecordShape;
      readonly fileCount: number;
    }
  | RecordSkipped;

type RecordSkipped =
  | { readonly kind: "records-off" }
  | { readonly kind: "deferred-destination"; readonly destination: "repo" }
  | {
      readonly kind: "refused";
      readonly reason: RecordsDestinationRefusalReason;
      readonly destination: RecordsDestination;
      readonly message: string;
      readonly remedy: string;
    };

export interface RecordDestinationInput {
  readonly repoRoot: string;
  /** The local records clone, required for a dedicated `repo` destination. */
  readonly recordsClonePath?: string | undefined;
  readonly records: ResolvedRecordsConfig;
}

/**
 * Decide where a record's commit lands, or why none is written. Records off is
 * a total no-op. The commit lands on the source repo for an `in-repo`
 * destination, or on the local records clone for a dedicated `repo`
 * destination — and only once the destination policy allows it (spec §5.4):
 * detection guards the configured choice, it never picks one.
 */
export function resolveRecordDestination(
  input: RecordDestinationInput,
): Effect.Effect<{ readonly kind: "write"; readonly repo: string } | RecordSkipped, never, GitHub> {
  return Effect.gen(function* () {
    if (!input.records.enabled) return { kind: "records-off" } as const;

    // A dedicated repo destination writes to the local clone, which must
    // already exist by the time a phase runs — the run preflight
    // (recordsSync.ts) refuses the run before any phase spawns otherwise.
    // No clone path here is a caller bug, not a policy refusal, but degrades
    // to a deferred outcome rather than crashing the caller.
    let repo = input.repoRoot;
    if (input.records.destination.kind === "repo") {
      if (input.recordsClonePath === undefined) {
        return { kind: "deferred-destination", destination: "repo" } as const;
      }
      repo = input.recordsClonePath;
    }

    // Visibility is only consulted for an in-repo destination with
    // transcripts on — a skeleton record is safe in-repo whatever the
    // visibility, and a dedicated repo is safe whatever the visibility, so
    // asking avoids a needless `gh` call in both of those cases.
    let visibility: RepoVisibility = "unknown";
    if (input.records.transcript && input.records.destination.kind === "in-repo") {
      const github = yield* GitHub;
      visibility = yield* github
        .visibility(input.repoRoot)
        .pipe(Effect.orElseSucceed(() => "unknown" as const));
    }
    const decision = decideRecordsDestination({
      transcript: input.records.transcript,
      destination: input.records.destination,
      visibility,
    });
    if (decision.kind === "refused") {
      return {
        kind: "refused",
        reason: decision.reason,
        destination: decision.destination,
        message: decision.message,
        remedy: decision.remedy,
      } as const;
    }
    return { kind: "write", repo } as const;
  });
}

export interface CommitRecordTreeInput {
  /** The repository whose records branch receives the commit. */
  readonly repo: string;
  /** The folder the record's artifacts are read from. */
  readonly folder: string;
  /** The record's key: the directory its files live under in the commit's tree. */
  readonly key: string;
  /** Folder-relative names of the artifacts the record carries. */
  readonly artifactPaths: readonly string[];
  /** The encoded manifest, written as `<key>/record.json`. */
  readonly manifest: unknown;
  readonly message: string;
}

/**
 * Write one record as one commit on `phax/records/v1` — the artifacts plus
 * the manifest under `<key>/` — without touching the working tree or index
 * (the tree-only plumbing drives a scratch index).
 */
export function commitRecordTree(
  input: CommitRecordTreeInput,
): Effect.Effect<
  { readonly commitSha: string; readonly branch: string; readonly fileCount: number },
  GitError | FsError,
  FileSystem | Git
> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const git = yield* Git;

    const encoder = new TextEncoder();
    const files: { path: string; content: Uint8Array }[] = [];
    for (const name of input.artifactPaths) {
      const text = yield* fs.readText(join(input.folder, name));
      files.push({ path: `${input.key}/${name}`, content: encoder.encode(text) });
    }
    files.push({
      path: `${input.key}/${MANIFEST_FILE}`,
      content: encoder.encode(`${JSON.stringify(input.manifest, null, 2)}\n`),
    });

    const commitSha = yield* git.writeTreeCommit({
      repo: input.repo,
      branch: RECORDS_BRANCH,
      message: input.message,
      files,
    });
    return { commitSha, branch: RECORDS_BRANCH_NAME, fileCount: files.length };
  });
}

/**
 * Read a session's token usage from its provider-specific source: Claude and
 * codex carry it in `output.jsonl`, vibe keeps none there and records it in the
 * session `meta.json`. Any failure to read degrades to the explicitly
 * unavailable variant — usage is never reported as zero (spec §5.5).
 */
export function computeRecordUsage(input: {
  readonly provider: ProviderId;
  readonly folder: string;
  readonly sessionId: string | undefined;
  /** Overridable vibe home (`~/.vibe` by default) so tests can point at a fixture. */
  readonly vibeHome: string | undefined;
}): Effect.Effect<TokenUsage, never, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    if (input.provider === "claude-code" || input.provider === "codex-cli") {
      const outputPath = join(input.folder, RECORD_TRANSCRIPT_FILE);
      const exists = yield* fs.exists(outputPath).pipe(Effect.orElseSucceed(() => false));
      if (!exists) return UNAVAILABLE_TOKEN_USAGE;
      const text = yield* fs.readText(outputPath).pipe(Effect.orElseSucceed(() => ""));
      const lines = text.split("\n");
      const usage =
        input.provider === "claude-code" ? extractClaudeUsage(lines) : extractCodexUsage(lines);
      return usage === undefined ? UNAVAILABLE_TOKEN_USAGE : { available: true as const, usage };
    }

    const vibeHome = input.vibeHome ?? join(homedir(), ".vibe");
    const metaText = yield* readVibeSessionMeta(fs, vibeHome, input.sessionId);
    if (metaText === undefined) return UNAVAILABLE_TOKEN_USAGE;
    const usage = extractVibeUsage(metaText);
    return usage === undefined ? UNAVAILABLE_TOKEN_USAGE : { available: true as const, usage };
  });
}

/**
 * Locate the `meta.json` of the vibe session that produced this record by
 * matching its recorded `session_id`, scanning `<vibeHome>/logs/session`.
 * Returns the raw meta text, or `undefined` when no matching session is found.
 */
function readVibeSessionMeta(
  fs: FileSystemOps,
  vibeHome: string,
  sessionId: string | undefined,
): Effect.Effect<string | undefined, never> {
  return Effect.gen(function* () {
    if (sessionId === undefined) return undefined;
    const sessionRoot = join(vibeHome, "logs", "session");
    const entries = yield* fs
      .list(sessionRoot)
      .pipe(Effect.orElseSucceed(() => [] as readonly string[]));
    for (const name of entries) {
      if (!name.startsWith("session_")) continue;
      const metaText = yield* fs
        .readText(join(sessionRoot, name, "meta.json"))
        .pipe(Effect.orElseSucceed(() => ""));
      if (metaText === "") continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(metaText) as unknown;
      } catch {
        continue;
      }
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        (parsed as { session_id?: unknown }).session_id === sessionId
      ) {
        return metaText;
      }
    }
    return undefined;
  });
}
