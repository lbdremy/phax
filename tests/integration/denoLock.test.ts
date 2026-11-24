import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { phaxHomeEnv } from "../helpers/isolatePhaxHome.js";
import { boundedSpawn, CLI_BOUND_MS } from "../helpers/boundedSpawn.js";

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");

const BUILD_ARGS = [
  "run",
  "--allow-read",
  "--allow-write",
  "--allow-run",
  "--allow-env",
  "scripts/build-binaries.ts",
];
const SMOKE_ARGS = [
  "run",
  "--sloppy-imports",
  "--allow-read",
  "--allow-env",
  "--allow-sys",
  "--allow-run",
  "src/cli/main.ts",
  "--version",
];

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

const dirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const pkgJson: unknown = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
const pkg = {
  version: String(field(pkgJson, "version")),
  scripts: field(pkgJson, "scripts"),
};

// No Deno cache of the user's and no registry: a mistake fails instead of reaching npm.
function denoEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DENO_DIR: tempDir("phax-deno-dir-"),
    NO_COLOR: "1",
    NPM_CONFIG_REGISTRY: "http://127.0.0.1:9/",
  };
}

// Every name@version of node_modules' top-level and scoped packages, the .pnpm entries, .deno.
function fingerprint(): unknown {
  const root = join(REPO_ROOT, "node_modules");
  const versions: string[] = [];
  const read = (dir: string, name: string): void => {
    try {
      const json: unknown = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      versions.push(`${name}@${String(field(json, "version"))}`);
    } catch {
      versions.push(`${name}@unreadable`);
    }
  };
  for (const entry of readdirSync(root)) {
    if (entry.startsWith(".")) continue;
    if (entry.startsWith("@")) {
      for (const sub of readdirSync(join(root, entry))) {
        read(join(root, entry, sub), `${entry}/${sub}`);
      }
    } else {
      read(join(root, entry), entry);
    }
  }
  return {
    versions: versions.toSorted(),
    pnpm: readdirSync(join(root, ".pnpm")).toSorted(),
    deno: existsSync(join(root, ".deno")),
  };
}

describe("deno commands", () => {
  it("the build script runs deno with the arguments this test uses", () => {
    expect(field(pkg.scripts, "deno:build-binaries")).toBe(["deno", ...BUILD_ARGS].join(" "));
  });

  it("the smoke script runs deno with the arguments this test uses", () => {
    expect(field(pkg.scripts, "deno:smoke")).toBe(["deno", ...SMOKE_ARGS].join(" "));
  });

  it("a deno.lock lacking a declared dependency stops the build and stays unchanged", () => {
    const scratch = tempDir("phax-deno-lock-");
    mkdirSync(join(scratch, "scripts"));
    copyFileSync(join(REPO_ROOT, "package.json"), join(scratch, "package.json"));
    copyFileSync(join(REPO_ROOT, "deno.json"), join(scratch, "deno.json"));
    copyFileSync(
      join(REPO_ROOT, "scripts", "build-binaries.ts"),
      join(scratch, "scripts", "build-binaries.ts"),
    );
    // Drop the first package.json dependency line, keeping the lock's own formatting.
    const lines = readFileSync(join(REPO_ROOT, "deno.lock"), "utf8").split("\n");
    const at = lines.findIndex((line) => line.includes('"packageJson"'));
    expect(at).toBeGreaterThan(-1);
    expect(lines[at + 1]).toContain('"dependencies"');
    lines.splice(at + 2, 1);
    const written = lines.join("\n");
    writeFileSync(join(scratch, "deno.lock"), written);

    // CLI_BOUND_MS: a cold Deno start under a loaded gate.
    const result = boundedSpawn("deno", BUILD_ARGS, {
      boundMs: CLI_BOUND_MS,
      cwd: scratch,
      env: denoEnv(),
    });

    expect(result.status).not.toBe(0);
    const output = `${result.stdout}${result.stderr}`;
    expect(output).toContain("The lockfile is out of date");
    expect(readFileSync(join(scratch, "deno.lock"), "utf8")).toBe(written);
  });

  it("deno:smoke prints the version and leaves node_modules as pnpm installed it", () => {
    const before = fingerprint();

    // CLI_BOUND_MS: a cold Deno transpile of the CLI under a loaded gate.
    const result = boundedSpawn("deno", SMOKE_ARGS, {
      boundMs: CLI_BOUND_MS,
      cwd: REPO_ROOT,
      env: { ...denoEnv(), ...phaxHomeEnv() },
    });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(pkg.version);
    expect(fingerprint()).toEqual(before);
  });
});
