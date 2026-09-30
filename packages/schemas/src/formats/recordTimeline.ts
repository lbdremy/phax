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
import type { ParsedShape } from "../parsed.js";
import { defineFormat } from "../shapes.js";

// None of these files has ever carried a `$schema` or a `version`: each is
// read by phax's own decoder as its format's shape `pre-schema`. A timeline
// file is identified by where it lives in the record folder; an attempt's
// order comes from its file name, which the reader supplies.

// ── gate attribution

export type GateAttributionShapes = { "pre-schema": GateAttribution };

/** The id of every gate attribution shape the package reads. */
export type GateAttributionShape = keyof GateAttributionShapes;

export const gateAttributionFormat = defineFormat<GateAttributionShapes>({
  id: "gate-attribution",
  label: "gate attribution",
  releases: [],
  current: {
    name: "pre-schema",
    shape: { schema: GateAttributionSchema, decode: decodeGateAttribution },
  },
});

/** Reads a phase's `gate-attribution.json`. Never throws. */
export const parseGateAttribution: (input: unknown) => ParsedShape<GateAttributionShapes> =
  gateAttributionFormat.parse;

/** The latest gate attribution: the pre-schema shape, which carries no version. */
export type LatestGateAttribution = GateAttribution;

/** Upgrades a parsed gate attribution in memory: the identity on the pre-schema shape. */
export function toLatestGateAttribution(value: GateAttribution): LatestGateAttribution {
  return value;
}

// ── phase file reconciliation

export type PhaseFileReconciliationShapes = { "pre-schema": PhaseFileReconciliation };

/** The id of every phase file reconciliation shape the package reads. */
export type PhaseFileReconciliationShape = keyof PhaseFileReconciliationShapes;

export const phaseFileReconciliationFormat = defineFormat<PhaseFileReconciliationShapes>({
  id: "phase-file-reconciliation",
  label: "phase file reconciliation",
  releases: [],
  current: {
    name: "pre-schema",
    shape: { schema: PhaseFileReconciliationSchema, decode: decodePhaseFileReconciliation },
  },
});

/** Reads a phase's `file-reconciliation.json`. Never throws. */
export const parsePhaseFileReconciliation: (
  input: unknown,
) => ParsedShape<PhaseFileReconciliationShapes> = phaseFileReconciliationFormat.parse;

/** The latest phase file reconciliation: the pre-schema shape, which carries no version. */
export type LatestPhaseFileReconciliation = PhaseFileReconciliation;

/** Upgrades a parsed file reconciliation in memory: the identity on the pre-schema shape. */
export function toLatestPhaseFileReconciliation(
  value: PhaseFileReconciliation,
): LatestPhaseFileReconciliation {
  return value;
}

// ── gate diagnostics

export type GateDiagnosticsShapes = { "pre-schema": GateDiagnosticsDocument };

/** The id of every gate diagnostics shape the package reads. */
export type GateDiagnosticsShape = keyof GateDiagnosticsShapes;

export const gateDiagnosticsFormat = defineFormat<GateDiagnosticsShapes>({
  id: "gate-diagnostics",
  label: "gate diagnostics document",
  releases: [],
  current: {
    name: "pre-schema",
    shape: { schema: GateDiagnosticsDocumentSchema, decode: decodeGateDiagnosticsDocument },
  },
});

/** Reads an attempt's `checks-attempt-NN.diagnostics.json`. Never throws. */
export const parseGateDiagnostics: (input: unknown) => ParsedShape<GateDiagnosticsShapes> =
  gateDiagnosticsFormat.parse;

/** The latest gate diagnostics document: the pre-schema shape, which carries no version. */
export type LatestGateDiagnostics = GateDiagnosticsDocument;

/** Upgrades a parsed gate diagnostics document in memory: the identity on the pre-schema shape. */
export function toLatestGateDiagnostics(value: GateDiagnosticsDocument): LatestGateDiagnostics {
  return value;
}

// ── gate pending

export type GatePendingShapes = { "pre-schema": GatePendingDocument };

/** The id of every gate pending shape the package reads. */
export type GatePendingShape = keyof GatePendingShapes;

export const gatePendingFormat = defineFormat<GatePendingShapes>({
  id: "gate-pending",
  label: "gate pending document",
  releases: [],
  current: {
    name: "pre-schema",
    shape: { schema: GatePendingDocumentSchema, decode: decodeGatePendingDocument },
  },
});

/** Reads an attempt's `checks-attempt-NN.pending.json`. Never throws. */
export const parseGatePending: (input: unknown) => ParsedShape<GatePendingShapes> =
  gatePendingFormat.parse;

/** The latest gate pending document: the pre-schema shape, which carries no version. */
export type LatestGatePending = GatePendingDocument;

/** Upgrades a parsed gate pending document in memory: the identity on the pre-schema shape. */
export function toLatestGatePending(value: GatePendingDocument): LatestGatePending {
  return value;
}
