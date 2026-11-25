/**
 * The phase-folder files a phase record may carry (SEC-02). A record carries
 * only the names this table lists; any other entry of the phase folder is
 * carried by neither shape. Each entry is tagged transcript-class or not: a
 * transcript-class file holds what an agent session or a project command
 * printed, and a record written with `records.transcript: false` carries none.
 *
 * Never listed, so never carried: a stop's files (`stopArtifacts.ts`), Vibe
 * export directories (`*.vibe-export`) and an earlier failed session's
 * archived transcript (`*.failed-NN.jsonl`). Pure: no I/O.
 */
import { isAttemptFile, isAttemptTranscript } from "../gate/attemptFiles.js";
import { AGENT_ERROR_LOG, isArchivedFailureLog } from "../session/failureArchive.js";

/** Exact names, each tagged transcript-class (`true`) or not (`false`). */
const EXACT_FILES: ReadonlyMap<string, boolean> = new Map([
  ["prompt.md", false],
  ["status.json", false],
  ["security.json", false],
  ["model-resolution.json", false],
  ["agent-binding.json", false],
  ["claude-session-id.txt", false],
  ["diff.patch", false],
  ["file-reconciliation.json", false],
  ["file-reconciliation.md", false],
  ["gate-attribution.json", false],
  ["phase-handoff.md", false],
  // The pushed brief's record, decoded before it is written.
  ["brief-00.json", false],
  ["output.jsonl", true],
  ["handoff-generation.jsonl", true],
  ["setup.log", true],
  [AGENT_ERROR_LOG, true],
]);

/** A pulled brief's record, `brief-NN.json` (`brief-00.json` is the pushed one). */
const BRIEF_RECORD = /^brief-\d{2,}\.json$/;

/**
 * Per-attempt names: every `checks-attempt-NN.*` file and the fix transcript
 * `fix-attempt-NN.jsonl` (`attemptFiles.ts`), the archived failure log
 * `agent-error.failed-NN.log` and a pulled brief's record.
 */
function isPerAttemptFile(name: string): boolean {
  return isAttemptFile(name) || isArchivedFailureLog(name) || BRIEF_RECORD.test(name);
}

/**
 * Transcript-class per-attempt names: the gate log `checks-attempt-NN.log`,
 * the fix transcript `fix-attempt-NN.jsonl` and `agent-error.failed-NN.log`.
 */
function isPerAttemptTranscript(name: string): boolean {
  return isAttemptTranscript(name) || isArchivedFailureLog(name);
}

/** Whether a phase record may carry `name`, an entry of the phase folder. */
export function isPhaseRecordFile(name: string): boolean {
  return EXACT_FILES.has(name) || isPerAttemptFile(name);
}

/** Whether `name` is an allowlisted, transcript-class phase-folder file. */
export function isTranscriptClassFile(name: string): boolean {
  return EXACT_FILES.get(name) ?? isPerAttemptTranscript(name);
}
