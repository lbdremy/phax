// The test ratchet refuses a recorded test file that marks more tests `.fails` than its
// copy at HEAD: vitest reports such a test as passed when its body throws, so a recorded
// test turned into `it.fails` would otherwise keep passing while it no longer holds.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { failsMarkersAdded } from "../../scripts/effect4-codemod/passingTests.js";
import { isolateGit } from "../helpers/isolateGit.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

let restoreGit: () => void;
let root: string;

function git(...args: ReadonlyArray<string>): void {
  execFileSync(
    "git",
    ["-c", "user.name=Ratchet Test", "-c", "user.email=ratchet@example.test", ...args],
    {
      cwd: root,
      stdio: "pipe",
    },
  );
}

function write(file: string, text: string): void {
  mkdirSync(join(root, file, ".."), { recursive: true });
  writeFileSync(join(root, file), text);
}

const RECORD = { "tests/a.test.ts": ["adds"], "tests/b.test.ts": ["subtracts"] };

beforeEach(() => {
  restoreGit = isolateGit();
  root = mkdtempSync(join(tmpdir(), "phax-fails-markers-"));
  git("init", "--quiet", "--initial-branch=main");
  disableGitAutoMaintenance(root);
  write("tests/a.test.ts", 'it("adds", () => expect(1 + 1).toBe(2));\n');
  write(
    "tests/b.test.ts",
    'it.fails("is pending", () => expect(1).toBe(2));\nit("subtracts", () => {});\n',
  );
  git("add", ".");
  git("commit", "--quiet", "-m", "base");
});

afterEach(() => {
  removeTempDir(root);
  restoreGit();
});

describe("failsMarkersAdded", () => {
  it("names nothing when the working tree matches HEAD", () => {
    expect(failsMarkersAdded(root, RECORD)).toEqual([]);
  });

  it("names a recorded file whose test was turned into it.fails", () => {
    write("tests/a.test.ts", 'it.fails("adds", () => expect(1 + 1).toBe(3));\n');
    expect(failsMarkersAdded(root, RECORD)).toEqual(["tests/a.test.ts"]);
  });

  it("counts a chained modifier and leaves a file that kept its count", () => {
    write(
      "tests/b.test.ts",
      'it.fails("is pending", () => expect(1).toBe(2));\ntest.concurrent.fails("subtracts", () => {});\n',
    );
    expect(failsMarkersAdded(root, RECORD)).toEqual(["tests/b.test.ts"]);
  });

  it("ignores a file the record does not hold", () => {
    write("tests/c.test.ts", 'it.fails("new", () => expect(1).toBe(2));\n');
    expect(failsMarkersAdded(root, RECORD)).toEqual([]);
  });
});
