// A test line: one guarantee of a phase's test strategy, placed on the four
// closed coordinates of the phax-planning skill (size, technique, oracle,
// loop) and an optional acceptance criterion id. The plan document carries a
// phase's test strategy as a list of them. Imports only `effect`, because the
// schemas package publishes it. The text coordinates are refined with one
// lookaround-free pattern each, so the exported JSON Schema states what a
// provider's strict structured output accepts; the rules a pattern would need a
// lookaround for (the oracle's three, the criterion's reserved words) are
// filters phax checks, with their messages. The grammar that renders and reads
// a line is src/domain/plan/testLineGrammar.ts.
import { Schema } from "effect";

export const TestSizeSchema = Schema.Literal("small", "medium", "large");
export const TestTechniqueSchema = Schema.Literal(
  "example",
  "table",
  "property",
  "metamorphic",
  "stateful",
  "fuzz",
  "contract",
  "smoke",
);
export const TestLoopSchema = Schema.Literal("oracle", "in-phase");

export type TestSize = Schema.Schema.Type<typeof TestSizeSchema>;
export type TestTechnique = Schema.Schema.Type<typeof TestTechniqueSchema>;
export type TestLoop = Schema.Schema.Type<typeof TestLoopSchema>;

/** The closed values, in the skill's order, read from the literals. */
export const TEST_SIZES: ReadonlyArray<TestSize> = TestSizeSchema.literals;
export const TEST_TECHNIQUES: ReadonlyArray<TestTechnique> = TestTechniqueSchema.literals;
export const TEST_LOOPS: ReadonlyArray<TestLoop> = TestLoopSchema.literals;

// No line break and no control character: C0, DEL, C1 (U+0085 among them),
// U+2028 and U+2029. Built from strings so the source holds the escapes.
const ONE_LINE_CHAR = "[^\\x00-\\x1F\\x7F-\\x9F\\u2028\\u2029]";
// Such a char that is also not whitespace: a trimmed line's first and last.
const ONE_LINE_EDGE = "[^\\s\\x00-\\x1F\\x7F-\\x9F\\u2028\\u2029]";
// eslint-disable-next-line no-control-regex
const ONE_LINE = new RegExp(`^${ONE_LINE_CHAR}*$`);
// One non-empty, trimmed line, without lookaround (a provider's strict
// structured output refuses one): an edge char, then optionally any one-line
// chars and a closing edge char.
const ONE_LINE_TRIMMED = new RegExp(`^${ONE_LINE_EDGE}(?:${ONE_LINE_CHAR}*${ONE_LINE_EDGE})?$`);

// One pattern for both halves; its message names the half the value breaks.
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

// The oracle's three reading rules, checked by phax rather than by a pattern:
// the first one broken, in a fixed order. After the ` · ` before it, a leading
// `— ` renders as ` — `, which reads back as the guarantee's end when a size and
// a technique follow it.
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

// The filter's JSON Schema description is the one the field renders with.
const OracleSchema = oneLineText("oracle").pipe(
  Schema.filter((oracle) => oracleViolation(oracle) ?? true, {
    jsonSchema: {
      description: `What the test compares against: one non-empty, trimmed line, ${ORACLE_RULES} (these three checked by phax, not by this JSON Schema).`,
    },
  }),
);

const CriterionSchema = Schema.String.pipe(
  // eslint-disable-next-line no-control-regex
  Schema.pattern(/^[^\s`\x00-\x1F\x7F-\x9F]+$/, {
    message: () =>
      "a criterion is a run of non-whitespace characters holding no backtick and no control character",
  }),
  Schema.filter(
    (criterion) =>
      !TEST_LOOPS.includes(criterion as TestLoop) ||
      "a criterion is neither 'oracle' nor 'in-phase', the loop values",
    {
      jsonSchema: {
        description:
          "An acceptance criterion id from the source spec's JSON sidecar: a run of non-whitespace characters, no backtick, neither 'oracle' nor 'in-phase' (that last checked by phax, not by this JSON Schema).",
      },
    },
  ),
);

export const TestLineSchema = Schema.Struct({
  guarantee: GuaranteeSchema,
  size: TestSizeSchema,
  technique: TestTechniqueSchema,
  oracle: OracleSchema,
  loop: TestLoopSchema,
  criterion: Schema.NullOr(CriterionSchema),
}).annotations({
  description:
    "One test line of a phase's test strategy, rendered as `- <guarantee> — <size> · <technique> · <oracle> · <loop>[ · <criterion>]`, one per line under the phase's `### Test strategy` heading. `criterion` is an acceptance criterion id from the source spec's JSON sidecar, or null.",
});

export type TestLine = Schema.Schema.Type<typeof TestLineSchema>;
