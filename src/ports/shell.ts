import { Context, Data, Effect } from "effect";

export class ShellError extends Data.TaggedError("ShellError")<{
  message: string;
  cause?: unknown;
}> {}

export interface ShellRunOptions {
  readonly command: readonly [string, ...string[]];
  readonly cwd: string;
}

export interface ShellRunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ShellOps {
  run(options: ShellRunOptions): Effect.Effect<ShellRunResult, ShellError>;
}

export class Shell extends Context.Tag("phax/Shell")<Shell, ShellOps>() {}
