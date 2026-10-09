// Two of the documents of a brief: the request phax writes on a brief
// provider's stdin, and the record of one brief call. The brief report the
// provider prints is in briefReport.ts. A brief informs and never blocks;
// decoding the report by its own `$schema` is the only check phax makes on it.
import { Schema } from "effect";
import { gateRequestFields } from "./gateRequest.js";
import { schemaUrlField } from "./schemaUrl.js";

// ── brief request

const BriefPathsSchema = Schema.NonEmptyArray(Schema.NonEmptyString);

const phaseFiles = Schema.NullOr(BriefPathsSchema).annotations({
  description:
    "Null for the phase's brief: the phase's planned files. Otherwise working-tree-root-relative paths, deduplicated, in the order given, never checked for existence.",
});

const outsideFiles = BriefPathsSchema.annotations({
  description:
    "Working-tree-root-relative paths, deduplicated, in the order given, never checked for existence.",
});

/**
 * A brief request inside a phase: `$schema`, the phase facts of the phase's
 * gate request, then `files`.
 */
export const PhaseBriefRequestFileSchema = Schema.Struct({
  $schema: schemaUrlField("brief-request"),
  ...gateRequestFields,
  files: phaseFiles,
});

/** A brief request outside a phase: `$schema` and `files` only. */
export const OutsideBriefRequestFileSchema = Schema.Struct({
  $schema: schemaUrlField("brief-request"),
  files: outsideFiles,
});

/**
 * A `brief-request` document: what phax writes on a brief provider's stdin,
 * saves as a phase worktree's `.phax-context/brief-request.json`, and keeps
 * as `request` in a brief record. Exactly the keys of one variant; any other
 * key is refused.
 */
export const BriefRequestFileSchema = Schema.Union(
  PhaseBriefRequestFileSchema,
  OutsideBriefRequestFileSchema,
);

export type PhaseBriefRequestFile = Schema.Schema.Type<typeof PhaseBriefRequestFileSchema>;
export type OutsideBriefRequestFile = Schema.Schema.Type<typeof OutsideBriefRequestFileSchema>;
export type BriefRequestFile = Schema.Schema.Type<typeof BriefRequestFileSchema>;

/** A brief request inside a phase, without `$schema`. */
export type PhaseBriefRequest = Omit<PhaseBriefRequestFile, "$schema">;
/** A brief request outside a phase, without `$schema`. */
export type OutsideBriefRequest = Omit<OutsideBriefRequestFile, "$schema">;
/** A brief request, without `$schema`. */
export type BriefRequest = PhaseBriefRequest | OutsideBriefRequest;

export const decodeBriefRequestFile = Schema.decodeUnknownEither(BriefRequestFileSchema, {
  onExcessProperty: "error",
});

export const encodeBriefRequestFile = Schema.encodeSync(BriefRequestFileSchema);

// ── brief record

const AnsweredOutcomeSchema = Schema.Struct({
  kind: Schema.Literal("answered"),
  answer: Schema.Record({ key: Schema.String, value: Schema.Unknown }).annotations({
    description:
      "The brief report as the provider printed it, its own $schema included and every key in its printed order, never re-stamped or re-shaped. It decodes by its own $schema, with parseBriefReport.",
  }),
});

const FailedOutcomeSchema = Schema.Struct({
  kind: Schema.Literal("failed"),
  reason: Schema.NonEmptyString.annotations({
    description: "Why the brief call gave no answer, in one line.",
  }),
});

/**
 * A `brief-record` document: one brief call, saved as `brief-NN.json` in the
 * phase folder. `brief-00.json` is the pushed brief; pulled briefs are
 * numbered from 01 in call order. Any key beyond these is refused, except
 * inside the answer, the brief report kept as printed.
 */
export const BriefRecordFileSchema = Schema.Struct({
  $schema: schemaUrlField("brief-record"),
  moment: Schema.Literal("pushed", "pulled").annotations({
    description: "pushed for the phase's brief at phase start (brief-00 only), pulled otherwise.",
  }),
  request: BriefRequestFileSchema.annotations({
    description: "The brief request as phax sent it on the provider's stdin.",
  }),
  outcome: Schema.Union(AnsweredOutcomeSchema, FailedOutcomeSchema),
});

export type BriefRecordFile = Schema.Schema.Type<typeof BriefRecordFileSchema>;

/** A brief record, without its own top-level `$schema`. */
export type BriefRecord = Omit<BriefRecordFile, "$schema">;

export const decodeBriefRecordFile = Schema.decodeUnknownEither(BriefRecordFileSchema, {
  onExcessProperty: "error",
});

export const encodeBriefRecordFile = Schema.encodeSync(BriefRecordFileSchema);
