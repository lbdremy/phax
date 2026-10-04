import { describe, expect, it } from "vitest";
import { generateSite, linksLine } from "../../../site/build/generate.js";
import { repositoryOf, type SiteLink } from "../../../site/build/links.js";
import { INTRO, definePageMap } from "../../../site/build/pageMap.js";

const README = [
  "# tool",
  "",
  "Read [orient](docs/cli/reference.md#phax-orient), [shell rules](docs/security.md#shell-command-execution) and [modes](#security-modes).",
  "",
  "Start at the [quickstart](#quickstart) or see the [generated reference](#generated-reference).",
  "",
  "## Quickstart",
  "",
  "Routing is in [routing](docs/model-routing.md); examples live in [examples](examples/).",
  "Ask on [the forum](https://example.com/forum) or [mail](mailto:team@example.com).",
  "",
  "## Run",
  "",
  "Runs every phase; [security modes](#security-modes) apply.",
  "",
  "## Security modes",
  "",
  "Pick a mode.",
  "",
  "## Generated reference",
  "",
  "A [broken link](docs/nowhere.md) nobody renders.",
  "",
].join("\n");

const OPENSPEC = [
  "# OpenSpec vs. tool",
  "",
  "Compare with [Spec Kit](./spec-kit-vs-tool.md) and read [the idea](../ideas/desktop-app.md).",
  "Back to [running](../../README.md#run).",
  "",
].join("\n");

const SPEC_KIT = [
  "# Spec Kit vs. tool",
  "",
  "Read the [announcement](../blog/announcing.md) and the [CLI][cli].",
  "",
  "See also [the post][post].",
  "",
  "[cli]: ../cli/reference.md",
  "[post]: ../blog/announcing.md",
  "",
].join("\n");

const SOURCES: ReadonlyMap<string, string> = new Map([
  ["README.md", README],
  ["docs/cli/reference.md", "# CLI reference\n\n## phax orient\n\nOrients.\n"],
  [
    "docs/security.md",
    "# Security\n\n## Shell command execution\n\nSee [above](#shell-command-execution).\n",
  ],
  ["docs/comparisons/openspec-vs-tool.md", OPENSPEC],
  ["docs/comparisons/spec-kit-vs-tool.md", SPEC_KIT],
  ["docs/blog/announcing.md", "# Announcing tool 1.0\n\nIt shipped.\n"],
]);

/** The repository: the sources plus files the site does not render. */
const REPOSITORY = new Map([
  ...SOURCES,
  ["docs/model-routing.md", "# Model routing\n"],
  ["docs/ideas/desktop-app.md", "# Desktop app\n"],
  ["examples/hello/plan.md", "# Plan\n"],
]);

const MAP = definePageMap({
  repository: "https://github.com/example/tool",
  readme: [
    { route: "/", title: "tool", sections: [INTRO, "Quickstart"] },
    { route: "/guide/run", title: "Running a plan", sections: ["Run"] },
    { route: "/guide/security-modes", title: "Modes", sections: ["Security modes"] },
    { omit: ["Generated reference"], why: "generated" },
  ],
  files: [
    { route: "/reference/cli", title: "CLI", source: "docs/cli/reference.md" },
    { route: "/security", title: "Security", source: "docs/security.md" },
    {
      route: "/compare/openspec-vs-tool",
      title: "OpenSpec",
      source: "docs/comparisons/openspec-vs-tool.md",
    },
    {
      route: "/compare/spec-kit-vs-tool",
      title: "Spec Kit",
      source: "docs/comparisons/spec-kit-vs-tool.md",
    },
    {
      route: "/blog/announcing-tool-1-0",
      title: "Announcing",
      source: "docs/blog/announcing.md",
      holdUntil: "1.0.0",
    },
  ],
});

function generate(version: string, sources: ReadonlyMap<string, string> = SOURCES) {
  return generateSite({
    files: sources,
    pageMap: MAP,
    version,
    repository: repositoryOf([...REPOSITORY.keys(), ...sources.keys()]),
  });
}

function page(version: string, path: string): string {
  const result = generate(version);
  expect(result.findings).toEqual([]);
  return result.files.get(path) ?? "";
}

function withSource(path: string, text: string): ReadonlyMap<string, string> {
  return new Map([...SOURCES, [path, text]]);
}

describe("link rewriting", () => {
  it("points README links at the route and anchor serving the target", () => {
    const index = page("0.17.0", "docs/index.md");
    expect(index).toContain("[orient](/reference/cli#phax-orient)");
    expect(index).toContain("[shell rules](/security#shell-command-execution)");
    expect(index).toContain("[modes](/guide/security-modes#security-modes)");
  });

  it("keeps an in-page anchor whose section shares the page", () => {
    expect(page("0.17.0", "docs/index.md")).toContain("[quickstart](#quickstart)");
    expect(page("0.17.0", "docs/security.md")).toContain("[above](#shell-command-execution)");
  });

  it("moves a README in-page anchor to the route holding its section", () => {
    expect(page("0.17.0", "docs/guide/run.md")).toContain(
      "[security modes](/guide/security-modes#security-modes)",
    );
  });

  it("points links between files at their routes", () => {
    const openspec = page("0.17.0", "docs/compare/openspec-vs-tool.md");
    expect(openspec).toContain("[Spec Kit](/compare/spec-kit-vs-tool)");
    expect(openspec).toContain("[running](/guide/run#run)");
  });

  it("points unrendered files at GitHub at the release tag, and directories at the tree", () => {
    const index = page("0.17.0", "docs/index.md");
    expect(index).toContain(
      "[routing](https://github.com/example/tool/blob/v0.17.0/docs/model-routing.md)",
    );
    expect(index).toContain("[examples](https://github.com/example/tool/tree/v0.17.0/examples)");
    expect(page("0.17.0", "docs/compare/openspec-vs-tool.md")).toContain(
      "[the idea](https://github.com/example/tool/blob/v0.17.0/docs/ideas/desktop-app.md)",
    );
  });

  it("points a link into an omitted README section at README.md on GitHub", () => {
    expect(page("0.17.0", "docs/index.md")).toContain(
      "[generated reference](https://github.com/example/tool/blob/v0.17.0/README.md#generated-reference)",
    );
  });

  it("leaves scheme URLs unchanged", () => {
    const index = page("0.17.0", "docs/index.md");
    expect(index).toContain("[the forum](https://example.com/forum)");
    expect(index).toContain("[mail](mailto:team@example.com)");
  });

  it("rewrites reference definitions", () => {
    expect(page("0.17.0", "docs/compare/spec-kit-vs-tool.md")).toContain("[cli]: /reference/cli");
  });

  it("unlinks a held source before its release and links it from then on", () => {
    const before = generate("0.17.0");
    const held = before.files.get("docs/compare/spec-kit-vs-tool.md") ?? "";
    expect(held).toContain("Read the announcement and the [CLI][cli].");
    expect(held).toContain("See also the post.");
    expect(held).not.toContain("announcing");
    expect(before.summary.links.held).toBe(2);
    const after = page("1.0.0", "docs/compare/spec-kit-vs-tool.md");
    expect(after).toContain("[announcement](/blog/announcing-tool-1-0)");
    expect(after).toContain("[post]: /blog/announcing-tool-1-0");
  });

  it("lists every site link with its origin in links.json", () => {
    const links = JSON.parse(generate("0.17.0").files.get("links.json") ?? "[]") as SiteLink[];
    expect(links).toContainEqual({
      source: "README.md",
      line: 3,
      link: "docs/cli/reference.md#phax-orient",
      route: "/reference/cli",
      anchor: "phax-orient",
    });
    expect(links).toContainEqual({
      source: "docs/comparisons/openspec-vs-tool.md",
      line: 3,
      link: "./spec-kit-vs-tool.md",
      route: "/compare/spec-kit-vs-tool",
      anchor: null,
    });
    expect(links.some((link) => link.route.startsWith("https:"))).toBe(false);
  });

  it("prints the links line", () => {
    expect(linksLine(generate("0.17.0").summary)).toBe(
      "site: links — rewritten to routes and to github.com/example/tool/blob/v0.17.0, 2 held, 0 broken",
    );
  });

  it("checks no link inside an omitted section", () => {
    expect(generate("0.17.0").findings).toEqual([]);
  });
});

describe("broken links", () => {
  // The README links to #shell-command-execution, so the heading stays, last.
  const broken = (text: string) =>
    generate(
      "0.17.0",
      withSource("docs/security.md", `# Security\n\n${text}\n\n## Shell command execution\n`),
    );

  it("names a missing file with its source, line and link", () => {
    const result = broken("See [missing](../docs/missing.md).");
    expect(result.files.size).toBe(0);
    expect(result.findings).toEqual(["✗ docs/security.md:3: ../docs/missing.md — no such file"]);
    expect(linksLine(result.summary)).toMatch(/, 1 broken$/);
  });

  it("names a missing anchor on a rendered target", () => {
    expect(
      generate(
        "0.17.0",
        withSource("README.md", README.replace("#phax-orient", "#phax-no-such-command")),
      ).findings,
    ).toEqual([
      "✗ README.md:3: docs/cli/reference.md#phax-no-such-command — no such anchor on /reference/cli",
    ]);
  });

  it("names a missing in-page anchor", () => {
    expect(broken("Line two.\n\nSee [nothing](#nothing-here).").findings).toEqual([
      "✗ docs/security.md:5: #nothing-here — no such anchor on /security",
    ]);
  });

  it("names a missing README anchor", () => {
    expect(broken("See [run](../README.md#walk).").findings).toEqual([
      "✗ docs/security.md:3: ../README.md#walk — no such anchor on README.md",
    ]);
  });

  it("refuses a relative image, even of an existing file", () => {
    expect(broken("![logo](../examples/hello/plan.md)").findings).toEqual([
      "✗ docs/security.md:3: ../examples/hello/plan.md — relative images are not served",
    ]);
  });

  it("refuses a link leaving the repository", () => {
    expect(broken("See [outside](../../../outside.md).").findings).toEqual([
      "✗ docs/security.md:3: ../../../outside.md — leaves the repository",
    ]);
  });

  it("reports every broken link, not only the first", () => {
    const result = broken("[a](a.md) and [b](b.md).\n\n[c](#c)");
    expect(result.findings).toEqual([
      "✗ docs/security.md:3: a.md — no such file",
      "✗ docs/security.md:3: b.md — no such file",
      "✗ docs/security.md:5: #c — no such anchor on /security",
    ]);
    expect(result.summary.links.broken).toBe(3);
  });

  it("does not check an anchor into a file the site does not render", () => {
    expect(broken("See [routing](../docs/model-routing.md#anything).").findings).toEqual([]);
  });
});
