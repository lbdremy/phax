import { describe, expect, it } from "vitest";
import {
  BRIEF_PUSH_CAP,
  renderBriefSection,
  renderNoBrief,
  renderWholeBrief,
} from "../../src/domain/brief/render.js";
import type { BriefAnswer, BriefGuarantee } from "../../src/schemas/brief.js";

// Made-up guarantees, paths and wording throughout.
const INSTRUCTIONS = [
  "Before touching any file, planned or not, existing or not yet created, run `phax brief <path> [<path>…]` to see the guarantees over it, their state there, what is wrong and how to repair it.",
  "`phax brief` with no path prints this phase's brief whole, as the code stands now.",
  "To learn where the phase stands, run the gate commands listed under Execution rules. The brief never fails the phase.",
].join("\n");

function metGuarantee(id: string): BriefGuarantee {
  return {
    id,
    statement: `statement of ${id}`,
    places: [{ location: { file: `src/${id}.ts` }, state: "met" }],
  };
}

function lines(section: string): string[] {
  return section.split("\n");
}

describe("renderBriefSection — answered", () => {
  it("opens with the heading and intro", () => {
    const section = renderBriefSection({ kind: "answered", answer: { guarantees: [] } });
    expect(lines(section).slice(0, 3)).toEqual([
      "## Brief for this phase",
      "",
      "What the project's standard expects of the files this phase plans, and how each expectation stands, in the provider's order. It informs; the gate decides.",
    ]);
  });

  it("caps 53 guarantees at 50, in order, then names the 3 not shown and phax brief", () => {
    const ids = Array.from({ length: 53 }, (_, n) => `g${String(n + 1).padStart(2, "0")}`);
    const answer: BriefAnswer = {
      guarantees: ids.map((id, n) =>
        n === 0
          ? {
              id,
              statement: "nothing under src/ reads the clock",
              places: [
                {
                  location: { file: "src/a.ts", line: 3 },
                  state: "forbidden",
                  due: "this-phase",
                  what: "W1",
                  repair: "R1",
                },
              ],
            }
          : metGuarantee(id),
      ),
    };
    const section = renderBriefSection({ kind: "answered", answer });
    const guaranteeLines = lines(section).filter((line) => line.startsWith("- "));
    expect(BRIEF_PUSH_CAP).toBe(50);
    expect(guaranteeLines).toHaveLength(51);
    expect(guaranteeLines.slice(0, 50).map((line) => line.split(" ")[1])).toEqual(ids.slice(0, 50));
    const g01 = guaranteeLines[0] ?? "";
    expect(g01).toBe(
      "- g01 — nothing under src/ reads the clock · forbidden src/a.ts:3 (this phase)",
    );
    expect(g01).not.toContain("W1");
    expect(g01).not.toContain("R1");
    expect(section).not.toContain("g51");
    const notShown = guaranteeLines[50] ?? "";
    expect(notShown).toBe("- …and 3 more not shown. `phax brief` prints the phase's brief whole.");
  });

  it("shows exactly 50 guarantees with no not-shown line", () => {
    const answer: BriefAnswer = {
      guarantees: Array.from({ length: 50 }, (_, n) => metGuarantee(`g${n + 1}`)),
    };
    const section = renderBriefSection({ kind: "answered", answer });
    expect(section).not.toContain("not shown");
  });

  it("renders later, null due, accepted and missing places, skipping met ones", () => {
    const answer: BriefAnswer = {
      guarantees: [
        {
          id: "cli-registered",
          statement: "every command is registered",
          places: [
            { location: { file: "src/cli/a.ts" }, state: "met" },
            {
              location: { file: "src/cli/index.ts" },
              state: "missing",
              due: "later",
              what: "absent",
              repair: "register it",
            },
            {
              location: { file: "src/cli/b.ts", line: 7 },
              state: "forbidden",
              due: null,
              what: "bad",
              repair: "fix it",
            },
            {
              location: { file: "src/legacy.ts", line: 40 },
              state: "accepted",
              what: "known debt",
            },
          ],
        },
      ],
    };
    const section = renderBriefSection({ kind: "answered", answer });
    expect(section).toContain(
      "- cli-registered — every command is registered · missing src/cli/index.ts (later) · forbidden src/cli/b.ts:7 · accepted src/legacy.ts:40",
    );
    expect(section).not.toContain("src/cli/a.ts");
    expect(section).not.toContain("known debt");
  });

  it("marks a guarantee whose every place is met", () => {
    const section = renderBriefSection({
      kind: "answered",
      answer: { guarantees: [metGuarantee("pure-core")] },
    });
    expect(section).toContain("- pure-core — statement of pure-core · met");
  });

  it("keeps the provider's order, duplicates included", () => {
    const section = renderBriefSection({
      kind: "answered",
      answer: { guarantees: [metGuarantee("zeta"), metGuarantee("alpha"), metGuarantee("zeta")] },
    });
    const ids = lines(section)
      .filter((line) => line.startsWith("- "))
      .map((line) => line.split(" ")[1]);
    expect(ids).toEqual(["zeta", "alpha", "zeta"]);
  });

  it("says the provider has nothing to report on an empty answer", () => {
    const section = renderBriefSection({ kind: "answered", answer: { guarantees: [] } });
    expect(section).toContain(
      "The brief provider has nothing to report on this phase's planned files.",
    );
  });
});

describe("renderBriefSection — failed", () => {
  it("says the brief is unavailable and why", () => {
    const section = renderBriefSection({
      kind: "failed",
      reason: "brief provider exited with code 1",
    });
    expect(section).toContain(
      "The brief is unavailable at phase start (brief provider exited with code 1). `phax brief` may still answer.",
    );
  });
});

describe("renderBriefSection — every variant", () => {
  it("ends with the three instructions after a blank line", () => {
    const variants = [
      renderBriefSection({ kind: "answered", answer: { guarantees: [metGuarantee("g01")] } }),
      renderBriefSection({ kind: "answered", answer: { guarantees: [] } }),
      renderBriefSection({ kind: "failed", reason: "brief provider timed out" }),
    ];
    for (const section of variants) {
      expect(section.endsWith(`\n\n${INSTRUCTIONS}`)).toBe(true);
    }
  });
});

describe("renderWholeBrief", () => {
  it("prints every place with its state, location, due, what and repair", () => {
    const answer: BriefAnswer = {
      guarantees: [
        {
          id: "core-no-adapters",
          statement: "src/core imports no adapter from src/infra",
          places: [
            {
              location: { file: "src/core/billing/invoice.ts", line: 3 },
              state: "forbidden",
              due: "this-phase",
              what: "imports src/infra/stripe.ts",
              repair: "depend on PaymentPort from src/core/billing/port.ts",
            },
            { location: { file: "src/core/billing/port.ts" }, state: "met" },
          ],
        },
        {
          id: "money-as-cents",
          statement: "amounts are integer cents",
          places: [
            {
              location: { file: "src/core/billing/tax.ts" },
              state: "missing",
              due: "later",
              what: "tax amounts are computed as floats in the plan",
              repair: "compute tax in integer cents",
            },
            {
              location: { file: "src/core/billing/legacy.ts", line: 40 },
              state: "accepted",
              what: "floats kept for the old export",
            },
            {
              location: { file: "src/core/billing/rates.ts" },
              state: "forbidden",
              due: null,
              what: "rates are floats",
              repair: "store rates in basis points",
            },
          ],
        },
      ],
    };
    expect(renderWholeBrief(answer)).toBe(
      [
        "core-no-adapters — src/core imports no adapter from src/infra",
        "  forbidden  src/core/billing/invoice.ts:3   due this phase",
        "    what:    imports src/infra/stripe.ts",
        "    repair:  depend on PaymentPort from src/core/billing/port.ts",
        "  met        src/core/billing/port.ts",
        "money-as-cents — amounts are integer cents",
        "  missing    src/core/billing/tax.ts   due later",
        "    what:    tax amounts are computed as floats in the plan",
        "    repair:  compute tax in integer cents",
        "  accepted   src/core/billing/legacy.ts:40",
        "    what:    floats kept for the old export",
        "  forbidden  src/core/billing/rates.ts",
        "    what:    rates are floats",
        "    repair:  store rates in basis points",
      ].join("\n"),
    );
  });

  it("prints all 53 guarantees in the provider's order, with no cap", () => {
    const ids = Array.from({ length: 53 }, (_, n) => `g${String(n + 1).padStart(2, "0")}`);
    const whole = renderWholeBrief({ guarantees: ids.map(metGuarantee) });
    const headers = lines(whole).filter((line) => !line.startsWith(" "));
    expect(headers).toEqual(ids.map((id) => `${id} — statement of ${id}`));
    expect(whole).not.toContain("not shown");
  });
});

describe("renderNoBrief", () => {
  it("names the paths asked about", () => {
    expect(renderNoBrief(["src/x.ts"])).toBe("No brief for src/x.ts.");
    expect(renderNoBrief(["src/x.ts", "src/y.ts"])).toBe("No brief for src/x.ts, src/y.ts.");
  });

  it("names the phase's planned files for the phase's brief", () => {
    expect(renderNoBrief(null)).toBe("No brief for this phase's planned files.");
  });
});
