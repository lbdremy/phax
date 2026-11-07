import { Schema } from "effect";

/** A branch name: not empty, and no whitespace. */
export const BranchName = Schema.String.check(Schema.makeFilter((name) => name.length > 0 && !/\s/.test(name)));

/** A TCP port. */
export const Port = Schema.Number.check(
  Schema.makeFilter((port) => Number.isInteger(port) && port > 0 && port < 65536),
);

export const Remote = Schema.Struct({
  host: Schema.String.check(Schema.makeFilter((host) => host.length > 0)),
  port: Port,
});
