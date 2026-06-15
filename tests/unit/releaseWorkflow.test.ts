import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { versionFromTag } from "../../scripts/prepare-npm.ts";

const workflowPath = join(import.meta.dirname, "../../.github/workflows/release.yml");
const workflow = readFileSync(workflowPath, "utf-8");

describe("release workflow invariants", () => {
  it("triggers on v* tags", () => {
    expect(workflow).toContain("tags:");
    expect(workflow).toContain('"v*"');
  });

  it("includes a Deno setup step", () => {
    expect(workflow).toContain("denoland/setup-deno");
  });

  it("builds release binaries", () => {
    expect(workflow).toContain("pnpm deno:build-binaries");
  });

  it("generates checksums (uploads .sha256 files)", () => {
    expect(workflow).toContain(".sha256");
  });

  it("uploads artifacts to GitHub Release", () => {
    expect(workflow).toContain("softprops/action-gh-release");
  });

  it("runs npm publish --dry-run", () => {
    expect(workflow).toContain("npm publish --dry-run");
  });

  it("uses GITHUB_TOKEN only (no NPM_TOKEN)", () => {
    expect(workflow).toContain("GITHUB_TOKEN");
    expect(workflow).not.toContain("NPM_TOKEN");
  });
});

describe("versionFromTag", () => {
  it("strips the leading v from a semver tag", () => {
    expect(versionFromTag("v1.2.3")).toBe("1.2.3");
  });

  it("handles patch version zero", () => {
    expect(versionFromTag("v0.1.0")).toBe("0.1.0");
  });

  it("handles multi-digit segments", () => {
    expect(versionFromTag("v10.20.30")).toBe("10.20.30");
  });

  it("throws for missing v prefix", () => {
    expect(() => versionFromTag("1.2.3")).toThrow("Malformed tag");
  });

  it("throws for a two-part version", () => {
    expect(() => versionFromTag("v1.2")).toThrow("Malformed tag");
  });

  it("throws for a non-numeric segment", () => {
    expect(() => versionFromTag("v1.2.x")).toThrow("Malformed tag");
  });

  it("throws for an empty string", () => {
    expect(() => versionFromTag("")).toThrow("Malformed tag");
  });

  it("throws for a pre-release suffix", () => {
    expect(() => versionFromTag("v1.2.3-beta.1")).toThrow("Malformed tag");
  });
});
