import { describe, expect, it } from "vitest";
import { renderGateSection } from "../../src/domain/gate/gateSection.js";
import type { GateStep } from "../../src/schemas/phaxConfig.js";

const steps: readonly GateStep[] = [
  { command: "pnpm lint", surface: "local", firing: "every-phase", output: "log" },
  { command: "pnpm build", surface: "product", firing: "terminal", output: "log" },
];

describe("renderGateSection", () => {
  it("lists one surface-tagged line per step, in the given order, commands verbatim", () => {
    const lines = renderGateSection(steps);
    expect(lines.filter((l) => l.startsWith("- "))).toEqual([
      "- local: pnpm lint",
      "- product: pnpm build",
    ]);
  });

  it("says no step runs for an empty list, and promises no fix loop", () => {
    const text = renderGateSection([]).join("\n");
    expect(text.startsWith("## Gate\n\nNo gate step runs after this session")).toBe(true);
    expect(renderGateSection([]).filter((l) => l.startsWith("- "))).toEqual([]);
    expect(text).not.toContain("resumes this same session");
    expect(text).toContain("the narrowest command that covers it");
  });

  it("states the gate contract", () => {
    const text = renderGateSection(steps).join("\n");
    expect(
      text.startsWith("## Gate\n\nAfter this session ends, phax runs these gate steps, in order:"),
    ).toBe(true);
    expect(text).toContain(
      "If a step fails, phax resumes this same session with its output and you fix it here.",
    );
    expect(text).toContain(
      "While you work, check each change with the narrowest command that covers it.",
    );
    expect(text).toContain(
      "You need not run a whole gate step before finishing: the gate runs it.",
    );
  });

  it("names no tool or package manager outside the step commands", () => {
    for (const fixed of [
      renderGateSection(steps)
        .filter((l) => !l.startsWith("- "))
        .join("\n"),
      renderGateSection([]).join("\n"),
    ]) {
      for (const tool of ["pnpm", "npm", "vitest", "jest", "cargo"]) {
        expect(fixed).not.toContain(tool);
      }
    }
  });
});
