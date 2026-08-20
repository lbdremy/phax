import type { ProviderId } from "../../schemas/providerId.js";
import type { RecordPhaseOutcome, RunRecordManifest, TokenUsage } from "../../schemas/runRecord.js";

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
}

export interface AssembledRecord {
  readonly manifest: RunRecordManifest;
  /** Ordered, deterministic set of phase-folder-relative paths the record carries. */
  readonly artifactPaths: readonly string[];
}

/**
 * Decide what a phase's record carries and assemble its manifest.
 *
 * Skeleton = every artifact except `output.jsonl`. Full = skeleton plus
 * `output.jsonl`, and only when both the config enables the transcript and
 * the provider actually produced one. Assembly is pure: the writer performs
 * no selection of its own, it only hashes and commits what this returns.
 */
export function assembleRecord(input: AssembleRecordInput): AssembledRecord {
  const hasTranscript = input.files.includes(TRANSCRIPT_FILE);
  const includeTranscript = input.transcriptEnabled && hasTranscript;
  const shape = includeTranscript ? "full" : "skeleton";

  const artifactPaths = input.files
    .filter((file) => file !== TRANSCRIPT_FILE || includeTranscript)
    .toSorted((a, b) => a.localeCompare(b));

  const manifest: RunRecordManifest = {
    version: 1,
    runId: input.runId,
    phaseId: input.phaseId,
    shape,
    ...(input.sourceSha !== undefined ? { sourceSha: input.sourceSha } : {}),
    model: input.model,
    effort: input.effort,
    provider: input.provider,
    outcome: input.outcome,
    usage: input.usage,
  };

  return { manifest, artifactPaths };
}
