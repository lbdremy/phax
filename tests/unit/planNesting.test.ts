import { Result } from "effect";
import * as fc from "fast-check";
import type { Node, Parent } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  collectPlanStructureErrors,
  extractPlanDeterministic,
  readPlanDeterministic,
  readPlanTestStrategies,
  readPlanUnplannablePaths,
} from "../../src/domain/plan/parsePlanMarkdown.js";
import { readPhaseHeaders } from "../../src/domain/plan/phaseHeader.js";
import { readPlanTree } from "../../src/domain/plan/planTree.js";
import {
  locatePlanSections,
  phaseHeadingIds,
  phaseHeadingSources,
} from "../../src/domain/plan/sections.js";
import { checkProperty, propertyTimeout } from "../helpers/property/harness.js";

// A pass-through spy: every reader still parses with the real parser, and the
// test can tell whether it was called at all.
vi.mock("mdast-util-from-markdown", async (importOriginal) => {
  const original = await importOriginal<typeof import("mdast-util-from-markdown")>();
  return { ...original, fromMarkdown: vi.fn(original.fromMarkdown) };
});

const message = (line: number): string =>
  `line ${line}: blockquotes and lists nest over 32 levels deep`;

// The deepest count of blockquote and listItem ancestors over every node of the tree.
function treeDepth(node: Node, depth = 0): number {
  const here = node.type === "blockquote" || node.type === "listItem" ? depth + 1 : depth;
  const children = (node as Partial<Parent>).children ?? [];
  let deepest = here;
  for (const child of children) deepest = Math.max(deepest, treeDepth(child, here));
  return deepest;
}

const bulletList = (levels: number): string =>
  Array.from({ length: levels }, (_, i) => `${"  ".repeat(i)}- item`).join("\n");

const refusedLine = (text: string): number | null => {
  const tree = readPlanTree(text);
  return Result.isFailure(tree) ? tree.failure.line : null;
};

describe("readPlanTree: the nesting limit", () => {
  it("reads a 2-space bullet list 32 levels deep, and refuses it at 33 on its line", () => {
    const read = readPlanTree(bulletList(32));
    expect(Result.isSuccess(read)).toBe(true);
    if (Result.isSuccess(read)) expect(treeDepth(read.success.root)).toBe(32);
    expect(readPlanTree(bulletList(33))).toEqual(Result.fail({ line: 33, message: message(33) }));
  });

  it("reads a `>` run of 32 and refuses one of 33", () => {
    expect(refusedLine(`${">".repeat(32)} x`)).toBeNull();
    expect(refusedLine(`${">".repeat(33)} x`)).toBe(1);
  });

  it("reads `> ` quotes with spaces at 32 and refuses them at 33", () => {
    expect(refusedLine(`${"> ".repeat(32)}x`)).toBeNull();
    expect(refusedLine(`intro\n\n${"> ".repeat(33)}x`)).toBe(3);
  });

  it("counts mixed `> - > -` containers on one line, and the space after each list marker", () => {
    // 2k markers and k - 1 counted spaces: 13 repeats estimate 32, 14 estimate 34.
    expect(refusedLine(`${"> - ".repeat(13)}x`)).toBeNull();
    expect(refusedLine(`${"> - ".repeat(14)}x`)).toBe(1);
    expect(refusedLine(`${"> ".repeat(31)}- x`)).toBeNull();
    expect(refusedLine(`${"> ".repeat(32)}- x`)).toBe(1);
  });

  it("counts ordered markers, `.` and `)`, of 1 to 9 digits", () => {
    // Three columns per level count one and a half: line 23 estimates 1 + 33.
    const ordered = (levels: number): string =>
      Array.from({ length: levels }, (_, i) => `${"   ".repeat(i)}1${i % 2 ? ")" : "."} x`).join(
        "\n",
      );
    expect(refusedLine(ordered(22))).toBeNull();
    expect(refusedLine(ordered(23))).toBe(23);
    expect(refusedLine(`${"> ".repeat(32)}123456789. x`)).toBe(1);
    expect(refusedLine(`${"> ".repeat(32)}7) x`)).toBe(1);
    // Ten digits, or no space after the delimiter, is no ordered marker.
    expect(refusedLine(`${"> ".repeat(32)}1234567890. x`)).toBeNull();
    expect(refusedLine(`${"> ".repeat(32)}1.x`)).toBeNull();
  });

  it("expands tabs to stops of 4, after `>` keeping all but the column `>` takes", () => {
    // Each tab is 4 columns, counting 2: line 17 estimates 1 + 32.
    const tabbed = (levels: number): string =>
      Array.from({ length: levels }, (_, i) => `${"\t".repeat(i)}- x`).join("\n");
    expect(refusedLine(tabbed(16))).toBeNull();
    expect(refusedLine(tabbed(17))).toBe(17);
    // `>\t` at column 0 or 4 leaves 2 columns pending, counted at the next `>`.
    expect(refusedLine(`${">\t".repeat(16)}x`)).toBeNull();
    expect(refusedLine(`${">\t".repeat(17)}x`)).toBe(1);
    // Whitespace after the last marker is not counted.
    expect(refusedLine(`${"> ".repeat(31)}>\t\tx`)).toBeNull();
  });

  it("may count a `>` inside a fenced code block", () => {
    const fenced = ["```", ">".repeat(40), "```"].join("\n");
    expect(refusedLine(fenced)).toBe(2);
  });

  it("numbers the refused line in the plan file, frontmatter lines counted", () => {
    const frontmatter = "---\nstatus: approved\nslug: deep\n---\n";
    expect(refusedLine(`${frontmatter}# Plan\n\n${">".repeat(40)}`)).toBe(7);
    // Only the body is measured: a deep frontmatter line is not refused.
    expect(refusedLine(`---\nnote: "${">".repeat(40)}"\n---\n# Plan\n`)).toBeNull();
  });

  it("reads CRLF and lone-CR endings as micromark does", () => {
    expect(refusedLine(`# Plan\r\n\r\n${">".repeat(40)}`)).toBe(3);
    expect(refusedLine(`# Plan\r\r${">".repeat(40)}`)).toBe(3);
    expect(refusedLine(`a\r\nb\rc\n${">".repeat(40)}`)).toBe(4);
  });

  it("gives the body and the tree the parser gives", () => {
    const plan = "---\nstatus: draft\n---\n# Plan\n\n- a\n  - b\n";
    const read = readPlanTree(plan);
    expect(read).toEqual(
      Result.succeed({
        body: "# Plan\n\n- a\n  - b\n",
        root: fromMarkdown("# Plan\n\n- a\n  - b\n"),
      }),
    );
  });
});

// ── never under-count ──────────────────────────────────────────────────────

interface Container {
  /** The marker text that opens it. */
  readonly open: string;
  /** The prefix that continues it on a later line. */
  readonly cont: string;
}

const quote: fc.Arbitrary<Container> = fc
  .constantFrom(">", "> ", ">\t")
  .chain((open) => fc.constantFrom(">", "> ").map((cont) => ({ open, cont })));

const bullet: fc.Arbitrary<Container> = fc
  .tuple(
    fc.constantFrom("-", "+", "*"),
    fc.integer({ min: 1, max: 4 }),
    fc.integer({ min: 0, max: 1 }),
  )
  .chain(([marker, spaces, extra]) =>
    fc
      .constantFrom(" ".repeat(1 + spaces + extra), "\t")
      .map((cont) => ({ open: `${marker}${" ".repeat(spaces)}`, cont })),
  );

const ordered: fc.Arbitrary<Container> = fc
  .tuple(
    fc.integer({ min: 1, max: 999 }),
    fc.constantFrom(".", ")"),
    fc.integer({ min: 1, max: 3 }),
  )
  .map(([n, delimiter, spaces]) => {
    const open = `${n}${delimiter}${" ".repeat(spaces)}`;
    return { open, cont: " ".repeat(open.length) };
  });

type LineOp =
  | { readonly kind: "open"; readonly pop: number; readonly opens: readonly Container[] }
  | { readonly kind: "lazy" }
  | { readonly kind: "blank" };

const container = fc.oneof(quote, bullet, ordered);

const lineOp: fc.Arbitrary<LineOp> = fc.oneof(
  {
    weight: 6,
    arbitrary: fc.record({
      kind: fc.constant("open" as const),
      pop: fc.integer({ min: 0, max: 3 }),
      opens: fc.array(container, { minLength: 0, maxLength: 6 }),
    }),
  },
  { weight: 1, arbitrary: fc.constant({ kind: "lazy" as const }) },
  { weight: 1, arbitrary: fc.constant({ kind: "blank" as const }) },
);

// Nested blockquote and list text about 20 to 45 levels deep: a first line opening
// 20 to 45 containers, then lines that continue, close and open containers.
const nestedText: fc.Arbitrary<string> = fc
  .tuple(
    fc.array(container, { minLength: 20, maxLength: 45 }),
    fc.array(lineOp, { minLength: 0, maxLength: 20 }),
  )
  .map(([first, ops]) => {
    const stack: Container[] = [...first];
    const lines = [`${first.map((c) => c.open).join("")}text`];
    for (const op of ops) {
      if (op.kind === "lazy") lines.push("lazy text");
      else if (op.kind === "blank") lines.push("");
      else {
        stack.splice(Math.max(0, stack.length - op.pop));
        const kept = stack.map((c) => c.cont).join("");
        lines.push(`${kept}${op.opens.map((c) => c.open).join("")}text`);
        stack.push(...op.opens.slice(0, Math.max(0, 45 - stack.length)));
      }
    }
    return lines.join("\n");
  });

// Minimal-form nesting: `> ` quotes, then a 2-space bullet list inside them.
const minimalText: fc.Arbitrary<string> = fc
  .tuple(fc.integer({ min: 0, max: 45 }), fc.integer({ min: 0, max: 45 }))
  .map(([quotes, levels]) =>
    Array.from({ length: Math.max(1, levels) }, (_, i) =>
      levels === 0 ? `${"> ".repeat(quotes)}x` : `${"> ".repeat(quotes)}${"  ".repeat(i)}- item`,
    ).join("\n"),
  );

describe("readPlanTree: the measure never under-counts", () => {
  it(
    "refuses every generated nesting the parser reads deeper than 32",
    () => {
      let deepDrawn = 0;
      checkProperty(nestedText, (text) => {
        const deep = treeDepth(fromMarkdown(text)) > 32;
        if (deep) deepDrawn += 1;
        return !deep || Result.isFailure(readPlanTree(text));
      });
      // The generator reaches past the limit often enough for the property to bite.
      expect(deepDrawn).toBeGreaterThan(10);
    },
    propertyTimeout(),
  );

  it(
    "refuses minimal-form nesting exactly when the parser reads it deeper than 32",
    () => {
      let deepDrawn = 0;
      checkProperty(minimalText, (text) => {
        const deep = treeDepth(fromMarkdown(text)) > 32;
        if (deep) deepDrawn += 1;
        return deep === Result.isFailure(readPlanTree(text));
      });
      expect(deepDrawn).toBeGreaterThan(10);
    },
    propertyTimeout(),
  );
});

// ── no parse over the limit ────────────────────────────────────────────────

const READERS: ReadonlyArray<readonly [string, (text: string) => unknown]> = [
  ["collectPlanStructureErrors", collectPlanStructureErrors],
  ["readPlanDeterministic", readPlanDeterministic],
  ["extractPlanDeterministic", extractPlanDeterministic],
  ["readPlanUnplannablePaths", readPlanUnplannablePaths],
  ["readPlanTestStrategies", readPlanTestStrategies],
  ["readPhaseHeaders", readPhaseHeaders],
  [
    "locatePlanSections",
    (text) => locatePlanSections(text, [{ id: "phase-01", planMarkdownAnchor: "#phase-01-a" }]),
  ],
  ["phaseHeadingIds", phaseHeadingIds],
  ["phaseHeadingSources", phaseHeadingSources],
];

describe("plan readers: no parse over the limit", () => {
  const spy = vi.mocked(fromMarkdown);
  beforeEach(() => spy.mockClear());

  const deep = `# Plan\n\n${bulletList(33)}\n`;
  const shallow = `# Plan\n\n${bulletList(32)}\n`;

  for (const [name, read] of READERS) {
    it(`${name} never calls the parser on a text over the limit, and calls it within`, () => {
      read(deep);
      expect(spy).not.toHaveBeenCalled();
      read(shallow);
      expect(spy).toHaveBeenCalled();
    });
  }
});
