import { describe, expect, it } from "vitest";
import type { SiteJson } from "../../../site/build/generate.js";
import type { SiteLink } from "../../../site/build/links.js";
import {
  checkBuiltSite,
  checkLinkAnchors,
  checkServedSchemas,
} from "../../../site/build/postbuild.js";

const RELEASE = "https://github.com/example/tool/releases/tag/v0.17.0";

const SITE: SiteJson = {
  version: "0.17.0",
  releaseUrl: RELEASE,
  nav: [{ text: "v0.17.0", link: RELEASE }],
  sidebar: { "/": [] },
  socialLinks: [],
  routes: ["/", "/guide/run"],
  headingIds: { "/": ["tool"], "/guide/run": ["run", "locks"] },
};

function page(body: string, head = ""): string {
  return (
    `<!doctype html><html><head>${head}<link rel="stylesheet" href="/static/css/styles.css"></head>` +
    `<body><nav><a href="${RELEASE}" target="_blank" class="rp-link">v0.17.0</a>` +
    `<a href="https://github.com/example/tool">GitHub</a></nav>${body}</body></html>`
  );
}

function built(overrides: Record<string, string> = {}): Map<string, string> {
  return new Map(
    Object.entries({
      "index.html": page('<h1 id="tool">tool</h1>'),
      "guide/run.html": page('<h2 id="run">Run</h2><h2 id="locks">Locks</h2>'),
      "static/css/styles.css": "body{background:url(/static/image/bg.png)}",
      "static/js/index.js": 'const page=import("./async/route.js");',
      ...overrides,
    }),
  );
}

describe("checkBuiltSite", () => {
  it("passes a complete local build, outbound links included", () => {
    expect(checkBuiltSite(SITE, built())).toEqual([]);
  });

  it("accepts a route served as a directory index", () => {
    const files = built();
    files.set("guide/run/index.html", files.get("guide/run.html") ?? "");
    files.delete("guide/run.html");
    expect(checkBuiltSite(SITE, files)).toEqual([]);
  });

  it("names a route without its page", () => {
    const files = built();
    files.delete("guide/run.html");
    expect(checkBuiltSite(SITE, files)).toEqual([
      "✗ site/doc_build: route /guide/run has no page (guide/run.html or guide/run/index.html)",
    ]);
  });

  it("names a page without the release label", () => {
    const files = built({
      "guide/run.html": '<html><body><h2 id="run">Run</h2><h2 id="locks">Locks</h2></body></html>',
    });
    expect(checkBuiltSite(SITE, files)).toEqual([
      `✗ site/doc_build/guide/run.html: does not show v0.17.0 linking to ${RELEASE}`,
    ]);
  });

  it("names a page whose release link shows another version", () => {
    const files = built({
      "index.html": page('<h1 id="tool">tool</h1>').replace(">v0.17.0<", ">v0.16.0<"),
    });
    expect(checkBuiltSite(SITE, files)).toEqual([
      `✗ site/doc_build/index.html: does not show v0.17.0 linking to ${RELEASE}`,
    ]);
  });

  it("names a heading id that did not reach the HTML", () => {
    const files = built({
      "guide/run.html": page('<h2 id="run">Run</h2><h2 id="locking">Locks</h2>'),
    });
    expect(checkBuiltSite(SITE, files)).toEqual([
      "✗ site/doc_build/guide/run.html: heading id #locks of route /guide/run is missing",
    ]);
  });

  // Each load sits in a page that is no route (404.html), so only the load is reported.
  it.each([
    ["script src", "404.html", page("", '<script src="https://cdn.example.com/a.js"></script>')],
    [
      "stylesheet",
      "404.html",
      page("", '<link rel="stylesheet" href="https://fonts.example.com/a.css">'),
    ],
    ["preload", "404.html", page("", "<link rel=preload href=https://cdn.example.com/f.woff2>")],
    [
      "modulepreload",
      "404.html",
      page("", '<link rel="modulepreload" href="//cdn.example.com/m.js">'),
    ],
    ["icon", "404.html", page("", '<link rel="shortcut icon" href="https://example.com/i.svg">')],
    ["manifest", "404.html", page("", '<link rel="manifest" href="https://example.com/m.json">')],
    ["img src", "404.html", page('<img src="https://example.com/logo.png">')],
    [
      "img srcset",
      "404.html",
      page('<img src="/a.png" srcset="/a2.png 2x, https://example.com/a3.png 3x">'),
    ],
    [
      "source srcset",
      "404.html",
      page('<picture><source srcset="https://example.com/a.webp"></picture>'),
    ],
    [
      "inline style",
      "404.html",
      page("<style>body{background:url('https://example.com/bg.png')}</style>"),
    ],
    [
      "style attribute",
      "404.html",
      page('<div style="background:url(https://example.com/bg.png)"></div>'),
    ],
    [
      "CSS url()",
      "static/css/styles.css",
      "@font-face{src:url(https://fonts.example.com/f.woff2)}",
    ],
    ["CSS @import", "static/css/styles.css", '@import "https://fonts.example.com/f.css";'],
    ["CSS @import url()", "static/css/styles.css", "@import url(https://fonts.example.com/f.css);"],
    ["JS import()", "static/js/index.js", 'const m=import("https://cdn.example.com/m.js");'],
    ["JS static import", "static/js/index.js", 'import x from"https://cdn.example.com/m.js";'],
  ])("refuses a remote load through %s", (_form, path, content) => {
    const findings = checkBuiltSite(SITE, built({ [path]: content }));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(
      new RegExp(`^✗ site/doc_build/${path.replaceAll(".", "\\.")}: loads .+ from another origin$`),
    );
  });
});

function link(anchor: string | null): SiteLink {
  return {
    source: "README.md",
    line: 12,
    link: anchor === null ? "docs/run.md" : `docs/run.md#${anchor}`,
    route: "/guide/run",
    anchor,
  };
}

describe("checkLinkAnchors", () => {
  it("passes an anchor the target page carries, and a link without one", () => {
    expect(checkLinkAnchors([link("locks"), link(null)], built())).toEqual([]);
  });

  it("names the source, line and link of an anchor the target page lacks", () => {
    expect(checkLinkAnchors([link("resume")], built())).toEqual([
      "✗ README.md:12: docs/run.md#resume — no such anchor on /guide/run",
    ]);
  });
});

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe("checkServedSchemas", () => {
  const expected = new Map([
    ["/_headers", bytes("/schemas/*\n  Content-Type: application/json\n")],
    [
      "/schemas/index.json",
      bytes('{"releases":["0.17.0"],"paths":["/schemas/registry/0.17.0.json"]}\n'),
    ],
    ["/schemas/registry/0.17.0.json", bytes('{"type":"object"}\n')],
  ]);

  it("passes a build holding every served file byte for byte", () => {
    expect(checkServedSchemas(expected, new Map(expected))).toEqual([]);
  });

  it("fails a missing or altered file", () => {
    const output = new Map(expected);
    output.delete("/_headers");
    output.set("/schemas/registry/0.17.0.json", bytes('{ "type": "object" }\n'));
    expect(checkServedSchemas(expected, output)).toEqual([
      "✗ site/doc_build/_headers: missing",
      "✗ site/doc_build/schemas/registry/0.17.0.json: differs from what the build served",
    ]);
  });

  it("fails a pre-schema or next file under schemas/", () => {
    const output = new Map([
      ...expected,
      ["/schemas/registry/pre-schema.json", bytes("{}\n")],
      ["/schemas/run-status/next.json", bytes("{}\n")],
    ]);
    expect(checkServedSchemas(expected, output)).toEqual([
      "✗ site/doc_build/schemas/registry/pre-schema.json: names a snapshot that is never served",
      "✗ site/doc_build/schemas/run-status/next.json: names a snapshot that is never served",
    ]);
  });
});
