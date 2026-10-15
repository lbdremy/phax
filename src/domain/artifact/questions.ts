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

/** An open question as the §9 format names it: its id and its option ids, in order. */
export interface ParsedQuestion {
  readonly id: string;
  readonly optionIds: readonly string[];
  /** The 1-based line of its `### <id> — …` heading, in the whole file. */
  readonly line: number;
}

/** An arbitrated question: a parsed question, plus the option its Decision line chose. */
export interface ParsedArbitratedQuestion extends ParsedQuestion {
  readonly chosen: string;
  /** The Decision line reads `<chosen> — lifted…`: no arbiter is named. */
  readonly lifted: boolean;
}

export type HandAuthoredQuestions =
  | { readonly kind: "none" }
  | {
      readonly kind: "parsed";
      readonly open: readonly ParsedQuestion[];
      readonly arbitrated: readonly ParsedArbitratedQuestion[];
    }
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
const SECTION_END = /^#{1,2}(?:\s|$)|^ {0,3}(?:-{3,}|\*{3,}|_{3,})$/;
const PHASE_HEADING = /^## phase-\d{2}\b/i;
const HEADING = /^#{1,6}(?:\s|$)/;
const QUESTION_HEADING = /^### (\S+) — \S/;
const OPTION_BULLET = /^- (\S+) — [\s\S]+ — abandons: \S/;
const RECOMMENDATION = /^Recommendation: \S+ —(?: |$)/;
const DECISION = /^Decision: (\S+) — ([\s\S]*)$/;

// Every line of the file with its 1-based number, the frontmatter skipped, and
// whether it sits inside a fenced code block (where nothing is a heading).
function bodyLines(md: string): readonly (Line & { readonly fenced: boolean })[] {
  const all = md.split(/\r\n?|\n/);
  let start = 0;
  if (all[0] === "---") {
    const close = all.indexOf("---", 1);
    if (close > 0) start = close + 1;
  }
  const out: (Line & { readonly fenced: boolean })[] = [];
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
    } else if (HEADING.test(line.text)) {
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
function optionIdsOf(block: readonly Line[]): string[] | Departure {
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
    ids.push(match[1]);
  }
  return ids;
}

interface Draft {
  readonly heading: Line;
  readonly id: string;
  optionIds: string[];
  stage: "heading" | "options" | "recommendation" | "decision";
  chosen: string;
  lifted: boolean;
}

function parseSection(
  role: SectionRole,
  lines: readonly Line[],
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
  const close = (q: Draft): Departure | null => {
    const complete = role === "open" ? q.stage === "recommendation" : q.stage === "decision";
    if (!complete) return departs(q.heading);
    questions.push({
      id: q.id,
      optionIds: q.optionIds,
      line: q.heading.n,
      chosen: q.chosen,
      lifted: q.lifted,
    });
    return null;
  };

  for (const block of blocks) {
    const first = block[0];
    if (first === undefined) continue;
    if (HEADING.test(first.text)) {
      const heading = QUESTION_HEADING.exec(first.text);
      if (heading?.[1] === undefined) return departs(first);
      if (draft !== null) {
        const closed = close(draft);
        if (closed !== null) return closed;
      }
      draft = {
        heading: first,
        id: heading[1],
        optionIds: [],
        stage: "heading",
        chosen: "",
        lifted: false,
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
        if (draft.stage === "options" && RECOMMENDATION.test(first.text)) {
          draft.stage = "recommendation";
          break;
        }
        if (!first.text.startsWith("- ")) return departs(first);
        const ids = optionIdsOf(block);
        if (!Array.isArray(ids)) return ids;
        draft.optionIds = [...draft.optionIds, ...ids];
        draft.stage = "options";
        break;
      }
      case "recommendation": {
        // Further paragraphs continue the rationale, until a Decision opens.
        if (!first.text.startsWith("Decision:")) break;
        const decision = DECISION.exec(block.map((l) => l.text).join("\n"));
        if (role === "open" || decision?.[1] === undefined) return departs(first);
        draft.chosen = decision[1];
        draft.lifted = (decision[2] ?? "").startsWith("lifted");
        draft.stage = "decision";
        break;
      }
      case "decision":
        // Why:, Earlier decision: and any prose belong to the Decision.
        break;
    }
  }
  if (draft !== null) {
    const closed = close(draft);
    if (closed !== null) return closed;
  }
  return { questions };
}

/**
 * Reads the question sections of a hand-authored spec or plan in the §9
 * format. `none` when the artifact has neither section; otherwise the open
 * and arbitrated questions, or the first line that departs from the format.
 * A spec's sections are `## 9. Open questions` (or the older `## 9. Open
 * questions for implementation planning`) and `## 9b. Arbitrated questions`;
 * a plan's are `## Open questions` and `## Arbitrated questions`, before its
 * first `## phase-` heading. A section ends at the next h1 or h2 (or a
 * thematic break); the decision log is not read.
 */
export function parseHandAuthoredQuestions(kind: ArtifactKind, md: string): HandAuthoredQuestions {
  const lines = bodyLines(md);
  const headings = SECTION_HEADINGS[kind];
  const sections: { role: SectionRole; heading: Line; body: Line[] }[] = [];
  let current: { role: SectionRole; heading: Line; body: Line[] } | null = null;
  let pastFirstPhase = false;
  for (const line of lines) {
    if (!line.fenced && kind === "plan" && PHASE_HEADING.test(line.text)) pastFirstPhase = true;
    const role = line.fenced ? undefined : headings[line.text];
    if (role !== undefined) {
      if (pastFirstPhase || sections.some((s) => s.role === role)) return departs(line);
      current = { role, heading: line, body: [] };
      sections.push(current);
      continue;
    }
    if (current === null) continue;
    if (!line.fenced && SECTION_END.test(line.text)) {
      current = null;
      continue;
    }
    current.body.push(line);
  }
  if (sections.length === 0) return { kind: "none" };

  const open: ParsedQuestion[] = [];
  const arbitrated: ParsedArbitratedQuestion[] = [];
  for (const section of sections) {
    const parsed = parseSection(section.role, section.body);
    if ("kind" in parsed) return parsed;
    if (section.role === "open") {
      open.push(...parsed.questions.map(({ id, optionIds, line }) => ({ id, optionIds, line })));
    } else {
      arbitrated.push(...parsed.questions);
    }
  }
  return { kind: "parsed", open, arbitrated };
}
