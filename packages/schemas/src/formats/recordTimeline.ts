// A phase record's timeline files: its gate attribution, its file
// reconciliation, and each fix-loop attempt's gate diagnostics and gate
// pending documents. Each current schema and decoder is phax's own; the
// package declares none of its own.
import {
  GateAttributionSchema,
  decodeGateAttribution,
  type GateAttribution,
} from "../../../../src/schemas/gateAttribution.js";
import {
  GateDiagnosticsDocumentSchema,
  decodeGateDiagnosticsDocument,
  type GateDiagnosticsDocument,
} from "../../../../src/schemas/gateDiagnostics.js";
import {
  GatePendingDocumentSchema,
  decodeGatePendingDocument,
  type GatePendingDocument,
} from "../../../../src/schemas/gatePending.js";
import {
  PhaseFileReconciliationSchema,
  decodePhaseFileReconciliation,
  type PhaseFileReconciliation,
} from "../../../../src/schemas/reconciliation.js";
import {
  GateAttributionV0Schema,
  decodeGateAttributionV0,
  type GateAttributionV0,
} from "../history/gate-attribution/v0.js";
import {
  GateDiagnosticsV0Schema,
  decodeGateDiagnosticsV0,
  type GateDiagnosticsV0,
} from "../history/gate-diagnostics/v0.js";
import {
  GatePendingV0Schema,
  decodeGatePendingV0,
  type GatePendingV0,
} from "../history/gate-pending/v0.js";
import {
  PhaseFileReconciliationV0Schema,
  decodePhaseFileReconciliationV0,
  type PhaseFileReconciliationV0,
} from "../history/phase-file-reconciliation/v0.js";
import type { ParsedShape } from "../parsed.js";
import { UNKNOWN, defineFormat, type Unknown } from "../shapes.js";

export type { GateAttributionV0, GateDiagnosticsV0, GatePendingV0, PhaseFileReconciliationV0 };

// None of these files has ever carried a `$schema` or a `version`: each is
// read as its format's unversioned shape `v0`, by phax's own decoder first
// and then by its frozen v0 module. A timeline file is identified by where it
// lives in the record folder; an attempt's order comes from its file name,
// which the reader supplies.

// ── gate attribution

export type GateAttributionShapes = { v0: GateAttributionV0 };

/** The id of every gate attribution shape the package reads. */
export type GateAttributionShape = keyof GateAttributionShapes;

export const gateAttributionFormat = defineFormat<GateAttributionShapes>({
  id: "gate-attribution",
  label: "gate attribution",
  legacy: { 0: { schema: GateAttributionV0Schema, decode: decodeGateAttributionV0 } },
  releases: [],
  current: {
    name: "v0",
    shape: { schema: GateAttributionSchema, decode: decodeGateAttribution },
  },
});

/** Reads a phase's `gate-attribution.json` of any shape phax has written. Never throws. */
export const parseGateAttribution: (input: unknown) => ParsedShape<GateAttributionShapes> =
  gateAttributionFormat.parse;

/** The latest gate attribution: the current shape, which carries no version. */
export type LatestGateAttribution = GateAttribution;

/** Upgrades a parsed gate attribution in memory: the identity on the current shape. */
export function toLatestGateAttribution(value: GateAttributionV0): LatestGateAttribution {
  return value;
}

// ── phase file reconciliation

export type PhaseFileReconciliationShapes = { v0: PhaseFileReconciliationV0 };

/** The id of every phase file reconciliation shape the package reads. */
export type PhaseFileReconciliationShape = keyof PhaseFileReconciliationShapes;

export const phaseFileReconciliationFormat = defineFormat<PhaseFileReconciliationShapes>({
  id: "phase-file-reconciliation",
  label: "phase file reconciliation",
  legacy: {
    0: { schema: PhaseFileReconciliationV0Schema, decode: decodePhaseFileReconciliationV0 },
  },
  releases: [],
  current: {
    name: "v0",
    shape: { schema: PhaseFileReconciliationSchema, decode: decodePhaseFileReconciliation },
  },
});

/** Reads a phase's `file-reconciliation.json` of any shape phax has written. Never throws. */
export const parsePhaseFileReconciliation: (
  input: unknown,
) => ParsedShape<PhaseFileReconciliationShapes> = phaseFileReconciliationFormat.parse;

type LaterReconciliationFact = "phaseId" | "createdButPlannedEdit" | "editedButPlannedCreate";

/**
 * The latest phase file reconciliation: `phaseId`, `createdButPlannedEdit`
 * and `editedButPlannedCreate` each marked `Unknown` when the document
 * predates it.
 */
export type LatestPhaseFileReconciliation = Omit<
  PhaseFileReconciliation,
  LaterReconciliationFact
> & {
  readonly [K in LaterReconciliationFact]: PhaseFileReconciliation[K] | Unknown;
};

/** Upgrades a parsed file reconciliation in memory. Keeps every recorded fact; never invents one. */
export function toLatestPhaseFileReconciliation(
  value: PhaseFileReconciliationV0,
): LatestPhaseFileReconciliation {
  const { phaseId, createdButPlannedEdit, editedButPlannedCreate, ...recorded } = value;
  return {
    ...recorded,
    phaseId: phaseId ?? UNKNOWN,
    createdButPlannedEdit: createdButPlannedEdit ?? UNKNOWN,
    editedButPlannedCreate: editedButPlannedCreate ?? UNKNOWN,
  };
}

// ── gate diagnostics

export type GateDiagnosticsShapes = { v0: GateDiagnosticsV0 };

/** The id of every gate diagnostics shape the package reads. */
export type GateDiagnosticsShape = keyof GateDiagnosticsShapes;

export const gateDiagnosticsFormat = defineFormat<GateDiagnosticsShapes>({
  id: "gate-diagnostics",
  label: "gate diagnostics document",
  legacy: { 0: { schema: GateDiagnosticsV0Schema, decode: decodeGateDiagnosticsV0 } },
  releases: [],
  current: {
    name: "v0",
    shape: { schema: GateDiagnosticsDocumentSchema, decode: decodeGateDiagnosticsDocument },
  },
});

/** Reads an attempt's `checks-attempt-NN.diagnostics.json`. Never throws. */
export const parseGateDiagnostics: (input: unknown) => ParsedShape<GateDiagnosticsShapes> =
  gateDiagnosticsFormat.parse;

/** The latest gate diagnostics document: the current shape, which carries no version. */
export type LatestGateDiagnostics = GateDiagnosticsDocument;

/** Upgrades a parsed gate diagnostics document in memory: the identity on the current shape. */
export function toLatestGateDiagnostics(value: GateDiagnosticsV0): LatestGateDiagnostics {
  return value;
}

// ── gate pending

export type GatePendingShapes = { v0: GatePendingV0 };

/** The id of every gate pending shape the package reads. */
export type GatePendingShape = keyof GatePendingShapes;

export const gatePendingFormat = defineFormat<GatePendingShapes>({
  id: "gate-pending",
  label: "gate pending document",
  legacy: { 0: { schema: GatePendingV0Schema, decode: decodeGatePendingV0 } },
  releases: [],
  current: {
    name: "v0",
    shape: { schema: GatePendingDocumentSchema, decode: decodeGatePendingDocument },
  },
});

/** Reads an attempt's `checks-attempt-NN.pending.json`. Never throws. */
export const parseGatePending: (input: unknown) => ParsedShape<GatePendingShapes> =
  gatePendingFormat.parse;

/** The latest gate pending document: the current shape, which carries no version. */
export type LatestGatePending = GatePendingDocument;

/** Upgrades a parsed gate pending document in memory: the identity on the current shape. */
export function toLatestGatePending(value: GatePendingV0): LatestGatePending {
  return value;
}
