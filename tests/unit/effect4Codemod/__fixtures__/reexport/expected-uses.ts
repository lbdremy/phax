import { Result } from "./effectReexport.js";

/** A count read from a setting, or why the setting is not one. */
export type CountReading = Result.Result<number, string>;

export function readCount(text: string): CountReading {
  const count = Number(text);
  if (Number.isInteger(count) && count >= 0) return Result.succeed(count);
  return Result.fail(`not a count: ${text}`);
}

export function isCount(reading: CountReading): boolean {
  return Result.isSuccess(reading);
}
