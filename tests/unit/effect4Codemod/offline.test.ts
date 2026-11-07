// phax's Effect 4 codemod runs offline: it loads only node builtins, ts-morph pinned
// exactly and fixed by the lockfile, and its own modules, and every package it runs on
// is a devDependency.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ts } from "ts-morph";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const codemodDirectory = "scripts/effect4-codemod";

function readRepoFile(path: string): string {
  return readFileSync(`${repoRoot}${path}`, "utf8");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** package.json's devDependencies, narrowed by hand. */
function devDependencies(): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readRepoFile("package.json"));
  if (!isRecord(parsed)) throw new Error("package.json is not an object");
  const dev = parsed["devDependencies"];
  if (!isRecord(dev)) throw new Error("package.json has no devDependencies object");
  return dev;
}

/** Every module specifier a file imports or re-exports, statically or dynamically. */
function specifiersOf(text: string): Array<string> {
  return ts.preProcessFile(text, true, true).importedFiles.map((file) => file.fileName);
}

describe("effect4 codemod offline", () => {
  it("pins ts-morph exactly at 28.0.0 in devDependencies", () => {
    expect(devDependencies()["ts-morph"]).toBe("28.0.0");
  });

  it("fixes ts-morph 28.0.0 in pnpm-lock.yaml", () => {
    const lock = readRepoFile("pnpm-lock.yaml");
    expect(lock).toMatch(/\n {6}ts-morph:\n {8}specifier: 28\.0\.0\n {8}version: 28\.0\.0\n/);
    expect(lock).toContain("\n  ts-morph@28.0.0:\n");
  });

  it("runs on tsx and typescript from devDependencies", () => {
    const dev = devDependencies();
    expect(typeof dev["tsx"]).toBe("string");
    expect(typeof dev["typescript"]).toBe("string");
  });

  it("imports only node builtins, ts-morph and its own modules", () => {
    const files = readdirSync(`${repoRoot}${codemodDirectory}`).filter((name) =>
      name.endsWith(".ts"),
    );
    expect(files.length).toBeGreaterThan(0);
    const foreign = files.flatMap((name) =>
      specifiersOf(readRepoFile(`${codemodDirectory}/${name}`))
        .filter(
          (specifier) =>
            !specifier.startsWith("node:") &&
            specifier !== "ts-morph" &&
            !specifier.startsWith("./"),
        )
        .map((specifier) => `${name}: ${specifier}`),
    );
    expect(foreign).toEqual([]);
  });
});
