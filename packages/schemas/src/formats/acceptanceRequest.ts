// The request phax writes on the acceptance provider's stdin, once per
// acceptance step, and the oracle request it replaced. Two formats, one
// document role:
// - `acceptance-request`, born at 0.33.0 with `$schema`: no pre-schema shape,
//   and a document without `$schema` is unreadable. It refuses a key it does
//   not name. Its current shape, named by `CURRENT_SHAPES`, is phax's own file
//   schema and decoder.
// - `oracle-request`, born at 0.26.0 and frozen there: phax 0.32.0 and below
//   wrote it, and phax writes it nowhere now. Its 0.26.0 module is listed as
//   its release and as its current shape, so `parseDocument` still identifies
//   one.
// `parseAcceptanceRequest` reads either, by the format its `$schema` names, and
// `toLatestAcceptanceRequest` lifts either to the latest acceptance request.
import {
  AcceptanceRequestFileSchema,
  decodeAcceptanceRequestFile,
  type AcceptanceRequest,
  type AcceptanceRequestFile,
} from "../../../../src/schemas/acceptanceRequest.js";
import { liftOracleRequest } from "../../../../src/schemas/acceptanceLift.js";
import {
  OracleRequestV0_26_0Schema,
  decodeOracleRequestV0_26_0,
  type OracleRequestV0_26_0,
} from "../../../../src/schemas/history/oracle-request/0.26.0.js";
import { parseSchemaUrl } from "../../../../src/schemas/schemaUrl.js";
import { CURRENT_SHAPES } from "../generated/index.js";
import type { ParsedShape } from "../parsed.js";
import { defineFormat, isDocumentObject, type CurrentShapeName } from "../shapes.js";

// ── oracle request, retired

export type OracleRequestShapes = {
  "0.26.0": OracleRequestV0_26_0;
} & {
  [K in CurrentShapeName<"oracle-request">]: OracleRequestV0_26_0;
};

const oracleRequestV0_26_0 = {
  schema: OracleRequestV0_26_0Schema,
  decode: decodeOracleRequestV0_26_0,
};

export const oracleRequestFormat = defineFormat<OracleRequestShapes>({
  id: "oracle-request",
  label: "oracle request",
  preSchema: null,
  releases: [["0.26.0", oracleRequestV0_26_0]],
  current: { name: CURRENT_SHAPES["oracle-request"], shape: oracleRequestV0_26_0 },
});

// ── acceptance request

export type AcceptanceRequestShapes = {
  [K in CurrentShapeName<"acceptance-request">]: AcceptanceRequestFile;
};

export const acceptanceRequestFormat = defineFormat<AcceptanceRequestShapes>({
  id: "acceptance-request",
  label: "acceptance request",
  preSchema: null,
  releases: [],
  current: {
    name: CURRENT_SHAPES["acceptance-request"],
    shape: { schema: AcceptanceRequestFileSchema, decode: decodeAcceptanceRequestFile },
  },
});

/**
 * The id of every shape `parseAcceptanceRequest` reads: the acceptance
 * request's current shape and the oracle request's 0.26.0.
 */
export type AcceptanceRequestShape = keyof (AcceptanceRequestShapes & OracleRequestShapes);

/**
 * Reads an attempt's `checks-attempt-NN.acceptance-request.json`, or the
 * `checks-attempt-NN.oracle-request.json` phax 0.32.0 and below saved. The
 * `$schema` names the format: an `oracle-request` is read at its frozen 0.26.0
 * shape, anything else as an `acceptance-request` (which fails a document
 * without `$schema` or with another format's). The shape of a success names the
 * release that last changed it. Never throws.
 */
export function parseAcceptanceRequest(
  input: unknown,
): ParsedShape<AcceptanceRequestShapes & OracleRequestShapes> {
  if (
    isDocumentObject(input) &&
    parseSchemaUrl(input["$schema"])?.formatId === oracleRequestFormat.id
  ) {
    return oracleRequestFormat.parse(input);
  }
  return acceptanceRequestFormat.parse(input);
}

/** The latest acceptance request: phax's in-memory value, with no `$schema`. */
export type LatestAcceptanceRequest = AcceptanceRequest;

/**
 * Upgrades a parsed acceptance request or oracle request in memory: drops
 * `$schema`, and lifts an oracle request's `discharged` to `passed`,
 * `oraclePhase` to `acceptancePhase` and `oracleCommit` to `acceptanceCommit`.
 * Every other fact is kept.
 */
export function toLatestAcceptanceRequest(
  value: AcceptanceRequestFile | OracleRequestV0_26_0,
): LatestAcceptanceRequest {
  const { $schema: _schema, ...recorded } = value;
  if ("oraclePhase" in recorded) return liftOracleRequest(recorded);
  return recorded as LatestAcceptanceRequest;
}
