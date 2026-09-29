// Frozen: a run's phax-plan.json as phax wrote it with `version: 1`, the
// union of every shape written under that literal:
// - `run.backend`, phases without planned-file lists (src/schemas/phaxPlan.ts
//   at d49cf51a^);
// - `run.backend`, phases with planned-file lists (at 788604f6^);
// - no `run.backend` and no `run.requiredCommands` (at dfd6279f^);
// - `run.requiredCommands` (at 233f1f18).
// Each phase's effort is today's set, a superset of every earlier one.
// Pinned by hash in packages/schemas/history.lock.json — never edit.
// Self-contained: imports only effect, so later changes to phax's
// src/schemas cannot reach it.
import { Schema } from "effect";

const EffortSchema = Schema.Literal(
  "none",
  "off",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultracode",
  "ultra",
);

const CommitSchema = Schema.Struct({
  subject: Schema.NonEmptyString,
  body: Schema.NonEmptyString,
});

const PhaseWithoutPlannedFilesSchema = Schema.Struct({
  id: Schema.String.pipe(Schema.pattern(/^phase-\d{2}$/)),
  title: Schema.NonEmptyString,
  model: Schema.NonEmptyString,
  effort: EffortSchema,
  planMarkdownAnchor: Schema.NonEmptyString,
  commit: CommitSchema,
});

const PhaseSchema = Schema.Struct({
  id: Schema.String.pipe(Schema.pattern(/^phase-\d{2}$/)),
  title: Schema.NonEmptyString,
  model: Schema.NonEmptyString,
  effort: EffortSchema,
  planMarkdownAnchor: Schema.NonEmptyString,
  plannedFilesToCreate: Schema.Array(Schema.String),
  plannedFilesToEdit: Schema.Array(Schema.String),
  optionalFilesToEdit: Schema.Array(Schema.String),
  commit: CommitSchema,
});

const RunWithBackendSchema = Schema.Struct({
  shortName: Schema.NonEmptyString,
  title: Schema.NonEmptyString,
  branch: Schema.NonEmptyString,
  backend: Schema.NonEmptyString,
});

const PhaxPlanWithBackendSchema = Schema.Struct({
  version: Schema.Literal(1),
  run: RunWithBackendSchema,
  phases: Schema.NonEmptyArray(PhaseWithoutPlannedFilesSchema),
});

const PhaxPlanWithBackendAndPlannedFilesSchema = Schema.Struct({
  version: Schema.Literal(1),
  run: RunWithBackendSchema,
  phases: Schema.NonEmptyArray(PhaseSchema),
});

const PhaxPlanWithoutRequiredCommandsSchema = Schema.Struct({
  version: Schema.Literal(1),
  run: Schema.Struct({
    shortName: Schema.NonEmptyString,
    title: Schema.NonEmptyString,
    branch: Schema.NonEmptyString,
  }),
  phases: Schema.NonEmptyArray(PhaseSchema),
});

const PhaxPlanWithRequiredCommandsSchema = Schema.Struct({
  version: Schema.Literal(1),
  run: Schema.Struct({
    shortName: Schema.NonEmptyString,
    title: Schema.NonEmptyString,
    branch: Schema.NonEmptyString,
    requiredCommands: Schema.Array(Schema.String),
  }),
  phases: Schema.NonEmptyArray(PhaseSchema),
});

export const PhaxPlanV1Schema = Schema.Union(
  PhaxPlanWithRequiredCommandsSchema,
  PhaxPlanWithoutRequiredCommandsSchema,
  PhaxPlanWithBackendAndPlannedFilesSchema,
  PhaxPlanWithBackendSchema,
);

export type PhaxPlanV1 = Schema.Schema.Type<typeof PhaxPlanV1Schema>;

export const decodePhaxPlanV1 = Schema.decodeUnknownEither(PhaxPlanV1Schema, {
  onExcessProperty: "error",
});
