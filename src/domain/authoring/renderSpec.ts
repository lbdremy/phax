import type { SpecDocument } from "../../schemas/specDocument.js";
import { bulletList, finishDocument, headingText, inlineCode, sentence } from "./markdown.js";

// Renders a spec document to the canonical ten-section spec plus `## 11. Docs
// page`. Requirements are numbered 5.N by position and acceptance-criterion
// refs cite that number, so a ref always names a heading that exists whatever
// the document's id scheme. The body only: the caller prepends the frontmatter.
// Prose is emitted as given — nothing is wrapped or reflowed.

type Surface = SpecDocument["surface"][number];
type Question = SpecDocument["openQuestions"][number];

const NONE = "None.";

function listOrNone(items: readonly string[]): string {
  return items.length === 0 ? NONE : bulletList(items);
}

function indentBlock(text: string): string {
  return text
    .split(/\r\n?|\n/)
    .map((line) => (line.length === 0 ? "" : `    ${line}`))
    .join("\n");
}

function labelledBlock(label: string, text: string): string {
  return text.length === 0 ? `${label} (empty)` : `${label}\n\n${indentBlock(text)}`;
}

function blockquote(text: string): string {
  return text
    .split(/\r\n?|\n/)
    .map((line) => (line.length === 0 ? ">" : `> ${line}`))
    .join("\n");
}

function renderContext(doc: SpecDocument): string {
  const blocks = ["## 1. Context", doc.context];
  if (doc.ground.length > 0) {
    blocks.push(
      "Ground read:",
      bulletList(doc.ground.map((g) => `${inlineCode(g.path)} — ${g.note}`)),
    );
  }
  return blocks.join("\n\n");
}

function renderRequirements(doc: SpecDocument): string {
  const subsections = doc.requirements.map(
    (r, i) => `### 5.${String(i + 1)} ${headingText(r.title)}\n\n${r.statement}`,
  );
  return ["## 5. Functional requirements", ...subsections].join("\n\n");
}

function renderSurfaceElement(element: Surface): string {
  const heading = `### ${headingText(element.surface)} — ${element.binding}`;
  const body =
    element.before === null
      ? indentBlock(element.after)
      : `${labelledBlock("before:", element.before)}\n\n${labelledBlock("after:", element.after)}`;
  return `${heading}\n\n${body}`;
}

function renderSurface(doc: SpecDocument): string {
  const body = doc.surface.length === 0 ? [NONE] : doc.surface.map(renderSurfaceElement);
  return ["## 6. Surface", ...body].join("\n\n");
}

function renderCriteria(doc: SpecDocument): string {
  const numberOf = new Map(doc.requirements.map((r, i) => [r.id, `§5.${String(i + 1)}`]));
  const criteria = doc.acceptanceCriteria.map((c) => {
    const refs = c.refs.map((ref) => numberOf.get(ref) ?? `§${ref}`).join(", ");
    const statement = sentence(`Given ${c.given}, when ${c.when}, then ${c.then}`);
    return `### ${headingText(c.name)}\n\n${statement} (refs ${refs})`;
  });
  return ["## 8. Acceptance criteria", ...criteria].join("\n\n");
}

function renderQuestion(question: Question, index: number): string {
  const options = bulletList(question.options.map((o) => `${o.label} — abandons: ${o.abandons}`));
  const recommended =
    question.options.find((o) => o.id === question.recommendation)?.label ??
    question.recommendation;
  return [
    `### Q${String(index + 1)} — ${headingText(question.question)}`,
    options,
    `Recommendation: ${recommended} — ${sentence(question.rationale)}`,
  ].join("\n\n");
}

function renderQuestions(doc: SpecDocument): string {
  const body = doc.openQuestions.length === 0 ? [NONE] : doc.openQuestions.map(renderQuestion);
  return ["## 9. Open questions for implementation planning", ...body].join("\n\n");
}

function labelled(label: string, items: readonly string[]): string {
  return items.length === 0 ? `${label}: none.` : `${label}:\n\n${bulletList(items)}`;
}

function renderPlanningNote(doc: SpecDocument): string {
  const { settled, open, constraints } = doc.planningNote;
  return [
    "## 10. Implementation-planning note",
    labelled("Settled", settled),
    labelled("Left open", open),
    labelled("Constraints", constraints),
  ].join("\n\n");
}

function renderDocsPage(doc: SpecDocument): string {
  const page = doc.docsPage;
  const body =
    page.kind === "none"
      ? `None — ${page.why}`
      : [`Page: ${page.page}`, `Reader: ${page.reader}`, `Example: ${page.example}`].join("\n\n");
  return `## 11. Docs page\n\n${body}`;
}

export function renderSpecBody(doc: SpecDocument): string {
  return finishDocument([
    `# ${headingText(doc.title)}`,
    renderContext(doc),
    `## 2. Problem\n\n${doc.problem}`,
    `## 3. Product goal\n\n${doc.productGoal.statement}\n\n${blockquote(doc.productGoal.guidingRule)}`,
    `## 4. Terminology\n\n${listOrNone(doc.terminology.map((t) => `**${t.term}** — ${t.definition}`))}`,
    renderRequirements(doc),
    renderSurface(doc),
    `## 7. Non-goals\n\n${listOrNone(doc.nonGoals)}`,
    renderCriteria(doc),
    renderQuestions(doc),
    renderPlanningNote(doc),
    renderDocsPage(doc),
  ]);
}
