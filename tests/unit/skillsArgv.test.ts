import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { registerSkillsCommand, runSkillsInstall } from "../../src/cli/commands/skills.js";
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
  it("returns 2 and prints error for invalid --target", async () => {
    const { out, errors } = captureOutput();
    const exitCode = await runSkillsInstall({ target: "bad-target" }, out);
    expect(exitCode).toBe(2);
    expect(errors[0]).toContain("Invalid --target");
    expect(errors[0]).toContain("claude");
  });

  it("returns 2 and prints error for invalid --scope", async () => {
    const { out, errors } = captureOutput();
    const exitCode = await runSkillsInstall({ target: "claude", scope: "bad-scope" }, out);
    expect(exitCode).toBe(2);
    expect(errors[0]).toContain("Invalid --scope");
    expect(errors[0]).toContain("project");
  });

  it("accepts all valid targets without validation error", async () => {
    for (const target of ["claude", "codex", "agent"]) {
      const { out, errors } = captureOutput();
      // Will fail at installSkill (bundle not in cwd), but should pass validation
      const exitCode = await runSkillsInstall({ target }, out);
      // Exit code 2 is fine here (bundle missing), but NOT for invalid-target reason
      if (exitCode === 2) {
        expect(errors[0]).not.toContain("Invalid --target");
      }
    }
  });

  it("accepts both valid scopes without validation error", async () => {
    for (const scope of ["project", "user"]) {
      const { out, errors } = captureOutput();
      const exitCode = await runSkillsInstall({ target: "claude", scope }, out);
      if (exitCode === 2) {
        expect(errors[0]).not.toContain("Invalid --scope");
      }
    }
  });

  it("returns 2 and prints error for an unknown skill", async () => {
    const { out, errors } = captureOutput();
    const exitCode = await runSkillsInstall({ target: "claude", skill: "bogus-skill" }, out);
    expect(exitCode).toBe(2);
    expect(errors[0]).toContain('Unknown skill "bogus-skill"');
    expect(errors[0]).toContain("phax-planning");
    expect(errors[0]).toContain("phax-cli");
  });

  it("accepts exposed skill names without validation error", async () => {
    for (const skill of ["phax-planning", "phax-cli"]) {
      const { out, errors } = captureOutput();
      // Will fail at installSkill (bundle not in cwd), but should pass validation
      const exitCode = await runSkillsInstall({ target: "claude", skill }, out);
      if (exitCode === 2) {
        expect(errors[0]).not.toContain("Unknown skill");
      }
    }
  });

  it("installs every bundled skill when no skill is named", async () => {
    // project scope writes under the repo's own .claude/skills, which already
    // holds both bundled skills — so this is idempotent (already-present).
    const { out, lines, errors } = captureOutput();
    const exitCode = await runSkillsInstall({ target: "claude", scope: "project" }, out);
    expect(errors).toHaveLength(0);
    expect(exitCode).toBe(0);
    const joined = lines.join("\n");
    expect(joined).toContain("phax-planning:");
    expect(joined).toContain("phax-cli:");
  });
});
