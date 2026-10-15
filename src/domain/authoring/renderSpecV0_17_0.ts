import type { SpecDocumentV0_17_0Value } from "../../schemas/persisted.js";

// The spec rendering of spec-document 0.17.0, frozen: the layout phax wrote
// for a spec sidecar stamped 0.17.0 or written before `$schema` — a single
// `## 9. Open questions for implementation planning` with positional `Q<n>`
// headings and label-only option bullets. Only `phax artifact
// migrate-documents` uses it, as the own-shape rendering of such a sidecar:
// a body that is not this rendering was edited by hand, and is not migrated.
// Self-contained on purpose — it copies the markdown helpers it needs rather
// than importing `markdown.ts`, so a later helper change cannot move it.

type Surface = SpecDocumentV0_17_0Value["surface"][number];
type Question = SpecDocumentV0_17_0Value["openQuestions"][number];

const NONE = "None.";

function finishDocument(blocks: readonly string[]): string {
  const text = blocks.join("\n\n").replace(/\r\n?/g, "\n");
  return `${text.replace(/\n+$/, "")}\n`;
}

function listItem(marker: string, text: string): string {
  const indent = " ".repeat(marker.length + 1);
  const [first = "", ...rest] = text.split(/\r\n?|\n/);
  const continuation = rest.map((line) => (line.length === 0 ? "" : `${indent}${line}`));
  return [`${marker} ${first}`, ...continuation].join("\n");
}

function bulletList(items: readonly string[]): string {
  return items.map((item) => listItem("-", item)).join("\n");
}

function inlineCode(text: string): string {
  const longestRun = Math.max(0, ...Array.from(text.matchAll(/`+/g), (m) => m[0].length));
  const fence = "`".repeat(longestRun + 1);
  const pad = text.includes("`") || (text.startsWith(" ") && text.endsWith(" ")) ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

function sentence(text: string): string {
  const trimmed = text.trimEnd();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function headingText(text: string): string {
  return text.replace(/\s*(?:\r\n?|\n)\s*/g, " ").trim();
}

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

function renderContext(doc: SpecDocumentV0_17_0Value): string {
  const blocks = ["## 1. Context", doc.context];
  if (doc.ground.length > 0) {
    blocks.push(
      "Ground read:",
      bulletList(doc.ground.map((g) => `${inlineCode(g.path)} — ${g.note}`)),
    );
  }
  return blocks.join("\n\n");
}

function renderRequirements(doc: SpecDocumentV0_17_0Value): string {
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

function renderSurface(doc: SpecDocumentV0_17_0Value): string {
  const body = doc.surface.length === 0 ? [NONE] : doc.surface.map(renderSurfaceElement);
  return ["## 6. Surface", ...body].join("\n\n");
}

function renderCriteria(doc: SpecDocumentV0_17_0Value): string {
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

function renderQuestions(doc: SpecDocumentV0_17_0Value): string {
  const body = doc.openQuestions.length === 0 ? [NONE] : doc.openQuestions.map(renderQuestion);
  return ["## 9. Open questions for implementation planning", ...body].join("\n\n");
}

function labelled(label: string, items: readonly string[]): string {
  return items.length === 0 ? `${label}: none.` : `${label}:\n\n${bulletList(items)}`;
}

function renderPlanningNote(doc: SpecDocumentV0_17_0Value): string {
  const { settled, open, constraints } = doc.planningNote;
  return [
    "## 10. Implementation-planning note",
    labelled("Settled", settled),
    labelled("Left open", open),
    labelled("Constraints", constraints),
  ].join("\n\n");
}

function renderDocsPage(doc: SpecDocumentV0_17_0Value): string {
  const page = doc.docsPage;
  const body =
    page.kind === "none"
      ? `None — ${page.why}`
      : [`Page: ${page.page}`, `Reader: ${page.reader}`, `Example: ${page.example}`].join("\n\n");
  return `## 11. Docs page\n\n${body}`;
}

/**
 * The body phax rendered for a spec document in its 0.17.0 shape: the frozen
 * value a 0.17.0 or pre-schema sidecar decodes to, without `$schema` or
 * `version`. The caller prepends the frontmatter.
 */
export function renderSpecBodyV0_17_0(doc: SpecDocumentV0_17_0Value): string {
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
