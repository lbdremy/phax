import { Schema } from "effect";

/** The options a run may set; an absent key keeps the project's own setting. */
export const RunOptions = Schema.Struct({
  model: Schema.optionalWith(Schema.String, { exact: true }),
  maxAttempts: Schema.optionalWith(Schema.Number, { exact: true }),
  labels: Schema.optionalWith(Schema.Array(Schema.String), { exact: true }),
});
