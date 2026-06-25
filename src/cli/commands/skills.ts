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
import { EXPOSED_SKILL_NAMES, findExposedSkill } from "../../domain/skills/catalog.js";
import { installSkill } from "../../app/skills/installSkill.js";
import { NodeFileSystemLayer } from "../../infra/fs.js";

export async function runSkillsInstall(
  opts: { target: string; scope?: string | undefined; skill?: string | undefined },
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

  // No skill named → install every bundled skill; a name → install just that one.
  let skillNames: readonly string[];
  if (opts.skill === undefined) {
    skillNames = EXPOSED_SKILL_NAMES;
  } else {
    if (findExposedSkill(opts.skill) === null) {
      out.error(`Unknown skill "${opts.skill}". Valid values: ${EXPOSED_SKILL_NAMES.join(", ")}`);
      return 2;
    }
    skillNames = [opts.skill];
  }

  const bundleRoot = join(import.meta.dirname, "../../..", ".claude", "skills");
  const projectRoot = process.cwd();
  const homeDir = homedir();

  out.log(`Target: ${target}`);
  out.log(`Scope: ${scope}`);
  out.log("");

  for (const skillName of skillNames) {
    const result = await Effect.runPromise(
      Effect.either(
        installSkill({
          skillName,
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
    out.log(`${skillName}: ${displayStatus} (${destination})`);
  }

  return 0;
}

export function registerSkillsCommand(program: Command, out: OutputPort): void {
  const skillsCmd = program.command("skills").description("Manage PHAX skills");

  skillsCmd
    .command("install")
    .description("Install bundled PHAX skills into an agent's native skill directory")
    .argument(
      "[skill]",
      `Skill to install (${EXPOSED_SKILL_NAMES.join("|")}); installs all skills when omitted`,
    )
    .requiredOption("--target <target>", `Agent target (${SKILL_TARGETS.join("|")})`)
    .option("--scope <scope>", `Installation scope (${SKILL_SCOPES.join("|")})`, "project")
    .action(async (skill: string | undefined, opts: { target: string; scope?: string }) => {
      const exitCode = await runSkillsInstall({ ...opts, skill }, out);
      process.exit(exitCode);
    });
}
