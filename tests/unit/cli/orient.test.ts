import { describe, expect, it, vi, beforeEach } from "vitest";
import { Effect, Either } from "effect";
import { runOrient } from "../../../src/cli/commands/orient.js";
import { OrientProviderError } from "../../../src/domain/errors.js";

vi.mock("../../../src/app/loadConfig.js", () => ({
  loadConfig: vi.fn(),
}));

vi.mock("../../../src/app/orient.js", () => ({
  expandOrientRow: vi.fn(),
  queryOrientIndex: vi.fn(),
}));

vi.mock("../../../src/app/loadTelemetryConfig.js", () => ({
  loadTelemetryConfig: vi.fn(() => Either.right({ enabled: false })),
  TELEMETRY_CONFIG_PATH: "/fake-home/.phax/telemetry.json",
  PHAX_HOME_DIR: "/fake-home/.phax",
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

function makeConfig(orient: { command: string } | undefined) {
  return {
    raw: {} as never,
    namespace: "myproject",
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
    ...(orient !== undefined ? { orient } : {}),
  };
}

describe("runOrient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects when neither <id> nor --file is given", async () => {
    const { out, errors } = makeOutput();
    const code = await runOrient(undefined, {}, out);
    expect(code).toBe(2);
    expect(errors.some((e) => e.includes("exactly one"))).toBe(true);
  });

  it("rejects when both <id> and --file are given", async () => {
    const { out, errors } = makeOutput();
    const code = await runOrient("row-1", { file: "src/foo.ts" }, out);
    expect(code).toBe(2);
    expect(errors.some((e) => e.includes("exactly one"))).toBe(true);
  });

  it("errors with exit 1 when config fails to load", async () => {
    const { loadConfig } = vi.mocked(await import("../../../src/app/loadConfig.js"));
    loadConfig.mockReturnValue(
      Either.left({ message: "no phax.json found", path: "/repo/phax.json" }),
    );

    const { out, errors } = makeOutput();
    const code = await runOrient("row-1", {}, out);
    expect(code).toBe(1);
    expect(errors.some((e) => e.includes("Config error"))).toBe(true);
  });

  it("errors with exit 1 when no orient provider is configured", async () => {
    const { loadConfig } = vi.mocked(await import("../../../src/app/loadConfig.js"));
    loadConfig.mockReturnValue(Either.right(makeConfig(undefined)));

    const { out, errors } = makeOutput();
    const code = await runOrient("row-1", {}, out);
    expect(code).toBe(1);
    expect(errors.some((e) => e.includes("No orient provider is configured"))).toBe(true);
  });

  it("expand hit: prints the row body and returns 0", async () => {
    const { loadConfig } = vi.mocked(await import("../../../src/app/loadConfig.js"));
    const { expandOrientRow } = vi.mocked(await import("../../../src/app/orient.js"));
    loadConfig.mockReturnValue(Either.right(makeConfig({ command: "orient-provider" })));
    expandOrientRow.mockReturnValue(
      Effect.succeed(
        Either.right({
          row: {
            id: "row-1",
            title: "Watch X",
            severity: "warn" as const,
            trigger: "touches foo.ts",
            body: "Full explanation.",
          },
        }),
      ),
    );

    const { out, lines } = makeOutput();
    const code = await runOrient("row-1", {}, out);
    expect(code).toBe(0);
    expect(lines).toEqual(["Full explanation."]);
  });

  it("expand empty: prints a notice and exits 0 (advisory, never a failure)", async () => {
    const { loadConfig } = vi.mocked(await import("../../../src/app/loadConfig.js"));
    const { expandOrientRow } = vi.mocked(await import("../../../src/app/orient.js"));
    loadConfig.mockReturnValue(Either.right(makeConfig({ command: "orient-provider" })));
    expandOrientRow.mockReturnValue(Effect.succeed(Either.right({ row: null })));

    const { out, lines } = makeOutput();
    const code = await runOrient("missing-row", {}, out);
    expect(code).toBe(0);
    expect(lines.some((l) => l.toLowerCase().includes("no orientation"))).toBe(true);
  });

  it("expand provider failure: prints error and exits 1", async () => {
    const { loadConfig } = vi.mocked(await import("../../../src/app/loadConfig.js"));
    const { expandOrientRow } = vi.mocked(await import("../../../src/app/orient.js"));
    loadConfig.mockReturnValue(Either.right(makeConfig({ command: "orient-provider" })));
    expandOrientRow.mockReturnValue(
      Effect.succeed(Either.left(new OrientProviderError({ message: "boom", exitCode: 1 }))),
    );

    const { out, errors } = makeOutput();
    const code = await runOrient("row-1", {}, out);
    expect(code).toBe(1);
    expect(errors.some((e) => e.includes("boom"))).toBe(true);
  });

  it("--file hit: prints one index line per row and returns 0", async () => {
    const { loadConfig } = vi.mocked(await import("../../../src/app/loadConfig.js"));
    const { queryOrientIndex } = vi.mocked(await import("../../../src/app/orient.js"));
    loadConfig.mockReturnValue(Either.right(makeConfig({ command: "orient-provider" })));
    queryOrientIndex.mockReturnValue(
      Effect.succeed(
        Either.right({
          rows: [
            { id: "row-1", title: "Watch X", severity: "warn" as const, trigger: "src/foo.ts" },
            { id: "row-2", title: "Watch Y", severity: "error" as const, trigger: "src/foo.ts" },
          ],
        }),
      ),
    );

    const { out, lines } = makeOutput();
    const code = await runOrient(undefined, { file: "src/foo.ts" }, out);
    expect(code).toBe(0);
    expect(lines).toEqual(["[warn] row-1 — Watch X", "[error] row-2 — Watch Y"]);
  });

  it("--file empty: prints a notice and exits 0", async () => {
    const { loadConfig } = vi.mocked(await import("../../../src/app/loadConfig.js"));
    const { queryOrientIndex } = vi.mocked(await import("../../../src/app/orient.js"));
    loadConfig.mockReturnValue(Either.right(makeConfig({ command: "orient-provider" })));
    queryOrientIndex.mockReturnValue(Effect.succeed(Either.right({ rows: [] })));

    const { out, lines } = makeOutput();
    const code = await runOrient(undefined, { file: "src/unknown.ts" }, out);
    expect(code).toBe(0);
    expect(lines.some((l) => l.toLowerCase().includes("no orientation"))).toBe(true);
  });

  it("--file provider failure: prints error and exits 1", async () => {
    const { loadConfig } = vi.mocked(await import("../../../src/app/loadConfig.js"));
    const { queryOrientIndex } = vi.mocked(await import("../../../src/app/orient.js"));
    loadConfig.mockReturnValue(Either.right(makeConfig({ command: "orient-provider" })));
    queryOrientIndex.mockReturnValue(
      Effect.succeed(Either.left(new OrientProviderError({ message: "garbage stdout" }))),
    );

    const { out, errors } = makeOutput();
    const code = await runOrient(undefined, { file: "src/foo.ts" }, out);
    expect(code).toBe(1);
    expect(errors.some((e) => e.includes("garbage stdout"))).toBe(true);
  });
});
