import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const releaseDocs = readFileSync(join(import.meta.dirname, "../../../docs/release.md"), "utf-8");

const sectionOf = (heading: string): string => {
  const start = releaseDocs.indexOf(`\n${heading}\n`);
  expect(start, `missing heading: ${heading}`).toBeGreaterThanOrEqual(0);
  const level = heading.match(/^#+/)?.[0].length ?? 1;
  const rest = releaseDocs.slice(start + heading.length + 2);
  const next = rest.search(new RegExp(`\\n#{1,${level}} `));
  return next === -1 ? rest : rest.slice(0, next);
};

describe("docs/release.md documents the docs site", () => {
  it("has a one-time docs-site setup under Prerequisites, stated as manual", () => {
    const prerequisites = releaseDocs.slice(
      releaseDocs.indexOf("\n## Prerequisites\n"),
      releaseDocs.indexOf("\n## Release process\n"),
    );
    expect(prerequisites).toContain("### The docs site (one-time, by hand — never automated)");
    const setup = sectionOf("### The docs site (one-time, by hand — never automated)");
    expect(setup).toContain("never automated");
    expect(setup).toContain("phax.run zone");
    expect(setup).toContain("CLOUDFLARE_API_TOKEN");
    expect(setup).toContain("CLOUDFLARE_ACCOUNT_ID");
    expect(setup).toContain("docs.phax.run");
    expect(setup).toContain("preview URL");
    expect(setup).toContain("phax-docs");
  });

  it("mentions the ledger append and the docs deploy before the npm stage publish", () => {
    const process = sectionOf("## Release process");
    expect(process).toContain("packages/schemas/releases.json");
    const deploy = process.indexOf("docs.phax.run");
    const stage = process.indexOf("npm stage publish");
    expect(deploy).toBeGreaterThanOrEqual(0);
    expect(stage).toBeGreaterThanOrEqual(0);
    expect(deploy).toBeLessThan(stage);
    for (const step of ["guard", "upload", "check", "promote"]) {
      expect(process).toContain(step);
    }
    expect(process).toContain("vX-Y-Z");
  });

  it("describes the opened version and re-opening with --open", () => {
    const process = sectionOf("## Release process");
    expect(process).toContain("opened version");
    expect(process).toContain("scripts/release.sh --open");
    expect(process).toContain("chore: open v");
  });

  it("verifies the docs site and the previous preview URL in step 5", () => {
    const verify = sectionOf("### 5. Verify");
    expect(verify).toContain("schemas/registry/");
    expect(verify).toContain("preview URL");
    expect(verify).toContain("docs.phax.run");
  });

  it("has a manual redeploy section naming docs-deploy.yml", () => {
    const redeploy = sectionOf("## Redeploying the docs site by hand");
    expect(redeploy).toContain("docs-deploy.yml");
    expect(redeploy).toContain("gh workflow run docs-deploy.yml -f tag=vX.Y.Z");
    expect(redeploy).toContain("pnpm site:preview");
  });

  it("keeps the existing sections", () => {
    for (const heading of [
      "## Prerequisites",
      "## Release process",
      "## macOS Gatekeeper",
      "## Deleting and re-pushing a tag",
    ]) {
      expect(releaseDocs).toContain(`\n${heading}\n`);
    }
  });
});
