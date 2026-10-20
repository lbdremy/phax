// The two documents of an architecture call: the request phax writes on an
// architecture provider's stdin and the report the provider prints. Both are
// born with `$schema`: no pre-schema shape, and a document without `$schema`
// is unreadable. Both refuse a key they do not name. Each current shape,
// named by `CURRENT_SHAPES`, is phax's own file schema and decoder.
import {
  ArchitectureReportFileSchema,
  ArchitectureRequestFileSchema,
  decodeArchitectureReportFile,
  decodeArchitectureRequestFile,
  type ArchitectureReportFile,
  type ArchitectureRequestFile,
} from "../../../../src/schemas/architecture.js";
import { CURRENT_SHAPES } from "../generated/index.js";
import type { ParsedShape } from "../parsed.js";
import { defineFormat, type CurrentShapeName } from "../shapes.js";

// ── architecture request

export type ArchitectureRequestShapes = {
  [K in CurrentShapeName<"architecture-request">]: ArchitectureRequestFile;
};

/** The id of every architecture request shape the package reads. */
export type ArchitectureRequestShape = keyof ArchitectureRequestShapes;

export const architectureRequestFormat = defineFormat<ArchitectureRequestShapes>({
  id: "architecture-request",
  label: "architecture request",
  preSchema: null,
  releases: [],
  current: {
    name: CURRENT_SHAPES["architecture-request"],
    shape: { schema: ArchitectureRequestFileSchema, decode: decodeArchitectureRequestFile },
  },
});

/** Reads an architecture request: what phax writes on a provider's stdin. Never throws. */
export const parseArchitectureRequest: (input: unknown) => ParsedShape<ArchitectureRequestShapes> =
  architectureRequestFormat.parse;

/** The latest architecture request: phax's in-memory value, with no `$schema`. */
export type LatestArchitectureRequest = Omit<ArchitectureRequestFile, "$schema">;

/** Upgrades a parsed architecture request in memory: drops `$schema`. */
export function toLatestArchitectureRequest(
  value: ArchitectureRequestFile,
): LatestArchitectureRequest {
  const { $schema: _schema, ...requested } = value;
  return requested;
}

// ── architecture report

export type ArchitectureReportShapes = {
  [K in CurrentShapeName<"architecture-report">]: ArchitectureReportFile;
};

/** The id of every architecture report shape the package reads. */
export type ArchitectureReportShape = keyof ArchitectureReportShapes;

export const architectureReportFormat = defineFormat<ArchitectureReportShapes>({
  id: "architecture-report",
  label: "architecture report",
  preSchema: null,
  releases: [],
  current: {
    name: CURRENT_SHAPES["architecture-report"],
    shape: { schema: ArchitectureReportFileSchema, decode: decodeArchitectureReportFile },
  },
});

/** Reads an architecture report: what a provider prints on stdout. Never throws. */
export const parseArchitectureReport: (input: unknown) => ParsedShape<ArchitectureReportShapes> =
  architectureReportFormat.parse;

/** The latest architecture report: phax's in-memory value, with no `$schema`. */
export type LatestArchitectureReport = Omit<ArchitectureReportFile, "$schema">;

/** Upgrades a parsed architecture report in memory: drops `$schema`. */
export function toLatestArchitectureReport(
  value: ArchitectureReportFile,
): LatestArchitectureReport {
  const { $schema: _schema, ...reported } = value;
  return reported;
}
