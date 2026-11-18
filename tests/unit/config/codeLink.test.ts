import { describe, expect, it } from "vitest";
import {
  CODE_ROOT_MISSING,
  CODE_ROOT_NOT_TOP_LEVEL,
  codeRootMessage,
  codeRootNotIgnored,
  codeRootProblem,
  codeRootTracked,
  phaxConfigCandidates,
} from "../../../src/domain/config/codeLink.js";

const INSIDE = "must be a relative path inside this repository";

describe("codeRootProblem", () => {
  it.each([
    ["code", null],
    ["deps/code", null],
    ["/abs", INSIDE],
    ["../elsewhere", INSIDE],
    ["code/..", INSIDE],
    ["./code", "must be written code"],
    ["code/", "must be written code"],
    ["a//b", "must be written a/b"],
    [".", INSIDE],
    ["a\\b", "must be written a/b"],
    ["", INSIDE],
  ])("reads %j as %j", (root, problem) => {
    expect(codeRootProblem(root)).toBe(problem);
  });
});

describe("the refusal sentences", () => {
  it("names the field and the root before the reason", () => {
    expect(codeRootMessage("code", CODE_ROOT_MISSING)).toBe('code.root "code": does not exist');
    expect(codeRootMessage("code", CODE_ROOT_NOT_TOP_LEVEL)).toBe(
      'code.root "code": not the top level of a git repository',
    );
    expect(codeRootNotIgnored("code")).toBe(
      "not ignored by this repository — add /code/ to .gitignore",
    );
    expect(codeRootTracked("code")).toBe(
      "tracked by this repository although ignored — untrack it with git rm -r --cached code",
    );
  });
});

describe("phaxConfigCandidates", () => {
  it("lists phax.json from the start directory up to the root, nearest first", () => {
    expect(phaxConfigCandidates("/r/a/b", "/r")).toEqual([
      "/r/a/b/phax.json",
      "/r/a/phax.json",
      "/r/phax.json",
    ]);
  });

  it("is the root's phax.json alone when it starts at the root", () => {
    expect(phaxConfigCandidates("/r", "/r")).toEqual(["/r/phax.json"]);
  });
});
