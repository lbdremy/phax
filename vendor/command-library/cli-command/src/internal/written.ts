import { Effect } from "effect";
import * as Schema from "effect/Schema";

/** A file a command wrote: where, in which format (the document's own `$schema`, when it names
 *  one), and the SHA-256 of its bytes. Both command libraries make the same record. */
export const Written: Schema.Struct<{
  readonly path: Schema.String;
  readonly format: Schema.NullOr<Schema.String>;
  readonly digest: Schema.String;
}> = Schema.Struct({
  path: Schema.String,
  format: Schema.NullOr(Schema.String),
  digest: Schema.String,
});

export type Written = typeof Written.Type;

// The package builds without the DOM or Node types: the two web globals it needs are named here.
interface WebGlobals {
  readonly crypto: {
    readonly subtle: {
      readonly digest: (
        algorithm: string,
        data: Uint8Array,
      ) => Promise<ArrayBuffer>;
    };
  };
  readonly TextDecoder: new (
    label: string,
    options: { readonly fatal: boolean },
  ) => { readonly decode: (bytes: Uint8Array) => string };
  readonly TextEncoder: new () => {
    readonly encode: (text: string) => Uint8Array;
  };
}

const web = globalThis as unknown as WebGlobals;

/** UTF-8 text as bytes. */
export function utf8Bytes(text: string): Uint8Array {
  return new web.TextEncoder().encode(text);
}

/** UTF-8 bytes as text; bytes that are not UTF-8 throw. */
export function utf8Text(bytes: Uint8Array): string {
  return new web.TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

const hex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

/** The bytes' top-level `$schema`, when they are a JSON object holding a string there. */
function formatOf(bytes: Uint8Array): string | null {
  try {
    const parsed: unknown = JSON.parse(utf8Text(bytes));
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return null;
    }
    const schema: unknown = Reflect.get(parsed, "$schema");
    return typeof schema === "string" ? schema : null;
  } catch {
    return null;
  }
}

/** The record of a file written with these bytes at this path: `sha256:` and 64 lowercase hex digits. */
export function written(
  path: string,
  bytes: Uint8Array,
): Effect.Effect<Written> {
  return Effect.promise(() =>
    web.crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
  ).pipe(
    Effect.map((digest) => ({
      path,
      format: formatOf(bytes),
      digest: `sha256:${hex(digest)}`,
    })),
  );
}
