// The frozen 0.38.0 shape of `phax-plan`: the phax-plan.json phax 0.38.0 to
// 0.42.x wrote, `$schema` first (a release pattern, not a const), phases with
// `mode` and `acceptance` after `optionalFilesToEdit`, then `testLines` and
// `commit`, and the strict non-empty string. Its file lists hold canonical plan
// paths only. Its run declares no gate profile. Its test lines have the loop
// `acceptance | in-phase`, nine techniques and the reserved criterion words
// `acceptance`, `in-phase` and `oracle`. Never edit this module:
// packages/schemas/history.lock.json pins its bytes. In phax, only
// src/schemas/persisted.ts and the tests may import it. The schemas package
// lists it as the format's 0.38.0 release. It carries its own copy of the plan
// path rule, the test line and the strict string, so a later change to
// src/domain/plan/planPath.ts, src/schemas/planPath.ts, testLine.ts,
// strictString.ts or phaxPlan.ts cannot move it.
import { Schema } from "effect";

// `Schema.isPattern` whose JSON Schema is the RegExp's source, whatever its
// flags: Effect 4 exports a pattern only for a RegExp with the `u` flag.
function isExportedPattern(regExp: RegExp, annotations?: Schema.Annotations.Filter) {
  return Schema.isPattern(regExp, {
    toJsonSchema: () => ({ pattern: regExp.source }),
    ...annotations,
  });
}

// phax's own refusal text for a refused value, computed from it. The annotation key is the
// one src/schemas/refusal/adapter.ts reads, written out here because a frozen module imports
// only effect.
const refusalMessage = (message: (actual: unknown) => string) => ({
  phaxRefusalMessage: message,
});

const SchemaUrlSchema = Schema.String.check(
  isExportedPattern(
    /^https:\/\/docs\.phax\.run\/schemas\/phax-plan\/(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.json$/,
  ),
).pipe(
  Schema.annotate({
    description:
      "The phax-plan format's shape, named by the phax release that last changed it (not necessarily the release that wrote this file): https://docs.phax.run/schemas/phax-plan/<X.Y.Z>.json",
  }),
);

const NonEmptyString = Schema.String.check(
  isExportedPattern(/^[\s\S]+$/, {
    identifier: "NonEmptyString",
    // The pattern refuses the empty string alone, so the refused value is always "".
    message: 'Expected a non empty string, actual ""',
  }),
);

const EffortSchema = Schema.Literals([
  "none",
  "off",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultracode",
  "ultra",
]);

const PhaseIdSchema = Schema.String.check(isExportedPattern(/^phase-\d{2}$/));

// ── plan paths

type UnplannableReason = "empty" | "absolute" | "leaves-repository" | "directory" | "backslash";

type PlanPathReading =
  | { readonly kind: "canonical"; readonly path: string }
  | { readonly kind: "rewritable"; readonly written: string; readonly canonical: string }
  | { readonly kind: "unplannable"; readonly written: string; readonly reason: UnplannableReason };

function readPlanPath(written: string): PlanPathReading {
  const unplannable = (reason: UnplannableReason): PlanPathReading => ({
    kind: "unplannable",
    written,
    reason,
  });
  if (written === "") return unplannable("empty");
  if (written.includes("\\")) return unplannable("backslash");
  if (written.startsWith("/")) return unplannable("absolute");
  const kept: string[] = [];
  for (const segment of written.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (kept.length === 0) return unplannable("leaves-repository");
      kept.pop();
      continue;
    }
    kept.push(segment);
  }
  if (kept.length === 0) return unplannable("empty");
  if (written.endsWith("/")) return unplannable("directory");
  const canonical = kept.join("/");
  return canonical === written
    ? { kind: "canonical", path: written }
    : { kind: "rewritable", written, canonical };
}

const UNPLANNABLE: Readonly<Record<UnplannableReason, string>> = {
  empty: "is empty",
  absolute: "is absolute",
  "leaves-repository": "leaves the repository",
  directory: "names a directory",
  backslash: "contains a backslash",
};

function describePlanPathProblem(
  reading: Exclude<PlanPathReading, { kind: "canonical" }>,
): string {
  return reading.kind === "rewritable"
    ? `is not canonical: write ${JSON.stringify(reading.canonical)}`
    : UNPLANNABLE[reading.reason];
}

const SEGMENT = "(?:[^/\\\\.][^/\\\\]*|\\.[^/\\\\.][^/\\\\]*|\\.\\.[^/\\\\]+)";

const PLAN_PATH_PATTERN = `^${SEGMENT}(?:/${SEGMENT})*$`;

const PLAN_PATH_DESCRIPTION =
  "A file path relative to the repository root, in canonical form: `/` separators, no empty, `.` or `..` segment, no leading or trailing `/`, no backslash, e.g. `src/widget.ts`. phax refuses any other spelling, naming the canonical one when it exists.";

const PlanPath = Schema.String.check(
  Schema.makeFilter(
    (written: string) => {
      const reading = readPlanPath(written);
      return reading.kind === "canonical" ? true : describePlanPathProblem(reading);
    },
    {
      description: PLAN_PATH_DESCRIPTION,
      toJsonSchema: () => ({ pattern: PLAN_PATH_PATTERN }),
      ...refusalMessage((actual) => {
        if (typeof actual !== "string") return "a plan path is a string";
        const reading = readPlanPath(actual);
        return reading.kind === "canonical" ? "" : describePlanPathProblem(reading);
      }),
    },
  ),
);

// ── test lines

// No line break and no control character: C0, DEL, C1 (U+0085 among them),
// U+2028 and U+2029. Built from strings so the source holds the escapes.
const CONTROL = "\\x00-\\x1F\\x7F-\\x9F";
const ONE_LINE_CHAR = `[^${CONTROL}\\u2028\\u2029]`;
const ONE_LINE_EDGE = `[^\\s${CONTROL}\\u2028\\u2029]`;
const ONE_LINE = new RegExp(`^${ONE_LINE_CHAR}*$`);
const ONE_LINE_TRIMMED = new RegExp(`^${ONE_LINE_EDGE}(?:${ONE_LINE_CHAR}*${ONE_LINE_EDGE})?$`);

const oneLineText = (coordinate: string) =>
  Schema.String.check(
    isExportedPattern(
      ONE_LINE_TRIMMED,
      refusalMessage((actual) =>
        typeof actual === "string" && !ONE_LINE.test(actual)
          ? `a ${coordinate} is one line: no line break, U+2028, U+2029, U+0085 or other control character`
          : `a ${coordinate} is non-empty and trimmed: no leading or trailing whitespace`,
      ),
    ),
  );

const GuaranteeSchema = oneLineText("guarantee").annotate({
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

const OracleSchema = oneLineText("oracle").check(
  Schema.makeFilter((oracle) => oracleViolation(oracle) ?? true, {
    description: `What the test compares against: one non-empty, trimmed line, ${ORACLE_RULES} (these three checked by phax, not by this JSON Schema).`,
    toJsonSchema: () => ({}),
  }),
);

const RESERVED_CRITERIA: ReadonlyArray<string> = ["acceptance", "in-phase", "oracle"];

const CriterionSchema = Schema.String.check(
  isExportedPattern(new RegExp(`^[^\\s\`${CONTROL}]+$`), {
    message:
      "a criterion is a run of non-whitespace characters holding no backtick and no control character",
  }),
  Schema.makeFilter(
    (criterion: string) =>
      !RESERVED_CRITERIA.includes(criterion) ||
      "a criterion is neither 'acceptance', 'in-phase' nor 'oracle'",
    {
      description:
        "An acceptance criterion id from the source spec's JSON sidecar: a run of non-whitespace characters, no backtick, neither 'acceptance', 'in-phase' nor 'oracle' (that last checked by phax, not by this JSON Schema).",
      toJsonSchema: () => ({}),
    },
  ),
);

const TestLineSchema = Schema.Struct({
  guarantee: GuaranteeSchema,
  size: Schema.Literals(["small", "medium", "large"]),
  technique: Schema.Literals([
    "example",
    "boundary",
    "table",
    "property",
    "metamorphic",
    "stateful",
    "fuzz",
    "contract",
    "smoke",
  ]),
  oracle: OracleSchema,
  loop: Schema.Literals(["acceptance", "in-phase"]),
  criterion: Schema.NullOr(CriterionSchema),
}).annotate({
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
  plannedFilesToCreate: Schema.Array(PlanPath),
  plannedFilesToEdit: Schema.Array(PlanPath),
  optionalFilesToEdit: Schema.Array(PlanPath),
  mode: Schema.Literals(["headless", "interactive"]),
  acceptance: Schema.NullOr(
    Schema.Struct({
      passedBy: PhaseIdSchema,
      files: Schema.Array(NonEmptyString),
    }),
  ),
  testLines: Schema.Array(TestLineSchema),
  commit: Schema.Struct({
    subject: NonEmptyString,
    body: NonEmptyString,
  }),
});

export const PhaxPlanV0_38_0Schema = Schema.Struct({
  $schema: SchemaUrlSchema,
  run: Schema.Struct({
    shortName: NonEmptyString,
    title: NonEmptyString,
    branch: NonEmptyString,
    requiredCommands: Schema.Array(Schema.String),
  }),
  phases: Schema.NonEmptyArray(PhaseSchema),
});

export type PhaxPlanV0_38_0 = Schema.Schema.Type<typeof PhaxPlanV0_38_0Schema>;

export const decodePhaxPlanV0_38_0 = Schema.decodeUnknownResult(PhaxPlanV0_38_0Schema, {
  onExcessProperty: "error",
  reportInput: true,
});
