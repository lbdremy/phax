import { describe, expect, it, vi, beforeEach } from "vitest";
import { Effect, Either, Layer } from "effect";
import { runLs } from "../../../src/cli/commands/ls.js";
import { makeFakeLock } from "../../../src/infra/fakes/lock.js";

vi.mock("../../../src/app/loadConfig.js", () => ({
  loadConfig: vi.fn(),
}));

vi.mock("../../../src/app/registry.js", () => ({
  readRegistry: vi.fn(),
}));

vi.mock("../../../src/app/resolveRunInfo.js", () => ({
  resolveRun: vi.fn(() => Either.left("not found")),
  findCurrentPhase: vi.fn(() => undefined),
}));

vi.mock("../../../src/infra/lock.js", () => ({
  makeNodeLockLayer: vi.fn(() => makeFakeLock().layer),
}));

vi.mock("../../../src/infra/fs.js", () => ({
  NodeFileSystemLayer: Layer.empty,
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

function makeRegistryEntry(namespace: string, shortName: string, state = "review_open") {
  return {
    namespace,
    shortName,
    runId: `run-${shortName}`,
    state,
    branch: `phax/${shortName}`,
    projectName: namespace,
    phasesCount: 3,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T12:00:00Z",
  };
}

describe("runLs — qualified names", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows qualified run name as primary identity in table output", async () => {
    const { loadConfig } = vi.mocked(await import("../../../src/app/loadConfig.js"));
    loadConfig.mockReturnValue(Either.right(makeConfig()));

    const { readRegistry } = vi.mocked(await import("../../../src/app/registry.js"));
    readRegistry.mockReturnValue(
      Effect.succeed({ version: 1 as const, runs: [makeRegistryEntry("myproject", "fixbug")] }),
    );

    const { out, lines } = makeOutput();
    const code = await runLs({}, out);

    expect(code).toBe(0);
    const text = lines.join("\n");
    expect(text).toContain("myproject.fixbug");
    expect(text).toContain("NAME");
  });

  it("shows two same-short-name runs in different namespaces as distinct rows", async () => {
    const { loadConfig } = vi.mocked(await import("../../../src/app/loadConfig.js"));
    loadConfig.mockReturnValue(Either.right(makeConfig()));

    const { readRegistry } = vi.mocked(await import("../../../src/app/registry.js"));
    readRegistry.mockReturnValue(
      Effect.succeed({
        version: 1 as const,
        runs: [makeRegistryEntry("alpha", "fixbug"), makeRegistryEntry("beta", "fixbug")],
      }),
    );

    const { out, lines } = makeOutput();
    const code = await runLs({}, out);

    expect(code).toBe(0);
    const text = lines.join("\n");
    expect(text).toContain("alpha.fixbug");
    expect(text).toContain("beta.fixbug");
  });

  it("includes namespace and qualifiedName in --json output", async () => {
    const { loadConfig } = vi.mocked(await import("../../../src/app/loadConfig.js"));
    loadConfig.mockReturnValue(Either.right(makeConfig()));

    const { readRegistry } = vi.mocked(await import("../../../src/app/registry.js"));
    readRegistry.mockReturnValue(
      Effect.succeed({
        version: 1 as const,
        runs: [makeRegistryEntry("myproject", "fixbug")],
      }),
    );

    const { out, lines } = makeOutput();
    const code = await runLs({ json: true }, out);

    expect(code).toBe(0);
    const parsed = JSON.parse(lines.join("\n")) as unknown[];
    expect(parsed).toHaveLength(1);
    const row = parsed[0] as Record<string, unknown>;
    expect(row["namespace"]).toBe("myproject");
    expect(row["shortName"]).toBe("fixbug");
    expect(row["qualifiedName"]).toBe("myproject.fixbug");
  });

  it("includes qualifiedName for both runs when namespaces differ in --json output", async () => {
    const { loadConfig } = vi.mocked(await import("../../../src/app/loadConfig.js"));
    loadConfig.mockReturnValue(Either.right(makeConfig()));

    const { readRegistry } = vi.mocked(await import("../../../src/app/registry.js"));
    readRegistry.mockReturnValue(
      Effect.succeed({
        version: 1 as const,
        runs: [makeRegistryEntry("proj-a", "myrun"), makeRegistryEntry("proj-b", "myrun")],
      }),
    );

    const { out, lines } = makeOutput();
    const code = await runLs({ json: true }, out);

    expect(code).toBe(0);
    const parsed = JSON.parse(lines.join("\n")) as unknown[];
    expect(parsed).toHaveLength(2);
    const names = (parsed as Record<string, unknown>[]).map((r) => r["qualifiedName"]);
    expect(names).toContain("proj-a.myrun");
    expect(names).toContain("proj-b.myrun");
  });

  it("returns 1 and error when config load fails", async () => {
    const { loadConfig } = vi.mocked(await import("../../../src/app/loadConfig.js"));
    loadConfig.mockReturnValue(Either.left({ message: "no phax.json" }));

    const { out, errors } = makeOutput();
    const code = await runLs({}, out);
    expect(code).toBe(1);
    expect(errors.join("")).toContain("Config error");
  });

  it("returns 0 with (no runs) when registry is empty", async () => {
    const { loadConfig } = vi.mocked(await import("../../../src/app/loadConfig.js"));
    loadConfig.mockReturnValue(Either.right(makeConfig()));

    const { readRegistry } = vi.mocked(await import("../../../src/app/registry.js"));
    readRegistry.mockReturnValue(Effect.succeed({ version: 1 as const, runs: [] }));

    const { out, lines } = makeOutput();
    const code = await runLs({}, out);
    expect(code).toBe(0);
    expect(lines.join("")).toContain("(no runs)");
  });
});
