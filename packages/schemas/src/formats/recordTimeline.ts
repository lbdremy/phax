// A phase record's timeline files: its gate attribution, its file
// reconciliation, and each fix-loop attempt's gate diagnostics and gate
// pending documents. Each pre-schema shape is phax's frozen module under
// src/schemas/history/; each current shape, `next`, is phax's own schema and
// decoder. The package declares none of its own.
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
  GateAttributionPreSchemaSchema,
  decodeGateAttributionPreSchema,
  type GateAttributionPreSchema,
} from "../../../../src/schemas/history/gate-attribution/pre-schema.js";
import {
  GateDiagnosticsPreSchemaSchema,
  decodeGateDiagnosticsPreSchema,
  type GateDiagnosticsPreSchema,
} from "../../../../src/schemas/history/gate-diagnostics/pre-schema.js";
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
  PhaseFileReconciliationSchema,
  decodePhaseFileReconciliation,
  type PhaseFileReconciliation,
} from "../../../../src/schemas/reconciliation.js";
import type { ParsedShape } from "../parsed.js";
import { defineFormat } from "../shapes.js";

// None of these files has ever carried a `version`. A file without `$schema`
// is read by its frozen pre-schema module as shape `pre-schema`; no release
// has written `$schema` yet, so a `$schema` file at the package's own release
// is read by phax's decoder as shape `next`. A timeline file is identified by
// where it lives in the record folder; an attempt's order comes from its file
// name, which the reader supplies.

// ── gate attribution

export type GateAttributionShapes = {
  "pre-schema": GateAttributionPreSchema;
  next: GateAttribution;
};

/** The id of every gate attribution shape the package reads. */
export type GateAttributionShape = keyof GateAttributionShapes;

export const gateAttributionFormat = defineFormat<GateAttributionShapes>({
  id: "gate-attribution",
  label: "gate attribution",
  preSchema: { schema: GateAttributionPreSchemaSchema, decode: decodeGateAttributionPreSchema },
  releases: [],
  current: {
    name: "next",
    shape: { schema: GateAttributionSchema, decode: decodeGateAttribution },
  },
});

/** Reads a phase's `gate-attribution.json`. Never throws. */
export const parseGateAttribution: (input: unknown) => ParsedShape<GateAttributionShapes> =
  gateAttributionFormat.parse;

/** The latest gate attribution: phax's own, which carries no version. */
export type LatestGateAttribution = GateAttribution;

/** Upgrades a parsed gate attribution in memory: the identity on either shape. */
export function toLatestGateAttribution(
  value: GateAttributionPreSchema | GateAttribution,
): LatestGateAttribution {
  return value;
}

// ── phase file reconciliation

export type PhaseFileReconciliationShapes = {
  "pre-schema": PhaseFileReconciliationPreSchema;
  next: PhaseFileReconciliation;
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
    name: "next",
    shape: { schema: PhaseFileReconciliationSchema, decode: decodePhaseFileReconciliation },
  },
});

/** Reads a phase's `file-reconciliation.json`. Never throws. */
export const parsePhaseFileReconciliation: (
  input: unknown,
) => ParsedShape<PhaseFileReconciliationShapes> = phaseFileReconciliationFormat.parse;

/** The latest phase file reconciliation: phax's own, which carries no version. */
export type LatestPhaseFileReconciliation = PhaseFileReconciliation;

/** Upgrades a parsed file reconciliation in memory: the identity on either shape. */
export function toLatestPhaseFileReconciliation(
  value: PhaseFileReconciliationPreSchema | PhaseFileReconciliation,
): LatestPhaseFileReconciliation {
  return value;
}

// ── gate diagnostics

export type GateDiagnosticsShapes = {
  "pre-schema": GateDiagnosticsPreSchema;
  next: GateDiagnosticsDocument;
};

/** The id of every gate diagnostics shape the package reads. */
export type GateDiagnosticsShape = keyof GateDiagnosticsShapes;

export const gateDiagnosticsFormat = defineFormat<GateDiagnosticsShapes>({
  id: "gate-diagnostics",
  label: "gate diagnostics document",
  preSchema: { schema: GateDiagnosticsPreSchemaSchema, decode: decodeGateDiagnosticsPreSchema },
  releases: [],
  current: {
    name: "next",
    shape: { schema: GateDiagnosticsDocumentSchema, decode: decodeGateDiagnosticsDocument },
  },
});

/** Reads an attempt's `checks-attempt-NN.diagnostics.json`. Never throws. */
export const parseGateDiagnostics: (input: unknown) => ParsedShape<GateDiagnosticsShapes> =
  gateDiagnosticsFormat.parse;

/** The latest gate diagnostics document: phax's own, which carries no version. */
export type LatestGateDiagnostics = GateDiagnosticsDocument;

/** Upgrades a parsed gate diagnostics document in memory: the identity on either shape. */
export function toLatestGateDiagnostics(
  value: GateDiagnosticsPreSchema | GateDiagnosticsDocument,
): LatestGateDiagnostics {
  return value;
}

// ── gate pending

export type GatePendingShapes = { "pre-schema": GatePendingPreSchema; next: GatePendingDocument };

/** The id of every gate pending shape the package reads. */
export type GatePendingShape = keyof GatePendingShapes;

export const gatePendingFormat = defineFormat<GatePendingShapes>({
  id: "gate-pending",
  label: "gate pending document",
  preSchema: { schema: GatePendingPreSchemaSchema, decode: decodeGatePendingPreSchema },
  releases: [],
  current: {
    name: "next",
    shape: { schema: GatePendingDocumentSchema, decode: decodeGatePendingDocument },
  },
});

/** Reads an attempt's `checks-attempt-NN.pending.json`. Never throws. */
export const parseGatePending: (input: unknown) => ParsedShape<GatePendingShapes> =
  gatePendingFormat.parse;

/** The latest gate pending document: phax's own, which carries no version. */
export type LatestGatePending = GatePendingDocument;

/** Upgrades a parsed gate pending document in memory: the identity on either shape. */
export function toLatestGatePending(
  value: GatePendingPreSchema | GatePendingDocument,
): LatestGatePending {
  return value;
}
