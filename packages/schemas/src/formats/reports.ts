// The two reports a provider prints: the gate report of a report step and the
// brief report of a brief provider. They share one location, guide and
// finding definition (phax's src/schemas/report.ts). Each current shape,
// named by `CURRENT_SHAPES` (`next` until a release renames it), is phax's own
// file schema and decoder. The package declares none of its own.
import {
  BriefReportFileSchema,
  decodeBriefReportFile,
  type BriefReport,
  type BriefReportFile,
} from "../../../../src/schemas/briefReport.js";
import {
  GateReportFileSchema,
  decodeGateReportFile,
  type GateReport,
  type GateReportFile,
} from "../../../../src/schemas/gateReport.js";
import { CURRENT_SHAPES } from "../generated/index.js";
import type { ParsedShape } from "../parsed.js";
import { defineFormat, type CurrentShapeName } from "../shapes.js";

// Both are born with `$schema`: no pre-schema shape, and a document without
// `$schema` is unreadable. Both refuse a key they do not name, at any level.
// Each latest value is phax's in-memory value, with no `$schema`.

// ── gate report

export type GateReportShapes = {
  [K in CurrentShapeName<"gate-report">]: GateReportFile;
};

/** The id of every gate report shape the package reads. */
export type GateReportShape = keyof GateReportShapes;

export const gateReportFormat = defineFormat<GateReportShapes>({
  id: "gate-report",
  label: "gate report",
  preSchema: null,
  releases: [],
  current: {
    name: CURRENT_SHAPES["gate-report"],
    shape: { schema: GateReportFileSchema, decode: decodeGateReportFile },
  },
});

/**
 * Reads a gate report: what a report step prints on stdout, or a phase
 * record's `checks-attempt-NN.report-SS.json`. Never throws.
 */
export const parseGateReport: (input: unknown) => ParsedShape<GateReportShapes> =
  gateReportFormat.parse;

/** The latest gate report: phax's in-memory value, with no `$schema`. */
export type LatestGateReport = GateReport;

/** Upgrades a parsed gate report in memory: drops `$schema`, keeps every other fact. */
export function toLatestGateReport(value: GateReportFile): LatestGateReport {
  const { $schema: _schema, ...reported } = value;
  return reported;
}

// ── brief report

export type BriefReportShapes = {
  [K in CurrentShapeName<"brief-report">]: BriefReportFile;
};

/** The id of every brief report shape the package reads. */
export type BriefReportShape = keyof BriefReportShapes;

export const briefReportFormat = defineFormat<BriefReportShapes>({
  id: "brief-report",
  label: "brief report",
  preSchema: null,
  releases: [],
  current: {
    name: CURRENT_SHAPES["brief-report"],
    shape: { schema: BriefReportFileSchema, decode: decodeBriefReportFile },
  },
});

/**
 * Reads a brief report: what a brief provider prints on stdout, or the
 * `outcome.answer` of an answered brief record. Never throws.
 */
export const parseBriefReport: (input: unknown) => ParsedShape<BriefReportShapes> =
  briefReportFormat.parse;

/** The latest brief report: phax's in-memory value, with no `$schema`. */
export type LatestBriefReport = BriefReport;

/** Upgrades a parsed brief report in memory: drops `$schema`, keeps every other fact. */
export function toLatestBriefReport(value: BriefReportFile): LatestBriefReport {
  const { $schema: _schema, ...reported } = value;
  return reported;
}
