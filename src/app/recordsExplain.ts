import { Effect, Either } from "effect";
import { Git, GitError, type GitOps } from "../ports/git.js";
import { Shell, type ShellError } from "../ports/shell.js";
import { ORIGIN } from "./recordsSync.js";
import { RECORDS_BRANCH_NAME } from "./writeRecord.js";
import { authoringRecordKey } from "./writeAuthoringRecord.js";
import type { RunRecordManifest } from "../schemas/runRecord.js";
import {
  decodeRecordManifest,
  isAuthoringRecordManifest,
  type AuthoringRecordManifest,
  type RecordManifest,
} from "../schemas/authoringRecord.js";
import type { ResolvedRecordsConfig } from "../schemas/recordsConfig.js";

/** The records branch as a local ref — same value in the source repo (in-repo
 * destination) or the local records clone (dedicated repo destination): both
 * receive the write directly, never only through a remote-tracking ref. */
export const RECORDS_REF = `refs/heads/${RECORDS_BRANCH_NAME}`;

export interface RecordDiffStat {
  readonly files: number;
  readonly insertions: number;
  readonly deletions: number;
}

export interface ExplainedRecord {
  readonly runId: string;
  readonly phaseId: string;
  readonly manifest: RunRecordManifest;
  readonly recordCommitSha: string;
  readonly foundVia: "local" | "remote-refresh";
  /** Whether `manifest.sourceSha` still resolves in the source repo. Absent
   * when the manifest carries no `sourceSha` at all (the phase never committed). */
  readonly sourceCommitReachable?: boolean;
  readonly checksAttemptCount: number;
  readonly promptByteLength?: number;
  readonly diffStat?: RecordDiffStat;
  readonly handoffPresent: boolean;
  /** Artifact contents by file name (e.g. `"prompt.md"`), excluding `record.json`. */
  readonly artifacts: ReadonlyMap<string, Uint8Array>;
}

/** A headless authoring session's record, resolved through an artifact commit's `Authoring-Id`. */
export interface ExplainedAuthoringRecord {
  readonly authoringId: string;
  readonly manifest: AuthoringRecordManifest;
  readonly recordCommitSha: string;
  readonly foundVia: "local" | "remote-refresh";
  /** Whether `manifest.sourceSha` still resolves in the source repo; absent
   * when the session did not commit. */
  readonly sourceCommitReachable?: boolean;
  readonly briefByteLength?: number;
  readonly promptByteLength?: number;
  readonly documentPresent: boolean;
  /** Artifact contents by file name (e.g. `"brief.md"`), excluding `record.json`. */
  readonly artifacts: ReadonlyMap<string, Uint8Array>;
}

export type ExplainOutcome =
  | { readonly kind: "records-disabled" }
  | { readonly kind: "commit-not-found"; readonly sha: string }
  | { readonly kind: "not-phax-commit"; readonly sha: string; readonly resolvedSha: string }
  | {
      readonly kind: "not-found";
      /** The record key the commit's trailers name: `<runId>/<phaseId>` or `authoring/<id>`. */
      readonly key: string;
      readonly sourceSha: string;
      /** Whether the remote was consulted before reporting this outcome —
       * false only ever means "unreachable", never "skipped" (spec §5.9). */
      readonly remoteConsulted: boolean;
    }
  | { readonly kind: "found"; readonly record: ExplainedRecord }
  | { readonly kind: "found-authoring"; readonly record: ExplainedAuthoringRecord };

export interface ExplainRecordInput {
  /** A commit sha (or short sha) in the source repository. */
  readonly sha: string;
  readonly repoRoot: string;
  readonly records: ResolvedRecordsConfig;
  readonly publishRemote: string;
  /** Required (and used) only when the destination is a dedicated `repo`. */
  readonly recordsClonePath?: string | undefined;
}

function decodeText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function parseTrailers(body: string): ReadonlyMap<string, string> {
  const trailers = new Map<string, string>();
  for (const line of body.split("\n")) {
    const match = /^([A-Za-z][A-Za-z-]*): (.+)$/.exec(line);
    const key = match?.[1];
    const value = match?.[2];
    if (key !== undefined && value !== undefined) trailers.set(key, value);
  }
  return trailers;
}

function parseDiffStat(patchText: string): RecordDiffStat {
  let files = 0;
  let insertions = 0;
  let deletions = 0;
  for (const line of patchText.split("\n")) {
    if (line.startsWith("diff --git ")) {
      files++;
    } else if (line.startsWith("+++") || line.startsWith("---")) {
      // file headers, not content lines
    } else if (line.startsWith("+")) {
      insertions++;
    } else if (line.startsWith("-")) {
      deletions++;
    }
  }
  return { files, insertions, deletions };
}

/**
 * Read an arbitrary commit's raw message (subject + body) via `git log`, the
 * same ad hoc use of the Shell port `commit.ts` already makes for
 * `git rev-parse`/`git diff` — reading one commit's message is a one-off
 * query here, not a repeatable capability worth adding to `GitOps`.
 */
function readCommitMessage(repo: string, sha: string): Effect.Effect<string, ShellError, Shell> {
  return Effect.gen(function* () {
    const shell = yield* Shell;
    const result = yield* shell.run({
      command: ["git", "log", "-1", "--format=%B", sha],
      cwd: repo,
    });
    return result.stdout;
  });
}

/**
 * Which record a source commit's trailers name. `Run-Id`/`Phase-Id` (a phase
 * commit) wins over `Authoring-Id` (an artifact commit): a commit carrying the
 * phase pair is a phase commit whatever else it says.
 */
type RecordAddress =
  | { readonly kind: "phase"; readonly runId: string; readonly phaseId: string }
  | { readonly kind: "authoring"; readonly authoringId: string };

function addressFromTrailers(trailers: ReadonlyMap<string, string>): RecordAddress | null {
  const runId = trailers.get("Run-Id");
  const phaseId = trailers.get("Phase-Id");
  if (runId !== undefined && phaseId !== undefined) return { kind: "phase", runId, phaseId };
  const authoringId = trailers.get("Authoring-Id");
  if (authoringId !== undefined) return { kind: "authoring", authoringId };
  return null;
}

function keyOf(address: RecordAddress): string {
  return address.kind === "phase"
    ? `${address.runId}/${address.phaseId}`
    : authoringRecordKey(address.authoringId);
}

/**
 * Find the records-branch commit holding `address`'s record, walking history
 * from `ref`. Record commits are not cumulative — each write's tree holds only
 * that write's own files (spec §5.3's plumbing builds a fresh tree per commit)
 * — so an older record is not present in the branch tip's tree; it has to be
 * located by the commit that wrote it. `--fixed-strings` makes the `--grep`s
 * literal substring matches, so an id containing regex metacharacters cannot
 * misbehave; a substring match on an `Authoring-Id` (one slug a prefix of
 * another) is ruled out by checking the candidate's tree holds the key.
 */
function findRecordCommit(
  git: GitOps,
  repo: string,
  ref: string,
  address: RecordAddress,
): Effect.Effect<string | null, ShellError | GitError, Shell> {
  return Effect.gen(function* () {
    const shell = yield* Shell;
    if (address.kind === "phase") {
      const result = yield* shell.run({
        command: [
          "git",
          "log",
          ref,
          "--format=%H",
          "--fixed-strings",
          `--grep=Run-Id: ${address.runId}`,
          `--grep=Phase-Id: ${address.phaseId}`,
          "--all-match",
          "-n",
          "1",
        ],
        cwd: repo,
      });
      const sha = result.stdout.trim();
      return sha.length > 0 ? sha : null;
    }

    const result = yield* shell.run({
      command: [
        "git",
        "log",
        ref,
        "--format=%H",
        "--fixed-strings",
        `--grep=Authoring-Id: ${address.authoringId}`,
      ],
      cwd: repo,
    });
    const manifestPath = `${keyOf(address)}/record.json`;
    for (const sha of result.stdout.split("\n").map((line) => line.trim())) {
      if (sha.length === 0) continue;
      const entries = yield* git.readTree(repo, sha);
      if (entries.some((e) => e.type === "blob" && e.path === manifestPath)) return sha;
    }
    return null;
  });
}

interface LoadedRecord {
  readonly manifest: RecordManifest;
  readonly artifacts: ReadonlyMap<string, Uint8Array>;
  readonly sourceCommitReachable?: boolean;
}

function malformed(prefix: string, sha: string, detail: string): GitError {
  return new GitError({
    message: `Malformed ${prefix}record.json at ${sha}: ${detail}`,
    command: "records explain",
  });
}

/** Read one record's manifest (either kind) and artifacts from its commit's tree. */
function loadRecord(
  git: GitOps,
  repoRoot: string,
  localPath: string,
  recordCommitSha: string,
  key: string,
): Effect.Effect<LoadedRecord, GitError> {
  return Effect.gen(function* () {
    const prefix = `${key}/`;
    const entries = yield* git.readTree(localPath, recordCommitSha);
    const relevant = entries.filter((e) => e.type === "blob" && e.path.startsWith(prefix));

    const manifestEntry = relevant.find((e) => e.path === `${prefix}record.json`);
    if (manifestEntry === undefined) {
      return yield* Effect.fail(
        new GitError({
          message: `Record commit ${recordCommitSha} carries no ${prefix}record.json`,
          command: "records explain",
        }),
      );
    }
    const manifestBytes = yield* git.readBlob(localPath, manifestEntry.oid);
    let manifestJson: unknown;
    try {
      manifestJson = JSON.parse(decodeText(manifestBytes)) as unknown;
    } catch (cause) {
      // A record.json that is not valid JSON reaches the caller as the same
      // clean failure as a schema-invalid one, never an uncaught defect.
      return yield* Effect.fail(malformed(prefix, recordCommitSha, String(cause)));
    }
    const decoded = decodeRecordManifest(manifestJson);
    if (Either.isLeft(decoded)) {
      return yield* Effect.fail(malformed(prefix, recordCommitSha, decoded.left.message));
    }
    const manifest = decoded.right;

    const artifacts = new Map<string, Uint8Array>();
    for (const entry of relevant) {
      if (entry.path === manifestEntry.path) continue;
      const bytes = yield* git.readBlob(localPath, entry.oid);
      artifacts.set(entry.path.slice(prefix.length), bytes);
    }

    const sourceCommitReachable =
      manifest.sourceSha !== undefined
        ? (yield* git.resolveRef(repoRoot, manifest.sourceSha)) !== null
        : undefined;

    return {
      manifest,
      artifacts,
      ...(sourceCommitReachable !== undefined ? { sourceCommitReachable } : {}),
    };
  });
}

function explainPhaseRecord(
  loaded: LoadedRecord,
  address: { readonly runId: string; readonly phaseId: string },
  recordCommitSha: string,
  foundVia: "local" | "remote-refresh",
  prefix: string,
): Either.Either<ExplainedRecord, GitError> {
  const { manifest, artifacts } = loaded;
  if (isAuthoringRecordManifest(manifest)) {
    return Either.left(
      malformed(prefix, recordCommitSha, "an authoring manifest under a phase key"),
    );
  }
  const checksAttemptCount = [...artifacts.keys()].filter((name) =>
    /^checks-attempt-\d+\.log$/.test(name),
  ).length;
  const promptBytes = artifacts.get("prompt.md");
  const diffBytes = artifacts.get("diff.patch");
  return Either.right({
    runId: address.runId,
    phaseId: address.phaseId,
    manifest,
    recordCommitSha,
    foundVia,
    ...(loaded.sourceCommitReachable !== undefined
      ? { sourceCommitReachable: loaded.sourceCommitReachable }
      : {}),
    checksAttemptCount,
    ...(promptBytes !== undefined ? { promptByteLength: promptBytes.length } : {}),
    ...(diffBytes !== undefined ? { diffStat: parseDiffStat(decodeText(diffBytes)) } : {}),
    handoffPresent: artifacts.has("phase-handoff.md"),
    artifacts,
  });
}

function explainAuthoringRecord(
  loaded: LoadedRecord,
  authoringId: string,
  recordCommitSha: string,
  foundVia: "local" | "remote-refresh",
  prefix: string,
): Either.Either<ExplainedAuthoringRecord, GitError> {
  const { manifest, artifacts } = loaded;
  if (!isAuthoringRecordManifest(manifest)) {
    return Either.left(
      malformed(prefix, recordCommitSha, "a phase manifest under an authoring key"),
    );
  }
  const briefBytes = artifacts.get("brief.md");
  const promptBytes = artifacts.get("prompt.md");
  return Either.right({
    authoringId,
    manifest,
    recordCommitSha,
    foundVia,
    ...(loaded.sourceCommitReachable !== undefined
      ? { sourceCommitReachable: loaded.sourceCommitReachable }
      : {}),
    ...(briefBytes !== undefined ? { briefByteLength: briefBytes.length } : {}),
    ...(promptBytes !== undefined ? { promptByteLength: promptBytes.length } : {}),
    documentPresent: artifacts.has("document.json"),
    artifacts,
  });
}

/**
 * Resolve `phax records explain <sha>`: read `sha`'s trailers in the source
 * repo, locate the record they key (never the sha itself, spec §5.2), and load
 * it from the local records clone or, on a local miss, the remote-tracking ref
 * — never requiring a checked-out local records branch (spec §5.9). A phase
 * commit's `Run-Id`/`Phase-Id` key a phase record; a headless artifact
 * commit's `Authoring-Id` keys an authoring record.
 */
export function explainRecord(
  input: ExplainRecordInput,
): Effect.Effect<ExplainOutcome, GitError | ShellError, Git | Shell> {
  return Effect.gen(function* () {
    if (!input.records.enabled) return { kind: "records-disabled" } as const;

    const git = yield* Git;

    const resolvedSha = yield* git.resolveRef(input.repoRoot, input.sha);
    if (resolvedSha === null) return { kind: "commit-not-found", sha: input.sha } as const;

    const message = yield* readCommitMessage(input.repoRoot, resolvedSha);
    const address = addressFromTrailers(parseTrailers(message));
    if (address === null) {
      return { kind: "not-phax-commit", sha: input.sha, resolvedSha } as const;
    }
    const key = keyOf(address);

    const isInRepo = input.records.destination.kind === "in-repo";
    const localPath = isInRepo ? input.repoRoot : input.recordsClonePath;
    const remote = isInRepo ? input.publishRemote : ORIGIN;

    if (localPath === undefined) {
      return { kind: "not-found", key, sourceSha: resolvedSha, remoteConsulted: false } as const;
    }

    let recordCommitSha: string | null = null;
    let foundVia: "local" | "remote-refresh" = "local";

    const localTip = yield* git.resolveRef(localPath, RECORDS_REF);
    if (localTip !== null) {
      recordCommitSha = yield* findRecordCommit(git, localPath, localTip, address);
    }

    if (recordCommitSha === null) {
      const fetchResult = yield* Effect.either(git.fetchRemote(remote, localPath));
      if (Either.isLeft(fetchResult)) {
        return { kind: "not-found", key, sourceSha: resolvedSha, remoteConsulted: false } as const;
      }

      const remoteTip = yield* git.resolveRef(
        localPath,
        `refs/remotes/${remote}/${RECORDS_BRANCH_NAME}`,
      );
      if (remoteTip !== null) {
        recordCommitSha = yield* findRecordCommit(git, localPath, remoteTip, address);
      }
      if (recordCommitSha === null) {
        return { kind: "not-found", key, sourceSha: resolvedSha, remoteConsulted: true } as const;
      }
      foundVia = "remote-refresh";
    }

    const loaded = yield* loadRecord(git, input.repoRoot, localPath, recordCommitSha, key);
    const prefix = `${key}/`;
    if (address.kind === "phase") {
      const record = explainPhaseRecord(loaded, address, recordCommitSha, foundVia, prefix);
      if (Either.isLeft(record)) return yield* Effect.fail(record.left);
      return { kind: "found", record: record.right } as const;
    }
    const record = explainAuthoringRecord(
      loaded,
      address.authoringId,
      recordCommitSha,
      foundVia,
      prefix,
    );
    if (Either.isLeft(record)) return yield* Effect.fail(record.left);
    return { kind: "found-authoring", record: record.right } as const;
  });
}
