import { JSONSchema, Schema, type Types } from "effect";
import {
  OpenQuestionSchema,
  QUESTION_CHECKS_DESCRIPTION,
  SpecArbitratedQuestionSchema,
  SpecAuthoringArbitratedQuestionsSchema,
  firstQuestionViolation,
} from "./questions.js";
import { schemaUrlField } from "./schemaUrl.js";

// The spec document: the JSON a headless spec authoring session returns, from
// which phax renders the Markdown spec deterministically. Experimental — outside
// the `version: 1` stability promise of phax.json and the run formats. Every
// field is required; an absent section is an empty list or an explicit variant
// (`before: null`, `docsPage.kind: "none"`), never a missing key.

const RequirementPatternSchema = Schema.Literal(
  "ubiquitous",
  "event",
  "state",
  "unwanted",
  "optional",
);

const GroundEntrySchema = Schema.Struct({
  path: Schema.NonEmptyString,
  note: Schema.NonEmptyString,
});

const TermSchema = Schema.Struct({
  term: Schema.NonEmptyString,
  definition: Schema.NonEmptyString,
});

const RequirementSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  title: Schema.NonEmptyString,
  pattern: RequirementPatternSchema,
  statement: Schema.NonEmptyString,
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
  after: Schema.NonEmptyString,
});

const AcceptanceCriterionSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  given: Schema.NonEmptyString,
  when: Schema.NonEmptyString,
  // Given/when/then is the criterion's shape; the key is data, never awaited.
  // eslint-disable-next-line unicorn/no-thenable
  then: Schema.NonEmptyString,
  refs: Schema.NonEmptyArray(Schema.NonEmptyString),
});

const PlanningNoteSchema = Schema.Struct({
  settled: Schema.Array(Schema.NonEmptyString),
  open: Schema.Array(Schema.NonEmptyString),
  constraints: Schema.Array(Schema.NonEmptyString),
});

const DocsPageSchema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("page"),
    page: Schema.NonEmptyString,
    reader: Schema.NonEmptyString,
    example: Schema.NonEmptyString,
  }),
  Schema.Struct({
    kind: Schema.Literal("none"),
    why: Schema.NonEmptyString,
  }),
);

const specDocumentFields = {
  kind: Schema.Literal("spec"),
  title: Schema.NonEmptyString,
  ground: Schema.Array(GroundEntrySchema),
  context: Schema.NonEmptyString,
  problem: Schema.NonEmptyString,
  productGoal: Schema.Struct({
    statement: Schema.NonEmptyString,
    guidingRule: Schema.NonEmptyString,
  }),
  terminology: Schema.Array(TermSchema),
  requirements: Schema.NonEmptyArray(RequirementSchema),
  surface: Schema.Array(SurfaceElementSchema),
  nonGoals: Schema.Array(Schema.NonEmptyString),
  acceptanceCriteria: Schema.NonEmptyArray(AcceptanceCriterionSchema),
  openQuestions: Schema.Array(OpenQuestionSchema),
  arbitratedQuestions: Schema.Array(SpecArbitratedQuestionSchema),
  planningNote: PlanningNoteSchema,
  docsPage: DocsPageSchema,
};

// The authoring answer leaves every question open (§5.60): its
// `arbitratedQuestions` is always empty, and a non-empty one is refused at its
// first entry, through the invalid-document path.
const SpecDocumentStruct = Schema.Struct({
  version: Schema.Literal(1),
  ...specDocumentFields,
  arbitratedQuestions: SpecAuthoringArbitratedQuestionsSchema,
}).annotations({ title: "phax spec document (experimental)" });

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

// JSON Schema cannot express the traceability checks: the annotation declares
// the gap in the exported schema rather than dropping the filter silently. It
// adds no constraint, and decoding is unchanged.
const TRACEABILITY_DESCRIPTION = `Checked by phax's parser, not by this JSON Schema: requirement ids are unique; every acceptance criterion \`refs\` entry names an existing requirement; every requirement is referenced by at least one acceptance criterion; ${QUESTION_CHECKS_DESCRIPTION}.`;

export const SpecDocumentSchema = SpecDocumentStruct.pipe(
  Schema.filter(firstTraceabilityViolation, {
    jsonSchema: { description: TRACEABILITY_DESCRIPTION },
  }),
);

/** The document an authoring session returns: `version: 1`, then the spec. */
export type AuthoredSpecDocument = Schema.Schema.Type<typeof SpecDocumentSchema>;

// The document an authoring session returns: decoded with this contract, never through the bridge.
export const decodeSpecDocument = Schema.decodeUnknownEither(SpecDocumentSchema, {
  onExcessProperty: "error",
});

/**
 * A spec's JSON sidecar as phax persists it: `$schema` first, then the
 * document's fields, with the same traceability checks. Unlike the authoring
 * answer, it carries arbitrated questions. Unknown keys are rejected.
 */
export const SpecDocumentFileSchema = Schema.Struct({
  $schema: schemaUrlField("spec-document"),
  ...specDocumentFields,
}).pipe(
  Schema.filter(firstTraceabilityViolation, {
    jsonSchema: { description: TRACEABILITY_DESCRIPTION },
  }),
);

export type SpecDocumentFile = Schema.Schema.Type<typeof SpecDocumentFileSchema>;

export const decodeSpecDocumentFile = Schema.decodeUnknownEither(SpecDocumentFileSchema, {
  onExcessProperty: "error",
});
export const encodeSpecDocumentFile = Schema.encodeSync(SpecDocumentFileSchema);

export function getSpecDocumentJsonSchema(): object {
  return JSONSchema.make(SpecDocumentSchema);
}

/** The JSON Schema of a spec sidecar: what a decide session returns as its revised document. */
export function getSpecDocumentFileJsonSchema(): object {
  return JSONSchema.make(SpecDocumentFileSchema);
}
