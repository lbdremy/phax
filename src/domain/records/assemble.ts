import type { PhaseMode } from "../../schemas/phaxPlan.js";
import type { ProviderId } from "../../schemas/providerId.js";
import type {
  RecordAcceptanceRole,
  RecordPhaseOutcome,
  RecordShape,
  RecordStop,
  RunRecordManifest,
  TokenUsage,
} from "../../schemas/runRecord.js";
import type { RecordedSurface } from "../../schemas/surface.js";
import { isArchivedTranscript } from "../session/failureArchive.js";
import { isPhaseRecordFile, isTranscriptClassFile } from "./phaseRecordFiles.js";
import { isStopArtifact } from "./stopArtifacts.js";
import { userConfigOf } from "./userConfig.js";
import { isVibeExportDir } from "./usage.js";

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
  /** The phase's role in an acceptance pair, or null when it is in none. */
  readonly acceptance: RecordAcceptanceRole;
  /** The plan's mode for the phase. */
  readonly mode: PhaseMode;
  /** The phase's stop, or null when it never stopped. */
  readonly stop: RecordStop;
}

export interface AssembledRecord {
  readonly manifest: RunRecordManifest;
  /** Ordered, deterministic set of phase-folder-relative paths the record carries. */
  readonly artifactPaths: readonly string[];
}

/**
 * Decide which of a session folder's files a record carries, and its shape.
 *
 * Skeleton = every artifact except the transcripts (`transcriptFiles`: a
 * phase's `output.jsonl`; an authoring session's `output.jsonl` and, when
 * retried, `retry-output.jsonl`). Full = skeleton plus every transcript
 * present, and only when both the config enables the transcript and the
 * provider actually produced one. The transcripts are kept or dropped
 * together. An earlier failed session's archived transcript
 * (`output.failed-NN.jsonl`) is another session's and never carried; its
 * archived `agent-error.failed-NN.log` is, as `agent-error.log` is. Used by
 * authoring, decision and revision records; a phase record selects through
 * its own allowlist (`selectPhaseRecordArtifacts`).
 */
export function selectRecordArtifacts(
  files: readonly string[],
  transcriptEnabled: boolean,
  transcriptFiles: ReadonlySet<string>,
): { readonly shape: RecordShape; readonly artifactPaths: readonly string[] } {
  const includeTranscript = transcriptEnabled && files.some((file) => transcriptFiles.has(file));
  const artifactPaths = files
    .filter((file) => !isArchivedTranscript(file))
    .filter((file) => !transcriptFiles.has(file) || includeTranscript)
    .toSorted((a, b) => a.localeCompare(b));
  return { shape: includeTranscript ? "full" : "skeleton", artifactPaths };
}

/**
 * Decide which of a phase folder's files its record carries, and its shape
 * (SEC-02). Only allowlisted names are carried (`phaseRecordFiles.ts`). Two
 * questions, two answers: the `records.transcript` toggle alone decides the
 * transcript-class files (all dropped when off, all kept when on, whatever the
 * shape); `output.jsonl` alone decides the shape (full when the toggle is on
 * and it is present, skeleton otherwise).
 */
function selectPhaseRecordArtifacts(
  files: readonly string[],
  transcriptEnabled: boolean,
): { readonly shape: RecordShape; readonly artifactPaths: readonly string[] } {
  const artifactPaths = files
    // A stop's files are the review's, never the agent's work; its transcript
    // copies (`interactive-transcripts/`) are among them, whatever the toggle.
    .filter((file) => !isStopArtifact(file) && !isVibeExportDir(file))
    .filter((file) => !isArchivedTranscript(file))
    .filter((file) => isPhaseRecordFile(file))
    .filter((file) => transcriptEnabled || !isTranscriptClassFile(file))
    .toSorted((a, b) => a.localeCompare(b));
  const shape = transcriptEnabled && files.includes(TRANSCRIPT_FILE) ? "full" : "skeleton";
  return { shape, artifactPaths };
}

/**
 * Decide what a phase's record carries and assemble its manifest. Assembly is
 * pure: the writer performs no selection of its own, it only hashes and
 * commits what this returns.
 */
export function assembleRecord(input: AssembleRecordInput): AssembledRecord {
  const { shape, artifactPaths } = selectPhaseRecordArtifacts(input.files, input.transcriptEnabled);

  const manifest: RunRecordManifest = {
    runId: input.runId,
    phaseId: input.phaseId,
    shape,
    ...(input.sourceSha !== undefined ? { sourceSha: input.sourceSha } : {}),
    model: input.model,
    effort: input.effort,
    provider: input.provider,
    userConfig: userConfigOf(input.provider),
    outcome: input.outcome,
    usage: input.usage,
    verifiedSurfaces: input.verifiedSurfaces,
    acceptance: input.acceptance,
    mode: input.mode,
    stop: input.stop,
  };

  return { manifest, artifactPaths };
}
