/**
 * The `$schema` URL that names a persisted document's format and its shape,
 * by the phax release that last changed that shape (not necessarily the
 * release that wrote the document): `<base>/<format-id>/<X.Y.Z>.json`. Pure, and
 * imports only `effect`, so the schemas package can carry it.
 */
import { JsonSchema, Schema } from "effect";
import { isExportedPattern } from "./strictString.js";

export const SCHEMA_URL_BASE = "https://docs.phax.run/schemas";

/**
 * Every persisted format: the thirteen of spec §4 phax still writes, then the two approval
 * record formats of spec approval-record-files, then the gate request of spec
 * gate-request, then the brief request and record of spec brief-provider,
 * then the gate report and brief report of spec guarantee-reports, then the
 * hand decision answer and the decision record manifest of spec
 * artifact-decide, then the cost ledger of spec cost-ledger, then the
 * architecture request and report of spec planning-skill-defaults, then the
 * oracle request of spec oracle-phases, then the first reading, interactive
 * handoff, interactive session and review stop of spec interactive-phases,
 * then the decide verdicts of spec artifact-decide-verdicts, then the review
 * record manifest and the code review of spec headless-code-review,
 * then the plan extraction answer and the spec and plan hand decision answers
 * of spec structured-output, then the acceptance request of spec
 * acceptance-tests, which replaces the oracle request (kept in this list,
 * frozen at 0.26.0), then the three answers of the commands behind the Claude
 * Code mod (artifact status, plans overview and plans lint) of spec
 * command-contracts, appended so existing order stays stable.
 */
export const FORMAT_IDS = [
  "registry",
  "run-status",
  "phase-status",
  "phax-plan",
  "compliance-review",
  "plan-approvals",
  "spec-approvals",
  "phase-record-manifest",
  "authoring-record-manifest",
  "gate-attribution",
  "phase-file-reconciliation",
  "spec-document",
  "plan-document",
  "plan-approval-record",
  "spec-approval-record",
  "gate-request",
  "brief-request",
  "brief-record",
  "gate-report",
  "brief-report",
  "hand-decision-answer",
  "decision-record-manifest",
  "cost-ledger",
  "architecture-request",
  "architecture-report",
  "oracle-request",
  "first-reading",
  "interactive-handoff",
  "interactive-session",
  "review-stop",
  "run-list",
  "decide-verdicts",
  "review-record-manifest",
  "code-review",
  "phax-plan-extraction",
  "spec-hand-decision-answer",
  "plan-hand-decision-answer",
  "acceptance-request",
  "artifact-status",
  "plan-overview",
  "plan-lint",
] as const;

export type FormatId = (typeof FORMAT_IDS)[number];

export function isFormatId(value: string): value is FormatId {
  return (FORMAT_IDS as ReadonlyArray<string>).includes(value);
}

/**
 * The formats born with `$schema`: phax wrote every one of their documents
 * with it, so they have no pre-schema shape and no frozen pre-schema module,
 * and a document of theirs without `$schema` is unreadable. The gate report
 * and the brief report, which phax reads but never writes, are born at
 * 0.21.0 with `$schema` too. So is the hand decision answer a decide session
 * returns for a hand-authored artifact, which phax reads but never writes,
 * the manifest of a decide session's decision record, and a run's cost
 * ledger. So are the architecture request phax writes on an architecture
 * provider's stdin and the architecture report the provider prints, of spec
 * planning-skill-defaults, and the oracle request phax wrote on the provider's
 * stdin (retired, frozen at 0.26.0), of spec oracle-phases. So are the first reading and the
 * interactive handoff a declared phase's turns answer, which phax reads but
 * never writes, and the interactive session and review stop phax writes, of
 * spec interactive-phases. So is the run list `phax ls --json` prints, of the
 * same spec. So are the decide verdicts a person writes for
 * `phax artifact decide --verdicts`, which phax reads but never writes, of
 * spec artifact-decide-verdicts. So is the manifest of a review entry on
 * phax/records/v1, and the code review a headless review session answers, of
 * spec headless-code-review. So is the plan extraction answer the fallback
 * extraction model returns, which phax reads but never writes, of spec
 * structured-output, and the spec and plan hand decision answers that replace
 * the hand decision answer's root union, of the same spec. So is the
 * acceptance request phax writes on the acceptance provider's stdin, of spec
 * acceptance-tests, born at 0.33.0 beside the oracle request it replaces
 * (frozen at 0.26.0, still listed here). So are the artifact status, the plan
 * overview and the plan lint that `phax artifact status --json`,
 * `phax plans overview --json` and `phax plans lint --json` print, which phax
 * never saves, of spec command-contracts, born at 0.34.0.
 */
export const SCHEMA_BORN_FORMAT_IDS = [
  "plan-approval-record",
  "spec-approval-record",
  "gate-request",
  "brief-request",
  "brief-record",
  "gate-report",
  "brief-report",
  "hand-decision-answer",
  "decision-record-manifest",
  "cost-ledger",
  "architecture-request",
  "architecture-report",
  "oracle-request",
  "first-reading",
  "interactive-handoff",
  "interactive-session",
  "review-stop",
  "run-list",
  "decide-verdicts",
  "review-record-manifest",
  "code-review",
  "phax-plan-extraction",
  "spec-hand-decision-answer",
  "plan-hand-decision-answer",
  "acceptance-request",
  "artifact-status",
  "plan-overview",
  "plan-lint",
] as const satisfies ReadonlyArray<FormatId>;

export type SchemaBornFormatId = (typeof SCHEMA_BORN_FORMAT_IDS)[number];

/** The formats phax wrote before it wrote `$schema`: each has a pre-schema shape. */
export type PreSchemaFormatId = Exclude<FormatId, SchemaBornFormatId>;

export function isSchemaBornFormatId(value: string): value is SchemaBornFormatId {
  return (SCHEMA_BORN_FORMAT_IDS as ReadonlyArray<string>).includes(value);
}

/** Every format with a pre-schema shape, in `FORMAT_IDS` order. */
export const PRE_SCHEMA_FORMAT_IDS: ReadonlyArray<PreSchemaFormatId> = FORMAT_IDS.filter(
  (id): id is PreSchemaFormatId => !isSchemaBornFormatId(id),
);

const RELEASE_TRIPLE = String.raw`(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)`;
const RELEASE = new RegExp(`^${RELEASE_TRIPLE}$`);

/** A release string: a numeric `X.Y.Z` triple. */
export function isRelease(value: string): boolean {
  return RELEASE.test(value);
}

export function schemaUrl(formatId: FormatId, release: string): string {
  return `${SCHEMA_URL_BASE}/${formatId}/${release}.json`;
}

/**
 * A persisted file's `$schema` field: the URL of that one format at any
 * `X.Y.Z` release. Not bound to the running release, so a file the previous
 * release wrote in the same shape still decodes.
 */
export function schemaUrlField(formatId: FormatId) {
  const prefix = `${SCHEMA_URL_BASE}/${formatId}/`.replaceAll(".", "\\.");
  return Schema.String.check(
    isExportedPattern(new RegExp(`^${prefix}${RELEASE_TRIPLE}\\.json$`)),
  ).pipe(
    Schema.annotate({
      description: `The ${formatId} format's shape, named by the phax release that last changed it (not necessarily the release that wrote this file): ${SCHEMA_URL_BASE}/${formatId}/<X.Y.Z>.json`,
    }),
  );
}

// Any lowercase-kebab id is accepted, so that an id unknown to this build
// stays reportable by name rather than reading as a malformed URL.
const SCHEMA_URL = new RegExp(
  `^${SCHEMA_URL_BASE.replaceAll(".", "\\.")}/([a-z][a-z0-9]*(?:-[a-z0-9]+)*)/([0-9.]+)\\.json$`,
);

export function parseSchemaUrl(value: unknown): { formatId: string; release: string } | undefined {
  if (typeof value !== "string") return undefined;
  const match = SCHEMA_URL.exec(value);
  const formatId = match?.[1];
  const release = match?.[2];
  if (formatId === undefined || release === undefined || !isRelease(release)) return undefined;
  return { formatId, release };
}

/**
 * How a decoder treats a key its schema does not name: `error` rejects it,
 * `ignore` accepts and drops it. The JSON Schema follows suit.
 */
export type Excess = "error" | "ignore";

const DEFINITIONS_REF = "#/definitions/";
const DEFS_REF = "#/$defs/";

function isJsonObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A draft-07 node in the form phax publishes: a `$ref` names its definition
 * under `$defs`, and a non-empty array whose every element has one schema is
 * `items` with `minItems`, not a tuple of one element and the same rest.
 * Both are the same contract as Effect's form, written as every released
 * snapshot writes it.
 */
function published(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(published);
  if (!isJsonObject(node)) return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    out[key] =
      key === "$ref" && typeof value === "string" && value.startsWith(DEFINITIONS_REF)
        ? `${DEFS_REF}${value.slice(DEFINITIONS_REF.length)}`
        : published(value);
  }
  const { items, additionalItems, minItems } = out;
  if (
    Array.isArray(items) &&
    items.length === minItems &&
    additionalItems !== undefined &&
    items.every((item) => JSON.stringify(item) === JSON.stringify(additionalItems))
  ) {
    const { additionalItems: _rest, ...array } = out;
    return { ...array, items: additionalItems };
  }
  return out;
}

const NON_FINITE: ReadonlySet<unknown> = new Set(["NaN", "Infinity", "-Infinity"]);

function isNullType(node: unknown): boolean {
  return isJsonObject(node) && Object.keys(node).length === 1 && node["type"] === "null";
}

/** Effect's JSON form of a non-finite number: a string enum of `NaN`, `Infinity` and `-Infinity`. */
function isNonFiniteString(node: unknown): boolean {
  if (!isJsonObject(node) || node["type"] !== "string") return false;
  const values = node["enum"];
  return (
    Array.isArray(values) &&
    values.length === NON_FINITE.size &&
    values.every((value) => NON_FINITE.has(value)) &&
    Object.keys(node).length === 2
  );
}

/** A node with its `anyOf` members filtered, written as the one member left when only one is. */
function keepMembers(
  node: Readonly<Record<string, unknown>>,
  keep: (members: ReadonlyArray<unknown>) => ReadonlyArray<unknown>,
): Readonly<Record<string, unknown>> {
  const anyOf = node["anyOf"];
  if (!Array.isArray(anyOf)) return node;
  const kept = keep(anyOf);
  if (kept.length === anyOf.length) return node;
  const { anyOf: _members, ...rest } = node;
  const [only] = kept;
  return kept.length === 1 && isJsonObject(only) ? { ...only, ...rest } : { ...rest, anyOf: kept };
}

/** An optional key's schema without the one `null` Effect adds for its `undefined`. */
function withoutUndefined(node: unknown): unknown {
  if (!isJsonObject(node)) return node;
  return keepMembers(node, (members) => {
    const index = members.findLastIndex(isNullType);
    return index === -1 ? members : members.filter((_, at) => at !== index);
  });
}

/**
 * A node as phax's decoders read it. Effect renders the JSON codec's encoded
 * side, which a decoder of the type side does not accept: a number may also
 * be the string `NaN`, `Infinity` or `-Infinity`, and an optional key may also
 * be `null` (its `undefined`). phax decodes the type side, so both go: the
 * non-finite strings from every `anyOf`, and from a key outside `required`
 * exactly one `null`, the last, so `optional(NullOr(X))`, which Effect renders
 * with two, keeps the one its value accepts.
 */
function decoderShaped(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(decoderShaped);
  if (!isJsonObject(node)) return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) out[key] = decoderShaped(value);
  const properties = out["properties"];
  const required = new Set(Array.isArray(out["required"]) ? out["required"] : []);
  const shaped = isJsonObject(properties)
    ? {
        ...out,
        properties: Object.fromEntries(
          Object.entries(properties).map(([name, property]) => [
            name,
            required.has(name) ? property : withoutUndefined(property),
          ]),
        ),
      }
    : out;
  return keepMembers(shaped, (members) => members.filter((member) => !isNonFiniteString(member)));
}

/** The root schema and the `$defs` its `$ref`s name, in phax's published draft-07 form. */
export interface Draft07Document {
  readonly schema: Readonly<Record<string, unknown>>;
  readonly defs: Readonly<Record<string, unknown>>;
}

/**
 * The annotation keys copied onto their node's JSON Schema, for a keyword
 * Effect would otherwise place under `allOf` or not state: a `$schema`'s
 * `const` (an answer's stamp) and an object's `anyOf` (the config partial's
 * at-least-one key).
 */
const NODE_KEYWORDS: ReadonlySet<string> = new Set(["const", "anyOf"]);

/**
 * `Schema.toJsonSchemaDocument` with the excess strategy, converted to
 * draft-07 (`JsonSchema.toDocumentDraft07`), in phax's published form.
 */
export function draft07Document(schema: Schema.Top, excess: Excess): Draft07Document {
  const document = JsonSchema.toDocumentDraft07(
    Schema.toJsonSchemaDocument(schema, {
      onExcessProperty: excess,
      includeAnnotationKey: (key) => NODE_KEYWORDS.has(key),
    }),
  );
  const root = decoderShaped(published(document.schema));
  const defs = decoderShaped(published(document.definitions));
  return {
    schema: isJsonObject(root) ? root : {},
    defs: isJsonObject(defs) ? defs : {},
  };
}

/**
 * A schema's JSON Schema as a Draft-07 document: the meta-schema, the root
 * schema, and its `$defs` when there are any.
 */
export function draft07JsonSchema(schema: Schema.Top): object {
  const document = draft07Document(schema, "error");
  return {
    $schema: JsonSchema.META_SCHEMA_URI_DRAFT_07,
    ...document.schema,
    ...(Object.keys(document.defs).length > 0 ? { $defs: document.defs } : {}),
  };
}

const ANNOTATION_KEYS: ReadonlySet<string> = new Set(["description", "title"]);

/**
 * One node of an editor schema. Effect renders a description on a key under
 * `allOf`, and a record as `propertyNames` plus `additionalProperties`; the
 * editor reads a description beside its key, and a record as
 * `patternProperties`, as every released editor schema wrote them.
 */
function editorNode(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(editorNode);
  if (!isJsonObject(node)) return node;
  let out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) out[key] = editorNode(value);

  const allOf = out["allOf"];
  if (
    Array.isArray(allOf) &&
    allOf.every(
      (member) => isJsonObject(member) && Object.keys(member).every((k) => ANNOTATION_KEYS.has(k)),
    )
  ) {
    const { allOf: _annotations, ...rest } = out;
    out = Object.assign({}, rest, ...allOf);
  }

  const additional = out["additionalProperties"];
  if (isJsonObject(out["propertyNames"]) && isJsonObject(additional)) {
    const { additionalProperties: _values, ...rest } = out;
    return { ...rest, properties: {}, patternProperties: { "": additional } };
  }
  return out;
}

/** A config schema as the editor reads it: `draft07JsonSchema` in the form the editor schemas were always written. */
export function editorJsonSchema(schema: Schema.Top): object {
  const document = draft07JsonSchema(schema);
  const normalised = editorNode(document);
  return isJsonObject(normalised) ? normalised : document;
}

/** Orders two `X.Y.Z` releases numerically: negative, zero or positive. */
export function compareReleases(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}
