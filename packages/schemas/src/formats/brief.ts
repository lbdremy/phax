// Two documents of a brief: the request phax writes on a brief provider's
// stdin, and the record of one brief call. The brief report the provider
// prints is in reports.ts. Each current shape, named by `CURRENT_SHAPES`
// (`next` until a release renames it), is phax's own file schema and decoder;
// a released shape that is no longer current is phax's frozen module under
// src/schemas/history/. The package declares none of its own.
import {
  BriefRecordFileSchema,
  BriefRequestFileSchema,
  decodeBriefRecordFile,
  decodeBriefRequestFile,
  type BriefRecord,
  type BriefRecordFile,
  type BriefRequest,
  type BriefRequestFile,
} from "../../../../src/schemas/brief.js";
import {
  BriefRecordV0_20_0Schema,
  decodeBriefRecordV0_20_0,
  type BriefRecordV0_20_0,
} from "../../../../src/schemas/history/brief-record/0.20.0.js";
import { CURRENT_SHAPES } from "../generated/index.js";
import type { ParsedShape } from "../parsed.js";
import { defineFormat, type CurrentShapeName } from "../shapes.js";

// Both are born with `$schema`: no pre-schema shape, and a document without
// `$schema` is unreadable. Both refuse unknown keys, except inside a record's
// answer, which is kept as printed. Each latest value is phax's in-memory
// value, with no top-level `$schema`.

// ── brief request

export type BriefRequestShapes = {
  [K in CurrentShapeName<"brief-request">]: BriefRequestFile;
};

/** The id of every brief request shape the package reads. */
export type BriefRequestShape = keyof BriefRequestShapes;

export const briefRequestFormat = defineFormat<BriefRequestShapes>({
  id: "brief-request",
  label: "brief request",
  preSchema: null,
  releases: [],
  current: {
    name: CURRENT_SHAPES["brief-request"],
    shape: { schema: BriefRequestFileSchema, decode: decodeBriefRequestFile },
  },
});

/**
 * Reads a brief request: a phase worktree's
 * `.phax-context/brief-request.json`, or the `request` of a brief record.
 * Never throws.
 */
export const parseBriefRequest: (input: unknown) => ParsedShape<BriefRequestShapes> =
  briefRequestFormat.parse;

/** The latest brief request: phax's in-memory value, with no `$schema`. */
export type LatestBriefRequest = BriefRequest;

/** Upgrades a parsed brief request in memory: drops `$schema`, keeps every other fact. */
export function toLatestBriefRequest(value: BriefRequestFile): LatestBriefRequest {
  const { $schema: _schema, ...recorded } = value;
  return recorded;
}

// ── brief record

export type BriefRecordShapes = { "0.20.0": BriefRecordV0_20_0 } & {
  [K in CurrentShapeName<"brief-record">]: BriefRecordFile;
};

/** The id of every brief record shape the package reads. */
export type BriefRecordShape = keyof BriefRecordShapes;

export const briefRecordFormat = defineFormat<BriefRecordShapes>({
  id: "brief-record",
  label: "brief record",
  preSchema: null,
  releases: [["0.20.0", { schema: BriefRecordV0_20_0Schema, decode: decodeBriefRecordV0_20_0 }]],
  current: {
    name: CURRENT_SHAPES["brief-record"],
    shape: { schema: BriefRecordFileSchema, decode: decodeBriefRecordFile },
  },
});

/**
 * Reads a phase record's `brief-NN.json`. Never throws. Its `outcome.answer`
 * is kept as printed: a current record's answer is a brief report, read with
 * `parseBriefReport`.
 */
export const parseBriefRecord: (input: unknown) => ParsedShape<BriefRecordShapes> =
  briefRecordFormat.parse;

/** The latest brief record: phax's in-memory value, with no top-level `$schema`. */
export type LatestBriefRecord = BriefRecord;

/**
 * Upgrades a parsed brief record in memory: drops its own `$schema`, keeps
 * every other fact. Its request and answer stay as recorded. The current
 * shape becomes the latest value; the 0.20.0 shape keeps its recorded value,
 * under its own type, and is never mapped onto the latest.
 */
export function toLatestBriefRecord(value: BriefRecordFile): LatestBriefRecord;
export function toLatestBriefRecord(value: BriefRecordV0_20_0): Omit<BriefRecordV0_20_0, "$schema">;
export function toLatestBriefRecord(
  value: BriefRecordV0_20_0 | BriefRecordFile,
): LatestBriefRecord | Omit<BriefRecordV0_20_0, "$schema">;
export function toLatestBriefRecord(
  value: BriefRecordV0_20_0 | BriefRecordFile,
): LatestBriefRecord | Omit<BriefRecordV0_20_0, "$schema"> {
  const { $schema: _schema, ...recorded } = value;
  return recorded;
}
