// The frozen pre-schema shape of `spec-document`: exactly what phax wrote
// before it wrote `$schema`. Never edit this module:
// packages/schemas/history.lock.json pins its bytes. In phax, only
// src/schemas/persisted.ts may import it. The schemas package re-exports its
// schema and type.
import { Schema } from "effect";

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

type SpecDocumentStructType = Schema.Schema.Type<typeof SpecDocumentStruct>;

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

// The traceability checks, in a fixed order so the first violation reported
// for a given document is stable.
function firstTraceabilityViolation(doc: SpecDocumentStructType): Violation | undefined {
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

const TRACEABILITY_DESCRIPTION =
  "Checked by phax's parser, not by this JSON Schema: requirement ids, question ids and each question's option ids are unique; every acceptance criterion `refs` entry names an existing requirement; every requirement is referenced by at least one acceptance criterion; and each open question's `recommendation` names one of its options.";

export const SpecDocumentPreSchemaSchema = SpecDocumentStruct.pipe(
  Schema.filter(firstTraceabilityViolation, {
    jsonSchema: { description: TRACEABILITY_DESCRIPTION },
  }),
);

export type SpecDocumentPreSchema = Schema.Schema.Type<typeof SpecDocumentPreSchemaSchema>;

export const decodeSpecDocumentPreSchema = Schema.decodeUnknownEither(SpecDocumentPreSchemaSchema, {
  onExcessProperty: "error",
});
