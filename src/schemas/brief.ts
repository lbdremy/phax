// The three documents a brief provider exchanges with phax: the request on
// its stdin, the answer it prints, and the record of one brief call. A brief
// informs and never blocks; decoding the answer by its own `$schema` is the
// only check phax makes on it.
import { Schema } from "effect";
import { gateRequestFields } from "./gateRequest.js";
import { schemaUrlField } from "./schemaUrl.js";

// ── brief answer

// The same shape as a diagnostics finding's location.
const BriefLocationSchema = Schema.Struct({
  file: Schema.NonEmptyString,
  line: Schema.optionalWith(Schema.Int.pipe(Schema.positive()), { exact: true }),
});

const BriefDueSchema = Schema.NullOr(Schema.Literal("this-phase", "later")).annotations({
  description:
    "The provider's word on when the place must be resolved: this-phase, later, or null when the request carried no phase facts. phax never computes or checks it.",
});

const what = Schema.NonEmptyString.annotations({
  description: "What stands at the place, in the provider's words.",
});

const repair = Schema.NonEmptyString.annotations({
  description: "How to bring the place in line with the guarantee.",
});

const MetPlaceSchema = Schema.Struct({
  location: BriefLocationSchema,
  state: Schema.Literal("met"),
}).annotations({ description: "The guarantee holds at the place." });

const MissingPlaceSchema = Schema.Struct({
  location: BriefLocationSchema,
  state: Schema.Literal("missing"),
  due: BriefDueSchema,
  what,
  repair,
}).annotations({ description: "Something the guarantee requires is absent at the place." });

const ForbiddenPlaceSchema = Schema.Struct({
  location: BriefLocationSchema,
  state: Schema.Literal("forbidden"),
  due: BriefDueSchema,
  what,
  repair,
}).annotations({ description: "Something the guarantee forbids is present at the place." });

const AcceptedPlaceSchema = Schema.Struct({
  location: BriefLocationSchema,
  state: Schema.Literal("accepted"),
  what,
}).annotations({ description: "A known violation recorded as accepted debt, to leave alone." });

const BriefPlaceSchema = Schema.Union(
  MetPlaceSchema,
  MissingPlaceSchema,
  ForbiddenPlaceSchema,
  AcceptedPlaceSchema,
);

/** One place a guarantee ranges over, with the guarantee's state there. */
export type BriefPlace = Schema.Schema.Type<typeof BriefPlaceSchema>;

const BriefGuaranteeSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  statement: Schema.NonEmptyString,
  places: Schema.NonEmptyArray(BriefPlaceSchema),
});

/** One expectation of the project's standard, with the places it ranges over. */
export type BriefGuarantee = Schema.Schema.Type<typeof BriefGuaranteeSchema>;

const BriefAnswerSchema = Schema.Struct({
  guarantees: Schema.Array(BriefGuaranteeSchema).annotations({
    description:
      "The guarantees that range over the requested paths, in the provider's order, which is its rank. An empty array means nothing to report.",
  }),
});

/** A brief answer, without `$schema`: what phax reads from it. */
export type BriefAnswer = Schema.Schema.Type<typeof BriefAnswerSchema>;

/**
 * A `brief-answer` document: what a brief provider prints on stdout, read
 * through the bridge's `readBriefAnswer`. phax never writes one as a file; a
 * brief record holds it as printed. Unknown keys are ignored at every level.
 */
export const BriefAnswerFileSchema = Schema.Struct({
  $schema: schemaUrlField("brief-answer"),
  ...BriefAnswerSchema.fields,
});

export type BriefAnswerFile = Schema.Schema.Type<typeof BriefAnswerFileSchema>;

export const decodeBriefAnswerFile = Schema.decodeUnknownEither(BriefAnswerFileSchema);

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
      "The brief answer as the provider printed it, its own $schema and any extra key included, never re-stamped or re-shaped. It decodes by its own $schema, with parseBriefAnswer.",
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
 * inside the answer, which is kept as printed.
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
