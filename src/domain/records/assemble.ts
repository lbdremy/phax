import type { ProviderId } from "../../schemas/providerId.js";
import type {
  RecordPhaseOutcome,
  RecordShape,
  RunRecordManifest,
  TokenUsage,
} from "../../schemas/runRecord.js";
import type { Surface } from "../../schemas/phaxConfig.js";

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
  readonly verifiedSurfaces: readonly Surface[];
}

export interface AssembledRecord {
  readonly manifest: RunRecordManifest;
  /** Ordered, deterministic set of phase-folder-relative paths the record carries. */
  readonly artifactPaths: readonly string[];
}

/**
 * Decide which of a session folder's files a record carries, and its shape.
 *
 * Skeleton = every artifact except `output.jsonl`. Full = skeleton plus
 * `output.jsonl`, and only when both the config enables the transcript and
 * the provider actually produced one. Shared by phase and authoring records.
 */
export function selectRecordArtifacts(
  files: readonly string[],
  transcriptEnabled: boolean,
): { readonly shape: RecordShape; readonly artifactPaths: readonly string[] } {
  const includeTranscript = transcriptEnabled && files.includes(TRANSCRIPT_FILE);
  const artifactPaths = files
    .filter((file) => file !== TRANSCRIPT_FILE || includeTranscript)
    .toSorted((a, b) => a.localeCompare(b));
  return { shape: includeTranscript ? "full" : "skeleton", artifactPaths };
}

/**
 * Decide what a phase's record carries and assemble its manifest. Assembly is
 * pure: the writer performs no selection of its own, it only hashes and
 * commits what this returns.
 */
export function assembleRecord(input: AssembleRecordInput): AssembledRecord {
  const { shape, artifactPaths } = selectRecordArtifacts(input.files, input.transcriptEnabled);

  const manifest: RunRecordManifest = {
    version: 2,
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
  };

  return { manifest, artifactPaths };
}
