// The definitions the gate report and the brief report share: a location, a
// related location, a guide and a finding, with the two checks phax makes
// beyond keys and types — finding ids are unique within a report, and a lines
// pair is ordered. Both formats are decoded with `onExcessProperty: "error"`,
// so a key a definition does not name is refused at any level. Pure, and
// imports only `effect`, so the schemas package can carry it.
import { ParseResult, Schema } from "effect";

/**
 * A key with its description. The description sits on the key, not on its
 * value's schema, so a decode message says what was expected (`string`,
 * `"checked" | "refused"`) rather than quoting the description.
 */
export function described<S extends Schema.Schema.All>(schema: S, description: string) {
  return Schema.propertySignature(schema).annotations({ description });
}

// A line number is at least 1. The JSON Schema says so; phax's decode leaves
// it to the location's filter, so that a refusal names the location's file.
const LineNumberSchema = Schema.Int.annotations({
  identifier: "LineNumber",
  description: "A 1-based line number.",
  jsonSchema: { type: "integer", minimum: 1 },
});

const LinesSchema = Schema.NullOr(Schema.Tuple(LineNumberSchema, LineNumberSchema));

type Lines = Schema.Schema.Type<typeof LinesSchema>;

const locationFields = {
  file: described(
    Schema.NonEmptyString,
    "A path relative to the working tree. phax never checks that it exists.",
  ),
  lines: described(
    LinesSchema,
    "[start, end]: 1-based line numbers, both included, start at least 1 and end at least start. Null for the whole file.",
  ),
};

/** Why a `lines` pair is refused, naming the pair and its file; undefined when it is ordered. */
function linesViolation(location: { readonly file: string; readonly lines: Lines }) {
  if (location.lines === null) return undefined;
  const [start, end] = location.lines;
  const pair = `lines [${start}, ${end}] of ${location.file}`;
  if (start < 1) return `${pair} start below line 1`;
  if (end < start) return `${pair} are out of order`;
  return undefined;
}

// JSON Schema cannot compare the two numbers of a pair: the annotation names
// the check rather than dropping the filter silently. Decoding is unchanged.
const ORDERED_LINES =
  "Checked by phax's parser: lines starts at 1 or above and ends at or after its start.";

/** Where a finding is: a file, and the lines in it or null for the whole file. */
export const ReportLocationSchema = Schema.Struct(locationFields).pipe(
  Schema.filter(linesViolation, {
    jsonSchema: { description: `A file and the lines in it. ${ORDERED_LINES}` },
  }),
  Schema.annotations({ identifier: "ReportLocation" }),
);

export type ReportLocation = Schema.Schema.Type<typeof ReportLocationSchema>;

/** Another location a finding involves, and why. */
export const ReportRelatedLocationSchema = Schema.Struct({
  ...locationFields,
  why: described(Schema.NonEmptyString, "Why the finding involves this location, in one line."),
}).pipe(
  Schema.filter(linesViolation, {
    jsonSchema: { description: `Another location the finding involves, and why. ${ORDERED_LINES}` },
  }),
  Schema.annotations({ identifier: "ReportRelatedLocation" }),
);

export type ReportRelatedLocation = Schema.Schema.Type<typeof ReportRelatedLocationSchema>;

/** How to fix or comply: one line, and a file the agent reads and follows. */
export const ReportGuideSchema = Schema.Struct({
  summary: described(
    Schema.NonEmptyString,
    "One line on how to fix the finding or comply with the rule.",
  ),
  read: described(
    Schema.NonEmptyString,
    "A file, relative to the working tree, that the agent reads and follows. phax never opens it; what kind of file it is belongs to the provider.",
  ),
}).annotations({ identifier: "ReportGuide" });

export type ReportGuide = Schema.Schema.Type<typeof ReportGuideSchema>;

/** The keys of a finding, shared by both formats; the brief report adds `due`. */
export const reportFindingFields = {
  id: described(
    Schema.NonEmptyString,
    "The provider's own id for the finding, stable across runs of the same check and unique within the report. phax compares it by equality only.",
  ),
  rule: described(Schema.NonEmptyString, "The rule the finding breaks, in plain words."),
  location: described(ReportLocationSchema, "Where the finding is."),
  message: described(Schema.NonEmptyString, "What was found, in one line."),
  related: described(
    Schema.Array(ReportRelatedLocationSchema),
    "The other locations the finding involves, in the provider's order. May be empty.",
  ),
  guide: described(
    Schema.NullOr(ReportGuideSchema),
    "How to fix the finding: a summary and a file to read, or null when the provider gives none.",
  ),
};

/** A finding as both formats write it: a gate finding is exactly this, a brief finding adds `due`. */
export type ReportFinding = Schema.Schema.Type<Schema.Struct<typeof reportFindingFields>>;

/** The first finding id used twice in a list, or undefined. */
function firstDuplicateId(findings: ReadonlyArray<{ readonly id: string }>): string | undefined {
  const seen = new Set<string>();
  for (const { id } of findings) {
    if (seen.has(id)) return id;
    seen.add(id);
  }
  return undefined;
}

/**
 * `self`, refusing a list in which two findings share an id, naming the first
 * id used twice. JSON Schema cannot express it: the annotation names the
 * check, and the key's own description, when it has one, replaces it.
 */
export function uniqueFindingIds<A extends { readonly id: string }, I, R>(
  self: Schema.Schema<ReadonlyArray<A>, I, R>,
) {
  return self.pipe(
    Schema.filter(
      (findings) => {
        const duplicate = firstDuplicateId(findings);
        return duplicate === undefined
          ? undefined
          : `finding id ${JSON.stringify(duplicate)} is used twice`;
      },
      { jsonSchema: { description: "Checked by phax's parser: no two findings share an id." } },
    ),
  );
}

// `findings[0].guide.kind` — indexes bracketed, keys dotted, a top-level key
// bare — so an issue reads as the path a report's author would type.
function issuePath(path: ReadonlyArray<PropertyKey>): string {
  return path
    .map((segment, i) =>
      typeof segment === "number" ? `[${segment}]` : `${i === 0 ? "" : "."}${String(segment)}`,
    )
    .join("");
}

/**
 * The first issue of a report's decode error as one line, `<path>: <message>`
 * (the message alone at the root). An excess key and a missing key both name
 * the key's own path; a filter's message names the id or the file itself.
 */
export function describeReportIssue(error: ParseResult.ParseError): string {
  const [first] = ParseResult.ArrayFormatter.formatErrorSync(error);
  if (first === undefined) return error.message;
  const path = issuePath(first.path);
  return path.length > 0 ? `${path}: ${first.message}` : first.message;
}
