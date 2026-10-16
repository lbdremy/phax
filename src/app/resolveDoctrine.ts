import { Effect, Either } from "effect";
import type { ArtifactKind } from "../domain/artifact/status.js";
import {
  DECIDE_SKILL_FOR_KIND,
  type Doctrine,
  assembleDoctrine,
} from "../domain/decide/doctrine.js";
import { DecideRefusedError } from "../domain/errors.js";
import { FileSystem, type FsError } from "../ports/fs.js";

export interface ResolveDoctrineInput {
  readonly kind: ArtifactKind;
  /** The bundled `SKILL.md` of the kind's doctrine skill, read by the caller. */
  readonly bundledSkillText: string;
  /** The repo-relative `--doctrine` file, or null. */
  readonly doctrinePath: string | null;
}

/**
 * Resolves a decide session's doctrine: the project copy at
 * `.claude/skills/<name>/SKILL.md` when it exists, else the bundled skill,
 * then the `--doctrine` file appended. Paths resolve against the
 * FileSystem's root (the repository). An unreadable or invalid doctrine file
 * is refused with reason `doctrine`.
 */
export function resolveDoctrine(
  input: ResolveDoctrineInput,
): Effect.Effect<Doctrine, DecideRefusedError | FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const name = DECIDE_SKILL_FOR_KIND[input.kind];
    const projectPath = `.claude/skills/${name}/SKILL.md`;
    const skill = (yield* fs.exists(projectPath))
      ? { name, source: "project" as const, text: yield* fs.readText(projectPath) }
      : { name, source: "bundled" as const, text: input.bundledSkillText };

    const doctrinePath = input.doctrinePath;
    const file =
      doctrinePath === null
        ? null
        : {
            path: doctrinePath,
            text: yield* fs.readText(doctrinePath).pipe(
              Effect.mapError(
                (err) =>
                  new DecideRefusedError({
                    reason: "doctrine",
                    message: `Decide refused: cannot read doctrine file ${doctrinePath}: ${err.message}`,
                  }),
              ),
            ),
          };

    const assembled = assembleDoctrine({ skill, file });
    if (Either.isLeft(assembled)) {
      return yield* new DecideRefusedError({
        reason: "doctrine",
        message: `Decide refused: ${assembled.left}`,
      });
    }
    return assembled.right;
  });
}
