import type { PlanDocument, PlanDocumentPhase } from "../../schemas/planDocument.js";
import type { TestLine } from "../../schemas/testLine.js";
import { renderTestLine } from "../plan/testLineGrammar.js";
import { bulletList, finishDocument, headingText, inlineCode, listItem } from "./markdown.js";
import {
  renderArbitratedQuestion,
  renderDecisionLog,
  renderOpenQuestion,
} from "./renderQuestions.js";

// Renders a plan document to the phax-planning shape. The deterministic parser
// (src/domain/plan/parsePlanMarkdown.ts) is the oracle: rendering then parsing
// yields the document's projection. Extracted values are therefore emitted in
// forms whose flattened text is exactly the value — file paths, required
// commands and the commit subject as code spans, the run title with its inline
// markup escaped — while informational prose (a phase's assignment reason
// included) is emitted as given. A phase's test lines are written verbatim in
// the line format, so `readTestStrategyText` of the rendered `### Test
// strategy` section returns the document's lines. The body only: the caller
// prepends the frontmatter.

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

// One `- ` line per test line, verbatim: never through the inline escaping,
// so backticks and code spans round-trip byte for byte.
function testLines(lines: readonly TestLine[]): string {
  return lines.length === 0 ? NONE : lines.map((line) => `- ${renderTestLine(line)}`).join("\n");
}

function anchorOf(planMarkdownAnchor: string): string {
  return planMarkdownAnchor.startsWith("#") ? planMarkdownAnchor : `#${planMarkdownAnchor}`;
}

function section(title: string, content: string): string {
  return `### ${title}\n\n${content}`;
}

// The header paragraph: model and effort, the optional assignment reason, then
// the phase's kinds. A headless phase writes no Mode line and a null oracle no
// oracle line; an oracle always names its discharging phase, so it reads back
// unchanged wherever the phase sits.
function headerLines(phase: PlanDocumentPhase): string[] {
  return [
    `**Recommended model:** ${phase.model}`,
    `**Recommended effort:** ${phase.effort}`,
    ...(phase.assignmentReason === null
      ? []
      : [`**Assignment reason:** ${phase.assignmentReason}`]),
    ...(phase.mode === "interactive" ? ["**Mode:** interactive"] : []),
    ...(phase.oracle === null
      ? []
      : [
          `**Oracle phase:** discharged by ${phase.oracle.dischargedBy}`,
          `**Oracle files:** ${phase.oracle.files.map(inlineCode).join(", ")}`,
        ]),
  ];
}

function renderPhase(phase: PlanDocumentPhase): string {
  const blocks = [
    "---",
    `## ${phase.id} — ${headingText(phase.title)} {${anchorOf(phase.planMarkdownAnchor)}}`,
    headerLines(phase).join("\n"),
    phase.objective,
    section("Detailed instructions", proseList(phase.detailedInstructions)),
    section("Planned files to create", codeList(phase.plannedFilesToCreate)),
    section("Planned files to edit", codeList(phase.plannedFilesToEdit)),
    section("Optional files that may be edited", codeList(phase.optionalFilesToEdit)),
    ...(phase.boundaryContracts === null
      ? []
      : [section("Boundary contracts", phase.boundaryContracts)]),
    section("Test strategy", testLines(phase.testStrategy)),
    section("Implementation order", orderedList(phase.implementationOrder)),
    section("Excluded scope", proseList(phase.excludedScope)),
    section("Verification", phase.verification),
    section("Expected handoff content", phase.expectedHandoff),
    section("Commit subject", inlineCode(phase.commit.subject)),
    section("Commit body", phase.commit.body),
  ];
  return blocks.join("\n\n");
}

// The preamble's question sections, each only when non-empty, so a plan
// without questions renders exactly as it did before questions existed. They
// sit before the first phase heading, where the deterministic parser reads
// only `## Required commands`.
function renderPreambleQuestions(preamble: PlanDocument["preamble"]): string[] {
  const { openQuestions, arbitratedQuestions } = preamble;
  return [
    ...(openQuestions.length === 0
      ? []
      : [["## Open questions", ...openQuestions.map(renderOpenQuestion)].join("\n\n")]),
    ...(arbitratedQuestions.length === 0
      ? []
      : [
          ["## Arbitrated questions", ...arbitratedQuestions.map(renderArbitratedQuestion)].join(
            "\n\n",
          ),
          `## Decision log\n\n${renderDecisionLog(arbitratedQuestions)}`,
        ]),
  ];
}

/** Takes the in-memory document: an authored one or a sidecar read back, neither `version` nor `$schema` matters. */
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
    ...renderPreambleQuestions(preamble),
    ...doc.phases.map(renderPhase),
  ];
  return finishDocument(blocks);
}
