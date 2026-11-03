import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = new URL("..", import.meta.url).pathname;

interface Pkg {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as Pkg;

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name === "dist") return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });

const files = walk(root);

describe("the package", () => {
  it("is @steme-lab/cli-command 0.1.0", () => {
    expect(pkg.name).toBe("@steme-lab/cli-command");
    expect(pkg.version).toBe("0.1.0");
  });

  it("names no runner in any dependency field", () => {
    const names = [
      pkg.dependencies,
      pkg.devDependencies,
      pkg.peerDependencies,
      pkg.optionalDependencies,
    ].flatMap((field) => Object.keys(field ?? {}));
    expect(names).not.toContain("commander");
    expect(names).not.toContain("@steme-lab/cli-command-commander");
  });

  it("takes effect as a peer, not a dependency", () => {
    expect(pkg.peerDependencies).toHaveProperty("effect");
    expect(pkg.dependencies ?? {}).not.toHaveProperty("effect");
  });

  it("imports no runner from any source file", () => {
    const importing = files
      .filter((f) => f.endsWith(".ts") && !f.endsWith("package.test.ts"))
      .filter((f) =>
        /from\s+["'](commander|@steme-lab\/cli-command-commander)["']/.test(
          readFileSync(f, "utf8"),
        ),
      );
    expect(importing).toEqual([]);
  });

  it("keeps no hand-written declarations", () => {
    const declarations = files
      .filter((f) => f.endsWith(".d.ts"))
      .map((f) => f.slice(root.length));
    expect(declarations).toEqual([]);
  });

  it("keeps the suite free of node modules, a test runner and the process", () => {
    const suite = files.filter((f) =>
      f.startsWith(join(root, "src", "internal", "conformance") + "/"),
    );
    expect(suite.length).toBeGreaterThan(0);
    for (const file of suite) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/from\s+["']node:/);
      expect(source, file).not.toMatch(/from\s+["']vitest["']/);
      expect(source, file).not.toMatch(/\bprocess\b/);
    }
  });

  it("has no paths in any tsconfig", () => {
    const configs = files.filter((f) => /\/tsconfig[^/]*\.json$/.test(f));
    expect(configs.length).toBeGreaterThan(0);
    for (const config of configs) {
      const parsed = JSON.parse(readFileSync(config, "utf8")) as {
        compilerOptions?: { paths?: unknown };
      };
      expect(parsed.compilerOptions?.paths, config).toBeUndefined();
    }
  });
});
