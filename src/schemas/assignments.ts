// The repository owner's assignment bounds: phax.json's `assignments`. Each
// bound names the files it covers (an architecture-report part, or globs), one
// model and an effort range. Decode checks the shape only; whether a bound's
// model and efforts are in the routing catalog is `boundCatalogProblems`
// (src/domain/plan/assignmentCheck.ts).
import { Schema } from "effect";
import { ArchitectureGlobSchema, GLOB_DIALECT } from "./architecture.js";
import { PlanEffortSchema } from "./phaxPlan.js";

export const EffortRangeSchema = Schema.Struct({
  min: PlanEffortSchema,
  max: PlanEffortSchema,
}).annotations({
  description:
    "The efforts a phase may take, inclusive, in the order of the bound model's catalog `efforts` list. `min` equal to `max` admits one effort.",
});

const BOUND_MODEL_DESCRIPTION =
  "The model a governed phase takes: a catalog model id, never ranked against another.";

export const PartBoundSchema = Schema.Struct({
  kind: Schema.Literal("part"),
  part: Schema.NonEmptyString.annotations({
    description:
      "The id of an architecture-report part: the bound covers the files of the part whose id this is, read from the architecture provider.",
  }),
  model: Schema.NonEmptyString.annotations({ description: BOUND_MODEL_DESCRIPTION }),
  effort: EffortRangeSchema,
});

export const GlobsBoundSchema = Schema.Struct({
  kind: Schema.Literal("globs"),
  globs: Schema.NonEmptyArray(ArchitectureGlobSchema).annotations({
    description: `The files the bound covers, as globs: ${GLOB_DIALECT}`,
  }),
  model: Schema.NonEmptyString.annotations({ description: BOUND_MODEL_DESCRIPTION }),
  effort: EffortRangeSchema,
});

export const AssignmentBoundSchema = Schema.Union(PartBoundSchema, GlobsBoundSchema);

export const AssignmentsSchema = Schema.NonEmptyArray(AssignmentBoundSchema).annotations({
  description:
    "The repository owner's assignment bounds, ordered from most to least demanding: the first bound that matches any of a phase's planned files governs it. A phase conforms when it takes the bound's model at an effort within the range; a departure needs an **Assignment reason:** line. Accepted in phax.json only.",
});

export type PartBound = Schema.Schema.Type<typeof PartBoundSchema>;
export type GlobsBound = Schema.Schema.Type<typeof GlobsBoundSchema>;
export type AssignmentBound = Schema.Schema.Type<typeof AssignmentBoundSchema>;
export type Assignments = Schema.Schema.Type<typeof AssignmentsSchema>;
