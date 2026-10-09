// A phase record's timeline files: its gate attribution, its file
// reconciliation, and each fix-loop attempt's gate request.
// Each pre-schema and released shape that is no longer
// current is phax's frozen module under src/schemas/history/; each current
// shape, named by `CURRENT_SHAPES` (`next` until a release renames it), is
// phax's own file schema and decoder. The package declares none of its own.
import {
  GateAttributionFileSchema,
  decodeGateAttributionFile,
  type GateAttribution,
  type GateAttributionFile,
} from "../../../../src/schemas/gateAttribution.js";
import {
  GateRequestFileSchema,
  decodeGateRequestFile,
  type GateRequest,
  type GateRequestFile,
} from "../../../../src/schemas/gateRequest.js";
import {
  GateAttributionPreSchemaSchema,
  decodeGateAttributionPreSchema,
  type GateAttributionPreSchema,
} from "../../../../src/schemas/history/gate-attribution/pre-schema.js";
import {
  GateAttributionV0_17_0Schema,
  decodeGateAttributionV0_17_0,
  type GateAttributionV0_17_0,
} from "../../../../src/schemas/history/gate-attribution/0.17.0.js";
import {
  PhaseFileReconciliationPreSchemaSchema,
  decodePhaseFileReconciliationPreSchema,
  type PhaseFileReconciliationPreSchema,
} from "../../../../src/schemas/history/phase-file-reconciliation/pre-schema.js";
import {
  PhaseFileReconciliationFileSchema,
  decodePhaseFileReconciliationFile,
  type PhaseFileReconciliation,
  type PhaseFileReconciliationFile,
} from "../../../../src/schemas/reconciliation.js";
import { CURRENT_SHAPES } from "../generated/index.js";
import type { ParsedShape } from "../parsed.js";
import { defineFormat, type CurrentShapeName } from "../shapes.js";

// None of these files has ever carried a `version`. A file without `$schema`
// is read by its frozen pre-schema module as shape `pre-schema`; a file phax
// writes starts with `$schema` and is read by phax's file decoder as the
// current shape, named by `CURRENT_SHAPES`: `next` until a release renames
// it. Each latest value is phax's in-memory value, with no `$schema`. A
// timeline file is identified by where it lives in the record folder; an
// attempt's order comes from its file name, which the reader supplies.

// ── gate attribution

export type GateAttributionShapes = {
  "pre-schema": GateAttributionPreSchema;
  "0.17.0": GateAttributionV0_17_0;
} & {
  [K in CurrentShapeName<"gate-attribution">]: GateAttributionFile;
};

/** The id of every gate attribution shape the package reads. */
export type GateAttributionShape = keyof GateAttributionShapes;

export const gateAttributionFormat = defineFormat<GateAttributionShapes>({
  id: "gate-attribution",
  label: "gate attribution",
  preSchema: { schema: GateAttributionPreSchemaSchema, decode: decodeGateAttributionPreSchema },
  releases: [
    ["0.17.0", { schema: GateAttributionV0_17_0Schema, decode: decodeGateAttributionV0_17_0 }],
  ],
  current: {
    name: CURRENT_SHAPES["gate-attribution"],
    shape: { schema: GateAttributionFileSchema, decode: decodeGateAttributionFile },
  },
});

/** Reads a phase's `gate-attribution.json`. Never throws. */
export const parseGateAttribution: (input: unknown) => ParsedShape<GateAttributionShapes> =
  gateAttributionFormat.parse;

/** The latest gate attribution: phax's in-memory value, with no `$schema`. */
export type LatestGateAttribution = GateAttribution;

/**
 * Upgrades a parsed gate attribution in memory: drops `$schema`, keeps every
 * other fact. The current shape becomes the latest value; an older shape keeps
 * its recorded value, under its own type, and is never mapped onto the latest.
 */
export function toLatestGateAttribution(value: GateAttributionFile): LatestGateAttribution;
export function toLatestGateAttribution(value: GateAttributionPreSchema): GateAttributionPreSchema;
export function toLatestGateAttribution(
  value: GateAttributionV0_17_0,
): Omit<GateAttributionV0_17_0, "$schema">;
export function toLatestGateAttribution(
  value: GateAttributionPreSchema | GateAttributionV0_17_0 | GateAttributionFile,
): LatestGateAttribution | GateAttributionPreSchema | Omit<GateAttributionV0_17_0, "$schema">;
export function toLatestGateAttribution(
  value: GateAttributionPreSchema | GateAttributionV0_17_0 | GateAttributionFile,
): LatestGateAttribution | GateAttributionPreSchema | Omit<GateAttributionV0_17_0, "$schema"> {
  if ("$schema" in value) {
    const { $schema: _schema, ...recorded } = value;
    return recorded;
  }
  return value;
}

// ── phase file reconciliation

export type PhaseFileReconciliationShapes = { "pre-schema": PhaseFileReconciliationPreSchema } & {
  [K in CurrentShapeName<"phase-file-reconciliation">]: PhaseFileReconciliationFile;
};

/** The id of every phase file reconciliation shape the package reads. */
export type PhaseFileReconciliationShape = keyof PhaseFileReconciliationShapes;

export const phaseFileReconciliationFormat = defineFormat<PhaseFileReconciliationShapes>({
  id: "phase-file-reconciliation",
  label: "phase file reconciliation",
  preSchema: {
    schema: PhaseFileReconciliationPreSchemaSchema,
    decode: decodePhaseFileReconciliationPreSchema,
  },
  releases: [],
  current: {
    name: CURRENT_SHAPES["phase-file-reconciliation"],
    shape: {
      schema: PhaseFileReconciliationFileSchema,
      decode: decodePhaseFileReconciliationFile,
    },
  },
});

/** Reads a phase's `file-reconciliation.json`. Never throws. */
export const parsePhaseFileReconciliation: (
  input: unknown,
) => ParsedShape<PhaseFileReconciliationShapes> = phaseFileReconciliationFormat.parse;

/** The latest phase file reconciliation: phax's in-memory value, with no `$schema`. */
export type LatestPhaseFileReconciliation = PhaseFileReconciliation;

/** Upgrades a parsed file reconciliation in memory: drops `$schema`, keeps every other fact. */
export function toLatestPhaseFileReconciliation(
  value: PhaseFileReconciliationPreSchema | PhaseFileReconciliationFile,
): LatestPhaseFileReconciliation {
  if ("$schema" in value) {
    const { $schema: _schema, ...recorded } = value;
    return recorded;
  }
  return value;
}

// ── gate request

// Born with `$schema`: no pre-schema shape. Unknown keys are refused.
export type GateRequestShapes = {
  [K in CurrentShapeName<"gate-request">]: GateRequestFile;
};

/** The id of every gate request shape the package reads. */
export type GateRequestShape = keyof GateRequestShapes;

export const gateRequestFormat = defineFormat<GateRequestShapes>({
  id: "gate-request",
  label: "gate request",
  preSchema: null,
  releases: [],
  current: {
    name: CURRENT_SHAPES["gate-request"],
    shape: { schema: GateRequestFileSchema, decode: decodeGateRequestFile },
  },
});

/** Reads an attempt's `checks-attempt-NN.request.json`. Never throws. */
export const parseGateRequest: (input: unknown) => ParsedShape<GateRequestShapes> =
  gateRequestFormat.parse;

/** The latest gate request: phax's in-memory value, with no `$schema`. */
export type LatestGateRequest = GateRequest;

/** Upgrades a parsed gate request in memory: drops `$schema`, keeps every other fact. */
export function toLatestGateRequest(value: GateRequestFile): LatestGateRequest {
  const { $schema: _schema, ...recorded } = value;
  return recorded;
}
