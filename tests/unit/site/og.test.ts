import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readmeDescription } from "../../../site/build/generate.js";
import {
  GITHUB_PREVIEW_PATH,
  GITHUB_PREVIEW_SIZE,
  OG_IMAGE_HEIGHT,
  OG_IMAGE_URL,
  OG_IMAGE_WIDTH,
  SITE_ORIGIN,
  WEBSITE_JSON_LD,
  cardHtml,
  socialHead,
} from "../../../site/build/og.js";
import { THEMES } from "../../../site/theme/tokens.js";

const ROOT = resolve(import.meta.dirname, "../../..");

/** A PNG's width and height, read from its IHDR chunk. */
function pngSize(path: string): readonly [number, number] {
  const png = readFileSync(resolve(ROOT, path));
  expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(png.subarray(12, 16).toString("latin1")).toBe("IHDR");
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

describe("the social card", () => {
  it("is a 1200×630 PNG, the size link previews expect", () => {
    expect(pngSize("site/public/og.png")).toEqual([OG_IMAGE_WIDTH, OG_IMAGE_HEIGHT]);
  });

  it("has a 1280×640 variant under 1 MB for GitHub's social preview", () => {
    expect(pngSize(GITHUB_PREVIEW_PATH)).toEqual([
      GITHUB_PREVIEW_SIZE.width,
      GITHUB_PREVIEW_SIZE.height,
    ]);
    expect(readFileSync(resolve(ROOT, GITHUB_PREVIEW_PATH)).length).toBeLessThan(1_000_000);
  });

  it("is drawn from the dark theme, the logo and the promise, with no remote resource", () => {
    const html = cardHtml('<svg viewBox="0 0 32 32"></svg>', { sans600: "file:///font.woff2" });
    expect(html).toContain(THEMES.dark.bg);
    expect(html).toContain(THEMES.dark.fill);
    expect(html).toContain('<svg class="logo" viewBox="0 0 32 32">');
    expect(html).toContain("The <em>golden path</em>,<br>just facts.");
    expect(html).not.toMatch(/https?:\/\//);
  });
});

describe("the link-preview tags", () => {
  const tags = socialHead();
  const statics = tags.filter((tag) => typeof tag !== "function");

  it("name the card on the site's origin as a large-image preview", () => {
    expect(SITE_ORIGIN).toBe("https://docs.phax.run");
    expect(OG_IMAGE_URL).toBe("https://docs.phax.run/og.png");
    expect(statics).toContainEqual(["meta", { property: "og:image", content: OG_IMAGE_URL }]);
    expect(statics).toContainEqual([
      "meta",
      { name: "twitter:card", content: "summary_large_image" },
    ]);
    expect(statics).toContainEqual(["meta", { property: "og:image:width", content: "1200" }]);
  });

  const perRoute = (routePath: string) =>
    tags.flatMap((tag) => {
      if (typeof tag !== "function") return [];
      const result = tag({ routePath });
      return result === undefined ? [] : [result];
    });

  it("give each page its clean URL as canonical and og:url", () => {
    expect(perRoute("/guide/run")).toEqual([
      ["link", { rel: "canonical", href: "https://docs.phax.run/guide/run" }],
      ["meta", { property: "og:url", content: "https://docs.phax.run/guide/run" }],
    ]);
  });

  it("give the home the WebSite structured data", () => {
    const home = perRoute("/");
    expect(home).toHaveLength(3);
    expect(home[2]).toBe(`<script type="application/ld+json">${WEBSITE_JSON_LD}</script>`);
    expect(JSON.parse(WEBSITE_JSON_LD)).toEqual({
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "phax",
      url: "https://docs.phax.run/",
    });
  });
});

describe("the site's description", () => {
  it("is README.md's first paragraph, as plain text", () => {
    expect(readmeDescription("# tool\n\nTool runs **gated** plans.\n\n## Install\n\nMore.\n")).toBe(
      "Tool runs gated plans.",
    );
  });
});
