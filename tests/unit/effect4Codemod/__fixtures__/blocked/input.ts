// One use no rule covers (`Either.getOrThrow`) keeps the binding's covered uses unrewritten:
// the report names it as their blocker.
import { Either } from "effect";

export const value = Either.getOrThrow(Either.right(1));
export const failed = Either.isLeft(Either.left("no"));
