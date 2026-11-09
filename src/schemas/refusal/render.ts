import type { Refusal, RefusalPath } from "./model.js";

/**
 * A refusal's message, without its path: `is missing`; `is unexpected,
 * expected: <expected>`; for any other kind, the `message` alone when it is
 * set, and otherwise `Expected <expected>, actual <formatActual(actual)>`. A
 * missing or unexpected refusal that carries phax's own text renders that
 * text alone.
 */
export function refusalMessage(refusal: Refusal): string {
  switch (refusal.kind) {
    case "missing":
      return refusal.message ?? "is missing";
    case "unexpected":
      return refusal.message ?? `is unexpected, expected: ${refusal.expected}`;
    case "invalid-type":
    case "invalid-value":
    case "filter":
      return (
        refusal.message ?? `Expected ${refusal.expected}, actual ${formatActual(refusal.actual)}`
      );
  }
}

/**
 * A refusal's path. `bracketed` reads as the JSON path a document author would
 * type (`acceptanceCriteria[2].refs[0]`); `dotted` joins every segment with
 * `.` (`a.0.b`). Both give `""` for the root.
 */
export function refusalPath(path: RefusalPath, notation: "bracketed" | "dotted"): string {
  if (notation === "dotted") return path.map(String).join(".");
  return path
    .map((segment, i) =>
      typeof segment === "number" ? `[${segment}]` : `${i === 0 ? "" : "."}${String(segment)}`,
    )
    .join("");
}

/**
 * The refused value as a refusal line prints it: the text Effect 3 printed for
 * the same JSON data (`"x"`, `1`, `null`, `undefined`, `[1,"a"]`, `{"a":1}`).
 * Strings are JSON-quoted, other primitives print as written, arrays and
 * objects print compactly and recursively, and a cycle prints `[Circular]`.
 */
export function formatActual(value: unknown): string {
  const seen = new WeakSet<object>();
  const go = (v: unknown): string => {
    if (typeof v === "string") return JSON.stringify(v);
    if (typeof v === "bigint") return `${String(v)}n`;
    if (typeof v !== "object" || v === null) return String(v);
    if (seen.has(v)) return "[Circular]";
    seen.add(v);
    if (Array.isArray(v)) return `[${v.map(go).join(",")}]`;
    const record = v as Record<PropertyKey, unknown>;
    const body = Reflect.ownKeys(v)
      .map(
        (key) =>
          `${typeof key === "string" ? JSON.stringify(key) : String(key)}:${go(record[key])}`,
      )
      .join(",");
    return `{${body}}`;
  };
  return go(value);
}
