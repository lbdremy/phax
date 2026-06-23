import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { Either } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/app/loadConfig.js";

let repoDir: string;
let tempHome: string;
let originalHome: string | undefined;

const baseConfig = {
  version: 1,
  name: "test",
  gateProfiles: { fast: ["pnpm test"] },
};

beforeEach(() => {
  repoDir = mkdtempSync(join(tmpdir(), "phax-layers-test-"));
  execSync("git init", { cwd: repoDir, stdio: "ignore" });
  tempHome = mkdtempSync(join(tmpdir(), "phax-layers-home-"));
  originalHome = process.env.HOME;
  process.env.HOME = tempHome;
});

afterEach(() => {
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  rmSync(repoDir, { recursive: true, force: true });
  rmSync(tempHome, { recursive: true, force: true });
});

function writeProjectConfig(config: object): void {
  writeFileSync(join(repoDir, "phax.json"), JSON.stringify(config));
}

function writeGlobalUserConfig(config: object): void {
  mkdirSync(join(tempHome, ".phax"), { recursive: true });
  writeFileSync(join(tempHome, ".phax", "config.json"), JSON.stringify(config));
}

function writeLocalUserConfig(config: object): void {
  writeFileSync(join(repoDir, "phax.local.json"), JSON.stringify(config));
}

describe("loadConfig with no user config files", () => {
  it("loads project config when neither user file exists", () => {
    writeProjectConfig(baseConfig);
    const result = loadConfig(repoDir);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.maxFixAttempts).toBe(1);
      expect(result.right.namespace).toBe("test");
    }
  });

  it("defaults stateRoot to tempHome/.phax when no layer sets it", () => {
    writeProjectConfig(baseConfig);
    const result = loadConfig(repoDir);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.stateRoot).toBe(join(tempHome, ".phax"));
    }
  });
});

describe("loadConfig phax.local.json scalar override", () => {
  it("overrides maxFixAttempts from project config", () => {
    writeProjectConfig({ ...baseConfig, agent: { maxFixAttempts: 2 } });
    writeLocalUserConfig({ agent: { maxFixAttempts: 5 } });
    const result = loadConfig(repoDir);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.maxFixAttempts).toBe(5);
    }
  });

  it("overrides fileReconciliationMode from project config", () => {
    writeProjectConfig({ ...baseConfig, fileReconciliation: { mode: "report_only" } });
    writeLocalUserConfig({ fileReconciliation: { mode: "warn" } });
    const result = loadConfig(repoDir);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.fileReconciliationMode).toBe("warn");
    }
  });

  it("overrides state.root, changing stateRoot", () => {
    writeProjectConfig(baseConfig);
    writeLocalUserConfig({ state: { root: "~/custom-root" } });
    const result = loadConfig(repoDir);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.stateRoot).toBe(join(tempHome, "custom-root"));
    }
  });
});

describe("loadConfig ~/.phax/config.json scalar override", () => {
  it("overrides maxFixAttempts from project config", () => {
    writeProjectConfig({ ...baseConfig, agent: { maxFixAttempts: 2 } });
    writeGlobalUserConfig({ agent: { maxFixAttempts: 4 } });
    const result = loadConfig(repoDir);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.maxFixAttempts).toBe(4);
    }
  });

  it("local user beats global user for scalar override", () => {
    writeProjectConfig({ ...baseConfig, agent: { maxFixAttempts: 1 } });
    writeGlobalUserConfig({ agent: { maxFixAttempts: 3 } });
    writeLocalUserConfig({ agent: { maxFixAttempts: 7 } });
    const result = loadConfig(repoDir);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.maxFixAttempts).toBe(7);
    }
  });

  it("local user beats global user for state.root", () => {
    writeProjectConfig(baseConfig);
    writeGlobalUserConfig({ state: { root: "~/global-root" } });
    writeLocalUserConfig({ state: { root: "~/local-root" } });
    const result = loadConfig(repoDir);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.stateRoot).toBe(join(tempHome, "local-root"));
    }
  });
});

describe("loadConfig allowlist union across layers", () => {
  it("unions allowWrite paths from all three layers", () => {
    writeProjectConfig({
      ...baseConfig,
      security: { filesystem: { allowWrite: ["/tmp/project-path"] } },
    });
    writeGlobalUserConfig({ security: { filesystem: { allowWrite: ["/tmp/global-path"] } } });
    writeLocalUserConfig({ security: { filesystem: { allowWrite: ["/tmp/local-path"] } } });
    const result = loadConfig(repoDir);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      const paths = result.right.security.filesystem.allowWrite;
      expect(paths).toContain("/tmp/project-path");
      expect(paths).toContain("/tmp/global-path");
      expect(paths).toContain("/tmp/local-path");
    }
  });

  it("deduplicates paths that appear in multiple layers", () => {
    writeProjectConfig({
      ...baseConfig,
      security: { filesystem: { allowWrite: ["/tmp/shared"] } },
    });
    writeLocalUserConfig({ security: { filesystem: { allowWrite: ["/tmp/shared"] } } });
    const result = loadConfig(repoDir);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      const paths = result.right.security.filesystem.allowWrite;
      expect(paths.filter((p) => p === "/tmp/shared")).toHaveLength(1);
    }
  });

  it("project allowWrite is preserved when local user adds additional paths", () => {
    writeProjectConfig({
      ...baseConfig,
      security: { filesystem: { allowWrite: ["/tmp/project-path"] } },
    });
    writeLocalUserConfig({ security: { filesystem: { allowWrite: ["/tmp/extra-path"] } } });
    const result = loadConfig(repoDir);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      const paths = result.right.security.filesystem.allowWrite;
      expect(paths).toContain("/tmp/project-path");
      expect(paths).toContain("/tmp/extra-path");
    }
  });

  it("unions agentCommands across all three layers", () => {
    writeProjectConfig({
      ...baseConfig,
      security: { agentCommands: ["pnpm test"] },
    });
    writeGlobalUserConfig({ security: { agentCommands: ["make build"] } });
    writeLocalUserConfig({ security: { agentCommands: ["cargo check"] } });
    const result = loadConfig(repoDir);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      const cmds = result.right.security.agentCommands;
      expect(cmds).toContain("pnpm test");
      expect(cmds).toContain("make build");
      expect(cmds).toContain("cargo check");
    }
  });
});

describe("loadConfig invalid user file error handling", () => {
  it("returns ConfigValidationError naming the global user file on invalid JSON", () => {
    writeProjectConfig(baseConfig);
    mkdirSync(join(tempHome, ".phax"), { recursive: true });
    writeFileSync(join(tempHome, ".phax", "config.json"), "{ invalid json }");
    const result = loadConfig(repoDir);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.path).toBe(join(tempHome, ".phax", "config.json"));
    }
  });

  it("returns ConfigValidationError naming the local user file on invalid JSON", () => {
    writeProjectConfig(baseConfig);
    writeFileSync(join(repoDir, "phax.local.json"), "{ invalid json }");
    const result = loadConfig(repoDir);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.path).toBe(join(repoDir, "phax.local.json"));
    }
  });

  it("returns ConfigValidationError naming the global user file when it carries an excess property", () => {
    writeProjectConfig(baseConfig);
    writeGlobalUserConfig({ version: 1 });
    const result = loadConfig(repoDir);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.path).toBe(join(tempHome, ".phax", "config.json"));
    }
  });

  it("returns ConfigValidationError naming the local user file when it carries an excess property", () => {
    writeProjectConfig(baseConfig);
    writeLocalUserConfig({ name: "other" });
    const result = loadConfig(repoDir);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.path).toBe(join(repoDir, "phax.local.json"));
    }
  });
});
