/**
 * The one rule that locates each phase's section in plan.md (spec
 * phase-prompt-scope §4). Lint, the run preflight and the phase prompt builder
 * all call `locatePlanSections`; none of them re-implements it. Pure: no model,
 * no I/O.
 */
import { Either } from "effect";
import { fromMarkdown } from "mdast-util-from-markdown";
import { toString } from "mdast-util-to-string";
import type { Heading, RootContent } from "mdast";
import { splitFrontmatter } from "../artifact/frontmatter.js";

export interface LocatablePhase {
  readonly id: string;
  readonly planMarkdownAnchor: string;
}

export interface PlanSections {
  /** The plan body before the first located phase heading, without the frontmatter. */
  readonly preamble: string;
  /** Each phase's section, verbatim, keyed by phase id. */
  readonly sections: ReadonlyMap<string, string>;
}

const PHASE_ID_RE = /^(phase-\d{2})\b/i;
const ANCHOR_RE = /\{#([^}]+)\}/;

interface RootHeading {
  readonly offset: number;
  readonly phaseId: string | null;
  readonly anchor: string | null;
}

interface ThematicBreakSpan {
  readonly start: number;
  readonly end: number;
}

interface RootBlocks {
  readonly headings: readonly RootHeading[];
  /** The root thematic breaks (`---`), in source order. */
  readonly breaks: readonly ThematicBreakSpan[];
}

function isRootH2(node: RootContent): node is Heading {
  return node.type === "heading" && node.depth === 2;
}

function stripHash(anchor: string): string {
  return anchor.trim().replace(/^#/, "");
}

/** The plan body after the frontmatter; the whole document when it has none. */
function planBody(planMd: string): string {
  return splitFrontmatter(planMd)?.body ?? planMd;
}

// Depth-2 headings at the root of the document, in source order, and the root
// thematic breaks. mdast already ignores a `## …` line inside a fenced code block.
function rootBlocks(body: string): RootBlocks {
  const headings: RootHeading[] = [];
  const breaks: ThematicBreakSpan[] = [];
  for (const node of fromMarkdown(body).children) {
    if (node.type === "thematicBreak") {
      breaks.push({ start: node.position?.start.offset ?? 0, end: node.position?.end.offset ?? 0 });
    }
    if (!isRootH2(node)) continue;
    const text = toString(node).trim();
    const idMatch = text.match(PHASE_ID_RE);
    const anchorMatch = text.match(ANCHOR_RE);
    headings.push({
      offset: node.position?.start.offset ?? 0,
      phaseId: idMatch ? idMatch[1]!.toLowerCase() : null,
      anchor: anchorMatch ? stripHash(anchorMatch[1]!) : null,
    });
  }
  return { headings, breaks };
}

// A slice ending at `end` stops before a separator `---` that only whitespace
// parts from the heading at `end`, so neither the preamble nor a section
// carries the rule a plan sets between its parts.
function sliceBefore(
  body: string,
  start: number,
  end: number,
  breaks: readonly ThematicBreakSpan[],
): string {
  const separator = breaks.find(
    (b) => b.start >= start && b.end <= end && body.slice(b.end, end).trim() === "",
  );
  return body.slice(start, separator?.start ?? end).trimEnd();
}

/**
 * Locate each phase's heading — by its `phase-NN` id, failing that by its
 * `{#anchor}` — and slice the preamble and one verbatim section per phase.
 * Left carries the ids of the phases with no heading, in plan order.
 */
export function locatePlanSections(
  planMd: string,
  phases: readonly LocatablePhase[],
): Either.Either<PlanSections, readonly string[]> {
  const body = planBody(planMd);
  const { headings, breaks } = rootBlocks(body);
  const taken = new Set<RootHeading>();
  const located: { readonly id: string; readonly heading: RootHeading }[] = [];
  const missing: string[] = [];

  for (const phase of phases) {
    const id = phase.id.toLowerCase();
    const anchor = stripHash(phase.planMarkdownAnchor);
    const heading =
      headings.find((h) => !taken.has(h) && h.phaseId === id) ??
      headings.find((h) => !taken.has(h) && h.anchor === anchor);
    if (heading === undefined) {
      missing.push(phase.id);
      continue;
    }
    taken.add(heading);
    located.push({ id: phase.id, heading });
  }

  if (missing.length > 0) return Either.left(missing);

  const ordered = located.toSorted((a, b) => a.heading.offset - b.heading.offset);
  const sections = new Map<string, string>();
  ordered.forEach(({ id, heading }, index) => {
    const end = ordered[index + 1]?.heading.offset ?? body.length;
    sections.set(id, sliceBefore(body, heading.offset, end, breaks));
  });
  const preambleEnd = ordered[0]?.heading.offset ?? body.length;
  return Either.right({ preamble: sliceBefore(body, 0, preambleEnd, breaks), sections });
}

/**
 * The lowercased `phase-NN` ids of the root-level `##` headings that begin with
 * one, in document order — the same heading recognition as
 * `locatePlanSections`.
 */
export function phaseHeadingIds(planMd: string): readonly string[] {
  return rootBlocks(planBody(planMd)).headings.flatMap((h) =>
    h.phaseId === null ? [] : [h.phaseId],
  );
}
