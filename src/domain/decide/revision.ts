import { Either, ParseResult } from "effect";
import { decodeCurrentDocumentSidecar } from "../../schemas/persisted.js";
import type {
  OpenQuestion,
  PlanArbitratedQuestion,
  PlanVerdict,
  SpecArbitratedQuestion,
  SpecVerdict,
} from "../../schemas/questions.js";
import { CURRENT_STAMPS } from "../../schemas/release.js";
import { parseSchemaUrl, schemaUrl } from "../../schemas/schemaUrl.js";
import {
  type DocumentFormat,
  type SidecarDocument,
  artifactBody,
  renderCurrent,
  serializeSidecar,
} from "../artifact/sidecar.js";
import type { ArtifactKind } from "../artifact/status.js";

// The pure core of `phax artifact decide` for a headless-authored spec or
// plan: which questions a session takes, how its revised document is read,
// and the checks that document must pass before anything is written. The use
// case spawns the session and writes; this module only decides.

type ArbitratedQuestion = SpecArbitratedQuestion | PlanArbitratedQuestion;
type Verdict = SpecVerdict | PlanVerdict;

/** The questions of an artifact, in their two states. */
export interface DecideQuestions {
  readonly openQuestions: ReadonlyArray<OpenQuestion>;
  readonly arbitratedQuestions: ReadonlyArray<ArbitratedQuestion>;
}

/**
 * The questions a decide session takes, in presentation order, and the
 * arbitrated question it re-arbitrates (`--question` naming one), if any.
 */
export interface DecideScope {
  readonly presented: readonly string[];
  readonly reArbitrated: string | null;
}

/** Why a revised document is refused: a document-relative path (`""` at the root) and what is wrong there. */
export interface RevisionRefusal {
  readonly path: string;
  readonly message: string;
}

/** A refusal as one line: `<path>: <message>`, or the message alone at the root. */
export function describeRevisionRefusal({ path, message }: RevisionRefusal): string {
  return path.length > 0 ? `${path}: ${message}` : message;
}

// `preamble.arbitratedQuestions[0].verdict` — indices bracketed, keys dotted,
// as `formatFirstViolation` renders a decoder's path.
function renderPath(path: ReadonlyArray<PropertyKey>): string {
  return path
    .map((key, i) =>
      typeof key === "number" ? `[${key}]` : i === 0 ? String(key) : `.${String(key)}`,
    )
    .join("");
}

function refusal(path: ReadonlyArray<PropertyKey>, message: string): RevisionRefusal {
  return { path: renderPath(path), message };
}

function formatOf(kind: ArtifactKind): DocumentFormat {
  return kind === "spec" ? "spec-document" : "plan-document";
}

interface LocatedArrays extends DecideQuestions {
  /** `[]` for a spec, `["preamble"]` for a plan. */
  readonly basePath: ReadonlyArray<PropertyKey>;
}

function arraysOf(sidecar: SidecarDocument): LocatedArrays {
  return sidecar.kind === "spec"
    ? {
        basePath: [],
        openQuestions: sidecar.document.openQuestions,
        arbitratedQuestions: sidecar.document.arbitratedQuestions,
      }
    : {
        basePath: ["preamble"],
        openQuestions: sidecar.document.preamble.openQuestions,
        arbitratedQuestions: sidecar.document.preamble.arbitratedQuestions,
      };
}

/** The questions of a document, open then arbitrated. */
export function questionsOf(sidecar: SidecarDocument): DecideQuestions {
  const { openQuestions, arbitratedQuestions } = arraysOf(sidecar);
  return { openQuestions, arbitratedQuestions };
}

// ── Scope ──────────────────────────────────────────────────────────────────

/**
 * The questions a session takes from `--question` (or null). Without it,
 * every open question, in document order. With an open question's id, that
 * question alone; with an arbitrated question's id, that question alone,
 * re-arbitrated. An id the artifact does not have is refused, naming every
 * question id it has (§5.34). Only ids are read, so a hand-authored
 * artifact's parsed questions serve as well as a sidecar's.
 */
export function decideScope(
  questions: {
    readonly openQuestions: ReadonlyArray<{ readonly id: string }>;
    readonly arbitratedQuestions: ReadonlyArray<{ readonly id: string }>;
  },
  questionFlag: string | null,
): Either.Either<DecideScope, string> {
  const openIds = questions.openQuestions.map((q) => q.id);
  if (questionFlag === null) return Either.right({ presented: openIds, reArbitrated: null });
  if (openIds.includes(questionFlag)) {
    return Either.right({ presented: [questionFlag], reArbitrated: null });
  }
  if (questions.arbitratedQuestions.some((q) => q.id === questionFlag)) {
    return Either.right({ presented: [questionFlag], reArbitrated: questionFlag });
  }
  const ids = [...openIds, ...questions.arbitratedQuestions.map((q) => q.id)];
  return Either.left(
    ids.length === 0
      ? `--question ${questionFlag} names no question: the artifact has none`
      : `--question ${questionFlag} names no question of the artifact — its questions are ${ids.join(", ")}`,
  );
}

// ── The answer's stamp ─────────────────────────────────────────────────────

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Why a session's answer is not stamped with its document format's current
 * shape, or undefined when it is. The answer must be a JSON object whose
 * `$schema` names `<kind>-document` at `CURRENT_STAMPS`; a missing `$schema`,
 * another format or another release is refused by name, quoting the URL read
 * (or saying there is none) and the URL phax reads. Never lifted (§5.18).
 */
export function answerStampViolation(kind: ArtifactKind, json: unknown): string | undefined {
  const format = formatOf(kind);
  const reads = schemaUrl(format, CURRENT_STAMPS[format]);
  if (!isObject(json)) return `the answer is not a JSON object — phax reads ${reads}`;
  if (!Object.hasOwn(json, "$schema")) return `the answer carries no $schema — phax reads ${reads}`;
  const read = json["$schema"];
  const named = parseSchemaUrl(read);
  if (named === undefined) {
    return `$schema ${JSON.stringify(read)} is not a phax schema URL — phax reads ${reads}`;
  }
  if (named.formatId !== format) {
    return `$schema ${String(read)} names ${named.formatId}, not ${format} — phax reads ${reads}`;
  }
  if (named.release !== CURRENT_STAMPS[format]) {
    return `$schema ${String(read)} names ${format} ${named.release}, not its current shape — phax reads ${reads}`;
  }
  return undefined;
}

// ── Stamping the operator and the time ─────────────────────────────────────

/** The facts phax brings to a session's answer: the document it started from, the scope, who decides and when. */
export interface DecideContext {
  readonly original: SidecarDocument;
  readonly scope: DecideScope;
  readonly operator: { readonly name: string };
  /** An ISO-8601 UTC timestamp, as `Date.prototype.toISOString` prints it. */
  readonly atIso: string;
}

// Deep structural equality over parsed JSON.
function sameJson(a: unknown, b: unknown): boolean {
  return firstDifference(a, b, []) === undefined;
}

// The path of the first place two parsed JSON values differ, or undefined.
// Object keys are compared as sets (key order is not content); arrays by
// index, then length.
function firstDifference(
  a: unknown,
  b: unknown,
  path: ReadonlyArray<PropertyKey>,
): ReadonlyArray<PropertyKey> | undefined {
  if (Array.isArray(a) && Array.isArray(b)) {
    const length = Math.min(a.length, b.length);
    for (let i = 0; i < length; i++) {
      const found = firstDifference(a[i], b[i], [...path, i]);
      if (found !== undefined) return found;
    }
    return a.length === b.length ? undefined : [...path, length];
  }
  if (isObject(a) && isObject(b)) {
    const keys = [...Object.keys(a), ...Object.keys(b).filter((key) => !Object.hasOwn(a, key))];
    for (const key of keys) {
      if (!Object.hasOwn(a, key) || !Object.hasOwn(b, key)) return [...path, key];
      const found = firstDifference(a[key], b[key], [...path, key]);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  return Object.is(a, b) ? undefined : path;
}

function withoutStamp(verdict: unknown): unknown {
  if (!isObject(verdict)) return verdict;
  const { by: _by, at: _at, ...rest } = verdict;
  return rest;
}

// Whether a verdict is the same decision as another: equal apart from who
// gave it and when, which phax sets.
function sameDecision(a: unknown, b: unknown): boolean {
  return sameJson(withoutStamp(a), withoutStamp(b));
}

/**
 * Stamps a parsed answer before it is decoded. Each arbitrated question whose
 * id the session took gets `verdict.by = { kind: "operator", name }` and
 * `verdict.at = atIso`, overwriting or filling whatever the session put
 * there, unless its verdict is not an object or is `lifted` (refused later,
 * by name). The re-arbitrated question is stamped only when its verdict
 * changed apart from `by` and `at`; otherwise its original verdict is kept
 * whole, so a re-arbitration the operator left alone is not a decision. On a
 * plan, `sourceSpec` and `completesSpec` are restored from the original
 * (§5.32). Anything that is not an object is returned as it is. The input is
 * never mutated.
 */
export function stampSessionVerdicts(json: unknown, context: DecideContext): unknown {
  if (!isObject(json)) return json;
  const { original, scope, operator, atIso } = context;
  const before = arraysOf(original);
  const presented = new Set(scope.presented);

  const stampQuestion = (entry: unknown): unknown => {
    if (!isObject(entry) || typeof entry["id"] !== "string" || !presented.has(entry["id"])) {
      return entry;
    }
    const verdict = entry["verdict"];
    if (!isObject(verdict) || verdict["kind"] === "lifted") return entry;
    if (entry["id"] === scope.reArbitrated) {
      const previous = before.arbitratedQuestions.find((q) => q.id === scope.reArbitrated);
      if (previous !== undefined && sameDecision(verdict, previous.verdict)) {
        return { ...entry, verdict: previous.verdict };
      }
    }
    return {
      ...entry,
      verdict: { ...verdict, by: { kind: "operator", name: operator.name }, at: atIso },
    };
  };
  const stampArray = (value: unknown): unknown =>
    Array.isArray(value) ? value.map(stampQuestion) : value;

  if (original.kind === "spec") {
    return Object.hasOwn(json, "arbitratedQuestions")
      ? { ...json, arbitratedQuestions: stampArray(json["arbitratedQuestions"]) }
      : json;
  }
  const preamble = json["preamble"];
  const stamped =
    isObject(preamble) && Object.hasOwn(preamble, "arbitratedQuestions")
      ? {
          ...json,
          preamble: {
            ...preamble,
            arbitratedQuestions: stampArray(preamble["arbitratedQuestions"]),
          },
        }
      : json;
  return {
    ...stamped,
    sourceSpec: original.document.sourceSpec,
    completesSpec: original.document.completesSpec,
  };
}

// ── Decoding ───────────────────────────────────────────────────────────────

function firstParseIssue(error: ParseResult.ParseError): RevisionRefusal {
  const [first] = ParseResult.ArrayFormatter.formatErrorSync(error);
  if (first === undefined) return { path: "", message: error.message };
  return refusal(first.path, first.message);
}

/**
 * A session's parsed answer as a current-shape document of the original's
 * kind, or the first refusal: the stamp (`answerStampViolation`, at
 * `$schema`), then `stampSessionVerdicts`, then the current-shape sidecar
 * decoder of the kind (`decodeCurrentDocumentSidecar`: unknown keys refused,
 * never lifted), which runs the question checks, a plan verdict's phase and
 * a spec's traceability. The decoded document carries no `$schema`.
 */
export function decodeRevisedDocument(
  json: unknown,
  context: DecideContext,
): Either.Either<SidecarDocument, RevisionRefusal> {
  const { kind } = context.original;
  const stampViolation = answerStampViolation(kind, json);
  if (stampViolation !== undefined) {
    return Either.left({ path: isObject(json) ? "$schema" : "", message: stampViolation });
  }
  return Either.mapLeft(
    decodeCurrentDocumentSidecar(kind, stampSessionVerdicts(json, context)),
    firstParseIssue,
  );
}

// ── Revision checks ────────────────────────────────────────────────────────

/** A document before and after a decide session. */
export interface RevisionDocuments {
  readonly before: SidecarDocument;
  readonly after: SidecarDocument;
  readonly scope: DecideScope;
}

export interface RevisionCheckInput extends RevisionDocuments {
  /** The ids the loaded doctrine defines (`Doctrine.principleIds`). */
  readonly principleIds: ReadonlySet<string>;
}

/** A question decided in this session, with its new verdict and whether it departs from the recommendation. */
export interface SessionDecision {
  readonly id: string;
  readonly verdict: Verdict;
  readonly departs: boolean;
}

interface Located<Q> {
  readonly question: Q;
  readonly path: ReadonlyArray<PropertyKey>;
}

function locate<Q extends { readonly id: string }>(
  questions: ReadonlyArray<Q>,
  path: ReadonlyArray<PropertyKey>,
): Map<string, Located<Q>> {
  return new Map(questions.map((question, i) => [question.id, { question, path: [...path, i] }]));
}

const KEPT_FIELDS = ["id", "question", "options", "recommendation", "rationale"] as const;

// The arbitrated questions of `after` that carry a verdict given in this
// session: a presented question that was open, and the re-arbitrated one when
// its decision changed. In `after`'s order, with their paths.
function sessionVerdicts(input: RevisionDocuments): ReadonlyArray<Located<ArbitratedQuestion>> {
  const before = arraysOf(input.before);
  const after = arraysOf(input.after);
  const presented = new Set(input.scope.presented);
  const wasOpen = new Set(before.openQuestions.map((q) => q.id));
  const previous = locate(before.arbitratedQuestions, []);
  return after.arbitratedQuestions.flatMap((question, i) => {
    if (!presented.has(question.id)) return [];
    const path = [...after.basePath, "arbitratedQuestions", i];
    if (wasOpen.has(question.id)) return [{ question, path }];
    const earlier = previous.get(question.id);
    if (
      question.id === input.scope.reArbitrated &&
      earlier !== undefined &&
      !sameDecision(question.verdict, earlier.question.verdict)
    ) {
      return [{ question, path }];
    }
    return [];
  });
}

/**
 * The questions decided in this session, in `after`'s document order: each
 * presented question that moved to the arbitrated array, and the
 * re-arbitrated question when its verdict changed apart from `by` and `at`.
 * `departs` is whether its `chosen` differs from its `recommendation`. Empty
 * when the document arbitrated nothing.
 */
export function decidedInSession(input: RevisionDocuments): readonly SessionDecision[] {
  return sessionVerdicts(input).map(({ question }) => ({
    id: question.id,
    verdict: question.verdict,
    departs: question.verdict.chosen !== question.recommendation,
  }));
}

function unchanged(
  before: unknown,
  after: unknown,
  path: ReadonlyArray<PropertyKey>,
  message: string,
): RevisionRefusal | undefined {
  const differs = firstDifference(before, after, path);
  return differs === undefined ? undefined : refusal(differs, message);
}

// (1) The same questions, by id, before and after.
function sameQuestionSet(before: LocatedArrays, after: LocatedArrays): RevisionRefusal | undefined {
  const afterIds = new Set([...after.openQuestions, ...after.arbitratedQuestions].map((q) => q.id));
  const beforeIds = new Set(
    [...before.openQuestions, ...before.arbitratedQuestions].map((q) => q.id),
  );
  for (const [key, questions] of [
    ["openQuestions", before.openQuestions],
    ["arbitratedQuestions", before.arbitratedQuestions],
  ] as const) {
    for (const question of questions) {
      if (!afterIds.has(question.id)) {
        return refusal(
          [...before.basePath, key],
          `"${question.id}" is missing: every question of the artifact stays in the document`,
        );
      }
    }
  }
  for (const [key, questions] of [
    ["openQuestions", after.openQuestions],
    ["arbitratedQuestions", after.arbitratedQuestions],
  ] as const) {
    for (const [i, question] of questions.entries()) {
      if (!beforeIds.has(question.id)) {
        return refusal(
          [...after.basePath, key, i, "id"],
          `"${question.id}" is not a question of the artifact: a session adds none`,
        );
      }
    }
  }
  return undefined;
}

// The questions of `after`'s array that were in `before`'s, in the order
// they were: a question that did not move keeps its place among the others.
// Refused at the first one out of place.
function sameOrder(
  before: ReadonlyArray<{ readonly id: string }>,
  after: ReadonlyArray<{ readonly id: string }>,
  path: ReadonlyArray<PropertyKey>,
  key: "openQuestions" | "arbitratedQuestions",
): RevisionRefusal | undefined {
  const afterIds = new Set(after.map((q) => q.id));
  const beforeIds = new Set(before.map((q) => q.id));
  const expected = before.map((q) => q.id).filter((id) => afterIds.has(id));
  const kept = [...after.entries()].filter(([, q]) => beforeIds.has(q.id));
  for (const [n, [i, { id }]] of kept.entries()) {
    if (id !== expected[n]) {
      return refusal(
        [...path, key, i, "id"],
        `"${id}" is out of place: the questions this session did not move keep their order (${expected.join(", ")})`,
      );
    }
  }
  return undefined;
}

/**
 * The first violation of the revision rules (§5.19–§5.21, §5.33), or
 * undefined. Checked in a fixed order, with document-relative paths:
 * 1. `after` has exactly the questions of `before`, by id;
 * 2. an open question not presented is still open, and an open question left
 *    open is unchanged and keeps its place among the open questions;
 * 3. an arbitrated question is still arbitrated, unchanged unless it is the
 *    re-arbitrated one with a new decision, and keeps its place among the
 *    questions that were arbitrated (a question decided in this session may
 *    join them anywhere);
 * 4. each question decided in this session keeps its id, question, options,
 *    recommendation and rationale, has a `decided` verdict (never `lifted`),
 *    and its history is `[]` when it was open, or its earlier history then
 *    its previous verdict when re-arbitrated;
 * 5. every principle a session verdict cites is a loaded doctrine id;
 * 6. a session verdict whose `chosen` differs from the recommendation names
 *    at least one revised section;
 * 7. when no session verdict departs and every one has `revised: []`, every
 *    field outside the two question arrays is unchanged.
 * The schema checks (`decodeRevisedDocument`) are assumed to have passed.
 */
export function firstRevisionViolation(input: RevisionCheckInput): RevisionRefusal | undefined {
  const { scope } = input;
  if (input.before.kind !== input.after.kind) {
    return refusal(
      ["kind"],
      `"${input.after.kind}" is not the artifact's kind "${input.before.kind}"`,
    );
  }
  const before = arraysOf(input.before);
  const after = arraysOf(input.after);
  const presented = new Set(scope.presented);

  const setViolation = sameQuestionSet(before, after);
  if (setViolation !== undefined) return setViolation;

  const afterOpen = locate(after.openQuestions, [...after.basePath, "openQuestions"]);
  const afterArbitrated = locate(after.arbitratedQuestions, [
    ...after.basePath,
    "arbitratedQuestions",
  ]);

  // (2)
  for (const question of before.openQuestions) {
    const stillOpen = afterOpen.get(question.id);
    if (stillOpen === undefined) {
      if (presented.has(question.id)) continue;
      const moved = afterArbitrated.get(question.id);
      return refusal(
        moved === undefined ? [...after.basePath, "arbitratedQuestions"] : [...moved.path, "id"],
        `"${question.id}" was not presented in this session: it stays open`,
      );
    }
    const violation = unchanged(
      question,
      stillOpen.question,
      stillOpen.path,
      `"${question.id}" was not decided in this session: it stays as it was`,
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

  // (3)
  const decided = sessionVerdicts(input);
  const decidedIds = new Set(decided.map(({ question }) => question.id));
  for (const question of before.arbitratedQuestions) {
    const stillArbitrated = afterArbitrated.get(question.id);
    if (stillArbitrated === undefined) {
      const reopened = afterOpen.get(question.id);
      return refusal(
        reopened === undefined ? [...after.basePath, "openQuestions"] : [...reopened.path, "id"],
        `"${question.id}" is arbitrated: it stays in arbitratedQuestions`,
      );
    }
    if (decidedIds.has(question.id)) continue;
    const violation = unchanged(
      question,
      stillArbitrated.question,
      stillArbitrated.path,
      question.id === scope.reArbitrated
        ? `"${question.id}" was re-arbitrated without a new verdict: it stays as it was`
        : `"${question.id}" is arbitrated and was not re-arbitrated in this session: it stays as it was`,
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

  // (4)
  const beforeOpen = locate(before.openQuestions, []);
  const beforeArbitrated = locate(before.arbitratedQuestions, []);
  for (const { question, path } of decided) {
    const earlierOpen = beforeOpen.get(question.id)?.question;
    const earlierArbitrated = beforeArbitrated.get(question.id)?.question;
    const earlier = earlierOpen ?? earlierArbitrated;
    if (earlier === undefined) continue;
    for (const field of KEPT_FIELDS) {
      const violation = unchanged(
        earlier[field],
        question[field],
        [...path, field],
        `a decided question keeps its ${field}`,
      );
      if (violation !== undefined) return violation;
    }
    if (question.verdict.kind !== "decided") {
      return refusal(
        [...path, "verdict", "kind"],
        `"${question.id}" was decided in this session: its verdict is decided, never lifted`,
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

  // (5)
  for (const { question, path } of decided) {
    if (question.verdict.kind !== "decided") continue;
    for (const [i, id] of question.verdict.principles.entries()) {
      if (!input.principleIds.has(id)) {
        const loaded = [...input.principleIds];
        return refusal(
          [...path, "verdict", "principles", i],
          `"${id}" is no principle id of the loaded doctrine (${loaded.length === 0 ? "none" : loaded.join(", ")})`,
        );
      }
    }
  }

  // (6)
  for (const { question, path } of decided) {
    const { verdict } = question;
    if (
      verdict.kind === "decided" &&
      verdict.chosen !== question.recommendation &&
      verdict.revised.length === 0
    ) {
      return refusal(
        [...path, "verdict", "revised"],
        `"${verdict.chosen}" departs from the recommendation "${question.recommendation}": name the body sections it revised`,
      );
    }
  }

  // (7)
  const bodyRevised = decided.some(
    ({ question: { verdict, recommendation } }) =>
      verdict.chosen !== recommendation ||
      (verdict.kind === "decided" && verdict.revised.length > 0),
  );
  if (!bodyRevised) {
    const differs = firstDifference(
      withoutQuestions(input.before),
      withoutQuestions(input.after),
      [],
    );
    if (differs !== undefined) {
      return refusal(
        differs,
        "no verdict of this session revised the body (every revised is []): it stays as it was",
      );
    }
  }

  return undefined;
}

// A document with its two question arrays left out, for comparing the rest.
function withoutQuestions(sidecar: SidecarDocument): unknown {
  if (sidecar.kind === "spec") {
    const { openQuestions: _open, arbitratedQuestions: _arbitrated, ...rest } = sidecar.document;
    return rest;
  }
  const { preamble, ...rest } = sidecar.document;
  const { openQuestions: _open, arbitratedQuestions: _arbitrated, ...preambleRest } = preamble;
  return { ...rest, preamble: preambleRest };
}

// ── Re-render ──────────────────────────────────────────────────────────────

/** The texts decide writes for a revised document. */
export interface RevisedArtifact {
  /** The original frontmatter block byte for byte, then the current rendering of the body. */
  readonly md: string;
  /** The sidecar text, `$schema` first at the current shape. */
  readonly sidecarText: string;
}

/**
 * The artifact and sidecar texts for a revised document: the original's
 * frontmatter block kept byte for byte (everything before its body, as
 * `artifactBody` splits it), followed by `renderCurrent`'s body; and
 * `serializeSidecar`'s text.
 */
export function renderRevisedArtifact(originalMd: string, after: SidecarDocument): RevisedArtifact {
  const body = artifactBody(originalMd);
  return {
    md: originalMd.slice(0, originalMd.length - body.length) + renderCurrent(after),
    sidecarText: serializeSidecar(after),
  };
}
