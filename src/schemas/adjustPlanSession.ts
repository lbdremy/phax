import { Schema } from "effect";
import { ProviderIdSchema } from "./providerId.js";

export const AdjustPlanSessionSchema = Schema.Struct({
  version: Schema.Literal(1),
  planPath: Schema.NonEmptyString,
  landedRunKey: Schema.NonEmptyString,
  provider: ProviderIdSchema,
  sessionId: Schema.NonEmptyString,
  cwd: Schema.NonEmptyString,
  createdAt: Schema.NonEmptyString,
  updatedAt: Schema.NonEmptyString,
});

export type AdjustPlanSession = Schema.Schema.Type<typeof AdjustPlanSessionSchema>;

export const decodeAdjustPlanSession = Schema.decodeUnknownEither(AdjustPlanSessionSchema, {
  onExcessProperty: "error",
});

export const encodeAdjustPlanSession = Schema.encodeSync(AdjustPlanSessionSchema);
