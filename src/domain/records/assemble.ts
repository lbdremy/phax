import type { ProviderId } from "../../schemas/providerId.js";
import type {
  RecordOracleRole,
  RecordPhaseOutcome,
  RecordShape,
  RunRecordManifest,
  TokenUsage,
} from "../../schemas/runRecord.js";
import type { RecordedSurface } from "../../schemas/surface.js";
import { isStopArtifact } from "./stopArtifacts.js";

const TRANSCRIPT_FILE = "output.jsonl";

export interface AssembleRecordInput {
  readonly runId: string;
  readonly phaseId: string;
  /** Directory listing (file names) of the phase folder. No I/O happens here. */
  readonly files: readonly string[];
  /** The project's `records.transcript` toggle. */
  readonly transcriptEnabled: boolean;
  /** Absent for a phase that ended without a commit. */
  readonly sourceSha?: string;
  readonly model: string;
  readonly effort: string;
  readonly provider: ProviderId;
  readonly outcome: RecordPhaseOutcome;
  readonly usage: TokenUsage;
  readonly verifiedSurfaces: readonly RecordedSurface[];
  /** The phase's role in an oracle pair, or null when it is in none. */
  readonly oracle: RecordOracleRole;
}

export interface AssembledRecord {
  readonly manifest: RunRecordManifest;
  /** Ordered, deterministic set of phase-folder-relative paths the record carries. */
  readonly artifactPaths: readonly string[];
}

/** A phase session's one transcript. */
const PHASE_TRANSCRIPT_FILES: ReadonlySet<string> = new Set([TRANSCRIPT_FILE]);

/**
 * Decide which of a session folder's files a record carries, and its shape.
 *
 * Skeleton = every artifact except the transcripts (`transcriptFiles`: a
 * phase's `output.jsonl`; an authoring session's `output.jsonl` and, when
 * retried, `retry-output.jsonl`). Full = skeleton plus every transcript
 * present, and only when both the config enables the transcript and the
 * provider actually produced one. The transcripts are kept or dropped
 * together. Shared by phase and authoring records.
 */
export function selectRecordArtifacts(
  files: readonly string[],
  transcriptEnabled: boolean,
  transcriptFiles: ReadonlySet<string>,
): { readonly shape: RecordShape; readonly artifactPaths: readonly string[] } {
  const includeTranscript = transcriptEnabled && files.some((file) => transcriptFiles.has(file));
  const artifactPaths = files
    .filter((file) => !transcriptFiles.has(file) || includeTranscript)
    .toSorted((a, b) => a.localeCompare(b));
  return { shape: includeTranscript ? "full" : "skeleton", artifactPaths };
}

/**
 * Decide what a phase's record carries and assemble its manifest. Assembly is
 * pure: the writer performs no selection of its own, it only hashes and
 * commits what this returns.
 */
export function assembleRecord(input: AssembleRecordInput): AssembledRecord {
  // A stop's files are the review's, never the agent's work.
  const { shape, artifactPaths } = selectRecordArtifacts(
    input.files.filter((file) => !isStopArtifact(file)),
    input.transcriptEnabled,
    PHASE_TRANSCRIPT_FILES,
  );

  const manifest: RunRecordManifest = {
    runId: input.runId,
    phaseId: input.phaseId,
    shape,
    ...(input.sourceSha !== undefined ? { sourceSha: input.sourceSha } : {}),
    model: input.model,
    effort: input.effort,
    provider: input.provider,
    outcome: input.outcome,
    usage: input.usage,
    verifiedSurfaces: input.verifiedSurfaces,
    oracle: input.oracle,
  };

  return { manifest, artifactPaths };
}
