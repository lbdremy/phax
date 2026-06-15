import { join } from "node:path";
import { homedir } from "node:os";
import { Effect, Either } from "effect";
import type { Command } from "commander";
import type { OutputPort } from "../../ports/output.js";
import {
  parseSkillTarget,
  parseSkillScope,
  SKILL_TARGETS,
  SKILL_SCOPES,
} from "../../domain/skills/types.js";
import { PHAX_PLANNING_SKILL } from "../../domain/skills/catalog.js";
import { installSkill } from "../../app/skills/installSkill.js";
import { NodeFileSystemLayer } from "../../infra/fs.js";

export async function runSkillsInstall(
  opts: { target: string; scope?: string },
  out: OutputPort,
): Promise<number> {
  const target = parseSkillTarget(opts.target);
  if (target === null) {
    out.error(`Invalid --target "${opts.target}". Valid values: ${SKILL_TARGETS.join(", ")}`);
    return 2;
  }

  const scopeStr = opts.scope ?? "project";
  const scope = parseSkillScope(scopeStr);
  if (scope === null) {
    out.error(`Invalid --scope "${scopeStr}". Valid values: ${SKILL_SCOPES.join(", ")}`);
    return 2;
  }

  const bundleRoot = join(import.meta.dirname, "../../..", ".claude", "skills");
  const projectRoot = process.cwd();
  const homeDir = homedir();

  const result = await Effect.runPromise(
    Effect.either(
      installSkill({
        skillName: PHAX_PLANNING_SKILL,
        target,
        scope,
        projectRoot,
        homeDir,
        bundleRoot,
      }),
    ).pipe(Effect.provide(NodeFileSystemLayer)),
  );

  if (Either.isLeft(result)) {
    out.error(result.left.message);
    return 2;
  }

  const { destination, status } = result.right;
  const displayStatus = status === "already-present" ? "already present" : status;

  out.log("Installed PHAX planning skill.");
  out.log("");
  out.log(`Target: ${target}`);
  out.log(`Scope: ${scope}`);
  out.log(`Skill: ${PHAX_PLANNING_SKILL}`);
  out.log(`Destination: ${destination}`);
  out.log(`Status: ${displayStatus}`);

  return 0;
}

export function registerSkillsCommand(program: Command, out: OutputPort): void {
  const skillsCmd = program.command("skills").description("Manage PHAX skills");

  skillsCmd
    .command("install")
    .description("Install the phax-planning skill into an agent's native skill directory")
    .requiredOption("--target <target>", `Agent target (${SKILL_TARGETS.join("|")})`)
    .option("--scope <scope>", `Installation scope (${SKILL_SCOPES.join("|")})`, "project")
    .action(async (opts: { target: string; scope?: string }) => {
      const exitCode = await runSkillsInstall(opts, out);
      process.exit(exitCode);
    });
}
