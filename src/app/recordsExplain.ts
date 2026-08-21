import { Effect, Either } from "effect";
import { Git, GitError, type GitOps } from "../ports/git.js";
import { Shell, type ShellError } from "../ports/shell.js";
import { ORIGIN } from "./recordsSync.js";
import { RECORDS_BRANCH_NAME } from "./writeRecord.js";
import { decodeRunRecordManifest, type RunRecordManifest } from "../schemas/runRecord.js";
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

export type ExplainOutcome =
  | { readonly kind: "records-disabled" }
  | { readonly kind: "commit-not-found"; readonly sha: string }
  | { readonly kind: "not-phax-commit"; readonly sha: string; readonly resolvedSha: string }
  | {
      readonly kind: "not-found";
      readonly runId: string;
      readonly phaseId: string;
      readonly sourceSha: string;
      /** Whether the remote was consulted before reporting this outcome —
       * false only ever means "unreachable", never "skipped" (spec §5.9). */
      readonly remoteConsulted: boolean;
    }
  | { readonly kind: "found"; readonly record: ExplainedRecord };

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
 * Find the records-branch commit whose message trailers match `runId` and
 * `phaseId`, walking history from `ref`. Record commits are not cumulative —
 * each write's tree holds only that write's own files (spec §5.3's plumbing
 * builds a fresh tree per commit) — so an older phase's record is not present
 * in the branch tip's tree; it has to be located by the commit that wrote it.
 * `--fixed-strings` makes both `--grep`s literal substring matches, so a
 * run/phase id containing regex metacharacters cannot misbehave.
 */
function findRecordCommit(
  repo: string,
  ref: string,
  runId: string,
  phaseId: string,
): Effect.Effect<string | null, ShellError, Shell> {
  return Effect.gen(function* () {
    const shell = yield* Shell;
    const result = yield* shell.run({
      command: [
        "git",
        "log",
        ref,
        "--format=%H",
        "--fixed-strings",
        `--grep=Run-Id: ${runId}`,
        `--grep=Phase-Id: ${phaseId}`,
        "--all-match",
        "-n",
        "1",
      ],
      cwd: repo,
    });
    const sha = result.stdout.trim();
    return sha.length > 0 ? sha : null;
  });
}

function loadRecord(
  git: GitOps,
  repoRoot: string,
  localPath: string,
  recordCommitSha: string,
  runId: string,
  phaseId: string,
  foundVia: "local" | "remote-refresh",
): Effect.Effect<ExplainedRecord, GitError> {
  return Effect.gen(function* () {
    const prefix = `${runId}/${phaseId}/`;
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
      return yield* Effect.fail(
        new GitError({
          message: `Malformed ${prefix}record.json at ${recordCommitSha}: ${String(cause)}`,
          command: "records explain",
        }),
      );
    }
    const decoded = decodeRunRecordManifest(manifestJson);
    if (Either.isLeft(decoded)) {
      return yield* Effect.fail(
        new GitError({
          message: `Malformed ${prefix}record.json at ${recordCommitSha}: ${decoded.left.message}`,
          command: "records explain",
        }),
      );
    }
    const manifest = decoded.right;

    const artifacts = new Map<string, Uint8Array>();
    for (const entry of relevant) {
      if (entry.path === manifestEntry.path) continue;
      const bytes = yield* git.readBlob(localPath, entry.oid);
      artifacts.set(entry.path.slice(prefix.length), bytes);
    }

    const checksAttemptCount = [...artifacts.keys()].filter((name) =>
      /^checks-attempt-\d+\.log$/.test(name),
    ).length;

    const promptBytes = artifacts.get("prompt.md");
    const diffBytes = artifacts.get("diff.patch");

    const sourceCommitReachable =
      manifest.sourceSha !== undefined
        ? (yield* git.resolveRef(repoRoot, manifest.sourceSha)) !== null
        : undefined;

    return {
      runId,
      phaseId,
      manifest,
      recordCommitSha,
      foundVia,
      ...(sourceCommitReachable !== undefined ? { sourceCommitReachable } : {}),
      checksAttemptCount,
      ...(promptBytes !== undefined ? { promptByteLength: promptBytes.length } : {}),
      ...(diffBytes !== undefined ? { diffStat: parseDiffStat(decodeText(diffBytes)) } : {}),
      handoffPresent: artifacts.has("phase-handoff.md"),
      artifacts,
    } as const;
  });
}

/**
 * Resolve `phax records explain <sha>`: read `sha`'s trailers in the source
 * repo, locate the record they key (never the sha itself, spec §5.2), and load
 * it from the local records clone or, on a local miss, the remote-tracking ref
 * — never requiring a checked-out local records branch (spec §5.9).
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
    const trailers = parseTrailers(message);
    const runId = trailers.get("Run-Id");
    const phaseId = trailers.get("Phase-Id");
    if (runId === undefined || phaseId === undefined) {
      return { kind: "not-phax-commit", sha: input.sha, resolvedSha } as const;
    }

    const isInRepo = input.records.destination.kind === "in-repo";
    const localPath = isInRepo ? input.repoRoot : input.recordsClonePath;
    const remote = isInRepo ? input.publishRemote : ORIGIN;

    if (localPath === undefined) {
      return {
        kind: "not-found",
        runId,
        phaseId,
        sourceSha: resolvedSha,
        remoteConsulted: false,
      } as const;
    }

    let recordCommitSha: string | null = null;
    let foundVia: "local" | "remote-refresh" = "local";

    const localTip = yield* git.resolveRef(localPath, RECORDS_REF);
    if (localTip !== null) {
      recordCommitSha = yield* findRecordCommit(localPath, localTip, runId, phaseId);
    }

    if (recordCommitSha === null) {
      const fetchResult = yield* Effect.either(git.fetchRemote(remote, localPath));
      if (Either.isLeft(fetchResult)) {
        return {
          kind: "not-found",
          runId,
          phaseId,
          sourceSha: resolvedSha,
          remoteConsulted: false,
        } as const;
      }

      const remoteTip = yield* git.resolveRef(
        localPath,
        `refs/remotes/${remote}/${RECORDS_BRANCH_NAME}`,
      );
      if (remoteTip !== null) {
        recordCommitSha = yield* findRecordCommit(localPath, remoteTip, runId, phaseId);
      }
      if (recordCommitSha === null) {
        return {
          kind: "not-found",
          runId,
          phaseId,
          sourceSha: resolvedSha,
          remoteConsulted: true,
        } as const;
      }
      foundVia = "remote-refresh";
    }

    const record = yield* loadRecord(
      git,
      input.repoRoot,
      localPath,
      recordCommitSha,
      runId,
      phaseId,
      foundVia,
    );
    return { kind: "found", record } as const;
  });
}
