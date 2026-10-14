// Rspress config for docs.phax.run. It renders site/generated/docs, which
// `pnpm site:build` (site/build/site.ts) writes from the repository's docs,
// and takes the nav and sidebar from site/generated/site.json, so nothing is
// computed here. Local search only; no last-updated, edit links, analytics or
// remote resource. The identity: dark first, the theme CSS generated from
// site/theme/tokens.ts, the logo (the dark-accent file is the favicon)
// beside the lowercase wordmark, site/theme/index.tsx's home, and the social
// card (site/build/og.ts) in every page's link-preview tags.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type UserConfig } from "@rspress/core";
import { THEME_CSS, type SiteJson } from "./build/generate.js";
import { SITE_ORIGIN, socialHead } from "./build/og.js";
import { DARK_MODE } from "./theme/appearance.js";

const SITE_JSON = resolve(import.meta.dirname, "generated/site.json");

if (!existsSync(SITE_JSON)) {
  throw new Error(`${SITE_JSON} is missing: run pnpm site:build`);
}
const site = JSON.parse(readFileSync(SITE_JSON, "utf8")) as SiteJson;

export default defineConfig({
  root: resolve(import.meta.dirname, "generated/docs"),
  outDir: resolve(import.meta.dirname, "doc_build"),
  title: "phax",
  description: site.description,
  siteOrigin: SITE_ORIGIN,
  head: socialHead(),
  // One URL per page: /guide/run, never /guide/run.html.
  route: { cleanUrls: true },
  logo: { dark: "/logo.svg", light: "/logo-light.svg" },
  logoText: "phax",
  icon: "/logo.svg",
  globalStyles: resolve(import.meta.dirname, "generated", THEME_CSS),
  themeDir: resolve(import.meta.dirname, "theme"),
  lang: "en",
  search: { codeBlocks: true },
  // llms.txt, llms-full.txt and a .md twin of every page, for coding agents.
  llms: true,
  markdown: {
    // Links are emitted as the sources wrote them; site/build checks its own.
    link: { checkDeadLinks: false, checkAnchors: false },
  },
  themeConfig: {
    nav: site.nav as NonNullable<NonNullable<UserConfig["themeConfig"]>["nav"]>,
    sidebar: site.sidebar as NonNullable<NonNullable<UserConfig["themeConfig"]>["sidebar"]>,
    socialLinks: [...site.socialLinks],
    lastUpdated: false,
    darkMode: DARK_MODE,
  },
});
