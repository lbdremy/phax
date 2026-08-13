import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { registerSkillsCommand, runSkillsInstall } from "../../src/cli/commands/skills.js";
import type { SkillsInstallRoots } from "../../src/cli/commands/skills.js";
import type { OutputPort } from "../../src/ports/output.js";

function makeProgram() {
  const p = new Command();
  p.exitOverride();
  return p;
}

function captureOutput(): { out: OutputPort; lines: string[]; errors: string[] } {
  const lines: string[] = [];
  const errors: string[] = [];
  const out: OutputPort = {
    log: (msg: string) => lines.push(msg),
    warn: (msg: string) => lines.push(msg),
    error: (msg: string) => errors.push(msg),
  };
  return { out, lines, errors };
}

describe("skills install subcommand registration", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  it("registers the skills install command", () => {
    const p = makeProgram();
    const { out } = captureOutput();
    registerSkillsCommand(p, out);

    const skillsCmd = p.commands.find((c) => c.name() === "skills");
    expect(skillsCmd).toBeDefined();

    const installCmd = skillsCmd?.commands.find((c) => c.name() === "install");
    expect(installCmd).toBeDefined();
  });

  it("--target is required; missing it throws via exitOverride", async () => {
    const p = makeProgram();
    const { out } = captureOutput();
    registerSkillsCommand(p, out);

    await expect(p.parseAsync(["node", "phax", "skills", "install"])).rejects.toThrow();
  });

  it("--scope defaults to project when omitted", async () => {
    const installFn = vi.fn().mockResolvedValue(0);

    const p = makeProgram();
    const skillsCmd = p.command("skills");
    skillsCmd
      .command("install")
      .requiredOption("--target <target>", "target")
      .option("--scope <scope>", "scope", "project")
      .action(async (opts: { target: string; scope?: string }) => {
        const exitCode = await installFn(opts);
        process.exit(exitCode);
      });

    await p.parseAsync(["node", "phax", "skills", "install", "--target", "claude"]);

    expect(installFn).toHaveBeenCalledOnce();
    expect(installFn.mock.calls[0][0]).toMatchObject({ target: "claude", scope: "project" });
  });

  it("--scope can be set to user", async () => {
    const installFn = vi.fn().mockResolvedValue(0);

    const p = makeProgram();
    const skillsCmd = p.command("skills");
    skillsCmd
      .command("install")
      .requiredOption("--target <target>", "target")
      .option("--scope <scope>", "scope", "project")
      .action(async (opts: { target: string; scope?: string }) => {
        const exitCode = await installFn(opts);
        process.exit(exitCode);
      });

    await p.parseAsync([
      "node",
      "phax",
      "skills",
      "install",
      "--target",
      "codex",
      "--scope",
      "user",
    ]);

    expect(installFn).toHaveBeenCalledOnce();
    expect(installFn.mock.calls[0][0]).toMatchObject({ target: "codex", scope: "user" });
  });
});

describe("runSkillsInstall validation", () => {
  // Install into a throwaway project/home so a unit run never mutates the repo
  // working tree; the bundle stays the real shipped .claude/skills so the
  // exposed skills are actually found.
  const bundleRoot = join(import.meta.dirname, "../..", ".claude", "skills");
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
    const { out, errors } = captureOutput();
    const exitCode = await runSkillsInstall({ target: "bad-target" }, out, roots);
    expect(exitCode).toBe(2);
    expect(errors[0]).toContain("Invalid --target");
    expect(errors[0]).toContain("claude");
  });

  it("returns 2 and prints error for invalid --scope", async () => {
    const { out, errors } = captureOutput();
    const exitCode = await runSkillsInstall({ target: "claude", scope: "bad-scope" }, out, roots);
    expect(exitCode).toBe(2);
    expect(errors[0]).toContain("Invalid --scope");
    expect(errors[0]).toContain("project");
  });

  it("accepts all valid targets without validation error", async () => {
    for (const target of ["claude", "codex", "agent"]) {
      const { out, errors } = captureOutput();
      const exitCode = await runSkillsInstall({ target }, out, roots);
      // Install succeeds into the temp root; the point is no validation refusal.
      if (exitCode === 2) {
        expect(errors[0]).not.toContain("Invalid --target");
      }
    }
  });

  it("accepts both valid scopes without validation error", async () => {
    for (const scope of ["project", "user"]) {
      const { out, errors } = captureOutput();
      const exitCode = await runSkillsInstall({ target: "claude", scope }, out, roots);
      if (exitCode === 2) {
        expect(errors[0]).not.toContain("Invalid --scope");
      }
    }
  });

  it("returns 2 and prints error for an unknown skill", async () => {
    const { out, errors } = captureOutput();
    const exitCode = await runSkillsInstall({ target: "claude", skill: "bogus-skill" }, out, roots);
    expect(exitCode).toBe(2);
    expect(errors[0]).toContain('Unknown skill "bogus-skill"');
    expect(errors[0]).toContain("phax-planning");
    expect(errors[0]).toContain("phax-cli");
  });

  it("accepts exposed skill names without validation error", async () => {
    for (const skill of ["phax-planning", "phax-cli", "phax-spec"]) {
      const { out, errors } = captureOutput();
      const exitCode = await runSkillsInstall({ target: "claude", skill }, out, roots);
      if (exitCode === 2) {
        expect(errors[0]).not.toContain("Unknown skill");
      }
    }
  });

  it("installs every bundled skill when no skill is named", async () => {
    // Installs from the real bundle into the temp project root, so every skill
    // is freshly created there.
    const { out, lines, errors } = captureOutput();
    const exitCode = await runSkillsInstall({ target: "claude", scope: "project" }, out, roots);
    expect(errors).toHaveLength(0);
    expect(exitCode).toBe(0);
    const joined = lines.join("\n");
    expect(joined).toContain("phax-planning:");
    expect(joined).toContain("phax-cli:");
    expect(joined).toContain("phax-spec:");
  });
});
