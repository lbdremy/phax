// Text inputs of the plan-parser properties. Each value carries its `origin`, so a counter-example
// printed by the harness says how its text was made: from arbitrary strings, from a rendered plan
// with named line-level mutations, or from fragments of a large adversarial input.
import * as fc from "fast-check";
import { renderPlanBody } from "../../../src/domain/authoring/renderPlan.js";
import { planDocuments } from "./planDocuments.js";

export type PlanText = { readonly origin: string; readonly text: string };

const MAX_BYTES = 65_536;
const MAX_ANY_CHARS = 2_000;
const MAX_FRAGMENT_USES = 400;

/** A code point other than a surrogate: a file read as UTF-8 never holds a lone one. */
const wellFormedUnit: fc.Arbitrary<string> = fc
  .oneof(
    { weight: 3, arbitrary: fc.integer({ min: 0x20, max: 0x7e }) },
    { weight: 1, arbitrary: fc.integer({ min: 0, max: 0xd7ff }) },
    { weight: 1, arbitrary: fc.integer({ min: 0xe000, max: 0x10ffff }) },
  )
  .map((codePoint) => String.fromCodePoint(codePoint));

const PLAN_TOKENS = [
  "#",
  "## ",
  "### ",
  "## phase-01 — T {#phase-01-t}",
  "{#a}",
  "phase-02",
  " — ",
  " · ",
  "- ",
  "1. ",
  "  ",
  "    ",
  "\n",
  "\r\n",
  "\t",
  "`",
  "```",
  "~~~",
  "*",
  "**Recommended model:** ",
  "**Recommended effort:** ",
  "_",
  ">",
  "[",
  "]",
  "(none)",
  "---",
  "===",
  "|",
  "<div>",
] as const;

/** Arbitrary strings, and strings over a Markdown-and-plan token alphabet. */
export const anyPlanText = (): fc.Arbitrary<PlanText> =>
  fc.oneof(
    fc
      .string({ unit: wellFormedUnit, maxLength: MAX_ANY_CHARS })
      .map((text): PlanText => ({ origin: "arbitrary-unicode", text })),
    fc
      .string({ unit: fc.constantFrom(...PLAN_TOKENS), maxLength: MAX_ANY_CHARS })
      .map((text): PlanText => ({ origin: "plan-token-alphabet", text })),
  );

// ---- mutated plans -------------------------------------------------------------------------

export const PLAN_TEXT_MUTATIONS = [
  "heading-dropped",
  "section-duplicated",
  "list-item-emptied",
  "path-made-non-canonical",
  "line-inserted",
  "line-removed",
  "lines-swapped",
  "fence-inserted",
  "test-line-departs",
] as const;

type MutationName = (typeof PLAN_TEXT_MUTATIONS)[number];

/** A mutation as drawn: `at` and `pick` are free naturals, reduced modulo what they index. */
type Draw = { readonly name: MutationName; readonly at: number; readonly pick: number };

const HEADING = /^#{1,3} /;
const SECTION = /^### /;
const LIST_ITEM = /^\s*(?:[-*]|\d+\.) \S/;
const PATH_ITEM = /^- `([^`]+)`$/;
const SEPARATOR = / — | · /;

const INSERTED_LINES = [
  "# Inserted",
  "## Inserted",
  "### Inserted",
  "---",
  "```",
  "- ",
  "**Recommended model:** claude-haiku-5-5",
  "- note — small · example · table · in-phase",
] as const;

const NON_CANONICAL = [
  (p: string) => `./${p}`,
  (p: string) => `a/../${p}`,
  (p: string) => p.replaceAll("/", "\\"),
  (p: string) => `/${p}`,
  (p: string) => `${p}/`,
  (p: string) => `a//${p}`,
] as const;

const DEPARTURES = ["--", "-", "  "] as const;

const indicesWhere = (lines: readonly string[], test: (line: string) => boolean): number[] =>
  lines.flatMap((line, i) => (test(line) ? [i] : []));

/** The line indices of the `### Test strategy` items. */
const testLineIndices = (lines: readonly string[]): number[] => {
  let inStrategy = false;
  const found: number[] = [];
  lines.forEach((line, i) => {
    if (/^#{1,3} /.test(line)) inStrategy = line === "### Test strategy";
    else if (inStrategy && line.startsWith("- ") && SEPARATOR.test(line)) found.push(i);
  });
  return found;
};

/** Applies one mutation; `undefined` when no line is eligible for it. */
const mutate = (lines: readonly string[], draw: Draw): string[] | undefined => {
  const out = [...lines];
  const choose = (eligible: readonly number[]): number | undefined =>
    eligible.length === 0 ? undefined : eligible[draw.at % eligible.length];
  switch (draw.name) {
    case "heading-dropped": {
      const i = choose(indicesWhere(lines, (l) => HEADING.test(l)));
      if (i === undefined) return undefined;
      out.splice(i, 1);
      return out;
    }
    case "section-duplicated": {
      const i = choose(indicesWhere(lines, (l) => SECTION.test(l)));
      if (i === undefined) return undefined;
      let end = i + 1;
      while (end < lines.length && !HEADING.test(lines[end]!)) end += 1;
      out.splice(end, 0, ...lines.slice(i, end));
      return out;
    }
    case "list-item-emptied": {
      const i = choose(indicesWhere(lines, (l) => LIST_ITEM.test(l)));
      if (i === undefined) return undefined;
      out[i] = /^\s*/.exec(lines[i]!)![0] + "- ";
      return out;
    }
    case "path-made-non-canonical": {
      const i = choose(indicesWhere(lines, (l) => PATH_ITEM.test(l)));
      if (i === undefined) return undefined;
      const path = PATH_ITEM.exec(lines[i]!)![1]!;
      const rewrite = NON_CANONICAL[draw.pick % NON_CANONICAL.length]!;
      out[i] = `- \`${rewrite(path)}\``;
      return out;
    }
    case "line-inserted": {
      const at = lines.length === 0 ? 0 : draw.at % (lines.length + 1);
      out.splice(at, 0, INSERTED_LINES[draw.pick % INSERTED_LINES.length]!);
      return out;
    }
    case "line-removed": {
      const i = choose(lines.map((_, k) => k));
      if (i === undefined) return undefined;
      out.splice(i, 1);
      return out;
    }
    case "lines-swapped": {
      if (lines.length < 2) return undefined;
      const i = draw.at % (lines.length - 1);
      [out[i], out[i + 1]] = [lines[i + 1]!, lines[i]!];
      return out;
    }
    case "fence-inserted": {
      const i = choose(lines.map((_, k) => k));
      if (i === undefined) return undefined;
      if (draw.pick % 2 === 0) {
        out.splice(i, 0, "```");
      } else {
        const sections = indicesWhere(lines, (l) => SECTION.test(l));
        const start = sections.length === 0 ? i : sections[draw.at % sections.length]!;
        let end = start + 1;
        while (end < lines.length && !HEADING.test(lines[end]!)) end += 1;
        out.splice(end, 0, "~~~");
        out.splice(start + 1, 0, "~~~");
      }
      return out;
    }
    case "test-line-departs": {
      const i = choose(testLineIndices(lines));
      if (i === undefined) return undefined;
      const replacement = DEPARTURES[draw.pick % DEPARTURES.length]!;
      out[i] = lines[i]!.replace(SEPARATOR, (separator) =>
        replacement === "  " ? "  " : separator.replace(/[—·]/, replacement),
      );
      return out;
    }
  }
};

const drawArbitrary: fc.Arbitrary<Draw> = fc.record(
  {
    name: fc.constantFrom(...PLAN_TEXT_MUTATIONS),
    at: fc.nat(),
    pick: fc.nat(),
  },
  { noNullPrototype: true },
);

/** Renders `doc` and applies the draws in order; the names of those that found a line to change. */
const applyDraws = (
  rendered: string,
  draws: readonly Draw[],
): { readonly names: MutationName[]; readonly text: string } => {
  let lines = rendered.split("\n");
  const names: MutationName[] = [];
  for (const draw of draws) {
    const mutated = mutate(lines, draw);
    if (mutated === undefined) continue;
    lines = mutated;
    names.push(draw.name);
  }
  return { names, text: lines.join("\n") };
};

/** A rendered plan mutated 1 to 3 times; the origin lists the mutations applied, in order. */
export const mutatedPlanText = (): fc.Arbitrary<PlanText> =>
  fc
    .tuple(planDocuments(), fc.array(drawArbitrary, { minLength: 1, maxLength: 3 }))
    .map(([doc, draws]): PlanText => {
      const { names, text } = applyDraws(renderPlanBody(doc), draws);
      // A draw with no eligible line is still named, as `line-inserted` always applies: fall back
      // to it so every mutated text names at least one mutation.
      if (names.length > 0) return { origin: `mutated: ${names.join(", ")}`, text };
      const fallback = applyDraws(renderPlanBody(doc), [{ name: "line-inserted", at: 0, pick: 0 }]);
      return { origin: `mutated: ${fallback.names.join(", ")}`, text: fallback.text };
    });

// ---- large inputs --------------------------------------------------------------------------

export const LARGE_TEXT_FRAGMENTS = [
  "nested-lists",
  "nested-quotes",
  "character-run",
  "repeated-plan",
  "mutated-plans",
] as const;

type FragmentName = (typeof LARGE_TEXT_FRAGMENTS)[number];

const RUN_CHARACTERS = ["#", "*", "_", "`", ">", "[", "~", "-", "="] as const;

type Fragment = { readonly name: FragmentName; readonly text: string };

const nestedLists = fc
  .integer({ min: 1, max: 2_000 })
  .map((depth) => Array.from({ length: depth }, (_, i) => `${"  ".repeat(i)}- item`).join("\n"));

const nestedQuotes = fc
  .integer({ min: 1, max: 3_000 })
  .map((depth) => `${"> ".repeat(depth)}quoted\n`);

const characterRun = fc
  .tuple(fc.constantFrom(...RUN_CHARACTERS), fc.integer({ min: 1, max: 20_000 }))
  .map(([character, length]) => character.repeat(length));

const renderedPlan = planDocuments().map((doc) => renderPlanBody(doc));

const repeatedPlan = fc
  .tuple(renderedPlan, fc.integer({ min: 2, max: 40 }))
  .map(([plan, count]) => Array.from({ length: count }, () => plan).join("\n"));

const mutatedPlans = fc
  .array(mutatedPlanText(), { minLength: 2, maxLength: 8 })
  .map((texts) => texts.map((t) => t.text).join("\n"));

const fragments: fc.Arbitrary<Fragment> = fc.oneof(
  nestedLists.map((text): Fragment => ({ name: "nested-lists", text })),
  nestedQuotes.map((text): Fragment => ({ name: "nested-quotes", text })),
  characterRun.map((text): Fragment => ({ name: "character-run", text })),
  repeatedPlan.map((text): Fragment => ({ name: "repeated-plan", text })),
  mutatedPlans.map((text): Fragment => ({ name: "mutated-plans", text })),
);

/**
 * The target size: mostly mid-sized, about one in eight near the cap. A near-cap input costs the
 * Markdown parser up to a second, so a larger share would eat the CI budget of the property tier.
 */
const targetBytes: fc.Arbitrary<number> = fc.oneof(
  { weight: 7, arbitrary: fc.integer({ min: 64, max: 24_000 }) },
  { weight: 1, arbitrary: fc.integer({ min: 61_440, max: MAX_BYTES }) },
);

/** Cuts `text` to at most `maxBytes` UTF-8 bytes, at a code-point boundary. */
const cutToBytes = (text: string, maxBytes: number): string => {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  let bytes = 0;
  let end = 0;
  for (const codePoint of text) {
    const size = Buffer.byteLength(codePoint, "utf8");
    if (bytes + size > maxBytes) break;
    bytes += size;
    end += codePoint.length;
  }
  return text.slice(0, end);
};

/** Adversarial inputs of at most 65,536 UTF-8 bytes; the origin lists the fragments in order. */
export const largePlanText = (): fc.Arbitrary<PlanText> =>
  fc
    .tuple(fc.array(fragments, { minLength: 1, maxLength: 6 }), targetBytes)
    .map(([parts, target]): PlanText => {
      const used: FragmentName[] = [];
      let text = "";
      // Fragments are appended, cycling through the drawn ones, until the target is met; the
      // last is cut. The origin lists each fragment kind once, in order of first use.
      for (let i = 0; Buffer.byteLength(text, "utf8") < target && i < MAX_FRAGMENT_USES; i += 1) {
        const part = parts[i % parts.length]!;
        text = text === "" ? part.text : `${text}\n${part.text}`;
        if (!used.includes(part.name)) used.push(part.name);
      }
      return { origin: `large: ${used.join(", ")}`, text: cutToBytes(text, target) };
    });
