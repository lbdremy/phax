// The plan-document generator of the plan-parser properties: valid `PlanDocument` values, built by
// hand from fast-check pieces, that stay clear of every named limit of the plan.md form
// (`RENDERABLE_RULES`). A document decodes as a plan sidecar and satisfies every rule by
// construction, never through a filter, so a round trip through the renderer and the parser can
// only fail on a parser, finalize or renderer behaviour that a rule does not already name.
//
// Hand-built on purpose, not derived from the format registry: derived prose is arbitrary text,
// which breaks the Markdown it renders to. The records below are typed over every key of the
// document, so a new required key fails `pnpm test:type`; the closed vocabularies are read from
// the schemas' literals. A value the schema newly admits is generated only once a piece is
// extended (the decode check catches a value the schema stops admitting, nothing catches a
// widened domain).
import * as fc from "fast-check";
import { slugifyShortName } from "../../../src/domain/branded.js";
import { PhaseModeSchema, PlanEffortSchema } from "../../../src/schemas/phaxPlan.js";
import type {
  PlanDocument,
  PlanDocumentLineage,
  PlanDocumentPhase,
} from "../../../src/schemas/planDocument.js";
import {
  OTHER_OPTION_ID,
  type OpenQuestion,
  type PlanArbitratedQuestion,
  type PlanVerdict,
} from "../../../src/schemas/questions.js";
import {
  TEST_SIZES,
  TEST_TECHNIQUES,
  TestLoopSchema,
  type TestLine,
} from "../../../src/schemas/testLine.js";

// ---------------------------------------------------------------------------------------------
// Text: a line is built from tokens, so every adversarial piece of inline syntax occurs and every
// line has the shape the rules need (opens with a word, ends on a non-space token).
// ---------------------------------------------------------------------------------------------

// A record of ordinary objects, as JSON.parse builds them: fast-check's own `record` makes objects
// with a null prototype, which a deep-equality comparison against a parsed document refuses.
const record = <T>(model: { [K in keyof T]: fc.Arbitrary<T[K]> }): fc.Arbitrary<T> =>
  fc.record<T>(model, { noNullPrototype: true });

const WORDS = ["plain", "word", "parser", "text"] as const;

// The adversarial inline vocabulary: code spans and their parts, emphasis and link characters,
// the plan syntax that a prose field may quote (an anchor, a phase id, a phase heading, a header
// label, `(none)`), and non-ASCII and astral text. Each token is non-space at both ends.
const INLINE_TOKENS: readonly string[] = [
  ...WORDS,
  "`",
  "``",
  "`code`",
  "*",
  "**",
  "_",
  "[",
  "]",
  "<",
  ">",
  "&",
  "\\",
  "#",
  "{#x}",
  "phase-03",
  "## phase-03",
  "Recommended model:",
  "(none)",
  "é",
  "日本語",
  "😀",
];

// A phase heading ends `{#anchor}`, and the parser reads the first one it finds.
const WITHOUT_ANCHOR = INLINE_TOKENS.filter((token) => token !== "{#x}");
// An oracle never holds ` — `, and its separators are placed by `oracle` below.
const PROSE_TOKENS: readonly string[] = [...INLINE_TOKENS, "—", "·"];

// The first word of a line. Every line of root prose opens with one: no heading, quote, list,
// fence, break, indented code or HTML block can start, and no header label (`Mode:`,
// `Acceptance phase:`, …) can be quoted at a line start.
const LEADS = ["note", "check", "keep", "read", "write", "see", "plan", "run"] as const;

const separator = fc.constantFrom(" ", " ", "");

// One line opening with a word, then 0 to `maxTokens` tokens, spaced or not.
const wordLine = (tokens: readonly string[], maxTokens = 4): fc.Arbitrary<string> =>
  fc
    .tuple(
      fc.constantFrom(...LEADS),
      fc.array(fc.tuple(separator, fc.constantFrom(...tokens)), { maxLength: maxTokens }),
    )
    .map(([lead, parts]) => lead + parts.map(([sep, token]) => `${sep}${token}`).join(""));

// One line that may open and end on any token: a commit subject quotes whatever it likes.
const tokenLine = (tokens: readonly string[], maxTokens = 4): fc.Arbitrary<string> =>
  fc
    .array(fc.tuple(separator, fc.constantFrom(...tokens)), { minLength: 1, maxLength: maxTokens })
    .map((parts) => parts.map(([sep, token], i) => (i === 0 ? "" : sep) + token).join(""));

const proseLine = wordLine(PROSE_TOKENS);

// Block markers a continuation line of a list item may open with: the item's indent keeps them
// inside it, which is what `listItem` is for.
const OPENERS = ["# ", "### ", "> ", "* ", "1. ", "```", "---", "***"] as const;

const continuation = fc.oneof(
  proseLine,
  fc.tuple(fc.constantFrom(...OPENERS), proseLine).map(([opener, line]) => `${opener}${line}`),
  fc.constantFrom("---", "```", "***"),
);

// A list item: a first line, then lines that may be set off by a blank line, and that may open a
// block. Never ends on whitespace.
const listProse: fc.Arbitrary<string> = fc.oneof(
  { weight: 3, arbitrary: proseLine },
  {
    weight: 2,
    arbitrary: fc
      .tuple(
        proseLine,
        fc.array(fc.tuple(fc.constantFrom("\n", "\n\n"), continuation), {
          minLength: 1,
          maxLength: 3,
        }),
      )
      .map(([first, rest]) => first + rest.map(([glue, line]) => `${glue}${line}`).join("")),
  },
);

// Root prose: a paragraph block of one or more lines, possibly several blocks set off by blank
// lines. Every line opens with a word, so no line opens a block (`root-prose-opens-no-block`),
// and the text starts and ends on a non-space character (`commit-body-is-trimmed`).
const rootProse: fc.Arbitrary<string> = fc.oneof(
  { weight: 3, arbitrary: proseLine },
  {
    weight: 2,
    arbitrary: fc
      .tuple(
        proseLine,
        fc.array(fc.tuple(fc.constantFrom("\n", "\n\n", "\n\n\n"), proseLine), {
          minLength: 1,
          maxLength: 3,
        }),
      )
      .map(([first, rest]) => first + rest.map(([glue, line]) => `${glue}${line}`).join("")),
  },
);

// ---------------------------------------------------------------------------------------------
// Leaf pieces: paths, slugs, ids, test lines.
// ---------------------------------------------------------------------------------------------

// A canonical plan path: 1 to 3 `/`-separated segments of letters, digits, `.`, `_` and `-`, each
// opening with a character other than `.`, so none is empty, `.` or `..`.
const SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,7}$/;
const planPath = fc
  .array(fc.stringMatching(SEGMENT), { minLength: 1, maxLength: 3 })
  .map((segments) => segments.join("/"));
const planPaths = fc.array(planPath, { maxLength: 3 });

// Lowercase letters and hyphens, as an anchor's slug and a spec's slug are.
const slug = fc.stringMatching(/^[a-z]{1,8}(?:-[a-z]{1,8}){0,2}$/);

const date = fc
  .tuple(
    fc.integer({ min: 2020, max: 2030 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 28 }),
  )
  .map(([year, month, day]) => `${year}-${pad2(month)}-${pad2(day)}`);

const timestamp = fc
  .tuple(
    date,
    fc.integer({ min: 0, max: 23 }),
    fc.integer({ min: 0, max: 59 }),
    fc.integer({ min: 0, max: 59 }),
  )
  .map(([day, hour, minute, second]) => `${day}T${pad2(hour)}:${pad2(minute)}:${pad2(second)}Z`);

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

const phaseId = (index: number): string => `phase-${pad2(index + 1)}`;

// A criterion id: a run of non-space characters without a backtick, and never a reserved word,
// which its `ac-` or `q-` prefix guarantees.
const CRITERION_PIECES = [
  "a",
  "b",
  "1",
  "-",
  "_",
  "*",
  "[",
  "]",
  "<",
  ">",
  "&",
  "\\",
  "#",
  "é",
  "日",
  "😀",
];
const criterion = fc
  .tuple(
    fc.constantFrom("ac-", "q-"),
    fc.array(fc.constantFrom(...CRITERION_PIECES), { minLength: 1, maxLength: 5 }),
  )
  .map(([prefix, pieces]) => prefix + pieces.join(""));

// ` · ` may sit inside an oracle, but ` — ` may not, it may not start with `— ` and it may not end
// with ` ·`: its parts have no dash or dot token, and open and end on words or tokens.
const ORACLE_TOKENS = INLINE_TOKENS;
const oracle = fc.oneof(
  { weight: 3, arbitrary: wordLine(ORACLE_TOKENS) },
  {
    weight: 1,
    arbitrary: fc
      .tuple(wordLine(ORACLE_TOKENS), wordLine(ORACLE_TOKENS))
      .map(([first, second]) => `${first} · ${second}`),
  },
);

const testLine: fc.Arbitrary<TestLine> = record<TestLine>({
  // A guarantee may hold ` — ` and ` · `.
  guarantee: wordLine(PROSE_TOKENS),
  size: fc.constantFrom(...TEST_SIZES),
  technique: fc.constantFrom(...TEST_TECHNIQUES),
  oracle,
  loop: fc.constantFrom(...TestLoopSchema.literals),
  criterion: fc.option(criterion, { nil: null }),
});

// ---------------------------------------------------------------------------------------------
// Questions: built valid, never repaired.
// ---------------------------------------------------------------------------------------------

// An option id is never `other`, and the ids of a question are unique by position.
const OPTION_IDS = ["a", "b", "c", "d"] as const;

interface RawQuestion {
  readonly question: string;
  readonly options: ReadonlyArray<{ readonly label: string; readonly abandons: string }>;
  readonly recommended: number;
  readonly rationale: string;
}

interface RawVerdict {
  readonly kind: "lifted" | "decided";
  readonly chosen: number;
  readonly why: string;
  readonly day: string;
  readonly at: string;
  readonly advocate: string;
  readonly principles: ReadonlyArray<string>;
  readonly reversibility: "cheap" | "costly" | "irreversible";
  readonly name: string;
  readonly revised: ReadonlyArray<string>;
  readonly phase: number;
}

const rawQuestion: fc.Arbitrary<RawQuestion> = record<RawQuestion>({
  question: wordLine(PROSE_TOKENS),
  options: fc.array(record({ label: listProse, abandons: listProse }), {
    minLength: 2,
    maxLength: OPTION_IDS.length,
  }),
  recommended: fc.nat(),
  rationale: rootProse,
});

const rawVerdict: fc.Arbitrary<RawVerdict> = record<RawVerdict>({
  kind: fc.constantFrom("lifted", "decided"),
  chosen: fc.nat(),
  why: wordLine(PROSE_TOKENS),
  day: date,
  at: timestamp,
  advocate: wordLine(PROSE_TOKENS),
  principles: fc.array(wordLine(PROSE_TOKENS), { maxLength: 2 }),
  reversibility: fc.constantFrom("cheap", "costly", "irreversible"),
  name: wordLine(PROSE_TOKENS),
  revised: fc.array(wordLine(PROSE_TOKENS), { maxLength: 2 }),
  phase: fc.nat(),
});

const openQuestionOf = (raw: RawQuestion, id: string): OpenQuestion => {
  const options = raw.options.map((option, j) => ({ id: OPTION_IDS[j]!, ...option }));
  return {
    id,
    question: raw.question,
    options,
    recommendation: options[raw.recommended % options.length]!.id,
    rationale: raw.rationale,
  };
};

// A verdict chooses one of the question's options or `other`, and abandons every other option once.
const verdictOf = (
  question: OpenQuestion,
  raw: RawVerdict,
  phaseIds: ReadonlyArray<string>,
): PlanVerdict => {
  const ids = question.options.map((option) => option.id);
  const pick = raw.chosen % (ids.length + 1);
  const chosen = pick === ids.length ? OTHER_OPTION_ID : ids[pick]!;
  const abandoned = ids.filter((id) => id !== chosen);
  return raw.kind === "lifted"
    ? {
        kind: "lifted",
        chosen,
        abandoned,
        why: raw.why,
        at: raw.day,
        by: { kind: "unattributed" },
      }
    : {
        kind: "decided",
        chosen,
        abandoned,
        why: raw.why,
        advocate: raw.advocate,
        principles: raw.principles,
        reversibility: raw.reversibility,
        by: { kind: "operator", name: raw.name },
        at: raw.at,
        revised: raw.revised,
        phase: phaseIds[raw.phase % phaseIds.length]!,
      };
};

const rawArbitrated = record({
  question: rawQuestion,
  verdict: rawVerdict,
  history: fc.array(rawVerdict, { maxLength: 2 }),
});

// ---------------------------------------------------------------------------------------------
// The document: phases, preamble, run, lineage.
// ---------------------------------------------------------------------------------------------

// The models a plan names: a catalog-style id, or one generated token. The token is one run of
// non-space characters that does not end on `*` (`model-is-one-token`).
const CATALOG_MODELS = [
  "claude-sonnet-5-5",
  "claude-opus-5-5",
  "claude-haiku-5-5",
  "gpt-5.5-codex",
  "devstral-2",
] as const;
const MODEL_CHARS = [
  "a",
  "z",
  "Q",
  "0",
  "9",
  ".",
  "-",
  "_",
  ":",
  "/",
  "*",
  "[",
  "]",
  "<",
  ">",
  "&",
  "#",
  "\\",
  "é",
  "日",
  "😀",
];
const modelToken = fc
  .tuple(
    fc.array(fc.constantFrom(...MODEL_CHARS), { minLength: 1, maxLength: 8 }),
    fc.constantFrom("x", "7", "é", "."),
  )
  .map(([chars, end]) => chars.join("") + end);
const modelPiece = fc.oneof(
  { weight: 3, arbitrary: fc.constantFrom(...CATALOG_MODELS) },
  { weight: 1, arbitrary: modelToken },
);

type PhaseBody = Omit<PlanDocumentPhase, "id" | "planMarkdownAnchor" | "acceptance">;

// A phase title holds no `{#`: the heading ends `{#anchor}`. It may span lines and open or end
// on whitespace: the renderer's `headingText` folds it onto the heading line and trims it, and the
// round trip holds the title finalize reads back to that folded form. The folding is a renderer
// limit, `phase-title-folds-onto-its-heading` in docs/property-tests.md, not a renderable rule:
// the folded title reads back, so no document is kept out of the round trip for it.
const phaseTitle = fc
  .tuple(
    fc.constantFrom("", " ", "\n"),
    wordLine(WITHOUT_ANCHOR),
    fc.array(fc.tuple(fc.constantFrom("\n", " \n "), wordLine(WITHOUT_ANCHOR)), { maxLength: 2 }),
    fc.constantFrom("", " ", "\n"),
  )
  .map(
    ([lead, first, rest, end]) =>
      lead + first + rest.map(([glue, line]) => `${glue}${line}`).join("") + end,
  );

const phaseBody: fc.Arbitrary<PhaseBody> = record<PhaseBody>({
  title: phaseTitle,
  objective: rootProse,
  detailedInstructions: fc.array(listProse, { maxLength: 3 }),
  plannedFilesToCreate: planPaths,
  plannedFilesToEdit: planPaths,
  optionalFilesToEdit: planPaths,
  mode: fc.constantFrom(...PhaseModeSchema.literals),
  boundaryContracts: fc.option(rootProse, { nil: null }),
  testStrategy: fc.array(testLine, { maxLength: 3 }),
  implementationOrder: fc.array(listProse, { maxLength: 3 }),
  excludedScope: fc.array(listProse, { maxLength: 3 }),
  verification: rootProse,
  expectedHandoff: rootProse,
  // A subject is one line of single spaces, which it may open and end with any token.
  commit: record({ subject: tokenLine(PROSE_TOKENS), body: rootProse }),
  // One line: it sits in the header paragraph, where a blank line would end the header.
  assignmentReason: fc.option(wordLine(PROSE_TOKENS), { nil: null }),
  model: modelPiece,
  effort: fc.constantFrom(...PlanEffortSchema.literals),
});

interface RawPhase {
  readonly body: PhaseBody;
  readonly slug: string;
  // The phase that passes the acceptance tests, as a position (taken modulo the plan's length).
  readonly acceptance: {
    readonly passedBy: number;
    readonly files: ReadonlyArray<string>;
  } | null;
}

const rawPhase: fc.Arbitrary<RawPhase> = record<RawPhase>({
  body: phaseBody,
  slug,
  acceptance: fc.option(record({ passedBy: fc.nat(), files: planPaths }), { nil: null }),
});

type PreambleBody = Omit<PlanDocument["preamble"], "openQuestions" | "arbitratedQuestions">;

const preambleBody: fc.Arbitrary<PreambleBody> = record<PreambleBody>({
  summary: rootProse,
  requiredCommandsNote: rootProse,
  technicalArbitrations: fc.array(listProse, { maxLength: 3 }),
});

// A command opens with a word and ends on a non-space token, so it is a trimmed line and never
// the lone item `(none)` (`required-command-is-a-trimmed-line`).
const commandList = fc.array(wordLine(PROSE_TOKENS), { maxLength: 3 });

// A gate profile id from a small fixed set: a run of non-whitespace characters without a backtick.
const gateProfileId = fc.constantFrom("standard", "light", "full", "ci-gate.v2");

// The short name slugifies to what the title does: the slug itself, or the title (`slugifyShortName`
// of both sides is what finalize compares).
const runPiece = fc
  .tuple(wordLine(INLINE_TOKENS), fc.boolean(), commandList, gateProfileId)
  .map(([title, slugged, commands, gateProfile]): PlanDocument["run"] => ({
    shortName: slugged ? slugifyShortName(title) : title,
    title,
    requiredCommands: commands,
    gateProfile,
  }));

type LineageBody = PlanDocumentLineage;

const lineage: fc.Arbitrary<LineageBody> = fc.oneof(
  fc.tuple(date, slug, fc.boolean()).map(([day, name, completesSpec]): LineageBody => ({
    sourceSpec: `docs/specs/${day}-${name}.md`,
    completesSpec,
  })),
  fc.constant<LineageBody>({ sourceSpec: null, completesSpec: null }),
);

// What the top level holds besides the pieces above.
type DocumentRest = Omit<PlanDocument, keyof LineageBody | "run" | "preamble" | "phases">;
const documentRest: fc.Arbitrary<DocumentRest> = record<DocumentRest>({
  kind: fc.constant("plan" as const),
});

interface Pieces {
  readonly rest: DocumentRest;
  readonly run: PlanDocument["run"];
  readonly preamble: PreambleBody;
  readonly open: ReadonlyArray<RawQuestion>;
  readonly arbitrated: ReadonlyArray<{
    readonly question: RawQuestion;
    readonly verdict: RawVerdict;
    readonly history: ReadonlyArray<RawVerdict>;
  }>;
  readonly first: RawPhase;
  readonly more: ReadonlyArray<RawPhase>;
  readonly lineage: LineageBody;
}

const assemble = (pieces: Pieces): PlanDocument => {
  const rawPhases = [pieces.first, ...pieces.more];
  const ids = rawPhases.map((_, i) => phaseId(i));
  const phaseOf = (raw: RawPhase, i: number): PlanDocumentPhase => ({
    ...raw.body,
    id: ids[i]!,
    planMarkdownAnchor: `#${ids[i]!}-${raw.slug}`,
    acceptance:
      raw.acceptance === null
        ? null
        : { passedBy: ids[raw.acceptance.passedBy % ids.length]!, files: raw.acceptance.files },
  });
  const phases: [PlanDocumentPhase, ...PlanDocumentPhase[]] = [
    phaseOf(pieces.first, 0),
    ...pieces.more.map((raw, i) => phaseOf(raw, i + 1)),
  ];
  const openQuestions = pieces.open.map((raw, i) => openQuestionOf(raw, `q-open-${i + 1}`));
  const arbitratedQuestions = pieces.arbitrated.map((raw, i): PlanArbitratedQuestion => {
    const question = openQuestionOf(raw.question, `q-decided-${i + 1}`);
    return {
      ...question,
      verdict: verdictOf(question, raw.verdict, ids),
      history: raw.history.map((earlier) => verdictOf(question, earlier, ids)),
    };
  });
  return {
    ...pieces.rest,
    ...pieces.lineage,
    run: pieces.run,
    preamble: { ...pieces.preamble, openQuestions, arbitratedQuestions },
    phases,
  };
};

/**
 * Valid plan documents: 1 to 4 phases in order from `phase-01`, every variant of the format, and
 * prose that quotes the plan.md syntax. Each decodes as a plan sidecar once stamped, and satisfies
 * every `RENDERABLE_RULES` rule.
 */
export const planDocuments = (): fc.Arbitrary<PlanDocument> =>
  record<Pieces>({
    rest: documentRest,
    run: runPiece,
    preamble: preambleBody,
    open: fc.array(rawQuestion, { maxLength: 2 }),
    arbitrated: fc.array(rawArbitrated, { maxLength: 2 }),
    first: rawPhase,
    more: fc.array(rawPhase, { maxLength: 3 }),
    lineage,
  }).map(assemble);

// ---------------------------------------------------------------------------------------------
// The limits of the plan.md form.
// ---------------------------------------------------------------------------------------------

interface RenderableRule {
  readonly name: string;
  /** The parser, finalize or renderer behaviour that the plan.md form cannot get past. */
  readonly reason: string;
  readonly holds: (doc: PlanDocument) => boolean;
}

const isOneTrimmedLine = (text: string): boolean =>
  text.length > 0 && text === text.trim() && !/[\r\n]/.test(text);

// A line that opens a block of its own at the root: an indented code block, an ATX heading, a
// thematic break or a setext underline, a fence, an HTML block, a block quote or a list item.
const BLOCK_OPENERS: readonly RegExp[] = [
  /^(?: {4}|\t)/,
  /^ {0,3}#{1,6}(?:[ \t]|$)/,
  /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/,
  /^ {0,3}(?:=+|-+)[ \t]*$/,
  /^ {0,3}(?:`{3,}|~{3,})/,
  /^ {0,3}</,
  /^ {0,3}>/,
  /^ {0,3}(?:[-+*]|\d{1,9}[.)])(?:[ \t]|$)/,
];

const opensNoBlock = (text: string): boolean =>
  text.split(/\r\n?|\n/).every((line) => !BLOCK_OPENERS.some((opener) => opener.test(line)));

// The prose `renderPlanBody` emits as root blocks, as given.
const rootProseOf = (doc: PlanDocument): ReadonlyArray<string> => [
  doc.preamble.summary,
  doc.preamble.requiredCommandsNote,
  ...doc.phases.flatMap((phase) => [
    phase.objective,
    ...(phase.boundaryContracts === null ? [] : [phase.boundaryContracts]),
    phase.verification,
    phase.expectedHandoff,
    phase.commit.body,
  ]),
];

/**
 * What the plan.md form cannot carry, one rule each. A document that breaks a rule is not a
 * parser's to read back: the round trip is checked over documents that satisfy every rule.
 */
export const RENDERABLE_RULES: ReadonlyArray<RenderableRule> = [
  {
    name: "short-name-is-the-title-slug",
    reason:
      "the parser takes the run short name from the H1 title, and finalize slugifies both sides with slugifyShortName",
    holds: ({ run: { shortName, title } }) =>
      slugifyShortName(title) !== "" && slugifyShortName(shortName) === slugifyShortName(title),
  },
  {
    name: "run-title-is-one-trimmed-line",
    reason:
      "the renderer's headingText folds line breaks to a space and trims, and the H1 is one line",
    holds: (doc) => isOneTrimmedLine(doc.run.title),
  },
  {
    name: "model-is-one-token",
    reason:
      "readRecommendedFields reads the model as one run of non-space characters and strips trailing `*`",
    holds: ({ phases }) =>
      phases.every((phase) => /^\S+$/.test(phase.model) && !phase.model.endsWith("*")),
  },
  {
    name: "anchor-fits-its-braces",
    reason:
      "the heading writes the anchor as `{#…}`, and the parser reads up to the first `}` and trims it",
    holds: ({ phases }) =>
      phases.every(({ planMarkdownAnchor }) => /^[^\s}]+$/.test(planMarkdownAnchor)),
  },
  {
    name: "phase-title-holds-no-anchor",
    reason:
      "the parser reads the first `{#…}` of the phase heading as the anchor, and finalize's parsePhaseTitles reads the title before the last one",
    holds: ({ phases }) => phases.every(({ title }) => !title.includes("{#")),
  },
  {
    name: "phase-title-has-text",
    reason:
      "the renderer's headingText trims a blank title to nothing, and finalize's parsePhaseTitles then finds no title in the heading",
    holds: ({ phases }) => phases.every(({ title }) => /\S/.test(title)),
  },
  {
    name: "root-prose-opens-no-block",
    reason:
      "a root prose line that opens a heading, break, fence, code, HTML, quote or list block changes the block structure that the parser walks",
    holds: (doc) => rootProseOf(doc).every(opensNoBlock),
  },
  {
    name: "commit-body-is-trimmed",
    reason: "extractCommitBody reads the source slice of the section and trims it",
    holds: ({ phases }) => phases.every(({ commit }) => commit.body === commit.body.trim()),
  },
  {
    name: "commit-subject-is-one-line-of-single-spaces",
    reason: "extractCommitSubject folds every whitespace run to one space and trims",
    holds: ({ phases }) =>
      phases.every(
        ({ commit }) => isOneTrimmedLine(commit.subject) && !/\s{2}|[^\S ]/.test(commit.subject),
      ),
  },
  {
    name: "required-command-is-a-trimmed-line",
    reason:
      "extractRequiredCommands reads each item's flattened text trimmed, drops an empty one and reads a lone `(none)` as no command",
    holds: ({ run: { requiredCommands: commands } }) =>
      commands.every(isOneTrimmedLine) &&
      !(commands.length === 1 && /^\(?none\)?$/i.test(commands[0]!)),
  },
];
