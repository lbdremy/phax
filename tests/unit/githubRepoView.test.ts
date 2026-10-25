import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { decodeGithubRepoView } from "../../src/schemas/githubRepoView.js";

describe("decodeGithubRepoView", () => {
  it("decodes an https url", () => {
    const decoded = decodeGithubRepoView({ url: "https://github.com/example/repo" });
    expect(Either.getOrNull(decoded)).toEqual({ url: "https://github.com/example/repo" });
  });

  it.each([
    ["a missing url", {}],
    ["an http:// url", { url: "http://github.com/example/repo" }],
    ["a url holding whitespace", { url: "https://github.com/example/my repo" }],
    ["a url ending in a newline", { url: "https://github.com/example/repo\n" }],
    ["an extra key", { url: "https://github.com/example/repo", name: "repo" }],
    ["a url that is not a string", { url: 42 }],
  ])("refuses %s", (_label, answer) => {
    expect(Either.isLeft(decodeGithubRepoView(answer))).toBe(true);
  });
});
