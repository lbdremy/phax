import {
  RunRecordManifestSchema,
  decodeRunRecordManifest,
  type RunRecordManifest,
} from "../../../src/schemas/runRecord.js";
import type { Surface } from "../../../src/schemas/surface.js";
import {
  PhaseRecordManifestV1Schema,
  decodePhaseRecordManifestV1,
  type PhaseRecordManifestV1,
} from "./history/phase-record-manifest/v1.js";
import {
  PhaseRecordManifestV2Schema,
  decodePhaseRecordManifestV2,
  type PhaseRecordManifestV2,
} from "./history/phase-record-manifest/v2.js";
import { makeDocumentParser } from "./document.js";
import type { IdentifiedDocument, Parsed, ParsedDocument, ParsedShape } from "./parsed.js";
import { UNKNOWN, defineFormat, isUnknown, type Unknown } from "./shapes.js";

export type {
  Parsed,
  ParsedDocument,
  ParsedShape,
  PhaseRecordManifestV1,
  PhaseRecordManifestV2,
  Unknown,
};
export { UNKNOWN, isUnknown };

/** A phase record's `record.json` (format id `phase-record-manifest`), as phax writes it. */
export const PhaseRecordManifestSchema = RunRecordManifestSchema;
export type PhaseRecordManifest = RunRecordManifest;

type PhaseRecordManifestShapes = {
  v1: PhaseRecordManifestV1;
  v2: PhaseRecordManifest;
};

/** The id of every phase record manifest shape the package reads. */
export type PhaseRecordManifestShape = keyof PhaseRecordManifestShapes;

// While phax still writes version 2, its own decoder reads v2 documents; the
// frozen v2 twin takes over once the current shape moves on.
const phaseRecordManifest = defineFormat<PhaseRecordManifestShapes>({
  id: "phase-record-manifest",
  label: "phase record manifest",
  legacy: {
    1: { schema: PhaseRecordManifestV1Schema, decode: decodePhaseRecordManifestV1 },
    2: { schema: PhaseRecordManifestV2Schema, decode: decodePhaseRecordManifestV2 },
  },
  releases: [],
  current: {
    name: "v2",
    shape: { schema: RunRecordManifestSchema, decode: decodeRunRecordManifest },
  },
});

/** Reads a phase record manifest of any shape phax has written. Never throws. */
export const parsePhaseRecordManifest: (input: unknown) => ParsedShape<PhaseRecordManifestShapes> =
  phaseRecordManifest.parse;

type DocumentShapes = {
  "phase-record-manifest": PhaseRecordManifestShapes;
};

/** The id of every format `parseDocument` reads. */
export type DocumentFormatId = keyof DocumentShapes;

/** A document identified by its `$schema`: its format, its shape and its value. */
export type AnyDocument = IdentifiedDocument<DocumentShapes>;

/**
 * Identifies a document by its `$schema` URL alone and reads it. A legacy
 * document without `$schema` is read with its format's parse function. Never
 * throws.
 */
export const parseDocument: (input: unknown) => ParsedDocument<DocumentShapes> =
  makeDocumentParser<DocumentShapes>({ "phase-record-manifest": phaseRecordManifest });

/**
 * The latest phase record manifest, upgraded from any shape: no `version`,
 * and every fact the source shape never recorded marked `Unknown`.
 */
export type LatestPhaseRecordManifest = Omit<
  PhaseRecordManifest,
  "version" | "verifiedSurfaces"
> & {
  readonly verifiedSurfaces: ReadonlyArray<Surface> | Unknown;
};

/** Upgrades a parsed manifest in memory. Keeps every recorded fact; never invents one. */
export function toLatestPhaseRecordManifest(
  value: PhaseRecordManifestV1 | PhaseRecordManifest,
): LatestPhaseRecordManifest {
  if (value.version === 1) {
    const { version: _version, ...recorded } = value;
    return { ...recorded, verifiedSurfaces: UNKNOWN };
  }
  const { version: _version, ...recorded } = value;
  return recorded;
}
