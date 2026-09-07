import { describe, expect, it } from "vitest";
import { buildFixPrompt } from "../../src/domain/gate/fixPrompt.js";
import type { GateDiagnostic, CompletionDiagnostic } from "../../src/schemas/gateDiagnostics.js";
import type { PendingStep } from "../../src/domain/errors.js";

const baseInput = {
  command: "pnpm test",
  exitCode: 1,
  attempt: 2,
  logContent: "some log output",
  logPath: "/phase-01/checks-attempt-02.log",
  diagnostics: [] as readonly GateDiagnostic[],
  pending: [] as readonly PendingStep[],
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
        class: "invariant",
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
        class: "invariant",
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
        class: "invariant",
        location: { file: "src/foo.ts", line: 12 },
        message: "unused variable 'x'",
        repair: "remove the unused declaration",
      },
    ];

    const prompt = buildFixPrompt({ ...baseInput, diagnostics });

    expect(prompt).toContain(
      "Read each repair guide above before changing code, then fix every diagnostic listed under **Diagnostics**.",
    );
    expect(prompt).not.toContain("## Gate output");
    expect(prompt).not.toContain("some log output");
    expect(prompt).toContain(`Full output: ${baseInput.logPath}`);
    expect(prompt).toContain("**Failed step:** `pnpm test` (1 diagnostic(s))");
  });

  it("omits the Pending section when there is nothing pending, in both branches", () => {
    const diagnostics: readonly GateDiagnostic[] = [
      {
        rule: "no-unused-vars",
        class: "invariant",
        location: { file: "src/foo.ts", line: 12 },
        message: "unused variable 'x'",
        repair: "remove the unused declaration",
      },
    ];

    expect(buildFixPrompt(baseInput)).not.toContain("## Pending");
    expect(buildFixPrompt({ ...baseInput, diagnostics })).not.toContain("## Pending");
  });

  it("renders the Pending section with open scopes and the repair guide", () => {
    const completion: CompletionDiagnostic = {
      rule: "missing-wiring",
      class: "completion",
      scopes: ["core", "adapters"],
      location: { file: "src/core/billing/port.ts" },
      message: "billing port is not wired up",
      repair: "wire the port into the adapter registry",
    };
    const pending: readonly PendingStep[] = [
      {
        command: "pnpm audit:diagnostics",
        pending: [{ diagnostic: completion, openScopes: ["adapters"] }],
      },
    ];

    const prompt = buildFixPrompt({ ...baseInput, pending });

    expect(prompt).toContain("## Pending (optional — not required to pass this gate)");
    expect(prompt).toContain("not required to pass");
    expect(prompt).toContain(
      "missing-wiring at src/core/billing/port.ts — billing port is not wired up (scopes still open: adapters)",
    );
    expect(prompt).toContain("repair guide: wire the port into the adapter registry");
  });

  it("keeps the invariant under Diagnostics only, with a separate Pending section", () => {
    const invariant: GateDiagnostic = {
      rule: "no-unused-vars",
      class: "invariant",
      location: { file: "src/foo.ts", line: 12 },
      message: "unused variable 'x'",
      repair: "remove the unused declaration",
    };
    const completion: CompletionDiagnostic = {
      rule: "missing-wiring",
      class: "completion",
      scopes: ["core"],
      location: { file: "src/core/billing/port.ts" },
      message: "billing port is not wired up",
      repair: "wire the port into the adapter registry",
    };
    const pending: readonly PendingStep[] = [
      {
        command: "pnpm audit:diagnostics",
        pending: [{ diagnostic: completion, openScopes: ["core"] }],
      },
    ];

    const prompt = buildFixPrompt({ ...baseInput, diagnostics: [invariant], pending });

    const diagnosticsIndex = prompt.indexOf("## Diagnostics");
    const pendingIndex = prompt.indexOf("## Pending");
    expect(diagnosticsIndex).toBeGreaterThan(-1);
    expect(pendingIndex).toBeGreaterThan(diagnosticsIndex);
    expect(prompt.slice(diagnosticsIndex, pendingIndex)).not.toContain("missing-wiring");
    expect(prompt).toContain("missing-wiring at src/core/billing/port.ts");
  });
});
