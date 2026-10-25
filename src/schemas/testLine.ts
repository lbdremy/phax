// A test line: one guarantee of a phase's test strategy, placed on the four
// closed coordinates of the phax-planning skill (size, technique, oracle,
// loop) and an optional acceptance criterion id. The plan document carries a
// phase's test strategy as a list of them. Imports only `effect`, because the
// schemas package publishes it. The text coordinates are refined with
// patterns, so the exported JSON Schema states what the decoder refuses; the
// grammar that renders and reads a line is src/domain/plan/testLineGrammar.ts.
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
// U+2028 and U+2029. Built from a string so the source holds the escapes.
// eslint-disable-next-line no-control-regex
const ONE_LINE = new RegExp("^[^\\x00-\\x1F\\x7F-\\x9F\\u2028\\u2029]*$");
// Neither starts nor ends with whitespace.
const TRIMMED = /^(?!\s)[\s\S]*\S$/;

const oneLineText = (coordinate: string) =>
  Schema.String.pipe(
    Schema.pattern(ONE_LINE, {
      message: () =>
        `a ${coordinate} is one line: no line break, U+2028, U+2029, U+0085 or other control character`,
    }),
    Schema.pattern(TRIMMED, {
      message: () => `a ${coordinate} is non-empty and trimmed: no leading or trailing whitespace`,
    }),
  );

const GuaranteeSchema = oneLineText("guarantee").annotations({
  description: "What the test guarantees: one non-empty, trimmed line.",
});

const OracleSchema = oneLineText("oracle").pipe(
  Schema.pattern(/^(?![\s\S]* — )/, {
    message: () => "an oracle never contains ' — ' (a space, an em dash, a space)",
  }),
  // After the ` · ` before it, a leading `— ` renders as ` — `, which reads
  // back as the guarantee's end when a size and a technique follow it.
  Schema.pattern(/^(?!— )/, {
    message: () =>
      "an oracle never starts with '— ' (an em dash and a space): it would read back as another line",
  }),
  Schema.pattern(/^(?![\s\S]* ·$)/, {
    message: () =>
      "an oracle never ends with ' ·' (a space and a middle dot): it would read back as another line",
  }),
  Schema.annotations({
    description:
      "What the test compares against: one non-empty, trimmed line, never holding ' — ', never starting with '— ' and never ending with ' ·'.",
  }),
);

const CriterionSchema = Schema.String.pipe(
  // eslint-disable-next-line no-control-regex
  Schema.pattern(/^[^\s`\x00-\x1F\x7F-\x9F]+$/, {
    message: () =>
      "a criterion is a run of non-whitespace characters holding no backtick and no control character",
  }),
  Schema.pattern(/^(?!(?:oracle|in-phase)$)/, {
    message: () => "a criterion is neither 'oracle' nor 'in-phase', the loop values",
  }),
  Schema.annotations({
    description:
      "An acceptance criterion id from the source spec's JSON sidecar: a run of non-whitespace characters, no backtick, neither 'oracle' nor 'in-phase'.",
  }),
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
