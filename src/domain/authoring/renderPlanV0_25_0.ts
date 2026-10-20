import type { PlanDocumentV0_25_0Value } from "../../schemas/persisted.js";

// The plan rendering of plan-document 0.25.0, frozen: the layout phax 0.25.0
// wrote for a plan sidecar, `**Model reason:**` line included. Only `phax
// artifact migrate-documents` uses it, as the own-shape rendering of a 0.25.0
// sidecar: a body that is not this rendering was edited by hand, and is not
// migrated. Self-contained on purpose — it copies the markdown helpers and the
// question renderers it needs rather than importing `markdown.ts` or
// `renderQuestions.ts`, so a later change to them cannot move it.

type Phase = PlanDocumentV0_25_0Value["phases"][number];
type OpenQuestion = PlanDocumentV0_25_0Value["preamble"]["openQuestions"][number];
type ArbitratedQuestion = PlanDocumentV0_25_0Value["preamble"]["arbitratedQuestions"][number];
type Verdict = ArbitratedQuestion["verdict"];

const NONE = "- (none)";

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

// The run title is read back as the H1's flattened text, which drops inline
// markup; escaping it keeps backticks, emphasis markers and brackets literal.
function escapeInline(text: string): string {
  return text.replace(/[\\`*_[\]<>&#]/g, (ch) => `\\${ch}`);
}

function questionBlocks(question: OpenQuestion): string[] {
  return [
    `### ${question.id} — ${headingText(question.question)}`,
    bulletList(question.options.map((o) => `${o.id} — ${o.label} — abandons: ${o.abandons}`)),
    `Recommendation: ${question.recommendation} — ${sentence(question.rationale)}`,
  ];
}

function dateOf(verdict: Verdict): string {
  return verdict.at.slice(0, 10);
}

function verdictLine(verdict: Verdict): string {
  return verdict.kind === "lifted"
    ? `${verdict.chosen} — lifted, unattributed, ${verdict.at}`
    : `${verdict.chosen} — by operator (${headingText(verdict.by.name)}), ${dateOf(verdict)}`;
}

function listOrNoneText(items: readonly string[]): string {
  return items.length === 0 ? "none" : items.join(", ");
}

function verdictDecision(verdict: Verdict): string {
  const lines = [`Decision: ${verdictLine(verdict)}`];
  if (verdict.kind === "decided") {
    const phase = "phase" in verdict ? ` Phase: ${verdict.phase}.` : "";
    lines.push(
      `Why: ${sentence(verdict.why)} Advocate: ${sentence(verdict.advocate)} ` +
        `Principles: ${listOrNoneText(verdict.principles)}. Reversibility: ${verdict.reversibility}. ` +
        `Revised: ${listOrNoneText(verdict.revised)}.${phase}`,
    );
  }
  return lines.join("\n");
}

function decisionBlock(question: ArbitratedQuestion): string {
  const lines = [verdictDecision(question.verdict)];
  for (const earlier of question.history) lines.push(`Earlier decision: ${verdictLine(earlier)}`);
  return lines.join("\n");
}

function renderOpenQuestion(question: OpenQuestion): string {
  return questionBlocks(question).join("\n\n");
}

function renderArbitratedQuestion(question: ArbitratedQuestion): string {
  return [...questionBlocks(question), decisionBlock(question)].join("\n\n");
}

function decisionLogEntry(id: string, verdict: Verdict): string {
  const date = dateOf(verdict);
  if (verdict.kind === "lifted") return `${date} ${id} lifted ${verdict.chosen} — unattributed`;
  const n = verdict.revised.length;
  const revised = n === 0 ? "" : ` — revised ${String(n)} ${n === 1 ? "section" : "sections"}`;
  return `${date} ${id} decided ${verdict.chosen} — operator (${headingText(verdict.by.name)})${revised}`;
}

function renderDecisionLog(questions: ReadonlyArray<ArbitratedQuestion>): string {
  const entries = questions.flatMap((q) =>
    [...q.history, q.verdict].map((verdict) => ({
      date: dateOf(verdict),
      line: decisionLogEntry(q.id, verdict),
    })),
  );
  const ordered = entries.toSorted((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return bulletList(ordered.map((e) => e.line));
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

function renderPhase(phase: Phase): string {
  const blocks = [
    "---",
    `## ${phase.id} — ${headingText(phase.title)} {${anchorOf(phase.planMarkdownAnchor)}}`,
    `**Recommended model:** ${phase.model}\n**Recommended effort:** ${phase.effort}${
      phase.modelReason === null ? "" : `\n**Model reason:** ${phase.modelReason}`
    }`,
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

function renderPreambleQuestions(preamble: PlanDocumentV0_25_0Value["preamble"]): string[] {
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

/** The body phax 0.25.0 rendered for a plan sidecar: no frontmatter. */
export function renderPlanBodyV0_25_0(doc: PlanDocumentV0_25_0Value): string {
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
