import { Effect, type Either } from "effect";
import { inspectResume, type ResumeDecision, type ResumeRefusal } from "../../src/app/resume.js";
import type { ShortName } from "../../src/domain/branded.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";

/** `inspectResume` on the real file system, as `phax resume` decides. */
export function inspectResumeOnDisk(
  namespace: string,
  shortName: ShortName,
  stateRoot: string,
): Promise<Either.Either<ResumeDecision, ResumeRefusal>> {
  return Effect.runPromise(
    inspectResume(namespace, shortName, stateRoot).pipe(Effect.provide(NodeFileSystemLayer)),
  );
}
