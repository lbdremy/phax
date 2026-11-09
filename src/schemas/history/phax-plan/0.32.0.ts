// The frozen 0.32.0 shape of `phax-plan`: the phax-plan.json phax 0.32.0
// wrote, `$schema` first (a release pattern, not a const), phases with `mode`
// and `oracle` after `optionalFilesToEdit`, then `testLines` and `commit`, and
// the strict non-empty string. Its test lines have the loop `oracle | in-phase`,
// eight techniques and the reserved criterion words `oracle` and `in-phase`. Never
// edit this module: packages/schemas/history.lock.json pins its bytes. In phax,
// only src/schemas/persisted.ts and the tests may import it. The schemas package
// lists it as the format's 0.32.0 release. It carries its own copy of the test
// line and strict string, so a later change to src/schemas/testLine.ts or
// strictString.ts cannot move it.
import { Schema } from "effect";

const SchemaUrlSchema = Schema.String.pipe(
  Schema.pattern(
    /^https:\/\/docs\.phax\.run\/schemas\/phax-plan\/(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.json$/,
  ),
  Schema.annotations({
    description:
      "The phax-plan format's shape, named by the phax release that last changed it (not necessarily the release that wrote this file): https://docs.phax.run/schemas/phax-plan/<X.Y.Z>.json",
  }),
);

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

// ── the plan

const PhaseSchema = Schema.Struct({
  id: PhaseIdSchema,
  title: NonEmptyString,
  model: NonEmptyString,
  effort: EffortSchema,
  planMarkdownAnchor: NonEmptyString,
  plannedFilesToCreate: Schema.Array(Schema.String),
  plannedFilesToEdit: Schema.Array(Schema.String),
  optionalFilesToEdit: Schema.Array(Schema.String),
  mode: Schema.Literal("headless", "interactive"),
  oracle: Schema.NullOr(
    Schema.Struct({
      dischargedBy: PhaseIdSchema,
      files: Schema.Array(NonEmptyString),
    }),
  ),
  testLines: Schema.Array(TestLineSchema),
  commit: Schema.Struct({
    subject: NonEmptyString,
    body: NonEmptyString,
  }),
});

export const PhaxPlanV0_32_0Schema = Schema.Struct({
  $schema: SchemaUrlSchema,
  run: Schema.Struct({
    shortName: NonEmptyString,
    title: NonEmptyString,
    branch: NonEmptyString,
    requiredCommands: Schema.Array(Schema.String),
  }),
  phases: Schema.NonEmptyArray(PhaseSchema),
});

export type PhaxPlanV0_32_0 = Schema.Schema.Type<typeof PhaxPlanV0_32_0Schema>;

export const decodePhaxPlanV0_32_0 = Schema.decodeUnknownResult(PhaxPlanV0_32_0Schema, {
  onExcessProperty: "error",
});
