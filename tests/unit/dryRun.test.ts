import { describe, it, expect } from "vitest";
import { buildDryRunReport, formatDryRunReport } from "../../src/app/dryRun.js";
import type { PhaxPlan } from "../../src/schemas/phaxPlan.js";
import type { ResolvedConfig } from "../../src/schemas/phaxConfig.js";
import { DEFAULT_SECURITY_PROFILE } from "../../src/schemas/securityConfig.js";

const minimalPlan: PhaxPlan = {
  version: 1,
  run: {
    shortName: "test-run",
    title: "Test Run",
    branch: "feat/test",
    backend: "claude-code-cli",
  },
  phases: [
    {
      id: "phase-01",
      title: "First phase",
      model: "claude-sonnet-4-6",
      effort: "medium",
      commit: { subject: "feat: add thing", body: "" },
    },
  ],
};

const minimalConfig: ResolvedConfig = {
  stateRoot: "/home/user/.phax",
  extractPlanModel: "claude-sonnet-4-6",
  extractPlanEffort: "medium",
  backend: "claude-code-cli",
  raw: {
    version: 1,
    project: { name: "test-project" },
    agent: { extractPlan: { model: "claude-sonnet-4-6", effort: "medium" } },
    gateProfiles: {
      full: ["pnpm test"],
    },
  },
  security: {
    profile: "secure",
    filesystem: { allowRead: [], allowWrite: [] },
    network: { profile: "provider-only", allowDomains: [] },
    mcp: { mode: "disabled", allow: [] },
  },
};

describe("buildDryRunReport / formatDryRunReport", () => {
  it("does not include Priority line when providerPriorityOverride is absent", () => {
    const report = buildDryRunReport(minimalPlan, minimalConfig);
    expect(report.providerPriorityOverride).toBeUndefined();
    const output = formatDryRunReport(report);
    expect(output).not.toContain("Priority:");
  });

  it("includes providerPriorityOverride in the report when provided", () => {
    const override = ["mistral-vibe", "claude-code"];
    const report = buildDryRunReport(minimalPlan, minimalConfig, undefined, override);
    expect(report.providerPriorityOverride).toEqual(override);
  });

  it("renders the Priority line with arrow-separated ids and (override) suffix", () => {
    const override = ["mistral-vibe", "claude-code"];
    const report = buildDryRunReport(minimalPlan, minimalConfig, "full", override);
    const output = formatDryRunReport(report);
    expect(output).toContain("Priority:     mistral-vibe → claude-code (override)");
  });

  it("renders a single-provider override correctly", () => {
    const report = buildDryRunReport(minimalPlan, minimalConfig, undefined, ["codex-cli"]);
    const output = formatDryRunReport(report);
    expect(output).toContain("Priority:     codex-cli (override)");
  });

  it("includes securityMode in the report", () => {
    const report = buildDryRunReport(minimalPlan, minimalConfig);
    expect(report.securityMode).toBe(DEFAULT_SECURITY_PROFILE);
  });

  it("uses passed securityMode over config default", () => {
    const report = buildDryRunReport(minimalPlan, minimalConfig, undefined, undefined, "unsafe");
    expect(report.securityMode).toBe("unsafe");
  });

  it("renders security mode in formatted output", () => {
    const report = buildDryRunReport(minimalPlan, minimalConfig);
    const output = formatDryRunReport(report);
    expect(output).toContain(`Security:     ${DEFAULT_SECURITY_PROFILE}`);
  });

  it("renders unsafe security mode in formatted output", () => {
    const report = buildDryRunReport(minimalPlan, minimalConfig, undefined, undefined, "unsafe");
    const output = formatDryRunReport(report);
    expect(output).toContain("Security:     unsafe");
  });
});
