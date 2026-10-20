/**
 * phax's own reading of a phase's header lines in plan.md: Assignment reason,
 * Model reason, Mode, Oracle phase and Oracle files. Pure: no model, no I/O.
 *
 * One line grammar, shared by lint, the run preflight and (phase-03) the
 * extraction: a label is recognised at the start of a line, bold or not
 * (`**Mode:**`, `**Mode**:` or `Mode:`), case-insensitively, the tolerance the
 * model and effort lines get. Its value is the rest of the line, trimmed.
 * Inline code and code blocks are prose and never declare anything.
 */
import { fromMarkdown } from "mdast-util-from-markdown";
import { toString } from "mdast-util-to-string";
import type { Heading, Paragraph, Parent, RootContent } from "mdast";
import { splitFrontmatter } from "../artifact/frontmatter.js";

/** The declaration labels a phase may carry only in its header paragraph. */
type DeclarationLabel = "Mode" | "Oracle phase" | "Oracle files";

/** What one header paragraph's lines say. */
export interface HeaderParagraph {
  /** The `**Assignment reason:**` text, or null. */
  readonly assignmentReason: string | null;
  /** Whether a `**Model reason:**` line is present. */
  readonly hasModelReason: boolean;
  /** The raw value of the `**Mode:**` line, null when absent. */
  readonly mode: string | null;
  /** The raw value of the `**Oracle phase:**` line, null when absent. */
  readonly oraclePhase: string | null;
  /** The `**Oracle files:**` entries, null when the line is absent. */
  readonly oracleFiles: readonly string[] | null;
  /** The declaration labels that appear more than once in the header paragraph. */
  readonly repeated: readonly DeclarationLabel[];
}

export interface PhaseHeader extends HeaderParagraph {
  readonly phase: string;
  /** The declaration labels found at the start of a line of any other paragraph or list item. */
  readonly misplaced: readonly DeclarationLabel[];
}

type OracleDischarge = { readonly kind: "next" } | { readonly kind: "phase"; readonly id: string };

export interface OracleDeclaration {
  readonly dischargedBy: OracleDischarge;
  readonly files: readonly string[];
}

type LineLabel = DeclarationLabel | "Assignment reason" | "Model reason";

const LABELS: readonly LineLabel[] = [
  "Assignment reason",
  "Model reason",
  "Mode",
  "Oracle phase",
  "Oracle files",
];
const DECLARATION_LABELS: readonly DeclarationLabel[] = ["Mode", "Oracle phase", "Oracle files"];

// `**Label:** value`, `**Label**: value` or `Label: value`.
const LINE_RE = new RegExp(
  `^\\s*(?:\\*\\*\\s*)?(${LABELS.map((l) => l.replace(" ", "\\s+")).join("|")})\\s*(?::\\s*\\*\\*|\\*\\*\\s*:|:)(.*)$`,
  "i",
);

const PHASE_HEADING_RE = /^(phase-\d{2})\b/i;
const DISCHARGED_BY_RE = /^discharged by (phase-\d{2})$/;

function canonicalLabel(raw: string): LineLabel {
  const flat = raw.replace(/\s+/g, " ").toLowerCase();
  return LABELS.find((l) => l.toLowerCase() === flat)!;
}

function isDeclaration(label: LineLabel): label is DeclarationLabel {
  return (DECLARATION_LABELS as readonly string[]).includes(label);
}

interface LabelledLine {
  readonly label: LineLabel;
  readonly value: string;
}

function labelledLines(source: string): LabelledLine[] {
  const lines: LabelledLine[] = [];
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(LINE_RE);
    if (match) lines.push({ label: canonicalLabel(match[1]!), value: match[2]!.trim() });
  }
  return lines;
}

function unwrapBackticks(entry: string): string {
  return entry.length >= 2 && entry.startsWith("`") && entry.endsWith("`")
    ? entry.slice(1, -1).trim()
    : entry;
}

function splitEntries(value: string): string[] {
  return value
    .split(",")
    .map((entry) => unwrapBackticks(entry.trim()))
    .filter((entry) => entry.length > 0);
}

/**
 * The line grammar of one header paragraph's raw source text (not its
 * flattened text, which would run the lines together across soft breaks).
 * The first line of a repeated label supplies the value.
 */
export function readHeaderParagraph(source: string): HeaderParagraph {
  const lines = labelledLines(source);
  const first = (label: LineLabel): string | null =>
    lines.find((l) => l.label === label)?.value ?? null;
  const oracleFiles = first("Oracle files");
  const assignmentReason = first("Assignment reason");
  return {
    assignmentReason:
      assignmentReason === null || assignmentReason === "" ? null : assignmentReason,
    hasModelReason: lines.some((l) => l.label === "Model reason"),
    mode: first("Mode"),
    oraclePhase: first("Oracle phase"),
    oracleFiles: oracleFiles === null ? null : splitEntries(oracleFiles),
    repeated: DECLARATION_LABELS.filter(
      (label) => lines.filter((l) => l.label === label).length > 1,
    ),
  };
}

function isRootH2(node: RootContent): node is Heading {
  return node.type === "heading" && node.depth === 2;
}

// Every paragraph below `node`, however deeply nested in lists or quotes.
// Code blocks are a different node type and never yield a paragraph.
function paragraphsOf(node: RootContent): Paragraph[] {
  if (node.type === "paragraph") return [node];
  if ("children" in node && node.type !== "heading") {
    return (node as Parent).children.flatMap((child) => paragraphsOf(child as RootContent));
  }
  return [];
}

function sourceOf(body: string, node: RootContent): string {
  return body.slice(node.position?.start.offset ?? 0, node.position?.end.offset ?? 0);
}

function readPhaseBlock(phase: string, nodes: readonly RootContent[], body: string): PhaseHeader {
  const headerNode = nodes.find(
    (n): n is Paragraph => n.type === "paragraph" && /Recommended\s+model:/i.test(toString(n)),
  );
  const header = readHeaderParagraph(headerNode === undefined ? "" : sourceOf(body, headerNode));
  const misplaced = new Set<DeclarationLabel>();
  for (const node of nodes) {
    for (const paragraph of paragraphsOf(node)) {
      if (paragraph === headerNode) continue;
      for (const line of labelledLines(sourceOf(body, paragraph))) {
        if (isDeclaration(line.label)) misplaced.add(line.label);
      }
    }
  }
  return {
    phase,
    ...header,
    misplaced: DECLARATION_LABELS.filter((label) => misplaced.has(label)),
  };
}

/**
 * One `PhaseHeader` per root-level `## phase-NN` heading, in document order,
 * the frontmatter skipped. Same heading recognition as the deterministic
 * parser: a non-phase `##` heading closes the open phase; the header paragraph
 * is the first root-level paragraph of the phase block that carries
 * `Recommended model:`.
 */
export function readPhaseHeaders(planMd: string): readonly PhaseHeader[] {
  const body = splitFrontmatter(planMd)?.body ?? planMd;
  const root = fromMarkdown(body);
  const headers: PhaseHeader[] = [];
  let current: { phase: string; nodes: RootContent[] } | null = null;
  const close = (): void => {
    if (current) headers.push(readPhaseBlock(current.phase, current.nodes, body));
    current = null;
  };
  for (const child of root.children) {
    if (isRootH2(child)) {
      close();
      const idMatch = toString(child).trim().match(PHASE_HEADING_RE);
      if (idMatch) current = { phase: idMatch[1]!.toLowerCase(), nodes: [] };
      continue;
    }
    if (current) current.nodes.push(child);
  }
  close();
  return headers;
}

/** True exactly when the Mode value is `interactive`. */
export function declaresInteractive(header: PhaseHeader): boolean {
  return header.mode === "interactive";
}

/**
 * The phase's oracle declaration when it is well formed: both oracle lines
 * appear exactly once and only in the header paragraph, and the Oracle phase
 * value is exactly `yes` or `discharged by phase-NN`. Null otherwise.
 */
export function oracleDeclaration(header: PhaseHeader): OracleDeclaration | null {
  if (header.oraclePhase === null || header.oracleFiles === null) return null;
  const oracleLabels: readonly DeclarationLabel[] = ["Oracle phase", "Oracle files"];
  if (oracleLabels.some((l) => header.repeated.includes(l) || header.misplaced.includes(l))) {
    return null;
  }
  if (header.oraclePhase === "yes") {
    return { dischargedBy: { kind: "next" }, files: header.oracleFiles };
  }
  const discharged = header.oraclePhase.match(DISCHARGED_BY_RE);
  if (discharged === null) return null;
  return { dischargedBy: { kind: "phase", id: discharged[1]! }, files: header.oracleFiles };
}
