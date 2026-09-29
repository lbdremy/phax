// Frozen: the run registry (~/.phax/registry.json) as phax wrote it with
// `version: 1` (copied from src/schemas/registry.ts at 233f1f18).
// Pinned by hash in packages/schemas/history.lock.json — never edit.
// Self-contained: imports only effect, so later changes to phax's
// src/schemas cannot reach it.
import { Schema } from "effect";

const RunStateSchema = Schema.Union(
  Schema.Literal("created"),
  Schema.Literal("running"),
  Schema.Literal("failed"),
  Schema.Literal("review_open"),
  Schema.Literal("completed"),
  Schema.Literal("stopped"),
  Schema.Literal("archived"),
  Schema.Literal("interrupted"),
  Schema.Literal("rate_limited"),
);

const RegistryEntrySchema = Schema.Struct({
  namespace: Schema.NonEmptyString,
  shortName: Schema.NonEmptyString,
  runId: Schema.NonEmptyString,
  state: RunStateSchema,
  branch: Schema.NonEmptyString,
  projectName: Schema.NonEmptyString,
  phasesCount: Schema.Number,
  createdAt: Schema.NonEmptyString,
  updatedAt: Schema.NonEmptyString,
  archivePath: Schema.optionalWith(Schema.NonEmptyString, { exact: true }),
});

export const RegistryV1Schema = Schema.Struct({
  version: Schema.Literal(1),
  runs: Schema.Array(RegistryEntrySchema),
});

export type RegistryV1 = Schema.Schema.Type<typeof RegistryV1Schema>;

export const decodeRegistryV1 = Schema.decodeUnknownEither(RegistryV1Schema);
