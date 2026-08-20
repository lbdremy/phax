import { Effect, Either } from "effect";
import { homedir } from "node:os";
import { join } from "node:path";
import { assembleRecord } from "../domain/records/assemble.js";
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
  encodeRunRecordManifest,
  UNAVAILABLE_TOKEN_USAGE,
  type RecordPhaseOutcome,
  type RecordShape,
  type TokenUsage,
} from "../schemas/runRecord.js";

/**
 * The records branch is an ordinary branch, not a custom ref namespace, so it
 * travels with a clone and a fetch (spec §5.3). Phase-03's `writeTreeCommit`
 * takes the branch as a parameter; this is the value phase-04 passes.
 */
export const RECORDS_BRANCH_NAME = "phax/records/v1";

const RECORDS_BRANCH: BranchName = Either.getOrThrow(decodeBranchName(RECORDS_BRANCH_NAME));

const TRANSCRIPT_FILE = "output.jsonl";
const MANIFEST_FILE = "record.json";

export interface WriteRecordInput {
  /** The source repository. Also where `phax/records/v1` receives the commit
   * when the destination is `in-repo`. */
  readonly repoRoot: string;
  /**
   * The local records clone's path (`recordsClonePath` in recordsSync.ts),
   * where `phax/records/v1` receives the commit when the destination is a
   * dedicated `repo` — required in that case, ignored for `in-repo`.
   */
  readonly recordsClonePath?: string | undefined;
  /** The phase's run-folder path (where its artifacts were written), not the worktree. */
  readonly phaseFolderPath: string;
  /** The record key's first component — the `Run-Id` the phase commit already carries. */
  readonly runId: string;
  /** The record key's second component — the `Phase-Id` the phase commit already carries. */
  readonly phaseId: string;
  readonly provider: ProviderId;
  readonly model: string;
  readonly effort: string;
  readonly outcome: RecordPhaseOutcome;
  readonly records: ResolvedRecordsConfig;
  /** Back-reference recorded when the phase committed; absent for a phase that never did. */
  readonly sourceSha?: string | undefined;
  /** The agent session id, used to locate a vibe session's `meta.json` for usage. */
  readonly sessionId?: string | undefined;
  /** Overridable vibe home (`~/.vibe` by default) so tests can point at a fixture. */
  readonly vibeHome?: string | undefined;
}

export type WriteRecordResult =
  | {
      readonly kind: "written";
      readonly commitSha: string;
      readonly branch: string;
      readonly key: string;
      readonly shape: RecordShape;
      readonly fileCount: number;
    }
  | { readonly kind: "records-off" }
  | { readonly kind: "deferred-destination"; readonly destination: "repo" }
  | {
      readonly kind: "refused";
      readonly reason: RecordsDestinationRefusalReason;
      readonly destination: RecordsDestination;
      readonly message: string;
      readonly remedy: string;
    };

/**
 * Assemble a phase's record and write it as one commit on `phax/records/v1`,
 * keyed by `runId/phaseId`, without touching the working tree or index (the
 * plumbing from phase-03 drives a scratch index). Records off is a total
 * no-op. The commit lands on the source repo for an `in-repo` destination, or
 * on the local records clone (`recordsClonePath`) for a dedicated `repo`
 * destination — and only once the destination policy allows it (spec §5.4):
 * detection guards the configured choice, it never picks one.
 */
export function writeRecord(
  input: WriteRecordInput,
): Effect.Effect<WriteRecordResult, GitError | FsError, Git | FileSystem | GitHub> {
  return Effect.gen(function* () {
    if (!input.records.enabled) return { kind: "records-off" } as const;

    // A dedicated repo destination writes to the local clone, which must
    // already exist by the time a phase runs — the run preflight
    // (recordsSync.ts) refuses the run before any phase spawns otherwise.
    // No clone path here is a caller bug, not a policy refusal, but degrades
    // to the same deferred outcome phase-04 used before this destination was
    // implemented rather than crashing the phase.
    let targetRepoRoot = input.repoRoot;
    if (input.records.destination.kind === "repo") {
      if (input.recordsClonePath === undefined) {
        return { kind: "deferred-destination", destination: "repo" } as const;
      }
      targetRepoRoot = input.recordsClonePath;
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
    const destinationDecision = decideRecordsDestination({
      transcript: input.records.transcript,
      destination: input.records.destination,
      visibility,
    });
    if (destinationDecision.kind === "refused") {
      return {
        kind: "refused",
        reason: destinationDecision.reason,
        destination: destinationDecision.destination,
        message: destinationDecision.message,
        remedy: destinationDecision.remedy,
      } as const;
    }

    const fs = yield* FileSystem;
    const git = yield* Git;

    const files = yield* fs.list(input.phaseFolderPath);
    const vibeHome = input.vibeHome ?? join(homedir(), ".vibe");
    const usage = yield* computeUsage(
      fs,
      input.provider,
      input.phaseFolderPath,
      input.sessionId,
      vibeHome,
    );

    const { manifest, artifactPaths } = assembleRecord({
      runId: input.runId,
      phaseId: input.phaseId,
      files,
      transcriptEnabled: input.records.transcript,
      ...(input.sourceSha !== undefined ? { sourceSha: input.sourceSha } : {}),
      model: input.model,
      effort: input.effort,
      provider: input.provider,
      outcome: input.outcome,
      usage,
    });

    const key = `${input.runId}/${input.phaseId}`;
    const encoder = new TextEncoder();
    const gitFiles: { path: string; content: Uint8Array }[] = [];
    for (const name of artifactPaths) {
      const text = yield* fs.readText(join(input.phaseFolderPath, name));
      gitFiles.push({ path: `${key}/${name}`, content: encoder.encode(text) });
    }
    const manifestJson = JSON.stringify(encodeRunRecordManifest(manifest), null, 2);
    gitFiles.push({
      path: `${key}/${MANIFEST_FILE}`,
      content: encoder.encode(`${manifestJson}\n`),
    });

    const message = [
      `records(${input.phaseId}): ${input.outcome}`,
      "",
      `Run-Id: ${input.runId}`,
      `Phase-Id: ${input.phaseId}`,
      `Shape: ${manifest.shape}`,
    ].join("\n");

    const commitSha = yield* git.writeTreeCommit({
      repo: targetRepoRoot,
      branch: RECORDS_BRANCH,
      message,
      files: gitFiles,
    });

    return {
      kind: "written",
      commitSha,
      branch: RECORDS_BRANCH_NAME,
      key,
      shape: manifest.shape,
      fileCount: gitFiles.length,
    } as const;
  });
}

/**
 * Read the phase's token usage from its provider-specific source: Claude and
 * codex carry it in `output.jsonl`, vibe keeps none there and records it in the
 * session `meta.json`. Any failure to read degrades to the explicitly
 * unavailable variant — usage is never reported as zero (spec §5.5).
 */
function computeUsage(
  fs: FileSystemOps,
  provider: ProviderId,
  phaseFolderPath: string,
  sessionId: string | undefined,
  vibeHome: string,
): Effect.Effect<TokenUsage, never> {
  return Effect.gen(function* () {
    if (provider === "claude-code" || provider === "codex-cli") {
      const outputPath = join(phaseFolderPath, TRANSCRIPT_FILE);
      const exists = yield* fs.exists(outputPath).pipe(Effect.orElseSucceed(() => false));
      if (!exists) return UNAVAILABLE_TOKEN_USAGE;
      const text = yield* fs.readText(outputPath).pipe(Effect.orElseSucceed(() => ""));
      const lines = text.split("\n");
      const usage =
        provider === "claude-code" ? extractClaudeUsage(lines) : extractCodexUsage(lines);
      return usage === undefined ? UNAVAILABLE_TOKEN_USAGE : { available: true as const, usage };
    }

    const metaText = yield* readVibeSessionMeta(fs, vibeHome, sessionId);
    if (metaText === undefined) return UNAVAILABLE_TOKEN_USAGE;
    const usage = extractVibeUsage(metaText);
    return usage === undefined ? UNAVAILABLE_TOKEN_USAGE : { available: true as const, usage };
  });
}

/**
 * Locate the `meta.json` of the vibe session that produced this phase by
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
