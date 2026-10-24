import type { SpecDocument } from "../../schemas/specDocument.js";
import { bulletList, finishDocument, headingText, inlineCode, sentence } from "./markdown.js";
import {
  renderArbitratedQuestion,
  renderDecisionLog,
  renderOpenQuestion,
} from "./renderQuestions.js";

// Renders a spec document to the canonical ten-section spec plus `## 11. Docs
// page`. Requirements are numbered 5.N by position and acceptance-criterion
// refs cite that number, so a ref always names a heading that exists whatever
// the document's id scheme. Questions are named by id: §9 holds the open ones,
// §9b the arbitrated ones with their Decision blocks, and `## 12. Decision
// log` follows when any question is arbitrated. The body only: the caller
// prepends the frontmatter. Prose is emitted as given — nothing is wrapped or
// reflowed. A surface element prints its heading, a `Summary:` line, then its
// blocks. The 0.25.0 layout (no summary line) is frozen in renderSpecV0_25_0.ts
// and the 0.17.0 layout in renderSpecV0_17_0.ts.

type Surface = SpecDocument["surface"][number];

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
  return `${heading}\n\nSummary: ${element.summary}\n\n${body}`;
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

function renderOpenQuestions(doc: SpecDocument): string {
  const body = doc.openQuestions.length === 0 ? [NONE] : doc.openQuestions.map(renderOpenQuestion);
  return ["## 9. Open questions", ...body].join("\n\n");
}

function renderArbitratedQuestions(doc: SpecDocument): string {
  const body =
    doc.arbitratedQuestions.length === 0
      ? [NONE]
      : doc.arbitratedQuestions.map(renderArbitratedQuestion);
  return ["## 9b. Arbitrated questions", ...body].join("\n\n");
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

/** Takes the in-memory document: an authored one or a sidecar read back, neither `version` nor `$schema` matters. */
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
    renderOpenQuestions(doc),
    renderArbitratedQuestions(doc),
    renderPlanningNote(doc),
    renderDocsPage(doc),
    ...(doc.arbitratedQuestions.length === 0
      ? []
      : [`## 12. Decision log\n\n${renderDecisionLog(doc.arbitratedQuestions)}`]),
  ]);
}
