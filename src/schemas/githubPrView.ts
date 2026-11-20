import { Schema } from "effect";

/**
 * `gh pr view <url> --json state`'s answer: an object with exactly one `state` field, one of the
 * three states GitHub gives a pull request.
 */
const GithubPrViewSchema = Schema.Struct({
  state: Schema.Literals(["OPEN", "MERGED", "CLOSED"]),
});

export const decodeGithubPrView = Schema.decodeUnknownResult(GithubPrViewSchema, {
  onExcessProperty: "error",
  reportInput: true,
});
