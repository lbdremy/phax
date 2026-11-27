// A run's phax home record, `<state root>/runs/<run key>/phax-home.json`: the home `phax run`
// started with and where it came from. Both fields are required; nothing else is accepted.
// phax-home.json is a run-folder file of its own, not one of the persisted formats behind
// src/schemas/persisted.ts: it carries no $schema and is decoded here only.
import { Schema } from "effect";

const RunHomeSchema = Schema.Struct({
  path: Schema.String.check(Schema.isStartingWith("/")),
  from: Schema.Literals(["PHAX_HOME", "default"]),
}).pipe(
  Schema.annotate({
    identifier: "RunHome",
    description: "The phax home a run started with, and whether PHAX_HOME or the default chose it.",
  }),
);

/** A run's recorded phax home. */
export type RunHome = Schema.Schema.Type<typeof RunHomeSchema>;

/** The record as it is read from phax-home.json: an unknown key is refused. */
export const decodeRunHome = Schema.decodeUnknownResult(RunHomeSchema, {
  onExcessProperty: "error",
});
