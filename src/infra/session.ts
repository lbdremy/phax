import { Effect, Layer } from "effect";
import { spawnSync } from "node:child_process";
import { Session, SessionError } from "../ports/session.js";

export function makeNodeSessionLayer(): Layer.Layer<Session> {
  return Layer.succeed(Session, {
    resume: ({ executable, args, cwd }) =>
      Effect.try({
        try: () => {
          const result = spawnSync(executable, [...args], { cwd, stdio: "inherit" });
          if (result.error) throw result.error;
          return result.status ?? 0;
        },
        catch: (err): SessionError =>
          new SessionError({
            message: err instanceof Error ? err.message : String(err),
            cause: err,
          }),
      }),
  });
}
