import { describe, expect, it } from "vitest";
import { parseGitmodulesPaths } from "../../../src/domain/config/gitmodules.js";

describe("parseGitmodulesPaths", () => {
  it("reads the path line of every submodule, in file order", () => {
    const text = [
      '[submodule "lint-rules"]',
      "\tpath = vendor/lint-rules",
      "\turl = https://example.test/lint-rules.git",
      '[submodule "docs"]',
      "\tpath = site/docs",
      "\turl = https://example.test/docs.git",
      "",
    ].join("\n");
    expect(parseGitmodulesPaths(text)).toEqual(["vendor/lint-rules", "site/docs"]);
  });

  it("trims whitespace, drops surrounding double quotes and trailing slashes", () => {
    const text = [
      '[submodule "a"]',
      '  path   =   "with space/dir//"  ',
      '[submodule "b"]',
      "path=plain/",
      "",
    ].join("\n");
    expect(parseGitmodulesPaths(text)).toEqual(["with space/dir", "plain"]);
  });

  it("ignores comments and every other key", () => {
    const text = [
      "# path = commented/out",
      "; path = also/commented",
      '[submodule "a"]',
      "\turl = https://example.test/path = trick.git",
      "\tbranch = main",
      "\tpathspec = not/a/path",
      "\tpath = kept",
      "",
    ].join("\n");
    expect(parseGitmodulesPaths(text)).toEqual(["kept"]);
  });

  it("reads CRLF line endings", () => {
    expect(parseGitmodulesPaths('[submodule "a"]\r\n\tpath = one\r\n\tpath = two\r\n')).toEqual([
      "one",
      "two",
    ]);
  });

  it("gives none for a file with no path line", () => {
    expect(parseGitmodulesPaths("")).toEqual([]);
    expect(parseGitmodulesPaths('[submodule "a"]\n\turl = https://example.test/a.git\n')).toEqual(
      [],
    );
  });
});
