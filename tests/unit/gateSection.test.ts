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

describe("renderGateSection — partial commands", () => {
  const withPartial: readonly GateStep[] = [
    {
      command: "pnpm lint",
      surface: "local",
      firing: "every-phase",
      output: "log",
      partial: { files: "pnpm exec oxlint <files>", diff: "git diff --name-only | xargs oxlint" },
    },
    {
      command: "pnpm test",
      surface: "local",
      firing: "every-phase",
      output: "log",
      partial: { files: "pnpm exec vitest run <files>" },
    },
    {
      command: "pnpm typecheck",
      surface: "local",
      firing: "every-phase",
      output: "log",
      partial: { diff: "pnpm exec tsc --noEmit" },
    },
  ];

  it("renders each declared variant under its step, files first, indented, verbatim", () => {
    expect(renderGateSection(withPartial)).toEqual([
      "## Gate",
      "",
      "After this session ends, phax runs these gate steps, in order:",
      "",
      "- local: pnpm lint",
      "  - on some files: pnpm exec oxlint <files>",
      "  - on your changes: git diff --name-only | xargs oxlint",
      "- local: pnpm test",
      "  - on some files: pnpm exec vitest run <files>",
      "- local: pnpm typecheck",
      "  - on your changes: pnpm exec tsc --noEmit",
      "",
      "If a step fails, phax resumes this same session with its output and you fix it here.",
      "While you work, check each change with the narrowest command that covers it.",
      `A step's "on some files" and "on your changes" commands check part of what the step checks.`,
      "Replace a placeholder such as <files> with the files you choose. phax does not run these commands.",
      "You need not run a whole gate step before finishing: the gate runs it.",
      "",
    ]);
  });

  it("explains partials only when some listed step declares one", () => {
    const text = renderGateSection(steps).join("\n");
    expect(text).not.toContain("on some files");
    expect(text).not.toContain("phax does not run these commands");
  });

  it("renders exactly the unchanged lines for steps without partial (ac-unchanged-without)", () => {
    expect(renderGateSection(steps)).toEqual([
      "## Gate",
      "",
      "After this session ends, phax runs these gate steps, in order:",
      "",
      "- local: pnpm lint",
      "- product: pnpm build",
      "",
      "If a step fails, phax resumes this same session with its output and you fix it here.",
      "While you work, check each change with the narrowest command that covers it.",
      "You need not run a whole gate step before finishing: the gate runs it.",
      "",
    ]);
  });

  it("names no tool in the fixed wording, partial explanation included", () => {
    const fixed = renderGateSection(withPartial)
      .filter((l) => !l.startsWith("- ") && !l.startsWith("  - "))
      .join("\n");
    for (const tool of ["pnpm", "npm", "vitest", "oxlint", "git", "cargo"]) {
      expect(fixed).not.toContain(tool);
    }
  });
});
