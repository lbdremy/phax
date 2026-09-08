import { collectPlanStructureErrors } from "./parsePlanMarkdown.js";

export type LintSeverity = "error" | "warning";
export type LintCheck = "structure" | "files" | "commands" | "models";

export interface LintFinding {
  readonly severity: LintSeverity;
  readonly check: LintCheck;
  readonly phase: string | null;
  readonly message: string;
}

/**
 * Maps every structural defect `collectPlanStructureErrors` can find to an
 * `error` finding on the `structure` check (spec 33 §5.2, §6).
 */
export function structureFindings(planMd: string): readonly LintFinding[] {
  return collectPlanStructureErrors(planMd).map((e) => ({
    severity: "error",
    check: "structure",
    phase: e.phase,
    message: e.message,
  }));
}
