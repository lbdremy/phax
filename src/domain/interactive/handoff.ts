import { Either } from "effect";
import type { InteractiveHandoff } from "../../schemas/interactiveHandoff.js";

// The interactive handoff: what a stop leaves for the phases after it. One
// shape, whether a closing turn's answer is rendered into it or a person
// wrote `.phax-context/correction-handoff.md` themselves. Pure: no I/O.

export const INTERACTIVE_HANDOFF_SECTIONS = [
  "## What was corrected",
  "## The pattern to follow from now on",
  "## Guards",
  "## What the next phases need to know",
] as const;

type Section = (typeof INTERACTIVE_HANDOFF_SECTIONS)[number];

const CORRECTED: Section = INTERACTIVE_HANDOFF_SECTIONS[0];
const GUARDS: Section = INTERACTIVE_HANDOFF_SECTIONS[2];

const NO_GUARD_PREFIX = "no guard:";

/** The handoff of a stop where the person changed nothing. It passes validation. */
export const REVIEWED_WITHOUT_CHANGE_HANDOFF = [
  CORRECTED,
  "- Nothing: the phase was reviewed and no file changed.",
  "",
  INTERACTIVE_HANDOFF_SECTIONS[1],
  "- Keep following the pattern the phase set.",
  "",
  GUARDS,
  `- ${NO_GUARD_PREFIX} nothing was corrected.`,
  "",
  INTERACTIVE_HANDOFF_SECTIONS[3],
  "- Nothing beyond the phases' own handoffs.",
  "",
].join("\n");

interface FoundSection {
  readonly title: Section;
  readonly lines: readonly string[];
}

const LIST_ENTRY = /^(?:[-*]|\d+[.)])\s+(.*)$/;

function isSection(title: string): title is Section {
  return (INTERACTIVE_HANDOFF_SECTIONS as readonly string[]).includes(title);
}

// The level-2 headings outside code fences, with the lines under each.
function splitSections(markdown: string): {
  readonly sections: readonly FoundSection[];
  readonly unknown: readonly string[];
} {
  const sections: FoundSection[] = [];
  const unknown: string[] = [];
  let current: { title: Section; lines: string[] } | null = null;
  let fence: string | null = null;
  for (const line of markdown.split(/\r?\n/)) {
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fenceMatch !== null) {
      const marker = fenceMatch[1] ?? "";
      if (fence === null) fence = marker;
      else if (marker.startsWith(fence.charAt(0)) && marker.length >= fence.length) fence = null;
    }
    const heading = fence === null ? /^## (.+?)\s*$/.exec(line) : null;
    if (heading !== null) {
      const title = `## ${heading[1] ?? ""}`;
      if (isSection(title)) {
        current = { title, lines: [] };
        sections.push(current);
      } else {
        unknown.push(title);
        current = null;
      }
      continue;
    }
    current?.lines.push(line);
  }
  return { sections, unknown };
}

// A section's top-level list entries: lines at column 0, with the indented
// lines under an entry belonging to it.
function listEntries(lines: readonly string[]): string[] {
  const entries: string[] = [];
  for (const line of lines) {
    const match = LIST_ENTRY.exec(line);
    if (match !== null) entries.push((match[1] ?? "").trim());
  }
  return entries;
}

/**
 * The markdown unchanged when it is a valid interactive handoff, else every
 * defect found: a missing, repeated, unexpected or out-of-order section, no
 * correction listed, or a `## Guards` that does not hold exactly one entry per
 * `## What was corrected` entry, in order, each naming a ref or starting
 * `no guard:` with a reason.
 */
export function validateInteractiveHandoff(
  markdown: string,
): Either.Either<string, readonly string[]> {
  const { sections, unknown } = splitSections(markdown);
  const defects: string[] = [];

  for (const title of unknown) {
    defects.push(`unexpected section "${title}"`);
  }
  for (const expected of INTERACTIVE_HANDOFF_SECTIONS) {
    const count = sections.filter((s) => s.title === expected).length;
    if (count === 0) defects.push(`missing section "${expected}"`);
    if (count > 1) defects.push(`section "${expected}" appears ${count} times`);
  }

  const seen = sections.map((s) => s.title).filter((t, i, all) => all.indexOf(t) === i);
  const expectedOrder = INTERACTIVE_HANDOFF_SECTIONS.filter((t) => seen.includes(t));
  seen.forEach((title, index) => {
    const wanted = expectedOrder[index];
    if (wanted !== undefined && wanted !== title) {
      defects.push(`section "${title}" is out of order: expected "${wanted}" here`);
    }
  });

  const corrected = sections.find((s) => s.title === CORRECTED);
  const guards = sections.find((s) => s.title === GUARDS);
  if (corrected !== undefined && guards !== undefined) {
    const correctedEntries = listEntries(corrected.lines);
    const guardEntries = listEntries(guards.lines);
    if (correctedEntries.length === 0) {
      defects.push(`"${CORRECTED}" lists no correction`);
    }
    if (correctedEntries.length !== guardEntries.length) {
      defects.push(
        `"${GUARDS}" holds ${guardEntries.length} entries for ${correctedEntries.length} corrections: one guard per correction, in order`,
      );
    }
    guardEntries.forEach((entry, index) => {
      if (entry.length === 0) {
        defects.push(
          `guard ${index + 1} is empty: name a ref or write "${NO_GUARD_PREFIX} <reason>"`,
        );
      } else if (
        entry.toLowerCase().startsWith(NO_GUARD_PREFIX) &&
        entry.slice(NO_GUARD_PREFIX.length).trim().length === 0
      ) {
        defects.push(`guard ${index + 1} says "${NO_GUARD_PREFIX}" without a reason`);
      }
    });
  }

  return defects.length === 0 ? Either.right(markdown) : Either.left(defects);
}

// One line per entry, so a multi-line answer cannot change the entry count.
function oneLine(text: string): string {
  return text.replace(/\s*\r?\n\s*/g, " ").trim();
}

function bullets(items: readonly string[]): string[] {
  return items.length === 0 ? ["- none"] : items.map((item) => `- ${oneLine(item)}`);
}

/**
 * The interactive handoff rendered from a closing turn's answer, in the four
 * sections. A guard that names nothing is written `no guard: <reason>`, and
 * an empty list reads `- none`.
 */
export function renderInteractiveHandoff(answer: InteractiveHandoff): string {
  return [
    CORRECTED,
    ...bullets(answer.corrections.map((c) => c.what)),
    "",
    INTERACTIVE_HANDOFF_SECTIONS[1],
    ...bullets(answer.patternFromNowOn),
    "",
    GUARDS,
    ...bullets(
      answer.corrections.map((c) =>
        c.guard.kind === "none" ? `${NO_GUARD_PREFIX} ${c.guard.reason}` : c.guard.ref,
      ),
    ),
    "",
    INTERACTIVE_HANDOFF_SECTIONS[3],
    ...bullets(answer.nextPhasesNeedToKnow),
    "",
  ].join("\n");
}
