import type { OpenQuestion } from "../../schemas/questions.js";
import type { ArbitratedQuestion } from "../authoring/renderQuestions.js";
import type { ArtifactKind } from "./status.js";

// The questions of an artifact as status reports them, and the read side of
// the §9 format a hand-authored artifact follows — the format the spec and
// plan renderers emit (src/domain/authoring/renderQuestions.ts):
//
//   ## 9. Open questions                 (a plan: ## Open questions)
//
//   ### <id> — <question>
//
//   - <option id> — <label> — abandons: <loss>
//   - <option id> — <label> — abandons: <loss>
//
//   Recommendation: <option id> — <rationale>
//
//   ## 9b. Arbitrated questions          (a plan: ## Arbitrated questions)
//
//   ### <id> — <question>
//   …the same blocks, then
//   Decision: <chosen id> — lifted, unattributed, <date> | — by operator (<name>), <date>
//   Why: …  /  Earlier decision: …
//
// A section holding `None.` alone is empty. Pure: text in, value out.

/** A run of lines, 1-based and inclusive, in the whole file. */
export interface LineRange {
  readonly start: number;
  readonly end: number;
}

/** An open question as the §9 format names it: its id, its option ids in order, and the one it recommends. */
export interface ParsedQuestion {
  readonly id: string;
  readonly optionIds: readonly string[];
  /** The option id its Recommendation line names. */
  readonly recommendation: string;
  /**
   * Its whole rationale: the Recommendation line's text after `<id> — `, plus
   * its continuation paragraphs up to the `Decision:` line or the next block,
   * joined with a blank line.
   */
  readonly rationale: string;
  /** The 1-based line of its `### <id> — …` heading, in the whole file. */
  readonly line: number;
  /**
   * Its block: its heading through the line before the next question
   * heading, or through the last line of its section.
   */
  readonly range: LineRange;
}

/**
 * An arbitrated question: a parsed question, plus what its Decision line
 * chose: one of its options, or the reserved `other`.
 */
export interface ParsedArbitratedQuestion extends ParsedQuestion {
  readonly chosen: string;
  /** The Decision line reads `<chosen> — lifted…`: no arbiter is named. */
  readonly lifted: boolean;
  /** The 1-based line of its `Decision:` line, in the whole file. */
  readonly decisionLine: number;
}

/**
 * A section of the artifact: its heading line, and its range from the heading
 * through the line before the line that ends it (or the file's last line).
 */
export interface ParsedSection {
  readonly heading: number;
  readonly range: LineRange;
}

/** Where the question sections and the decision log sit; null for one the artifact lacks. */
interface ParsedSections {
  readonly open: ParsedSection | null;
  readonly arbitrated: ParsedSection | null;
  /** A spec's `## 12. Decision log`, or a plan's `## Decision log` before its first phase. */
  readonly decisionLog: ParsedSection | null;
}

/** The parsed question sections of a hand-authored artifact. */
export interface ParsedHandQuestions {
  readonly kind: "parsed";
  readonly open: readonly ParsedQuestion[];
  readonly arbitrated: readonly ParsedArbitratedQuestion[];
  readonly sections: ParsedSections;
}

export type HandAuthoredQuestions =
  | { readonly kind: "none" }
  | ParsedHandQuestions
  /** The first line that departs from the §9 format, 1-based in the whole file, frontmatter included. */
  | { readonly kind: "departs"; readonly line: number; readonly text: string };

/** How many questions an artifact holds by state: the open ones by id, in order. */
export interface QuestionSummary {
  readonly open: readonly string[];
  readonly arbitrated: number;
  readonly lifted: number;
}

/** The summary of a document's two question arrays. */
export function summarizeDocumentQuestions(arrays: {
  readonly openQuestions: ReadonlyArray<OpenQuestion>;
  readonly arbitratedQuestions: ReadonlyArray<ArbitratedQuestion>;
}): QuestionSummary {
  return {
    open: arrays.openQuestions.map((q) => q.id),
    arbitrated: arrays.arbitratedQuestions.length,
    lifted: arrays.arbitratedQuestions.filter((q) => q.verdict.kind === "lifted").length,
  };
}

/** The summary of a hand-authored artifact's parsed question sections. */
export function summarizeParsedQuestions(parsed: {
  readonly open: readonly ParsedQuestion[];
  readonly arbitrated: readonly ParsedArbitratedQuestion[];
}): QuestionSummary {
  return {
    open: parsed.open.map((q) => q.id),
    arbitrated: parsed.arbitrated.length,
    lifted: parsed.arbitrated.filter((q) => q.lifted).length,
  };
}

type SectionRole = "open" | "arbitrated";

interface Line {
  /** 1-based, in the whole file. */
  readonly n: number;
  readonly text: string;
  /** Inside a fenced code block, where nothing is a heading. */
  readonly fenced: boolean;
}

// The section headings, exact once trailing whitespace is dropped. A spec
// written before the §9 format headed its open section with the older title;
// it is still a question section, so its content must follow the format.
const SECTION_HEADINGS: Readonly<Record<ArtifactKind, Readonly<Record<string, SectionRole>>>> = {
  spec: {
    "## 9. Open questions": "open",
    "## 9. Open questions for implementation planning": "open",
    "## 9b. Arbitrated questions": "arbitrated",
  },
  plan: {
    "## Open questions": "open",
    "## Arbitrated questions": "arbitrated",
  },
};

const FENCE = /^ {0,3}(?:```|~~~)/;
// Where a question section ends. A spec's sections are numbered, so only an h1
// or the next numbered h2 ends one: a stray h2 or a thematic break inside it
// is read as part of it, and departs rather than hiding the questions after
// it. A plan's preamble has unnumbered h2s, and a thematic break opens each
// phase.
const SECTION_END: Readonly<Record<ArtifactKind, RegExp>> = {
  spec: /^#(?:\s|$)|^## \d+[a-z]?\.(?:\s|$)/,
  plan: /^#{1,2}(?:\s|$)|^ {0,3}(?:-{3,}|\*{3,}|_{3,})$/,
};
// The decision log's heading. It is not parsed, only located: a plan's only
// before its first phase, and the first one only.
const DECISION_LOG_HEADING: Readonly<Record<ArtifactKind, string>> = {
  spec: "## 12. Decision log",
  plan: "## Decision log",
};
const PHASE_HEADING = /^## phase-\d{2}\b/i;
const HEADING = /^#{1,6}(?:\s|$)/;
const QUESTION_HEADING = /^### (\S+) — \S/;
const OPTION_BULLET = /^- (\S+) — [\s\S]+ — abandons: \S/;
const RECOMMENDATION = /^Recommendation: (\S+) —(?: |$)/;
const DECISION = /^Decision: (\S+) — ([\s\S]*)$/;
// The reserved id every question implicitly offers; see OTHER_OPTION_ID in
// src/schemas/questions.ts. A Decision may choose it; an option or a
// Recommendation may not name it.
const RESERVED_ID = "other";

// Every line of the file with its 1-based number, the frontmatter skipped, and
// whether it sits inside a fenced code block.
function bodyLines(md: string): readonly Line[] {
  const all = md.split(/\r\n?|\n/);
  let start = 0;
  if (all[0] === "---") {
    const close = all.indexOf("---", 1);
    if (close > 0) start = close + 1;
  }
  const out: Line[] = [];
  let inFence = false;
  for (let i = start; i < all.length; i++) {
    const text = (all[i] ?? "").trimEnd();
    const fence = FENCE.test(text);
    out.push({ n: i + 1, text, fenced: inFence || fence });
    if (fence) inFence = !inFence;
  }
  return out;
}

type Departure = { readonly kind: "departs"; readonly line: number; readonly text: string };

function departs(line: Line): Departure {
  return { kind: "departs", line: line.n, text: line.text };
}

// The non-blank runs of a section's lines; a heading is a block of its own.
function blocksOf(lines: readonly Line[]): Line[][] {
  const blocks: Line[][] = [];
  let current: Line[] | null = null;
  for (const line of lines) {
    if (line.text.trim().length === 0) {
      current = null;
    } else if (!line.fenced && HEADING.test(line.text)) {
      blocks.push([line]);
      current = null;
    } else if (current === null) {
      current = [line];
      blocks.push(current);
    } else {
      current.push(line);
    }
  }
  return blocks;
}

// The option ids of a bullet block: each `- ` line opens an item, any other
// line continues the one before it.
function optionIdsOf(block: readonly Line[], questionId: string): string[] | Departure {
  const items: Line[][] = [];
  for (const line of block) {
    const last = items.at(-1);
    if (line.text.startsWith("- ") || last === undefined) items.push([line]);
    else last.push(line);
  }
  const ids: string[] = [];
  for (const item of items) {
    const [first] = item;
    if (first === undefined) continue;
    const match = OPTION_BULLET.exec(item.map((l) => l.text.trim()).join("\n"));
    if (match?.[1] === undefined) return departs(first);
    if (match[1] === RESERVED_ID) {
      return {
        kind: "departs",
        line: first.n,
        text: `${questionId} lists the reserved option id ${RESERVED_ID}`,
      };
    }
    ids.push(match[1]);
  }
  return ids;
}

interface Draft {
  readonly heading: Line;
  readonly id: string;
  optionIds: string[];
  stage: "heading" | "options" | "recommendation" | "decision";
  recommendation: string;
  /** The rationale's paragraphs, the Recommendation line's text first. */
  rationale: string[];
  chosen: string;
  lifted: boolean;
  decisionLine: number;
}

function parseSection(
  role: SectionRole,
  lines: readonly Line[],
  /** The section's last line, which ends its last question's block. */
  sectionEnd: number,
): { readonly questions: readonly ParsedArbitratedQuestion[] } | Departure {
  const blocks = blocksOf(lines);
  const [firstBlock] = blocks;
  if (firstBlock === undefined) return { questions: [] };
  if (firstBlock[0]?.text === "None.") {
    const after = firstBlock[1] ?? blocks[1]?.[0];
    return after === undefined ? { questions: [] } : departs(after);
  }

  const questions: ParsedArbitratedQuestion[] = [];
  let draft: Draft | null = null;
  // A question ends complete: an open one once its Recommendation is read, an
  // arbitrated one once its Decision is; otherwise it departs at its heading.
  // Its block ends at `end`: the line before the next heading, or the
  // section's last line.
  const close = (q: Draft, end: number): Departure | null => {
    const complete = role === "open" ? q.stage === "recommendation" : q.stage === "decision";
    if (!complete) return departs(q.heading);
    questions.push({
      id: q.id,
      optionIds: q.optionIds,
      recommendation: q.recommendation,
      rationale: q.rationale.join("\n\n"),
      line: q.heading.n,
      range: { start: q.heading.n, end },
      chosen: q.chosen,
      lifted: q.lifted,
      decisionLine: q.decisionLine,
    });
    return null;
  };

  for (const block of blocks) {
    const first = block[0];
    if (first === undefined) continue;
    if (!first.fenced && HEADING.test(first.text)) {
      const heading = QUESTION_HEADING.exec(first.text);
      if (heading?.[1] === undefined) return departs(first);
      if (draft !== null) {
        const closed = close(draft, first.n - 1);
        if (closed !== null) return closed;
      }
      draft = {
        heading: first,
        id: heading[1],
        optionIds: [],
        stage: "heading",
        recommendation: "",
        rationale: [],
        chosen: "",
        lifted: false,
        decisionLine: 0,
      };
      continue;
    }
    if (draft === null) return departs(first);
    switch (draft.stage) {
      case "heading":
      case "options": {
        // A loose list splits its bullets into blocks; an indented block
        // continues the bullet before it.
        if (draft.stage === "options" && /^\s/.test(first.text)) break;
        const recommendation = draft.stage === "options" ? RECOMMENDATION.exec(first.text) : null;
        if (recommendation?.[1] !== undefined) {
          if (recommendation[1] === RESERVED_ID) {
            return {
              kind: "departs",
              line: first.n,
              text: `${draft.id} recommends the reserved id ${RESERVED_ID}`,
            };
          }
          // It recommends one of the question's own options.
          if (!draft.optionIds.includes(recommendation[1])) return departs(first);
          draft.recommendation = recommendation[1];
          draft.rationale = [
            [first.text.slice(recommendation[0].length), ...block.slice(1).map((l) => l.text)]
              .join("\n")
              .trim(),
          ];
          draft.stage = "recommendation";
          break;
        }
        if (!first.text.startsWith("- ")) return departs(first);
        const ids = optionIdsOf(block, draft.id);
        if (!Array.isArray(ids)) return ids;
        draft.optionIds = [...draft.optionIds, ...ids];
        draft.stage = "options";
        break;
      }
      case "recommendation": {
        // Further paragraphs continue the rationale, until a Decision opens.
        if (first.fenced || !first.text.startsWith("Decision:")) {
          draft.rationale.push(block.map((l) => l.text).join("\n"));
          break;
        }
        const decision = DECISION.exec(block.map((l) => l.text).join("\n"));
        // It chooses one of the question's own options, or the reserved id.
        if (
          role === "open" ||
          decision?.[1] === undefined ||
          (decision[1] !== RESERVED_ID && !draft.optionIds.includes(decision[1]))
        ) {
          return departs(first);
        }
        draft.chosen = decision[1];
        draft.lifted = (decision[2] ?? "").startsWith("lifted");
        draft.decisionLine = first.n;
        draft.stage = "decision";
        break;
      }
      case "decision":
        // Why:, Earlier decision: and any prose belong to the Decision.
        break;
    }
  }
  if (draft !== null) {
    const closed = close(draft, sectionEnd);
    if (closed !== null) return closed;
  }
  return { questions };
}

interface Span {
  readonly role: SectionRole | "log";
  readonly heading: Line;
  readonly body: Line[];
}

function sectionOf(span: Span | undefined): ParsedSection | null {
  if (span === undefined) return null;
  const end = span.body.at(-1)?.n ?? span.heading.n;
  return { heading: span.heading.n, range: { start: span.heading.n, end } };
}

/**
 * Reads the question sections of a hand-authored spec or plan in the §9
 * format. `none` when the artifact has neither section; otherwise the open
 * and arbitrated questions, or the first line that departs from the format.
 * A spec's sections are `## 9. Open questions` (or the older `## 9. Open
 * questions for implementation planning`) and `## 9b. Arbitrated questions`;
 * a plan's are `## Open questions` and `## Arbitrated questions`, before its
 * first `## phase-` heading. A spec's section ends at the next h1 or
 * numbered h2; a plan's at the next h1, h2 or thematic break. A
 * Recommendation or Decision line names one of its question's options. The
 * decision log (a spec's `## 12. Decision log`, a plan's `## Decision log`
 * before its first phase) is located, never read. Each question carries its
 * block's line range and each section its own, for a writer that moves them.
 */
export function parseHandAuthoredQuestions(kind: ArtifactKind, md: string): HandAuthoredQuestions {
  const lines = bodyLines(md);
  const headings = SECTION_HEADINGS[kind];
  const spans: Span[] = [];
  let current: Span | null = null;
  let pastFirstPhase = false;
  for (const line of lines) {
    if (!line.fenced && kind === "plan" && PHASE_HEADING.test(line.text)) pastFirstPhase = true;
    const role = line.fenced ? undefined : headings[line.text];
    if (role !== undefined) {
      if (pastFirstPhase || spans.some((s) => s.role === role)) return departs(line);
      current = { role, heading: line, body: [] };
      spans.push(current);
      continue;
    }
    if (
      !line.fenced &&
      line.text === DECISION_LOG_HEADING[kind] &&
      !pastFirstPhase &&
      !spans.some((s) => s.role === "log")
    ) {
      current = { role: "log", heading: line, body: [] };
      spans.push(current);
      continue;
    }
    if (current === null) continue;
    if (!line.fenced && SECTION_END[kind].test(line.text)) {
      current = null;
      continue;
    }
    current.body.push(line);
  }
  const questionSpans = spans.filter(
    (s): s is Span & { readonly role: SectionRole } => s.role !== "log",
  );
  if (questionSpans.length === 0) return { kind: "none" };

  const open: ParsedQuestion[] = [];
  const arbitrated: ParsedArbitratedQuestion[] = [];
  for (const span of questionSpans) {
    const end = sectionOf(span)?.range.end ?? span.heading.n;
    const parsed = parseSection(span.role, span.body, end);
    if ("kind" in parsed) return parsed;
    if (span.role === "open") {
      open.push(
        ...parsed.questions.map(({ id, optionIds, recommendation, rationale, line, range }) => ({
          id,
          optionIds,
          recommendation,
          rationale,
          line,
          range,
        })),
      );
    } else {
      arbitrated.push(...parsed.questions);
    }
  }
  return {
    kind: "parsed",
    open,
    arbitrated,
    sections: {
      open: sectionOf(spans.find((s) => s.role === "open")),
      arbitrated: sectionOf(spans.find((s) => s.role === "arbitrated")),
      decisionLog: sectionOf(spans.find((s) => s.role === "log")),
    },
  };
}
