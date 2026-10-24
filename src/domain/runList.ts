// The rows of `phax ls --json`, as the `run-list` document holds them. Pure:
// ls reads the runs and their stops, this shapes what it read.
import type { RunList, RunListRow } from "../schemas/runList.js";

/** One run as `phax ls` reconciled it, with the stop it waits at. */
export interface LsRunRow {
  readonly qualifiedName: string;
  readonly namespace: string;
  readonly shortName: string;
  readonly state: RunListRow["state"];
  readonly branch: string;
  /** `-` where the run's progress is unknown. */
  readonly currentPhase: string;
  /** `-` where the run's gate profile is unknown. */
  readonly gateProfile: string;
  readonly updatedAt: string;
  readonly lockState: RunListRow["lockState"];
  /** Undefined where records are off, or belong to another project. */
  readonly recordsPending: number | undefined;
  readonly archivePath: string | undefined;
  /** The run's review-stop document, with its `$schema`; null when it has none or it cannot be read. */
  readonly stop: RunListRow["stop"];
}

const UNKNOWN = "-";

/**
 * The run list for `rows`. Every key is written: null stands where the table
 * prints `-` and where `ls --json` used to leave a key out.
 */
export function buildRunList(rows: ReadonlyArray<LsRunRow>): RunList {
  return {
    runs: rows.map((r) => ({
      qualifiedName: r.qualifiedName,
      namespace: r.namespace,
      shortName: r.shortName,
      state: r.state,
      branch: r.branch,
      currentPhase: r.currentPhase === UNKNOWN ? null : r.currentPhase,
      gateProfile: r.gateProfile === UNKNOWN ? null : r.gateProfile,
      updatedAt: r.updatedAt,
      lockState: r.lockState,
      recordsPending: r.recordsPending ?? null,
      archivePath: r.archivePath ?? null,
      stop: r.stop,
    })),
  };
}
