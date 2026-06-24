import { Context, Data, Effect } from "effect";

export class PromptError extends Data.TaggedError("PromptError")<{
  message: string;
  cause?: unknown;
}> {}

export class PromptCancelled extends Data.TaggedError("PromptCancelled")<{}> {}

export interface PromptOps {
  text(opts: {
    message: string;
    placeholder?: string;
    defaultValue?: string;
    required?: boolean;
    validate?: (value: string) => string | undefined;
  }): Effect.Effect<string, PromptError | PromptCancelled>;

  confirm(opts: {
    message: string;
    initialValue?: boolean;
  }): Effect.Effect<boolean, PromptError | PromptCancelled>;

  select<A>(opts: {
    message: string;
    options: ReadonlyArray<{ value: A; label: string; hint?: string }>;
    initialValue?: A;
  }): Effect.Effect<A, PromptError | PromptCancelled>;

  multiselect<A>(opts: {
    message: string;
    options: ReadonlyArray<{ value: A; label: string; hint?: string }>;
    initialValues?: ReadonlyArray<A>;
    required?: boolean;
  }): Effect.Effect<ReadonlyArray<A>, PromptError | PromptCancelled>;

  note(message: string, title?: string): Effect.Effect<void, PromptError>;

  intro(message: string): Effect.Effect<void, PromptError>;

  outro(message: string): Effect.Effect<void, PromptError>;
}

export class Prompt extends Context.Tag("phax/Prompt")<Prompt, PromptOps>() {}
