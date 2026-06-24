import * as clackPrompts from "@clack/prompts";
import { Effect, Layer } from "effect";
import { Prompt, PromptCancelled, PromptError } from "../ports/prompt.js";

function wrapClack<A>(
  fn: () => Promise<A | symbol>,
): Effect.Effect<A, PromptError | PromptCancelled> {
  return Effect.tryPromise({
    try: async () => {
      const result = await fn();
      if (clackPrompts.isCancel(result)) {
        throw new PromptCancelled();
      }
      return result as A;
    },
    catch: (err): PromptError | PromptCancelled => {
      if (err instanceof PromptCancelled) return err;
      return new PromptError({
        message: err instanceof Error ? err.message : String(err),
        cause: err,
      });
    },
  });
}

function wrapVoid(fn: () => unknown): Effect.Effect<void, PromptError> {
  return Effect.tryPromise({
    try: async () => {
      fn();
    },
    catch: (err): PromptError =>
      new PromptError({
        message: err instanceof Error ? err.message : String(err),
        cause: err,
      }),
  });
}

export function makeClackPromptLayer(): Layer.Layer<Prompt> {
  return Layer.succeed(Prompt, {
    text: (opts) =>
      wrapClack(() =>
        clackPrompts.text({
          message: opts.message,
          ...(opts.placeholder !== undefined ? { placeholder: opts.placeholder } : {}),
          ...(opts.defaultValue !== undefined ? { defaultValue: opts.defaultValue } : {}),
          ...(opts.validate !== undefined
            ? { validate: (v: string | undefined) => opts.validate!(v ?? "") }
            : {}),
        }),
      ),

    confirm: (opts) =>
      wrapClack(() =>
        clackPrompts.confirm({
          message: opts.message,
          ...(opts.initialValue !== undefined ? { initialValue: opts.initialValue } : {}),
        }),
      ),

    select: <A>(opts: {
      message: string;
      options: ReadonlyArray<{ value: A; label: string; hint?: string }>;
      initialValue?: A;
    }) =>
      wrapClack(() =>
        clackPrompts.select<A>({
          message: opts.message,
          options: opts.options as unknown as Parameters<
            typeof clackPrompts.select<A>
          >[0]["options"],
          ...(opts.initialValue !== undefined ? { initialValue: opts.initialValue } : {}),
        }),
      ),

    multiselect: <A>(opts: {
      message: string;
      options: ReadonlyArray<{ value: A; label: string; hint?: string }>;
      initialValues?: ReadonlyArray<A>;
      required?: boolean;
    }) =>
      wrapClack(() =>
        clackPrompts.multiselect<A>({
          message: opts.message,
          options: opts.options as unknown as Parameters<
            typeof clackPrompts.multiselect<A>
          >[0]["options"],
          ...(opts.initialValues !== undefined
            ? { initialValues: opts.initialValues as Array<A> }
            : {}),
          ...(opts.required !== undefined ? { required: opts.required } : {}),
        }),
      ) as Effect.Effect<ReadonlyArray<A>, PromptError | PromptCancelled>,

    note: (message, title) => wrapVoid(() => clackPrompts.note(message, title)),

    intro: (message) => wrapVoid(() => clackPrompts.intro(message)),

    outro: (message) => wrapVoid(() => clackPrompts.outro(message)),
  });
}
