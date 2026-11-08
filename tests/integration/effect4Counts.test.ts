// The type-error counts read the installed tsc's real output: a temporary project with one
// known error in src and one in tests counts { src: 1, tests: 1 }, and a tsc that exits
// non-zero without a diagnostic phax can count is an error, never zero errors.
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { measureCounts, spawnRunner } from "../../scripts/effect4-codemod/counts.js";
import { removeTempDir } from "../helpers/tempGit.js";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) removeTempDir(root);
});

function project(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), "phax-effect4-counts-"));
  roots.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  // The installed compiler itself, not pnpm's `.bin` shim, which resolves its package
  // relative to the repository it was installed in.
  mkdirSync(join(root, "node_modules/.bin"), { recursive: true });
  symlinkSync(
    realpathSync(join(repoRoot, "node_modules/typescript")),
    join(root, "node_modules/typescript"),
  );
  symlinkSync("../typescript/bin/tsc", join(root, "node_modules/.bin/tsc"));
  return root;
}

const options = { strict: true, noEmit: true, skipLibCheck: true, types: [] };

describe("effect4 type-error counts against the installed tsc", () => {
  it("counts one error in src and one in tests", () => {
    const root = project({
      "tsconfig.json": JSON.stringify({ compilerOptions: options, include: ["src/**/*"] }),
      "tsconfig.test.json": JSON.stringify({
        compilerOptions: options,
        include: ["src/**/*", "tests/**/*"],
      }),
      "src/a.ts": "export const a: number = 'not a number';\n",
      "tests/b.ts": "export const b: string = 42;\n",
    });

    expect(measureCounts(root)).toEqual({ src: 1, tests: 1 });
  }, 120_000);

  it("refuses a non-zero exit that printed no diagnostic it can count", () => {
    const root = project({ "fail.sh": "#!/bin/sh\necho 'panic: something broke'\nexit 2\n" });
    const script = join(root, "fail.sh");
    expect(() => spawnRunner("/bin/sh", [script], root)).toThrow(/no diagnostic phax can count/);
  });
});
