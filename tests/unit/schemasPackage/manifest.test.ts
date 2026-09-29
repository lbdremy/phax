import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(repoRoot, path), "utf8")) as Record<string, unknown>;
}

const root = readJson("package.json");
const pkg = readJson("packages/schemas/package.json");
const rootDependencies = root["dependencies"] as Record<string, string>;

describe("schemas package manifest", () => {
  it("is named @lbdremy/phax-schemas", () => {
    expect(pkg["name"]).toBe("@lbdremy/phax-schemas");
  });

  it("carries the root package version", () => {
    expect(pkg["version"]).toBe(root["version"]);
  });

  it("depends on exactly effect, at the root range", () => {
    expect(pkg["dependencies"]).toEqual({ effect: rootDependencies["effect"] });
  });

  it("declares no scripts, devDependencies or peerDependencies", () => {
    expect(pkg).not.toHaveProperty("scripts");
    expect(pkg).not.toHaveProperty("devDependencies");
    expect(pkg).not.toHaveProperty("peerDependencies");
  });

  it("exports the entry, as types and default from the tsc output, and the JSON Schemas", () => {
    expect(pkg["exports"]).toEqual({
      ".": {
        types: "./dist/packages/schemas/src/index.d.ts",
        default: "./dist/packages/schemas/src/index.js",
      },
      "./json/*": "./json/*",
    });
  });

  it("publishes only dist and json", () => {
    expect(pkg["files"]).toEqual(["dist", "json"]);
  });

  it("builds json after the package's tsc output, in the root build script", () => {
    const scripts = root["scripts"] as Record<string, string>;
    expect(scripts["build"]).toBe(
      "tsc -p tsconfig.build.json && tsc -p packages/schemas/tsconfig.build.json && tsx scripts/schemas-json.ts",
    );
  });

  it("never commits the built json", () => {
    const ignored = readFileSync(join(repoRoot, ".gitignore"), "utf8").split("\n");
    expect(ignored).toContain("packages/schemas/json/");
  });

  it("is an ESM package for Node 20 and later, under Apache-2.0", () => {
    expect(pkg["type"]).toBe("module");
    expect(pkg["engines"]).toEqual({ node: ">=20" });
    expect(pkg["license"]).toBe("Apache-2.0");
  });

  it("stays outside the pnpm workspace", () => {
    const workspace = readFileSync(join(repoRoot, "pnpm-workspace.yaml"), "utf8");
    expect(workspace).not.toContain("packages/");
  });
});
