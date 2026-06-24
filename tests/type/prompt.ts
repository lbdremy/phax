import type { Effect } from "effect";
import type { FakePromptImpl } from "../../src/infra/fakes/prompt.js";
import type { PromptCancelled, PromptError, PromptOps } from "../../src/ports/prompt.js";

// FakePromptImpl must be assignable to PromptOps
declare const fake: FakePromptImpl;
const assignableToOps: PromptOps = fake;
void assignableToOps;

// text returns Effect<string, PromptError | PromptCancelled>
declare const promptOps: PromptOps;
const textEffect: Effect.Effect<string, PromptError | PromptCancelled> = promptOps.text({
  message: "x",
});
void textEffect;

// confirm returns Effect<boolean, PromptError | PromptCancelled>
const confirmEffect: Effect.Effect<boolean, PromptError | PromptCancelled> = promptOps.confirm({
  message: "x",
});
void confirmEffect;

// select returns Effect<A, PromptError | PromptCancelled>
const selectEffect: Effect.Effect<string, PromptError | PromptCancelled> = promptOps.select({
  message: "x",
  options: [{ value: "a", label: "A" }],
});
void selectEffect;

// multiselect returns Effect<ReadonlyArray<A>, PromptError | PromptCancelled>
const multiselectEffect: Effect.Effect<
  ReadonlyArray<string>,
  PromptError | PromptCancelled
> = promptOps.multiselect({ message: "x", options: [{ value: "a", label: "A" }] });
void multiselectEffect;

// note returns Effect<void, PromptError>
const noteEffect: Effect.Effect<void, PromptError> = promptOps.note("msg");
void noteEffect;

// intro returns Effect<void, PromptError>
const introEffect: Effect.Effect<void, PromptError> = promptOps.intro("msg");
void introEffect;

// outro returns Effect<void, PromptError>
const outroEffect: Effect.Effect<void, PromptError> = promptOps.outro("msg");
void outroEffect;
