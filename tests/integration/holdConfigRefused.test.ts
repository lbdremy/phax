/**
 * A hold comes only from `phax run --hold`: no configuration layer carries one.
 * The existing unknown-key refusal already exits 2; this pins it, and no schema
 * changes for it. Real config loading in a temporary repository, with the home
 * directory replaced so ~/.phax is never read.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runValidate } from "../../src/cli/commands/validate.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

const home = vi.hoisted(() => ({ dir: "" }));

vi.mock("node:os", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:os")>()),
  homedir: () => home.dir,
}));

const PHAX_JSON = {
  version: 1,
  name: "invoice-export",
  gateProfiles: {
    standard: [{ command: "true", surface: "local", firing: "every-phase", output: "log" }],
  },
};

let repo: string;
let root: string;

function validate() {
  const errors: string[] = [];
  const out = { log: () => undefined, warn: () => undefined, error: (m: string) => errors.push(m) };
  return runValidate({}, out).then((code) => ({ code, errors }));
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "phax-hold-config-")));
  repo = join(root, "repo");
  home.dir = join(root, "home");
  mkdirSync(repo);
  mkdirSync(join(home.dir, ".phax"), { recursive: true });
  execFileSync("git", ["init", "--quiet"], { cwd: repo });
  disableGitAutoMaintenance(repo);
  vi.spyOn(process, "cwd").mockReturnValue(repo);
});

afterEach(() => {
  vi.restoreAllMocks();
  removeTempDir(root);
});

describe("a hold in configuration", () => {
  it("accepts the project config without one (control)", async () => {
    writeFileSync(join(repo, "phax.json"), JSON.stringify(PHAX_JSON));
    expect((await validate()).code).toBe(0);
  });

  it("is refused in phax.json with exit 2, naming the unknown key", async () => {
    writeFileSync(
      join(repo, "phax.json"),
      JSON.stringify({ ...PHAX_JSON, review: { holdPhases: true } }),
    );
    const { code, errors } = await validate();
    expect(code).toBe(2);
    expect(errors.join("\n")).toContain("holdPhases");
  });

  it("is refused in the home config with exit 2, naming the unknown key", async () => {
    writeFileSync(join(repo, "phax.json"), JSON.stringify(PHAX_JSON));
    writeFileSync(join(home.dir, ".phax", "config.json"), JSON.stringify({ hold: true }));
    const { code, errors } = await validate();
    expect(code).toBe(2);
    expect(errors.join("\n")).toContain("hold");
  });
});
