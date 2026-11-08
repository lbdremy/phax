// `pnpm codemod:effect4` on a small temporary tree: `--check` reports and exits 1, a
// write run rewrites the files, and a second `--check` finds nothing left to change.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const tsx = join(repoRoot, "node_modules/.bin/tsx");
const main = join(repoRoot, "scripts/effect4-codemod/main.ts");

const settings = `import { Effect, Either } from "effect";

export const readPort = (text: string): Either.Either<number, string> =>
  Number.isInteger(Number(text)) ? Either.right(Number(text)) : Either.left(text);

export const settle = (effect: Effect.Effect<number, Error>) => Effect.either(effect);
`;

const settingsRewritten = `import { Effect, Result } from "effect";

export const readPort = (text: string): Result.Result<number, string> =>
  Number.isInteger(Number(text)) ? Result.succeed(Number(text)) : Result.fail(text);

export const settle = (effect: Effect.Effect<number, Error>) => Effect.result(effect);
`;

const issues = `import { ParseResult } from "effect";

export const format = ParseResult.TreeFormatter.formatErrorSync;
`;

/** A file under an excluded directory, which the codemod must never touch. */
const excluded = `import { Effect } from "effect";

export const settle = (effect: Effect.Effect<number>) => Effect.either(effect);
`;

let root = "";

function write(path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function codemod(...args: Array<string>): { status: number | null; stdout: string } {
  const run = spawnSync(tsx, [main, "--root", root, ...args], { cwd: repoRoot, encoding: "utf8" });
  return { status: run.status, stdout: run.stdout };
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "phax-effect4-cli-"));
  write("src/settings.ts", settings);
  write("tests/issues.ts", issues);
  write("src/dist/settings.ts", excluded);
  write("tests/e2e/fixtures/settings.ts", excluded);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("pnpm codemod:effect4", () => {
  it("--check reports what would change and exits 1, writing nothing", () => {
    const { status, stdout } = codemod("--check");
    expect(status).toBe(1);
    expect(stdout).toContain("1 files would change\n  src/settings.ts\n");
    expect(stdout).toContain("left to phases (1):\n");
    expect(stdout).toContain(
      "effect4-schema  tests/issues.ts:3  ParseResult.TreeFormatter -> SchemaIssue.defaultFormatter  v3-to-v4.md:13106\n",
    );
    expect(read("src/settings.ts")).toBe(settings);
  });

  it("a write run rewrites the files and prints the per-rule table", () => {
    const { status, stdout } = codemod();
    expect(status).toBe(0);
    expect(read("src/settings.ts")).toBe(settingsRewritten);
    expect(read("tests/issues.ts")).toBe(issues);
    expect(read("src/dist/settings.ts")).toBe(excluded);
    expect(read("tests/e2e/fixtures/settings.ts")).toBe(excluded);
    expect(stdout).toMatch(/^rule +files +rewrites +reference\n/);
    expect(stdout).toMatch(/\neither-to-result +1 +4 +v3-to-v4\.md:689,10395,/);
    expect(stdout).toMatch(/\neffect-either +1 +1 +v3-to-v4\.md:10057\n/);
    expect(stdout).toContain(
      "\n1 files changed\ntype errors   not measured (no tsconfig.json under the root)\nleft to phases (1):\n",
    );
  });

  it("a second --check finds nothing to change and exits 0", () => {
    const { status, stdout } = codemod("--check");
    expect(status).toBe(0);
    expect(stdout).toContain("0 files would change\n");
  });
});
