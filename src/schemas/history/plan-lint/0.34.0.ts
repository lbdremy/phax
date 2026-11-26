// The frozen 0.34.0 shape of `plan-lint`: the answer of `phax plans lint
// --json` phax 0.34.0 through 0.42.x printed, never saved. `$schema` first,
// then `plan` and `findings`; a finding's `check` is one of the eight checks of
// those releases, without `gate-profile`. Every key is required and any other
// key is refused. Never edit this module: packages/schemas/history.lock.json
// pins its bytes. In phax, only the tests may import it. The schemas package
// lists it as the format's 0.34.0 release.
import { Schema } from "effect";

// `Schema.isPattern` whose JSON Schema is the RegExp's source, whatever its
// flags: Effect 4 exports a pattern only for a RegExp with the `u` flag.
function isExportedPattern(regExp: RegExp, annotations?: Schema.Annotations.Filter) {
  return Schema.isPattern(regExp, {
    toJsonSchema: () => ({ pattern: regExp.source }),
    ...annotations,
  });
}

const strictKeys = { parseOptions: { onExcessProperty: "error" } } as const;

const SchemaUrlSchema = Schema.String.check(
  isExportedPattern(
    /^https:\/\/docs\.phax\.run\/schemas\/plan-lint\/(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.json$/,
  ),
).pipe(
  Schema.annotate({
    description:
      "The plan-lint format's shape, named by the phax release that last changed it (not necessarily the release that wrote this file): https://docs.phax.run/schemas/plan-lint/<X.Y.Z>.json",
  }),
);

const FindingSchema = Schema.Struct({
  severity: Schema.Literals(["error", "warning"]).annotate({
    description: "An error makes `phax plans lint` exit 1.",
  }),
  check: Schema.Literals([
    "structure",
    "files",
    "commands",
    "models",
    "interactive",
    "acceptance",
    "tests",
    "advisory",
  ]),
  phase: Schema.NullOr(Schema.String).annotate({
    description: "The phase id the finding names, or null for a finding about the whole plan.",
  }),
  message: Schema.String,
}).annotate(strictKeys);

export const PlanLintV0_34_0Schema = Schema.Struct({
  $schema: SchemaUrlSchema,
  plan: Schema.String.annotate({ description: "The plan path as the caller typed it." }),
  findings: Schema.Array(FindingSchema),
}).annotate(strictKeys);

export type PlanLintV0_34_0 = Schema.Schema.Type<typeof PlanLintV0_34_0Schema>;

export const decodePlanLintV0_34_0 = Schema.decodeUnknownResult(PlanLintV0_34_0Schema, {
  onExcessProperty: "error",
  reportInput: true,
});
