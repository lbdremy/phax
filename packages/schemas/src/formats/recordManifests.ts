// The manifests (`record.json`) on phax/records/v1: a phase record's and an
// authoring session's, and the reader that tells them apart. Each pre-schema
// shape is phax's frozen module under src/schemas/history/; each current
// shape, named by `CURRENT_SHAPES` (`next` until a release renames it), is
// phax's own file schema and decoder. The package declares none of its own.
import {
  AuthoringRecordManifestFileSchema,
  decodeAuthoringRecordManifestFile,
  type AuthoringRecordManifest,
  type AuthoringRecordManifestFile,
} from "../../../../src/schemas/authoringRecord.js";
import {
  AuthoringRecordManifestPreSchemaSchema,
  decodeAuthoringRecordManifestPreSchema,
  type AuthoringRecordManifestPreSchema,
} from "../../../../src/schemas/history/authoring-record-manifest/pre-schema.js";
import {
  PhaseRecordManifestPreSchemaSchema,
  decodePhaseRecordManifestPreSchema,
  type PhaseRecordManifestPreSchema,
} from "../../../../src/schemas/history/phase-record-manifest/pre-schema.js";
import {
  RunRecordManifestFileSchema,
  decodeRunRecordManifestFile,
  type RunRecordManifest,
  type RunRecordManifestFile,
} from "../../../../src/schemas/runRecord.js";
import { isFormatId, parseSchemaUrl } from "../../../../src/schemas/schemaUrl.js";
import { CURRENT_SHAPES } from "../generated/index.js";
import { failure, type ParsedDocument, type ParsedShape } from "../parsed.js";
import {
  defineFormat,
  isDocumentObject,
  malformedSchemaUrlMessage,
  notAnObjectMessage,
  unknownFormatMessage,
  type CurrentShapeName,
  type FormatDefinition,
} from "../shapes.js";

// A manifest without `$schema` is read by its frozen pre-schema module as
// shape `pre-schema`; a `$schema` manifest is read by phax's decoder as the
// current shape, named by `CURRENT_SHAPES`: `next` until a release renames
// it, then that release.

// ── phase record manifest

/** A phase record's `record.json` (format id `phase-record-manifest`), as phax writes it. */
export const PhaseRecordManifestSchema = RunRecordManifestFileSchema;
export type PhaseRecordManifest = RunRecordManifestFile;

export type PhaseRecordManifestShapes = { "pre-schema": PhaseRecordManifestPreSchema } & {
  [K in CurrentShapeName<"phase-record-manifest">]: PhaseRecordManifest;
};

/** The id of every phase record manifest shape the package reads. */
export type PhaseRecordManifestShape = keyof PhaseRecordManifestShapes;

export const phaseRecordManifestFormat = defineFormat<PhaseRecordManifestShapes>({
  id: "phase-record-manifest",
  label: "phase record manifest",
  preSchema: {
    schema: PhaseRecordManifestPreSchemaSchema,
    decode: decodePhaseRecordManifestPreSchema,
  },
  releases: [],
  current: {
    name: CURRENT_SHAPES["phase-record-manifest"],
    shape: { schema: RunRecordManifestFileSchema, decode: decodeRunRecordManifestFile },
  },
});

/** Reads a phase record manifest. Never throws. */
export const parsePhaseRecordManifest: (input: unknown) => ParsedShape<PhaseRecordManifestShapes> =
  phaseRecordManifestFormat.parse;

/** The latest phase record manifest: phax's in-memory value, with no `version` and no `$schema`. */
export type LatestPhaseRecordManifest = RunRecordManifest;

/** Upgrades a parsed manifest in memory. Keeps every recorded fact; never invents one. */
export function toLatestPhaseRecordManifest(
  value: PhaseRecordManifestPreSchema | PhaseRecordManifest,
): LatestPhaseRecordManifest {
  if ("$schema" in value) {
    const { $schema: _schema, ...recorded } = value;
    return recorded;
  }
  const { version: _version, ...recorded } = value;
  return recorded;
}

// ── authoring record manifest

export type AuthoringRecordManifestShapes = { "pre-schema": AuthoringRecordManifestPreSchema } & {
  [K in CurrentShapeName<"authoring-record-manifest">]: AuthoringRecordManifestFile;
};

/** The id of every authoring record manifest shape the package reads. */
export type AuthoringRecordManifestShape = keyof AuthoringRecordManifestShapes;

export const authoringRecordManifestFormat = defineFormat<AuthoringRecordManifestShapes>({
  id: "authoring-record-manifest",
  label: "authoring record manifest",
  preSchema: {
    schema: AuthoringRecordManifestPreSchemaSchema,
    decode: decodeAuthoringRecordManifestPreSchema,
  },
  releases: [],
  current: {
    name: CURRENT_SHAPES["authoring-record-manifest"],
    shape: {
      schema: AuthoringRecordManifestFileSchema,
      decode: decodeAuthoringRecordManifestFile,
    },
  },
});

/** Reads an authoring record's `record.json`. Never throws. */
export const parseAuthoringRecordManifest: (
  input: unknown,
) => ParsedShape<AuthoringRecordManifestShapes> = authoringRecordManifestFormat.parse;

/**
 * The latest authoring record manifest: phax's in-memory value, with no
 * `version` and no `$schema`. An absent `sourceSha` stays absent — it records
 * a session that did not commit, not an unknown fact.
 */
export type LatestAuthoringRecordManifest = AuthoringRecordManifest;

/** Upgrades a parsed authoring manifest in memory. Keeps every recorded fact; never invents one. */
export function toLatestAuthoringRecordManifest(
  value: AuthoringRecordManifestPreSchema | AuthoringRecordManifestFile,
): LatestAuthoringRecordManifest {
  if ("$schema" in value) {
    const { $schema: _schema, ...recorded } = value;
    return recorded;
  }
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
