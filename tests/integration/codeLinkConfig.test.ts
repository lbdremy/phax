/**
 * `phax validate` and the code link of a process repository (spec code-repository), through the
 * real command in temporary git repositories: a process repository with its code repository
 * checked out at `code/` and ignored. HOME is a temporary directory and git is isolated, so no
 * real ~/.phax, credential store or global git config is read.
 */
import { GIT_BOUND_MS, boundedOutput } from "../helpers/boundedSpawn.js";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isolateGit } from "../helpers/isolateGit.js";
import { phaxCall } from "../helpers/runnerCall.js";
import { removeTempDir } from "../helpers/tempGit.js";

function sh(args: readonly string[], cwd: string): void {
  boundedOutput("git", [...args], { cwd, boundMs: GIT_BOUND_MS });
}

const BASE_CONFIG = {
  version: 1,
  name: "process-repo",
  gateProfiles: { standard: [{ command: "pnpm test", surface: "local", firing: "every-phase" }] },
};

let base: string;
let processRepo: string;
let restoreGit: () => void;
let savedCwd: string;
let savedHome: string | undefined;

function writeConfig(extra: Record<string, unknown>, file = "phax.json"): void {
  const body = file === "phax.json" ? { ...BASE_CONFIG, ...extra } : extra;
  writeFileSync(join(processRepo, file), JSON.stringify(body, null, 2));
}

beforeEach(() => {
  restoreGit = isolateGit();
  savedCwd = process.cwd();
  savedHome = process.env["HOME"];
  base = realpathSync(mkdtempSync(join(tmpdir(), "phax-code-link-config-")));
  process.env["HOME"] = join(base, "home");
  mkdirSync(process.env["HOME"]);
  processRepo = join(base, "process");
  mkdirSync(join(processRepo, "code"), { recursive: true });
  sh(["init"], processRepo);
  sh(["init"], join(processRepo, "code"));
  writeFileSync(join(processRepo, ".gitignore"), "/code/\n");
  process.chdir(processRepo);
});

afterEach(() => {
  process.chdir(savedCwd);
  if (savedHome === undefined) delete process.env["HOME"];
  else process.env["HOME"] = savedHome;
  removeTempDir(base);
  restoreGit();
});

describe("phax validate with a code link", () => {
  it("accepts an ignored root that is a repository's top level (ac-link-accepted)", async () => {
    writeConfig({ code: { root: "code" } });
    const result = await phaxCall(["validate"]);
    expect(result.code).toBe(0);
    expect(result.out.startsWith("✓ config is valid")).toBe(true);
  });

  it("gives an unlinked project today's output", async () => {
    writeConfig({});
    const result = await phaxCall(["validate"]);
    expect(result.code).toBe(0);
    expect(result.outLines).toEqual([
      "✓ config is valid (project: process-repo)",
      `  home:    ${join(base, "home", ".phax")} (default)`,
      `  project: ${join(processRepo, "phax.json")}`,
      "  local:   (none)",
      "  global:  (none)",
    ]);
  });

  describe("a link declared where it is not accepted (ac-link-overlay-rejected)", () => {
    it("refuses code in phax.local.json, naming the file and the key", async () => {
      writeConfig({});
      writeConfig({ code: { root: "code" } }, "phax.local.json");
      const result = await phaxCall(["validate"]);
      expect(result.code).toBe(2);
      expect(result.err).toContain('"code" is accepted only in phax.json');
      expect(result.err).toContain("phax.local.json");
    });

    it.each([["../elsewhere"], ["/abs/code"]])("refuses code.root %s", async (root) => {
      writeConfig({ code: { root } });
      const result = await phaxCall(["validate"]);
      expect(result.code).toBe(2);
      expect(result.err).toContain(`code.root "${root}"`);
      expect(result.err).toContain("must be a relative path inside this repository");
      expect(result.err).toContain("phax.json");
    });

    it("refuses a root that is not in canonical form", async () => {
      writeConfig({ code: { root: "./code" } });
      const result = await phaxCall(["validate"]);
      expect(result.code).toBe(2);
      expect(result.err).toContain('code.root "./code": must be written code');
    });
  });

  describe("a root that is not a repository's top level (ac-root-not-repo)", () => {
    it("refuses a missing directory", async () => {
      writeConfig({ code: { root: "gone" } });
      writeFileSync(join(processRepo, ".gitignore"), "/gone/\n");
      const result = await phaxCall(["validate"]);
      expect(result.code).toBe(2);
      expect(result.err).toContain('code.root "gone": does not exist');
      expect(result.err).toContain(join(processRepo, "phax.json"));
    });

    it("refuses a plain directory", async () => {
      mkdirSync(join(processRepo, "plain"));
      writeFileSync(join(processRepo, ".gitignore"), "/plain/\n");
      writeConfig({ code: { root: "plain" } });
      const result = await phaxCall(["validate"]);
      expect(result.code).toBe(2);
      expect(result.err).toContain('code.root "plain": not the top level of a git repository');
    });

    it("refuses a subdirectory of another repository", async () => {
      mkdirSync(join(processRepo, "code", "sub"));
      writeConfig({ code: { root: "code/sub" } });
      const result = await phaxCall(["validate"]);
      expect(result.code).toBe(2);
      expect(result.err).toContain('code.root "code/sub": not the top level of a git repository');
    });
  });

  it("refuses a root the repository does not ignore, saying how to ignore it (ac-root-not-ignored)", async () => {
    writeFileSync(join(processRepo, ".gitignore"), "");
    writeConfig({ code: { root: "code" } });
    const result = await phaxCall(["validate"]);
    expect(result.code).toBe(2);
    expect(result.err).toContain('code.root "code"');
    expect(result.err).toContain("add /code/ to .gitignore");
  });

  it("refuses an ignored root the repository still tracks, saying how to untrack it", async () => {
    const code = join(processRepo, "code");
    writeFileSync(join(code, "a.ts"), "export {};\n");
    sh(["add", "a.ts"], code);
    sh(["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "c"], code);
    // A gitlink, as `git add code` records it, then the root ignored after the fact.
    sh(["add", "-f", "code"], processRepo);
    writeConfig({ code: { root: "code" } });
    const result = await phaxCall(["validate"]);
    expect(result.code).toBe(2);
    expect(result.err).toContain('code.root "code": tracked by this repository');
    expect(result.err).toContain("git rm -r --cached code");
  });

  it("checks the link of the phax.json found from a subdirectory, and names that file", async () => {
    writeConfig({});
    const sub = join(processRepo, "sub");
    mkdirSync(sub);
    writeFileSync(
      join(sub, "phax.json"),
      JSON.stringify({ ...BASE_CONFIG, code: { root: "gone" } }, null, 2),
    );
    process.chdir(sub);
    const result = await phaxCall(["validate"]);
    expect(result.code).toBe(2);
    expect(result.err).toContain('code.root "gone": does not exist');
    expect(result.err).toContain(join(sub, "phax.json"));
  });
});
