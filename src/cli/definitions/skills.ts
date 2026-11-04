// `phax skills install` as the runner reads it: installs the bundled PHAX skills into an agent's
// native skill directory. Its answer lists each skill with what became of it and the files it
// installed as written-file records (none for a skill already present). A target, scope or skill
// the command does not know is refused by `run` with today's sentence and exit 2, so the inputs
// are strings; an install that fails part way is an error naming the lines already reached and
// the files already installed.
import { join } from "node:path";
import { homedir } from "node:os";
import { Data, Effect } from "effect";
import * as Schema from "effect/Schema";
import { installSkill } from "../../app/skills/installSkill.js";
import { EXPOSED_SKILL_NAMES, findExposedSkill } from "../../domain/skills/catalog.js";
import {
  parseSkillScope,
  parseSkillTarget,
  SKILL_SCOPES,
  SKILL_TARGETS,
} from "../../domain/skills/types.js";
import { NodeFileSystemLayer } from "../../infra/fs.js";
import { FileSystem } from "../../ports/fs.js";
import {
  defineCommand,
  defineGroup,
  reject,
  Written,
  written,
} from "../commandLibrary/contract/index.js";
import { exposeMessage, findGitRoot, MessageFields, recordedPath } from "./shared.js";

/** Filesystem roots the install resolves against. The program uses the real environment (the
 *  current working directory, the user's home, and the bundled .claude/skills tree shipped with
 *  phax); tests inject temp dirs so a unit run never writes into the repo working tree. */
export interface SkillsInstallRoots {
  readonly projectRoot: string;
  readonly homeDir: string;
  readonly bundleRoot: string;
}

/** The bundled `.claude/skills` tree shipped with this phax install. */
export function defaultBundleRoot(): string {
  return join(import.meta.dirname, "../../..", ".claude", "skills");
}

/** The real roots, read when the command runs. */
export function defaultInstallRoots(): SkillsInstallRoots {
  return {
    projectRoot: process.cwd(),
    homeDir: homedir(),
    bundleRoot: defaultBundleRoot(),
  };
}

/** The `--target` is none phax installs for. */
class InvalidSkillTargetError extends Data.TaggedError("InvalidSkillTargetError")<{
  readonly message: string;
}> {}

/** The `--scope` is none phax installs for. */
class InvalidSkillScopeError extends Data.TaggedError("InvalidSkillScopeError")<{
  readonly message: string;
}> {}

/** The skill named is none the bundle exposes. */
class UnknownSkillError extends Data.TaggedError("UnknownSkillError")<{
  readonly message: string;
}> {}

/** An install failed: `reached` is what the command had printed before it, `written` the files
 *  already installed. */
class SkillsInstallFailedError extends Data.TaggedError("SkillsInstallFailedError")<{
  readonly message: string;
  readonly reached: ReadonlyArray<string>;
  readonly written: ReadonlyArray<Written>;
}> {}

const SkillsInstallOutput = Schema.Struct({
  target: Schema.String,
  scope: Schema.String,
  skills: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      status: Schema.Literal("created", "updated", "already-present"),
      destination: Schema.String,
    }),
  ),
  written: Schema.Array(Written),
});

/** `phax skills install` over these install roots, read when it runs. */
export function makeSkillsInstallCommand(roots: () => SkillsInstallRoots) {
  return defineCommand({
    name: "install",
    summary: "Install bundled PHAX skills into an agent's native skill directory",
    input: {
      args: reject(
        Schema.Tuple(
          Schema.optionalElement(
            Schema.String.annotations({
              identifier: "skill",
              description: `Skill to install (${EXPOSED_SKILL_NAMES.join("|")}); installs all skills when omitted`,
            }),
          ),
        ),
      ),
      flags: reject(
        Schema.Struct({
          target: Schema.String.annotations({
            description: `Agent target (${SKILL_TARGETS.join("|")})`,
          }),
          scope: Schema.optionalWith(
            Schema.String.annotations({
              description: `Installation scope (${SKILL_SCOPES.join("|")})`,
            }),
            { default: () => "project" },
          ),
        }),
      ),
    },
    output: reject(SkillsInstallOutput),
    run: ({ input }) =>
      Effect.gen(function* () {
        const target = parseSkillTarget(input.flags.target);
        if (target === null) {
          return yield* Effect.fail(
            new InvalidSkillTargetError({
              message: `Invalid --target "${input.flags.target}". Valid values: ${SKILL_TARGETS.join(", ")}`,
            }),
          );
        }
        const scope = parseSkillScope(input.flags.scope);
        if (scope === null) {
          return yield* Effect.fail(
            new InvalidSkillScopeError({
              message: `Invalid --scope "${input.flags.scope}". Valid values: ${SKILL_SCOPES.join(", ")}`,
            }),
          );
        }
        // No skill named → install every bundled skill; a name → install just that one.
        const named = input.args[0];
        let skillNames: ReadonlyArray<string> = EXPOSED_SKILL_NAMES;
        if (named !== undefined) {
          if (findExposedSkill(named) === null) {
            return yield* Effect.fail(
              new UnknownSkillError({
                message: `Unknown skill "${named}". Valid values: ${EXPOSED_SKILL_NAMES.join(", ")}`,
              }),
            );
          }
          skillNames = [named];
        }

        const { projectRoot, homeDir, bundleRoot } = roots();
        const recordRoot = findGitRoot(projectRoot);
        const reached: string[] = [`Target: ${target}`, `Scope: ${scope}`, ""];
        const skills: Array<{
          name: string;
          status: "created" | "updated" | "already-present";
          destination: string;
        }> = [];
        const files: Written[] = [];

        for (const skillName of skillNames) {
          const installed = yield* installSkill({
            skillName,
            target,
            scope,
            projectRoot,
            homeDir,
            bundleRoot,
          }).pipe(
            Effect.provide(NodeFileSystemLayer),
            Effect.mapError(
              (error) =>
                new SkillsInstallFailedError({
                  message: error.message,
                  reached: [...reached],
                  written: [...files],
                }),
            ),
          );
          const { destination, status } = installed;
          skills.push({ name: skillName, status, destination });
          reached.push(
            `${skillName}: ${status === "already-present" ? "already present" : status} (${destination})`,
          );
          if (status === "already-present") continue;
          // Each file installed, as the disk holds it now. Under project scope the record names
          // it from the repository root; under user scope its path is absolute.
          const skill = findExposedSkill(skillName);
          for (const file of skill?.files ?? []) {
            const path = join(destination, file);
            const bytes = yield* Effect.gen(function* () {
              const fs = yield* FileSystem;
              return yield* fs.readBytes(path);
            }).pipe(Effect.provide(NodeFileSystemLayer), Effect.orDie);
            files.push(
              yield* written(scope === "project" ? recordedPath(path, recordRoot) : path, bytes),
            );
          }
        }
        return { target, scope, skills, written: files };
      }).pipe(Effect.mapError(exposeMessage)),
    exits: {
      InvalidSkillTargetError: 2,
      InvalidSkillScopeError: 2,
      UnknownSkillError: 2,
      SkillsInstallFailedError: 2,
    },
    errors: {
      InvalidSkillTargetError: MessageFields,
      InvalidSkillScopeError: MessageFields,
      UnknownSkillError: MessageFields,
      SkillsInstallFailedError: Schema.Struct({
        message: Schema.String,
        reached: Schema.Array(Schema.String),
        written: Schema.Array(Written),
      }),
    },
    texts: {
      InvalidSkillTargetError: (error) => error.message,
      InvalidSkillScopeError: (error) => error.message,
      UnknownSkillError: (error) => error.message,
      // The lines the command had printed, then the failure, as before.
      SkillsInstallFailedError: (error) => [...error.reached, error.message].join("\n"),
    },
    render: (value) =>
      [
        `Target: ${value.target}`,
        `Scope: ${value.scope}`,
        "",
        ...value.skills.map(
          (skill) =>
            `${skill.name}: ${skill.status === "already-present" ? "already present" : skill.status} (${skill.destination})`,
        ),
      ].join("\n"),
  });
}

const skillsInstallCommand = makeSkillsInstallCommand(defaultInstallRoots);

export const skillsGroup = defineGroup({
  name: "skills",
  summary: "Manage PHAX skills",
  commands: [skillsInstallCommand],
});
