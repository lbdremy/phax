import { describe, expect, it } from "vitest";
import { robotsTxt, sitemapXml } from "../../../site/build/discovery.js";

describe("sitemap.xml", () => {
  it("lists every route at its clean URL, in route order, with its source's git date", () => {
    expect(
      sitemapXml([
        { route: "/guide/run", lastmod: "2026-10-04" },
        { route: "/", lastmod: "2026-10-14" },
        { route: "/compare/a&b" },
      ]),
    ).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        "  <url>",
        "    <loc>https://docs.phax.run/</loc>",
        "    <lastmod>2026-10-14</lastmod>",
        "  </url>",
        "  <url>",
        "    <loc>https://docs.phax.run/compare/a&amp;b</loc>",
        "  </url>",
        "  <url>",
        "    <loc>https://docs.phax.run/guide/run</loc>",
        "    <lastmod>2026-10-04</lastmod>",
        "  </url>",
        "</urlset>",
        "",
      ].join("\n"),
    );
  });
});

describe("robots.txt", () => {
  it("welcomes every crawler, signals search and AI use, and names the sitemap", () => {
    const robots = robotsTxt();
    expect(robots).toContain("User-agent: *\n");
    expect(robots).toContain("Allow: /\n");
    expect(robots).not.toMatch(/Disallow/i);
    expect(robots).toContain("Content-Signal: search=yes, ai-input=yes, ai-train=yes\n");
    expect(robots).toContain("Sitemap: https://docs.phax.run/sitemap.xml\n");
  });
});
