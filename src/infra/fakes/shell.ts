import { Effect, Layer } from "effect";
import {
  Shell,
  ShellError,
  type ShellOps,
  type ShellRunOptions,
  type ShellRunResult,
} from "../../ports/shell.js";

export interface FakeShellResponse {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export class FakeShellImpl implements ShellOps {
  readonly calls: ShellRunOptions[] = [];
  readonly responses = new Map<string, FakeShellResponse>();
  defaultResponse: FakeShellResponse = { exitCode: 0, stdout: "", stderr: "" };
  readonly queue: FakeShellResponse[] = [];
  private readonly failures = new Map<string, string>();

  setResponse(command: string, response: FakeShellResponse): void {
    this.responses.set(command, response);
  }

  setDefaultResponse(response: FakeShellResponse): void {
    this.defaultResponse = response;
  }

  enqueue(...responses: FakeShellResponse[]): void {
    this.queue.push(...responses);
  }

  /** Makes `run` fail with a `ShellError` for this command, as a timeout or spawn failure does. */
  setFailure(command: string, message: string): void {
    this.failures.set(command, message);
  }

  run(options: ShellRunOptions): Effect.Effect<ShellRunResult, ShellError> {
    this.calls.push(options);
    const key = options.command.join(" ");
    const failure = this.failures.get(key);
    if (failure !== undefined) {
      return Effect.fail(new ShellError({ message: failure, argv: options.command }));
    }
    if (this.queue.length > 0) {
      return Effect.succeed(this.queue.shift()!);
    }
    const response = this.responses.get(key) ?? this.defaultResponse;
    return Effect.succeed(response);
  }
}

export const makeFakeShell = () => {
  const impl = new FakeShellImpl();
  const layer = Layer.succeed(Shell, impl);
  return { impl, layer } as const;
};
