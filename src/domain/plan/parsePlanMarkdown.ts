import { Result, Schema } from "effect";
import type { Heading, List, Paragraph, Root, RootContent } from "mdast";
import { PlanValidationError } from "../errors.js";
import { ExtractedPhaxPlanSchema, type ExtractedPhaxPlan } from "../../schemas/phaxPlan.js";
import { nodeText as toString } from "./nodeText.js";
import { phaseKinds, readPhaseBlock } from "./phaseHeader.js";
import { describeUnplannable, readPlanPath } from "./planPath.js";
import { readPlanTree } from "./planTree.js";
import {
  departureMessage,
  readTestStrategyText,
  type TestLineDeparture,
  type TestStrategyReading,
} from "./testLineGrammar.js";

const decodeExtracted = Schema.decodeUnknownResult(ExtractedPhaxPlanSchema, {
  onExcessProperty: "error",
  reportInput: true,
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

// A planned-file item keeps its place even when it writes no path: an empty
// bullet, a code span holding only spaces, or a lone backtick run (`` is an
// empty code span to the author, literal text to CommonMark) reads as the
// empty path, which the canonical-path rule refuses.
const BACKTICK_RUN_RE = /^`+$/;
function plannedItemTexts(list: List): string[] {
  return list.children.map((item) => {
    const text = toString(item).trim();
    return BACKTICK_RUN_RE.test(text) ? "" : text;
  });
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
): Result.Result<readonly string[], PlanValidationError> {
  const section = findH3Section(block, headingTitle);
  if (!section) {
    return Result.fail(
      new PlanValidationError({
        message: `${phaseId}: missing "### ${headingTitle}" section`,
      }),
    );
  }
  const list = section.body.find(isList);
  if (!list) {
    return Result.fail(
      new PlanValidationError({
        message: `${phaseId}: "${headingTitle}" section has no list`,
      }),
    );
  }
  return Result.succeed(normalizeItems(plannedItemTexts(list)));
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
): Result.Result<string, PlanValidationError> {
  const section = findH3Section(block, "Commit subject");
  if (!section) {
    return Result.fail(
      new PlanValidationError({
        message: `${phaseId}: missing "### Commit subject" section`,
      }),
    );
  }
  const paragraph = section.body.find(isParagraph);
  if (!paragraph) {
    return Result.fail(
      new PlanValidationError({
        message: `${phaseId}: "Commit subject" section has no paragraph`,
      }),
    );
  }
  // A paragraph that is one code span reads as the span's content, backticks inside it included:
  // the code span already unwrapped it, and unwrapping again would eat a subject's own backticks.
  const [only, ...others] = paragraph.children;
  const written =
    only?.type === "inlineCode" && others.length === 0
      ? only.value
      : unwrapBackticks(toString(paragraph));
  const subject = written.replace(/\s+/g, " ").trim();
  if (subject.length === 0) {
    return Result.fail(new PlanValidationError({ message: `${phaseId}: empty commit subject` }));
  }
  return Result.succeed(subject);
}

// Extract the commit body as a verbatim slice of the plan.md source, preserving
// the author's line wrapping and paragraph/list structure. This keeps the body
// deterministic and git-friendly (the author's ~72-80 column wraps carry into
// the commit message) rather than folding paragraphs into single long lines.
function extractCommitBody(
  planMd: string,
  block: RootContent[],
  phaseId: string,
): Result.Result<string, PlanValidationError> {
  const section = findH3Section(block, "Commit body");
  if (!section || section.body.length === 0) {
    return Result.fail(
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
    return Result.fail(
      new PlanValidationError({
        message: `${phaseId}: could not read commit body source`,
      }),
    );
  }
  const body = planMd.slice(startOffset, endOffset).trim();
  if (body.length === 0) {
    return Result.fail(new PlanValidationError({ message: `${phaseId}: empty commit body` }));
  }
  return Result.succeed(body);
}

function extractRequiredCommands(
  block: RootContent[],
): Result.Result<readonly string[], PlanValidationError> {
  // Find the h2 whose text is exactly "Required commands".
  for (let i = 0; i < block.length; i++) {
    const node = block[i]!;
    if (isH2(node) && toString(node).trim().toLowerCase() === "required commands") {
      for (let j = i + 1; j < block.length; j++) {
        const inner = block[j]!;
        if (isH2(inner)) break;
        if (isList(inner)) {
          return Result.succeed(normalizeItems(listItemTexts(inner)));
        }
      }
      return Result.fail(
        new PlanValidationError({
          message: `"Required commands" section has no list`,
        }),
      );
    }
  }
  return Result.fail(
    new PlanValidationError({ message: `missing "## Required commands" section` }),
  );
}

// The structure errors of a plan whose preamble declares no gate profile, and
// more than one.
const GATE_PROFILE_MISSING = "the plan declares no gate profile (## Gate profile)";
const GATE_PROFILE_DOUBLED = "the plan declares more than one gate profile (## Gate profile)";
// A section holding one thing that is not one id: a code block, a quote, or a
// word with a backtick in it.
const GATE_PROFILE_NOT_AN_ID =
  "the plan's gate profile is not one id written as a code span or a bare word (## Gate profile)";

const GATE_PROFILE_TITLE = "gate profile";
const GATE_PROFILE_ID_RE = /^[^\s`]+$/;
const WHITESPACE_RE = /\s/;

// The one id a `## Gate profile` section's paragraph holds: the paragraph is
// one code span, or its flattened text is one bare word.
function readGateProfileParagraph(paragraph: Paragraph): Result.Result<string, string> {
  const [only, ...others] = paragraph.children;
  const written = (
    only?.type === "inlineCode" && others.length === 0 ? only.value : toString(paragraph)
  ).trim();
  if (written.length === 0) return Result.fail(GATE_PROFILE_MISSING);
  if (WHITESPACE_RE.test(written)) return Result.fail(GATE_PROFILE_DOUBLED);
  return GATE_PROFILE_ID_RE.test(written)
    ? Result.succeed(written)
    : Result.fail(GATE_PROFILE_NOT_AN_ID);
}

// Reads the preamble's `## Gate profile` sections (title matched
// case-insensitively and trimmed, as `## Required commands` is). Each runs to
// the next `#` or `##` heading. None, or one with nothing in it, is missing;
// two, or one holding more than one paragraph, a list or two words, is
// doubled.
function readGateProfileInPreamble(
  preamble: readonly RootContent[],
): Result.Result<string, string> {
  const sections: RootContent[][] = [];
  let current: RootContent[] | null = null;
  for (const node of preamble) {
    if (node.type === "heading" && node.depth <= 2) {
      current = null;
      if (isH2(node) && toString(node).trim().toLowerCase() === GATE_PROFILE_TITLE) {
        current = [];
        sections.push(current);
      }
      continue;
    }
    current?.push(node);
  }
  const [section, ...others] = sections;
  if (section === undefined) return Result.fail(GATE_PROFILE_MISSING);
  if (others.length > 0) return Result.fail(GATE_PROFILE_DOUBLED);
  const [only, ...rest] = section;
  if (only === undefined) return Result.fail(GATE_PROFILE_MISSING);
  if (rest.length > 0 || isList(only)) return Result.fail(GATE_PROFILE_DOUBLED);
  return isParagraph(only) ? readGateProfileParagraph(only) : Result.fail(GATE_PROFILE_NOT_AN_ID);
}

/**
 * The gate profile a plan.md declares in its one preamble `## Gate profile`
 * section: the id, written as a code span or a bare word, or the structure
 * error the plan's declaration is (`GATE_PROFILE_MISSING`,
 * `GATE_PROFILE_DOUBLED`, or a section holding one thing that is not an id).
 * A plan nested over the limit `readPlanTree` refuses fails with that refusal.
 * phax reads the declaration itself on both extraction paths; the model is
 * never asked for it.
 */
export function readPlanGateProfile(planMd: string): Result.Result<string, PlanValidationError> {
  const tree = readPlanTree(planMd);
  if (Result.isFailure(tree)) {
    return Result.fail(new PlanValidationError({ message: tree.failure.message }));
  }
  return Result.mapError(
    readGateProfileInPreamble(collectPreamble(tree.success.root)),
    (message) => new PlanValidationError({ message }),
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

// The raw source of a phase block's `### Test strategy` section, read by the
// test line grammar: from the end of its heading line to the next root-level
// `###`, `##` or thematic break, or to the end of the phase block. Never the
// flattened text, so code spans and backticks reach the grammar verbatim.
// Null when the phase has no such section.
function testStrategySource(body: string, nodes: readonly RootContent[]): string | null {
  const at = nodes.findIndex(
    (n) => isH3(n) && toString(n).trim().toLowerCase() === "test strategy",
  );
  if (at < 0) return null;
  const start = nodes[at]!.position?.end.offset ?? 0;
  let end = start;
  for (const node of nodes.slice(at + 1)) {
    if (isH3(node) || isH2(node) || node.type === "thematicBreak") break;
    end = node.position?.end.offset ?? end;
  }
  return body.slice(start, end);
}

const NO_TEST_LINES: TestStrategyReading = { lines: [], departures: [] };

function readBlockTestStrategy(body: string, nodes: readonly RootContent[]): TestStrategyReading {
  const source = testStrategySource(body, nodes);
  return source === null ? NO_TEST_LINES : readTestStrategyText(source);
}

/** One phase's `### Test strategy` section read by the test line grammar. */
export interface PhaseTestStrategy extends TestStrategyReading {
  readonly phase: string;
}

/**
 * One reading per root-level `## phase-NN` heading, in document order, the
 * frontmatter skipped, recognised as `readPhaseHeaders` recognises them. Reads
 * plan.md alone: a phase with no `### Test strategy` section has no line and
 * no departure. None for a plan nested over the limit `readPlanTree` refuses.
 */
export function readPlanTestStrategies(planMd: string): readonly PhaseTestStrategy[] {
  const tree = readPlanTree(planMd);
  if (Result.isFailure(tree)) return [];
  const { body, root } = tree.success;
  return collectPhaseBlocks(root).map((pb) => ({
    phase: toString(pb.heading).trim().match(PHASE_HEADING_RE)![1]!.toLowerCase(),
    ...readBlockTestStrategy(body, pb.body),
  }));
}

// Nodes before the first phase h2 — used to find "## Gate profile" and "## Required commands".
function collectPreamble(root: Root): RootContent[] {
  const preamble: RootContent[] = [];
  for (const child of root.children) {
    if (isH2(child) && PHASE_HEADING_RE.test(toString(child).trim())) break;
    preamble.push(child);
  }
  return preamble;
}

const EffortSchema = Schema.Literals([
  "none",
  "off",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultracode",
  "ultra",
]);
const decodeEffort = Schema.decodeUnknownResult(EffortSchema, { reportInput: true });

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
  /** Set on a path with no canonical form, so a caller can tell it apart. */
  readonly unplannablePath?: true;
}

// Reads each item of one planned list as its canonical form. A path with no
// canonical form is reported (in list order) and the list is left out.
function canonicalList(
  items: readonly string[],
  phase: string,
  section: string,
  errors: RawStructureError[],
): string[] | null {
  const out: string[] = [];
  let ok = true;
  for (const written of items) {
    const reading = readPlanPath(written);
    if (reading.kind === "canonical") out.push(reading.path);
    else if (reading.kind === "rewritable") out.push(reading.canonical);
    else {
      ok = false;
      errors.push({
        phase,
        message: `${phase}: ${section}: ${JSON.stringify(written)} ${describeUnplannable(reading.reason)}`,
        unplannablePath: true,
      });
    }
  }
  return ok ? out : null;
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
      readonly gateProfile: string;
    };
    readonly phases: readonly unknown[];
  } | null;
  /** Each candidate phase's test strategy reading, in `candidate.phases` order. */
  readonly strategies: readonly PhaseTestStrategy[];
}

// Walks the plan once, accumulating every structural defect in document
// order instead of stopping at the first one. A phase whose heading cannot
// be parsed (missing `{#anchor}`) contributes its heading error and is
// skipped; every other phase runs all of its checks regardless of earlier
// failures. `candidate` is only populated when the walk found no errors —
// it is the shape `extractPlanDeterministic` decodes through the schema.
// A plan nested over the limit `readPlanTree` refuses is not walked: its one
// error is the refusal.
function walkPlan(planMd: string): PlanWalkResult {
  const tree = readPlanTree(planMd);
  if (Result.isFailure(tree)) {
    return {
      errors: [{ phase: null, message: tree.failure.message }],
      candidate: null,
      strategies: [],
    };
  }
  const errors: RawStructureError[] = [];
  const { body, root } = tree.success;

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
  const gateProfileE = readGateProfileInPreamble(preamble);
  let gateProfile = "";
  if (Result.isFailure(gateProfileE)) {
    errors.push({ phase: null, message: gateProfileE.failure });
  } else {
    gateProfile = gateProfileE.success;
  }

  const requiredCommandsE = extractRequiredCommands(preamble);
  let requiredCommands: readonly string[] = [];
  if (Result.isFailure(requiredCommandsE)) {
    errors.push({ phase: null, message: requiredCommandsE.failure.message });
  } else {
    requiredCommands = requiredCommandsE.success;
  }

  const phaseBlocks = collectPhaseBlocks(root);
  if (phaseBlocks.length === 0) {
    errors.push({ phase: null, message: `no phase headings found` });
  }

  const phases: unknown[] = [];
  const strategies: PhaseTestStrategy[] = [];
  for (const [index, pb] of phaseBlocks.entries()) {
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
        if (Result.isFailure(effortE)) {
          errors.push({ phase: id, message: `${id}: invalid effort "${rawEffort}"` });
          phaseOk = false;
        } else {
          decodedEffort = effortE.success;
        }
      }
    }

    const createE = extractPlannedList(pb.body, "Planned files to create", id);
    let createList: string[] | null = null;
    if (Result.isFailure(createE)) {
      errors.push({ phase: id, message: createE.failure.message });
      phaseOk = false;
    } else {
      createList = canonicalList(createE.success, id, "Planned files to create", errors);
    }
    const editE = extractPlannedList(pb.body, "Planned files to edit", id);
    let editList: string[] | null = null;
    if (Result.isFailure(editE)) {
      errors.push({ phase: id, message: editE.failure.message });
      phaseOk = false;
    } else {
      editList = canonicalList(editE.success, id, "Planned files to edit", errors);
    }
    const optionalE = extractPlannedList(pb.body, "Optional files that may be edited", id);
    let optionalList: string[] | null = null;
    if (Result.isFailure(optionalE)) {
      errors.push({ phase: id, message: optionalE.failure.message });
      phaseOk = false;
    } else {
      optionalList = canonicalList(
        optionalE.success,
        id,
        "Optional files that may be edited",
        errors,
      );
    }
    if (createList === null || editList === null || optionalList === null) phaseOk = false;

    const subjectE = extractCommitSubject(pb.body, id);
    if (Result.isFailure(subjectE)) {
      errors.push({ phase: id, message: subjectE.failure.message });
      phaseOk = false;
    }
    const bodyE = extractCommitBody(body, pb.body, id);
    if (Result.isFailure(bodyE)) {
      errors.push({ phase: id, message: bodyE.failure.message });
      phaseOk = false;
    }

    if (
      phaseOk &&
      Result.isSuccess(createE) &&
      Result.isSuccess(editE) &&
      Result.isSuccess(optionalE) &&
      Result.isSuccess(subjectE) &&
      Result.isSuccess(bodyE)
    ) {
      // A declaration line never adds a structure error here: its defects are
      // the `interactive` and `acceptance` checks' errors, and it reads as
      // headless with no acceptance.
      const nextBlock = phaseBlocks[index + 1];
      const nextId = nextBlock
        ? (toString(nextBlock.heading).trim().match(PHASE_HEADING_RE)?.[1]?.toLowerCase() ?? null)
        : null;
      const kinds = phaseKinds(readPhaseBlock(id, pb.body, body), nextId);
      // A departing entry is left out here and never a structure error: the
      // callers read the departures through `readPlanTestStrategies`.
      const strategy = readBlockTestStrategy(body, pb.body);
      strategies.push({ phase: id, ...strategy });
      phases.push({
        id,
        model,
        effort: decodedEffort,
        planMarkdownAnchor: anchor,
        plannedFilesToCreate: createList,
        plannedFilesToEdit: editList,
        optionalFilesToEdit: optionalList,
        mode: kinds.mode,
        acceptance: kinds.acceptance,
        testLines: strategy.lines.map(({ line }) => line),
        commit: { subject: subjectE.success, body: bodyE.success },
      });
    }
  }

  if (errors.length > 0) {
    return { errors, candidate: null, strategies };
  }

  return {
    errors,
    candidate: {
      version: 1,
      run: { shortName: runTitle, title: runTitle, requiredCommands, gateProfile },
      phases,
    },
    strategies,
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
 * Every path of a plan.md that has no canonical form, in plan order. `message`
 * is `<phase>: <section title>: "<written>" <reason>`.
 */
export function readPlanUnplannablePaths(
  planMd: string,
): readonly { readonly phase: string; readonly message: string }[] {
  return walkPlan(planMd).errors.flatMap((e) =>
    e.unplannablePath === true && e.phase !== null ? [{ phase: e.phase, message: e.message }] : [],
  );
}

/** A departing test line of a phase. */
interface PlanTestLineDeparture {
  readonly phase: string;
  readonly departure: TestLineDeparture;
}

/** A phase's kept test lines' source item numbers, in `testLines` order. */
interface PhaseLineItems {
  readonly phase: string;
  readonly items: readonly number[];
}

/**
 * The deterministic reading of a plan.md: the plan with each phase's departing
 * test lines left out, every departure in plan order, and each kept line's
 * source item number, so a `test line <n>` message names the source item and
 * never the kept index.
 */
export interface DeterministicPlanReading {
  readonly plan: ExtractedPhaxPlan;
  readonly departures: readonly PlanTestLineDeparture[];
  readonly lineItems: readonly PhaseLineItems[];
}

/**
 * Pure deterministic reader: parses a conforming `plan.md` into an
 * `ExtractedPhaxPlan` via an mdast tree, leaving departing test lines out and
 * reporting them beside the plan. Fails only on a structure error or a parser
 * bug: the output is decoded through `ExtractedPhaxPlanSchema`, so a parser bug
 * cannot inject malformed data.
 */
export function readPlanDeterministic(
  planMd: string,
): Result.Result<DeterministicPlanReading, PlanValidationError> {
  const { errors, candidate, strategies } = walkPlan(planMd);
  if (errors.length > 0 || !candidate) {
    return Result.fail(new PlanValidationError({ message: errors[0]!.message }));
  }

  const decoded = decodeExtracted(candidate);
  if (Result.isFailure(decoded)) {
    return Result.fail(
      new PlanValidationError({
        message: `deterministic extraction produced invalid ExtractedPhaxPlan: ${decoded.failure.message}`,
      }),
    );
  }
  return Result.succeed({
    plan: decoded.success,
    departures: strategies.flatMap((s) =>
      s.departures.map((departure) => ({ phase: s.phase, departure })),
    ),
    lineItems: strategies.map((s) => ({ phase: s.phase, items: s.lines.map((l) => l.item) })),
  });
}

/**
 * Pure deterministic extractor: `readPlanDeterministic`'s plan, refused at
 * the first departing test line in plan order, as
 * `phase-NN: test line <n> departs from the format: "<text>"`. Its caller
 * falls back to the LLM on a structure error.
 */
export function extractPlanDeterministic(
  planMd: string,
): Result.Result<ExtractedPhaxPlan, PlanValidationError> {
  return Result.flatMap(readPlanDeterministic(planMd), ({ plan, departures }) => {
    const [first] = departures;
    return first === undefined
      ? Result.succeed(plan)
      : Result.fail(
          new PlanValidationError({
            message: `${first.phase}: ${departureMessage(first.departure)}`,
          }),
        );
  });
}
