import { Schema } from "effect";

/**
 * `gh pr view <url> --json state`'s answer: an object with exactly one `state` field, one of the
 * three states GitHub gives a pull request.
 */
export const GithubPrViewSchema = Schema.Struct({
  state: Schema.Literals(["OPEN", "MERGED", "CLOSED"]),
});

export type GithubPrView = Schema.Schema.Type<typeof GithubPrViewSchema>;

export const decodeGithubPrView = Schema.decodeUnknownResult(GithubPrViewSchema, {
  onExcessProperty: "error",
  reportInput: true,
});
