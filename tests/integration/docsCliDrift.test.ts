import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildCliSummary,
  injectReadmeSection,
  README_BEGIN,
  README_END,
} from "../../scripts/docs-cli.js";

const repoRoot = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");

describe("docs:cli drift", () => {
  it("docs/cli/reference.md matches a fresh generation from phax.usage.kdl", () => {
    const specPath = join(repoRoot, "phax.usage.kdl");
    const committedRef = readFileSync(join(repoRoot, "docs/cli/reference.md"), "utf8");

    const tmpDir = mkdtempSync(join(tmpdir(), "phax-docs-"));
    const tmpRef = join(tmpDir, "reference.md");

    execSync(`usage generate markdown -f "${specPath}" --out-file "${tmpRef}"`);
    const freshRef = readFileSync(tmpRef, "utf8");

    expect(freshRef).toBe(committedRef);
  });

  it("README.md CLI section matches a fresh generation", () => {
    const readme = readFileSync(join(repoRoot, "README.md"), "utf8");

    const beginIdx = readme.indexOf(README_BEGIN);
    const endIdx = readme.indexOf(README_END);
    expect(beginIdx, `README.md missing: ${README_BEGIN}`).toBeGreaterThan(-1);
    expect(endIdx, `README.md missing: ${README_END}`).toBeGreaterThan(-1);

    const committedSection = readme.slice(beginIdx + README_BEGIN.length, endIdx);

    const specPath = join(repoRoot, "phax.usage.kdl");
    const tmpDir = mkdtempSync(join(tmpdir(), "phax-docs-"));
    const tmpRef = join(tmpDir, "reference.md");
    execSync(`usage generate markdown -f "${specPath}" --out-file "${tmpRef}"`);

    const freshRef = readFileSync(tmpRef, "utf8");
    const expectedContent = "\n\n" + buildCliSummary(freshRef) + "\n\n";

    expect(committedSection).toBe(expectedContent);
  });

  it("README.md injection is idempotent (running docs:cli twice produces no diff)", () => {
    const readmePath = join(repoRoot, "README.md");
    const readme = readFileSync(readmePath, "utf8");

    const specPath = join(repoRoot, "phax.usage.kdl");
    const tmpDir = mkdtempSync(join(tmpdir(), "phax-docs-"));
    const tmpRef = join(tmpDir, "reference.md");
    execSync(`usage generate markdown -f "${specPath}" --out-file "${tmpRef}"`);

    const freshRef = readFileSync(tmpRef, "utf8");
    const summary = buildCliSummary(freshRef);

    const once = injectReadmeSection(readme, summary);
    const twice = injectReadmeSection(once, summary);

    expect(twice).toBe(once);
  });
});
