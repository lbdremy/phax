import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Result } from "effect";
import type { Node, Parent } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { describe, expect, it } from "vitest";
import { splitFrontmatter } from "../../src/domain/artifact/frontmatter.js";
import { readPlanTree } from "../../src/domain/plan/planTree.js";

// Every plan reader parses through readPlanTree (the architectural guard keeps it so), so a
// committed plan that gets no refusal and the same tree as an unguarded parse reads exactly as it
// did before the nesting limit.

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const plansRoot = join(repoRoot, "docs", "plans");

const planFiles = readdirSync(plansRoot, { recursive: true, encoding: "utf8" })
  .filter((path) => path.endsWith(".md"))
  .map((path) => relative(repoRoot, join(plansRoot, path)).split("\\").join("/"))
  .toSorted();

// The deepest count of blockquote and listItem ancestors over every node of the tree.
function treeDepth(node: Node, depth = 0): number {
  const here = node.type === "blockquote" || node.type === "listItem" ? depth + 1 : depth;
  let deepest = here;
  for (const child of (node as Partial<Parent>).children ?? []) {
    deepest = Math.max(deepest, treeDepth(child, here));
  }
  return deepest;
}

const corpus = planFiles.map((path) => {
  const planMd = readFileSync(join(repoRoot, path), "utf8");
  const body = splitFrontmatter(planMd)?.body ?? planMd;
  const root = fromMarkdown(body);
  return { path, planMd, body, root, depth: treeDepth(root) };
});

const deepest = Math.max(0, ...corpus.map((plan) => plan.depth));

describe("the committed plans under docs/plans/", () => {
  it("include the archive", () => {
    expect(planFiles.length).toBeGreaterThan(10);
    expect(planFiles.some((path) => path.startsWith("docs/plans/archive/"))).toBe(true);
  });

  it(`every committed plan reads as before (deepest nesting: ${deepest})`, () => {
    for (const { path, planMd, body, root } of corpus) {
      expect(readPlanTree(planMd), path).toEqual(Result.succeed({ body, root }));
    }
    expect(deepest).toBeLessThan(32);
  });
});
