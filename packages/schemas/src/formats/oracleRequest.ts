// The oracle request phax writes on the oracles provider's stdin, once per
// oracle step. Born with `$schema`: no pre-schema shape, and a document
// without `$schema` is unreadable. It refuses a key it does not name. The
// current shape, named by `CURRENT_SHAPES`, is phax's own file schema and
// decoder.
import {
  OracleRequestFileSchema,
  decodeOracleRequestFile,
  type OracleRequest,
  type OracleRequestFile,
} from "../../../../src/schemas/oracleRequest.js";
import { CURRENT_SHAPES } from "../generated/index.js";
import type { ParsedShape } from "../parsed.js";
import { defineFormat, type CurrentShapeName } from "../shapes.js";

export type OracleRequestShapes = {
  [K in CurrentShapeName<"oracle-request">]: OracleRequestFile;
};

/** The id of every oracle request shape the package reads. */
export type OracleRequestShape = keyof OracleRequestShapes;

export const oracleRequestFormat = defineFormat<OracleRequestShapes>({
  id: "oracle-request",
  label: "oracle request",
  preSchema: null,
  releases: [],
  current: {
    name: CURRENT_SHAPES["oracle-request"],
    shape: { schema: OracleRequestFileSchema, decode: decodeOracleRequestFile },
  },
});

/** Reads an attempt's `checks-attempt-NN.oracle-request.json`. Never throws. */
export const parseOracleRequest: (input: unknown) => ParsedShape<OracleRequestShapes> =
  oracleRequestFormat.parse;

/** The latest oracle request: phax's in-memory value, with no `$schema`. */
export type LatestOracleRequest = OracleRequest;

/** Upgrades a parsed oracle request in memory: drops `$schema`, keeps every other fact. */
export function toLatestOracleRequest(value: OracleRequestFile): LatestOracleRequest {
  const { $schema: _schema, ...recorded } = value;
  return recorded as LatestOracleRequest;
}
