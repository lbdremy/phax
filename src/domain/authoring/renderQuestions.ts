import type {
  OpenQuestion,
  PlanArbitratedQuestion,
  PlanVerdict,
  SpecArbitratedQuestion,
  SpecVerdict,
} from "../../schemas/questions.js";
import { bulletList, headingText, sentence } from "./markdown.js";

// The question sections the spec and plan renderers share, in the §9 format
// that `parseHandAuthoredQuestions` (src/domain/artifact/questions.ts) reads
// back: every question headed by its id, every option bullet and the
// Recommendation line opening with an option id, and under an arbitrated
// question its Decision block. The wording of the Decision block and the
// decision log is indicative; the line shapes the parser reads are not.

export type ArbitratedQuestion = SpecArbitratedQuestion | PlanArbitratedQuestion;
type Verdict = SpecVerdict | PlanVerdict;

function questionBlocks(question: OpenQuestion): string[] {
  return [
    `### ${question.id} — ${headingText(question.question)}`,
    bulletList(question.options.map((o) => `${o.id} — ${o.label} — abandons: ${o.abandons}`)),
    `Recommendation: ${question.recommendation} — ${sentence(question.rationale)}`,
  ];
}

// `<chosen> — lifted, unattributed, <date>` or `<chosen> — by operator (<name>), <date>`.
function verdictLine(verdict: Verdict): string {
  return verdict.kind === "lifted"
    ? `${verdict.chosen} — lifted, unattributed, ${verdict.at}`
    : `${verdict.chosen} — by operator (${headingText(verdict.by.name)}), ${dateOf(verdict)}`;
}

function listOrNone(items: readonly string[]): string {
  return items.length === 0 ? "none" : items.join(", ");
}

function decisionBlock(question: ArbitratedQuestion): string {
  const { verdict } = question;
  const lines = [`Decision: ${verdictLine(verdict)}`];
  if (verdict.kind === "decided") {
    const phase = "phase" in verdict ? ` Phase: ${verdict.phase}.` : "";
    lines.push(
      `Why: ${sentence(verdict.why)} Advocate: ${sentence(verdict.advocate)} ` +
        `Principles: ${listOrNone(verdict.principles)}. Reversibility: ${verdict.reversibility}. ` +
        `Revised: ${listOrNone(verdict.revised)}.${phase}`,
    );
  }
  for (const earlier of question.history) lines.push(`Earlier decision: ${verdictLine(earlier)}`);
  return lines.join("\n");
}

/** An open question: its heading, its option bullets and its Recommendation line. */
export function renderOpenQuestion(question: OpenQuestion): string {
  return questionBlocks(question).join("\n\n");
}

/** An arbitrated question: an open question's blocks, then its Decision block. */
export function renderArbitratedQuestion(question: ArbitratedQuestion): string {
  return [...questionBlocks(question), decisionBlock(question)].join("\n\n");
}

/** The date a verdict was reached: a lifted verdict's date, a decided one's timestamp's date. */
function dateOf(verdict: Verdict): string {
  return verdict.at.slice(0, 10);
}

function logEntry(id: string, verdict: Verdict): string {
  const date = dateOf(verdict);
  if (verdict.kind === "lifted") return `${date} ${id} lifted ${verdict.chosen} — unattributed`;
  const n = verdict.revised.length;
  const revised = n === 0 ? "" : ` — revised ${String(n)} ${n === 1 ? "section" : "sections"}`;
  return `${date} ${id} decided ${verdict.chosen} — operator (${headingText(verdict.by.name)})${revised}`;
}

/**
 * The decision log: one bullet per verdict, current and earlier, ordered by
 * date; verdicts of the same date keep document order (question by question,
 * each question's history before its current verdict).
 */
export function renderDecisionLog(questions: ReadonlyArray<ArbitratedQuestion>): string {
  const entries = questions.flatMap((q) =>
    [...q.history, q.verdict].map((verdict) => ({
      date: dateOf(verdict),
      line: logEntry(q.id, verdict),
    })),
  );
  const ordered = entries.toSorted((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return bulletList(ordered.map((e) => e.line));
}
