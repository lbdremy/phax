// The social card: site/public/og.png, the 1200×630 image link previews show
// (X, WhatsApp, Slack, LinkedIn…), which every page names in its og:image and
// twitter:image tags. `pnpm site:og` draws it from the dark theme's tokens,
// the committed logo and the self-hosted IBM Plex fonts, and renders it with
// a local headless Chrome (PHAX_CHROME, or the macOS default). The PNG is
// committed, so building the site never needs Chrome; rerun this after a
// change to the card, the tokens or the logo.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { SCHEMA_URL_BASE } from "../../src/schemas/schemaUrl.js";
import { THEMES } from "../theme/tokens.js";

/** The site's origin, the one its schema URLs are served from. */
export const SITE_ORIGIN = new URL(SCHEMA_URL_BASE).origin;

/** The card's path in site/public, and the size every platform expects. */
export const OG_IMAGE_PATH = "/og.png";
export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;
export const OG_IMAGE_URL = `${SITE_ORIGIN}${OG_IMAGE_PATH}`;
export const OG_IMAGE_ALT = "phax — the golden path, just facts";

type HeadTag = [string, Record<string, string>];

function meta(key: "property" | "name", name: string, content: string): HeadTag {
  return ["meta", { [key]: name, content }];
}

/**
 * The tags every page carries for link previews: the card as og:image and
 * twitter:image (a large-image card), and the page's own URL as og:url.
 * Rspress adds og:title and og:description from each page's title and first
 * paragraph; the home's description is README.md's first paragraph.
 */
export function socialHead(): Array<HeadTag | ((route: { routePath: string }) => HeadTag)> {
  return [
    meta("property", "og:type", "website"),
    meta("property", "og:site_name", "phax"),
    meta("property", "og:image", OG_IMAGE_URL),
    meta("property", "og:image:width", String(OG_IMAGE_WIDTH)),
    meta("property", "og:image:height", String(OG_IMAGE_HEIGHT)),
    meta("property", "og:image:alt", OG_IMAGE_ALT),
    meta("name", "twitter:card", "summary_large_image"),
    meta("name", "twitter:image", OG_IMAGE_URL),
    meta("name", "twitter:image:alt", OG_IMAGE_ALT),
    (route) => meta("property", "og:url", `${SITE_ORIGIN}${route.routePath}`),
  ];
}

/** The font file the card uses, as a URL the renderer can load. */
export interface CardFonts {
  readonly sans600: string;
}

/**
 * The golden path along the card's foot, as a picture with no words, so it
 * still reads at a preview's size: spec and plan, three phases with a gate cut
 * into the rail after each, then compliance, review and the pull request.
 */
const PATH: ReadonlyArray<{ readonly phase: boolean; readonly gate: boolean }> = [
  { phase: false, gate: false },
  { phase: false, gate: false },
  { phase: true, gate: false },
  { phase: true, gate: true },
  { phase: true, gate: true },
  { phase: false, gate: true },
  { phase: false, gate: false },
  { phase: false, gate: false },
];

/**
 * The card as a self-contained HTML page, 1200×630, in the dark theme. A
 * preview shows it a few hundred pixels wide, beside the page's title, the
 * description and the domain, so it holds only what reads at that size: the
 * logo and name, the promise, and the golden path.
 */
export function cardHtml(logoSvg: string, fonts: CardFonts): string {
  const theme = THEMES.dark;
  const logo = logoSvg.replace("<svg ", '<svg class="logo" ');
  const steps = PATH.map(
    (step, index) =>
      `${index === 0 ? "" : `<i class="rail${step.gate ? " rail--gate" : ""}"></i>`}` +
      `<span class="step${step.phase ? " step--phase" : ""}"></span>`,
  ).join("");
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
@font-face { font-family: "Plex Sans"; font-weight: 600; src: url("${fonts.sans600}") format("woff2"); }
* { box-sizing: border-box; margin: 0; }
html, body { width: ${OG_IMAGE_WIDTH}px; height: ${OG_IMAGE_HEIGHT}px; overflow: hidden; }
body {
  position: relative;
  padding: 72px 88px 0;
  background:
    radial-gradient(80% 95% at 100% 0%, ${theme.fill}38 0%, ${theme.fill}14 45%, transparent 100%),
    ${theme.bg};
  color: ${theme.text1};
  font-family: "Plex Sans", sans-serif;
  font-weight: 600;
}
.brand { display: flex; align-items: center; gap: 22px; }
.logo { width: 80px; height: 80px; }
.brand b { font-size: 60px; letter-spacing: -0.02em; }
h1 { margin-top: 52px; font-size: 112px; line-height: 1.02; letter-spacing: -0.03em; }
h1 em { font-style: normal; color: ${theme.brand}; }
.path { position: absolute; left: 88px; right: 88px; bottom: 64px; display: flex; align-items: center; }
.step { flex: none; width: 48px; height: 32px; border-radius: 7px; border: 2px solid ${theme.text2}66; background: ${theme.bgSoft}; }
.step--phase { width: 112px; border-color: ${theme.fill}; background: ${theme.fill}; }
.rail { flex: 1; height: 5px; background: ${theme.brand}; }
.rail--gate { background: linear-gradient(90deg, ${theme.brand} 0 38%, transparent 38% 62%, ${theme.brand} 62% 100%); }
</style></head><body>
<div class="brand">${logo}<b>phax</b></div>
<h1>The <em>golden path</em>,<br>just facts.</h1>
<div class="path">${steps}</div>
</body></html>
`;
}

const CHROME_MAC = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function fontUrl(require: NodeJS.Require, file: string): string {
  return pathToFileURL(require.resolve(file)).href;
}

/** Renders the card with a local headless Chrome into site/public/og.png. */
function render(): void {
  const siteDir = resolve(import.meta.dirname, "..");
  const require = createRequire(join(siteDir, "..", "package.json"));
  const html = cardHtml(readFileSync(join(siteDir, "public", "logo.svg"), "utf8"), {
    sans600: fontUrl(
      require,
      "@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2",
    ),
  });
  const work = mkdtempSync(join(tmpdir(), "phax-og-"));
  try {
    const page = join(work, "card.html");
    writeFileSync(page, html);
    const out = join(siteDir, "public", "og.png");
    const chrome = process.env["PHAX_CHROME"] ?? CHROME_MAC;
    const result = spawnSync(
      chrome,
      [
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--no-first-run",
        `--user-data-dir=${join(work, "profile")}`,
        `--window-size=${OG_IMAGE_WIDTH},${OG_IMAGE_HEIGHT}`,
        "--virtual-time-budget=2000",
        `--screenshot=${out}`,
        pathToFileURL(page).href,
      ],
      { encoding: "utf8" },
    );
    if (result.status !== 0) {
      throw new Error(`site:og: ${chrome} exited with ${result.status ?? result.signal}`);
    }
    console.log(`site:og: wrote ${out}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (import.meta.filename === process.argv[1]) render();
