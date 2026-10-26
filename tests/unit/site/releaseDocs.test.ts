import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { commitPlace } from "../../../scripts/releaseNotes.js";

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

  it("documents the release notes, their sources, their preview and the GitHub body", () => {
    const notes = sectionOf("## Release notes");
    for (const text of [
      "pnpm release:notes",
      "docs/releases/",
      "docs/upgrading.md",
      "Run-Id",
      "Short-Name",
      "completes-spec",
      "--github-body",
    ]) {
      expect(notes).toContain(text);
    }
  });

  it("lists a review fix with a forgotten trailer by its type, as the notes script does", () => {
    const where = sectionOf("### Where the notes come from");
    const sentence = /A review fix whose trailer was forgotten [^\n]*?\./.exec(where)?.[0] ?? "";
    expect(sentence).toContain("`fix` under Fixes");
    expect(sentence).toContain("any other under Other");
    const dropped = /under Fixes, (.*) nowhere/.exec(sentence)?.[1] ?? "";
    const types = [
      "fix",
      "feat",
      "perf",
      "revert",
      "test",
      "chore",
      "docs",
      "refactor",
      "style",
      "build",
      "ci",
    ];
    expect(Array.from(dropped.matchAll(/`([a-z]+)`/g), (m) => m[1])).toEqual(
      types.filter((type) => commitPlace(`${type}: x`) === "neither"),
    );
  });

  it("says a completes-spec: false plan is not announced", () => {
    const where = sectionOf("### Where the notes come from");
    expect(where).toContain(
      "A plan with `completes-spec: false` is not announced: the notes announce a spec only once a plan completes it. Its run's commits still belong to its run, so they are listed neither under Fixes nor under Other, and its spec is announced in full by the release that ships the plan with `completes-spec: true`.",
    );
    expect(releaseDocs).not.toContain("Specs in progress");
  });

  it("names the layout's sections and the examples", () => {
    const notes = sectionOf("## Release notes");
    for (const part of [
      "## Highlights",
      "## What's new",
      "## Also in this release",
      "`Now:`",
      "`Before`",
    ]) {
      expect(notes).toContain(part);
    }
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
