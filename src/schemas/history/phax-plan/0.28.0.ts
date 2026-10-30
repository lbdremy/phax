// The frozen 0.28.0 shape of `phax-plan`: the phax-plan.json phax 0.28.0 to
// 0.31.0 wrote, `$schema` first, phases with `mode` and `oracle` after
// `optionalFilesToEdit`, then `testLines` (their rules as lookahead patterns)
// and `commit`, and Effect's `NonEmptyString`. Never edit this module:
// packages/schemas/history.lock.json pins its bytes. In phax, only
// src/schemas/persisted.ts may import it. The schemas package lists it as the
// format's 0.28.0 release. It carries its own copy of the test line, so a later
// change to src/schemas/testLine.ts cannot move it.
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

// No line break and no control character: C0, DEL, C1 (U+0085 among them),
// U+2028 and U+2029.
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

const PhaseSchema = Schema.Struct({
  id: PhaseIdSchema,
  title: Schema.NonEmptyString,
  model: Schema.NonEmptyString,
  effort: EffortSchema,
  planMarkdownAnchor: Schema.NonEmptyString,
  plannedFilesToCreate: Schema.Array(Schema.String),
  plannedFilesToEdit: Schema.Array(Schema.String),
  optionalFilesToEdit: Schema.Array(Schema.String),
  mode: Schema.Literal("headless", "interactive"),
  oracle: Schema.NullOr(
    Schema.Struct({
      dischargedBy: PhaseIdSchema,
      files: Schema.Array(Schema.NonEmptyString),
    }),
  ),
  testLines: Schema.Array(TestLineSchema),
  commit: Schema.Struct({
    subject: Schema.NonEmptyString,
    body: Schema.NonEmptyString,
  }),
});

export const PhaxPlanV0_28_0Schema = Schema.Struct({
  $schema: SchemaUrlSchema,
  run: Schema.Struct({
    shortName: Schema.NonEmptyString,
    title: Schema.NonEmptyString,
    branch: Schema.NonEmptyString,
    requiredCommands: Schema.Array(Schema.String),
  }),
  phases: Schema.NonEmptyArray(PhaseSchema),
});

export type PhaxPlanV0_28_0 = Schema.Schema.Type<typeof PhaxPlanV0_28_0Schema>;

export const decodePhaxPlanV0_28_0 = Schema.decodeUnknownEither(PhaxPlanV0_28_0Schema, {
  onExcessProperty: "error",
});
