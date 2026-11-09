// `phax schema upgrade` as the runner reads it: regenerates phax.schema.json and the user schema
// from the installed binary's config contract. Its answer says whether it updated the files or
// found them current, and lists the files it wrote as written-file records (none when current).
import { Data, Effect } from "effect";
import * as Schema from "effect/Schema";
import { upgradeConfigSchema } from "../../app/initProject.js";
import { NodeFileSystemLayer } from "../../infra/fs.js";
import { FileSystem } from "../../ports/fs.js";
import {
  defineCommand,
  defineGroup,
  reject,
  Written,
  written,
} from "../commandLibrary/contract/index.js";
import { exposeMessage, gitRoot, MessageFields, recordedPath } from "./shared.js";

/** No phax.json holds the invocation directory. */
class NoPhaxConfigError extends Data.TaggedError("NoPhaxConfigError")<{
  readonly message: string;
}> {}

const SchemaUpgradeOutput = Schema.Struct({
  kind: Schema.Literals(["updated", "current"]),
  schemaPath: Schema.String,
  userSchemaPath: Schema.String,
  written: Schema.Array(Written),
});

const schemaUpgradeCommand = defineCommand({
  name: "upgrade",
  summary:
    "Regenerate phax.schema.json from the installed binary's config contract; never modifies phax.json",
  input: {},
  output: reject(SchemaUpgradeOutput),
  run: () =>
    Effect.gen(function* () {
      const result = upgradeConfigSchema(process.cwd());
      if (result.kind === "no_config") {
        return yield* Effect.fail(
          new NoPhaxConfigError({ message: "No phax.json found. Run `phax init` first." }),
        );
      }
      const { kind, schemaPath, userSchemaPath } = result;
      if (kind === "current") {
        return { kind, schemaPath, userSchemaPath, written: [] };
      }
      const root = gitRoot(process.cwd());
      // Each file as the disk holds it now.
      const files = yield* Effect.forEach([schemaPath, userSchemaPath], (path) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem;
          return yield* written(recordedPath(path, root), yield* fs.readBytes(path));
        }),
      ).pipe(Effect.provide(NodeFileSystemLayer), Effect.orDie);
      return { kind, schemaPath, userSchemaPath, written: files };
    }).pipe(Effect.mapError(exposeMessage)),
  exits: { NoPhaxConfigError: 1 },
  errors: { NoPhaxConfigError: MessageFields },
  texts: { NoPhaxConfigError: (error) => error.message },
  render: (value) =>
    value.kind === "updated"
      ? `Updated ${value.schemaPath}\nUpdated ${value.userSchemaPath}`
      : `${value.schemaPath} is already up to date\n${value.userSchemaPath} is already up to date`,
});

export const schemaGroup = defineGroup({
  name: "schema",
  summary: "Manage the local phax.schema.json",
  commands: [schemaUpgradeCommand],
});
