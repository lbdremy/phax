// The frozen 0.32.0 shape of `phax-plan-extraction`: the answer the fallback
// extraction model gave for a plan.md in phax 0.32.0, `$schema` first as a
// const naming this stamp, then `plan` and `incomplete`, exactly one of them
// null. Born with `$schema`; every key is required and any other key is
// refused. Its test lines have the loop `oracle | in-phase`, eight techniques
// and the reserved criterion words `oracle` and `in-phase`. Never edit this
// module: packages/schemas/history.lock.json pins its bytes. In phax, only
// src/schemas/persisted.ts and the tests may import it; the schemas package
// lists it as the format's 0.32.0 release. It carries its own copy of the test
// line, strict string and run fields, so a later change to src/schemas/testLine.ts,
// strictString.ts or phaxPlan.ts cannot move it.
import { Schema } from "effect";

const SCHEMA_URL = "https://docs.phax.run/schemas/phax-plan-extraction/0.32.0.json";

const SchemaUrlSchema = Schema.Literal(SCHEMA_URL).annotations({
  jsonSchema: { const: SCHEMA_URL },
  description: `The phax-plan-extraction format's shape, exactly: ${SCHEMA_URL}`,
});

const NonEmptyString = Schema.String.pipe(
  Schema.pattern(/^[\s\S]+$/, {
    identifier: "NonEmptyString",
    message: (issue) => `Expected a non empty string, actual ${JSON.stringify(issue.actual)}`,
  }),
);

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

const PhaseIdSchema = Schema.String.pipe(Schema.pattern(/^phase-\d{2}$/));

// ── test lines

// No line break and no control character: C0, DEL, C1 (U+0085 among them),
// U+2028 and U+2029. Built from strings so the source holds the escapes.
const ONE_LINE_CHAR = "[^\\x00-\\x1F\\x7F-\\x9F\\u2028\\u2029]";
const ONE_LINE_EDGE = "[^\\s\\x00-\\x1F\\x7F-\\x9F\\u2028\\u2029]";
// eslint-disable-next-line no-control-regex
const ONE_LINE = new RegExp(`^${ONE_LINE_CHAR}*$`);
const ONE_LINE_TRIMMED = new RegExp(`^${ONE_LINE_EDGE}(?:${ONE_LINE_CHAR}*${ONE_LINE_EDGE})?$`);

const oneLineText = (coordinate: string) =>
  Schema.String.pipe(
    Schema.pattern(ONE_LINE_TRIMMED, {
      message: (issue) =>
        typeof issue.actual === "string" && !ONE_LINE.test(issue.actual)
          ? `a ${coordinate} is one line: no line break, U+2028, U+2029, U+0085 or other control character`
          : `a ${coordinate} is non-empty and trimmed: no leading or trailing whitespace`,
    }),
  );

const GuaranteeSchema = oneLineText("guarantee").annotations({
  description: "What the test guarantees: one non-empty, trimmed line.",
});

const ORACLE_RULES = "never holding ' — ', never starting with '— ' and never ending with ' ·'";

function oracleViolation(oracle: string): string | undefined {
  if (oracle.includes(" — ")) {
    return "an oracle never contains ' — ' (a space, an em dash, a space)";
  }
  if (oracle.startsWith("— ")) {
    return "an oracle never starts with '— ' (an em dash and a space): it would read back as another line";
  }
  if (oracle.endsWith(" ·")) {
    return "an oracle never ends with ' ·' (a space and a middle dot): it would read back as another line";
  }
  return undefined;
}

const OracleSchema = oneLineText("oracle").pipe(
  Schema.filter((oracle) => oracleViolation(oracle) ?? true, {
    jsonSchema: {
      description: `What the test compares against: one non-empty, trimmed line, ${ORACLE_RULES} (these three checked by phax, not by this JSON Schema).`,
    },
  }),
);

const LOOPS: ReadonlyArray<string> = ["oracle", "in-phase"];

const CriterionSchema = Schema.String.pipe(
  // eslint-disable-next-line no-control-regex
  Schema.pattern(/^[^\s`\x00-\x1F\x7F-\x9F]+$/, {
    message: () =>
      "a criterion is a run of non-whitespace characters holding no backtick and no control character",
  }),
  Schema.filter(
    (criterion) =>
      !LOOPS.includes(criterion) || "a criterion is neither 'oracle' nor 'in-phase', the loop values",
    {
      jsonSchema: {
        description:
          "An acceptance criterion id from the source spec's JSON sidecar: a run of non-whitespace characters, no backtick, neither 'oracle' nor 'in-phase' (that last checked by phax, not by this JSON Schema).",
      },
    },
  ),
);

const TestLineSchema = Schema.Struct({
  guarantee: GuaranteeSchema,
  size: Schema.Literal("small", "medium", "large"),
  technique: Schema.Literal(
    "example",
    "table",
    "property",
    "metamorphic",
    "stateful",
    "fuzz",
    "contract",
    "smoke",
  ),
  oracle: OracleSchema,
  loop: Schema.Literal("oracle", "in-phase"),
  criterion: Schema.NullOr(CriterionSchema),
}).annotations({
  description:
    "One test line of a phase's test strategy, rendered as `- <guarantee> — <size> · <technique> · <oracle> · <loop>[ · <criterion>]`, one per line under the phase's `### Test strategy` heading. `criterion` is an acceptance criterion id from the source spec's JSON sidecar, or null.",
});

// ── the answer

const ExtractionRunSchema = Schema.Struct({
  shortName: NonEmptyString,
  title: NonEmptyString,
  requiredCommands: Schema.Array(Schema.String),
});

const ExtractionPhaseSchema = Schema.Struct({
  id: PhaseIdSchema,
  model: NonEmptyString,
  effort: EffortSchema,
  planMarkdownAnchor: NonEmptyString,
  plannedFilesToCreate: Schema.Array(Schema.String),
  plannedFilesToEdit: Schema.Array(Schema.String),
  optionalFilesToEdit: Schema.Array(Schema.String),
  testLines: Schema.Array(TestLineSchema),
  commit: Schema.Struct({
    subject: NonEmptyString,
    body: NonEmptyString,
  }),
});

const ExtractionPlanSchema = Schema.Struct({
  run: ExtractionRunSchema,
  phases: Schema.NonEmptyArray(ExtractionPhaseSchema),
});

const EXACTLY_ONE = "plan and incomplete: exactly one of them is null";

export const PhaxPlanExtractionV0_32_0Schema = Schema.Struct({
  $schema: SchemaUrlSchema,
  plan: Schema.NullOr(ExtractionPlanSchema).annotations({
    description: "The extracted plan, or null when the plan is incomplete.",
  }),
  incomplete: Schema.NullOr(NonEmptyString).annotations({
    description:
      "What is missing from the plan, or a test strategy item not in the line format; null when the plan is extracted.",
  }),
}).pipe(
  Schema.filter((answer) => (answer.plan === null) !== (answer.incomplete === null) || EXACTLY_ONE, {
    jsonSchema: {},
    description: "Exactly one of plan and incomplete is null.",
  }),
);

export type PhaxPlanExtractionV0_32_0 = Schema.Schema.Type<typeof PhaxPlanExtractionV0_32_0Schema>;

export const decodePhaxPlanExtractionV0_32_0 = Schema.decodeUnknownEither(
  PhaxPlanExtractionV0_32_0Schema,
  { onExcessProperty: "error" },
);
