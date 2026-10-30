import { posix } from "node:path";
import { Either, ParseResult } from "effect";
import type { HandDecisionAnswer } from "../../schemas/handDecisionAnswer.js";
import {
  decodeCurrentDecideVerdicts,
  decodeCurrentDocumentSidecar,
  decodeCurrentHandDecisionAnswer,
} from "../../schemas/persisted.js";
import { OTHER_OPTION_ID } from "../../schemas/questions.js";
import { CURRENT_STAMPS } from "../../schemas/release.js";
import { parseSchemaUrl, schemaUrl } from "../../schemas/schemaUrl.js";
import type { ParsedHandQuestions } from "../artifact/questions.js";
import type { SidecarDocument } from "../artifact/sidecar.js";
import type { ArtifactKind } from "../artifact/status.js";
import {
  handAnswerStampViolation,
  firstHandAnswerViolation,
  writeHandDecisions,
} from "./handAuthored.js";
import {
  KEPT_FIELDS,
  answerStampViolation,
  arraysOf,
  firstDifference,
  firstParseIssue,
  isObject,
  locate,
  questionsOf,
  refusal,
  sameJson,
  sameOrder,
  sameQuestionSet,
  unchanged,
  withoutQuestions,
  type DecideQuestions,
  type RevisionRefusal,
} from "./revision.js";

// The pure contract of `phax artifact decide <artifact> --verdicts`: reading a
// verdicts file, binding it to the artifact's questions, and checking the
// writer session's transcription of it. The use case reads the file, spawns
// the session and writes; this module only decides. The oracles in
// tests/unit/decide/verdicts.test.ts and tests/unit/decide/transcription.test.ts
// pin the types and signatures below.

/** One verdict as the file gives it: the option chosen and the person's note. */
export type GivenVerdict = {
  readonly question: string;
  readonly chosen: string;
  readonly note: string | null;
};

/** A decoded verdicts file, without its `$schema`. */
export type VerdictsFile = {
  readonly artifact: string;
  readonly verdicts: readonly GivenVerdict[];
};

/** Why a verdicts file is refused: a path into the file (`""` at the root) and what is wrong there. */
export type VerdictsRefusal = { readonly path: string; readonly message: string };

const VERDICTS_FORMAT = "decide-verdicts";

// Why a verdicts file's `$schema` is not the current shape, or undefined.
function verdictsStampViolation(json: Record<string, unknown>): string | undefined {
  const reads = schemaUrl(VERDICTS_FORMAT, CURRENT_STAMPS[VERDICTS_FORMAT]);
  if (!Object.hasOwn(json, "$schema")) return `the file carries no $schema — phax reads ${reads}`;
  const read = json["$schema"];
  const named = parseSchemaUrl(read);
  if (named === undefined) {
    return `$schema ${JSON.stringify(read)} is not a phax schema URL — phax reads ${reads}`;
  }
  if (named.formatId !== VERDICTS_FORMAT) {
    return `$schema ${String(read)} names ${named.formatId}, not ${VERDICTS_FORMAT} — phax reads ${reads}`;
  }
  if (named.release !== CURRENT_STAMPS[VERDICTS_FORMAT]) {
    return `$schema ${String(read)} names ${VERDICTS_FORMAT} ${named.release}, not its current shape — phax reads ${reads}`;
  }
  return undefined;
}

/**
 * A verdicts file's text as a decoded file, or the first refusal: text that is
 * not JSON (path `""`), a missing `$schema` (path `$schema`, saying there is
 * none and naming the URL phax reads), a `$schema` naming another format or
 * release than the current `decide-verdicts` stamp (path `$schema`, quoting
 * the URL read and the URL phax reads), an empty `verdicts` list (path
 * `verdicts`), or the first decoder violation with its path rendered like
 * `verdicts[0].note`.
 */
export function parseVerdictsFile(text: string): Either.Either<VerdictsFile, VerdictsRefusal> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return Either.left({
      path: "",
      message: error instanceof Error ? error.message : String(error),
    });
  }
  const reads = schemaUrl(VERDICTS_FORMAT, CURRENT_STAMPS[VERDICTS_FORMAT]);
  if (!isObject(json)) {
    return Either.left({
      path: "",
      message: `the file is not a JSON object — phax reads ${reads}`,
    });
  }
  const stampViolation = verdictsStampViolation(json);
  if (stampViolation !== undefined)
    return Either.left({ path: "$schema", message: stampViolation });
  const given = json["verdicts"];
  if (Array.isArray(given) && given.length === 0) {
    return Either.left({
      path: "verdicts",
      message: "the list is empty — give at least one verdict",
    });
  }
  return Either.mapLeft(decodeCurrentDecideVerdicts(json), firstParseIssue);
}

/**
 * How a question's current verdict departed from its recommendation, as a
 * verdict returning to the recommendation must answer for it: `revised` when
 * it named the body sections it revised, `unrevised` when it named none, and
 * `unrecorded` when it records none — a lifted verdict, or a hand-authored
 * Decision block, whose `Revised:` text phax does not read.
 */
type Departure = "revised" | "unrevised" | "unrecorded";

/**
 * What a verdict is bound against: a question's id, its state, its option
 * ids, its recommendation and its rationale. For a hand-authored artifact,
 * `rationale` is the parser's whole rationale: the Recommendation line's text
 * after `<id> — ` plus its continuation paragraphs, up to the `Decision:`
 * line or the next block, joined with a blank line.
 */
export type QuestionFacts = {
  readonly id: string;
  readonly state: "open" | "arbitrated";
  readonly optionIds: readonly string[];
  readonly recommendation: string;
  readonly rationale: string;
  /**
   * How its current verdict departed from the recommendation; `null` for an
   * open question, and for an arbitrated one whose verdict follows it.
   */
  readonly departed: Departure | null;
};

type QuestionLike = {
  readonly id: string;
  readonly recommendation: string;
  readonly rationale: string;
};

function factsOf(
  state: QuestionFacts["state"],
  question: QuestionLike & {
    readonly options?: ReadonlyArray<{ readonly id: string }>;
    readonly optionIds?: readonly string[];
  },
  departed: Departure | null,
): QuestionFacts {
  return {
    id: question.id,
    state,
    optionIds: question.optionIds ?? (question.options ?? []).map((o) => o.id),
    recommendation: question.recommendation,
    rationale: question.rationale,
    departed,
  };
}

type ArbitratedQuestion = DecideQuestions["arbitratedQuestions"][number];

// How a headless question's current verdict departed: a decided verdict
// names what it revised; a lifted one records nothing.
function departureOf(question: ArbitratedQuestion): Departure | null {
  const { verdict } = question;
  if (verdict.chosen === question.recommendation) return null;
  if (verdict.kind !== "decided") return "unrecorded";
  return verdict.revised.length > 0 ? "revised" : "unrevised";
}

/** The questions of a headless document: the open ones, then the arbitrated ones, each in document order. */
export function questionFactsOfDocument(sidecar: SidecarDocument): readonly QuestionFacts[] {
  const { openQuestions, arbitratedQuestions } = questionsOf(sidecar);
  return [
    ...openQuestions.map((q) => factsOf("open", q, null)),
    ...arbitratedQuestions.map((q) => factsOf("arbitrated", q, departureOf(q))),
  ];
}

/**
 * The questions of a hand-authored artifact's §9 sections: the open ones, then
 * the arbitrated ones, each in document order. `[]` for sections holding no
 * question; an artifact with no §9 section at all is not parsed and has no
 * facts to give. A Decision block's revised sections are not read: a
 * departing one is `unrecorded`.
 */
export function questionFactsOfHand(parsed: ParsedHandQuestions): readonly QuestionFacts[] {
  return [
    ...parsed.open.map((q) => factsOf("open", q, null)),
    ...parsed.arbitrated.map((q) =>
      factsOf("arbitrated", q, q.chosen === q.recommendation ? null : "unrecorded"),
    ),
  ];
}

/** A given verdict bound to its question. */
export type BoundVerdict = {
  readonly question: string;
  readonly state: "open" | "arbitrated";
  readonly chosen: string;
  readonly note: string | null;
  readonly recommendation: string;
  /** `chosen` differs from the recommendation; `other` always does. */
  readonly departs: boolean;
  /** The note verbatim, or the question's rationale when the note is null. */
  readonly why: string;
  /**
   * A verdict that chooses the recommendation of a question whose current
   * verdict departed restores it, and owes the body what that departure did:
   * `revised` — it names the sections it restores, as the departure named
   * those it revised; `unrevised` — the departure revised nothing, so it
   * revises nothing; `unrecorded` — the departure records no revised
   * sections, so it may revise or not. `null` for every other verdict.
   */
  readonly restores: Departure | null;
};

/** The verdicts of a file bound to an artifact, and the open questions it leaves out. */
export type BoundVerdicts = {
  /** In the artifact's document order, never the file's. */
  readonly verdicts: readonly BoundVerdict[];
  /** The ids of the open questions the file does not name, in document order. */
  readonly open: readonly string[];
};

function namesAnotherArtifact(given: string, artifactPath: string): boolean {
  if (posix.isAbsolute(given)) return true;
  const normalized = posix.normalize(given);
  return normalized === ".." || normalized.startsWith("../") || normalized !== artifactPath;
}

function optionsText(optionIds: readonly string[]): string {
  return optionIds.length === 0
    ? OTHER_OPTION_ID
    : `${optionIds.join(", ")}, or ${OTHER_OPTION_ID}`;
}

/**
 * A verdicts file bound to the artifact's questions, or why it cannot be. The
 * message carries no `Decide refused:` prefix. Checked in this order, and each
 * names:
 * 1. a different artifact: both paths;
 * 2. an unknown question: the artifact's question ids;
 * 3. a question named twice: that id;
 * 4. a chosen id neither listed nor `other`: the question's option ids and `other`;
 * 5. a departing verdict, `other` included, with a null note: the question and its recommendation;
 * 6. a verdict with a null note on a question whose rationale is empty, so
 *    nothing could stand as its `why`: the question, and the note to give.
 */
export function bindVerdicts(input: {
  readonly file: VerdictsFile;
  readonly artifactPath: string;
  readonly questions: readonly QuestionFacts[];
  readonly label: string;
}): Either.Either<BoundVerdicts, string> {
  const { file, artifactPath, questions, label } = input;
  if (namesAnotherArtifact(file.artifact, artifactPath)) {
    return Either.left(
      `${label} is for the artifact ${file.artifact}, not ${artifactPath} — a verdicts file names the artifact it is decided for`,
    );
  }
  const byId = new Map(questions.map((q) => [q.id, q]));
  for (const { question } of file.verdicts) {
    if (!byId.has(question)) {
      const ids = questions.map((q) => q.id);
      return Either.left(
        `${label} names ${question}, which is no question of the artifact — its questions are ${ids.join(", ") || "none"}`,
      );
    }
  }
  const seen = new Set<string>();
  for (const { question } of file.verdicts) {
    if (seen.has(question)) return Either.left(`${label} names ${question} twice`);
    seen.add(question);
  }
  const given = new Map(file.verdicts.map((v) => [v.question, v]));
  for (const { question, chosen } of file.verdicts) {
    const facts = byId.get(question);
    if (facts !== undefined && chosen !== OTHER_OPTION_ID && !facts.optionIds.includes(chosen)) {
      return Either.left(
        `${label} chooses ${chosen} for ${question} — its options: ${optionsText(facts.optionIds)}`,
      );
    }
  }
  const verdicts: BoundVerdict[] = [];
  for (const facts of questions) {
    const verdict = given.get(facts.id);
    if (verdict === undefined) continue;
    const departs = verdict.chosen !== facts.recommendation;
    if (departs && verdict.note === null) {
      return Either.left(
        `${label} chooses ${verdict.chosen} for ${facts.id}, which departs from its recommendation ${facts.recommendation}, with no note — a departing verdict needs a note`,
      );
    }
    if (verdict.note === null && facts.rationale.trim().length === 0) {
      return Either.left(
        `${label} gives ${facts.id} no note, and ${facts.id} has no rationale to stand as its why — give the verdict a note, or write the question's rationale`,
      );
    }
    verdicts.push({
      question: facts.id,
      state: facts.state,
      chosen: verdict.chosen,
      note: verdict.note,
      recommendation: facts.recommendation,
      departs,
      why: verdict.note ?? facts.rationale,
      restores: departs ? null : facts.departed,
    });
  }
  const open = questions.filter((q) => q.state === "open" && !given.has(q.id)).map((q) => q.id);
  return Either.right({ verdicts, open });
}

/** A verdict as it landed in the document, with who set it. */
export type TranscribedVerdict = {
  readonly question: string;
  readonly chosen: string;
  readonly recommendation: string;
  readonly departs: boolean;
  readonly why: string;
  readonly revised: readonly string[];
  readonly by: { readonly kind: "operator"; readonly name: string };
};

// A verdict with `why`, `by` and `at` set by phax; a non-object or `lifted`
// verdict is left for the decoder and the checks to refuse by name.
function stampedVerdict(
  verdict: unknown,
  bound: BoundVerdict,
  operator: { readonly name: string },
  atIso: string,
): unknown {
  if (!isObject(verdict) || verdict["kind"] === "lifted") return verdict;
  return { ...verdict, why: bound.why, by: { kind: "operator", name: operator.name }, at: atIso };
}

function stampEntries(
  value: unknown,
  boundById: ReadonlyMap<string, BoundVerdict>,
  operator: { readonly name: string },
  atIso: string,
): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((entry: unknown) => {
    if (!isObject(entry) || typeof entry["id"] !== "string") return entry;
    const bound = boundById.get(entry["id"]);
    if (bound === undefined) return entry;
    return { ...entry, verdict: stampedVerdict(entry["verdict"], bound, operator, atIso) };
  });
}

function stampDocument(
  json: unknown,
  original: SidecarDocument,
  boundById: ReadonlyMap<string, BoundVerdict>,
  operator: { readonly name: string },
  atIso: string,
): unknown {
  if (!isObject(json)) return json;
  const stamp = (value: unknown) => stampEntries(value, boundById, operator, atIso);
  if (original.kind === "spec") {
    return Object.hasOwn(json, "arbitratedQuestions")
      ? { ...json, arbitratedQuestions: stamp(json["arbitratedQuestions"]) }
      : json;
  }
  const preamble = json["preamble"];
  const stamped =
    isObject(preamble) && Object.hasOwn(preamble, "arbitratedQuestions")
      ? {
          ...json,
          preamble: { ...preamble, arbitratedQuestions: stamp(preamble["arbitratedQuestions"]) },
        }
      : json;
  return {
    ...stamped,
    sourceSpec: original.document.sourceSpec,
    completesSpec: original.document.completesSpec,
  };
}

function boundOf(bound: BoundVerdicts): ReadonlyMap<string, BoundVerdict> {
  return new Map(bound.verdicts.map((v) => [v.question, v]));
}

function operatorBy(operator: { readonly name: string }) {
  return { kind: "operator", name: operator.name } as const;
}

function unlistedPrinciple(id: string, principleIds: ReadonlySet<string>): string {
  const loaded = [...principleIds];
  return `"${id}" is no principle id of the loaded doctrine (${loaded.length === 0 ? "none" : loaded.join(", ")})`;
}

/**
 * Why a landed verdict's `revised` breaks what its bound verdict owes the
 * body, or undefined: a departing verdict names the sections it revised; a
 * restoring one names the sections it restores after a departure that
 * revised some, and none after a departure that revised none, and may do
 * either after one that records none; any other following verdict names none.
 */
function revisedViolation(given: BoundVerdict, revised: readonly string[]): string | undefined {
  if (given.departs) {
    return revised.length === 0
      ? `"${given.chosen}" departs from the recommendation "${given.recommendation}": name the body sections it revised`
      : undefined;
  }
  switch (given.restores) {
    case "revised":
      return revised.length === 0
        ? `"${given.chosen}" restores the recommendation after a verdict that departed and revised the body: name the body sections it restores`
        : undefined;
    case "unrevised":
      return revised.length > 0
        ? `"${given.chosen}" restores the recommendation after a verdict that departed and revised nothing: its revised is []`
        : undefined;
    case "unrecorded":
      return undefined;
    case null:
      return revised.length > 0
        ? `"${given.chosen}" follows the recommendation: its revised is []`
        : undefined;
  }
}

function firstTranscriptionViolation(input: {
  readonly original: SidecarDocument;
  readonly revised: SidecarDocument;
  readonly bound: BoundVerdicts;
  readonly principleIds: ReadonlySet<string>;
}): RevisionRefusal | undefined {
  const { original, revised, bound, principleIds } = input;
  const named = boundOf(bound);
  const before = arraysOf(original);
  const after = arraysOf(revised);

  const setViolation = sameQuestionSet(before, after);
  if (setViolation !== undefined) return setViolation;

  const afterOpen = locate(after.openQuestions, [...after.basePath, "openQuestions"]);
  const afterArbitrated = locate(after.arbitratedQuestions, [
    ...after.basePath,
    "arbitratedQuestions",
  ]);

  for (const question of before.openQuestions) {
    const stillOpen = afterOpen.get(question.id);
    if (named.has(question.id)) {
      if (stillOpen !== undefined) {
        return refusal(
          [...stillOpen.path, "id"],
          `"${question.id}" is named in the verdicts file: it is arbitrated`,
        );
      }
      continue;
    }
    if (stillOpen === undefined) {
      const moved = afterArbitrated.get(question.id);
      return refusal(
        moved === undefined ? [...after.basePath, "arbitratedQuestions"] : [...moved.path, "id"],
        `"${question.id}" is not named in the verdicts file: it stays open`,
      );
    }
    const violation = unchanged(
      question,
      stillOpen.question,
      stillOpen.path,
      `"${question.id}" is not named in the verdicts file: it stays as it was`,
    );
    if (violation !== undefined) return violation;
  }
  const openOrder = sameOrder(
    before.openQuestions,
    after.openQuestions,
    after.basePath,
    "openQuestions",
  );
  if (openOrder !== undefined) return openOrder;

  for (const question of before.arbitratedQuestions) {
    const stillArbitrated = afterArbitrated.get(question.id);
    if (stillArbitrated === undefined) {
      const reopened = afterOpen.get(question.id);
      return refusal(
        reopened === undefined ? [...after.basePath, "openQuestions"] : [...reopened.path, "id"],
        `"${question.id}" is arbitrated: it stays in arbitratedQuestions`,
      );
    }
    if (named.has(question.id)) continue;
    const violation = unchanged(
      question,
      stillArbitrated.question,
      stillArbitrated.path,
      `"${question.id}" is arbitrated and not named in the verdicts file: it stays as it was`,
    );
    if (violation !== undefined) return violation;
  }
  const arbitratedOrder = sameOrder(
    before.arbitratedQuestions,
    after.arbitratedQuestions,
    after.basePath,
    "arbitratedQuestions",
  );
  if (arbitratedOrder !== undefined) return arbitratedOrder;

  const beforeOpen = locate(before.openQuestions, []);
  const beforeArbitrated = locate(before.arbitratedQuestions, []);
  for (const given of bound.verdicts) {
    const landed = afterArbitrated.get(given.question);
    if (landed === undefined) continue;
    const { question, path } = landed;
    const earlierOpen = beforeOpen.get(given.question)?.question;
    const earlierArbitrated = beforeArbitrated.get(given.question)?.question;
    const earlier = earlierOpen ?? earlierArbitrated;
    if (earlier === undefined) continue;
    const optionIds = earlier.options.map((o) => o.id);
    for (const field of KEPT_FIELDS) {
      const violation = unchanged(
        earlier[field],
        question[field],
        [...path, field],
        field === "options"
          ? `a decided question keeps its options (${optionIds.join(", ")})`
          : `a decided question keeps its ${field}`,
      );
      if (violation !== undefined) return violation;
    }
    const { verdict } = question;
    if (verdict.kind !== "decided") {
      return refusal(
        [...path, "verdict", "kind"],
        `"${question.id}" was decided from the verdicts file: its verdict is decided, never lifted`,
      );
    }
    if (verdict.chosen !== given.chosen) {
      return refusal(
        [...path, "verdict", "chosen"],
        `"${verdict.chosen}" is not "${given.chosen}", the option the verdicts file gives for "${question.id}" (its options: ${optionsText(optionIds)})`,
      );
    }
    const expectedAbandoned = optionIds.filter((id) => id !== given.chosen);
    if (
      verdict.abandoned.length !== expectedAbandoned.length ||
      !expectedAbandoned.every((id) => verdict.abandoned.includes(id))
    ) {
      return refusal(
        [...path, "verdict", "abandoned"],
        `a verdict abandons every listed option it does not choose (${expectedAbandoned.join(", ") || "none"})`,
      );
    }
    const expectedHistory =
      earlierArbitrated === undefined
        ? []
        : [...earlierArbitrated.history, earlierArbitrated.verdict];
    if (!sameJson(question.history, expectedHistory)) {
      return refusal(
        [...path, "history"],
        earlierArbitrated === undefined
          ? `"${question.id}" was open: its history is []`
          : `"${question.id}" was re-arbitrated: its history is its earlier history, then its previous verdict`,
      );
    }
  }

  for (const given of bound.verdicts) {
    const landed = afterArbitrated.get(given.question);
    if (landed === undefined || landed.question.verdict.kind !== "decided") continue;
    for (const [i, id] of landed.question.verdict.principles.entries()) {
      if (!principleIds.has(id)) {
        return refusal(
          [...landed.path, "verdict", "principles", i],
          unlistedPrinciple(id, principleIds),
        );
      }
    }
  }

  let revisesBody = false;
  for (const given of bound.verdicts) {
    const landed = afterArbitrated.get(given.question);
    if (landed === undefined || landed.question.verdict.kind !== "decided") continue;
    const { revised: sections } = landed.question.verdict;
    const violation = revisedViolation(given, sections);
    if (violation !== undefined) {
      return refusal([...landed.path, "verdict", "revised"], violation);
    }
    if (sections.length > 0) revisesBody = true;
  }

  if (!revisesBody) {
    const differs = firstDifference(withoutQuestions(original), withoutQuestions(revised), []);
    if (differs !== undefined) {
      return refusal(
        differs,
        "no verdict of the file departs from its recommendation, or restores it with revised sections: the body stays as it was",
      );
    }
  }
  return undefined;
}

// The first question whose options the answer changed, named with the
// options it keeps. Checked on the answer as given, before the decoder: its
// question checks would otherwise refuse an added option by a side effect,
// such as a history verdict whose `abandoned` misses it.
function changedOptions(original: SidecarDocument, answer: unknown): RevisionRefusal | undefined {
  if (!isObject(answer)) return undefined;
  const before = arraysOf(original);
  const holder = original.kind === "spec" ? answer : answer["preamble"];
  if (!isObject(holder)) return undefined;
  const kept = new Map(
    [...before.openQuestions, ...before.arbitratedQuestions].map((q) => [q.id, q.options]),
  );
  for (const key of ["openQuestions", "arbitratedQuestions"] as const) {
    const entries: unknown = holder[key];
    if (!Array.isArray(entries)) continue;
    for (const [i, entry] of (entries as unknown[]).entries()) {
      if (!isObject(entry) || typeof entry["id"] !== "string") continue;
      const options = kept.get(entry["id"]);
      if (options === undefined || sameJson(entry["options"], options)) continue;
      return refusal(
        [...before.basePath, key, i, "options"],
        `"${entry["id"]}" keeps its options (${options.map((o) => o.id).join(", ")}) exactly: never add, drop or change one — a choice off the list is \`${OTHER_OPTION_ID}\``,
      );
    }
  }
  return undefined;
}

/**
 * A writer's answer for a headless document as a checked document, or the
 * first refusal, with the landed verdicts in document order. Before decoding,
 * phax overwrites `why` (from the bound verdict), `by` and `at` on each named
 * question's verdict and restores a plan's `sourceSpec` and `completesSpec`.
 * The answer is then refused unless it is stamped with the document format's
 * current shape, keeps every question's options exactly (checked before the
 * decoder, naming the question and its options), and passes the
 * current-shape decoder (question checks, traceability, a plan verdict's
 * phase), and:
 * - the question set is unchanged;
 * - every named question is arbitrated with a decided verdict whose `chosen`
 *   is the given one, `other` included, and whose `abandoned` is every other
 *   listed option;
 * - every question keeps its id, question, options, recommendation and rationale;
 * - a named question that was open has history `[]`; one that was arbitrated
 *   has its earlier history followed by its previous verdict, even when the
 *   new choice equals the old one;
 * - every unnamed question is unchanged and keeps its place;
 * - cited principles are loaded ids;
 * - a departing verdict names a non-empty `revised`; a restoring verdict
 *   (`BoundVerdict.restores`) names a non-empty one after a departure that
 *   revised sections, `[]` after one that revised none, either after one that
 *   records none; any other following verdict has `revised: []` — each
 *   refused at that verdict's `revised` path;
 * - when no landed verdict names a revised section, every field outside the
 *   two question arrays is unchanged.
 */
export function checkTranscription(input: {
  readonly original: SidecarDocument;
  readonly answer: unknown;
  readonly bound: BoundVerdicts;
  readonly operator: { readonly name: string };
  readonly atIso: string;
  readonly principleIds: ReadonlySet<string>;
}): Either.Either<
  { readonly document: SidecarDocument; readonly verdicts: readonly TranscribedVerdict[] },
  RevisionRefusal
> {
  const { original, answer, bound, operator, atIso, principleIds } = input;
  const stampViolation = answerStampViolation(original.kind, answer);
  if (stampViolation !== undefined) {
    return Either.left({ path: isObject(answer) ? "$schema" : "", message: stampViolation });
  }
  const optionsViolation = changedOptions(original, answer);
  if (optionsViolation !== undefined) return Either.left(optionsViolation);
  const decoded = Either.mapLeft(
    decodeCurrentDocumentSidecar(
      original.kind,
      stampDocument(answer, original, boundOf(bound), operator, atIso),
    ),
    firstParseIssue,
  );
  if (Either.isLeft(decoded)) return Either.left(decoded.left);
  const revised: SidecarDocument = decoded.right;
  const violation = firstTranscriptionViolation({ original, revised, bound, principleIds });
  if (violation !== undefined) return Either.left(violation);

  const landed = new Map(arraysOf(revised).arbitratedQuestions.map((q) => [q.id, q.verdict]));
  const verdicts = bound.verdicts.flatMap((given): TranscribedVerdict[] => {
    const verdict = landed.get(given.question);
    if (verdict === undefined || verdict.kind !== "decided") return [];
    return [
      {
        question: given.question,
        chosen: verdict.chosen,
        recommendation: given.recommendation,
        departs: given.departs,
        why: verdict.why,
        revised: verdict.revised,
        by: operatorBy(operator),
      },
    ];
  });
  return Either.right({ document: revised, verdicts });
}

function stampHandAnswer(
  json: unknown,
  boundById: ReadonlyMap<string, BoundVerdict>,
  operator: { readonly name: string },
  atIso: string,
): unknown {
  if (!isObject(json) || !Array.isArray(json["decisions"])) return json;
  return { ...json, decisions: stampEntries(json["decisions"], boundById, operator, atIso) };
}

/**
 * A writer's answer for a hand-authored artifact, checked the same way: its
 * decisions are exactly the named questions, each once, each `revised` as its
 * bound verdict owes the body (a restore of a hand-authored departure, which
 * records no revised sections, may revise or not); its frontmatter, question
 * sections and decision log are returned unchanged; and when every decision
 * has `revised: []` its markdown equals the artifact's. On success `md` is the
 * artifact's Markdown with the decisions written in place (each named block
 * moved to the arbitrated section with its Decision block, one decision-log
 * entry per verdict), and `answer` is the decoded answer with `why`, `by` and
 * `at` set by phax.
 */
export function checkHandTranscription(input: {
  readonly kind: ArtifactKind;
  readonly md: string;
  readonly parsed: ParsedHandQuestions;
  readonly answer: unknown;
  readonly bound: BoundVerdicts;
  readonly operator: { readonly name: string };
  readonly atIso: string;
  readonly principleIds: ReadonlySet<string>;
  readonly phaseIds: readonly string[];
}): Either.Either<
  {
    readonly answer: HandDecisionAnswer;
    readonly md: string;
    readonly verdicts: readonly TranscribedVerdict[];
  },
  RevisionRefusal
> {
  const { kind, md, parsed, answer, bound, operator, atIso } = input;
  const stampViolation = handAnswerStampViolation(answer, kind);
  if (stampViolation !== undefined) {
    return Either.left({ path: isObject(answer) ? "$schema" : "", message: stampViolation });
  }
  const named = boundOf(bound);
  const decoded = Either.mapLeft(
    decodeCurrentHandDecisionAnswer(stampHandAnswer(answer, named, operator, atIso), kind),
    (error: ParseResult.ParseError) => firstParseIssue(error),
  );
  if (Either.isLeft(decoded)) return Either.left(decoded.left);
  const handAnswer = decoded.right;

  for (const [i, { id, verdict }] of handAnswer.decisions.entries()) {
    const given = named.get(id);
    if (given === undefined) {
      return Either.left(
        refusal(["decisions", i, "id"], `"${id}" is not named in the verdicts file`),
      );
    }
    if (verdict.chosen !== given.chosen) {
      return Either.left(
        refusal(
          ["decisions", i, "verdict", "chosen"],
          `"${verdict.chosen}" is not "${given.chosen}", the option the verdicts file gives for "${id}"`,
        ),
      );
    }
    const revisedRefusal = revisedViolation(given, verdict.revised);
    if (revisedRefusal !== undefined) {
      return Either.left(refusal(["decisions", i, "verdict", "revised"], revisedRefusal));
    }
  }
  for (const { question } of bound.verdicts) {
    if (!handAnswer.decisions.some(({ id }) => id === question)) {
      return Either.left(
        refusal(["decisions"], `"${question}" is named in the verdicts file: decide it`),
      );
    }
  }

  const violation = firstHandAnswerViolation({
    kind,
    md,
    parsed,
    answer: handAnswer,
    scope: { presented: bound.verdicts.map((v) => v.question), reArbitrated: null },
    principleIds: input.principleIds,
    phaseIds: input.phaseIds,
  });
  if (violation !== undefined) return Either.left(violation);

  const written = writeHandDecisions({
    kind,
    md,
    answer: handAnswer,
    parsed,
    reArbitrated: bound.verdicts.filter((v) => v.state === "arbitrated").map((v) => v.question),
  });
  if (Either.isLeft(written)) return Either.left(refusal(["markdown"], written.left));

  const verdicts = bound.verdicts.flatMap((given): TranscribedVerdict[] => {
    const decision = handAnswer.decisions.find(({ id }) => id === given.question);
    if (decision === undefined) return [];
    return [
      {
        question: given.question,
        chosen: decision.verdict.chosen,
        recommendation: given.recommendation,
        departs: given.departs,
        why: decision.verdict.why,
        revised: decision.verdict.revised,
        by: operatorBy(operator),
      },
    ];
  });
  return Either.right({ answer: handAnswer, md: written.right, verdicts });
}
