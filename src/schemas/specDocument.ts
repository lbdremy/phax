import { JSONSchema, Schema } from "effect";

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

// `Schema.String` rather than `NonEmptyString` under the pattern: the prefix
// already rules out the empty string, and a `$ref`-plus-`pattern` pair in the
// exported JSON Schema would have its pattern ignored by draft-07 validators.
const SurfaceElementSchema = Schema.Struct({
  surface: Schema.String.pipe(Schema.pattern(/^(cli|config|file|api|package|internal): /)),
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

const QuestionOptionSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  label: Schema.NonEmptyString,
  abandons: Schema.NonEmptyString,
});

const OpenQuestionSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  question: Schema.NonEmptyString,
  options: Schema.Array(QuestionOptionSchema).pipe(Schema.minItems(2)),
  recommendation: Schema.NonEmptyString,
  rationale: Schema.NonEmptyString,
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

const SpecDocumentStruct = Schema.Struct({
  version: Schema.Literal(1),
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
  planningNote: PlanningNoteSchema,
  docsPage: DocsPageSchema,
}).annotations({ title: "phax spec document (experimental)" });

type SpecDocumentShape = Schema.Schema.Type<typeof SpecDocumentStruct>;

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
// `acceptanceCriteria[2].refs[0]: "5.9" names no requirement`.
function firstTraceabilityViolation(doc: SpecDocumentShape): Violation | undefined {
  const duplicateRequirement = firstDuplicateId(doc.requirements, ["requirements"], "requirement");
  if (duplicateRequirement !== undefined) return duplicateRequirement;

  const duplicateQuestion = firstDuplicateId(doc.openQuestions, ["openQuestions"], "question");
  if (duplicateQuestion !== undefined) return duplicateQuestion;

  for (const [q, question] of doc.openQuestions.entries()) {
    const duplicateOption = firstDuplicateId(
      question.options,
      ["openQuestions", q, "options"],
      "option",
    );
    if (duplicateOption !== undefined) return duplicateOption;
  }

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

  for (const [q, question] of doc.openQuestions.entries()) {
    const optionIds = question.options.map((o) => o.id);
    if (!optionIds.includes(question.recommendation)) {
      return {
        path: ["openQuestions", q, "recommendation"],
        message: `"${question.recommendation}" names none of the question's options (${optionIds.join(", ")})`,
      };
    }
  }

  return undefined;
}

export const SpecDocumentSchema = SpecDocumentStruct.pipe(
  Schema.filter(firstTraceabilityViolation),
);

export type SpecDocument = Schema.Schema.Type<typeof SpecDocumentSchema>;

export const decodeSpecDocument = Schema.decodeUnknownEither(SpecDocumentSchema, {
  onExcessProperty: "error",
});

export function getSpecDocumentJsonSchema(): object {
  return JSONSchema.make(SpecDocumentSchema);
}
