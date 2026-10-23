import { currentSchemaUrl } from "../../src/schemas/persisted.js";
import type { RunStatus } from "../../src/schemas/status.js";

/** The facts a test gives a run status: every required field but `hold`, which defaults to none. */
export type RunStatusFields = Omit<RunStatus, "hold"> & Partial<Pick<RunStatus, "hold">>;

/** A run status in memory: `hold: { selection: "none" }` unless given. */
export function runStatus(fields: RunStatusFields): RunStatus {
  return { hold: { selection: "none" }, ...fields };
}

/**
 * A run's `run-status.json` as phax writes it: `$schema` at the format's
 * current stamp first, then the status.
 */
export function runStatusFile(fields: RunStatusFields) {
  return { $schema: currentSchemaUrl("run-status"), ...runStatus(fields) };
}
