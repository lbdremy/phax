import type { TestLoop } from "../../schemas/testLine.js";
import {
  criterionCoverage,
  uncoveredCriterionMessage,
  unknownCriterionMessage,
  type NoCriterionIdsReason,
} from "./criterionCoverage.js";
import type { LintFinding } from "./lint.js";

/** What the source spec reader found, as the rules read it. */
export type CriteriaInput =
  | { readonly kind: "no-source-spec" }
  | { readonly kind: "criteria"; readonly slug: string; readonly ids: readonly string[] }
  | {
      readonly kind: "no-criterion-ids";
      readonly reason: NoCriterionIdsReason;
      readonly message: string;
    };

export interface TestLineCheckPhase {
  readonly id: string;
  /** Null when the phase is not an oracle phase. */
  readonly oracle: object | null;
  /** The kept lines, each with the item number it has in plan.md. */
  readonly lines: ReadonlyArray<{
    readonly item: number;
    readonly loop: TestLoop;
    readonly criterion: string | null;
  }>;
}

const finding = (
  severity: LintFinding["severity"],
  phase: string | null,
  message: string,
): LintFinding => ({ severity, check: "tests", phase, message });

/**
 * The `tests` findings of lint's rules on test lines (test-strategy §5.7–§5.12),
 * departures excluded: per phase in plan order, each line's oracle-loop error
 * then its unknown-criterion error, then the phase's silent-oracle error; then
 * the plan-level warnings. A phase with nothing to state gets no finding.
 */
export function testLineFindings(input: {
  readonly phases: readonly TestLineCheckPhase[];
  readonly criteria: CriteriaInput;
}): readonly LintFinding[] {
  const { phases, criteria } = input;
  const known = criteria.kind === "criteria" ? new Set(criteria.ids) : null;
  const findings: LintFinding[] = [];
  for (const phase of phases) {
    for (const line of phase.lines) {
      if (line.loop === "oracle" && phase.oracle === null) {
        findings.push(
          finding(
            "error",
            phase.id,
            `test line ${line.item} is in the oracle loop, but ${phase.id} is not an oracle phase`,
          ),
        );
      }
      if (criteria.kind === "criteria" && line.criterion !== null && !known!.has(line.criterion)) {
        findings.push(
          finding(
            "error",
            phase.id,
            unknownCriterionMessage(line.item, line.criterion, criteria.slug),
          ),
        );
      }
    }
    if (phase.oracle !== null && !phase.lines.some((l) => l.loop === "oracle")) {
      findings.push(
        finding(
          "error",
          phase.id,
          `${phase.id} is an oracle phase, but none of its test lines is in the oracle loop`,
        ),
      );
    }
  }
  if (criteria.kind === "no-criterion-ids") {
    findings.push(finding("warning", null, criteria.message));
  } else if (criteria.kind === "criteria") {
    const { uncovered } = criterionCoverage(
      phases.map((p) => ({ id: p.id, lines: p.lines })),
      criteria.ids,
    );
    for (const id of uncovered) {
      findings.push(finding("warning", null, uncoveredCriterionMessage(id, criteria.slug)));
    }
  }
  return findings;
}
