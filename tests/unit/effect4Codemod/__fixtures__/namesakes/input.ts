// Local namesakes of Effect symbols, none imported from `effect`: a codemod that decides
// by name rather than by import binding would rewrite them.

/** A value or why there is none, right-biased like Effect 3's. */
type Either<A, E> =
  | { readonly _tag: "Right"; readonly right: A }
  | { readonly _tag: "Left"; readonly left: E };

/** Runs a step and recovers from any failure it throws. */
function catchAll<A>(step: () => A, recover: (error: unknown) => A): A {
  try {
    return step();
  } catch (error) {
    return recover(error);
  }
}

/** A registry of named keys, shaped like Effect 3's `Context`. */
const Context = {
  Tag:
    (id: string) =>
    <Self, Shape>() =>
      class {
        static readonly key = id;
        declare readonly self: Self;
        declare readonly shape: Shape;
      },
};

export class Clock extends Context.Tag("phax/Clock")<Clock, { readonly now: () => Date }>() {}

export function readSetting(text: string): Either<number, string> {
  return catchAll<Either<number, string>>(
    () => {
      const value: unknown = JSON.parse(text);
      if (typeof value !== "number") throw new Error("not a number");
      return { _tag: "Right", right: value };
    },
    () => ({ _tag: "Left", left: `not a number: ${text}` }),
  );
}
