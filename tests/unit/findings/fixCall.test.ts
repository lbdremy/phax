import { describe, expect, it } from "vitest";
import {
  defaultFixSubject,
  fixCommitBody,
  isFindingId,
  splitFixOperands,
} from "../../../src/domain/findings/fixCall.js";

describe("isFindingId", () => {
  it.each([
    ["F1", true],
    ["C12", true],
    ["F0", false],
    ["F01", false],
    ["f1", false],
    ["G1", false],
    ["F", false],
    ["./F2", false],
    ["F2.ts", false],
    ["tests/gate.test.ts", false],
  ])("%s is %s", (word, expected) => {
    expect(isFindingId(word)).toBe(expected);
  });
});

describe("splitFixOperands", () => {
  it.each([
    {
      title: "ids then paths",
      operands: ["F2", "F5", "tests/gate.test.ts", "src/app/gate.ts"],
      ids: ["F2", "F5"],
      paths: ["tests/gate.test.ts", "src/app/gate.ts"],
    },
    {
      title: "a duplicate id is kept once, in the order given",
      operands: ["F5", "F2", "F5", "docs/gates.md"],
      ids: ["F5", "F2"],
      paths: ["docs/gates.md"],
    },
    {
      title: "no id",
      operands: ["tests/gate.test.ts"],
      ids: [],
      paths: ["tests/gate.test.ts"],
    },
    {
      title: "no path",
      operands: ["F1", "C2"],
      ids: ["F1", "C2"],
      paths: [],
    },
    {
      title: "a path spelled like an id after another path stays a path",
      operands: ["F1", "docs/gates.md", "F2"],
      ids: ["F1"],
      paths: ["docs/gates.md", "F2"],
    },
    {
      title: "a path spelled ./F2 is a path",
      operands: ["F1", "./F2"],
      ids: ["F1"],
      paths: ["./F2"],
    },
    { title: "nothing", operands: [], ids: [], paths: [] },
  ])("$title", ({ operands, ids, paths }) => {
    expect(splitFixOperands(operands)).toEqual({ ids, paths });
  });
});

describe("defaultFixSubject", () => {
  it("names the ids in the order given and the run", () => {
    expect(defaultFixSubject(["F2", "F5"], "gate-retry")).toBe("fix(review): F2, F5 of gate-retry");
  });

  it("names one id", () => {
    expect(defaultFixSubject(["C1"], "gate-retry")).toBe("fix(review): C1 of gate-retry");
  });
});

describe("fixCommitBody", () => {
  it("is the trailers alone without a body", () => {
    expect(fixCommitBody({ shortName: "gate-retry", ids: ["F2", "F5"], body: undefined })).toBe(
      "Short-Name: gate-retry\nFinding: F2\nFinding: F5",
    );
  });

  it("puts the paragraph, a blank line, then the trailers last and in order", () => {
    const body = fixCommitBody({
      shortName: "gate-retry",
      ids: ["F5", "F2"],
      body: "Keeps the exit code of the failed step.",
    });
    expect(body).toBe(
      "Keeps the exit code of the failed step.\n\nShort-Name: gate-retry\nFinding: F5\nFinding: F2",
    );
    expect(body).not.toContain("Run-Id");
  });

  it("treats a blank body as none", () => {
    expect(fixCommitBody({ shortName: "gate-retry", ids: ["F1"], body: "  \n" })).toBe(
      "Short-Name: gate-retry\nFinding: F1",
    );
  });
});
