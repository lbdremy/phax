import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Paragraph } from "mdast";
import { describe, expect, it } from "vitest";
import { generateSite, summaryLine, type SiteJson } from "../../../site/build/generate.js";
import { liveRun } from "../../../site/build/liveRun.js";
import { parseMarkdown, plainText } from "../../../site/build/markdown.js";
import { INTRO, definePageMap, type ReadmePage } from "../../../site/build/pageMap.js";
import { readSources } from "../../../site/build/sources.js";

const README = [
  "# tool",
  "",
  "Tool runs plans <name> by name.",
  "",
  "## Quickstart",
  "",
  "Install it, then run it.",
  "",
  "```md",
  "## Not a section",
  "```",
  "",
  "## Run",
  "",
  "Runs every phase in order.",
  "",
  "## Locks",
  "",
  "One run per plan holds the lock.",
  "",
  "## Generated reference",
  "",
  "A generated summary nobody should see on the site.",
  "",
].join("\n");

const FILES = new Map([
  ["README.md", README],
  ["docs/security.md", "# Security\n\nSandboxes <!-- todo --> every agent.\n"],
  ["docs/blog/announcing.md", "# Announcing tool 1.0\n\nIt shipped.\n"],
]);

const DESCRIBED = "A page of the made-up tool these tests build, said in one sentence.";

/** The site/public files the test homes' video names. */
const VIDEO_ASSETS = new Map([
  ["/tour.mp4", new Uint8Array()],
  ["/tour.jpg", new Uint8Array()],
]);

const MAP = definePageMap({
  repository: "https://github.com/example/tool",
  readme: [
    { route: "/", title: "tool", sections: [INTRO, "Quickstart"] },
    {
      route: "/guide/run",
      title: "Running a plan",
      sections: ["Run", "Locks"],
      description: DESCRIBED,
    },
    { omit: ["Generated reference"], why: "generated" },
  ],
  files: [
    { route: "/security", title: "Security", source: "docs/security.md", description: DESCRIBED },
    {
      route: "/blog/announcing-tool-1-0",
      title: "Announcing tool 1.0",
      source: "docs/blog/announcing.md",
      holdUntil: "1.0.0",
      description: DESCRIBED,
    },
  ],
});

function generate(version: string) {
  return generateSite({ files: FILES, pageMap: MAP, version });
}

function siteJson(files: ReadonlyMap<string, string>): SiteJson {
  return JSON.parse(files.get("site.json") ?? "{}") as SiteJson;
}

describe("generateSite", () => {
  it("writes one page per mapped route holding exactly its sections", () => {
    const result = generate("0.17.0");
    expect(result.findings).toEqual([]);
    expect([...result.files.keys()]).toEqual([
      "docs/guide/run.md",
      "docs/index.md",
      "docs/security.md",
      "links.json",
      "site.json",
      "theme.css",
    ]);
    expect(result.files.get("docs/index.md")).toBe(
      [
        "---",
        'title: "tool"',
        'description: "Tool runs plans <name> by name."',
        "---",
        "",
        "# tool \\{#tool\\}",
        "",
        "Tool runs plans \\<name\\> by name.",
        "",
        "## Quickstart \\{#quickstart\\}",
        "",
        "Install it, then run it.",
        "",
        "```md",
        "## Not a section",
        "```",
        "",
      ].join("\n"),
    );
    expect(result.files.get("docs/guide/run.md")).toBe(
      [
        "---",
        'title: "Running a plan"',
        `description: ${JSON.stringify(DESCRIBED)}`,
        "---",
        "",
        "## Run \\{#run\\}",
        "",
        "Runs every phase in order.",
        "",
        "## Locks \\{#locks\\}",
        "",
        "One run per plan holds the lock.",
        "",
      ].join("\n"),
    );
    expect(result.files.get("docs/security.md")).toBe(
      `---\ntitle: "Security"\ndescription: ${JSON.stringify(DESCRIBED)}\n---\n\n# Security \\{#security\\}\n\nSandboxes  every agent.\n`,
    );
  });

  it("puts the omitted section on no page", () => {
    for (const [, content] of generate("0.17.0").files) {
      expect(content).not.toContain("Generated reference");
      expect(content).not.toContain("nobody should see");
    }
  });

  it("holds the post until its release", () => {
    const before = generate("0.17.0");
    expect(before.files.has("docs/blog/announcing-tool-1-0.md")).toBe(false);
    expect(before.files.get("site.json")).not.toContain("/blog/");
    const after = generate("1.0.0");
    expect(after.files.get("docs/blog/announcing-tool-1-0.md")).toContain("It shipped.");
    expect(siteJson(after.files).routes).toContain("/blog/announcing-tool-1-0");
  });

  it("records routes, heading ids and the release in site.json", () => {
    const site = siteJson(generate("0.17.0").files);
    expect(site.version).toBe("0.17.0");
    expect(site.releaseUrl).toBe("https://github.com/example/tool/releases/tag/v0.17.0");
    expect(site.routes).toEqual(["/", "/guide/run", "/security"]);
    expect(site.headingIds).toEqual({
      "/": ["tool", "quickstart"],
      "/guide/run": ["run", "locks"],
      "/security": ["security"],
    });
  });

  it("summarises pages, sources and README sections", () => {
    expect(summaryLine(generate("0.17.0").summary)).toBe(
      "site: v0.17.0 — 3 pages from 2 sources (README: 4 sections, 1 omitted, 0 held)",
    );
    expect(summaryLine(generate("1.0.0").summary)).toBe(
      "site: v1.0.0 — 4 pages from 3 sources (README: 4 sections, 1 omitted, 0 held)",
    );
  });

  it("is deterministic: two runs give byte-identical output", () => {
    const first = generate("0.17.0");
    const second = generate("0.17.0");
    expect([...second.files]).toEqual([...first.files]);
  });

  it("writes nothing and names every unmapped section", () => {
    const files = new Map(FILES);
    files.set("README.md", `${README}\n## Contributing\n\nSend patches.\n`);
    const result = generateSite({ files, pageMap: MAP, version: "0.17.0" });
    expect(result.files.size).toBe(0);
    expect(result.findings).toEqual([
      '✗ README.md: section "## Contributing" is not in the page map',
    ]);
  });

  it("fails on raw HTML in a rendered section only", () => {
    const files = new Map(FILES);
    files.set("README.md", README.replace("A generated summary", "<details>A generated summary"));
    expect(generateSite({ files, pageMap: MAP, version: "0.17.0" }).findings).toEqual([]);
    files.set("README.md", README.replace("Runs every phase", "<details>Runs every phase"));
    expect(generateSite({ files, pageMap: MAP, version: "0.17.0" }).findings).toEqual([
      "✗ README.md:15: raw HTML <details> is not supported; write Markdown",
    ]);
  });

  it("renders the home's hero, features and live run into / as Rspress's home", () => {
    const map = definePageMap({
      ...MAP,
      readme: [
        {
          ...(MAP.readme[0] as ReadmePage),
          home: {
            name: "tool",
            text: "Plans, gated.",
            tagline: "Runs plans.",
            actions: [{ text: "Run", link: "/guide/run", theme: "brand" }],
            install: "Install it",
            video: { label: "Watch it", src: "/tour.mp4", poster: "/tour.jpg" },
            features: [
              { key: "gates", title: "Gated", details: "Green first.", link: "/guide/run" },
            ],
          },
        },
        MAP.readme[1]!,
        MAP.readme[2]!,
      ],
    });
    const result = generateSite({
      files: FILES,
      pageMap: map,
      version: "0.17.0",
      assets: VIDEO_ASSETS,
    });
    expect(result.findings).toEqual([]);
    const page = result.files.get("docs/index.md") ?? "";
    const frontmatter = page.slice(0, page.indexOf("\n---\n", 4) + 5).split("\n");
    expect(frontmatter.slice(0, 4)).toEqual([
      "---",
      'title: "tool"',
      'description: "Tool runs plans <name> by name."',
      "pageType: home",
    ]);
    const value = (key: string): unknown =>
      JSON.parse(
        frontmatter.find((line) => line.startsWith(`${key}: `))?.slice(key.length + 2) ?? "null",
      );
    expect(value("hero")).toEqual({
      name: "tool",
      text: "Plans, gated.",
      tagline: "Runs plans.",
      actions: [{ text: "Run", link: "/guide/run", theme: "brand" }],
    });
    expect(value("features")).toEqual([
      {
        icon: '<span class="phax-feature-key">gates</span>',
        title: "Gated",
        details: "Green first.",
        link: "/guide/run",
      },
    ]);
    expect(value("install")).toBe("Install it");
    expect(value("video")).toEqual({ label: "Watch it", src: "/tour.mp4", poster: "/tour.jpg" });
    expect(value("description")).toBe("Tool runs plans <name> by name.");
    expect(value("liveRun")).toEqual(liveRun());
    expect(page).toContain("## Quickstart \\{#quickstart\\}");
  });

  it("refuses a home whose install command README.md does not contain", () => {
    const home = {
      name: "tool",
      text: "Plans, gated.",
      tagline: "Runs plans.",
      actions: [],
      install: "npm install -g other-tool",
      video: { label: "Watch it", src: "/tour.mp4", poster: "/tour.jpg" },
      features: [],
    };
    const map = definePageMap({
      ...MAP,
      readme: [{ ...(MAP.readme[0] as ReadmePage), home }, MAP.readme[1]!, MAP.readme[2]!],
    });
    expect(
      generateSite({ files: FILES, pageMap: map, version: "0.17.0", assets: VIDEO_ASSETS })
        .findings,
    ).toEqual([
      '✗ page map: the home\'s install command "npm install -g other-tool" is not in README.md',
    ]);
  });

  it("refuses a home whose video or poster site/public does not hold", () => {
    const home = {
      name: "tool",
      text: "Plans, gated.",
      tagline: "Runs plans.",
      actions: [],
      install: "Install it",
      video: { label: "Watch it", src: "/tour.mp4", poster: "/tour.jpg" },
      features: [],
    };
    const map = definePageMap({
      ...MAP,
      readme: [{ ...(MAP.readme[0] as ReadmePage), home }, MAP.readme[1]!, MAP.readme[2]!],
    });
    const assets = new Map([["/tour.jpg", new Uint8Array()]]);
    expect(
      generateSite({ files: FILES, pageMap: map, version: "0.17.0", assets }).findings,
    ).toEqual(["✗ page map: the home's video names /tour.mp4, which site/public does not hold"]);
  });

  it("refuses a page title whose heading id a section already uses", () => {
    const map = definePageMap({
      ...MAP,
      readme: [
        MAP.readme[0]!,
        { route: "/guide/run", title: "Run", sections: ["Run", "Locks"], description: DESCRIBED },
        MAP.readme[2]!,
      ],
    });
    expect(generateSite({ files: FILES, pageMap: map, version: "0.17.0" }).findings).toEqual([
      '✗ page map: /guide/run has title "Run", whose heading id #run a section already uses',
    ]);
  });
});

describe("the committed site", () => {
  const ROOT = resolve(import.meta.dirname, "../../..");

  it("keeps both generated directories out of git", () => {
    const ignored = readFileSync(join(ROOT, ".gitignore"), "utf8").split("\n");
    expect(ignored).toContain("site/generated/");
    expect(ignored).toContain("site/doc_build/");
  });

  it("copies no source prose into a committed file", () => {
    const paragraphs = [...readSources(ROOT).values()].flatMap((text) =>
      parseMarkdown(text)
        .children.filter((node): node is Paragraph => node.type === "paragraph")
        .map((node) => plainText(node).replace(/\s+/g, " ").trim())
        .filter((paragraph) => paragraph.length >= 60),
    );
    expect(paragraphs.length).toBeGreaterThan(0);
    // The files git tracks under site/, so local renders and the ignored
    // generated directories are never read.
    const tracked = execFileSync("git", ["ls-files", "-z", "--", "site"], {
      cwd: ROOT,
      encoding: "utf8",
    })
      .split("\0")
      .filter((name) => name !== "");
    expect(tracked.length).toBeGreaterThan(0);
    const committed = tracked.map((name) =>
      readFileSync(join(ROOT, name), "utf8").replace(/\s+/g, " "),
    );
    for (const content of committed) {
      for (const paragraph of paragraphs) expect(content).not.toContain(paragraph);
    }
  });
});
