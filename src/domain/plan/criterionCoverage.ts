import type { TestLoop } from "../../schemas/testLine.js";

/** The phases' kept test lines, as far as criterion coverage reads them. */
export interface CoveragePhase {
  readonly id: string;
  readonly lines: ReadonlyArray<{
    /** The line's number in its plan.md section, never its index among kept lines. */
    readonly item: number;
    readonly loop: TestLoop;
    readonly criterion: string | null;
  }>;
}

interface CriterionNaming {
  readonly phase: string;
  readonly loop: TestLoop;
}

export interface CriterionCoverage {
  /** Each criterion id in spec order, with every line naming it, in plan and line order. */
  readonly covered: ReadonlyArray<{
    readonly id: string;
    readonly namedBy: readonly CriterionNaming[];
  }>;
  /** The ids no line names, in spec order. */
  readonly uncovered: readonly string[];
  /** Every line naming an id the spec lacks, in plan and line order. */
  readonly unknown: ReadonlyArray<{
    readonly phase: string;
    readonly line: number;
    readonly id: string;
  }>;
}

export function criterionCoverage(
  phases: readonly CoveragePhase[],
  ids: readonly string[],
): CriterionCoverage {
  const known = new Set(ids);
  const naming = new Map<string, CriterionNaming[]>(ids.map((id) => [id, []]));
  const unknown: Array<{ phase: string; line: number; id: string }> = [];
  for (const phase of phases) {
    for (const line of phase.lines) {
      if (line.criterion === null) continue;
      if (known.has(line.criterion)) {
        naming.get(line.criterion)!.push({ phase: phase.id, loop: line.loop });
      } else {
        unknown.push({ phase: phase.id, line: line.item, id: line.criterion });
      }
    }
  }
  const covered = ids.map((id) => ({ id, namedBy: naming.get(id)! }));
  return {
    covered,
    uncovered: covered.filter((c) => c.namedBy.length === 0).map((c) => c.id),
    unknown,
  };
}

/**
 * Why a source spec's criterion ids are not known. `not-a-spec-path`: the
 * declared path is not a spec path inside the repository, so nothing is read.
 */
export type NoCriterionIdsReason = "not-a-spec-path" | "no-sidecar" | "not-found" | "unreadable";

/** A spec's acceptance criteria as its JSON sidecar declares them, or why they are not known. */
export type SpecCriteria =
  | {
      readonly kind: "criteria";
      /** The spec path that was read, repo-relative. */
      readonly spec: string;
      readonly slug: string;
      /** In spec order. */
      readonly criteria: ReadonlyArray<{ readonly id: string; readonly name: string }>;
    }
  | {
      readonly kind: "no-criterion-ids";
      readonly spec: string;
      readonly reason: NoCriterionIdsReason;
      readonly message: string;
    };

export function notASpecPathMessage(spec: string): string {
  return `source spec ${spec} is not a spec path under docs/specs/: no criterion id is checked`;
}

export function noSidecarMessage(spec: string): string {
  return `source spec ${spec} has no JSON sidecar: no criterion id is checked`;
}

export function specNotFoundMessage(spec: string): string {
  return `source spec ${spec} is not found, here or under docs/specs/archive/: no criterion id is checked`;
}

export function sidecarUnreadableMessage(sidecar: string, reason: string): string {
  return `source spec sidecar ${sidecar} cannot be read (${reason}): no criterion id is checked`;
}

export function frontmatterUndecodableMessage(problem: string): string {
  return `the plan's frontmatter does not decode (${problem}): no source spec is read, no criterion id is checked`;
}

export function uncoveredCriterionMessage(id: string, slug: string): string {
  return `criterion "${id}" of ${slug} is named by no test line`;
}

export function unknownCriterionMessage(line: number, id: string, slug: string): string {
  return `test line ${line} names criterion "${id}", which ${slug} does not have`;
}
