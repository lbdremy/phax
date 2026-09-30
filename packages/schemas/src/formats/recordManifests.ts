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
import { failure, type ParsedDocument, type ParsedShape } from "../parsed.js";
import {
  defineFormat,
  isDocumentObject,
  malformedSchemaUrlMessage,
  notAnObjectMessage,
  unknownFormatMessage,
  type FormatDefinition,
} from "../shapes.js";

// Neither manifest has written `$schema` yet: a document without it is read by
// phax's own decoder as shape `pre-schema`, the shape phax writes today.

// ── phase record manifest

/** A phase record's `record.json` (format id `phase-record-manifest`), as phax writes it. */
export const PhaseRecordManifestSchema = RunRecordManifestSchema;
export type PhaseRecordManifest = RunRecordManifest;

export type PhaseRecordManifestShapes = { "pre-schema": PhaseRecordManifest };

/** The id of every phase record manifest shape the package reads. */
export type PhaseRecordManifestShape = keyof PhaseRecordManifestShapes;

export const phaseRecordManifestFormat = defineFormat<PhaseRecordManifestShapes>({
  id: "phase-record-manifest",
  label: "phase record manifest",
  releases: [],
  current: {
    name: "pre-schema",
    shape: { schema: RunRecordManifestSchema, decode: decodeRunRecordManifest },
  },
});

/** Reads a phase record manifest. Never throws. */
export const parsePhaseRecordManifest: (input: unknown) => ParsedShape<PhaseRecordManifestShapes> =
  phaseRecordManifestFormat.parse;

/** The latest phase record manifest: no `version`. */
export type LatestPhaseRecordManifest = Omit<PhaseRecordManifest, "version">;

/** Upgrades a parsed manifest in memory. Keeps every recorded fact; never invents one. */
export function toLatestPhaseRecordManifest(value: PhaseRecordManifest): LatestPhaseRecordManifest {
  const { version: _version, ...recorded } = value;
  return recorded;
}

// ── authoring record manifest

export type AuthoringRecordManifestShapes = { "pre-schema": AuthoringRecordManifest };

/** The id of every authoring record manifest shape the package reads. */
export type AuthoringRecordManifestShape = keyof AuthoringRecordManifestShapes;

export const authoringRecordManifestFormat = defineFormat<AuthoringRecordManifestShapes>({
  id: "authoring-record-manifest",
  label: "authoring record manifest",
  releases: [],
  current: {
    name: "pre-schema",
    shape: { schema: AuthoringRecordManifestSchema, decode: decodeAuthoringRecordManifest },
  },
});

/** Reads an authoring record's `record.json`. Never throws. */
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
  value: AuthoringRecordManifest,
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
