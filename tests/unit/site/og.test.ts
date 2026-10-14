import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readmeDescription } from "../../../site/build/generate.js";
import {
  OG_IMAGE_HEIGHT,
  OG_IMAGE_URL,
  OG_IMAGE_WIDTH,
  SITE_ORIGIN,
  cardHtml,
  socialHead,
} from "../../../site/build/og.js";
import { THEMES } from "../../../site/theme/tokens.js";

const OG_PNG = resolve(import.meta.dirname, "../../../site/public/og.png");

describe("the social card", () => {
  it("is a 1200×630 PNG, the size link previews expect", () => {
    const png = readFileSync(OG_PNG);
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(png.subarray(12, 16).toString("latin1")).toBe("IHDR");
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([OG_IMAGE_WIDTH, OG_IMAGE_HEIGHT]);
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

  it("give each page its own URL", () => {
    const perRoute = tags.find((tag) => typeof tag === "function");
    expect(perRoute?.({ routePath: "/guide/run" })).toEqual([
      "meta",
      { property: "og:url", content: "https://docs.phax.run/guide/run" },
    ]);
  });
});

describe("the site's description", () => {
  it("is README.md's first paragraph, as plain text", () => {
    expect(readmeDescription("# tool\n\nTool runs **gated** plans.\n\n## Install\n\nMore.\n")).toBe(
      "Tool runs gated plans.",
    );
  });
});
