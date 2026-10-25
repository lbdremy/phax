import { Either, ParseResult } from "effect";
import type { HandDecision, HandDecisionAnswer } from "../../schemas/handDecisionAnswer.js";
import { decodeCurrentHandDecisionAnswer } from "../../schemas/persisted.js";
import { OTHER_OPTION_ID } from "../../schemas/questions.js";
import { CURRENT_STAMPS } from "../../schemas/release.js";
import { parseSchemaUrl, schemaUrl } from "../../schemas/schemaUrl.js";
import { splitFrontmatter } from "../artifact/frontmatter.js";
import {
  type LineRange,
  type ParsedArbitratedQuestion,
  type ParsedHandQuestions,
  type ParsedQuestion,
  type ParsedSection,
  parseHandAuthoredQuestions,
} from "../artifact/questions.js";
import type { ArtifactKind } from "../artifact/status.js";
import { bulletList } from "../authoring/markdown.js";
import { renderDecisionLogEntry, renderVerdictDecision } from "../authoring/renderQuestions.js";
import type { DecideScope, RevisionRefusal } from "./revision.js";

// The pure core of `phax artifact decide` for a hand-authored spec or plan,
// which has no sidecar for the session to revise. The session answers in the
// `hand-decision-answer` format: the verdicts it decided, by question id, and
// the artifact's whole revised Markdown. phax checks the verdicts against the
// parsed §9 sections, keeps only the Markdown's edits outside the
// frontmatter, the question sections and the decision log, and writes those
// itself: each decided block moves to the arbitrated section with its
// Decision block, and the decision log gains an entry per verdict.

const FORMAT = "hand-decision-answer";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// `decisions[0].verdict.chosen` — indices bracketed, keys dotted.
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

// ── The answer's stamp ─────────────────────────────────────────────────────

/**
 * Why a session's answer is not stamped with the hand decision answer's
 * current shape, or undefined when it is. The same by-name rule as a
 * document answer's: a missing `$schema`, another format or another release
 * is refused, quoting the URL read (or saying there is none) and the URL phax
 * reads. Never lifted.
 */
export function handAnswerStampViolation(json: unknown): string | undefined {
  const reads = schemaUrl(FORMAT, CURRENT_STAMPS[FORMAT]);
  if (!isObject(json)) return `the answer is not a JSON object — phax reads ${reads}`;
  if (!Object.hasOwn(json, "$schema")) return `the answer carries no $schema — phax reads ${reads}`;
  const read = json["$schema"];
  const named = parseSchemaUrl(read);
  if (named === undefined) {
    return `$schema ${JSON.stringify(read)} is not a phax schema URL — phax reads ${reads}`;
  }
  if (named.formatId !== FORMAT) {
    return `$schema ${String(read)} names ${named.formatId}, not ${FORMAT} — phax reads ${reads}`;
  }
  if (named.release !== CURRENT_STAMPS[FORMAT]) {
    return `$schema ${String(read)} names ${FORMAT} ${named.release}, not its current shape — phax reads ${reads}`;
  }
  return undefined;
}

// ── Stamping the operator and the time ─────────────────────────────────────

/**
 * Stamps a parsed answer before it is decoded: each entry of `decisions`
 * whose id the session took and whose `verdict` is an object, not `lifted`,
 * gets `verdict.by = { kind: "operator", name }` and `verdict.at = atIso`,
 * overwriting or filling whatever the session put there. Anything else is
 * returned as it is. The input is never mutated.
 */
export function stampHandVerdicts(
  json: unknown,
  scope: DecideScope,
  operator: { readonly name: string },
  atIso: string,
): unknown {
  if (!isObject(json) || !Array.isArray(json["decisions"])) return json;
  const presented = new Set(scope.presented);
  const decisions = json["decisions"].map((entry: unknown) => {
    if (!isObject(entry) || typeof entry["id"] !== "string" || !presented.has(entry["id"])) {
      return entry;
    }
    const verdict = entry["verdict"];
    if (!isObject(verdict) || verdict["kind"] === "lifted") return entry;
    return {
      ...entry,
      verdict: { ...verdict, by: { kind: "operator", name: operator.name }, at: atIso },
    };
  });
  return { ...json, decisions };
}

/** The facts phax brings to a hand decision answer: the scope, who decides and when. */
export interface HandDecideContext {
  readonly scope: DecideScope;
  readonly operator: { readonly name: string };
  /** An ISO-8601 UTC timestamp, as `Date.prototype.toISOString` prints it. */
  readonly atIso: string;
}

function firstParseIssue(error: ParseResult.ParseError): RevisionRefusal {
  const [first] = ParseResult.ArrayFormatter.formatErrorSync(error);
  if (first === undefined) return { path: "", message: error.message };
  return refusal(first.path, first.message);
}

/**
 * A session's parsed answer as a hand decision answer, or the first refusal:
 * the stamp (`handAnswerStampViolation`, at `$schema`), then
 * `stampHandVerdicts`, then the current-shape decoder (unknown keys refused,
 * never lifted). The decoded answer carries no `$schema`.
 */
export function decodeHandAnswer(
  json: unknown,
  context: HandDecideContext,
): Either.Either<HandDecisionAnswer, RevisionRefusal> {
  const stampViolation = handAnswerStampViolation(json);
  if (stampViolation !== undefined) {
    return Either.left({ path: isObject(json) ? "$schema" : "", message: stampViolation });
  }
  return Either.mapLeft(
    decodeCurrentHandDecisionAnswer(
      stampHandVerdicts(json, context.scope, context.operator, context.atIso),
    ),
    firstParseIssue,
  );
}

// ── The plan's phases ──────────────────────────────────────────────────────

const FENCE = /^ {0,3}(?:```|~~~)/;
const PHASE_ID = /^## (phase-\d{2})\b/;

/** The ids of a plan's `## phase-NN` headings, in order, outside fenced code. */
export function planPhaseIds(md: string): readonly string[] {
  const ids: string[] = [];
  let inFence = false;
  for (const line of md.split(/\r\n?|\n/)) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    const id = inFence ? undefined : PHASE_ID.exec(line)?.[1];
    if (id !== undefined && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

// ── Answer checks ──────────────────────────────────────────────────────────

/** A hand decision answer with the facts it is checked against. */
export interface HandAnswerCheckInput {
  readonly kind: ArtifactKind;
  /** The artifact's Markdown, as it is on disk. */
  readonly md: string;
  /** `md` parsed by `parseHandAuthoredQuestions`. */
  readonly parsed: ParsedHandQuestions;
  readonly answer: HandDecisionAnswer;
  readonly scope: DecideScope;
  /** The ids the loaded doctrine defines (`Doctrine.principleIds`). */
  readonly principleIds: ReadonlySet<string>;
  /** The plan's phase ids (`planPhaseIds`); empty for a spec. */
  readonly phaseIds: readonly string[];
}

type AnyParsedQuestion = ParsedQuestion | ParsedArbitratedQuestion;

function findQuestion(parsed: ParsedHandQuestions, id: string): AnyParsedQuestion | undefined {
  return parsed.open.find((q) => q.id === id) ?? parsed.arbitrated.find((q) => q.id === id);
}

function optionList(question: AnyParsedQuestion): string {
  return question.optionIds.join(", ");
}

function verdictOptionViolation(
  question: AnyParsedQuestion,
  verdict: HandDecision["verdict"],
  path: ReadonlyArray<PropertyKey>,
): RevisionRefusal | undefined {
  if (verdict.chosen !== OTHER_OPTION_ID && !question.optionIds.includes(verdict.chosen)) {
    return refusal(
      [...path, "chosen"],
      `"${verdict.chosen}" names none of the question's options (${optionList(question)}, ${OTHER_OPTION_ID})`,
    );
  }
  const seen = new Set<string>();
  for (const [i, id] of verdict.abandoned.entries()) {
    if (id === verdict.chosen) {
      return refusal([...path, "abandoned", i], `"${id}" is the chosen option`);
    }
    if (!question.optionIds.includes(id)) {
      return refusal(
        [...path, "abandoned", i],
        `"${id}" names none of the question's options (${optionList(question)})`,
      );
    }
    if (seen.has(id)) return refusal([...path, "abandoned", i], `"${id}" is abandoned twice`);
    seen.add(id);
  }
  const missing = question.optionIds.filter((id) => id !== verdict.chosen && !seen.has(id));
  if (missing.length > 0) {
    return refusal(
      [...path, "abandoned"],
      `misses ${missing.map((id) => `"${id}"`).join(", ")}: a verdict abandons every option it does not choose`,
    );
  }
  return undefined;
}

// The text of a range of lines: each line's trailing whitespace dropped, and
// the blank lines that end the range.
function rangeText(lines: readonly string[], range: LineRange): string {
  const slice = lines.slice(range.start - 1, range.end).map((line) => line.trimEnd());
  while (slice.length > 0 && slice.at(-1) === "") slice.pop();
  return slice.join("\n");
}

// The lines of a range as they are, without the blank lines that end it.
function blockLines(lines: readonly string[], range: LineRange): string[] {
  const slice = lines.slice(range.start - 1, range.end);
  while (slice.length > 0 && (slice.at(-1) ?? "").trim() === "") slice.pop();
  return slice;
}

function splitLines(md: string): string[] {
  return md.split(/\r\n?|\n/);
}

// The frontmatter block, delimiters included, or "" without one.
function frontmatterBlock(md: string): string {
  const normalized = md.replace(/\r\n?/g, "\n");
  const split = splitFrontmatter(normalized);
  return split === null ? "" : normalized.slice(0, normalized.length - split.body.length);
}

// The text phax writes itself in an artifact: its frontmatter, its two
// question sections and its decision log; each null when absent.
interface WrittenRegions {
  readonly frontmatter: string;
  readonly open: string | null;
  readonly arbitrated: string | null;
  readonly decisionLog: string | null;
}

function regionsOf(md: string, sections: ParsedHandQuestions["sections"] | null): WrittenRegions {
  const lines = splitLines(md);
  const text = (section: ParsedSection | null | undefined) =>
    section === null || section === undefined ? null : rangeText(lines, section.range);
  return {
    frontmatter: frontmatterBlock(md),
    open: text(sections?.open),
    arbitrated: text(sections?.arbitrated),
    decisionLog: text(sections?.decisionLog),
  };
}

const REGION_LABELS: Readonly<Record<keyof WrittenRegions, string>> = {
  frontmatter: "the frontmatter",
  open: "the open questions section",
  arbitrated: "the arbitrated questions section",
  decisionLog: "the decision log",
};

function normalizedMarkdown(md: string): string {
  return md.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
}

// Two Markdown texts that differ at most by line endings and trailing newlines.
function sameMarkdown(a: string, b: string): boolean {
  return normalizedMarkdown(a) === normalizedMarkdown(b);
}

// Two question lists with the same ids, in the same order.
function sameIds(a: readonly { id: string }[], b: readonly { id: string }[]): boolean {
  return a.map((q) => q.id).join("\n") === b.map((q) => q.id).join("\n");
}

/**
 * The first violation of a hand decision answer, or undefined. Checked in a
 * fixed order, with paths into the answer:
 * 1. its `kind` is the artifact's;
 * 2. each decision's id was presented in this session, and appears once;
 * 3. each verdict's `chosen` is one of the question's parsed options, and
 *    `abandoned` is exactly the others, each once;
 * 4. every cited principle is a loaded doctrine id;
 * 5. on a plan, each verdict's `phase` is one of the plan's phases;
 * 6. a verdict whose `chosen` differs from the parsed recommendation names at
 *    least one revised section;
 * 7. its `markdown` parses, and its frontmatter, question sections and
 *    decision log equal the artifact's: phax writes those;
 * 8. when every decision has `revised: []`, its `markdown` is the artifact's.
 * The schema checks (`decodeHandAnswer`) are assumed to have passed.
 */
export function firstHandAnswerViolation(input: HandAnswerCheckInput): RevisionRefusal | undefined {
  const { answer, parsed, scope } = input;
  if (answer.kind !== input.kind) {
    return refusal(["kind"], `"${answer.kind}" is not the artifact's kind "${input.kind}"`);
  }
  const decisions: ReadonlyArray<HandDecision> = answer.decisions;

  // (2)
  const presented = new Set(scope.presented);
  const seen = new Set<string>();
  for (const [i, { id }] of decisions.entries()) {
    if (!presented.has(id)) {
      return refusal(
        ["decisions", i, "id"],
        `"${id}" was not presented in this session (presented: ${scope.presented.join(", ") || "none"})`,
      );
    }
    if (seen.has(id)) return refusal(["decisions", i, "id"], `"${id}" is decided twice`);
    seen.add(id);
  }

  // (3)
  for (const [i, { id, verdict }] of decisions.entries()) {
    const question = findQuestion(parsed, id);
    if (question === undefined) {
      return refusal(["decisions", i, "id"], `"${id}" is not a question of the artifact`);
    }
    const violation = verdictOptionViolation(question, verdict, ["decisions", i, "verdict"]);
    if (violation !== undefined) return violation;
  }

  // (4)
  for (const [i, { verdict }] of decisions.entries()) {
    for (const [j, id] of verdict.principles.entries()) {
      if (!input.principleIds.has(id)) {
        const loaded = [...input.principleIds];
        return refusal(
          ["decisions", i, "verdict", "principles", j],
          `"${id}" is no principle id of the loaded doctrine (${loaded.length === 0 ? "none" : loaded.join(", ")})`,
        );
      }
    }
  }

  // (5)
  for (const [i, { verdict }] of decisions.entries()) {
    if ("phase" in verdict && !input.phaseIds.includes(verdict.phase)) {
      return refusal(
        ["decisions", i, "verdict", "phase"],
        `"${verdict.phase}" names none of the plan's phases (${input.phaseIds.join(", ") || "none"})`,
      );
    }
  }

  // (6)
  for (const [i, { id, verdict }] of decisions.entries()) {
    const recommendation = findQuestion(parsed, id)?.recommendation;
    if (verdict.chosen !== recommendation && verdict.revised.length === 0) {
      return refusal(
        ["decisions", i, "verdict", "revised"],
        `"${verdict.chosen}" departs from the recommendation "${recommendation ?? ""}": name the body sections it revised`,
      );
    }
  }

  // (7)
  const revisedParse = parseHandAuthoredQuestions(input.kind, answer.markdown);
  if (revisedParse.kind === "departs") {
    return refusal(
      ["markdown"],
      `line ${revisedParse.line} departs from the §9 format: ${revisedParse.text}`,
    );
  }
  const before = regionsOf(input.md, parsed.sections);
  const after = regionsOf(
    answer.markdown,
    revisedParse.kind === "parsed" ? revisedParse.sections : null,
  );
  for (const key of ["frontmatter", "open", "arbitrated", "decisionLog"] as const) {
    if (before[key] !== after[key]) {
      return refusal(
        ["markdown"],
        `${REGION_LABELS[key]} differs from the artifact's: phax writes it — return it exactly as it was`,
      );
    }
  }

  // (8)
  if (decisions.every(({ verdict }) => verdict.revised.length === 0)) {
    if (!sameMarkdown(input.md, answer.markdown)) {
      return refusal(
        ["markdown"],
        "no verdict of this session revised the body (every revised is []): it stays as it was",
      );
    }
  }

  return undefined;
}

// ── Writing the decisions in place ─────────────────────────────────────────

/** What `writeHandDecisions` writes from. */
export interface HandWriteInput {
  readonly kind: ArtifactKind;
  /** The artifact's Markdown, as it is on disk. */
  readonly md: string;
  /** An answer `firstHandAnswerViolation` passed. */
  readonly answer: HandDecisionAnswer;
  /** `md` parsed by `parseHandAuthoredQuestions`. */
  readonly parsed: ParsedHandQuestions;
  /** The arbitrated questions this session re-arbitrates; interactive decide passes at most one. */
  readonly reArbitrated: readonly string[];
}

// A run of lines inserted before an original line (or at the end). A
// section chunk opens a new section: a blank line precedes it.
interface Chunk {
  readonly lines: readonly string[];
  readonly section: boolean;
}

// A verdict's Decision block lines, as the renderers render them.
function decisionLines(verdict: HandDecision["verdict"]): string[] {
  return renderVerdictDecision(verdict).split("\n");
}

const ARBITRATED_HEADING: Readonly<Record<ArtifactKind, string>> = {
  spec: "## 9b. Arbitrated questions",
  plan: "## Arbitrated questions",
};

const DECISION_LOG_HEADING: Readonly<Record<ArtifactKind, string>> = {
  spec: "## 12. Decision log",
  plan: "## Decision log",
};

// The 0-based index of the last non-blank line of a range, or of its first
// line when every other line is blank.
function lastContent(lines: readonly string[], range: LineRange): number {
  for (let i = range.end - 1; i >= range.start - 1; i--) {
    if ((lines[i] ?? "").trim().length > 0) return i;
  }
  return range.start - 1;
}

// A re-arbitrated question's Decision block, by 0-based line: the old
// verdict's own lines, and the last of the `Earlier decision:` lines among
// them, if any. Its own lines are its Decision line and its `Why:` paragraph
// — the next line, or the next paragraph after blank lines — each with the
// lines that continue it; an `Earlier decision:` line and the lines that
// continue it are history. Read through the end of the Decision line's
// paragraph (or of its Why paragraph): what follows a blank line is not the
// verdict's. `decision` is its Decision line, continuation lines joined.
interface DecisionBlock {
  readonly own: readonly number[];
  readonly decision: string;
  readonly lastEarlier: number | undefined;
}

function decisionBlockOf(lines: readonly string[], q: ParsedArbitratedQuestion): DecisionBlock {
  const start = q.decisionLine - 1;
  const end = q.range.end - 1;
  const text = (i: number) => (lines[i] ?? "").trim();
  const own: number[] = [];
  const decision: string[] = [];
  let lastEarlier: number | undefined;
  let owner: "decision" | "why" | "earlier" = "decision";
  let sawWhy = false;
  let i = start;
  const readParagraph = () => {
    for (; i <= end && text(i).length > 0; i++) {
      if (i !== start && text(i).startsWith("Why:")) {
        owner = "why";
        sawWhy = true;
      } else if (text(i).startsWith("Earlier decision:")) {
        owner = "earlier";
      }
      if (owner === "earlier") lastEarlier = i;
      else own.push(i);
      if (owner === "decision") decision.push(text(i));
    }
  };
  readParagraph();
  let next = i;
  while (next <= end && text(next).length === 0) next++;
  if (!sawWhy && next <= end && text(next).startsWith("Why:")) {
    for (let blank = i; blank < next; blank++) own.push(blank);
    i = next;
    readParagraph();
  }
  return { own, decision: decision.join(" "), lastEarlier };
}

// The 0-based index of a section's `None.` line, if it holds one.
function noneLine(lines: readonly string[], section: ParsedSection): number | undefined {
  for (let i = section.range.start; i < section.range.end; i++) {
    const text = (lines[i] ?? "").trim();
    if (text === "None.") return i;
    if (text.length > 0) return undefined;
  }
  return undefined;
}

/**
 * The artifact's Markdown with this session's decisions written in place, or
 * why it could not be written. It starts from the answer's `markdown` (the
 * artifact's own text when every decision has `revised: []`, which then
 * equals it), so the session's accepted body edits carry over, then:
 * - each decided open question's block (its range) is cut from the open
 *   section and appended to the arbitrated section, followed by its Decision
 *   block; an open section left without a question holds `None.`;
 * - each re-arbitrated question's old verdict (its Decision line and its Why
 *   paragraph) is replaced by the new one, and its previous Decision line is
 *   added as an `Earlier decision:` line after its earlier decisions; every
 *   other line of its block (earlier decisions, notes) stays in place;
 * - the decision log gains one entry per new verdict, after its last line;
 * - a missing arbitrated section is created right after the open section,
 *   and a missing decision log at the end of a spec, or right after a plan's
 *   arbitrated section (so before its first phase).
 * No other line changes, and the file keeps its line ending. The Decision
 * block and log entries are rendered as the spec and plan renderers render
 * them. The result is parsed again: a
 * Left when it does not parse, or its open and arbitrated ids are not the
 * expected ones.
 */
export function writeHandDecisions(input: HandWriteInput): Either.Either<string, string> {
  const { kind, answer, parsed, reArbitrated } = input;
  const decisions: ReadonlyArray<HandDecision> = answer.decisions;
  const base = decisions.every(({ verdict }) => verdict.revised.length === 0)
    ? input.md
    : answer.markdown;
  if (decisions.length === 0) return Either.right(base);

  const current = parseHandAuthoredQuestions(kind, base);
  if (current.kind !== "parsed") {
    return Either.left("the revised Markdown has no question section phax can write to");
  }
  if (!sameIds(current.open, parsed.open) || !sameIds(current.arbitrated, parsed.arbitrated)) {
    return Either.left("the revised Markdown's questions are not the artifact's");
  }

  const verdictOf = new Map(decisions.map((d) => [d.id, d.verdict]));
  const moved = current.open.filter((q) => verdictOf.has(q.id));
  const rearbitrated = current.arbitrated.filter(
    (q) => reArbitrated.includes(q.id) && verdictOf.has(q.id),
  );
  const written = new Set([...moved, ...rearbitrated].map((q) => q.id));
  const unwritten = decisions.find((d) => !written.has(d.id));
  if (unwritten !== undefined) {
    return Either.left(`"${unwritten.id}" is neither an open question nor the re-arbitrated one`);
  }

  const lines = splitLines(base);
  // The file's line ending, kept: CRLF when it holds one, LF otherwise.
  const eol = input.md.includes("\r\n") ? "\r\n" : "\n";
  const dropped = new Set<number>();
  const inserted = new Map<number, Chunk[]>();
  const insert = (index: number, chunkLines: readonly string[], section = false) => {
    inserted.set(index, [...(inserted.get(index) ?? []), { lines: chunkLines, section }]);
  };
  const drop = (from: number, to: number) => {
    for (let i = from; i <= to; i++) dropped.add(i);
  };

  // The moved blocks, each followed by its Decision block, blank-separated.
  const movedBlocks = moved.flatMap((q, i) => {
    const verdict = verdictOf.get(q.id);
    if (verdict === undefined) return [];
    return [...(i === 0 ? [] : [""]), ...blockLines(lines, q.range), "", ...decisionLines(verdict)];
  });
  for (const q of moved) drop(q.range.start - 1, q.range.end - 1);
  const firstOpen = current.open[0];
  if (moved.length > 0 && moved.length === current.open.length && firstOpen !== undefined) {
    insert(firstOpen.range.start - 1, ["None.", ""]);
  }

  // Each re-arbitrated question: its old verdict's own lines replaced by the
  // new verdict's, and the old verdict added after its earlier decisions.
  // Every other line of its block stays where it is.
  for (const question of rearbitrated) {
    const verdict = verdictOf.get(question.id);
    if (verdict === undefined) return Either.left(`"${question.id}" has no verdict`);
    const from = question.decisionLine - 1;
    const block = decisionBlockOf(lines, question);
    const previous = `Earlier decision: ${block.decision.slice("Decision: ".length)}`;
    for (const i of block.own) drop(i, i);
    if (block.lastEarlier === undefined) {
      insert(from, [...decisionLines(verdict), previous]);
    } else {
      insert(from, decisionLines(verdict));
      insert(block.lastEarlier + 1, [previous]);
    }
  }

  // The decision log entries, one per new verdict, in document order.
  const entries = bulletList(
    [...moved, ...rearbitrated].flatMap((q) => {
      const verdict = verdictOf.get(q.id);
      return verdict === undefined ? [] : [renderDecisionLogEntry(q.id, verdict)];
    }),
  ).split("\n");
  const logSection = [DECISION_LOG_HEADING[kind], "", ...entries];

  // The arbitrated section: the moved blocks appended, or the section created.
  const { open: openSection, arbitrated: arbitratedSection, decisionLog } = current.sections;
  let logPlaced = false;
  if (movedBlocks.length > 0) {
    if (arbitratedSection !== null) {
      const none = noneLine(lines, arbitratedSection);
      if (none !== undefined) {
        drop(none, none);
        insert(none, movedBlocks);
      } else {
        insert(lastContent(lines, arbitratedSection.range) + 1, ["", ...movedBlocks]);
      }
    } else if (openSection !== null) {
      const created = [ARBITRATED_HEADING[kind], "", ...movedBlocks, ""];
      // A plan's decision log follows its arbitrated section, before the first phase.
      const withLog = kind === "plan" && decisionLog === null ? [...logSection, ""] : [];
      logPlaced = withLog.length > 0;
      insert(openSection.range.end, [...created, ...withLog], true);
    } else {
      return Either.left("the artifact has no open questions section to move questions from");
    }
  }

  // The decision log: entries appended, or the log created.
  if (decisionLog !== null) {
    const none = noneLine(lines, decisionLog);
    if (none !== undefined) {
      drop(none, none);
      insert(none, entries);
    } else {
      const last = lastContent(lines, decisionLog.range);
      insert(last + 1, last === decisionLog.heading - 1 ? ["", ...entries] : entries);
    }
  } else if (!logPlaced) {
    if (kind === "spec") {
      insert(lines.length, logSection, true);
    } else {
      const after = arbitratedSection ?? openSection;
      if (after === null) return Either.left("the plan has no question section to log after");
      insert(after.range.end, [...logSection, ""], true);
    }
  }

  const out: string[] = [];
  const emit = (index: number) => {
    for (const chunk of inserted.get(index) ?? []) {
      if (chunk.section && out.length > 0 && out.at(-1) !== "") out.push("");
      out.push(...chunk.lines);
    }
  };
  for (const [i, line] of lines.entries()) {
    emit(i);
    if (!dropped.has(i)) out.push(line);
  }
  emit(lines.length);
  const result = `${out.join(eol).replace(/(?:\r?\n)+$/, "")}${eol}`;

  const reparsed = parseHandAuthoredQuestions(kind, result);
  if (reparsed.kind !== "parsed") {
    return Either.left(
      reparsed.kind === "departs"
        ? `the written Markdown departs from the §9 format at line ${reparsed.line}: ${reparsed.text}`
        : "the written Markdown has no question section",
    );
  }
  const expectedOpen = parsed.open.filter((q) => !verdictOf.has(q.id)).map((q) => q.id);
  const expectedArbitrated = [...parsed.arbitrated.map((q) => q.id), ...moved.map((q) => q.id)];
  const openIds = reparsed.open.map((q) => q.id);
  const arbitratedIds = reparsed.arbitrated.map((q) => q.id);
  if (
    openIds.join("\n") !== expectedOpen.join("\n") ||
    arbitratedIds.join("\n") !== expectedArbitrated.join("\n")
  ) {
    return Either.left(
      `the written Markdown holds open ${openIds.join(", ") || "none"} and arbitrated ${arbitratedIds.join(", ") || "none"}, not open ${expectedOpen.join(", ") || "none"} and arbitrated ${expectedArbitrated.join(", ") || "none"}`,
    );
  }
  for (const q of reparsed.arbitrated) {
    const verdict = verdictOf.get(q.id);
    if (verdict !== undefined && (q.chosen !== verdict.chosen || q.lifted)) {
      return Either.left(
        `the written Decision line of "${q.id}" does not choose "${verdict.chosen}"`,
      );
    }
  }
  return Either.right(result);
}
