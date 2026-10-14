import { Schema } from "effect";

/** A machine's grant: a kebab-case slug, as `--by machine:<grant>` takes it. */
export const GRANT_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Who gave an approval: a machine and its grant, the operator by their git
 * `user.name`, or no one recorded — an approval written before phax named its
 * approver. Every key is required; the kinds are the whole set.
 */
export const ApprovedBySchema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("machine"),
    grant: Schema.String.pipe(
      Schema.pattern(GRANT_PATTERN),
      Schema.annotations({
        description: "The grant the machine declared with `--by machine:<grant>`.",
      }),
    ),
  }),
  Schema.Struct({
    kind: Schema.Literal("operator"),
    name: Schema.NonEmptyString.annotations({
      description: "The operator's git user.name when they approved.",
    }),
  }),
  Schema.Struct({ kind: Schema.Literal("unattributed") }),
);

export type ApprovedBy = Schema.Schema.Type<typeof ApprovedBySchema>;
