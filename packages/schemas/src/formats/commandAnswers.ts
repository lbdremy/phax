// The answers of the commands behind the Claude Code mod, born at 0.34.0 with
// `$schema`: the artifact status `phax artifact status --json` prints, the plan
// overview `phax plans overview --json` prints and the plan lint
// `phax plans lint --json` prints, and the finding list
// `phax finding list --json` prints. phax never saves one. Each has no
// pre-schema shape, and a document without `$schema` is unreadable. Two have
// a frozen release: the plan lint's 0.34.0, before the `gate-profile` check,
// and the finding list's 0.40.0, before a finding's `landed` and the run's
// `baseBranch`. Each refuses a key it does not name. Its current shape, named
// by `CURRENT_SHAPES`, is phax's own file schema and decoder, and its
// `toLatest` drops `$schema`; a 0.40.0 finding list lifts to a
// `LiftedFindingList` that never invents where a fix landed.
import {
  ArtifactStatusFileSchema,
  decodeArtifactStatusFile,
  type ArtifactStatusDocument,
  type ArtifactStatusFile,
} from "../../../../src/schemas/artifactStatusDocument.js";
import {
  FindingListFileSchema,
  decodeFindingListFile,
  type FindingListDocument,
  type FindingListFile,
} from "../../../../src/schemas/findingList.js";
import {
  FindingListV0_40_0Schema,
  decodeFindingListV0_40_0,
  type FindingListV0_40_0,
} from "../../../../src/schemas/history/finding-list/0.40.0.js";
import {
  PlanLintV0_34_0Schema,
  decodePlanLintV0_34_0,
  type PlanLintV0_34_0,
} from "../../../../src/schemas/history/plan-lint/0.34.0.js";
import {
  PlanLintFileSchema,
  decodePlanLintFile,
  type PlanLintDocument,
  type PlanLintFile,
} from "../../../../src/schemas/planLint.js";
import {
  PlanOverviewFileSchema,
  decodePlanOverviewFile,
  type PlanOverviewDocument,
  type PlanOverviewFile,
} from "../../../../src/schemas/planOverview.js";
import { CURRENT_SHAPES } from "../generated/index.js";
import type { ParsedShape } from "../parsed.js";
import { UNKNOWN, defineFormat, type CurrentShapeName, type Unknown } from "../shapes.js";

// ── artifact status

export type ArtifactStatusShapes = {
  [K in CurrentShapeName<"artifact-status">]: ArtifactStatusFile;
};

/** The id of every artifact status shape the package reads. */
export type ArtifactStatusShape = keyof ArtifactStatusShapes;

export const artifactStatusFormat = defineFormat<ArtifactStatusShapes>({
  id: "artifact-status",
  label: "artifact status",
  preSchema: null,
  releases: [],
  current: {
    name: CURRENT_SHAPES["artifact-status"],
    shape: { schema: ArtifactStatusFileSchema, decode: decodeArtifactStatusFile },
  },
});

/** Reads what `phax artifact status --json` printed. Never throws. */
export const parseArtifactStatus: (input: unknown) => ParsedShape<ArtifactStatusShapes> =
  artifactStatusFormat.parse;

/** The latest artifact status: phax's in-memory value, with no `$schema`. */
export type LatestArtifactStatus = ArtifactStatusDocument;

/** Drops `$schema` from a parsed artifact status and keeps every other fact. */
export function toLatestArtifactStatus(value: ArtifactStatusFile): LatestArtifactStatus {
  const { $schema: _schema, ...recorded } = value;
  return recorded;
}

// ── plan overview

export type PlanOverviewShapes = {
  [K in CurrentShapeName<"plan-overview">]: PlanOverviewFile;
};

/** The id of every plan overview shape the package reads. */
export type PlanOverviewShape = keyof PlanOverviewShapes;

export const planOverviewFormat = defineFormat<PlanOverviewShapes>({
  id: "plan-overview",
  label: "plan overview",
  preSchema: null,
  releases: [],
  current: {
    name: CURRENT_SHAPES["plan-overview"],
    shape: { schema: PlanOverviewFileSchema, decode: decodePlanOverviewFile },
  },
});

/** Reads what `phax plans overview --json` printed. Never throws. */
export const parsePlanOverview: (input: unknown) => ParsedShape<PlanOverviewShapes> =
  planOverviewFormat.parse;

/** The latest plan overview: phax's in-memory value, with no `$schema`. */
export type LatestPlanOverview = PlanOverviewDocument;

/** Drops `$schema` from a parsed plan overview and keeps every other fact. */
export function toLatestPlanOverview(value: PlanOverviewFile): LatestPlanOverview {
  const { $schema: _schema, ...recorded } = value;
  return recorded;
}

// ── plan lint

export type PlanLintShapes = {
  "0.34.0": PlanLintV0_34_0;
} & {
  [K in CurrentShapeName<"plan-lint">]: PlanLintFile;
};

/** The id of every plan lint shape the package reads. */
export type PlanLintShape = keyof PlanLintShapes;

export const planLintFormat = defineFormat<PlanLintShapes>({
  id: "plan-lint",
  label: "plan lint",
  preSchema: null,
  releases: [["0.34.0", { schema: PlanLintV0_34_0Schema, decode: decodePlanLintV0_34_0 }]],
  current: {
    name: CURRENT_SHAPES["plan-lint"],
    shape: { schema: PlanLintFileSchema, decode: decodePlanLintFile },
  },
});

/** Reads what `phax plans lint --json` printed. Never throws. */
export const parsePlanLint: (input: unknown) => ParsedShape<PlanLintShapes> = planLintFormat.parse;

/** The latest plan lint: phax's in-memory value, with no `$schema`. */
export type LatestPlanLint = PlanLintDocument;

/**
 * Drops `$schema` from a parsed plan lint and keeps every other fact. A 0.34.0
 * plan lint is lifted unchanged: its check names are a subset of the current
 * ones (it predates `gate-profile`).
 */
export function toLatestPlanLint(value: PlanLintFile | PlanLintV0_34_0): LatestPlanLint {
  const { $schema: _schema, ...recorded } = value;
  return recorded;
}

// ── finding list

export type FindingListShapes = {
  "0.40.0": FindingListV0_40_0;
} & {
  [K in CurrentShapeName<"finding-list">]: FindingListFile;
};

/** The id of every finding list shape the package reads. */
export type FindingListShape = keyof FindingListShapes;

export const findingListFormat = defineFormat<FindingListShapes>({
  id: "finding-list",
  label: "finding list",
  preSchema: null,
  releases: [["0.40.0", { schema: FindingListV0_40_0Schema, decode: decodeFindingListV0_40_0 }]],
  current: {
    name: CURRENT_SHAPES["finding-list"],
    shape: { schema: FindingListFileSchema, decode: decodeFindingListFile },
  },
});

/** Reads what `phax finding list --json` printed. Never throws. */
export const parseFindingList: (input: unknown) => ParsedShape<FindingListShapes> =
  findingListFormat.parse;

/** The latest finding list: phax's in-memory value, with no `$schema`. */
export type LatestFindingList = FindingListDocument;

type LatestFindingEntry = LatestFindingList["findings"][number];

/** A finding of a lifted list: every recorded fact, and `landed` as the lift reads it. */
type LiftedFindingEntry = LatestFindingEntry extends infer E
  ? E extends LatestFindingEntry
    ? Omit<E, "landed"> & { readonly landed: Unknown | null }
    : never
  : never;

/**
 * A finding list older than the resolution of fixes (0.40.0), upgraded under a
 * type of its own: every recorded fact kept, but a fixed finding's `landed` is
 * `Unknown`, since no older list recorded where a fix landed, and the run's
 * `baseBranch` is `Unknown`, since none named the branch it searched. Every
 * other finding's `landed` is null, as the current shape defines it from its
 * fate. It is never a `LatestFindingList`.
 */
export interface LiftedFindingList {
  readonly run: Omit<LatestFindingList["run"], "baseBranch"> & { readonly baseBranch: Unknown };
  readonly records: LatestFindingList["records"];
  readonly findings: readonly LiftedFindingEntry[];
}

/**
 * Upgrades a parsed finding list in memory and keeps every recorded fact. A
 * current list drops its `$schema` and becomes a `LatestFindingList`. A 0.40.0
 * list becomes a `LiftedFindingList`: a resolution is never invented, so a
 * fixed finding's `landed` and the run's `baseBranch` are `Unknown`, and every
 * other finding's `landed` is null.
 */
export function toLatestFindingList(value: FindingListFile): LatestFindingList;
export function toLatestFindingList(value: FindingListV0_40_0): LiftedFindingList;
export function toLatestFindingList(
  value: FindingListFile | FindingListV0_40_0,
): LatestFindingList | LiftedFindingList;
export function toLatestFindingList(
  value: FindingListFile | FindingListV0_40_0,
): LatestFindingList | LiftedFindingList {
  if (isCurrentFindingList(value)) {
    const { $schema: _schema, ...recorded } = value;
    return recorded;
  }
  const { $schema: _schema, run, records, findings } = value;
  return {
    run: { ...run, baseBranch: UNKNOWN },
    records,
    findings: findings.map((finding) => ({
      ...finding,
      landed: finding.fate === "fixed" ? UNKNOWN : null,
    })),
  };
}

function isCurrentFindingList(
  value: FindingListFile | FindingListV0_40_0,
): value is FindingListFile {
  return "baseBranch" in value.run;
}
