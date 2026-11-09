import type { Refusal, RefusalPath } from "./model.js";

/**
 * A refusal's message, without its path: `is missing`; `is unexpected,
 * expected: <expected>`; for any other kind, the `message` alone when it is
 * set, and otherwise `Expected <expected>, actual <formatActual(actual)>`.
 */
export function refusalMessage(_refusal: Refusal): string {
  throw new Error("refusal renderer: not implemented");
}

/**
 * A refusal's path. `bracketed` reads as the JSON path a document author would
 * type (`acceptanceCriteria[2].refs[0]`); `dotted` joins every segment with
 * `.` (`a.0.b`). Both give `""` for the root.
 */
export function refusalPath(_path: RefusalPath, _notation: "bracketed" | "dotted"): string {
  throw new Error("refusal renderer: not implemented");
}

/**
 * The refused value as a refusal line prints it: the text Effect 3 printed for
 * the same JSON data (`"x"`, `1`, `null`, `undefined`, `[1,"a"]`, `{"a":1}`).
 */
export function formatActual(_value: unknown): string {
  throw new Error("refusal renderer: not implemented");
}
