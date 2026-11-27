// The PHAX_HOME environment variable, decoded before phax uses it as its home: unset, or a
// non-empty POSIX absolute path. An empty value, an unexpanded `~/...` and a relative path are
// refused. Whether the path is a directory is the resolution point's to check (src/app/phaxHome.ts).
import { Result, Schema } from "effect";

const PhaxHomeVariableSchema = Schema.String.check(Schema.isStartingWith("/")).pipe(
  Schema.annotate({
    identifier: "PhaxHomeVariable",
    description: "An absolute path (starting with `/`) to the directory phax uses as its home.",
  }),
);

const decodePath = Schema.decodeUnknownResult(PhaxHomeVariableSchema);

/** PHAX_HOME as phax reads it: not set, or set to an absolute path. */
type PhaxHomeVariable =
  | { readonly kind: "unset" }
  | { readonly kind: "set"; readonly path: string };

/** `{ kind: "unset" }` for undefined, `{ kind: "set", path }` for an absolute path; any other value is refused. */
export function decodePhaxHomeVariable(
  raw: string | undefined,
): Result.Result<PhaxHomeVariable, Schema.SchemaError> {
  if (raw === undefined) return Result.succeed({ kind: "unset" });
  return Result.map(decodePath(raw), (path): PhaxHomeVariable => ({ kind: "set", path }));
}
