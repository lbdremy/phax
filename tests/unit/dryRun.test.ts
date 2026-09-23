import { describe, it, expect } from "vitest";
import { buildDryRunReport, formatDryRunReport } from "../../src/app/dryRun.js";
import type { PhaxPlan } from "../../src/schemas/phaxPlan.js";
import {
  resolveAuthoringConfig,
  resolveCodeReviewConfig,
  type ResolvedConfig,
} from "../../src/schemas/phaxConfig.js";
import { resolveRecordsConfig } from "../../src/schemas/recordsConfig.js";
import { DEFAULT_SECURITY_PROFILE } from "../../src/schemas/securityConfig.js";

const minimalPlan: PhaxPlan = {
  version: 1,
  run: {
    shortName: "test-run",
    title: "Test Run",
    branch: "feat/test",
    requiredCommands: [],
  },
  phases: [
    {
      id: "phase-01",
      title: "First phase",
      model: "claude-sonnet-4-6",
      effort: "medium",
      planMarkdownAnchor: "#phase-01",
      plannedFilesToCreate: [],
      plannedFilesToEdit: [],
      optionalFilesToEdit: [],
      commit: { subject: "feat: add thing", body: "" },
    },
  ],
};

const minimalConfig: ResolvedConfig = {
  stateRoot: "/home/user/.phax",
  namespace: "test-project",
  extractPlanModel: "claude-sonnet-4-6",
  extractPlanEffort: "medium",
  raw: {
    version: 1,
    name: "test-project",
    state: { root: "/home/user/.phax" },
    agent: { extractPlan: { model: "claude-sonnet-4-6", effort: "medium" } },
    gateProfiles: {
      full: [{ command: "pnpm test", surface: "local", firing: "every-phase", output: "log" }],
    },
  },
  security: {
    profile: "secure",
    filesystem: { allowRead: [], allowWrite: [] },
    network: { profile: "provider-only" },
    mcp: { mode: "disabled", allow: [] },
    agentCommands: [],
  },
  repoRoot: "/home/user/project",
  maxFixAttempts: 1,
  fileReconciliationMode: "report_only",
  publish: {
    auto: false,
    remote: "origin",
    provider: "github",
    pushBranch: true,
    createPullRequest: true,
  },
  complianceReview: { enabled: false, model: "claude-sonnet-4-6", effort: "medium" },
  codeReview: resolveCodeReviewConfig(undefined),
  authoring: resolveAuthoringConfig(undefined),
  records: resolveRecordsConfig(undefined),
};

describe("buildDryRunReport / formatDryRunReport", () => {
  it("report includes qualifiedName composed from namespace and shortName", () => {
    const report = buildDryRunReport(minimalPlan, minimalConfig);
    expect(report.qualifiedName).toBe("test-project.test-run");
  });

  it("formatted output shows the qualified name as the run identity", () => {
    const report = buildDryRunReport(minimalPlan, minimalConfig);
    const output = formatDryRunReport(report);
    expect(output).toContain("Dry run: test-project.test-run");
  });

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

  it("includes empty agentCommands and requiredCommands in report", () => {
    const report = buildDryRunReport(minimalPlan, minimalConfig);
    expect(report.agentCommands).toEqual([]);
    expect(report.requiredCommands).toEqual([]);
    expect(report.uncoveredRequiredCommands).toEqual([]);
  });

  it("renders (none) for empty agentCommands and requiredCommands", () => {
    const report = buildDryRunReport(minimalPlan, minimalConfig);
    const output = formatDryRunReport(report);
    expect(output).toContain("Agent commands (security.agentCommands):");
    expect(output).toContain("Required commands (plan.run.requiredCommands):");
  });

  it("reports uncovered required commands and preflight warning", () => {
    const planWithRequired: PhaxPlan = {
      ...minimalPlan,
      run: { ...minimalPlan.run, requiredCommands: ["deno fmt"] },
    };
    const report = buildDryRunReport(planWithRequired, minimalConfig);
    expect(report.requiredCommands).toEqual(["deno fmt"]);
    expect(report.uncoveredRequiredCommands).toEqual(["deno fmt"]);
    const output = formatDryRunReport(report);
    expect(output).toContain("✗ deno fmt");
    expect(output).toContain("Preflight will fail");
  });

  it("marks covered required commands with a check", () => {
    const planWithRequired: PhaxPlan = {
      ...minimalPlan,
      run: { ...minimalPlan.run, requiredCommands: ["pnpm test"] },
    };
    const configWithAgentCmd = {
      ...minimalConfig,
      security: { ...minimalConfig.security, agentCommands: ["pnpm test"] },
    };
    const report = buildDryRunReport(planWithRequired, configWithAgentCmd as typeof minimalConfig);
    expect(report.uncoveredRequiredCommands).toEqual([]);
    const output = formatDryRunReport(report);
    expect(output).toContain("✓ pnpm test");
    expect(output).not.toContain("Preflight will fail");
  });

  describe("skill edit grants", () => {
    const planWithSkill: PhaxPlan = {
      ...minimalPlan,
      phases: [
        {
          ...minimalPlan.phases[0],
          plannedFilesToEdit: [".claude/skills/foo/SKILL.md", "src/x.ts"],
        },
      ],
    };

    it("lists per-phase grants and flags missing consent", () => {
      const report = buildDryRunReport(planWithSkill, minimalConfig);
      expect(report.phases[0]?.skillEditGrants).toEqual([".claude/skills/foo/SKILL.md"]);
      expect(report.skillEditConsentMissing).toBe(true);
      const output = formatDryRunReport(report);
      expect(output).toContain("skill edits: .claude/skills/foo/SKILL.md");
      expect(output).toContain("requires --allow-skill-edits");
    });

    it("does not flag consent when --allow-skill-edits is given", () => {
      const report = buildDryRunReport(
        planWithSkill,
        minimalConfig,
        undefined,
        undefined,
        undefined,
        true,
      );
      expect(report.skillEditConsentMissing).toBe(false);
      const output = formatDryRunReport(report);
      expect(output).toContain("skill edits: .claude/skills/foo/SKILL.md");
      expect(output).not.toContain("--allow-skill-edits");
    });

    it("shows no grants and no warning for a plan without skill files", () => {
      const report = buildDryRunReport(minimalPlan, minimalConfig);
      expect(report.phases[0]?.skillEditGrants).toEqual([]);
      expect(report.skillEditConsentMissing).toBe(false);
      expect(formatDryRunReport(report)).not.toContain("skill edits");
    });
  });
});
