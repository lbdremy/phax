import { describe, expect, it } from "vitest";
import {
  INTRO,
  checkPageMap,
  definePageMap,
  siteNavigation,
  type PageMap,
  type SourceInventory,
} from "../../../site/build/pageMap.js";

const MAP = definePageMap({
  repository: "https://github.com/example/tool",
  readme: [
    { route: "/", title: "Tool", sections: [INTRO, "Quickstart"] },
    { route: "/guide/run", title: "Running", sections: ["Run", "Locks"] },
    { omit: ["Generated reference"], why: "generated; /reference/cli is the full reference" },
  ],
  files: [
    { route: "/reference/cli", title: "CLI reference", source: "docs/cli/reference.md" },
    { route: "/security", title: "Security", source: "docs/security.md" },
    {
      route: "/compare/other-vs-tool",
      title: "Other vs. tool",
      source: "docs/comparisons/other.md",
    },
    {
      route: "/blog/announcing-tool-1-0",
      title: "Announcing tool 1.0",
      source: "docs/blog/announcing.md",
      holdUntil: "1.0.0",
    },
  ],
});

const SOURCES: SourceInventory = {
  readmeSections: [INTRO, "Quickstart", "Run", "Locks", "Generated reference"],
  files: [
    "docs/blog/announcing.md",
    "docs/cli/reference.md",
    "docs/comparisons/other.md",
    "docs/security.md",
  ],
};

describe("checkPageMap", () => {
  it("accepts a map assigning every section and file exactly once", () => {
    expect(checkPageMap(MAP, SOURCES)).toEqual([]);
  });

  it("names a README section added without a map entry", () => {
    const sources = { ...SOURCES, readmeSections: [...SOURCES.readmeSections, "Contributing"] };
    expect(checkPageMap(MAP, sources)).toEqual([
      '✗ README.md: section "## Contributing" is not in the page map',
    ]);
  });

  it("names a mapped section whose heading was renamed, and the renamed heading", () => {
    const sources = {
      ...SOURCES,
      readmeSections: SOURCES.readmeSections.map((name) => (name === "Locks" ? "Locking" : name)),
    };
    expect(checkPageMap(MAP, sources)).toEqual([
      '✗ README.md: section "## Locking" is not in the page map',
      '✗ page map: names README section "## Locks", which README.md no longer has',
    ]);
  });

  it("names a docs file added without a map entry", () => {
    const sources = { ...SOURCES, files: [...SOURCES.files, "docs/blog/second-post.md"] };
    expect(checkPageMap(MAP, sources)).toEqual([
      "✗ docs/blog/second-post.md: source file is not in the page map",
    ]);
  });

  it("names a mapped file that no longer exists", () => {
    const sources = {
      ...SOURCES,
      files: SOURCES.files.filter((path) => path !== "docs/security.md"),
    };
    expect(checkPageMap(MAP, sources)).toEqual([
      "✗ page map: names docs/security.md, which does not exist",
    ]);
  });

  it("reports every finding, not only the first", () => {
    const sources: SourceInventory = {
      readmeSections: [...SOURCES.readmeSections, "Contributing", "Exit codes"],
      files: [...SOURCES.files, "docs/blog/second-post.md"],
    };
    expect(checkPageMap(MAP, sources)).toHaveLength(3);
  });

  it("refuses a section or file assigned twice and a duplicate route", () => {
    const map: PageMap = {
      ...MAP,
      readme: [...MAP.readme, { route: "/guide/run", title: "Again", sections: ["Run"] }],
      files: [...MAP.files, { omit: "docs/security.md", why: "twice" }],
    };
    expect(checkPageMap(map, SOURCES)).toEqual([
      '✗ page map: README section "## Run" is assigned 2 times',
      "✗ page map: docs/security.md is assigned 2 times",
      "✗ page map: route /guide/run is used 2 times",
    ]);
  });

  it("refuses version-prefixed routes and a hold that is not X.Y.Z", () => {
    const map: PageMap = {
      ...MAP,
      readme: [
        { route: "/v1/guide", title: "Tool", sections: [INTRO, "Quickstart"] },
        { route: "/0.17/run", title: "Running", sections: ["Run", "Locks"], holdUntil: "1.0" },
        { omit: ["Generated reference"], why: "generated" },
      ],
    };
    expect(checkPageMap(map, SOURCES)).toEqual([
      "✗ page map: route /v1/guide starts with a version segment",
      "✗ page map: route /0.17/run starts with a version segment",
      '✗ page map: /0.17/run holds until "1.0", which is not X.Y.Z',
    ]);
  });
});

describe("siteNavigation", () => {
  it("shows the release, no blog and no held page before the hold's release", () => {
    const navigation = siteNavigation(MAP, "0.17.0");
    expect(navigation.nav.map((item) => item.text)).toEqual([
      "Guide",
      "Reference",
      "Security",
      "Compare",
      "v0.17.0",
    ]);
    expect(navigation.nav.at(-1)).toEqual({
      text: "v0.17.0",
      link: "https://github.com/example/tool/releases/tag/v0.17.0",
    });
    expect(navigation.releaseUrl).toBe("https://github.com/example/tool/releases/tag/v0.17.0");
    expect(JSON.stringify(navigation)).not.toContain("/blog/");
    expect(navigation.socialLinks).toEqual([
      { icon: "github", mode: "link", content: "https://github.com/example/tool" },
    ]);
  });

  it("adds the blog once its post is rendered", () => {
    const navigation = siteNavigation(MAP, "1.0.0");
    expect(navigation.nav.map((item) => item.text)).toEqual([
      "Guide",
      "Reference",
      "Security",
      "Compare",
      "Blog",
      "v1.0.0",
    ]);
    const groups = navigation.sidebar["/"] ?? [];
    expect(groups.find((group) => group.text === "Blog")?.items).toEqual([
      { text: "Announcing tool 1.0", link: "/blog/announcing-tool-1-0" },
    ]);
  });

  it("never offers a version switcher", () => {
    for (const version of ["0.17.0", "1.0.0"]) {
      const navigation = siteNavigation(MAP, version);
      expect(navigation.nav.filter((item) => /^v\d/.test(item.text))).toHaveLength(1);
      expect(navigation.nav.every((item) => !("items" in item))).toBe(true);
    }
  });
});
