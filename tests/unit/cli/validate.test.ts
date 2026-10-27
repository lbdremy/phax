import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { Either } from "effect";
import { exitCodeForError } from "../../../src/cli/commands/runLayers.js";
import { runValidate } from "../../../src/cli/commands/validate.js";
import { ConfigValidationError, PlanValidationError } from "../../../src/domain/errors.js";
import type { ResolvedConfig } from "../../../src/schemas/phaxConfig.js";
import type { PhaxPlan, PhaxPlanPhase } from "../../../src/schemas/phaxPlan.js";
import { schemaUrl } from "../../../src/schemas/schemaUrl.js";

vi.mock("../../../src/app/loadConfig.js", () => ({
  loadConfig: vi.fn(),
  describeConfigSources: vi.fn(),
}));

vi.mock("../../../src/app/loadPlan.js", () => ({
  loadPlan: vi.fn(),
}));

// The default catalog, so the bounds check never reads ~/.phax/providers.json.
vi.mock("../../../src/app/loadRouting.js", async (importOriginal) => {
  const { Effect } = await import("effect");
  const { DEFAULT_PROVIDER_CONFIG } = await import("../../../src/domain/routing/defaults.js");
  return {
    ...(await importOriginal<typeof import("../../../src/app/loadRouting.js")>()),
    loadProviderConfig: () => Effect.succeed(DEFAULT_PROVIDER_CONFIG),
  };
});

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

function makeConfig(namespace = "myproject"): ResolvedConfig {
  return {
    raw: {} as never,
    namespace,
    stateRoot: "/fake-state",
    repoRoot: "/fake-repo",
    maxFixAttempts: 3,
    extractPlanModel: "claude-haiku-4-5-20251001",
    extractPlanEffort: "low",
    fileReconciliationMode: "report_only",
    security: {
      profile: "secure",
      filesystem: { allowRead: [], allowWrite: [] },
      network: { profile: "provider-only" },
      mcp: { mode: "disabled", allow: [] },
      agentCommands: [],
    },
    publish: {
      auto: false,
      remote: "origin",
      provider: "github",
      pushBranch: true,
      createPullRequest: true,
    },
    complianceReview: {
      enabled: false,
      model: "claude-sonnet-4-6",
      effort: "medium",
    },
    codeReview: { enabled: false, model: "claude-opus-5-5", effort: "high" },
    authoring: {
      spec: { model: "claude-opus-5-5", effort: "high" },
      plan: { model: "claude-opus-5-5", effort: "high" },
    },
    records: {
      enabled: false,
      transcript: false,
      destination: { kind: "in-repo" },
      autoPush: false,
    },
  };
}

function makePhase(i: number): PhaxPlan["phases"][number] {
  return {
    id: `phase-0${i + 1}`,
    model: "claude-sonnet-4-6",
    effort: "medium",
    planMarkdownAnchor: `phase-0${i + 1}`,
    plannedFilesToCreate: [],
    plannedFilesToEdit: [],
    optionalFilesToEdit: [],
    mode: "headless",
    oracle: null,
    testLines: [],
    commit: { subject: `feat: phase ${i + 1}`, body: "" },
    title: `Phase ${i + 1}`,
  };
}

function makePlan(shortName = "myrun", phaseCount = 2): PhaxPlan {
  return {
    run: { shortName, title: "My Run", requiredCommands: [], branch: `phax/${shortName}` },
    phases: [makePhase(0), ...Array.from({ length: phaseCount - 1 }, (_, i) => makePhase(i + 1))],
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
    const code = await runValidate({}, out);

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
      Either.left(
        new ConfigValidationError({ message: "no phax.json found", path: "/repo/phax.json" }),
      ),
    );

    const { out, errors } = makeOutput();
    const code = await runValidate({}, out);

    expect(code).toBe(2);
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
    const code = await runValidate({ plan: "phax-plan.json" }, out);

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
      Either.left(
        new PlanValidationError({ message: "invalid plan schema", path: "phax-plan.json" }),
      ),
    );

    const { out, errors } = makeOutput();
    const code = await runValidate({ plan: "phax-plan.json" }, out);

    expect(code).toBe(2);
    expect(errors.some((e) => e.includes("Plan validation failed"))).toBe(true);
    expect(errors.some((e) => e.includes("phax-plan.json"))).toBe(true);
  });

  // Literal releases: the answer must not change when a release is cut.
  it.each([
    {
      shape: "0.17.0",
      stamp: "0.25.0",
      older: ({ mode: _mode, oracle: _oracle, testLines: _lines, ...phase }: PhaxPlanPhase) =>
        phase,
    },
    {
      shape: "0.26.0",
      stamp: "0.26.0",
      older: ({ testLines: _lines, ...phase }: PhaxPlanPhase) => phase,
    },
  ])(
    "--plan on a phax-plan.json in the $shape shape: exits 2 naming the shape and the way out",
    async ({ shape, stamp, older }) => {
      const { loadConfig, describeConfigSources } = vi.mocked(
        await import("../../../src/app/loadConfig.js"),
      );
      const { loadPlan } = vi.mocked(await import("../../../src/app/loadPlan.js"));
      const actual = await vi.importActual<typeof import("../../../src/app/loadPlan.js")>(
        "../../../src/app/loadPlan.js",
      );
      loadConfig.mockReturnValue(Either.right(makeConfig()));
      describeConfigSources.mockReturnValue(undefined);
      loadPlan.mockImplementation(actual.loadPlan);

      const dir = mkdtempSync(join(tmpdir(), "phax-validate-older-"));
      try {
        const planPath = join(dir, "phax-plan.json");
        const { run, phases } = makePlan("myrun", 2);
        writeFileSync(
          planPath,
          JSON.stringify({
            $schema: schemaUrl("phax-plan", stamp),
            run,
            phases: phases.map((phase) => ({
              ...older(phase),
              commit: { ...phase.commit, body: "Body." },
            })),
          }),
        );

        const { out, errors } = makeOutput();
        const code = await runValidate({ plan: planPath }, out);

        expect(code).toBe(2);
        const combined = errors.join("\n");
        expect(combined).toContain("Plan validation failed");
        expect(combined).toContain(`${planPath}: phax-plan in the ${shape} shape`);
        expect(combined).toContain("Finish the run with the phax release that started it");
        expect(combined).toContain("`phax archive <run> --force`");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it("describeConfigSources returning undefined does not crash the success path", async () => {
    const { loadConfig, describeConfigSources } = vi.mocked(
      await import("../../../src/app/loadConfig.js"),
    );
    loadConfig.mockReturnValue(Either.right(makeConfig()));
    describeConfigSources.mockReturnValue(undefined);

    const { out, lines } = makeOutput();
    const code = await runValidate({}, out);

    expect(code).toBe(0);
    expect(lines.some((l) => l.includes("config is valid"))).toBe(true);
  });

  describe("--plan resolution against process.cwd()", () => {
    let cwdSpy: ReturnType<typeof vi.spyOn>;

    afterEach(() => {
      cwdSpy.mockRestore();
    });

    it("resolves a relative --plan path against process.cwd(), not an implicit relative read", async () => {
      const { loadConfig, describeConfigSources } = vi.mocked(
        await import("../../../src/app/loadConfig.js"),
      );
      const { loadPlan } = vi.mocked(await import("../../../src/app/loadPlan.js"));
      loadConfig.mockReturnValue(Either.right(makeConfig()));
      describeConfigSources.mockReturnValue(undefined);
      loadPlan.mockReturnValue(Either.right(makePlan("myrun", 1)));
      cwdSpy = vi.spyOn(process, "cwd").mockReturnValue("/some/other/dir");

      const { out, lines } = makeOutput();
      const code = await runValidate({ plan: "sub/phax-plan.json" }, out);

      expect(code).toBe(0);
      expect(loadPlan).toHaveBeenCalledWith(resolve("/some/other/dir", "sub/phax-plan.json"));
      // The success message still quotes the path as the user typed it.
      expect(lines.some((l) => l.includes("sub/phax-plan.json"))).toBe(true);
    });

    it("plan load failure: error output quotes the path as typed, not the resolved absolute path", async () => {
      const { loadConfig, describeConfigSources } = vi.mocked(
        await import("../../../src/app/loadConfig.js"),
      );
      const { loadPlan } = vi.mocked(await import("../../../src/app/loadPlan.js"));
      loadConfig.mockReturnValue(Either.right(makeConfig()));
      describeConfigSources.mockReturnValue(undefined);
      cwdSpy = vi.spyOn(process, "cwd").mockReturnValue("/repo/nested");
      const resolvedPath = resolve("/repo/nested", "phax-plan.json");
      loadPlan.mockReturnValue(
        Either.left(
          new PlanValidationError({
            message: `Failed to read or parse "${resolvedPath}": ENOENT`,
            path: resolvedPath,
          }),
        ),
      );

      const { out, errors } = makeOutput();
      const code = await runValidate({ plan: "phax-plan.json" }, out);

      expect(code).toBe(2);
      expect(loadPlan).toHaveBeenCalledWith(resolvedPath);
      const combined = errors.join("\n");
      expect(combined).toContain("phax-plan.json");
      expect(combined).not.toContain(resolvedPath);
      expect(combined).not.toContain("/repo/nested");
    });
  });

  // A gate step's `input` key, through the real config loader in a made-up
  // repository. HOME points at the temp dir so no user overlay is read.
  describe("gate step input", () => {
    let repoDir: string;
    let cwdSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(async () => {
      repoDir = mkdtempSync(join(tmpdir(), "phax-validate-input-"));
      execSync("git init", { cwd: repoDir, stdio: "ignore" });
      vi.stubEnv("HOME", repoDir);
      cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(repoDir);
      const actual = await vi.importActual<typeof import("../../../src/app/loadConfig.js")>(
        "../../../src/app/loadConfig.js",
      );
      const { loadConfig, describeConfigSources } = vi.mocked(
        await import("../../../src/app/loadConfig.js"),
      );
      loadConfig.mockImplementation(actual.loadConfig);
      describeConfigSources.mockImplementation(actual.describeConfigSources);
    });

    afterEach(() => {
      cwdSpy.mockRestore();
      vi.unstubAllEnvs();
      rmSync(repoDir, { recursive: true, force: true });
    });

    function writeConfig(config: object): void {
      writeFileSync(join(repoDir, "phax.json"), JSON.stringify(config));
    }

    const logStep = { command: "pnpm test", surface: "local", firing: "every-phase" };

    it("refuses an unknown input value, naming the step path and gate-request (exit 2)", async () => {
      writeConfig({
        version: 1,
        name: "example",
        gateProfiles: {
          standard: [logStep, { ...logStep, command: "node ./audit.mjs", input: "stdin" }],
        },
      });

      const { loadConfig } = await vi.importActual<typeof import("../../../src/app/loadConfig.js")>(
        "../../../src/app/loadConfig.js",
      );
      const refused = loadConfig(repoDir);
      expect(Either.isLeft(refused)).toBe(true);
      if (Either.isLeft(refused)) {
        expect(exitCodeForError(refused.left)).toBe(2);
      }

      const { out, errors } = makeOutput();
      const code = await runValidate({}, out);

      expect(code).toBe(2);
      const combined = errors.join("\n");
      expect(combined).toContain(
        'gateProfiles.standard.1.input: Expected "gate-request", actual "stdin"',
      );
    });

    it("refuses a profile that lists one command twice (exit 2)", async () => {
      writeConfig({
        version: 1,
        name: "example",
        gateProfiles: {
          standard: [logStep, { ...logStep, command: "node ./audit.mjs" }, logStep],
        },
      });

      const { loadConfig } = await vi.importActual<typeof import("../../../src/app/loadConfig.js")>(
        "../../../src/app/loadConfig.js",
      );
      const refused = loadConfig(repoDir);
      expect(Either.isLeft(refused)).toBe(true);
      if (Either.isLeft(refused)) {
        expect(exitCodeForError(refused.left)).toBe(2);
      }

      const { out, errors } = makeOutput();
      const code = await runValidate({}, out);

      expect(code).toBe(2);
      const combined = errors.join("\n");
      expect(combined).toContain(
        'gateProfiles.standard lists the command "pnpm test" twice (steps 1 and 3)',
      );
      expect(combined).toContain("at: gateProfiles.standard");
    });

    it("accepts a workspace profile with a declaring log step", async () => {
      mkdirSync(join(repoDir, "packages", "app"), { recursive: true });
      writeConfig({
        version: 1,
        name: "example",
        gateProfiles: { standard: [logStep] },
        workspaces: [
          {
            id: "app",
            name: "App",
            path: "packages/app",
            gateProfiles: {
              standard: [{ ...logStep, command: "node ./audit.mjs", input: "gate-request" }],
            },
          },
        ],
      });

      const { out, lines, errors } = makeOutput();
      const code = await runValidate({}, out);

      expect(errors).toEqual([]);
      expect(code).toBe(0);
      expect(lines.some((l) => l.includes("config is valid"))).toBe(true);
    });
  });

  // phax.json `assignments`, through the real config loader in a made-up
  // acme-billing repository, against the default catalog (loadProviderConfig
  // is mocked, so ~/.phax is never read).
  describe("assignment bounds", () => {
    let repoDir: string;
    let cwdSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(async () => {
      repoDir = realpathSync(mkdtempSync(join(tmpdir(), "phax-validate-bounds-")));
      execSync("git init", { cwd: repoDir, stdio: "ignore" });
      vi.stubEnv("HOME", repoDir);
      cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(repoDir);
      const actual = await vi.importActual<typeof import("../../../src/app/loadConfig.js")>(
        "../../../src/app/loadConfig.js",
      );
      const { loadConfig, describeConfigSources } = vi.mocked(
        await import("../../../src/app/loadConfig.js"),
      );
      loadConfig.mockImplementation(actual.loadConfig);
      describeConfigSources.mockImplementation(actual.describeConfigSources);
    });

    afterEach(() => {
      cwdSpy.mockRestore();
      vi.unstubAllEnvs();
      rmSync(repoDir, { recursive: true, force: true });
    });

    const PART = {
      kind: "part",
      part: "core-decide",
      model: "claude-opus-5-5",
      effort: { min: "medium", max: "high" },
    };
    const GLOBS = {
      kind: "globs",
      globs: ["src/*/schemas/**"],
      model: "claude-sonnet-5-5",
      effort: { min: "medium", max: "high" },
    };
    const DOCS = {
      kind: "part",
      part: "docs",
      model: "claude-haiku-5-5",
      effort: { min: "low", max: "medium" },
    };

    function writeConfig(assignments: unknown): void {
      writeFileSync(
        join(repoDir, "phax.json"),
        JSON.stringify({
          version: 1,
          name: "acme-billing",
          gateProfiles: {
            standard: [{ command: "pnpm test", surface: "local", firing: "every-phase" }],
          },
          ...(assignments !== undefined ? { assignments } : {}),
        }),
      );
    }

    it("counts the example bounds and exits 0", async () => {
      writeConfig([PART, GLOBS, DOCS]);
      const { out, lines, errors } = makeOutput();
      const code = await runValidate({}, out);

      expect(errors).toEqual([]);
      expect(code).toBe(0);
      expect(lines).toContain("  3 assignment bounds (2 part, 1 globs)");
    });

    it("prints no count line without bounds", async () => {
      writeConfig(undefined);
      const { out, lines } = makeOutput();
      expect(await runValidate({}, out)).toBe(0);
      expect(lines.some((l) => l.includes("assignment bounds"))).toBe(false);
    });

    it("exits 2 for a model the catalog lacks, naming the bound, the field and phax.json", async () => {
      writeConfig([GLOBS, { ...PART, model: "claude-opus-9" }]);
      const { out, errors, lines } = makeOutput();
      const code = await runValidate({}, out);

      expect(code).toBe(2);
      // A bad bound never follows a success line.
      expect(lines.some((l) => l.includes("config is valid"))).toBe(false);
      expect(errors).toEqual([
        "Config validation failed: assignments[1].model: claude-opus-9 is not in the catalog",
        `  at: ${join(repoDir, "phax.json")}`,
      ]);
    });

    it("exits 2 for a min after max, naming the bound, the field and phax.json", async () => {
      writeConfig([{ ...PART, effort: { min: "high", max: "medium" } }]);
      const { out, errors } = makeOutput();
      const code = await runValidate({}, out);

      expect(code).toBe(2);
      expect(errors).toEqual([
        'Config validation failed: assignments[0].effort: min "high" comes after max "medium" for claude-opus-5-5',
        `  at: ${join(repoDir, "phax.json")}`,
      ]);
    });

    it("exits 2 for a malformed bound, naming phax.json, the bound and the field", async () => {
      writeConfig([PART, { ...PART, kind: "path" }]);
      const { out, errors } = makeOutput();
      const code = await runValidate({}, out);

      expect(code).toBe(2);
      const combined = errors.join("\n");
      expect(combined).toContain(join(repoDir, "phax.json"));
      expect(combined).toContain('assignments[1].kind: Expected "part" | "globs", actual "path"');
    });

    it("exits 2 for bounds declared in phax.local.json, naming it", async () => {
      writeConfig([PART]);
      writeFileSync(join(repoDir, "phax.local.json"), JSON.stringify({ assignments: [GLOBS] }));
      const { out, errors } = makeOutput();
      const code = await runValidate({}, out);

      expect(code).toBe(2);
      expect(errors).toEqual([
        'Config validation failed: "assignments" is accepted only in phax.json',
        `  at: ${join(repoDir, "phax.local.json")}`,
      ]);
    });
  });

  describe("oracles provider block", () => {
    let repoDir: string;
    let cwdSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(async () => {
      repoDir = realpathSync(mkdtempSync(join(tmpdir(), "phax-validate-oracles-")));
      execSync("git init", { cwd: repoDir, stdio: "ignore" });
      vi.stubEnv("HOME", repoDir);
      cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(repoDir);
      const actual = await vi.importActual<typeof import("../../../src/app/loadConfig.js")>(
        "../../../src/app/loadConfig.js",
      );
      const { loadConfig, describeConfigSources } = vi.mocked(
        await import("../../../src/app/loadConfig.js"),
      );
      loadConfig.mockImplementation(actual.loadConfig);
      describeConfigSources.mockImplementation(actual.describeConfigSources);
    });

    afterEach(() => {
      cwdSpy.mockRestore();
      vi.unstubAllEnvs();
      rmSync(repoDir, { recursive: true, force: true });
    });

    const STEP = { command: "pnpm test", surface: "local", firing: "every-phase" };

    function writeConfig(extra: Record<string, unknown>, step: object = STEP): void {
      writeFileSync(
        join(repoDir, "phax.json"),
        JSON.stringify({
          version: 1,
          name: "acme-billing",
          gateProfiles: { standard: [step] },
          ...extra,
        }),
      );
    }

    it("accepts an oracles block with a command", async () => {
      writeConfig({ oracles: { command: "./fake-oracles" } });
      const { out, errors } = makeOutput();
      expect(await runValidate({}, out)).toBe(0);
      expect(errors).toEqual([]);
    });

    it("accepts the block in a user overlay", async () => {
      writeConfig({});
      writeFileSync(
        join(repoDir, "phax.local.json"),
        JSON.stringify({ oracles: { command: "./fake-oracles" } }),
      );
      const { out, errors } = makeOutput();
      expect(await runValidate({}, out)).toBe(0);
      expect(errors).toEqual([]);
    });

    it("exits 2 for a timeout key, naming it", async () => {
      writeConfig({ oracles: { command: "./fake-oracles", timeout: 30 } });
      const { out, errors } = makeOutput();
      expect(await runValidate({}, out)).toBe(2);
      expect(errors.join("\n")).toContain("timeout");
      expect(errors.join("\n")).toContain("oracles");
    });

    it("exits 2 for an empty command, naming it", async () => {
      writeConfig({ oracles: { command: "" } });
      const { out, errors } = makeOutput();
      expect(await runValidate({}, out)).toBe(2);
      expect(errors.join("\n")).toContain("oracles.command");
    });

    it("exits 2 for a configured step with surface oracle, naming the surface", async () => {
      writeConfig({}, { ...STEP, surface: "oracle" });
      const { out, errors } = makeOutput();
      expect(await runValidate({}, out)).toBe(2);
      expect(errors.join("\n")).toContain("surface");
    });
  });
});
