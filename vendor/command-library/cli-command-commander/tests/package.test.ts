import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = new URL("..", import.meta.url).pathname;

interface Pkg {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  nx?: {
    targets?: Record<string, { inputs?: string[] } | undefined>;
  };
}

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as Pkg;

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name === "dist") return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });

const sample =
  "{workspaceRoot}/libraries/typescript/cli-command/rename-todo.command.ts";

describe("the package", () => {
  it("is @steme-lab/cli-command-commander 0.1.0", () => {
    expect(pkg.name).toBe("@steme-lab/cli-command-commander");
    expect(pkg.version).toBe("0.1.0");
  });

  it("depends on commander, and takes effect and the contract as peers", () => {
    expect(pkg.dependencies).toHaveProperty("commander");
    expect(pkg.peerDependencies).toHaveProperty("effect");
    expect(pkg.peerDependencies).toHaveProperty("@steme-lab/cli-command");
    expect(pkg.dependencies ?? {}).not.toHaveProperty("effect");
  });

  it("imports commander from src/adapters only", () => {
    const importing = walk(join(root, "src"))
      .filter((f) => f.endsWith(".ts"))
      .filter((f) => /from\s+["']commander["']/.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(join(root, "src").length + 1));
    expect(importing).toEqual(["adapters/commander.ts"]);
  });

  it("holds no hand-written declarations", () => {
    expect(existsSync(join(root, "index.d.ts"))).toBe(false);
    const declarations = walk(join(root, "src")).filter((f) =>
      f.endsWith(".d.ts"),
    );
    expect(declarations).toEqual([]);
  });

  it("has no paths in any tsconfig", () => {
    const configs = readdirSync(root).filter((f) =>
      /^tsconfig.*\.json$/.test(f),
    );
    expect(configs.length).toBeGreaterThan(0);
    for (const config of configs) {
      expect(readFileSync(join(root, config), "utf8"), config).not.toMatch(
        /"paths"/,
      );
    }
  });

  it("reads the process in src/adapters/process-io.ts only", () => {
    const naming = walk(join(root, "src"))
      .filter((f) => f.endsWith(".ts"))
      .filter((f) => {
        const code = readFileSync(f, "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/^\s*\/\/.*$/gm, "")
          .replace(/"[^"\n]*"/g, '""');
        return /\bprocess\b/.test(code);
      })
      .map((f) => f.slice(join(root, "src").length + 1));
    expect(naming).toEqual(["adapters/process-io.ts"]);
  });

  it("names the contract's sample among the inputs of its test and typecheck targets", () => {
    for (const target of ["test", "typecheck"]) {
      const inputs = pkg.nx?.targets?.[target]?.inputs ?? [];
      expect(inputs, target).toContain(sample);
      expect(inputs, target).toContain("default");
      expect(inputs, target).toContain("^default");
    }
  });
});
