import { Effect, Layer } from "effect";
import { Session, type SessionOps, SessionError } from "../../ports/session.js";

export interface FakeSessionInvocation {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
}

export class FakeSessionImpl implements SessionOps {
  readonly invocations: FakeSessionInvocation[] = [];
  exitCode = 0;

  resume(invocation: {
    executable: string;
    args: readonly string[];
    cwd: string;
  }): Effect.Effect<number, SessionError> {
    this.invocations.push(invocation);
    return Effect.succeed(this.exitCode);
  }
}

export const makeFakeSession = (exitCode = 0) => {
  const impl = new FakeSessionImpl();
  impl.exitCode = exitCode;
  const layer = Layer.succeed(Session, impl);
  return { impl, layer } as const;
};
