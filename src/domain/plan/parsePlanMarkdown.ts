import { Either, Schema } from "effect";
import { fromMarkdown } from "mdast-util-from-markdown";
import { toString } from "mdast-util-to-string";
import type { Heading, List, Paragraph, Root, RootContent } from "mdast";
import { PlanValidationError } from "../errors.js";
import { ExtractedPhaxPlanSchema, type ExtractedPhaxPlan } from "../../schemas/phaxPlan.js";
import { splitFrontmatter } from "../artifact/frontmatter.js";

const decodeExtracted = Schema.decodeUnknownEither(ExtractedPhaxPlanSchema, {
  onExcessProperty: "error",
});

const PHASE_HEADING_RE = /^(phase-\d{2})\b/i;
const ANCHOR_IN_HEADING_RE = /\{#([^}]+)\}/;
const NONE_ITEM_RE = /^\(?none\)?$/i;

// Extract `## phase-NN — Title {#anchor}` fields from a heading's flattened text.
function parsePhaseHeading(text: string): { id: string; anchor: string } | null {
  const idMatch = text.match(PHASE_HEADING_RE);
  const anchorMatch = text.match(ANCHOR_IN_HEADING_RE);
  if (!idMatch || !anchorMatch) return null;
  return { id: idMatch[1]!.toLowerCase(), anchor: `#${anchorMatch[1]!.trim()}` };
}

function isH2(n: RootContent): n is Heading {
  return n.type === "heading" && n.depth === 2;
}
function isH3(n: RootContent): n is Heading {
  return n.type === "heading" && n.depth === 3;
}
function isH1(n: RootContent): n is Heading {
  return n.type === "heading" && n.depth === 1;
}
function isList(n: RootContent): n is List {
  return n.type === "list";
}
function isParagraph(n: RootContent): n is Paragraph {
  return n.type === "paragraph";
}

function listItemTexts(list: List): string[] {
  return list.children.map((item) => toString(item).trim()).filter((s) => s.length > 0);
}

function normalizeItems(items: string[]): string[] {
  if (items.length === 1 && NONE_ITEM_RE.test(items[0]!)) return [];
  return items;
}

function findFirstH1(root: Root): Heading | null {
  for (const child of root.children) {
    if (isH1(child)) return child;
  }
  return null;
}

function stripTrailingStars(s: string): string {
  return s.replace(/\**$/, "").trim();
}

// Read `Recommended model:` / `Recommended effort:` from the raw paragraph
// source. Flattening would concatenate the two values across the soft break.
function readRecommendedFields(
  planMd: string,
  paragraph: Paragraph,
): { model: string | null; effort: string | null } {
  const start = paragraph.position?.start.offset ?? 0;
  const end = paragraph.position?.end.offset ?? 0;
  const src = planMd.slice(start, end);
  const modelMatch = src.match(/Recommended\s+model:\s*\**\s*(\S+)/i);
  const effortMatch = src.match(/Recommended\s+effort:\s*\**\s*(\S+)/i);
  return {
    model: modelMatch ? stripTrailingStars(modelMatch[1]!) : null,
    effort: effortMatch ? stripTrailingStars(effortMatch[1]!) : null,
  };
}

function paragraphContainsRecommended(paragraph: Paragraph): boolean {
  return /Recommended\s+model:/i.test(toString(paragraph));
}

// Return the h3 subsection whose heading text (case-insensitive, trimmed)
// matches `title`, returning the list of block nodes between that heading and
// the next h3/h2.
function findH3Section(
  block: RootContent[],
  title: string,
): { heading: Heading; body: RootContent[] } | null {
  const wanted = title.trim().toLowerCase();
  for (let i = 0; i < block.length; i++) {
    const node = block[i]!;
    if (isH3(node) && toString(node).trim().toLowerCase() === wanted) {
      const body: RootContent[] = [];
      for (let j = i + 1; j < block.length; j++) {
        const inner = block[j]!;
        if (isH3(inner) || isH2(inner)) break;
        if (inner.type === "thematicBreak") break;
        body.push(inner);
      }
      return { heading: node, body };
    }
  }
  return null;
}

function extractPlannedList(
  block: RootContent[],
  headingTitle: string,
  phaseId: string,
): Either.Either<readonly string[], PlanValidationError> {
  const section = findH3Section(block, headingTitle);
  if (!section) {
    return Either.left(
      new PlanValidationError({
        message: `${phaseId}: missing "### ${headingTitle}" section`,
      }),
    );
  }
  const list = section.body.find(isList);
  if (!list) {
    return Either.left(
      new PlanValidationError({
        message: `${phaseId}: "${headingTitle}" section has no list`,
      }),
    );
  }
  return Either.right(normalizeItems(listItemTexts(list)));
}

// Strip a leading/trailing backtick wrap: `foo` → foo. Also handles the case
// where the paragraph is a single inlineCode node.
function unwrapBackticks(s: string): string {
  const trimmed = s.trim();
  if (trimmed.startsWith("`") && trimmed.endsWith("`") && trimmed.length >= 2) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function extractCommitSubject(
  block: RootContent[],
  phaseId: string,
): Either.Either<string, PlanValidationError> {
  const section = findH3Section(block, "Commit subject");
  if (!section) {
    return Either.left(
      new PlanValidationError({
        message: `${phaseId}: missing "### Commit subject" section`,
      }),
    );
  }
  const paragraph = section.body.find(isParagraph);
  if (!paragraph) {
    return Either.left(
      new PlanValidationError({
        message: `${phaseId}: "Commit subject" section has no paragraph`,
      }),
    );
  }
  const subject = unwrapBackticks(toString(paragraph)).replace(/\s+/g, " ").trim();
  if (subject.length === 0) {
    return Either.left(new PlanValidationError({ message: `${phaseId}: empty commit subject` }));
  }
  return Either.right(subject);
}

// Extract the commit body as a verbatim slice of the plan.md source, preserving
// the author's line wrapping and paragraph/list structure. This keeps the body
// deterministic and git-friendly (the author's ~72-80 column wraps carry into
// the commit message) rather than folding paragraphs into single long lines.
function extractCommitBody(
  planMd: string,
  block: RootContent[],
  phaseId: string,
): Either.Either<string, PlanValidationError> {
  const section = findH3Section(block, "Commit body");
  if (!section || section.body.length === 0) {
    return Either.left(
      new PlanValidationError({
        message: `${phaseId}: missing "### Commit body" section`,
      }),
    );
  }
  const first = section.body[0]!;
  const last = section.body[section.body.length - 1]!;
  const startOffset = first.position?.start.offset;
  const endOffset = last.position?.end.offset;
  if (startOffset === undefined || endOffset === undefined) {
    return Either.left(
      new PlanValidationError({
        message: `${phaseId}: could not read commit body source`,
      }),
    );
  }
  const body = planMd.slice(startOffset, endOffset).trim();
  if (body.length === 0) {
    return Either.left(new PlanValidationError({ message: `${phaseId}: empty commit body` }));
  }
  return Either.right(body);
}

function extractRequiredCommands(
  block: RootContent[],
): Either.Either<readonly string[], PlanValidationError> {
  // Find the h2 whose text is exactly "Required commands".
  for (let i = 0; i < block.length; i++) {
    const node = block[i]!;
    if (isH2(node) && toString(node).trim().toLowerCase() === "required commands") {
      for (let j = i + 1; j < block.length; j++) {
        const inner = block[j]!;
        if (isH2(inner)) break;
        if (isList(inner)) {
          return Either.right(normalizeItems(listItemTexts(inner)));
        }
      }
      return Either.left(
        new PlanValidationError({
          message: `"Required commands" section has no list`,
        }),
      );
    }
  }
  return Either.left(
    new PlanValidationError({ message: `missing "## Required commands" section` }),
  );
}

interface PhaseBlock {
  readonly heading: Heading;
  readonly body: RootContent[];
}

function collectPhaseBlocks(root: Root): PhaseBlock[] {
  const blocks: PhaseBlock[] = [];
  let current: PhaseBlock | null = null;
  for (const child of root.children) {
    if (isH2(child)) {
      const text = toString(child).trim();
      if (PHASE_HEADING_RE.test(text)) {
        if (current) blocks.push(current);
        current = { heading: child, body: [] };
        continue;
      }
      // Non-phase h2 (e.g. "Context") closes any open phase.
      if (current) {
        blocks.push(current);
        current = null;
      }
    }
    if (current) current.body.push(child);
  }
  if (current) blocks.push(current);
  return blocks;
}

// Nodes before the first phase h2 — used to find "## Required commands".
function collectPreamble(root: Root): RootContent[] {
  const preamble: RootContent[] = [];
  for (const child of root.children) {
    if (isH2(child) && PHASE_HEADING_RE.test(toString(child).trim())) break;
    preamble.push(child);
  }
  return preamble;
}

const EffortSchema = Schema.Literal(
  "none",
  "off",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultracode",
  "ultra",
);
const decodeEffort = Schema.decodeUnknownEither(EffortSchema);

/**
 * A structural defect found while walking a plan.md. `phase` is the
 * `phase-NN` id when the error concerns a phase, `null` for plan-level
 * errors. `message` never repeats the phase id — callers that want the
 * legacy `"phase-NN: <message>"` form re-prefix it themselves.
 */
export interface StructureError {
  readonly phase: string | null;
  readonly message: string;
}

// Raw error as produced during the walk: `message` still carries the
// `"phase-NN: "` prefix baked in by the per-check helpers below, so
// `extractPlanDeterministic` can reuse it verbatim as the first-error
// message exactly as before the accumulation refactor.
interface RawStructureError {
  readonly phase: string | null;
  readonly message: string;
}

function stripPhasePrefix(message: string, phase: string): string {
  const prefix = `${phase}: `;
  return message.startsWith(prefix) ? message.slice(prefix.length) : message;
}

interface PlanWalkResult {
  readonly errors: readonly RawStructureError[];
  readonly candidate: {
    readonly version: 1;
    readonly run: {
      readonly shortName: string;
      readonly title: string;
      readonly requiredCommands: readonly string[];
    };
    readonly phases: readonly unknown[];
  } | null;
}

// Walks the plan once, accumulating every structural defect in document
// order instead of stopping at the first one. A phase whose heading cannot
// be parsed (missing `{#anchor}`) contributes its heading error and is
// skipped; every other phase runs all of its checks regardless of earlier
// failures. `candidate` is only populated when the walk found no errors —
// it is the shape `extractPlanDeterministic` decodes through the schema.
function walkPlan(planMd: string): PlanWalkResult {
  const errors: RawStructureError[] = [];
  const split = splitFrontmatter(planMd);
  const body = split ? split.body : planMd;
  const root = fromMarkdown(body);

  const h1 = findFirstH1(root);
  let runTitle = "";
  if (!h1) {
    errors.push({ phase: null, message: `missing top-level "# " heading for run title` });
  } else {
    runTitle = toString(h1).trim();
    if (runTitle.length === 0) {
      errors.push({ phase: null, message: `top-level heading is empty` });
    }
  }

  const preamble = collectPreamble(root);
  const requiredCommandsE = extractRequiredCommands(preamble);
  let requiredCommands: readonly string[] = [];
  if (Either.isLeft(requiredCommandsE)) {
    errors.push({ phase: null, message: requiredCommandsE.left.message });
  } else {
    requiredCommands = requiredCommandsE.right;
  }

  const phaseBlocks = collectPhaseBlocks(root);
  if (phaseBlocks.length === 0) {
    errors.push({ phase: null, message: `no phase headings found` });
  }

  const phases: unknown[] = [];
  for (const pb of phaseBlocks) {
    const headingText = toString(pb.heading).trim();
    const parsed = parsePhaseHeading(headingText);
    if (!parsed) {
      const idMatch = headingText.match(PHASE_HEADING_RE);
      errors.push({
        phase: idMatch ? idMatch[1]!.toLowerCase() : null,
        message: `phase heading "${headingText}" missing id or {#anchor}`,
      });
      continue;
    }
    const { id, anchor } = parsed;
    let phaseOk = true;

    const recParagraph = pb.body.find(
      (n): n is Paragraph => isParagraph(n) && paragraphContainsRecommended(n),
    );
    let model: string | null = null;
    let decodedEffort: Schema.Schema.Type<typeof EffortSchema> | null = null;
    if (!recParagraph) {
      errors.push({ phase: id, message: `${id}: missing "Recommended model:" line` });
      phaseOk = false;
    } else {
      const { model: rawModel, effort: rawEffort } = readRecommendedFields(body, recParagraph);
      model = rawModel;
      if (!rawModel) {
        errors.push({ phase: id, message: `${id}: missing "Recommended model:" value` });
        phaseOk = false;
      }
      if (!rawEffort) {
        errors.push({ phase: id, message: `${id}: missing "Recommended effort:" value` });
        phaseOk = false;
      } else {
        const effortE = decodeEffort(rawEffort);
        if (Either.isLeft(effortE)) {
          errors.push({ phase: id, message: `${id}: invalid effort "${rawEffort}"` });
          phaseOk = false;
        } else {
          decodedEffort = effortE.right;
        }
      }
    }

    const createE = extractPlannedList(pb.body, "Planned files to create", id);
    if (Either.isLeft(createE)) {
      errors.push({ phase: id, message: createE.left.message });
      phaseOk = false;
    }
    const editE = extractPlannedList(pb.body, "Planned files to edit", id);
    if (Either.isLeft(editE)) {
      errors.push({ phase: id, message: editE.left.message });
      phaseOk = false;
    }
    const optionalE = extractPlannedList(pb.body, "Optional files that may be edited", id);
    if (Either.isLeft(optionalE)) {
      errors.push({ phase: id, message: optionalE.left.message });
      phaseOk = false;
    }

    const subjectE = extractCommitSubject(pb.body, id);
    if (Either.isLeft(subjectE)) {
      errors.push({ phase: id, message: subjectE.left.message });
      phaseOk = false;
    }
    const bodyE = extractCommitBody(body, pb.body, id);
    if (Either.isLeft(bodyE)) {
      errors.push({ phase: id, message: bodyE.left.message });
      phaseOk = false;
    }

    if (
      phaseOk &&
      Either.isRight(createE) &&
      Either.isRight(editE) &&
      Either.isRight(optionalE) &&
      Either.isRight(subjectE) &&
      Either.isRight(bodyE)
    ) {
      phases.push({
        id,
        model,
        effort: decodedEffort,
        planMarkdownAnchor: anchor,
        plannedFilesToCreate: createE.right,
        plannedFilesToEdit: editE.right,
        optionalFilesToEdit: optionalE.right,
        commit: { subject: subjectE.right, body: bodyE.right },
      });
    }
  }

  if (errors.length > 0) {
    return { errors, candidate: null };
  }

  return {
    errors,
    candidate: {
      version: 1,
      run: { shortName: runTitle, title: runTitle, requiredCommands },
      phases,
    },
  };
}

/**
 * Walks a plan.md and returns every structural defect it can establish, in
 * document order, instead of stopping at the first one. Groundwork for
 * `phax plans lint` (spec 33): `structureFindings` in `lint.ts` maps this to
 * the finding vocabulary.
 */
export function collectPlanStructureErrors(planMd: string): readonly StructureError[] {
  const { errors } = walkPlan(planMd);
  return errors.map((e) => ({
    phase: e.phase,
    message: e.phase ? stripPhasePrefix(e.message, e.phase) : e.message,
  }));
}

/**
 * Pure deterministic extractor: parses a conforming `plan.md` into an
 * `ExtractedPhaxPlan` via an mdast tree. The output is decoded through
 * `ExtractedPhaxPlanSchema` so a parser bug cannot inject malformed data —
 * the strict decode rejects it and the caller falls back to the LLM.
 */
export function extractPlanDeterministic(
  planMd: string,
): Either.Either<ExtractedPhaxPlan, PlanValidationError> {
  const { errors, candidate } = walkPlan(planMd);
  if (errors.length > 0 || !candidate) {
    return Either.left(new PlanValidationError({ message: errors[0]!.message }));
  }

  const decoded = decodeExtracted(candidate);
  if (Either.isLeft(decoded)) {
    return Either.left(
      new PlanValidationError({
        message: `deterministic extraction produced invalid ExtractedPhaxPlan: ${decoded.left.message}`,
      }),
    );
  }
  return Either.right(decoded.right);
}
