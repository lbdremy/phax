import { describe, expect, it } from "vitest";
import {
  declaresInteractive,
  oracleDeclaration,
  readHeaderParagraph,
  readPhaseHeaders,
  type PhaseHeader,
} from "../../src/domain/plan/phaseHeader.js";

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

  it("reads oracle files with and without a backtick wrap, dropping empty entries", () => {
    expect(readHeaderParagraph("**Oracle files:** `a.ts`, b.ts, , `c/d.ts`").oracleFiles).toEqual([
      "a.ts",
      "b.ts",
      "c/d.ts",
    ]);
    expect(readHeaderParagraph("**Oracle files:**").oracleFiles).toEqual([]);
    expect(readHeaderParagraph("**Mode:** interactive").oracleFiles).toBeNull();
  });

  it("reports repeated declaration labels", () => {
    const header = readHeaderParagraph(
      "**Mode:** interactive\n**Mode:** interactive\n**Oracle phase:** yes",
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
        "**Oracle phase:** discharged by phase-04",
        "**Oracle files:** `x.ts`",
      ]),
    );
    expect(header).toMatchObject({
      phase: "phase-01",
      assignmentReason: "why",
      mode: "interactive",
      oraclePhase: "discharged by phase-04",
      oracleFiles: ["x.ts"],
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
    const header = only(plan([], "- **Oracle phase:** yes\n- nested\n  - Oracle files: a.ts\n"));
    expect(header.misplaced).toEqual(["Oracle phase", "Oracle files"]);
  });

  it("flags a declaration in a second paragraph that carries no Recommended model", () => {
    const header = only(plan([], "Mode: interactive"));
    expect(header.misplaced).toEqual(["Mode"]);
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

describe("oracleDeclaration", () => {
  it("reads yes as the next phase", () => {
    const header = only(plan(["**Oracle phase:** yes", "**Oracle files:** `a.ts`"]));
    expect(oracleDeclaration(header)).toEqual({ dischargedBy: { kind: "next" }, files: ["a.ts"] });
  });

  it("reads discharged by phase-NN", () => {
    const header = only(
      plan(["**Oracle phase:** discharged by phase-04", "**Oracle files:** a.ts"]),
    );
    expect(oracleDeclaration(header)).toEqual({
      dischargedBy: { kind: "phase", id: "phase-04" },
      files: ["a.ts"],
    });
  });

  it("allows an empty files list", () => {
    const header = only(plan(["**Oracle phase:** yes", "**Oracle files:**"]));
    expect(oracleDeclaration(header)).toEqual({ dischargedBy: { kind: "next" }, files: [] });
  });

  it.each([
    ["a malformed value", ["**Oracle phase:** maybe", "**Oracle files:** a.ts"]],
    ["a missing files line", ["**Oracle phase:** yes"]],
    ["a missing phase line", ["**Oracle files:** a.ts"]],
    [
      "a repeated line",
      ["**Oracle phase:** yes", "**Oracle phase:** yes", "**Oracle files:** a.ts"],
    ],
  ])("is null for %s", (_name, lines) => {
    expect(oracleDeclaration(only(plan(lines)))).toBeNull();
  });

  it("is null when a line sits outside the header", () => {
    const header = only(plan(["**Oracle phase:** yes"], "**Oracle files:** a.ts"));
    expect(oracleDeclaration(header)).toBeNull();
  });
});
