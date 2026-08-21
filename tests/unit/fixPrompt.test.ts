import { describe, expect, it } from "vitest";
import { buildFixPrompt } from "../../src/domain/gate/fixPrompt.js";
import type { GateDiagnostic } from "../../src/schemas/gateDiagnostics.js";

const baseInput = {
  command: "pnpm test",
  exitCode: 1,
  attempt: 2,
  logContent: "some log output",
  logPath: "/phase-01/checks-attempt-02.log",
  diagnostics: [] as readonly GateDiagnostic[],
};

describe("buildFixPrompt", () => {
  it("renders the raw-log prompt when there are no diagnostics", () => {
    const prompt = buildFixPrompt(baseInput);

    expect(prompt).toContain("# Gate checks failed — fix required");
    expect(prompt).toContain("Gate run (attempt 2) failed.");
    expect(prompt).toContain("**Failed command:** `pnpm test`");
    expect(prompt).toContain("**Exit code:** 1");
    expect(prompt).toContain("## Gate output");
    expect(prompt).toContain("some log output");
    expect(prompt).toContain("Fix all issues revealed by the gate output above.");
    expect(prompt).not.toContain("## Diagnostics");
    expect(prompt).not.toContain("repair guide:");
  });

  it("renders file:line for a diagnostic with a line", () => {
    const diagnostics: readonly GateDiagnostic[] = [
      {
        rule: "no-unused-vars",
        location: { file: "src/foo.ts", line: 12 },
        message: "unused variable 'x'",
        repair: "remove the unused declaration",
      },
    ];

    const prompt = buildFixPrompt({ ...baseInput, diagnostics });

    expect(prompt).toContain("## Diagnostics");
    expect(prompt).toContain("no-unused-vars at src/foo.ts:12 — unused variable 'x'");
    expect(prompt).toContain("repair guide: remove the unused declaration");
  });

  it("renders file only for a diagnostic without a line", () => {
    const diagnostics: readonly GateDiagnostic[] = [
      {
        rule: "missing-license",
        location: { file: "package.json" },
        message: "license field is missing",
        repair: "add a license field",
      },
    ];

    const prompt = buildFixPrompt({ ...baseInput, diagnostics });

    expect(prompt).toContain("missing-license at package.json — license field is missing");
  });

  it("tells the agent to read repair guides before changing code and omits the raw log", () => {
    const diagnostics: readonly GateDiagnostic[] = [
      {
        rule: "no-unused-vars",
        location: { file: "src/foo.ts", line: 12 },
        message: "unused variable 'x'",
        repair: "remove the unused declaration",
      },
    ];

    const prompt = buildFixPrompt({ ...baseInput, diagnostics });

    expect(prompt).toContain(
      "Read each repair guide above before changing code, then fix every diagnostic.",
    );
    expect(prompt).not.toContain("## Gate output");
    expect(prompt).not.toContain("some log output");
    expect(prompt).toContain(`Full output: ${baseInput.logPath}`);
    expect(prompt).toContain("**Failed step:** `pnpm test` (1 diagnostic(s))");
  });
});
