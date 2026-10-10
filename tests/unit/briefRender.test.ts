import { describe, expect, it } from "vitest";
import {
  BRIEF_PUSH_CAP,
  isEmptyBrief,
  renderBriefSection,
  renderNoBrief,
  renderWholeBrief,
} from "../../src/domain/brief/render.js";
import type { BriefFinding, BriefReport, BriefRule } from "../../src/schemas/briefReport.js";

// The spec §6 brief report, made up, and made-up rules and findings below.
const GUIDE = { summary: "keep I/O in the module's caller", read: "guides/no-node-import.md" };

const EXPORTS_RULE: BriefRule = {
  rule: "a module under src/ exports its function",
  files: ["src/greet.ts", "src/farewell.ts"],
  guide: null,
};

const NO_IMPORT_RULE: BriefRule = {
  rule: "a module under src/ imports no node: module",
  files: ["src/greet.ts", "src/farewell.ts"],
  guide: GUIDE,
};

const GREET_FINDING: BriefFinding = {
  id: "no-node-import src/greet.ts node:fs",
  rule: "a module under src/ imports no node: module",
  location: { file: "src/greet.ts", lines: [1, 1] },
  message: "imports node:fs",
  related: [],
  guide: GUIDE,
  due: "this-phase",
};

const FAREWELL_FINDING: BriefFinding = {
  id: "exports-function src/farewell.ts",
  rule: "a module under src/ exports its function",
  location: { file: "src/farewell.ts", lines: null },
  message: "no exported function",
  related: [],
  guide: null,
  due: "later",
};

const REPORT: BriefReport = {
  rules: [EXPORTS_RULE, NO_IMPORT_RULE],
  findings: [GREET_FINDING, FAREWELL_FINDING],
};

const EMPTY: BriefReport = { rules: [], findings: [] };

const INSTRUCTIONS = [
  "Before touching any file, planned or not, existing or not yet created, run `phax brief <path> [<path>…]` to see the rules over it, what fails there and how to fix it.",
  "`phax brief` with no path prints this phase's brief whole, as the code stands now.",
  "To learn where the phase stands, run the gate commands listed under Execution rules. The brief never fails the phase.",
];

const GREET_LINE =
  "- src/greet.ts:1 — a module under src/ imports no node: module — imports node:fs · guide: keep I/O in the module's caller (read guides/no-node-import.md)";

function lines(section: string): string[] {
  return section.split("\n");
}

/** The section's item lines: everything between the intro and the instructions. */
function body(section: string): string[] {
  const all = lines(section);
  return all.slice(4, all.length - INSTRUCTIONS.length - 1);
}

function finding(n: number, due: BriefFinding["due"]): BriefFinding {
  return {
    id: `finding-${n}`,
    rule: `rule ${n}`,
    location: { file: `src/f${n}.ts`, lines: [n, n] },
    message: `message ${n}`,
    related: [],
    guide: null,
    due,
  };
}

function rule(n: number): BriefRule {
  return { rule: `rule ${n}`, files: [`src/r${n}.ts`], guide: null };
}

describe("renderBriefSection — findings", () => {
  const section = renderBriefSection({ kind: "answered", report: REPORT }, "findings");

  it("opens with the heading and the findings intro, and ends with the three instructions", () => {
    expect(lines(section).slice(0, 4)).toEqual([
      "## Brief for this phase",
      "",
      "What fails in this phase's planned files and is due in this phase, in the provider's order. It informs; the gate decides.",
      "",
    ]);
    expect(lines(section).slice(-4)).toEqual(["", ...INSTRUCTIONS]);
  });

  it("lists only what is due this phase: one line with location, rule, message and guide", () => {
    expect(body(section)).toEqual([GREET_LINE]);
    expect(section).not.toContain("src/farewell.ts");
    expect(section).not.toContain("- rule:");
  });

  it("never shows a finding id", () => {
    expect(section).not.toContain("no-node-import src/greet.ts node:fs");
  });

  it("never pushes a finding with a null due", () => {
    const report: BriefReport = { rules: [], findings: [{ ...GREET_FINDING, due: null }] };
    expect(body(renderBriefSection({ kind: "answered", report }, "findings"))).toEqual([
      "Nothing in this phase's planned files is due in this phase.",
    ]);
  });

  it("renders a ranged location as file:N-M and a finding without guide with no guide suffix", () => {
    const report: BriefReport = {
      rules: [],
      findings: [
        { ...FAREWELL_FINDING, location: { file: "src/cli.ts", lines: [3, 5] }, due: "this-phase" },
      ],
    };
    expect(body(renderBriefSection({ kind: "answered", report }, "findings"))).toEqual([
      "- src/cli.ts:3-5 — a module under src/ exports its function — no exported function",
    ]);
  });
});

describe("renderBriefSection — findings-and-rules", () => {
  const section = renderBriefSection({ kind: "answered", report: REPORT }, "findings-and-rules");

  it("names the rules in its intro", () => {
    expect(lines(section)[2]).toBe(
      "What fails in this phase's planned files and is due in this phase, then the rules over those files, in the provider's order. It informs; the gate decides.",
    );
  });

  it("lists the due findings, then one line per rule in the report's order", () => {
    expect(body(section)).toEqual([
      GREET_LINE,
      "- rule: a module under src/ exports its function — src/greet.ts, src/farewell.ts",
      "- rule: a module under src/ imports no node: module — src/greet.ts, src/farewell.ts · guide: keep I/O in the module's caller (read guides/no-node-import.md)",
    ]);
    expect(section).not.toContain("no exported function");
  });
});

describe("the pushed brief stops at 50 lines", () => {
  it("45 due findings, 5 later and 10 rules give 45 findings, 5 rules and 5 more", () => {
    const report: BriefReport = {
      rules: Array.from({ length: 10 }, (_, n) => rule(n + 1)),
      findings: [
        ...Array.from({ length: 45 }, (_, n) => finding(n + 1, "this-phase")),
        ...Array.from({ length: 5 }, (_, n) => finding(n + 46, "later")),
      ],
    };
    const items = body(renderBriefSection({ kind: "answered", report }, "findings-and-rules"));
    expect(BRIEF_PUSH_CAP).toBe(50);
    expect(items).toHaveLength(51);
    expect(items.slice(0, 45).map((line) => line.split(" ")[1])).toEqual(
      Array.from({ length: 45 }, (_, n) => `src/f${n + 1}.ts:${n + 1}`),
    );
    expect(items.slice(45, 50)).toEqual(
      Array.from({ length: 5 }, (_, n) => `- rule: rule ${n + 1} — src/r${n + 1}.ts`),
    );
    expect(items[50]).toBe("- …and 5 more not shown. `phax brief` prints the phase's brief whole.");
    expect(items.join("\n")).not.toContain("src/f46.ts");
  });

  it("shows exactly 50 items with no overflow line", () => {
    const report: BriefReport = {
      rules: [],
      findings: Array.from({ length: 50 }, (_, n) => finding(n + 1, "this-phase")),
    };
    const items = body(renderBriefSection({ kind: "answered", report }, "findings"));
    expect(items).toHaveLength(50);
    expect(items.join("\n")).not.toContain("more not shown");
  });
});

describe("nothing to push", () => {
  it("findings: a report whose only finding is due later is one line", () => {
    const report: BriefReport = { rules: [NO_IMPORT_RULE], findings: [FAREWELL_FINDING] };
    const section = renderBriefSection({ kind: "answered", report }, "findings");
    expect(body(section)).toEqual(["Nothing in this phase's planned files is due in this phase."]);
    expect(lines(section).slice(-3)).toEqual(INSTRUCTIONS);
  });

  it("findings-and-rules: a report with no rule and no finding is one line", () => {
    const section = renderBriefSection({ kind: "answered", report: EMPTY }, "findings-and-rules");
    expect(body(section)).toEqual(["The brief lists nothing for this phase's planned files."]);
    expect(lines(section).slice(-3)).toEqual(INSTRUCTIONS);
  });
});

describe("renderBriefSection — failed", () => {
  it.each(["findings", "findings-and-rules"] as const)(
    "gives the unavailable line and the instructions with push %s",
    (push) => {
      const section = renderBriefSection(
        { kind: "failed", reason: "brief provider timed out" },
        push,
      );
      expect(body(section)).toEqual([
        "The brief is unavailable at phase start (brief provider timed out). `phax brief` may still answer.",
      ]);
      expect(lines(section).slice(-3)).toEqual(INSTRUCTIONS);
    },
  );
});

describe("renderWholeBrief", () => {
  it("prints the rules with their files and guides, then the findings with due, rule, message and guide", () => {
    expect(renderWholeBrief(REPORT)).toBe(
      [
        "Rules",
        "  a module under src/ exports its function",
        "    files:  src/greet.ts, src/farewell.ts",
        "  a module under src/ imports no node: module",
        "    files:  src/greet.ts, src/farewell.ts",
        "    guide:  keep I/O in the module's caller (read guides/no-node-import.md)",
        "Findings",
        "  src/greet.ts:1   due this phase",
        "    rule:   a module under src/ imports no node: module",
        "    found:  imports node:fs",
        "    guide:  keep I/O in the module's caller (read guides/no-node-import.md)",
        "  src/farewell.ts   due later",
        "    rule:   a module under src/ exports its function",
        "    found:  no exported function",
      ].join("\n"),
    );
  });

  it("prints each related location under its finding, and nothing for a null due", () => {
    const report: BriefReport = {
      rules: [],
      findings: [
        {
          ...GREET_FINDING,
          due: null,
          related: [
            { file: "src/cli.ts", lines: [3, 5], why: "the caller, where the read belongs" },
          ],
        },
      ],
    };
    expect(renderWholeBrief(report)).toBe(
      [
        "Findings",
        "  src/greet.ts:1",
        "    rule:   a module under src/ imports no node: module",
        "    found:  imports node:fs",
        "    also involves src/cli.ts:3-5 — the caller, where the read belongs",
        "    guide:  keep I/O in the module's caller (read guides/no-node-import.md)",
      ].join("\n"),
    );
  });

  it("never prints a finding id", () => {
    expect(renderWholeBrief(REPORT)).not.toContain("no-node-import src/greet.ts");
    expect(renderWholeBrief(REPORT)).not.toContain("exports-function src/farewell.ts");
  });

  it("prints rules alone when there is no finding", () => {
    expect(renderWholeBrief({ rules: [EXPORTS_RULE], findings: [] })).toBe(
      [
        "Rules",
        "  a module under src/ exports its function",
        "    files:  src/greet.ts, src/farewell.ts",
      ].join("\n"),
    );
  });
});

describe("isEmptyBrief and renderNoBrief", () => {
  it("is empty only with no rule and no finding", () => {
    expect(isEmptyBrief(EMPTY)).toBe(true);
    expect(isEmptyBrief({ rules: [EXPORTS_RULE], findings: [] })).toBe(false);
    expect(isEmptyBrief({ rules: [], findings: [FAREWELL_FINDING] })).toBe(false);
  });

  it("names the paths, or the phase's planned files for the phase's brief", () => {
    expect(renderNoBrief(["src/a.ts", "src/b.ts"])).toBe("No brief for src/a.ts, src/b.ts.");
    expect(renderNoBrief(null)).toBe("No brief for this phase's planned files.");
  });
});

describe("line breaks in a brief report", () => {
  it("never add a line to the pushed brief, so the cap counts items", () => {
    const report: BriefReport = {
      rules: [],
      findings: [{ ...GREET_FINDING, message: "imports node:fs\n- a fake item\n- another" }],
    };
    const items = body(renderBriefSection({ kind: "answered", report }, "findings"));
    expect(items).toHaveLength(1);
    expect(items[0]).toContain("imports node:fs - a fake item - another");
  });

  it("are flattened in phax brief's whole form", () => {
    const report: BriefReport = {
      rules: [{ ...NO_IMPORT_RULE, rule: "a module under src/\nimports no node: module" }],
      findings: [],
    };
    expect(renderWholeBrief(report)).toContain("  a module under src/ imports no node: module");
  });
});
