// A phase record's timeline files: its gate attribution, its file
// reconciliation, and each fix-loop attempt's gate diagnostics and gate
// pending documents. Each pre-schema and released shape that is no longer
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
  GateDiagnosticsFileSchema,
  decodeGateDiagnosticsFile,
  type GateDiagnosticsDocument,
  type GateDiagnosticsFile,
} from "../../../../src/schemas/gateDiagnostics.js";
import {
  GatePendingFileSchema,
  decodeGatePendingFile,
  type GatePendingDocument,
  type GatePendingFile,
} from "../../../../src/schemas/gatePending.js";
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
  GateDiagnosticsPreSchemaSchema,
  decodeGateDiagnosticsPreSchema,
  type GateDiagnosticsPreSchema,
} from "../../../../src/schemas/history/gate-diagnostics/pre-schema.js";
import {
  GateDiagnosticsV0_17_0Schema,
  decodeGateDiagnosticsV0_17_0,
  type GateDiagnosticsV0_17_0,
} from "../../../../src/schemas/history/gate-diagnostics/0.17.0.js";
import {
  GatePendingPreSchemaSchema,
  decodeGatePendingPreSchema,
  type GatePendingPreSchema,
} from "../../../../src/schemas/history/gate-pending/pre-schema.js";
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

// ── gate diagnostics

export type GateDiagnosticsShapes = {
  "pre-schema": GateDiagnosticsPreSchema;
  "0.17.0": GateDiagnosticsV0_17_0;
} & {
  [K in CurrentShapeName<"gate-diagnostics">]: GateDiagnosticsFile;
};

/** The id of every gate diagnostics shape the package reads. */
export type GateDiagnosticsShape = keyof GateDiagnosticsShapes;

export const gateDiagnosticsFormat = defineFormat<GateDiagnosticsShapes>({
  id: "gate-diagnostics",
  label: "gate diagnostics document",
  preSchema: { schema: GateDiagnosticsPreSchemaSchema, decode: decodeGateDiagnosticsPreSchema },
  releases: [
    ["0.17.0", { schema: GateDiagnosticsV0_17_0Schema, decode: decodeGateDiagnosticsV0_17_0 }],
  ],
  current: {
    name: CURRENT_SHAPES["gate-diagnostics"],
    shape: { schema: GateDiagnosticsFileSchema, decode: decodeGateDiagnosticsFile },
  },
});

/** Reads an attempt's `checks-attempt-NN.diagnostics.json`. Never throws. */
export const parseGateDiagnostics: (input: unknown) => ParsedShape<GateDiagnosticsShapes> =
  gateDiagnosticsFormat.parse;

/** The latest gate diagnostics document: phax's in-memory value, with no `$schema`. */
export type LatestGateDiagnostics = GateDiagnosticsDocument;

/**
 * Upgrades a parsed gate diagnostics document in memory: drops `$schema`,
 * keeps every other fact. An older finding's fields all fit the latest type;
 * its recorded keys are kept as read.
 */
export function toLatestGateDiagnostics(
  value: GateDiagnosticsPreSchema | GateDiagnosticsV0_17_0 | GateDiagnosticsFile,
): LatestGateDiagnostics {
  if ("$schema" in value) {
    const { $schema: _schema, ...recorded } = value;
    return recorded;
  }
  return value;
}

// ── gate pending

export type GatePendingShapes = { "pre-schema": GatePendingPreSchema } & {
  [K in CurrentShapeName<"gate-pending">]: GatePendingFile;
};

/** The id of every gate pending shape the package reads. */
export type GatePendingShape = keyof GatePendingShapes;

export const gatePendingFormat = defineFormat<GatePendingShapes>({
  id: "gate-pending",
  label: "gate pending document",
  preSchema: { schema: GatePendingPreSchemaSchema, decode: decodeGatePendingPreSchema },
  releases: [],
  current: {
    name: CURRENT_SHAPES["gate-pending"],
    shape: { schema: GatePendingFileSchema, decode: decodeGatePendingFile },
  },
});

/** Reads an attempt's `checks-attempt-NN.pending.json`. Never throws. */
export const parseGatePending: (input: unknown) => ParsedShape<GatePendingShapes> =
  gatePendingFormat.parse;

/** The latest gate pending document: phax's in-memory value, with no `$schema`. */
export type LatestGatePending = GatePendingDocument;

/** Upgrades a parsed gate pending document in memory: drops `$schema`, keeps every other fact. */
export function toLatestGatePending(
  value: GatePendingPreSchema | GatePendingFile,
): LatestGatePending {
  if ("$schema" in value) {
    const { $schema: _schema, ...recorded } = value;
    return recorded;
  }
  return value;
}
