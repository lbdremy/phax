import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { npmReadme } from "../../scripts/npmReadme.js";

const repoRoot = join(import.meta.dirname, "../..");
const readme = readFileSync(join(repoRoot, "README.md"), "utf-8");
const manifest = JSON.parse(readFileSync(join(repoRoot, "npm/package.json"), "utf-8")) as {
  readonly description?: string;
  readonly homepage?: string;
  readonly bugs?: { readonly url?: string };
  readonly keywords?: ReadonlyArray<string>;
  readonly files?: ReadonlyArray<string>;
};

describe("npmReadme", () => {
  it("pins relative links and images at the tag on GitHub", () => {
    const text = "See [the docs](docs/security.md) and ![logo](./site/logo.svg).";
    expect(npmReadme(text, "v1.2.3")).toBe(
      "See [the docs](https://github.com/lbdremy/phax/blob/v1.2.3/docs/security.md) and " +
        "![logo](https://github.com/lbdremy/phax/blob/v1.2.3/site/logo.svg).",
    );
  });

  it("links a directory as a tree and keeps a fragment and a title", () => {
    expect(npmReadme('[x](examples/hello-world/) [y](docs/a.md#b "t")', "v1.0.0")).toBe(
      "[x](https://github.com/lbdremy/phax/tree/v1.0.0/examples/hello-world/) " +
        '[y](https://github.com/lbdremy/phax/blob/v1.0.0/docs/a.md#b "t")',
    );
  });

  it("leaves absolute URLs, anchors and other schemes as written", () => {
    const text = "[a](https://docs.phax.run) [b](#quickstart) [c](mailto:x@example.com) [d](//cdn)";
    expect(npmReadme(text, "v1.0.0")).toBe(text);
  });

  it("leaves fenced code untouched", () => {
    const text = "```md\n[a](docs/a.md)\n```\n~~~\n[b](b.md)\n~~~\n[c](c.md)";
    expect(npmReadme(text, "v1.0.0")).toBe(
      "```md\n[a](docs/a.md)\n```\n~~~\n[b](b.md)\n~~~\n" +
        "[c](https://github.com/lbdremy/phax/blob/v1.0.0/c.md)",
    );
  });

  it("leaves no relative link in the README it ships", () => {
    const shipped = npmReadme(readme, "v9.9.9");
    const outsideFences = shipped.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm, "");
    const targets = [...outsideFences.matchAll(/\]\(([^)\s]+)/g)].map((match) => match[1]!);
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.filter((target) => !/^(?:https?:|#)/.test(target))).toEqual([]);
  });
});

describe("npm/package.json", () => {
  it("ships the README the release writes next to it", () => {
    expect(manifest.files).toContain("README.md");
  });

  it("describes phax with the README's first sentence", () => {
    const first = readme.split("\n").find((line) => line.startsWith("phax runs"));
    expect(first?.replaceAll("**", "")).toBe(manifest.description);
  });

  it("names the docs site, the issue tracker and its keywords", () => {
    expect(manifest.homepage).toBe("https://docs.phax.run");
    expect(manifest.bugs?.url).toBe("https://github.com/lbdremy/phax/issues");
    // The same words as the GitHub repository's topics, so both describe phax alike.
    expect(manifest.keywords).toEqual([
      "agent-harness",
      "agentic-coding",
      "claude-code",
      "codex-cli",
      "deterministic-ai",
      "git-worktree",
      "mistral-vibe",
      "quality-gates",
      "spec-driven-development",
    ]);
  });
});
