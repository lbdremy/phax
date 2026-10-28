import { Effect, Either } from "effect";
import { join } from "node:path";
import {
  extractClaudeUsage,
  extractCodexUsage,
  extractVibeExportUsage,
  phaseSessionTranscripts,
  vibeExportFileOf,
} from "../domain/records/usage.js";
import {
  decideRecordsDestination,
  type RecordsDestinationRefusalReason,
  type VisibilityReading,
} from "../domain/records/destination.js";
import { decodeBranchName, type BranchName } from "../domain/branded.js";
import { FileSystem, type FileSystemOps, type FsError } from "../ports/fs.js";
import { Git, type GitError } from "../ports/git.js";
import { GitHub } from "../ports/github.js";
import type { ProviderId } from "../schemas/providerId.js";
import type { RecordsDestination, ResolvedRecordsConfig } from "../schemas/recordsConfig.js";
import {
  UNAVAILABLE_TOKEN_USAGE,
  type ProviderTokenUsage,
  type RecordShape,
  type TokenUsage,
} from "../schemas/runRecord.js";

// Shared by the three record writers (`writeRecord.ts` for phases,
// `writeAuthoringRecord.ts` for headless authoring sessions,
// `writeDecisionRecord.ts` for decide sessions): destination policy, usage
// extraction, and the tree-only commit on the records branch.

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

export type RecordSkipped =
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
    let visibility: VisibilityReading = { visibility: "unknown", ghError: null };
    if (input.records.transcript && input.records.destination.kind === "in-repo") {
      const github = yield* GitHub;
      visibility = yield* github
        .visibility(input.repoRoot)
        .pipe(
          Effect.orElseSucceed((): VisibilityReading => ({ visibility: "unknown", ghError: null })),
        );
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
  /**
   * Strings no recorded artifact may carry (a decision or authoring record's
   * provider session ids): each occurrence is replaced by `[session id withheld]`.
   */
  readonly redact?: readonly string[] | undefined;
}

const REDACTED_SESSION_ID = "[session id withheld]";

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
    const redact = (input.redact ?? []).filter((value) => value.length > 0);
    for (const name of input.artifactPaths) {
      let text = yield* fs.readText(join(input.folder, name));
      for (const value of redact) text = text.replaceAll(value, REDACTED_SESSION_ID);
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
 * Read a phase session's token usage from its provider-specific source:
 * Claude and codex carry it in `output.jsonl`, vibe keeps none there and
 * writes it in the `export.json` of each turn's `--output-dir`, beside the
 * turn's transcript, counting that turn only, so a vibe phase sums its turn,
 * its fix attempts and its handoff (`phaseSessionTranscripts`). Any failure to
 * read degrades to the explicitly unavailable variant — usage is never
 * reported as zero (spec §5.5).
 */
export function computeRecordUsage(input: {
  readonly provider: ProviderId;
  readonly folder: string;
  readonly sessionId: string | undefined;
}): Effect.Effect<TokenUsage, never, FileSystem> {
  return Effect.gen(function* () {
    if (input.provider !== "mistral-vibe") {
      return yield* computeSessionUsage({
        provider: input.provider,
        folder: input.folder,
        turns: [{ transcript: RECORD_TRANSCRIPT_FILE, sessionId: input.sessionId }],
      });
    }
    const fs = yield* FileSystem;
    const names = yield* fs.list(input.folder).pipe(Effect.orElseSucceed(() => []));
    const transcripts = phaseSessionTranscripts(names);
    if (transcripts.length === 0) return UNAVAILABLE_TOKEN_USAGE;
    return yield* computeSessionUsage({
      provider: input.provider,
      folder: input.folder,
      turns: transcripts.map((transcript) => ({ transcript, sessionId: input.sessionId })),
    });
  });
}

/** One turn of a session: the transcript file it wrote and the session id it reported. */
interface SessionTurn {
  /** Folder-relative name of the turn's transcript (`output.jsonl`, `retry-output.jsonl`). */
  readonly transcript: string;
  readonly sessionId: string | undefined;
}

/**
 * A session's token usage over every turn it ran (the first run and, for a
 * retried authoring session, its resume). Claude and codex report each
 * invocation's usage in that turn's transcript, vibe in the `export.json` of
 * that turn's export directory (`vibeExportFileOf`), whose usage counts that
 * turn only: the turns are summed field by field, never deduplicated by
 * session id. When any turn's usage cannot be read the whole is unavailable,
 * never a partial count shown as a total.
 */
export function computeSessionUsage(input: {
  readonly provider: ProviderId;
  readonly folder: string;
  readonly turns: readonly SessionTurn[];
}): Effect.Effect<TokenUsage, never, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const { provider } = input;
    const counted: ProviderTokenUsage[] = [];
    if (provider === "claude-code" || provider === "codex-cli") {
      for (const turn of input.turns) {
        const usage = yield* readTranscriptUsage(fs, provider, join(input.folder, turn.transcript));
        if (usage === undefined) return UNAVAILABLE_TOKEN_USAGE;
        counted.push(usage);
      }
    } else {
      for (const turn of input.turns) {
        const usage = yield* readVibeExportUsage(fs, join(input.folder, turn.transcript));
        if (usage === undefined) return UNAVAILABLE_TOKEN_USAGE;
        counted.push(usage);
      }
    }
    let usage: ProviderTokenUsage | undefined = counted[0];
    for (const next of counted.slice(1)) {
      usage = usage === undefined ? undefined : addUsage(usage, next);
    }
    return usage === undefined ? UNAVAILABLE_TOKEN_USAGE : { available: true as const, usage };
  });
}

/** One transcript's usage as its provider reports it, or undefined when it cannot be read. */
function readTranscriptUsage(
  fs: FileSystemOps,
  provider: "claude-code" | "codex-cli",
  outputPath: string,
): Effect.Effect<ProviderTokenUsage | undefined, never> {
  return Effect.gen(function* () {
    const exists = yield* fs.exists(outputPath).pipe(Effect.orElseSucceed(() => false));
    if (!exists) return undefined;
    const text = yield* fs.readText(outputPath).pipe(Effect.orElseSucceed(() => ""));
    const lines = text.split("\n");
    return provider === "claude-code" ? extractClaudeUsage(lines) : extractCodexUsage(lines);
  });
}

/** One Vibe turn's usage from the `export.json` beside its transcript, or undefined when it cannot be read. */
function readVibeExportUsage(
  fs: FileSystemOps,
  transcriptPath: string,
): Effect.Effect<ProviderTokenUsage | undefined, never> {
  return Effect.gen(function* () {
    const text = yield* fs
      .readText(vibeExportFileOf(transcriptPath))
      .pipe(Effect.orElseSucceed(() => undefined));
    return text === undefined ? undefined : extractVibeExportUsage(text);
  });
}

/** Two turns' usage summed field by field; undefined when they come from different providers. */
function addUsage(a: ProviderTokenUsage, b: ProviderTokenUsage): ProviderTokenUsage | undefined {
  if (a.provider === "claude-code" && b.provider === "claude-code") {
    return {
      provider: "claude-code",
      inputTokens: a.inputTokens + b.inputTokens,
      cacheCreationInputTokens: a.cacheCreationInputTokens + b.cacheCreationInputTokens,
      cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
      outputTokens: a.outputTokens + b.outputTokens,
      totalCostUsd: a.totalCostUsd + b.totalCostUsd,
    };
  }
  if (a.provider === "codex-cli" && b.provider === "codex-cli") {
    return {
      provider: "codex-cli",
      inputTokens: a.inputTokens + b.inputTokens,
      cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
      outputTokens: a.outputTokens + b.outputTokens,
      reasoningOutputTokens: a.reasoningOutputTokens + b.reasoningOutputTokens,
    };
  }
  if (a.provider === "mistral-vibe" && b.provider === "mistral-vibe") {
    return {
      provider: "mistral-vibe",
      inputTokens: a.inputTokens + b.inputTokens,
      cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
      outputTokens: a.outputTokens + b.outputTokens,
      costUsd: a.costUsd + b.costUsd,
    };
  }
  return undefined;
}
