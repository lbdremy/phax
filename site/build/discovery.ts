// What tells crawlers where the site is: robots.txt, which welcomes every
// crawler (search engines and AI alike) and names the sitemap, and
// sitemap.xml, every rendered route at its clean URL with the date its source
// last changed in git (a page's build date would make every lastmod a lie,
// since the generator rewrites every page on each build). Pure: the dates come
// in from site/build/site.ts.
import { pageUrl } from "./og.js";

/** A rendered route and, when known, the YYYY-MM-DD its source last changed. */
export interface SitemapEntry {
  readonly route: string;
  readonly lastmod?: string;
}

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** sitemap.xml: one `<url>` per route, in route order. */
export function sitemapXml(entries: ReadonlyArray<SitemapEntry>): string {
  const urls = entries
    .toSorted((left, right) => (left.route < right.route ? -1 : 1))
    .map((entry) =>
      [
        "  <url>",
        `    <loc>${escapeXml(pageUrl(entry.route))}</loc>`,
        ...(entry.lastmod === undefined ? [] : [`    <lastmod>${entry.lastmod}</lastmod>`]),
        "  </url>",
      ].join("\n"),
    );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
}

/**
 * robots.txt: every crawler may read every page, and the content signals say
 * the site may be used for search, as AI input and for training, since phax
 * wants to be found and cited.
 */
export function robotsTxt(): string {
  return [
    "# docs.phax.run welcomes every crawler, search engines and AI alike.",
    "User-agent: *",
    "Content-Signal: search=yes, ai-input=yes, ai-train=yes",
    "Allow: /",
    "",
    `Sitemap: ${pageUrl("/sitemap.xml")}`,
    "",
  ].join("\n");
}
