// The three documents of a brief: the request phax writes on a brief
// provider's stdin, the answer the provider prints, and the record of one
// brief call. Each current shape, named by `CURRENT_SHAPES` (`next` until a
// release renames it), is phax's own file schema and decoder. The package
// declares none of its own.
import {
  BriefAnswerFileSchema,
  BriefRecordFileSchema,
  BriefRequestFileSchema,
  decodeBriefAnswerFile,
  decodeBriefRecordFile,
  decodeBriefRequestFile,
  type BriefAnswer,
  type BriefAnswerFile,
  type BriefRecord,
  type BriefRecordFile,
  type BriefRequest,
  type BriefRequestFile,
} from "../../../../src/schemas/brief.js";
import { CURRENT_SHAPES } from "../generated/index.js";
import type { ParsedShape } from "../parsed.js";
import { defineFormat, type CurrentShapeName } from "../shapes.js";

// All three are born with `$schema`: no pre-schema shape, and a document
// without `$schema` is unreadable. A request and a record refuse unknown keys;
// an answer ignores them. Each latest value is phax's in-memory value, with no
// top-level `$schema`.

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

// ── brief answer

export type BriefAnswerShapes = {
  [K in CurrentShapeName<"brief-answer">]: BriefAnswerFile;
};

/** The id of every brief answer shape the package reads. */
export type BriefAnswerShape = keyof BriefAnswerShapes;

export const briefAnswerFormat = defineFormat<BriefAnswerShapes>({
  id: "brief-answer",
  label: "brief answer",
  preSchema: null,
  releases: [],
  current: {
    name: CURRENT_SHAPES["brief-answer"],
    shape: { schema: BriefAnswerFileSchema, decode: decodeBriefAnswerFile },
  },
});

/**
 * Reads a brief answer: what a brief provider prints on stdout, or the
 * `outcome.answer` of an answered brief record. Never throws.
 */
export const parseBriefAnswer: (input: unknown) => ParsedShape<BriefAnswerShapes> =
  briefAnswerFormat.parse;

/** The latest brief answer: phax's in-memory value, with no `$schema`. */
export type LatestBriefAnswer = BriefAnswer;

/** Upgrades a parsed brief answer in memory: drops `$schema`, keeps every other fact. */
export function toLatestBriefAnswer(value: BriefAnswerFile): LatestBriefAnswer {
  const { $schema: _schema, ...recorded } = value;
  return recorded;
}

// ── brief record

export type BriefRecordShapes = {
  [K in CurrentShapeName<"brief-record">]: BriefRecordFile;
};

/** The id of every brief record shape the package reads. */
export type BriefRecordShape = keyof BriefRecordShapes;

export const briefRecordFormat = defineFormat<BriefRecordShapes>({
  id: "brief-record",
  label: "brief record",
  preSchema: null,
  releases: [],
  current: {
    name: CURRENT_SHAPES["brief-record"],
    shape: { schema: BriefRecordFileSchema, decode: decodeBriefRecordFile },
  },
});

/**
 * Reads a phase record's `brief-NN.json`. Never throws. Its `outcome.answer`
 * is kept as printed: read it with `parseBriefAnswer`.
 */
export const parseBriefRecord: (input: unknown) => ParsedShape<BriefRecordShapes> =
  briefRecordFormat.parse;

/** The latest brief record: phax's in-memory value, with no top-level `$schema`. */
export type LatestBriefRecord = BriefRecord;

/**
 * Upgrades a parsed brief record in memory: drops its own `$schema`, keeps
 * every other fact. Its request and answer stay as recorded.
 */
export function toLatestBriefRecord(value: BriefRecordFile): LatestBriefRecord {
  const { $schema: _schema, ...recorded } = value;
  return recorded;
}
