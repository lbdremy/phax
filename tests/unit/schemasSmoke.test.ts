// The pure pieces of scripts/schemas-smoke.ts. The smoke itself packs and
// installs from the registry, so it runs only in CI and the release workflow.
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CURRENT_SHAPES } from "../../packages/schemas/src/generated/index.js";
import { parsePhaseRecordManifest } from "../../packages/schemas/src/index.js";
import {
  CONSUMER_SCRIPT,
  SMOKE_RECORD_KEY,
  dependencyClosure,
  expectedConsumerOutput,
  smokeRecordManifest,
  strayPackages,
} from "../../scripts/schemas-smoke.js";
import { PHAX_RELEASE } from "../../src/schemas/release.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";
import { homePaths, strings } from "./schemasPackage/documents.js";

const repoRoot = join(import.meta.dirname, "../..");

describe("the smoke record manifest", () => {
  const manifest = smokeRecordManifest();

  it("is written as phax writes it: $schema first, at the running release, no version", () => {
    expect(Object.keys(manifest)[0]).toBe("$schema");
    expect(manifest.$schema).toBe(schemaUrl("phase-record-manifest", PHAX_RELEASE));
    expect(Object.hasOwn(manifest, "version")).toBe(false);
  });

  it("is read by the package at the current shape", () => {
    const parsed = parsePhaseRecordManifest(JSON.parse(JSON.stringify(manifest)));
    expect(parsed.ok && parsed.shape).toBe(CURRENT_SHAPES["phase-record-manifest"]);
  });

  it("is keyed <runId>/phase-01", () => {
    expect(SMOKE_RECORD_KEY).toBe(`${manifest.runId}/phase-01`);
    expect(manifest.phaseId).toBe("phase-01");
  });

  it("names no home directory and no phax home", () => {
    expect(strings(manifest).length).toBeGreaterThan(0);
    expect(homePaths(manifest)).toEqual([]);
  });

  it("makes the consumer print its runId, phaseId, outcome and provider", () => {
    expect(expectedConsumerOutput(manifest)).toBe(
      `${manifest.runId} phase-01 committed claude-code`,
    );
  });

  it("prints 'no usage' for a record without usage", () => {
    expect(expectedConsumerOutput({ ...manifest, usage: { available: false } })).toBe(
      `${manifest.runId} phase-01 committed no usage`,
    );
  });
});

describe("the consumer script", () => {
  it("imports only node:child_process and the schemas package", () => {
    const imports = [...CONSUMER_SCRIPT.matchAll(/^import .* from "([^"]+)";$/gm)].map(
      ([, from]) => from,
    );
    expect(imports).toEqual(["node:child_process", "@lbdremy/phax-schemas"]);
    expect(CONSUMER_SCRIPT).not.toMatch(/\brequire\(|\bimport\(/);
  });

  it("reads the record from the records branch and parses it as a phase record manifest", () => {
    expect(CONSUMER_SCRIPT).toContain("`phax/records/v1:${key}/record.json`");
    expect(CONSUMER_SCRIPT).toContain('execFileSync("git", ["show", ');
    expect(CONSUMER_SCRIPT).toContain("parsePhaseRecordManifest(JSON.parse(raw))");
    expect(CONSUMER_SCRIPT).toContain("if (!parsed.ok) {");
  });
});

describe("strayPackages", () => {
  const effectClosure = dependencyClosure(repoRoot, "effect");

  it("computes effect's closure from its installed manifests", () => {
    expect(effectClosure.has("effect")).toBe(true);
    expect(effectClosure.size).toBeGreaterThan(1);
  });

  it("passes the package, effect, effect's closure and npm's own entries", () => {
    const installed = [
      ".bin",
      ".package-lock.json",
      "@lbdremy/phax-schemas",
      "effect",
      ...effectClosure,
    ];
    expect(strayPackages(installed, effectClosure)).toEqual([]);
  });

  it("flags a foreign package, scoped or not", () => {
    const installed = ["@lbdremy/phax-schemas", ...effectClosure, "left-pad", "@acme/widget"];
    expect(strayPackages(installed, effectClosure)).toEqual(["left-pad", "@acme/widget"]);
  });

  it("does not let a scope stand for its packages", () => {
    expect(strayPackages(["@lbdremy/phax"], effectClosure)).toEqual(["@lbdremy/phax"]);
  });
});
