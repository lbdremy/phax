/**
 * phax's own reading of a phase's header lines in plan.md: Assignment reason,
 * Mode, Acceptance phase and Acceptance test files, and the old labels Model
 * reason, Oracle phase and Oracle files, recognised only to be refused by
 * name. Pure: no model, no I/O.
 *
 * One line grammar, shared by lint, the run preflight and both extraction
 * paths (`phaseKinds`): a label is recognised at the start of a line, bold or not
 * (`**Mode:**`, `**Mode**:` or `Mode:`, with `*`/`_` emphasis and after
 * blockquote markers), case-insensitively. Its value is the rest of the line, trimmed.
 * Inline code and code blocks are prose and never declare anything.
 */
import { fromMarkdown } from "mdast-util-from-markdown";
import { toString } from "mdast-util-to-string";
import type { Heading, Paragraph, Parent, RootContent } from "mdast";
import { Result } from "effect";
import type { PhaseAcceptance, PhaseMode } from "../../schemas/phaxPlan.js";
import type { ExtractionPlan } from "../../schemas/planExtraction.js";
import { splitFrontmatter } from "../artifact/frontmatter.js";
import { PlanValidationError } from "../errors.js";

/** The declaration labels a phase may carry only in its header paragraph. */
type DeclarationLabel = "Mode" | "Acceptance phase" | "Acceptance test files";

/** The labels no longer read: recognised anywhere in a phase, never declarations. */
type OldLabel = "Model reason" | "Oracle phase" | "Oracle files";

/** What one header paragraph's lines say. */
export interface HeaderParagraph {
  /** The `**Assignment reason:**` text, or null. */
  readonly assignmentReason: string | null;
  /** Whether a `**Model reason:**` line is present. */
  readonly hasModelReason: boolean;
  /** The raw value of the `**Mode:**` line, null when absent. */
  readonly mode: string | null;
  /** The raw value of the `**Acceptance phase:**` line, null when absent. */
  readonly acceptancePhase: string | null;
  /** The `**Acceptance test files:**` entries, null when the line is absent. */
  readonly acceptanceFiles: readonly string[] | null;
  /** Whether an old `**Oracle phase:**` line is present. It declares nothing. */
  readonly hasOraclePhaseLine: boolean;
  /** Whether an old `**Oracle files:**` line is present. It declares nothing. */
  readonly hasOracleFilesLine: boolean;
  /** The declaration labels that appear more than once in the header paragraph. */
  readonly repeated: readonly DeclarationLabel[];
}

export interface PhaseHeader extends HeaderParagraph {
  readonly phase: string;
  /** The declaration labels found at the start of a line of any other paragraph or list item. */
  readonly misplaced: readonly DeclarationLabel[];
}

type AcceptancePassing =
  | { readonly kind: "next" }
  | { readonly kind: "phase"; readonly id: string };

export interface AcceptanceDeclaration {
  readonly passedBy: AcceptancePassing;
  readonly files: readonly string[];
}

type LineLabel = DeclarationLabel | OldLabel | "Assignment reason";

const LABELS: readonly LineLabel[] = [
  "Assignment reason",
  "Model reason",
  "Mode",
  "Acceptance phase",
  "Acceptance test files",
  "Oracle phase",
  "Oracle files",
];
const DECLARATION_LABELS: readonly DeclarationLabel[] = [
  "Mode",
  "Acceptance phase",
  "Acceptance test files",
];

// `**Label:** value`, `**Label**: value` or `Label: value`, with `*` or `_`
// emphasis of one or two markers in place of `**`, and after any blockquote
// markers: a typo in the emphasis must never hide a declaration.
const EMPHASIS = "(?:\\*{1,2}|_{1,2})";
const LINE_RE = new RegExp(
  `^\\s*(?:>\\s*)*(?:${EMPHASIS}\\s*)?(${LABELS.map((l) => l.replaceAll(" ", "\\s+")).join("|")})\\s*(?::\\s*${EMPHASIS}|${EMPHASIS}\\s*:|:)(.*)$`,
  "i",
);

const PHASE_HEADING_RE = /^(phase-\d{2})\b/i;
const PASSED_BY_RE = /^passed by (phase-\d{2})$/;

function canonicalLabel(raw: string): LineLabel {
  const flat = raw.replace(/\s+/g, " ").toLowerCase();
  return LABELS.find((l) => l.toLowerCase() === flat)!;
}

function isDeclaration(label: LineLabel): label is DeclarationLabel {
  return (DECLARATION_LABELS as readonly string[]).includes(label);
}

function isOld(label: LineLabel): label is OldLabel {
  return label === "Model reason" || label === "Oracle phase" || label === "Oracle files";
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

// Split on the commas outside code spans, so a path with a comma, rendered as
// one code span, reads back whole.
function splitEntries(value: string): string[] {
  const entries: string[] = [];
  let current = "";
  let inCode = false;
  for (const char of value) {
    if (char === "`") inCode = !inCode;
    if (char === "," && !inCode) {
      entries.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  entries.push(current);
  return entries.map((entry) => unwrapBackticks(entry.trim())).filter((entry) => entry.length > 0);
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
  const acceptanceFiles = first("Acceptance test files");
  const assignmentReason = first("Assignment reason");
  return {
    assignmentReason:
      assignmentReason === null || assignmentReason === "" ? null : assignmentReason,
    hasModelReason: lines.some((l) => l.label === "Model reason"),
    mode: first("Mode"),
    acceptancePhase: first("Acceptance phase"),
    acceptanceFiles: acceptanceFiles === null ? null : splitEntries(acceptanceFiles),
    hasOraclePhaseLine: lines.some((l) => l.label === "Oracle phase"),
    hasOracleFilesLine: lines.some((l) => l.label === "Oracle files"),
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

/**
 * One phase block's header: its header paragraph read by `readHeaderParagraph`,
 * the declaration labels misplaced in its other paragraphs and list items, and
 * the old labels wherever they sit. `nodes` are the root-level nodes under the
 * phase's `##` heading; `body` is the markdown they were parsed from,
 * frontmatter skipped. The deterministic walk reads its phase blocks through
 * this, so both readers share one grammar.
 */
export function readPhaseBlock(
  phase: string,
  nodes: readonly RootContent[],
  body: string,
): PhaseHeader {
  const headerNode = nodes.find(
    (n): n is Paragraph => n.type === "paragraph" && /Recommended\s+model:/i.test(toString(n)),
  );
  const header = readHeaderParagraph(headerNode === undefined ? "" : sourceOf(body, headerNode));
  const misplaced = new Set<DeclarationLabel>();
  // The old labels are refused wherever they sit in the phase, so a line set
  // off by a blank line is never dropped without a word.
  const oldElsewhere = new Set<OldLabel>();
  for (const node of nodes) {
    for (const paragraph of paragraphsOf(node)) {
      if (paragraph === headerNode) continue;
      for (const line of labelledLines(sourceOf(body, paragraph))) {
        if (isDeclaration(line.label)) misplaced.add(line.label);
        if (isOld(line.label)) oldElsewhere.add(line.label);
      }
    }
  }
  return {
    phase,
    ...header,
    hasModelReason: header.hasModelReason || oldElsewhere.has("Model reason"),
    hasOraclePhaseLine: header.hasOraclePhaseLine || oldElsewhere.has("Oracle phase"),
    hasOracleFilesLine: header.hasOracleFilesLine || oldElsewhere.has("Oracle files"),
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
 * The phase's acceptance declaration when it is well formed: both acceptance
 * lines appear exactly once and only in the header paragraph, and the
 * Acceptance phase value is exactly `yes` or `passed by phase-NN`. Null
 * otherwise. The old Oracle lines never declare anything.
 */
export function acceptanceDeclaration(header: PhaseHeader): AcceptanceDeclaration | null {
  if (header.acceptancePhase === null || header.acceptanceFiles === null) return null;
  const labels: readonly DeclarationLabel[] = ["Acceptance phase", "Acceptance test files"];
  if (labels.some((l) => header.repeated.includes(l) || header.misplaced.includes(l))) {
    return null;
  }
  if (header.acceptancePhase === "yes") {
    return { passedBy: { kind: "next" }, files: header.acceptanceFiles };
  }
  const passed = header.acceptancePhase.match(PASSED_BY_RE);
  if (passed === null) return null;
  return { passedBy: { kind: "phase", id: passed[1]! }, files: header.acceptanceFiles };
}

/** A phase's `mode` and `acceptance`, as the plan document and phax-plan.json carry them. */
export interface PhaseKinds {
  readonly mode: PhaseMode;
  readonly acceptance: PhaseAcceptance;
}

/**
 * The only source of a phase's `mode` and `acceptance`: phax's reading of its
 * header lines. `mode` is `interactive` exactly when `declaresInteractive`.
 * `acceptance` is `acceptanceDeclaration` resolved, `next` to `nextPhaseId`;
 * it is null when the declaration is, or when it says `next` and no phase
 * follows. A declaration phax cannot read or resolve yields headless and null
 * here, and an error of the `interactive` or `acceptance` check, never an
 * extraction failure.
 */
export function phaseKinds(header: PhaseHeader, nextPhaseId: string | null): PhaseKinds {
  const mode = declaresInteractive(header) ? "interactive" : "headless";
  const declaration = acceptanceDeclaration(header);
  if (declaration === null) return { mode, acceptance: null };
  const passedBy = declaration.passedBy.kind === "phase" ? declaration.passedBy.id : nextPhaseId;
  if (passedBy === null) return { mode, acceptance: null };
  return { mode, acceptance: { passedBy, files: [...declaration.files] } };
}

type AnswerPhase = ExtractionPlan["phases"][number];

/**
 * An extraction answer phase with `mode` and `acceptance` set directly after
 * `optionalFilesToEdit`, before the answer's `testLines`.
 */
type KindedPhase = Omit<AnswerPhase, "testLines" | "commit"> &
  PhaseKinds &
  Pick<AnswerPhase, "testLines" | "commit">;

/**
 * The extraction model's plan with every phase's `mode` and `acceptance` read
 * from plan.md's header lines (`phaseKinds`), placed directly after
 * `optionalFilesToEdit` and before the answer's own `testLines`, so the key
 * order is `…, optionalFilesToEdit, mode, acceptance, testLines, commit`. An answer phase with no `## phase-NN` heading in
 * plan.md fails, naming it. The next phase of an acceptance phase is the next
 * heading in plan.md, as on the deterministic path.
 */
export function withPhaseKinds(
  answer: ExtractionPlan,
  planMd: string,
): Result.Result<
  Omit<ExtractionPlan, "phases"> & { readonly phases: readonly KindedPhase[] },
  PlanValidationError
> {
  const headers = readPhaseHeaders(planMd);
  const missing = answer.phases.filter((p) => !headers.some((h) => h.phase === p.id));
  if (missing.length > 0) {
    return Result.fail(
      new PlanValidationError({
        message: `The extraction model returned ${missing.map((p) => p.id).join(", ")}, which plan.md has no \`## phase-NN\` heading for.`,
      }),
    );
  }
  const phases = answer.phases.map((phase): KindedPhase => {
    const index = headers.findIndex((h) => h.phase === phase.id);
    const kinds = phaseKinds(headers[index]!, headers[index + 1]?.phase ?? null);
    const { testLines, commit, ...fields } = phase;
    return { ...fields, mode: kinds.mode, acceptance: kinds.acceptance, testLines, commit };
  });
  return Result.succeed({ ...answer, phases });
}
