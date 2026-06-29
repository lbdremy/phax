import { Either, Schema } from "effect";
import { PlanValidationError } from "../errors.js";
import { ExtractedPhaxPlanSchema, type ExtractedPhaxPlan } from "../../schemas/phaxPlan.js";

const decodeStrict = Schema.decodeUnknownEither(ExtractedPhaxPlanSchema, {
  onExcessProperty: "error",
});

type Block =
  | { readonly kind: "heading"; readonly depth: number; readonly text: string }
  | { readonly kind: "list"; readonly items: readonly string[] }
  | { readonly kind: "paragraph"; readonly text: string };

const HEADING_RE = /^(#{1,6})\s+(.*?)\s*$/;
const LIST_ITEM_RE = /^[-*]\s+(.*)$/;
const PHASE_HEADING_RE = /^(phase-\d{2})\b/i;
const ANCHOR_RE = /\{#([^}]+)\}/;
const MODEL_LINE_RE = /^\s*\*\*Recommended model:\*\*\s*(\S.*?)\s*$/m;
const EFFORT_LINE_RE = /^\s*\*\*Recommended effort:\*\*\s*(\S.*?)\s*$/m;

function tokenize(md: string): Block[] {
  const lines = md.split(/\r?\n/);
  const blocks: Block[] = [];
  let para: string[] = [];
  const flushPara = (): void => {
    if (para.length > 0) {
      blocks.push({ kind: "paragraph", text: para.join("\n") });
      para = [];
    }
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (/^\s*```/.test(line)) {
      flushPara();
      const start = i;
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i]!)) i++;
      const end = Math.min(i + 1, lines.length);
      blocks.push({ kind: "paragraph", text: lines.slice(start, end).join("\n") });
      i = end;
      continue;
    }
    if (line.trim() === "") {
      flushPara();
      i++;
      continue;
    }
    if (line.startsWith(">")) {
      // Treat blockquote like a paragraph (ignored by extractor unless matched).
      flushPara();
      const start = i;
      while (i < lines.length && lines[i]!.trim() !== "" && lines[i]!.startsWith(">")) i++;
      blocks.push({ kind: "paragraph", text: lines.slice(start, i).join("\n") });
      continue;
    }
    const h = HEADING_RE.exec(line);
    if (h) {
      flushPara();
      blocks.push({ kind: "heading", depth: h[1]!.length, text: h[2]! });
      i++;
      continue;
    }
    if (LIST_ITEM_RE.test(line)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length) {
        const li = lines[i]!;
        const m = LIST_ITEM_RE.exec(li);
        if (m) {
          items.push(m[1]!.trim());
          i++;
        } else if (li.trim() !== "" && /^\s+\S/.test(li) && items.length > 0) {
          items[items.length - 1] = `${items[items.length - 1]} ${li.trim()}`;
          i++;
        } else {
          break;
        }
      }
      blocks.push({ kind: "list", items });
      continue;
    }
    para.push(line);
    i++;
  }
  flushPara();
  return blocks;
}

function isNoneList(items: readonly string[]): boolean {
  if (items.length !== 1) return false;
  const t = items[0]!.toLowerCase().replace(/[()`]/g, "").trim();
  return t === "none";
}

function stripCodeWrap(text: string): string {
  const trimmed = text.trim();
  const inline = /^`([^`]+)`$/.exec(trimmed);
  if (inline) return inline[1]!.trim();
  const fence = /^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```$/.exec(trimmed);
  if (fence) return fence[1]!.trim();
  return trimmed;
}

function fail(message: string): Either.Either<never, PlanValidationError> {
  return Either.left(new PlanValidationError({ message }));
}

function findFollowingList(blocks: readonly Block[], from: number): readonly string[] | null {
  for (let i = from; i < blocks.length; i++) {
    const b = blocks[i]!;
    if (b.kind === "list") return b.items;
    if (b.kind === "heading") return null;
  }
  return null;
}

function findH3List(
  blocks: readonly Block[],
  sectionName: string,
): readonly string[] | null | undefined {
  // undefined: section heading not found; null: heading found but no list followed.
  const target = sectionName.toLowerCase();
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    if (b.kind === "heading" && b.depth === 3 && b.text.trim().toLowerCase() === target) {
      return findFollowingList(blocks, i + 1);
    }
  }
  return undefined;
}

function findH3Paragraph(blocks: readonly Block[], sectionName: string): string | null {
  const target = sectionName.toLowerCase();
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    if (b.kind === "heading" && b.depth === 3 && b.text.trim().toLowerCase() === target) {
      for (let j = i + 1; j < blocks.length; j++) {
        const nb = blocks[j]!;
        if (nb.kind === "heading") return null;
        if (nb.kind === "paragraph") return nb.text;
      }
      return null;
    }
  }
  return null;
}

function findH3BlockText(blocks: readonly Block[], sectionName: string): string | null {
  const target = sectionName.toLowerCase();
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    if (b.kind === "heading" && b.depth === 3 && b.text.trim().toLowerCase() === target) {
      const parts: string[] = [];
      for (let j = i + 1; j < blocks.length; j++) {
        const nb = blocks[j]!;
        if (nb.kind === "heading") break;
        if (nb.kind === "paragraph") parts.push(nb.text.trim());
        else if (nb.kind === "list") parts.push(nb.items.map((it) => `- ${it}`).join("\n"));
      }
      const joined = parts.join("\n\n").trim();
      return joined.length > 0 ? joined : null;
    }
  }
  return null;
}

/**
 * Parse a conforming plan.md into a validated ExtractedPhaxPlan. Pure: no I/O.
 * Returns Left with a phase- and field-specific message on any parse or schema
 * failure so the LLM fallback can surface a useful reason.
 */
export function extractPlanDeterministic(
  planMd: string,
): Either.Either<ExtractedPhaxPlan, PlanValidationError> {
  const blocks = tokenize(planMd);

  const h1 = blocks.find(
    (b): b is Block & { kind: "heading" } => b.kind === "heading" && b.depth === 1,
  );
  if (!h1) return fail("plan.md is missing a top-level # heading for the run title.");
  const runTitle = h1.text.trim();
  if (runTitle.length === 0) return fail("Run title (first # heading) is empty.");

  const firstPhaseIdx = blocks.findIndex(
    (b) => b.kind === "heading" && b.depth === 2 && PHASE_HEADING_RE.test(b.text),
  );
  const searchEnd = firstPhaseIdx === -1 ? blocks.length : firstPhaseIdx;
  const requiredIdx = blocks.findIndex(
    (b, i) =>
      i < searchEnd &&
      b.kind === "heading" &&
      b.depth === 2 &&
      b.text.trim().toLowerCase() === "required commands",
  );
  if (requiredIdx === -1) {
    return fail(
      'plan.md is missing the "## Required commands" section before the first phase heading.',
    );
  }
  const reqList = findFollowingList(blocks, requiredIdx + 1);
  if (reqList === null) {
    return fail(
      '"## Required commands" must be followed by a list (use "- (none)" if there are none).',
    );
  }
  const requiredCommands = isNoneList(reqList) ? [] : reqList.map((s) => stripCodeWrap(s));

  const phaseHeadings: Array<{
    readonly idx: number;
    readonly heading: Block & { kind: "heading" };
  }> = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    if (b.kind === "heading" && b.depth === 2 && PHASE_HEADING_RE.test(b.text)) {
      phaseHeadings.push({ idx: i, heading: b });
    }
  }
  if (phaseHeadings.length === 0) {
    return fail('plan.md has no phase headings (e.g. "## phase-01 — Title {#anchor}").');
  }

  const phases: unknown[] = [];
  for (let pi = 0; pi < phaseHeadings.length; pi++) {
    const { idx, heading } = phaseHeadings[pi]!;
    const endIdx = pi + 1 < phaseHeadings.length ? phaseHeadings[pi + 1]!.idx : blocks.length;
    const phaseBlocks = blocks.slice(idx + 1, endIdx);
    const id = PHASE_HEADING_RE.exec(heading.text)![1]!.toLowerCase();

    const anchorMatch = ANCHOR_RE.exec(heading.text);
    if (!anchorMatch) {
      return fail(`${id}: heading is missing a {#anchor} marker.`);
    }
    const planMarkdownAnchor = `#${anchorMatch[1]!.trim()}`;

    let model: string | undefined;
    let effort: string | undefined;
    for (const b of phaseBlocks) {
      if (b.kind !== "paragraph") continue;
      if (model === undefined) {
        const mm = MODEL_LINE_RE.exec(b.text);
        if (mm) model = stripCodeWrap(mm[1]!.replace(/\*+$/, "").trim());
      }
      if (effort === undefined) {
        const em = EFFORT_LINE_RE.exec(b.text);
        if (em) effort = stripCodeWrap(em[1]!.replace(/\*+$/, "").trim());
      }
    }
    if (model === undefined || model.length === 0) {
      return fail(`${id}: missing "**Recommended model:** <model>" line.`);
    }
    if (effort === undefined || effort.length === 0) {
      return fail(`${id}: missing "**Recommended effort:** <effort>" line.`);
    }

    const parseFileList = (
      sectionName: string,
    ): Either.Either<readonly string[], PlanValidationError> => {
      const list = findH3List(phaseBlocks, sectionName);
      if (list === undefined) {
        return fail(`${id}: missing "### ${sectionName}" section.`);
      }
      if (list === null) {
        return fail(
          `${id}: "### ${sectionName}" must be followed by a list (use "- (none)" if empty).`,
        );
      }
      return Either.right(isNoneList(list) ? [] : list.map((s) => stripCodeWrap(s)));
    };

    const created = parseFileList("Planned files to create");
    if (Either.isLeft(created)) return Either.left(created.left);
    const edited = parseFileList("Planned files to edit");
    if (Either.isLeft(edited)) return Either.left(edited.left);
    const optional = parseFileList("Optional files that may be edited");
    if (Either.isLeft(optional)) return Either.left(optional.left);

    const subjectPara = findH3Paragraph(phaseBlocks, "Commit subject");
    if (subjectPara === null) {
      return fail(`${id}: missing "### Commit subject" with a non-empty value.`);
    }
    const subject = stripCodeWrap(subjectPara).replace(/\s+/g, " ").trim();
    if (subject.length === 0) {
      return fail(`${id}: "### Commit subject" is empty.`);
    }

    const body = findH3BlockText(phaseBlocks, "Commit body");
    if (body === null) {
      return fail(`${id}: missing "### Commit body" with a non-empty value.`);
    }

    phases.push({
      id,
      model,
      effort,
      planMarkdownAnchor,
      plannedFilesToCreate: created.right,
      plannedFilesToEdit: edited.right,
      optionalFilesToEdit: optional.right,
      commit: { subject, body },
    });
  }

  const candidate = {
    version: 1,
    run: { shortName: runTitle, title: runTitle, requiredCommands },
    phases,
  };
  const decoded = decodeStrict(candidate);
  if (Either.isLeft(decoded)) {
    return fail(`Decoded plan failed schema validation: ${String(decoded.left)}`);
  }
  return Either.right(decoded.right);
}
