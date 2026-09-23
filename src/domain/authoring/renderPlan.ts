import type { PlanDocument, PlanDocumentPhase } from "../../schemas/planDocument.js";
import { bulletList, finishDocument, headingText, inlineCode, listItem } from "./markdown.js";

// Renders a plan document to the phax-planning shape. The deterministic parser
// (src/domain/plan/parsePlanMarkdown.ts) is the oracle: rendering then parsing
// yields the document's projection. Extracted values are therefore emitted in
// forms whose flattened text is exactly the value — file paths, required
// commands and the commit subject as code spans, the run title with its inline
// markup escaped — while informational prose is emitted as given. The body only:
// the caller prepends the frontmatter.

const NONE = "- (none)";

// The run title is read back as the H1's flattened text, which drops inline
// markup; escaping it keeps backticks, emphasis markers and brackets literal.
function escapeInline(text: string): string {
  return text.replace(/[\\`*_[\]<>&#]/g, (ch) => `\\${ch}`);
}

function listOrNone(items: readonly string[], render: (items: readonly string[]) => string) {
  return items.length === 0 ? NONE : render(items);
}

function codeList(items: readonly string[]): string {
  return listOrNone(items, (xs) => bulletList(xs.map(inlineCode)));
}

function proseList(items: readonly string[]): string {
  return listOrNone(items, bulletList);
}

function orderedList(items: readonly string[]): string {
  return listOrNone(items, (xs) => xs.map((x, i) => listItem(`${String(i + 1)}.`, x)).join("\n"));
}

function anchorOf(planMarkdownAnchor: string): string {
  return planMarkdownAnchor.startsWith("#") ? planMarkdownAnchor : `#${planMarkdownAnchor}`;
}

function section(title: string, content: string): string {
  return `### ${title}\n\n${content}`;
}

function renderPhase(phase: PlanDocumentPhase): string {
  const blocks = [
    "---",
    `## ${phase.id} — ${headingText(phase.title)} {${anchorOf(phase.planMarkdownAnchor)}}`,
    `**Recommended model:** ${phase.model}\n**Recommended effort:** ${phase.effort}`,
    phase.objective,
    section("Detailed instructions", proseList(phase.detailedInstructions)),
    section("Planned files to create", codeList(phase.plannedFilesToCreate)),
    section("Planned files to edit", codeList(phase.plannedFilesToEdit)),
    section("Optional files that may be edited", codeList(phase.optionalFilesToEdit)),
    ...(phase.boundaryContracts === null
      ? []
      : [section("Boundary contracts", phase.boundaryContracts)]),
    section("Test strategy", phase.testStrategy),
    section("Implementation order", orderedList(phase.implementationOrder)),
    section("Excluded scope", proseList(phase.excludedScope)),
    section("Verification", phase.verification),
    section("Expected handoff content", phase.expectedHandoff),
    section("Commit subject", inlineCode(phase.commit.subject)),
    section("Commit body", phase.commit.body),
  ];
  return blocks.join("\n\n");
}

export function renderPlanBody(doc: PlanDocument): string {
  const { preamble, run } = doc;
  const blocks = [
    `# ${escapeInline(headingText(run.title))}`,
    preamble.summary,
    `## Required commands\n\n${codeList(run.requiredCommands)}`,
    preamble.requiredCommandsNote,
    ...(preamble.technicalArbitrations.length === 0
      ? []
      : [`## Technical arbitrations\n\n${bulletList(preamble.technicalArbitrations)}`]),
    ...doc.phases.map(renderPhase),
  ];
  return finishDocument(blocks);
}
