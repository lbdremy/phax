import { Either } from "./effectReexport.js";

/** A count read from a setting, or why the setting is not one. */
export type CountReading = Either.Either<number, string>;

export function readCount(text: string): CountReading {
  const count = Number(text);
  if (Number.isInteger(count) && count >= 0) return Either.right(count);
  return Either.left(`not a count: ${text}`);
}

export function isCount(reading: CountReading): boolean {
  return Either.isRight(reading);
}
