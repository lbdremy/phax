import { Context, Data, Effect } from "effect";

export class ShellError extends Data.TaggedError("ShellError")<{
  message: string;
  cause?: unknown;
  exitCode?: number;
  argv?: readonly string[];
  stderrExcerpt?: string;
  expected?: string;
}> {}

export interface ShellRunOptions {
  readonly command: readonly [string, ...string[]];
  readonly cwd: string;
  readonly stdin?: string;
  /**
   * Wall-clock cap on the child. Unset means no cap, which is the right default
   * for gate commands — a build or a test suite is legitimately slow. Set it
   * only where a wedged child would wedge a command the user expects to be
   * quick, and the adapter reports the expiry as a `ShellError`.
   */
  readonly timeoutMs?: number;
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
