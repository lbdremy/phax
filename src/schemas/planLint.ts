// The `plan-lint` document: what `phax plans lint <plan> --json` prints,
// never saved. Born at 0.34.0 with `$schema`, then exactly the fields of
// phax's lint report in their order (src/app/lintPlan.ts, whose type
// tests/type/schemasPackage.ts holds equal to this one); every key is
// required and any other key is refused. Imports only `effect` and schema
// modules, because the schemas package publishes it.
import { Schema } from "effect";
import { schemaUrlField } from "./schemaUrl.js";

const strictKeys = { parseOptions: { onExcessProperty: "error" } } as const;

const FindingSchema = Schema.Struct({
  severity: Schema.Literal("error", "warning").annotations({
    description: "An error makes `phax plans lint` exit 1.",
  }),
  check: Schema.Literal(
    "structure",
    "files",
    "commands",
    "models",
    "interactive",
    "acceptance",
    "tests",
    "advisory",
  ),
  phase: Schema.NullOr(Schema.String).annotations({
    description: "The phase id the finding names, or null for a finding about the whole plan.",
  }),
  message: Schema.String,
}).annotations(strictKeys);

/** A `plan-lint` document: the answer of `phax plans lint --json`. */
export const PlanLintFileSchema = Schema.Struct({
  $schema: schemaUrlField("plan-lint"),
  plan: Schema.String.annotations({ description: "The plan path as the caller typed it." }),
  findings: Schema.Array(FindingSchema),
}).annotations(strictKeys);

export type PlanLintFile = Schema.Schema.Type<typeof PlanLintFileSchema>;
/** A lint report without `$schema`. */
export type PlanLintDocument = Omit<PlanLintFile, "$schema">;

export const decodePlanLintFile = Schema.decodeUnknownEither(PlanLintFileSchema, {
  onExcessProperty: "error",
});

export const encodePlanLintFile = Schema.encodeSync(PlanLintFileSchema);
