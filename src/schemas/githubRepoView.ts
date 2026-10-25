import { Schema } from "effect";

// An https:// URL holding no whitespace: the web URL a host reports for a
// repository, as phax links to it.
const RepoWebUrlSchema = Schema.String.pipe(
  Schema.pattern(/^https:\/\/\S+$/, {
    message: () => "url must be an https:// URL with no whitespace",
  }),
);

/** `gh repo view --json url`'s answer: an object with exactly one `url` field. */
export const GithubRepoViewSchema = Schema.Struct({ url: RepoWebUrlSchema });

export type GithubRepoView = Schema.Schema.Type<typeof GithubRepoViewSchema>;

export const decodeGithubRepoView = Schema.decodeUnknownEither(GithubRepoViewSchema, {
  onExcessProperty: "error",
});
