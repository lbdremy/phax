import { Effect, Layer } from "effect";
import { Prompt, PromptCancelled, PromptError, type PromptOps } from "../../ports/prompt.js";

type ScriptedAnswer = string | boolean | ReadonlyArray<unknown> | typeof CANCEL;

const CANCEL = Symbol("PromptCancelled");

export { CANCEL as FAKE_PROMPT_CANCEL };

export class FakePromptImpl implements PromptOps {
  readonly asks: string[] = [];
  private readonly queue: ScriptedAnswer[];

  constructor(answers: ScriptedAnswer[]) {
    this.queue = [...answers];
  }

  private next(message: string): Effect.Effect<ScriptedAnswer, PromptError | PromptCancelled> {
    this.asks.push(message);
    if (this.queue.length === 0) {
      return Effect.fail(
        new PromptError({ message: `No scripted answer for prompt: "${message}"` }),
      );
    }
    const answer = this.queue.shift()!;
    if (answer === CANCEL) {
      return Effect.fail(new PromptCancelled());
    }
    return Effect.succeed(answer);
  }

  text(opts: {
    message: string;
    placeholder?: string;
    defaultValue?: string;
    required?: boolean;
    validate?: (value: string) => string | undefined;
  }): Effect.Effect<string, PromptError | PromptCancelled> {
    return Effect.flatMap(this.next(opts.message), (answer) => {
      const value = answer as string;
      if (opts.validate) {
        const err = opts.validate(value);
        if (err !== undefined) {
          return Effect.fail(new PromptError({ message: err }));
        }
      }
      return Effect.succeed(value);
    });
  }

  confirm(opts: {
    message: string;
    initialValue?: boolean;
  }): Effect.Effect<boolean, PromptError | PromptCancelled> {
    return Effect.map(this.next(opts.message), (answer) => answer as boolean);
  }

  select<A>(opts: {
    message: string;
    options: ReadonlyArray<{ value: A; label: string; hint?: string }>;
    initialValue?: A;
  }): Effect.Effect<A, PromptError | PromptCancelled> {
    return Effect.map(this.next(opts.message), (answer) => answer as A);
  }

  multiselect<A>(opts: {
    message: string;
    options: ReadonlyArray<{ value: A; label: string; hint?: string }>;
    initialValues?: ReadonlyArray<A>;
    required?: boolean;
  }): Effect.Effect<ReadonlyArray<A>, PromptError | PromptCancelled> {
    return Effect.map(this.next(opts.message), (answer) => answer as ReadonlyArray<A>);
  }

  note(message: string, _title?: string): Effect.Effect<void, PromptError> {
    this.asks.push(message);
    return Effect.void;
  }

  intro(message: string): Effect.Effect<void, PromptError> {
    this.asks.push(message);
    return Effect.void;
  }

  outro(message: string): Effect.Effect<void, PromptError> {
    this.asks.push(message);
    return Effect.void;
  }
}

export const makeFakePrompt = (answers: ScriptedAnswer[]) => {
  const impl = new FakePromptImpl(answers);
  const layer = Layer.succeed(Prompt, impl);
  return { impl, layer } as const;
};
