import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseAllDocuments } from "yaml";

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The object under `key`, or an empty one. */
function section(value: unknown, key: string): Json {
  const found = isRecord(value) ? value[key] : undefined;
  return isRecord(found) ? found : {};
}

function readJson(name: string): Json {
  const parsed: unknown = JSON.parse(readFileSync(join(REPO_ROOT, name), "utf8"));
  return isRecord(parsed) ? parsed : {};
}

const denoJson = readJson("deno.json");
const denoLock = readJson("deno.lock");

// pnpm-lock.yaml may hold several documents (an env lockfile first); gather every `packages` key.
const pnpmPackages = new Set<string>();
for (const doc of parseAllDocuments(readFileSync(join(REPO_ROOT, "pnpm-lock.yaml"), "utf8"))) {
  for (const key of Object.keys(section(doc.toJS(), "packages"))) pnpmPackages.add(key);
}
const denoNpm = new Set(Object.keys(section(denoLock, "npm")));

const grants = section(denoJson, "allowScripts")["allow"];
const allowed: string[] = Array.isArray(grants)
  ? grants.filter((entry): entry is string => typeof entry === "string")
  : [];

describe("deno.json", () => {
  it("lets pnpm own node_modules", () => {
    expect(denoJson["nodeModulesDir"]).toBe("manual");
  });

  it("freezes deno.lock", () => {
    expect(section(denoJson, "lock")["frozen"]).toBe(true);
  });

  it("keeps node_modules out of the compiled binary", () => {
    expect(section(denoJson, "compile")["exclude"]).toContain("node_modules");
  });

  it.each([
    "npm:esbuild@0.21.5",
    "npm:esbuild@0.28.1",
    "npm:@parcel/watcher@2.5.6",
    "npm:msgpackr-extract@3.0.4",
  ])("does not grant scripts to the stale %s", (entry) => {
    expect(allowed).not.toContain(entry);
  });

  it("grants scripts only to versions a lockfile pins", () => {
    for (const entry of allowed) {
      const match = /^npm:(.+@[^@]+)$/.exec(entry);
      expect(match, `${entry} is not npm:<name>@<version>`).not.toBeNull();
      const key = match?.[1] ?? "";
      expect(
        pnpmPackages.has(key) || denoNpm.has(key),
        `${entry} is in neither pnpm-lock.yaml nor deno.lock`,
      ).toBe(true);
    }
  });
});
