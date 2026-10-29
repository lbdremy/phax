import { mkdirSync, mkdtempSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, execSync } from "node:child_process";
import { Either } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig, describeConfigSources } from "../../src/app/loadConfig.js";
import { isolateGit } from "../helpers/isolateGit.js";
import { isolatePhaxHome } from "../helpers/isolatePhaxHome.js";
import { ConfigValidationError } from "../../src/domain/errors.js";
import {
  DEFAULT_EXTRACT_MODEL,
  DEFAULT_CODE_REVIEW_MODEL,
  DEFAULT_AUTHORING_MODEL,
  DEFAULT_AUTHORING_EFFORT,
  resolveAuthoringSelection,
} from "../../src/schemas/phaxConfig.js";
import { effortsFor, entryFor } from "../../src/domain/routing/catalog.js";
import { DEFAULT_PROVIDER_CONFIG } from "../../src/domain/routing/defaults.js";

const baseConfig = {
  version: 1,
  name: "test",
  state: { root: "~/.phax" },
  gateProfiles: { fast: [{ command: "pnpm test", surface: "local", firing: "every-phase" }] },
};

// loadConfig reads homedir()/.phax/config.json: give it a temporary home.
vi.mock("node:os", async (importOriginal) =>
  (await import("../helpers/isolatePhaxHome.js")).isolatedOs(await importOriginal()),
);

let repoDir: string;
let home: ReturnType<typeof isolatePhaxHome>;

beforeEach(() => {
  home = isolatePhaxHome();
  repoDir = mkdtempSync(join(tmpdir(), "phax-loadconfig-test-"));
  execSync("git init", { cwd: repoDir, stdio: "ignore" });
});

afterEach(() => {
  rmSync(repoDir, { recursive: true, force: true });
  home.restore();
});

function writePhaxJson(config: object): void {
  writeFileSync(join(repoDir, "phax.json"), JSON.stringify(config));
}

describe("loadConfig namespace resolution", () => {
  it("exposes namespace from top-level name field", () => {
    writePhaxJson(baseConfig);
    const result = loadConfig(repoDir);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.namespace).toBe("test");
    }
  });

  it("returns ConfigValidationError with path 'name' when name is missing", () => {
    const { name: _, ...noName } = baseConfig;
    writePhaxJson(noName);
    const result = loadConfig(repoDir);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.path).toBe("name");
    }
  });

  it("returns ConfigValidationError with path 'name' when name is empty", () => {
    writePhaxJson({ ...baseConfig, name: "" });
    const result = loadConfig(repoDir);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.path).toBe("name");
    }
  });

  it("returns ConfigValidationError with path 'name' when name contains a dot", () => {
    writePhaxJson({ ...baseConfig, name: "my.project" });
    const result = loadConfig(repoDir);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.path).toBe("name");
    }
  });

  it("returns ConfigValidationError with path 'name' when name has uppercase", () => {
    writePhaxJson({ ...baseConfig, name: "MyProject" });
    const result = loadConfig(repoDir);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.path).toBe("name");
    }
  });

  it("returns ConfigValidationError with path 'name' when name starts with a digit", () => {
    writePhaxJson({ ...baseConfig, name: "1project" });
    const result = loadConfig(repoDir);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.path).toBe("name");
    }
  });

  it("includes the spec error message when name is missing", () => {
    const { name: _, ...noName } = baseConfig;
    writePhaxJson(noName);
    const result = loadConfig(repoDir);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.message).toContain("PHAX project name is missing");
    }
  });
});

const OUTPUT_REFUSAL = 'gate step "node ./audit.mjs": output must be "log" or "gate-report"';

function auditStep(output: string) {
  return { command: "node ./audit.mjs", surface: "local", firing: "every-phase", output };
}

describe("loadConfig gate step output", () => {
  it("refuses a diagnostics step in a project profile, naming the step and both values", () => {
    writePhaxJson({ ...baseConfig, gateProfiles: { fast: [auditStep("diagnostics")] } });
    const result = loadConfig(repoDir);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(ConfigValidationError);
      expect(result.left.message).toContain(OUTPUT_REFUSAL);
    }
  });

  it("refuses any other output in a workspace profile", () => {
    writePhaxJson({
      ...baseConfig,
      workspaces: [
        {
          id: "ui",
          name: "UI",
          path: ".",
          gateProfiles: {
            fast: [
              { command: "pnpm test", surface: "local", firing: "every-phase" },
              auditStep("json"),
            ],
          },
        },
      ],
    });
    const result = loadConfig(repoDir);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.message).toContain(OUTPUT_REFUSAL);
    }
  });

  it("loads a gate-report step that declares no input", () => {
    writePhaxJson({ ...baseConfig, gateProfiles: { fast: [auditStep("gate-report")] } });
    const result = loadConfig(repoDir);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.raw.gateProfiles["fast"]?.[0]).toEqual({
        command: "node ./audit.mjs",
        surface: "local",
        firing: "every-phase",
        output: "gate-report",
      });
    }
  });
});

function logStep(command: string) {
  return { command, surface: "local", firing: "every-phase" };
}

describe("loadConfig duplicate gate commands", () => {
  it("refuses a profile that lists one command twice, naming the profile and the command", () => {
    writePhaxJson({
      ...baseConfig,
      gateProfiles: {
        default: [logStep("pnpm test"), logStep("node scripts/audit.mjs"), logStep("pnpm  test")],
      },
    });
    const result = loadConfig(repoDir);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(ConfigValidationError);
      expect(result.left.message).toBe(
        'gateProfiles.default lists the command "pnpm test" twice (steps 1 and 3)',
      );
      expect(result.left.path).toBe("gateProfiles.default");
    }
  });

  it("names a workspace profile by its workspace id", () => {
    writePhaxJson({
      ...baseConfig,
      workspaces: [
        {
          id: "ui",
          name: "UI",
          path: ".",
          gateProfiles: { fast: [logStep("pnpm lint"), logStep(" pnpm lint ")] },
        },
      ],
    });
    const result = loadConfig(repoDir);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.message).toBe(
        'workspaces[ui].gateProfiles.fast lists the command "pnpm lint" twice (steps 1 and 2)',
      );
      expect(result.left.path).toBe("workspaces[ui].gateProfiles.fast");
    }
  });

  it("loads profiles whose commands are distinct", () => {
    writePhaxJson({
      ...baseConfig,
      gateProfiles: {
        default: [logStep("pnpm test"), logStep("pnpm run test")],
        fast: [logStep("pnpm test")],
      },
    });
    expect(Either.isRight(loadConfig(repoDir))).toBe(true);
  });
});

const PUSH_REFUSAL = 'brief.push must be "findings" or "findings-and-rules"';

describe("loadConfig brief.push", () => {
  it.each([
    ["no push", { command: "node ./brief.mjs" }],
    ["push rules", { command: "node ./brief.mjs", push: "rules" }],
  ])(
    "refuses a phax.json brief with %s, naming the file, brief.push and both values",
    (_n, brief) => {
      writePhaxJson({ ...baseConfig, brief });
      const result = loadConfig(repoDir);
      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(ConfigValidationError);
        expect(result.left.message).toContain(join(repoDir, "phax.json"));
        expect(result.left.message).toContain(PUSH_REFUSAL);
      }
    },
  );

  it("loads a brief that pushes findings", () => {
    writePhaxJson({ ...baseConfig, brief: { command: "node ./brief.mjs", push: "findings" } });
    const result = loadConfig(repoDir);
    expect(Either.isRight(result) && result.right.brief).toEqual({
      command: "node ./brief.mjs",
      push: "findings",
    });
  });
});

describe("loadConfig extractPlan resolution", () => {
  it("defaults to DEFAULT_EXTRACT_MODEL and low effort when no extractPlan config", () => {
    writePhaxJson(baseConfig);
    const result = loadConfig(repoDir);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.extractPlanModel).toBe(DEFAULT_EXTRACT_MODEL);
      expect(result.right.extractPlanEffort).toBe("low");
    }
  });

  it("uses model from agent.extractPlan.model when set", () => {
    writePhaxJson({
      ...baseConfig,
      agent: {
        extractPlan: { model: "claude-sonnet-4-6" },
      },
    });
    const result = loadConfig(repoDir);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.extractPlanModel).toBe("claude-sonnet-4-6");
      expect(result.right.extractPlanEffort).toBe("low");
    }
  });

  it("uses effort from agent.extractPlan.effort when set", () => {
    writePhaxJson({
      ...baseConfig,
      agent: {
        extractPlan: { effort: "medium" },
      },
    });
    const result = loadConfig(repoDir);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.extractPlanModel).toBe(DEFAULT_EXTRACT_MODEL);
      expect(result.right.extractPlanEffort).toBe("medium");
    }
  });

  it("uses both model and effort from agent.extractPlan when both set", () => {
    writePhaxJson({
      ...baseConfig,
      agent: {
        extractPlan: { model: "claude-opus-4-7", effort: "high" },
      },
    });
    const result = loadConfig(repoDir);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.extractPlanModel).toBe("claude-opus-4-7");
      expect(result.right.extractPlanEffort).toBe("high");
    }
  });

  it("rejects agent.extractPlan with an invalid effort value", () => {
    writePhaxJson({
      ...baseConfig,
      agent: {
        extractPlan: { effort: "extreme" },
      },
    });
    const result = loadConfig(repoDir);
    expect(Either.isLeft(result)).toBe(true);
  });
});

describe("loadConfig fileReconciliation resolution", () => {
  it("defaults fileReconciliationMode to report_only when not set", () => {
    writePhaxJson(baseConfig);
    const result = loadConfig(repoDir);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.fileReconciliationMode).toBe("report_only");
    }
  });

  it("resolves fileReconciliationMode to warn when configured", () => {
    writePhaxJson({ ...baseConfig, fileReconciliation: { mode: "warn" } });
    const result = loadConfig(repoDir);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.fileReconciliationMode).toBe("warn");
    }
  });

  it("resolves fileReconciliationMode to report_only when explicitly set", () => {
    writePhaxJson({ ...baseConfig, fileReconciliation: { mode: "report_only" } });
    const result = loadConfig(repoDir);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.fileReconciliationMode).toBe("report_only");
    }
  });
});

describe("describeConfigSources", () => {
  it("returns undefined when no phax.json exists", () => {
    const result = describeConfigSources(repoDir);
    expect(result).toBeUndefined();
  });

  it("returns project path with undefined overlays when no overlays exist", () => {
    writePhaxJson(baseConfig);
    const result = describeConfigSources(repoDir);
    expect(result).toBeDefined();
    if (result) {
      expect(result.project).toBe(join(repoDir, "phax.json"));
      expect(result.localOverlay).toBeUndefined();
      // globalOverlay may or may not exist depending on the test machine; we just check it's string or undefined
      expect(typeof result.globalOverlay === "string" || result.globalOverlay === undefined).toBe(
        true,
      );
    }
  });

  it("sets localOverlay when phax.local.json exists", () => {
    writePhaxJson(baseConfig);
    const localPath = join(repoDir, "phax.local.json");
    writeFileSync(localPath, JSON.stringify({ version: 1 }));
    const result = describeConfigSources(repoDir);
    expect(result).toBeDefined();
    if (result) {
      expect(result.localOverlay).toBe(localPath);
    }
  });

  it("returns undefined when not inside a git repo", () => {
    const nonRepo = mkdtempSync(join(tmpdir(), "phax-no-git-"));
    try {
      const result = describeConfigSources(nonRepo);
      expect(result).toBeUndefined();
    } finally {
      rmSync(nonRepo, { recursive: true, force: true });
    }
  });
});

describe("loadConfig security resolution", () => {
  it("defaults security profile to secure when no security block", () => {
    writePhaxJson(baseConfig);
    const result = loadConfig(repoDir);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.security.profile).toBe("secure");
    }
  });

  it("uses the profile from the security block when set", () => {
    writePhaxJson({ ...baseConfig, security: { profile: "secure" } });
    const result = loadConfig(repoDir);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.security.profile).toBe("secure");
    }
  });

  it("defaults network profile to provider-only and mcp mode to disabled", () => {
    writePhaxJson(baseConfig);
    const result = loadConfig(repoDir);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.security.network.profile).toBe("provider-only");
      expect(result.right.security.mcp.mode).toBe("disabled");
    }
  });

  it("defaults all allow-lists to empty arrays", () => {
    writePhaxJson(baseConfig);
    const result = loadConfig(repoDir);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.security.filesystem.allowRead).toEqual([]);
      expect(result.right.security.filesystem.allowWrite).toEqual([]);
      expect(result.right.security.mcp.allow).toEqual([]);
    }
  });

  it("resolves relative filesystem allowWrite paths against gitRoot", () => {
    writePhaxJson({
      ...baseConfig,
      security: { filesystem: { allowWrite: ["relative/path"] } },
    });
    const result = loadConfig(repoDir);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      const write = result.right.security.filesystem.allowWrite;
      // Use realpathSync to resolve macOS /tmp → /private/tmp symlink
      const realRepoDir = realpathSync(repoDir);
      expect(write.length).toBe(1);
      expect(write[0]).toBe(`${realRepoDir}/relative/path`);
    }
  });

  it("rejects an unknown security profile value", () => {
    writePhaxJson({ ...baseConfig, security: { profile: "super-safe" } });
    const result = loadConfig(repoDir);
    expect(Either.isLeft(result)).toBe(true);
  });
});

describe("loadConfig codeReview defaults", () => {
  it("defaults DEFAULT_CODE_REVIEW_MODEL and DEFAULT_EXTRACT_MODEL to their catalog-pinned ids", () => {
    expect(DEFAULT_CODE_REVIEW_MODEL).toBe("claude-opus-5-5");
    expect(DEFAULT_EXTRACT_MODEL).toBe("claude-haiku-5-5");
    expect(entryFor(DEFAULT_CODE_REVIEW_MODEL, DEFAULT_PROVIDER_CONFIG)).toBeDefined();
    expect(entryFor(DEFAULT_EXTRACT_MODEL, DEFAULT_PROVIDER_CONFIG)).toBeDefined();
    expect(effortsFor(DEFAULT_EXTRACT_MODEL, DEFAULT_PROVIDER_CONFIG)).toContain("low");
  });

  it("resolves codeReview to DEFAULT_CODE_REVIEW_MODEL and high effort when no review.code block", () => {
    writePhaxJson(baseConfig);
    const result = loadConfig(repoDir);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.codeReview.model).toBe(DEFAULT_CODE_REVIEW_MODEL);
      expect(result.right.codeReview.effort).toBe("high");
    }
  });

  it("honors review.code.model when set", () => {
    writePhaxJson({ ...baseConfig, review: { code: { model: "claude-sonnet-4-6" } } });
    const result = loadConfig(repoDir);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.codeReview.model).toBe("claude-sonnet-4-6");
      expect(result.right.codeReview.effort).toBe("high");
    }
  });

  it("honors review.code.effort when set", () => {
    writePhaxJson({ ...baseConfig, review: { code: { effort: "medium" } } });
    const result = loadConfig(repoDir);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.codeReview.model).toBe(DEFAULT_CODE_REVIEW_MODEL);
      expect(result.right.codeReview.effort).toBe("medium");
    }
  });

  it("keeps review.code.enabled from phax.json when phax.local.json exists", () => {
    writePhaxJson({ ...baseConfig, review: { code: { enabled: true } } });
    writeFileSync(join(repoDir, "phax.local.json"), JSON.stringify({ publish: { auto: false } }));
    const result = loadConfig(repoDir);
    expect(Either.isRight(result) && result.right.codeReview.enabled).toBe(true);
  });

  it("takes review.code.enabled from phax.local.json alone", () => {
    writePhaxJson(baseConfig);
    writeFileSync(
      join(repoDir, "phax.local.json"),
      JSON.stringify({ review: { code: { enabled: true } } }),
    );
    const result = loadConfig(repoDir);
    expect(Either.isRight(result) && result.right.codeReview.enabled).toBe(true);
  });
});

describe("loadConfig authoring defaults", () => {
  it("resolves authoring.spec and authoring.plan to catalog defaults when no authoring block", () => {
    writePhaxJson(baseConfig);
    const result = loadConfig(repoDir);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.authoring.spec.model).toBe(DEFAULT_AUTHORING_MODEL);
      expect(result.right.authoring.spec.effort).toBe(DEFAULT_AUTHORING_EFFORT);
      expect(result.right.authoring.plan.model).toBe(DEFAULT_AUTHORING_MODEL);
      expect(result.right.authoring.plan.effort).toBe(DEFAULT_AUTHORING_EFFORT);
    }
  });

  it("honors authoring.spec.model while keeping the effort default", () => {
    writePhaxJson({ ...baseConfig, authoring: { spec: { model: "claude-sonnet-5" } } });
    const result = loadConfig(repoDir);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.authoring.spec.model).toBe("claude-sonnet-5");
      expect(result.right.authoring.spec.effort).toBe(DEFAULT_AUTHORING_EFFORT);
      expect(result.right.authoring.plan.model).toBe(DEFAULT_AUTHORING_MODEL);
    }
  });

  it("honors authoring.plan.effort independently of authoring.spec", () => {
    writePhaxJson({ ...baseConfig, authoring: { plan: { effort: "medium" } } });
    const result = loadConfig(repoDir);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.authoring.plan.effort).toBe("medium");
      expect(result.right.authoring.plan.model).toBe(DEFAULT_AUTHORING_MODEL);
      expect(result.right.authoring.spec.effort).toBe(DEFAULT_AUTHORING_EFFORT);
    }
  });
});

function loadFailure(cwd: string): ConfigValidationError {
  const result = loadConfig(cwd);
  if (Either.isRight(result)) throw new Error("expected loadConfig to refuse the config");
  return result.left;
}

// phax.json `protectedPaths`: the files whose change is the operator's decision.
describe("loadConfig protectedPaths", () => {
  it("resolves no list for a project that declares none", () => {
    writePhaxJson(baseConfig);
    const result = loadConfig(repoDir);
    expect(Either.isRight(result)).toBe(true);
    expect(Either.isRight(result) && result.right.protectedPaths).toBeUndefined();
  });

  it("resolves the declared globs, then the loaded phax.json by its repo-relative path", () => {
    writePhaxJson({ ...baseConfig, protectedPaths: ["**/steme.baseline.json", "docs/*.md"] });
    const result = loadConfig(repoDir);
    expect(Either.isRight(result) && result.right.protectedPaths).toEqual([
      { glob: "**/steme.baseline.json", entry: "protectedPaths[0]" },
      { glob: "docs/*.md", entry: "protectedPaths[1]" },
      { glob: "phax.json", entry: "phax.json" },
    ]);
  });

  it("does not repeat phax.json when a declared glob is exactly its path", () => {
    writePhaxJson({ ...baseConfig, protectedPaths: ["phax.json"] });
    const result = loadConfig(repoDir);
    expect(Either.isRight(result) && result.right.protectedPaths).toEqual([
      { glob: "phax.json", entry: "protectedPaths[0]" },
    ]);
  });

  it("names a phax.json found below the git root by that path, not by a root phax.json", () => {
    mkdirSync(join(repoDir, "pkg"));
    writeFileSync(
      join(repoDir, "pkg", "phax.json"),
      JSON.stringify({ ...baseConfig, protectedPaths: ["**/steme.baseline.json"] }),
    );
    const result = loadConfig(join(repoDir, "pkg"));
    const list = Either.isRight(result) ? result.right.protectedPaths : undefined;
    expect(list).toEqual([
      { glob: "**/steme.baseline.json", entry: "protectedPaths[0]" },
      { glob: "pkg/phax.json", entry: "pkg/phax.json" },
    ]);
  });

  it.each([
    ["an empty list", [], "protectedPaths: a non-empty list of globs is required"],
    ["a string", "phax.json", "protectedPaths: a non-empty list of globs is required"],
    [
      "a .. segment",
      ["a.json", "../shared/allow.json"],
      'protectedPaths[1]: "../shared/allow.json" has a .. segment',
    ],
    ["a leading /", ["/abs/x.json"], 'protectedPaths[0]: "/abs/x.json" starts with /'],
    ["braces", ["{a,b}.json"], 'protectedPaths[0]: "{a,b}.json" uses braces'],
    ["a non-string entry", ["a.json", 3], "protectedPaths[1]: a glob string is required"],
  ])(
    "refuses %s, naming the entry and the rule, at the phax.json path",
    (_name, value, message) => {
      writePhaxJson({ ...baseConfig, protectedPaths: value });
      const error = loadFailure(repoDir);
      expect(error.message).toBe(message);
      expect(error.path).toBe(join(repoDir, "phax.json"));
    },
  );

  it("refuses a glob inside a submodule .gitmodules declares", () => {
    writeFileSync(
      join(repoDir, ".gitmodules"),
      '[submodule "lint-rules"]\n\tpath = vendor/lint-rules\n\turl = https://example.test/lint-rules.git\n',
    );
    writePhaxJson({
      ...baseConfig,
      protectedPaths: ["**/steme.baseline.json", "vendor/lint-rules/**"],
    });
    const error = loadFailure(repoDir);
    expect(error.message).toBe(
      'protectedPaths[1]: "vendor/lint-rules/**" is inside the submodule vendor/lint-rules',
    );
    expect(error.path).toBe(join(repoDir, "phax.json"));
  });

  it("refuses a literal entry naming a directory on disk", () => {
    mkdirSync(join(repoDir, "vendor", "rules"), { recursive: true });
    writePhaxJson({ ...baseConfig, protectedPaths: ["**/steme.baseline.json", "vendor/rules"] });
    const error = loadFailure(repoDir);
    expect(error.message).toBe(
      'protectedPaths[1]: "vendor/rules" is a directory; protect its files with "vendor/rules/**"',
    );
    expect(error.path).toBe(join(repoDir, "phax.json"));
  });

  it("refuses a literal entry naming a directory in HEAD, absent from disk", () => {
    const restoreGit = isolateGit();
    try {
      mkdirSync(join(repoDir, "vendor", "rules"), { recursive: true });
      writeFileSync(join(repoDir, "vendor", "rules", "a.json"), "{}\n");
      const git = (...args: string[]): void => {
        execFileSync("git", args, { cwd: repoDir, stdio: "ignore" });
      };
      git("add", "-A");
      git("-c", "user.name=Ada", "-c", "user.email=ada@example.test", "commit", "-qm", "rules");
      rmSync(join(repoDir, "vendor"), { recursive: true, force: true });
      writePhaxJson({ ...baseConfig, protectedPaths: ["vendor/rules"] });
      expect(loadFailure(repoDir).message).toBe(
        'protectedPaths[0]: "vendor/rules" is a directory; protect its files with "vendor/rules/**"',
      );
    } finally {
      restoreGit();
    }
  });

  it("accepts a literal file path and a glob over a directory", () => {
    mkdirSync(join(repoDir, "vendor", "rules"), { recursive: true });
    writeFileSync(join(repoDir, "vendor", "rules", "a.json"), "{}\n");
    writePhaxJson({
      ...baseConfig,
      protectedPaths: ["vendor/rules/a.json", "vendor/rules/**", "vendor/rule?", "absent/dir"],
    });
    expect(Either.isRight(loadConfig(repoDir))).toBe(true);
  });

  it("accepts globs outside every submodule", () => {
    writeFileSync(join(repoDir, ".gitmodules"), '[submodule "a"]\n\tpath = vendor/lint-rules\n');
    writePhaxJson({ ...baseConfig, protectedPaths: ["vendor/other/**", "**/lint-rules.json"] });
    expect(Either.isRight(loadConfig(repoDir))).toBe(true);
  });

  it("refuses protectedPaths in phax.local.json, naming the overlay file", () => {
    writePhaxJson(baseConfig);
    writeFileSync(join(repoDir, "phax.local.json"), JSON.stringify({ protectedPaths: ["a.json"] }));
    const error = loadFailure(repoDir);
    expect(error.message).toBe('"protectedPaths" is accepted only in phax.json');
    expect(error.path).toBe(join(repoDir, "phax.local.json"));
  });

  it("refuses protectedPaths in ~/.phax/config.json, naming the overlay file", () => {
    writePhaxJson(baseConfig);
    const overlay = join(home.home, ".phax", "config.json");
    writeFileSync(overlay, JSON.stringify({ protectedPaths: ["a.json"] }));
    const error = loadFailure(repoDir);
    expect(error.message).toBe('"protectedPaths" is accepted only in phax.json');
    expect(error.path).toBe(overlay);
  });
});

describe("resolveAuthoringSelection", () => {
  const configured = { model: "configured-model", effort: "medium" as const };

  it("prefers the flag over the configured value for model and effort independently", () => {
    expect(resolveAuthoringSelection({ flagModel: "flag-model", configured })).toEqual({
      model: "flag-model",
      effort: "medium",
    });
    expect(resolveAuthoringSelection({ flagEffort: "high", configured })).toEqual({
      model: "configured-model",
      effort: "high",
    });
  });

  it("falls back to the configured value when no flag is given", () => {
    expect(resolveAuthoringSelection({ configured })).toEqual(configured);
  });
});
