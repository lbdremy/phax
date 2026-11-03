// The answers of the commands behind the Claude Code mod, born at 0.34.0 with
// `$schema`: the artifact status `phax artifact status --json` prints, the plan
// overview `phax plans overview --json` prints and the plan lint
// `phax plans lint --json` prints. phax never saves one. Each has no
// pre-schema shape and no frozen release, and a document without `$schema` is
// unreadable. Each refuses a key it does not name. Its current shape, named by
// `CURRENT_SHAPES`, is phax's own file schema and decoder, and its
// `toLatest` drops `$schema`.
import {
  ArtifactStatusFileSchema,
  decodeArtifactStatusFile,
  type ArtifactStatusDocument,
  type ArtifactStatusFile,
} from "../../../../src/schemas/artifactStatusDocument.js";
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
import { defineFormat, type CurrentShapeName } from "../shapes.js";

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
  [K in CurrentShapeName<"plan-lint">]: PlanLintFile;
};

/** The id of every plan lint shape the package reads. */
export type PlanLintShape = keyof PlanLintShapes;

export const planLintFormat = defineFormat<PlanLintShapes>({
  id: "plan-lint",
  label: "plan lint",
  preSchema: null,
  releases: [],
  current: {
    name: CURRENT_SHAPES["plan-lint"],
    shape: { schema: PlanLintFileSchema, decode: decodePlanLintFile },
  },
});

/** Reads what `phax plans lint --json` printed. Never throws. */
export const parsePlanLint: (input: unknown) => ParsedShape<PlanLintShapes> = planLintFormat.parse;

/** The latest plan lint: phax's in-memory value, with no `$schema`. */
export type LatestPlanLint = PlanLintDocument;

/** Drops `$schema` from a parsed plan lint and keeps every other fact. */
export function toLatestPlanLint(value: PlanLintFile): LatestPlanLint {
  const { $schema: _schema, ...recorded } = value;
  return recorded;
}
