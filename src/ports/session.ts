import { Context, Data, Effect } from "effect";

export class SessionError extends Data.TaggedError("SessionError")<{
  message: string;
  cause?: unknown;
}> {}

export interface SessionOps {
  resume(invocation: {
    executable: string;
    args: readonly string[];
    cwd: string;
  }): Effect.Effect<number, SessionError>;
}

export class Session extends Context.Tag("phax/Session")<Session, SessionOps>() {}
