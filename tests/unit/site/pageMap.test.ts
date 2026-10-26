import { describe, expect, it } from "vitest";
import {
  INTRO,
  checkPageMap,
  definePageMap,
  releaseNotePages,
  siteNavigation,
  type PageMap,
  type SourceInventory,
} from "../../../site/build/pageMap.js";

const DESCRIBED = "A page of the made-up tool these tests map, said in one sentence.";

const MAP = definePageMap({
  repository: "https://github.com/example/tool",
  readme: [
    { route: "/", title: "Tool", sections: [INTRO, "Quickstart"] },
    { route: "/guide/run", title: "Running", sections: ["Run", "Locks"], description: DESCRIBED },
    { omit: ["Generated reference"], why: "generated; /reference/cli is the full reference" },
  ],
  files: [
    {
      route: "/reference/cli",
      title: "CLI reference",
      source: "docs/cli/reference.md",
      description: DESCRIBED,
    },
    { route: "/security", title: "Security", source: "docs/security.md", description: DESCRIBED },
    {
      route: "/compare/other-vs-tool",
      title: "Other vs. tool",
      source: "docs/comparisons/other.md",
      description: DESCRIBED,
    },
    {
      route: "/blog/announcing-tool-1-0",
      title: "Announcing tool 1.0",
      source: "docs/blog/announcing.md",
      holdUntil: "1.0.0",
      description: DESCRIBED,
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
      readme: [
        ...MAP.readme,
        { route: "/guide/run", title: "Again", sections: ["Run"], description: DESCRIBED },
      ],
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
        {
          route: "/v1/guide",
          title: "Tool",
          sections: [INTRO, "Quickstart"],
          description: DESCRIBED,
        },
        {
          route: "/0.17/run",
          title: "Running",
          sections: ["Run", "Locks"],
          holdUntil: "1.0",
          description: DESCRIBED,
        },
        { omit: ["Generated reference"], why: "generated" },
      ],
    };
    expect(checkPageMap(map, SOURCES)).toEqual([
      "✗ page map: route /v1/guide starts with a version segment",
      "✗ page map: route /0.17/run starts with a version segment",
      '✗ page map: /0.17/run holds until "1.0", which is not X.Y.Z',
    ]);
  });

  it("describes every page but /, in 50 to 160 characters", () => {
    const map: PageMap = {
      ...MAP,
      readme: [
        { route: "/", title: "Tool", sections: [INTRO, "Quickstart"], description: DESCRIBED },
        { route: "/guide/run", title: "Running", sections: ["Run", "Locks"] },
        { omit: ["Generated reference"], why: "generated" },
      ],
      files: [
        {
          route: "/reference/cli",
          title: "CLI reference",
          source: "docs/cli/reference.md",
          description: "Too short.",
        },
        ...MAP.files.slice(1),
      ],
    };
    expect(checkPageMap(map, SOURCES)).toEqual([
      "✗ page map: / takes README.md's first paragraph as its description, not its own",
      "✗ page map: /guide/run has no description",
      "✗ page map: /reference/cli's description is 10 characters, not 50 to 160",
    ]);
  });

  it("lets only / have a home, and only link to routes every build renders", () => {
    const home = {
      name: "tool",
      text: "Plans, gated.",
      tagline: "Runs plans.",
      actions: [{ text: "Run", link: "/guide/run", theme: "brand" as const }],
      install: "npm install -g tool",
      video: { label: "Watch it", src: "/tour.mp4", poster: "/tour.jpg" },
      features: [
        { key: "post", title: "1.0", details: "Shipped.", link: "/blog/announcing-tool-1-0" },
        { key: "gone", title: "Gone", details: "Missing.", link: "/guide/missing" },
      ],
    };
    const map: PageMap = {
      ...MAP,
      readme: [
        { route: "/", title: "Tool", sections: [INTRO, "Quickstart"], home },
        {
          route: "/guide/run",
          title: "Running",
          sections: ["Run", "Locks"],
          home,
          description: DESCRIBED,
        },
        { omit: ["Generated reference"], why: "generated" },
      ],
    };
    expect(checkPageMap(map, SOURCES)).toEqual([
      "✗ page map: the home links to /blog/announcing-tool-1-0, which is not a route every build renders",
      "✗ page map: the home links to /guide/missing, which is not a route every build renders",
      "✗ page map: /guide/run has a home, which only / may have",
      "✗ page map: the home links to /blog/announcing-tool-1-0, which is not a route every build renders",
      "✗ page map: the home links to /guide/missing, which is not a route every build renders",
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

const described = (version: string): string =>
  `What phax ${version} changes: the specs and plans it delivers, its fixes and its upgrade steps.`;

describe("releaseNotePages", () => {
  it("gives each notes file its route, title and description, newest first", () => {
    const { pages, findings } = releaseNotePages([
      "docs/releases/1.2.0.md",
      "docs/releases/1.10.0.md",
      "docs/security.md",
    ]);
    expect(findings).toEqual([]);
    expect(pages).toEqual([
      {
        route: "/releases/1-10-0",
        title: "phax 1.10.0",
        source: "docs/releases/1.10.0.md",
        description: described("1.10.0"),
      },
      {
        route: "/releases/1-2-0",
        title: "phax 1.2.0",
        source: "docs/releases/1.2.0.md",
        description: described("1.2.0"),
      },
    ]);
  });

  it("names a misnamed file in the directory", () => {
    const { pages, findings } = releaseNotePages([
      "docs/releases/next.md",
      "docs/releases/0.28.md",
    ]);
    expect(pages).toEqual([]);
    expect(findings).toEqual([
      "✗ docs/releases/0.28.md: a release notes file is named X.Y.Z.md",
      "✗ docs/releases/next.md: a release notes file is named X.Y.Z.md",
    ]);
  });

  it("has a Releases sidebar group and nav entry only when there is a page", () => {
    const without = siteNavigation(MAP, "0.28.0");
    expect(without.nav.map((item) => item.text)).not.toContain("Releases");
    expect(without.sidebar["/"]?.map((group) => group.text)).not.toContain("Releases");

    const withPages = definePageMap({
      ...MAP,
      files: [...MAP.files, ...releaseNotePages(["docs/releases/0.28.0.md"]).pages],
    });
    const navigation = siteNavigation(withPages, "0.28.0");
    expect(navigation.nav.map((item) => item.text)).toContain("Releases");
    expect(navigation.sidebar["/"]?.find((group) => group.text === "Releases")?.items).toEqual([
      { text: "phax 0.28.0", link: "/releases/0-28-0" },
    ]);
  });
});
