// The manifests (`record.json`) on phax/records/v1: a phase record's and an
// authoring session's, and the reader that tells them apart. Each current
// schema and decoder is phax's own; the package declares none of its own.
import {
  AuthoringRecordManifestSchema,
  decodeAuthoringRecordManifest,
  type AuthoringRecordManifest,
} from "../../../../src/schemas/authoringRecord.js";
import {
  RunRecordManifestSchema,
  decodeRunRecordManifest,
  type RunRecordManifest,
} from "../../../../src/schemas/runRecord.js";
import { isFormatId, parseSchemaUrl } from "../../../../src/schemas/schemaUrl.js";
import type { Surface } from "../../../../src/schemas/surface.js";
import {
  AuthoringRecordManifestV1Schema,
  decodeAuthoringRecordManifestV1,
  type AuthoringRecordManifestV1,
} from "../history/authoring-record-manifest/v1.js";
import {
  PhaseRecordManifestV1Schema,
  decodePhaseRecordManifestV1,
  type PhaseRecordManifestV1,
} from "../history/phase-record-manifest/v1.js";
import {
  PhaseRecordManifestV2Schema,
  decodePhaseRecordManifestV2,
  type PhaseRecordManifestV2,
} from "../history/phase-record-manifest/v2.js";
import { failure, type ParsedDocument, type ParsedShape } from "../parsed.js";
import {
  UNKNOWN,
  defineFormat,
  isDocumentObject,
  malformedSchemaUrlMessage,
  notAnObjectMessage,
  unknownFormatMessage,
  type FormatDefinition,
  type Unknown,
} from "../shapes.js";

export type { AuthoringRecordManifestV1, PhaseRecordManifestV1, PhaseRecordManifestV2 };

// ── phase record manifest

/** A phase record's `record.json` (format id `phase-record-manifest`), as phax writes it. */
export const PhaseRecordManifestSchema = RunRecordManifestSchema;
export type PhaseRecordManifest = RunRecordManifest;

export type PhaseRecordManifestShapes = {
  v1: PhaseRecordManifestV1;
  v2: PhaseRecordManifest;
};

/** The id of every phase record manifest shape the package reads. */
export type PhaseRecordManifestShape = keyof PhaseRecordManifestShapes;

// While phax still writes version 2, its own decoder reads v2 documents; the
// frozen v2 twin takes over once the current shape moves on.
export const phaseRecordManifestFormat = defineFormat<PhaseRecordManifestShapes>({
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
  phaseRecordManifestFormat.parse;

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

// ── authoring record manifest

export type AuthoringRecordManifestShapes = { v1: AuthoringRecordManifestV1 };

/** The id of every authoring record manifest shape the package reads. */
export type AuthoringRecordManifestShape = keyof AuthoringRecordManifestShapes;

// Both surveyed signatures, with and without `sourceSha`, are one shape: phax
// has always written `sourceSha` as optional. The frozen v1 is an exact twin.
export const authoringRecordManifestFormat = defineFormat<AuthoringRecordManifestShapes>({
  id: "authoring-record-manifest",
  label: "authoring record manifest",
  legacy: {
    1: { schema: AuthoringRecordManifestV1Schema, decode: decodeAuthoringRecordManifestV1 },
  },
  releases: [],
  current: {
    name: "v1",
    shape: { schema: AuthoringRecordManifestSchema, decode: decodeAuthoringRecordManifest },
  },
});

/** Reads an authoring record's `record.json` of any shape phax has written. Never throws. */
export const parseAuthoringRecordManifest: (
  input: unknown,
) => ParsedShape<AuthoringRecordManifestShapes> = authoringRecordManifestFormat.parse;

/**
 * The latest authoring record manifest: no `version`. An absent `sourceSha`
 * stays absent — it records a session that did not commit, not an unknown fact.
 */
export type LatestAuthoringRecordManifest = Omit<AuthoringRecordManifest, "version">;

/** Upgrades a parsed authoring manifest in memory. Keeps every recorded fact; never invents one. */
export function toLatestAuthoringRecordManifest(
  value: AuthoringRecordManifestV1,
): LatestAuthoringRecordManifest {
  const { version: _version, ...recorded } = value;
  return recorded;
}

// ── any record manifest

export type RecordManifestShapes = {
  "phase-record-manifest": PhaseRecordManifestShapes;
  "authoring-record-manifest": AuthoringRecordManifestShapes;
};

/** The format of a `record.json`: a phase record or an authoring record. */
export type RecordManifestFormat = keyof RecordManifestShapes;

const recordManifestFormats: {
  readonly [F in RecordManifestFormat]: FormatDefinition<RecordManifestShapes[F]>;
} = {
  "phase-record-manifest": phaseRecordManifestFormat,
  "authoring-record-manifest": authoringRecordManifestFormat,
};

function isRecordManifestFormat(id: string): id is RecordManifestFormat {
  return Object.hasOwn(recordManifestFormats, id);
}

function readAs(
  format: RecordManifestFormat,
  input: unknown,
): ParsedDocument<RecordManifestShapes> {
  const result = recordManifestFormats[format].parse(input);
  if (!result.ok) return result;
  return {
    ok: true,
    format,
    shape: result.shape,
    value: result.value,
  } as ParsedDocument<RecordManifestShapes>;
}

/**
 * Reads any `record.json` on phax/records/v1 and names the format it read.
 * Never throws. In order:
 * 1. a non-object fails at `""`;
 * 2. a `$schema` naming one of the two manifest formats is read by that
 *    format; another known format fails at `$schema` (`<url> is a <format>
 *    document, not a record manifest`); a malformed URL or an unknown format
 *    fails with the shared messages;
 * 3. `kind: "authoring"` is read as an authoring record manifest, the rule of
 *    phax's `isAuthoringRecordManifest`;
 * 4. anything else is read as a phase record manifest.
 */
export function parseRecordManifest(input: unknown): ParsedDocument<RecordManifestShapes> {
  if (!isDocumentObject(input)) return failure("", notAnObjectMessage("record manifest", input));
  if (Object.hasOwn(input, "$schema")) {
    const url = input["$schema"];
    const parsed = parseSchemaUrl(url);
    if (parsed === undefined) return failure("$schema", malformedSchemaUrlMessage(url));
    const href = url as string;
    if (!isFormatId(parsed.formatId)) {
      return failure(
        "$schema",
        unknownFormatMessage(href, phaseRecordManifestFormat.packageVersion),
      );
    }
    if (!isRecordManifestFormat(parsed.formatId)) {
      return failure("$schema", `${href} is a ${parsed.formatId} document, not a record manifest`);
    }
    return readAs(parsed.formatId, input);
  }
  return readAs(
    input["kind"] === "authoring" ? "authoring-record-manifest" : "phase-record-manifest",
    input,
  );
}
