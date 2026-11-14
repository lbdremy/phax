import { describe, expect, it } from "vitest";
import {
  describeNotCanonical,
  describePlanPathProblem,
  describeUnplannable,
  isCanonicalPlanPath,
  readPlanPath,
  type PlanPathReading,
  type UnplannableReason,
} from "../../src/domain/plan/planPath.js";

const canonical = (path: string): PlanPathReading => ({ kind: "canonical", path });
const rewritable = (written: string, to: string): PlanPathReading => ({
  kind: "rewritable",
  written,
  canonical: to,
});
const unplannable = (written: string, reason: UnplannableReason): PlanPathReading => ({
  kind: "unplannable",
  written,
  reason,
});

// Spec §4.
const SPEC_CASES: ReadonlyArray<PlanPathReading> = [
  canonical("src/widget.ts"),
  rewritable("./src/x.ts", "src/x.ts"),
  rewritable("src//x.ts", "src/x.ts"),
  rewritable("src/a/../x.ts", "src/x.ts"),
  unplannable("", "empty"),
  unplannable(".", "empty"),
  unplannable("./", "empty"),
  unplannable("a/..", "empty"),
  unplannable("/src/x.ts", "absolute"),
  unplannable("../x.ts", "leaves-repository"),
  unplannable("src/../../x.ts", "leaves-repository"),
  unplannable("src/", "directory"),
  unplannable("src\\x.ts", "backslash"),
];

const EDGE_CASES: ReadonlyArray<PlanPathReading> = [
  canonical("x"),
  canonical(".claude/skills/a/SKILL.md"),
  canonical("..a/b"),
  canonical("a/.b"),
  canonical("..."),
  canonical("src/*.ts"),
  unplannable("/", "absolute"),
  unplannable("a//", "directory"),
  unplannable("./a/./b/", "directory"),
  rewritable("a/b/..", "a"),
  unplannable("a/../../b", "leaves-repository"),
  unplannable("src//", "directory"),
];

describe("readPlanPath", () => {
  it.each(SPEC_CASES.map((c) => [c.kind === "canonical" ? c.path : c.written, c] as const))(
    "reads %j as in spec §4",
    (written, expected) => {
      expect(readPlanPath(written)).toEqual(expected);
    },
  );

  it.each(EDGE_CASES.map((c) => [c.kind === "canonical" ? c.path : c.written, c] as const))(
    "reads the edge spelling %j",
    (written, expected) => {
      expect(readPlanPath(written)).toEqual(expected);
    },
  );

  it("reads a canonical form as canonical, and varying the spelling never changes it", () => {
    for (const reading of [...SPEC_CASES, ...EDGE_CASES]) {
      if (reading.kind === "unplannable") continue;
      const form = reading.kind === "canonical" ? reading.path : reading.canonical;
      expect(readPlanPath(form)).toEqual(canonical(form));
      expect(readPlanPath(`./${form}`)).toEqual(rewritable(`./${form}`, form));
      const doubled = form.replace("/", "//");
      expect(readPlanPath(doubled)).toEqual(
        doubled === form ? canonical(form) : rewritable(doubled, form),
      );
    }
  });

  it("answers isCanonicalPlanPath from the reading", () => {
    expect(isCanonicalPlanPath("src/x.ts")).toBe(true);
    expect(isCanonicalPlanPath("./src/x.ts")).toBe(false);
    expect(isCanonicalPlanPath("src/")).toBe(false);
  });
});

describe("the message words", () => {
  it("names each reason exactly", () => {
    expect(describeUnplannable("empty")).toBe("is empty");
    expect(describeUnplannable("absolute")).toBe("is absolute");
    expect(describeUnplannable("leaves-repository")).toBe("leaves the repository");
    expect(describeUnplannable("directory")).toBe("names a directory");
    expect(describeUnplannable("backslash")).toBe("contains a backslash");
  });

  it("names the canonical form of a rewritable path", () => {
    expect(describeNotCanonical("src/x.ts")).toBe('is not canonical: write "src/x.ts"');
    expect(
      describePlanPathProblem({ kind: "rewritable", written: "./src/x.ts", canonical: "src/x.ts" }),
    ).toBe('is not canonical: write "src/x.ts"');
    expect(
      describePlanPathProblem({ kind: "unplannable", written: "src/", reason: "directory" }),
    ).toBe("names a directory");
  });
});
