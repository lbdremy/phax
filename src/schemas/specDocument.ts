import { Either, Schema, type Types } from "effect";
import { answerSchemaUrlField } from "./answerStamp.js";
import { formatFirstViolation, formatViolationAt } from "./formatError.js";
import {
  OpenQuestionSchema,
  QUESTION_CHECKS_DESCRIPTION,
  SpecArbitratedQuestionSchema,
  authoringArbitratedViolation,
  firstQuestionViolation,
} from "./questions.js";
import { NonEmptyString } from "./strictString.js";

// The spec document: a spec's JSON sidecar, and the JSON a headless spec
// authoring session returns (the same published shape), from which phax
// renders the Markdown spec deterministically. A strict answer since 0.32.0:
// its `$schema` is a const naming the current stamp and its strings are
// `strictString`'s pattern. Every field is required; an absent section is an
// empty list or an explicit variant (`before: null`, `docsPage.kind: "none"`),
// never a missing key.

const RequirementPatternSchema = Schema.Literal(
  "ubiquitous",
  "event",
  "state",
  "unwanted",
  "optional",
);

const GroundEntrySchema = Schema.Struct({
  path: NonEmptyString,
  note: NonEmptyString,
});

const TermSchema = Schema.Struct({
  term: NonEmptyString,
  definition: NonEmptyString,
});

const RequirementSchema = Schema.Struct({
  id: NonEmptyString,
  title: NonEmptyString,
  pattern: RequirementPatternSchema,
  statement: NonEmptyString,
});

/**
 * The one-line value the reader lifts into a surface element that had no
 * summary (a 0.25.0, 0.17.0 or pre-schema sidecar). The schema accepts it;
 * `phax artifact approve` and `complete` refuse a spec that still holds it.
 */
export const SURFACE_SUMMARY_PLACEHOLDER =
  "(summary to write — lifted by phax artifact migrate-documents)";

// `Schema.String` rather than `NonEmptyString` under a pattern: the prefix (or
// the one-line pattern) already rules out the empty string, and a
// `$ref`-plus-`pattern` pair in the exported JSON Schema would have its
// pattern ignored by draft-07 validators.
const SurfaceElementSchema = Schema.Struct({
  surface: Schema.String.pipe(Schema.pattern(/^(cli|config|file|api|package|internal): /)),
  summary: Schema.String.pipe(
    Schema.pattern(/^[^\n\r\u0085\u2028\u2029]+$/),
    Schema.annotations({
      description:
        "One sentence, in the consumer's words: what whoever consumes this element can now do or sees differently. Never where it lives or how it is built.",
    }),
  ),
  binding: Schema.Literal("normative", "indicative"),
  before: Schema.NullOr(Schema.String),
  after: NonEmptyString,
});

const AcceptanceCriterionSchema = Schema.Struct({
  id: NonEmptyString,
  name: NonEmptyString,
  given: NonEmptyString,
  when: NonEmptyString,
  // Given/when/then is the criterion's shape; the key is data, never awaited.
  // eslint-disable-next-line unicorn/no-thenable
  then: NonEmptyString,
  refs: Schema.NonEmptyArray(NonEmptyString),
});

const PlanningNoteSchema = Schema.Struct({
  settled: Schema.Array(NonEmptyString),
  open: Schema.Array(NonEmptyString),
  constraints: Schema.Array(NonEmptyString),
});

const DocsPageSchema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("page"),
    page: NonEmptyString,
    reader: NonEmptyString,
    example: NonEmptyString,
  }),
  Schema.Struct({
    kind: Schema.Literal("none"),
    why: NonEmptyString,
  }),
);

const specDocumentFields = {
  kind: Schema.Literal("spec"),
  title: NonEmptyString,
  ground: Schema.Array(GroundEntrySchema),
  context: NonEmptyString,
  problem: NonEmptyString,
  productGoal: Schema.Struct({
    statement: NonEmptyString,
    guidingRule: NonEmptyString,
  }),
  terminology: Schema.Array(TermSchema),
  requirements: Schema.NonEmptyArray(RequirementSchema),
  surface: Schema.Array(SurfaceElementSchema),
  nonGoals: Schema.Array(NonEmptyString),
  acceptanceCriteria: Schema.NonEmptyArray(AcceptanceCriterionSchema),
  openQuestions: Schema.Array(OpenQuestionSchema),
  arbitratedQuestions: Schema.Array(SpecArbitratedQuestionSchema),
  planningNote: PlanningNoteSchema,
  docsPage: DocsPageSchema,
};

/** A spec document in memory: never a `version`, never a `$schema`. */
export type SpecDocument = Types.Simplify<Schema.Struct.Type<typeof specDocumentFields>>;

interface Violation {
  readonly path: ReadonlyArray<PropertyKey>;
  readonly message: string;
}

function firstDuplicateId(
  items: ReadonlyArray<{ readonly id: string }>,
  basePath: ReadonlyArray<PropertyKey>,
  label: string,
): Violation | undefined {
  const firstIndex = new Map<string, number>();
  for (const [i, item] of items.entries()) {
    const seen = firstIndex.get(item.id);
    if (seen !== undefined) {
      return {
        path: [...basePath, i, "id"],
        message: `"${item.id}" duplicates the ${label} id at index ${seen}`,
      };
    }
    firstIndex.set(item.id, i);
  }
  return undefined;
}

// Spec §5.3 traceability, checked in a fixed order so the first violation
// reported for a given document is stable. Each violation carries the path of
// the offending value; `formatFirstViolation` renders it as
// `acceptanceCriteria[2].refs[0]: "5.9" names no requirement`. The question
// checks (`firstQuestionViolation`) run where the question ids were checked.
function firstTraceabilityViolation(doc: SpecDocument): Violation | undefined {
  const duplicateRequirement = firstDuplicateId(doc.requirements, ["requirements"], "requirement");
  if (duplicateRequirement !== undefined) return duplicateRequirement;

  const question = firstQuestionViolation({
    basePath: [],
    openQuestions: doc.openQuestions,
    arbitratedQuestions: doc.arbitratedQuestions,
    phaseIds: null,
  });
  if (question !== undefined) return question;

  const requirementIds = new Set(doc.requirements.map((r) => r.id));
  for (const [c, criterion] of doc.acceptanceCriteria.entries()) {
    for (const [r, ref] of criterion.refs.entries()) {
      if (!requirementIds.has(ref)) {
        return {
          path: ["acceptanceCriteria", c, "refs", r],
          message: `"${ref}" names no requirement`,
        };
      }
    }
  }

  const referenced = new Set(doc.acceptanceCriteria.flatMap((c) => c.refs));
  for (const [i, requirement] of doc.requirements.entries()) {
    if (!referenced.has(requirement.id)) {
      return {
        path: ["requirements", i, "id"],
        message: `"${requirement.id}" is referenced by no acceptance criterion`,
      };
    }
  }

  return undefined;
}

// JSON Schema cannot express the traceability checks, nor an authoring
// answer's empty `arbitratedQuestions`: the annotation declares the gap in the
// exported schema rather than dropping the check silently. It adds no
// constraint, and decoding is unchanged.
const TRACEABILITY_DESCRIPTION = `Checked by phax's parser, not by this JSON Schema: requirement ids are unique; every acceptance criterion \`refs\` entry names an existing requirement; every requirement is referenced by at least one acceptance criterion; ${QUESTION_CHECKS_DESCRIPTION}; and an authoring session's answer leaves every question open, so its arbitratedQuestions is [].`;

/**
 * A spec's JSON sidecar, which is also the answer a headless authoring session
 * and a decide session give: `$schema` first, then the document's fields, with
 * the traceability checks. Unknown keys are rejected.
 */
export const SpecDocumentFileSchema = Schema.Struct({
  $schema: answerSchemaUrlField("spec-document"),
  ...specDocumentFields,
}).pipe(
  Schema.filter(firstTraceabilityViolation, {
    jsonSchema: { description: TRACEABILITY_DESCRIPTION },
  }),
);

export type SpecDocumentFile = Schema.Schema.Type<typeof SpecDocumentFileSchema>;

/** The document an authoring session returns: the sidecar's own shape, `$schema` included. */
export type AuthoredSpecDocument = SpecDocumentFile;

export const decodeSpecDocumentFile = Schema.decodeUnknownEither(SpecDocumentFileSchema, {
  onExcessProperty: "error",
});
export const encodeSpecDocumentFile = Schema.encodeSync(SpecDocumentFileSchema);

/**
 * Decodes a headless spec authoring session's parsed answer: the authoring
 * rule first (a non-empty `arbitratedQuestions` is refused at its first entry,
 * `arbitratedQuestions[0]`), then the sidecar decoder. A Left is the first
 * violation, `<path>: <message>`.
 */
export function decodeAuthoredSpecDocument(
  input: unknown,
): Either.Either<AuthoredSpecDocument, string> {
  if (
    typeof input === "object" &&
    input !== null &&
    Array.isArray((input as { readonly arbitratedQuestions?: unknown }).arbitratedQuestions)
  ) {
    const arbitrated = (input as { readonly arbitratedQuestions: ReadonlyArray<unknown> })
      .arbitratedQuestions;
    const violation = authoringArbitratedViolation(arbitrated, []);
    if (violation !== undefined) return Either.left(formatViolationAt(violation));
  }
  return Either.mapLeft(decodeSpecDocumentFile(input), formatFirstViolation);
}
