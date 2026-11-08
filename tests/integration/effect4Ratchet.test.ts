// The ratchet against a temporary git repository: its base is the counts file at HEAD,
// whatever the working tree says.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RATCHET_FILE, runRatchet } from "../../scripts/effect4-codemod/ratchet.js";

let root = "";

function git(...args: Array<string>): void {
  const run = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  if (run.status !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr}`);
}

function writeText(text: string): void {
  mkdirSync(dirname(join(root, RATCHET_FILE)), { recursive: true });
  writeFileSync(join(root, RATCHET_FILE), text);
}

function writeCounts(src: number, tests: number): void {
  writeText(`{\n  "src": ${src},\n  "tests": ${tests}\n}\n`);
}

function commitAll(): void {
  git("add", "-A");
  git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "base");
}

function ratchet(src: number, tests: number): { status: number; output: string } {
  let output = "";
  const status = runRatchet(root, {
    measure: () => ({ src, tests }),
    write: (text) => {
      output += text;
    },
  });
  return { status, output };
}

function counts(): string {
  return readFileSync(join(root, RATCHET_FILE), "utf8");
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "phax-effect4-ratchet-"));
  git("init", "-q");
  writeFileSync(join(root, "README.md"), "x\n");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("runRatchet", () => {
  it("records the first counts and passes when HEAD has no counts file", () => {
    commitAll();
    const { status, output } = ratchet(140, 12);
    expect(status).toBe(0);
    expect(output).toContain("recorded the first counts");
    expect(counts()).toBe('{\n  "src": 140,\n  "tests": 12\n}\n');
  });

  it("records the first counts when the repository has no commit yet", () => {
    expect(ratchet(5, 6).status).toBe(0);
    expect(counts()).toBe('{\n  "src": 5,\n  "tests": 6\n}\n');
  });

  it("passes at the base and writes the measured counts", () => {
    writeCounts(10, 20);
    commitAll();
    expect(ratchet(10, 20).status).toBe(0);
    expect(counts()).toBe('{\n  "src": 10,\n  "tests": 20\n}\n');
  });

  it("passes under the base and lowers the recorded counts", () => {
    writeCounts(10, 20);
    commitAll();
    const { status, output } = ratchet(4, 20);
    expect(status).toBe(0);
    expect(output).toContain("passed");
    expect(counts()).toBe('{\n  "src": 4,\n  "tests": 20\n}\n');
  });

  it.each([
    ["src", 11, 20],
    ["tests", 10, 21],
  ])("fails above the base on %s and writes nothing", (name, src, tests) => {
    writeCounts(10, 20);
    commitAll();
    const { status, output } = ratchet(src, tests);
    expect(status).toBe(1);
    expect(output).toContain(`failed, ${name} above the base`);
    expect(counts()).toBe('{\n  "src": 10,\n  "tests": 20\n}\n');
  });

  it("still compares against HEAD after the working-tree file is raised", () => {
    writeCounts(10, 20);
    commitAll();
    writeCounts(500, 500);
    expect(ratchet(11, 20).status).toBe(1);
    expect(counts()).toBe('{\n  "src": 500,\n  "tests": 500\n}\n');
  });

  it("still compares against HEAD after the working-tree file is deleted", () => {
    writeCounts(10, 20);
    commitAll();
    rmSync(join(root, RATCHET_FILE));
    expect(ratchet(11, 20).status).toBe(1);
    expect(existsSync(join(root, RATCHET_FILE))).toBe(false);
  });

  it("does not take a working-tree file that HEAD lacks as a base", () => {
    commitAll();
    writeCounts(1, 1);
    expect(ratchet(50, 50).status).toBe(0);
    expect(counts()).toBe('{\n  "src": 50,\n  "tests": 50\n}\n');
  });

  it("fails on a malformed counts file at HEAD without measuring or writing", () => {
    writeText('{ "src": "many" }\n');
    commitAll();
    writeCounts(0, 0);
    let measured = false;
    let output = "";
    const status = runRatchet(root, {
      measure: () => {
        measured = true;
        return { src: 0, tests: 0 };
      },
      write: (text) => {
        output += text;
      },
    });
    expect(status).toBe(1);
    expect(measured).toBe(false);
    expect(output).toContain("is not");
    expect(counts()).toBe('{\n  "src": 0,\n  "tests": 0\n}\n');
  });

  it("fails outside a git repository", () => {
    const bare = mkdtempSync(join(tmpdir(), "phax-effect4-nogit-"));
    try {
      const status = runRatchet(bare, { measure: () => ({ src: 0, tests: 0 }), write: () => {} });
      expect(status).toBe(1);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });
});
