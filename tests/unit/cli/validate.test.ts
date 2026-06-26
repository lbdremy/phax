import { describe, expect, it, vi, beforeEach } from "vitest";
import { Either } from "effect";
import { runValidate } from "../../../src/cli/commands/validate.js";

vi.mock("../../../src/app/loadConfig.js", () => ({
  loadConfig: vi.fn(),
  describeConfigSources: vi.fn(),
}));

vi.mock("../../../src/app/loadPlan.js", () => ({
  loadPlan: vi.fn(),
}));

function makeOutput() {
  const lines: string[] = [];
  const errors: string[] = [];
  return {
    out: {
      log: (m: string) => lines.push(m),
      warn: (m: string) => lines.push(`WARN: ${m}`),
      error: (m: string) => errors.push(m),
    },
    lines,
    errors,
  };
}

function makeConfig(namespace = "myproject") {
  return {
    raw: {} as never,
    namespace,
    stateRoot: "/fake-state",
    repoRoot: "/fake-repo",
    maxFixAttempts: 3,
    extractPlanModel: "claude-haiku-4-5-20251001",
    extractPlanEffort: "low" as const,
    fileReconciliationMode: "report_only" as const,
    security: {
      mode: "secure" as const,
      enforcedGates: [],
      allowedPaths: [],
      blockedCommands: [],
    },
    publish: {
      auto: false,
      remote: "origin",
      provider: "github" as const,
      pushBranch: true,
      createPullRequest: true,
    },
    complianceReview: {
      enabled: false,
      model: "claude-sonnet-4-6",
      effort: "medium" as const,
    },
  };
}

function makePlan(shortName = "myrun", phaseCount = 2) {
  return {
    version: 1,
    run: { shortName, title: "My Run", requiredCommands: [], branch: `phax/${shortName}` },
    phases: Array.from({ length: phaseCount }, (_, i) => ({
      id: `phase-0${i + 1}`,
      model: "claude-sonnet-4-6",
      effort: "medium" as const,
      planMarkdownAnchor: `phase-0${i + 1}`,
      plannedFilesToCreate: [],
      plannedFilesToEdit: [],
      optionalFilesToEdit: [],
      commit: { subject: `feat: phase ${i + 1}`, body: "" },
      title: `Phase ${i + 1}`,
    })),
  };
}

describe("runValidate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("config valid, no --plan: returns 0, logs config line and layer lines, loadPlan never called", async () => {
    const { loadConfig, describeConfigSources } = vi.mocked(
      await import("../../../src/app/loadConfig.js"),
    );
    const { loadPlan } = vi.mocked(await import("../../../src/app/loadPlan.js"));
    loadConfig.mockReturnValue(Either.right(makeConfig()));
    describeConfigSources.mockReturnValue({
      project: "/repo/phax.json",
      localOverlay: "/repo/phax.local.json",
      globalOverlay: undefined,
    });

    const { out, lines } = makeOutput();
    const code = runValidate({}, out);

    expect(code).toBe(0);
    expect(lines.some((l) => l.includes("config is valid") && l.includes("myproject"))).toBe(true);
    expect(lines.some((l) => l.includes("/repo/phax.json"))).toBe(true);
    expect(lines.some((l) => l.includes("/repo/phax.local.json"))).toBe(true);
    expect(lines.some((l) => l.includes("(none)"))).toBe(true);
    expect(loadPlan).not.toHaveBeenCalled();
  });

  it("config invalid: returns 1, prints config error, loadPlan never called", async () => {
    const { loadConfig } = vi.mocked(await import("../../../src/app/loadConfig.js"));
    const { loadPlan } = vi.mocked(await import("../../../src/app/loadPlan.js"));
    loadConfig.mockReturnValue(
      Either.left({ message: "no phax.json found", path: "/repo/phax.json" }),
    );

    const { out, errors } = makeOutput();
    const code = runValidate({}, out);

    expect(code).toBe(1);
    expect(errors.some((e) => e.includes("Config validation failed"))).toBe(true);
    expect(errors.some((e) => e.includes("/repo/phax.json"))).toBe(true);
    expect(loadPlan).not.toHaveBeenCalled();
  });

  it("config valid + --plan valid plan: returns 0, logs plan-valid line", async () => {
    const { loadConfig, describeConfigSources } = vi.mocked(
      await import("../../../src/app/loadConfig.js"),
    );
    const { loadPlan } = vi.mocked(await import("../../../src/app/loadPlan.js"));
    loadConfig.mockReturnValue(Either.right(makeConfig()));
    describeConfigSources.mockReturnValue({
      project: "/repo/phax.json",
      localOverlay: undefined,
      globalOverlay: undefined,
    });
    loadPlan.mockReturnValue(Either.right(makePlan("myrun", 3)));

    const { out, lines } = makeOutput();
    const code = runValidate({ plan: "phax-plan.json" }, out);

    expect(code).toBe(0);
    expect(
      lines.some(
        (l) => l.includes("phax-plan.json") && l.includes("myrun") && l.includes("3 phase"),
      ),
    ).toBe(true);
  });

  it("config valid + --plan invalid plan: returns 1, prints plan error", async () => {
    const { loadConfig, describeConfigSources } = vi.mocked(
      await import("../../../src/app/loadConfig.js"),
    );
    const { loadPlan } = vi.mocked(await import("../../../src/app/loadPlan.js"));
    loadConfig.mockReturnValue(Either.right(makeConfig()));
    describeConfigSources.mockReturnValue(undefined);
    loadPlan.mockReturnValue(
      Either.left({ message: "invalid plan schema", path: "phax-plan.json" }),
    );

    const { out, errors } = makeOutput();
    const code = runValidate({ plan: "phax-plan.json" }, out);

    expect(code).toBe(1);
    expect(errors.some((e) => e.includes("Plan validation failed"))).toBe(true);
    expect(errors.some((e) => e.includes("phax-plan.json"))).toBe(true);
  });

  it("describeConfigSources returning undefined does not crash the success path", async () => {
    const { loadConfig, describeConfigSources } = vi.mocked(
      await import("../../../src/app/loadConfig.js"),
    );
    loadConfig.mockReturnValue(Either.right(makeConfig()));
    describeConfigSources.mockReturnValue(undefined);

    const { out, lines } = makeOutput();
    const code = runValidate({}, out);

    expect(code).toBe(0);
    expect(lines.some((l) => l.includes("config is valid"))).toBe(true);
  });
});
