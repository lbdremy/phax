import { matchesAnyGlob } from "../architecture/glob.js";
import type { PhaxPlanPhase } from "../../schemas/phaxPlan.js";
import type { TestLine, TestLoop } from "../../schemas/testLine.js";
import { criterionCoverage, type NoCriterionIdsReason } from "./criterionCoverage.js";
import { oracleRoleOf } from "./oraclePairs.js";

// The plan overview (test-strategy §5.13–§5.20): a plan laid out phase by
// phase before it runs. Pure: the use case reads the plan, the source spec and
// the architecture provider, and passes what it found here.

/** What the architecture provider came to, as placement reads it. */
export type ArchitectureOutcome =
  | {
      readonly kind: "parts";
      readonly parts: ReadonlyArray<{ readonly id: string; readonly globs: readonly string[] }>;
    }
  | { readonly kind: "none" }
  | { readonly kind: "failed"; readonly message: string };

/** What the source spec reader found, as the coverage block reads it. */
export type OverviewCriteriaInput =
  | { readonly kind: "no-source-spec" }
  | {
      readonly kind: "frontmatter-undecodable";
      readonly problem: string;
      readonly message: string;
    }
  | {
      readonly kind: "criteria";
      /** The spec path that was read, repo-relative. */
      readonly spec: string;
      readonly slug: string;
      readonly ids: readonly string[];
    }
  | {
      readonly kind: "no-criterion-ids";
      readonly spec: string;
      readonly reason: NoCriterionIdsReason;
      readonly message: string;
    };

/** The architecture line of the overview: the parts themselves live in each placement. */
type OverviewArchitecture =
  | { readonly kind: "parts" }
  | { readonly kind: "none" }
  | { readonly kind: "failed"; readonly message: string };

type OverviewOracleRole =
  | { readonly kind: "oracle"; readonly dischargedBy: string }
  | { readonly kind: "discharging"; readonly oraclePhase: string }
  | { readonly kind: "none" };

/** The planned files held by one part; `part: null` holds those no part holds. */
interface OverviewPlacement {
  readonly part: string | null;
  readonly files: readonly string[];
}

export interface OverviewPhase {
  readonly id: string;
  readonly title: string;
  readonly model: string;
  readonly effort: string;
  readonly mode: "headless" | "interactive";
  readonly oracleRole: OverviewOracleRole;
  readonly placement: readonly OverviewPlacement[];
  readonly testLines: readonly TestLine[];
}

export type OverviewCoverage =
  | {
      readonly kind: "criteria";
      readonly spec: string;
      readonly slug: string;
      readonly criteria: ReadonlyArray<{
        readonly id: string;
        readonly lines: ReadonlyArray<{ readonly phase: string; readonly loop: TestLoop }>;
      }>;
      readonly uncovered: readonly string[];
    }
  | { readonly kind: "no-source-spec" }
  /** The plan's frontmatter does not decode, so no source spec is read. */
  | { readonly kind: "frontmatter-undecodable"; readonly message: string }
  | {
      readonly kind: "no-criterion-ids";
      readonly spec: string;
      readonly reason: NoCriterionIdsReason;
      readonly message: string;
    };

/**
 * The plan's frontmatter: decoded with its status, absent, or a block that does
 * not decode, with its problem in brief. Only a loose plan.md can be the last
 * two: a plan under `docs/plans/` passes artifact validation first.
 */
export type OverviewFrontmatter =
  | { readonly kind: "decoded"; readonly status: string }
  | { readonly kind: "none" }
  | { readonly kind: "undecodable"; readonly problem: string };

export interface PlanOverview {
  /** The plan path as the caller wants it reported. */
  readonly plan: string;
  readonly name: string;
  readonly title: string;
  readonly frontmatter: OverviewFrontmatter;
  readonly sourceSpec: { readonly path: string; readonly slug: string } | null;
  readonly architecture: OverviewArchitecture;
  readonly phases: readonly OverviewPhase[];
  readonly coverage: OverviewCoverage;
}

type OverviewPlanPhase = Pick<
  PhaxPlanPhase,
  | "id"
  | "title"
  | "model"
  | "effort"
  | "mode"
  | "oracle"
  | "plannedFilesToCreate"
  | "plannedFilesToEdit"
  | "testLines"
>;

/** A phase's planned files to create and edit, deduplicated, in plan order. */
function plannedFilesOf(
  phase: Pick<PhaxPlanPhase, "plannedFilesToCreate" | "plannedFilesToEdit">,
): readonly string[] {
  return [...new Set([...phase.plannedFilesToCreate, ...phase.plannedFilesToEdit])];
}

/** The files of every phase, deduplicated, in plan order. */
export function planFilesOf(phases: readonly OverviewPlanPhase[]): readonly string[] {
  return [...new Set(phases.flatMap(plannedFilesOf))];
}

/**
 * Each file under every part whose globs match it, in report order, only the
 * parts that hold a file, then the `{ part: null }` entry of the files no part
 * holds. Without parts, one `{ part: null }` entry holds them all.
 */
function placementOf(files: readonly string[], architecture: ArchitectureOutcome) {
  const parts = architecture.kind === "parts" ? architecture.parts : [];
  const placed = new Set<string>();
  const entries: OverviewPlacement[] = [];
  for (const part of parts) {
    const held = files.filter((file) => matchesAnyGlob(part.globs, [file]));
    if (held.length === 0) continue;
    for (const file of held) placed.add(file);
    entries.push({ part: part.id, files: held });
  }
  entries.push({ part: null, files: files.filter((file) => !placed.has(file)) });
  return entries;
}

function oracleRole(phases: readonly OverviewPlanPhase[], phaseId: string): OverviewOracleRole {
  const role = oracleRoleOf(phases, phaseId);
  if (role === null) return { kind: "none" };
  return role.role === "oracle"
    ? { kind: "oracle", dischargedBy: role.pair.dischargingPhase }
    : { kind: "discharging", oraclePhase: role.pair.oraclePhase };
}

function coverageOf(
  phases: readonly OverviewPlanPhase[],
  criteria: OverviewCriteriaInput,
): OverviewCoverage {
  if (criteria.kind === "frontmatter-undecodable") {
    return { kind: "frontmatter-undecodable", message: criteria.message };
  }
  if (criteria.kind !== "criteria") return criteria;
  const covered = criterionCoverage(
    phases.map((phase) => ({
      id: phase.id,
      // `item` only numbers an unknown id, which the overview leaves to lint.
      lines: phase.testLines.map((line, index) => ({
        item: index + 1,
        loop: line.loop,
        criterion: line.criterion,
      })),
    })),
    criteria.ids,
  );
  return {
    kind: "criteria",
    spec: criteria.spec,
    slug: criteria.slug,
    criteria: covered.covered.map((c) => ({ id: c.id, lines: c.namedBy })),
    uncovered: covered.uncovered,
  };
}

/** The overview of a parsed plan; the plan's test lines are the kept ones. */
export function buildOverview(input: {
  readonly plan: string;
  readonly name: string;
  readonly title: string;
  readonly frontmatter: OverviewFrontmatter;
  readonly sourceSpec: { readonly path: string; readonly slug: string } | null;
  readonly phases: readonly OverviewPlanPhase[];
  readonly architecture: ArchitectureOutcome;
  readonly criteria: OverviewCriteriaInput;
}): PlanOverview {
  const { phases, architecture } = input;
  return {
    plan: input.plan,
    name: input.name,
    title: input.title,
    frontmatter: input.frontmatter,
    sourceSpec: input.sourceSpec,
    architecture:
      architecture.kind === "parts"
        ? { kind: "parts" }
        : architecture.kind === "none"
          ? { kind: "none" }
          : { kind: "failed", message: architecture.message },
    phases: phases.map((phase) => ({
      id: phase.id,
      title: phase.title,
      model: phase.model,
      effort: phase.effort,
      mode: phase.mode,
      oracleRole: oracleRole(phases, phase.id),
      placement: placementOf(plannedFilesOf(phase), architecture),
      testLines: phase.testLines,
    })),
    coverage: coverageOf(phases, input.criteria),
  };
}
