// The manifests (`record.json`) on phax/records/v1: a phase record's, an
// authoring session's, a decide session's and a review entry's, and the reader
// that tells them apart. Each pre-schema
// and released shape that is no longer current is phax's frozen module under
// src/schemas/history/; each current shape, named by `CURRENT_SHAPES` (`next`
// until a release renames it), is phax's own file schema and decoder. The
// package declares none of its own.
import {
  AuthoringRecordManifestFileSchema,
  decodeAuthoringRecordManifestFile,
  type AuthoringRecordManifest,
  type AuthoringRecordManifestFile,
} from "../../../../src/schemas/authoringRecord.js";
import {
  DecisionRecordManifestFileSchema,
  decodeDecisionRecordManifestFile,
  liftFrozenDecisionManifest,
  type DecisionRecordManifest,
  type DecisionRecordManifestFile,
} from "../../../../src/schemas/decisionRecord.js";
import {
  ReviewRecordManifestFileSchema,
  decodeReviewRecordManifestFile,
  type ReviewRecordManifest,
  type ReviewRecordManifestFile,
} from "../../../../src/schemas/reviewRecord.js";
import {
  DecisionRecordManifestV0_25_0Schema,
  decodeDecisionRecordManifestV0_25_0,
  type DecisionRecordManifestV0_25_0,
} from "../../../../src/schemas/history/decision-record-manifest/0.25.0.js";
import {
  DecisionRecordManifestV0_28_0Schema,
  decodeDecisionRecordManifestV0_28_0,
  type DecisionRecordManifestV0_28_0,
} from "../../../../src/schemas/history/decision-record-manifest/0.28.0.js";
import {
  AuthoringRecordManifestV0_17_0Schema,
  decodeAuthoringRecordManifestV0_17_0,
  type AuthoringRecordManifestV0_17_0,
} from "../../../../src/schemas/history/authoring-record-manifest/0.17.0.js";
import {
  AuthoringRecordManifestV0_23_0Schema,
  decodeAuthoringRecordManifestV0_23_0,
  type AuthoringRecordManifestV0_23_0,
} from "../../../../src/schemas/history/authoring-record-manifest/0.23.0.js";
import {
  AuthoringRecordManifestPreSchemaSchema,
  decodeAuthoringRecordManifestPreSchema,
  type AuthoringRecordManifestPreSchema,
} from "../../../../src/schemas/history/authoring-record-manifest/pre-schema.js";
import {
  PhaseRecordManifestV0_17_0Schema,
  decodePhaseRecordManifestV0_17_0,
  type PhaseRecordManifestV0_17_0,
} from "../../../../src/schemas/history/phase-record-manifest/0.17.0.js";
import {
  PhaseRecordManifestV0_26_0Schema,
  decodePhaseRecordManifestV0_26_0,
  type PhaseRecordManifestV0_26_0,
} from "../../../../src/schemas/history/phase-record-manifest/0.26.0.js";
import {
  PhaseRecordManifestPreSchemaSchema,
  decodePhaseRecordManifestPreSchema,
  type PhaseRecordManifestPreSchema,
} from "../../../../src/schemas/history/phase-record-manifest/pre-schema.js";
import {
  RunRecordManifestFileSchema,
  decodeRunRecordManifestFile,
  liftFrozenTokenUsage,
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
// shape `pre-schema`; a `$schema` manifest stamped at a release the format
// lists is read by that release's frozen module; any other `$schema` manifest
// is read by phax's decoder as the current shape, named by `CURRENT_SHAPES`:
// `next` until a release renames it, then that release.

// ── phase record manifest

/** A phase record's `record.json` (format id `phase-record-manifest`), as phax writes it. */
export const PhaseRecordManifestSchema = RunRecordManifestFileSchema;
export type PhaseRecordManifest = RunRecordManifestFile;

export type PhaseRecordManifestShapes = {
  "pre-schema": PhaseRecordManifestPreSchema;
  "0.17.0": PhaseRecordManifestV0_17_0;
  "0.26.0": PhaseRecordManifestV0_26_0;
} & {
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
  releases: [
    [
      "0.17.0",
      { schema: PhaseRecordManifestV0_17_0Schema, decode: decodePhaseRecordManifestV0_17_0 },
    ],
    [
      "0.26.0",
      { schema: PhaseRecordManifestV0_26_0Schema, decode: decodePhaseRecordManifestV0_26_0 },
    ],
  ],
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

/**
 * Upgrades a parsed manifest in memory. Keeps every recorded fact; never
 * invents one: a shape older than `oracle`, `mode` and `stop` gets
 * `oracle: null`, `mode: "headless"` and `stop: null`, because no phax that
 * wrote it could run an oracle phase or stop a phase. Its recorded surfaces
 * are kept as they are. A Vibe usage a shape older than 0.30.0 recorded
 * counted a whole session from the session's `meta.json`: it becomes
 * `{ available: false }`.
 */
export function toLatestPhaseRecordManifest(
  value:
    | PhaseRecordManifestPreSchema
    | PhaseRecordManifestV0_17_0
    | PhaseRecordManifestV0_26_0
    | PhaseRecordManifest,
): LatestPhaseRecordManifest {
  if ("stop" in value) {
    const { $schema: _schema, usage, ...recorded } = value;
    return { ...recorded, usage: liftFrozenTokenUsage(usage) };
  }
  if ("$schema" in value) {
    const { $schema: _schema, usage, ...recorded } = value;
    return {
      ...recorded,
      usage: liftFrozenTokenUsage(usage),
      oracle: null,
      mode: "headless",
      stop: null,
    };
  }
  const { version: _version, usage, ...recorded } = value;
  return {
    ...recorded,
    usage: liftFrozenTokenUsage(usage),
    oracle: null,
    mode: "headless",
    stop: null,
  };
}

// ── authoring record manifest

export type AuthoringRecordManifestShapes = {
  "pre-schema": AuthoringRecordManifestPreSchema;
  "0.17.0": AuthoringRecordManifestV0_17_0;
  "0.23.0": AuthoringRecordManifestV0_23_0;
} & {
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
  releases: [
    [
      "0.17.0",
      {
        schema: AuthoringRecordManifestV0_17_0Schema,
        decode: decodeAuthoringRecordManifestV0_17_0,
      },
    ],
    [
      "0.23.0",
      {
        schema: AuthoringRecordManifestV0_23_0Schema,
        decode: decodeAuthoringRecordManifestV0_23_0,
      },
    ],
  ],
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

/**
 * Upgrades a parsed authoring manifest in memory. Keeps every recorded fact;
 * never invents one: a shape older than `retry` gets `retry: "none"`, because
 * no phax that wrote it ever resumed a headless session. A Vibe usage a shape
 * older than 0.30.0 recorded counted a whole session from the session's
 * `meta.json`: it becomes `{ available: false }`.
 */
export function toLatestAuthoringRecordManifest(
  value:
    | AuthoringRecordManifestPreSchema
    | AuthoringRecordManifestV0_17_0
    | AuthoringRecordManifestV0_23_0
    | AuthoringRecordManifestFile,
): LatestAuthoringRecordManifest {
  if ("retry" in value) {
    const { $schema: _schema, usage, ...recorded } = value;
    return { ...recorded, usage: liftFrozenTokenUsage(usage) };
  }
  if ("$schema" in value) {
    const { $schema: _schema, usage, ...recorded } = value;
    return { ...recorded, usage: liftFrozenTokenUsage(usage), retry: "none" };
  }
  const { version: _version, usage, ...recorded } = value;
  return { ...recorded, usage: liftFrozenTokenUsage(usage), retry: "none" };
}

// ── decision record manifest

// Born with `$schema`: no pre-schema shape, and a manifest without `$schema`
// is unreadable. The 0.25.0 shape is frozen: every manifest it describes is an
// interactive record, valid as it is in the current shape but for a Vibe usage.
// The 0.28.0 shape is frozen too, for the Vibe usage alone.

export type DecisionRecordManifestShapes = {
  "0.25.0": DecisionRecordManifestV0_25_0;
  "0.28.0": DecisionRecordManifestV0_28_0;
} & {
  [K in CurrentShapeName<"decision-record-manifest">]: DecisionRecordManifestFile;
};

/** The id of every decision record manifest shape the package reads. */
export type DecisionRecordManifestShape = keyof DecisionRecordManifestShapes;

export const decisionRecordManifestFormat = defineFormat<DecisionRecordManifestShapes>({
  id: "decision-record-manifest",
  label: "decision record manifest",
  preSchema: null,
  releases: [
    [
      "0.25.0",
      { schema: DecisionRecordManifestV0_25_0Schema, decode: decodeDecisionRecordManifestV0_25_0 },
    ],
    [
      "0.28.0",
      { schema: DecisionRecordManifestV0_28_0Schema, decode: decodeDecisionRecordManifestV0_28_0 },
    ],
  ],
  current: {
    name: CURRENT_SHAPES["decision-record-manifest"],
    shape: {
      schema: DecisionRecordManifestFileSchema,
      decode: decodeDecisionRecordManifestFile,
    },
  },
});

/** Reads a decide session's `record.json`. Never throws. */
export const parseDecisionRecordManifest: (
  input: unknown,
) => ParsedShape<DecisionRecordManifestShapes> = decisionRecordManifestFormat.parse;

/** The latest decision record manifest: phax's in-memory value, with no `$schema`. */
export type LatestDecisionRecordManifest = DecisionRecordManifest;

/**
 * Upgrades a parsed decision manifest in memory: drops `$schema`, keeps every
 * other fact. A 0.25.0 manifest is an interactive record, valid as it is. A
 * Vibe usage a shape older than 0.30.0 recorded counted a whole session from
 * the session's `meta.json`: it becomes `{ available: false }`.
 */
export function toLatestDecisionRecordManifest(
  value: DecisionRecordManifestFile | DecisionRecordManifestV0_25_0 | DecisionRecordManifestV0_28_0,
): LatestDecisionRecordManifest {
  const { $schema: _schema, ...recorded } = value;
  // A current failed record already names its failure; a frozen one never does.
  if ("failure" in recorded) return recorded;
  return liftFrozenDecisionManifest(recorded);
}

// ── review record manifest

// Born with `$schema` and with no older shape: a manifest without `$schema` is
// unreadable.

export type ReviewRecordManifestShapes = {
  [K in CurrentShapeName<"review-record-manifest">]: ReviewRecordManifestFile;
};

/** The id of every review record manifest shape the package reads. */
export type ReviewRecordManifestShape = keyof ReviewRecordManifestShapes;

export const reviewRecordManifestFormat = defineFormat<ReviewRecordManifestShapes>({
  id: "review-record-manifest",
  label: "review record manifest",
  preSchema: null,
  releases: [],
  current: {
    name: CURRENT_SHAPES["review-record-manifest"],
    shape: {
      schema: ReviewRecordManifestFileSchema,
      decode: decodeReviewRecordManifestFile,
    },
  },
});

/** Reads a review entry's `record.json`. Never throws. */
export const parseReviewRecordManifest: (
  input: unknown,
) => ParsedShape<ReviewRecordManifestShapes> = reviewRecordManifestFormat.parse;

/** The latest review record manifest: phax's in-memory value, with no `$schema`. */
export type LatestReviewRecordManifest = ReviewRecordManifest;

/** Upgrades a parsed review manifest in memory: drops `$schema`, keeps every other fact. */
export function toLatestReviewRecordManifest(
  value: ReviewRecordManifestFile,
): LatestReviewRecordManifest {
  const { $schema: _schema, ...recorded } = value;
  return recorded;
}

// ── any record manifest

export type RecordManifestShapes = {
  "phase-record-manifest": PhaseRecordManifestShapes;
  "authoring-record-manifest": AuthoringRecordManifestShapes;
  "decision-record-manifest": DecisionRecordManifestShapes;
  "review-record-manifest": ReviewRecordManifestShapes;
};

/**
 * The format of a `record.json`: a phase record, an authoring record, a
 * decision record or a review record.
 */
export type RecordManifestFormat = keyof RecordManifestShapes;

const recordManifestFormats: {
  readonly [F in RecordManifestFormat]: FormatDefinition<RecordManifestShapes[F]>;
} = {
  "phase-record-manifest": phaseRecordManifestFormat,
  "authoring-record-manifest": authoringRecordManifestFormat,
  "decision-record-manifest": decisionRecordManifestFormat,
  "review-record-manifest": reviewRecordManifestFormat,
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
 * 2. a `$schema` naming one of the four manifest formats is read by that
 *    format; another known format fails at `$schema` (`<url> is a <format>
 *    document, not a record manifest`); a malformed URL or an unknown format
 *    fails with the shared messages;
 * 3. `kind: "review"` is read as a review record manifest and `kind:
 *    "decision"` as a decision record manifest, both born with `$schema` and
 *    so failing without one; `kind: "authoring"` is read as
 *    an authoring record manifest, the rule of phax's
 *    `isAuthoringRecordManifest`;
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
  if (input["kind"] === "review") return readAs("review-record-manifest", input);
  if (input["kind"] === "decision") return readAs("decision-record-manifest", input);
  return readAs(
    input["kind"] === "authoring" ? "authoring-record-manifest" : "phase-record-manifest",
    input,
  );
}
