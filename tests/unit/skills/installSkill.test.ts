import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Result } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NodeFileSystemLayer } from "../../../src/infra/fs.js";
import { installSkill } from "../../../src/app/skills/installSkill.js";
import type { InstallSkillInput } from "../../../src/app/skills/installSkill.js";
import { SkillInstallError } from "../../../src/domain/errors.js";

const FAKE_SKILL_CONTENT = "---\nname: phax-planning\ndescription: fake skill\n---\n\nBody.";

let tmpRoot: string;
let bundleRoot: string;
let projectRoot: string;
let homeDir: string;

function makeInput(overrides: Partial<InstallSkillInput> = {}): InstallSkillInput {
  return {
    skillName: "phax-planning",
    target: "claude",
    scope: "project",
    projectRoot,
    homeDir,
    bundleRoot,
    ...overrides,
  };
}

function run<A, E>(effect: Effect.Effect<A, E, never>): Promise<Result.Result<A, E>> {
  return Effect.runPromise(Effect.result(effect));
}

function provide<A, E>(
  effect: Effect.Effect<A, E, import("../../../src/ports/fs.js").FileSystem>,
): Effect.Effect<A, E, never> {
  return Effect.provide(effect, NodeFileSystemLayer);
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "phax-installskill-test-"));
  bundleRoot = join(tmpRoot, "bundle");
  projectRoot = join(tmpRoot, "project");
  homeDir = join(tmpRoot, "home");

  // Create fake bundle
  mkdirSync(join(bundleRoot, "phax-planning"), { recursive: true });
  writeFileSync(join(bundleRoot, "phax-planning", "SKILL.md"), FAKE_SKILL_CONTENT);

  mkdirSync(projectRoot, { recursive: true });
  mkdirSync(homeDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("installSkill", () => {
  it("creates the skill dir and returns status=created when destination is empty", async () => {
    const result = await run(provide(installSkill(makeInput())));
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.status).toBe("created");
      expect(result.success.skillName).toBe("phax-planning");
      expect(result.success.target).toBe("claude");
      expect(result.success.scope).toBe("project");
      expect(result.success.destination).toContain("phax-planning");

      const written = readFileSync(join(result.success.destination, "SKILL.md"), "utf8");
      expect(written).toBe(FAKE_SKILL_CONTENT);
    }
  });

  it("returns status=already-present on a second identical run (idempotent)", async () => {
    await run(provide(installSkill(makeInput())));
    const result = await run(provide(installSkill(makeInput())));
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.status).toBe("already-present");
    }
  });

  it("returns status=updated when destination SKILL.md differs from bundle", async () => {
    // First install
    const first = await run(provide(installSkill(makeInput())));
    expect(Result.isSuccess(first)).toBe(true);
    if (!Result.isSuccess(first)) return;

    // Modify the destination file to simulate drift
    writeFileSync(join(first.success.destination, "SKILL.md"), "stale content");

    const result = await run(provide(installSkill(makeInput())));
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.status).toBe("updated");
      // File is rewritten with the bundled content
      const written = readFileSync(join(result.success.destination, "SKILL.md"), "utf8");
      expect(written).toBe(FAKE_SKILL_CONTENT);
    }
  });

  it("fails with SkillInstallError when bundle root is empty (bundle missing)", async () => {
    const emptyBundleRoot = join(tmpRoot, "empty-bundle");
    mkdirSync(emptyBundleRoot, { recursive: true });

    const result = await run(provide(installSkill(makeInput({ bundleRoot: emptyBundleRoot }))));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(SkillInstallError);
      expect(result.failure.message).toContain("Bundled skill file missing");
    }
  });

  it("fails with SkillInstallError for an unknown skill name", async () => {
    const result = await run(provide(installSkill(makeInput({ skillName: "nonexistent-skill" }))));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(SkillInstallError);
      expect(result.failure.message).toContain("Unknown skill");
    }
  });

  it("resolves destination correctly for user scope", async () => {
    const result = await run(provide(installSkill(makeInput({ scope: "user" }))));
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.destination).toContain(homeDir);
      expect(result.success.destination).toContain(".claude/skills/phax-planning");
    }
  });

  it("resolves destination correctly for codex target", async () => {
    const result = await run(
      provide(installSkill(makeInput({ target: "codex", scope: "project" }))),
    );
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.destination).toContain(".agents/skills/phax-planning");
    }
  });
});
