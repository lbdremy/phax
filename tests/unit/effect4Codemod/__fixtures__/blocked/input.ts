// One use no rule covers (`Either.getOrNull`) keeps the binding's covered uses unrewritten:
// the report names it as their blocker.
import { Either } from "effect";

export const value = Either.getOrNull(Either.right(1));
export const failed = Either.isLeft(Either.left("no"));
