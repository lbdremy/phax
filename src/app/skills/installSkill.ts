import { join } from "node:path";
import { Effect } from "effect";
import { FileSystem, FsError } from "../../ports/fs.js";
import { SkillInstallError } from "../../domain/errors.js";
import { findExposedSkill } from "../../domain/skills/catalog.js";
import { resolveSkillDestination } from "../../domain/skills/destination.js";
import type { SkillTarget, SkillScope } from "../../domain/skills/types.js";

export interface InstallSkillInput {
  skillName: string;
  target: SkillTarget;
  scope: SkillScope;
  projectRoot: string;
  homeDir: string;
  bundleRoot: string;
}

export interface InstallSkillResult {
  target: SkillTarget;
  scope: SkillScope;
  skillName: string;
  destination: string;
  status: "created" | "updated" | "already-present";
}

function mapFsError(context: string): (e: FsError) => SkillInstallError {
  return (e) => new SkillInstallError({ message: `${context}: ${e.message}` });
}

export function installSkill(
  input: InstallSkillInput,
): Effect.Effect<InstallSkillResult, SkillInstallError, FileSystem> {
  return Effect.gen(function* () {
    const { skillName, target, scope, projectRoot, homeDir, bundleRoot } = input;
    const fs = yield* FileSystem;

    const skill = findExposedSkill(skillName);
    if (skill === null) {
      return yield* Effect.fail(
        new SkillInstallError({
          message: `Unknown skill: "${skillName}". No exposed skill with that name.`,
        }),
      );
    }

    const { skillDir } = resolveSkillDestination({
      target,
      scope,
      projectRoot,
      homeDir,
      skillName,
    });

    // Validate bundle: every manifest file must exist in the bundle
    const bundledContents: string[] = [];
    for (const file of skill.files) {
      const bundlePath = join(bundleRoot, skill.sourceDir, file);
      const content = yield* Effect.mapError(
        fs.readText(bundlePath),
        (e: FsError) =>
          new SkillInstallError({
            message: `Bundled skill file missing at "${bundlePath}": ${e.message}`,
          }),
      );
      bundledContents.push(content);
    }

    // Compute status by comparing destination to bundle
    const skillDirExists = yield* Effect.mapError(
      fs.exists(skillDir),
      mapFsError(`Failed to check skill directory "${skillDir}"`),
    );

    let status: "created" | "updated" | "already-present";
    if (!skillDirExists) {
      status = "created";
    } else {
      let allIdentical = true;
      for (let i = 0; i < skill.files.length; i++) {
        const file = skill.files[i] as string;
        const destPath = join(skillDir, file);
        const destExists = yield* Effect.mapError(
          fs.exists(destPath),
          mapFsError(`Failed to check "${destPath}"`),
        );
        if (!destExists) {
          allIdentical = false;
          break;
        }
        const destContent = yield* Effect.mapError(
          fs.readText(destPath),
          mapFsError(`Failed to read "${destPath}"`),
        );
        if (destContent !== bundledContents[i]) {
          allIdentical = false;
          break;
        }
      }
      status = allIdentical ? "already-present" : "updated";
    }

    // Write files unless already-present
    if (status !== "already-present") {
      for (let i = 0; i < skill.files.length; i++) {
        const file = skill.files[i] as string;
        const destPath = join(skillDir, file);
        yield* Effect.mapError(
          fs.writeAtomic(destPath, bundledContents[i] as string),
          mapFsError(`Failed to write "${destPath}"`),
        );
      }
    }

    // Post-validate: required file must exist
    const requiredPath = join(skillDir, skill.requiredFile);
    const requiredExists = yield* Effect.mapError(
      fs.exists(requiredPath),
      mapFsError(`Failed to verify required file "${requiredPath}"`),
    );
    if (!requiredExists) {
      return yield* Effect.fail(
        new SkillInstallError({
          message: `Post-install validation failed: required file "${requiredPath}" not found after write`,
        }),
      );
    }

    return { target, scope, skillName, destination: skillDir, status };
  });
}
