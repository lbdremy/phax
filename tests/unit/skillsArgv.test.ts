import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { defineGroup } from "../../src/cli/commandLibrary/contract/index.js";
import type { SkillsInstallRoots } from "../../src/cli/definitions/skills.js";
import { makeSkillsInstallCommand } from "../../src/cli/definitions/skills.js";
import { EXPOSED_SKILL_NAMES } from "../../src/domain/skills/catalog.js";
import { runnerCall } from "../helpers/runnerCall.js";

// The bundle stays the real shipped .claude/skills so the exposed skills are actually found.
const bundleRoot = join(import.meta.dirname, "../..", ".claude", "skills");

/** The skills group over `roots`, called as `phax skills install …argv`. */
function install(roots: SkillsInstallRoots, argv: ReadonlyArray<string>) {
  return runnerCall(
    [
      defineGroup({
        name: "skills",
        summary: "Manage PHAX skills",
        commands: [makeSkillsInstallCommand(() => roots)],
      }),
    ],
    ["skills", "install", ...argv],
  );
}

describe("skills install subcommand through the runner", () => {
  let tmpRoot: string;
  let roots: SkillsInstallRoots;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "phax-skillsargv-runner-"));
    roots = { projectRoot: tmpRoot, homeDir: tmpRoot, bundleRoot };
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("registers the skills install command", async () => {
    const called = await install(roots, ["--help"]);
    expect(called.code).toBe(0);
    expect(called.out + called.err).toContain("--target");
  });

  it("--target is required; missing it is refused with 64", async () => {
    const called = await install(roots, []);
    expect(called.code).toBe(64);
    expect(called.err).toContain("--target");
  });

  it("--scope defaults to project when omitted", async () => {
    const called = await install(roots, ["--target", "claude", "phax-cli"]);
    expect(called.code).toBe(0);
    expect(called.out).toContain("Target: claude");
    expect(called.out).toContain("Scope: project");
  });

  it("--scope can be set to user", async () => {
    const called = await install(roots, ["--target", "codex", "--scope", "user", "phax-cli"]);
    expect(called.code).toBe(0);
    expect(called.out).toContain("Target: codex");
    expect(called.out).toContain("Scope: user");
  });
});

describe("skills install validation", () => {
  // Install into a throwaway project/home so a unit run never mutates the repo
  // working tree; the bundle stays the real shipped .claude/skills so the
  // exposed skills are actually found.
  let tmpRoot: string;
  let roots: SkillsInstallRoots;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "phax-skillsargv-test-"));
    roots = { projectRoot: tmpRoot, homeDir: tmpRoot, bundleRoot };
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("returns 2 and prints error for invalid --target", async () => {
    const { code: exitCode, errLines: errors } = await install(roots, ["--target", "bad-target"]);
    expect(exitCode).toBe(2);
    expect(errors[0]).toContain("Invalid --target");
    expect(errors[0]).toContain("claude");
  });

  it("returns 2 and prints error for invalid --scope", async () => {
    const { code: exitCode, errLines: errors } = await install(roots, [
      "--target",
      "claude",
      "--scope",
      "bad-scope",
    ]);
    expect(exitCode).toBe(2);
    expect(errors[0]).toContain("Invalid --scope");
    expect(errors[0]).toContain("project");
  });

  it("keeps the lines printed before a failure part way on stdout, the failure on stderr", async () => {
    // A bundle holding only the first exposed skill: the first installs, the second fails.
    const [first] = EXPOSED_SKILL_NAMES;
    const partial = join(tmpRoot, "bundle");
    cpSync(join(bundleRoot, first ?? ""), join(partial, first ?? ""), { recursive: true });
    const {
      code: exitCode,
      outLines: lines,
      errLines: errors,
    } = await install({ ...roots, bundleRoot: partial }, ["--target", "claude"]);
    expect(exitCode).toBe(2);
    expect(lines.slice(0, 3)).toEqual(["Target: claude", "Scope: project", ""]);
    expect(lines[3]).toMatch(new RegExp(`^${first}: created \\(`));
    expect(lines).toHaveLength(4);
    expect(errors).toHaveLength(1);
    expect(errors[0]).not.toContain("Target:");
  });

  it("accepts all valid targets without validation error", async () => {
    for (const target of ["claude", "codex", "agent"]) {
      const { code: exitCode, errLines: errors } = await install(roots, ["--target", target]);
      // Install succeeds into the temp root; the point is no validation refusal.
      if (exitCode === 2) {
        expect(errors[0]).not.toContain("Invalid --target");
      }
    }
  });

  it("accepts both valid scopes without validation error", async () => {
    for (const scope of ["project", "user"]) {
      const { code: exitCode, errLines: errors } = await install(roots, [
        "--target",
        "claude",
        "--scope",
        scope,
      ]);
      if (exitCode === 2) {
        expect(errors[0]).not.toContain("Invalid --scope");
      }
    }
  });

  it("returns 2 and prints error for an unknown skill", async () => {
    const { code: exitCode, errLines: errors } = await install(roots, [
      "--target",
      "claude",
      "bogus-skill",
    ]);
    expect(exitCode).toBe(2);
    expect(errors[0]).toContain('Unknown skill "bogus-skill"');
    expect(errors[0]).toContain("phax-planning");
    expect(errors[0]).toContain("phax-cli");
  });

  it("accepts exposed skill names without validation error", async () => {
    for (const skill of ["phax-planning", "phax-cli", "phax-spec"]) {
      const { code: exitCode, errLines: errors } = await install(roots, [
        "--target",
        "claude",
        skill,
      ]);
      if (exitCode === 2) {
        expect(errors[0]).not.toContain("Unknown skill");
      }
    }
  });

  it("installs every bundled skill when no skill is named", async () => {
    // Installs from the real bundle into the temp project root, so every skill
    // is freshly created there.
    const {
      code: exitCode,
      outLines: lines,
      errLines: errors,
    } = await install(roots, ["--target", "claude", "--scope", "project"]);
    expect(errors).toHaveLength(0);
    expect(exitCode).toBe(0);
    const joined = lines.join("\n");
    expect(joined).toContain("phax-planning:");
    expect(joined).toContain("phax-cli:");
    expect(joined).toContain("phax-spec:");
  });
});
