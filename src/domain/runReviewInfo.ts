import type { PhaseStatus } from "../schemas/status.js";

export interface RunReviewInfo {
  readonly shortName: string;
  readonly runId: string;
  readonly runState: string;
  readonly branch: string;
  readonly stateRoot: string;
  readonly runPath: string;
  readonly finalPhaseId: string;
  readonly finalPhaseTitle: string;
  readonly worktreePath: string;
  readonly claudeSessionId: string | undefined;
  readonly gateProfileId: string | undefined;
  readonly phaseStatuses: readonly PhaseStatus[];
  readonly planPhases: ReadonlyArray<{ id: string; title: string }>;
  readonly updatedAt: string;
  readonly stoppedReason: string | undefined;
  readonly lastError: string | undefined;
}
