import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Effect } from "effect";
import { runner } from "../../src/cli/commandLibrary/commander/index.js";
import {
  defineGroup,
  defineProgram,
  type ExitCode,
} from "../../src/cli/commandLibrary/contract/index.js";
import { runSkillsInstall } from "../../src/cli/commands/skills.js";
import type { SkillsInstallRoots } from "../../src/cli/commands/skills.js";
import { makeSkillsInstallCommand } from "../../src/cli/definitions/skills.js";
import type { OutputPort } from "../../src/ports/output.js";
import { memoryIo } from "./commandLibrary/commander/support/memoryIo.js";

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

// The bundle stays the real shipped .claude/skills so the exposed skills are actually found.
const bundleRoot = join(import.meta.dirname, "../..", ".claude", "skills");

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

  /** The skills group over the temporary roots, called as `phax skills install …argv`. */
  async function call(argv: ReadonlyArray<string>) {
    const program = defineProgram({
      name: "phax",
      version: "0.0.0",
      exits: { refused: 64, defect: 70 },
      commands: [
        defineGroup({
          name: "skills",
          summary: "Manage PHAX skills",
          commands: [makeSkillsInstallCommand(() => roots)],
        }),
      ],
    });
    const memory = memoryIo({ argv: ["skills", "install", ...argv] });
    const code = await Effect.runPromise(runner.run(program, memory.io) as Effect.Effect<ExitCode>);
    return { code, out: memory.out.join(""), err: memory.err.join("") };
  }

  it("registers the skills install command", async () => {
    const called = await call(["--help"]);
    expect(called.code).toBe(0);
    expect(called.out + called.err).toContain("--target");
  });

  it("--target is required; missing it is refused with 64", async () => {
    const called = await call([]);
    expect(called.code).toBe(64);
    expect(called.err).toContain("--target");
  });

  it("--scope defaults to project when omitted", async () => {
    const called = await call(["--target", "claude", "phax-cli"]);
    expect(called.code).toBe(0);
    expect(called.out).toContain("Target: claude");
    expect(called.out).toContain("Scope: project");
  });

  it("--scope can be set to user", async () => {
    const called = await call(["--target", "codex", "--scope", "user", "phax-cli"]);
    expect(called.code).toBe(0);
    expect(called.out).toContain("Target: codex");
    expect(called.out).toContain("Scope: user");
  });
});

describe("runSkillsInstall validation", () => {
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
