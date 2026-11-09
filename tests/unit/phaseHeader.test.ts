import { describe, expect, it } from "vitest";
import { Result } from "effect";
import {
  declaresInteractive,
  acceptanceDeclaration,
  phaseKinds,
  readHeaderParagraph,
  readPhaseHeaders,
  withPhaseKinds,
  type PhaseHeader,
} from "../../src/domain/plan/phaseHeader.js";
import type { ExtractionPlan } from "../../src/schemas/planExtraction.js";

function plan(headerLines: readonly string[], rest = ""): string {
  return [
    "# Plan",
    "",
    "## phase-01 — One {#phase-01-one}",
    "",
    "**Recommended model:** claude-sonnet-5-5",
    "**Recommended effort:** medium",
    ...headerLines,
    "",
    "### Detailed instructions",
    "",
    rest,
  ].join("\n");
}

function only(planMd: string): PhaseHeader {
  const headers = readPhaseHeaders(planMd);
  expect(headers).toHaveLength(1);
  return headers[0]!;
}

describe("readHeaderParagraph", () => {
  it.each([
    "**Mode:** interactive",
    "**Mode**: interactive",
    "Mode: interactive",
    "MODE: interactive",
    "*Mode:* interactive",
    "__Mode:__ interactive",
    "_Mode_: interactive",
  ])("reads a Mode line written as %s", (line) => {
    expect(readHeaderParagraph(line).mode).toBe("interactive");
  });

  it("reads the Assignment reason text and Model reason presence", () => {
    const header = readHeaderParagraph(
      "**Assignment reason:** Wide change, needs care.\n**Model reason:** old",
    );
    expect(header.assignmentReason).toBe("Wide change, needs care.");
    expect(header.hasModelReason).toBe(true);
    expect(readHeaderParagraph("**Recommended model:** x").assignmentReason).toBeNull();
    expect(readHeaderParagraph("**Recommended model:** x").hasModelReason).toBe(false);
  });

  it("reads acceptance test files with and without a backtick wrap, dropping empty entries", () => {
    expect(
      readHeaderParagraph("**Acceptance test files:** `a.ts`, b.ts, , `c/d.ts`").acceptanceFiles,
    ).toEqual(["a.ts", "b.ts", "c/d.ts"]);
    expect(readHeaderParagraph("**Acceptance test files:**").acceptanceFiles).toEqual([]);
    expect(readHeaderParagraph("**Mode:** interactive").acceptanceFiles).toBeNull();
  });

  it("keeps a comma inside a code span as part of its path", () => {
    expect(
      readHeaderParagraph("**Acceptance test files:** `a,b.test.ts`, `c.ts`").acceptanceFiles,
    ).toEqual(["a,b.test.ts", "c.ts"]);
  });

  it("reports repeated declaration labels", () => {
    const header = readHeaderParagraph(
      "**Mode:** interactive\n**Mode:** interactive\n**Acceptance phase:** yes",
    );
    expect(header.repeated).toEqual(["Mode"]);
  });

  it("does not mistake Model reason or Recommended model for Mode", () => {
    const header = readHeaderParagraph("**Model reason:** because\n**Recommended model:** m");
    expect(header.mode).toBeNull();
  });
});

describe("readPhaseHeaders", () => {
  it("reads one header per phase heading, in document order, skipping frontmatter", () => {
    const md = [
      "---",
      "status: Approved",
      "---",
      "# Plan",
      "",
      "## phase-01 — One {#a}",
      "",
      "**Recommended model:** m",
      "**Recommended effort:** low",
      "**Mode:** interactive",
      "",
      "## Context",
      "",
      "**Mode:** interactive",
      "",
      "## phase-02 — Two {#b}",
      "",
      "**Recommended model:** m",
      "**Recommended effort:** low",
      "",
    ].join("\n");
    const headers = readPhaseHeaders(md);
    expect(headers.map((h) => h.phase)).toEqual(["phase-01", "phase-02"]);
    expect(headers[0]!.mode).toBe("interactive");
    expect(headers[0]!.misplaced).toEqual([]);
    expect(headers[1]!.mode).toBeNull();
  });

  it("reads all lines of the header paragraph", () => {
    const header = only(
      plan([
        "**Assignment reason:** why",
        "**Mode:** interactive",
        "**Acceptance phase:** passed by phase-04",
        "**Acceptance test files:** `x.ts`",
      ]),
    );
    expect(header).toMatchObject({
      phase: "phase-01",
      assignmentReason: "why",
      mode: "interactive",
      acceptancePhase: "passed by phase-04",
      acceptanceFiles: ["x.ts"],
      repeated: [],
      misplaced: [],
    });
  });

  it("flags a declaration at the start of a line of another paragraph", () => {
    const header = only(plan([], "Some text.\n\n**Mode:** interactive\n"));
    expect(header.mode).toBeNull();
    expect(header.misplaced).toEqual(["Mode"]);
  });

  it("flags a declaration in a list item under a ### section", () => {
    const header = only(
      plan([], "- **Acceptance phase:** yes\n- nested\n  - Acceptance test files: a.ts\n"),
    );
    expect(header.misplaced).toEqual(["Acceptance phase", "Acceptance test files"]);
  });

  it("flags a declaration in a second paragraph that carries no Recommended model", () => {
    const header = only(plan([], "Mode: interactive"));
    expect(header.misplaced).toEqual(["Mode"]);
  });

  it("flags a declaration on a line of a blockquote", () => {
    const header = only(plan([], "> A note.\n> **Mode:** interactive\n"));
    expect(header.misplaced).toEqual(["Mode"]);
  });

  it("reports a Model reason line set off from the header by a blank line", () => {
    const header = only(plan(["", "**Model reason:** old label"]));
    expect(header.hasModelReason).toBe(true);
  });

  it.each([
    ["in the header paragraph", ["**Oracle phase:** yes", "**Oracle files:** `a.ts`"], ""],
    ["outside the header paragraph", [], "**Oracle phase:** yes\n\n- Oracle files: a.ts\n"],
    [
      "split across the header and a later paragraph",
      ["*Oracle phase*: yes"],
      "Oracle files: a.ts",
    ],
  ])("recognizes the old Oracle labels %s and declares nothing", (_name, lines, rest) => {
    const header = only(plan(lines, rest));
    expect(header).toMatchObject({
      hasOraclePhaseLine: true,
      hasOracleFilesLine: true,
      acceptancePhase: null,
      acceptanceFiles: null,
      repeated: [],
      misplaced: [],
    });
    expect(acceptanceDeclaration(header)).toBeNull();
    expect(phaseKinds(header, "phase-02")).toEqual({ mode: "headless", acceptance: null });
  });

  it("flags each old label on its own, and neither on a phase without them", () => {
    const phaseOnly = only(plan(["**Oracle phase:** passed by phase-04"]));
    expect(phaseOnly.hasOraclePhaseLine).toBe(true);
    expect(phaseOnly.hasOracleFilesLine).toBe(false);
    const filesOnly = only(plan([], "**Oracle files:** a.ts"));
    expect(filesOnly.hasOraclePhaseLine).toBe(false);
    expect(filesOnly.hasOracleFilesLine).toBe(true);
    const none = only(plan(["**Acceptance phase:** yes", "**Acceptance test files:** a.ts"]));
    expect(none.hasOraclePhaseLine).toBe(false);
    expect(none.hasOracleFilesLine).toBe(false);
  });

  it("treats inline code and code blocks as prose", () => {
    const header = only(
      plan([], "Write `**Mode:** interactive` to opt in.\n\n```\n**Mode:** interactive\n```\n"),
    );
    expect(header.misplaced).toEqual([]);
  });

  it("does not count a label that does not start a line", () => {
    const header = only(plan([], "Use the Mode: line for this."));
    expect(header.misplaced).toEqual([]);
  });
});

describe("declaresInteractive", () => {
  it("is true exactly for the value interactive", () => {
    expect(declaresInteractive(only(plan(["**Mode:** interactive"])))).toBe(true);
    expect(declaresInteractive(only(plan(["**Mode:** review"])))).toBe(false);
    expect(declaresInteractive(only(plan([])))).toBe(false);
  });
});

describe("acceptanceDeclaration", () => {
  it("reads yes as the next phase", () => {
    const header = only(plan(["**Acceptance phase:** yes", "**Acceptance test files:** `a.ts`"]));
    expect(acceptanceDeclaration(header)).toEqual({ passedBy: { kind: "next" }, files: ["a.ts"] });
  });

  it("reads passed by phase-NN", () => {
    const header = only(
      plan(["**Acceptance phase:** passed by phase-04", "**Acceptance test files:** a.ts"]),
    );
    expect(acceptanceDeclaration(header)).toEqual({
      passedBy: { kind: "phase", id: "phase-04" },
      files: ["a.ts"],
    });
  });

  it("allows an empty files list", () => {
    const header = only(plan(["**Acceptance phase:** yes", "**Acceptance test files:**"]));
    expect(acceptanceDeclaration(header)).toEqual({ passedBy: { kind: "next" }, files: [] });
  });

  it.each([
    ["a malformed value", ["**Acceptance phase:** maybe", "**Acceptance test files:** a.ts"]],
    ["a missing files line", ["**Acceptance phase:** yes"]],
    ["a missing phase line", ["**Acceptance test files:** a.ts"]],
    [
      "a repeated line",
      ["**Acceptance phase:** yes", "**Acceptance phase:** yes", "**Acceptance test files:** a.ts"],
    ],
  ])("is null for %s", (_name, lines) => {
    expect(acceptanceDeclaration(only(plan(lines)))).toBeNull();
  });

  it("is null when a line sits outside the header", () => {
    const header = only(plan(["**Acceptance phase:** yes"], "**Acceptance test files:** a.ts"));
    expect(acceptanceDeclaration(header)).toBeNull();
  });
});

describe("phaseKinds", () => {
  it("is headless with no acceptance for a phase without declarations", () => {
    expect(phaseKinds(only(plan([])), "phase-02")).toEqual({ mode: "headless", acceptance: null });
  });

  it("is interactive exactly when declaresInteractive", () => {
    expect(phaseKinds(only(plan(["**Mode:** interactive"])), null).mode).toBe("interactive");
    expect(phaseKinds(only(plan(["**Mode:** review"])), null).mode).toBe("headless");
  });

  it("resolves yes to the next phase id", () => {
    const header = only(
      plan(["**Acceptance phase:** yes", "**Acceptance test files:** `a.ts`, b.ts"]),
    );
    expect(phaseKinds(header, "phase-02").acceptance).toEqual({
      passedBy: "phase-02",
      files: ["a.ts", "b.ts"],
    });
  });

  it("keeps an explicit passing phase, with or without a next phase", () => {
    const header = only(
      plan(["**Acceptance phase:** passed by phase-04", "**Acceptance test files:** a.ts"]),
    );
    for (const next of ["phase-02", null]) {
      expect(phaseKinds(header, next).acceptance).toEqual({
        passedBy: "phase-04",
        files: ["a.ts"],
      });
    }
  });

  it("is null for yes on the last phase, and for a malformed declaration", () => {
    const yes = only(plan(["**Acceptance phase:** yes", "**Acceptance test files:** a.ts"]));
    expect(phaseKinds(yes, null).acceptance).toBeNull();
    const malformed = only(
      plan(["**Acceptance phase:** maybe", "**Acceptance test files:** a.ts"]),
    );
    expect(phaseKinds(malformed, "phase-02").acceptance).toBeNull();
  });
});

/** An extraction model's answer phase: no title, no mode, no acceptance. */
function answerPhase(id: string): ExtractionPlan["phases"][number] {
  return {
    id,
    model: "claude-sonnet-5-5",
    effort: "medium",
    planMarkdownAnchor: `#${id}`,
    plannedFilesToCreate: [],
    plannedFilesToEdit: [],
    optionalFilesToEdit: [],
    testLines: [],
    commit: { subject: "feat: x", body: "Body." },
  };
}

function answer([first, ...rest]: readonly [string, ...string[]]): ExtractionPlan {
  return {
    run: { shortName: "plan", title: "Plan", requiredCommands: [] },
    phases: [answerPhase(first), ...rest.map(answerPhase)],
  };
}

describe("withPhaseKinds", () => {
  const twoPhases = [
    "# Plan",
    "",
    "## phase-01 — One {#phase-01-one}",
    "",
    "**Recommended model:** claude-sonnet-5-5",
    "**Recommended effort:** medium",
    "**Acceptance phase:** yes",
    "**Acceptance test files:** `a.test.ts`",
    "",
    "## phase-02 — Two {#phase-02-two}",
    "",
    "**Recommended model:** claude-sonnet-5-5",
    "**Recommended effort:** medium",
    "**Mode:** interactive",
    "",
  ].join("\n");

  it("adds each phase's mode and acceptance from its header lines, after optionalFilesToEdit and before the answer's testLines", () => {
    const result = withPhaseKinds(answer(["phase-01", "phase-02"]), twoPhases);
    if (Result.isFailure(result)) throw new Error(result.failure.message);
    const [first, second] = result.success.phases;
    expect(first).toMatchObject({
      mode: "headless",
      acceptance: { passedBy: "phase-02", files: ["a.test.ts"] },
      testLines: [],
    });
    expect(second).toMatchObject({ mode: "interactive", acceptance: null });
    expect(Object.keys(first!).slice(-5)).toEqual([
      "optionalFilesToEdit",
      "mode",
      "acceptance",
      "testLines",
      "commit",
    ]);
  });

  it("fails naming an answer phase with no heading in plan.md", () => {
    const result = withPhaseKinds(answer(["phase-01", "phase-09"]), twoPhases);
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure.message).toContain("phase-09");
  });
});
