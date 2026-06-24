import { Effect, Either } from "effect";
import { describe, expect, it } from "vitest";
import { FAKE_PROMPT_CANCEL, makeFakePrompt } from "../../src/infra/fakes/prompt.js";
import { Prompt, PromptCancelled, PromptError } from "../../src/ports/prompt.js";

function runEither<A, E>(eff: Effect.Effect<A, E>) {
  return Effect.runPromise(Effect.either(eff));
}

describe("makeFakePrompt", () => {
  it("returns scripted text answers in order", async () => {
    const { impl } = makeFakePrompt(["hello", "world"]);
    const a = await Effect.runPromise(impl.text({ message: "first" }));
    const b = await Effect.runPromise(impl.text({ message: "second" }));
    expect([a, b]).toEqual(["hello", "world"]);
    expect(impl.asks).toEqual(["first", "second"]);
  });

  it("records asks for all prompt types", async () => {
    const { impl } = makeFakePrompt(["text-val", true, "select-val", ["a", "b"]]);
    await Effect.runPromise(impl.text({ message: "t" }));
    await Effect.runPromise(impl.confirm({ message: "c" }));
    await Effect.runPromise(
      impl.select({ message: "s", options: [{ value: "select-val", label: "S" }] }),
    );
    await Effect.runPromise(
      impl.multiselect({
        message: "m",
        options: [
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ],
      }),
    );
    expect(impl.asks).toEqual(["t", "c", "s", "m"]);
  });

  it("records asks for note, intro, outro without consuming queue", async () => {
    const { impl } = makeFakePrompt([]);
    await Effect.runPromise(impl.intro("start"));
    await Effect.runPromise(impl.note("info", "title"));
    await Effect.runPromise(impl.outro("end"));
    expect(impl.asks).toEqual(["start", "info", "end"]);
  });

  it("confirm returns boolean answer", async () => {
    const { impl } = makeFakePrompt([true]);
    const result = await Effect.runPromise(impl.confirm({ message: "yes?" }));
    expect(result).toBe(true);
  });

  it("multiselect returns array answer", async () => {
    const { impl } = makeFakePrompt([["a", "b"]]);
    const result = await Effect.runPromise(
      impl.multiselect({
        message: "pick",
        options: [
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ],
      }),
    );
    expect(result).toEqual(["a", "b"]);
  });

  it("fails with PromptCancelled when FAKE_PROMPT_CANCEL is scripted", async () => {
    const { impl } = makeFakePrompt([FAKE_PROMPT_CANCEL]);
    const result = await runEither(impl.text({ message: "will cancel" }));
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(PromptCancelled);
    }
  });

  it("fails with PromptError when queue is exhausted", async () => {
    const { impl } = makeFakePrompt([]);
    const result = await runEither(impl.text({ message: "empty" }));
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(PromptError);
    }
  });

  it("text validate is called and fails when validation returns an error message", async () => {
    const { impl } = makeFakePrompt(["bad-value"]);
    const result = await runEither(
      impl.text({
        message: "validated",
        validate: (v) => (v === "bad-value" ? "invalid" : undefined),
      }),
    );
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(PromptError);
      expect((result.left as PromptError).message).toBe("invalid");
    }
  });

  it("text validate passes when validation returns undefined", async () => {
    const { impl } = makeFakePrompt(["good-value"]);
    const result = await Effect.runPromise(
      impl.text({
        message: "validated",
        validate: (v) => (v === "good-value" ? undefined : "invalid"),
      }),
    );
    expect(result).toBe("good-value");
  });

  it("layer provides impl via Prompt tag", async () => {
    const { impl, layer } = makeFakePrompt(["answer"]);
    const program = Effect.gen(function* () {
      const prompt = yield* Prompt;
      return yield* prompt.text({ message: "q" });
    });
    const result = await Effect.runPromise(Effect.provide(program, layer));
    expect(result).toBe("answer");
    expect(impl.asks).toEqual(["q"]);
  });
});
